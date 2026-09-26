import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export interface ApiKeyItem {
  id: string;
  name: string;
  key: string;
  createdAt: string;
  lastUsedAt?: string;
  status: 'active' | 'revoked';
}

const API_KEYS_FILE = path.join(process.cwd(), '.api_keys_store.json');

export function getStoredApiKeys(): ApiKeyItem[] {
  try {
    if (fs.existsSync(API_KEYS_FILE)) {
      const raw = fs.readFileSync(API_KEYS_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.keys)) {
        return parsed.keys;
      }
    }
  } catch (e) {
    console.warn('Error loading stored API keys:', e);
  }
  return [
    {
      id: 'key_default_1',
      name: 'Default Production API Key',
      key: 'mk_live_' + crypto.randomBytes(16).toString('hex'),
      createdAt: new Date().toISOString(),
      status: 'active'
    }
  ];
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

export function createNewApiKey(name: string): ApiKeyItem {
  const keys = getStoredApiKeys();
  const newKey: ApiKeyItem = {
    id: 'key_' + Date.now(),
    name: name.trim() || 'Custom API Key',
    key: 'mk_live_' + crypto.randomBytes(16).toString('hex'),
    createdAt: new Date().toISOString(),
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
