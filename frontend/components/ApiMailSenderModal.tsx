'use client';

import React, { useState, useEffect } from 'react';
import { X, Code, Send, CheckCircle2, AlertCircle, Copy, Terminal, Server, Key, Zap, Layers, Activity, RefreshCw } from 'lucide-react';

interface ApiMailSenderModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function ApiMailSenderModal({ isOpen, onClose }: ApiMailSenderModalProps) {
  const [activeTab, setActiveTab] = useState<'tester' | 'docs' | 'stats'>('tester');
  
  // Live API Stats
  const [stats, setStats] = useState<{
    service?: string;
    rotationOrder?: string[];
    currentNextSender?: string;
    todaySentCount: number;
    dailyLimit: number;
    remainingQuota: number;
  } | null>(null);

  const [loadingStats, setLoadingStats] = useState(false);

  // Tester Form state
  const [toEmail, setToEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('Hello! This is a test message sent via the MakeAble Round-Robin Mail Sender API.');
  
  // Tester Execution Result
  const [isSending, setIsSending] = useState(false);
  const [apiResponse, setApiResponse] = useState<any>(null);
  const [responseStatus, setResponseStatus] = useState<number | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const fetchStats = async () => {
    setLoadingStats(true);
    try {
      const res = await fetch('/api/v1/send-mail');
      const data = await res.json();
      if (data.success) {
        setStats({
          service: data.service,
          rotationOrder: data.rotationOrder || ['collab@makeable.work', 'collab@makeable.website', 'collab@makeable.online'],
          currentNextSender: data.currentNextSender || 'collab@makeable.work',
          todaySentCount: data.todaySentCount || 0,
          dailyLimit: data.dailyLimit || 150,
          remainingQuota: data.remainingQuota || 0
        });
      }
    } catch (e) {
      console.warn('Error loading mail sender stats:', e);
    } finally {
      setLoadingStats(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchStats();
    }
  }, [isOpen]);

  const handleTestSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!toEmail || !body) {
      alert('Please provide destination email and message body.');
      return;
    }

    setIsSending(true);
    setApiResponse(null);
    setResponseStatus(null);

    try {
      const payload: any = {
        toEmail: toEmail.trim(),
        body: body.trim()
      };

      if (subject.trim()) {
        payload.subject = subject.trim();
      }

      const res = await fetch('/api/v1/send-mail', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      setResponseStatus(res.status);
      setApiResponse(data);
      fetchStats();
    } catch (err: any) {
      setResponseStatus(500);
      setApiResponse({ success: false, error: err.message || 'Failed to dispatch request' });
    } finally {
      setIsSending(false);
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCode(label);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  if (!isOpen) return null;

  const curlCode = `curl -X POST http://localhost:3000/api/v1/send-mail \\
  -H "Content-Type: application/json" \\
  -d '{
    "toEmail": "${toEmail || 'recipient@example.com'}",
    "body": "${body.replace(/\n/g, '\\n') || 'Hi there! We would love to collaborate.'}"
  }'`;

  const jsCode = `const response = await fetch('http://localhost:3000/api/v1/send-mail', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    toEmail: '${toEmail || 'recipient@example.com'}',
    body: \`${body || 'Hi there!'}\`
  })
});

const data = await response.json();
console.log(data);`;

  const pythonCode = `import requests

url = "http://localhost:3000/api/v1/send-mail"
payload = {
    "toEmail": "${toEmail || 'recipient@example.com'}",
    "body": "${body.replace(/\n/g, '\\n') || 'Hi there!'}"
}

response = requests.post(url, json=payload)
print(response.json())`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-white w-full max-w-4xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh] my-auto">
        
        {/* Header */}
        <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 p-6 text-white flex items-center justify-between border-b border-slate-800 shrink-0">
          <div className="flex items-center space-x-3">
            <div className="h-10 w-10 rounded-xl bg-violet-600/30 border border-violet-400/30 flex items-center justify-center text-violet-400">
              <RefreshCw className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-xl font-extrabold tracking-tight">Round-Robin Mail Sender API</h2>
                <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs font-semibold">
                  1 ➔ 2 ➔ 3 Auto-Rotation
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Pass destination email & message body. Automatically rotates sender domains: <code>.work</code> ➔ <code>.website</code> ➔ <code>.online</code>.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Live Rotation Banner */}
        <div className="bg-slate-900 text-slate-200 px-6 py-3 border-b border-slate-800 flex flex-wrap items-center justify-between gap-4 text-xs shrink-0">
          <div className="flex items-center space-x-4">
            <span className="text-slate-400 font-bold uppercase tracking-wider text-[11px]">3-Domain Rotation Sequence:</span>
            <div className="flex items-center space-x-2">
              <span className={`px-2 py-0.5 rounded font-mono font-bold ${stats?.currentNextSender === 'collab@makeable.work' ? 'bg-violet-600 text-white shadow-sm' : 'bg-slate-800 text-slate-400'}`}>
                1. .work
              </span>
              <span className="text-slate-600">➔</span>
              <span className={`px-2 py-0.5 rounded font-mono font-bold ${stats?.currentNextSender === 'collab@makeable.website' ? 'bg-violet-600 text-white shadow-sm' : 'bg-slate-800 text-slate-400'}`}>
                2. .website
              </span>
              <span className="text-slate-600">➔</span>
              <span className={`px-2 py-0.5 rounded font-mono font-bold ${stats?.currentNextSender === 'collab@makeable.online' ? 'bg-violet-600 text-white shadow-sm' : 'bg-slate-800 text-slate-400'}`}>
                3. .online
              </span>
            </div>
          </div>

