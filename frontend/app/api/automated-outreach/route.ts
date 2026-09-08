import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import OpenAI from 'openai';
import { supabase } from '@/lib/supabase';
import { getAllCreators, recordEmailSent } from '@/lib/creators-storage';
import fs from 'fs';
import path from 'path';

// Persistent State file path
const STATE_FILE = path.join(process.cwd(), '.batch_outreach_state.json');

// Helper to get all configured Resend accounts
export function getConfiguredSenders() {
  const accounts: Array<{
    id: string;
    apiKey: string;
    senderName: string;
    senderEmail: string;
    label: string;
  }> = [];

  if (process.env.RESEND_API_KEY && process.env.RESEND_API_KEY.startsWith('re_')) {
    accounts.push({
      id: 'sender_1',
      apiKey: process.env.RESEND_API_KEY,
      senderName: process.env.SENDER_NAME || 'MakeAble Partnerships',
      senderEmail: process.env.SENDER_EMAIL || 'partnerships@makeable.info',
      label: `${process.env.SENDER_NAME || 'MakeAble Partnerships'} (${process.env.SENDER_EMAIL || 'partnerships@makeable.info'})`
    });
  }

  if (process.env.RESEND_API_KEY_2 && process.env.RESEND_API_KEY_2.startsWith('re_')) {
    accounts.push({
      id: 'sender_2',
      apiKey: process.env.RESEND_API_KEY_2,
      senderName: process.env.SENDER_NAME_2 || process.env.SENDER_NAME || 'MakeAble Partnerships',
      senderEmail: process.env.SENDER_EMAIL_2 || 'collab@makeable.online',
      label: `${process.env.SENDER_NAME_2 || 'MakeAble Partnerships'} (${process.env.SENDER_EMAIL_2 || 'collab@makeable.online'})`
    });
  }

  if (process.env.RESEND_API_KEY_3 && process.env.RESEND_API_KEY_3.startsWith('re_')) {
    accounts.push({
      id: 'sender_3',
      apiKey: process.env.RESEND_API_KEY_3,
      senderName: process.env.SENDER_NAME_3 || process.env.SENDER_NAME || 'MakeAble Partnerships',
      senderEmail: process.env.SENDER_EMAIL_3 || 'support@makeable.website',
      label: `${process.env.SENDER_NAME_3 || 'MakeAble Partnerships'} (${process.env.SENDER_EMAIL_3 || 'support@makeable.website'})`
    });
  }

  return accounts;
}

// Helper to read state
function getBatchState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (e) {
    console.warn('Error reading batch state file:', e);
  }
  return {
    isRunning: false,
    total: 0,
    sent: 0,
    failed: 0,
    currentCreator: '',
    currentSender: '',
    statusMessage: 'Idle. No active batch running.',
    startedAt: null,
    lastUpdatedAt: new Date().toISOString(),
    recentLogs: [],
    shouldStop: false
  };
}

// Helper to save state
function saveBatchState(state: any) {
  try {
    state.lastUpdatedAt = new Date().toISOString();
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
  } catch (e) {
    console.warn('Error saving batch state file:', e);
  }
}

