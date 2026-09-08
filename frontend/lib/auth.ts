import crypto from 'crypto';

const AUTH_SECRET = process.env.AUTH_SECRET || process.env.JWT_SECRET || 'makeable_super_secret_session_key_2026';
export const AUTH_COOKIE_NAME = 'makeable_auth_token';

// Simple, fast, secure HMAC-based session token
export function createSessionToken(username: string): string {
  const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days
  const payload = `${username}:${expiresAt}`;
  const signature = crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('hex');
  return Buffer.from(`${payload}:${signature}`).toString('base64');
}

export function verifySessionToken(token: string | undefined): { valid: boolean; username?: string } {
  if (!token) return { valid: false };

  try {
    const decoded = Buffer.from(token, 'base64').toString('utf-8');
    const parts = decoded.split(':');
    if (parts.length !== 3) return { valid: false };

    const [username, expiresAtStr, signature] = parts;
    const expiresAt = parseInt(expiresAtStr, 10);

    if (isNaN(expiresAt) || Date.now() > expiresAt) {
      return { valid: false };
    }

    const payload = `${username}:${expiresAtStr}`;
    const expectedSignature = crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('hex');

    if (crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
      return { valid: true, username };
    }
  } catch (e) {
    // Malformed token
  }

  return { valid: false };
}
