import sys
import os
import json
import time
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from curl_cffi import requests as cffi_requests
from bs4 import BeautifulSoup
from scrapers.instagram_profile import fetch_instagram_profile
from utils.email_extractor import extract_first_email, extract_phones
from utils.exporter import export_data

sys.stdout.reconfigure(encoding='utf-8')

def extract_email_from_external_url(url: str) -> str:
    """
    If bio has a Linktree, Beacons, Stan Store, or website, fetch it to find the email.
    """
    if not url or not url.startswith("http"):
        return ""
    try:
        # Avoid heavy binary or social profile loops
        if any(skip in url.lower() for skip in ["instagram.com", "tiktok.com", "youtube.com", "facebook.com", "twitter.com", "x.com"]):
            return ""
        
        r = cffi_requests.get(url, impersonate="chrome120", timeout=8)
        if r.status_code == 200:
            em = extract_first_email(r.text)
            if em:
                return em
            # Also check mailto: links
            soup = BeautifulSoup(r.text, "html.parser")
            for a in soup.find_all("a", href=True):
                href = a["href"]
                if href.startswith("mailto:"):
                    clean = href.replace("mailto:", "").split("?")[0].strip().lower()
                    if "@" in clean and "." in clean:
                        return clean
    except Exception:
        pass
    return ""

def enrich_single_creator(creator):
    username = creator.get("username", "").strip()
    if not username:
        return creator

    try:
        prof = fetch_instagram_profile(username)
        if prof and not prof.get("error"):
            bio = prof.get("biography", "")
            email = prof.get("email", "")
            ext_url = prof.get("external_url", "")
            phone = prof.get("phone", "")

            if not email and bio:
                email = extract_first_email(bio)

            # If still no email, check their Linktree / external website
            if not email and ext_url:
                email = extract_email_from_external_url(ext_url)

            if not phone and bio:
                phones = extract_phones(bio)
                if phones:
                    phone = phones[0]

            if email:
                creator["email"] = email.lower().strip()
            if phone:
                creator["phone"] = phone
            if bio:
                creator["biography"] = bio
            if ext_url:
                creator["external_url"] = ext_url
            if prof.get("is_verified"):
                creator["is_verified"] = prof.get("is_verified")
            if prof.get("followers"):
                raw_f = prof.get("followers")
                if isinstance(raw_f, int):
                    creator["followers_num"] = raw_f
    except Exception as e:
        pass

    return creator

def enrich_all_missing_emails():
    master_json_path = "data/all_creators_merged.json"
    if not os.path.exists(master_json_path):
        print(f"[!] File {master_json_path} not found.")
        return

    with open(master_json_path, "r", encoding="utf-8") as f:
        creators = json.load(f)

    total_count = len(creators)
    missing_creators = [c for c in creators if not c.get("email")]
    already_has_email = [c for c in creators if c.get("email")]

    print("=" * 75)
    print(f"STARTING EMAIL ENRICHMENT FOR MISSING CREATORS")
    print(f"Total Creators:             {total_count}")
    print(f"Already with Email:         {len(already_has_email)}")
    print(f"Missing Email (To Enrich):  {len(missing_creators)}")
    print("=" * 75, flush=True)

    enriched_missing = []
    new_emails_found = 0

    # Process in parallel using 8 workers
    with ThreadPoolExecutor(max_workers=8) as executor:
        future_to_creator = {executor.submit(enrich_single_creator, c): c for c in missing_creators}
        
        for idx, future in enumerate(as_completed(future_to_creator), 1):
            updated_c = future.result()
            enriched_missing.append(updated_c)
            
            u = updated_c.get("username", "")
            em = updated_c.get("email", "")
            
            if em:
                new_emails_found += 1
                print(f"[{idx}/{len(missing_creators)}] SUCCESS: @{u} -> Email Found: {em}", flush=True)
            else:
                if idx % 20 == 0 or idx == len(missing_creators):
                    print(f"[{idx}/{len(missing_creators)}] Progressing... ({new_emails_found} new emails found so far)", flush=True)

    # Combine all creators
    all_final = already_has_email + enriched_missing

    # Deduplicate by non-empty email
    seen_emails = set()
    deduped_final = []
    for c in all_final:
        em = c.get("email")
        if em:
            if em in seen_emails:
                continue
            seen_emails.add(em)
        deduped_final.append(c)

    # Sort: with email first, then by followers_num descending
    deduped_final.sort(key=lambda x: (1 if x.get("email") else 0, x.get("followers_num", 0)), reverse=True)

    total_with_email = sum(1 for c in deduped_final if c.get("email"))

    print("\n" + "=" * 75)
    print(f"ENRICHMENT COMPLETED SUMMARY")
    print(f"Total Unique Creators:      {len(deduped_final)}")
    print(f"Total with Valid Email:     {total_with_email} (+{new_emails_found} new emails enriched!)")
    print(f"Still without Email:        {len(deduped_final) - total_with_email} (no email listed in public bio/linktree)")
    print("=" * 75, flush=True)

    # Export to master files
    master_base = "data/creators_master_all"
    export_data(deduped_final, master_base)

    with open(master_json_path, "w", encoding="utf-8") as f:
        json.dump(deduped_final, f, indent=2, ensure_ascii=False)
    print(f"[OK] Master Merged JSON updated: {master_json_path}")

if __name__ == "__main__":
    enrich_all_missing_emails()
