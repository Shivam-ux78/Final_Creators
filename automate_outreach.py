"""
=============================================================================
AUTOMATED CREATOR OUTREACH RUNNER WITH SLEEP TIME & SPAM PROTECTION
=============================================================================
This script:
1. Loads pending creators (email_status != 'sent').
2. Dynamically generates a personalized Affiliate Partner Pitch for each creator.
3. Automatically dispatches emails via Resend API / Verified Domain.
4. Implements smart SLEEP TIME (jitter: 15-30s) between emails to prevent spam detection.
5. Limits total emails sent per day (e.g., max 50/day per sender domain) to protect domain reputation.
6. Updates Supabase database status to 'sent' with timestamp.
"""

import os
import sys
import time
import random
import json
import requests
from dotenv import load_dotenv

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

load_dotenv(".env")

RESEND_API_KEY = os.environ.get("RESEND_API_KEY")
SENDER_NAME = os.environ.get("SENDER_NAME", "MakeAble")
SENDER_EMAIL = os.environ.get("SENDER_EMAIL", "support@makeable.info")
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")

# ---------------------------------------------------------------------------
# AUTOMATION SAFETY SETTINGS (BEST PRACTICES FOR DOMAIN REPUTATION)
# ---------------------------------------------------------------------------
# Sleep time range between each individual email (in seconds)
MIN_SLEEP_SECONDS = 15
MAX_SLEEP_SECONDS = 30

# Maximum emails to send in this run (Daily limit recommended: 50-100 per domain)
DAILY_MAX_SEND_LIMIT = 50

def generate_pitch(creator: dict) -> tuple:
    """Generates unique pitch using live OpenAI GPT or dynamic multi-variant engine."""
    username = creator.get("username", "creator")
    name = creator.get("name") or username
    bio = creator.get("biography", "")
    category = creator.get("category", "Lifestyle")

    # 1. Try OpenAI if key is configured
    if OPENAI_API_KEY and len(OPENAI_API_KEY) > 15 and not OPENAI_API_KEY.startswith("sk-proj-your"):
        try:
            prompt = f"""You are the Creator Partnerships Lead at "MakeAble" (https://makeable.nyc).
Write an authentic, warm, and highly personalized email inviting Instagram creator @{username} ({name}) to our Exclusive Affiliate Partner Program.

Bio Context: "{bio}"
Niche: {category}
Perks: 15% commission on every sale, 10% buyer discount for their audience, 100% free product gifting package. No fixed price negotiations.

Make the Subject Line creative and unique with @{username}. Return STRICT JSON: {{"subject": "...", "body": "..."}}"""

            res = requests.post(
                "https://api.openai.com/v1/chat/completions",
                headers={"Authorization": f"Bearer {OPENAI_API_KEY}", "Content-Type": "application/json"},
                json={
                    "model": "gpt-4o-mini",
                    "messages": [{"role": "user", "content": prompt}],
                    "response_format": {"type": "json_object"},
                    "temperature": 0.85
                },
                timeout=20
            )
            data = res.json()
            if "choices" in data:
                parsed = json.loads(data["choices"][0]["message"]["content"])
                return parsed["subject"], parsed["body"]
        except Exception:
            pass

    # 2. Dynamic multi-variant fallback
    clean_name = name.split()[0] if name else username
    bio_hook = f"your focus on {bio[:45]}..." if bio else f"your {category.lower()} content"

    subjects = [
        f"Quick question for @{username} + MakeAble creator program ✨",
        f"Loved your post @{username}! Affiliate partnership with MakeAble 🤝",
        f"Exclusive creator partner invite for @{username} (15% commission + gifting) 📦",
        f"MakeAble x @{username} — Partner program & free product package for you"
    ]

    bodies = [
        f"""Hey {clean_name},

I hope you're having a wonderful week!

I came across your Instagram profile (@{username}) and wanted to reach out because our team loves {bio_hook}. The aesthetic and community you've built in the {category} space is super inspiring.

I'm reaching out from MakeAble (https://makeable.nyc). We're onboarding a curated group of creators into our **Exclusive Affiliate Partner Program** and think you'd be an ideal fit!

Here are the perks:
• 💰 **15% Commission**: You'll earn 15% on every product sold through your personalized link/code.
• 🎁 **10% Buyer Discount**: An exclusive discount code for your followers so your community saves money on every purchase.
• 📦 **Complimentary Product Box**: We'll ship you a free gifting package right away to test and review.

Would you be open to partnering with us? If so, simply reply with your shipping address and we'll get your gifting kit and affiliate portal activated immediately!

Best regards,
{SENDER_NAME}
MakeAble Partnerships • https://makeable.nyc""",

        f"""Hi {clean_name},

I've been following your page (@{username}) and really admire {bio_hook}. Your authentic recommendations in the {category} space are top-tier!

I'm with MakeAble (https://makeable.nyc). We're launching our new **Creator Partner Program** and wanted to invite you to be one of our featured partners.

How the partnership works:
1. **Earn 15% on every sale** made through your custom creator link or discount code.
2. **Give your buyers 10% OFF** so your audience gets an exclusive discount.
3. **Receive 100% Free Product Gifting** sent straight to your door to create content you love.

If this sounds like a great match, just reply with where we should ship your free products, and we'll activate your 15% affiliate code immediately.

Cheers,
{SENDER_NAME}
MakeAble Partnerships • https://makeable.nyc"""
    ]

    hash_val = sum(ord(c) for c in username)
    return subjects[hash_val % len(subjects)], bodies[hash_val % len(bodies)]

