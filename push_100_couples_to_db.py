import os
import sys
import json
import requests
from dotenv import load_dotenv

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

load_dotenv(".env")
load_dotenv("frontend/.env.local")

SUPABASE_URL = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY") or os.environ.get("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "")
TABLE_NAME = os.environ.get("SUPABASE_TABLE_NAME", "creators")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("[!] SUPABASE_URL and SUPABASE_KEY must be set in .env file.")
    sys.exit(1)

json_path = os.path.join("data", "extracted_100_couples_100k_300k_usa.json")
if not os.path.exists(json_path):
    print(f"[!] File not found: {json_path}")
    sys.exit(1)

with open(json_path, "r", encoding="utf-8") as f:
    creators = json.load(f)

print("=" * 70)
print("🚀 PUSHING 100 COUPLE CREATORS (100K-300K | USA) TO SUPABASE")
print("=" * 70)
print(f"[*] Supabase URL: {SUPABASE_URL}")
print(f"[*] Table: {TABLE_NAME}")
print(f"[*] Creators to push: {len(creators)}")
print("-" * 70)

endpoint = f"{SUPABASE_URL}/rest/v1/{TABLE_NAME}"
headers = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=representation,resolution=merge-duplicates"
}

# Clean and format records
clean_records = []
for c in creators:
    clean_records.append({
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
        "last_emailed_at": c.get("last_emailed_at", None),
        "email_subject": c.get("email_subject", "") or "",
        "email_body": c.get("email_body", "") or ""
    })

BATCH_SIZE = 50
uploaded = 0

for i in range(0, len(clean_records), BATCH_SIZE):
    batch = clean_records[i:i + BATCH_SIZE]
    upload_res = requests.post(endpoint, headers=headers, json=batch, timeout=30)
    if upload_res.status_code in [200, 201]:
        uploaded += len(batch)
        print(f"  [✓] Inserted batch {i + 1} - {min(i + BATCH_SIZE, len(clean_records))} / {len(clean_records)} creators")
    else:
        print(f"  [!] Batch upload error: {upload_res.status_code} - {upload_res.text[:300]}")

# Get new total database count
total_in_db = "?"
try:
    count_res = requests.get(
        f"{endpoint}?select=id",
        headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}", "Range": "0-0", "Prefer": "count=exact"},
        timeout=10
    )
    crange = count_res.headers.get("Content-Range", "")
    if "/" in crange:
        total_in_db = crange.split("/")[-1]
except Exception as e:
    pass

print("=" * 70)
print(f"🎉 SUCCESS: {uploaded} / {len(clean_records)} Couple Creators pushed to Supabase!")
print(f"📊 Total creators now live in Supabase: {total_in_db}")
print("=" * 70)
