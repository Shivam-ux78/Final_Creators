import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { supabase } from './supabase';

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

const API_KEYS_FILE = path.join(process.cwd(), '.api_keys_store.json');

// In-memory cache for fast access
let inMemoryKeysCache: ApiKeyItem[] | null = null;

// Synchronous local file/cache loader
export function getStoredApiKeys(): ApiKeyItem[] {
  if (inMemoryKeysCache && inMemoryKeysCache.length > 0) {
    return inMemoryKeysCache;
  }

  const todayStr = new Date().toISOString().split('T')[0];

  try {
    if (fs.existsSync(API_KEYS_FILE)) {
      const raw = fs.readFileSync(API_KEYS_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.keys) && parsed.keys.length > 0) {
        const keys = parsed.keys.map((k: any) => ({
          id: k.id || 'key_' + Math.random(),
          name: k.name || 'API Key',
          key: k.key,
          dailyLimit: typeof k.dailyLimit === 'number' && k.dailyLimit > 0 ? k.dailyLimit : 500,
          createdAt: k.createdAt || new Date().toISOString(),
          lastUsedAt: k.lastUsedAt,
          lastUsedDate: k.lastUsedDate || todayStr,
          todaySentCount: k.lastUsedDate === todayStr ? (k.todaySentCount || 0) : 0,
          totalSentCount: k.totalSentCount || 0,
          status: k.status || 'active'
        }));
        inMemoryKeysCache = keys;
        return keys;
      }
    }
  } catch (e) {
    console.warn('Error loading local API keys file:', e);
  }

  const initialKey: ApiKeyItem = {
    id: 'key_default_1',
    name: 'Default Production API Key',
    key: 'mk_live_e841f92b704c3d8e561a2903b417c82f',
    dailyLimit: 500,
    createdAt: new Date().toISOString(),
    todaySentCount: 0,
    totalSentCount: 0,
    lastUsedDate: todayStr,
    status: 'active'
  };

  saveStoredApiKeys([initialKey]);
  return [initialKey];
}

// Helper to push keys to Supabase DB
async function syncKeysToSupabase(keys: ApiKeyItem[]) {
  try {
    for (const k of keys) {
      await supabase.from('api_keys').upsert({
        id: k.id,
        name: k.name,
        key: k.key,
        daily_limit: k.dailyLimit,
        created_at: k.createdAt,
        last_used_at: k.lastUsedAt || null,
        last_used_date: k.lastUsedDate || null,
        today_sent_count: k.todaySentCount || 0,
        total_sent_count: k.totalSentCount || 0,
        status: k.status
      }, { onConflict: 'id' });
    }
  } catch (e) {
    // Ignore error if table is not yet created in DB
  }
}

// Async loader with Supabase DB integration for deployment persistence
export async function getStoredApiKeysAsync(): Promise<ApiKeyItem[]> {
  const todayStr = new Date().toISOString().split('T')[0];

  try {
    const { data, error } = await supabase.from('api_keys').select('*').order('created_at', { ascending: false });
    if (!error && Array.isArray(data) && data.length > 0) {
      const keys: ApiKeyItem[] = data.map((k: any) => ({
        id: k.id,
        name: k.name || 'API Key',
        key: k.key,
        dailyLimit: typeof k.daily_limit === 'number' && k.daily_limit > 0 ? k.daily_limit : 500,
        createdAt: k.created_at || new Date().toISOString(),
        lastUsedAt: k.last_used_at || undefined,
        lastUsedDate: k.last_used_date || todayStr,
        todaySentCount: k.last_used_date === todayStr ? (k.today_sent_count || 0) : 0,
        totalSentCount: k.total_sent_count || 0,
        status: k.status === 'revoked' ? 'revoked' : 'active'
      }));

      inMemoryKeysCache = keys;
      saveStoredApiKeysLocal(keys);
      return keys;
    }
  } catch (err) {
    console.warn('Supabase api_keys fetch error, using local fallback:', err);
  }

  const localKeys = getStoredApiKeys();
  syncKeysToSupabase(localKeys).catch(() => {});
  return localKeys;
}

function saveStoredApiKeysLocal(keys: ApiKeyItem[]): boolean {
  inMemoryKeysCache = keys;
  try {
    fs.writeFileSync(
      API_KEYS_FILE,
      JSON.stringify({ keys, updatedAt: new Date().toISOString() }, null, 2),
      'utf-8'
    );
  } catch (e) {
    // Soft error in read-only environment
  }
  return true;
}

export function saveStoredApiKeys(keys: ApiKeyItem[]): boolean {
  saveStoredApiKeysLocal(keys);
  syncKeysToSupabase(keys).catch(() => {});
  return true;
}

export async function createNewApiKeyAsync(name: string, dailyLimit?: number): Promise<ApiKeyItem> {
  const keys = await getStoredApiKeysAsync();
  const limit = typeof dailyLimit === 'number' && dailyLimit > 0 ? dailyLimit : 500;
  const todayStr = new Date().toISOString().split('T')[0];

  const newKey: ApiKeyItem = {
    id: 'key_' + Date.now(),
    name: name.trim() || 'Custom API Key',
    key: 'mk_live_' + crypto.randomBytes(16).toString('hex'),
    dailyLimit: limit,
    createdAt: new Date().toISOString(),
    todaySentCount: 0,
    totalSentCount: 0,
    lastUsedDate: todayStr,
    status: 'active'
  };

  keys.unshift(newKey);
  saveStoredApiKeys(keys);
  await syncKeysToSupabase([newKey]);
  return newKey;
}

