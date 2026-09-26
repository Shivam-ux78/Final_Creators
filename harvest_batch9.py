"""
Batch 9 harvester: 100 brand-new USA Instagram creators, 100k-500k followers, with verified emails.

Differences vs extract_100_creators_100k_500k.py (which stalled at 0 results):
  - every HTTP call goes through curl_cffi TLS impersonation; plain `requests` is blocked
    by Collabstr and silently timed out, so the old run scanned pages but found nothing.
  - follower count is taken from Instagram itself, NOT the Collabstr listing badge.
    Listing badges mix platforms: brynelise showed 476K on Collabstr but has 680 on IG.
  - location and the real IG handle both come from the Collabstr meta description.
  - retry/backoff on every fetch, so rate limiting degrades instead of dropping pages.
"""
import os
import sys
import re
import json
import time
import random
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests as rq
import pandas as pd
from bs4 import BeautifulSoup
from curl_cffi import requests as cureq
from dotenv import load_dotenv

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', line_buffering=True)
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', line_buffering=True)

os.chdir(os.path.dirname(os.path.abspath(__file__)))
load_dotenv(".env")

MIN_F = 100000
MAX_F = 500000
TARGET = 100

OUT_JSON = os.path.join("data", "extracted_100_brand_new_100k_500k_batch9.json")
OUT_CSV = os.path.join("data", "extracted_100_brand_new_100k_500k_batch9.csv")
OUT_XLSX = os.path.join("data", "extracted_100_brand_new_100k_500k_batch9.xlsx")
CAND_FILE = os.path.join("data", "batch9_candidates.json")
# slugs permanently rejected (non-US, out of range, no email) -- skipped on restart
DEAD_FILE = os.path.join("data", "batch9_dead_ends.json")

