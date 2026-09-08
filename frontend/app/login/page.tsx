'use client';

import React, { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Lock, User, Eye, EyeOff, Sparkles, ArrowRight, ShieldCheck, AlertCircle } from 'lucide-react';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const from = searchParams.get('from') || '/';

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      setError('Please enter your username and password.');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username.trim(),
          password: password.trim()
        })
      });

      const data = await res.json();

      if (res.ok && data.success) {
        router.push(from);
        router.refresh();
      } else {
        setError(data.error || 'Invalid credentials. Please try again.');
      }
    } catch (err: any) {
      setError('Network error. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md relative z-10 space-y-8 animate-fade-in">
      
      {/* Brand Header */}
      <div className="text-center space-y-3">
        <div className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-gradient-to-tr from-violet-600 via-indigo-600 to-purple-600 shadow-xl shadow-violet-500/20 border border-violet-400/30 text-white mb-2">
          <Sparkles className="h-7 w-7" />
        </div>
        <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white">
          MakeAble <span className="bg-gradient-to-r from-violet-400 to-indigo-300 bg-clip-text text-transparent">Creators</span>
        </h1>
        <p className="text-xs text-slate-400 max-w-xs mx-auto">
          Secure Admin Access for Creator Outreach & AI Collaboration Dashboard
        </p>
      </div>

      {/* Login Card */}
      <div className="bg-slate-900/80 backdrop-blur-xl border border-slate-800 rounded-3xl p-7 sm:p-8 shadow-2xl shadow-black/50 space-y-6">
        
        <div className="flex items-center justify-between border-b border-slate-800/80 pb-4">
          <div>
            <h2 className="text-sm font-bold text-slate-200">Admin Sign In</h2>
            <p className="text-[11px] text-slate-400">Enter your credentials to continue</p>
          </div>
          <span className="flex items-center space-x-1.5 px-2.5 py-1 text-[10px] font-bold bg-violet-950 text-violet-300 border border-violet-800/60 rounded-full">
            <ShieldCheck className="h-3.5 w-3.5 text-violet-400" />
            <span>Protected</span>
          </span>
        </div>

        {error && (
          <div className="p-3.5 bg-rose-950/60 border border-rose-800/80 rounded-2xl text-rose-300 text-xs flex items-start space-x-2.5 animate-shake">
            <AlertCircle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />
            <span className="leading-relaxed font-medium">{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          
          {/* Username field */}
          <div className="space-y-1.5">
            <label className="block text-[11px] font-bold text-slate-300">
              Username or Admin Email
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                <User className="h-4 w-4" />
              </div>
              <input
                type="text"
                required
                autoFocus
                placeholder="admin"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-slate-950/70 border border-slate-800 rounded-xl text-slate-100 placeholder-slate-600 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition-all"
              />
            </div>
          </div>

          {/* Password field */}
          <div className="space-y-1.5">
            <label className="block text-[11px] font-bold text-slate-300">
              Password
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                <Lock className="h-4 w-4" />
              </div>
              <input
                type={showPassword ? 'text' : 'password'}
                required
                placeholder="••••••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full pl-10 pr-10 py-2.5 bg-slate-950/70 border border-slate-800 rounded-xl text-slate-100 placeholder-slate-600 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition-all"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-500 hover:text-slate-300 transition-colors"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={isLoading}
            className="w-full mt-2 py-3 px-4 bg-gradient-to-r from-violet-600 via-indigo-600 to-purple-600 hover:from-violet-500 hover:via-indigo-500 hover:to-purple-500 text-white font-bold rounded-xl text-xs transition-all shadow-lg shadow-violet-600/30 flex items-center justify-center space-x-2 disabled:opacity-50 group"
          >
            {isLoading ? (
              <>
                <div className="h-3.5 w-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span>Authenticating...</span>
              </>
            ) : (
              <>
                <span>Sign In to Dashboard</span>
                <ArrowRight className="h-3.5 w-3.5 group-hover:translate-x-0.5 transition-transform" />
              </>
            )}
          </button>
        </form>

      </div>

      {/* Footer info */}
      <div className="text-center text-[11px] text-slate-500 space-y-1">
        <p>© 2026 MakeAble NYC. All rights reserved.</p>
        <p className="text-[10px] text-slate-600">Encrypted with HTTPS & Secure HttpOnly Session Tokens</p>
      </div>

    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-screen w-full bg-slate-950 text-slate-100 flex flex-col justify-center items-center p-4 relative overflow-hidden font-['Plus_Jakarta_Sans',sans-serif]">
      
      {/* Dynamic Background Glow Elements */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-gradient-to-tr from-violet-600/20 via-indigo-600/20 to-purple-600/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-10 right-10 w-[350px] h-[350px] bg-emerald-500/10 rounded-full blur-[100px] pointer-events-none" />
      
      <Suspense fallback={
        <div className="flex items-center space-x-2 text-slate-400 text-xs">
          <div className="h-4 w-4 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
          <span>Loading sign in...</span>
        </div>
      }>
        <LoginForm />
      </Suspense>
    </div>
  );
}
