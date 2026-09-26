import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import OpenAI from 'openai';
import { supabase } from '../../../lib/supabase';
import { getAllCreators, recordEmailSent, getDailyLimitInfo, getTodaySentCountFromSupabase } from '../../../lib/creators-storage';
import { getConfiguredSenders } from '../../../lib/senders-config';
import fs from 'fs';
import path from 'path';

// Persistent State file path
const STATE_FILE = path.join(process.cwd(), '.batch_outreach_state.json');

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
    isCooldown: false,
    nextCycleAt: null,
    currentCycle: 1,
    totalCycles: 1,
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

// Sleep helper function with stop checking
async function sleepWithCheck(ms: number, updateCallback?: (remainingSec: number) => void): Promise<boolean> {
  const step = 1000;
  let elapsed = 0;
  while (elapsed < ms) {
    const currentState = getBatchState();
    if (currentState.shouldStop) {
      return false; // User requested stop
    }
    await new Promise((resolve) => setTimeout(resolve, step));
    elapsed += step;
    if (updateCallback) {
      updateCallback(Math.round((ms - elapsed) / 1000));
    }
  }
  return true;
}

// Background Worker execution runner
async function runBackgroundBatch(options: {
  limit: number;
  minSleepSeconds: number;
  maxSleepSeconds: number;
  dryRun: boolean;
  commissionRate: string;
  buyerDiscount: string;
  senderMode: string;
  customSenderEmail?: string;
  customSenderName?: string;
  rotationInterval?: number; // 5 per domain
  enableIntervalCycles?: boolean;
  burstSize?: number; // e.g. 10 emails (5 from each of 2 domains)
  cooldownMinutes?: number; // e.g. 30 minutes
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
    rotationInterval = 5,
    enableIntervalCycles = false,
    burstSize = 10,
    cooldownMinutes = 30
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
      state.isCooldown = false;
      state.total = 0;
      state.sent = 0;
      state.statusMessage = 'All creators have already been emailed! No pending outreach left.';
      saveBatchState(state);
      return;
    }

    const calculatedTotalCycles = enableIntervalCycles ? Math.ceil(pendingCreators.length / burstSize) : 1;

    state.total = pendingCreators.length;
    state.sent = 0;
    state.failed = 0;
    state.isRunning = true;
    state.isCooldown = false;
    state.currentCycle = 1;
    state.totalCycles = calculatedTotalCycles;
    state.shouldStop = false;
    state.statusMessage = `Starting outreach for ${pendingCreators.length} creators (Cycles: ${calculatedTotalCycles})...`;
    saveBatchState(state);

    let openai: OpenAI | null = null;
    if (openaiApiKey && openaiApiKey.trim().length > 15 && !openaiApiKey.includes('your-openai')) {
      try {
        openai = new OpenAI({ apiKey: openaiApiKey.trim() });
      } catch (err) {
        console.warn('OpenAI init error:', err);
      }
    }

    let burstCounter = 0;
    let cycleNumber = 1;

    // 2. Main processing loop
    for (let i = 0; i < pendingCreators.length; i++) {
      // Re-read state to check for user stop signal
      state = getBatchState();
      if (state.shouldStop) {
        state.isRunning = false;
        state.isCooldown = false;
        state.shouldStop = false;
        state.statusMessage = `Batch stopped by user. Sent ${state.sent} / ${state.total} emails across ${cycleNumber} cycle(s).`;
        saveBatchState(state);
        console.log('[Node Background Outreach] Batch stopped by user signal.');
        return;
      }

      // Enforce daily per-domain limit based on Supabase DB records
      const todaySentCount = await getTodaySentCountFromSupabase();
      const { limitPerDomain, totalDailyLimit } = getDailyLimitInfo();

      if (todaySentCount >= totalDailyLimit) {
        state.isRunning = false;
        state.isCooldown = false;
        state.statusMessage = `💤 Daily limit reached (${limitPerDomain} emails/domain, ${totalDailyLimit} total today). Engine paused to protect domain reputation. Will auto-resume tomorrow at 00:05.`;
        saveBatchState(state);
        console.log(`[Node Background Outreach] Daily limit reached: ${todaySentCount}/${totalDailyLimit} emails sent today.`);
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
      let activeSenderEmail = accounts.length > 0 ? accounts[0].senderEmail : 'collab@makeable.work';
      let activeApiKey = process.env.RESEND_API_KEY_2 || process.env.RESEND_API_KEY || (accounts.length > 0 ? accounts[0].apiKey : '');

      if (senderMode === 'rotate' && accounts.length > 0) {
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
        const matched = accounts.find(a => activeSenderEmail.endsWith(a.senderEmail.split('@')[1] || ''));
        activeApiKey = matched ? matched.apiKey : (accounts[0]?.apiKey || '');
      } else if (accounts.length > 0) {
        activeSenderName = accounts[0].senderName;
        activeSenderEmail = accounts[0].senderEmail;
        activeApiKey = accounts[0].apiKey;
      }

      state.currentCreator = username;
      state.currentSender = activeSenderEmail;
      state.currentCycle = cycleNumber;
      state.isCooldown = false;
      state.statusMessage = `[${i + 1}/${pendingCreators.length}] Sending to @${username} via ${activeSenderEmail} (Burst ${burstCounter + 1}/${burstSize})...`;
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
- Option 1: Paid Sponsored Campaign (CPM & rate-card based sponsored Reel/Post campaign - reply with rate sheet or apply online!).
- Option 2: Affiliate Partnership (${commissionRate} recurring commission + ${buyerDiscount} follower discount + Free Product Gifting Kit).

STRICT GUIDELINES:
1. SUBJECT LINE:
   - DO NOT include the @username or name in the subject line.
   - Write a fresh, creative, and enticing subject line highlighting the collab, paid sponsorship / ${commissionRate} commission, and free gifting kit.
   - Make every subject line distinct and varied across creators.

2. EMAIL BODY:
   - Write like a real person reaching out 1-on-1, NOT a corporate bot.
   - Opening: Mention checking out their profile (@${username}) and mention specific aspects of their content or bio ("${bio || category}").
   - Offer: Clearly outline the 2 collaboration options:
      💰 **Option 1: Paid Sponsored Campaign**: Competitive CPM & rate-sheet sponsored fees (reply with your rate sheet / media kit!).
      🛍️ **Option 2: Affiliate Partner & Free Product Box**: ${commissionRate} recurring commission + ${buyerDiscount} audience discount + 100% Free Product Box shipped to your door.
   - Call to Action: Reply directly to this email (with media kit or shipping address) OR apply online at https://makeable.nyc/creators/apply
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
          `Paid Collab + Partnership Invite for @${username} ✨`,
          `MakeAble x @${username} — Sponsored Post & Affiliate Partner Options 🤝`,
          `Collaboration Offer for @${username} (Paid Sponsored Post or Affiliate + Free Gifting Kit) 📦`,
          `Exclusive creator collab: Paid sponsorship + 15% commission 🎁`
        ];
        subject = subjects[hash % subjects.length];

        const bioHook = bio.length > 5 ? `your focus on ${bio.slice(0, 50)}...` : `your ${category.toLowerCase()} content`;
        const bodyTemplates = [
          `Hey ${cleanName},

I was personally checking out your Instagram (@${username}) and our team at MakeAble has been searching for authentic creators in the ${category.toLowerCase()} space. Your work focusing on ${bioHook} really stood out to us!

We would love to invite you to partner with MakeAble (https://makeable.nyc). We offer two flexible collaboration paths so you can choose what works best for you:

💰 **Option 1: Paid Sponsored Campaign**
• We offer competitive CPM & rate-sheet fees for sponsored Reel/Post campaigns (reply with your media kit / rate sheet!).

🛍️ **Option 2: Affiliate Partner & Free Product Box**
• **${commissionRate} Recurring Commission** on all sales via your personal link/code.
• **${buyerDiscount} Follower Discount**: An exclusive discount code for your audience.
• **100% Free Product Gifting Kit**: Shipped straight to your door to test and feature.

📩 **How to Get Started:**
• Reply directly to this email with your rate card / shipping address, OR
• Apply instantly on our creator portal: https://makeable.nyc/creators/apply

Warmly,
${activeSenderName}
https://makeable.nyc`,

          `Hey ${cleanName},

Hope you're having a great week! Our team at MakeAble has been following your journey on Instagram (@${username}) and we really admire what you're creating in the ${category.toLowerCase()} community, especially ${bioHook}.

We're expanding our creator network and would love to collaborate with you! We have two options available:

💰 **Option 1: Paid Sponsored Campaign**
• We offer CPM & rate-card based sponsored campaign fees (reply with your rate card or media kit!).

🛍️ **Option 2: Affiliate Collaboration & Free Gifting**
• **${commissionRate} Recurring Commission** on all sales driven through your creator link/code.
• **${buyerDiscount} Community Discount** code for your followers.
• **Free Product Box**: Shipped directly to your door — no upfront costs.

📩 **Next Steps:**
• Reply directly to this email with your media kit / rate card, OR
• Fill out our 1-minute creator application: https://makeable.nyc/creators/apply

Warmly,
${activeSenderName}
https://makeable.nyc`
        ];

        body = bodyTemplates[hash % bodyTemplates.length];
      }

      // C. Dispatch via Resend
      let sentSuccess = false;
      let logEntry = '';

      if (dryRun) {
        sentSuccess = true;
        logEntry = `[DRY RUN] Generated pitch for @${username} (${toEmail}) via ${activeSenderEmail}`;
      } else if (activeApiKey && activeApiKey.startsWith('re_')) {
        try {
          const resendClient = new Resend(activeApiKey);
          let formatted = body;

          // 1. Convert markdown link formats like [Apply Online](url) or [https://...](https://...)
          formatted = formatted.replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g, (match, text, url) => {
            if (url.includes('makeable.nyc/creators/apply')) {
              return `[[CTA_BUTTON]]`;
            }
            return `<a href="${url}" target="_blank" style="color: #4f46e5; font-weight: 600; text-decoration: underline;">${text}</a>`;
          });

          // 2. Convert bold **text** to <strong>
          formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong style="color: #0f172a; font-weight: 700;">$1</strong>');
          
          // 3. Convert bullet markers (* , - , • ) into clean styled bullets
          formatted = formatted.replace(/^[*•\-]\s+/gm, '<span style="color: #6366f1; font-weight: bold; margin-right: 6px;">•</span> ');
          
          // 4. Convert *text* to <em>
          formatted = formatted.replace(/(?<!\*)\*(?!\*)(.*?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
          
          // 5. Convert standalone apply URLs to CTA button placeholder
          formatted = formatted.replace(/https?:\/\/makeable\.nyc\/creators\/apply/g, `[[CTA_BUTTON]]`);
          
          // 6. Convert remaining URLs to clickable links
          formatted = formatted.replace(/(?<!href=")(https?:\/\/[^\s<]+)(?![^<]*>)/g, '<a href="$1" target="_blank" style="color: #4f46e5; font-weight: 600; text-decoration: underline;">$1</a>');
          
          const buttonHtml = `
            <div style="margin: 20px 0; text-align: left;">
              <a href="https://makeable.nyc/creators/apply" target="_blank" style="background-color: #6366f1; color: #ffffff !important; padding: 12px 24px; border-radius: 8px; font-weight: 700; font-size: 14px; text-decoration: none; display: inline-block; box-shadow: 0 4px 10px rgba(99, 102, 241, 0.3);">
                👉 Apply for Creator Collab Now
              </a>
            </div>
          `;

          if (formatted.includes('[[CTA_BUTTON]]')) {
            formatted = formatted.replace(/\[\[CTA_BUTTON\]\]/g, buttonHtml);
          }

          const paragraphs = formatted.split(/\n\n+/);
          const htmlBody = `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 15px; line-height: 1.65; color: #334155; max-width: 580px;">
              ${paragraphs.map(p => {
                if (p.includes('href="https://makeable.nyc/creators/apply"')) {
                  return p;
                }
                return `<p style="margin-bottom: 16px; margin-top: 0; line-height: 1.65;">${p.replace(/\n/g, '<br/>')}</p>`;
              }).join('')}
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
            logEntry = `✓ Sent to @${username} (${toEmail}) via [${activeSenderEmail}] (Cycle ${cycleNumber})`;
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

      if (sentSuccess) {
        state.sent += 1;
        burstCounter += 1;
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

      // Check if more emails remain
      if (i < pendingCreators.length - 1) {
        // D. Check if we just completed a BURST cycle
        if (enableIntervalCycles && burstCounter >= burstSize) {
          burstCounter = 0;
          cycleNumber += 1;
          const nextCycleDate = new Date(Date.now() + cooldownMinutes * 60 * 1000);
          
          state.isCooldown = true;
          state.nextCycleAt = nextCycleDate.toISOString();
          state.currentCycle = cycleNumber;
          state.statusMessage = `Burst completed! Cooldown active: next cycle (${cycleNumber}/${calculatedTotalCycles}) starts in ${cooldownMinutes} min...`;
          saveBatchState(state);

          console.log(`[Interval Automation] Cooldown initiated. Sleeping ${cooldownMinutes} minutes until next burst cycle (${nextCycleDate.toLocaleTimeString()})...`);

          const canContinue = await sleepWithCheck(cooldownMinutes * 60 * 1000, (remainingSec) => {
            const mins = Math.floor(remainingSec / 60);
            const secs = remainingSec % 60;
            state = getBatchState();
            state.statusMessage = `⏳ Interval cooldown: Next burst starts in ${mins}m ${secs < 10 ? '0' : ''}${secs}s (Cycle ${cycleNumber}/${calculatedTotalCycles})...`;
            saveBatchState(state);
          });

          if (!canContinue) {
            state.isRunning = false;
            state.isCooldown = false;
            state.statusMessage = `Outreach stopped by user during interval cooldown.`;
            saveBatchState(state);
            return;
          }

          state.isCooldown = false;
          state.nextCycleAt = null;
          state.statusMessage = `Resuming Cycle ${cycleNumber}/${calculatedTotalCycles}...`;
          saveBatchState(state);

        } else {
          // Standard pacing delay between individual emails in a burst
          const sleepSeconds = Math.floor(Math.random() * (maxSleepSeconds - minSleepSeconds + 1)) + minSleepSeconds;
          state.statusMessage = `Pacing delay (${sleepSeconds}s anti-spam sleep) before next creator...`;
          saveBatchState(state);
          console.log(`[Node Background Outreach] Sleeping ${sleepSeconds}s before next email...`);
          
          const canContinue = await sleepWithCheck(sleepSeconds * 1000);
          if (!canContinue) {
            state.isRunning = false;
            state.statusMessage = `Outreach stopped by user during pacing delay.`;
            saveBatchState(state);
            return;
          }
        }
      }
    }

    state.isRunning = false;
    state.isCooldown = false;
    state.statusMessage = `All outreach cycles completed! Dispatched ${state.sent} / ${state.total} outreach emails.`;
    saveBatchState(state);

  } catch (err: any) {
    console.error('Background batch execution error:', err);
    state.isRunning = false;
    state.isCooldown = false;
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
      state.isRunning = false;
      state.isCooldown = false;
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
      rotationInterval = 5,
      enableIntervalCycles = false,
      burstSize = 10,
      cooldownMinutes = 30
    } = body;

    const currentState = getBatchState();
    if (currentState.isRunning) {
      return NextResponse.json({
        success: true,
        message: 'A batch is already actively running in the background.',
        state: currentState
      });
    }

    const totalCycles = enableIntervalCycles ? Math.ceil(limit / burstSize) : 1;

    // Initialize state
    const newState = {
      isRunning: true,
      isCooldown: false,
      nextCycleAt: null,
      currentCycle: 1,
      totalCycles,
      total: limit,
      sent: 0,
      failed: 0,
      currentCreator: 'Initializing...',
      currentSender: '',
      statusMessage: enableIntervalCycles 
        ? `Starting scheduled cycle engine: sending ${burstSize} emails every ${cooldownMinutes} min (${totalCycles} cycles)...`
        : `Starting background batch for ${limit} creators (Mode: ${senderMode === 'rotate' ? 'Auto-Rotate 5/domain' : senderMode})...`,
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
      rotationInterval,
      enableIntervalCycles,
      burstSize,
      cooldownMinutes
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


