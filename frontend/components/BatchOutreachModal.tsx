'use client';

import React, { useState, useEffect, useRef } from 'react';
import { X, Play, CheckCircle2, AlertCircle, Zap, ShieldCheck, RefreshCw, Square, Terminal, Sparkles, Send } from 'lucide-react';

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

  const [isRunning, setIsRunning] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [progress, setProgress] = useState<{ total: number; sent: number; failed?: number; currentCreator?: string } | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [recentLogs, setRecentLogs] = useState<Array<{ time: string; message: string; success: boolean }>>([]);
  
  const wasRunningRef = useRef(false);

  // Fetch status from server
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
          currentCreator: data.currentCreator || ''
        });

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
    setStatusMessage(`Starting automated outreach for ${sendAll ? 'all' : targetCount} pending creators...`);

    try {
      const res = await fetch('/api/automated-outreach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          limit: sendAll ? 0 : targetCount, // 0 = send all pending
          minSleepSeconds: minSleep,
          maxSleepSeconds: maxSleep,
          dryRun
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
                    <span>Sending in Background</span>
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500">
                100% automatic — runs on server even when browser is closed
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
          
          {/* Background Persistence Banner */}
          <div className="p-3 bg-violet-50/80 border border-violet-200 rounded-xl flex items-start space-x-2.5 text-violet-900">
            <ShieldCheck className="h-4 w-4 text-violet-600 shrink-0 mt-0.5" />
            <div className="leading-relaxed">
              <span className="font-bold block">Zero Maintenance Background Outreach:</span>
              <span className="text-slate-600 text-[11px]">
                Clicking Start will automatically generate AI pitches tailored to each creator and send them one by one. Once all emails are sent, it stops automatically. You can safely close your browser tab.
              </span>
            </div>
          </div>

          {/* Active Running State Display */}
          {isRunning ? (
            <div className="space-y-3">
              <div className="p-4 bg-slate-900 text-white rounded-xl space-y-3 shadow-lg">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <RefreshCw className="h-4 w-4 animate-spin text-violet-400" />
                    <span className="font-bold text-sm text-slate-100">Live Auto Outreach In Progress</span>
                  </div>
                  <span className="font-mono text-xs text-emerald-400 font-bold">
                    {progress?.sent || 0} / {progress?.total || targetCount} Sent
                  </span>
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
                  <span className="truncate max-w-[340px] font-medium">
                    {statusMessage || 'Processing outreach emails...'}
                  </span>
                  {progress?.currentCreator && (
                    <span className="px-2 py-0.5 bg-slate-800 text-violet-300 rounded font-mono text-[10px]">
                      @{progress.currentCreator}
                    </span>
                  )}
                </div>
              </div>

              {/* Live activity log stream */}
              <div>
                <div className="flex items-center justify-between mb-1.5 text-slate-600 font-bold text-[11px]">
                  <span className="flex items-center space-x-1">
                    <Terminal className="h-3.5 w-3.5 text-slate-500" />
                    <span>Real-time Dispatch Stream</span>
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
                    <span className="text-xs text-slate-500 block">Single-Source DB</span>
                    <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                      Supabase PostgreSQL
                    </span>
                  </div>
                </div>

                <p className="mt-2 text-xs text-slate-600 leading-relaxed">
                  {pendingCount > 0 
                    ? `Clicking the button below will immediately start automatic outreach to all ${pendingCount} remaining creators.`
                    : 'All creators have received outreach emails! No pending creators remaining.'}
                </p>
              </div>

              {/* Mode Selection */}
              <div className="space-y-2">
                <label className="block font-bold text-slate-700 text-[11px]">
                  Outreach Scope
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
                    <span className="text-[10px] text-slate-500 font-normal">Auto-send to everyone pending</span>
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
                      <span className="font-bold">Custom Batch Size</span>
                    </div>
                    <span className="text-[10px] text-slate-500 font-normal">Set custom number of emails</span>
                  </button>
                </div>
              </div>

              {/* Custom Batch Size Input (if selected) */}
              {!sendAll && (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                  <label className="block font-bold text-slate-700 mb-1 text-[11px]">
                    Number of Emails to Send
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

              {/* Anti-Spam Pacing */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between">
                <div>
                  <span className="font-bold text-slate-800 text-[11px] block">Anti-Spam Pacing Delay</span>
                  <span className="text-[10px] text-slate-500">Human-like delay between each email</span>
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
                  : `Start Auto Outreach (${sendAll ? 'All ' + pendingCount : targetCount} Creators)`}
              </span>
            </button>
          )}
        </div>

      </div>
    </div>
  );
}
