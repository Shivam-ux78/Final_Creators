export interface Creator {
  id?: number;
  username: string;
  name: string;
  email: string;
  phone?: string;
  followers: string;
  followers_num: number;
  category: string;
  location: string;
  biography: string;
  instagram_url: string;
  is_verified: boolean;
  price?: string;
  rating?: string;
  package_offer?: string;
  external_url?: string;
  source?: string;
  email_status: 'not_sent' | 'sent' | 'failed';
  last_emailed_at?: string | null;
  email_subject?: string;
  email_body?: string;
  notes?: string;
  created_at?: string;
  updated_at?: string;
}

export interface EmailSignature {
  senderName: string;
  brandName: string;
  website: string;
  phone: string;
  title: string;
  customSignoff: string;
}

export interface EmailPayload {
  toEmail: string;
  toName: string;
  username: string;
  subject: string;
  body: string;
  creatorId?: number;
  signature?: EmailSignature;
}

export interface FilterState {
  search: string;
  category: string;
  emailStatus: 'all' | 'not_sent' | 'sent' | 'failed';
  dateFilter: 'all' | 'today' | 'last_7_days' | 'last_30_days' | 'custom';
  startDate?: string;
  endDate?: string;
  minFollowers?: number;
  maxFollowers?: number;
  sortBy: 'followers_desc' | 'followers_asc' | 'created_newest' | 'created_oldest' | 'last_emailed';
}
