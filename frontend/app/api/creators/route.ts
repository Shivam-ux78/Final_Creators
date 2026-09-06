import { NextResponse } from 'next/server';
import { getAllCreators, recordEmailSent } from '@/lib/creators-storage';
import { supabase } from '@/lib/supabase';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const dateFilter = searchParams.get('dateFilter') || 'all';
    const emailStatus = searchParams.get('emailStatus') || 'all';
    const search = searchParams.get('search') || '';
    const category = searchParams.get('category') || '';

    const { creators: dbData, isFromDb } = await getAllCreators();

    // Format fields & apply in-memory filters
    let results = dbData.map((c: any, index: number) => ({
      id: c.id || index + 1,
      username: c.username || '',
      name: c.name || c.username || '',
      email: c.email || '',
      phone: c.phone || '',
      followers: c.followers || '0',
      followers_num: Number(c.followers_num) || 0,
      category: c.category || 'Lifestyle',
      location: c.location || 'USA',
      biography: c.biography || '',
      instagram_url: c.instagram_url || `https://www.instagram.com/${c.username}`,
      is_verified: Boolean(c.is_verified),
      price: c.price || '',
      rating: c.rating || '',
      package_offer: c.package_offer || '',
      external_url: c.external_url || '',
      email_status: c.email_status || 'not_sent',
      last_emailed_at: c.last_emailed_at || null,
      email_subject: c.email_subject || '',
      email_body: c.email_body || '',
      created_at: c.created_at || new Date().toISOString(),
    }));

    // Search filter
    if (search.trim()) {
      const q = search.toLowerCase();
      results = results.filter(
        (c) =>
          c.username.toLowerCase().includes(q) ||
          c.name.toLowerCase().includes(q) ||
          c.email.toLowerCase().includes(q) ||
          c.biography.toLowerCase().includes(q) ||
          c.category.toLowerCase().includes(q)
      );
    }

    // Category filter
    if (category && category !== 'All') {
      results = results.filter((c) =>
        c.category.toLowerCase().includes(category.toLowerCase())
      );
    }

    // Email status filter
    if (emailStatus && emailStatus !== 'all') {
      results = results.filter((c) => c.email_status === emailStatus);
    }

    // Date & Time filter (Today, 7 days, 30 days)
    if (dateFilter === 'today') {
      const today = new Date().toISOString().split('T')[0];
      results = results.filter((c) => (c.created_at || '').startsWith(today));
    } else if (dateFilter === 'last_7_days') {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      results = results.filter((c) => (c.created_at || '') >= sevenDaysAgo);
    } else if (dateFilter === 'last_30_days') {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      results = results.filter((c) => (c.created_at || '') >= thirtyDaysAgo);
    }

    return NextResponse.json({
      success: true,
      total: results.length,
      creators: results,
      isFromDb,
    });
  } catch (error: any) {
    console.error('Creators API error:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

export async function PATCH(req: Request) {
  try {
    const { username, email, email_status, email_subject, email_body, notes } = await req.json();

    if (!username && !email) {
      return NextResponse.json({ success: false, error: 'Missing username or email' }, { status: 400 });
    }

    if (email_status === 'sent') {
      await recordEmailSent({
        username: username || '',
        email: email || '',
        subject: email_subject || '',
        body: email_body || ''
      });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
