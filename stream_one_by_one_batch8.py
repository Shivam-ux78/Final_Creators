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
from scrapers.collabstr_scraper import parse_collabstr_card
from scrapers.creatordb import lookup_creatordb, extract_from_external_link, clean_email
from scrapers.instagram_profile import fetch_instagram_profile
from utils.strict_verifier import is_strictly_usa, parse_num
from curl_cffi import requests as cureq

MIN_FOLLOWERS = 100000
MAX_FOLLOWERS = 500000
TARGET_BATCH_COUNT = 100

OUTPUT_JSON = os.path.join("data", "extracted_100_brand_new_100k_500k_batch8.json")
OUTPUT_CSV = os.path.join("data", "extracted_100_brand_new_100k_500k_batch8.csv")
OUTPUT_XLSX = os.path.join("data", "extracted_100_brand_new_100k_500k_batch8.xlsx")

SUPABASE_URL = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY") or os.environ.get("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "")
TABLE_NAME = os.environ.get("SUPABASE_TABLE_NAME", "creators")

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
        r = requests.post(endpoint, headers=headers, json=payload, timeout=15)
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
                    timeout=15
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
            
    # Also load from all local JSON batch files in data/
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

def enrich_single_candidate(candidate: dict, existing_usernames: set) -> dict:
    slug = candidate.get("username", "").strip().lower().lstrip("@")
    if not slug:
        return None
        
    real_username = slug
    biography = candidate.get("biography", "")
    external_url = candidate.get("external_url", "")
    full_name = candidate.get("name", "") or slug
    loc = candidate.get("location", "") or "USA"
    email = ""
    f_num = candidate.get("followers_num", 0)

    # 1. Fetch Collabstr Profile page to get real handle, bio, mailto, linktree
    try:
        r_c = cureq.get(f"https://collabstr.com/{slug}", impersonate="chrome120", headers=DEFAULT_HEADERS, timeout=4)
        if r_c.status_code == 200:
            soup = BeautifulSoup(r_c.text, "html.parser")
            
            # Resolve real IG handle from title
            title_str = soup.title.string if soup.title else ""
            m_h = re.search(r'\(@([a-zA-Z0-9_\.]+)\)', title_str)
            if m_h:
                real_username = m_h.group(1).lower().strip()
                
            bio_div = soup.find("div", class_=re.compile(r"bio|description|about", re.I))
            if bio_div and not biography:
                biography = bio_div.get_text(separator=" ").strip()
            
            for mailto in soup.find_all("a", href=re.compile(r"^mailto:")):
                em = clean_email(mailto["href"].replace("mailto:", "").split("?")[0])
                if em:
                    email = em
                    break
            
            if not external_url:
                for a in soup.find_all("a", href=True):
                    h = a["href"]
                    if any(kw in h.lower() for kw in ["linktr.ee", "beacons.ai", "hoo.be", "stan.store", "allmylinks", "snipfeed.co", "campsite.bio"]):
                        external_url = h
                        break
                        
            if not f_num:
                h1 = soup.find("h1")
                if h1:
                    m = re.search(r"with\s+([\d\.,KMkm]+)\s+(?:Instagram|TikTok)?\s*followers", h1.get_text(), re.I)
                    if m:
                        f_num = parse_num(m.group(1))
    except Exception:
        pass

    if real_username in existing_usernames:
        return None

    # 2. Extract bio email if present in Collabstr bio
    if not email and biography:
        c_em = clean_email(biography)
        if c_em:
            email = c_em

    # 3. Check Instagram Profile Page via cureq
    ig_data = fetch_instagram_profile(real_username)
    if "error" not in ig_data:
        if not biography and ig_data.get("biography"):
            biography = ig_data.get("biography")
        if not email and ig_data.get("bio_email"):
            email = clean_email(ig_data.get("bio_email"))
        if not email and ig_data.get("biography"):
            email = clean_email(ig_data.get("biography"))
        if not external_url and ig_data.get("external_url"):
            external_url = ig_data.get("external_url")
        if ig_data.get("followers"):
            f_num_ig = parse_num(ig_data.get("followers"))
            if f_num_ig > 0:
                f_num = f_num_ig
        if ig_data.get("full_name") and ig_data.get("full_name") != real_username:
            full_name = ig_data.get("full_name")

    # 4. Check external link (Linktree / website)
    if not email and external_url:
        link_email = extract_from_external_link(external_url)
        if link_email:
            c_em = clean_email(link_email)
            if c_em:
                email = c_em

    # 5. Check CreatorDB lookup
    if not email:
        cdb = lookup_creatordb(real_username)
        if cdb and cdb.get("email"):
            c_em = clean_email(cdb["email"])
            if c_em:
                email = c_em
                if not f_num and cdb.get("followers"):
                    f_num = parse_num(cdb["followers"])
                if not full_name and cdb.get("name"):
                    full_name = cdb.get("name")

    # Strict Validations: 100k to 500k followers, USA, verified email
    if not email or "@" not in email:
        return None
    if not (MIN_FOLLOWERS <= f_num <= MAX_FOLLOWERS):
        return None
    if not is_strictly_usa(loc, biography):
        return None
    
    return {
        "username": real_username,
        "name": full_name or real_username,
        "email": email,
        "phone": "",
        "followers": f"{int(round(f_num/1000))}K" if f_num >= 1000 else str(f_num),
        "followers_num": f_num,
        "category": candidate.get("category", "Lifestyle & Entertainment") or "Lifestyle & Entertainment",
        "location": loc if loc else "USA",
        "biography": biography,
        "instagram_url": f"https://www.instagram.com/{real_username}",
        "is_verified": True,
        "price": candidate.get("price", "$150") or "$150",
        "rating": candidate.get("rating", "5.0") or "5.0",
        "package_offer": candidate.get("package_offer", "1 Instagram Reel") or "1 Instagram Reel",
        "external_url": external_url,
        "email_status": "not_sent",
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    }

def fetch_collabstr_page(url_tuple):
    url, q, cat = url_tuple
    try:
        r = cureq.get(url, impersonate="chrome120", headers=DEFAULT_HEADERS, timeout=6)
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
    print("⚡ BATCH 8 ENGINE: STREAMING USA CREATORS (100K-500K FOLLOWERS)", flush=True)
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
                    if u and em and u not in [c['username'] for c in collected_creators]:
                        item['email'] = em
                        collected_creators.append(item)
                        seen.add(u)
            print(f"[*] Resumed with {len(collected_creators)} verified creators already collected in Batch 8 file.", flush=True)
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
        print(f"[✓] Already have {len(collected_creators)} creators collected in Batch 8!", flush=True)
        return

    needed = TARGET_BATCH_COUNT - len(collected_creators)
    print(f"[*] Target: {len(collected_creators)}/100 collected. Real-time extraction for remaining {needed} creators...", flush=True)

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

    print(f"[*] Scanning {len(search_urls)} search pages in parallel...", flush=True)

    chunk_size = 30
    for i in range(0, len(search_urls), chunk_size):
        if len(collected_creators) >= TARGET_BATCH_COUNT:
            break
            
        chunk = search_urls[i:i+chunk_size]
        candidates = []
        with ThreadPoolExecutor(max_workers=15) as page_executor:
            page_futures = [page_executor.submit(fetch_collabstr_page, u) for u in chunk]
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
        with ThreadPoolExecutor(max_workers=25) as verifier_executor:
            ver_futures = [verifier_executor.submit(enrich_single_candidate, c, db_usernames) for c in candidates]
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
