import { NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import { Resend } from 'resend';
import { recordEmailSent } from '@/lib/creators-storage';
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
    let senderName = customSenderName || process.env.SENDER_NAME || signature?.senderName || 'MakeAble Partnerships';
    let senderEmail = customSenderEmail || process.env.SENDER_EMAIL || 'partnerships@makeable.info';
    let resendApiKey = process.env.RESEND_API_KEY;

    // Pick matching account key if customSenderEmail belongs to account 2
    if (customSenderEmail) {
      const matched = accounts.find(a => customSenderEmail.trim().toLowerCase().includes(a.senderEmail.split('@')[1] || ''));
      if (matched) {
        resendApiKey = matched.apiKey;
        senderName = customSenderName || matched.senderName;
      }
    }

    // Append signature if present and not already at end of body
    let finalBody = body;
    if (signature && signature.senderName && !body.includes(signature.senderName)) {
      finalBody += `\n\n---\n${signature.senderName}\n${signature.title ? signature.title + ' | ' : ''}${signature.brandName}\n${signature.website}\n${signature.phone || ''}`;
    }

    // Helper to convert markdown text to rich email HTML
    const renderEmailToHtml = (rawText: string) => {
      let formatted = rawText;

      // 1. Convert bold **text** to <strong>
      formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong style="color: #0f172a; font-weight: 700;">$1</strong>');
      
      // 2. Convert bullet markers (* , - , • ) into clean styled bullets
      formatted = formatted.replace(/^[*\-•]\s+/gm, '<span style="color: #6366f1; font-weight: bold; margin-right: 6px;">•</span> ');
      
      // 3. Convert *text* to <em>
      formatted = formatted.replace(/(?<!\*)\*(?!\*)(.*?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
      
      // 4. Convert URLs to clickable links
      formatted = formatted.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" style="color: #4f46e5; font-weight: 600; text-decoration: underline;">$1</a>');
      
      // 5. Split by paragraphs and style
      const paragraphs = formatted.split(/\n\n+/);
      return `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 15px; line-height: 1.65; color: #334155; max-width: 580px; margin: 0 auto;">
          ${paragraphs.map(p => `<p style="margin-bottom: 16px; margin-top: 0; line-height: 1.65;">${p.replace(/\n/g, '<br/>')}</p>`).join('')}
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
