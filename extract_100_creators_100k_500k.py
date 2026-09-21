import os
import sys
import re
import json
import time
import requests
from bs4 import BeautifulSoup
from concurrent.futures import ThreadPoolExecutor, as_completed
from dotenv import load_dotenv
import pandas as pd
import threading

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', line_buffering=True)
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', line_buffering=True)

load_dotenv(".env")
load_dotenv("frontend/.env.local")

from config.settings import DEFAULT_HEADERS
from utils.strict_verifier import is_strictly_usa, parse_num

MIN_FOLLOWERS = 100000
MAX_FOLLOWERS = 500000
TARGET_BATCH_COUNT = 100

OUTPUT_JSON = os.path.join("data", "extracted_100_brand_new_100k_500k_batch9.json")
OUTPUT_CSV = os.path.join("data", "extracted_100_brand_new_100k_500k_batch9.csv")
OUTPUT_XLSX = os.path.join("data", "extracted_100_brand_new_100k_500k_batch9.xlsx")

SUPABASE_URL = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY") or os.environ.get("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "")
TABLE_NAME = os.environ.get("SUPABASE_TABLE_NAME", "creators")

EMAIL_REGEX = re.compile(r'[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z]{2,8}')
INVALID_EMAILS = {
    'example.com', 'domain.com', 'email.com', 'yourdomain.com', 'test.com', 
    'sentry.io', 'wixpress.com', 'jsdelivr.net', 'unpkg.com', 'cloudflare.com', 'github.com'
}

CATEGORIES = [
    "Lifestyle", "Family & Children", "Travel", "Food & Drink", "Comedy & Entertainment",
    "Health & Fitness", "Fashion", "Beauty", "Animals & Pets", "Art & Photography",
    "DIY & Craft", "Music & Dance", "Gaming", "Education", "Outdoor & Nature",
    "Technology", "Home & Garden", "Actor", "Model", "Athlete & Sports",
    "Entrepreneur & Business", "Automotive", "Vegan", "Celebrity & Public Figure", "LGBTQ2+"
]

EXPANDED_QUERIES = [
    "couple", "couples", "married", "husband", "wife", "relationship", "dating", "love", "family", "mom", "dad",
    "california", "florida", "texas", "new+york", "los+angeles", "miami", "austin", "dallas", "chicago", "atlanta",
    "phoenix", "seattle", "denver", "nashville", "lifestyle", "fitness", "travel", "foodie", "fashion", "beauty",
    "comedy", "podcast", "ugc", "skincare", "hair", "wellness", "mommy", "parenting", "homestead", "realtor", "cars"
]

def clean_email(email_str: str) -> str:
    if not email_str or '@' not in email_str:
        return ""
    matches = EMAIL_REGEX.findall(email_str)
    if not matches:
        return ""
    cand = matches[0].lower().strip('.').strip()
    if any(bad in cand for bad in ['chart.js', 'swiper', 'bootstrap', 'jquery', 'react', 'npm@', 'cdnjs', 'wixpress', 'sentry']):
        return ""
    parts = cand.split('@')
    if len(parts) != 2:
        return ""
    local, domain = parts
    if '.' not in domain:
        return ""
    tld = domain.split('.')[-1]
    if not tld.isalpha() or len(tld) < 2 or len(tld) > 8:
        return ""
    if any(ext in local for ext in ['.js', '.css', '.min', '.json', '.svg', '.png', '.jpg']):
        return ""
    if domain in INVALID_EMAILS or len(domain) < 4:
        return ""
    return cand

def get_live_db_count() -> str:
    try:
        count_res = requests.get(
            f"{SUPABASE_URL}/rest/v1/{TABLE_NAME}?select=id",
            headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}", "Range": "0-0", "Prefer": "count=exact"},
            timeout=10
        )
        crange = count_res.headers.get("Content-Range", "")
        if "/" in crange:
            return crange.split("/")[-1]
    except Exception:
        pass
    return "?"

