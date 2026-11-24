import { getSuppression } from './suppressions';

const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;
export const MAX_CC = 50;
export const MAX_BCC = 50;

/** Accepts "a@x.com, b@y.com", "a@x.com; b@y.com", newline-separated text, or an array. */
export function parseEmailList(input: unknown): { emails: string[]; invalid: string[] } {
  let parts: string[] = [];
  if (Array.isArray(input)) {
    parts = input.filter(v => typeof v === 'string') as string[];
  } else if (typeof input === 'string') {
    parts = input.split(/[,;\n]+/);
  }
  const emails: string[] = [];
  const invalid: string[] = [];
  for (const raw of parts) {
    const e = raw.trim().toLowerCase();
    if (!e) continue;
    if (!EMAIL_RE.test(e)) invalid.push(raw.trim());
    else if (!emails.includes(e)) emails.push(e);
  }
  return { emails, invalid };
}

export interface CopyRecipients {
  cc: string[];
  bcc: string[];
  skipped: Array<{ email: string; field: 'cc' | 'bcc'; reason: string }>;
  error?: string;
}

/**
 * Resolve CC/BCC for a send: validates, de-duplicates against the main recipient
 * (and BCC against CC), enforces limits, and drops suppressed addresses.
 */
export async function resolveCopyRecipients(toEmail: string, ccInput: unknown, bccInput: unknown): Promise<CopyRecipients> {
  const cc = parseEmailList(ccInput);
  const bcc = parseEmailList(bccInput);
  const bad = [...cc.invalid, ...bcc.invalid];
  if (bad.length) {
    return { cc: [], bcc: [], skipped: [], error: `Invalid CC/BCC email address: ${bad.join(', ')}` };
  }
  if (cc.emails.length > MAX_CC || bcc.emails.length > MAX_BCC) {
    return { cc: [], bcc: [], skipped: [], error: `Too many copy recipients (max ${MAX_CC} CC and ${MAX_BCC} BCC).` };
  }

  const to = toEmail.trim().toLowerCase();
  const ccList = cc.emails.filter(e => e !== to);
  const bccList = bcc.emails.filter(e => e !== to && !ccList.includes(e));

  const skipped: CopyRecipients['skipped'] = [];
  const keep = async (list: string[], field: 'cc' | 'bcc') => {
    const out: string[] = [];
    for (const email of list) {
      const s = await getSuppression(email);
      if (s) skipped.push({ email, field, reason: s.reason || 'suppressed' });
      else out.push(email);
    }
    return out;
  };

  return { cc: await keep(ccList, 'cc'), bcc: await keep(bccList, 'bcc'), skipped };
}
