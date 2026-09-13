import { NextResponse } from 'next/server';
import { verifySessionToken, createSessionToken, AUTH_COOKIE_NAME } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const token = searchParams.get('token') || searchParams.get('sso_token');
    const redirectPath = searchParams.get('redirect') || '/';

    if (!token) {
      return NextResponse.json(
        { success: false, error: 'Missing SSO token parameter.' },
        { status: 400 }
      );
    }

    const { valid, username } = verifySessionToken(token);

    if (!valid || !username) {
      return NextResponse.redirect(new URL('/login?error=invalid_sso_session', req.url));
    }

    // Refresh token with standard session duration
    const sessionCookieToken = createSessionToken(username);

    const redirectUrl = new URL(redirectPath, req.url);
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
    return NextResponse.redirect(new URL('/login?error=sso_server_error', req.url));
  }
}
