import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET() {
  const startTime = Date.now();
  let dbStatus = 'connected';
  let totalCreators = 0;

  try {
    const { count, error } = await supabase
      .from('creators')
      .select('*', { count: 'exact', head: true });
    
    if (error) {
      dbStatus = `degraded: ${error.message}`;
    } else {
      totalCreators = count || 0;
    }
  } catch (err: any) {
    dbStatus = `error: ${err.message}`;
  }

  const responseTimeMs = Date.now() - startTime;

  return NextResponse.json(
    {
      status: 'healthy',
      service: 'MakeAble Creator Outreach Platform',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      responseTimeMs,
      database: {
        status: dbStatus,
        totalCreators
      },
      environment: process.env.NODE_ENV || 'production'
    },
    {
      status: 200,
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate'
      }
    }
  );
}
