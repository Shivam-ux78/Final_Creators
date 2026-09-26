'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles, Mail, ShieldCheck, Settings, Database, Instagram, RefreshCw, LogOut, Code } from 'lucide-react';

interface NavbarProps {
  onOpenSettings: () => void;
  onOpenGuide: () => void;
  onOpenBatch: () => void;
  onOpenSingleEmail?: () => void;
  onOpenApiModal?: () => void;
  onSyncDb?: () => void;
  isDbConnected: boolean;
  totalCount: number;
  pendingCount: number;
  batchProgress?: { isRunning: boolean; sent: number; total: number; currentCreator?: string };
}

export default function Navbar({
  onOpenSettings,
  onOpenGuide,
  onOpenBatch,
  onOpenSingleEmail,
  onOpenApiModal,
  onSyncDb,
  isDbConnected,
  totalCount,
  pendingCount,
  batchProgress
}: NavbarProps) {
  const router = useRouter();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const handleLogout = async () => {
    if (confirm('Are you sure you want to sign out of MakeAble Admin?')) {
      setIsLoggingOut(true);
      try {
        await fetch('/api/auth/logout', { method: 'POST' });
        router.push('/login');
        router.refresh();
      } catch (err) {
        console.error('Logout error:', err);
      } finally {
        setIsLoggingOut(false);
      }
    }
  };

  return (
    <header className="sticky top-0 z-30 bg-white/90 backdrop-blur-md border-b border-slate-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          
          {/* Logo and Brand */}
          <div className="flex items-center space-x-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-tr from-violet-600 to-indigo-500 flex items-center justify-center text-white shadow-md shadow-violet-200">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-bold text-lg text-slate-900 tracking-tight">MakeAble Outreach</span>
              </div>
              <p className="text-xs text-slate-500 font-medium">Verified US Creator Discovery & Auto-Pitch</p>
            </div>
          </div>

          {/* Right Action buttons */}
          <div className="flex items-center space-x-2.5">
            
            {/* Auto Batch Send Button or Background Active Badge */}
            {batchProgress?.isRunning ? (
              <button
                onClick={onOpenBatch}
                className="flex items-center space-x-2 px-3.5 py-1.5 text-xs font-bold text-emerald-950 bg-emerald-100 hover:bg-emerald-200 border border-emerald-300 rounded-lg transition-all shadow-sm animate-pulse"
                title="View Active Background Outreach"
              >
                <RefreshCw className="h-3.5 w-3.5 animate-spin text-emerald-700" />
                <span>
                  Batch Active: {batchProgress.sent} / {batchProgress.total} Sent
                </span>
              </button>
            ) : (
              <button
                onClick={onOpenBatch}
                className="flex items-center space-x-1.5 px-3.5 py-1.5 text-xs font-bold text-white bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 rounded-lg transition-all shadow-sm shadow-violet-200"
                title="Launch Automated Batch Outreach"
              >
                <Sparkles className="h-4 w-4" />
                <span>Auto Batch Send ({pendingCount})</span>
              </button>
            )}

            {/* API Mail Sender Button */}
            {onOpenApiModal && (
              <button
                onClick={onOpenApiModal}
                className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-bold text-emerald-900 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 rounded-lg transition-all shadow-xs"
                title="API Mail Sender Console & Docs"
              >
                <Code className="h-4 w-4 text-emerald-600" />
                <span>API Mail Sender</span>
              </button>
            )}

            {/* Single Custom Email Dispatch Button */}
            {onOpenSingleEmail && (
              <button
                onClick={onOpenSingleEmail}
                className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-bold text-violet-900 bg-violet-50 hover:bg-violet-100 border border-violet-200 rounded-lg transition-all shadow-xs"
                title="Send or Enhance Single Custom Email"
              >
                <Mail className="h-4 w-4 text-violet-600" />
                <span className="hidden sm:inline">Single Email</span>
              </button>
            )}

            {/* Spam Prevention & Domain Setup Guide */}
            <button
              onClick={onOpenGuide}
              className="hidden md:flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-300/80 rounded-lg transition-colors shadow-sm"
              title="GoDaddy Free Domain & Anti-Spam Setup"
            >
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
              <span>Domain Guide</span>
            </button>

            {/* Email Signature Settings */}
            <button
              onClick={onOpenSettings}
              className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-300/80 rounded-lg transition-colors shadow-sm"
              title="Configure Outreach Signature"
            >
              <Settings className="h-4 w-4" />
              <span className="hidden sm:inline">Settings</span>
            </button>

            {/* Logout Button */}
            <button
              onClick={handleLogout}
              disabled={isLoggingOut}
              className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition-colors shadow-sm"
              title="Sign Out"
            >
              <LogOut className="h-4 w-4 text-rose-600" />
              <span className="hidden sm:inline">{isLoggingOut ? 'Signing out...' : 'Logout'}</span>
            </button>
          </div>

        </div>
      </div>
    </header>
  );
}


