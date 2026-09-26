'use client';

import React, { useState, useEffect } from 'react';
import { X, Code, Send, CheckCircle2, AlertCircle, Copy, Terminal, Server, Key, Zap, Layers, Activity, RefreshCw, Edit3, Plus, Trash2, Save, Lock, ShieldCheck } from 'lucide-react';

interface ApiMailSenderModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function ApiMailSenderModal({ isOpen, onClose }: ApiMailSenderModalProps) {
  const [activeTab, setActiveTab] = useState<'tester' | 'keys' | 'presets' | 'docs' | 'stats'>('keys');
  
  // Live API Stats
  const [stats, setStats] = useState<{
    service?: string;
    rotationOrder?: string[];
    currentNextSender?: string;
    presetSubjects?: string[];
    todaySentCount: number;
    dailyLimit: number;
    remainingQuota: number;
  } | null>(null);

  // API Keys state
  const [apiKeysList, setApiKeysList] = useState<Array<{
    id: string;
    name: string;
    key: string;
    dailyLimit: number;
    todaySentCount?: number;
    totalSentCount?: number;
    createdAt: string;
    status: 'active' | 'revoked';
  }>>([]);

  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyDailyLimit, setNewKeyDailyLimit] = useState('100');
  const [isCreatingKey, setIsCreatingKey] = useState(false);
  const [createdKeyNotice, setCreatedKeyNotice] = useState<string | null>(null);

  // Tester Form state
  const [toEmail, setToEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('Hello! This is a test message sent via the MakeAble Round-Robin Mail Sender API.');
  
  // Preset Subjects Edit State
  const [presetSubjectsList, setPresetSubjectsList] = useState<string[]>([]);
  const [newSubjectInput, setNewSubjectInput] = useState('');
  const [isSavingPresets, setIsSavingPresets] = useState(false);
  const [presetSaveNotice, setPresetSaveNotice] = useState<string | null>(null);

  // Tester Execution Result
  const [isSending, setIsSending] = useState(false);
  const [apiResponse, setApiResponse] = useState<any>(null);
  const [responseStatus, setResponseStatus] = useState<number | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const fetchStatsAndKeys = async () => {
    try {
      // Fetch stats
      const resStats = await fetch('/api/v1/send-mail');
      const dataStats = await resStats.json();
      if (dataStats.success) {
        const subjects = dataStats.presetSubjects || [
          'Paid Collab & Partnership Offer ✨',
          'MakeAble x Creator Partnership — Sponsored & Affiliate Offer 🤝',
          'Exclusive Creator Collab (Paid Sponsorship + Free Gifting Kit) 📦'
        ];
        setStats({
          service: dataStats.service,
          rotationOrder: dataStats.rotationOrder || ['collab@makeable.work', 'collab@makeable.website', 'collab@makeable.online'],
          currentNextSender: dataStats.currentNextSender || 'collab@makeable.work',
          presetSubjects: subjects,
          todaySentCount: dataStats.todaySentCount || 0,
          dailyLimit: dataStats.dailyLimit || 150,
          remainingQuota: dataStats.remainingQuota || 0
        });
        setPresetSubjectsList(subjects);
      }

      // Fetch API Keys
      const resKeys = await fetch('/api/keys');
      const dataKeys = await resKeys.json();
      if (dataKeys.success && Array.isArray(dataKeys.keys)) {
        setApiKeysList(dataKeys.keys);
      }
    } catch (e) {
      console.warn('Error fetching API stats and keys:', e);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchStatsAndKeys();
    }
  }, [isOpen]);

  const handleCreateApiKey = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsCreatingKey(true);
    setCreatedKeyNotice(null);

    try {
      const res = await fetch('/api/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newKeyName.trim() || 'Production API Key',
          dailyLimit: Number(newKeyDailyLimit) || 100
        })
      });
      const data = await res.json();
      if (data.success && data.apiKey) {
        setCreatedKeyNotice(`Successfully created key "${data.apiKey.name}" (Limit: ${data.apiKey.dailyLimit}/day): ${data.apiKey.key}`);
        setNewKeyName('');
        setNewKeyDailyLimit('100');
        fetchStatsAndKeys();
      } else {
        alert(data.error || 'Failed to create API key.');
      }
    } catch (err: any) {
      alert(err.message || 'Error creating API key.');
    } finally {
      setIsCreatingKey(false);
    }
  };

  const handleRevokeKey = async (id: string) => {
    if (!confirm('Are you sure you want to revoke this API key?')) return;
    try {
      const res = await fetch('/api/keys', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });
      const data = await res.json();
      if (data.success) {
        fetchStatsAndKeys();
      }
    } catch (err: any) {
      alert('Failed to revoke key.');
    }
  };

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
      fetchStatsAndKeys();
    } catch (err: any) {
      setResponseStatus(500);
      setApiResponse({ success: false, error: err.message || 'Failed to dispatch request' });
    } finally {
      setIsSending(false);
    }
  };

  const handleAddPresetSubject = () => {
    if (!newSubjectInput.trim()) return;
    setPresetSubjectsList([...presetSubjectsList, newSubjectInput.trim()]);
    setNewSubjectInput('');
  };

  const handleRemovePresetSubject = (index: number) => {
    if (presetSubjectsList.length <= 1) {
      alert('You must keep at least one preset subject line.');
      return;
    }
    setPresetSubjectsList(presetSubjectsList.filter((_, i) => i !== index));
  };

  const handleSavePresetsConfig = async () => {
    setIsSavingPresets(true);
    setPresetSaveNotice(null);
    try {
      const res = await fetch('/api/v1/send-mail', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subjects: presetSubjectsList })
      });
      const data = await res.json();
      if (data.success) {
        setPresetSaveNotice('Preset subjects configuration successfully updated!');
        fetchStatsAndKeys();
        setTimeout(() => setPresetSaveNotice(null), 3000);
      } else {
        alert(data.error || 'Failed to update preset subjects.');
      }
    } catch (err: any) {
      alert(err.message || 'Network error updating presets.');
    } finally {
      setIsSavingPresets(false);
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCode(label);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const [baseUrl, setBaseUrl] = useState('https://creators.makeable.nyc');

  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.origin) {
      // Use current window origin if available, default to live domain
      setBaseUrl(window.location.origin);
    }
  }, []);

  if (!isOpen) return null;

  const activeKeySample = apiKeysList.find(k => k.status === 'active')?.key || 'mk_live_123456789abcdef';

  const curlCode = `curl -X POST ${baseUrl}/api/v1/send-mail \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: ${activeKeySample}" \\
  -d '{
    "toEmail": "${toEmail || 'recipient@example.com'}",
    "subject": "${subject || 'Custom Subject Line Here (Optional)'}",
    "body": "${body.replace(/\n/g, '\\n') || 'Hi there! We would love to collaborate.'}"
  }'`;

  const jsCode = `const response = await fetch('${baseUrl}/api/v1/send-mail', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': '${activeKeySample}'
  },
  body: JSON.stringify({
    toEmail: '${toEmail || 'recipient@example.com'}',
    subject: '${subject || 'Custom Subject Line Here (Optional)'}',
    body: \`${body || 'Hi there!'}\`
  })
});

const data = await response.json();
console.log(data);`;

  const pythonCode = `import requests

url = "${baseUrl}/api/v1/send-mail"
headers = {
    "Content-Type": "application/json",
    "x-api-key": "${activeKeySample}"
}
payload = {
    "toEmail": "${toEmail || 'recipient@example.com'}",
    "subject": "${subject || 'Custom Subject Line Here (Optional)'}",
    "body": "${body.replace(/\n/g, '\\n') || 'Hi there!'}"
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
              <Key className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-xl font-extrabold tracking-tight">API Mail Sender & Key Manager</h2>
                <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs font-semibold">
                  1 ➔ 2 ➔ 3 Auto-Rotation
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Generate API Keys & send emails programmatically. Rotates domains: <code>.work</code> ➔ <code>.website</code> ➔ <code>.online</code>.
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
            <span className="text-slate-400 font-bold uppercase tracking-wider text-[11px]">3-Domain Rotation:</span>
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
            <span className="text-slate-400">Next Sender: <strong className="text-emerald-400 font-mono">{stats?.currentNextSender}</strong></span>
            <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-bold">
              Quota: {stats?.remainingQuota ?? '...'} remaining
            </span>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex border-b border-slate-200 bg-white px-6 shrink-0 overflow-x-auto">
          <button
            onClick={() => setActiveTab('keys')}
            className={`px-4 py-3 text-xs font-bold border-b-2 transition-all flex items-center space-x-2 whitespace-nowrap ${
              activeTab === 'keys'
                ? 'border-violet-600 text-violet-600 bg-violet-50/50'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Key className="h-3.5 w-3.5" />
            <span>Create & Manage API Keys ({apiKeysList.filter(k => k.status === 'active').length})</span>
          </button>

          <button
            onClick={() => setActiveTab('tester')}
            className={`px-4 py-3 text-xs font-bold border-b-2 transition-all flex items-center space-x-2 whitespace-nowrap ${
              activeTab === 'tester'
                ? 'border-violet-600 text-violet-600 bg-violet-50/50'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Send className="h-3.5 w-3.5" />
            <span>Interactive API Tester</span>
          </button>

          <button
            onClick={() => setActiveTab('presets')}
            className={`px-4 py-3 text-xs font-bold border-b-2 transition-all flex items-center space-x-2 whitespace-nowrap ${
              activeTab === 'presets'
                ? 'border-violet-600 text-violet-600 bg-violet-50/50'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Edit3 className="h-3.5 w-3.5" />
            <span>Preset Subjects Config ({presetSubjectsList.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('docs')}
            className={`px-4 py-3 text-xs font-bold border-b-2 transition-all flex items-center space-x-2 whitespace-nowrap ${
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
            className={`px-4 py-3 text-xs font-bold border-b-2 transition-all flex items-center space-x-2 whitespace-nowrap ${
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

          {/* TAB 0: CREATE & MANAGE API KEYS */}
          {activeTab === 'keys' && (
            <div className="space-y-6">
              
              {/* Create API Key Box */}
              <div className="p-5 rounded-2xl bg-gradient-to-r from-violet-900 via-indigo-900 to-slate-900 text-white shadow-md">
                <div className="flex items-center space-x-2.5 mb-2">
                  <Key className="h-5 w-5 text-violet-400" />
                  <h3 className="text-sm font-bold tracking-tight">Generate New API Key</h3>
                </div>
                <p className="text-xs text-slate-300 mb-4">
                  Create a secure API key to share with external users or integrate into your third-party applications.
                </p>

                <form onSubmit={handleCreateApiKey} className="flex flex-col sm:flex-row items-center gap-3">
                  <input
                    type="text"
                    required
                    placeholder="Key Name (e.g., Client App 1, Marketing Team)"
                    value={newKeyName}
                    onChange={(e) => setNewKeyName(e.target.value)}
                    className="w-full sm:flex-1 px-3.5 py-2 text-xs border border-slate-700 bg-slate-800/80 rounded-xl text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-400 font-medium"
                  />
                  <div className="flex items-center space-x-2 w-full sm:w-auto">
                    <input
                      type="number"
                      required
                      min={1}
                      max={10000}
                      placeholder="Daily Limit"
                      value={newKeyDailyLimit}
                      onChange={(e) => setNewKeyDailyLimit(e.target.value)}
                      className="w-28 px-3 py-2 text-xs border border-slate-700 bg-slate-800/80 rounded-xl text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-400 font-bold"
                      title="Set Daily Sending Limit for this API Key"
                    />
                    <span className="text-[11px] text-slate-400 whitespace-nowrap hidden sm:inline">emails/day</span>
                    <button
                      type="submit"
                      disabled={isCreatingKey}
                      className="px-4 py-2 text-xs font-bold text-slate-950 bg-emerald-400 hover:bg-emerald-300 rounded-xl shadow-sm transition-all flex items-center space-x-1.5 disabled:opacity-50 shrink-0"
                    >
                      <Plus className="h-4 w-4" />
                      <span>{isCreatingKey ? 'Generating...' : '+ Create API Key'}</span>
                    </button>
                  </div>
                </form>

                {createdKeyNotice && (
                  <div className="mt-4 p-3 bg-emerald-500/20 border border-emerald-400/40 rounded-xl text-emerald-300 text-xs font-mono font-semibold flex items-center justify-between">
                    <span className="truncate">{createdKeyNotice}</span>
                    <button
                      onClick={() => copyToClipboard(createdKeyNotice.split(': ')[1] || '', 'newkey')}
                      className="ml-2 px-2 py-1 bg-emerald-500/30 hover:bg-emerald-500/50 rounded text-[11px] text-white shrink-0"
                    >
                      {copiedCode === 'newkey' ? 'Copied!' : 'Copy Key'}
                    </button>
                  </div>
                )}
              </div>

              {/* Existing API Keys Table */}
              <div>
                <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-3">
                  Your Active & Generated API Keys ({apiKeysList.length})
                </h4>

                <div className="space-y-3">
                  {apiKeysList.map((k) => (
                    <div
                      key={k.id}
                      className="p-4 rounded-xl border border-slate-200 bg-slate-50 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                    >
                      <div className="space-y-1 truncate">
                        <div className="flex items-center space-x-2">
                          <span className="text-xs font-bold text-slate-900">{k.name}</span>
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              k.status === 'active'
                                ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                                : 'bg-rose-100 text-rose-800 border border-rose-200'
                            }`}
                          >
                            {k.status.toUpperCase()}
                          </span>
                          <span className="px-2 py-0.5 rounded bg-violet-100 text-violet-800 text-[10px] font-bold">
                            Limit: {k.dailyLimit || 100} / day
                          </span>
                        </div>
                        <p className="text-xs font-mono text-slate-600 font-semibold truncate">{k.key}</p>
                        <div className="flex items-center space-x-4 text-[11px] text-slate-400">
                          <span>Created: {new Date(k.createdAt).toLocaleDateString()}</span>
                          <span>Today Sent: <strong className="text-slate-700 font-semibold">{k.todaySentCount || 0} / {k.dailyLimit || 100}</strong></span>
                        </div>
                      </div>

                      <div className="flex items-center space-x-2 shrink-0">
                        <button
                          onClick={() => copyToClipboard(k.key, k.id)}
                          className="px-3 py-1.5 text-xs font-semibold text-violet-700 bg-violet-100 hover:bg-violet-200 rounded-lg transition-colors flex items-center space-x-1"
                        >
                          <Copy className="h-3.5 w-3.5" />
                          <span>{copiedCode === k.id ? 'Copied!' : 'Copy'}</span>
                        </button>
                        {k.status === 'active' && (
                          <button
                            onClick={() => handleRevokeKey(k.id)}
                            className="px-3 py-1.5 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition-colors"
                          >
                            Revoke Key
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

            </div>
          )}
          
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
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Custom Subject Line (<code className="text-violet-700">subject</code> - Optional)
                  </label>
                  <input
                    type="text"
                    placeholder="Leave blank to use preset subject rotation"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-violet-500"
                  />
                  <p className="text-[11px] text-slate-400 mt-1">If blank, rotates automatically from your configured preset subject list.</p>
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

          {/* TAB 2: PRESET SUBJECTS CONFIG EDITOR */}
          {activeTab === 'presets' && (
            <div className="space-y-6">
              <div className="p-4 rounded-xl bg-violet-50 border border-violet-200 text-xs text-violet-950 flex items-start justify-between">
                <div>
                  <h4 className="font-bold text-sm text-violet-900 mb-1">Preset Subject Line Configuration</h4>
                  <p className="leading-relaxed text-violet-800">
                    When API callers omit the optional <code className="bg-violet-100 px-1 py-0.5 rounded font-bold font-mono">subject</code> parameter, the API automatically rotates through these preset subject lines in sequence.
                  </p>
                </div>
              </div>

              {presetSaveNotice && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold rounded-lg flex items-center space-x-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  <span>{presetSaveNotice}</span>
                </div>
              )}

              {/* Subject Lines List */}
              <div className="space-y-3">
                <label className="block text-xs font-bold text-slate-700">Active Preset Subjects ({presetSubjectsList.length})</label>
                {presetSubjectsList.map((subj, idx) => (
                  <div key={idx} className="flex items-center space-x-2">
                    <span className="w-6 h-6 rounded bg-slate-100 text-slate-600 font-bold text-xs flex items-center justify-center shrink-0">
                      {idx + 1}
                    </span>
                    <input
                      type="text"
                      value={subj}
                      onChange={(e) => {
                        const updated = [...presetSubjectsList];
                        updated[idx] = e.target.value;
                        setPresetSubjectsList(updated);
                      }}
                      className="flex-1 px-3 py-2 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-violet-500 font-medium text-slate-800"
                    />
                    <button
                      type="button"
                      onClick={() => handleRemovePresetSubject(idx)}
                      className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                      title="Remove subject"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>

              {/* Add New Preset Subject Input */}
              <div className="flex items-center space-x-2 pt-2 border-t border-slate-200">
                <input
                  type="text"
                  placeholder="Enter new preset subject line..."
                  value={newSubjectInput}
                  onChange={(e) => setNewSubjectInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddPresetSubject(); } }}
                  className="flex-1 px-3 py-2 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-violet-500"
                />
                <button
                  type="button"
                  onClick={handleAddPresetSubject}
                  className="px-3 py-2 text-xs font-bold text-violet-700 bg-violet-50 hover:bg-violet-100 border border-violet-200 rounded-lg flex items-center space-x-1.5 transition-all"
                >
                  <Plus className="h-4 w-4" />
                  <span>Add Subject</span>
                </button>
              </div>

              {/* Save Button */}
              <div className="pt-4 flex justify-end">
                <button
                  type="button"
                  onClick={handleSavePresetsConfig}
                  disabled={isSavingPresets}
                  className="flex items-center space-x-2 px-5 py-2.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-md transition-all disabled:opacity-50"
                >
                  <Save className="h-4 w-4" />
                  <span>{isSavingPresets ? 'Saving Config...' : 'Save Preset Subjects Config'}</span>
                </button>
              </div>
            </div>
          )}

          {/* TAB 3: CODE SNIPPETS & DOCS */}
          {activeTab === 'docs' && (
            <div className="space-y-6">
              <div className="p-4 rounded-xl bg-violet-50 border border-violet-200 text-xs text-violet-900 leading-relaxed">
                <strong>Public API Endpoint:</strong> Send JSON requests to <code className="bg-violet-100 px-1.5 py-0.5 rounded font-bold font-mono text-violet-900">POST /api/v1/send-mail</code>.
                Provide <code className="bg-violet-100 px-1.5 py-0.5 rounded font-bold">toEmail</code>, <code className="bg-violet-100 px-1.5 py-0.5 rounded font-bold">body</code>, and optional <code className="bg-violet-100 px-1.5 py-0.5 rounded font-bold">subject</code>.
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

          {/* TAB 4: SENDER DOMAINS & DB LOGS */}
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
