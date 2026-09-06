'use client';

import React from 'react';
import { Mail, Sparkles, ExternalLink, Instagram, CheckCircle2, Clock3, Eye, Copy, Check } from 'lucide-react';
import { Creator } from '@/lib/types';

interface CreatorTableProps {
  creators: Creator[];
  onOpenPitchModal: (creator: Creator) => void;
  onOpenDetailModal: (creator: Creator) => void;
  onQuickCopyEmail: (email: string) => void;
  copiedEmail: string | null;
}

export default function CreatorTable({
  creators,
  onOpenPitchModal,
  onOpenDetailModal,
  onQuickCopyEmail,
  copiedEmail
}: CreatorTableProps) {
  if (creators.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-12 text-center shadow-sm">
        <div className="h-12 w-12 bg-slate-100 rounded-full flex items-center justify-center mx-auto text-slate-400 mb-3">
          <Mail className="h-6 w-6" />
        </div>
        <h3 className="text-base font-bold text-slate-800">No creators match your current filter</h3>
        <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
          Try clearing your search query, switching email status tabs, or changing the date filter.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50/80 border-b border-slate-200 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              <th className="py-3 px-4">#</th>
              <th className="py-3 px-4">Creator / Profile</th>
              <th className="py-3 px-4">Followers</th>
              <th className="py-3 px-4">Niche / Category</th>
              <th className="py-3 px-4">Verified Business Email</th>
              <th className="py-3 px-4">Status & Outreach</th>
              <th className="py-3 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-sm">
            {creators.map((creator, index) => {
              const isSent = creator.email_status === 'sent';
              const initial = (creator.name || creator.username || 'C').charAt(0).toUpperCase();

              return (
                <tr 
                  key={creator.username || index}
                  className="hover:bg-slate-50/60 transition-colors group"
                >
                  {/* ID */}
                  <td className="py-3 px-4 text-xs font-semibold text-slate-400">
                    {creator.id || index + 1}
                  </td>

                  {/* Creator info */}
                  <td className="py-3 px-4">
                    <div className="flex items-center space-x-3">
                      {/* Avatar */}
                      <div className="h-10 w-10 rounded-full bg-gradient-to-tr from-violet-100 to-indigo-100 border border-violet-200 flex items-center justify-center font-bold text-violet-700 shrink-0 shadow-sm">
                        {initial}
                      </div>

                      <div className="min-w-0 max-w-[220px]">
                        <div className="flex items-center space-x-1.5">
                          <span className="font-semibold text-slate-900 truncate">
                            {creator.name || creator.username}
                          </span>
                          {creator.is_verified && (
                            <span className="h-3.5 w-3.5 bg-blue-500 text-white rounded-full flex items-center justify-center text-[8px] font-bold shrink-0" title="Instagram Verified">
                              ✓
                            </span>
                          )}
                        </div>
                        <a
                          href={creator.instagram_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center space-x-1 text-xs text-violet-600 hover:text-violet-800 font-medium truncate"
                        >
                          <Instagram className="h-3 w-3 inline shrink-0" />
                          <span>@{creator.username}</span>
                        </a>
                      </div>
                    </div>
                  </td>

                  {/* Followers */}
                  <td className="py-3 px-4">
                    <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-bold bg-slate-100 text-slate-800 border border-slate-200">
                      {creator.followers || `${creator.followers_num}`}
                    </span>
                  </td>

                  {/* Category */}
                  <td className="py-3 px-4">
                    <span className="text-xs font-medium text-slate-600 bg-slate-50 px-2 py-1 rounded-md border border-slate-200/60 inline-block max-w-[140px] truncate">
                      {creator.category}
                    </span>
                  </td>

                  {/* Email */}
                  <td className="py-3 px-4">
                    <div className="flex items-center space-x-1.5">
                      <span className="text-xs font-mono font-medium text-slate-700 bg-slate-50 px-2 py-1 rounded border border-slate-200 truncate max-w-[180px]">
                        {creator.email}
                      </span>
                      <button
                        onClick={() => onQuickCopyEmail(creator.email)}
                        className="p-1 hover:bg-slate-200 text-slate-400 hover:text-slate-700 rounded transition-colors"
                        title="Copy Email"
                      >
                        {copiedEmail === creator.email ? (
                          <Check className="h-3.5 w-3.5 text-emerald-600" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  </td>

                  {/* Outreach Status */}
                  <td className="py-3 px-4">
                    {isSent ? (
                      <div className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                        <span>Mail Sent</span>
                      </div>
                    ) : (
                      <div className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                        <Clock3 className="h-3.5 w-3.5 text-amber-600" />
                        <span>Not Sent</span>
                      </div>
                    )}
                  </td>

                  {/* Actions */}
                  <td className="py-3 px-4 text-right">
                    <div className="flex items-center justify-end space-x-2">
                      
                      {/* View details */}
                      <button
                        onClick={() => onOpenDetailModal(creator)}
                        className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors"
                        title="View Full Profile & Bio"
                      >
                        <Eye className="h-4 w-4" />
                      </button>

                      {/* AI Pitch & Send Email Button */}
                      <button
                        onClick={() => onOpenPitchModal(creator)}
                        className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-sm ${
                          isSent
                            ? 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-300'
                            : 'bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white shadow-violet-200'
                        }`}
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        <span>{isSent ? 'Resend / View' : 'AI Pitch & Send'}</span>
                      </button>

                    </div>
                  </td>

                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