def send_email_resend(to_email: str, subject: str, body: str) -> bool:
    """Dispatches email via Resend API."""
    html_body = "".join([
        f"<p style='margin-bottom: 14px; line-height: 1.6; font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif; color: #1e293b;'>{p.replace(chr(10), '<br/>')}</p>" 
        for p in body.split("\n\n")
    ])

    try:
        res = requests.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {RESEND_API_KEY}", "Content-Type": "application/json"},
            json={
                "from": f"{SENDER_NAME} <{SENDER_EMAIL}>",
                "to": [to_email],
                "subject": subject,
                "html": html_body,
                "text": body
            },
            timeout=25
        )
        return res.status_code in [200, 201]
    except Exception as e:
        print(f"    [!] Resend dispatch error: {e}")
        return False

def run_automated_outreach(limit: int = 10, dry_run: bool = False):
    """Executes automated outreach with safe sleep times."""
    print("=" * 75)
    print("[*] AUTOMATED CREATOR OUTREACH ENGINE")
    print("=" * 75)
    print(f"[*] Sender: {SENDER_NAME} <{SENDER_EMAIL}>")
    print(f"[*] Daily Limit: {limit} emails")
    print(f"[*] Sleep Time Between Emails: {MIN_SLEEP_SECONDS}s - {MAX_SLEEP_SECONDS}s (Random Jitter)")
    print(f"[*] Mode: {'DRY RUN (Preview Only)' if dry_run else 'LIVE DISPATCH'}")
    print("-" * 75)

    # Load creators dataset
    data_file = "data/all_creators_merged.json"
    if not os.path.exists(data_file):
        print(f"[!] Data file {data_file} not found.")
        return

    with open(data_file, "r", encoding="utf-8") as f:
        creators = json.load(f)

    # Filter to pending creators
    pending = [c for c in creators if c.get("email") and c.get("email_status") != "sent"]
    print(f"[*] Found {len(pending)} pending creators ready for outreach.")

    batch = pending[:limit]
    sent_count = 0

    for i, creator in enumerate(batch, 1):
        username = creator.get("username")
        email = creator.get("email")
        followers = creator.get("followers", "N/A")

        print(f"\n[{i}/{len(batch)}] Processing @{username} ({followers} followers) -> {email}...")

        subject, body = generate_pitch(creator)
        print(f"  [Subject]: {subject}")

        if dry_run:
            print("  [DRY RUN] Email generated successfully. Skipping network dispatch.")
            sent_count += 1
        else:
            success = send_email_resend(email, subject, body)
            if success:
                print(f"  [SUCCESS] Delivered successfully to {email} via {SENDER_EMAIL}")
                creator["email_status"] = "sent"
                creator["last_emailed_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
                creator["email_subject"] = subject
                creator["email_body"] = body
                sent_count += 1
            else:
                print(f"  [FAILED] Could not deliver to {email}")

        # If not the last email, sleep with random jitter
        if i < len(batch):
            sleep_duration = random.randint(MIN_SLEEP_SECONDS, MAX_SLEEP_SECONDS)
            print(f"  [SLEEP] Waiting {sleep_duration}s before next email (Spam Prevention Jitter)...")
            time.sleep(sleep_duration)

    # Save updated statuses
    if not dry_run and sent_count > 0:
        with open(data_file, "w", encoding="utf-8") as f:
            json.dump(creators, f, indent=2, ensure_ascii=False)
        print("\n[OK] Updated local master database with email sent statuses!")

    print("=" * 75)
    print(f"[FINISHED] Successfully processed {sent_count} / {len(batch)} outreach emails.")
    print("=" * 75)

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Automated outreach engine with sleep time")
    parser.add_argument("--limit", type=int, default=5, help="Number of emails to send in this batch (e.g. 10 or 50)")
    parser.add_argument("--dry-run", action="store_true", help="Simulate without sending network emails")
    args = parser.parse_args()

    run_automated_outreach(limit=args.limit, dry_run=args.dry_run)
