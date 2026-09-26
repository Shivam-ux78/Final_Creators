import { NextResponse } from 'next/server';
import { verifyToken, getBaseUrl, getMcpResourceUrl, CORS_HEADERS, corsPreflight } from '../../../lib/mcp-oauth';
import { TOOLS, ToolError, ToolContext } from '../../../lib/mcp-tools';

export const dynamic = 'force-dynamic';

// Remote MCP server (Streamable HTTP transport, stateless, JSON responses).
// Clients authenticate with an OAuth access token from /api/oauth/token.

const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const SERVER_INFO = { name: 'makeable-creators-mail', title: 'MakeAble Creators Mail', version: '1.0.0' };

interface AccessClaims {
  sub: string;
  client_id: string;
  resource: string;
}

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: any;
}

function rpcResult(id: JsonRpcMessage['id'], result: unknown) {
  return { jsonrpc: '2.0', id, result };
}

function rpcError(id: JsonRpcMessage['id'], code: number, message: string) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

function unauthorized(req: Request, error?: string) {
  const metadataUrl = `${getBaseUrl(req)}/.well-known/oauth-protected-resource`;
  const challenge = `Bearer resource_metadata="${metadataUrl}"${error ? `, error="${error}"` : ''}`;
  return NextResponse.json(
    { error: error || 'unauthorized', error_description: 'A valid OAuth access token is required.' },
    { status: 401, headers: { ...CORS_HEADERS, 'WWW-Authenticate': challenge } }
  );
}

async function handleMessage(msg: JsonRpcMessage, ctx: ToolContext) {
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    return msg && msg.id !== undefined ? rpcError(msg.id, -32600, 'Invalid Request') : null;
  }
  // Notifications (e.g. notifications/initialized) get no response
  if (msg.id === undefined || msg.id === null) return null;

  switch (msg.method) {
    case 'initialize': {
      const requested = msg.params?.protocolVersion;
      return rpcResult(msg.id, {
        protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : SUPPORTED_PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: 'Send creator outreach email via MakeAble. Call get_limit before bulk sends, and check get_status(email) or the suppression list before emailing someone. Never retry a send_mail that returned an error about suppression or daily limits.'
      });
    }

    case 'ping':
      return rpcResult(msg.id, {});

    case 'tools/list':
      return rpcResult(msg.id, {
        tools: TOOLS.map(({ handler, ...definition }) => definition)
      });

    case 'tools/call': {
      const tool = TOOLS.find(t => t.name === msg.params?.name);
      if (!tool) return rpcError(msg.id, -32602, `Unknown tool: ${msg.params?.name}`);

      const args = msg.params?.arguments && typeof msg.params.arguments === 'object' ? msg.params.arguments : {};
      try {
        const result = await tool.handler(args, ctx);
        return rpcResult(msg.id, {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
          isError: false
        });
      } catch (error: any) {
        if (!(error instanceof ToolError)) console.error(`MCP tool ${tool.name} failed:`, error);
        const details = error instanceof ToolError && error.details ? `\n${JSON.stringify(error.details, null, 2)}` : '';
        return rpcResult(msg.id, {
          content: [{ type: 'text', text: `${error.message || 'Tool failed.'}${details}` }],
          isError: true
        });
      }
    }

    default:
      return rpcError(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

export async function POST(req: Request) {
  const authHeader = req.headers.get('authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return unauthorized(req);

  let claims: AccessClaims | null;
  try {
    claims = verifyToken<AccessClaims>('access', authHeader.substring(7));
  } catch (error: any) {
    console.error('MCP auth configuration error:', error);
    return NextResponse.json({ error: 'server_error', error_description: error.message }, { status: 500, headers: CORS_HEADERS });
  }
  if (!claims || claims.resource !== getMcpResourceUrl(req)) return unauthorized(req, 'invalid_token');

  const ctx: ToolContext = {
    apiBase: (process.env.MAKEABLE_API_BASE_URL || getBaseUrl(req)).replace(/\/+$/, ''),
    user: claims.sub,
    clientId: claims.client_id
  };

  const payload = await req.json().catch(() => undefined);
  if (payload === undefined) {
    return NextResponse.json(rpcError(null, -32700, 'Parse error'), { status: 400, headers: CORS_HEADERS });
  }

  const responses = Array.isArray(payload)
    ? (await Promise.all(payload.map(m => handleMessage(m, ctx)))).filter(Boolean)
    : [await handleMessage(payload, ctx)].filter(Boolean);

  if (responses.length === 0) {
    return new NextResponse(null, { status: 202, headers: CORS_HEADERS });
  }
  return NextResponse.json(Array.isArray(payload) ? responses : responses[0], { headers: CORS_HEADERS });
}

// No server-initiated SSE stream and no sessions in this stateless server
export async function GET() {
  return new NextResponse(null, { status: 405, headers: { ...CORS_HEADERS, Allow: 'POST, OPTIONS' } });
}

export async function DELETE() {
  return new NextResponse(null, { status: 405, headers: { ...CORS_HEADERS, Allow: 'POST, OPTIONS' } });
}

export const OPTIONS = corsPreflight;
