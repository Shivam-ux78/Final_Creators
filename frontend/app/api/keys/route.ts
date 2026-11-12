import { NextResponse } from 'next/server';
import {
  getStoredApiKeysAsync,
  createNewApiKeyAsync,
  updateApiKeySendersAsync,
  revokeApiKeyAsync,
  rotateApiKeyAsync
} from '../../../lib/api-keys-storage';

// GET: List all API Keys with count summary
export async function GET() {
  try {
    const keys = await getStoredApiKeysAsync();
    const activeKeys = keys.filter(k => k.status === 'active');
    const revokedKeys = keys.filter(k => k.status === 'revoked');
    const combinedDailyLimit = activeKeys.reduce((acc, k) => acc + (k.dailyLimit || 100), 0);

    return NextResponse.json({
      success: true,
      totalKeys: keys.length,
      activeKeysCount: activeKeys.length,
      revokedKeysCount: revokedKeys.length,
      combinedActiveDailyLimit: combinedDailyLimit,
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
    const { name, dailyLimit, allowedSenders, customSenderName } = body;

    const keyName = (name || 'Production API Key').trim();
    const limitNum = typeof dailyLimit === 'number' && dailyLimit > 0 ? dailyLimit : Number(dailyLimit) || 500;
    const newKey = await createNewApiKeyAsync(
      keyName,
      limitNum,
      Array.isArray(allowedSenders) ? allowedSenders : undefined,
      typeof customSenderName === 'string' ? customSenderName : undefined
    );
    const updatedKeys = await getStoredApiKeysAsync();

    return NextResponse.json({
      success: true,
      message: 'API Key successfully created!',
      apiKey: newKey,
      keys: updatedKeys
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to create API key' },
      { status: 500 }
    );
  }
}

// PUT: Update allowed sender mail IDs / custom sender name for an existing API Key
export async function PUT(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { id, allowedSenders, customSenderName } = body;

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'API Key ID is required.' },
        { status: 400 }
      );
    }

    const updated = await updateApiKeySendersAsync(
      id,
      Array.isArray(allowedSenders) ? allowedSenders : undefined,
      typeof customSenderName === 'string' ? customSenderName : undefined
    );

    if (!updated) {
      return NextResponse.json(
        { success: false, error: `API Key with ID "${id}" not found.` },
        { status: 404 }
      );
    }

    const updatedKeys = await getStoredApiKeysAsync();
    return NextResponse.json({
      success: true,
      message: `Sender configuration updated for "${updated.name}".`,
      apiKey: updated,
      keys: updatedKeys
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to update API key senders' },
      { status: 500 }
    );
  }
}

// PATCH: Rotate an existing API Key (Generates a new key string)
export async function PATCH(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { id } = body;

    const keyId = id || 'key_default_1';
    const rotated = await rotateApiKeyAsync(keyId);

    if (!rotated) {
      return NextResponse.json(
        { success: false, error: `API Key with ID "${keyId}" not found.` },
        { status: 404 }
      );
    }

    const updatedKeys = await getStoredApiKeysAsync();

    return NextResponse.json({
      success: true,
      message: `API Key "${rotated.name}" successfully rotated!`,
      rotatedKey: rotated,
      keys: updatedKeys
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to rotate API key' },
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

    await revokeApiKeyAsync(id);
    const updatedKeys = await getStoredApiKeysAsync();

    return NextResponse.json({
      success: true,
      message: 'API Key successfully revoked.',
      keys: updatedKeys
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to revoke API key' },
      { status: 500 }
    );
  }
}
