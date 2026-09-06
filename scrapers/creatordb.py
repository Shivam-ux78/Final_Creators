import re
import json
import time
from bs4 import BeautifulSoup
from curl_cffi import requests as cureq
from config.settings import DEFAULT_HEADERS
from utils.email_extractor import extract_first_email, extract_phones

EMAIL_REGEX = re.compile(r'[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+')
INVALID_EMAILS = {'example.com', 'domain.com', 'email.com', 'yourdomain.com', 'test.com', 'sentry.io', 'wixpress.com'}

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
    return cand

def lookup_creatordb(username: str) -> dict:
    """
    Look up creator data via CreatorDB public finder endpoint.
    Retrieves verified business email, follower count, engagement rate, and platform links.
    """
    clean_user = username.lower().replace('@', '').strip()
    url = f"https://creatordb.app/api/creator/instagram/{clean_user}"
    headers = {
        **DEFAULT_HEADERS,
        "Referer": "https://creatordb.app/creator/instagram-email-finder/",
        "Origin": "https://creatordb.app"
    }

    try:
        r = cureq.get(url, headers=headers, impersonate="chrome120", timeout=10)
        if r.status_code == 200:
            data = r.json()
            email = clean_email(data.get("email") or data.get("business_email", ""))
            followers = data.get("followers") or data.get("follower_count")
            return {
                "username": clean_user,
                "email": email,
                "followers": followers,
                "name": data.get("name") or data.get("full_name", ""),
                "source": "CreatorDB"
            }
    except Exception as e:
        pass

    return {}

def extract_from_external_link(url: str) -> str:
    """
    Extracts business emails from Linktree, Beacons, Stan.store, or personal websites.
    """
    if not url or not url.startswith("http"):
        return ""
    try:
        if any(skip in url.lower() for skip in ["instagram.com", "tiktok.com", "youtube.com", "facebook.com", "twitter.com", "x.com"]):
            return ""
        
        r = cureq.get(url, headers=DEFAULT_HEADERS, impersonate="chrome120", timeout=8)
        if r.status_code == 200:
            em = extract_first_email(r.text)
            if em:
                return clean_email(em)
            
            soup = BeautifulSoup(r.text, "html.parser")
            for a in soup.find_all("a", href=True):
                href = a["href"]
                if href.startswith("mailto:"):
                    clean = href.replace("mailto:", "").split("?")[0].strip().lower()
                    return clean_email(clean)
    except Exception:
        pass
    return ""
