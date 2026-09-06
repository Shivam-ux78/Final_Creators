import sys
import os
import glob
import json
import re
from pathlib import Path
import pandas as pd
from utils.exporter import export_data

sys.stdout.reconfigure(encoding='utf-8')

def parse_followers_to_num(val):
    if isinstance(val, (int, float)):
        return int(val)
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

def merge_all_data():
    data_files = [
        "data/raw/creators_usa_10k_50k.json",
        "data/enriched/creators_enriched_all.json",
        "data/enriched/creators_with_emails_50.json",
        "data/enriched/creators_multi_category_5k_50k_50_emails.json",
        "data/enriched/creators_modash_creatordb_50_emails.json",
    ]

    total_records_read = 0
    creators_by_username = {}

    for fpath in data_files:
        if not os.path.exists(fpath):
            print(f"[!] Warning: File {fpath} not found.")
            continue

        with open(fpath, "r", encoding="utf-8") as fp:
            try:
                records = json.load(fp)
            except Exception as e:
                print(f"[!] Error reading {fpath}: {e}")
                continue

            print(f"[*] Reading {fpath} -> {len(records)} records")
            total_records_read += len(records)

            for item in records:
                raw_u = item.get("username", "")
                if not raw_u:
                    continue
                u = raw_u.lower().strip().lstrip('@')
                
                # Standardize follower count
                f_num = item.get("followers_num")
                if not f_num:
                    f_num = parse_followers_to_num(item.get("followers", 0))
                else:
                    f_num = parse_followers_to_num(f_num)

                # Format clean string representation
                f_str = item.get("followers")
                if not f_str or isinstance(f_str, (int, float)):
                    f_str = f"{f_num:,}"

                email = str(item.get("email", "")).lower().strip()
                if email in ["none", "nan", "null"]:
                    email = ""

                phone = str(item.get("phone", "")).strip()
                if phone in ["none", "nan", "null"]:
                    phone = ""

                new_record = {
                    "username": u,
                    "name": item.get("name") or item.get("full_name") or u,
                    "email": email,
                    "phone": phone,
                    "followers": f_str,
                    "followers_num": f_num,
                    "category": item.get("category") or item.get("category_name") or "Lifestyle / Content Creator",
                    "location": item.get("location") or "USA",
                    "biography": item.get("biography", ""),
                    "instagram_url": item.get("instagram_url") or f"https://www.instagram.com/{u}",
                    "is_verified": bool(item.get("is_verified", False)),
                    "price": item.get("price", ""),
                    "rating": item.get("rating", ""),
                    "package_offer": item.get("package_offer", ""),
                    "external_url": item.get("external_url", ""),
                    "source": item.get("source") or ("Collabstr" if "collabstr" in item.get("collabstr_url", "") else "Modash / CreatorDB / Open Directory")
                }

                if u not in creators_by_username:
                    creators_by_username[u] = new_record
                else:
                    # Merge existing record with new data (prioritizing non-empty fields)
                    existing = creators_by_username[u]
                    for k, v in new_record.items():
                        # If existing field is empty or default, overwrite with richer value
                        if not existing.get(k) and v:
                            existing[k] = v
                        # If new record has verified email and existing does not, take it
                        if k == "email" and v and not existing.get("email"):
                            existing["email"] = v
                        # If new record has longer bio, take it
                        if k == "biography" and len(str(v)) > len(str(existing.get("biography", ""))):
                            existing["biography"] = v
                        # If new record has follower num and existing is 0
                        if k == "followers_num" and v > existing.get("followers_num", 0):
                            existing["followers_num"] = v
                            existing["followers"] = new_record["followers"]

    # Deduplicate by non-empty email
    unique_creators = []
    seen_emails = set()
    for u, rec in creators_by_username.items():
        em = rec.get("email")
        if em:
            if em in seen_emails:
                continue
            seen_emails.add(em)
        unique_creators.append(rec)

    # Sort: records with email first, then by followers_num descending
    unique_creators.sort(key=lambda x: (1 if x.get("email") else 0, x.get("followers_num", 0)), reverse=True)

    print("=" * 75)
    print(f"Total Raw Records Read:    {total_records_read}")
    print(f"Total Unique Creators:     {len(unique_creators)}")
    with_email_count = sum(1 for c in unique_creators if c.get("email"))
    print(f"Creators with Valid Email: {with_email_count}")
    print(f"Creators without Email:    {len(unique_creators) - with_email_count}")
    print("=" * 75)

    # Export to master files
    master_base = "data/creators_master_all"
    export_data(unique_creators, master_base)

    # Also save as data/all_creators_merged.json for direct convenience
    merged_json_path = "data/all_creators_merged.json"
    with open(merged_json_path, "w", encoding="utf-8") as f:
        json.dump(unique_creators, f, indent=2, ensure_ascii=False)
    print(f"[OK] Master Merged JSON saved: {merged_json_path}")

if __name__ == "__main__":
    merge_all_data()
