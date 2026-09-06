import os
from pathlib import Path
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent

# Load environment variables from .env file
load_dotenv(BASE_DIR / ".env")

DATA_DIR = BASE_DIR / "data"
RAW_DATA_DIR = DATA_DIR / "raw"
ENRICHED_DATA_DIR = DATA_DIR / "enriched"

# Supabase Configurations
SUPABASE_URL = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY") or os.environ.get("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY", "")
SUPABASE_TABLE_NAME = os.environ.get("SUPABASE_TABLE_NAME", "creators")

# Default Scraping Parameters
DEFAULT_PLATFORM = "instagram"
DEFAULT_CATEGORY = "Lifestyle"
DEFAULT_LOCATION_ID = os.environ.get("DEFAULT_LOCATION_ID", "204821")  # United States on Collabstr
DEFAULT_MIN_FOLLOWERS = int(os.environ.get("DEFAULT_MIN_FOLLOWERS", 5000))
DEFAULT_MAX_FOLLOWERS = int(os.environ.get("DEFAULT_MAX_FOLLOWERS", 50000))

# Browser Headers for Scraping
DEFAULT_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

# Influencers Club Dashboard API Auth Token (Optional)
INFLUENCERS_CLUB_TOKEN = os.environ.get("INFLUENCERS_CLUB_TOKEN", "")
