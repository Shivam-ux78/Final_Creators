import os
import sys
import re
import json
import time
import requests
from bs4 import BeautifulSoup
from curl_cffi import requests as cureq
from concurrent.futures import ThreadPoolExecutor, as_completed
from dotenv import load_dotenv
import pandas as pd

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

load_dotenv(".env")
load_dotenv("frontend/.env.local")

from config.settings import DEFAULT_HEADERS
from scrapers.collabstr_scraper import parse_collabstr_card
from scrapers.instagram_profile import fetch_instagram_profile
from scrapers.creatordb import lookup_creatordb, extract_from_external_link, clean_email
from utils.strict_verifier import is_strictly_usa

MIN_FOLLOWERS = 100000
MAX_FOLLOWERS = 500000
TARGET_COUNT = 100

OUTPUT_JSON = os.path.join("data", "extracted_100_brand_new_couples_100k_500k_usa.json")
OUTPUT_CSV = os.path.join("data", "extracted_100_brand_new_couples_100k_500k_usa.csv")
OUTPUT_XLSX = os.path.join("data", "extracted_100_brand_new_couples_100k_500k_usa.xlsx")

SUPABASE_URL = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY") or os.environ.get("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "")
TABLE_NAME = os.environ.get("SUPABASE_TABLE_NAME", "creators")

SEARCH_QUERIES = [
    "couple", "couples", "married", "marriage", "husband", "wife",
    "relationship", "dating", "love", "wedding", "fiance", "engaged",
    "family", "parents", "duo", "traveling+couple", "travel+couple",
    "together", "lifestyle+couple", "family+lifestyle", "mom+dad", "raising",
    "our+life", "daily+vlog", "home+life", "adventures", "twins", "boy+mom",
    "girl+mom", "husband+wife", "mom+life", "dad+life", "motherhood",
    "fatherhood", "parenting", "family+fun", "couple+travel", "family+vlog",
    "lifestyle", "california", "florida", "texas", "new+york", "los+angeles", "miami",
    "austin", "dallas", "chicago", "atlanta", "phoenix", "seattle", "denver",
    "nashville", "san+diego", "san+antonio", "san+francisco", "boston", "las+vegas",
    "orlando", "tampa", "charlotte", "portland", "detroit", "cleveland"
]

CATEGORIES = [
    "Family & Children", "Lifestyle", "Travel", "Comedy & Entertainment",
    "Food & Drink", "Health & Fitness", "Fashion", "Beauty", "Animals & Pets",
    "Art & Photography", "DIY & Craft", "Music & Dance", "Gaming", "Education",
    "Outdoor & Nature", "Technology", "Home & Garden"
]

COUPLE_KEYWORDS = [
    "couple", "couples", "husband", "wife", "marriage", "married", 
    "relationship", "dating", "together", "family", "parents", 
    "mom & dad", "mom and dad", "him and her", "partners", "duo",
    "love", "traveling couple", "home & family", "lifestyle & family",
    "travel couple", "couple goals", "living together", "mr & mrs",
    "mom of", "dad of", "raising", "family life", "fiance", "fiancé",
    "our journey", "our story", "two of us", "boyfriend", "girlfriend",
    "mama", "papa", "twins", "toddler", "baby", "mom", "dad", "mother", "father",
    "family vlog", "daily vlog", "our life", "the family", "wife & mom",
    "husband & dad", "family of", "travel family", "adventure couple",
    "home", "homestead", "life with", "adventures of", "lifestyle",
    "boy mom", "girl mom", "twin mom", "twin dad", "motherhood", "fatherhood"
]

def load_all_existing_db_usernames() -> set:
    existing = set()
    if SUPABASE_URL and SUPABASE_KEY:
        try:
            r = requests.get(
                f"{SUPABASE_URL}/rest/v1/{TABLE_NAME}?select=username",
                headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"},
                timeout=15
            )
            if r.status_code == 200:
                for row in r.json():
                    u = str(row.get("username", "")).strip().lower().lstrip("@")
                    if u:
                        existing.add(u)
        except Exception as e:
            print(f"[!] Warning fetching DB usernames: {e}", flush=True)
            
    print(f"[*] Total existing usernames currently in Supabase DB: {len(existing)}", flush=True)
    return existing