          <div className="flex items-center space-x-4">
            <span className="text-slate-400">Next Up: <strong className="text-emerald-400 font-mono">{stats?.currentNextSender}</strong></span>
            <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-bold">
              Quota: {stats?.remainingQuota ?? '...'} remaining
            </span>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex border-b border-slate-200 bg-white px-6 shrink-0">
          <button
            onClick={() => setActiveTab('tester')}
            className={`px-4 py-3 text-xs font-bold border-b-2 transition-all flex items-center space-x-2 ${
              activeTab === 'tester'
                ? 'border-violet-600 text-violet-600 bg-violet-50/50'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Send className="h-3.5 w-3.5" />
            <span>Interactive API Tester</span>
          </button>

          <button
            onClick={() => setActiveTab('docs')}
            className={`px-4 py-3 text-xs font-bold border-b-2 transition-all flex items-center space-x-2 ${
              activeTab === 'docs'
                ? 'border-violet-600 text-violet-600 bg-violet-50/50'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Code className="h-3.5 w-3.5" />
            <span>API Docs & Snippets</span>
          </button>

          <button
            onClick={() => setActiveTab('stats')}
            className={`px-4 py-3 text-xs font-bold border-b-2 transition-all flex items-center space-x-2 ${
              activeTab === 'stats'
                ? 'border-violet-600 text-violet-600 bg-violet-50/50'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Layers className="h-3.5 w-3.5" />
            <span>Sender Domains & DB Logs</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          
          {/* TAB 1: INTERACTIVE API TESTER */}
          {activeTab === 'tester' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              
              {/* Form Input */}
              <form onSubmit={handleTestSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Destination Email (<code className="text-violet-700">toEmail</code>) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="email"
                    required
                    placeholder="creator@example.com"
                    value={toEmail}
                    onChange={(e) => setToEmail(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-violet-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Message Body (<code className="text-violet-700">body</code>) <span className="text-rose-500">*</span>
                  </label>
                  <textarea
                    rows={5}
                    required
                    placeholder="Write your email message here..."
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-violet-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Subject Line (<code className="text-slate-700">subject</code> - Optional)
                  </label>
                  <input
                    type="text"
                    placeholder="Auto-preset will be used if left blank"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-violet-500"
                  />
                  <p className="text-[11px] text-slate-400 mt-1">If blank, rotates between high-converting preset collaboration subjects.</p>
                </div>

                <button
                  type="submit"
                  disabled={isSending}
                  className="w-full flex items-center justify-center space-x-2 py-3 px-4 text-xs font-bold text-white bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 rounded-xl shadow-md transition-all disabled:opacity-50"
                >
                  <Send className={`h-4 w-4 ${isSending ? 'animate-bounce' : ''}`} />
                  <span>{isSending ? 'Sending & Rotating Domain...' : 'Send API Email (Trigger 1➔2➔3 Rotation)'}</span>
                </button>
              </form>

              {/* API Response Console */}
              <div className="flex flex-col bg-slate-950 text-slate-100 rounded-xl p-4 border border-slate-800 font-mono text-xs">
                <div className="flex items-center justify-between pb-3 border-b border-slate-800 text-slate-400">
                  <span className="flex items-center space-x-2">
                    <Terminal className="h-4 w-4 text-emerald-400" />
                    <span className="font-semibold text-slate-300">Live API Response</span>
                  </span>
                  {responseStatus && (
                    <span
                      className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                        responseStatus >= 200 && responseStatus < 300
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                          : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                      }`}
                    >
                      HTTP {responseStatus}
                    </span>
                  )}
                </div>

                <div className="flex-1 overflow-y-auto py-3 space-y-2 text-[11px]">
                  {apiResponse ? (
                    <div>
                      {apiResponse.senderEmail && (
                        <div className="p-2 mb-3 bg-violet-950/60 border border-violet-800/60 rounded text-violet-200">
                          🎯 Dispatched via <strong>{apiResponse.senderEmail}</strong> ({apiResponse.rotationStep})
                        </div>
                      )}
                      <pre className="whitespace-pre-wrap text-emerald-300 leading-relaxed">
                        {JSON.stringify(apiResponse, null, 2)}
                      </pre>
                    </div>
                  ) : (
                    <div className="h-56 flex flex-col items-center justify-center text-slate-600 text-center">
                      <RefreshCw className="h-8 w-8 mb-2 text-slate-700" />
                      <p>Enter email & message, then click Send to observe live domain rotation.</p>
                    </div>
                  )}
                </div>
              </div>

