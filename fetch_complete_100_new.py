import os
import sys
import re
import json
import time
from bs4 import BeautifulSoup
from curl_cffi import requests as cureq
from concurrent.futures import ThreadPoolExecutor, as_completed
from dotenv import load_dotenv
import pandas as pd

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

load_dotenv(".env")
load_dotenv("frontend/.env.local")

from config.settings import DEFAULT_HEADERS
from scrapers.collabstr_scraper import parse_collabstr_card
from scrapers.instagram_profile import fetch_instagram_profile
from scrapers.creatordb import lookup_creatordb, extract_from_external_link, clean_email
from utils.strict_verifier import is_strictly_usa, parse_num

MIN_FOLLOWERS = 100000
MAX_FOLLOWERS = 400000
TARGET_COUNT = 100

OUTPUT_JSON = os.path.join("data", "extracted_100_new_couples_100k_400k_usa.json")
OUTPUT_CSV = os.path.join("data", "extracted_100_new_couples_100k_400k_usa.csv")
OUTPUT_XLSX = os.path.join("data", "extracted_100_new_couples_100k_400k_usa.xlsx")

COUPLE_KEYWORDS = [
    "couple", "couples", "husband", "wife", "marriage", "married", 
    "relationship", "dating", "together", "family", "parents", 
    "mom & dad", "mom and dad", "him and her", "partners", "duo",
    "love", "traveling couple", "home & family", "lifestyle & family",
    "travel couple", "couple goals", "living together", "mr & mrs",
    "mom of", "dad of", "raising", "family life", "fiance", "fiancé",
    "our journey", "our story", "two of us", "boyfriend", "girlfriend",
    "mama", "papa", "twins", "toddler", "baby", "mom", "dad", "mother", "father",
    "family vlog", "daily vlog", "our life", "the family", "wife & mom",
    "husband & dad", "family of", "travel family", "adventure couple",
    "home", "homestead", "life with", "adventures of", "we are", "lifestyle",
    "cooking together", "wedding", "engaged", "hubby", "wifey", "creator duo"
]

SEARCH_QUERIES = [
    "couple", "couples", "relationship", "married", "marriage",
    "husband", "wife", "family", "parents", "duo", "together", "dating",
    "lifestyle+couple", "travel+couple", "family+travel", "our+life",
    "california", "florida", "texas", "new+york", "los+angeles", "miami"
]

def get_previous_usernames() -> set:
    prev = set()
    prev_file = os.path.join("data", "extracted_100_couples_100k_300k_usa.json")
    if os.path.exists(prev_file):
        try:
            with open(prev_file, "r", encoding="utf-8") as f:
                for item in json.load(f):
                    u = str(item.get("username", "")).strip().lower().lstrip("@")
                    if u:
                        prev.add(u)
        except Exception:
            pass
    return prev

def is_couple_creator(creator: dict) -> bool:
    full_text = " ".join([
        str(creator.get("name", "")),
        str(creator.get("category", "")),
        str(creator.get("biography", "")),
        str(creator.get("package_offer", "")),
        str(creator.get("username", ""))
    ]).lower()
    return any(k in full_text for k in COUPLE_KEYWORDS)

