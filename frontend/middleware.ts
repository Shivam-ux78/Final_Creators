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
  '/favicon.ico'
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 1. Allow Next.js static files and internal paths
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/static') ||
    pathname.includes('.') // static file extensions (css, js, images, svg, etc.)
  ) {
    return NextResponse.next();
  }

  // 2. Allow explicitly defined public routes
  if (PUBLIC_PATHS.some(path => pathname === path || pathname.startsWith(path + '/'))) {
    // If user is already authenticated and visits /login, redirect to dashboard /
    if (pathname === '/login') {
      const token = request.cookies.get(AUTH_COOKIE_NAME)?.value;
      if (token && token.length > 20) {
        return NextResponse.redirect(new URL('/', request.url));
      }
    }
    return NextResponse.next();
  }

  // 3. Protect all other pages and API endpoints
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
    const loginUrl = new URL('/login', request.url);
    if (pathname !== '/') {
      loginUrl.searchParams.set('from', pathname);
    }
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
