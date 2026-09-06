import os
import sys
import json
import requests
from dotenv import load_dotenv

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

load_dotenv(".env")

SUPABASE_URL = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY") or os.environ.get("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "")
TABLE_NAME = os.environ.get("SUPABASE_TABLE_NAME", "creators")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("[!] SUPABASE_URL and SUPABASE_KEY must be set in .env file.")
    sys.exit(1)

print("=" * 70)
print("SUPABASE DATABASE SEEDING ENGINE")
print("=" * 70)
print(f"[*] Supabase URL: {SUPABASE_URL}")
print(f"[*] Table: {TABLE_NAME}")
print("-" * 70)

# 1. Check if table exists
endpoint = f"{SUPABASE_URL}/rest/v1/{TABLE_NAME}"
headers = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=representation,resolution=merge-duplicates"
}

res = requests.get(f"{endpoint}?select=count", headers=headers)
if res.status_code == 404:
    print("[!] ERROR: Table 'creators' does not exist yet in your Supabase project.")
    print("    Please run the SQL schema in your Supabase SQL Editor:")
    print("    1. Go to https://supabase.com/dashboard/project/lhaurzgpjiteiwllhwjg/sql/new")
    print("    2. Paste the contents of schema.sql and click 'RUN'")
    print("    3. Re-run this script to seed all 292 creators into Supabase!")
    sys.exit(1)

# 2. Load master creators dataset
json_path = os.path.join("data", "all_creators_merged.json")
if not os.path.exists(json_path):
    print(f"[!] File not found: {json_path}")
    sys.exit(1)

with open(json_path, "r", encoding="utf-8") as f:
    creators = json.load(f)

print(f"[*] Loaded {len(creators)} creators from {json_path}. Seeding into Supabase...")

# Clean payload for Supabase insertion
clean_records = []
for c in creators:
    clean_records.append({
        "username": c.get("username", "").strip(),
        "name": c.get("name", "").strip() or c.get("username", "").strip(),
        "email": c.get("email", "").strip(),
        "phone": c.get("phone", "") or "",
        "followers": str(c.get("followers", "0")),
        "followers_num": int(c.get("followers_num", 0) or 0),
        "category": c.get("category", "Lifestyle"),
        "location": c.get("location", "USA"),
        "biography": c.get("biography", "") or "",
        "instagram_url": c.get("instagram_url", f"https://www.instagram.com/{c.get('username', '')}"),
        "is_verified": bool(c.get("is_verified", False)),
        "price": str(c.get("price", "") or ""),
        "rating": str(c.get("rating", "") or ""),
        "package_offer": str(c.get("package_offer", "") or ""),
        "external_url": str(c.get("external_url", "") or ""),
        "email_status": c.get("email_status", "not_sent") or "not_sent",
        "last_emailed_at": c.get("last_emailed_at", None),
        "email_subject": c.get("email_subject", "") or "",
        "email_body": c.get("email_body", "") or ""
    })

# Batch upload in chunks of 50
BATCH_SIZE = 50
uploaded = 0

for i in range(0, len(clean_records), BATCH_SIZE):
    batch = clean_records[i:i + BATCH_SIZE]
    upload_res = requests.post(endpoint, headers=headers, json=batch, timeout=30)
    if upload_res.status_code in [200, 201]:
        uploaded += len(batch)
        print(f"  [✓] Seeded batch {i + 1} - {min(i + BATCH_SIZE, len(clean_records))} / {len(clean_records)} creators")
    else:
        print(f"  [!] Batch upload error: {upload_res.status_code} - {upload_res.text[:200]}")

print("=" * 70)
print(f"🏁 SUPABASE SEEDING COMPLETE: {uploaded} / {len(clean_records)} creators active in Supabase!")
print("=" * 70)