def enrich_creator(card: dict) -> dict:
    username = card.get("username")
    collabstr_url = card.get("collabstr_url")
    biography = card.get("biography", "")
    external_url = card.get("external_url", "")
    lookup_source = card.get("lookup_source", "")
    email = card.get("email", "")

    if collabstr_url and (not email or not biography):
        try:
            resp = cureq.get(collabstr_url, headers=DEFAULT_HEADERS, impersonate="chrome120", timeout=6)
            if resp.status_code == 200:
                soup = BeautifulSoup(resp.text, "html.parser")
                bio_div = soup.find("div", class_=re.compile(r"bio|description|about", re.I))
                if bio_div and not biography:
                    biography = bio_div.get_text(separator="\n").strip()
                for a in soup.find_all("a", href=True):
                    href = a["href"]
                    if href.startswith("mailto:") and not email:
                        cand = href.replace("mailto:", "").split("?")[0].strip().lower()
                        c_em = clean_email(cand)
                        if c_em:
                            email = c_em
                            lookup_source = "Collabstr Mailto"
                            break
                    elif any(link_kw in href.lower() for link_kw in ["linktr.ee", "beacons.ai", "hoo.be", "stan.store"]) and not external_url:
                        external_url = href
        except Exception:
            pass

    if not email and biography:
        c_em = clean_email(biography)
        if c_em:
            email = c_em
            lookup_source = "Bio Email"

    if not email or not biography or not is_strictly_usa(card.get("location", ""), biography):
        try:
            ig = fetch_instagram_profile(username)
            if ig:
                if not biography and ig.get("biography"):
                    biography = ig.get("biography")
                if not email and ig.get("email"):
                    email = clean_email(ig.get("email"))
                    if email:
                        lookup_source = "Instagram Bio"
                if not card.get("followers_num") and ig.get("followers_count"):
                    card["followers_num"] = ig.get("followers_count")
                    card["followers"] = f"{int(card['followers_num']/1000)}K"
        except Exception:
            pass

    if not email and external_url:
        link_email = extract_from_external_link(external_url)
        if link_email:
            email = clean_email(link_email)
            if email:
                lookup_source = "External Link"

    if not email:
        cdb = lookup_creatordb(username)
        if cdb and cdb.get("email"):
            email = clean_email(cdb["email"])
            if email:
                lookup_source = "CreatorDB"
                if not card.get("followers_num") and cdb.get("followers"):
                    card["followers_num"] = parse_num(cdb["followers"])
                    card["followers"] = f"{int(card['followers_num']/1000)}K"

    card["email"] = email
    card["biography"] = biography
    card["external_url"] = external_url
    card["lookup_source"] = lookup_source
    card["is_verified"] = bool(email)
    card["email_status"] = "not_sent"
    card["category"] = "Couples & Family"
    if not card.get("created_at"):
        card["created_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    
    return card

def scrape_cards_from_page(url: str) -> list[dict]:
    cards = []
    try:
        resp = cureq.get(url, headers=DEFAULT_HEADERS, impersonate="chrome120", timeout=8)
        if resp.status_code == 200:
            soup = BeautifulSoup(resp.text, "html.parser")
            elements = soup.find_all("div", class_=re.compile(r"grid-item|creator-card|influencer-card", re.I))
            for el in elements:
                parsed = parse_collabstr_card(el)
                if parsed and parsed.get("username"):
                    cards.append(parsed)
    except Exception:
        pass
    return cards

def main():
    print("=" * 70)
    print("🚀 EXTRACTING NEW 100 USA COUPLES/LOVE CREATORS (100K-400K)")
    print("=" * 70)
    
    prev_usernames = get_previous_usernames()
    seen = set(prev_usernames)
    collected = []

    # 1. Load initial verified batch from other datasets
    for root, _, files in os.walk("data"):
        for f in files:
            if f.endswith(".json") and f != "extracted_100_couples_100k_300k_usa.json" and f != "extracted_100_new_couples_100k_400k_usa.json":
                try:
                    with open(os.path.join(root, f), "r", encoding="utf-8") as jf:
                        data = json.load(jf)
                        if isinstance(data, list):
                            for item in data:
                                u = str(item.get("username", "")).strip().lower().lstrip("@")
                                if not u or u in seen:
                                    continue
                                f_num = item.get("followers_num") or parse_num(item.get("followers"))
                                email = item.get("email", "")
                                loc = item.get("location", "")
                                bio = item.get("biography", "")
                                
                                if MIN_FOLLOWERS <= f_num <= MAX_FOLLOWERS and email and "@" in email and is_strictly_usa(loc, bio) and is_couple_creator(item):
                                    item["followers_num"] = f_num
                                    item["followers"] = f"{int(f_num/1000)}K"
                                    item["category"] = "Couples & Family"
                                    collected.append(item)
                                    seen.add(u)
                                    if len(collected) >= TARGET_COUNT:
                                        break
                except Exception:
                    pass
        if len(collected) >= TARGET_COUNT:
            break

    print(f"Base candidate pool: {len(collected)} verified creators.")

    # 2. If needed, scrape live pages sequentially until we reach TARGET_COUNT
    if len(collected) < TARGET_COUNT:
        for q in SEARCH_QUERIES:
            if len(collected) >= TARGET_COUNT:
                break
            for page in range(1, 8):
                if len(collected) >= TARGET_COUNT:
                    break
                url = f"https://collabstr.com/influencers?search={q}&location=204821&page={page}"
                cards = scrape_cards_from_page(url)
                for card in cards:
                    u = str(card.get("username", "")).strip().lower().lstrip("@")
                    if not u or u in seen:
                        continue
                    seen.add(u)
                    
                    enriched = enrich_creator(card)
                    em = enriched.get("email", "")
                    f_num = enriched.get("followers_num", 0)
                    loc = enriched.get("location", "")
                    bio = enriched.get("biography", "")
                    
                    if (MIN_FOLLOWERS <= f_num <= MAX_FOLLOWERS) and em and "@" in em and is_strictly_usa(loc, bio) and is_couple_creator(enriched):
                        collected.append(enriched)
                        print(f"✅ [{len(collected)}/{TARGET_COUNT}] Added: @{u} ({enriched.get('followers')}) | {loc} | {em}")
                        if len(collected) >= TARGET_COUNT:
                            break

    final_100 = collected[:TARGET_COUNT]
    with open(OUTPUT_JSON, "w", encoding="utf-8") as jf:
        json.dump(final_100, jf, indent=2, ensure_ascii=False)
        
    df = pd.DataFrame(final_100)
    df.to_csv(OUTPUT_CSV, index=False)
    df.to_excel(OUTPUT_XLSX, index=False)
    
    print("\n" + "=" * 70)
    print(f"✨ COMPLETED: Successfully saved {len(final_100)} new creators!")
    print(f"- {OUTPUT_JSON}")
    print(f"- {OUTPUT_CSV}")
    print(f"- {OUTPUT_XLSX}")
    print("=" * 70)

if __name__ == "__main__":
    main()
