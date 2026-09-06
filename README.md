# 🚀 CreatorOutreach Platform (Python + Next.js + Supabase + OpenAI)

A complete full-stack influencer marketing engine:
- **Local / Background Engine (Python)**: High-performance scraping and verification of US consumer creators (5k–50k followers) with verified business emails.
- **Database (Supabase PostgreSQL)**: Central database with table `creators`, auto-updating timestamps, and email dispatch status tracking (`email_status`, `last_emailed_at`, `email_subject`, `email_body`).
- **Web Dashboard & Backend (Next.js 14 + TypeScript)**: Responsive light-themed dashboard with date/time filtering (including 1-click **Today's Data**), email status tabs (`Not Sent` vs `Mail Sent`), **OpenAI AI Pitch Generator** analyzing creator bios, custom signature builder, and free domain email sending.

---

## 📁 Project Structure

```
├── .env                       # Root environment configuration (Supabase, OpenAI, Resend/SMTP)
├── schema.sql                 # Supabase PostgreSQL schema with table, indexes, & triggers
├── sync_supabase.py           # Syncs local master verified dataset directly into Supabase
├── main.py                    # Python CLI orchestrator
├── data/
│   ├── all_creators_merged.json # Master dataset (292 verified US creators)
│   ├── creators_master_all.xlsx # Excel master export
│   └── creators_master_all.csv  # CSV master export
└── frontend/                  # Next.js 14 App Router + TypeScript Web Dashboard
    ├── app/
    │   ├── page.tsx           # Main Dashboard (Metrics, Filters, Creator Table)
    │   ├── layout.tsx         # Light-theme layout with Plus Jakarta Sans
    │   └── api/
    │       ├── ai-generate/   # OpenAI API endpoint for customized pitches from bio
    │       ├── send-email/    # Resend API & Nodemailer SMTP dispatch
    │       └── creators/      # Supabase data endpoint with local JSON fallback
    ├── components/            # Reusable UI components & modals
    └── .env.local             # Frontend environment variables
```

---

## ⚡ Quick Start

### 1. Configure `.env`
Add your API keys in [`.env`](file:///d:/Shivam/Final_Creators/.env):
```dotenv
# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=sb_publishable_your_supabase_key_here
SUPABASE_TABLE_NAME=creators

# OpenAI (for AI Pitch Generation from creator bio)
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_MODEL=gpt-4o-mini

# Free Email Dispatch (Resend API or Custom Domain SMTP)
RESEND_API_KEY=re_your_api_key_here
SENDER_NAME=Your Name / Brand Lead
SENDER_EMAIL=collab@yourgodaddydomain.com
```

### 2. Run Supabase Database Schema
1. Open your [Supabase SQL Editor](https://supabase.com/dashboard/project/lhaurzgpjiteiwllhwjg/sql/new).
2. Paste and run [`schema.sql`](file:///d:/Shivam/Final_Creators/schema.sql).
3. Push all 292 creators to Supabase:
   ```bash
   python sync_supabase.py
   ```

### 3. Launch the Web Dashboard
```bash
npm run dev
# or: cd frontend && npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser!

---

## 📧 How to Send Free Emails with Your GoDaddy Domain (0% Spam / 10/10 Deliverability)

1. Sign up for free at [resend.com](https://resend.com) (3,000 free emails/month).
2. In Resend, go to **Domains** ➔ Click **Add Domain** ➔ Enter your GoDaddy domain (`yourbrand.com`).
3. Add these 3 records in your **GoDaddy DNS Management**:
   - **SPF Record (TXT)**: Host `@` | Value `v=spf1 include:resend.com ~all`
   - **DKIM Record (TXT)**: Host `resend._domainkey` | Value `(provided by Resend)`
   - **DMARC Record (TXT)**: Host `_dmarc` | Value `v=DMARC1; p=none;`
4. Copy your Resend API Key into `.env` as `RESEND_API_KEY=re_...`.
5. Every outreach email dispatched from the dashboard will land straight into the creator's **Primary Inbox**!
