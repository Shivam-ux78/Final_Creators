import json
import os
import sys
import time
from pathlib import Path
from urllib.parse import quote_plus
from bs4 import BeautifulSoup
from curl_cffi import requests as cureq

from config.settings import DEFAULT_HEADERS, RAW_DATA_DIR, ENRICHED_DATA_DIR
from scrapers.collabstr_scraper import parse_collabstr_card
from scrapers.instagram_profile import fetch_instagram_profile
from utils.exporter import export_data

if sys.platform == 'win32':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except:
        pass

# Categories strictly excluding gov, finance, news, media
ALLOWED_CATEGORIES = [
    'Lifestyle',
    'Beauty',
    'Fashion',
    'Health & Fitness',
    'Food & Drink',
    'Travel',
    'Art & Photography',
    'Animals & Pets',
    'Comedy & Entertainment',
    'Music & Dance',
    'DIY & Craft'
]

def collect_multi_category_creators(
    min_followers=5000,
    max_followers=50000,
    target_emails=50,
    location_id="204821" # USA
):
    print("=" * 65)
    print(" 🚀 MULTI-CATEGORY CREATOR DISCOVERY & EMAIL ENRICHMENT")
    print("    Follower Range: 5,000 - 50,000 | Location: USA")
    print("    Excluding: Government, Finance, News, Media")
    print(f"    Target: {target_emails} Creators with Verified Emails")
    print("=" * 65 + "\n")

    seen_usernames = set()
    creators_with_email = []
    all_scanned = []

    for cat in ALLOWED_CATEGORIES:
        if len(creators_with_email) >= target_emails:
            break

        print(f"\n[📁 Category] {cat.upper()}")
        cat_enc = quote_plus(cat)
        
        # Scrape up to 4 pages per category to get diverse creators
        for page in range(1, 5):
            if len(creators_with_email) >= target_emails:
                break

            url = (
                f"https://collabstr.com/influencers"
                f"?p=instagram&c={cat_enc}&loc_ids={location_id}"
                f"&fmi={min_followers}&fmx={max_followers}&pg={page}"
            )

            try:
                r = cureq.get(url, headers=DEFAULT_HEADERS, impersonate="chrome120", timeout=15)
                if r.status_code != 200:
                    break

                soup = BeautifulSoup(r.text, "html.parser")
                cards = soup.select('.profile-listing-holder')
                if not cards:
                    break

                for card in cards:
                    if len(creators_with_email) >= target_emails:
                        break

                    data = parse_collabstr_card(card)
                    if not data:
                        continue

                    username = data['username']
                    if username in seen_usernames:
                        continue
                    seen_usernames.add(username)
                    data['category'] = cat

                    # Enrich with profile details and bio email
                    ig_data = fetch_instagram_profile(username)
                    merged = {**data}

                    email = ""
                    phone = ""
                    if "error" not in ig_data:
                        merged["biography"] = ig_data.get("biography", "")
                        email = ig_data.get("bio_email", "")
                        phone = ig_data.get("bio_phones", "")
                        merged["email"] = email
                        merged["phone"] = phone
                        merged["is_verified"] = ig_data.get("is_verified", False)
                        merged["external_url"] = ig_data.get("external_url", "")
                        if ig_data.get("followers"):
                            merged["ig_followers_exact"] = ig_data.get("followers")
                    else:
                        merged["email"] = ""
                        merged["phone"] = ""
                        merged["error"] = ig_data.get("error")

                    all_scanned.append(merged)

                    if email:
                        creators_with_email.append(merged)
                        print(f"[{len(creators_with_email):02d}/{target_emails}] [{cat[:10]:<10}] @{username:<20} ✉ {email:<32} 📱 {phone or 'N/A'}")
                    else:
                        print(f"[-] [{cat[:10]:<10}] @{username:<20} (No email in bio)")

                    time.sleep(0.35)

            except Exception as e:
                print(f"[!] Error in {cat} pg {page}: {e}")
                time.sleep(1)

    # Save to file
    out_file = ENRICHED_DATA_DIR / f"creators_multi_category_5k_50k_{len(creators_with_email)}_emails"
    export_data(creators_with_email, out_file)

    print("\n" + "=" * 65)
    print(f"[🎯 SUCCESS] Collected {len(creators_with_email)} creators with direct emails across categories!")
    print(f"    - Excel: {out_file}.xlsx")
    print(f"    - CSV:   {out_file}.csv")
    print(f"    - JSON:  {out_file}.json")
    print("=" * 65)

if __name__ == "__main__":
    collect_multi_category_creators(
        min_followers=5000,
        max_followers=50000,
        target_emails=50
    )
