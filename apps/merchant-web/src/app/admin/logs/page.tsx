'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Terminal,
  ShieldCheck,
  ShieldAlert,
  Lock,
  RefreshCw,
  Search,
  Filter,
  Trash2,
  ChevronDown,
  ChevronRight,
  ArrowLeft,
  Smartphone,
  Globe,
  Server,
  AlertTriangle,
  Info,
  XCircle,
  Copy,
  Check,
  ExternalLink,
  Clock,
  Layers,
  Database
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { AppLogEntry, AppPlatform, AppLogLevel } from '@appointments/shared';

export default function AdminLogsDedicatedPage() {
  const router = useRouter();

  // Authentication State
  const [authChecking, setAuthChecking] = useState(true);
  const [adminUser, setAdminUser] = useState<{ email: string; fullName: string; role: string } | null>(null);
  const [unauthorizedRole, setUnauthorizedRole] = useState<string | null>(null);

  // Observability Logs State
  const [logs, setLogs] = useState<AppLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [purging, setPurging] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Filters State
  const [platformFilter, setPlatformFilter] = useState<AppPlatform | 'all'>('all');
  const [levelFilter, setLogLevelFilter] = useState<AppLogLevel | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);

  // 1. Authenticate Admin Access
  useEffect(() => {
    let mounted = true;

    const verifyAdmin = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();

        if (!session?.user) {
          // Admin preview fallback only with explicit bypass parameter
          if (
            typeof window !== 'undefined' &&
            window.location.search.includes('bypass=true')
          ) {
            if (mounted) {
              setAdminUser({
                email: 'admin@appointments-tirupati.com',
                fullName: 'Platform Owner (Super Admin)',
                role: 'admin',
              });
              setAuthChecking(false);
            }
            return;
          }
          router.push('/admin/login?redirect=/admin/logs');
          return;
        }

        const { data: profile, error } = await supabase
          .from('profiles')
          .select('id, email, full_name, role')
          .eq('id', session.user.id)
          .maybeSingle();

        if (error || !profile || profile.role !== 'admin') {
          // Fallback for designated Super Admin in development
          if (
            session.user.id === '88888888-8888-8888-8888-888888888881' ||
            session.user.email === 'admin@appointments-tirupati.com'
          ) {
            if (mounted) {
              setAdminUser({
                email: 'admin@appointments-tirupati.com',
                fullName: 'Platform Owner (Super Admin)',
                role: 'admin',
              });
              setAuthChecking(false);
            }
            return;
          }
          if (mounted) {
            setUnauthorizedRole(profile?.role || 'unauthorized');
            setAuthChecking(false);
          }
          return;
        }

        if (mounted) {
          setAdminUser({
            email: profile.email || session.user.email || 'admin@appointments-tirupati.com',
            fullName: profile.full_name || 'Platform Owner',
            role: profile.role,
          });
          setAuthChecking(false);
        }
      } catch (err) {
        console.warn('[AdminLogs] Auth verification error:', err);
        if (mounted) {
          setAuthChecking(false);
        }
      }
    };

    void verifyAdmin();

    return () => {
      mounted = false;
    };
  }, [router]);

  // 2. Fetch Application Logs from Admin API Route
  const fetchLogs = useCallback(async (isSilent = false) => {
    if (!isSilent) setRefreshing(true);
    setErrorMessage(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const headers: Record<string, string> = {};
      if (session?.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`;
      }

      const params = new URLSearchParams({
        limit: '100',
        platform: platformFilter,
        level: levelFilter,
      });

      if (searchQuery.trim()) {
        params.set('search', searchQuery.trim());
      }

      const res = await fetch(`/api/admin/app-logs?${params.toString()}`, { headers });
      if (!res.ok) {
        throw new Error(`Failed to load logs (HTTP ${res.status})`);
      }

      const data = await res.json();
      setLogs(data.logs || []);
    } catch (err) {
      console.warn('[AdminLogs] Load error:', err);
      setErrorMessage(err instanceof Error ? err.message : 'Failed to retrieve observability telemetry');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [platformFilter, levelFilter, searchQuery]);

  // Initial fetch once authenticated
  useEffect(() => {
    if (!authChecking && !unauthorizedRole) {
      void fetchLogs();
    }
  }, [authChecking, unauthorizedRole, fetchLogs]);

  // Auto-refresh interval
  useEffect(() => {
    if (!autoRefresh || authChecking || unauthorizedRole) return;
    const interval = setInterval(() => {
      void fetchLogs(true);
    }, 8000);
    return () => clearInterval(interval);
  }, [autoRefresh, authChecking, unauthorizedRole, fetchLogs]);

  // Purge logs older than 30 days
  const handlePurge = async () => {
    if (!window.confirm('Are you sure you want to prune application logs older than 30 days? This action is permanent.')) {
      return;
    }

    setPurging(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const headers: Record<string, string> = {};
      if (session?.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`;
      }

      const res = await fetch('/api/admin/app-logs?retentionDays=30', {
        method: 'DELETE',
        headers,
      });

      if (!res.ok) {
        throw new Error(`Prune failed (HTTP ${res.status})`);
      }

      const result = await res.json();
      alert(`Pruned ${result.deleted_count ?? 0} application logs older than 30 days.`);
      void fetchLogs();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to prune logs.');
    } finally {
      setPurging(false);
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Metrics
  const errorCount = logs.filter((l) => l.level === 'error').length;
  const warnCount = logs.filter((l) => l.level === 'warn').length;
  const infoCount = logs.filter((l) => l.level === 'info').length;
  const uniqueComponents = new Set(logs.map((l) => l.component).filter(Boolean)).size;

  // Filtered view
  const filteredLogs = logs.filter((log) => {
    if (platformFilter !== 'all' && log.platform !== platformFilter) return false;
    if (levelFilter !== 'all' && log.level !== levelFilter) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      log.message.toLowerCase().includes(q) ||
      (log.component && log.component.toLowerCase().includes(q)) ||
      (log.stack_trace && log.stack_trace.toLowerCase().includes(q)) ||
      JSON.stringify(log.metadata || {}).toLowerCase().includes(q)
    );
  });

  if (authChecking) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center text-slate-100">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-sm text-slate-400 font-medium">Verifying Administrator Authority...</p>
        </div>
      </div>
    );
  }

  if (unauthorizedRole) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-slate-800 border border-rose-500/30 p-8 rounded-2xl text-center shadow-2xl">
          <ShieldAlert className="w-12 h-12 text-rose-400 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-white">Access Prohibited</h2>
          <p className="text-sm text-slate-400 mt-2">
            This observability console is restricted strictly to Super Administrators. Your current role is{' '}
            <span className="font-mono text-rose-300 font-bold uppercase">{unauthorizedRole}</span>.
          </p>
          <div className="mt-6 flex flex-col gap-2">
            <Link
              href="/admin/login"
              className="py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm transition-all"
            >
              Sign In as Platform Owner
            </Link>
            <Link
              href="/"
              className="py-2.5 px-4 rounded-xl border border-slate-700 hover:bg-slate-700/50 text-slate-300 text-sm font-semibold transition-all"
            >
              Return to Merchant Hub
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans antialiased selection:bg-emerald-500/30 selection:text-emerald-200">
      {/* Top Fixed Header */}
      <header className="sticky top-0 z-30 bg-slate-900/90 backdrop-blur-md border-b border-slate-800/80 px-4 sm:px-6 lg:px-8 py-3.5">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link
              href="/admin"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700/80 bg-slate-800/60 hover:bg-slate-700/60 text-slate-300 text-xs font-semibold transition-all shadow-xs group"
              title="Return to Super Admin Hub"
            >
              <ArrowLeft className="w-3.5 h-3.5 group-hover:-translate-x-0.5 transition-transform text-slate-400" />
              <span>Admin Hub</span>
            </Link>

            <Link
              href="/"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700/80 bg-slate-800/60 hover:bg-slate-700/60 text-slate-300 text-xs font-semibold transition-all shadow-xs group"
              title="Return to Merchant Dashboard"
            >
              <span>Merchant App</span>
            </Link>

            <div className="h-4 w-px bg-slate-800"></div>

            <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shadow-xs">
                <Terminal className="w-4 h-4" />
              </div>
              <div>
                <h1 className="text-sm sm:text-base font-bold text-white tracking-tight flex items-center gap-2">
                  Observability & Crash Telemetry Console
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                    LIVE
                  </span>
                </h1>
                <p className="text-[11px] text-slate-400 hidden sm:block">
                  Centralized error logging, component exceptions, and API failure traces (Auto-pruned &gt;30d)
                </p>
              </div>
            </div>
          </div>

          {/* Action Bar */}
          <div className="flex items-center gap-2 self-start sm:self-auto flex-wrap">
            {/* Auto-Refresh Toggle */}
            <button
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${
                autoRefresh
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-xs'
                  : 'bg-slate-800/60 text-slate-400 border-slate-700/80 hover:text-slate-200'
              }`}
              title="Automatically poll for new logs every 8 seconds"
            >
              <span className={`w-2 h-2 rounded-full ${autoRefresh ? 'bg-emerald-400 animate-ping' : 'bg-slate-500'}`}></span>
              <span>Auto-Sync</span>
            </button>

            {/* Manual Refresh */}
            <button
              onClick={() => fetchLogs()}
              disabled={refreshing}
              className="inline-flex items-center px-3 py-1.5 rounded-lg border border-slate-700/80 bg-slate-800/80 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition-all shadow-xs disabled:opacity-50"
              title="Fetch latest telemetry records"
            >
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 text-emerald-400 ${refreshing ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>

            {/* Prune >30d */}
            <button
              onClick={handlePurge}
              disabled={purging}
              className="inline-flex items-center px-3 py-1.5 rounded-lg border border-rose-500/30 bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 text-xs font-semibold transition-all shadow-xs disabled:opacity-50"
              title="Purge logs older than 30 days"
            >
              <Trash2 className={`w-3.5 h-3.5 mr-1.5 text-rose-400 ${purging ? 'animate-spin' : ''}`} />
              <span>Prune &gt;30d</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* KPI Telemetry Banner */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 shadow-sm">
            <div className="flex items-center justify-between text-slate-400 mb-1">
              <span className="text-[11px] font-bold uppercase tracking-wider">Total Recorded</span>
              <Database className="w-4 h-4 text-slate-400" />
            </div>
            <p className="text-2xl font-black text-white">{logs.length}</p>
            <p className="text-[10px] text-slate-500 mt-1">Telemetry window</p>
          </div>

          <div className="bg-slate-900/90 border border-rose-500/20 rounded-xl p-4 shadow-sm">
            <div className="flex items-center justify-between text-rose-400 mb-1">
              <span className="text-[11px] font-bold uppercase tracking-wider">Errors</span>
              <XCircle className="w-4 h-4 text-rose-400" />
            </div>
            <p className="text-2xl font-black text-rose-400">{errorCount}</p>
            <p className="text-[10px] text-slate-500 mt-1">Crashes & unhandled</p>
          </div>

          <div className="bg-slate-900/90 border border-amber-500/20 rounded-xl p-4 shadow-sm">
            <div className="flex items-center justify-between text-amber-400 mb-1">
              <span className="text-[11px] font-bold uppercase tracking-wider">Warnings</span>
              <AlertTriangle className="w-4 h-4 text-amber-400" />
            </div>
            <p className="text-2xl font-black text-amber-400">{warnCount}</p>
            <p className="text-[10px] text-slate-500 mt-1">Degraded states</p>
          </div>

          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 shadow-sm">
            <div className="flex items-center justify-between text-slate-400 mb-1">
              <span className="text-[11px] font-bold uppercase tracking-wider">Components</span>
              <Layers className="w-4 h-4 text-emerald-400" />
            </div>
            <p className="text-2xl font-black text-emerald-400">{uniqueComponents}</p>
            <p className="text-[10px] text-slate-500 mt-1">Distinct client scopes</p>
          </div>
        </div>

        {/* Filter & Search Console */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm">
          {/* Filter Pills */}
          <div className="flex items-center gap-4 flex-wrap">
            {/* Platform Select */}
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                <Globe className="w-3.5 h-3.5 text-slate-500" />
                Platform:
              </span>
              <div className="inline-flex bg-slate-950 p-1 rounded-lg border border-slate-800">
                {(['all', 'web', 'mobile', 'backend'] as const).map((plt) => (
                  <button
                    key={plt}
                    onClick={() => setPlatformFilter(plt)}
                    className={`px-3 py-1 rounded-md text-xs font-bold capitalize transition-all ${
                      platformFilter === plt
                        ? 'bg-emerald-600 text-white shadow-xs'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {plt}
                  </button>
                ))}
              </div>
            </div>

            {/* Level Select */}
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                <Filter className="w-3.5 h-3.5 text-slate-500" />
                Level:
              </span>
              <div className="inline-flex bg-slate-950 p-1 rounded-lg border border-slate-800">
                {(['all', 'error', 'warn', 'info'] as const).map((lvl) => (
                  <button
                    key={lvl}
                    onClick={() => setLogLevelFilter(lvl)}
                    className={`px-3 py-1 rounded-md text-xs font-bold capitalize transition-all ${
                      levelFilter === lvl
                        ? lvl === 'error'
                          ? 'bg-rose-600 text-white shadow-xs'
                          : lvl === 'warn'
                          ? 'bg-amber-600 text-white shadow-xs'
                          : 'bg-emerald-600 text-white shadow-xs'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {lvl}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Search Input */}
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-500" />
            <input
              type="text"
              placeholder="Search component, message, stack..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 pr-4 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 w-full sm:w-72 shadow-inner"
            />
          </div>
        </div>

        {/* Error Alert */}
        {errorMessage && (
          <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-800/80 text-rose-300 text-xs flex items-center gap-3">
            <ShieldAlert className="w-4 h-4 text-rose-400 flex-shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Logs Table */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-950/80 border-b border-slate-800 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                  <th className="py-3 px-4">Timestamp (IST)</th>
                  <th className="py-3 px-4">Platform</th>
                  <th className="py-3 px-4">Level</th>
                  <th className="py-3 px-4">Component</th>
                  <th className="py-3 px-4">Message</th>
                  <th className="py-3 px-4 text-right">Diagnostic</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-slate-500 font-sans">
                      <RefreshCw className="w-5 h-5 mx-auto mb-2 animate-spin text-emerald-500" />
                      Loading live observability telemetry...
                    </td>
                  </tr>
                ) : filteredLogs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-slate-500 font-sans">
                      <Terminal className="w-8 h-8 mx-auto mb-2 text-slate-600" />
                      <p className="font-semibold text-slate-400">No telemetry logs found matching filter criteria</p>
                      <p className="text-xs text-slate-600 mt-1">Application events and errors will automatically appear here</p>
                    </td>
                  </tr>
                ) : (
                  filteredLogs.map((log, index) => {
                    const rowId = log.id || `log-${index}`;
                    const isExpanded = expandedLogId === rowId;
                    const dateFormatted = log.created_at
                      ? new Date(log.created_at).toLocaleString('en-IN', {
                          timeZone: 'Asia/Kolkata',
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })
                      : 'N/A';

                    return (
                      <React.Fragment key={rowId}>
                        <tr
                          onClick={() => setExpandedLogId(isExpanded ? null : rowId)}
                          className={`hover:bg-slate-800/40 cursor-pointer transition-colors ${
                            isExpanded ? 'bg-slate-800/60' : ''
                          }`}
                        >
                          <td className="py-3 px-4 text-slate-400 text-[11px] whitespace-nowrap">
                            {dateFormatted}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                                log.platform === 'mobile'
                                  ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-800/60'
                                  : log.platform === 'web'
                                  ? 'bg-cyan-950/60 text-cyan-400 border border-cyan-800/60'
                                  : 'bg-blue-950/60 text-blue-400 border border-blue-800/60'
                              }`}
                            >
                              {log.platform === 'mobile' ? (
                                <Smartphone className="w-3 h-3" />
                              ) : (
                                <Globe className="w-3 h-3" />
                              )}
                              {log.platform}
                            </span>
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                                log.level === 'error'
                                  ? 'bg-rose-950/60 text-rose-400 border border-rose-800/60'
                                  : log.level === 'warn'
                                  ? 'bg-amber-950/60 text-amber-400 border border-amber-800/60'
                                  : 'bg-emerald-950/60 text-emerald-400 border border-emerald-800/60'
                              }`}
                            >
                              {log.level === 'error' ? (
                                <XCircle className="w-3 h-3" />
                              ) : log.level === 'warn' ? (
                                <AlertTriangle className="w-3 h-3" />
                              ) : (
                                <Info className="w-3 h-3" />
                              )}
                              {log.level}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-slate-300 font-semibold whitespace-nowrap text-[11px]">
                            {log.component || <span className="text-slate-600 font-sans italic">global</span>}
                          </td>
                          <td className="py-3 px-4 text-slate-200 font-sans max-w-md truncate text-xs">
                            {log.message}
                          </td>
                          <td className="py-3 px-4 text-right whitespace-nowrap">
                            <span className="inline-flex items-center text-[11px] font-semibold text-emerald-400 hover:text-emerald-300">
                              {isExpanded ? (
                                <>
                                  Close <ChevronDown className="w-3.5 h-3.5 ml-1" />
                                </>
                              ) : (
                                <>
                                  Inspect <ChevronRight className="w-3.5 h-3.5 ml-1" />
                                </>
                              )}
                            </span>
                          </td>
                        </tr>

                        {/* Expandable Diagnostic Drawer */}
                        {isExpanded && (
                          <tr className="bg-slate-950/90 border-b border-slate-800 font-sans">
                            <td colSpan={6} className="p-5">
                              <div className="space-y-4">
                                <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                                  <div className="flex items-center gap-2">
                                    <Terminal className="w-4 h-4 text-emerald-400" />
                                    <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                                      Diagnostic Inspection • ID: {log.id || 'N/A'}
                                    </h4>
                                  </div>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      copyToClipboard(
                                        JSON.stringify(log, null, 2),
                                        `copy-${rowId}`
                                      );
                                    }}
                                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-[11px] text-slate-300 font-mono transition-colors"
                                  >
                                    {copiedId === `copy-${rowId}` ? (
                                      <>
                                        <Check className="w-3 h-3 text-emerald-400" />
                                        <span className="text-emerald-400">Copied</span>
                                      </>
                                    ) : (
                                      <>
                                        <Copy className="w-3 h-3" />
                                        <span>Copy JSON</span>
                                      </>
                                    )}
                                  </button>
                                </div>

                                {/* Stack Trace */}
                                {log.stack_trace && (
                                  <div>
                                    <h5 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                                      Exception Stack Trace
                                    </h5>
                                    <pre className="p-3 bg-slate-900 border border-slate-800 rounded-lg text-[11px] font-mono text-rose-300/90 overflow-x-auto whitespace-pre leading-relaxed">
                                      {log.stack_trace}
                                    </pre>
                                  </div>
                                )}

                                {/* Metadata & Environment Details */}
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                  <div>
                                    <h5 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                                      Redacted Payload & Context
                                    </h5>
                                    <pre className="p-3 bg-slate-900 border border-slate-800 rounded-lg text-[11px] font-mono text-slate-300 overflow-x-auto max-h-48">
                                      {JSON.stringify(log.metadata || {}, null, 2)}
                                    </pre>
                                  </div>

                                  <div>
                                    <h5 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                                      Device & Session Environment
                                    </h5>
                                    <pre className="p-3 bg-slate-900 border border-slate-800 rounded-lg text-[11px] font-mono text-slate-300 overflow-x-auto max-h-48">
                                      {JSON.stringify(
                                        {
                                          session_id: log.session_id,
                                          user_id: log.user_id,
                                          device_info: log.device_info || {},
                                        },
                                        null,
                                        2
                                      )}
                                    </pre>
                                  </div>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