def is_couple_creator(creator: dict) -> bool:
    full_text = " ".join([
        str(creator.get("name", "")),
        str(creator.get("category", "")),
        str(creator.get("biography", "")),
        str(creator.get("package_offer", "")),
        str(creator.get("query_matched", "")),
        str(creator.get("username", ""))
    ]).lower()
    return any(kw in full_text for kw in COUPLE_KEYWORDS)

def parse_follower_num(val) -> int:
    if not val:
        return 0
    if isinstance(val, int):
        return val
    s = str(val).lower().replace(',', '').strip()
    if 'k' in s:
        try:
            return int(float(s.replace('k', '')) * 1000)
        except:
            return 0
    if 'm' in s:
        try:
            return int(float(s.replace('m', '')) * 1000000)
        except:
            return 0
    try:
        return int(float(s))
    except:
        return 0

def enrich_single_candidate(candidate: dict) -> dict:
    username = candidate.get("username", "").strip().lower()
    if not username:
        return None
    
    # 1. Fetch Instagram profile
    ig = fetch_instagram_profile(username)
    biography = ig.get("biography") or ""
    bio_email = ig.get("bio_email") or ""
    ext_url = ig.get("external_url") or candidate.get("external_url") or ""
    full_name = ig.get("full_name") or candidate.get("name") or username
    ig_followers = ig.get("followers") or candidate.get("followers")
    is_verified = ig.get("is_verified", False)
    
    # Follower check strictly 100k to 500k
    f_num = parse_follower_num(ig_followers) or candidate.get("followers_num", 0)
    if f_num < MIN_FOLLOWERS or f_num > MAX_FOLLOWERS:
        return None
    
    # Location verification
    loc = candidate.get("location") or "USA"
    if not is_strictly_usa(loc, biography):
        return None
    
    # Category / Niche verification
    temp_obj = {
        "name": full_name,
        "category": candidate.get("category", "Couples & Family"),
        "biography": biography,
        "package_offer": candidate.get("package_offer", ""),
        "query_matched": candidate.get("query_matched", ""),
        "username": username
    }
    if not is_couple_creator(temp_obj):
        return None
    
    # Email lookup pipeline (0 synthetic emails)
    verified_email = clean_email(bio_email)
    lookup_source = "Instagram Bio" if verified_email else ""
    
    if not verified_email and ext_url:
        link_email = extract_from_external_link(ext_url)
        if link_email:
            verified_email = link_email
            lookup_source = "External Link (Linktree/Beacons)"
            
    if not verified_email:
        cdb = lookup_creatordb(username)
        if cdb and cdb.get("email"):
            verified_email = clean_email(cdb.get("email"))
            if verified_email:
                lookup_source = "CreatorDB"
                if not full_name and cdb.get("name"):
                    full_name = cdb.get("name")
    
    if not verified_email:
        return None
        
    followers_formatted = f"{round(f_num / 1000)}K" if f_num >= 1000 else str(f_num)
    
    return {
        "username": username,
        "name": full_name,
        "email": verified_email,
        "phone": ig.get("bio_phones", ""),
        "followers": followers_formatted,
        "followers_num": f_num,
        "category": "Couples & Family",
        "location": loc,
        "biography": biography,
        "instagram_url": f"https://www.instagram.com/{username}",
        "is_verified": is_verified,
        "price": candidate.get("price", "$150"),
        "rating": candidate.get("rating", "5.0"),
        "package_offer": candidate.get("package_offer", "1 Instagram Reel"),
        "external_url": ext_url,
        "lookup_source": lookup_source,
        "email_status": "not_sent",
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    }

def scrape_url_cards(url_item: tuple) -> list[dict]:
    url, query, category = url_item
    cards = []
    try:
        r = cureq.get(url, headers=DEFAULT_HEADERS, impersonate="chrome120", timeout=8)
        if r.status_code == 200:
            soup = BeautifulSoup(r.text, "html.parser")
            elements = soup.select('.profile-listing-holder')
            for el in elements:
                parsed = parse_collabstr_card(el)
                if parsed and parsed.get("username"):
                    if query: parsed["query_matched"] = query
                    if category: parsed["category"] = category
                    cards.append(parsed)
    except Exception:
        pass
    return cards

