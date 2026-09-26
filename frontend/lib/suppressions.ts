import { supabase } from './supabase';

// Email suppression list stored in Supabase (see email_suppressions in schema.sql).
// Lookups fail closed: if the table can't be read, callers must not send.

export interface SuppressionItem {
  email: string;
  reason: string;
  source: string;
  created_at: string;
}

const TABLE = 'email_suppressions';

export function normalizeEmail(email: string): string {
  return (email || '').trim().toLowerCase();
}

export async function getSuppression(email: string): Promise<SuppressionItem | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select('email, reason, source, created_at')
    .eq('email', normalizeEmail(email))
    .maybeSingle();

  if (error) throw new Error(`Suppression list lookup failed: ${error.message}`);
  return data as SuppressionItem | null;
}

export async function addSuppression(email: string, reason: string, source: string): Promise<SuppressionItem> {
  const { data, error } = await supabase
    .from(TABLE)
    .upsert([{ email: normalizeEmail(email), reason: reason.trim(), source }], { onConflict: 'email' })
    .select('email, reason, source, created_at')
    .single();

  if (error) throw new Error(`Failed to add suppression: ${error.message}`);
  return data as SuppressionItem;
}

export async function listSuppressions(limit: number, search?: string): Promise<SuppressionItem[]> {
  let query = supabase
    .from(TABLE)
    .select('email, reason, source, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (search && search.trim()) {
    query = query.ilike('email', `%${search.trim().toLowerCase()}%`);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Failed to list suppressions: ${error.message}`);
  return (data || []) as SuppressionItem[];
}
