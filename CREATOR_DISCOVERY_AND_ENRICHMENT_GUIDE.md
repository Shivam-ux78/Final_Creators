# Instagram Creator Discovery & Profile Enrichment Guide

This document outlines the complete workflow, best sources to collect Instagram user lists (filtered by 10k–50k followers and USA location), and methods to enrich profiles with email, phone numbers, and engagement stats.

---

## 1. Summary of Ready-to-Use Files in Workspace

| File | Description | Status |
| :--- | :--- | :--- |
| [`creators_usa_10k_50k.csv`](file:///d:/Shivam/Final_Creators/creators_usa_10k_50k.csv) | **460 Vetted US Creators** (10k–50k followers, rates, city/state, handles) | **Ready** |
| [`creators_usa_10k_50k.xlsx`](file:///d:/Shivam/Final_Creators/creators_usa_10k_50k.xlsx) | Excel Spreadsheet formatted with all creator columns | **Ready** |
| [`creators_usa_10k_50k.json`](file:///d:/Shivam/Final_Creators/creators_usa_10k_50k.json) | Clean structured JSON records for developer pipelines | **Ready** |
| [`extract_creators.py`](file:///d:/Shivam/Final_Creators/extract_creators.py) | Standalone Python scraper for Collabstr (public, no auth needed) | **Ready** |
| [`fetch_ig_profile.py`](file:///d:/Shivam/Final_Creators/fetch_ig_profile.py) | Instagram profile parser (bio, email in bio, followers, posts, verification) | **Ready** |
| [`influencers_club_api.py`](file:///d:/Shivam/Final_Creators/influencers_club_api.py) | Influencers.Club dashboard API client (over 1M+ database records) | **Ready** |

---

## 2. Top Sources to Collect Instagram Creator Lists

### A. Collabstr (Recommended - Public & Free)
- **Website**: `https://collabstr.com/influencers`
- **Why it is best**:
  - 100% public directory (No login, API keys, or captchas required).
  - Exact filters: Platform (Instagram), Category (Family & Children, Lifestyle, Beauty, etc.), Location (USA), Follower Range (10,000 to 50,000).
  - Gives verified usernames, full names, cities/states in USA, pricing packages ($), and ratings.
- **How to scrape**:
  ```bash
  python extract_creators.py
  ```

---

### B. Influencers.Club Dashboard (`api-dashboard.influencers.club`)
- **Website**: `https://dashboard.influencers.club`
- **Why it is powerful**:
  - Huge database of **1,069,978+ US Instagram creators**.
  - Provides cross-platform statistics (TikTok follower count, YouTube subscribers).
  - Identifies if creator has email (`has_email: true`) and lists Linktree/website URLs.
- **How to use**:
  Pass your session `Token <YOUR_TOKEN>` from DevTools into [`influencers_club_api.py`](file:///d:/Shivam/Final_Creators/influencers_club_api.py).

---

### C. CreatorDB (`https://creatordb.app/creator/instagram-email-finder/`)
- **Website**: CreatorDB Email Finder
- **Usage**:
  - Used for individual creator lookups to uncover business emails and phone numbers.
  - Supports rotating proxies / IP rotation for automated high-volume lookups.

---

## 3. Profile Inspection & Detail Extraction Methods

```
+---------------------------+       +-------------------------------+       +-------------------------------+
|  1. Collect Usernames     | ----> | 2. Instagram Profile Parser   | ----> | 3. Contact & Email Enrichment |
|  - Collabstr              |       | - Bio text & email in bio     |       | - CreatorDB Lookup            |
|  - Influencers.Club       |       | - Followers & Following count |       | - Linktree / Website scraping |
|  - Hashtag / Location     |       | - Verification & external link|       | - Export to Master CRM (CSV)  |
+---------------------------+       +-------------------------------+       +-------------------------------+
```

---

### Method 1: Automated Profile Inspector (No Login Required)
Uses browser TLS fingerprint impersonation (`curl_cffi` + `BeautifulSoup`) to extract:
- **`username`**: Instagram handle
- **`full_name`**: Creator real name
- **`biography`**: Bio description (including emails, emojis, and location text)
- **`followers`** & **`followees`**: Follower / Following count
- **`is_verified`**: Meta verification badge (`True` / `False`)
- **`external_url`**: Link in bio (Linktree, Beacons, website)

**Code Example (`fetch_ig_profile.py`)**:
```python
from fetch_ig_profile import parse_instagram_profile

profile = parse_instagram_profile("thatgirlcosplays")
print(profile)
```

**Output**:
```json
{
  "username": "thatgirlcosplays",
  "full_name": "Raleigh Hinton",
  "biography": "I’m THAT girl😜\nwith a cosplaying hobby! ✨\n-\n📧: ThatGirlCosplayss@gmail.com\nGA. 🇺🇸",
  "followers": "12K",
  "followees": "1,079",
  "posts_count": "245",
  "is_verified": true,
  "external_url": ""
}
```

---

### Method 2: Instaloader (When Account Session is Available)
- **Anonymous**: Blocks with `HTTP 429 Too Many Requests`.
- **Logged in**: Works via `L.login()` or `L.load_session_from_file()`.

```python
import instaloader

L = instaloader.Instaloader()
# L.login("your_ig_username", "your_ig_password")

profile = instaloader.Profile.from_username(L.context, "thatgirlcosplays")
print(profile.username, profile.followers, profile.biography)
```

---

## 4. End-to-End Extraction Pipeline

1. **Generate Creator List**: Run `extract_creators.py` to get 10k–50k US creator usernames.
2. **Scan Profiles for Bio Emails**: Run `fetch_ig_profile.py` in batch across the usernames.
3. **Lookup Remaining Emails**: Send usernames without bio emails to CreatorDB via IP rotation.
4. **Final Export**: Consolidate all records into a single master Excel/CSV file with:
   - Username
   - Name
   - Followers
   - Email
   - Phone
   - Location
   - Price / Rate
   - External Links (Linktree / Website)
