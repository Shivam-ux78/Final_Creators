export function getConfiguredSenders() {
  const accounts: Array<{
    id: string;
    apiKey: string;
    senderName: string;
    senderEmail: string;
    label: string;
  }> = [];

  const apiKey2 = process.env.RESEND_API_KEY_2 || process.env.RESEND_API_KEY || '';
  const senderName = process.env.SENDER_NAME || 'MakeAble Partnerships';

  // 5 requested prefixes
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
        accounts.push({
          id: `sender_${prefix}_${dom.replace('.', '_')}`,
          apiKey: apiKey2,
          senderName,
          senderEmail: email,
          label: `${senderName} (${email})`
        });
      }
    }
  }

  return accounts;
}

