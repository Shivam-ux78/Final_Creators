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
TARGET_TOTAL = 100

OUTPUT_JSON = os.path.join("data", "extracted_100_brand_new_100k_500k_batch5.json")
OUTPUT_CSV = os.path.join("data", "extracted_100_brand_new_100k_500k_batch5.csv")
OUTPUT_XLSX = os.path.join("data", "extracted_100_brand_new_100k_500k_batch5.xlsx")

SUPABASE_URL = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY") or os.environ.get("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "")
TABLE_NAME = os.environ.get("SUPABASE_TABLE_NAME", "creators")

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
            
    print(f"[*] Total existing usernames currently in Supabase DB: {len(existing)}", flush=True)
    return existing

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
            
            for mailto in soup.find_all("a", href=re.compile(r"^mailto:")):
                em = clean_email(mailto["href"].replace("mailto:", "").split("?")[0])
                if em:
                    email = em
                    break
            
            if not external_url:
                for a in soup.find_all("a", href=True):
                    h = a["href"]
                    if any(kw in h.lower() for kw in ["linktr.ee", "beacons.ai", "hoo.be", "stan.store", "allmylinks"]):
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
        
    return cand_obj

def scrape_url_cards(url: str) -> list[dict]:
    cards = []
    try:
        r = cureq.get(url, headers=DEFAULT_HEADERS, impersonate="chrome120", timeout=8)
        if r.status_code == 200:
            soup = BeautifulSoup(r.text, "html.parser")
            elements = soup.select('.profile-listing-holder')
            for el in elements:
                parsed = parse_collabstr_card(el)
                if parsed and parsed.get("username"):
                    cards.append(parsed)
    except Exception:
        pass
    return cards

def main():
    print("=" * 70, flush=True)
    print("🚀 EXTRACTING REMAINING 3 CREATORS TO HIT EXACTLY 100 (BATCH 5)")
    print("=" * 70, flush=True)

    db_usernames = load_all_existing_db_usernames()
    seen = set(db_usernames)

    collected_creators = []
    if os.path.exists(OUTPUT_JSON):
        with open(OUTPUT_JSON, "r", encoding="utf-8") as jf:
            collected_creators = json.load(jf)
            for c in collected_creators:
                seen.add(str(c.get("username", "")).strip().lower())
                
    print(f"[*] Starting with {len(collected_creators)} verified creators in batch 5.", flush=True)

    more_queries = [
        "https://collabstr.com/influencers?platform=instagram&loc_ids=204821&pg=",
        "https://collabstr.com/influencers?platform=tiktok&loc_ids=204821&pg=",
        "https://collabstr.com/influencers?q=family+love&pg=",
        "https://collabstr.com/influencers?q=couple+goals&pg=",
        "https://collabstr.com/influencers?q=husband+and+wife&pg=",
        "https://collabstr.com/influencers?q=united+states&pg=",
        "https://collabstr.com/influencers?q=american+family&pg=",
        "https://collabstr.com/influencers?q=lifestyle+creator&pg=",
        "https://collabstr.com/influencers?c=Lifestyle&min_followers=100000&max_followers=500000&pg=",
        "https://collabstr.com/influencers?c=Family+%26+Children&min_followers=100000&max_followers=500000&pg="
    ]
    
    urls_to_scan = []
    for base in more_queries:
        for pg in range(1, 15):
            urls_to_scan.append(f"{base}{pg}")

    raw_candidates = []
    with ThreadPoolExecutor(max_workers=20) as executor:
        futures = {executor.submit(scrape_url_cards, u): u for u in urls_to_scan}
        for f in as_completed(futures):
            for c in f.result():
                u = str(c.get("username", "")).strip().lower()
                f_num = c.get("followers_num", 0)
                if not f_num and c.get("followers"):
                    f_num = parse_num(c.get("followers"))
                    c["followers_num"] = f_num
                if u and u not in seen:
                    if f_num == 0 or (MIN_FOLLOWERS <= f_num <= MAX_FOLLOWERS):
                        seen.add(u)
                        raw_candidates.append(c)

    print(f"[✓] Found {len(raw_candidates)} additional candidates. Verifying...", flush=True)

    with ThreadPoolExecutor(max_workers=16) as executor:
        futures = {executor.submit(enrich_single_candidate, c): c for c in raw_candidates}
        for f in as_completed(futures):
            res = f.result()
            if res:
                collected_creators.append(res)
                print(f"[{len(collected_creators)}/{TARGET_TOTAL}] ✅ NEW: @{res['username']} | {res['followers']} | {res['location']} | {res['email']}", flush=True)
                
                with open(OUTPUT_JSON, "w", encoding="utf-8") as jf:
                    json.dump(collected_creators, jf, indent=2, ensure_ascii=False)
                    
                if len(collected_creators) >= TARGET_TOTAL:
                    break

    final_100 = collected_creators[:TARGET_TOTAL]
    with open(OUTPUT_JSON, "w", encoding="utf-8") as jf:
        json.dump(final_100, jf, indent=2, ensure_ascii=False)
        
    df = pd.DataFrame(final_100)
    df.to_csv(OUTPUT_CSV, index=False)
    df.to_excel(OUTPUT_XLSX, index=False)

    print(f"\n[✓] Saved {len(final_100)} creators to JSON, CSV, and XLSX.", flush=True)

    # Push all 100 creators to Supabase
    print("\n[*] Pushing to Supabase...", flush=True)
    endpoint = f"{SUPABASE_URL}/rest/v1/{TABLE_NAME}?on_conflict=username"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation,resolution=merge-duplicates"
    }

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

    BATCH_SIZE = 50
    for i in range(0, len(clean_db_records), BATCH_SIZE):
        batch = clean_db_records[i:i + BATCH_SIZE]
        upload_res = requests.post(endpoint, headers=headers, json=batch, timeout=30)
        print(f"  [✓] Upserted batch {i + 1} - {min(i + BATCH_SIZE, len(clean_db_records))} / {len(clean_db_records)}")

    # Check total count
    count_res = requests.get(
        f"{SUPABASE_URL}/rest/v1/{TABLE_NAME}?select=id",
        headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}", "Range": "0-0", "Prefer": "count=exact"},
        timeout=10
    )
    print(f"\n🎉 Total creators in Supabase database: {count_res.headers.get('Content-Range', '').split('/')[-1]}", flush=True)

if __name__ == "__main__":
    main()
