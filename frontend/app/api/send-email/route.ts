import { NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import { Resend } from 'resend';
import { recordEmailSent, getTodaySentCountFromSupabase, getDailyLimitInfo } from '../../../lib/creators-storage';
import { getDashboardSenders } from '../../../lib/senders-config';
import { resolveCopyRecipients } from '../../../lib/recipients';

// GET: Check live daily email sending stats, limit, and remaining quota
export async function GET() {
  try {
    const todaySentCount = await getTodaySentCountFromSupabase();
    const { limitPerDomain, totalDailyLimit } = getDailyLimitInfo();
    const senders = getDashboardSenders();

    return NextResponse.json({
      success: true,
      todaySentCount,
      defaultDailyLimit: totalDailyLimit,
      limitPerDomain,
      remainingQuota: Math.max(0, totalDailyLimit - todaySentCount),
      configuredSenders: senders.map(s => ({
        id: s.id,
        email: s.senderEmail,
        label: s.label
      }))
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to fetch mail sender status' },
      { status: 500 }
    );
  }
}

// POST: API-based mail sender endpoint
export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get('authorization');
    const xApiKeyHeader = req.headers.get('x-api-key');

    const bodyData = await req.json().catch(() => ({}));
    const {
      toEmail,
      toName,
      username,
      subject,
      body,
      signature,
      customSenderEmail,
      customSenderName,
      replyTo,
      reply_to,
      cc,
      bcc,
      apiKey: apiKeyInBody,
      resendApiKey: resendKeyInBody,
      dailyLimit: customDailyLimit
    } = bodyData;

    if (!toEmail || !subject || !body) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: toEmail, subject, or body.' },
        { status: 400 }
      );
    }

    // CC / BCC: validate, de-duplicate, drop suppressed addresses
    const copies = await resolveCopyRecipients(toEmail, cc, bcc);
    if (copies.error) {
      return NextResponse.json({ success: false, error: copies.error }, { status: 400 });
    }

    // 1. Enforce Daily Sending Limit
    const { totalDailyLimit: defaultLimit } = getDailyLimitInfo();
    const activeDailyLimit = typeof customDailyLimit === 'number' && customDailyLimit > 0 
      ? customDailyLimit 
      : defaultLimit;

    const todaySentCount = await getTodaySentCountFromSupabase();
    if (todaySentCount >= activeDailyLimit) {
      return NextResponse.json(
        {
          success: false,
          error: `Daily email sending limit of ${activeDailyLimit} reached for today.`,
          todaySentCount,
          dailyLimit: activeDailyLimit,
          remainingQuota: 0
        },
        { status: 429 }
      );
    }

    // 2. Resolve API Key & Senders (Support header key, payload key, or server default)
    const providedApiKey = apiKeyInBody || resendKeyInBody || xApiKeyHeader || (authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : '');
    const accounts = getDashboardSenders();

    let resendApiKey = providedApiKey || process.env.RESEND_API_KEY_2 || (accounts.length > 0 ? accounts[0].apiKey : '');
    let senderName = customSenderName || process.env.SENDER_NAME || signature?.senderName || 'MakeAble Partnerships';
    let senderEmail = customSenderEmail || (accounts.length > 0 ? accounts[0].senderEmail : 'collab@makeable.work');

    if (customSenderEmail && accounts.length > 0) {
      const wanted = customSenderEmail.trim().toLowerCase();
      const [localPart = '', domainPart = ''] = wanted.split('@');
      // Any name before @ is allowed, but only on a verified sending domain
      if (!/^[a-z0-9](?:[a-z0-9._+-]{0,62}[a-z0-9])?$/.test(localPart)) {
        return NextResponse.json(
          { success: false, error: `Invalid sender name "${localPart}". Use letters, numbers, dot, dash, underscore or plus.` },
          { status: 400 }
        );
      }
      if (!accounts.some(a => a.senderEmail.toLowerCase().endsWith(`@${domainPart}`))) {
        return NextResponse.json(
          { success: false, error: `Domain "${domainPart}" is not a verified sending domain.` },
          { status: 400 }
        );
      }
      // Exact address first; fall back to same-domain account only for its API key,
      // keeping the address the user actually picked.
      const matched =
        accounts.find(a => a.senderEmail.toLowerCase() === wanted) ||
        accounts.find(a => a.senderEmail.toLowerCase().endsWith(`@${domainPart}`));
      if (matched) {
        if (!providedApiKey) resendApiKey = matched.apiKey;
        senderName = customSenderName || matched.senderName;
        senderEmail = wanted;
      }
    }

    // Append signature if present and not already at end of body
    let finalBody = body;
    // includeFooter === false lets the user send with their own custom footer instead
    if (bodyData.includeFooter !== false && signature && signature.senderName && !body.includes(signature.senderName)) {
      finalBody += `\n\n---\n${signature.senderName}\n${signature.title ? signature.title + ' | ' : ''}${signature.brandName}\n${signature.website}\n${signature.phone || ''}`;
    }

    // Helper to convert markdown text to rich email HTML
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

    const htmlBody = renderEmailToHtml(finalBody);

    let messageId = '';
    let methodUsed = '';
    const requestedReplyTo = (replyTo || reply_to || '').trim();
    const isHr = /^(hr|careers|talent|hiring|recruiting|people|jobs)@/i.test(senderEmail);
    const replyToEmail = requestedReplyTo || (isHr ? senderEmail : (process.env.REPLY_TO_EMAIL || 'support@makeable.nyc'));

    // 1. Try Resend API
    if (resendApiKey && resendApiKey.startsWith('re_')) {
      const resend = new Resend(resendApiKey);
      const resendData = await resend.emails.send({
        from: `${senderName} <${senderEmail}>`,
        to: [toEmail],
        ...(copies.cc.length ? { cc: copies.cc } : {}),
        ...(copies.bcc.length ? { bcc: copies.bcc } : {}),
        replyTo: replyToEmail,
        reply_to: replyToEmail as any,
        headers: {
          'Reply-To': replyToEmail
        },
        subject: subject,
        html: htmlBody,
        text: finalBody,
      } as any);

      if (resendData.error) {
        throw new Error(`Resend error: ${resendData.error.message}`);
      }
      messageId = resendData.data?.id || 'resend-sent';
      methodUsed = `Resend API (${senderEmail})`;
    } 
    // 2. Try Custom SMTP / Nodemailer (Connected Gmail)
    else if (process.env.SMTP_USER && process.env.SMTP_PASS) {
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: Number(process.env.SMTP_PORT) || 587,
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });

      const info = await transporter.sendMail({
        from: `"${senderName}" <${process.env.SMTP_USER}>`,
        to: toEmail,
        ...(copies.cc.length ? { cc: copies.cc } : {}),
        ...(copies.bcc.length ? { bcc: copies.bcc } : {}),
        replyTo: replyToEmail,
        headers: {
          'Reply-To': replyToEmail
        },
        subject: subject,
        text: finalBody,
        html: htmlBody,
      });

      messageId = info.messageId;
      methodUsed = `Custom Domain SMTP via ${process.env.SMTP_USER} (Reply-To: ${replyToEmail})`;
    } 
    // 3. Simulated Demo Mode
    else {
      messageId = `simulated-${Date.now()}`;
      methodUsed = 'Simulated Delivery (Add Resend API Key or SMTP credentials)';
    }

    // Permanently record sent email in Supabase database
    await recordEmailSent({
      username: username || '',
      email: toEmail,
      subject: subject,
      body: finalBody,
      messageId,
      senderEmail
    });

    const nowIso = new Date().toISOString();
    const newTodaySentCount = todaySentCount + 1;

    return NextResponse.json({
      success: true,
      messageId,
      methodUsed,
      sentAt: nowIso,
      toEmail,
      cc: copies.cc,
      bcc: copies.bcc,
      ...(copies.skipped.length ? { skippedCopyRecipients: copies.skipped } : {}),
      username: username || null,
      senderEmail,
      todaySentCount: newTodaySentCount,
      dailyLimit: activeDailyLimit,
      remainingQuota: Math.max(0, activeDailyLimit - newTodaySentCount)
    });

  } catch (error: any) {
    console.error('Send Email Error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to send email' },
      { status: 500 }
    );
  }
}