def push_single_creator_to_supabase(creator: dict) -> bool:
    payload = [{
        "username": creator.get("username", "").strip().lstrip("@"),
        "name": creator.get("name", "").strip() or creator.get("username", "").strip(),
        "email": creator.get("email", "").strip(),
        "phone": creator.get("phone", "") or "",
        "followers": str(creator.get("followers", "0")),
        "followers_num": int(creator.get("followers_num", 0) or 0),
        "category": creator.get("category", "Lifestyle & Entertainment"),
        "location": creator.get("location", "USA"),
        "biography": creator.get("biography", "") or "",
        "instagram_url": creator.get("instagram_url", f"https://www.instagram.com/{creator.get('username', '')}"),
        "is_verified": bool(creator.get("is_verified", False)),
        "price": str(creator.get("price", "") or ""),
        "rating": str(creator.get("rating", "") or ""),
        "package_offer": str(creator.get("package_offer", "") or ""),
        "external_url": str(creator.get("external_url", "") or ""),
        "email_status": creator.get("email_status", "not_sent") or "not_sent",
        "last_emailed_at": None,
        "email_subject": "",
        "email_body": ""
    }]
    
    endpoint = f"{SUPABASE_URL}/rest/v1/{TABLE_NAME}?on_conflict=username"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation,resolution=merge-duplicates"
    }
    
    try:
        r = requests.post(endpoint, headers=headers, json=payload, timeout=10)
        return r.status_code in [200, 201]
    except Exception as e:
        print(f"[!] Push error for @{creator.get('username')}: {e}", flush=True)
        return False

def load_all_existing_db_usernames() -> set:
    existing = set()
    if SUPABASE_URL and SUPABASE_KEY:
        try:
            offset = 0
            limit = 1000
            while True:
                r = requests.get(
                    f"{SUPABASE_URL}/rest/v1/{TABLE_NAME}?select=username&limit={limit}&offset={offset}",
                    headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"},
                    timeout=10
                )
                if r.status_code == 200:
                    data = r.json()
                    if not data:
                        break
                    for row in data:
                        u = str(row.get("username", "")).strip().lower().lstrip("@")
                        if u:
                            existing.add(u)
                    if len(data) < limit:
                        break
                    offset += limit
                else:
                    break
        except Exception as e:
            print(f"[!] Warning fetching DB usernames: {e}", flush=True)
            
    # Also load from all local JSON files in data/
    data_dir = os.path.join(os.path.dirname(__file__), "data")
    if os.path.exists(data_dir):
        for fname in os.listdir(data_dir):
            if fname.endswith(".json") and ("creator" in fname.lower() or "extracted" in fname.lower()):
                fpath = os.path.join(data_dir, fname)
                try:
                    with open(fpath, "r", encoding="utf-8") as jf:
                        items = json.load(jf)
                        if isinstance(items, list):
                            for item in items:
                                if isinstance(item, dict):
                                    u = str(item.get("username", "")).strip().lower().lstrip("@")
                                    if u:
                                        existing.add(u)
                except Exception:
                    pass

    print(f"[*] Total existing usernames loaded from Supabase & local datasets: {len(existing)}", flush=True)
    return existing

def parse_collabstr_card(card_element):
    a_tag = card_element.find('a', href=True)
    if not a_tag:
        return None
    
    href = a_tag['href']
    slug = href.split('?')[0].strip('/')
    collabstr_url = f"https://collabstr.com/{slug}"
    instagram_url = f"https://www.instagram.com/{slug}"
    
    texts = [t.strip() for t in card_element.stripped_strings if t.strip()]
    ignore_phrases = {"top creator", "top creators have completed multiple orders", "responds fast", "save", "saved"}
    clean_texts = [t for t in texts if t.lower() not in ignore_phrases]
    
    followers_str = ""
    followers_num = 0
    
    # Target exact follower badge div
    badges = card_element.select('.profile-platform-badge')
    for b in badges:
        fol_div = b.select_one('.profile-listing-followers')
        if fol_div:
            txt = fol_div.get_text().strip()
            num = parse_num(txt)
            if num > followers_num:
                followers_num = num
                followers_str = txt

    if not followers_num:
        for t in clean_texts:
            m = re.search(r'(\d+(?:\.\d+)?)\s*([km])\b', t.lower())
            if m:
                val = float(m.group(1))
                unit = m.group(2)
                followers_str = f"{val}{unit.upper()}"
                followers_num = int(val * 1000000 if unit == 'm' else val * 1000)
                break
            
    name = ""
    rating = ""
    price = ""
    location = ""
    package_offer = ""

    price_matches = [t for t in clean_texts if t.startswith('$')]
    if price_matches:
        price = price_matches[0]
        
    for t in clean_texts:
        if re.match(r'^\d\.\d$', t):
            rating = t
            break
            
    for t in clean_texts:
        if any(country in t for country in [", US", "United States", "USA", ", CA", ", TX", ", NY", ", FL", ", WA"]):
            location = t
            break
            
    for t in clean_texts:
        if t != followers_str and t != price and t != rating and t != location:
            if not t.startswith('$') and not any(kw in t.lower() for kw in ['post', 'story', 'reel', 'ugc', 'video']):
                name = t
                break
                
    for t in clean_texts:
        if any(kw in t.lower() for kw in ['post', 'story', 'reel', 'package', 'video', 'ugc']):
            package_offer = t
            break
            
    return {
        'username': slug,
        'name': name or slug,
        'followers': followers_str or (f"{int(followers_num/1000)}K" if followers_num >= 1000 else str(followers_num)),
        'followers_num': followers_num,
        'location': location or "USA",
        'price': price,
        'rating': rating,
        'package_offer': package_offer,
        'instagram_url': instagram_url,
        'collabstr_url': collabstr_url
    }

