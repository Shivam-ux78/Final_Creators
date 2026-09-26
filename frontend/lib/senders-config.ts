export function getConfiguredSenders() {
  const accounts: Array<{
    id: string;
    apiKey: string;
    senderName: string;
    senderEmail: string;
    label: string;
  }> = [];

  const apiKey2 = process.env.RESEND_API_KEY_2 || '';

  if (apiKey2 && apiKey2.startsWith('re_')) {
    accounts.push({
      id: 'sender_work',
      apiKey: apiKey2,
      senderName: process.env.SENDER_NAME || 'MakeAble Partnerships',
      senderEmail: 'collab@makeable.work',
      label: 'MakeAble Partnerships (collab@makeable.work)'
    });

    accounts.push({
      id: 'sender_website',
      apiKey: apiKey2,
      senderName: process.env.SENDER_NAME || 'MakeAble Partnerships',
      senderEmail: 'collab@makeable.website',
      label: 'MakeAble Partnerships (collab@makeable.website)'
    });

    accounts.push({
      id: 'sender_online',
      apiKey: apiKey2,
      senderName: process.env.SENDER_NAME || 'MakeAble Partnerships',
      senderEmail: 'collab@makeable.online',
      label: 'MakeAble Partnerships (collab@makeable.online)'
    });
  }

  return accounts;
}
