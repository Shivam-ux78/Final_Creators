import { NextResponse } from 'next/server';
import { verifySessionToken, createSessionToken, AUTH_COOKIE_NAME } from '../../../../lib/auth';

export const dynamic = 'force-dynamic';

function getPublicBaseUrl(req: Request): string {
  const forwardedHost = req.headers.get('x-forwarded-host');
  const host = forwardedHost || req.headers.get('host') || 'creators.makeable.nyc';
  const proto = req.headers.get('x-forwarded-proto') || (host.includes('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

export async function GET(req: Request) {
  try {
    const urlObj = new URL(req.url);
    const token = urlObj.searchParams.get('token') || urlObj.searchParams.get('sso_token');
    const redirectPath = urlObj.searchParams.get('redirect') || '/';

    const baseUrl = getPublicBaseUrl(req);

    if (!token) {
      return NextResponse.json(
        { success: false, error: 'Missing SSO token parameter.' },
        { status: 400 }
      );
    }

    const { valid, username } = verifySessionToken(token);

    if (!valid || !username) {
      return NextResponse.redirect(new URL('/login?error=invalid_sso_session', baseUrl));
    }

    // Refresh token with standard session duration
    const sessionCookieToken = createSessionToken(username);

    const targetPath = redirectPath.startsWith('/') ? redirectPath : `/${redirectPath}`;
    const redirectUrl = new URL(targetPath, baseUrl);
    const response = NextResponse.redirect(redirectUrl);

    // Set secure authentication cookie
    response.cookies.set({
      name: AUTH_COOKIE_NAME,
      value: sessionCookieToken,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 // 7 days in seconds
    });

    return response;
  } catch (err: any) {
    console.error('SSO Handshake error:', err);
    const baseUrl = getPublicBaseUrl(req);
    return NextResponse.redirect(new URL('/login?error=sso_server_error', baseUrl));
  }
}