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

// 3. Load all creators directly from Supabase
export async function getAllCreators() {
  try {
    const { data, error } = await supabase
      .from('creators')
      .select('*')
      .order('followers_num', { ascending: false });

    if (!error && data) {
      return { creators: data, isFromDb: true };
    }
  } catch (e) {
    console.warn('Supabase query error in getAllCreators:', e);
  }

  return { creators: [], isFromDb: false };
}
