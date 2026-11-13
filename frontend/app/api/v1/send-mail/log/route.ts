import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSupabaseAdmin } from '../../../../../lib/supabase-admin';
import { getStoredApiKeysAsync } from '../../../../../lib/api-keys-storage';
import { verifySessionToken, AUTH_COOKIE_NAME } from '../../../../../lib/auth';
import { getConfiguredSenders } from '../../../../../lib/senders-config';

export const dynamic = 'force-dynamic';

const HR_ADDRESS = /^(hr|careers|talent|hiring|recruiting|people|jobs)@/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/v1/send-mail/log?date=YYYY-MM-DD&category=hr&source=mcp:...&sender=hr@...&limit=100
// Itemised sent log for one UTC day, so a key's "todaySentCount" can be traced to actual messages.
// With an API key: only that key's sends. With a dashboard session: every send (optionally ?keyId=).
// Bodies are never returned.
export async function GET(req: Request) {
  try {
    const authHeader = req.headers.get('authorization');
    const providedKey = (req.headers.get('x-api-key') || (authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : '')).trim();
    const hasSession = verifySessionToken(cookies().get(AUTH_COOKIE_NAME)?.value).valid;

    let scopedKey: { id: string; name: string; dailyLimit: number; todaySentCount: number } | null = null;
    if (providedKey) {
      const keyItem = (await getStoredApiKeysAsync()).find(k => k.key === providedKey);
      if (!keyItem || keyItem.status === 'revoked') {
        return NextResponse.json({ success: false, error: 'Invalid or revoked API key.' }, { status: 401 });
      }
      scopedKey = keyItem;
    } else if (!hasSession) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized. Provide a valid API Key via the x-api-key header.' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(req.url);
    const date = searchParams.get('date') || new Date().toISOString().split('T')[0];
    if (!DATE_PATTERN.test(date)) {
      return NextResponse.json({ success: false, error: '"date" must be YYYY-MM-DD (UTC).' }, { status: 400 });
    }
    const category = (searchParams.get('category') || '').trim().toLowerCase();
    const sourceFilter = (searchParams.get('source') || '').trim();
    const senderFilter = (searchParams.get('sender') || '').trim().toLowerCase();
    const keyIdFilter = scopedKey ? scopedKey.id : (searchParams.get('keyId') || '').trim();
    const limitParam = parseInt(searchParams.get('limit') || '100', 10);
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 500) : 100;

    const dayStart = `${date}T00:00:00.000Z`;
    const dayEnd = new Date(new Date(dayStart).getTime() + 24 * 60 * 60 * 1000).toISOString();

    let query = getSupabaseAdmin()
      .from('email_logs')
      .select('message_id, recipient_email, subject, sender_email, sender_category, reply_to, status, source, api_key_id, api_key_name, sent_at, updated_at')
      .gte('sent_at', dayStart)
      .lt('sent_at', dayEnd)
      .order('sent_at', { ascending: false })
      .limit(2000);
    if (keyIdFilter) query = query.eq('api_key_id', keyIdFilter);

    const { data, error } = await query;
    if (error) {
      const missingColumns = /column .* does not exist|schema cache/i.test(error.message);
      return NextResponse.json(
        {
          success: false,
          error: missingColumns
            ? 'Sent-log attribution is not set up yet: run the email_logs ALTER TABLE statements in schema.sql on Supabase.'
            : `Failed to load sent log: ${error.message}`
        },
        { status: missingColumns ? 503 : 500 }
      );
    }

    const hrSenders = new Set(
      getConfiguredSenders().filter(s => s.category === 'hr').map(s => s.senderEmail.toLowerCase())
    );
    const categoryOf = (row: any): string => {
      if (row.sender_category) return row.sender_category;
      const sender = (row.sender_email || '').toLowerCase();
      return hrSenders.has(sender) || HR_ADDRESS.test(sender) ? 'hr' : 'outreach';
    };

    const rows = (data || [])
      .map((r: any) => ({ ...r, sender_category: categoryOf(r) }))
      .filter((r: any) => !category || r.sender_category === category)
      .filter((r: any) => !sourceFilter || (r.source || '') === sourceFilter)
      .filter((r: any) => !senderFilter || (r.sender_email || '').toLowerCase() === senderFilter);

    const tally = (field: string) =>
      rows.reduce((acc: Record<string, number>, r: any) => {
        const k = r[field] || 'unattributed';
        acc[k] = (acc[k] || 0) + 1;
        return acc;
      }, {});

    const isToday = date === new Date().toISOString().split('T')[0];
    const counterMismatch = scopedKey && isToday && !category && !sourceFilter && !senderFilter
      ? scopedKey.todaySentCount - rows.length
      : 0;

    return NextResponse.json({
      success: true,
      date,
      scope: scopedKey ? { type: 'api_key', keyName: scopedKey.name } : { type: 'all', keyId: keyIdFilter || undefined },
      total: rows.length,
      bySource: tally('source'),
      bySender: tally('sender_email'),
      byCategory: tally('sender_category'),
      byStatus: tally('status'),
      ...(scopedKey && isToday ? {
        keyCounter: {
          todaySentCount: scopedKey.todaySentCount,
          dailyLimit: scopedKey.dailyLimit,
          remainingQuota: Math.max(0, scopedKey.dailyLimit - scopedKey.todaySentCount),
          ...(counterMismatch > 0 ? {
            untracedCount: counterMismatch,
            note: 'Counter is higher than logged sends: these were counted before per-send attribution existed, or by attempts that failed under the old pre-send counting.'
          } : {})
        }
      } : {}),
      messages: rows.slice(0, limit)
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message || 'Failed to load sent log' }, { status: 500 });
  }
}
