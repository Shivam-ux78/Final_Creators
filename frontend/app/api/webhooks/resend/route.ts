import { NextResponse } from 'next/server';
import { updateEmailDeliveryStatus } from '../../../../lib/creators-storage';

// POST /api/webhooks/resend - Real-Time Resend Event Webhook Handler
export async function POST(req: Request) {
  try {
    const payload = await req.json().catch(() => ({}));
    const eventType = payload.type || payload.event; // 'email.delivered', 'email.bounced', 'email.complained', 'email.opened'
    const eventData = payload.data || payload;

    const messageId = eventData.email_id || eventData.id || eventData.message_id;
    const recipientEmail = Array.isArray(eventData.to) ? eventData.to[0] : (eventData.to || eventData.recipient);

    if (!eventType) {
      return NextResponse.json({ success: false, error: 'Event type missing' }, { status: 400 });
    }

    console.log(`[Resend Webhook] Event: ${eventType}, MessageId: ${messageId}, To: ${recipientEmail}`);

    let status: 'sent' | 'delivered' | 'bounced' | 'complained' | 'opened' | 'clicked' | 'failed' = 'sent';
    let bounceReason = '';

    if (eventType === 'email.delivered') {
      status = 'delivered';
    } else if (eventType === 'email.bounced') {
      status = 'bounced';
      bounceReason = eventData.bounce?.type || eventData.bounce?.message || 'Email hard bounced';
    } else if (eventType === 'email.complained') {
      status = 'complained';
      bounceReason = 'Spam complaint recorded';
    } else if (eventType === 'email.opened') {
      status = 'opened';
    } else if (eventType === 'email.clicked') {
      status = 'clicked';
    } else if (eventType === 'email.failed') {
      status = 'failed';
    }

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
      recipientEmail,
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
    supportedEvents: ['email.delivered', 'email.bounced', 'email.complained', 'email.opened', 'email.clicked']
  });
}
