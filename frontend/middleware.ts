import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const AUTH_COOKIE_NAME = 'makeable_auth_token';
// Must match lib/auth.ts (which uses Node crypto and can't run in the Edge middleware)
const AUTH_SECRET = process.env.AUTH_SECRET || process.env.JWT_SECRET || 'makeable_super_secret_session_key_2026';

// Verify the HMAC-signed session cookie created by lib/auth.ts createSessionToken()
async function isValidSession(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  try {
    const parts = atob(token).split(':');
    if (parts.length !== 3) return false;

    const [username, expiresAtStr, signature] = parts;
    const expiresAt = parseInt(expiresAtStr, 10);
    if (isNaN(expiresAt) || Date.now() > expiresAt) return false;

    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', encoder.encode(AUTH_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const digest = await crypto.subtle.sign('HMAC', key, encoder.encode(`${username}:${expiresAtStr}`));
    const expected = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');

    if (expected.length !== signature.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
    return diff === 0;
  } catch (e) {
    return false;
  }
}

// Public endpoints and static assets that bypass cookie authentication
const PUBLIC_PATHS = [
  '/login',
  '/health',
  '/api/health',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/status',
  '/api/auth/sso',
  '/api/v1/send-mail',
  '/api/v1/limit',
  '/api/mcp', // MCP connector: authenticates its own OAuth bearer tokens
  '/api/oauth', // OAuth endpoints for the MCP connector (authorize checks the session itself)
  '/favicon.ico'
];

export async function middleware(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;

  // 1. Allow Next.js static files and internal paths
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/static') ||
    pathname.includes('.') // static file extensions (css, js, images, svg, etc.)
  ) {
    return NextResponse.next();
  }

  // 2. If an SSO token is provided in the query string, route to /api/auth/sso
  const ssoToken = searchParams.get('sso_token') || searchParams.get('token');
  if (ssoToken && pathname !== '/api/auth/sso') {
    const ssoUrl = request.nextUrl.clone();
    ssoUrl.pathname = '/api/auth/sso';
    ssoUrl.searchParams.set('token', ssoToken);
    
    // Preserve target redirect
    const cleanUrl = request.nextUrl.clone();
    cleanUrl.searchParams.delete('sso_token');
    cleanUrl.searchParams.delete('token');
    ssoUrl.searchParams.set('redirect', cleanUrl.pathname + cleanUrl.search);
    
    return NextResponse.redirect(ssoUrl);
  }

  // 3. Allow explicitly defined public routes and API v1 endpoints
  if (
    PUBLIC_PATHS.some(path => pathname === path || pathname.startsWith(path + '/')) ||
    pathname.startsWith('/api/v1/')
  ) {
    // If user is already authenticated and visits /login, redirect to dashboard /
    if (pathname === '/login') {
      if (await isValidSession(request.cookies.get(AUTH_COOKIE_NAME)?.value)) {
        const dest = request.nextUrl.clone();
        dest.pathname = '/';
        dest.search = '';
        return NextResponse.redirect(dest);
      }
    }
    return NextResponse.next();
  }

  // 4. Protect all other pages and API endpoints with a verified dashboard session.
  // (API-key access is only for /api/v1/*, which validates keys itself.)
  if (!(await isValidSession(request.cookies.get(AUTH_COOKIE_NAME)?.value))) {
    // For API routes, return 401 Unauthorized
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized. Please log in to the dashboard.' },
        { status: 401 }
      );
    }

    // For Page routes, redirect to /login with redirect URL
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    if (pathname !== '/') {
      loginUrl.searchParams.set('from', pathname);
    }
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};