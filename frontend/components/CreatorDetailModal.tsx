'use client';

import React from 'react';
import { X, Instagram, Mail, MapPin, Tag, Users, Sparkles, CheckCircle2, DollarSign, Star } from 'lucide-react';
import { Creator } from '@/lib/types';

interface CreatorDetailModalProps {
  creator: Creator | null;
  isOpen: boolean;
  onClose: () => void;
  onOpenPitch: (creator: Creator) => void;
}

export default function CreatorDetailModal({
  creator,
  isOpen,
  onClose,
  onOpenPitch
}: CreatorDetailModalProps) {
  if (!isOpen || !creator) return null;

  const initial = (creator.name || creator.username || 'C').charAt(0).toUpperCase();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-fade-in">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/80">
          <div className="flex items-center space-x-3">
            <div className="h-12 w-12 rounded-2xl bg-gradient-to-tr from-violet-100 to-indigo-100 border border-violet-200 flex items-center justify-center font-bold text-lg text-violet-700 shadow-sm">
              {initial}
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-base font-bold text-slate-900">
                  {creator.name || creator.username}
                </h2>
                {creator.is_verified && (
                  <span className="px-2 py-0.5 text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200 rounded-full">
                    Instagram Verified
                  </span>
                )}
              </div>
              <a
                href={creator.instagram_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-violet-600 hover:text-violet-800 font-medium flex items-center space-x-1"
              >
                <Instagram className="h-3 w-3" />
                <span>@{creator.username}</span>
              </a>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-lg transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-4 flex-1">
          
          {/* Key Metric Badges */}
          <div className="grid grid-cols-3 gap-3">
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-center">
              <span className="text-[11px] font-semibold text-slate-500 block">Followers</span>
              <span className="text-base font-bold text-slate-900">{creator.followers}</span>
            </div>
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-center">
              <span className="text-[11px] font-semibold text-slate-500 block">Location</span>
              <span className="text-base font-bold text-slate-900">{creator.location || 'USA'}</span>
            </div>
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-center">
              <span className="text-[11px] font-semibold text-slate-500 block">Niche</span>
              <span className="text-xs font-bold text-slate-900 truncate block mt-1">{creator.category}</span>
            </div>
          </div>

          {/* Biography */}
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
              Instagram Biography
            </label>
            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 leading-relaxed">
              {creator.biography || 'No biography text found in public profile.'}
            </div>
          </div>

          {/* Verified Contact Details */}
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
              Verified Contact Information
            </label>
            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-500 flex items-center space-x-1.5">
                  <Mail className="h-3.5 w-3.5 text-slate-400" />
                  <span>Business Email:</span>
                </span>
                <span className="font-mono font-bold text-slate-800">{creator.email}</span>
              </div>
              {creator.phone && (
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Phone:</span>
                  <span className="font-mono text-slate-800">{creator.phone}</span>
                </div>
              )}
              {creator.external_url && (
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Bio Link:</span>
                  <a href={creator.external_url} target="_blank" rel="noopener noreferrer" className="text-violet-600 hover:underline truncate max-w-[280px]">
                    {creator.external_url}
                  </a>
                </div>
              )}
            </div>
          </div>

          {/* Affiliate Partner Program Perks */}
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
              Affiliate Partner Program Terms
            </label>
            <div className="p-3.5 bg-emerald-50/70 border border-emerald-200 rounded-xl space-y-1.5 text-xs text-slate-700">
              <div className="flex items-center justify-between">
                <span className="text-emerald-800 font-semibold">Creator Commission:</span>
                <span className="font-bold text-emerald-900 bg-white px-2 py-0.5 rounded border border-emerald-200">15% on each product sale</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-violet-800 font-semibold">Buyer / Audience Discount:</span>
                <span className="font-bold text-violet-900 bg-white px-2 py-0.5 rounded border border-violet-200">10% OFF discount code</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-indigo-800 font-semibold">Product Gifting:</span>
                <span className="font-bold text-indigo-900 bg-white px-2 py-0.5 rounded border border-indigo-200">Free Product Package</span>
              </div>
            </div>
          </div>

        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/80 flex items-center justify-between">
          <a
            href={creator.instagram_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center space-x-1 text-xs font-semibold text-slate-600 hover:text-slate-900"
          >
            <Instagram className="h-4 w-4 text-violet-600" />
            <span>Open Instagram Profile</span>
          </a>

          <button
            onClick={() => {
              onClose();
              onOpenPitch(creator);
            }}
            className="flex items-center space-x-1.5 px-4 py-2 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white rounded-xl text-xs font-bold shadow-md shadow-violet-200"
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span>Generate Pitch & Email</span>
          </button>
        </div>

      </div>
    </div>
  );
}