def main():
    print("=" * 70, flush=True)
    print("🚀 EXTRACTING 100 BRAND NEW USA COUPLE CREATORS (100K-500K | NOT IN DB)", flush=True)
    print("=" * 70, flush=True)

    db_usernames = load_all_existing_db_usernames()
    seen = set(db_usernames)

    collected_creators = []
    
    # 1. Build all search URLs
    urls_to_scan = []
    for q in SEARCH_QUERIES:
        for pg in range(1, 8):
            urls_to_scan.append((f"https://collabstr.com/influencers?q={q}&loc_ids=204821&pg={pg}", q, None))
    for cat in CATEGORIES:
        cat_enc = cat.replace(' ', '+').replace('&', '%26')
        for pg in range(1, 10):
            urls_to_scan.append((f"https://collabstr.com/influencers?c={cat_enc}&loc_ids=204821&pg={pg}", None, cat))

    print(f"[*] Scanning {len(urls_to_scan)} search and category pages concurrently...", flush=True)

    raw_candidates = []
    with ThreadPoolExecutor(max_workers=20) as executor:
        futures = {executor.submit(scrape_url_cards, u_item): u_item for u_item in urls_to_scan}
        for f in as_completed(futures):
            cards = f.result()
            for c in cards:
                u = str(c.get("username", "")).strip().lower()
                if u and u not in seen:
                    seen.add(u)
                    raw_candidates.append(c)

    print(f"[✓] Discovered {len(raw_candidates)} brand new unique candidates not in database!", flush=True)
    print(f"[*] Starting deep parallel verification & email extraction...", flush=True)

    with ThreadPoolExecutor(max_workers=16) as executor:
        futures = {executor.submit(enrich_single_candidate, c): c for c in raw_candidates}
        for f in as_completed(futures):
            res = f.result()
            if res:
                collected_creators.append(res)
                print(f"[{len(collected_creators)}/{TARGET_COUNT}] ✅ NEW: @{res['username']} | {res['followers']} | {res['location']} | {res['email']} ({res['lookup_source']})", flush=True)
                
                # Incremental write
                with open(OUTPUT_JSON, "w", encoding="utf-8") as jf:
                    json.dump(collected_creators, jf, indent=2, ensure_ascii=False)
                    
                if len(collected_creators) >= TARGET_COUNT:
                    print(f"\n🎉 Successfully collected all {TARGET_COUNT} brand new creators!", flush=True)
                    break

    final_100 = collected_creators[:TARGET_COUNT]
    with open(OUTPUT_JSON, "w", encoding="utf-8") as jf:
        json.dump(final_100, jf, indent=2, ensure_ascii=False)
        
    df = pd.DataFrame(final_100)
    df.to_csv(OUTPUT_CSV, index=False)
    df.to_excel(OUTPUT_XLSX, index=False)
    
    print("\n" + "=" * 70, flush=True)
    print(f"✨ SUCCESS: Extracted {len(final_100)} brand new USA couple creators (100k-500k followers)!", flush=True)
    print(f"📁 JSON: {OUTPUT_JSON}", flush=True)
    print(f"📁 CSV:  {OUTPUT_CSV}", flush=True)
    print(f"📁 XLSX: {OUTPUT_XLSX}", flush=True)
    print("=" * 70, flush=True)

    # Automatically push to Supabase
    print("\n[*] Pushing 100 brand new creators to Supabase database...", flush=True)
    endpoint = f"{SUPABASE_URL}/rest/v1/{TABLE_NAME}?on_conflict=username"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation,resolution=merge-duplicates"
    }

    BATCH_SIZE = 50
    uploaded = 0
    for i in range(0, len(final_100), BATCH_SIZE):
        batch = final_100[i:i + BATCH_SIZE]
        upload_res = requests.post(endpoint, headers=headers, json=batch, timeout=30)
        if upload_res.status_code in [200, 201]:
            uploaded += len(batch)
            print(f"  [✓] Inserted batch {i + 1} - {min(i + BATCH_SIZE, len(final_100))} / {len(final_100)} creators", flush=True)
        else:
            print(f"  [!] Batch upload error: {upload_res.status_code} - {upload_res.text[:300]}", flush=True)

    total_in_db = "?"
    try:
        count_res = requests.get(
            f"{SUPABASE_URL}/rest/v1/{TABLE_NAME}?select=id",
            headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}", "Range": "0-0", "Prefer": "count=exact"},
            timeout=10
        )
        crange = count_res.headers.get("Content-Range", "")
        if "/" in crange:
            total_in_db = crange.split("/")[-1]
    except Exception:
        pass

    print(f"\n🎉 Total creators now live in Supabase database: {total_in_db}", flush=True)

if __name__ == "__main__":
    main()
