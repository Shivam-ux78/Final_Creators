import os
import sys
import re
import json
import time
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
MAX_FOLLOWERS = 400000
TARGET_COUNT = 100

OUTPUT_JSON = os.path.join("data", "extracted_100_new_couples_100k_400k_usa.json")
OUTPUT_CSV = os.path.join("data", "extracted_100_new_couples_100k_400k_usa.csv")
OUTPUT_XLSX = os.path.join("data", "extracted_100_new_couples_100k_400k_usa.xlsx")

EXPANDED_QUERIES = [
    "motherhood", "fatherhood", "parenting", "lifestyle", "couples+goals",
    "vloggers", "duo", "daily+vlog", "our+family", "mom+life", "dad+life",
    "husband+wife", "marriage+advice", "dating+vlog", "family+fun", "family+vlogs",
    "couple+travel", "traveling+lovers", "engaged+couple", "wedding+day", "family+blog",
    "life+as+mom", "life+as+dad", "family+vacation", "toddler+mom", "boy+mom", "girl+mom",
    "raising+toddlers", "twin+mom", "twin+dad", "family+living", "home+and+family",
    "cooking+with+family", "couple+fitness", "couple+comedy", "prank+couple", "couple+challenge",
    "san+antonio", "san+jose", "columbus", "indianapolis", "charlotte", "san+francisco",
    "oklahoma+city", "el+paso", "washington+dc", "boston", "las+vegas", "portland",
    "detroit", "louisville", "memphis", "baltimore", "milwaukee", "albuquerque", "tucson",
    "fresno", "sacramento", "mesa", "kansas+city", "omaha", "colorado+springs", "raleigh",
    "virginia+beach", "long+beach", "oakland", "minneapolis", "tulsa", "tampa", "arlington",
    "new+orleans", "wichita", "cleveland", "bakersfield", "aurora", "anaheim", "honolulu",
    "santa+ana", "riverside", "corpus+christi", "lexington", "stockton", "henderson",
    "saint+paul", "st+louis", "cincinnati", "pittsburgh", "greensboro", "anchorage",
    "plano", "lincoln", "orlando", "irvine", "newark", "toledo", "durham", "chula+vista",
    "fort+wayne", "jersey+city", "st+petersburg", "laredo", "madison", "chandler",
    "buffalo", "lubbock", "scottsdale", "reno", "glendale", "gilbert", "winston+salem",
    "north+las+vegas", "norfolk", "chesapeake", "garland", "irving", "hialeah",
    "fremont", "boise", "richmond", "baton+rouge"
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
    "home", "homestead", "life with", "adventures of", "lifestyle"
]

def load_existing():
    existing_creators = []
    seen = set()
    
    # 1. Previous 100 couples batch
    prev_file = os.path.join("data", "extracted_100_couples_100k_300k_usa.json")
    if os.path.exists(prev_file):
        try:
            with open(prev_file, "r", encoding="utf-8") as f:
                for item in json.load(f):
                    u = str(item.get("username", "")).strip().lower().lstrip("@")
                    if u:
                        seen.add(u)
        except Exception:
            pass

    # 2. Current 100 new couples batch
    if os.path.exists(OUTPUT_JSON):
        try:
            with open(OUTPUT_JSON, "r", encoding="utf-8") as f:
                for item in json.load(f):
                    u = str(item.get("username", "")).strip().lower().lstrip("@")
                    if u and u not in [c["username"] for c in existing_creators]:
                        existing_creators.append(item)
                        seen.add(u)
        except Exception:
            pass
            
    print(f"Loaded {len(existing_creators)} already collected creators in new batch.", flush=True)
    print(f"Total exclusion pool (prev batch + current): {len(seen)} usernames.", flush=True)
    return existing_creators, seen

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
    
    # Follower check strictly 100k to 400k
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
    
    # Email lookup pipeline
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

def main():
    final_creators, seen = load_existing()
    
    if len(final_creators) >= TARGET_COUNT:
        print("Target already reached!", flush=True)
        return

    print("=" * 70, flush=True)
    print(f"🚀 COMPLETING NEW 100 USA COUPLE CREATORS ({len(final_creators)}/{TARGET_COUNT})", flush=True)
    print("=" * 70, flush=True)

    candidates = []
    
    # Scrape search queries
    for q in EXPANDED_QUERIES:
        if len(final_creators) >= TARGET_COUNT:
            break
        for pg in range(1, 15):
            url = f"https://collabstr.com/influencers?q={q}&loc_ids=204821&pg={pg}"
            try:
                r = cureq.get(url, headers=DEFAULT_HEADERS, impersonate="chrome120", timeout=10)
                if r.status_code != 200:
                    break
                soup = BeautifulSoup(r.text, "html.parser")
                cards = soup.select('.profile-listing-holder')
                if not cards:
                    break
                
                new_added = 0
                batch_cards = []
                for c in cards:
                    parsed = parse_collabstr_card(c)
                    if parsed:
                        u = parsed["username"].strip().lower()
                        if u and u not in seen:
                            parsed["query_matched"] = q
                            seen.add(u)
                            batch_cards.append(parsed)
                            new_added += 1
                
                # Enrich batch immediately
                if batch_cards:
                    with ThreadPoolExecutor(max_workers=6) as executor:
                        futures = {executor.submit(enrich_single_candidate, card): card for card in batch_cards}
                        for future in as_completed(futures):
                            res = future.result()
                            if res:
                                final_creators.append(res)
                                print(f"[{len(final_creators)}/{TARGET_COUNT}] ✅ @{res['username']} | {res['followers']} | {res['location']} | {res['email']} ({res['lookup_source']})", flush=True)
                                
                                with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
                                    json.dump(final_creators, f, indent=2, ensure_ascii=False)
                                    
                                if len(final_creators) >= TARGET_COUNT:
                                    break
                
                if len(final_creators) >= TARGET_COUNT:
                    break
                if new_added == 0 and pg > 1:
                    break
            except Exception:
                break

    final_100 = final_creators[:TARGET_COUNT]
    with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
        json.dump(final_100, f, indent=2, ensure_ascii=False)
        
    df = pd.DataFrame(final_100)
    df.to_csv(OUTPUT_CSV, index=False)
    df.to_excel(OUTPUT_XLSX, index=False)
    
    print("\n" + "=" * 70, flush=True)
    print(f"✨ COMPLETED: Extracted {len(final_100)} new USA couple creators (100k-400k followers)!", flush=True)
    print(f"📁 JSON: {OUTPUT_JSON}", flush=True)
    print(f"📁 CSV:  {OUTPUT_CSV}", flush=True)
    print(f"📁 XLSX: {OUTPUT_XLSX}", flush=True)
    print("=" * 70, flush=True)

if __name__ == "__main__":
    main()
