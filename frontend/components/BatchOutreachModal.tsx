'use client';

import React, { useState, useEffect, useRef } from 'react';
import { X, Play, CheckCircle2, AlertCircle, Zap, ShieldCheck, RefreshCw, Square, Terminal, Sparkles, Send, Repeat, Mail, Settings2, Clock, Timer, Hourglass } from 'lucide-react';

interface BatchOutreachModalProps {
  isOpen: boolean;
  onClose: () => void;
  onBatchComplete: () => void;
  pendingCount: number;
}

export default function BatchOutreachModal({
  isOpen,
  onClose,
  onBatchComplete,
  pendingCount
}: BatchOutreachModalProps) {
  const [sendAll, setSendAll] = useState(true);
  const [batchLimit, setBatchLimit] = useState(50);
  const [minSleep, setMinSleep] = useState(15);
  const [maxSleep, setMaxSleep] = useState(30);
  const [dryRun, setDryRun] = useState(false);

  // Multi-Account Sender Rotation State
  const [senderMode, setSenderMode] = useState<'rotate' | 'sender_1' | 'sender_2' | 'custom'>('rotate');
  const [rotationInterval, setRotationInterval] = useState(5);
  const [customSenderEmail, setCustomSenderEmail] = useState('');
  const [customSenderName, setCustomSenderName] = useState('MakeAble Partnerships');
  const [configuredSenders, setConfiguredSenders] = useState<Array<{ id: string; label: string; senderEmail: string }>>([]);

  // Recurring Interval Cooldown State
  const [enableIntervalCycles, setEnableIntervalCycles] = useState(true);
  const [burstSize, setBurstSize] = useState(10); // 5 per domain = 10 total per burst
  const [cooldownMinutes, setCooldownMinutes] = useState(30); // 30 min cooldown between bursts

  const [isRunning, setIsRunning] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [progress, setProgress] = useState<{
    total: number;
    sent: number;
    failed?: number;
    currentCreator?: string;
    currentSender?: string;
    isCooldown?: boolean;
    nextCycleAt?: string | null;
    currentCycle?: number;
    totalCycles?: number;
  } | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [recentLogs, setRecentLogs] = useState<Array<{ time: string; message: string; success: boolean; sender?: string }>>([]);
  
  const wasRunningRef = useRef(false);

  // Fetch status & configured senders from server
  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/automated-outreach');
      const data = await res.json();
      if (data.success) {
        const currentlyRunning = Boolean(data.isRunning);
        setIsRunning(currentlyRunning);
        setProgress({
          total: data.total || 0,
          sent: data.sent || 0,
          failed: data.failed || 0,
          currentCreator: data.currentCreator || '',
          currentSender: data.currentSender || '',
          isCooldown: Boolean(data.isCooldown),
          nextCycleAt: data.nextCycleAt || null,
          currentCycle: data.currentCycle || 1,
          totalCycles: data.totalCycles || 1
        });

        if (Array.isArray(data.senders) && data.senders.length > 0) {
          setConfiguredSenders(data.senders);
        }

        if (currentlyRunning) {
          setStatusMessage(data.statusMessage || 'Outreach engine active in background...');
          wasRunningRef.current = true;
        } else {
          // If it just transitioned from running to finished
          if (wasRunningRef.current) {
            wasRunningRef.current = false;
            onBatchComplete();
          }
          if (data.statusMessage && (data.statusMessage.includes('completed') || data.statusMessage.includes('stopped') || data.statusMessage.includes('halted'))) {
            setStatusMessage(data.statusMessage);
          } else {
            setStatusMessage(null);
          }
        }

        if (Array.isArray(data.recentLogs)) {
          setRecentLogs(data.recentLogs);
        }
      }
    } catch (err) {
      console.warn('Could not fetch background batch status:', err);
    }
  };

  // Poll status when modal is open
  useEffect(() => {
    if (isOpen) {
      fetchStatus();
      const interval = setInterval(fetchStatus, 2000);
      return () => clearInterval(interval);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const targetCount = sendAll ? (pendingCount || 292) : Math.min(batchLimit, pendingCount || 292);

  const handleStartBatch = async () => {
    setIsStarting(true);
    setIsRunning(true);
    setStatusMessage(`Starting automated outreach engine...`);

    try {
      const res = await fetch('/api/automated-outreach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          limit: sendAll ? 0 : targetCount,
          minSleepSeconds: minSleep,
          maxSleepSeconds: maxSleep,
          dryRun,
          senderMode,
          customSenderEmail,
          customSenderName,
          rotationInterval,
          enableIntervalCycles,
          burstSize,
          cooldownMinutes
        })
      });

      const data = await res.json();
      if (data.success) {
        setStatusMessage(data.message || 'Auto outreach is running in background.');
        fetchStatus();
      } else {
        alert(`Error starting outreach: ${data.error}`);
        setIsRunning(false);
      }
    } catch (e: any) {
      alert(`Network error starting outreach: ${e.message}`);
      setIsRunning(false);
    } finally {
      setIsStarting(false);
    }
  };

  const handleStopBatch = async () => {
    setIsStopping(true);
    try {
      const res = await fetch('/api/automated-outreach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stop' })
      });
      const data = await res.json();
      if (data.success) {
        setStatusMessage('Stopping background outreach...');
        setTimeout(fetchStatus, 1000);
      }
    } catch (err: any) {
      alert(`Failed to stop outreach: ${err.message}`);
    } finally {
      setIsStopping(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-fade-in">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-xl max-h-[92vh] flex flex-col overflow-hidden">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/80">
          <div className="flex items-center space-x-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-tr from-violet-600 to-indigo-600 text-white flex items-center justify-center shadow-md shadow-violet-200">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-base font-bold text-slate-900">
                  Automated Creator Outreach Engine
                </h2>
                {isRunning && (
                  <span className="flex items-center space-x-1.5 px-2 py-0.5 text-[10px] font-bold bg-emerald-100 text-emerald-800 rounded-full border border-emerald-200 animate-pulse">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-600"></span>
                    <span>{progress?.isCooldown ? 'Interval Cooldown' : 'Sending in Background'}</span>
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500">
                100% automated — 5/domain rotation & scheduled recurring burst cycles
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

        {/* Modal Content */}
        <div className="p-6 overflow-y-auto space-y-4 flex-1 text-xs">
          
          {/* Active Running State Display */}
          {isRunning ? (
            <div className="space-y-3">
              <div className="p-4 bg-slate-900 text-white rounded-xl space-y-3 shadow-lg">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    {progress?.isCooldown ? (
                      <Hourglass className="h-4 w-4 text-amber-400 animate-pulse" />
                    ) : (
                      <RefreshCw className="h-4 w-4 animate-spin text-violet-400" />
                    )}
                    <span className="font-bold text-sm text-slate-100">
                      {progress?.isCooldown ? 'Interval Cooldown Active' : 'Live Auto Outreach In Progress'}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="font-mono text-xs text-emerald-400 font-bold block">
                      {progress?.sent || 0} / {progress?.total || targetCount} Sent
                    </span>
                    {progress?.totalCycles && progress.totalCycles > 1 && (
                      <span className="text-[10px] text-slate-400 font-medium">
                        Cycle {progress.currentCycle || 1} of {progress.totalCycles}
                      </span>
                    )}
                  </div>
                </div>

                {/* Progress Bar */}
                <div className="w-full h-2.5 bg-slate-800 rounded-full overflow-hidden border border-slate-700">
                  <div
                    className="h-full bg-gradient-to-r from-violet-500 to-emerald-400 transition-all duration-500 rounded-full"
                    style={{
                      width: `${
                        progress && progress.total > 0
                          ? Math.min(100, Math.max(5, (progress.sent / progress.total) * 100))
                          : 5
                      }%`
                    }}
                  />
                </div>

                {/* Status message */}
                <div className="text-[11px] text-slate-300 flex items-center justify-between">
                  <span className="truncate max-w-[320px] font-medium">
                    {statusMessage || 'Processing outreach emails...'}
                  </span>
                  <div className="flex items-center space-x-1.5 shrink-0">
                    {progress?.currentSender && (
                      <span className="px-2 py-0.5 bg-indigo-950 text-indigo-300 border border-indigo-800 rounded font-mono text-[10px]">
                        {progress.currentSender.split('@')[1] || progress.currentSender}
                      </span>
                    )}
                    {progress?.currentCreator && (
                      <span className="px-2 py-0.5 bg-slate-800 text-violet-300 rounded font-mono text-[10px]">
                        @{progress.currentCreator}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Live activity log stream */}
              <div>
                <div className="flex items-center justify-between mb-1.5 text-slate-600 font-bold text-[11px]">
                  <span className="flex items-center space-x-1">
                    <Terminal className="h-3.5 w-3.5 text-slate-500" />
                    <span>Real-time Dispatch Stream (with Sender Rotation)</span>
                  </span>
                  <span className="text-[10px] text-slate-400 font-normal">Live from Supabase</span>
                </div>
                <div className="bg-slate-950 text-slate-200 p-3 rounded-xl font-mono text-[11px] max-h-40 overflow-y-auto space-y-1.5 border border-slate-800">
                  {recentLogs.length > 0 ? (
                    recentLogs.map((log, idx) => (
                      <div key={idx} className="flex items-start space-x-2">
                        <span className="text-slate-500 text-[10px] shrink-0">[{log.time}]</span>
                        <span className={log.success ? 'text-emerald-400' : 'text-rose-400'}>
                          {log.message}
                        </span>
                      </div>
                    ))
                  ) : (
                    <div className="text-slate-500 italic">Initializing auto outreach queue...</div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            /* Setup Configuration Form when not running */
            <div className="space-y-4">
              
              {/* Main Status / Summary Card */}
              <div className="p-4 bg-gradient-to-r from-violet-50 to-indigo-50 border border-violet-200 rounded-xl">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs font-semibold text-violet-700 uppercase tracking-wider block">Pending Outreach Queue</span>
                    <span className="text-2xl font-black text-slate-900">
                      {pendingCount} Creators Pending
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-xs text-slate-500 block">Database</span>
                    <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                      Supabase PostgreSQL
                    </span>
                  </div>
                </div>

                <p className="mt-2 text-xs text-slate-600 leading-relaxed">
                  {pendingCount > 0 
                    ? `Clicking the button below will start automatic outreach to all ${pendingCount} remaining creators.`
                    : 'All creators have received outreach emails! No pending creators remaining.'}
                </p>
              </div>

              {/* SENDER IDENTITY / ROTATION SETTING */}
              <div className="space-y-2">
                <label className="block font-bold text-slate-700 text-[11px] flex items-center justify-between">
                  <span className="flex items-center space-x-1.5">
                    <Repeat className="h-3.5 w-3.5 text-violet-600" />
                    <span>Sender Identity & Domain Rotation</span>
                  </span>
                  <span className="text-[10px] text-violet-600 font-semibold bg-violet-50 px-2 py-0.5 rounded-full border border-violet-200">
                    5 Emails / Rotation
                  </span>
                </label>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setSenderMode('rotate')}
                    className={`p-2.5 rounded-xl border text-left transition-all ${
                      senderMode === 'rotate'
                        ? 'border-violet-600 bg-violet-50/80 text-violet-900 font-bold shadow-sm'
                        : 'border-slate-200 hover:border-slate-300 text-slate-700'
                    }`}
                  >
                    <div className="flex items-center space-x-1.5 mb-0.5">
                      <Repeat className="h-3.5 w-3.5 text-violet-600" />
                      <span className="font-bold">Auto-Rotate (5 per domain)</span>
                    </div>
                    <span className="text-[10px] text-slate-500 font-normal block truncate">
                      Rotates between .info & .online accounts
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSenderMode('sender_1')}
                    className={`p-2.5 rounded-xl border text-left transition-all ${
                      senderMode === 'sender_1'
                        ? 'border-violet-600 bg-violet-50/80 text-violet-900 font-bold shadow-sm'
                        : 'border-slate-200 hover:border-slate-300 text-slate-700'
                    }`}
                  >
                    <div className="flex items-center space-x-1.5 mb-0.5">
                      <Mail className="h-3.5 w-3.5 text-indigo-600" />
                      <span className="font-bold">Account 1 (partnerships@)</span>
                    </div>
                    <span className="text-[10px] text-slate-500 font-normal block truncate">
                      makeable.info only
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSenderMode('sender_2')}
                    className={`p-2.5 rounded-xl border text-left transition-all ${
                      senderMode === 'sender_2'
                        ? 'border-violet-600 bg-violet-50/80 text-violet-900 font-bold shadow-sm'
                        : 'border-slate-200 hover:border-slate-300 text-slate-700'
                    }`}
                  >
                    <div className="flex items-center space-x-1.5 mb-0.5">
                      <Mail className="h-3.5 w-3.5 text-emerald-600" />
                      <span className="font-bold">Account 2 (collab@)</span>
                    </div>
                    <span className="text-[10px] text-slate-500 font-normal block truncate">
                      makeable.online only
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSenderMode('custom')}
                    className={`p-2.5 rounded-xl border text-left transition-all ${
                      senderMode === 'custom'
                        ? 'border-violet-600 bg-violet-50/80 text-violet-900 font-bold shadow-sm'
                        : 'border-slate-200 hover:border-slate-300 text-slate-700'
                    }`}
                  >
                    <div className="flex items-center space-x-1.5 mb-0.5">
                      <Settings2 className="h-3.5 w-3.5 text-amber-600" />
                      <span className="font-bold">Custom Sender Email</span>
                    </div>
                    <span className="text-[10px] text-slate-500 font-normal block truncate">
                      Specify manual from email
                    </span>
                  </button>
                </div>

                {/* Custom Email Input */}
                {senderMode === 'custom' && (
                  <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-xl space-y-2 mt-2">
                    <div>
                      <label className="block font-bold text-amber-900 text-[10px] mb-1">
                        From Email Address
                      </label>
                      <input
                        type="email"
                        placeholder="outreach@makeable.nyc"
                        value={customSenderEmail}
                        onChange={(e) => setCustomSenderEmail(e.target.value)}
                        className="w-full px-3 py-1.5 bg-white border border-amber-200 rounded-lg text-slate-900 font-medium text-xs focus:ring-2 focus:ring-amber-500"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* RECURRING INTERVAL / COOLDOWN BURST SETTING */}
              <div className="p-3.5 bg-indigo-50/70 border border-indigo-200 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Clock className="h-4 w-4 text-indigo-600" />
                    <div>
                      <span className="font-bold text-slate-900 text-xs block">Scheduled Interval Burst Engine</span>
                      <span className="text-[10px] text-slate-500">Send 5 from each domain, pause, and auto-restart</span>
                    </div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={enableIntervalCycles}
                      onChange={(e) => setEnableIntervalCycles(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
                  </label>
                </div>

                {enableIntervalCycles && (
                  <div className="grid grid-cols-2 gap-3 pt-2 border-t border-indigo-100">
                    <div>
                      <label className="block font-bold text-indigo-950 text-[10px] mb-1">
                        Emails Per Burst Cycle
                      </label>
                      <div className="flex items-center space-x-1.5">
                        <input
                          type="number"
                          min={2}
                          max={50}
                          value={burstSize}
                          onChange={(e) => setBurstSize(parseInt(e.target.value) || 10)}
                          className="w-full px-2.5 py-1.5 bg-white border border-indigo-200 rounded-lg text-slate-900 font-bold text-xs"
                        />
                        <span className="text-[10px] text-slate-500 font-semibold shrink-0">emails</span>
                      </div>
                      <span className="text-[9px] text-indigo-600 block mt-0.5">
                        ({Math.round(burstSize / 2)} from Account 1, {Math.round(burstSize / 2)} from Account 2)
                      </span>
                    </div>

                    <div>
                      <label className="block font-bold text-indigo-950 text-[10px] mb-1">
                        Cooldown Pause Time
                      </label>
                      <div className="flex items-center space-x-1.5">
                        <input
                          type="number"
                          min={5}
                          max={360}
                          value={cooldownMinutes}
                          onChange={(e) => setCooldownMinutes(parseInt(e.target.value) || 30)}
                          className="w-full px-2.5 py-1.5 bg-white border border-indigo-200 rounded-lg text-slate-900 font-bold text-xs"
                        />
                        <span className="text-[10px] text-slate-500 font-semibold shrink-0">min</span>
                      </div>
                      <div className="flex items-center space-x-1 mt-1">
                        {[15, 30, 60].map((mins) => (
                          <button
                            key={mins}
                            type="button"
                            onClick={() => setCooldownMinutes(mins)}
                            className={`px-1.5 py-0.5 text-[9px] font-bold rounded ${
                              cooldownMinutes === mins
                                ? 'bg-indigo-600 text-white'
                                : 'bg-white border border-indigo-200 text-indigo-700 hover:bg-indigo-50'
                            }`}
                          >
                            {mins}m
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Mode Selection */}
              <div className="space-y-2">
                <label className="block font-bold text-slate-700 text-[11px]">
                  Total Outreach Scope
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setSendAll(true)}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      sendAll
                        ? 'border-violet-600 bg-violet-50/70 text-violet-900 font-bold shadow-sm'
                        : 'border-slate-200 hover:border-slate-300 text-slate-700'
                    }`}
                  >
                    <div className="flex items-center space-x-1.5 mb-1">
                      <Zap className="h-4 w-4 text-violet-600" />
                      <span className="font-bold">All Pending ({pendingCount})</span>
                    </div>
                    <span className="text-[10px] text-slate-500 font-normal">Auto-send across recurring cycles</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSendAll(false)}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      !sendAll
                        ? 'border-violet-600 bg-violet-50/70 text-violet-900 font-bold shadow-sm'
                        : 'border-slate-200 hover:border-slate-300 text-slate-700'
                    }`}
                  >
                    <div className="flex items-center space-x-1.5 mb-1">
                      <Send className="h-4 w-4 text-indigo-600" />
                      <span className="font-bold">Custom Total Limit</span>
                    </div>
                    <span className="text-[10px] text-slate-500 font-normal">Cap maximum total emails</span>
                  </button>
                </div>
              </div>

              {/* Custom Total Limit (if selected) */}
              {!sendAll && (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                  <label className="block font-bold text-slate-700 mb-1 text-[11px]">
                    Total Number of Emails to Send
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={pendingCount || 292}
                    value={batchLimit}
                    onChange={(e) => setBatchLimit(parseInt(e.target.value) || 10)}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 font-bold focus:ring-2 focus:ring-violet-500 text-sm"
                  />
                </div>
              )}

              {/* Anti-Spam Pacing Delay Between Emails */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between">
                <div>
                  <span className="font-bold text-slate-800 text-[11px] block">Delay Between Each Email</span>
                  <span className="text-[10px] text-slate-500">Human-like spacing inside each burst</span>
                </div>
                <div className="flex items-center space-x-1.5">
                  <input
                    type="number"
                    min={5}
                    max={60}
                    value={minSleep}
                    onChange={(e) => setMinSleep(parseInt(e.target.value) || 15)}
                    className="w-14 px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-900 text-center font-bold text-xs"
                  />
                  <span className="text-slate-400 font-bold text-xs">to</span>
                  <input
                    type="number"
                    min={10}
                    max={120}
                    value={maxSleep}
                    onChange={(e) => setMaxSleep(parseInt(e.target.value) || 30)}
                    className="w-14 px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-900 text-center font-bold text-xs"
                  />
                  <span className="text-slate-500 font-semibold text-xs">sec</span>
                </div>
              </div>

              {statusMessage && (
                <div className="p-3 bg-slate-100 border border-slate-200 rounded-xl font-semibold text-slate-800 flex items-center space-x-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                  <span className="text-xs">{statusMessage}</span>
                </div>
              )}

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
            {isRunning ? 'Close Window (Keep Sending in Background)' : 'Close'}
          </button>

          {isRunning ? (
            <button
              type="button"
              onClick={handleStopBatch}
              disabled={isStopping}
              className="flex items-center space-x-2 px-5 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-rose-200 disabled:opacity-50"
            >
              <Square className="h-3.5 w-3.5 fill-current" />
              <span>{isStopping ? 'Stopping...' : 'Stop Auto Outreach'}</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={handleStartBatch}
              disabled={pendingCount === 0 || isStarting}
              className="flex items-center space-x-2 px-6 py-2.5 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-violet-200 disabled:opacity-50"
            >
              <Play className="h-4 w-4 fill-current" />
              <span>
                {isStarting 
                  ? 'Starting Engine...' 
                  : pendingCount === 0 
                  ? 'All Emails Sent' 
                  : `Start Scheduled Outreach (${enableIntervalCycles ? `${burstSize} / ${cooldownMinutes}m` : (sendAll ? 'All ' + pendingCount : targetCount)})`}
              </span>
            </button>
          )}
        </div>

      </div>
    </div>
  );
}
