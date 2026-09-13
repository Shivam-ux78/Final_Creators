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

SEARCH_QUERIES = [
    "couple",
    "couples",
    "married",
    "marriage",
    "husband",
    "wife",
    "relationship",
    "parents",
    "family",
    "duo",
    "two",
    "traveling+couple",
    "travel+couple",
    "together",
    "dating",
    "love",
    "partner",
    "partners",
    "wedding",
    "lifestyle+couple",
    "family+lifestyle",
    "mom+dad",
    "raising",
    "our+life",
    "daily+vlog",
    "home+life",
    "adventures",
    "twins"
]

CATEGORIES = [
    "Family & Children",
    "Lifestyle",
    "Travel",
    "Comedy & Entertainment",
    "Food & Drink",
    "Health & Fitness",
    "Fashion",
    "Beauty",
    "Animals & Pets",
    "Art & Photography",
    "DIY & Craft",
    "Music & Dance"
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
    "husband & dad", "family of", "travel family", "adventure couple"
]

def get_existing_usernames() -> set:
    """Loads all existing usernames in Supabase and local data to prevent duplicates."""
    existing = set()
    
    # 1. Fetch from Supabase
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
                print(f"[*] Loaded {len(existing)} existing usernames from Supabase.", flush=True)
        except Exception as e:
            print(f"[!] Warning fetching Supabase usernames: {e}", flush=True)
            
    # 2. Local JSON files (excluding our target output file)
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
                    
    print(f"[*] Exclusion pool: {len(existing)} existing creators.", flush=True)
    return existing

def is_couple_creator(creator: dict) -> bool:
    """Checks if creator is in the couple / relationship / family niche."""
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

def fetch_collabstr_candidates(excluded_usernames: set):
    """Scrapes raw candidates from Collabstr."""
    seen_usernames = set(excluded_usernames)
    candidates = []
    
    print("=" * 70, flush=True)
    print("🚀 DISCOVERING COUPLE CREATORS (100K - 300K FOLLOWERS | USA)", flush=True)
    print("=" * 70, flush=True)
    
    # 1. Search Queries
    for q in SEARCH_QUERIES:
        for pg in range(1, 30):
            url = f"https://collabstr.com/influencers?q={q}&loc_ids=204821&pg={pg}"
            try:
                r = cureq.get(url, headers=DEFAULT_HEADERS, impersonate="chrome120", timeout=12)
                if r.status_code != 200:
                    break
                soup = BeautifulSoup(r.text, "html.parser")
                cards = soup.select('.profile-listing-holder')
                if not cards:
                    break
                
                added = 0
                for c in cards:
                    parsed = parse_collabstr_card(c)
                    if parsed:
                        u = parsed["username"].strip().lower()
                        if u and u not in seen_usernames:
                            parsed["query_matched"] = q
                            seen_usernames.add(u)
                            candidates.append(parsed)
                            added += 1
                
                if added == 0 and pg > 1:
                    break
                time.sleep(0.08)
            except Exception as e:
                break

    # 2. Browse Category Pages
    for cat in CATEGORIES:
        cat_enc = cat.replace(' ', '+').replace('&', '%26')
        for pg in range(1, 35):
            url = f"https://collabstr.com/influencers?c={cat_enc}&loc_ids=204821&pg={pg}"
            try:
                r = cureq.get(url, headers=DEFAULT_HEADERS, impersonate="chrome120", timeout=12)
                if r.status_code != 200:
                    break
                soup = BeautifulSoup(r.text, "html.parser")
                cards = soup.select('.profile-listing-holder')
                if not cards:
                    break
                
                added = 0
                for c in cards:
                    parsed = parse_collabstr_card(c)
                    if parsed:
                        u = parsed["username"].strip().lower()
                        if u and u not in seen_usernames:
                            parsed["category"] = cat
                            seen_usernames.add(u)
                            candidates.append(parsed)
                            added += 1
                
                if added == 0 and pg > 1:
                    break
                time.sleep(0.08)
            except Exception as e:
                break

    print(f"[✓] Total candidate pool: {len(candidates)} creators", flush=True)
    return candidates

def enrich_single_candidate(candidate: dict) -> dict:
    """Enriches candidate with real Instagram bio, verified email, and US validation."""
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
    
    # Follower check (strictly 100k to 300k)
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
    
    # Check external link (Linktree, Beacons, Stan.store)
    if not verified_email and ext_url:
        link_email = extract_from_external_link(ext_url)
        if link_email:
            verified_email = link_email
            lookup_source = "External Link (Linktree/Beacons)"
            
    # Check CreatorDB public finder
    if not verified_email:
        cdb = lookup_creatordb(username)
        if cdb and cdb.get("email"):
            verified_email = clean_email(cdb.get("email"))
            if verified_email:
                lookup_source = "CreatorDB"
                if not full_name and cdb.get("name"):
                    full_name = cdb.get("name")
    
    # Strict: zero synthetic emails. Drop if no real email found.
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
    candidates = fetch_collabstr_candidates(excluded_usernames)
    if not candidates:
        print("[!] No candidates found.", flush=True)
        return

    # Load existing verified creators from OUTPUT_FILE if present to resume seamlessly
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
            print(f"[*] Resuming with {len(verified_creators)} already verified creators in output file.", flush=True)
        except:
            pass

    print("\n" + "=" * 70, flush=True)
    print(f"🔍 ENRICHING & VERIFYING CANDIDATES (TARGET: {TARGET_COUNT} COUPLE CREATORS 100K-300K)", flush=True)
    print("=" * 70, flush=True)

    with ThreadPoolExecutor(max_workers=25) as executor:
        futures = {executor.submit(enrich_single_candidate, c): c for c in candidates if c.get("username", "").strip().lower() not in seen}
        for future in as_completed(futures):
            res = future.result()
            if res and res["username"] not in seen and res["username"] not in excluded_usernames:
                seen.add(res["username"])
                verified_creators.append(res)
                print(f"  [✓] #{len(verified_creators):03d} @{res['username']:<20} | {res['followers']:<6} | {res['email']:<32} | {res['location']}", flush=True)
                
                # Periodically save snapshot
                if len(verified_creators) % 5 == 0 or len(verified_creators) >= TARGET_COUNT:
                    os.makedirs("data", exist_ok=True)
                    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
                        json.dump(verified_creators, f, indent=2, ensure_ascii=False)
                        
                if len(verified_creators) >= TARGET_COUNT:
                    break

    # Sort descending by followers
    verified_creators.sort(key=lambda x: x.get("followers_num", 0), reverse=True)

    # Final save
    os.makedirs("data", exist_ok=True)
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(verified_creators, f, indent=2, ensure_ascii=False)

    print("\n" + "=" * 70, flush=True)
    print(f"🎉 EXTRACTION COMPLETE: Successfully extracted {len(verified_creators)} verified Couple Creators (100k-300k | USA)", flush=True)
    print(f"📁 Saved to: {OUTPUT_FILE}", flush=True)
    print("🔒 Note: Stored in JSON dataset (not pushed to DB).", flush=True)
    print("=" * 70, flush=True)

if __name__ == "__main__":
    main()
