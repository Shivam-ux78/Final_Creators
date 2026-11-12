import fs from 'fs';
import path from 'path';

export type SenderCategory = 'outreach' | 'hr' | 'custom';

export interface SenderAccount {
  id: string;
  apiKey: string;
  senderName: string;
  senderEmail: string;
  label: string;
  category: SenderCategory;
}

export interface CustomSenderInput {
  email: string;
  senderName?: string;
}

const CUSTOM_SENDERS_FILE = path.join(process.cwd(), '.custom_senders.json');

const HR_SENDERS: Array<{ email: string; senderName: string }> = [
  { email: 'hr@makeable.work', senderName: 'MakeAble HR' },
  { email: 'hr@makeable.digital', senderName: 'MakeAble HR' },
  { email: 'hr@makeable.online', senderName: 'MakeAble HR' },
  { email: 'careers@makeable.work', senderName: 'MakeAble Careers' },
  { email: 'careers@makeable.live', senderName: 'MakeAble Careers' },
  { email: 'talent@makeable.solutions', senderName: 'MakeAble Talent' },
  { email: 'hiring@makeable.space', senderName: 'MakeAble Hiring' },
  { email: 'recruiting@makeable.cloud', senderName: 'MakeAble Recruiting' },
  { email: 'people@makeable.email', senderName: 'MakeAble People' },
  { email: 'jobs@makeable.website', senderName: 'MakeAble Jobs' }
];

export function getCustomSenders(): CustomSenderInput[] {
  try {
    if (fs.existsSync(CUSTOM_SENDERS_FILE)) {
      const raw = fs.readFileSync(CUSTOM_SENDERS_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed
          .filter((item: any) => item && typeof item.email === 'string' && item.email.includes('@'))
          .map((item: any) => ({
            email: item.email.trim().toLowerCase(),
            senderName: typeof item.senderName === 'string' && item.senderName.trim()
              ? item.senderName.trim()
              : undefined
          }));
      }
    }
  } catch (e) {
    console.warn('Error reading custom senders file:', e);
  }
  return [];
}

export function saveCustomSenders(senders: CustomSenderInput[]): boolean {
  try {
    fs.writeFileSync(CUSTOM_SENDERS_FILE, JSON.stringify(senders, null, 2), 'utf-8');
    return true;
  } catch (e) {
    console.warn('Error saving custom senders file:', e);
    return false;
  }
}

export function addCustomSender(email: string, senderName?: string): { added: boolean; error?: string; senders: CustomSenderInput[] } {
  const cleanEmail = (email || '').trim().toLowerCase();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(cleanEmail)) {
    return { added: false, error: 'Please provide a valid email address.', senders: getCustomSenders() };
  }

  const existing = getCustomSenders();
  const cleanName = senderName?.trim() || undefined;
  const idx = existing.findIndex(s => s.email === cleanEmail);
  if (idx >= 0) {
    existing[idx] = { email: cleanEmail, senderName: cleanName };
  } else {
    existing.push({ email: cleanEmail, senderName: cleanName });
  }

  saveCustomSenders(existing);
  return { added: true, senders: existing };
}

export function removeCustomSender(email: string): CustomSenderInput[] {
  const cleanEmail = (email || '').trim().toLowerCase();
  const filtered = getCustomSenders().filter(s => s.email !== cleanEmail);
  saveCustomSenders(filtered);
  return filtered;
}

export function getConfiguredSenders(): SenderAccount[] {
  const accounts: SenderAccount[] = [];
  const seen = new Set<string>();

  const apiKey2 = process.env.RESEND_API_KEY_2 || process.env.RESEND_API_KEY || '';
  const senderName = process.env.SENDER_NAME || 'MakeAble Partnerships';

  // 5 requested outreach prefixes
  const prefixes = ['collab', 'outreach', 'aryan', 'shivam', 'hello'];

  // 9 verified active domains (excluding .nyc and .info)
  const domainsKey2 = [
    'makeable.digital',
    'makeable.live',
    'makeable.email',
    'makeable.solutions',
    'makeable.space',
    'makeable.cloud',
    'makeable.work',
    'makeable.website',
    'makeable.online'
  ];

  if (apiKey2 && apiKey2.startsWith('re_')) {
    for (const dom of domainsKey2) {
      for (const prefix of prefixes) {
        const email = `${prefix}@${dom}`;
        seen.add(email.toLowerCase());
        accounts.push({
          id: `sender_${prefix}_${dom.replace('.', '_')}`,
          apiKey: apiKey2,
          senderName,
          senderEmail: email,
          label: `${senderName} (${email})`,
          category: 'outreach'
        });
      }
    }

    for (const hr of HR_SENDERS) {
      const lower = hr.email.toLowerCase();
      if (!seen.has(lower)) {
        seen.add(lower);
        accounts.push({
          id: `sender_hr_${lower.replace(/[^a-z0-9]/g, '_')}`,
          apiKey: apiKey2,
          senderName: hr.senderName,
          senderEmail: lower,
          label: `${hr.senderName} (${lower})`,
          category: 'hr'
        });
      }
    }

    for (const custom of getCustomSenders()) {
      const lower = custom.email.toLowerCase();
      if (!seen.has(lower)) {
        seen.add(lower);
        const displayName = custom.senderName || senderName;
        accounts.push({
          id: `sender_custom_${lower.replace(/[^a-z0-9]/g, '_')}`,
          apiKey: apiKey2,
          senderName: displayName,
          senderEmail: lower,
          label: `${displayName} (${lower})`,
          category: 'custom'
        });
      }
    }
  }

  return accounts;
}

