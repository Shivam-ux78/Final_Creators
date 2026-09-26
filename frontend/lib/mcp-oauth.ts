import crypto from 'crypto';
import { NextResponse } from 'next/server';

// Stateless OAuth 2.1 helpers for the MCP connector.
// Every artifact (client registration, auth code, access/refresh token) is an
// HMAC-signed payload, so nothing needs to be stored. Rotating MCP_OAUTH_SECRET
// instantly revokes every issued client, code and token.

export type OAuthTokenType = 'client' | 'consent' | 'code' | 'access' | 'refresh';

export const AUTH_CODE_TTL_SECONDS = 5 * 60;
export const CONSENT_TTL_SECONDS = 10 * 60;
export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
export const MCP_SCOPE = 'mail';

function getSecret(): string {
  const secret = process.env.MCP_OAUTH_SECRET || '';
  if (secret.length < 32) {
    throw new Error('MCP_OAUTH_SECRET is not configured (must be at least 32 characters).');
  }
  return secret;
}

function hmac(typ: OAuthTokenType, encoded: string): string {
  return crypto.createHmac('sha256', getSecret()).update(`${typ}.${encoded}`).digest('base64url');
}

export function signToken(typ: OAuthTokenType, payload: Record<string, any>, ttlSeconds?: number): string {
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, typ, iat: now, ...(ttlSeconds ? { exp: now + ttlSeconds } : {}) };
  const encoded = Buffer.from(JSON.stringify(body)).toString('base64url');
  return `${encoded}.${hmac(typ, encoded)}`;
}

export function verifyToken<T = Record<string, any>>(typ: OAuthTokenType, token: string | null | undefined): (T & { iat: number; exp?: number }) | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [encoded, signature] = parts;
  const expected = hmac(typ, encoded);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const body = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf-8'));
    if (body.typ !== typ) return null;
    if (typeof body.exp === 'number' && Math.floor(Date.now() / 1000) > body.exp) return null;
    return body;
  } catch (e) {
    return null;
  }
}

export function pkceMatches(verifier: string, challenge: string): boolean {
  if (!verifier || !challenge) return false;
  const computed = crypto.createHash('sha256').update(verifier).digest('base64url');
  const a = Buffer.from(computed);
  const b = Buffer.from(challenge);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Only https redirect URIs, or http on loopback (native clients such as Codex CLI)
export function isAllowedRedirectUri(uri: unknown): boolean {
  if (typeof uri !== 'string') return false;
  try {
    const parsed = new URL(uri);
    if (parsed.hash) return false;
    if (parsed.protocol === 'https:') return true;
    return parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  } catch (e) {
    return false;
  }
}

export function getBaseUrl(req: Request): string {
  const configured = (process.env.PUBLIC_BASE_URL || '').trim();
  if (configured) return configured.replace(/\/+$/, '');

  const url = new URL(req.url);
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || url.host;
  const proto = req.headers.get('x-forwarded-proto') || url.protocol.replace(':', '');
  return `${proto}://${host}`;
}

export function getMcpResourceUrl(req: Request): string {
  return `${getBaseUrl(req)}/api/mcp`;
}

export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Mcp-Protocol-Version, Mcp-Session-Id',
  'Access-Control-Expose-Headers': 'WWW-Authenticate, Mcp-Session-Id'
};

export function corsPreflight() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export function oauthError(error: string, description: string, status = 400) {
  return NextResponse.json(
    { error, error_description: description },
    { status, headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store' } }
  );
}
