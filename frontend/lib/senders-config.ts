export function getConfiguredSenders() {
  const accounts: Array<{
    id: string;
    apiKey: string;
    senderName: string;
    senderEmail: string;
    label: string;
  }> = [];

  const apiKey1 = process.env.RESEND_API_KEY || '';
  const apiKey2 = process.env.RESEND_API_KEY_2 || '';
  const senderName = process.env.SENDER_NAME || 'MakeAble Partnerships';

  // 5 requested prefixes
  const prefixes = ['collab', 'outreach', 'aryan', 'shivam', 'hello'];

  // All 10 verified non-.nyc domains
  const domainsKey1 = ['makeable.info'];
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

  if (apiKey1 && apiKey1.startsWith('re_')) {
    for (const dom of domainsKey1) {
      for (const prefix of prefixes) {
        const email = `${prefix}@${dom}`;
        accounts.push({
          id: `sender_${prefix}_${dom.replace('.', '_')}`,
          apiKey: apiKey1,
          senderName,
          senderEmail: email,
          label: `${senderName} (${email})`
        });
      }
    }
  }

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