            </div>
          )}

          {/* TAB 2: CODE SNIPPETS & DOCS */}
          {activeTab === 'docs' && (
            <div className="space-y-6">
              <div className="p-4 rounded-xl bg-violet-50 border border-violet-200 text-xs text-violet-900 leading-relaxed">
                <strong>Public API Endpoint:</strong> Send JSON requests to <code className="bg-violet-100 px-1.5 py-0.5 rounded font-bold font-mono text-violet-900">POST /api/v1/send-mail</code>.
                Only <code className="bg-violet-100 px-1.5 py-0.5 rounded font-bold">toEmail</code> and <code className="bg-violet-100 px-1.5 py-0.5 rounded font-bold">body</code> are required! Every incoming call automatically cycles through your 3 domains in sequence (1 ➔ 2 ➔ 3 ➔ 1...).
              </div>

              {/* cURL Snippet */}
              <div className="bg-slate-950 text-slate-100 rounded-xl p-4 border border-slate-800">
                <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800">
                  <span className="text-xs font-bold text-slate-300">cURL Command</span>
                  <button
                    onClick={() => copyToClipboard(curlCode, 'curl')}
                    className="flex items-center space-x-1 text-xs text-slate-400 hover:text-white"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    <span>{copiedCode === 'curl' ? 'Copied!' : 'Copy cURL'}</span>
                  </button>
                </div>
                <pre className="text-xs font-mono text-slate-300 overflow-x-auto whitespace-pre-wrap">{curlCode}</pre>
              </div>

              {/* JavaScript Snippet */}
              <div className="bg-slate-950 text-slate-100 rounded-xl p-4 border border-slate-800">
                <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800">
                  <span className="text-xs font-bold text-slate-300">JavaScript / Node.js (fetch)</span>
                  <button
                    onClick={() => copyToClipboard(jsCode, 'js')}
                    className="flex items-center space-x-1 text-xs text-slate-400 hover:text-white"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    <span>{copiedCode === 'js' ? 'Copied!' : 'Copy JS'}</span>
                  </button>
                </div>
                <pre className="text-xs font-mono text-slate-300 overflow-x-auto whitespace-pre-wrap">{jsCode}</pre>
              </div>

              {/* Python Snippet */}
              <div className="bg-slate-950 text-slate-100 rounded-xl p-4 border border-slate-800">
                <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800">
                  <span className="text-xs font-bold text-slate-300">Python (requests)</span>
                  <button
                    onClick={() => copyToClipboard(pythonCode, 'python')}
                    className="flex items-center space-x-1 text-xs text-slate-400 hover:text-white"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    <span>{copiedCode === 'python' ? 'Copied!' : 'Copy Python'}</span>
                  </button>
                </div>
                <pre className="text-xs font-mono text-slate-300 overflow-x-auto whitespace-pre-wrap">{pythonCode}</pre>
              </div>
            </div>
          )}

          {/* TAB 3: SENDER DOMAINS & DB LOGS */}
          {activeTab === 'stats' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-3">
                  Connected Sender Domains (1 ➔ 2 ➔ 3 Round-Robin)
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="p-4 rounded-xl bg-violet-50 border border-violet-200">
                    <span className="px-2 py-0.5 rounded bg-violet-600 text-white text-[10px] font-bold">Step 1</span>
                    <h4 className="text-xs font-bold text-slate-900 mt-2">MakeAble Work</h4>
                    <p className="text-xs font-mono text-violet-700 font-semibold">collab@makeable.work</p>
                  </div>

                  <div className="p-4 rounded-xl bg-indigo-50 border border-indigo-200">
                    <span className="px-2 py-0.5 rounded bg-indigo-600 text-white text-[10px] font-bold">Step 2</span>
                    <h4 className="text-xs font-bold text-slate-900 mt-2">MakeAble Website</h4>
                    <p className="text-xs font-mono text-indigo-700 font-semibold">collab@makeable.website</p>
                  </div>

                  <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200">
                    <span className="px-2 py-0.5 rounded bg-emerald-600 text-white text-[10px] font-bold">Step 3</span>
                    <h4 className="text-xs font-bold text-slate-900 mt-2">MakeAble Online</h4>
                    <p className="text-xs font-mono text-emerald-700 font-semibold">collab@makeable.online</p>
                  </div>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-slate-900 text-white space-y-2">
                <h4 className="text-xs font-bold text-emerald-400 flex items-center space-x-2">
                  <CheckCircle2 className="h-4 w-4" />
                  <span>Automatic Supabase Database Recording</span>
                </h4>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Every email dispatched via <code className="text-emerald-300">/api/v1/send-mail</code> is automatically logged directly into your Supabase database table (<code className="text-emerald-300">creators</code> and <code className="text-emerald-300">email_logs</code>) with timestamps, sender domain, subject, and Resend message ID.
                </p>
              </div>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="bg-slate-50 px-6 py-4 border-t border-slate-200 flex justify-end shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-bold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 transition-all"
          >
            Close Window
          </button>
        </div>

      </div>
    </div>
  );
}
