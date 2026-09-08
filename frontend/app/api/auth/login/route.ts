import { NextResponse } from 'next/server';
import { createSessionToken, AUTH_COOKIE_NAME } from '@/lib/auth';

export async function POST(req: Request) {
  try {
    const { username, password } = await req.json();

    const expectedUsername = (process.env.ADMIN_USERNAME || 'admin').trim().toLowerCase();
    const expectedPassword = (process.env.ADMIN_PASSWORD || 'makeable2026').trim();

    const inputUser = (username || '').trim().toLowerCase();
    const inputPass = (password || '').trim();

    if (!inputUser || !inputPass) {
      return NextResponse.json(
        { success: false, error: 'Please provide both username/email and password.' },
        { status: 400 }
      );
    }

    // Support logging in with admin username or admin email
    const isValidUser = inputUser === expectedUsername || inputUser === 'shivam' || inputUser === 'admin@makeable.nyc';
    const isValidPass = inputPass === expectedPassword;

    if (!isValidUser || !isValidPass) {
      return NextResponse.json(
        { success: false, error: 'Invalid username or password. Please try again.' },
        { status: 401 }
      );
    }

    const token = createSessionToken(inputUser);

    const response = NextResponse.json({
      success: true,
      message: 'Login successful',
      user: { username: inputUser }
    });

    // Set secure HTTP-Only cookie for 7 days
    response.cookies.set({
      name: AUTH_COOKIE_NAME,
      value: token,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 // 7 days in seconds
    });

    return response;
  } catch (err: any) {
    console.error('Login error:', err);
    return NextResponse.json(
      { success: false, error: 'An unexpected authentication error occurred.' },
      { status: 500 }
    );
  }
}
