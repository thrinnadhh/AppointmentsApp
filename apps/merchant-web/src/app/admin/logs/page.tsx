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
  Database,
  Flame,
  Send,
  Zap,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type {
  AppLogEntry,
  AppPlatform,
  AppLogLevel,
  AppSeverity,
  AppLogCategory,
  AppLogSource,
} from '@appointments/shared';

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
  const [testingAlert, setTestingAlert] = useState(false);
  const [testAlertFeedback, setTestAlertFeedback] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Filters State
  const [severityFilter, setSeverityFilter] = useState<AppSeverity | 'all'>('all');
  const [categoryFilter, setCategoryFilter] = useState<AppLogCategory | 'all'>('all');
  const [sourceFilter, setSourceFilter] = useState<AppLogSource | 'all'>('all');
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | '24h' | '7d' | '30d'>('all');
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
          if (process.env.NODE_ENV === 'development') {
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
        limit: '150',
        severity: severityFilter,
        category: categoryFilter,
        source: sourceFilter,
        dateRange: dateFilter,
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
  }, [severityFilter, categoryFilter, sourceFilter, dateFilter, searchQuery]);

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

  // Trigger test CRITICAL alert
  const handleTriggerTestAlert = async () => {
    try {
      setTestingAlert(true);
      setTestAlertFeedback('Emitting test CRITICAL exception...');
      const { data: { session } } = await supabase.auth.getSession();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (session?.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`;
      }

      const res = await fetch('/api/admin/app-logs/test-alert', {
        method: 'POST',
        headers,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to trigger test alert');
      }

      const data = await res.json();
      setTestAlertFeedback(`✓ Dispatched CRITICAL alert! Fingerprint: ${data.fingerprint}`);
      await fetchLogs();
      setTimeout(() => setTestAlertFeedback(null), 5000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Alert failed';
      setTestAlertFeedback(`⚠️ ${msg}`);
      setTimeout(() => setTestAlertFeedback(null), 5000);
    } finally {
      setTestingAlert(false);
    }
  };

  // Purge logs older than retention period
  const handlePurge = async () => {
    if (!window.confirm('Are you sure you want to run the automated tiered log retention purge (DEBUG/INFO >30d, WARN >60d, ERROR/CRITICAL >180d)?')) {
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
      alert(`Pruned ${result.deleted_count ?? 0} application logs matching retention expiration criteria.`);
      void fetchLogs();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to prune logs.');
    } finally {
      setPurging(false);
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    if (typeof navigator !== 'undefined') {
      void navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    }
  };

  // KPI Metrics
  const criticalCount = logs.filter((l) => (l.severity || '').toUpperCase() === 'CRITICAL').length;
  const errorCount = logs.filter((l) => (l.severity || '').toUpperCase() === 'ERROR').length;
  const warnCount = logs.filter((l) => (l.severity || '').toUpperCase() === 'WARN').length;
  const uniqueFingerprints = new Set(logs.map((l) => l.fingerprint).filter(Boolean)).size;

  if (authChecking) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center text-white space-y-4">
        <div className="w-10 h-10 border-3 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
        <p className="text-sm font-bold text-slate-300">Authorizing Super Administrator Observability Radar...</p>
      </div>
    );
  }

  if (unauthorizedRole) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-slate-800 border border-rose-800/60 p-8 rounded-2xl shadow-2xl text-center">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-center text-rose-400 mb-4">
            <Lock className="w-8 h-8" />
          </div>
          <h2 className="text-xl font-bold text-white mb-2">403 Restricted Console</h2>
          <p className="text-xs text-slate-400 mb-6 leading-relaxed">
            Application logs and crash telemetry contain confidential system execution metrics and are restricted strictly to platform administrators.
          </p>
          <button
            onClick={() => router.push('/admin/login?redirect=/admin/logs')}
            className="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs transition-colors shadow-sm"
          >
            Authenticate as Super Admin
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-emerald-500 selection:text-white pb-12">
      {/* Top Banner Navigation */}
      <header className="sticky top-0 z-40 bg-slate-900/95 backdrop-blur-md border-b border-slate-800 shadow-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link
              href="/admin"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700/80 bg-slate-800/60 hover:bg-slate-700/60 text-slate-300 text-xs font-semibold transition-all shadow-xs group"
              title="Return to Super Admin Hub"
            >
              <ArrowLeft className="w-3.5 h-3.5 group-hover:-translate-x-0.5 transition-transform" />
              <span>Admin Hub</span>
            </Link>

            <div className="h-4 w-px bg-slate-800"></div>

            <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shadow-xs">
                <Terminal className="w-4 h-4" />
              </div>
              <div>
                <h1 className="text-sm sm:text-base font-bold text-white tracking-tight flex items-center gap-2">
                  Observability & Crash Alert Console
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                    LIVE
                  </span>
                </h1>
                <p className="text-[11px] text-slate-400 hidden sm:block">
                  Classified severity, categories, deduplicated fingerprints, and automated crash alerting
                </p>
              </div>
            </div>
          </div>

          {/* Action Bar */}
          <div className="flex items-center gap-2 self-start sm:self-auto flex-wrap">
            {/* Test CRITICAL Alert */}
            <button
              onClick={handleTriggerTestAlert}
              disabled={testingAlert}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all border border-rose-500/40 bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 disabled:opacity-50"
              title="Emit a test CRITICAL error to verify database ingestion and edge alert dispatch"
            >
              <Zap className={`w-3.5 h-3.5 text-rose-400 ${testingAlert ? 'animate-bounce' : ''}`} />
              <span>{testingAlert ? 'Emitting...' : 'Test CRITICAL Alert'}</span>
            </button>

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

            {/* Tiered Prune */}
            <button
              onClick={handlePurge}
              disabled={purging}
              className="inline-flex items-center px-3 py-1.5 rounded-lg border border-slate-700/80 bg-slate-800/60 hover:bg-slate-700/60 text-slate-300 text-xs font-semibold transition-all shadow-xs disabled:opacity-50"
              title="Purge expired logs per retention tier"
            >
              <Trash2 className={`w-3.5 h-3.5 mr-1.5 text-slate-400 ${purging ? 'animate-spin' : ''}`} />
              <span>Prune Expired</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Test Alert Feedback Banner */}
        {testAlertFeedback && (
          <div className="p-3 rounded-xl bg-slate-900 border border-emerald-500/40 text-emerald-300 text-xs flex items-center justify-between animate-fade-in">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-emerald-400" />
              <span>{testAlertFeedback}</span>
            </div>
            <button
              onClick={() => setTestAlertFeedback(null)}
              className="text-slate-400 hover:text-white"
            >
              ✕
            </button>
          </div>
        )}

        {/* KPI Telemetry Banner */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 shadow-sm">
            <div className="flex items-center justify-between text-slate-400 mb-1">
              <span className="text-[11px] font-bold uppercase tracking-wider">Total Logs</span>
              <Database className="w-4 h-4 text-slate-400" />
            </div>
            <p className="text-2xl font-black text-white">{logs.length}</p>
            <p className="text-[10px] text-slate-500 mt-1">Telemetry window</p>
          </div>

          <div className="bg-slate-900/90 border border-rose-500/30 rounded-xl p-4 shadow-sm">
            <div className="flex items-center justify-between text-rose-400 mb-1">
              <span className="text-[11px] font-bold uppercase tracking-wider">Critical Events</span>
              <Flame className="w-4 h-4 text-rose-400" />
            </div>
            <p className="text-2xl font-black text-rose-400">{criticalCount}</p>
            <p className="text-[10px] text-slate-500 mt-1">Alerted immediately</p>
          </div>

          <div className="bg-slate-900/90 border border-amber-500/20 rounded-xl p-4 shadow-sm">
            <div className="flex items-center justify-between text-amber-400 mb-1">
              <span className="text-[11px] font-bold uppercase tracking-wider">Errors & Warnings</span>
              <AlertTriangle className="w-4 h-4 text-amber-400" />
            </div>
            <p className="text-2xl font-black text-amber-400">{errorCount + warnCount}</p>
            <p className="text-[10px] text-slate-500 mt-1">Digest queue ({errorCount} errors, {warnCount} warns)</p>
          </div>

          <div className="bg-slate-900/90 border border-emerald-500/20 rounded-xl p-4 shadow-sm">
            <div className="flex items-center justify-between text-slate-400 mb-1">
              <span className="text-[11px] font-bold uppercase tracking-wider">Distinct Fingerprints</span>
              <Layers className="w-4 h-4 text-emerald-400" />
            </div>
            <p className="text-2xl font-black text-emerald-400">{uniqueFingerprints}</p>
            <p className="text-[10px] text-slate-500 mt-1">Deduped crash signatures</p>
          </div>
        </div>

        {/* Filter & Search Console */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 space-y-4 shadow-sm">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
            {/* Severity Select */}
            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                Severity:
              </label>
              <select
                value={severityFilter}
                onChange={(e) => setSeverityFilter(e.target.value as any)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
              >
                <option value="all">All Severities</option>
                <option value="CRITICAL">🚨 CRITICAL (App Crash / Security / Payment)</option>
                <option value="ERROR">❌ ERROR</option>
                <option value="WARN">⚠️ WARN</option>
                <option value="INFO">ℹ️ INFO</option>
                <option value="DEBUG">🔍 DEBUG</option>
              </select>
            </div>

            {/* Category Select */}
            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                Category:
              </label>
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value as any)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
              >
                <option value="all">All Categories</option>
                <option value="UI_CRASH">UI_CRASH (React Native / Web Crashes)</option>
                <option value="PAYMENT">PAYMENT (Gateway / Refunds)</option>
                <option value="BOOKING">BOOKING (Hold / Confirmation / Collisions)</option>
                <option value="AUTH">AUTH (OTP / Tokens / Sessions)</option>
                <option value="SECURITY">SECURITY (RLS / Tenant Isolation)</option>
                <option value="HOSPITAL_QUEUE">HOSPITAL_QUEUE (OP / Bed / Triage)</option>
                <option value="NOTIFICATION">NOTIFICATION (WhatsApp / SMS / Push)</option>
                <option value="DATABASE">DATABASE (PostgreSQL / Constraints)</option>
                <option value="NETWORK">NETWORK (API / Latency)</option>
                <option value="OTHER">OTHER</option>
              </select>
            </div>

            {/* Source Select */}
            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                Source:
              </label>
              <select
                value={sourceFilter}
                onChange={(e) => setSourceFilter(e.target.value as any)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
              >
                <option value="all">All Sources</option>
                <option value="customer-mobile">customer-mobile (Expo / React Native)</option>
                <option value="merchant-web">merchant-web (Next.js)</option>
                <option value="admin-web">admin-web (Control Center)</option>
                <option value="edge-function">edge-function (Deno)</option>
                <option value="database">database (Postgres Triggers)</option>
              </select>
            </div>

            {/* Date Range Select */}
            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                Time Window:
              </label>
              <select
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value as any)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
              >
                <option value="all">All Time (Up to 180 Days)</option>
                <option value="today">Today (Since Midnight IST)</option>
                <option value="24h">Past 24 Hours</option>
                <option value="7d">Past 7 Days</option>
                <option value="30d">Past 30 Days</option>
              </select>
            </div>
          </div>

          {/* Search Input */}
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-500" />
            <input
              type="text"
              placeholder="Search by message, component, fingerprint hash, or error code..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 pr-4 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 w-full shadow-inner"
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
                  <th className="py-3 px-4">Severity</th>
                  <th className="py-3 px-4">Category</th>
                  <th className="py-3 px-4">Source</th>
                  <th className="py-3 px-4">Message</th>
                  <th className="py-3 px-4 text-center">Duplicates</th>
                  <th className="py-3 px-4 text-right">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-slate-500 font-sans">
                      <RefreshCw className="w-5 h-5 mx-auto mb-2 animate-spin text-emerald-500" />
                      Loading live observability telemetry...
                    </td>
                  </tr>
                ) : logs.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-slate-500 font-sans">
                      <Terminal className="w-8 h-8 mx-auto mb-2 text-slate-600" />
                      <p className="font-semibold text-slate-400">No telemetry logs found matching filter criteria</p>
                      <p className="text-xs text-slate-600 mt-1">Application events and errors will automatically appear here</p>
                    </td>
                  </tr>
                ) : (
                  logs.map((log, index) => {
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

                    const severityUpper = (log.severity || log.level || 'INFO').toUpperCase();
                    const categoryUpper = (log.category || 'OTHER').toUpperCase();
                    const sourceText = log.source || (log.platform === 'mobile' ? 'customer-mobile' : 'merchant-web');

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

                          {/* Severity Badge */}
                          <td className="py-3 px-4 whitespace-nowrap">
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                                severityUpper === 'CRITICAL'
                                  ? 'bg-rose-950/80 text-rose-300 border border-rose-500/80 shadow-xs animate-pulse'
                                  : severityUpper === 'ERROR'
                                  ? 'bg-rose-950/50 text-rose-400 border border-rose-800/60'
                                  : severityUpper === 'WARN'
                                  ? 'bg-amber-950/50 text-amber-400 border border-amber-800/60'
                                  : 'bg-emerald-950/50 text-emerald-400 border border-emerald-800/60'
                              }`}
                            >
                              {severityUpper === 'CRITICAL' ? (
                                <Flame className="w-3 h-3 text-rose-400" />
                              ) : severityUpper === 'ERROR' ? (
                                <XCircle className="w-3 h-3" />
                              ) : severityUpper === 'WARN' ? (
                                <AlertTriangle className="w-3 h-3" />
                              ) : (
                                <Info className="w-3 h-3" />
                              )}
                              {severityUpper}
                            </span>
                          </td>

                          {/* Category Badge */}
                          <td className="py-3 px-4 whitespace-nowrap">
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-800 text-slate-300 border border-slate-700">
                              {categoryUpper}
                            </span>
                          </td>

                          {/* Source Badge */}
                          <td className="py-3 px-4 whitespace-nowrap">
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium text-slate-400 bg-slate-900 border border-slate-800">
                              {sourceText.includes('mobile') ? (
                                <Smartphone className="w-3 h-3 text-emerald-400" />
                              ) : (
                                <Globe className="w-3 h-3 text-cyan-400" />
                              )}
                              {sourceText}
                            </span>
                          </td>

                          {/* Message */}
                          <td className="py-3 px-4 max-w-xs sm:max-w-md truncate text-slate-200">
                            <span className="font-semibold text-slate-300 mr-2">[{log.component || 'App'}]</span>
                            <span>{log.message}</span>
                          </td>

                          {/* Deduplication Count Badge */}
                          <td className="py-3 px-4 text-center whitespace-nowrap">
                            {(log.duplicate_count || 1) > 1 ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40">
                                x{log.duplicate_count}
                              </span>
                            ) : (
                              <span className="text-[10px] text-slate-600 font-mono">1x</span>
                            )}
                          </td>

                          {/* Expand Icon */}
                          <td className="py-3 px-4 text-right whitespace-nowrap">
                            <button className="text-slate-500 hover:text-slate-300 p-1">
                              {isExpanded ? (
                                <ChevronDown className="w-4 h-4 text-emerald-400" />
                              ) : (
                                <ChevronRight className="w-4 h-4" />
                              )}
                            </button>
                          </td>
                        </tr>

                        {/* Expandable Diagnostic Drawer */}
                        {isExpanded && (
                          <tr className="bg-slate-950/90 border-b border-slate-800 font-sans">
                            <td colSpan={7} className="p-5">
                              <div className="space-y-4">
                                <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                                  <div className="flex items-center gap-2">
                                    <Terminal className="w-4 h-4 text-emerald-400" />
                                    <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                                      Diagnostic Inspection • ID: {log.id || 'N/A'}
                                    </h4>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    {log.fingerprint && (
                                      <span className="text-[10px] font-mono bg-slate-900 border border-slate-700 px-2 py-0.5 rounded text-slate-400">
                                        Fingerprint: <strong className="text-emerald-400">{log.fingerprint}</strong>
                                      </span>
                                    )}
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

                                {/* Context Grid */}
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                  <div className="bg-slate-900/60 p-3 rounded-lg border border-slate-800">
                                    <h5 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                                      Business Context
                                    </h5>
                                    <p className="text-xs text-slate-300">Role: <strong className="text-white">{log.role || 'N/A'}</strong></p>
                                    <p className="text-xs text-slate-300">City ID: <strong className="text-white">{log.city_id || 'N/A'}</strong></p>
                                    <p className="text-xs text-slate-300">Vertical: <strong className="text-white">{log.vertical || 'N/A'}</strong></p>
                                    <p className="text-xs text-slate-300">Appointment ID: <strong className="text-white">{log.appointment_id || 'N/A'}</strong></p>
                                  </div>

                                  <div className="bg-slate-900/60 p-3 rounded-lg border border-slate-800">
                                    <h5 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                                      Environment & Build
                                    </h5>
                                    <p className="text-xs text-slate-300">App Version: <strong className="text-white">{log.app_version || '1.0.0'}</strong></p>
                                    <p className="text-xs text-slate-300">Platform OS: <strong className="text-white">{log.platform_os || 'N/A'}</strong></p>
                                    <p className="text-xs text-slate-300">Device Model: <strong className="text-white">{log.device_model || 'N/A'}</strong></p>
                                    <p className="text-xs text-slate-300">Environment: <strong className="text-emerald-400">{log.environment || 'dev'}</strong></p>
                                  </div>

                                  <div className="bg-slate-900/60 p-3 rounded-lg border border-slate-800">
                                    <h5 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                                      Session & Identity
                                    </h5>
                                    <p className="text-xs text-slate-300 font-mono">User ID: {log.user_id || 'anonymous'}</p>
                                    <p className="text-xs text-slate-300 font-mono truncate">Session ID: {log.session_id || 'none'}</p>
                                    <p className="text-xs text-slate-300 font-mono">Error Code: {log.error_code || 'NONE'}</p>
                                  </div>
                                </div>

                                {/* Sanitized Metadata */}
                                {log.metadata && Object.keys(log.metadata).length > 0 && (
                                  <div>
                                    <h5 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                                      Sanitized Metadata Payload (PII Redacted)
                                    </h5>
                                    <pre className="p-3 bg-slate-900 border border-slate-800 rounded-lg text-[11px] font-mono text-slate-300 overflow-x-auto max-h-48">
                                      {JSON.stringify(log.metadata, null, 2)}
                                    </pre>
                                  </div>
                                )}
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
