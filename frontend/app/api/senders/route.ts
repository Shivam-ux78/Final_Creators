import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  getConfiguredSenders,
  addCustomSender,
  removeCustomSender
} from '../../../lib/senders-config';
import { verifySessionToken, AUTH_COOKIE_NAME } from '../../../lib/auth';

export const dynamic = 'force-dynamic';

function hasDashboardSession(): boolean {
  return verifySessionToken(cookies().get(AUTH_COOKIE_NAME)?.value).valid;
}

export async function GET() {
  try {
    const senders = getConfiguredSenders().map(s => ({
      id: s.id,
      senderName: s.senderName,
      senderEmail: s.senderEmail,
      label: s.label,
      category: s.category
    }));

    return NextResponse.json({
      success: true,
      total: senders.length,
      counts: {
        outreach: senders.filter(s => s.category === 'outreach').length,
        hr: senders.filter(s => s.category === 'hr').length,
        custom: senders.filter(s => s.category === 'custom').length
      },
      senders
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to load senders' },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    if (!hasDashboardSession()) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized. Log in to the dashboard to add custom senders.' },
        { status: 401 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const email = (body.email || body.senderEmail || '').trim();
    const senderName = (body.senderName || body.name || '').trim();

    const result = addCustomSender(email, senderName);
    if (!result.added) {
      return NextResponse.json(
        { success: false, error: result.error || 'Invalid custom email.' },
        { status: 400 }
      );
    }

    const senders = getConfiguredSenders().map(s => ({
      id: s.id,
      senderName: s.senderName,
      senderEmail: s.senderEmail,
      label: s.label,
      category: s.category
    }));

    return NextResponse.json({
      success: true,
      message: `Custom sender ${email.toLowerCase()} added.`,
      email: email.toLowerCase(),
      senders
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to add custom sender' },
      { status: 500 }
    );
  }
}

export async function DELETE(req: Request) {
  try {
    if (!hasDashboardSession()) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized. Log in to the dashboard to remove custom senders.' },
        { status: 401 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const email = (body.email || body.senderEmail || '').trim();
    if (!email) {
      return NextResponse.json(
        { success: false, error: 'Email is required.' },
        { status: 400 }
      );
    }

    removeCustomSender(email);
    const senders = getConfiguredSenders().map(s => ({
      id: s.id,
      senderName: s.senderName,
      senderEmail: s.senderEmail,
      label: s.label,
      category: s.category
    }));

    return NextResponse.json({
      success: true,
      message: `Custom sender ${email.toLowerCase()} removed.`,
      senders
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to remove custom sender' },
      { status: 500 }
    );
  }
}

