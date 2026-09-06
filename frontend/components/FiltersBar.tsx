'use client';

import React from 'react';
import { Search, Calendar, Filter, ArrowUpDown, CheckCircle2, Clock3, RotateCcw } from 'lucide-react';
import { FilterState } from '@/lib/types';

interface FiltersBarProps {
  filters: FilterState;
  onFilterChange: (newFilters: Partial<FilterState>) => void;
  onReset: () => void;
  categories: string[];
}

export default function FiltersBar({
  filters,
  onFilterChange,
  onReset,
  categories
}: FiltersBarProps) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm mb-6 space-y-4">
      
      {/* Top Row: Search and Status Tabs */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        
        {/* Search input */}
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={filters.search}
            onChange={(e) => onFilterChange({ search: e.target.value })}
            placeholder="Search username, name, bio keyword, email..."
            className="w-full pl-10 pr-4 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500 focus:bg-white text-slate-900 placeholder:text-slate-400 transition-all"
          />
        </div>

        {/* Email Status Filter Tabs */}
        <div className="flex items-center space-x-1 p-1 bg-slate-100 rounded-lg border border-slate-200/80">
          <button
            onClick={() => onFilterChange({ emailStatus: 'all' })}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
              filters.emailStatus === 'all'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            All Statuses
          </button>
          <button
            onClick={() => onFilterChange({ emailStatus: 'not_sent' })}
            className={`flex items-center space-x-1 px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
              filters.emailStatus === 'not_sent'
                ? 'bg-amber-500 text-white shadow-sm'
                : 'text-amber-700 hover:bg-amber-100/50'
            }`}
          >
            <Clock3 className="h-3.5 w-3.5" />
            <span>Not Sent (Pending)</span>
          </button>
          <button
            onClick={() => onFilterChange({ emailStatus: 'sent' })}
            className={`flex items-center space-x-1 px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
              filters.emailStatus === 'sent'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-emerald-700 hover:bg-emerald-100/50'
            }`}
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span>Mail Sent</span>
          </button>
        </div>

      </div>

      {/* Bottom Row: Date Filter, Category Filter, Sort Filter, and Reset */}
      <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-slate-100">
        
        {/* Date / Time Filter */}
        <div className="flex items-center space-x-2">
          <Calendar className="h-4 w-4 text-slate-500" />
          <span className="text-xs font-medium text-slate-600">Date:</span>
          <select
            value={filters.dateFilter}
            onChange={(e) => onFilterChange({ dateFilter: e.target.value as any })}
            className="text-xs font-semibold bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-700 focus:outline-none focus:ring-2 focus:ring-violet-500"
          >
            <option value="all">All Dates</option>
            <option value="today">Today's Data Only</option>
            <option value="last_7_days">Last 7 Days</option>
            <option value="last_30_days">Last 30 Days</option>
          </select>
        </div>

        {/* Category Filter */}
        <div className="flex items-center space-x-2">
          <Filter className="h-4 w-4 text-slate-500" />
          <span className="text-xs font-medium text-slate-600">Category:</span>
          <select
            value={filters.category}
            onChange={(e) => onFilterChange({ category: e.target.value })}
            className="text-xs font-semibold bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-700 focus:outline-none focus:ring-2 focus:ring-violet-500"
          >
            <option value="All">All Categories</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
        </div>

        {/* Sort By */}
        <div className="flex items-center space-x-2">
          <ArrowUpDown className="h-4 w-4 text-slate-500" />
          <span className="text-xs font-medium text-slate-600">Sort:</span>
          <select
            value={filters.sortBy}
            onChange={(e) => onFilterChange({ sortBy: e.target.value as any })}
            className="text-xs font-semibold bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-700 focus:outline-none focus:ring-2 focus:ring-violet-500"
          >
            <option value="followers_desc">Followers: High to Low</option>
            <option value="followers_asc">Followers: Low to High</option>
            <option value="created_newest">Newest Scraped First</option>
            <option value="last_emailed">Recently Emailed</option>
          </select>
        </div>

        {/* Reset button */}
        <button
          onClick={onReset}
          className="ml-auto flex items-center space-x-1 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
        >
          <RotateCcw className="h-3 w-3" />
          <span>Reset Filters</span>
        </button>

      </div>

    </div>
  );
}
