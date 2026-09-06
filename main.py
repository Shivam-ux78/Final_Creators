import argparse
import sys
import json
import time
from pathlib import Path
from tqdm import tqdm

from config.settings import (
    RAW_DATA_DIR, 
    ENRICHED_DATA_DIR, 
    DEFAULT_CATEGORY, 
    DEFAULT_MIN_FOLLOWERS, 
    DEFAULT_MAX_FOLLOWERS
)
from scrapers.collabstr_scraper import scrape_collabstr
from scrapers.instagram_profile import fetch_instagram_profile
from utils.exporter import export_data
from utils.email_extractor import extract_first_email, extract_phones
from utils.supabase_client import is_supabase_configured, migrate_json_to_supabase, fetch_creators_from_supabase

if sys.platform == 'win32':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except:
        pass

def cmd_discover(args):
    """Scrapes creators matching criteria from Collabstr."""
    print("=" * 60)
    print(" 🎯 STAGE 1: CREATOR DISCOVERY")
    print("=" * 60)
    
    creators = scrape_collabstr(
        category=args.category,
        location_id="204821", # USA
        min_followers=args.min_followers,
        max_followers=args.max_followers,
        max_pages=args.pages
    )
    
    if creators:
        out_file = RAW_DATA_DIR / f"creators_usa_{args.min_followers//1000}k_{args.max_followers//1000}k"
        export_data(creators, out_file)
        print(f"\n[✓] Discovery complete! Total unique creators: {len(creators)}")
    else:
        print("\n[!] No creators found.")

def cmd_check_profile(args):
    """Fetches details for a single Instagram profile."""
    print("=" * 60)
    print(f" 🔍 CHECKING PROFILE: @{args.username}")
    print("=" * 60)
    
    data = fetch_instagram_profile(args.username)
    print(json.dumps(data, indent=2, ensure_ascii=False))

def cmd_enrich(args):
    """Enriches scraped creators by inspecting profiles until target emails are collected."""
    print("=" * 60)
    print(" 📧 STAGE 2: CONTACT & PROFILE ENRICHMENT")
    print("=" * 60)
    
    input_file = RAW_DATA_DIR / "creators_usa_10k_50k.json"
    if not input_file.exists():
        print(f"[!] Input file not found: {input_file}")
        print("    Please run `python main.py discover` first.")
        return
        
    with open(input_file, 'r', encoding='utf-8') as f:
        creators = json.load(f)
        
    target_emails_count = args.target_emails
    max_scan = args.max_scan if args.max_scan > 0 else len(creators)
    
    print(f"[+] Total creators in queue: {len(creators)}")
    print(f"[+] Target emails to collect: {target_emails_count}")
    print(f"[+] Max profiles to scan: {max_scan}\n")
    
    all_enriched = []
    creators_with_email = []
    
    for i, c in enumerate(creators[:max_scan], start=1):
        username = c.get("username")
        ig_data = fetch_instagram_profile(username)
        
        merged = {**c}
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
            
        all_enriched.append(merged)
        
        if email:
            creators_with_email.append(merged)
            print(f"[{len(creators_with_email):02d}/{target_emails_count}] @{username:<22} ✉ {email:<32} 📱 {phone or 'N/A'}")
        else:
            print(f"[-] ({i:03d}/{max_scan}) @{username:<22} (No email in bio)")
            
        if len(creators_with_email) >= target_emails_count:
            print(f"\n[🎯] Goal reached! Successfully collected {len(creators_with_email)} creators with emails.")
            break
            
        time.sleep(0.4)
        
    # Export all enriched
    out_all = ENRICHED_DATA_DIR / "creators_enriched_all"
    export_data(all_enriched, out_all)
    
    # Export only those with emails
    if creators_with_email:
        out_emails = ENRICHED_DATA_DIR / f"creators_with_emails_{len(creators_with_email)}"
        export_data(creators_with_email, out_emails)
        print(f"\n[✓] Saved {len(creators_with_email)} creators with emails to:")
        print(f"    - {out_emails}.xlsx")
        print(f"    - {out_emails}.csv")
        print(f"    - {out_emails}.json")

def cmd_sync_supabase(args):
    """Syncs verified creators dataset to Supabase database."""
    print("=" * 60)
    print(" ⚡ STAGE 3: SUPABASE DATABASE SYNC")
    print("=" * 60)
    
    if not is_supabase_configured():
        print("[!] Error: Supabase credentials are not configured in .env.")
        print("    Please set SUPABASE_URL and SUPABASE_KEY in your .env file.")
        print("    See schema.sql for table definition.")
        return

    json_file = args.file
    print(f"[*] Reading dataset: {json_file}")
    res = migrate_json_to_supabase(json_file)
    if res.get("success"):
        print(f"\n[✓] Successfully synced {res.get('total_upserted')} creators to Supabase table!")
    else:
        print(f"\n[!] Sync error: {res.get('error')}")

def main():
    parser = argparse.ArgumentParser(description="Instagram Creator Discovery & Enrichment Pipeline")
    subparsers = parser.add_subparsers(dest="command", help="Available Commands")
    
    # discover
    p_disc = subparsers.add_parser("discover", help="Discover creators from public marketplace")
    p_disc.add_argument("--category", default=DEFAULT_CATEGORY, help="Creator category (default: Lifestyle)")
    p_disc.add_argument("--min-followers", type=int, default=DEFAULT_MIN_FOLLOWERS, help="Min followers (default: 5000)")
    p_disc.add_argument("--max-followers", type=int, default=DEFAULT_MAX_FOLLOWERS, help="Max followers (default: 50000)")
    p_disc.add_argument("--pages", type=int, default=10, help="Max pages to scrape (default: 10)")
    
    # check-profile
    p_check = subparsers.add_parser("check-profile", help="Check individual Instagram profile")
    p_check.add_argument("--username", required=True, help="Instagram username")
    
    # enrich
    p_enrich = subparsers.add_parser("enrich", help="Enrich scraped creators with bios, emails, and links")
    p_enrich.add_argument("--target-emails", type=int, default=50, help="Target number of creators with emails to collect (default: 50)")
    p_enrich.add_argument("--max-scan", type=int, default=0, help="Maximum profiles to scan (0 for all, default: 0)")
    
    # sync-supabase
    p_sync = subparsers.add_parser("sync-supabase", help="Sync verified creators dataset to Supabase DB")
    p_sync.add_argument("--file", default="data/all_creators_merged.json", help="Path to JSON dataset (default: data/all_creators_merged.json)")

    args = parser.parse_args()
    
    if args.command == "discover":
        cmd_discover(args)
    elif args.command == "check-profile":
        cmd_check_profile(args)
    elif args.command == "enrich":
        cmd_enrich(args)
    elif args.command == "sync-supabase":
        cmd_sync_supabase(args)
    else:
        parser.print_help()

if __name__ == "__main__":
    main()
