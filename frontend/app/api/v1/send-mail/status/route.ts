import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { Resend } from 'resend';
import { supabase } from '../../../../../lib/supabase';
import { getSupabaseAdmin } from '../../../../../lib/supabase-admin';
import { updateEmailDeliveryStatus } from '../../../../../lib/creators-storage';
import { isActiveApiKeyAsync } from '../../../../../lib/api-keys-storage';
import { verifySessionToken, AUTH_COOKIE_NAME } from '../../../../../lib/auth';

export const dynamic = 'force-dynamic';

const DELIVERED_STATUSES = ['delivered', 'opened', 'clicked'];
const FAILED_STATUSES = ['bounced', 'failed', 'complained', 'canceled'];

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, m => '\\' + m);
}

// GET /api/v1/send-mail/status?messageId=<resend id> or ?email=creator@example.com
// Requires a valid API key (x-api-key / Bearer) or a dashboard session.
export async function GET(req: Request) {
  try {
    const authHeader = req.headers.get('authorization');
    const providedKey = req.headers.get('x-api-key') || (authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : '');
    const hasSession = verifySessionToken(cookies().get(AUTH_COOKIE_NAME)?.value).valid;
    if (!hasSession && !(await isActiveApiKeyAsync(providedKey))) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized. Provide a valid API Key via the x-api-key header.' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(req.url);
    const messageIdParam = searchParams.get('messageId') || searchParams.get('message_id') || searchParams.get('id');
    const emailParam = (searchParams.get('email') || searchParams.get('toEmail') || '').trim().toLowerCase();

    if (!messageIdParam && !emailParam) {
      return NextResponse.json(
        { success: false, error: 'Please provide messageId or email (e.g. ?email=creator@example.com)' },
        { status: 400 }
      );
    }

    // 1. Latest send log (email_logs is the record of every send)
    const logsQuery = getSupabaseAdmin().from('email_logs').select('*');
    const { data: logRecord } = messageIdParam
      ? await logsQuery.eq('message_id', messageIdParam).maybeSingle()
      : await logsQuery.eq('recipient_email', emailParam).order('sent_at', { ascending: false }).limit(1).maybeSingle();

    const messageId = messageIdParam || logRecord?.message_id || null;

    // 2. Ask Resend for live delivery state (skip simulated sends)
    const resendApiKey = process.env.RESEND_API_KEY_2 || process.env.RESEND_API_KEY || '';
    let liveResendStatus: any = null;
    let liveLookupError: string | null = null;

    if (messageId && !messageId.startsWith('simulated-') && resendApiKey.startsWith('re_')) {
      const resendRes = await new Resend(resendApiKey).emails.get(messageId)
        .catch((e: any) => ({ data: null, error: { message: e?.message || 'Resend unreachable' } }));
      if (resendRes.data) {
        liveResendStatus = resendRes.data;
        const liveState = resendRes.data.last_event;
        if (liveState && liveState !== logRecord?.status) {
          await updateEmailDeliveryStatus({
            messageId,
            email: Array.isArray(resendRes.data.to) ? resendRes.data.to[0] : (resendRes.data.to as any),
            status: liveState as any
          });
        }
      } else {
        liveLookupError = resendRes.error?.message || 'Resend lookup failed';
      }
    }

    // 3. Creator record, if the recipient is a known creator
    const targetEmail = emailParam || logRecord?.recipient_email || '';
    let creatorRecord: any = null;
    if (targetEmail) {
      const { data } = await supabase
        .from('creators')
        .select('username, email, email_status, last_emailed_at')
        .ilike('email', escapeLike(targetEmail))
        .limit(1)
        .maybeSingle();
      creatorRecord = data;
    }

    const finalStatus = liveResendStatus?.last_event || logRecord?.status || creatorRecord?.email_status || 'unknown';

    return NextResponse.json({
      success: true,
      messageId,
      recipientEmail: targetEmail || null,
      status: finalStatus,
      isDelivered: DELIVERED_STATUSES.includes(finalStatus),
      isBounced: FAILED_STATUSES.includes(finalStatus),
      deliveryConfirmedByResend: !!liveResendStatus,
      liveLookupError,
      sentAt: logRecord?.sent_at || creatorRecord?.last_emailed_at || null,
      senderEmail: logRecord?.sender_email || null,
      subject: logRecord?.subject || null,
      isCreator: !!creatorRecord,
      liveResendData: liveResendStatus ? {
        id: liveResendStatus.id,
        from: liveResendStatus.from,
        to: liveResendStatus.to,
        subject: liveResendStatus.subject,
        created_at: liveResendStatus.created_at,
        last_event: liveResendStatus.last_event
      } : null
    });

  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to check status' },
      { status: 500 }
    );
  }
}
