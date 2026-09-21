"""
=============================================================================
AUTOMATED CREATOR OUTREACH ENGINE WITH 3-DOMAIN ROTATION & WARMUP BATCHING
=============================================================================
Rules & Configuration:
1. Sender Accounts (Paid Resend Key 2: RESEND_API_KEY_2):
   - Domain 1: MakeAble Partnerships <collab@makeable.work>
   - Domain 2: MakeAble Partnerships <collab@makeable.website>
   - Domain 3: MakeAble Partnerships <collab@makeable.online>
   - Reply-To: support@makeable.nyc (ALWAYS)
   - Excluded: .nyc and .info are NOT used as sender addresses.

2. Round-Robin Sequence & Delays:
   - 1 email from .work -> 1 from .website -> 1 from .online -> repeat.
   - Inter-email Delay: 30 seconds between every email.

3. Batching & Cooldown:
   - Batch size: 5 emails per domain (15 emails total per batch).
   - After each batch of 15 emails is sent, sleep for 30 MINUTES (1800s) before starting the next batch.

4. Daily Warmup Schedule:
   - Day 1: 30 emails per domain (90 total / day)
   - Day 2: 31 emails per domain (93 total / day)
   - Daily Increment: +1 email per domain per day.
   - Max Cap: 50 emails per domain (150 total / day).

5. Auto-Resume & Manual Stop Controls:
   - Automatic Pause (Limit Hit): When daily limit is hit, sleeps until Midnight (00:00), then auto-resumes with limit + 1.
   - Manual Web UI Stop: If stopped via button, stays STOPPED permanently (no auto-start at midnight).
"""

import os
import sys
import time
import random
import json
import datetime
import requests
from dotenv import load_dotenv

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

load_dotenv(".env")
load_dotenv("frontend/.env.local")

RESEND_KEY = os.environ.get("RESEND_API_KEY_2")

# 3 Target Domains (NO .nyc, NO .info)
ACCOUNTS = [
    {
        "name": "MakeAble Partnerships",
        "email": "collab@makeable.work",
        "domain": "makeable.work",
        "key": RESEND_KEY
    },
    {
        "name": "MakeAble Partnerships",
        "email": "collab@makeable.website",
        "domain": "makeable.website",
        "key": RESEND_KEY
    },
    {
        "name": "MakeAble Partnerships",
        "email": "collab@makeable.online",
        "domain": "makeable.online",
        "key": RESEND_KEY
    }
]

REPLY_TO = "support@makeable.nyc"
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
SUPABASE_URL = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY") or os.environ.get("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY")

STATE_FILE = os.path.join("data", "outreach_state.json")
INTER_EMAIL_DELAY = 30  # 30 seconds between emails
EMAILS_PER_DOMAIN_PER_BATCH = 5
BATCH_COOLDOWN_SECONDS = 1800  # 30 minutes sleep after batch
INITIAL_DAILY_LIMIT_PER_DOMAIN = 30
MAX_DAILY_LIMIT_PER_DOMAIN = 50

