import os
import sys
import json
import re
import time
from urllib.parse import quote_plus
from bs4 import BeautifulSoup
from curl_cffi import requests as cureq
from dotenv import load_dotenv

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

load_dotenv("frontend/.env.local")
load_dotenv(".env")

DEFAULT_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

EMAIL_REGEX = re.compile(r'[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+')
INVALID_EMAILS = {'example.com', 'domain.com', 'email.com', 'yourdomain.com', 'test.com', 'sentry.io', 'wixpress.com'}

# List of 50 US states and major abbreviations
US_STATE_CODES = {
    'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
    'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
    'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
    'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
    'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'DC'
}

NON_US_KEYWORDS = ['india', 'brazil', 'brasil', 'uk', 'london', 'canada', 'australia', 'nigeria', 'germany', 'france', 'spain', 'mexico', 'colombia', 'indonesia', 'philippines', 'pakistan']

def clean_email(email_str):
    if not email_str or '@' not in email_str:
        return ""
    matches = EMAIL_REGEX.findall(email_str)
    if not matches:
        return ""
    cand = matches[0].lower().strip('.').strip()
    domain = cand.split('@')[-1]
    if domain in INVALID_EMAILS or len(domain) < 4:
        return ""
    if cand.endswith('.@gmail.com') or cand.endswith('.business@gmail.com'):
        # Only accept if not an artificial pattern
        pass
    return cand

def parse_num(f_str):
    if not f_str:
        return 0
    f = str(f_str).lower().replace(',', '').strip()
    if 'm' in f:
        try: return int(float(f.replace('m', '')) * 1000000)
        except: return 0
    if 'k' in f:
        try: return int(float(f.replace('k', '')) * 1000)
        except: return 0
    try: return int(float(f))
    except: return 0

def is_strictly_usa(location_str, bio_text):
    text = (location_str + " " + bio_text).lower()
    # Check for foreign country signals
    if any(k in text for k in NON_US_KEYWORDS):
        return False
    # Check for US signals
    if any(us_k in text for us_k in ['united states', 'usa', ', us', 'u.s.a.', 'nyc', 'los angeles', 'miami', 'california', 'texas', 'florida']):
        return True
    for code in US_STATE_CODES:
        if f', {code.lower()}' in text or f' {code.lower()} ' in text or f'{code.lower()}, us' in text:
            return True
    return False

def extract_from_external_link(url: str) -> str:
    if not url or not url.startswith("http"):
        return ""
    try:
        if any(skip in url.lower() for skip in ["instagram.com", "tiktok.com", "youtube.com", "facebook.com", "twitter.com", "x.com"]):
            return ""
        r = cureq.get(url, headers=DEFAULT_HEADERS, impersonate="chrome120", timeout=6)
        if r.status_code == 200:
            em = clean_email(r.text)
            if em:
                return em
            soup = BeautifulSoup(r.text, "html.parser")
            for a in soup.find_all("a", href=True):
                href = a["href"]
                if href.startswith("mailto:"):
                    clean = href.replace("mailto:", "").split("?")[0].strip().lower()
                    return clean_email(clean)
    except Exception:
        pass
    return ""

def fetch_instagram_profile(username):
    url = f"https://www.instagram.com/{username}/"
    try:
        r = cureq.get(url, headers=DEFAULT_HEADERS, impersonate="chrome124", timeout=10)
        if r.status_code != 200:
            return None
        soup = BeautifulSoup(r.text, "html.parser")
        
        og_desc = soup.find("meta", property="og:description")
        desc_text = og_desc["content"] if og_desc else ""
        
        followers_str = ""
        followers_num = 0
        m_followers = re.search(r'([\d\.,KMkm]+)\s+Followers', desc_text)
        if m_followers:
            followers_str = m_followers.group(1)
            followers_num = parse_num(followers_str)
            
        full_name = username
        m_name = re.search(r'from\s+(.*?)\s+\(@' + re.escape(username) + r'\)', desc_text, re.IGNORECASE)
        if m_name:
            full_name = m_name.group(1)
            
        biography = ""
        external_url = ""
        for s in soup.find_all("script"):
            if not s.string:
                continue
            bio_match = re.search(r'"biography":"(.*?)"(?:,|\})', s.string)
            if bio_match and not biography:
                try: biography = bio_match.group(1).encode().decode('unicode_escape', errors='ignore')
                except: biography = bio_match.group(1)
            url_match = re.search(r'"external_url":"(.*?)"', s.string)
            if url_match and not external_url:
                try: external_url = url_match.group(1).encode().decode('unicode_escape', errors='ignore')
                except: external_url = url_match.group(1)
                
        email = clean_email(biography)
        if not email and external_url:
            email = extract_from_external_link(external_url)

        return {
            "name": full_name,
            "followers_str": followers_str,
            "followers_num": followers_num,
            "biography": biography,
            "email": email,
            "external_url": external_url
        }
    except Exception:
        return None
