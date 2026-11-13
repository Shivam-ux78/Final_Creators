import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getSupabaseAdmin } from './supabase-admin';

// API keys live only in the Supabase `api_keys` table, accessed with the server-only
// secret key. There is no local-file or hardcoded fallback: if Supabase can't be
// read, key validation fails closed.

export interface ApiKeyItem {
  id: string;
  name: string;
  key: string;
  dailyLimit: number;
  allowedSenders?: string[];
  customSenderName?: string;
  replyTo?: string;
  createdAt: string;
  lastUsedAt?: string;
  lastUsedDate?: string; // YYYY-MM-DD for tracking today's limit reset
  todaySentCount: number;
  totalSentCount: number;
  status: 'active' | 'revoked';
}

const TABLE = 'api_keys';
const KEY_SENDERS_FALLBACK_FILE = path.join(process.cwd(), '.api_key_senders.json');

type KeySenderPrefs = {
  allowedSenders?: string[];
  customSenderName?: string;
  replyTo?: string;
};

function readKeySenderPrefsMap(): Record<string, KeySenderPrefs> {
  try {
    if (fs.existsSync(KEY_SENDERS_FALLBACK_FILE)) {
      const raw = fs.readFileSync(KEY_SENDERS_FALLBACK_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed;
    }
  } catch (e) {
    console.warn('Error reading .api_key_senders.json:', e);
  }
  return {};
}

function writeKeySenderPrefs(id: string, prefs: KeySenderPrefs): void {
  try {
    const map = readKeySenderPrefsMap();
    map[id] = prefs;
    fs.writeFileSync(KEY_SENDERS_FALLBACK_FILE, JSON.stringify(map, null, 2), 'utf-8');
  } catch (e) {
    console.warn('Error writing .api_key_senders.json:', e);
  }
}

function normalizeAllowedSenders(val: any): string[] | undefined {
  if (!Array.isArray(val)) return undefined;
  const cleaned = val
    .filter((s: any) => typeof s === 'string' && s.trim().includes('@'))
    .map((s: string) => s.trim().toLowerCase());
  return cleaned.length > 0 ? Array.from(new Set(cleaned)) : undefined;
}

function todayString(): string {
  return new Date().toISOString().split('T')[0];
}

function generateKey(): string {
  return 'mk_live_' + crypto.randomBytes(16).toString('hex');
}

function fromRow(k: any, prefsMap?: Record<string, KeySenderPrefs>): ApiKeyItem {
  const todayStr = todayString();
  const fallbackPrefs = prefsMap ? prefsMap[k.id] : readKeySenderPrefsMap()[k.id];
  const allowedSenders = normalizeAllowedSenders(k.allowed_senders) ?? normalizeAllowedSenders(fallbackPrefs?.allowedSenders);
  const customSenderName =
    (typeof k.custom_sender_name === 'string' && k.custom_sender_name.trim() ? k.custom_sender_name.trim() : undefined) ??
    (fallbackPrefs?.customSenderName?.trim() || undefined);
  const replyTo =
    (typeof k.reply_to === 'string' && k.reply_to.trim() ? k.reply_to.trim() : undefined) ??
    (fallbackPrefs?.replyTo?.trim() || undefined);

  return {
    id: k.id,
    name: k.name || 'API Key',
    key: k.key,
    dailyLimit: typeof k.daily_limit === 'number' && k.daily_limit > 0 ? k.daily_limit : 500,
    allowedSenders,
    customSenderName,
    replyTo,
    createdAt: k.created_at || new Date().toISOString(),
    lastUsedAt: k.last_used_at || undefined,
    lastUsedDate: k.last_used_date || undefined,
    todaySentCount: k.last_used_date === todayStr ? (k.today_sent_count || 0) : 0,
    totalSentCount: k.total_sent_count || 0,
    status: k.status === 'revoked' ? 'revoked' : 'active'
  };
}

export async function getStoredApiKeysAsync(): Promise<ApiKeyItem[]> {
  const { data, error } = await getSupabaseAdmin()
    .from(TABLE)
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw new Error(`Failed to load API keys: ${error.message}`);
  const prefsMap = readKeySenderPrefsMap();
  return (data || []).map(row => fromRow(row, prefsMap));
}

async function findKeyByValue(keyString: string): Promise<ApiKeyItem | null> {
  const { data, error } = await getSupabaseAdmin()
    .from(TABLE)
    .select('*')
    .eq('key', keyString)
    .maybeSingle();

  if (error) throw new Error(`Failed to validate API key: ${error.message}`);
  return data ? fromRow(data) : null;
}

export async function createNewApiKeyAsync(
  name: string,
  dailyLimit?: number,
  allowedSenders?: string[],
  customSenderName?: string,
  replyTo?: string
): Promise<ApiKeyItem> {
  const limit = typeof dailyLimit === 'number' && dailyLimit > 0 ? dailyLimit : 500;
  const cleanSenders = normalizeAllowedSenders(allowedSenders);
  const cleanCustomName = customSenderName?.trim() || undefined;
  const cleanReplyTo = replyTo?.trim() || undefined;
  const keyId = 'key_' + Date.now();

  const basePayload: Record<string, any> = {
    id: keyId,
    name: name.trim() || 'Custom API Key',
    key: generateKey(),
    daily_limit: limit,
    created_at: new Date().toISOString(),
    last_used_date: todayString(),
    today_sent_count: 0,
    total_sent_count: 0,
    status: 'active'
  };

  if (cleanSenders || cleanCustomName || cleanReplyTo) {
    writeKeySenderPrefs(keyId, {
      allowedSenders: cleanSenders,
      customSenderName: cleanCustomName,
      replyTo: cleanReplyTo
    });
  }

  let { data, error } = await getSupabaseAdmin()
    .from(TABLE)
    .insert({
      ...basePayload,
      allowed_senders: cleanSenders ?? null,
      custom_sender_name: cleanCustomName ?? null,
      reply_to: cleanReplyTo ?? null
    })
    .select('*')
    .single();

  if (error && /allowed_senders|custom_sender_name|reply_to|schema cache|column/i.test(error.message)) {
    const retry = await getSupabaseAdmin()
      .from(TABLE)
      .insert(basePayload)
      .select('*')
      .single();
    data = retry.data;
    error = retry.error;
  }

  if (error) throw new Error(`Failed to create API key: ${error.message}`);
  return fromRow(data);
}

export async function updateApiKeySendersAsync(
  id: string,
  allowedSenders?: string[],
  customSenderName?: string,
  replyTo?: string
): Promise<ApiKeyItem | null> {
  const cleanSenders = normalizeAllowedSenders(allowedSenders);
  const cleanCustomName = customSenderName?.trim() || undefined;
  const cleanReplyTo = replyTo !== undefined ? (replyTo?.trim() || undefined) : undefined;

  const existingPrefs = readKeySenderPrefsMap()[id] || {};
  writeKeySenderPrefs(id, {
    allowedSenders: cleanSenders,
    customSenderName: cleanCustomName,
    replyTo: replyTo !== undefined ? cleanReplyTo : existingPrefs.replyTo
  });

  const updatePayload: Record<string, any> = {
    allowed_senders: cleanSenders ?? null,
    custom_sender_name: cleanCustomName ?? null
  };
  if (replyTo !== undefined) {
    updatePayload.reply_to = cleanReplyTo ?? null;
  }

  const { data, error } = await getSupabaseAdmin()
    .from(TABLE)
    .update(updatePayload)
    .eq('id', id)
    .select('*')
    .maybeSingle();

  if (error && /allowed_senders|custom_sender_name|reply_to|schema cache|column/i.test(error.message)) {
    const existing = await getSupabaseAdmin().from(TABLE).select('*').eq('id', id).maybeSingle();
    if (existing.error) throw new Error(`Failed to update API key senders: ${existing.error.message}`);
    return existing.data ? fromRow(existing.data) : null;
  }

  if (error) throw new Error(`Failed to update API key senders: ${error.message}`);
  return data ? fromRow(data) : null;
}

// Dedicated key used internally by the MCP connector (/api/mcp). Auto-created on first
// use with a 500/day limit; it never leaves the server. Revoke or rotate it from the
// dashboard like any other key (revoking it disables sending through the connector).
const CONNECTOR_KEY_ID = 'key_mcp_connector';

export async function getOrCreateConnectorKeyAsync(): Promise<ApiKeyItem> {
  const admin = getSupabaseAdmin();
  const existing = await admin.from(TABLE).select('*').eq('id', CONNECTOR_KEY_ID).maybeSingle();
  if (existing.error) throw new Error(`Failed to load connector key: ${existing.error.message}`);
  if (existing.data) return fromRow(existing.data);

  const created = await admin
    .from(TABLE)
    .upsert({
      id: CONNECTOR_KEY_ID,
      name: 'MCP Connector',
      key: generateKey(),
      daily_limit: 500,
      created_at: new Date().toISOString(),
      last_used_date: todayString(),
      today_sent_count: 0,
      total_sent_count: 0,
      status: 'active'
    }, { onConflict: 'id', ignoreDuplicates: true })
    .select('*')
    .maybeSingle();
  if (created.error) throw new Error(`Failed to create connector key: ${created.error.message}`);
  if (created.data) return fromRow(created.data);

  // Another request created it concurrently
  const retry = await admin.from(TABLE).select('*').eq('id', CONNECTOR_KEY_ID).single();
  if (retry.error) throw new Error(`Failed to load connector key: ${retry.error.message}`);
  return fromRow(retry.data);
}

export async function revokeApiKeyAsync(id: string): Promise<boolean> {
  const { error } = await getSupabaseAdmin().from(TABLE).update({ status: 'revoked' }).eq('id', id);
  if (error) throw new Error(`Failed to revoke API key: ${error.message}`);
  return true;
}

export async function rotateApiKeyAsync(id: string): Promise<ApiKeyItem | null> {
  const { data, error } = await getSupabaseAdmin()
    .from(TABLE)
    .update({
      key: generateKey(),
      created_at: new Date().toISOString(),
      today_sent_count: 0,
      status: 'active'
    })
    .eq('id', id)
    .select('*')
    .maybeSingle();

  if (error) throw new Error(`Failed to rotate API key: ${error.message}`);
  return data ? fromRow(data) : null;
}

// Check a key is valid and active without recording usage (for read-only endpoints)
export async function isActiveApiKeyAsync(keyString: string | null | undefined): Promise<boolean> {
  if (!keyString || !keyString.trim()) return false;
  const keyItem = await findKeyByValue(keyString.trim());
  return !!keyItem && keyItem.status === 'active';
}

// Validate Key and Enforce Per-Key Daily Limit
// Check a key without consuming quota. Pair with recordKeyUsageAsync after a successful send,
// so refused/failed sends (suppressed, sender error, provider error) never count against the key.
export async function validateApiKeyAsync(keyString: string): Promise<{
  valid: boolean;
  error?: string;
  keyItem?: ApiKeyItem;
}> {
  if (!keyString || !keyString.trim()) {
    return { valid: false, error: 'An API Key is required. Provide it via the x-api-key header.' };
  }

  const keyItem = await findKeyByValue(keyString.trim());
  if (!keyItem) return { valid: false, error: 'Invalid API Key provided.' };
  if (keyItem.status === 'revoked') return { valid: false, error: 'This API Key has been revoked.' };
  if (keyItem.todaySentCount >= keyItem.dailyLimit) {
    return {
      valid: false,
      error: `Daily limit of ${keyItem.dailyLimit} emails for API key "${keyItem.name}" has been reached for today.`,
      keyItem
    };
  }
  return { valid: true, keyItem };
}

// Count one successful send against a key. Re-reads the row first to narrow lost-update races.
export async function recordKeyUsageAsync(keyItem: ApiKeyItem): Promise<ApiKeyItem> {
  const fresh = (await findKeyByValue(keyItem.key)) || keyItem;
  fresh.todaySentCount += 1;
  fresh.totalSentCount += 1;
  fresh.lastUsedAt = new Date().toISOString();
  fresh.lastUsedDate = todayString();

  const { error } = await getSupabaseAdmin()
    .from(TABLE)
    .update({
      today_sent_count: fresh.todaySentCount,
      total_sent_count: fresh.totalSentCount,
      last_used_at: fresh.lastUsedAt,
      last_used_date: fresh.lastUsedDate
    })
    .eq('id', fresh.id);

  if (error) throw new Error(`Failed to record API key usage: ${error.message}`);
  return fresh;
}

export async function validateAndRecordKeyUsageAsync(keyString: string): Promise<{
  valid: boolean;
  error?: string;
  keyItem?: ApiKeyItem;
}> {
  if (!keyString || !keyString.trim()) {
    return { valid: false, error: 'An API Key is required. Provide it via the x-api-key header.' };
  }

  const keyItem = await findKeyByValue(keyString.trim());

  if (!keyItem) {
    return { valid: false, error: 'Invalid API Key provided.' };
  }

  if (keyItem.status === 'revoked') {
    return { valid: false, error: 'This API Key has been revoked.' };
  }

  if (keyItem.todaySentCount >= keyItem.dailyLimit) {
    return {
      valid: false,
      error: `Daily limit of ${keyItem.dailyLimit} emails for API key "${keyItem.name}" has been reached for today.`,
      keyItem
    };
  }

  keyItem.todaySentCount += 1;
  keyItem.totalSentCount += 1;
  keyItem.lastUsedAt = new Date().toISOString();
  keyItem.lastUsedDate = todayString();

  const { error } = await getSupabaseAdmin()
    .from(TABLE)
    .update({
      today_sent_count: keyItem.todaySentCount,
      total_sent_count: keyItem.totalSentCount,
      last_used_at: keyItem.lastUsedAt,
      last_used_date: keyItem.lastUsedDate
    })
    .eq('id', keyItem.id);

  if (error) throw new Error(`Failed to record API key usage: ${error.message}`);
  return { valid: true, keyItem };
}
