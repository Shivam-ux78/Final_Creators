import { supabase } from './supabase';

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
    let query = supabase.from('creators').select('id, email_status').eq('email_status', 'sent');
    if (cleanUser && cleanEmail) {
      query = query.or(`username.ilike.${cleanUser},email.ilike.${cleanEmail}`);
    } else if (cleanUser) {
      query = query.ilike('username', cleanUser);
    } else if (cleanEmail) {
      query = query.ilike('email', cleanEmail);
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
  username: string;
  email: string;
  subject: string;
  body: string;
  messageId?: string;
}) {
  const { username, email, subject, body, messageId } = params;
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
      query = query.ilike('username', cleanUser);
    } else if (cleanEmail) {
      query = query.ilike('email', cleanEmail);
    }

    const { error } = await query;
    if (error) {
      console.warn('Supabase recordEmailSent update error:', error.message);
    }
  } catch (e) {
    console.warn('Supabase status update error:', e);
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

// 4. Calculate deterministic daily limit per domain (starting 30 on 2026-09-20, +1 per day up to max 50)
export function getDailyLimitInfo() {
  const startDate = new Date('2026-09-20T00:00:00Z');
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
  const limitPerDomain = Math.min(30 + Math.max(0, diffDays), 50);
  const totalDailyLimit = limitPerDomain * 3; // 3 active senders (.work, .website, .online)
  return { limitPerDomain, totalDailyLimit, dayNumber: Math.max(1, diffDays + 1) };
}

// 5. Fetch number of creators emailed today directly from Supabase
export async function getTodaySentCountFromSupabase(): Promise<number> {
  try {
    const todayStartIso = new Date(new Date().setUTCHours(0, 0, 0, 0)).toISOString();
    const { data, error } = await supabase
      .from('creators')
      .select('id')
      .eq('email_status', 'sent')
      .gte('last_emailed_at', todayStartIso);

    if (error) {
      console.warn('Error fetching today sent count from Supabase:', error.message);
      return 0;
    }

    return Array.isArray(data) ? data.length : 0;
  } catch (e) {
    console.warn('Failed to query Supabase today sent count:', e);
    return 0;
  }
}