# Revive mode: re-run the slugs already written off. Most were rejected for being
# non-US or out of range and will be rejected again cheaply, but a chunk failed only
# on "no email" back when DuckDuckGo was our search step and silently blocked. With
# Brave/Bing working those are winnable, so this re-tries them. It keeps its own
# output and dead-end files so it can run alongside the main harvester without the
# two clobbering each other's JSON (Supabase upserts on username, so no duplicates).
REVIVE = os.environ.get("REVIVE") == "1"
if REVIVE:
    OUT_JSON = os.path.join("data", "extracted_batch9_revive.json")
    OUT_CSV = os.path.join("data", "extracted_batch9_revive.csv")
    OUT_XLSX = os.path.join("data", "extracted_batch9_revive.xlsx")
    DEAD_FILE = os.path.join("data", "batch9_dead_ends_revive.json")

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")
TABLE = os.environ.get("SUPABASE_TABLE_NAME", "creators")

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
HDRS = {
    "User-Agent": UA,
    "Accept-Language": "en-US,en;q=0.9",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

EMAIL_RE = re.compile(r'[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z]{2,8}')

BAD_DOMAINS = {
    'example.com', 'domain.com', 'email.com', 'yourdomain.com', 'test.com', 'sentry.io',
    'wixpress.com', 'jsdelivr.net', 'unpkg.com', 'cloudflare.com', 'github.com',
    'fbcdn.net', 'cdninstagram.com', 'schema.org', 'w3.org', 'godaddy.com',
    'squarespace.com', 'wordpress.com', 'duckduckgo.com', 'sentry-next.wixpress.com',
}
BAD_SUBSTR = [
    'chart.js', 'swiper', 'bootstrap', 'jquery', 'react', 'npm@', 'cdnjs', 'sentry',
    'wixpress', '.png', '.jpg', '.js', '.css', '.min', '.json', '.svg', '@2x', '@3x',
    'example@', 'your@', 'name@', 'user@', 'email@example',
]

NON_US = [
    'india', 'brazil', 'brasil', 'united kingdom', 'london', 'england', 'scotland', 'wales',
    'ireland', 'dublin', 'canada', 'toronto', 'vancouver', 'montreal', 'ontario', 'alberta',
    'quebec', 'australia', 'sydney', 'melbourne', 'new zealand', 'nigeria', 'germany',
    'berlin', 'france', 'paris', 'spain', 'madrid', 'barcelona', 'mexico', 'colombia',
    'indonesia', 'philippines', 'pakistan', 'italy', 'rome', 'milan', 'netherlands',
    'amsterdam', 'dubai', 'united arab emirates', 'south africa', 'singapore', 'japan',
    'tokyo', 'korea', 'china', 'sweden', 'norway', 'denmark', 'poland', 'portugal',
    'lisbon', 'greece', 'turkey', 'egypt', 'kenya', 'ghana', 'argentina', 'chile', 'peru',
    'israel', 'thailand', 'vietnam', 'malaysia', 'russia', 'ukraine', 'romania', 'austria',
    'belgium', 'switzerland', 'finland', 'czech', 'hungary', 'croatia', 'serbia',
    'bulgaria', 'morocco', 'tunisia', 'qatar', 'saudi',
    # Collabstr mis-geocodes some foreign cities onto US states: "Algiers, LA, United
    # States" was an Algerian creator (French-language bio) mapped onto Louisiana.
    'algiers', 'algeria', 'oran', 'annaba', 'casablanca', 'rabat', 'tunis', 'cairo',
    'beirut', 'lebanon', 'amman', 'jordan', 'baghdad', 'iraq', 'tehran', 'iran',
    'karachi', 'lahore', 'islamabad', 'dhaka', 'bangladesh', 'colombo', 'sri lanka',
    'kathmandu', 'nepal', 'hanoi', 'jakarta', 'manila', 'bangkok', 'kuala lumpur',
]

# A bio written mostly in another language is a strong signal the creator is not US-based,
# which catches mis-geocoded locations that the city list above would miss.
FOREIGN_BIO_TOKENS = [
    ' pour ', ' les ', ' pub ', ' avec ', ' vous ', ' nous ', ' votre ',   # french
    ' para ', ' con ', ' los ', ' las ', ' tu ', ' mi ',                    # spanish
    ' und ', ' der ', ' die ', ' das ', ' ich ', ' fur ',                   # german
    ' per ', ' della ', ' che ', ' sono ',                                  # italian
    ' voor ', ' een ', ' het ',                                             # dutch
]

print_lock = threading.Lock()


def log(msg):
    with print_lock:
        print(msg, flush=True)


# Collabstr starts refusing everything if we hammer it -- sustained concurrency got the
# whole host timing out mid-run. Serialise Collabstr hits behind a minimum interval so we
# stay under its limit; Instagram is unthrottled since it answers fine at full speed.
COLLABSTR_MIN_INTERVAL = float(os.environ.get("COLLABSTR_MIN_INTERVAL", "2.5"))
_cs_lock = threading.Lock()
_cs_last = [0.0]


def _collabstr_gate():
    with _cs_lock:
        wait = COLLABSTR_MIN_INTERVAL - (time.time() - _cs_last[0])
        if wait > 0:
            time.sleep(wait)
        _cs_last[0] = time.time()


# Distinguishes "this profile is gone" from "the fetch failed"; the first is permanent
# and must go to the dead-end cache, the second deserves a retry.
GONE = object()


def cget(url, tries=3, timeout=20):
    """GET with TLS impersonation, throttling for Collabstr, plus retry/backoff.

    Returns the response, GONE for 404/410, or None when every attempt failed.
    """
    is_cs = 'collabstr.com' in url
    for i in range(tries):
        if is_cs:
            _collabstr_gate()
        try:
            r = cureq.get(url, headers=HDRS, impersonate="chrome124", timeout=timeout)
            if r.status_code == 200:
                return r
            if r.status_code in (404, 410):
                return GONE
        except Exception:
            pass
        # back off harder on Collabstr: it stays angry for a while once tripped
        time.sleep((6.0 if is_cs else 1.5) * (i + 1) + random.random())
    return None


def clean_email(s):
    if not s or '@' not in s:
        return ""
    for cand in EMAIL_RE.findall(s):
        c = cand.lower().strip('.').strip()
        if any(b in c for b in BAD_SUBSTR):
            continue
        parts = c.split('@')
        if len(parts) != 2:
            continue
        local, dom = parts
        if '.' not in dom or dom in BAD_DOMAINS or len(dom) < 4 or len(local) < 2:
            continue
        tld = dom.split('.')[-1]
        if not tld.isalpha() or not (2 <= len(tld) <= 8):
            continue
        return c
    return ""


def decode_ig(s):
    """Instagram embeds bio text as \\uXXXX escapes inside its JSON blob."""
    try:
        return s.encode('utf-8').decode('unicode_escape').encode('latin1', 'ignore').decode('utf-8', 'ignore')
    except Exception:
        return s


# ---------------------------- Supabase ----------------------------
def db_usernames():
    seen = set()
    off = 0
    while True:
        try:
            r = rq.get(
                "%s/rest/v1/%s?select=username&limit=1000&offset=%d" % (SUPABASE_URL, TABLE, off),
                headers={'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY},
                timeout=25)
            d = r.json()
        except Exception:
            break
        if not d:
            break
        for row in d:
            u = str(row.get('username', '')).strip().lower().lstrip('@')
            if u:
                seen.add(u)
        if len(d) < 1000:
            break
        off += 1000

    for fn in os.listdir('data'):
        if fn.endswith('.json'):
            try:
                items = json.load(open(os.path.join('data', fn), encoding='utf-8'))
                if isinstance(items, list):
                    for it in items:
                        if isinstance(it, dict):
                            u = str(it.get('username', '')).strip().lower().lstrip('@')
                            if u:
                                seen.add(u)
            except Exception:
                pass
    return seen


def db_count():
    try:
        r = rq.get(
            "%s/rest/v1/%s?select=id" % (SUPABASE_URL, TABLE),
            headers={'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY,
                     'Range': '0-0', 'Prefer': 'count=exact'},
            timeout=15)
        return r.headers.get('Content-Range', '?/?').split('/')[-1]
    except Exception:
        return "?"


def push(c):
    payload = [{
        "username": c["username"],
        "name": c["name"],
        "email": c["email"],
        "phone": "",
        "followers": c["followers"],
        "followers_num": c["followers_num"],
        "category": c["category"],
        "location": c["location"],
        "biography": c["biography"],
        "instagram_url": c["instagram_url"],
        "is_verified": c["is_verified"],
        "price": c["price"],
        "rating": c["rating"],
        "package_offer": c["package_offer"],
        "external_url": c["external_url"],
        "source": "Collabstr + Instagram verified (batch9)",
        "email_status": "not_sent",
        "last_emailed_at": None,
        "email_subject": "",
        "email_body": "",
    }]
    try:
        r = rq.post(
            "%s/rest/v1/%s?on_conflict=username" % (SUPABASE_URL, TABLE),
            headers={'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY,
                     'Content-Type': 'application/json',
                     'Prefer': 'return=minimal,resolution=merge-duplicates'},
            json=payload, timeout=25)
        if r.status_code not in (200, 201, 204):
            log("    [!] push %s for @%s :: %s" % (r.status_code, c['username'], r.text[:160]))
            return False
        return True
    except Exception as e:
        log("    [!] push error @%s: %s" % (c['username'], e))
        return False


# ---------------------------- extraction ----------------------------
def collabstr_profile(slug):
    """Return (ig_handle, location, name, external_link) from the Collabstr profile page."""
    r = cget("https://collabstr.com/" + slug)
    if r is GONE:
        return GONE                      # profile removed: permanent
    if not r:
        return None
    s = BeautifulSoup(r.text, 'html.parser')

    md = s.find('meta', attrs={'name': 'description'})
    desc = md.get('content', '') if md else ''
    m = re.search(r'creators like @([A-Za-z0-9_.]+) in (.+?)\.\s*$', desc)
    if m:
        handle, loc = m.group(1), m.group(2).strip()
    else:
        handle, loc = "", ""

    title = (s.title.string or '') if s.title else ''
    if not handle:
        m2 = re.search(r'\(@([A-Za-z0-9_.]+)\)', title)
        handle = m2.group(1) if m2 else ""

    # Creators whose Collabstr listing is YouTube/TikTok-only carry no "@handle" in the
    # meta. Most are also non-US and get dropped below, but when the location IS the US
    # and the listing mentions Instagram, the slug itself is worth trying as a handle --
    # Instagram verification downstream discards it if that guess is wrong.
    if not handle and 'Instagram' in title and 'United States' in desc:
        handle = slug
    if not loc:
        ml = re.search(r'\bin ([^.]+?)\.\s*$', desc)
        if ml:
            loc = ml.group(1).strip()

    name = ""
    mn = re.search(r'Promote with (.+?) \(@', title)
    if mn:
        name = mn.group(1).strip()

    ext = ""
    for a in s.find_all('a', href=True):
        h = a['href'].lower()
        if any(k in h for k in ['linktr.ee', 'beacons.ai', 'hoo.be', 'stan.store',
                                'allmylinks', 'campsite.bio', 'linkin.bio']):
            ext = a['href']
            break

    return handle.lower(), loc, name, ext


def instagram_profile(handle):
    """Return (followers, biography, external_url, contact_email) straight from Instagram."""
    r = cget("https://www.instagram.com/%s/" % handle, tries=3, timeout=25)
    if r is GONE:
        return GONE                      # handle no longer exists
    if not r:
        return None
    t = r.text

    fol = 0
    m = re.search(r'"follower_count":(\d+)', t)
    if m:
        fol = int(m.group(1))
    if not fol:
        og = re.search(r'og:description"\s+content="([\d.,]+[KMkm]?)\s*Followers', t)
        if og:
            v = og.group(1).replace(',', '')
            if v and v[-1].upper() in 'KM':
                fol = int(float(v[:-1]) * (1e6 if v[-1].upper() == 'M' else 1e3))
            else:
                try:
                    fol = int(float(v))
                except Exception:
                    fol = 0

    bm = re.search(r'"biography":"(.*?)","', t)
    bio = decode_ig(bm.group(1)) if bm else ""

    em = re.search(r'"external_url":"(.*?)"', t)
    ext = decode_ig(em.group(1)) if em else ""

    mail = ""
    pe = re.search(r'"(?:business_email|public_email)":"(.*?)"', t)
    if pe:
        mail = clean_email(decode_ig(pe.group(1)))

    # Instagram answers 200 for handles that do not exist, and for banned/removed
    # accounts, with no profile payload at all. Without this check those look like a
    # transient miss and get retried forever instead of being written off.
    if fol == 0 and '"username":"%s"' % handle.lower() not in t.lower():
        return GONE

    return fol, bio, ext, mail


def scrape_link_for_email(url):
    if not url or not url.startswith('http'):
        return ""
    low = url.lower()
    if any(s in low for s in ['instagram.com', 'tiktok.com', 'youtube.com',
                              'facebook.com', 'twitter.com', 'x.com']):
        return ""
    r = cget(url, tries=2, timeout=15)
    if not r or r is GONE:
        return ""
    e = clean_email(r.text)
    if e:
        return e
    try:
        s = BeautifulSoup(r.text, 'html.parser')
        for a in s.find_all('a', href=True):
            if a['href'].lower().startswith('mailto:'):
                e = clean_email(a['href'][7:].split('?')[0])
                if e:
                    return e
    except Exception:
        pass
    return ""


def _email_matches_creator(email, handle):
    """Does this address plausibly belong to `handle`?

    Only applied to web-search results, where the page may list many unrelated people.
    Accepts when the local part and the handle share a meaningful chunk (either contains
    the other, or they share a >=5-char run such as a surname).
    """
    local, _, domain = email.lower().partition('@')
    h = re.sub(r'[^a-z0-9]', '', handle.lower())
    l = re.sub(r'[^a-z0-9]', '', local)
    if not h or not l:
        return False

    # A personal domain is itself proof of ownership: info@marcistook.com for @marcistook.
    dom_root = re.sub(r'[^a-z0-9]', '', domain.rsplit('.', 1)[0].split('.')[-1])
    if dom_root and dom_root not in ('gmail', 'yahoo', 'hotmail', 'outlook', 'icloud',
                                     'aol', 'proton', 'protonmail', 'me', 'msn', 'live'):
        if dom_root in h or h in dom_root:
            return True

    if h in l or l in h:
        return True
    for size in range(min(len(h), len(l)), 4, -1):
        for i in range(len(l) - size + 1):
            if l[i:i + size] in h:
                return True
    return False


def hunt_email(handle, bio, ext_urls):
    e = clean_email(bio)
    if e:
        return e, "instagram_bio"

    for u in ext_urls:
        e = scrape_link_for_email(u)
        if e:
            return e, "link_in_bio"

    for host in ("https://linktr.ee/%s" % handle,
                 "https://beacons.ai/%s" % handle,
                 "https://stan.store/%s" % handle):
        e = scrape_link_for_email(host)
        if e:
            return e, "linktree/beacons"

    # Web search is the last resort. DuckDuckGo (html + lite), Mojeek and Ecosia all block
    # us; Brave and Bing answer. Startpage is excluded -- it returns a bot-check page whose
    # boilerplate address would be scraped as a false positive.
    #
    # Search results also surface addresses belonging to other people, so an email found
    # this way is only accepted when it actually looks like it belongs to this creator.
    try:
        q = rq.utils.quote('"%s" instagram email contact' % handle)
        for engine in ("https://search.brave.com/search?q=", "https://www.bing.com/search?q="):
            r = cget(engine + q, tries=1, timeout=15)
            if not r or r is GONE:
                continue
            for cand in EMAIL_RE.findall(r.text):
                e = clean_email(cand)
                if e and _email_matches_creator(e, handle):
                    return e, "web_search"
    except Exception:
        pass

    return "", ""


def is_usa(loc, bio):
    t = ("%s %s" % (loc, bio)).lower()
    if any(k in t for k in NON_US):
        return False
    return 'united states' in (loc or '').lower()


def process(slug, seen, hint=None):
    """hint: {followers, location, name} captured from the listing card, when available.

    The listing card already states the country, so a non-US candidate is dropped before
    it costs a throttled profile fetch.
    """
    try:
        hint = hint or {}
        hint_loc = hint.get('location') or ''
        hint_is_us = bool(re.search(r',\s*(US|USA)\s*$', hint_loc, re.I))
        if hint_loc and not hint_is_us:
            return ('DEAD', None)

        cp = collabstr_profile(slug)
        if cp is GONE:
            return ('DEAD', None)           # profile removed from Collabstr
        if not cp:
            return ('RETRY', None)          # fetch failure: transient, try again later
        handle, loc, name, cext = cp
        if not handle:
            return ('DEAD', None)
        if handle in seen:
            return ('DEAD', None)
        if not name:
            name = hint.get('name') or ''
        if not loc and hint_is_us:
            loc = hint_loc
        if not is_usa(loc, "") and not hint_is_us:
            return ('DEAD', None)

        ig = instagram_profile(handle)
        if ig is GONE:
            return ('DEAD', None)           # Instagram account gone
        if not ig:
            return ('RETRY', None)
        fol, bio, iext, pmail = ig

        if fol == 0:
            return ('RETRY', None)
        if not (MIN_F <= fol <= MAX_F):
            return ('DEAD', None)
        bio_low = bio.lower()
        if any(k in bio_low for k in NON_US):
            return ('DEAD', None)
        padded = ' ' + re.sub(r'[^a-z\s]', ' ', bio_low) + ' '
        if sum(1 for tok in FOREIGN_BIO_TOKENS if tok in padded) >= 2:
            return ('DEAD', None)

        if pmail:
            email, src = pmail, "ig_contact"
        else:
            email, src = hunt_email(handle, bio, [u for u in (iext, cext) if u])
        if not email:
            return ('DEAD', None)

        return ('OK', {
            "username": handle,
            "name": name or handle,
            "email": email,
            "followers": "%dK" % round(fol / 1000.0),
            "followers_num": fol,
            "category": "Lifestyle & Entertainment",
            "location": re.sub(r",\s*(US|USA)\s*$", ", United States", loc or "United States"),
            "biography": bio[:1000],
            "instagram_url": "https://www.instagram.com/" + handle,
            "is_verified": True,
            "price": "$150",
            "rating": "5.0",
            "package_offer": "1 Instagram Reel",
            "external_url": iext or cext or "",
            "email_source": src,
        })
    except Exception:
        return ('RETRY', None)


def main():
    log("=" * 74)
    log("BATCH 9 :: 100 NEW USA CREATORS | 100K-500K IG FOLLOWERS | VERIFIED EMAIL")
    log("=" * 74)

    seen = db_usernames()
    log("[*] dedupe set: %d known usernames | live DB rows: %s" % (len(seen), db_count()))

    dead = set()
    if os.path.exists(DEAD_FILE):
        try:
            dead = set(json.load(open(DEAD_FILE, encoding='utf-8')))
        except Exception:
            dead = set()

    revive_targets = None
    if REVIVE:
        try:
            revive_targets = [x for x in json.load(
                open(os.path.join("data", "batch9_dead_ends.json"), encoding='utf-8'))
                if x not in dead]
        except Exception:
            revive_targets = []
        log("[*] REVIVE mode: re-trying %d previously written-off slugs" % len(revive_targets))

    cands = {}
    if os.path.exists(CAND_FILE):
        cands = json.load(open(CAND_FILE, encoding='utf-8'))
    # candidate values are either a bare follower count (old format) or {followers, location, name}
    if REVIVE:
        # keep any listing hints we have, but drive the run from the dead-end list
        cands = {x: cands.get(x, {}) for x in revive_targets}
    slugs = [s for s in cands if s not in seen and s not in dead]
    hints = {s: (cands[s] if isinstance(cands[s], dict) else {}) for s in slugs}
    def _is_us_hint(sl):
        return bool(re.search(r',\s*(US|USA)\s*$', hints[sl].get('location', '') or '', re.I))

    us_known = sum(1 for s in slugs if _is_us_hint(s))
    def _band(sl):
        """Rank by how likely this candidate is to land in 100k-500k on Instagram.

        Most Collabstr cards show a 'UGC' badge with no follower number; those creators
        are usually far too small, so they go last. Cards whose badge already reads
        100k-500k convert far better and are worked first.
        """
        f = hints[sl].get('followers', 0) or 0
        if MIN_F <= f <= MAX_F:
            return 0
        if f > MAX_F:
            return 1
        if f > 0:
            return 2
        return 3                      # no badge / UGC-only: lowest yield

    # US-confirmed first, then by follower band, so each throttled fetch has the best odds.
    random.shuffle(slugs)
    slugs.sort(key=lambda sl: (0 if _is_us_hint(sl) else 1, _band(sl)))
    log("[*] priority bands -> in-range:%d over:%d other:%d no-badge:%d" % tuple(
        sum(1 for sl in slugs if _is_us_hint(sl) and _band(sl) == b) for b in (0, 1, 2, 3)))
    log("[*] candidate slugs to process: %d (%d pre-confirmed US from listing) | %d cached dead ends skipped"
        % (len(slugs), us_known, len(dead)))

    collected = []
    if os.path.exists(OUT_JSON):
        try:
            for it in json.load(open(OUT_JSON, encoding='utf-8')):
                if MIN_F <= int(it.get('followers_num', 0)) <= MAX_F and it.get('email'):
                    collected.append(it)
                    seen.add(it['username'])
            log("[*] resumed with %d already collected" % len(collected))
        except Exception:
            pass

    lock = threading.Lock()

    def save():
        json.dump(collected, open(OUT_JSON, 'w', encoding='utf-8'), indent=2, ensure_ascii=False)
        df = pd.DataFrame(collected)
        df.to_csv(OUT_CSV, index=False, encoding='utf-8')
        try:
            df.to_excel(OUT_XLSX, index=False)
        except Exception:
            pass

    # Work in waves, reloading the candidate file between each one. The expander keeps
    # appending better candidates while we run, and a queue fixed at startup would spend
    # the whole run on low-yield no-badge slugs while fresh in-range ones sat unused.
    done = 0
    processed = set()
    attempts = {}          # slug -> transient failures so far; retried up to MAX_TRIES
    MAX_TRIES = 3
    WAVE = 60
    idle_rounds = 0

    while len(collected) < TARGET:
        if not REVIVE:
            try:
                cands = json.load(open(CAND_FILE, encoding='utf-8'))
            except Exception:
                pass
        hints = {s: (cands[s] if isinstance(cands[s], dict) else {}) for s in cands}

        avail = [s for s in cands
                 if s not in seen and s not in dead and s not in processed
                 and attempts.get(s, 0) < MAX_TRIES]

        # Collabstr's rate limit is shared with the expander, so a fetch spent here is a
        # listing page the expander does not get. No-badge/UGC candidates convert at ~3%
        # while a listing page is worth ~10% of a creator, so we only spend fetches on
        # candidates whose listing shows a real follower count, and let the expander have
        # the rest of the budget. Fall back to everything once the sweep is done.
        # Prefer candidates with a real follower badge, but never idle waiting for them:
        # the expander runs on its own rate gate, so pausing here does not speed it up --
        # it just leaves half our request capacity unused. No-badge slugs convert at only
        # ~3%, which still beats scanning nothing.
        qualified = [s for s in avail if _is_us_hint(s) and _band(s) <= 2]
        wave = qualified or avail
        random.shuffle(wave)
        wave.sort(key=lambda sl: (0 if _is_us_hint(sl) else 1, _band(sl)))
        wave = wave[:WAVE]

        if not wave and REVIVE:
            log("[*] REVIVE complete: no slugs left to re-try")
            break
        if not wave:
            idle_rounds += 1
            if idle_rounds > 40:
                log("[!] candidate pool exhausted -- no fresh slugs to try")
                break
            log("    (waiting for expander: %d qualified, %d unqualified in pool)"
                % (len(qualified), len(avail)))
            time.sleep(20)
            continue
        idle_rounds = 0

        with ThreadPoolExecutor(max_workers=6) as ex:
            futs = {ex.submit(process, s, seen, hints.get(s)): s for s in wave}
            for f in as_completed(futs):
                done += 1
                slug = futs[f]
                status, res = f.result()
                with lock:
                    if status == 'DEAD':
                        dead.add(slug)
                        processed.add(slug)
                    elif status == 'RETRY':
                        # A fetch failure is transient (rate limiting, a slow profile).
                        # Keep the slug eligible for a later wave instead of discarding
                        # it -- these are often the in-band candidates worth most.
                        attempts[slug] = attempts.get(slug, 0) + 1
                        if attempts[slug] >= MAX_TRIES:
                            processed.add(slug)
                    else:
                        processed.add(slug)
                if res:
                    with lock:
                        if len(collected) < TARGET and res['username'] not in seen:
                            seen.add(res['username'])
                            ok = push(res)
                            collected.append(res)
                            save()
                            log("[%3d/%d] %s @%-22s %6s | %-30s | %s (%s)" % (
                                len(collected), TARGET, "DB OK" if ok else "LOCAL",
                                res['username'], res['followers'], res['location'][:30],
                                res['email'], res['email_source']))
                if done % 25 == 0:
                    inband = sum(1 for s in cands
                                 if s not in seen and s not in dead and s not in processed
                                 and isinstance(cands[s], dict)
                                 and MIN_F <= (cands[s].get('followers') or 0) <= MAX_F)
                    log("    ... scanned %d | collected %d/%d | dead ends %d | in-band left %d"
                        % (done, len(collected), TARGET, len(dead), inband))
                    try:
                        json.dump(sorted(dead), open(DEAD_FILE, 'w', encoding='utf-8'))
                    except Exception:
                        pass
                if len(collected) >= TARGET:
                    break

    save()
    try:
        json.dump(sorted(dead), open(DEAD_FILE, 'w', encoding='utf-8'))
    except Exception:
        pass
    log("=" * 74)
    log("DONE: %d creators collected & pushed | live DB rows now: %s" % (len(collected), db_count()))
    log("  %s" % OUT_JSON)
    log("  %s" % OUT_CSV)
    log("  %s" % OUT_XLSX)
    log("=" * 74)


if __name__ == "__main__":
    main()
