"""
=============================================================================
AUTOMATED CREATOR OUTREACH RUNNER WITH MULTI-RESEND SENDER ROTATION
=============================================================================
Features:
1. Multi-Resend Account Rotation:
   - Account 1: partnerships@makeable.info
   - Account 2: collab@makeable.online
   - Rotates sender every 5 emails (5 from Account 1, next 5 from Account 2, etc.)
2. Smart Sleep Time (15-30s anti-spam jitter) to maintain high deliverability.
3. Dynamically generates personalized pitch per creator using OpenAI or dynamic templates.
4. Auto-syncs delivery status directly to Supabase table.
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
load_dotenv("frontend/.env.local")

# Sender Accounts
ACCOUNTS = []
if os.environ.get("RESEND_API_KEY"):
    ACCOUNTS.append({
        "name": os.environ.get("SENDER_NAME", "MakeAble Partnerships"),
        "email": os.environ.get("SENDER_EMAIL", "partnerships@makeable.info"),
        "key": os.environ.get("RESEND_API_KEY")
    })

if os.environ.get("RESEND_API_KEY_2"):
    ACCOUNTS.append({
        "name": os.environ.get("SENDER_NAME_2") or os.environ.get("SENDER_NAME", "MakeAble Partnerships"),
        "email": os.environ.get("SENDER_EMAIL_2", "collab@makeable.online"),
        "key": os.environ.get("RESEND_API_KEY_2")
    })

if os.environ.get("RESEND_API_KEY_3"):
    ACCOUNTS.append({
        "name": os.environ.get("SENDER_NAME_3") or os.environ.get("SENDER_NAME", "MakeAble Partnerships"),
        "email": os.environ.get("SENDER_EMAIL_3", "support@makeable.website"),
        "key": os.environ.get("RESEND_API_KEY_3")
    })

OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
REPLY_TO = os.environ.get("REPLY_TO_EMAIL", "support@makeable.nyc")
SUPABASE_URL = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY") or os.environ.get("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY")

MIN_SLEEP_SECONDS = 15
MAX_SLEEP_SECONDS = 30
ROTATION_INTERVAL = 5  # 5 emails per sender domain

def get_sender_for_index(index: int, mode: str = "rotate", custom_email: str = None) -> dict:
    if custom_email:
        matched = next((a for a in ACCOUNTS if custom_email.split('@')[-1] in a['email']), None)
        key = matched['key'] if matched else (ACCOUNTS[0]['key'] if ACCOUNTS else "")
        return {"name": "MakeAble Partnerships", "email": custom_email, "key": key}
        
    if not ACCOUNTS:
        return {"name": "MakeAble Partnerships", "email": "partnerships@makeable.info", "key": ""}
        
    if mode == "sender_2" and len(ACCOUNTS) > 1:
        return ACCOUNTS[1]
    if mode == "sender_1":
        return ACCOUNTS[0]
        
    # Rotate every 5 emails
    account_idx = (index // ROTATION_INTERVAL) % len(ACCOUNTS)
    return ACCOUNTS[account_idx]

def generate_pitch(creator: dict, sender_name: str) -> tuple:
    username = creator.get("username", "creator")
    name = creator.get("name") or username
    bio = creator.get("biography", "")
    category = creator.get("category", "Lifestyle")

    clean_name = name.split()[0] if name else username
    bio_hook = f"your focus on {bio[:45]}..." if bio else f"your {category.lower()} content"

    # OpenAI attempt
    if OPENAI_API_KEY and len(OPENAI_API_KEY) > 15 and not OPENAI_API_KEY.startswith("sk-proj-your"):
        try:
            prompt = f"""You are a human Creator Partnerships Lead at "MakeAble" (https://makeable.nyc).
Write an authentic, warm, and bespoke outreach email to Instagram creator @{username} ({name}) inviting them to collaborate.

Bio: "{bio}"
Niche: {category}
Perks: 15% recurring commission, 10% follower discount, 100% free product gifting kit.

Return STRICT JSON: {{"subject": "...", "body": "..."}}"""

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

    subjects = [
        f"Quick question for @{username} + MakeAble creator program ✨",
        f"Loved your post @{username}! Affiliate partnership with MakeAble 🤝",
        f"Exclusive creator partner invite for @{username} (15% commission + gifting) 📦",
        f"MakeAble x @{username} — Partner program & free product package for you"
    ]

    body = f"""Hey {clean_name},

I hope you're having a wonderful week!

I came across your Instagram profile (@{username}) and wanted to reach out because our team loves {bio_hook}. The aesthetic and community you've built in the {category} space is super inspiring.

I'm reaching out from MakeAble (https://makeable.nyc). We're onboarding a curated group of creators into our **Exclusive Affiliate Partner Program** and think you'd be an ideal fit!

Here are the perks:
• 💰 **15% Commission**: You'll earn 15% on every product sold through your personalized link/code.
• 🎁 **10% Buyer Discount**: An exclusive discount code for your followers so your community saves money on every purchase.
• 📦 **Complimentary Product Box**: We'll ship you a free gifting package right away to test and review.

Would you be open to partnering with us? If so, simply reply with your shipping address and we'll get your gifting kit and affiliate portal activated immediately!

Best regards,
{sender_name}
MakeAble Partnerships • https://makeable.nyc"""

    hash_val = sum(ord(c) for c in username)
    return subjects[hash_val % len(subjects)], body

def send_email_resend(account: dict, to_email: str, subject: str, body: str) -> bool:
    html_body = "".join([
        f"<p style='margin-bottom: 14px; line-height: 1.6; font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif; color: #1e293b;'>{p.replace(chr(10), '<br/>')}</p>" 
        for p in body.split("\n\n")
    ])

    try:
        res = requests.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {account['key']}", "Content-Type": "application/json"},
            json={
                "from": f"{account['name']} <{account['email']}>",
                "to": [to_email],
                "reply_to": REPLY_TO,
                "subject": subject,
                "html": html_body,
                "text": body
            },
            timeout=25
        )
        return res.status_code in [200, 201]
    except Exception as e:
        print(f"    [!] Dispatch error: {e}")
        return False

