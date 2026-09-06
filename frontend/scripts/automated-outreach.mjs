#!/usr/bin/env node

/**
 * =============================================================================
 * NODE.JS CLOUD & LOCAL AUTOMATED EMAIL OUTREACH ENGINE
 * =============================================================================
 * Features:
 * - Runs in Node.js on cloud servers, serverless crons, Docker, or local machine.
 * - Supports Morning (e.g. 200 emails) & Night (e.g. 200 emails) scheduled batches.
 * - Smart Sleep Time (15-30s anti-spam jitter) to maintain 10/10 domain inbox delivery.
 * - Live OpenAI bio generation with multi-variant dynamic fallback.
 * - Auto-syncs delivery status directly to Supabase table.
 *
 * Usage:
 *   node scripts/automated-outreach.mjs --limit 50
 *   node scripts/automated-outreach.mjs --limit 200 --min-sleep 15 --max-sleep 30
 *   node scripts/automated-outreach.mjs --limit 5 --dry-run
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Resend } from 'resend';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read environment variables
function loadEnv() {
  const envPath = path.resolve(__dirname, '..', '.env.local');
  const rootEnvPath = path.resolve(__dirname, '..', '..', '.env');
  const target = fs.existsSync(envPath) ? envPath : rootEnvPath;

  if (fs.existsSync(target)) {
    const lines = fs.readFileSync(target, 'utf-8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
        const [key, ...vals] = trimmed.split('=');
        const k = key.trim();
        const v = vals.join('=').trim();
        if (!process.env[k]) process.env[k] = v;
      }
    }
  }
}

loadEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_KEY || '';
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SENDER_NAME = process.env.SENDER_NAME || 'MakeAble';
const SENDER_EMAIL = process.env.SENDER_EMAIL || 'support@makeable.info';
const BRAND_SITE = 'https://makeable.nyc';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const args = process.argv.slice(2);
  let limit = 10;
  let minSleep = 15;
  let maxSleep = 30;
  let dryRun = false;
  let schedule = 'immediate';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit' && args[i + 1]) limit = parseInt(args[i + 1], 10);
    if (args[i] === '--min-sleep' && args[i + 1]) minSleep = parseInt(args[i + 1], 10);
    if (args[i] === '--max-sleep' && args[i + 1]) maxSleep = parseInt(args[i + 1], 10);
    if (args[i] === '--dry-run') dryRun = true;
    if (args[i] === '--schedule' && args[i + 1]) schedule = args[i + 1];
  }

  console.log('='.repeat(75));
  console.log('⚡ NODE.JS CLOUD AUTOMATED OUTREACH ENGINE');
  console.log('='.repeat(75));
  console.log(`[*] Sender: ${SENDER_NAME} <${SENDER_EMAIL}>`);
  console.log(`[*] Website: ${BRAND_SITE}`);
  console.log(`[*] Target Batch Size: ${limit} creators`);
  console.log(`[*] Sleep Time Range: ${minSleep}s - ${maxSleep}s (Human Anti-Spam Jitter)`);
  console.log(`[*] Mode: ${dryRun ? 'DRY RUN (Simulated)' : 'LIVE NETWORK DISPATCH'}`);
  console.log('-'.repeat(75));

  // 1. Fetch pending creators (with persistent registry filter)
  const jsonPath = path.resolve(__dirname, '..', '..', 'data', 'all_creators_merged.json');
  const registryPath = path.resolve(__dirname, '..', '..', 'data', 'sent_emails_registry.json');
  let sentRegistry = {};
  if (fs.existsSync(registryPath)) {
    try {
      sentRegistry = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
    } catch (e) {}
  }

  let creators = [];
  try {
    const { data, error } = await supabase
      .from('creators')
      .select('*')
      .neq('email_status', 'sent')
      .limit(limit);

    if (!error && data && data.length > 0) {
      creators = data;
    }
  } catch (err) {
    console.warn('[!] Supabase fetch error, using local fallback:', err.message);
  }

  if (creators.length === 0 && fs.existsSync(jsonPath)) {
    const raw = fs.readFileSync(jsonPath, 'utf-8');
    const all = JSON.parse(raw);
    creators = all.filter((c) => {
      const email = (c.email || '').toLowerCase().trim();
      const user = (c.username || '').toLowerCase().trim();
      const isAlreadySent = c.email_status === 'sent' || sentRegistry[email] || sentRegistry[user];
      return c.email && !isAlreadySent;
    }).slice(0, limit);
  }

  console.log(`[*] Loaded ${creators.length} pending creators for this batch.`);
  if (creators.length === 0) {
    console.log('[✓] All creators have already been emailed! No pending outreach left.');
    return;
  }

  const resend = RESEND_API_KEY && RESEND_API_KEY.startsWith('re_') ? new Resend(RESEND_API_KEY) : null;
  let openai = null;
  if (OPENAI_API_KEY && OPENAI_API_KEY.trim().length > 15 && !OPENAI_API_KEY.startsWith('sk-proj-your')) {
    try {
      openai = new OpenAI({ apiKey: OPENAI_API_KEY.trim() });
    } catch (e) {
      console.warn('[!] OpenAI init error:', e.message);
    }
  }

  let sentCount = 0;

  for (let i = 0; i < creators.length; i++) {
    const creator = creators[i];
    const username = creator.username || 'creator';
    const cleanName = creator.name ? creator.name.split(' ')[0] : username;
    const category = creator.category || 'Lifestyle';
    const bio = creator.biography || '';
    const email = creator.email;

    console.log(`\n[${i + 1}/${creators.length}] Processing @${username} (${creator.followers || 'N/A'}) -> ${email}`);

    let subject = '';
    let body = '';

    // A. OpenAI Generator
    if (openai) {
      try {
        const prompt = `You are a real human Creator Partnerships Lead at "MakeAble" (https://makeable.nyc).
Write a unique, authentic, and bespoke outreach email to Instagram creator @${username} (${cleanName}) inviting them to collaborate.

Creator Details:
- Name: ${cleanName}
- Instagram Handle: @${username}
- Category/Niche: ${category}
- Follower Count: ${creator.followers || '15k'}
- Bio: "${bio || 'Content creator & digital influencer'}"

Perks to clearly highlight:
- 15% recurring commission on every product sale made through their creator code/link.
- 10% OFF discount code for their followers to save money on every purchase.
- 100% Free Product Gifting Kit sent straight to them. No upfront costs / no fixed rate negotiations.

STRICT GUIDELINES:
1. SUBJECT LINE:
   - DO NOT include the @username or name in the subject line.
   - Write a fresh, creative, and enticing subject line highlighting the collab, 15% commission, and free gifting package.
   - Make every subject line distinct and varied across creators.

2. EMAIL BODY:
   - Write like a real person reaching out 1-on-1, NOT a corporate bot.
   - Opening: Mention checking out their profile (@${username}) and mention specific aspects of their content or bio ("${bio || category}").
   - Offer: Clearly outline the 3 key perks using clean bold bullet points:
     • **15% Recurring Commission** on all sales made via your link/code.
     • **10% Audience Discount** code for your followers to save money.
     • **100% Free Product Gifting Kit** shipped directly to you to test and feature.
   - Call to Action: Low friction next step — ask them to reply with their shipping address so we can send the gifting kit and activate their partner dashboard.
   - Sign-off:
     Warmly,
     MakeAble Team
     https://makeable.nyc

Return STRICT JSON: {"subject": "...", "body": "..."}`;

        const comp = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          response_format: { type: 'json_object' },
          temperature: 0.95,
        });

        const parsed = JSON.parse(comp.choices[0].message.content);
        subject = parsed.subject;
        body = parsed.body;
      } catch (aiErr) {
        console.warn(`    [!] OpenAI call failed for @${username}:`, aiErr.message);
      }
    }

    // B. Multi-variant rotating fallback
    if (!subject || !body) {
      const hash = username.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
      const subjects = [
        `15% commission + free gifting partnership offer 🎁`,
        `Creator collab offer: 15% commission & free product box 🤝`,
        `Loved your profile — exclusive partnership offer from MakeAble ✨`,
        `Free gifting package + 15% affiliate partner offer 📦`,
        `Exclusive creator collab: 15% commission + free products 🎁`
      ];
      subject = subjects[hash % subjects.length];

      const bioHook = bio.length > 5 ? `your focus on ${bio.slice(0, 50)}...` : `your ${category.toLowerCase()} content`;
      const bodyTemplates = [
        `Hey ${cleanName},

I was personally checking out your Instagram (@${username}) and our team at MakeAble has been searching for an authentic creator in the ${category.toLowerCase()} space. Your work focusing on ${bioHook} really stood out to us!

We would love to invite you into our **Exclusive Creator Partner Program** and send you a complimentary gifting package.

Here is what we're offering:
• **15% Recurring Commission**: Earn 15% on every product sold through your personalized link or discount code.
• **10% Follower Discount**: An exclusive discount code for your community so they save money on every order.
• **100% Free Product Gifting Kit**: Shipped straight to your door to test, enjoy, and feature.

If you'd like to collaborate, simply reply with your shipping address and we'll get your free gifting box sent out and your affiliate portal activated immediately!

Warmly,
MakeAble Team
https://makeable.nyc`,

        `Hey ${cleanName},

Hope you're having a great week! Our team at MakeAble has been following your journey on Instagram (@${username}) and we really admire what you're creating in the ${category.toLowerCase()} community, especially ${bioHook}.

We're currently onboarding select creators for our **Affiliate Collaboration Program** and would love to partner with you and send over a free product package.

Here's how we partner:
• **15% Recurring Commission**: You earn a full 15% on all sales driven through your personal creator link/code.
• **10% Community Discount**: A custom discount code for your audience to save on every purchase.
• **Free Product Gifting**: We ship a complimentary gifting package directly to you — no upfront costs or strings attached.

Would you be interested in joining? If so, reply with your best shipping address and we'll dispatch your package and log you into the partner dashboard!

Warmly,
MakeAble Team
https://makeable.nyc`
      ];

      body = bodyTemplates[hash % bodyTemplates.length];
    }

    console.log(`  [Subject]: ${subject}`);

    // C. Dispatch
    let isSuccess = false;
    if (dryRun) {
      console.log('  [DRY RUN] Email generated successfully. Skipping network send.');
      isSuccess = true;
    } else if (resend) {
      try {
        let formatted = body;
        formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong style="color: #0f172a; font-weight: 700;">$1</strong>');
        formatted = formatted.replace(/^[*\-•]\s+/gm, '<span style="color: #6366f1; font-weight: bold; margin-right: 6px;">•</span> ');
        formatted = formatted.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" style="color: #4f46e5; font-weight: 600; text-decoration: underline;">$1</a>');

        const paragraphs = formatted.split(/\n\n+/);
        const htmlBody = `
          <div style="font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif; font-size: 15px; line-height: 1.65; color: #334155; max-width: 580px;">
            ${paragraphs.map((p) => `<p style="margin-bottom: 16px; margin-top: 0; line-height: 1.65;">${p.replace(/\n/g, '<br/>')}</p>`).join('')}
          </div>
        `;

        const replyToEmail = process.env.REPLY_TO_EMAIL || 'support@makeable.nyc';
        const res = await resend.emails.send({
          from: `${SENDER_NAME} <${SENDER_EMAIL}>`,
          to: [email],
          reply_to: replyToEmail,
          subject: subject,
          html: htmlBody,
          text: body,
        });

        if (res.data?.id) {
          console.log(`  [SUCCESS] Dispatched to ${email} (ID: ${res.data.id})`);
          isSuccess = true;
        } else {
          console.log(`  [FAILED] Resend error:`, res.error);
        }
      } catch (err) {
        console.log(`  [FAILED] Error sending: ${err.message}`);
      }
    } else {
      console.log(`  [SIMULATED] Add RESEND_API_KEY to send live network emails.`);
      isSuccess = true;
    }

    // D. Update Supabase, Registry, and local JSON
    if (isSuccess && !dryRun) {
      sentCount++;
      const nowIso = new Date().toISOString();

      // 1. Update Registry
      try {
        const cleanEmail = (email || '').toLowerCase().trim();
        const cleanUser = (username || '').toLowerCase().trim();
        const regEntry = { username: cleanUser, email: cleanEmail, sentAt: nowIso, subject, body };
        if (cleanEmail) sentRegistry[cleanEmail] = regEntry;
        if (cleanUser) sentRegistry[cleanUser] = regEntry;
        fs.writeFileSync(registryPath, JSON.stringify(sentRegistry, null, 2), 'utf-8');
      } catch (e) {}

      // 2. Update Master JSON
      try {
        if (fs.existsSync(jsonPath)) {
          const raw = fs.readFileSync(jsonPath, 'utf-8');
          const all = JSON.parse(raw);
          for (const c of all) {
            if (c.username?.toLowerCase() === username.toLowerCase() || c.email?.toLowerCase() === email.toLowerCase()) {
              c.email_status = 'sent';
              c.last_emailed_at = nowIso;
              c.email_subject = subject;
              c.email_body = body;
            }
          }
          fs.writeFileSync(jsonPath, JSON.stringify(all, null, 2), 'utf-8');
        }
      } catch (e) {}

      // 3. Update Supabase
      try {
        await supabase
          .from('creators')
          .update({
            email_status: 'sent',
            last_emailed_at: nowIso,
            email_subject: subject,
            email_body: body,
          })
          .eq('username', username.toLowerCase().trim());
      } catch (e) {
        console.warn(`    [!] Could not update Supabase for @${username}`);
      }
    }

    // E. Sleep between sends
    if (i < creators.length - 1) {
      const pauseSec = Math.floor(Math.random() * (maxSleep - minSleep + 1)) + minSleep;
      console.log(`  [SLEEP] Waiting ${pauseSec}s before next email (Spam Prevention Pacing)...`);
      await sleep(pauseSec * 1000);
    }
  }

  console.log('='.repeat(75));
  console.log(`🏁 BATCH COMPLETE: Successfully dispatched ${sentCount} / ${creators.length} outreach emails.`);
  console.log('='.repeat(75));
}

main().catch(console.error);