export function createNewApiKey(name: string, dailyLimit?: number): ApiKeyItem {
  const keys = getStoredApiKeys();
  const limit = typeof dailyLimit === 'number' && dailyLimit > 0 ? dailyLimit : 500;
  const todayStr = new Date().toISOString().split('T')[0];

  const newKey: ApiKeyItem = {
    id: 'key_' + Date.now(),
    name: name.trim() || 'Custom API Key',
    key: 'mk_live_' + crypto.randomBytes(16).toString('hex'),
    dailyLimit: limit,
    createdAt: new Date().toISOString(),
    todaySentCount: 0,
    totalSentCount: 0,
    lastUsedDate: todayStr,
    status: 'active'
  };

  keys.unshift(newKey);
  saveStoredApiKeys(keys);
  return newKey;
}

export async function revokeApiKeyAsync(id: string): Promise<boolean> {
  const keys = await getStoredApiKeysAsync();
  const updated = keys.map(k => {
    if (k.id === id) {
      return { ...k, status: 'revoked' as const };
    }
    return k;
  });
  saveStoredApiKeys(updated);
  await supabase.from('api_keys').update({ status: 'revoked' }).eq('id', id);
  return true;
}

export function revokeApiKey(id: string): boolean {
  const keys = getStoredApiKeys();
  const updated = keys.map(k => {
    if (k.id === id) {
      return { ...k, status: 'revoked' as const };
    }
    return k;
  });
  saveStoredApiKeys(updated);
  return true;
}

export async function rotateApiKeyAsync(id: string): Promise<ApiKeyItem | null> {
  const keys = await getStoredApiKeysAsync();
  let rotatedItem: ApiKeyItem | null = null;

  const updated = keys.map(k => {
    if (k.id === id) {
      rotatedItem = {
        ...k,
        key: 'mk_live_' + crypto.randomBytes(16).toString('hex'),
        createdAt: new Date().toISOString(),
        todaySentCount: 0,
        status: 'active' as const
      };
      return rotatedItem;
    }
    return k;
  });

  if (rotatedItem) {
    saveStoredApiKeys(updated);
    await syncKeysToSupabase([rotatedItem]);
  }
  return rotatedItem;
}

export function rotateApiKey(id: string): ApiKeyItem | null {
  const keys = getStoredApiKeys();
  let rotatedItem: ApiKeyItem | null = null;

  const updated = keys.map(k => {
    if (k.id === id) {
      rotatedItem = {
        ...k,
        key: 'mk_live_' + crypto.randomBytes(16).toString('hex'),
        createdAt: new Date().toISOString(),
        todaySentCount: 0,
        status: 'active' as const
      };
      return rotatedItem;
    }
    return k;
  });

  if (rotatedItem) {
    saveStoredApiKeys(updated);
  }
  return rotatedItem;
}

export async function validateAndRecordKeyUsageAsync(keyString: string): Promise<{
  valid: boolean;
  error?: string;
  keyItem?: ApiKeyItem;
}> {
  if (!keyString || !keyString.trim()) {
    return { valid: false, error: 'An API Key is required. Provide it via the x-api-key header.' };
  }

  const cleanKey = keyString.trim();
  const keys = await getStoredApiKeysAsync();
  const keyItem = keys.find(k => k.key === cleanKey);

  if (!keyItem) {
    return { valid: false, error: 'Invalid API Key provided.' };
  }

  if (keyItem.status === 'revoked') {
    return { valid: false, error: 'This API Key has been revoked.' };
  }

  const todayStr = new Date().toISOString().split('T')[0];
  let currentTodaySent = keyItem.todaySentCount || 0;

  if (keyItem.lastUsedDate !== todayStr) {
    currentTodaySent = 0;
  }

  if (currentTodaySent >= keyItem.dailyLimit) {
    return {
      valid: false,
      error: `Daily limit of ${keyItem.dailyLimit} emails for API key "${keyItem.name}" has been reached for today.`,
      keyItem
    };
  }

  keyItem.todaySentCount = currentTodaySent + 1;
  keyItem.totalSentCount = (keyItem.totalSentCount || 0) + 1;
  keyItem.lastUsedAt = new Date().toISOString();
  keyItem.lastUsedDate = todayStr;

  saveStoredApiKeys(keys);
  await syncKeysToSupabase([keyItem]);

  return { valid: true, keyItem };
}

export function validateAndRecordKeyUsage(keyString: string): {
  valid: boolean;
  error?: string;
  keyItem?: ApiKeyItem;
} {
  if (!keyString || !keyString.trim()) {
    return { valid: false, error: 'An API Key is required. Provide it via the x-api-key header.' };
  }

  const cleanKey = keyString.trim();
  const keys = getStoredApiKeys();
  const keyItem = keys.find(k => k.key === cleanKey);

  if (!keyItem) {
    return { valid: false, error: 'Invalid API Key provided.' };
  }

  if (keyItem.status === 'revoked') {
    return { valid: false, error: 'This API Key has been revoked.' };
  }

  const todayStr = new Date().toISOString().split('T')[0];
  let currentTodaySent = keyItem.todaySentCount || 0;

  if (keyItem.lastUsedDate !== todayStr) {
    currentTodaySent = 0;
  }

  if (currentTodaySent >= keyItem.dailyLimit) {
    return {
      valid: false,
      error: `Daily limit of ${keyItem.dailyLimit} emails for API key "${keyItem.name}" has been reached for today.`,
      keyItem
    };
  }

  keyItem.todaySentCount = currentTodaySent + 1;
  keyItem.totalSentCount = (keyItem.totalSentCount || 0) + 1;
  keyItem.lastUsedAt = new Date().toISOString();
  keyItem.lastUsedDate = todayStr;

  saveStoredApiKeys(keys);
  return { valid: true, keyItem };
}
