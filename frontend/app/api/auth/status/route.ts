import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifySessionToken, AUTH_COOKIE_NAME } from '@/lib/auth';

export async function GET() {
  const cookieStore = cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;
  const result = verifySessionToken(token);

  return NextResponse.json({
    authenticated: result.valid,
    username: result.username || null
  });
}
