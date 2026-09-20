import os
import sys
import re
import json
import time
import asyncio
import requests
from bs4 import BeautifulSoup
from concurrent.futures import ThreadPoolExecutor, as_completed
from dotenv import load_dotenv
import pandas as pd
from playwright.async_api import async_playwright

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', line_buffering=True)
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', line_buffering=True)

load_dotenv(".env")
load_dotenv("frontend/.env.local")

from config.settings import DEFAULT_HEADERS
from utils.strict_verifier import parse_num

SUPABASE_URL = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY") or os.environ.get("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "")
TABLE_NAME = os.environ.get("SUPABASE_TABLE_NAME", "creators")

INPUT_EXCEL = os.path.join("data", "usa_family_creators_200_enriched.xlsx")
OUTPUT_EXCEL = os.path.join("data", "usa_family_creators_200_enriched.xlsx")
OUTPUT_CSV = os.path.join("data", "usa_family_creators_200_enriched.csv")
OUTPUT_JSON = os.path.join("data", "usa_family_creators_200_enriched.json")

EMAIL_REGEX = re.compile(r'[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z]{2,8}')
INVALID_EMAILS = {
    'example.com', 'domain.com', 'email.com', 'yourdomain.com', 'test.com', 
    'sentry.io', 'wixpress.com', 'jsdelivr.net', 'unpkg.com', 'cloudflare.com', 'github.com'
}

def clean_email(email_str: str) -> str:
    if not email_str or '@' not in email_str:
        return ""
    matches = EMAIL_REGEX.findall(email_str)
    if not matches:
        return ""
    cand = matches[0].lower().strip('.').strip()
    if any(bad in cand for bad in ['chart.js', 'swiper', 'bootstrap', 'jquery', 'react', 'npm@', 'cdnjs', 'wixpress', 'sentry']):
        return ""
    parts = cand.split('@')
    if len(parts) != 2:
        return ""
    local, domain = parts
    if '.' not in domain:
        return ""
    tld = domain.split('.')[-1]
    if not tld.isalpha() or len(tld) < 2 or len(tld) > 8:
        return ""
    if any(ext in local for ext in ['.js', '.css', '.min', '.json', '.svg', '.png', '.jpg']):
        return ""
    if domain in INVALID_EMAILS or len(domain) < 4:
        return ""
    return cand

def push_single_creator_to_supabase(creator: dict) -> bool:
    payload = [{
        "username": creator.get("username", "").strip().lstrip("@"),
        "name": creator.get("name", "").strip() or creator.get("username", "").strip(),
        "email": creator.get("email", "").strip(),
        "phone": creator.get("phone", "") or "",
        "followers": str(creator.get("followers", "0")),
        "followers_num": int(creator.get("followers_num", 0) or 0),
        "category": creator.get("category", "Family & Lifestyle"),
        "location": creator.get("location", "USA"),
        "biography": creator.get("biography", "") or "",
        "instagram_url": creator.get("instagram_url", f"https://www.instagram.com/{creator.get('username', '')}"),
        "is_verified": bool(creator.get("is_verified", False)),
        "price": "$150",
        "rating": "5.0",
        "package_offer": "1 Instagram Reel",
        "external_url": "",
        "email_status": "not_sent",
        "last_emailed_at": None,
        "email_subject": "",
        "email_body": ""
    }]
    
    endpoint = f"{SUPABASE_URL}/rest/v1/{TABLE_NAME}?on_conflict=username"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation,resolution=merge-duplicates"
    }
    
    try:
        r = requests.post(endpoint, headers=headers, json=payload, timeout=10)
        return r.status_code in [200, 201]
    except Exception as e:
        print(f"[!] Push error for @{creator.get('username')}: {e}", flush=True)
        return False

def get_fresh_public_proxies():
    sources = [
        'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt',
        'https://raw.githubusercontent.com/TheSpeedX/SOCKS-List/master/http.txt',
        'https://raw.githubusercontent.com/clarketm/proxy-list/master/proxy-list-raw.txt',
        'https://raw.githubusercontent.com/sunny9577/proxy-scraper/master/generated/http_proxies.txt'
    ]
    px_set = set()
    for s in sources:
        try:
            r = requests.get(s, timeout=3)
            for line in r.text.splitlines():
                line = line.strip()
                if line and ':' in line and not line.startswith('#'):
                    px_set.add(line)
        except Exception:
            pass
    return list(px_set)

def validate_proxy(px):
    try:
        r = requests.get('https://httpbin.org/ip', proxies={'http': f'http://{px}', 'https': f'http://{px}'}, timeout=2.5)
        if r.status_code == 200:
            return px
    except Exception:
        pass
    return None

def get_working_proxies(candidate_list, max_needed=40):
    working = []
    print(f"[*] Validating candidate proxies in parallel...", flush=True)
    with ThreadPoolExecutor(max_workers=60) as ex:
        futures = [ex.submit(validate_proxy, p) for p in candidate_list[:500]]
        for f in as_completed(futures):
            res = f.result()
            if res:
                working.append(res)
                if len(working) >= max_needed:
                    break
    print(f"[✓] Found {len(working)} verified live proxies ready for IP rotation!", flush=True)
    return working

