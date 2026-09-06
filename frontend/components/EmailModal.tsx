'use client';

import React, { useState, useEffect } from 'react';
import { X, Sparkles, Send, RefreshCw, CheckCircle2, AlertCircle, Info, Percent, Gift, Tag } from 'lucide-react';
import { Creator, EmailSignature } from '@/lib/types';

interface EmailModalProps {
  creator: Creator | null;
  isOpen: boolean;
  onClose: () => void;
  onEmailSentSuccess: (username: string, subject: string, body: string) => void;
  signature: EmailSignature;
}

export default function EmailModal({
  creator,
  isOpen,
  onClose,
  onEmailSentSuccess,
  signature
}: EmailModalProps) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [commissionRate, setCommissionRate] = useState('15%');
  const [buyerDiscount, setBuyerDiscount] = useState('10%');
  const [customBrandInfo, setCustomBrandInfo] = useState('');
  
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [sendStatus, setSendStatus] = useState<{ success?: boolean; message?: string; method?: string } | null>(null);

  // Auto-generate affiliate pitch when modal opens for a new creator
  useEffect(() => {
    if (isOpen && creator) {
      setSendStatus(null);
      if (creator.email_subject && creator.email_body) {
        setSubject(creator.email_subject);
        setBody(creator.email_body);
      } else {
        handleGeneratePitch();
      }
    }
  }, [isOpen, creator]);

  if (!isOpen || !creator) return null;

  const handleGeneratePitch = async () => {
    setIsGenerating(true);
    setSendStatus(null);
    try {
      const res = await fetch('/api/ai-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: creator.name,
          username: creator.username,
          biography: creator.biography,
          category: creator.category,
          followers: creator.followers,
          signature,
          customBrandInfo,
          commissionRate,
          buyerDiscount
        })
      });
      const data = await res.json();
      if (data.success) {
        setSubject(data.subject);
        setBody(data.body);
      } else {
        alert(`AI Pitch Error: ${data.error}`);
      }
    } catch (e: any) {
      console.error(e);
      alert('Failed to connect to AI generation API');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSendEmail = async () => {
    if (!subject.trim() || !body.trim()) {
      alert('Please make sure both subject and email body are filled.');
      return;
    }

    setIsSending(true);
    setSendStatus(null);

    try {
      const res = await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toEmail: creator.email,
          toName: creator.name || creator.username,
          username: creator.username,
          subject,
          body,
          signature
        })
      });
      const data = await res.json();

      if (data.success) {
        setSendStatus({
          success: true,
          message: `Affiliate pitch successfully dispatched to ${creator.email}!`,
          method: data.methodUsed
        });
        onEmailSentSuccess(creator.username, subject, body);
      } else {
        setSendStatus({
          success: false,
          message: data.error || 'Failed to send email.'
        });
      }
    } catch (err: any) {
      setSendStatus({
        success: false,
        message: err.message || 'Network error sending email.'
      });
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-fade-in">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-3xl max-h-[92vh] flex flex-col overflow-hidden">
        
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/80">
          <div className="flex items-center space-x-3">
            <div className="h-9 w-9 rounded-xl bg-violet-600 text-white flex items-center justify-center font-bold shadow-sm shadow-violet-200">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-base font-bold text-slate-900">
                  Affiliate Partner Pitch to @{creator.username}
                </h2>
                <span className="px-2 py-0.5 text-[10px] font-bold bg-emerald-100 text-emerald-800 rounded-full border border-emerald-200">
                  15% Commission + Buyer Discount
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                To: <span className="font-semibold text-slate-700">{creator.email}</span> • {creator.followers} followers • {creator.category}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-lg transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-4 flex-1">
          
          {/* Creator Bio Context Pill */}
          {creator.biography && (
            <div className="p-3 bg-violet-50/60 border border-violet-100 rounded-xl text-xs text-slate-700">
              <div className="flex items-center space-x-1 font-bold text-violet-800 mb-1">
                <Info className="h-3.5 w-3.5" />
                <span>Creator Bio Context (analyzed by OpenAI):</span>
              </div>
              <p className="italic text-slate-600 font-normal">"{creator.biography}"</p>
            </div>
          )}

          {/* Affiliate Program Terms Banner */}
          <div className="grid grid-cols-3 gap-2.5 p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs">
            <div className="flex items-center space-x-2 bg-white p-2 rounded-lg border border-slate-200">
              <Percent className="h-4 w-4 text-emerald-600 shrink-0" />
              <div>
                <span className="text-[10px] text-slate-400 block font-semibold">Creator Earns</span>
                <span className="font-bold text-emerald-700 text-xs">15% on each sale</span>
              </div>
            </div>
            <div className="flex items-center space-x-2 bg-white p-2 rounded-lg border border-slate-200">
              <Tag className="h-4 w-4 text-violet-600 shrink-0" />
              <div>
                <span className="text-[10px] text-slate-400 block font-semibold">Buyer Discount</span>
                <span className="font-bold text-violet-700 text-xs">10% OFF for audience</span>
              </div>
            </div>
            <div className="flex items-center space-x-2 bg-white p-2 rounded-lg border border-slate-200">
              <Gift className="h-4 w-4 text-indigo-600 shrink-0" />
              <div>
                <span className="text-[10px] text-slate-400 block font-semibold">Free Product</span>
                <span className="font-bold text-indigo-700 text-xs">100% Gifting Kit</span>
              </div>
            </div>
          </div>

          {/* Quick Regenerate & Settings */}
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-slate-700">Generated Collaboration Email:</span>
            <button
              onClick={handleGeneratePitch}
              disabled={isGenerating}
              className="flex items-center space-x-1.5 px-3 py-1 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-xs font-bold transition-all shadow-sm disabled:opacity-50"
            >
              <RefreshCw className={`h-3 w-3 ${isGenerating ? 'animate-spin' : ''}`} />
              <span>{isGenerating ? 'Generating...' : 'Regenerate Pitch'}</span>
            </button>
          </div>

          {/* Subject line */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Email Subject Line:
            </label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="e.g. Exclusive Affiliate Partner Program: [Brand] x @username"
              className="w-full text-sm font-semibold px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-500 focus:bg-white text-slate-900"
            />
          </div>

          {/* Email Body */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-bold text-slate-700">
                Email Message Body (Editable):
              </label>
              <span className="text-[11px] text-slate-400 font-medium">Auto-formatted with line breaks</span>
            </div>
            <textarea
              rows={9}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="w-full text-xs font-normal leading-relaxed p-3.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-500 focus:bg-white text-slate-900 font-sans"
            />
          </div>

          {/* Attached Signature Preview */}
          <div className="p-3 bg-slate-100/70 border border-slate-200 rounded-xl text-xs text-slate-600">
            <span className="font-bold text-slate-700 block mb-1">Attached Signature:</span>
            <div className="text-[11px] space-y-0.5 font-mono text-slate-500">
              <div>{signature.senderName} ({signature.title || 'Lead'})</div>
              <div>{signature.brandName} • {signature.website}</div>
              {signature.phone && <div>{signature.phone}</div>}
            </div>
          </div>

          {/* Send Status feedback */}
          {sendStatus && (
            <div className={`p-3 rounded-xl border flex items-start space-x-2 text-xs font-semibold ${
              sendStatus.success
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                : 'bg-rose-50 text-rose-800 border-rose-200'
            }`}>
              {sendStatus.success ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
              )}
              <div>
                <p>{sendStatus.message}</p>
                {sendStatus.method && (
                  <p className="text-[11px] font-normal mt-0.5 text-emerald-700">
                    Engine: {sendStatus.method}
                  </p>
                )}
              </div>
            </div>
          )}

        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/80 flex items-center justify-between">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-200 rounded-xl transition-colors"
          >
            Close
          </button>

          <button
            onClick={handleSendEmail}
            disabled={isSending || isGenerating}
            className="flex items-center space-x-2 px-5 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-emerald-200 disabled:opacity-50"
          >
            <Send className={`h-4 w-4 ${isSending ? 'animate-pulse' : ''}`} />
            <span>{isSending ? 'Dispatching Pitch...' : 'Send Affiliate Pitch Email'}</span>
          </button>
        </div>

      </div>
    </div>
  );
}