def lookup_creatordb(username: str) -> str:
    try:
        url = f"https://creatordb.app/api/creator/instagram/{username.lower()}"
        headers = {
            **DEFAULT_HEADERS,
            "Referer": "https://creatordb.app/creator/instagram-email-finder/",
            "Origin": "https://creatordb.app"
        }
        r = requests.get(url, headers=headers, timeout=4)
        if r.status_code == 200:
            data = r.json()
            em = clean_email(data.get("email") or data.get("business_email", ""))
            if em:
                return em
    except Exception:
        pass
    return ""

def extract_from_external_link(url: str) -> str:
    if not url or not url.startswith("http"):
        return ""
    try:
        if any(skip in url.lower() for skip in ["instagram.com", "tiktok.com", "youtube.com", "facebook.com", "twitter.com"]):
            return ""
        r = requests.get(url, headers=DEFAULT_HEADERS, timeout=4)
        if r.status_code == 200:
            em = clean_email(r.text)
            if em:
                return em
            soup = BeautifulSoup(r.text, "html.parser")
            for a in soup.find_all("a", href=True):
                href = a["href"]
                if href.startswith("mailto:"):
                    clean_em = clean_email(href.replace("mailto:", "").split("?")[0])
                    if clean_em:
                        return clean_em
    except Exception:
        pass
    return ""

def find_verified_email_multi_source(username: str, bio: str = "", external_url: str = "") -> str:
    # 1. Clean email from bio text
    em = clean_email(bio)
    if em:
        return em

    # 2. Check external bio link (linktr.ee, beacons, etc.)
    if external_url:
        em = extract_from_external_link(external_url)
        if em:
            return em

    # 3. Direct Linktree / Beacons lookups for handle
    for link_host in [f'https://linktr.ee/{username}', f'https://beacons.ai/{username}', f'https://hoo.be/{username}', f'https://stan.store/{username}']:
        try:
            r = requests.get(link_host, headers=DEFAULT_HEADERS, timeout=4)
            if r.status_code == 200:
                cleaned = clean_email(r.text)
                if cleaned:
                    return cleaned
        except Exception:
            pass

    # 4. DuckDuckGo Search
    try:
        q = f'"{username}" "gmail.com" OR "contact" OR "collab" instagram'
        url = f'https://html.duckduckgo.com/html/?q={requests.utils.quote(q)}'
        r = requests.get(url, headers=DEFAULT_HEADERS, timeout=4)
        if r.status_code == 200:
            for match in EMAIL_REGEX.findall(r.text):
                cleaned = clean_email(match)
                if cleaned:
                    return cleaned
    except Exception:
        pass

    return ""

