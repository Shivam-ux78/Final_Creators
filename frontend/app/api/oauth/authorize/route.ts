import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifySessionToken, AUTH_COOKIE_NAME } from '../../../../lib/auth';
import {
  signToken,
  verifyToken,
  getBaseUrl,
  getMcpResourceUrl,
  AUTH_CODE_TTL_SECONDS,
  CONSENT_TTL_SECONDS,
  MCP_SCOPE
} from '../../../../lib/mcp-oauth';

export const dynamic = 'force-dynamic';

interface ClientRegistration {
  redirect_uris: string[];
  client_name: string;
}

interface ConsentRequest {
  client_id: string;
  client_name: string;
  redirect_uri: string;
  state: string;
  code_challenge: string;
  resource: string;
  scope: string;
  sub: string;
}

const PAGE_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "frame-ancestors 'none'"
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function page(title: string, inner: string, status = 200) {
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f8fafc; color: #0f172a; margin: 0; padding: 48px 16px; }
  .card { max-width: 440px; margin: 0 auto; background: #fff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 28px; box-shadow: 0 10px 30px rgba(15, 23, 42, 0.06); }
  h1 { font-size: 18px; margin: 0 0 12px; }
  p, li { font-size: 14px; line-height: 1.6; color: #334155; }
  code { background: #f1f5f9; padding: 2px 6px; border-radius: 6px; font-size: 12px; word-break: break-all; }
  .actions { display: flex; gap: 12px; margin-top: 20px; }
  button { flex: 1; padding: 12px; border-radius: 10px; font-weight: 700; font-size: 14px; cursor: pointer; border: 1px solid #cbd5e1; background: #fff; color: #0f172a; }
  button.primary { background: #6366f1; border-color: #6366f1; color: #fff; }
</style></head>
<body><div class="card">${inner}</div></body></html>`;
  return new NextResponse(html, { status, headers: PAGE_HEADERS });
}

function errorPage(message: string) {
  return page('Authorization error', `<h1>Authorization error</h1><p>${escapeHtml(message)}</p>`, 400);
}

function redirectToClient(redirectUri: string, params: Record<string, string>) {
  const target = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) {
    if (value) target.searchParams.set(key, value);
  }
  return NextResponse.redirect(target.toString(), 303);
}

function currentSessionUser(): string | null {
  const session = verifySessionToken(cookies().get(AUTH_COOKIE_NAME)?.value);
  return session.valid && session.username ? session.username : null;
}

// GET: validate the authorization request, require dashboard login, show consent screen
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const params = url.searchParams;
    const clientId = params.get('client_id') || '';
    const redirectUri = params.get('redirect_uri') || '';
    const state = params.get('state') || '';

    const client = verifyToken<ClientRegistration>('client', clientId);
    if (!client) return errorPage('Unknown or expired client. Re-register the connector and try again.');
    if (!client.redirect_uris.includes(redirectUri)) return errorPage('redirect_uri does not match the registered client.');

    if (params.get('response_type') !== 'code') {
      return redirectToClient(redirectUri, { error: 'unsupported_response_type', state });
    }
    const codeChallenge = params.get('code_challenge') || '';
    if (!codeChallenge || params.get('code_challenge_method') !== 'S256') {
      return redirectToClient(redirectUri, { error: 'invalid_request', error_description: 'PKCE with S256 is required.', state });
    }

    const expectedResource = getMcpResourceUrl(req);
    const resource = params.get('resource') || expectedResource;
    if (resource.replace(/\/+$/, '') !== expectedResource) {
      return redirectToClient(redirectUri, { error: 'invalid_target', state });
    }

    const username = currentSessionUser();
    if (!username) {
      const loginUrl = new URL('/login', getBaseUrl(req));
      loginUrl.searchParams.set('from', url.pathname + url.search);
      return NextResponse.redirect(loginUrl.toString());
    }

    const consent = signToken('consent', {
      client_id: clientId,
      client_name: client.client_name,
      redirect_uri: redirectUri,
      state,
      code_challenge: codeChallenge,
      resource: expectedResource,
      scope: MCP_SCOPE,
      sub: username
    } satisfies ConsentRequest, CONSENT_TTL_SECONDS);

    const redirectHost = new URL(redirectUri).host;

    return page('Authorize connector', `
      <h1>Allow &ldquo;${escapeHtml(client.client_name)}&rdquo; to use MakeAble Mail?</h1>
      <p>Signed in as <strong>${escapeHtml(username)}</strong>. This connector will be able to:</p>
      <ul>
        <li>Send emails through the MakeAble sender rotation (counts against the daily limit)</li>
        <li>Check the daily limit and send status</li>
        <li>View and add email suppressions</li>
      </ul>
      <p>It will never see the mail API key. You will be returned to <code>${escapeHtml(redirectHost)}</code>.</p>
      <form method="POST" action="/api/oauth/authorize">
        <input type="hidden" name="consent" value="${escapeHtml(consent)}">
        <div class="actions">
          <button type="submit" name="decision" value="deny">Deny</button>
          <button type="submit" name="decision" value="approve" class="primary">Allow</button>
        </div>
      </form>
    `);
  } catch (error: any) {
    console.error('OAuth authorize error:', error);
    return errorPage(error.message || 'Authorization failed.');
  }
}

// POST: consent form submission -> issue a short-lived authorization code
export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const consent = verifyToken<ConsentRequest>('consent', String(form.get('consent') || ''));
    if (!consent) return errorPage('This authorization request has expired. Start the connection again.');

    const username = currentSessionUser();
    if (!username || username !== consent.sub) {
      return errorPage('Your dashboard session changed. Start the connection again.');
    }

    if (form.get('decision') !== 'approve') {
      return redirectToClient(consent.redirect_uri, { error: 'access_denied', state: consent.state });
    }

    const code = signToken('code', {
      client_id: consent.client_id,
      redirect_uri: consent.redirect_uri,
      code_challenge: consent.code_challenge,
      resource: consent.resource,
      scope: consent.scope,
      sub: consent.sub
    }, AUTH_CODE_TTL_SECONDS);

    return redirectToClient(consent.redirect_uri, { code, state: consent.state });
  } catch (error: any) {
    console.error('OAuth consent error:', error);
    return errorPage(error.message || 'Authorization failed.');
  }
}
