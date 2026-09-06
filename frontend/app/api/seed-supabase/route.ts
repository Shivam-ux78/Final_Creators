import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import fs from 'fs';
import path from 'path';

export async function POST() {
  try {
    const jsonPath = path.join(process.cwd(), '..', 'data', 'all_creators_merged.json');
    if (!fs.existsSync(jsonPath)) {
      return NextResponse.json({ success: false, error: 'Dataset file not found' }, { status: 404 });
    }

    const raw = fs.readFileSync(jsonPath, 'utf-8');
    const creators = JSON.parse(raw);

    const cleanRecords = creators.map((c: any) => ({
      username: (c.username || '').trim(),
      name: (c.name || c.username || '').trim(),
      email: (c.email || '').trim(),
      phone: c.phone || '',
      followers: String(c.followers || '0'),
      followers_num: Number(c.followers_num) || 0,
      category: c.category || 'Lifestyle',
      location: c.location || 'USA',
      biography: c.biography || '',
      instagram_url: c.instagram_url || `https://www.instagram.com/${c.username}`,
      is_verified: Boolean(c.is_verified),
      price: String(c.price || ''),
      rating: String(c.rating || ''),
      package_offer: String(c.package_offer || ''),
      external_url: String(c.external_url || ''),
      email_status: c.email_status === 'sent' ? 'sent' : 'not_sent',
      last_emailed_at: c.last_emailed_at || null,
      email_subject: c.email_subject || '',
      email_body: c.email_body || ''
    }));

    // Batch upsert into Supabase table in chunks of 50
    const chunkSize = 50;
    let inserted = 0;

    for (let i = 0; i < cleanRecords.length; i += chunkSize) {
      const chunk = cleanRecords.slice(i, i + chunkSize);
      const { data, error } = await supabase
        .from('creators')
        .upsert(chunk, { onConflict: 'username' });

      if (error) {
        throw new Error(`Supabase error at chunk ${i}: ${error.message}`);
      }
      inserted += chunk.length;
    }

    return NextResponse.json({
      success: true,
      seededCount: inserted,
      total: cleanRecords.length,
      message: `Successfully synced ${inserted} creators into Supabase database!`
    });

  } catch (error: any) {
    console.error('Seed Supabase error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to seed Supabase' },
      { status: 500 }
    );
  }
}
