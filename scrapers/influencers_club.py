import time
from curl_cffi import requests as cureq

def query_influencers_club_dashboard(
    auth_token: str,
    platform: str = "instagram",
    location: list[str] = None,
    min_followers: int = 10000,
    max_followers: int = 50000,
    max_creators: int = 100,
    batch_limit: int = 50
) -> list[dict]:
    """Queries Influencers.Club dashboard preview-filter API."""
    if location is None:
        location = ["United States"]
        
    url = "https://api-dashboard.influencers.club/discovery/preview-filter/"
    
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Content-Type": "application/json",
        "Origin": "https://dashboard.influencers.club",
        "Referer": "https://dashboard.influencers.club/",
    }
    
    if not auth_token.startswith("Token ") and not auth_token.startswith("Bearer "):
        headers["Authorization"] = f"Token {auth_token}"
    else:
        headers["Authorization"] = auth_token

    results_all = []
    offset = 0

    print(f"[+] Influencers.Club Query | Platform: {platform} | Location: {location} | Range: {min_followers:,}-{max_followers:,}")

    while len(results_all) < max_creators:
        limit = min(batch_limit, max_creators - len(results_all))
        payload = {
            "discoveryfilters": {
                "type": "",
                "selectedPlatform": platform,
                "location": location,
                "follower_count": {
                    "from": min_followers,
                    "to": max_followers
                }
            },
            "limit": limit,
            "offset": offset,
            "sort_by": "relevancy",
            "exclude_all_lists": True,
            "exclude_all_manual_exported": True,
            "excluded_creators_uids": [],
            "excluded_report_ids": []
        }
        
        try:
            r = cureq.post(url, json=payload, headers=headers, impersonate="chrome124", timeout=20)
            if r.status_code != 200:
                print(f"[-] Status {r.status_code}: {r.text[:200]}")
                break
                
            data = r.json()
            items = data.get("results", [])
            if not items:
                break
                
            for item in items:
                ig_info = item.get("instagram", {})
                urls = []
                for u in item.get("external_urls", []):
                    if isinstance(u, list):
                        urls.extend(u)
                    elif isinstance(u, str):
                        urls.append(u)
                
                results_all.append({
                    "creator_uid": item.get("creator_uid", ""),
                    "full_name": item.get("first_name", "") or ig_info.get("full_name", ""),
                    "location": item.get("location") or ig_info.get("location_unified", ""),
                    "total_reach": item.get("total_reach", 0),
                    "engagement_percent": round(item.get("engagement_percent", 0), 2) if item.get("engagement_percent") else "",
                    "has_email": item.get("has_email", False),
                    "is_verified": item.get("is_verified", False),
                    "instagram_followers": ig_info.get("follower_count", ""),
                    "external_urls": " | ".join(urls),
                    "hashtags": " | ".join(item.get("hashtags", []))
                })
                
            offset += len(items)
            print(f"[*] Fetched {len(results_all)} / {max_creators} creators")
            time.sleep(0.5)
        except Exception as e:
            print(f"[!] Error: {e}")
            break
            
    return results_all
