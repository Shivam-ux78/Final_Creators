import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import fs from 'fs';
import path from 'path';
import { recordEmailSent, getTodaySentCountFromSupabase, getDailyLimitInfo } from '../../../../lib/creators-storage';

// 3 Configured Sender Domains
const SENDER_ACCOUNTS = [
  {
    id: 'sender_1',
    senderName: 'MakeAble Partnerships',
    senderEmail: 'collab@makeable.work',
    label: 'Domain 1: collab@makeable.work'
  },
  {
    id: 'sender_2',
    senderName: 'MakeAble Partnerships',
    senderEmail: 'collab@makeable.website',
    label: 'Domain 2: collab@makeable.website'
  },
  {
    id: 'sender_3',
    senderName: 'MakeAble Partnerships',
    senderEmail: 'collab@makeable.online',
    label: 'Domain 3: collab@makeable.online'
  }
];

// Persistent state files
const ROTATION_FILE = path.join(process.cwd(), '.sender_rotation_v1.json');
const PRESET_SUBJECTS_FILE = path.join(process.cwd(), '.preset_subjects.json');

const DEFAULT_PRESET_SUBJECTS = [
  'Paid Collab & Partnership Offer ✨',
  'MakeAble x Creator Partnership — Sponsored & Affiliate Offer 🤝',
  'Exclusive Creator Collab (Paid Sponsorship + Free Gifting Kit) 📦'
];

// Helper to read current preset subjects
function getPresetSubjects(): string[] {
  try {
    if (fs.existsSync(PRESET_SUBJECTS_FILE)) {
      const raw = fs.readFileSync(PRESET_SUBJECTS_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.subjects) && parsed.subjects.length > 0) {
        return parsed.subjects.filter((s: any) => typeof s === 'string' && s.trim().length > 0);
      }
    }
  } catch (e) {
    console.warn('Error reading preset subjects file:', e);
  }
  return DEFAULT_PRESET_SUBJECTS;
}

// Helper to save updated preset subjects
function savePresetSubjects(subjects: string[]): boolean {
  try {
    const cleanSubjects = subjects
      .filter(s => typeof s === 'string' && s.trim().length > 0)
      .map(s => s.trim());

    if (cleanSubjects.length === 0) return false;

    fs.writeFileSync(
      PRESET_SUBJECTS_FILE,
      JSON.stringify({ subjects: cleanSubjects, updatedAt: new Date().toISOString() }, null, 2),
      'utf-8'
    );
    return true;
  } catch (e) {
    console.warn('Error saving preset subjects file:', e);
    return false;
  }
}

