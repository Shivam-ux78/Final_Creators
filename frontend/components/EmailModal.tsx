'use client';

import React, { useState, useEffect } from 'react';
import { X, Sparkles, Send, RefreshCw, CheckCircle2, Wand2, Mail, Info, Percent, Gift, Tag, Globe, User } from 'lucide-react';
import { Creator, EmailSignature } from '../lib/types';

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
  const [recipientEmail, setRecipientEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [commissionRate, setCommissionRate] = useState('15%');
  const [buyerDiscount, setBuyerDiscount] = useState('10%');
  const [customBrandInfo, setCustomBrandInfo] = useState('');

  const [isGenerating, setIsGenerating] = useState(false);
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [sendStatus, setSendStatus] = useState<{ success?: boolean; message?: string; method?: string } | null>(null);

  // Auto-fill recipient email and generate pitch when modal opens
  useEffect(() => {
    if (isOpen) {
      setSendStatus(null);
      if (creator) {
        setRecipientEmail(creator.email || '');
        if (creator.email_subject && creator.email_body) {
          setSubject(creator.email_subject);
          setBody(creator.email_body);
        } else {
          handleGeneratePitch(creator);
        }
      } else {
        setRecipientEmail('');
        setSubject('');
        setBody('');
      }
    }
  }, [isOpen, creator]);

  if (!isOpen) return null;

  const handleGeneratePitch = async (targetCreator?: Creator | null) => {
    const activeCreator = targetCreator !== undefined ? targetCreator : creator;
    setIsGenerating(true);
    setSendStatus(null);

    try {
      const res = await fetch('/api/ai-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'generate',
          name: activeCreator?.name || 'Creator',
          username: activeCreator?.username || 'creator',
          biography: activeCreator?.biography || '',
          category: activeCreator?.category || 'Lifestyle',
          followers: activeCreator?.followers || '25k',
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

  const handleEnhanceBody = async () => {
    if (!body.trim()) {
      alert('Please type or paste your email body message first to enhance it.');
      return;
    }

    setIsEnhancing(true);
    setSendStatus(null);

    try {
      const res = await fetch('/api/ai-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'enhance',
          userSubject: subject,
          userBody: body,
          name: creator?.name || 'Creator',
          username: creator?.username || 'creator',
          signature
        })
      });

      const data = await res.json();
      if (data.success) {
        if (data.subject) setSubject(data.subject);
        setBody(data.body);
        setSendStatus({
          success: true,
          message: '✨ Email draft successfully enhanced and polished by AI!'
        });
      } else {
        alert(`AI Enhancement Error: ${data.error}`);
      }
    } catch (e: any) {
      console.error(e);
      alert('Failed to enhance email body');
    } finally {
      setIsEnhancing(false);
    }
  };

  const handleSendEmail = async () => {
    if (!recipientEmail.trim() || !recipientEmail.includes('@')) {
      alert('Please enter a valid recipient email address.');
      return;
    }
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
          toEmail: recipientEmail.trim(),
          toName: creator?.name || creator?.username || 'Creator',
          username: creator?.username || recipientEmail.split('@')[0],
          subject,
          body,
          signature
        })
      });
      const data = await res.json();

      if (data.success) {
        setSendStatus({
          success: true,
          message: `Outreach email successfully dispatched to ${recipientEmail}!`,
          method: data.methodUsed
        });
        onEmailSentSuccess(creator?.username || recipientEmail.split('@')[0], subject, body);
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-fade-in">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-3xl max-h-[92vh] flex flex-col overflow-hidden">
        
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/80">
          <div className="flex items-center space-x-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-tr from-violet-600 to-indigo-600 text-white flex items-center justify-center shadow-md shadow-violet-200">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-base font-bold text-slate-900">
                  {creator ? `Creator Outreach to @${creator.username}` : 'Custom Single Email Dispatch'}
                </h2>
                <span className="px-2 py-0.5 text-[10px] font-bold bg-violet-100 text-violet-800 rounded-full border border-violet-200">
                  Paid Collab + Affiliate
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Offers CPM Paid Collab + Affiliate Commission + Gifting Box & Application Link
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
        <div className="p-6 overflow-y-auto space-y-4 flex-1 text-xs">
          
          {/* Recipient Email Address Input */}
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-1.5">
            <label className="block font-bold text-slate-800 text-[11px] flex items-center space-x-1.5">
              <Mail className="h-4 w-4 text-violet-600" />
              <span>Recipient Email Address (Editable):</span>
            </label>
            <input
              type="email"
              value={recipientEmail}
              onChange={(e) => setRecipientEmail(e.target.value)}
              placeholder="e.g. creator@example.com"
              className="w-full px-3.5 py-2 bg-white border border-slate-200 rounded-lg font-mono font-bold text-slate-900 text-xs focus:ring-2 focus:ring-violet-500 focus:outline-none"
            />
          </div>

          {/* Offer Strategy Details */}
          <div className="grid grid-cols-2 gap-2.5 p-3 bg-violet-50/50 rounded-xl border border-violet-100 text-xs">
            <div className="flex items-center space-x-2 bg-white p-2.5 rounded-lg border border-violet-200/80 shadow-xs">
              <Percent className="h-4 w-4 text-violet-600 shrink-0" />
              <div>
                <span className="text-[10px] text-slate-400 block font-semibold">Option 1: Paid Collab</span>
                <span className="font-bold text-slate-900 text-xs">CPM / Media Kit Rates</span>
              </div>
            </div>
            <div className="flex items-center space-x-2 bg-white p-2.5 rounded-lg border border-violet-200/80 shadow-xs">
              <Globe className="h-4 w-4 text-emerald-600 shrink-0" />
              <div>
                <span className="text-[10px] text-slate-400 block font-semibold">Option 2: Affiliate + Box</span>
                <span className="font-bold text-emerald-700 text-xs">15% Comm + Free Gifting</span>
              </div>
            </div>
          </div>

          {/* AI Action Toolbar Buttons */}
          <div className="flex items-center justify-between gap-2 pt-1">
            <span className="text-xs font-bold text-slate-800 flex items-center space-x-1">
              <Sparkles className="h-3.5 w-3.5 text-violet-600" />
              <span>AI Message Editor:</span>
            </span>
            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={() => handleGeneratePitch()}
                disabled={isGenerating}
                className="flex items-center space-x-1.5 px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-xs font-bold transition-all shadow-sm disabled:opacity-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isGenerating ? 'animate-spin' : ''}`} />
                <span>{isGenerating ? 'Generating...' : '✨ Auto-Generate Pitch'}</span>
              </button>

              <button
                type="button"
                onClick={handleEnhanceBody}
                disabled={isEnhancing || !body.trim()}
                className="flex items-center space-x-1.5 px-3 py-1.5 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white rounded-lg text-xs font-bold transition-all shadow-sm disabled:opacity-50"
                title="Polish and format your manually typed email body"
              >
                <Wand2 className={`h-3.5 w-3.5 ${isEnhancing ? 'animate-spin' : ''}`} />
                <span>{isEnhancing ? 'Enhancing...' : '🪄 Enhance My Draft'}</span>
              </button>
            </div>
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
              placeholder="e.g. Paid Collab + Partnership Invite for @username ✨"
              className="w-full text-xs font-bold px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-500 focus:bg-white text-slate-900"
            />
          </div>

          {/* Email Body */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-bold text-slate-700">
                Email Message Body (Type custom or edit AI pitch):
              </label>
              <span className="text-[10px] text-slate-400 font-medium">Click "Enhance My Draft" anytime to polish</span>
            </div>
            <textarea
              rows={9}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Type your custom email message here... Then click 'Enhance My Draft' to polish it with AI!"
              className="w-full text-xs font-normal leading-relaxed p-3.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-500 focus:bg-white text-slate-900 font-sans"
            />
          </div>

          {/* Attached Signature Preview */}
          <div className="p-3 bg-slate-100/80 border border-slate-200 rounded-xl text-xs text-slate-600">
            <span className="font-bold text-slate-700 block mb-1">Attached Sender Signature (Reply-To: support@makeable.nyc):</span>
            <div className="text-[11px] space-y-0.5 font-mono text-slate-500">
              <div>{signature.senderName} ({signature.title || 'Lead'})</div>
              <div>{signature.brandName} • {signature.website} • Apply: https://makeable.nyc/creators/apply</div>
            </div>
          </div>

          {/* Send Status Alert */}
          {sendStatus && (
            <div className={`p-3 rounded-xl border flex items-center space-x-2 text-xs font-semibold ${
              sendStatus.success ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-rose-50 border-rose-200 text-rose-900'
            }`}>
              {sendStatus.success ? <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" /> : <X className="h-4 w-4 text-rose-600 shrink-0" />}
              <span>{sendStatus.message}</span>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/80 flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 font-semibold text-slate-600 hover:text-slate-900 rounded-xl transition-colors text-xs"
          >
            Cancel / Close
          </button>

          <button
            type="button"
            onClick={handleSendEmail}
            disabled={isSending || !recipientEmail || !subject || !body}
            className="flex items-center space-x-2 px-6 py-2.5 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-violet-200 disabled:opacity-50"
          >
            <Send className="h-4 w-4 fill-current" />
            <span>{isSending ? 'Dispatching Email...' : 'Send Single Email Now'}</span>
          </button>
        </div>

      </div>
    </div>
  );
}