// Sleep helper function in Node.js
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Background Worker execution runner
async function runBackgroundBatch(options: {
  limit: number;
  minSleepSeconds: number;
  maxSleepSeconds: number;
  dryRun: boolean;
  commissionRate: string;
  buyerDiscount: string;
  senderMode: string; // 'rotate' | 'sender_1' | 'sender_2' | 'custom'
  customSenderEmail?: string;
  customSenderName?: string;
  rotationInterval?: number; // default 5 emails per rotation
}) {
  const {
    limit,
    minSleepSeconds,
    maxSleepSeconds,
    dryRun,
    commissionRate,
    buyerDiscount,
    senderMode = 'rotate',
    customSenderEmail,
    customSenderName,
    rotationInterval = 5
  } = options;

  const replyTo = process.env.REPLY_TO_EMAIL || 'support@makeable.nyc';
  const openaiApiKey = process.env.OPENAI_API_KEY;
  const accounts = getConfiguredSenders();

  let state = getBatchState();

  try {
    // 1. Fetch pending creators directly from Supabase
    const { creators: allCreators } = await getAllCreators();
    const allPending = (allCreators || [])
      .filter((c: any) => c.email && c.email.includes('@') && c.email_status !== 'sent');

    const pendingCreators = limit && limit > 0 ? allPending.slice(0, limit) : allPending;

    if (pendingCreators.length === 0) {
      state.isRunning = false;
      state.total = 0;
      state.sent = 0;
      state.statusMessage = 'All creators have already been emailed! No pending outreach left.';
      saveBatchState(state);
      return;
    }

    state.total = pendingCreators.length;
    state.sent = 0;
    state.failed = 0;
    state.isRunning = true;
    state.shouldStop = false;
    state.statusMessage = `Processing batch of ${pendingCreators.length} creators in background...`;
    saveBatchState(state);

    let openai: OpenAI | null = null;
    if (openaiApiKey && openaiApiKey.trim().length > 15 && !openaiApiKey.includes('your-openai')) {
      try {
        openai = new OpenAI({ apiKey: openaiApiKey.trim() });
      } catch (err) {
        console.warn('OpenAI init error:', err);
      }
    }

    // 2. Main processing loop
    for (let i = 0; i < pendingCreators.length; i++) {
      // Re-read state to check for user stop signal
      state = getBatchState();
      if (state.shouldStop) {
        state.isRunning = false;
        state.shouldStop = false;
        state.statusMessage = `Batch stopped by user. Sent ${state.sent} / ${state.total} emails.`;
        saveBatchState(state);
        console.log('[Node Background Outreach] Batch stopped by user signal.');
        return;
      }

      const creator = pendingCreators[i];
      const username = creator.username || 'creator';
      const cleanName = creator.name && creator.name.trim() ? creator.name.split(' ')[0] : username;
      const category = creator.category || 'Lifestyle';
      const bio = creator.biography || '';
      const toEmail = creator.email;

      // Select sender account & email based on senderMode and 5-email rotation
      let activeSenderName = 'MakeAble Partnerships';
      let activeSenderEmail = 'partnerships@makeable.info';
      let activeApiKey = process.env.RESEND_API_KEY || '';

      if (senderMode === 'rotate' && accounts.length > 0) {
        // Rotate every N emails (default: 5)
        const accountIdx = Math.floor(i / rotationInterval) % accounts.length;
        const selected = accounts[accountIdx];
        activeSenderName = selected.senderName;
        activeSenderEmail = selected.senderEmail;
        activeApiKey = selected.apiKey;
      } else if (senderMode === 'sender_2' && accounts.find(a => a.id === 'sender_2')) {
        const selected = accounts.find(a => a.id === 'sender_2')!;
        activeSenderName = selected.senderName;
        activeSenderEmail = selected.senderEmail;
        activeApiKey = selected.apiKey;
      } else if (senderMode === 'sender_1' && accounts.length > 0) {
        activeSenderName = accounts[0].senderName;
        activeSenderEmail = accounts[0].senderEmail;
        activeApiKey = accounts[0].apiKey;
      } else if (senderMode === 'custom' && customSenderEmail) {
        activeSenderEmail = customSenderEmail.trim();
        activeSenderName = customSenderName?.trim() || process.env.SENDER_NAME || 'MakeAble Partnerships';
        // Pick best matching account or default to account 1
        const matched = accounts.find(a => activeSenderEmail.endsWith(a.senderEmail.split('@')[1] || ''));
        activeApiKey = matched ? matched.apiKey : (accounts[0]?.apiKey || '');
      } else if (accounts.length > 0) {
        activeSenderName = accounts[0].senderName;
        activeSenderEmail = accounts[0].senderEmail;
        activeApiKey = accounts[0].apiKey;
      }

      state.currentCreator = username;
      state.currentSender = activeSenderEmail;
      state.statusMessage = `[${i + 1}/${pendingCreators.length}] Sending to @${username} via ${activeSenderEmail}...`;
      saveBatchState(state);

      let subject = '';
      let body = '';

      // A. Dynamic OpenAI generation
      if (openai) {
        try {
          const prompt = `You are a real human Creator Partnerships Lead at "MakeAble" (https://makeable.nyc).
Write a unique, authentic, and bespoke outreach email to Instagram creator @${username} (${cleanName}) inviting them to collaborate.

Creator Details:
- Name: ${cleanName}
- Instagram Handle: @${username}
- Category/Niche: ${category}
- Followers: ${creator.followers || '25k'}
- Bio: "${bio || 'Content creator & digital influencer'}"

Partnership Terms:
- ${commissionRate} recurring commission on every product sale generated from their creator link/code.
- ${buyerDiscount} OFF discount code for their followers to save money on every order.
- 100% Free product gifting package sent right away. No upfront fees / no fixed rate negotiations.

STRICT GUIDELINES:
1. SUBJECT LINE:
   - DO NOT include the @username or name in the subject line.
   - Write a fresh, creative, and enticing subject line highlighting the collab, ${commissionRate} commission, and free gifting kit.
   - Make every subject line distinct and varied across creators.

2. EMAIL BODY:
   - Write like a real person reaching out 1-on-1, NOT a corporate bot.
   - Opening: Mention checking out their profile (@${username}) and mention specific aspects of their content or bio ("${bio || category}").
   - Offer: Clearly outline the 3 key perks using clean bold bullet points:
     • **${commissionRate} Recurring Commission** on all sales made via your link/code.
     • **${buyerDiscount} Audience Discount** code for your followers to save money.
     • **100% Free Product Gifting Kit** shipped directly to you to test and feature.
   - Call to Action: Low friction next step — ask them to reply with their shipping address to get their free package dispatched and affiliate portal set up.
   - Sign-off:
     Warmly,
     ${activeSenderName}
     https://makeable.nyc

Return STRICT JSON: {"subject": "...", "body": "..."}`;

          const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: prompt }],
            response_format: { type: 'json_object' },
            temperature: 0.95
          });

          const content = completion.choices[0].message.content;
          if (content) {
            const parsed = JSON.parse(content);
            subject = parsed.subject;
            body = parsed.body;
          }
        } catch (aiErr) {
          console.warn(`OpenAI generation error for @${username}:`, aiErr);
        }
      }

      // B. Multi-variant dynamic rotating fallback
      if (!subject || !body) {
        const hash = username.split('').reduce((acc: number, char: string) => acc + char.charCodeAt(0), 0);
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
• **${commissionRate} Recurring Commission**: Earn ${commissionRate} on every product sold through your personalized link or discount code.
• **${buyerDiscount} Follower Discount**: An exclusive discount code for your community so they save money on every order.
• **100% Free Product Gifting Kit**: Shipped straight to your door to test, enjoy, and feature.

If you'd like to collaborate, simply reply with your shipping address and we'll get your free gifting box sent out and your affiliate portal activated immediately!

Warmly,
${activeSenderName}
https://makeable.nyc`,

          `Hey ${cleanName},

Hope you're having a great week! Our team at MakeAble has been following your journey on Instagram (@${username}) and we really admire what you're creating in the ${category.toLowerCase()} community, especially ${bioHook}.

We're currently onboarding select creators for our **Affiliate Collaboration Program** and would love to partner with you and send over a free product package.

Here's how we partner:
• **${commissionRate} Recurring Commission**: You earn a full ${commissionRate} on all sales driven through your personal creator link/code.
• **${buyerDiscount} Community Discount**: A custom discount code for your audience to save on every purchase.
• **Free Product Gifting**: We ship a complimentary gifting package directly to you — no upfront costs or strings attached.

Would you be interested in joining? If so, reply with your best shipping address and we'll dispatch your package and log you into the partner dashboard!

Warmly,
${activeSenderName}
https://makeable.nyc`
        ];

        body = bodyTemplates[hash % bodyTemplates.length];
      }

      // C. Dispatch via Resend (using the designated rotated client)
      let sentSuccess = false;
      let logEntry = '';

      if (dryRun) {
        sentSuccess = true;
        logEntry = `[DRY RUN] Generated pitch for @${username} (${toEmail}) via ${activeSenderEmail}`;
      } else if (activeApiKey && activeApiKey.startsWith('re_')) {
        try {
          const resendClient = new Resend(activeApiKey);
          let formatted = body;
          formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong style="color: #0f172a; font-weight: 700;">$1</strong>');
          formatted = formatted.replace(/^[*\-•]\s+/gm, '<span style="color: #6366f1; font-weight: bold; margin-right: 6px;">•</span> ');
          formatted = formatted.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" style="color: #4f46e5; font-weight: 600; text-decoration: underline;">$1</a>');

          const paragraphs = formatted.split(/\n\n+/);
          const htmlBody = `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 15px; line-height: 1.65; color: #334155; max-width: 580px;">
              ${paragraphs.map(p => `<p style="margin-bottom: 16px; margin-top: 0; line-height: 1.65;">${p.replace(/\n/g, '<br/>')}</p>`).join('')}
            </div>
          `;

          const resendData = await resendClient.emails.send({
            from: `${activeSenderName} <${activeSenderEmail}>`,
            to: [toEmail],
            replyTo: replyTo,
            reply_to: replyTo as any,
            headers: {
              'Reply-To': replyTo
            },
            subject: subject,
            html: htmlBody,
            text: body
          } as any);

          if (resendData.data?.id) {
            sentSuccess = true;
            logEntry = `✓ Sent to @${username} (${toEmail}) via [${activeSenderEmail}]`;
          } else {
            logEntry = `✗ Failed sending to @${username} via [${activeSenderEmail}]: ${resendData.error?.message || 'Unknown error'}`;
          }
        } catch (resendErr: any) {
          logEntry = `✗ Error sending to @${username}: ${resendErr.message}`;
          console.error(`Resend error sending to ${toEmail}:`, resendErr);
        }
      } else {
        logEntry = `✗ No valid Resend API key configured for ${activeSenderEmail}`;
      }

      const nowIso = new Date().toISOString();
      if (sentSuccess) {
        state.sent += 1;
        if (!dryRun) {
          await recordEmailSent({
            username: username || '',
            email: toEmail,
            subject,
            body
          });
        }
      } else {
        state.failed += 1;
      }

      state.recentLogs = [
        { time: new Date().toLocaleTimeString(), message: logEntry, success: sentSuccess, sender: activeSenderEmail },
        ...state.recentLogs.slice(0, 19)
      ];
      saveBatchState(state);

      // D. Sleep with anti-spam jitter between each email
      if (i < pendingCreators.length - 1) {
        const sleepSeconds = Math.floor(Math.random() * (maxSleepSeconds - minSleepSeconds + 1)) + minSleepSeconds;
        state.statusMessage = `Pacing delay (${sleepSeconds}s anti-spam sleep) before next creator...`;
        saveBatchState(state);
        console.log(`[Node Background Outreach] Sleeping ${sleepSeconds}s before next email...`);
        await sleep(sleepSeconds * 1000);
      }
    }

    state.isRunning = false;
    state.statusMessage = `Batch completed successfully! Dispatched ${state.sent} / ${state.total} outreach emails.`;
    saveBatchState(state);

  } catch (err: any) {
    console.error('Background batch execution error:', err);
    state.isRunning = false;
    state.statusMessage = `Batch halted due to error: ${err.message}`;
    saveBatchState(state);
  }
}