def run_automated_outreach(limit: int = 10, dry_run: bool = False, mode: str = "rotate", custom_email: str = None):
    print("=" * 75)
    print("⚡ AUTOMATED OUTREACH ENGINE WITH 5-EMAIL SENDER ROTATION")
    print("=" * 75)
    print(f"[*] Configured Senders: {len(ACCOUNTS)}")
    for i, a in enumerate(ACCOUNTS, 1):
        print(f"    Account {i}: {a['name']} <{a['email']}>")
    print(f"[*] Sender Mode: {mode} (5 emails per domain)")
    print(f"[*] Daily Limit: {limit} emails")
    print(f"[*] Sleep Time: {MIN_SLEEP_SECONDS}s - {MAX_SLEEP_SECONDS}s (Random Anti-Spam Jitter)")
    print(f"[*] Mode: {'DRY RUN (Preview Only)' if dry_run else 'LIVE DISPATCH'}")
    print("-" * 75)

    # Fetch pending from Supabase
    creators = []
    if SUPABASE_URL and SUPABASE_KEY:
        try:
            r = requests.get(
                f"{SUPABASE_URL}/rest/v1/creators?select=*&email_status=neq.sent&limit={limit}",
                headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"},
                timeout=15
            )
            if r.status_code == 200:
                creators = [c for c in r.json() if c.get("email") and "@" in c.get("email")]
        except Exception as e:
            print(f"[!] Supabase fetch warning: {e}")

    if not creators and os.path.exists("data/all_creators_merged.json"):
        with open("data/all_creators_merged.json", "r", encoding="utf-8") as f:
            all_c = json.load(f)
            creators = [c for c in all_c if c.get("email") and c.get("email_status") != "sent"][:limit]

    print(f"[*] Loaded {len(creators)} pending creators ready for outreach.")
    if not creators:
        print("[✓] All creators have already been emailed!")
        return

    sent_count = 0

    for i, creator in enumerate(creators):
        sender = get_sender_for_index(i, mode=mode, custom_email=custom_email)
        username = creator.get("username")
        email = creator.get("email")
        followers = creator.get("followers", "N/A")

        print(f"\n[{i + 1}/{len(creators)}] @{username} ({followers}) -> {email} | via [{sender['email']}]")

        subject, body = generate_pitch(creator, sender["name"])

        if dry_run:
            print(f"  [DRY RUN] Generated pitch for {email} via {sender['email']}")
            sent_count += 1
        else:
            success = send_email_resend(sender, email, subject, body)
            if success:
                print(f"  [✓ SUCCESS] Delivered to {email} from {sender['email']}")
                sent_count += 1
                
                # Update Supabase
                if SUPABASE_URL and SUPABASE_KEY:
                    try:
                        requests.patch(
                            f"{SUPABASE_URL}/rest/v1/creators?username=eq.{username}",
                            headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}", "Content-Type": "application/json"},
                            json={
                                "email_status": "sent",
                                "last_emailed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                                "email_subject": subject,
                                "email_body": body
                            },
                            timeout=10
                        )
                    except:
                        pass
            else:
                print(f"  [✗ FAILED] Could not deliver to {email}")

        if i < len(creators) - 1:
            sleep_duration = random.randint(MIN_SLEEP_SECONDS, MAX_SLEEP_SECONDS)
            print(f"  [SLEEP] Waiting {sleep_duration}s (anti-spam jitter)...")
            time.sleep(sleep_duration)

    print("=" * 75)
    print(f"🏁 COMPLETED: Dispatched {sent_count} / {len(creators)} outreach emails.")
    print("=" * 75)

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Multi-account automated outreach engine")
    parser.add_argument("--limit", type=int, default=10, help="Number of emails to send")
    parser.add_argument("--dry-run", action="store_true", help="Simulate without network send")
    parser.add_argument("--mode", type=str, default="rotate", choices=["rotate", "sender_1", "sender_2", "custom"])
    parser.add_argument("--custom-email", type=str, default=None, help="Custom from email")
    args = parser.parse_args()

    run_automated_outreach(limit=args.limit, dry_run=args.dry_run, mode=args.mode, custom_email=args.custom_email)
