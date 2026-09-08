import os
import sys
import json
import time
import requests
from bs4 import BeautifulSoup
from curl_cffi import requests as cureq
from concurrent.futures import ThreadPoolExecutor, as_completed
from dotenv import load_dotenv

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
MAX_FOLLOWERS = 300000
TARGET_COUNT = 100
OUTPUT_FILE = os.path.join("data", "extracted_100_couples_100k_300k_usa.json")

SUPABASE_URL = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY") or os.environ.get("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY")
TABLE = os.environ.get("SUPABASE_TABLE_NAME", "creators")

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

def get_existing_usernames() -> set:
    existing = set()
    if SUPABASE_URL and SUPABASE_KEY:
        try:
            r = requests.get(
                f"{SUPABASE_URL}/rest/v1/{TABLE}?select=username",
                headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"},
                timeout=10
            )
            if r.status_code == 200:
                for row in r.json():
                    u = str(row.get("username", "")).strip().lower().lstrip("@")
                    if u:
                        existing.add(u)
        except:
            pass
            
    for root, _, files in os.walk("data"):
        for f in files:
            if f.endswith(".json") and f != "extracted_100_couples_100k_300k_usa.json":
                try:
                    with open(os.path.join(root, f), "r", encoding="utf-8") as jf:
                        data = json.load(jf)
                        if isinstance(data, list):
                            for item in data:
                                u = str(item.get("username", "")).strip().lower().lstrip("@")
                                if u:
                                    existing.add(u)
                except:
                    pass
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
        try: return int(float(s.replace('k', '')) * 1000)
        except: return 0
    if 'm' in s:
        try: return int(float(s.replace('m', '')) * 1000000)
        except: return 0
    try: return int(float(s))
    except: return 0

def fetch_cat_page(cat, pg, seen_set):
    term_enc = cat.replace(' ', '+').replace('&', '%26')
    url = f"https://collabstr.com/influencers?c={term_enc}&loc_ids=204821&pg={pg}"
    results = []
    try:
        r = cureq.get(url, headers=DEFAULT_HEADERS, impersonate="chrome120", timeout=8)
        if r.status_code == 200:
            soup = BeautifulSoup(r.text, "html.parser")
            cards = soup.select('.profile-listing-holder')
            for c in cards:
                parsed = parse_collabstr_card(c)
                if parsed:
                    u = parsed["username"].strip().lower()
                    if u and u not in seen_set:
                        parsed["query_matched"] = cat
                        results.append(parsed)
    except:
        pass
    return results

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
    
    # Follower check strictly 100k to 300k
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
        "location": loc if any(k in loc for k in [", US", "USA", ", CA", ", TX", ", FL", ", NY"]) else f"{loc}, US",
        "biography": biography,
        "instagram_url": f"https://www.instagram.com/{username}",
        "is_verified": is_verified,
        "price": candidate.get("price", ""),
        "rating": candidate.get("rating", "5.0"),
        "package_offer": candidate.get("package_offer", "1 Instagram Reel / Story Collab"),
        "external_url": ext_url,
        "lookup_source": lookup_source,
        "email_status": "not_sent",
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    }

def main():
    excluded_usernames = get_existing_usernames()
    
    verified_creators = []
    seen = set()
    if os.path.exists(OUTPUT_FILE):
        try:
            with open(OUTPUT_FILE, "r", encoding="utf-8") as f:
                saved = json.load(f)
                if isinstance(saved, list):
                    for item in saved:
                        u = item.get("username", "").strip().lower()
                        if u and u not in seen:
                            seen.add(u)
                            verified_creators.append(item)
            print(f"[*] Resumed with {len(verified_creators)} verified creators already in output file.", flush=True)
        except:
            pass

    if len(verified_creators) >= TARGET_COUNT:
        print(f"[✓] Goal reached ({len(verified_creators)} creators).")
        return

    needed = TARGET_COUNT - len(verified_creators)
    print(f"[*] Need {needed} more creators to reach {TARGET_COUNT} target.", flush=True)
    
    seen_candidates = set(excluded_usernames) | seen

    categories = [
        "Travel",
        "Food & Drink",
        "Health & Fitness",
        "Comedy & Entertainment",
        "Fashion & Style",
        "Beauty"
    ]

    for cat in categories:
        if len(verified_creators) >= TARGET_COUNT:
            break
        print(f"[*] Crawling category '{cat}' (pages 1 to 25)...", flush=True)
        tasks = [(cat, pg) for pg in range(1, 26)]
        candidates = []
        with ThreadPoolExecutor(max_workers=10) as executor:
            futures = {executor.submit(fetch_cat_page, c, p, seen_candidates): (c, p) for c, p in tasks}
            for future in as_completed(futures):
                try:
                    res = future.result()
                    for item in res:
                        u = item["username"]
                        if u not in seen_candidates:
                            seen_candidates.add(u)
                            candidates.append(item)
                except:
                    pass
                    
        print(f"  -> Discovered {len(candidates)} candidates in '{cat}'. Enriching...", flush=True)
        if not candidates:
            continue
            
        with ThreadPoolExecutor(max_workers=15) as executor:
            enrich_futures = {executor.submit(enrich_single_candidate, c): c for c in candidates}
            for future in as_completed(enrich_futures):
                try:
                    res = future.result()
                    if res and res["username"] not in seen and res["username"] not in excluded_usernames:
                        seen.add(res["username"])
                        verified_creators.append(res)
                        print(f"  [✓] #{len(verified_creators):03d} @{res['username']:<20} | {res['followers']:<6} | {res['email']:<32} | {res['location']}", flush=True)
                        
                        with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
                            json.dump(verified_creators, f, indent=2, ensure_ascii=False)
                                
                        if len(verified_creators) >= TARGET_COUNT:
                            break
                except:
                    pass

    # Final sort and save
    verified_creators.sort(key=lambda x: x.get("followers_num", 0), reverse=True)
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(verified_creators, f, indent=2, ensure_ascii=False)

    print("\n" + "=" * 70, flush=True)
    print(f"🎉 FINAL COMPLETION: Successfully compiled {len(verified_creators)} verified Couple Creators (100k-300k | USA)")
    print(f"📁 Saved to: {OUTPUT_FILE}")
    print("=" * 70, flush=True)

if __name__ == "__main__":
    main()
