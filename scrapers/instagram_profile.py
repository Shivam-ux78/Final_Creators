import json
import re
from bs4 import BeautifulSoup
from curl_cffi import requests as cureq
from config.settings import DEFAULT_HEADERS
from utils.email_extractor import extract_first_email, extract_phones
from utils.proxy_manager import ProxyManager

def decode_json_escaped_string(s: str) -> str:
    try:
        return json.loads(f'"{s}"')
    except:
        return s

def fetch_instagram_profile(username: str, proxy_manager: ProxyManager = None) -> dict:
    """
    Fetches full public profile details for an Instagram username without requiring any login.
    Extracts: Bio, Email in Bio, Phone in Bio, Followers, Following, Posts, Verified Status, Links.
    """
    url = f"https://www.instagram.com/{username}/"
    req_kwargs = {
        "headers": DEFAULT_HEADERS,
        "impersonate": "chrome124",
        "timeout": 15
    }
    if proxy_manager and proxy_manager.has_proxies():
        req_kwargs["proxies"] = proxy_manager.get_proxy()

    try:
        r = cureq.get(url, **req_kwargs)
        if r.status_code != 200:
            return {"username": username, "error": f"HTTP {r.status_code}"}

        soup = BeautifulSoup(r.text, "html.parser")
        
        # 1. Meta og tags
        og_title = soup.find("meta", property="og:title")
        og_desc = soup.find("meta", property="og:description")
        og_image = soup.find("meta", property="og:image")
        meta_desc = soup.find("meta", attrs={"name": "description"})
        
        desc_text = og_desc["content"] if og_desc else (meta_desc["content"] if meta_desc else "")
        title_text = og_title["content"] if og_title else ""
        
        followers = None
        followees = None
        posts_count = None
        full_name = None
        
        m_followers = re.search(r'([\d\.,KMkm]+)\s+Followers', desc_text)
        if m_followers:
            followers = m_followers.group(1)
            
        m_following = re.search(r'([\d\.,KMkm]+)\s+Following', desc_text)
        if m_following:
            followees = m_following.group(1)
            
        m_posts = re.search(r'([\d\.,KMkm]+)\s+Posts', desc_text)
        if m_posts:
            posts_count = m_posts.group(1)
            
        m_name = re.search(r'from\s+(.*?)\s+\(@' + re.escape(username) + r'\)', desc_text, re.IGNORECASE)
        if m_name:
            full_name = m_name.group(1)
        elif title_text:
            m_name_title = re.search(r'^(.*?)\s+\(@' + re.escape(username) + r'\)', title_text, re.IGNORECASE)
            if m_name_title:
                full_name = m_name_title.group(1)
                
        biography = ""
        is_verified = False
        external_url = ""
        
        for s in soup.find_all("script"):
            if not s.string:
                continue
            bio_match = re.search(r'"biography":"(.*?)"(?:,|\})', s.string)
            if bio_match and not biography:
                biography = decode_json_escaped_string(bio_match.group(1))
                    
            if '"is_verified":true' in s.string:
                is_verified = True
                
            url_match = re.search(r'"external_url":"(.*?)"', s.string)
            if url_match and not external_url:
                external_url = decode_json_escaped_string(url_match.group(1))

        # Extract contact from biography
        bio_email = extract_first_email(biography)
        bio_phones = extract_phones(biography)

        return {
            "username": username,
            "full_name": full_name or username,
            "biography": biography,
            "bio_email": bio_email,
            "bio_phones": " | ".join(bio_phones),
            "followers": followers,
            "followees": followees,
            "posts_count": posts_count,
            "is_verified": is_verified,
            "external_url": external_url,
            "instagram_url": f"https://www.instagram.com/{username}/",
            "profile_image": og_image["content"] if og_image else None
        }
    except Exception as e:
        return {"username": username, "error": str(e)}
