import { NextResponse } from 'next/server';
import { getBaseUrl, getMcpResourceUrl, CORS_HEADERS, corsPreflight, MCP_SCOPE } from '../../../lib/mcp-oauth';

export const dynamic = 'force-dynamic';

// RFC 9728 Protected Resource Metadata: tells MCP clients where to get tokens for /api/mcp
export async function GET(req: Request) {
  return NextResponse.json(
    {
      resource: getMcpResourceUrl(req),
      authorization_servers: [getBaseUrl(req)],
      scopes_supported: [MCP_SCOPE],
      bearer_methods_supported: ['header'],
      resource_name: 'MakeAble Creators Mail'
    },
    { headers: CORS_HEADERS }
  );
}

export const OPTIONS = corsPreflight;
