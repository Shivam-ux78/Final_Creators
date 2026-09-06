'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Navbar from '@/components/Navbar';
import MetricsHeader from '@/components/MetricsHeader';
import FiltersBar from '@/components/FiltersBar';
import CreatorTable from '@/components/CreatorTable';
import EmailModal from '@/components/EmailModal';
import CreatorDetailModal from '@/components/CreatorDetailModal';
import SignatureSettingsModal from '@/components/SignatureSettingsModal';
import DeliverabilityGuideModal from '@/components/DeliverabilityGuideModal';
import BatchOutreachModal from '@/components/BatchOutreachModal';
import { Creator, EmailSignature, FilterState } from '@/lib/types';
import { Sparkles, RefreshCw, AlertCircle } from 'lucide-react';

const DEFAULT_SIGNATURE: EmailSignature = {
  senderName: 'MakeAble Partnerships',
  title: 'Creator & Affiliate Team',
  brandName: 'MakeAble',
  website: 'https://makeable.nyc',
  phone: '+1 (555) 349-2810',
  customSignoff: 'Looking forward to creating something amazing together!'
};

export default function DashboardPage() {
  const [creators, setCreators] = useState<Creator[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDbConnected, setIsDbConnected] = useState(false);

  // Filters State
  const [filters, setFilters] = useState<FilterState>({
    search: '',
    category: 'All',
    emailStatus: 'all',
    dateFilter: 'all',
    sortBy: 'followers_desc'
  });

  // Modal States
  const [selectedCreatorForPitch, setSelectedCreatorForPitch] = useState<Creator | null>(null);
  const [isPitchModalOpen, setIsPitchModalOpen] = useState(false);

  const [selectedCreatorForDetail, setSelectedCreatorForDetail] = useState<Creator | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);

  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isGuideModalOpen, setIsGuideModalOpen] = useState(false);
  const [isBatchModalOpen, setIsBatchModalOpen] = useState(false);

  // Email Signature State (persisted in localStorage)
  const [signature, setSignature] = useState<EmailSignature>(DEFAULT_SIGNATURE);
  const [copiedEmail, setCopiedEmail] = useState<string | null>(null);

  // Background Batch Outreach State
  const [batchProgress, setBatchProgress] = useState<{ isRunning: boolean; sent: number; total: number; currentCreator?: string }>({
    isRunning: false,
    sent: 0,
    total: 0
  });

  // Poll background batch status periodically
  useEffect(() => {
    const checkBatchStatus = async () => {
      try {
        const res = await fetch('/api/automated-outreach');
        const data = await res.json();
        if (data.success) {
          setBatchProgress({
            isRunning: Boolean(data.isRunning),
            sent: data.sent || 0,
            total: data.total || 0,
            currentCreator: data.currentCreator || ''
          });
        }
      } catch (e) {
        // silent catch
      }
    };

    checkBatchStatus();
    const interval = setInterval(checkBatchStatus, 3000);
    return () => clearInterval(interval);
  }, []);

  // Load signature from localStorage
  useEffect(() => {
    try {
      const savedSig = localStorage.getItem('creator_outreach_signature');
      if (savedSig) {
        setSignature(JSON.parse(savedSig));
      }
    } catch (e) {
      console.warn('Could not read saved signature:', e);
    }
  }, []);

  const handleSaveSignature = (newSig: EmailSignature) => {
    setSignature(newSig);
    try {
      localStorage.setItem('creator_outreach_signature', JSON.stringify(newSig));
    } catch (e) {
      console.warn('Could not save signature:', e);
    }
  };

  // Fetch creators from API
  const fetchCreators = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/creators');
      const data = await res.json();
      if (data.success) {
        setCreators(data.creators || []);
        setIsDbConnected(Boolean(data.isFromDb));
      } else {
        setError(data.error || 'Failed to fetch creators.');
      }
    } catch (err: any) {
      setError(err.message || 'Network error fetching data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCreators();
  }, []);

  // Compute unique categories
  const categories = useMemo(() => {
    const set = new Set<string>();
    creators.forEach((c) => {
      if (c.category) {
        c.category.split('/').forEach((part) => {
          const trimmed = part.trim();
          if (trimmed.length > 2) set.add(trimmed);
        });
      }
    });
    return Array.from(set).sort();
  }, [creators]);

  // Apply in-memory search, filter, and sorting
  const filteredCreators = useMemo(() => {
    let result = [...creators];

    // Search
    if (filters.search.trim()) {
      const q = filters.search.toLowerCase().trim();
      result = result.filter(
        (c) =>
          (c.username || '').toLowerCase().includes(q) ||
          (c.name || '').toLowerCase().includes(q) ||
          (c.email || '').toLowerCase().includes(q) ||
          (c.biography || '').toLowerCase().includes(q) ||
          (c.category || '').toLowerCase().includes(q)
      );
    }

    // Category
    if (filters.category && filters.category !== 'All') {
      result = result.filter((c) =>
        (c.category || '').toLowerCase().includes(filters.category.toLowerCase())
      );
    }

    // Email Status
    if (filters.emailStatus !== 'all') {
      result = result.filter((c) => c.email_status === filters.emailStatus);
    }

    // Date / Time filter
    if (filters.dateFilter === 'today') {
      const today = new Date().toISOString().split('T')[0];
      result = result.filter((c) => (c.created_at || '').startsWith(today));
    } else if (filters.dateFilter === 'last_7_days') {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      result = result.filter((c) => (c.created_at || '') >= sevenDaysAgo);
    } else if (filters.dateFilter === 'last_30_days') {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      result = result.filter((c) => (c.created_at || '') >= thirtyDaysAgo);
    }

    // Sorting
    if (filters.sortBy === 'followers_desc') {
      result.sort((a, b) => (b.followers_num || 0) - (a.followers_num || 0));
    } else if (filters.sortBy === 'followers_asc') {
      result.sort((a, b) => (a.followers_num || 0) - (b.followers_num || 0));
    } else if (filters.sortBy === 'created_newest') {
      result.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    } else if (filters.sortBy === 'last_emailed') {
      result.sort((a, b) => (b.last_emailed_at || '').localeCompare(a.last_emailed_at || ''));
    }

    return result;
  }, [creators, filters]);

  // Handle Quick filter events
  const handleFilterToday = () => {
    setFilters((prev) => ({ ...prev, dateFilter: 'today' }));
  };

  const handleFilterSent = () => {
    setFilters((prev) => ({ ...prev, emailStatus: 'sent' }));
  };

  const handleFilterNotSent = () => {
    setFilters((prev) => ({ ...prev, emailStatus: 'not_sent' }));
  };

  const handleResetFilters = () => {
    setFilters({
      search: '',
      category: 'All',
      emailStatus: 'all',
      dateFilter: 'all',
      sortBy: 'followers_desc'
    });
  };

  const handleQuickCopyEmail = (email: string) => {
    navigator.clipboard.writeText(email);
    setCopiedEmail(email);
    setTimeout(() => setCopiedEmail(null), 1500);
  };

  // Update creator status locally when email is successfully sent
  const handleEmailSentSuccess = (username: string, subject: string, body: string) => {
    setCreators((prev) =>
      prev.map((c) => {
        if (c.username.toLowerCase() === username.toLowerCase()) {
          return {
            ...c,
            email_status: 'sent',
            last_emailed_at: new Date().toISOString(),
            email_subject: subject,
            email_body: body
          };
        }
        return c;
      })
    );
  };

  const handleSyncSupabase = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/seed-supabase', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        alert(`Success! ${data.message}`);
        fetchCreators();
      } else {
        alert(`Supabase Setup Notice: ${data.error}\n\nPlease run schema.sql in your Supabase SQL Editor first (https://supabase.com/dashboard/project/lhaurzgpjiteiwllhwjg/sql/new)`);
      }
    } catch (e: any) {
      alert(`Sync error: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      
      {/* Top Navbar */}
      <Navbar
        onOpenSettings={() => setIsSettingsModalOpen(true)}
        onOpenGuide={() => setIsGuideModalOpen(true)}
        onOpenBatch={() => setIsBatchModalOpen(true)}
        onSyncDb={handleSyncSupabase}
        isDbConnected={isDbConnected}
        totalCount={creators.length}
        pendingCount={creators.filter(c => c.email_status !== 'sent').length}
        batchProgress={batchProgress}
      />

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex-1 w-full">
        
        {/* Page Title & Subtitle */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight flex items-center space-x-2.5">
              <span>Creator Discovery & Outreach</span>
              <span className="p-1 rounded-lg bg-violet-100 text-violet-700">
                <Sparkles className="h-5 w-5" />
              </span>
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 mt-1 font-medium">
              Verified US consumer creators (5k–50k) with direct emails, automated AI pitches & custom-domain dispatch.
            </p>
          </div>

          <button
            onClick={fetchCreators}
            disabled={loading}
            className="self-start md:self-auto flex items-center space-x-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-xl transition-all shadow-sm disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh Data</span>
          </button>
        </div>

        {/* Metrics Header */}
        <MetricsHeader
          creators={creators}
          onFilterToday={handleFilterToday}
          onFilterNotSent={handleFilterNotSent}
          onFilterSent={handleFilterSent}
        />

        {/* Error Alert */}
        {error && (
          <div className="mb-6 p-4 rounded-xl bg-rose-50 border border-rose-200 flex items-center space-x-3 text-xs font-semibold text-rose-800">
            <AlertCircle className="h-4 w-4 text-rose-600 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Filters Bar */}
        <FiltersBar
          filters={filters}
          onFilterChange={(newFilters) => setFilters((prev) => ({ ...prev, ...newFilters }))}
          onReset={handleResetFilters}
          categories={categories}
        />

        {/* Results Counter */}
        <div className="flex items-center justify-between text-xs text-slate-500 font-semibold mb-3 px-1">
          <span>
            Showing <strong className="text-slate-800">{filteredCreators.length}</strong> of {creators.length} verified creators
          </span>
          {filters.dateFilter === 'today' && (
            <span className="text-violet-700 bg-violet-50 px-2 py-0.5 rounded-full border border-violet-200">
              Filtered to Today's Data
            </span>
          )}
        </div>

        {/* Creator Data Table */}
        {loading ? (
          <div className="bg-white rounded-xl border border-slate-200 p-16 text-center shadow-sm">
            <RefreshCw className="h-8 w-8 text-violet-600 animate-spin mx-auto mb-3" />
            <p className="text-sm font-bold text-slate-800">Loading verified creators...</p>
            <p className="text-xs text-slate-400 mt-1">Connecting to database and verifying records</p>
          </div>
        ) : (
          <CreatorTable
            creators={filteredCreators}
            onOpenPitchModal={(c) => {
              setSelectedCreatorForPitch(c);
              setIsPitchModalOpen(true);
            }}
            onOpenDetailModal={(c) => {
              setSelectedCreatorForDetail(c);
              setIsDetailModalOpen(true);
            }}
            onQuickCopyEmail={handleQuickCopyEmail}
            copiedEmail={copiedEmail}
          />
        )}

      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-slate-200 py-6 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>CreatorOutreach Platform • 292 Verified US Profiles (5k–50k Followers)</span>
          <span className="text-slate-400">Powered by Next.js, Supabase, OpenAI & Free Domain Deliverability</span>
        </div>
      </footer>

      {/* Modals */}
      <EmailModal
        creator={selectedCreatorForPitch}
        isOpen={isPitchModalOpen}
        onClose={() => {
          setIsPitchModalOpen(false);
          setSelectedCreatorForPitch(null);
        }}
        onEmailSentSuccess={handleEmailSentSuccess}
        signature={signature}
      />

      <CreatorDetailModal
        creator={selectedCreatorForDetail}
        isOpen={isDetailModalOpen}
        onClose={() => {
          setIsDetailModalOpen(false);
          setSelectedCreatorForDetail(null);
        }}
        onOpenPitch={(c) => {
          setSelectedCreatorForPitch(c);
          setIsPitchModalOpen(true);
        }}
      />

      <SignatureSettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
        signature={signature}
        onSaveSignature={handleSaveSignature}
      />

      <DeliverabilityGuideModal
        isOpen={isGuideModalOpen}
        onClose={() => setIsGuideModalOpen(false)}
      />

      <BatchOutreachModal
        isOpen={isBatchModalOpen}
        onClose={() => setIsBatchModalOpen(false)}
        onBatchComplete={() => {
          fetchCreators();
        }}
        pendingCount={creators.filter(c => c.email_status !== 'sent').length}
      />

    </div>
  );
}