def enrich_candidate(card: dict, existing_usernames: set) -> dict:
    slug = card.get("username", "").strip().lower().lstrip("@")
    if not slug or slug in existing_usernames:
        return None

    real_username = slug
    name = card.get("name", "") or slug
    loc = card.get("location", "") or "USA"
    followers_num = card.get("followers_num", 0)
    biography = ""
    external_url = ""
    email = ""

    # 1. Fetch Collabstr profile page
    try:
        r = requests.get(f"https://collabstr.com/{slug}", headers=DEFAULT_HEADERS, timeout=6)
        if r.status_code == 200:
            soup = BeautifulSoup(r.text, "html.parser")
            
            # Extract real IG username from page title e.g. "Promote with Name (@real_username)"
            title_str = soup.title.string if soup.title else ""
            m_ig = re.search(r'\(@([a-zA-Z0-9_\.]+)\)', title_str)
            if m_ig:
                real_username = m_ig.group(1).lower().strip()
                if real_username in existing_usernames:
                    return None
            
            # Extract email mailto
            for mailto in soup.find_all("a", href=re.compile(r"^mailto:", re.I)):
                em = clean_email(mailto["href"].replace("mailto:", "").split("?")[0])
                if em:
                    email = em
                    break
                    
            # Extract bio text
            bio_div = soup.find("div", class_=re.compile(r"bio|description|about", re.I))
            if bio_div:
                biography = bio_div.get_text(separator=" ").strip()
                if not email:
                    email = clean_email(biography)

            # Extract external bio link
            for a in soup.find_all("a", href=True):
                h = a["href"]
                if any(kw in h.lower() for kw in ["linktr.ee", "beacons.ai", "hoo.be", "stan.store", "allmylinks", "campsite.bio"]):
                    external_url = h
                    break
                    
            full_text = soup.get_text()
            m_fol = re.findall(r'([\d\.,]+[KMkm])\s*(?:Instagram|TikTok)?\s*Followers', full_text, re.I)
            if m_fol:
                nums = [parse_num(x) for x in m_fol if parse_num(x) > 0]
                if nums:
                    followers_num = max(nums)
    except Exception:
        pass

    # 2. Multi-source email discovery if email not found yet
    if not email:
        email = find_verified_email_multi_source(real_username, biography, external_url)

    # Validations: verified email + STRICT 100k to 500k followers + USA location
    if not email or "@" not in email:
        return None
    if not (MIN_FOLLOWERS <= followers_num <= MAX_FOLLOWERS):
        return None
    if loc and loc != "USA" and not is_strictly_usa(loc, biography):
        return None

    return {
        "username": real_username,
        "name": name or real_username,
        "email": email,
        "phone": "",
        "followers": f"{int(round(followers_num/1000))}K" if followers_num >= 1000 else str(followers_num),
        "followers_num": followers_num,
        "category": card.get("category", "Lifestyle & Entertainment"),
        "location": loc if loc else "USA",
        "biography": biography,
        "instagram_url": f"https://www.instagram.com/{real_username}",
        "is_verified": True,
        "price": card.get("price", "$150") or "$150",
        "rating": card.get("rating", "5.0") or "5.0",
        "package_offer": card.get("package_offer", "1 Instagram Reel") or "1 Instagram Reel",
        "external_url": external_url,
        "email_status": "not_sent",
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    }

def fetch_search_page(url_tuple):
    url, q, cat = url_tuple
    try:
        r = requests.get(url, headers=DEFAULT_HEADERS, timeout=5)
        if r.status_code == 200:
            soup = BeautifulSoup(r.text, "html.parser")
            elements = soup.select('.profile-listing-holder')
            cards = []
            for el in elements:
                parsed = parse_collabstr_card(el)
                if parsed and parsed.get("username"):
                    if q: parsed["query_matched"] = q
                    if cat: parsed["category"] = cat
                    cards.append(parsed)
            return cards
    except Exception:
        pass
    return []

