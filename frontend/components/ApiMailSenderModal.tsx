'use client';

import React, { useState, useEffect } from 'react';
import { X, Code, Send, CheckCircle2, AlertCircle, Copy, Terminal, Server, Key, Zap, Layers, Activity } from 'lucide-react';

interface ApiMailSenderModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function ApiMailSenderModal({ isOpen, onClose }: ApiMailSenderModalProps) {
  const [activeTab, setActiveTab] = useState<'tester' | 'docs' | 'stats'>('tester');
  
  // Live API Stats
  const [stats, setStats] = useState<{
    todaySentCount: number;
    defaultDailyLimit: number;
    limitPerDomain: number;
    remainingQuota: number;
    configuredSenders: Array<{ id: string; email: string; label: string }>;
  } | null>(null);

  const [loadingStats, setLoadingStats] = useState(false);

  // Tester Form state
  const [toEmail, setToEmail] = useState('');
  const [subject, setSubject] = useState('Test Email via MakeAble Mailer API');
  const [body, setBody] = useState('Hello! This is a test email sent using the MakeAble API Mail Sender endpoint.');
  const [apiKey, setApiKey] = useState('');
  const [dailyLimitOverride, setDailyLimitOverride] = useState<string>('');
  const [customSenderEmail, setCustomSenderEmail] = useState('collab@makeable.work');
  
