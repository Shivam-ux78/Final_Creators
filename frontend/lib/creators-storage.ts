import { supabase } from './supabase';
import { getSupabaseAdmin } from './supabase-admin';

// Statuses that mean a creator has already been emailed (delivery events included)
const ALREADY_EMAILED_STATUSES = ['sent', 'delivered', 'opened', 'clicked', 'bounced', 'complained'];

// Delivery events that should overwrite creators.email_status. Positive events
// (delivered/opened/clicked) keep 'sent' so dedupe and counting stay consistent.
const CREATOR_STATUS_EVENTS = ['bounced', 'complained', 'failed'];

// Escape LIKE wildcards so ilike() is an exact, case-insensitive match
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, m => '\\' + m);
}

export interface SentRecord {
  username: string;
  email: string;
  sentAt: string;
  subject: string;
  body: string;
  messageId?: string;
}

// 1. Check if email/username was already sent directly in Supabase
export async function isAlreadySent(email?: string, username?: string): Promise<boolean> {
  const cleanEmail = (email || '').toLowerCase().trim();
  const cleanUser = (username || '').toLowerCase().trim();

  try {
    let query = supabase.from('creators').select('id, email_status').in('email_status', ALREADY_EMAILED_STATUSES);
    if (cleanUser && cleanEmail) {
      query = query.or(`username.ilike.${cleanUser},email.ilike.${cleanEmail}`);
    } else if (cleanUser) {
      query = query.ilike('username', escapeLike(cleanUser));
    } else if (cleanEmail) {
      query = query.ilike('email', escapeLike(cleanEmail));
    } else {
      return false;
    }

    const { data, error } = await query;
    return !error && Array.isArray(data) && data.length > 0;
  } catch (e) {
    console.warn('Supabase isAlreadySent error:', e);
    return false;
  }
}

// 2. Mark creator as sent directly in Supabase database
export async function recordEmailSent(params: {
  username?: string;
  email: string;
  subject: string;
  body: string;
  messageId?: string;
  senderEmail?: string;
}) {
  const { username, email, subject, body, messageId, senderEmail } = params;
  const nowIso = new Date().toISOString();
  const cleanUser = (username || '').toLowerCase().trim();
  const cleanEmail = (email || '').toLowerCase().trim();

  try {
    let query = supabase.from('creators').update({
      email_status: 'sent',
      last_emailed_at: nowIso,
      email_subject: subject,
      email_body: body
    });

    if (cleanUser) {
      query = query.ilike('username', escapeLike(cleanUser));
    } else if (cleanEmail) {
      query = query.ilike('email', escapeLike(cleanEmail));
    }

    // Only touch creators when we know who to match (never update every row)
    if (cleanUser || cleanEmail) {
      const { error } = await query;
      if (error) {
        console.warn('Supabase recordEmailSent update error:', error.message);
      }
    }

    // Log every send (creator or not) - this is the source of truth for history and daily counts
    try {
      const { error: logError } = await getSupabaseAdmin().from('email_logs').insert([
        {
          recipient_email: cleanEmail,
          username: cleanUser,
          subject,
          body,
          message_id: messageId,
          sender_email: senderEmail,
          status: 'sent',
          sent_at: nowIso
        }
      ]);
      if (logError) console.warn('email_logs insert error:', logError.message);
    } catch (logErr) {
      console.warn('email_logs insert error:', logErr);
    }
  } catch (e) {
    console.warn('Supabase status update error:', e);
  }
}

// 2b. Update real-time email delivery status (from Resend webhooks or live polling)
export async function updateEmailDeliveryStatus(params: {
  messageId?: string;
  email?: string;
  status: 'sent' | 'delivered' | 'bounced' | 'complained' | 'opened' | 'clicked' | 'failed';
  reason?: string;
}) {
  const { messageId, email, status, reason } = params;
  const nowIso = new Date().toISOString();
  const cleanEmail = (email || '').toLowerCase().trim();

  try {
    // 1. Update email_logs table
    if (messageId) {
      await getSupabaseAdmin().from('email_logs').update({
        status,
        updated_at: nowIso
      }).eq('message_id', messageId);
    }

    // 2. Update creators table email_status only for negative outcomes
    if (cleanEmail && CREATOR_STATUS_EVENTS.includes(status)) {
      await supabase.from('creators').update({
        email_status: status,
        updated_at: nowIso
      }).ilike('email', escapeLike(cleanEmail));
    }

    // 3. Auto-suppress if email bounced or received complaint
    if ((status === 'bounced' || status === 'complained') && cleanEmail) {
      const { addSuppression } = await import('./suppressions');
      await addSuppression(cleanEmail, reason || `Automatic suppression due to Resend ${status} event`, 'resend_webhook');
    }
  } catch (e) {
    console.warn('Error updating email delivery status:', e);
  }
}

// 3. Load all creators directly from Supabase with full pagination
export async function getAllCreators() {
  try {
    let allCreators: any[] = [];
    let from = 0;
    const PAGE_SIZE = 1000;

    while (true) {
      const { data, error } = await supabase
        .from('creators')
        .select('*')
        .order('created_at', { ascending: false })
        .range(from, from + PAGE_SIZE - 1);

      if (error) {
        console.warn('Supabase query error in getAllCreators:', error);
        break;
      }

      if (!data || data.length === 0) {
        break;
      }

      allCreators = allCreators.concat(data);

      if (data.length < PAGE_SIZE) {
        break;
      }

      from += PAGE_SIZE;
    }

    if (allCreators.length > 0) {
      return { creators: allCreators, isFromDb: true };
    }
  } catch (e) {
    console.warn('Supabase query error in getAllCreators:', e);
  }

  return { creators: [], isFromDb: false };
}

// 4. Calculate deterministic daily limit (Default 500 emails/day)
export function getDailyLimitInfo() {
  const limitPerDomain = 167;
  const totalDailyLimit = 500; // Default 500 daily limit
  return { limitPerDomain, totalDailyLimit, dayNumber: 1 };
}

// 5. Count every email sent today (all recipients, all send paths) from email_logs
export async function getTodaySentCountFromSupabase(): Promise<number> {
  try {
    const todayStartIso = new Date(new Date().setUTCHours(0, 0, 0, 0)).toISOString();
    const { count, error } = await getSupabaseAdmin()
      .from('email_logs')
      .select('id', { count: 'exact', head: true })
      .gte('sent_at', todayStartIso);

    if (error) {
      console.warn('Error fetching today sent count from email_logs:', error.message);
      return 0;
    }

    return count || 0;
  } catch (e) {
    console.warn('Error fetching today sent count:', e);
    return 0;
  }
}