def load_outreach_state() -> dict:
    if os.path.exists(STATE_FILE):
        try:
            with open(STATE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {
        "manual_stop": False,
        "current_day_limit_per_domain": INITIAL_DAILY_LIMIT_PER_DOMAIN,
        "last_reset_date": datetime.date.today().isoformat(),
        "today_sent_per_domain": {a["email"]: 0 for a in ACCOUNTS},
        "total_sent_all_time": 0,
        "is_running": False
    }

def save_outreach_state(state: dict):
    os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
    state["last_updated_at"] = datetime.datetime.now().isoformat()
    with open(STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2)

def get_daily_limit_info() -> tuple:
    start_date = datetime.date(2026, 9, 20)
    today = datetime.date.today()
    days_elapsed = max(0, (today - start_date).days)
    limit_per_domain = min(30 + days_elapsed, 50)
    total_daily_limit = limit_per_domain * len(ACCOUNTS)
    return limit_per_domain, total_daily_limit

def get_today_sent_count_supabase() -> int:
    if not SUPABASE_URL or not SUPABASE_KEY:
        return 0
    try:
        today_start_utc = datetime.datetime.utcnow().strftime("%Y-%m-%dT00:00:00.000Z")
        r = requests.get(
            f"{SUPABASE_URL}/rest/v1/creators?select=id&email_status=eq.sent&last_emailed_at=gte.{today_start_utc}",
            headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"},
            timeout=10
        )
        if r.status_code == 200:
            data = r.json()
            return len(data) if isinstance(data, list) else 0
    except Exception as e:
        print(f"[!] Error fetching today sent count from Supabase: {e}", flush=True)
    return 0

def generate_pitch(creator: dict, sender_name: str) -> tuple:
    username = creator.get("username", "creator")
    name = creator.get("name") or username
    bio = creator.get("biography", "")
    category = creator.get("category", "Lifestyle")

    clean_name = name.split()[0] if name else username
    bio_hook = f"your focus on {bio[:45]}..." if bio else f"your {category.lower()} content"

    # OpenAI GPT-4o-mini generation
    if OPENAI_API_KEY and len(OPENAI_API_KEY) > 15 and not OPENAI_API_KEY.startswith("sk-proj-your"):
        try:
            prompt = f"""You are a Creator Partnerships Manager at "MakeAble" (https://makeable.nyc).
Write an authentic, personalized outreach email to Instagram creator @{username} ({name}).

Creator Bio: "{bio}"
Niche: {category}

IMPORTANT REQUIREMENTS:
You MUST offer BOTH options clearly to the creator:
1. Paid Sponsorship / Collaboration (Based on their media kit, CPM, and rate sheet — ask them to send their rate card or apply online!).
2. Affiliate Partnership (15% recurring commission + 10% follower discount code + Complimentary Gifted Product Box).

Call to Action / Next Steps:
Ask them to reply directly to this email with their media kit / shipping address OR apply directly at https://makeable.nyc/creators/apply.

Keep the email warm, professional, concise, and structured cleanly.
Return STRICT JSON format: {{"subject": "...", "body": "..."}}"""

            res = requests.post(
                "https://api.openai.com/v1/chat/completions",
                headers={"Authorization": f"Bearer {OPENAI_API_KEY}", "Content-Type": "application/json"},
                json={
                    "model": "gpt-4o-mini",
                    "messages": [{"role": "user", "content": prompt}],
                    "response_format": {"type": "json_object"},
                    "temperature": 0.8
                },
                timeout=20
            )
            data = res.json()
            if "choices" in data:
                parsed = json.loads(data["choices"][0]["message"]["content"])
                return parsed["subject"], parsed["body"]
        except Exception as e:
            pass

    # Default High-Converting Fallback Pitch with BOTH Paid Collab & Affiliate Options
    subjects = [
        f"Paid Collab + Partnership Invite for @{username} ✨",
        f"MakeAble x @{username} — Sponsored Post & Affiliate Partner Options 🤝",
        f"Collaboration Offer for @{username} (Paid Sponsored Post or Affiliate + Free Gifting Kit) 📦",
        f"Quick question for @{username} — MakeAble creator collaboration"
    ]

    body = f"""Hey {clean_name},

I hope you're having a great week!

I came across your Instagram profile (@{username}) and our team really loves {bio_hook}. The aesthetic and engagement you've cultivated in the {category} space is amazing.

I'm reaching out from MakeAble (https://makeable.nyc). We're expanding our creator network and would love to partner with you! We offer two flexible collaboration paths so you can choose what works best for you:

💰 **Option 1: Paid Sponsored Campaign**
• We offer competitive CPM & rate-sheet fees for sponsored Reel/Post campaigns (reply with your media kit & rate sheet!).

🛍️ **Option 2: Affiliate Partner & Free Product Box**
• **15% Recurring Commission** on all sales via your personal link/code.
• **10% Follower Discount Code** to boost conversion for your audience.
• **Complimentary Product Box** shipped to your door to review and keep.

Would you be open to collaborating with MakeAble?

📩 **How to Get Started:**
• Reply directly to this email with your media kit / rate sheet (or shipping address), OR
• Apply instantly on our creator portal: https://makeable.nyc/creators/apply

Best regards,
{sender_name}
Creator Partnerships Team • MakeAble
https://makeable.nyc"""

    hash_val = sum(ord(c) for c in username)
    return subjects[hash_val % len(subjects)], body

def send_email_resend(account: dict, to_email: str, subject: str, body: str) -> bool:
    formatted = body
    # Convert markdown link formats like [Apply Online](url) or [https://...](https://...)
    formatted = re.sub(r'\[([^\]]+)\]\((https?://[^\)]+)\)', lambda m: "[[CTA_BUTTON]]" if "makeable.nyc/creators/apply" in m.group(2) else f'<a href="{m.group(2)}" target="_blank" style="color: #4f46e5; font-weight: 600; text-decoration: underline;">{m.group(1)}</a>', formatted)
    
    # Convert bold **text** to <strong>
    formatted = re.sub(r'\*\*(.*?)\*\*', r'<strong style="color: #0f172a; font-weight: 700;">\1</strong>', formatted)
    
    # Convert bullet markers (* , - , • ) into clean styled bullets
    formatted = re.sub(r'^[*•\-]\s+', r'<span style="color: #6366f1; font-weight: bold; margin-right: 6px;">•</span> ', formatted, flags=re.MULTILINE)
    
    # Convert standalone apply URLs to CTA button placeholder
    formatted = re.sub(r'https?://makeable\.nyc/creators/apply', '[[CTA_BUTTON]]', formatted)
    
    # Convert remaining URLs to clickable links
    formatted = re.sub(r'(?<!href=")(https?://[^\s<]+)(?![^<]*>)', r'<a href="\1" target="_blank" style="color: #4f46e5; font-weight: 600; text-decoration: underline;">\1</a>', formatted)

    button_html = """
    <div style="margin: 20px 0; text-align: left;">
      <a href="https://makeable.nyc/creators/apply" target="_blank" style="background-color: #6366f1; color: #ffffff !important; padding: 12px 24px; border-radius: 8px; font-weight: 700; font-size: 14px; text-decoration: none; display: inline-block; box-shadow: 0 4px 10px rgba(99, 102, 241, 0.3);">
        👉 Apply for Creator Collab Now
      </a>
    </div>
    """

    if "[[CTA_BUTTON]]" in formatted:
        formatted = formatted.replace("[[CTA_BUTTON]]", button_html)

    paragraphs = formatted.split("\n\n")
    p_html = []
    for p in paragraphs:
        if 'href="https://makeable.nyc/creators/apply"' in p:
            p_html.append(p)
        else:
            p_html.append(f"<p style='margin-bottom: 16px; margin-top: 0; line-height: 1.65; font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif; color: #334155;'>{p.replace(chr(10), '<br/>')}</p>")

    html_body = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 15px; line-height: 1.65; color: #334155; max-width: 580px; margin: 0 auto;">
      {''.join(p_html)}
    </div>
    """

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
        print(f"    [!] Resend Dispatch Error: {e}", flush=True)
        return False

def run_continuous_outreach_loop():
    print("=" * 80, flush=True)
    print("🚀 AUTOMATED 3-DOMAIN OUTREACH ENGINE STARTED", flush=True)
    print("=" * 80, flush=True)
    print("Sending Domains:")
    for a in ACCOUNTS:
        print(f"  • {a['name']} <{a['email']}> (Reply-To: {REPLY_TO})", flush=True)
    print(f"Rules: Round-robin 1-by-1 (.work -> .website -> .online)")
    print(f"Delay: {INTER_EMAIL_DELAY}s between emails")
    print(f"Batching: {EMAILS_PER_DOMAIN_PER_BATCH} per domain/batch ({EMAILS_PER_DOMAIN_PER_BATCH * len(ACCOUNTS)} emails total) -> 30-min sleep")
    print(f"Warmup: Daily limit starts at {INITIAL_DAILY_LIMIT_PER_DOMAIN}/domain, +1/day up to max {MAX_DAILY_LIMIT_PER_DOMAIN}/domain")
    print("-" * 80, flush=True)

    state = load_outreach_state()
    state["is_running"] = True
    state["manual_stop"] = False
    save_outreach_state(state)

    while True:
        state = load_outreach_state()

        # 1. Check if user clicked STOP on Web UI
        if state.get("manual_stop"):
            print("\n🛑 [MANUAL STOP DETECTED] Engine stopped by user via Web UI. Exiting continuous loop.", flush=True)
            state["is_running"] = False
            save_outreach_state(state)
            break

        # 2. Check Daily Limit & Warmup Status from Supabase
        limit_per_domain, total_daily_limit = get_daily_limit_info()
        today_sent_count = get_today_sent_count_supabase()

        if today_sent_count >= total_daily_limit:
            now = datetime.datetime.now()
            tomorrow = datetime.datetime.combine(now.date() + datetime.timedelta(days=1), datetime.time(0, 5))
            seconds_until_midnight = int((tomorrow - now).total_seconds())
            hours_rem = round(seconds_until_midnight / 3600, 1)

            print(f"\n💤 [DAILY LIMIT REACHED] Sent {today_sent_count}/{total_daily_limit} emails today ({limit_per_domain} emails/domain across {len(ACCOUNTS)} domains).", flush=True)
            print(f"   Sleeping {hours_rem} hours until Midnight (00:05) for Auto-Resume (+1 daily warmup increment tomorrow)...", flush=True)

            # Sleep in 30-second checks so manual stop is immediately responsive
            for _ in range(0, seconds_until_midnight, 30):
                st = load_outreach_state()
                if st.get("manual_stop"):
                    print("\n🛑 [MANUAL STOP DETECTED DURING NIGHT SLEEP] Stopping loop permanently.", flush=True)
                    st["is_running"] = False
                    save_outreach_state(st)
                    return
                time.sleep(30)
            continue

        # 4. Fetch pending creators from Supabase
        pending_creators = []
        if SUPABASE_URL and SUPABASE_KEY:
            try:
                r = requests.get(
                    f"{SUPABASE_URL}/rest/v1/creators?select=*&email_status=neq.sent&limit=100",
                    headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"},
                    timeout=15
                )
                if r.status_code == 200:
                    pending_creators = [c for c in r.json() if c.get("email") and "@" in c.get("email")]
            except Exception as e:
                print(f"[!] Supabase fetch error: {e}", flush=True)

        if not pending_creators:
            print("\n[✓] All creators in database have been emailed! Sleeping 10 minutes before checking for new creators...", flush=True)
            time.sleep(600)
            continue

        # 5. Execute 1 Batch: 5 emails per domain (15 emails total in 1-by-1 round-robin)
        print(f"\n📦 [STARTING BATCH] Target: {EMAILS_PER_DOMAIN_PER_BATCH} emails per domain (Total batch: {EMAILS_PER_DOMAIN_PER_BATCH * len(ACCOUNTS)} emails)", flush=True)

        batch_sent_per_domain = {a["email"]: 0 for a in ACCOUNTS}
        total_batch_target = EMAILS_PER_DOMAIN_PER_BATCH * len(ACCOUNTS)
        creator_idx = 0

        while sum(batch_sent_per_domain.values()) < total_batch_target and creator_idx < len(pending_creators):
            # Check manual stop flag
            st = load_outreach_state()
            if st.get("manual_stop"):
                print("\n🛑 [MANUAL STOP DETECTED IN BATCH] Exiting immediately.", flush=True)
                st["is_running"] = False
                save_outreach_state(st)
                return

            # Round-robin selection of domain
            acct_idx = sum(batch_sent_per_domain.values()) % len(ACCOUNTS)
            account = ACCOUNTS[acct_idx]
            acct_email = account["email"]

            # Skip if this domain hit today's daily limit or batch target
            if sent_dict.get(acct_email, 0) >= daily_limit or batch_sent_per_domain[acct_email] >= EMAILS_PER_DOMAIN_PER_BATCH:
                # find next available domain
                avail = [a for a in ACCOUNTS if sent_dict.get(a["email"], 0) < daily_limit and batch_sent_per_domain[a["email"]] < EMAILS_PER_DOMAIN_PER_BATCH]
                if not avail:
                    break
                account = avail[0]
                acct_email = account["email"]

            creator = pending_creators[creator_idx]
            creator_idx += 1

            username = creator.get("username")
            email = creator.get("email")

            subject, body = generate_pitch(creator, account["name"])
            print(f"[{sum(batch_sent_per_domain.values()) + 1}/{total_batch_target}] Sending to @{username} ({email}) via [{acct_email}]...", flush=True)

            success = send_email_resend(account, email, subject, body)
            if success:
                batch_sent_per_domain[acct_email] += 1
                sent_dict[acct_email] = sent_dict.get(acct_email, 0) + 1
                state["today_sent_per_domain"] = sent_dict
                state["total_sent_all_time"] = state.get("total_sent_all_time", 0) + 1
                save_outreach_state(state)

                print(f"   ✓ Delivered successfully! Today's count for {acct_email}: {sent_dict[acct_email]}/{daily_limit}", flush=True)

                # Update Supabase status
                if SUPABASE_URL and SUPABASE_KEY:
                    try:
                        requests.patch(
                            f"{SUPABASE_URL}/rest/v1/creators?username=eq.{username}",
                            headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}", "Content-Type": "application/json"},
                            json={
                                "email_status": "sent",
                                "last_emailed_at": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
                                "email_subject": subject,
                                "email_body": body
                            },
                            timeout=10
                        )
                    except Exception:
                        pass
            else:
                print(f"   ✗ Delivery failed for {email}", flush=True)

            # 30 Seconds Inter-Email Delay
            print(f"   ⏳ Waiting {INTER_EMAIL_DELAY} seconds before next email...", flush=True)
            time.sleep(INTER_EMAIL_DELAY)

        # 6. Batch Finished: 30 Minutes Cooldown Sleep
        print(f"\n✅ [BATCH COMPLETE] Finished 1 batch of 15 emails ({dict(batch_sent_per_domain)}).", flush=True)
        print(f"😴 Sleeping 30 MINUTES (1800 seconds) before starting next batch...", flush=True)

        for _ in range(0, BATCH_COOLDOWN_SECONDS, 10):
            st = load_outreach_state()
            if st.get("manual_stop"):
                print("\n🛑 [MANUAL STOP DETECTED DURING 30-MIN COOLDOWN] Exiting loop.", flush=True)
                st["is_running"] = False
                save_outreach_state(st)
                return
            time.sleep(10)

if __name__ == "__main__":
    run_continuous_outreach_loop()
