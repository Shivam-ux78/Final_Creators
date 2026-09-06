'use client';

import React from 'react';
import { Users, MailCheck, Clock, CalendarDays, TrendingUp } from 'lucide-react';
import { Creator } from '@/lib/types';

interface MetricsHeaderProps {
  creators: Creator[];
  onFilterToday: () => void;
  onFilterNotSent: () => void;
  onFilterSent: () => void;
}

export default function MetricsHeader({
  creators,
  onFilterToday,
  onFilterNotSent,
  onFilterSent
}: MetricsHeaderProps) {
  const total = creators.length;
  const sentCount = creators.filter(c => c.email_status === 'sent').length;
  const pendingCount = creators.filter(c => c.email_status !== 'sent').length;

  const todayStr = new Date().toISOString().split('T')[0];
  const todayCount = creators.filter(c => (c.created_at || '').startsWith(todayStr)).length;

  const avgFollowers = total > 0
    ? Math.round(creators.reduce((acc, c) => acc + (c.followers_num || 0), 0) / total)
    : 0;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      
      {/* Total Creators */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm hover:border-slate-300 transition-all">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Creators</span>
          <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
            <Users className="h-4 w-4" />
          </div>
        </div>
        <div className="mt-2 flex items-baseline justify-between">
          <span className="text-2xl font-bold text-slate-900">{total}</span>
          <span className="text-xs font-semibold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">
            100% US & Mails
          </span>
        </div>
      </div>

      {/* Today's Added */}
      <div 
        onClick={onFilterToday}
        className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm hover:border-violet-300 cursor-pointer transition-all group"
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider group-hover:text-violet-600">Today's Data</span>
          <div className="p-2 bg-violet-50 text-violet-600 rounded-lg">
            <CalendarDays className="h-4 w-4" />
          </div>
        </div>
        <div className="mt-2 flex items-baseline justify-between">
          <span className="text-2xl font-bold text-violet-700">{todayCount > 0 ? todayCount : total}</span>
          <span className="text-xs font-semibold text-violet-600 bg-violet-50 px-2 py-0.5 rounded-full group-hover:bg-violet-100">
            Click to Filter
          </span>
        </div>
      </div>

      {/* Emails Sent */}
      <div 
        onClick={onFilterSent}
        className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm hover:border-emerald-300 cursor-pointer transition-all group"
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider group-hover:text-emerald-600">Mails Sent</span>
          <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg">
            <MailCheck className="h-4 w-4" />
          </div>
        </div>
        <div className="mt-2 flex items-baseline justify-between">
          <span className="text-2xl font-bold text-emerald-700">{sentCount}</span>
          <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full group-hover:bg-emerald-100">
            {total > 0 ? Math.round((sentCount / total) * 100) : 0}% Outreach
          </span>
        </div>
      </div>

      {/* Pending Outreach */}
      <div 
        onClick={onFilterNotSent}
        className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm hover:border-amber-300 cursor-pointer transition-all group"
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider group-hover:text-amber-600">Pending Outreach</span>
          <div className="p-2 bg-amber-50 text-amber-600 rounded-lg">
            <Clock className="h-4 w-4" />
          </div>
        </div>
        <div className="mt-2 flex items-baseline justify-between">
          <span className="text-2xl font-bold text-amber-700">{pendingCount}</span>
          <span className="text-xs font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full group-hover:bg-amber-100">
            Ready to Pitch
          </span>
        </div>
      </div>

    </div>
  );
}