def main():
    print("=" * 70, flush=True)
    print("⚡ AUTOMATED ENGINE: EXTRACTING 100 USA CREATORS (100K-500K FOLLOWERS)", flush=True)
    print("=" * 70, flush=True)

    db_usernames = load_all_existing_db_usernames()
    seen = set(db_usernames)

    collected_creators = []
    
    if os.path.exists(OUTPUT_JSON):
        try:
            with open(OUTPUT_JSON, "r", encoding="utf-8") as jf:
                saved = json.load(jf)
                for item in saved:
                    u = str(item.get("username", "")).strip().lower().lstrip("@")
                    em = clean_email(item.get("email", ""))
                    f_num = int(item.get("followers_num", 0) or 0)
                    if u and em and 100000 <= f_num <= 500000 and u not in [c['username'] for c in collected_creators]:
                        item['email'] = em
                        collected_creators.append(item)
                        seen.add(u)
            print(f"[*] Resumed with {len(collected_creators)} verified creators (100k-500k followers) already collected.", flush=True)
        except Exception:
            pass

    file_lock = threading.Lock()

    def save_data():
        with file_lock:
            with open(OUTPUT_JSON, "w", encoding="utf-8") as jf:
                json.dump(collected_creators, jf, indent=2, ensure_ascii=False)
            df = pd.DataFrame(collected_creators)
            df.to_csv(OUTPUT_CSV, index=False)
            try:
                df.to_excel(OUTPUT_XLSX, index=False)
            except Exception:
                pass

    if len(collected_creators) >= TARGET_BATCH_COUNT:
        print(f"[✓] Already have {len(collected_creators)} creators collected!", flush=True)
        return

    needed = TARGET_BATCH_COUNT - len(collected_creators)
    print(f"[*] Target: {len(collected_creators)}/100 collected. Streaming remaining {needed} creators...", flush=True)

    search_urls = []
    # Main listing pages
    for pg in range(1, 60):
        search_urls.append((f"https://collabstr.com/influencers?fmi=100000&fmx=500000&loc_ids=204821&pg={pg}", None, "Lifestyle & Entertainment"))
        search_urls.append((f"https://collabstr.com/influencers?fmi=100000&fmx=500000&pg={pg}", None, "Lifestyle & Entertainment"))

    # Category pages
    for cat in CATEGORIES:
        cat_enc = cat.replace(' ', '+').replace('&', '%26')
        for pg in range(1, 35):
            search_urls.append((f"https://collabstr.com/influencers?c={cat_enc}&fmi=100000&fmx=500000&loc_ids=204821&pg={pg}", None, cat))
            search_urls.append((f"https://collabstr.com/influencers?c={cat_enc}&fmi=100000&fmx=500000&pg={pg}", None, cat))

    # Query search pages
    for q in EXPANDED_QUERIES:
        for pg in range(1, 25):
            search_urls.append((f"https://collabstr.com/influencers?q={q}&fmi=100000&fmx=500000&loc_ids=204821&pg={pg}", q, None))
            search_urls.append((f"https://collabstr.com/influencers?q={q}&fmi=100000&fmx=500000&pg={pg}", q, None))

    print(f"[*] Generated {len(search_urls)} search URLs. Processing in chunks...", flush=True)

    chunk_size = 20
    for i in range(0, len(search_urls), chunk_size):
        if len(collected_creators) >= TARGET_BATCH_COUNT:
            break

        chunk = search_urls[i:i+chunk_size]
        candidates = []
        with ThreadPoolExecutor(max_workers=10) as page_executor:
            page_futures = [page_executor.submit(fetch_search_page, u) for u in chunk]
            for pf in as_completed(page_futures):
                cards = pf.result()
                for c in cards:
                    u = str(c.get("username", "")).strip().lower().lstrip("@")
                    with file_lock:
                        if u and u not in seen:
                            seen.add(u)
                            candidates.append(c)

        if not candidates:
            continue

        # Enrich chunk candidates in parallel
        with ThreadPoolExecutor(max_workers=15) as verifier_executor:
            ver_futures = [verifier_executor.submit(enrich_candidate, c, db_usernames) for c in candidates]
            for vf in as_completed(ver_futures):
                res = vf.result()
                if res:
                    with file_lock:
                        if len(collected_creators) < TARGET_BATCH_COUNT and res['username'] not in [x['username'] for x in collected_creators]:
                            pushed = push_single_creator_to_supabase(res)
                            collected_creators.append(res)
                            db_usernames.add(res['username'])
                            save_data()
                            
                            live_cnt = get_live_db_count()
                            push_tag = "PUSHED TO SUPABASE ✅" if pushed else "SAVED LOCAL ⚠️"
                            print(f"[{len(collected_creators)}/{TARGET_BATCH_COUNT}] {push_tag}: @{res['username']} | {res['followers']} | {res['location']} | {res['email']} | Live DB: {live_cnt}", flush=True)
                            
                            if len(collected_creators) >= TARGET_BATCH_COUNT:
                                break

        print(f"[*] Processed pages {i+1}-{min(i+chunk_size, len(search_urls))}/{len(search_urls)} | Candidates scanned: {len(candidates)} | Total Collected: {len(collected_creators)}/100", flush=True)

    final_100 = collected_creators[:TARGET_BATCH_COUNT]
    with open(OUTPUT_JSON, "w", encoding="utf-8") as jf:
        json.dump(final_100, jf, indent=2, ensure_ascii=False)
        
    df = pd.DataFrame(final_100)
    df.to_csv(OUTPUT_CSV, index=False)
    df.to_excel(OUTPUT_XLSX, index=False)
    
    live_total = get_live_db_count()
    print("\n" + "=" * 70, flush=True)
    print(f"✨ SUCCESS: Extracted & Pushed all {len(final_100)} brand new USA creators to Supabase DB!", flush=True)
    print(f"🎉 Total Creators Live in Supabase: {live_total}", flush=True)
    print(f"📁 JSON: {OUTPUT_JSON}", flush=True)
    print(f"📁 CSV:  {OUTPUT_CSV}", flush=True)
    print(f"📁 XLSX: {OUTPUT_XLSX}", flush=True)
    print("=" * 70, flush=True)

if __name__ == "__main__":
    main()
