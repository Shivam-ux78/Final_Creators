import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { supabase } from '../../../../../lib/supabase';
import { updateEmailDeliveryStatus } from '../../../../../lib/creators-storage';

// GET /api/v1/send-mail/status?messageId=re_12345 or ?email=creator@example.com
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const messageId = searchParams.get('messageId') || searchParams.get('message_id') || searchParams.get('id');
    const emailParam = searchParams.get('email') || searchParams.get('toEmail');

    if (!messageId && !emailParam) {
      return NextResponse.json(
        { success: false, error: 'Please provide messageId (e.g. ?messageId=re_123) or email (e.g. ?email=creator@example.com)' },
        { status: 400 }
      );
    }

    const resendApiKey = process.env.RESEND_API_KEY_2 || process.env.RESEND_API_KEY || '';
    let liveResendStatus: any = null;

    // 1. If messageId is a live Resend ID (starts with "re_"), query Resend API live directly
    if (messageId && messageId.startsWith('re_') && resendApiKey) {
      try {
        const resend = new Resend(resendApiKey);
        const resendRes = await resend.emails.get(messageId);
        if (resendRes.data) {
          liveResendStatus = resendRes.data;
          const resendState = resendRes.data.last_event || (resendRes.data as any).status;
          if (resendState) {
            await updateEmailDeliveryStatus({
              messageId,
              email: Array.isArray(resendRes.data.to) ? resendRes.data.to[0] : (resendRes.data.to as any),
              status: resendState as any
            });
          }
        }
      } catch (e) {
        // Resend API fetch fallback
      }
    }

    // 2. Fetch from Supabase email_logs and creators DB
    let logRecord: any = null;
    if (messageId) {
      const { data } = await supabase.from('email_logs').select('*').eq('message_id', messageId).maybeSingle();
      logRecord = data;
    } else if (emailParam) {
      const { data } = await supabase.from('email_logs').select('*').ilike('recipient_email', emailParam.trim()).order('sent_at', { ascending: false }).limit(1).maybeSingle();
      logRecord = data;
    }

    let creatorRecord: any = null;
    const targetEmail = emailParam || logRecord?.recipient_email;
    if (targetEmail) {
      const { data } = await supabase.from('creators').select('username, email, email_status, last_emailed_at').ilike('email', targetEmail.trim()).maybeSingle();
      creatorRecord = data;
    }

    const finalStatus = liveResendStatus?.last_event || logRecord?.status || creatorRecord?.email_status || 'sent';

    return NextResponse.json({
      success: true,
      messageId: messageId || logRecord?.message_id,
      recipientEmail: targetEmail,
      status: finalStatus,
      isDelivered: finalStatus === 'delivered' || finalStatus === 'opened' || finalStatus === 'clicked',
      isBounced: finalStatus === 'bounced' || finalStatus === 'failed' || finalStatus === 'complained',
      sentAt: logRecord?.sent_at || creatorRecord?.last_emailed_at,
      lastUpdated: logRecord?.updated_at || new Date().toISOString(),
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
