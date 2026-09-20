import { NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import { Resend } from 'resend';
import { recordEmailSent } from '../../../lib/creators-storage';
import { getConfiguredSenders } from '../automated-outreach/route';

export async function POST(req: Request) {
  try {
    const {
      toEmail,
      toName,
      username,
      subject,
      body,
      signature,
      customSenderEmail,
      customSenderName
    } = await req.json();

    if (!toEmail || !subject || !body) {
      return NextResponse.json(
        { success: false, error: 'Missing recipient email, subject, or message body.' },
        { status: 400 }
      );
    }

    const accounts = getConfiguredSenders();
    let resendApiKey = process.env.RESEND_API_KEY_2 || (accounts.length > 0 ? accounts[0].apiKey : '');
    
    let senderName = customSenderName || process.env.SENDER_NAME || signature?.senderName || 'MakeAble Partnerships';
    let senderEmail = customSenderEmail || (accounts.length > 0 ? accounts[0].senderEmail : 'collab@makeable.work');

    // Pick matching account key and details if customSenderEmail belongs to one of our 3 active senders
    if (customSenderEmail && accounts.length > 0) {
      const domainPart = customSenderEmail.trim().toLowerCase().split('@')[1] || '';
      const matched = accounts.find(a => a.senderEmail.toLowerCase().includes(domainPart));
      if (matched) {
        resendApiKey = matched.apiKey;
        senderName = customSenderName || matched.senderName;
        senderEmail = matched.senderEmail;
      }
    }

    // Append signature if present and not already at end of body
    let finalBody = body;
    if (signature && signature.senderName && !body.includes(signature.senderName)) {
      finalBody += `\n\n---\n${signature.senderName}\n${signature.title ? signature.title + ' | ' : ''}${signature.brandName}\n${signature.website}\n${signature.phone || ''}`;
    }

    // Helper to convert markdown text to rich email HTML with CTA Button
    const renderEmailToHtml = (rawText: string) => {
      let formatted = rawText;

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

      // 7. Split by paragraphs and style
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

    const replyToEmail = process.env.REPLY_TO_EMAIL || 'support@makeable.nyc';

    // 1. Try Resend API if API Key is configured
    if (resendApiKey && resendApiKey.startsWith('re_')) {
      const resend = new Resend(resendApiKey);
      const resendData = await resend.emails.send({
        from: `${senderName} <${senderEmail}>`,
        to: [toEmail],
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
    // 2. Try Custom SMTP / Nodemailer if configured
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
        subject: subject,
        text: finalBody,
        html: htmlBody,
      });

      messageId = info.messageId;
      methodUsed = 'Custom Domain SMTP (Nodemailer)';
    } 
    // 3. Simulated Demo Mode if keys are not yet configured in .env
    else {
      messageId = `simulated-${Date.now()}`;
      methodUsed = 'Simulated Delivery (Add RESEND_API_KEY or SMTP credentials in .env for live dispatch)';
    }

    // Permanently record sent email in local master JSON, registry, and Supabase
    await recordEmailSent({
      username: username || '',
      email: toEmail,
      subject: subject,
      body: finalBody,
      messageId
    });

    const nowIso = new Date().toISOString();

    return NextResponse.json({
      success: true,
      messageId,
      methodUsed,
      sentAt: nowIso,
      toEmail,
      username
    });

  } catch (error: any) {
    console.error('Send Email Error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to send email' },
      { status: 500 }
    );
  }
}