// GET: Retrieve live background batch status + configured senders
export async function GET() {
  const state = getBatchState();
  const senders = getConfiguredSenders();
  return NextResponse.json({
    success: true,
    senders,
    ...state
  });
}

// POST: Start a new background batch or Stop current running batch
export async function POST(req: Request) {
  try {
    const body = await req.json();

    // Check if user requested to STOP the batch
    if (body.action === 'stop') {
      const state = getBatchState();
      state.shouldStop = true;
      state.statusMessage = 'Stopping batch after current task finishes...';
      saveBatchState(state);
      return NextResponse.json({
        success: true,
        message: 'Stop signal sent to background worker.',
        state
      });
    }

    const {
      limit = 50,
      minSleepSeconds = 15,
      maxSleepSeconds = 30,
      dryRun = false,
      commissionRate = '15%',
      buyerDiscount = '10%',
      senderMode = 'rotate',
      customSenderEmail,
      customSenderName,
      rotationInterval = 5
    } = body;

    const currentState = getBatchState();
    if (currentState.isRunning) {
      return NextResponse.json({
        success: true,
        message: 'A batch is already actively running in the background.',
        state: currentState
      });
    }

    // Initialize state
    const newState = {
      isRunning: true,
      total: limit,
      sent: 0,
      failed: 0,
      currentCreator: 'Initializing...',
      currentSender: '',
      statusMessage: `Starting background batch for ${limit} creators (Mode: ${senderMode === 'rotate' ? 'Auto-Rotate 5/domain' : senderMode})...`,
      startedAt: new Date().toISOString(),
      lastUpdatedAt: new Date().toISOString(),
      recentLogs: [],
      shouldStop: false
    };
    saveBatchState(newState);

    // Launch background worker without awaiting (so HTTP response returns immediately to client)
    runBackgroundBatch({
      limit,
      minSleepSeconds,
      maxSleepSeconds,
      dryRun,
      commissionRate,
      buyerDiscount,
      senderMode,
      customSenderEmail,
      customSenderName,
      rotationInterval
    }).catch((e) => {
      console.error('Background runner unhandled exception:', e);
    });

    return NextResponse.json({
      success: true,
      message: 'Batch outreach successfully started in background. You can safely close this window.',
      state: newState
    });

  } catch (error: any) {
    console.error('Automated outreach route error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to start background batch' },
      { status: 500 }
    );
  }
}