// Helper for round robin rotation (1 -> 2 -> 3 -> 1 -> 2 -> 3...)
function getNextRotatedSender() {
  let lastIndex = -1;
  try {
    if (fs.existsSync(ROTATION_FILE)) {
      const raw = fs.readFileSync(ROTATION_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      lastIndex = typeof parsed.lastIndex === 'number' ? parsed.lastIndex : -1;
    }
  } catch (e) {
    lastIndex = -1;
  }

  const nextIndex = (lastIndex + 1) % SENDER_ACCOUNTS.length;

  try {
    fs.writeFileSync(
      ROTATION_FILE,
      JSON.stringify({ lastIndex: nextIndex, lastUpdatedAt: new Date().toISOString() }, null, 2),
      'utf-8'
    );
  } catch (e) {
    console.warn('Error saving rotation state:', e);
  }

  return {
    step: nextIndex + 1, // 1, 2, or 3
    totalSenders: SENDER_ACCOUNTS.length,
    sender: SENDER_ACCOUNTS[nextIndex]
  };
}

// GET: Check Status, Rotation & Preset Subjects Config
export async function GET() {
  try {
    const todaySentCount = await getTodaySentCountFromSupabase();
    const { totalDailyLimit } = getDailyLimitInfo();
    const presetSubjects = getPresetSubjects();

    let lastIndex = 0;
    try {
      if (fs.existsSync(ROTATION_FILE)) {
        const parsed = JSON.parse(fs.readFileSync(ROTATION_FILE, 'utf-8'));
        lastIndex = parsed.lastIndex ?? 0;
      }
    } catch (e) {}

    return NextResponse.json({
      success: true,
      service: 'MakeAble Round-Robin Mail Sender API v1',
      rotationOrder: ['collab@makeable.work', 'collab@makeable.website', 'collab@makeable.online'],
      currentNextSender: SENDER_ACCOUNTS[(lastIndex + 1) % SENDER_ACCOUNTS.length].senderEmail,
      presetSubjects,
      todaySentCount,
      dailyLimit: totalDailyLimit,
      remainingQuota: Math.max(0, totalDailyLimit - todaySentCount)
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to fetch status' },
      { status: 500 }
    );
  }
}

// PUT: Update Preset Subjects List
export async function PUT(req: Request) {
  try {
    const body = await req.json();
    const { subjects } = body;

    if (!Array.isArray(subjects) || subjects.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Please provide a non-empty array of preset subject strings under "subjects".' },
        { status: 400 }
      );
    }

    const saved = savePresetSubjects(subjects);
    if (!saved) {
      return NextResponse.json(
        { success: false, error: 'Failed to write updated preset subjects.' },
        { status: 500 }
      );
    }

    const updated = getPresetSubjects();
    return NextResponse.json({
      success: true,
      message: 'Preset subjects list successfully updated.',
      presetSubjects: updated
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to update preset subjects' },
      { status: 500 }
    );
  }
}

// POST: Public API Endpoint for Sending Email with Automatic 1->2->3 Rotation OR Updating Presets
export async function POST(req: Request) {
  try {
    const bodyData = await req.json().catch(() => ({}));

    // Handle Config Update Action via POST
    if (bodyData.action === 'update_presets' || (Array.isArray(bodyData.subjects) && !bodyData.toEmail && !bodyData.to_email)) {
      const { subjects } = bodyData;
      if (!Array.isArray(subjects) || subjects.length === 0) {
        return NextResponse.json(
          { success: false, error: 'Please provide a non-empty array of subject lines.' },
          { status: 400 }
        );
      }
      savePresetSubjects(subjects);
      return NextResponse.json({
        success: true,
        message: 'Preset subjects successfully updated.',
        presetSubjects: getPresetSubjects()
      });
    }

    const {
      toEmail,
      to_email,
      body,
      message,
      subject,
      subjectLine,
      subject_line,
      username
    } = bodyData;

    const recipientEmail = (toEmail || to_email || '').trim();
    const messageBody = (body || message || '').trim();
    const userSubject = (subject || subjectLine || subject_line || '').trim();

    if (!recipientEmail || !messageBody) {
      return NextResponse.json(
        {
          success: false,
          error: 'Missing required parameters. Please provide "toEmail" (or "to_email") and "body" (or "message").',
          examplePayload: {
            toEmail: 'creator@example.com',
            subject: 'Custom Subject Line Here (Optional)',
            body: 'Hi, we would love to collaborate with you!'
          }
        },
        { status: 400 }
      );
    }

    // 1. Daily Limit Check
    const { totalDailyLimit } = getDailyLimitInfo();
    const todaySentCount = await getTodaySentCountFromSupabase();
    if (todaySentCount >= totalDailyLimit) {
      return NextResponse.json(
        {
          success: false,
          error: `Daily limit of ${totalDailyLimit} emails reached for today. Engine paused to protect domain reputation.`,
          todaySentCount,
          dailyLimit: totalDailyLimit,
          remainingQuota: 0
        },
        { status: 429 }
      );
    }

    // 2. Perform 1 -> 2 -> 3 Round Robin Sender Rotation
    const { step, totalSenders, sender } = getNextRotatedSender();

    // 3. Resolve Subject Line (User-provided subject takes priority; fallback to rotating preset list)
    const presetSubjects = getPresetSubjects();
    const finalSubject = userSubject || presetSubjects[(step - 1) % presetSubjects.length];

    // 4. Resolve API Key & HTML rendering
    const resendApiKey = process.env.RESEND_API_KEY_2 || process.env.RESEND_API_KEY || '';
    const replyToEmail = process.env.REPLY_TO_EMAIL || 'support@makeable.nyc';

    const renderEmailToHtml = (rawText: string) => {
      let formatted = rawText;

      formatted = formatted.replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g, (match, text, url) => {
        if (url.includes('makeable.nyc/creators/apply')) {
          return `[[CTA_BUTTON]]`;
        }
        return `<a href="${url}" target="_blank" style="color: #4f46e5; font-weight: 600; text-decoration: underline;">${text}</a>`;
      });

      formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong style="color: #0f172a; font-weight: 700;">$1</strong>');
      formatted = formatted.replace(/^[*•\-]\s+/gm, '<span style="color: #6366f1; font-weight: bold; margin-right: 6px;">•</span> ');
      formatted = formatted.replace(/(?<!\*)\*(?!\*)(.*?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
      formatted = formatted.replace(/https?:\/\/makeable\.nyc\/creators\/apply/g, `[[CTA_BUTTON]]`);
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
      return `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 15px; line-height: 1.65; color: #334155; max-width: 580px; margin: 0 auto;">
          ${paragraphs.map(p => {
            if (p.includes('href="https://makeable.nyc/creators/apply"')) {
              return p;
            }
            return `<p style="margin-bottom: 16px; margin-top: 0; line-height: 1.65;">${p.replace(/\n/g, '<br/>')}</p>`;
          }).join('')}
        </div>
      `;
    };

    const htmlBody = renderEmailToHtml(messageBody);
    let messageId = '';
    let methodUsed = '';

    // 5. Send Email via Resend
    if (resendApiKey && resendApiKey.startsWith('re_')) {
      const resend = new Resend(resendApiKey);
      const resendData = await resend.emails.send({
        from: `${sender.senderName} <${sender.senderEmail}>`,
        to: [recipientEmail],
        replyTo: replyToEmail,
        reply_to: replyToEmail as any,
        headers: {
          'Reply-To': replyToEmail
        },
        subject: finalSubject,
        html: htmlBody,
        text: messageBody
      } as any);

      if (resendData.error) {
        throw new Error(`Resend Error: ${resendData.error.message}`);
      }
      messageId = resendData.data?.id || `resend-${Date.now()}`;
      methodUsed = `Resend API via ${sender.senderEmail}`;
    } else {
      messageId = `simulated-${Date.now()}`;
      methodUsed = `Simulated Rotation Mode (${sender.senderEmail})`;
    }

    // 6. Record sent email in Supabase Database
    await recordEmailSent({
      username: username || (recipientEmail.split('@')[0] || ''),
      email: recipientEmail,
      subject: finalSubject,
      body: messageBody,
      messageId,
      senderEmail: sender.senderEmail
    });

    const nowIso = new Date().toISOString();
    const newTodaySentCount = todaySentCount + 1;

    return NextResponse.json({
      success: true,
      messageId,
      senderEmail: sender.senderEmail,
      rotationStep: `Domain ${step} of ${totalSenders}`,
      nextDomainWillBe: SENDER_ACCOUNTS[step % totalSenders].senderEmail,
      sentAt: nowIso,
      toEmail: recipientEmail,
      subject: finalSubject,
      todaySentCount: newTodaySentCount,
      dailyLimit: totalDailyLimit,
      remainingQuota: Math.max(0, totalDailyLimit - newTodaySentCount)
    });

  } catch (error: any) {
    console.error('v1 Send Mail API Error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to send email' },
      { status: 500 }
    );
  }
}
