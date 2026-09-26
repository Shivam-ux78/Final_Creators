import { NextResponse } from 'next/server';
import { signToken, isAllowedRedirectUri, oauthError, CORS_HEADERS, corsPreflight } from '../../../../lib/mcp-oauth';

export const dynamic = 'force-dynamic';

// RFC 7591 Dynamic Client Registration. The client_id is a signed copy of the
// registration itself, so no client table is needed.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const redirectUris = body?.redirect_uris;

    if (!Array.isArray(redirectUris) || redirectUris.length === 0 || redirectUris.length > 10 || !redirectUris.every(isAllowedRedirectUri)) {
      return oauthError('invalid_redirect_uri', 'redirect_uris must be https URLs (or http on localhost / 127.0.0.1).');
    }

    const clientName = typeof body.client_name === 'string' && body.client_name.trim()
      ? body.client_name.trim().slice(0, 100)
      : 'MCP Client';

    const clientId = signToken('client', { redirect_uris: redirectUris, client_name: clientName });

    return NextResponse.json(
      {
        client_id: clientId,
        client_id_issued_at: Math.floor(Date.now() / 1000),
        client_name: clientName,
        redirect_uris: redirectUris,
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none'
      },
      { status: 201, headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store' } }
    );
  } catch (error: any) {
    console.error('OAuth register error:', error);
    return oauthError('server_error', error.message || 'Registration failed', 500);
  }
}

export const OPTIONS = corsPreflight;
