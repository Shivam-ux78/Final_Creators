import crypto from 'crypto';
import { getSupabaseAdmin } from './supabase-admin';

// API keys live only in the Supabase `api_keys` table, accessed with the server-only
// secret key. There is no local-file or hardcoded fallback: if Supabase can't be
// read, key validation fails closed.

export interface ApiKeyItem {
  id: string;
  name: string;
  key: string;
  dailyLimit: number;
  createdAt: string;
  lastUsedAt?: string;
  lastUsedDate?: string; // YYYY-MM-DD for tracking today's limit reset
  todaySentCount: number;
  totalSentCount: number;
  status: 'active' | 'revoked';
}

const TABLE = 'api_keys';

function todayString(): string {
  return new Date().toISOString().split('T')[0];
}

function generateKey(): string {
  return 'mk_live_' + crypto.randomBytes(16).toString('hex');
}

function fromRow(k: any): ApiKeyItem {
  const todayStr = todayString();
  return {
    id: k.id,
    name: k.name || 'API Key',
    key: k.key,
    dailyLimit: typeof k.daily_limit === 'number' && k.daily_limit > 0 ? k.daily_limit : 500,
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
  return (data || []).map(fromRow);
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

export async function createNewApiKeyAsync(name: string, dailyLimit?: number): Promise<ApiKeyItem> {
  const limit = typeof dailyLimit === 'number' && dailyLimit > 0 ? dailyLimit : 500;

  const { data, error } = await getSupabaseAdmin()
    .from(TABLE)
    .insert({
      id: 'key_' + Date.now(),
      name: name.trim() || 'Custom API Key',
      key: generateKey(),
      daily_limit: limit,
      created_at: new Date().toISOString(),
      last_used_date: todayString(),
      today_sent_count: 0,
      total_sent_count: 0,
      status: 'active'
    })
    .select('*')
    .single();

  if (error) throw new Error(`Failed to create API key: ${error.message}`);
  return fromRow(data);
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

// Validate Key and Enforce Per-Key Daily Limit
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