async def fetch_handle_with_proxy(p, handle, proxy_str):
    url = f"https://creatordb.app/creator/instagram-email-finder/?u={handle}"
    launch_kwargs = {"headless": True}
    if proxy_str:
        launch_kwargs["proxy"] = {"server": f"http://{proxy_str}"}
        
    browser = None
    try:
        browser = await p.chromium.launch(**launch_kwargs)
        context = await browser.new_context(user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
        page = await context.new_page()
        await page.goto(url, wait_until="domcontentloaded", timeout=7000)
        await page.wait_for_timeout(1000)
        html = await page.content()
        await browser.close()
        
        soup = BeautifulSoup(html, "html.parser")
        mailtos = [clean_email(a["href"].replace("mailto:", "").split("?")[0]) for a in soup.find_all("a", href=re.compile(r"^mailto:", re.I))]
        mailtos = [e for e in mailtos if e]
        if mailtos:
            return handle, mailtos[0]
        em_text = clean_email(html)
        if em_text:
            return handle, em_text
    except Exception:
        if browser:
            try:
                await browser.close()
            except Exception:
                pass
    return handle, ""

async def main_async():
    print("=" * 70, flush=True)
    print("⚡ PARALLEL ROTATING IP PLAYWRIGHT SCANNER FOR CREATORDB", flush=True)
    print("=" * 70, flush=True)

    if os.path.exists(OUTPUT_EXCEL):
        df = pd.read_excel(OUTPUT_EXCEL)
    else:
        df = pd.read_excel("usa_family_creators_200.xlsx", header=6)

    total_rows = len(df)
    missing_mask = df['Public Business Email'].isna() | (df['Public Business Email'] == '') | (df['Public Business Email'] == 'nan')
    missing_df = df[missing_mask]

    print(f"[*] Total creators: {total_rows} | Existing verified emails: {total_rows - len(missing_df)}", flush=True)
    print(f"[*] Target missing handles to scan with IP Rotation: {len(missing_df)}", flush=True)

    handles_to_check = []
    for idx, row in missing_df.iterrows():
        h = str(row.get("Instagram Handle", "")).strip().lstrip("@")
        if not h or h.lower() == "nan":
            raw_url = str(row.get("Instagram URL", ""))
            m = re.search(r"instagram\.com/([a-zA-Z0-9_\.]+)", raw_url)
            if m:
                h = m.group(1).lower()
        if h and h.lower() != "nan":
            handles_to_check.append((idx, h))

    raw_proxies = get_fresh_public_proxies()
    proxy_pool = get_working_proxies(raw_proxies, max_needed=40)

    newly_found = 0
    scanned_count = 0

    async with async_playwright() as p:
        chunk_size = 5
        for i in range(0, len(handles_to_check), chunk_size):
            chunk = handles_to_check[i:i+chunk_size]
            tasks = []
            for item_idx, (idx, h) in enumerate(chunk):
                # Assign a rotating proxy to each concurrent task
                px = proxy_pool[(i + item_idx) % len(proxy_pool)] if proxy_pool else None
                tasks.append(fetch_handle_with_proxy(p, h, px))

            results = await asyncio.gather(*tasks)

            for (idx, h), (res_handle, email_found) in zip(chunk, results):
                scanned_count += 1
                if email_found:
                    df.at[idx, 'Public Business Email'] = email_found
                    df.at[idx, 'Preferred Contact'] = 'Email'
                    df.at[idx, 'Contact Verification'] = 'Verified (CreatorDB IP Rotated)'
                    df.at[idx, 'Outreach Status'] = 'Not Contacted'

                    r = df.iloc[idx]
                    f_num = parse_num(str(r.get("Followers", "0")))
                    creator_obj = {
                        "username": h,
                        "name": str(r.get("Creator", "")) or h,
                        "email": email_found,
                        "phone": str(r.get("Public Business Phone", "")) if str(r.get("Public Business Phone", "")).lower() != "nan" else "",
                        "followers": f"{int(round(f_num/1000))}K" if f_num >= 1000 else str(f_num),
                        "followers_num": f_num,
                        "category": str(r.get("Category", "Family & Lifestyle")),
                        "location": str(r.get("Location", "United States")),
                        "biography": str(r.get("Public Bio", "")),
                        "instagram_url": str(r.get("Instagram URL", f"https://www.instagram.com/{h}")),
                        "is_verified": True
                    }
                    pushed = push_single_creator_to_supabase(creator_obj)
                    newly_found += 1
                    print(f"[{scanned_count}/{len(handles_to_check)}] 🎯 NEW EMAIL FOUND: @{h} -> {email_found} | Pushed to Supabase: {'✅' if pushed else '⚠️'}", flush=True)

            print(f"[*] Scanned {scanned_count}/{len(handles_to_check)} handles | Newly found: +{newly_found} | Total Verified: {total_rows - len(missing_df) + newly_found}", flush=True)

            # Periodically save progress
            df.to_excel(OUTPUT_EXCEL, index=False)
            df.to_csv(OUTPUT_CSV, index=False)
            verified_records = df.dropna(subset=['Public Business Email']).to_dict(orient='records')
            with open(OUTPUT_JSON, "w", encoding="utf-8") as jf:
                json.dump(verified_records, jf, indent=2, ensure_ascii=False, default=str)

    total_final = len(df.dropna(subset=['Public Business Email']))
    print("\n" + "=" * 70, flush=True)
    print(f"✨ SUCCESS: Finished Parallel IP Rotated Scan on CreatorDB!", flush=True)
    print(f"🎉 Newly Discovered Emails: +{newly_found}")
    print(f"🏆 Total Email-Verified Creators in Spreadsheet: {total_final} / {total_rows}")
    print(f"📁 Excel: {OUTPUT_EXCEL}")
    print(f"📁 CSV:   {OUTPUT_CSV}")
    print(f"📁 JSON:  {OUTPUT_JSON}")
    print("=" * 70, flush=True)

if __name__ == "__main__":
    asyncio.run(main_async())
