import { NextResponse } from 'next/server';
import { getStoredApiKeys, createNewApiKey, revokeApiKey } from '../../../lib/api-keys-storage';

// GET: List all API Keys
export async function GET() {
  try {
    const keys = getStoredApiKeys();
    return NextResponse.json({
      success: true,
      keys
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to fetch API keys' },
      { status: 500 }
    );
  }
}

// POST: Create a New API Key
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { name, dailyLimit } = body;

    const keyName = (name || 'Production API Key').trim();
    const limitNum = typeof dailyLimit === 'number' && dailyLimit > 0 ? dailyLimit : Number(dailyLimit) || 100;
    const newKey = createNewApiKey(keyName, limitNum);

    return NextResponse.json({
      success: true,
      message: 'API Key successfully created!',
      apiKey: newKey,
      keys: getStoredApiKeys()
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to create API key' },
      { status: 500 }
    );
  }
}

// DELETE: Revoke an API Key
export async function DELETE(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { id } = body;

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'API Key ID is required to revoke.' },
        { status: 400 }
      );
    }

    revokeApiKey(id);

    return NextResponse.json({
      success: true,
      message: 'API Key successfully revoked.',
      keys: getStoredApiKeys()
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to revoke API key' },
      { status: 500 }
    );
  }
}
