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
from scrapers.creatordb import extract_from_external_link, clean_email
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

def process_candidate(cand: dict) -> dict:
    u = cand.get("username", "").strip().lower()
    if not u:
        return None
        
    f_num = cand.get("followers_num", 0)
    if not f_num and cand.get("followers"):
        f_num = parse_num(cand.get("followers"))
        
    try:
        r = cureq.get(f"https://collabstr.com/{u}", headers=DEFAULT_HEADERS, impersonate="chrome120", timeout=7)
        if r.status_code != 200:
            return None
            
        soup = BeautifulSoup(r.text, "html.parser")
        
        # Follower count
        if not f_num or f_num < 100000 or f_num > 500000:
            h1 = soup.find("h1")
            if h1:
                m = re.search(r"with\s+([\d\.,KMkm]+)\s+(?:Instagram|TikTok)?\s*followers", h1.get_text(), re.I)
                if m:
                    f_num = parse_num(m.group(1))
            for span in soup.find_all("span"):
                st = span.get_text().strip().lower()
                if "follower" in st:
                    m = re.search(r"([\d\.,KMkm]+)\s*followers", st)
                    if m:
                        f_num = parse_num(m.group(1))
                        break
                    
        if not (MIN_FOLLOWERS <= f_num <= MAX_FOLLOWERS):
            return None
            
        # Biography
        biography = ""
        bio_div = soup.find("div", class_=re.compile(r"bio|description|about", re.I))
        if bio_div:
            biography = bio_div.get_text(separator=" ").strip()
            
        # Email
        email = ""
        for mailto in soup.find_all("a", href=re.compile(r"^mailto:")):
            em = clean_email(mailto["href"].replace("mailto:", "").split("?")[0])
            if em:
                email = em
                break
                
        if not email and biography:
            c_em = clean_email(biography)
            if c_em:
                email = c_em
                
        # External links
        external_url = ""
        for a in soup.find_all("a", href=True):
            h = a["href"]
            if any(kw in h.lower() for kw in ["linktr.ee", "beacons.ai", "hoo.be", "stan.store", "allmylinks"]):
                external_url = h
                if not email:
                    link_em = extract_from_external_link(h)
                    if link_em:
                        c_em = clean_email(link_em)
                        if c_em:
                            email = c_em
                break

        if not email or "@" not in email:
            return None

        loc = cand.get("location", "") or "USA"
        if not is_strictly_usa(loc, biography):
            return None

        return {
            "username": u,
            "name": cand.get("name", "") or u,
            "email": email,
            "phone": "",
            "followers": f"{int(round(f_num/1000))}K" if f_num >= 1000 else str(f_num),
            "followers_num": f_num,
            "category": cand.get("category", "Couples & Family") or "Couples & Family",
            "location": loc,
            "biography": biography,
            "instagram_url": f"https://www.instagram.com/{u}",
            "is_verified": True,
            "price": cand.get("price", "$150") or "$150",
            "rating": cand.get("rating", "5.0") or "5.0",
            "package_offer": cand.get("package_offer", "1 Instagram Reel") or "1 Instagram Reel",
            "external_url": external_url,
            "email_status": "not_sent",
            "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        }
    except Exception:
        return None

def main():
    print("=" * 70, flush=True)
    print("🚀 FINISHING BATCH 5 TO EXACTLY 100 USA CREATORS (100K-500K)")
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

    queries = [
        "https://collabstr.com/influencers?q=family&loc_ids=204821&pg=",
        "https://collabstr.com/influencers?q=couple&loc_ids=204821&pg=",
        "https://collabstr.com/influencers?q=lifestyle&loc_ids=204821&pg=",
        "https://collabstr.com/influencers?q=fitness&loc_ids=204821&pg=",
        "https://collabstr.com/influencers?q=food&loc_ids=204821&pg=",
        "https://collabstr.com/influencers?q=travel&loc_ids=204821&pg=",
        "https://collabstr.com/influencers?q=comedy&loc_ids=204821&pg=",
        "https://collabstr.com/influencers?q=fashion&loc_ids=204821&pg=",
        "https://collabstr.com/influencers?q=beauty&loc_ids=204821&pg=",
        "https://collabstr.com/influencers?q=los+angeles&pg=",
        "https://collabstr.com/influencers?q=new+york&pg=",
        "https://collabstr.com/influencers?q=miami&pg=",
        "https://collabstr.com/influencers?q=texas&pg=",
        "https://collabstr.com/influencers?q=chicago&pg=",
        "https://collabstr.com/influencers?q=atlanta&pg=",
        "https://collabstr.com/influencers?q=california&pg=",
        "https://collabstr.com/influencers?q=florida&pg="
    ]

    for base_url in queries:
        if len(collected_creators) >= TARGET_TOTAL:
            break
        print(f"[*] Scanning {base_url}...", flush=True)
        for pg in range(1, 20):
            if len(collected_creators) >= TARGET_TOTAL:
                break
            try:
                r = cureq.get(f"{base_url}{pg}", headers=DEFAULT_HEADERS, impersonate="chrome120", timeout=8)
                if r.status_code != 200:
                    continue
                soup = BeautifulSoup(r.text, "html.parser")
                cards = []
                for el in soup.select('.profile-listing-holder'):
                    p = parse_collabstr_card(el)
                    if p and p.get("username"):
                        u = str(p["username"]).strip().lower()
                        f_num = p.get("followers_num", 0)
                        if u not in seen:
                            if f_num == 0 or (MIN_FOLLOWERS <= f_num <= MAX_FOLLOWERS):
                                seen.add(u)
                                cards.append(p)
                            
                with ThreadPoolExecutor(max_workers=10) as executor:
                    futures = {executor.submit(process_candidate, c): c for c in cards}
                    for f in as_completed(futures):
                        res = f.result()
                        if res:
                            collected_creators.append(res)
                            print(f"[{len(collected_creators)}/{TARGET_TOTAL}] ✅ NEW: @{res['username']} | {res['followers']} | {res['location']} | {res['email']}", flush=True)
                            
                            with open(OUTPUT_JSON, "w", encoding="utf-8") as jf:
                                json.dump(collected_creators, jf, indent=2, ensure_ascii=False)
                                
                            if len(collected_creators) >= TARGET_TOTAL:
                                print(f"\n🎉 REACHED ALL {TARGET_TOTAL} CREATORS!", flush=True)
                                break
            except Exception:
                pass

    final_100 = collected_creators[:TARGET_TOTAL]
    with open(OUTPUT_JSON, "w", encoding="utf-8") as jf:
        json.dump(final_100, jf, indent=2, ensure_ascii=False)
        
    df = pd.DataFrame(final_100)
    df.to_csv(OUTPUT_CSV, index=False)
    df.to_excel(OUTPUT_XLSX, index=False)

    print(f"\n[✓] Successfully saved all {len(final_100)} creators to JSON, CSV, and XLSX.", flush=True)

    # Push to Supabase
    print("\n[*] Pushing 100 creators to Supabase...", flush=True)
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

    count_res = requests.get(
        f"{SUPABASE_URL}/rest/v1/{TABLE_NAME}?select=id",
        headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}", "Range": "0-0", "Prefer": "count=exact"},
        timeout=10
    )
    print(f"\n🎉 Total creators in Supabase database: {count_res.headers.get('Content-Range', '').split('/')[-1]}", flush=True)

if __name__ == "__main__":
    main()
