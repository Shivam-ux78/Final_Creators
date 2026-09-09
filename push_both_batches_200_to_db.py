import os
import sys
import json
import requests
import pandas as pd
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

batch1_path = os.path.join("data", "extracted_100_couples_100k_300k_usa.json")
batch2_path = os.path.join("data", "extracted_100_new_couples_100k_400k_usa.json")

batch1 = json.load(open(batch1_path, "r", encoding="utf-8")) if os.path.exists(batch1_path) else []
batch2 = json.load(open(batch2_path, "r", encoding="utf-8")) if os.path.exists(batch2_path) else []

print("=" * 70)
print("🚀 VALIDATING & PUSHING BOTH BATCHES (200 USA COUPLE CREATORS) TO DB")
print("=" * 70)
print(f"[*] Batch 1 Count: {len(batch1)}")
print(f"[*] Batch 2 Count: {len(batch2)}")

# Deduplicate across both batches
seen_usernames = set()
clean_records = []
duplicates_found = 0

for c in batch1 + batch2:
    u = str(c.get("username", "")).strip().lower().lstrip("@")
    if not u:
        continue
    if u in seen_usernames:
        duplicates_found += 1
        continue
    seen_usernames.add(u)
    
    clean_records.append({
        "username": u,
        "name": c.get("name", "").strip() or u,
        "email": c.get("email", "").strip(),
        "phone": c.get("phone", "") or "",
        "followers": str(c.get("followers", "0")),
        "followers_num": int(c.get("followers_num", 0) or 0),
        "category": c.get("category", "Couples & Family"),
        "location": c.get("location", "USA"),
        "biography": c.get("biography", "") or "",
        "instagram_url": c.get("instagram_url", f"https://www.instagram.com/{u}"),
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

print(f"[*] Total Unique Creators To Push: {len(clean_records)}")
print(f"[*] Internal Duplicates Filtered: {duplicates_found}")
print("-" * 70)

# Save unified 200 files
unified_json = os.path.join("data", "extracted_200_couples_100k_400k_usa.json")
unified_csv = os.path.join("data", "extracted_200_couples_100k_400k_usa.csv")
unified_xlsx = os.path.join("data", "extracted_200_couples_100k_400k_usa.xlsx")

with open(unified_json, "w", encoding="utf-8") as f:
    json.dump(clean_records, f, indent=2, ensure_ascii=False)

df = pd.DataFrame(clean_records)
df.to_csv(unified_csv, index=False)
df.to_excel(unified_xlsx, index=False)
print(f"[✓] Saved unified dataset of {len(clean_records)} creators to:")
print(f"    - {unified_json}")
print(f"    - {unified_csv}")
print(f"    - {unified_xlsx}")
print("-" * 70)

# Push to Supabase with on_conflict upsert
endpoint = f"{SUPABASE_URL}/rest/v1/{TABLE_NAME}?on_conflict=username"
headers = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=representation,resolution=merge-duplicates"
}

BATCH_SIZE = 50
uploaded = 0

for i in range(0, len(clean_records), BATCH_SIZE):
    batch = clean_records[i:i + BATCH_SIZE]
    upload_res = requests.post(endpoint, headers=headers, json=batch, timeout=30)
    if upload_res.status_code in [200, 201]:
        uploaded += len(batch)
        print(f"  [✓] Upserted batch {i + 1} - {min(i + BATCH_SIZE, len(clean_records))} / {len(clean_records)} creators")
    else:
        print(f"  [!] Batch upload error: {upload_res.status_code} - {upload_res.text[:300]}")

# Get new total database count
total_in_db = "?"
try:
    count_res = requests.get(
        f"{SUPABASE_URL}/rest/v1/{TABLE_NAME}?select=id",
        headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}", "Range": "0-0", "Prefer": "count=exact"},
        timeout=10
    )
    crange = count_res.headers.get("Content-Range", "")
    if "/" in crange:
        total_in_db = crange.split("/")[-1]
except Exception as e:
    pass

print("=" * 70)
print(f"🎉 SUCCESS: {uploaded} / {len(clean_records)} Couple Creators confirmed in Supabase!")
print(f"📊 Total creators now live in Supabase: {total_in_db}")
print("=" * 70)
