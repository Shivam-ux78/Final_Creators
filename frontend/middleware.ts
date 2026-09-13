import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const AUTH_COOKIE_NAME = 'makeable_auth_token';

// Public endpoints and static assets that bypass authentication
const PUBLIC_PATHS = [
  '/login',
  '/health',
  '/api/health',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/status',
  '/api/auth/sso',
  '/favicon.ico'
];

export function middleware(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;

  // 1. Allow Next.js static files and internal paths
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/static') ||
    pathname.includes('.') // static file extensions (css, js, images, svg, etc.)
  ) {
    return NextResponse.next();
  }

  // 2. If an SSO token is provided in the query string, route to /api/auth/sso using request.nextUrl.clone()
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

  // 3. Allow explicitly defined public routes
  if (PUBLIC_PATHS.some(path => pathname === path || pathname.startsWith(path + '/'))) {
    // If user is already authenticated and visits /login, redirect to dashboard /
    if (pathname === '/login') {
      const token = request.cookies.get(AUTH_COOKIE_NAME)?.value;
      if (token && token.length > 20) {
        const dest = request.nextUrl.clone();
        dest.pathname = '/';
        dest.search = '';
        return NextResponse.redirect(dest);
      }
    }
    return NextResponse.next();
  }

  // 4. Protect all other pages and API endpoints
  const token = request.cookies.get(AUTH_COOKIE_NAME)?.value;

  if (!token || token.length < 20) {
    // For API routes, return 401 Unauthorized
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized. Please login to access this API.' },
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