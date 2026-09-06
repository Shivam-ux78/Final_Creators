import os
import json
from pathlib import Path
from typing import List, Dict, Any, Optional
from dotenv import load_dotenv
from supabase import create_client, Client

# Ensure .env is loaded
load_dotenv()

SUPABASE_URL = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY") or os.environ.get("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY", "")
SUPABASE_TABLE = os.environ.get("SUPABASE_TABLE_NAME", "creators")

def is_supabase_configured() -> bool:
    """Checks if Supabase credentials are provided and not default placeholders."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        return False
    if "your-project-id" in SUPABASE_URL or "your-supabase-" in SUPABASE_KEY:
        return False
    return True

def get_supabase_client() -> Optional[Client]:
    """Initializes and returns a Supabase client."""
    if not is_supabase_configured():
        raise ValueError(
            "Supabase is not configured yet. Please open .env and set valid "
            "SUPABASE_URL and SUPABASE_KEY values from your Supabase dashboard."
        )
    return create_client(SUPABASE_URL, SUPABASE_KEY)

def format_creator_for_db(creator: Dict[str, Any]) -> Dict[str, Any]:
    """Formats and cleans a creator dict for insertion into the Supabase 'creators' table."""
    # Ensure id is omitted or integer if auto-generated
    record = {
        "username": str(creator.get("username", "")).strip().lower().lstrip("@"),
        "name": str(creator.get("name") or creator.get("username", "")).strip(),
        "email": str(creator.get("email", "")).strip().lower(),
        "phone": str(creator.get("phone", "")).strip(),
        "followers": str(creator.get("followers", "")).strip(),
        "followers_num": int(creator.get("followers_num") or 0),
        "category": str(creator.get("category") or "Lifestyle / Content Creator").strip(),
        "location": str(creator.get("location") or "USA").strip(),
        "biography": str(creator.get("biography", "")).strip(),
        "instagram_url": str(creator.get("instagram_url") or f"https://www.instagram.com/{creator.get('username')}").strip(),
        "is_verified": bool(creator.get("is_verified", False)),
        "price": str(creator.get("price", "")).strip(),
        "rating": str(creator.get("rating", "")).strip(),
        "package_offer": str(creator.get("package_offer", "")).strip(),
        "external_url": str(creator.get("external_url", "")).strip(),
        "source": str(creator.get("source", "Verified Public Profile")).strip(),
        "email_status": str(creator.get("email_status", "not_sent")).strip(),
        "last_emailed_at": creator.get("last_emailed_at"),
        "email_subject": str(creator.get("email_subject", "")).strip(),
        "email_body": str(creator.get("email_body", "")).strip(),
        "notes": str(creator.get("notes", "")).strip(),
    }
    return record

def upsert_creators(creators: List[Dict[str, Any]], batch_size: int = 50) -> Dict[str, Any]:
    """
    Upserts a list of creator records into Supabase in batches.
    Updates existing records if username already exists.
    """
    client = get_supabase_client()
    if not client:
        return {"success": False, "error": "Supabase client not initialized."}

    formatted_records = [format_creator_for_db(c) for c in creators if c.get("username") and c.get("email")]
    total = len(formatted_records)
    inserted = 0

    print(f"[*] Starting Supabase upsert for {total} creators into table '{SUPABASE_TABLE}'...")

    for i in range(0, total, batch_size):
        batch = formatted_records[i : i + batch_size]
        try:
            response = client.table(SUPABASE_TABLE).upsert(
                batch,
                on_conflict="username"
            ).execute()
            inserted += len(batch)
            print(f"  [✓] Batch {i//batch_size + 1}: Upserted {len(batch)} creators ({inserted}/{total})")
        except Exception as e:
            err_msg = str(e)
            if "PGRST205" in err_msg or "Could not find the table" in err_msg:
                print(f"\n[!] Table '{SUPABASE_TABLE}' does not exist in your Supabase database yet!")
                print("[*] Please run the SQL script in 'schema.sql' inside your Supabase SQL Editor first:")
                print("    https://supabase.com/dashboard/project/lhaurzgpjiteiwllhwjg/sql/new\n")
                return {"success": False, "error": "Table not created. Run schema.sql in Supabase SQL Editor.", "total_upserted": inserted, "total_records": total}
            print(f"  [!] Error upserting batch {i//batch_size + 1}: {e}")

    return {"success": inserted > 0, "total_upserted": inserted, "total_records": total}

def fetch_creators_from_supabase(limit: int = 1000) -> List[Dict[str, Any]]:
    """Fetches creators stored in Supabase."""
    client = get_supabase_client()
    if not client:
        return []
    try:
        response = client.table(SUPABASE_TABLE).select("*").order("followers_num", desc=True).limit(limit).execute()
        return response.data or []
    except Exception as e:
        print(f"[!] Error fetching from Supabase: {e}")
        return []

def migrate_json_to_supabase(json_path: str = "data/all_creators_merged.json") -> Dict[str, Any]:
    """Reads the JSON dataset and pushes all records to Supabase."""
    if not os.path.exists(json_path):
        return {"success": False, "error": f"JSON file {json_path} not found."}

    with open(json_path, "r", encoding="utf-8") as f:
        creators = json.load(f)

    return upsert_creators(creators)

if __name__ == "__main__":
    if not is_supabase_configured():
        print("[!] Supabase is not configured yet. Please update .env with your SUPABASE_URL and SUPABASE_KEY.")
    else:
        print("[*] Supabase configuration detected. Testing migration...")
        res = migrate_json_to_supabase()
        print("Result:", res)
