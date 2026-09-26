import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Server-only Supabase client using the secret (service role) key, which bypasses RLS.
// Used for tables that must never be readable with the public publishable key
// (api_keys, email_suppressions). Never import this from client components and
// never give the secret key a NEXT_PUBLIC_ prefix.

let adminClient: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (adminClient) return adminClient;

  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const secretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';

  if (!url || !secretKey) {
    throw new Error('SUPABASE_SECRET_KEY is not configured on the server.');
  }
  if (secretKey.startsWith('sb_publishable_')) {
    throw new Error('SUPABASE_SECRET_KEY must be the secret key (sb_secret_...), not the publishable key.');
  }

  adminClient = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  return adminClient;
}
