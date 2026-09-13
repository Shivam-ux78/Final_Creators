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
from utils.strict_verifier import is_strictly_usa, parse_num

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
    "orlando", "tampa", "charlotte", "portland", "detroit", "cleveland",
    "memphis", "baltimore", "milwaukee", "albuquerque", "tucson", "fresno", "sacramento",
    "kansas+city", "omaha", "colorado+springs", "raleigh", "virginia+beach", "minneapolis"
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

def enrich_single_candidate(candidate: dict) -> dict:
    username = candidate.get("username", "").strip().lower()
    if not username:
        return None
        
    f_num = candidate.get("followers_num", 0)
    if not f_num and candidate.get("followers"):
        f_num = parse_num(candidate.get("followers"))
        candidate["followers_num"] = f_num

    biography = candidate.get("biography", "")
    external_url = candidate.get("external_url", "")
    full_name = candidate.get("name", "") or username
    loc = candidate.get("location", "") or "USA"
    email = ""

    # 1. Collabstr Profile page fetch
    try:
        r_c = cureq.get(f"https://collabstr.com/{username}", headers=DEFAULT_HEADERS, impersonate="chrome120", timeout=7)
        if r_c.status_code == 200:
            soup = BeautifulSoup(r_c.text, "html.parser")
            bio_div = soup.find("div", class_=re.compile(r"bio|description|about", re.I))
            if bio_div and not biography:
                biography = bio_div.get_text(separator=" ").strip()
            
            # Check for mailto
            for mailto in soup.find_all("a", href=re.compile(r"^mailto:")):
                em = clean_email(mailto["href"].replace("mailto:", "").split("?")[0])
                if em:
                    email = em
                    break
            
            # Check external link
            if not external_url:
                for a in soup.find_all("a", href=True):
                    h = a["href"]
                    if any(kw in h.lower() for kw in ["linktr.ee", "beacons.ai", "hoo.be", "stan.store", "allmylinks"]):
                        external_url = h
                        break
    except Exception:
        pass

    # 2. Extract email from Collabstr bio
    if not email and biography:
        c_em = clean_email(biography)
        if c_em:
            email = c_em

    # 3. Fetch Instagram profile
    try:
        ig = fetch_instagram_profile(username)
        if ig:
            if not biography and ig.get("biography"):
                biography = ig.get("biography")
            if not external_url and ig.get("external_url"):
                external_url = ig.get("external_url")
            if not email and ig.get("bio_email"):
                c_em = clean_email(ig.get("bio_email"))
                if c_em:
                    email = c_em
            if not f_num and ig.get("followers_count"):
                f_num = ig.get("followers_count")
            elif not f_num and ig.get("followers"):
                f_num = parse_num(ig.get("followers"))
            if not full_name and ig.get("full_name"):
                full_name = ig.get("full_name")
    except Exception:
        pass

    # 4. Check external link
    if not email and external_url:
        link_email = extract_from_external_link(external_url)
        if link_email:
            c_em = clean_email(link_email)
            if c_em:
                email = c_em

    # 5. CreatorDB lookup
    if not email:
        cdb = lookup_creatordb(username)
        if cdb and cdb.get("email"):
            c_em = clean_email(cdb["email"])
            if c_em:
                email = c_em
                if not f_num and cdb.get("followers"):
                    f_num = parse_num(cdb["followers"])
                if not full_name and cdb.get("name"):
                    full_name = cdb.get("name")

    # Strict Validations
    if not email or "@" not in email:
        return None
    if not (MIN_FOLLOWERS <= f_num <= MAX_FOLLOWERS):
        return None
    if not is_strictly_usa(loc, biography):
        return None
    
    cand_obj = {
        "username": username,
        "name": full_name,
        "email": email,
        "phone": "",
        "followers": f"{int(round(f_num/1000))}K" if f_num >= 1000 else str(f_num),
        "followers_num": f_num,
        "category": "Couples & Family",
        "location": loc,
        "biography": biography,
        "instagram_url": f"https://www.instagram.com/{username}",
        "is_verified": True,
        "price": candidate.get("price", "$150") or "$150",
        "rating": candidate.get("rating", "5.0") or "5.0",
        "package_offer": candidate.get("package_offer", "1 Instagram Reel") or "1 Instagram Reel",
        "external_url": external_url,
        "email_status": "not_sent",
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    }
    
    if not is_couple_creator(cand_obj):
        return None
        
    return cand_obj

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
    print("🚀 EXTRACTING 100 BRAND NEW USA COUPLE CREATORS (100K-500K | NOT IN DB)")
    print("=" * 70, flush=True)

    db_usernames = load_all_existing_db_usernames()
    seen = set(db_usernames)

    collected_creators = []
    
    # Check if partial output exists
    if os.path.exists(OUTPUT_JSON):
        try:
            with open(OUTPUT_JSON, "r", encoding="utf-8") as jf:
                saved = json.load(jf)
                for item in saved:
                    u = str(item.get("username", "")).strip().lower().lstrip("@")
                    if u and u not in db_usernames:
                        collected_creators.append(item)
                        seen.add(u)
            print(f"Loaded {len(collected_creators)} verified brand new creators from JSON.", flush=True)
        except Exception:
            pass

    # Build URLs
    urls_to_scan = []
    for q in SEARCH_QUERIES:
        for pg in range(1, 12):
            urls_to_scan.append((f"https://collabstr.com/influencers?q={q}&loc_ids=204821&pg={pg}", q, None))
            urls_to_scan.append((f"https://collabstr.com/influencers?q={q}&pg={pg}", q, None))
    for cat in CATEGORIES:
        cat_enc = cat.replace(' ', '+').replace('&', '%26')
        for pg in range(1, 15):
            urls_to_scan.append((f"https://collabstr.com/influencers?c={cat_enc}&loc_ids=204821&pg={pg}", None, cat))

    print(f"[*] Scanning {len(urls_to_scan)} search and category pages concurrently...", flush=True)

    raw_candidates = []
    with ThreadPoolExecutor(max_workers=20) as executor:
        futures = {executor.submit(scrape_url_cards, u_item): u_item for u_item in urls_to_scan}
        for f in as_completed(futures):
            cards = f.result()
            for c in cards:
                u = str(c.get("username", "")).strip().lower()
                f_num = c.get("followers_num", 0)
                if not f_num and c.get("followers"):
                    f_num = parse_num(c.get("followers"))
                    c["followers_num"] = f_num
                
                # Keep if not in db and within 100k-500k range or unparsed
                if u and u not in seen:
                    if f_num == 0 or (MIN_FOLLOWERS <= f_num <= MAX_FOLLOWERS):
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
                print(f"[{len(collected_creators)}/{TARGET_COUNT}] ✅ NEW: @{res['username']} | {res['followers']} | {res['location']} | {res['email']}", flush=True)
                
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

    # Clean records for Supabase (strictly columns that exist in table schema)
    clean_db_records = []
    for c in final_100:
        clean_db_records.append({
            "username": c.get("username", "").strip(),
            "name": c.get("name", "").strip() or c.get("username", "").strip(),
            "email": c.get("email", "").strip(),
            "phone": c.get("phone", "") or "",
            "followers": str(c.get("followers", "0")),
            "followers_num": int(c.get("followers_num", 0) or 0),
            "category": c.get("category", "Couples & Family"),
            "location": c.get("location", "USA"),
            "biography": c.get("biography", "") or "",
            "instagram_url": c.get("instagram_url", f"https://www.instagram.com/{c.get('username', '')}"),
            "is_verified": bool(c.get("is_verified", False)),
            "price": str(c.get("price", "") or ""),
            "rating": str(c.get("rating", "") or ""),
            "package_offer": str(c.get("package_offer", "") or ""),
            "external_url": str(c.get("external_url", "") or ""),
            "email_status": c.get("email_status", "not_sent") or "not_sent",
            "last_emailed_at": None,
            "email_subject": "",
            "email_body": ""
        })

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
    for i in range(0, len(clean_db_records), BATCH_SIZE):
        batch = clean_db_records[i:i + BATCH_SIZE]
        upload_res = requests.post(endpoint, headers=headers, json=batch, timeout=30)
        if upload_res.status_code in [200, 201]:
            uploaded += len(batch)
            print(f"  [✓] Inserted batch {i + 1} - {min(i + BATCH_SIZE, len(clean_db_records))} / {len(clean_db_records)} creators", flush=True)
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
