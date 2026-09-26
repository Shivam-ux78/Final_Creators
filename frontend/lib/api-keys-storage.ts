import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

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

export function getStoredApiKeys(): ApiKeyItem[] {
  const todayStr = new Date().toISOString().split('T')[0];

  try {
    if (fs.existsSync(API_KEYS_FILE)) {
      const raw = fs.readFileSync(API_KEYS_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.keys)) {
        return parsed.keys.map((k: any) => ({
          id: k.id || 'key_' + Math.random(),
          name: k.name || 'API Key',
          key: k.key,
          dailyLimit: typeof k.dailyLimit === 'number' && k.dailyLimit > 0 ? k.dailyLimit : 100,
          createdAt: k.createdAt || new Date().toISOString(),
          lastUsedAt: k.lastUsedAt,
          lastUsedDate: k.lastUsedDate || todayStr,
          todaySentCount: k.lastUsedDate === todayStr ? (k.todaySentCount || 0) : 0,
          totalSentCount: k.totalSentCount || 0,
          status: k.status || 'active'
        }));
      }
    }
  } catch (e) {
    console.warn('Error loading stored API keys:', e);
  }

  const initialKey: ApiKeyItem = {
    id: 'key_default_1',
    name: 'Default Production API Key',
    key: 'mk_live_' + crypto.randomBytes(16).toString('hex'),
    dailyLimit: 100,
    createdAt: new Date().toISOString(),
    todaySentCount: 0,
    totalSentCount: 0,
    lastUsedDate: todayStr,
    status: 'active'
  };

  saveStoredApiKeys([initialKey]);
  return [initialKey];
}

export function saveStoredApiKeys(keys: ApiKeyItem[]): boolean {
  try {
    fs.writeFileSync(
      API_KEYS_FILE,
      JSON.stringify({ keys, updatedAt: new Date().toISOString() }, null, 2),
      'utf-8'
    );
    return true;
  } catch (e) {
    console.warn('Error saving stored API keys:', e);
    return false;
  }
}

export function createNewApiKey(name: string, dailyLimit?: number): ApiKeyItem {
  const keys = getStoredApiKeys();
  const limit = typeof dailyLimit === 'number' && dailyLimit > 0 ? dailyLimit : 100;
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

export function revokeApiKey(id: string): boolean {
  const keys = getStoredApiKeys();
  const updated = keys.map(k => {
    if (k.id === id) {
      return { ...k, status: 'revoked' as const };
    }
    return k;
  });
  return saveStoredApiKeys(updated);
}

// Validate Key and Enforce Per-Key Daily Limit
export function validateAndRecordKeyUsage(keyString: string): {
  valid: boolean;
  error?: string;
  keyItem?: ApiKeyItem;
} {
  if (!keyString || !keyString.trim()) {
    return { valid: true }; // No key provided, fallback to standard route limits
  }

  const cleanKey = keyString.trim();
  const keys = getStoredApiKeys();
  const keyItem = keys.find(k => k.key === cleanKey);

  if (!keyItem) {
    // If it's a Resend API Key (starts with re_), allow it through
    if (cleanKey.startsWith('re_')) {
      return { valid: true };
    }
    return { valid: false, error: 'Invalid API Key provided.' };
  }

  if (keyItem.status === 'revoked') {
    return { valid: false, error: 'This API Key has been revoked.' };
  }

  const todayStr = new Date().toISOString().split('T')[0];
  let currentTodaySent = keyItem.todaySentCount || 0;

  // Reset counter if new day
  if (keyItem.lastUsedDate !== todayStr) {
    currentTodaySent = 0;
  }

  // Check Daily Limit for this Key
  if (currentTodaySent >= keyItem.dailyLimit) {
    return {
      valid: false,
      error: `Daily limit of ${keyItem.dailyLimit} emails for API key "${keyItem.name}" has been reached for today.`,
      keyItem
    };
  }

  // Increment Usage
  keyItem.todaySentCount = currentTodaySent + 1;
  keyItem.totalSentCount = (keyItem.totalSentCount || 0) + 1;
  keyItem.lastUsedAt = new Date().toISOString();
  keyItem.lastUsedDate = todayStr;

  saveStoredApiKeys(keys);
  return { valid: true, keyItem };
}
