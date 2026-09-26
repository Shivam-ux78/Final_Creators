import { NextResponse } from 'next/server';
import { getBaseUrl, CORS_HEADERS, corsPreflight, MCP_SCOPE } from '../../../lib/mcp-oauth';

export const dynamic = 'force-dynamic';

// RFC 8414 Authorization Server Metadata for the MCP connector
export async function GET(req: Request) {
  const base = getBaseUrl(req);
  return NextResponse.json(
    {
      issuer: base,
      authorization_endpoint: `${base}/api/oauth/authorize`,
      token_endpoint: `${base}/api/oauth/token`,
      registration_endpoint: `${base}/api/oauth/register`,
      scopes_supported: [MCP_SCOPE],
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none']
    },
    { headers: CORS_HEADERS }
  );
}

export const OPTIONS = corsPreflight;
