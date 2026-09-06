import sys
import os
import json
import time
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from curl_cffi import requests as cffi_requests
from scrapers.instagram_profile import fetch_instagram_profile
from utils.email_extractor import extract_first_email, extract_phones
from utils.exporter import export_data

sys.stdout.reconfigure(encoding='utf-8')

EMAIL_REGEX = re.compile(r'^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$')

def is_valid_email(email: str) -> bool:
    if not email or not isinstance(email, str):
        return False
    email = email.strip().lower()
    if len(email) < 5 or "@" not in email or "." not in email:
        return False
    # Avoid fake or dummy emails
    if any(fake in email for fake in ["example.com", "email.com", "domain.com", "user@", "test@"]):
        return False
    # Must match email regex pattern
    return bool(EMAIL_REGEX.match(email))

def parse_followers(val) -> int:
    if isinstance(val, int):
        return val
    if not val:
        return 0
    val_str = str(val).replace(',', '').strip().lower()
    match = re.search(r'([\d\.]+)\s*([kmb]?)', val_str)
    if not match:
        return 0
    num = float(match.group(1))
    unit = match.group(2)
    if unit == 'k':
        return int(num * 1000)
    elif unit == 'm':
        return int(num * 1000000)
    elif unit == 'b':
        return int(num * 1000000000)
    return int(num)

def verify_single_creator(creator):
    username = creator.get("username", "").strip()
    if not username:
        return None

    # Fetch live Instagram profile data
    prof = fetch_instagram_profile(username)
    if not prof or prof.get("error"):
        print(f"[-] Dropping @{username}: Profile broken/not found/error ({prof.get('error') if prof else 'No response'})", flush=True)
        return None

    # Check if private
    if prof.get("is_private"):
        print(f"[-] Dropping @{username}: Account is PRIVATE", flush=True)
        return None

    # Extract exact live follower count
    live_followers_raw = prof.get("followers", 0)
    live_followers = parse_followers(live_followers_raw)
    if live_followers == 0:
        live_followers = parse_followers(creator.get("followers_num", 0))

    # Follower Range Check: 5k to 50k (with slight tolerance e.g. 4.8k to 52k)
    if not (4800 <= live_followers <= 55000):
        print(f"[-] Dropping @{username}: Live followers ({live_followers:,}) outside 5k-50k range", flush=True)
        return None

    # Email Check
    bio = prof.get("biography", "") or creator.get("biography", "")
    email = prof.get("email", "") or creator.get("email", "")
    if not email:
        email = extract_first_email(bio)

    email_clean = email.strip().lower() if email else ""
    if not is_valid_email(email_clean):
        print(f"[-] Dropping @{username}: No valid email found", flush=True)
        return None

    # Format clean followers string
    if live_followers >= 1000:
        f_str = f"{live_followers/1000:.1f}k".replace('.0k', 'k')
    else:
        f_str = str(live_followers)

    # Phone
    phone = prof.get("phone", "") or creator.get("phone", "")
    if not phone and bio:
        phones = extract_phones(bio)
        if phones:
            phone = phones[0]

    return {
        "username": username,
        "name": prof.get("full_name") or creator.get("name") or username,
        "email": email_clean,
        "phone": phone,
        "followers": f_str,
        "followers_num": live_followers,
        "category": creator.get("category") or prof.get("category_name") or "Lifestyle / Content Creator",
        "location": creator.get("location") or "USA",
        "biography": bio,
        "instagram_url": f"https://www.instagram.com/{username}",
        "is_verified": prof.get("is_verified", False),
        "price": creator.get("price", ""),
        "rating": creator.get("rating", ""),
        "package_offer": creator.get("package_offer", ""),
        "external_url": prof.get("external_url") or creator.get("external_url", ""),
        "source": creator.get("source", "Verified Public Profile")
    }

def clean_and_verify_master():
    master_path = "data/all_creators_merged.json"
    if not os.path.exists(master_path):
        print(f"[!] Error: {master_path} not found.")
        return

    with open(master_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    # Filter out entries that had no email to begin with
    candidates = [c for c in data if c.get("email") and c.get("username")]

    print("=" * 75)
    print(f"VERIFYING & CLEANING DATASET: LIVE INSTAGRAM VALIDATION")
    print(f"Total Initial Candidates with Email: {len(candidates)}")
    print(f"Criteria: Public Account Only | Followers 5k-50k | Non-Broken | Valid Email")
    print("=" * 75, flush=True)

    verified_creators = []
    seen_emails = set()
    seen_users = set()

    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = {executor.submit(verify_single_creator, c): c for c in candidates}
        for future in as_completed(futures):
            res = future.result()
            if res:
                u = res["username"]
                em = res["email"]
                if u not in seen_users and em not in seen_emails:
                    seen_users.add(u)
                    seen_emails.add(em)
                    verified_creators.append(res)
                    print(f"[OK] VERIFIED: @{u} | {res['followers_num']:,} followers | Email: {em}", flush=True)

    # Sort: by exact live follower count descending
    verified_creators.sort(key=lambda x: x.get("followers_num", 0), reverse=True)

    print("\n" + "=" * 75)
    print(f"FINAL VALIDATED DATASET SUMMARY")
    print(f"Total 100% Verified Public Creators with Valid Emails: {len(verified_creators)}")
    print("=" * 75, flush=True)

    # Save to master files
    master_base = "data/creators_master_all"
    export_data(verified_creators, master_base)

    with open(master_path, "w", encoding="utf-8") as f:
        json.dump(verified_creators, f, indent=2, ensure_ascii=False)
    print(f"[OK] Master Merged JSON overwritten with 100% verified records: {master_path}")

if __name__ == "__main__":
    clean_and_verify_master()
