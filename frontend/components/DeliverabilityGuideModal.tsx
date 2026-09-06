'use client';

import React from 'react';
import { X, ShieldCheck, CheckCircle2, AlertTriangle, Key, Globe, Server, Copy, Check } from 'lucide-react';

interface DeliverabilityGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function DeliverabilityGuideModal({
  isOpen,
  onClose
}: DeliverabilityGuideModalProps) {
  const [copiedKey, setCopiedKey] = React.useState<string | null>(null);

  if (!isOpen) return null;

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(id);
    setTimeout(() => setCopiedKey(null), 1500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-fade-in">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/80">
          <div className="flex items-center space-x-3">
            <div className="h-9 w-9 rounded-xl bg-emerald-600 text-white flex items-center justify-center shadow-sm shadow-emerald-200">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">
                100% Free Custom Domain Email & Anti-Spam Setup
              </h2>
              <p className="text-xs text-slate-500">
                How to send free outreach from your GoDaddy domain without ever hitting the Spam folder
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

        {/* Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 text-slate-700 text-xs leading-relaxed">
          
          {/* Executive Summary */}
          <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl">
            <h3 className="font-bold text-emerald-900 text-sm mb-1 flex items-center space-x-1.5">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              <span>Recommended Free Solution: Resend Free Tier (3,000 emails/month)</span>
            </h3>
            <p className="text-emerald-800">
              Sending directly from unverified servers lands emails in Spam. By connecting your GoDaddy domain to <strong>Resend</strong> (free forever tier with 3,000 emails/month) and adding 3 DNS records, all your emails achieve a <strong>10/10 inbox deliverability score</strong> directly in Primary Inbox.
            </p>
          </div>

          {/* Step 1: Sign up */}
          <div>
            <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-2 flex items-center space-x-1.5">
              <span className="h-5 w-5 rounded-full bg-violet-600 text-white flex items-center justify-center text-[10px]">1</span>
              <span>Create Free Account & Add Domain</span>
            </h4>
            <ol className="list-decimal list-inside space-y-1.5 pl-2 text-slate-600">
              <li>Sign up for a free account at <a href="https://resend.com" target="_blank" rel="noreferrer" className="text-violet-600 font-bold hover:underline">resend.com</a>.</li>
              <li>Go to <strong>Domains</strong> ➔ Click <strong>Add Domain</strong> ➔ Enter your GoDaddy domain (e.g. <code className="bg-slate-100 px-1 py-0.5 rounded font-mono">yourbrand.com</code>).</li>
              <li>Resend will show you 3 exact DNS records to paste into GoDaddy.</li>
            </ol>
          </div>

          {/* Step 2: GoDaddy DNS Records Table */}
          <div>
            <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-2 flex items-center space-x-1.5">
              <span className="h-5 w-5 rounded-full bg-violet-600 text-white flex items-center justify-center text-[10px]">2</span>
              <span>Add These 3 DNS Records in GoDaddy DNS Management</span>
            </h4>
            <div className="border border-slate-200 rounded-xl overflow-hidden shadow-sm">
              <table className="w-full text-left">
                <thead className="bg-slate-100 text-[11px] font-bold text-slate-700">
                  <tr>
                    <th className="p-2.5">Record Type</th>
                    <th className="p-2.5">Name / Host</th>
                    <th className="p-2.5">Value / Target</th>
                    <th className="p-2.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-[11px]">
                  
                  {/* SPF */}
                  <tr className="hover:bg-slate-50">
                    <td className="p-2.5 font-bold text-violet-700">TXT (SPF)</td>
                    <td className="p-2.5 font-mono">@ (or send)</td>
                    <td className="p-2.5 font-mono text-slate-600">v=spf1 include:resend.com ~all</td>
                    <td className="p-2.5 text-right">
                      <button
                        onClick={() => handleCopy('v=spf1 include:resend.com ~all', 'spf')}
                        className="px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded text-[10px] font-semibold"
                      >
                        {copiedKey === 'spf' ? <Check className="h-3 w-3 text-emerald-600 inline" /> : 'Copy'}
                      </button>
                    </td>
                  </tr>

                  {/* DKIM */}
                  <tr className="hover:bg-slate-50">
                    <td className="p-2.5 font-bold text-indigo-700">TXT (DKIM)</td>
                    <td className="p-2.5 font-mono">resend._domainkey</td>
                    <td className="p-2.5 font-mono text-slate-600">p=MIGfMA0GCSqGSIb3DQEBA... (provided in Resend)</td>
                    <td className="p-2.5 text-right">
                      <span className="text-slate-400 text-[10px]">From Resend</span>
                    </td>
                  </tr>

                  {/* DMARC */}
                  <tr className="hover:bg-slate-50">
                    <td className="p-2.5 font-bold text-emerald-700">TXT (DMARC)</td>
                    <td className="p-2.5 font-mono">_dmarc</td>
                    <td className="p-2.5 font-mono text-slate-600">v=DMARC1; p=none;</td>
                    <td className="p-2.5 text-right">
                      <button
                        onClick={() => handleCopy('v=DMARC1; p=none;', 'dmarc')}
                        className="px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded text-[10px] font-semibold"
                      >
                        {copiedKey === 'dmarc' ? <Check className="h-3 w-3 text-emerald-600 inline" /> : 'Copy'}
                      </button>
                    </td>
                  </tr>

                </tbody>
              </table>
            </div>
          </div>

          {/* Step 3: Add Keys to .env */}
          <div>
            <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-2 flex items-center space-x-1.5">
              <span className="h-5 w-5 rounded-full bg-violet-600 text-white flex items-center justify-center text-[10px]">3</span>
              <span>Paste API Key in Your .env File</span>
            </h4>
            <div className="p-3 bg-slate-900 text-slate-100 rounded-xl font-mono text-xs space-y-1">
              <div className="text-slate-400"># In your .env file:</div>
              <div className="text-emerald-400">RESEND_API_KEY=re_your_api_key_from_resend</div>
              <div className="text-emerald-400">SENDER_EMAIL=collab@yourgodaddydomain.com</div>
              <div className="text-emerald-400">SENDER_NAME=Your Brand Outreach Lead</div>
            </div>
          </div>

          {/* Anti-Spam Best Practices */}
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-1.5">
            <h4 className="font-bold text-slate-900 text-xs flex items-center space-x-1">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
              <span>Anti-Spam Golden Rules for Outreach:</span>
            </h4>
            <ul className="list-disc list-inside space-y-1 pl-1 text-[11px] text-slate-600">
              <li>Always include personal bio references (our AI Pitch Generator does this automatically).</li>
              <li>Avoid generic spam triggers like "FREE CASH $$$", "ACT NOW", or all-caps subject lines.</li>
              <li>Send up to 50–100 personalized pitches per day per domain to keep reputation pristine.</li>
            </ul>
          </div>

        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/80 flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-500">
            Need help? Everything is ready to dispatch directly from the UI.
          </span>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition-all shadow-sm"
          >
            Got It!
          </button>
        </div>

      </div>
    </div>
  );
}
