import { NextResponse } from 'next/server';
import { getStoredApiKeys } from '../../../../lib/api-keys-storage';
import { getTodaySentCountFromSupabase, getDailyLimitInfo } from '../../../../lib/creators-storage';

// Helper to resolve API Key details and usage
function resolveApiKeyLimitInfo(providedKey?: string | null) {
  const cleanKey = (providedKey || '').trim();
  const todayStr = new Date().toISOString().split('T')[0];
  const tomorrowReset = new Date(new Date().setUTCHours(24, 0, 0, 0)).toISOString();

  if (cleanKey) {
    const keys = getStoredApiKeys();
    const keyItem = keys.find(k => k.key === cleanKey);

    if (keyItem) {
      const todaySent = keyItem.lastUsedDate === todayStr ? (keyItem.todaySentCount || 0) : 0;
      const remaining = Math.max(0, keyItem.dailyLimit - todaySent);

      return {
        isKeySpecific: true,
        keyFound: true,
        keyId: keyItem.id,
        keyName: keyItem.name,
        apiKey: keyItem.key,
        dailyLimit: keyItem.dailyLimit,
        todaySentCount: todaySent,
        remainingQuota: remaining,
        totalSentCount: keyItem.totalSentCount || 0,
        status: keyItem.status,
        resetAt: tomorrowReset
      };
    }
  }

  return { isKeySpecific: false, keyFound: false };
}

// GET: Check API Key Limit, Today Sent Count, and Remaining Quota
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const authHeader = req.headers.get('authorization');
    const xApiKeyHeader = req.headers.get('x-api-key');
    const queryKey = searchParams.get('key') || searchParams.get('api_key') || searchParams.get('apiKey');

    const providedKey = xApiKeyHeader || (authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : '') || queryKey;
    const keyInfo = resolveApiKeyLimitInfo(providedKey);

    if (keyInfo.isKeySpecific) {
      if (keyInfo.status === 'revoked') {
        return NextResponse.json(
          { success: false, error: 'This API key has been revoked.', status: 'revoked' },
          { status: 401 }
        );
      }

      return NextResponse.json({
        success: true,
        type: 'api_key_quota',
        keyName: keyInfo.keyName,
        dailyLimit: keyInfo.dailyLimit,
        todaySentCount: keyInfo.todaySentCount,
        remainingQuota: keyInfo.remainingQuota,
        totalSentCount: keyInfo.totalSentCount,
        resetAt: keyInfo.resetAt,
        status: keyInfo.status
      });
    }

    // Default System Overall Quota fallback if no specific key provided
    const todaySentCount = await getTodaySentCountFromSupabase();
    const { totalDailyLimit, limitPerDomain } = getDailyLimitInfo();
    const tomorrowReset = new Date(new Date().setUTCHours(24, 0, 0, 0)).toISOString();

    return NextResponse.json({
      success: true,
      type: 'system_overall_quota',
      dailyLimit: totalDailyLimit,
      limitPerDomain,
      todaySentCount,
      remainingQuota: Math.max(0, totalDailyLimit - todaySentCount),
      resetAt: tomorrowReset,
      notice: 'Pass your API Key via x-api-key header or ?api_key= to get per-key specific limits.'
    });

  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to fetch limit info' },
      { status: 500 }
    );
  }
}

// POST: Check Limit via JSON Body
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const authHeader = req.headers.get('authorization');
    const xApiKeyHeader = req.headers.get('x-api-key');

    const providedKey = xApiKeyHeader || (authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : '') || body.apiKey || body.key || body.api_key;
    const keyInfo = resolveApiKeyLimitInfo(providedKey);

    if (keyInfo.isKeySpecific) {
      if (keyInfo.status === 'revoked') {
        return NextResponse.json(
          { success: false, error: 'This API key has been revoked.', status: 'revoked' },
          { status: 401 }
        );
      }

      return NextResponse.json({
        success: true,
        type: 'api_key_quota',
        keyName: keyInfo.keyName,
        dailyLimit: keyInfo.dailyLimit,
        todaySentCount: keyInfo.todaySentCount,
        remainingQuota: keyInfo.remainingQuota,
        totalSentCount: keyInfo.totalSentCount,
        resetAt: keyInfo.resetAt,
        status: keyInfo.status
      });
    }

    const todaySentCount = await getTodaySentCountFromSupabase();
    const { totalDailyLimit } = getDailyLimitInfo();
    const tomorrowReset = new Date(new Date().setUTCHours(24, 0, 0, 0)).toISOString();

    return NextResponse.json({
      success: true,
      type: 'system_overall_quota',
      dailyLimit: totalDailyLimit,
      todaySentCount,
      remainingQuota: Math.max(0, totalDailyLimit - todaySentCount),
      resetAt: tomorrowReset
    });

  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to fetch limit info' },
      { status: 500 }
    );
  }
}
