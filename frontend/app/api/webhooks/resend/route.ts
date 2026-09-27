import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { updateEmailDeliveryStatus } from '../../../../lib/creators-storage';

export const dynamic = 'force-dynamic';

const TIMESTAMP_TOLERANCE_SECONDS = 5 * 60;

// Resend signs webhooks with Svix. Verify svix-signature over "<id>.<timestamp>.<raw body>"
// using RESEND_WEBHOOK_SECRET (whsec_...), so nobody can post fake bounce/delivery events.
function verifyResendSignature(req: Request, rawBody: string): string | null {
  const secret = process.env.RESEND_WEBHOOK_SECRET || '';
  if (!secret) return 'RESEND_WEBHOOK_SECRET is not configured on the server.';

  const svixId = req.headers.get('svix-id');
  const svixTimestamp = req.headers.get('svix-timestamp');
  const svixSignature = req.headers.get('svix-signature');
  if (!svixId || !svixTimestamp || !svixSignature) return 'Missing webhook signature headers.';

  const timestamp = parseInt(svixTimestamp, 10);
  if (isNaN(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > TIMESTAMP_TOLERANCE_SECONDS) {
    return 'Webhook timestamp is too old or invalid.';
  }

  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const expected = crypto.createHmac('sha256', key).update(`${svixId}.${svixTimestamp}.${rawBody}`).digest('base64');
  const expectedBuf = Buffer.from(expected);

  // Header holds space-separated "v1,<signature>" entries (multiple during secret rotation)
  const matches = svixSignature.split(' ').some(entry => {
    const [version, signature] = entry.split(',');
    if (version !== 'v1' || !signature) return false;
    const sigBuf = Buffer.from(signature);
    return sigBuf.length === expectedBuf.length && crypto.timingSafeEqual(sigBuf, expectedBuf);
  });

  return matches ? null : 'Invalid webhook signature.';
}

// POST /api/webhooks/resend - Real-Time Resend Event Webhook Handler
export async function POST(req: Request) {
  try {
    const rawBody = await req.text();
    const signatureError = verifyResendSignature(req, rawBody);
    if (signatureError) {
      return NextResponse.json({ success: false, error: signatureError }, { status: 401 });
    }

    const payload = JSON.parse(rawBody || '{}');
    const eventType = payload.type; // 'email.delivered', 'email.bounced', 'email.complained', 'email.opened'
    const eventData = payload.data || {};

    const messageId = eventData.email_id;
    const recipientEmail = Array.isArray(eventData.to) ? eventData.to[0] : eventData.to;

    if (!eventType) {
      return NextResponse.json({ success: false, error: 'Event type missing' }, { status: 400 });
    }

    const statusByEvent: Record<string, 'sent' | 'delivered' | 'bounced' | 'complained' | 'opened' | 'clicked' | 'failed'> = {
      'email.sent': 'sent',
      'email.delivered': 'delivered',
      'email.bounced': 'bounced',
      'email.complained': 'complained',
      'email.opened': 'opened',
      'email.clicked': 'clicked',
      'email.failed': 'failed'
    };
    const status = statusByEvent[eventType];
    if (!status) {
      // Acknowledge events we don't track (e.g. email.delivery_delayed) so Resend doesn't retry
      return NextResponse.json({ success: true, ignoredEvent: eventType });
    }

    let bounceReason = '';
    if (status === 'bounced') {
      bounceReason = eventData.bounce?.message || eventData.bounce?.type || 'Email hard bounced';
    } else if (status === 'complained') {
      bounceReason = 'Spam complaint recorded';
    }

    console.log(`[Resend Webhook] Event: ${eventType}, MessageId: ${messageId}`);

    await updateEmailDeliveryStatus({
      messageId,
      email: recipientEmail,
      status,
      reason: bounceReason
    });

    return NextResponse.json({
      success: true,
      receivedEvent: eventType,
      messageId,
      updatedStatus: status
    });
  } catch (error: any) {
    console.error('Resend Webhook Error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Webhook processing failed' },
      { status: 500 }
    );
  }
}

// GET /api/webhooks/resend - Verification ping
export async function GET() {
  return NextResponse.json({
    success: true,
    service: 'MakeAble Resend Webhook Receiver',
    webhookUrl: 'https://creators.makeable.nyc/api/webhooks/resend',
    signatureVerification: process.env.RESEND_WEBHOOK_SECRET ? 'enabled' : 'NOT CONFIGURED - set RESEND_WEBHOOK_SECRET',
    supportedEvents: ['email.sent', 'email.delivered', 'email.bounced', 'email.complained', 'email.opened', 'email.clicked', 'email.failed']
  });
}
