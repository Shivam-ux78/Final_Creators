import re
import time
from bs4 import BeautifulSoup
from curl_cffi import requests as cureq
from config.settings import DEFAULT_HEADERS
from utils.proxy_manager import ProxyManager

def parse_collabstr_card(card_element):
    """Parses a single Collabstr creator card into a structured dictionary."""
    a_tag = card_element.find('a', href=True)
    if not a_tag:
        return None
    
    href = a_tag['href']
    slug = href.split('?')[0].strip('/')
    collabstr_url = f"https://collabstr.com{href}"
    instagram_url = f"https://www.instagram.com/{slug}"
    
    texts = [t.strip() for t in card_element.stripped_strings if t.strip()]
    
    ignore_phrases = {
        "top creator",
        "top creators have completed multiple orders and have a high rating from brands.",
        "responds fast",
        "responds to requests faster than most creators.",
        "save",
        "saved"
    }
    clean_texts = [t for t in texts if t.lower() not in ignore_phrases]
    
    followers_str = ""
    followers_num = 0
    name = ""
    rating = ""
    price = ""
    location = ""
    package_offer = ""
    
    for t in clean_texts:
        if re.match(r'^\d+(\.\d+)?k$', t.lower()):
            followers_str = t
            try:
                followers_num = int(float(t.lower().replace('k', '')) * 1000)
            except:
                pass
            break
            
    price_matches = [t for t in clean_texts if t.startswith('$')]
    if price_matches:
        price = price_matches[0]
        
    for t in clean_texts:
        if re.match(r'^\d\.\d$', t):
            rating = t
            break
            
    for t in clean_texts:
        if any(country in t for country in [", US", "United States", "USA", ", CA", ", TX", ", NY", ", FL", ", WA"]):
            location = t
            break
            
    for t in clean_texts:
        if t != followers_str and t != price and t != rating and t != location:
            if not t.startswith('$') and not any(kw in t.lower() for kw in ['post', 'story', 'reel', 'ugc', 'video']):
                name = t
                break
                
    for t in clean_texts:
        if any(kw in t.lower() for kw in ['post', 'story', 'reel', 'package', 'video', 'ugc']):
            package_offer = t
            break
            
    img = card_element.find('img')
    img_src = img.get('src') or img.get('data-src') if img else ''
    
    return {
        'username': slug,
        'name': name or slug,
        'followers': followers_str,
        'followers_num': followers_num,
        'location': location,
        'price': price,
        'rating': rating,
        'package_offer': package_offer,
        'instagram_url': instagram_url,
        'collabstr_url': collabstr_url,
        'profile_image': img_src
    }

def scrape_collabstr(
    category: str = "Family & Children",
    location_id: str = "204821",
    min_followers: int = 10000,
    max_followers: int = 50000,
    max_pages: int = 20,
    proxy_manager: ProxyManager = None
) -> list[dict]:
    """Scrapes creator profiles from Collabstr with pagination and optional proxy rotation."""
    base_url = (
        f"https://collabstr.com/influencers"
        f"?p=instagram&c={category.replace(' ', '+').replace('&', '%26')}"
        f"&loc_ids={location_id}&fmi={min_followers}&fmx={max_followers}"
    )
    
    creators = []
    seen = set()
    
    print(f"[+] Scraping Collabstr | Category: {category} | Followers: {min_followers:,}-{max_followers:,} | Max Pages: {max_pages}")
    
    for page in range(1, max_pages + 1):
        url = f"{base_url}&pg={page}"
        req_kwargs = {
            "impersonate": "chrome120",
            "headers": DEFAULT_HEADERS,
            "timeout": 15
        }
        if proxy_manager and proxy_manager.has_proxies():
            req_kwargs["proxies"] = proxy_manager.get_proxy()
            
        try:
            r = cureq.get(url, **req_kwargs)
            if r.status_code != 200:
                print(f"[-] Page {page} returned status {r.status_code}. Stopping.")
                break
                
            soup = BeautifulSoup(r.text, "html.parser")
            cards = soup.select('.profile-listing-holder')
            if not cards:
                print(f"[*] No cards found on page {page}. Reached end of catalog.")
                break
                
            new_added = 0
            for c in cards:
                data = parse_collabstr_card(c)
                if data and data['username'] not in seen:
                    seen.add(data['username'])
                    creators.append(data)
                    new_added += 1
                    
            print(f"[*] Page {page:02d}: +{new_added} creators (Total Unique: {len(creators)})")
            if new_added == 0:
                break
            time.sleep(0.3)
        except Exception as e:
            print(f"[!] Error on page {page}: {e}")
            time.sleep(1)
            
    return creators