  // Tester Execution Result
  const [isSending, setIsSending] = useState(false);
  const [apiResponse, setApiResponse] = useState<any>(null);
  const [responseStatus, setResponseStatus] = useState<number | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const fetchStats = async () => {
    setLoadingStats(true);
    try {
      const res = await fetch('/api/send-email');
      const data = await res.json();
      if (data.success) {
        setStats({
          todaySentCount: data.todaySentCount || 0,
          defaultDailyLimit: data.defaultDailyLimit || 150,
          limitPerDomain: data.limitPerDomain || 50,
          remainingQuota: data.remainingQuota || 0,
          configuredSenders: data.configuredSenders || []
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
    if (!toEmail || !subject || !body) {
      alert('Please provide recipient email, subject, and body.');
      return;
    }

    setIsSending(true);
    setApiResponse(null);
    setResponseStatus(null);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };
      if (apiKey.trim()) {
        headers['x-api-key'] = apiKey.trim();
      }

      const payload: any = {
        toEmail: toEmail.trim(),
        subject: subject.trim(),
        body: body.trim(),
        customSenderEmail: customSenderEmail.trim()
      };

      if (dailyLimitOverride.trim()) {
        payload.dailyLimit = Number(dailyLimitOverride.trim());
      }

      const res = await fetch('/api/send-email', {
        method: 'POST',
        headers,
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

  const curlCode = `curl -X POST http://localhost:3000/api/send-email \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: ${apiKey || 'YOUR_RESEND_API_KEY'}" \\
  -d '{
    "toEmail": "${toEmail || 'recipient@example.com'}",
    "subject": "${subject || 'Collaboration Offer'}",
    "body": "${body.replace(/\n/g, '\\n') || 'Hi there! We would love to collaborate.'}",
    "customSenderEmail": "${customSenderEmail}",
    "dailyLimit": ${dailyLimitOverride || 150}
  }'`;

  const jsCode = `const response = await fetch('http://localhost:3000/api/send-email', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': '${apiKey || 'YOUR_RESEND_API_KEY'}'
  },
  body: JSON.stringify({
    toEmail: '${toEmail || 'recipient@example.com'}',
    subject: '${subject || 'Collaboration Offer'}',
    body: \`${body || 'Hi there!'}\`,
    customSenderEmail: '${customSenderEmail}',
    dailyLimit: ${dailyLimitOverride || 150}
  })
});

const data = await response.json();
console.log(data);`;

  const pythonCode = `import requests

url = "http://localhost:3000/api/send-email"
headers = {
    "Content-Type": "application/json",
    "x-api-key": "${apiKey || 'YOUR_RESEND_API_KEY'}"
}
payload = {
    "toEmail": "${toEmail || 'recipient@example.com'}",
    "subject": "${subject || 'Collaboration Offer'}",
    "body": "${body.replace(/\n/g, '\\n') || 'Hi there!'}",
    "customSenderEmail": "${customSenderEmail}",
    "dailyLimit": ${dailyLimitOverride || 150}
}

response = requests.post(url, json=payload, headers=headers)
print(response.json())`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-white w-full max-w-4xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh] my-auto">
        
        {/* Header */}
        <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 p-6 text-white flex items-center justify-between border-b border-slate-800 shrink-0">
          <div className="flex items-center space-x-3">
            <div className="h-10 w-10 rounded-xl bg-violet-600/30 border border-violet-400/30 flex items-center justify-center text-violet-400">
              <Server className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-xl font-extrabold tracking-tight">API Mail Sender</h2>
                <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs font-semibold">
                  REST API v1
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Send emails programmatically with dynamic daily limits, key validation & Supabase tracking.
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

        {/* Live Quota Bar */}
        <div className="bg-slate-50 px-6 py-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4 text-xs font-medium shrink-0">
          <div className="flex items-center space-x-6">
            <div className="flex items-center space-x-2">
              <Activity className="h-4 w-4 text-indigo-600" />
              <span className="text-slate-600">Daily Sent:</span>
              <strong className="text-slate-900 font-bold">{stats?.todaySentCount ?? '...'}</strong>
            </div>

            <div className="flex items-center space-x-2">
              <Zap className="h-4 w-4 text-amber-500" />
              <span className="text-slate-600">Daily Limit:</span>
              <strong className="text-slate-900 font-bold">{stats?.defaultDailyLimit ?? '...'} / day</strong>
            </div>

            <div className="flex items-center space-x-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              <span className="text-slate-600">Remaining Quota:</span>
              <span className="px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 font-bold">
                {stats?.remainingQuota ?? '...'} emails
              </span>
            </div>
          </div>

          <div className="flex items-center space-x-2 text-slate-500 text-[11px]">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
            <span>Endpoint: <code className="bg-slate-200 px-1.5 py-0.5 rounded text-slate-800 font-mono font-bold">POST /api/send-email</code></span>
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
            <span>Code Snippets & Docs</span>
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
            <span>Configured Senders & Keys</span>
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
                    Recipient Email <span className="text-rose-500">*</span>
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
                    Subject Line <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Email Subject"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-violet-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Message Body <span className="text-rose-500">*</span>
                  </label>
                  <textarea
                    rows={4}
                    required
                    placeholder="Email text / markdown..."
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-violet-500 font-mono"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">
                      Sender Domain
                    </label>
                    <select
                      value={customSenderEmail}
                      onChange={(e) => setCustomSenderEmail(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                    >
                      <option value="collab@makeable.work">collab@makeable.work</option>
                      <option value="collab@makeable.website">collab@makeable.website</option>
                      <option value="collab@makeable.online">collab@makeable.online</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">
                      Daily Limit Override
                    </label>
                    <input
                      type="number"
                      placeholder="Default: 150"
                      value={dailyLimitOverride}
                      onChange={(e) => setDailyLimitOverride(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    API Key Header (<code className="text-slate-800">x-api-key</code>)
                  </label>
                  <input
                    type="password"
                    placeholder="Optional (Uses server key if empty)"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg font-mono"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isSending}
                  className="w-full flex items-center justify-center space-x-2 py-2.5 px-4 text-xs font-bold text-white bg-violet-600 hover:bg-violet-700 rounded-lg shadow-sm transition-all disabled:opacity-50"
                >
                  <Send className={`h-4 w-4 ${isSending ? 'animate-bounce' : ''}`} />
                  <span>{isSending ? 'Sending API Request...' : 'Execute Test Send via API'}</span>
                </button>
              </form>

              {/* API Response Output */}
              <div className="flex flex-col bg-slate-950 text-slate-100 rounded-xl p-4 border border-slate-800 font-mono text-xs">
                <div className="flex items-center justify-between pb-3 border-b border-slate-800 text-slate-400">
                  <span className="flex items-center space-x-2">
                    <Terminal className="h-4 w-4 text-emerald-400" />
                    <span className="font-semibold text-slate-300">API Response Console</span>
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
                    <pre className="whitespace-pre-wrap text-emerald-300 leading-relaxed">
                      {JSON.stringify(apiResponse, null, 2)}
                    </pre>
                  ) : (
                    <div className="h-48 flex flex-col items-center justify-center text-slate-600 text-center">
                      <Code className="h-8 w-8 mb-2 text-slate-700" />
                      <p>Fill form and click "Execute Test Send" to view live JSON response.</p>
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
                <strong>API Endpoint Details:</strong> Submit JSON payloads to <code className="bg-violet-100 px-1.5 py-0.5 rounded font-bold font-mono text-violet-900">POST /api/send-email</code>.
                You can authenticate using <code className="bg-violet-100 px-1.5 py-0.5 rounded font-bold font-mono">x-api-key</code> or <code className="bg-violet-100 px-1.5 py-0.5 rounded font-bold font-mono">Authorization: Bearer &lt;key&gt;</code> headers.
              </div>

              {/* cURL Snippet */}
              <div className="bg-slate-950 text-slate-100 rounded-xl p-4 border border-slate-800">
                <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800">
                  <span className="text-xs font-bold text-slate-300">cURL (Command Line)</span>
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
                  <span className="text-xs font-bold text-slate-300">JavaScript / TypeScript (fetch)</span>
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

          {/* TAB 3: CONFIGURED SENDERS & KEYS */}
          {activeTab === 'stats' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-3">
                  Configured Sender Domains & API Keys
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {stats?.configuredSenders.map((s) => (
                    <div key={s.id} className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                      <div className="flex items-center space-x-2 text-indigo-600 mb-1">
                        <Key className="h-4 w-4" />
                        <span className="text-xs font-bold text-slate-900">{s.id}</span>
                      </div>
                      <p className="text-xs font-semibold text-slate-700 truncate">{s.email}</p>
                      <p className="text-[11px] text-slate-400 mt-1">Quota: {stats.limitPerDomain} / day</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="p-4 rounded-xl bg-slate-900 text-white space-y-2">
                <h4 className="text-xs font-bold text-emerald-400 flex items-center space-x-2">
                  <CheckCircle2 className="h-4 w-4" />
                  <span>Automatic Supabase Tracking Enabled</span>
                </h4>
                <p className="text-xs text-slate-300 leading-relaxed">
                  All requests processed through <code className="text-emerald-300">/api/send-email</code> are automatically updated in your Supabase creators database table (<code className="text-emerald-300">creators</code>) and written to the <code className="text-emerald-300">email_logs</code> table with message IDs and timestamps.
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
