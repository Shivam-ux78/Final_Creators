import { NextResponse } from 'next/server';
import {
  signToken,
  verifyToken,
  pkceMatches,
  oauthError,
  corsPreflight,
  getMcpResourceUrl,
  CORS_HEADERS,
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS
} from '../../../../lib/mcp-oauth';

export const dynamic = 'force-dynamic';

interface GrantClaims {
  client_id: string;
  resource: string;
  scope: string;
  sub: string;
}

interface CodeClaims extends GrantClaims {
  redirect_uri: string;
  code_challenge: string;
}

async function readParams(req: Request): Promise<Record<string, string>> {
  const contentType = req.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const body = await req.json().catch(() => ({}));
    return Object.fromEntries(Object.entries(body || {}).map(([k, v]) => [k, String(v ?? '')]));
  }
  const text = await req.text();
  return Object.fromEntries(new URLSearchParams(text));
}

function issueTokens(claims: GrantClaims) {
  const base = { sub: claims.sub, client_id: claims.client_id, resource: claims.resource, scope: claims.scope };
  return NextResponse.json(
    {
      access_token: signToken('access', base, ACCESS_TOKEN_TTL_SECONDS),
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      refresh_token: signToken('refresh', base, REFRESH_TOKEN_TTL_SECONDS),
      scope: claims.scope
    },
    { headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store', Pragma: 'no-cache' } }
  );
}

export async function POST(req: Request) {
  try {
    const params = await readParams(req);
    const expectedResource = getMcpResourceUrl(req);

    if (params.resource && params.resource.replace(/\/+$/, '') !== expectedResource) {
      return oauthError('invalid_target', 'Unknown resource.');
    }

    if (params.grant_type === 'authorization_code') {
      const code = verifyToken<CodeClaims>('code', params.code);
      if (!code) return oauthError('invalid_grant', 'Authorization code is invalid or expired.');
      if (params.client_id && params.client_id !== code.client_id) return oauthError('invalid_grant', 'client_id mismatch.');
      if (params.redirect_uri !== code.redirect_uri) return oauthError('invalid_grant', 'redirect_uri mismatch.');
      if (!pkceMatches(params.code_verifier || '', code.code_challenge)) return oauthError('invalid_grant', 'PKCE verification failed.');
      if (code.resource !== expectedResource) return oauthError('invalid_grant', 'Code was issued for a different resource.');
      return issueTokens(code);
    }

    if (params.grant_type === 'refresh_token') {
      const refresh = verifyToken<GrantClaims>('refresh', params.refresh_token);
      if (!refresh) return oauthError('invalid_grant', 'Refresh token is invalid or expired.');
      if (params.client_id && params.client_id !== refresh.client_id) return oauthError('invalid_grant', 'client_id mismatch.');
      if (refresh.resource !== expectedResource) return oauthError('invalid_grant', 'Token was issued for a different resource.');
      return issueTokens(refresh);
    }

    return oauthError('unsupported_grant_type', 'Only authorization_code and refresh_token are supported.');
  } catch (error: any) {
    console.error('OAuth token error:', error);
    return oauthError('server_error', error.message || 'Token request failed', 500);
  }
}

export const OPTIONS = corsPreflight;
