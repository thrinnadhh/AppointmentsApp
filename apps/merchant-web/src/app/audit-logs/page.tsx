'use client';

import React, { useState, useEffect, useCallback, Suspense, useMemo } from 'react';
import Link from 'next/link';
import { 
  ShieldCheck, 
  Search, 
  RefreshCw, 
  AlertCircle, 
  Filter, 
  Clock, 
  User, 
  FileText, 
  ChevronDown, 
  ChevronUp, 
  AlertTriangle,
  Building2,
  Users,
  Calendar,
  CheckCircle2,
  ExternalLink
} from 'lucide-react';
import { useMerchantTenant } from '@/contexts/MerchantTenantContext';

interface AuditLogEntry {
  id: string;
  merchant_id?: string;
  actor_id?: string;
  action: string;
  target?: string;
  metadata?: Record<string, any>;
  ip_address?: string;
  created_at: string;
}

function AuditLogsContent() {
  const { activeProvider, isSuperAdmin, isHospitalAdmin } = useMerchantTenant();

  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [expandedLogIds, setExpandedLogIds] = useState<Set<string>>(new Set());

  const fetchAuditLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/hospital/audit-logs');
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Failed to load audit logs');
      }
      setLogs(json.logs || []);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error fetching audit logs';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAuditLogs();
  }, [fetchAuditLogs]);

  const toggleExpand = (id: string) => {
    setExpandedLogIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const getActionCategory = (action: string): string => {
    if (action.startsWith('department.') || action.startsWith('member.')) return 'GOVERNANCE';
    if (action.startsWith('emergency.')) return 'EMERGENCY';
    if (action.startsWith('override.')) return 'OVERRIDE';
    if (action.startsWith('consultation.') || action.startsWith('queue.')) return 'CONSULTATION';
    if (action.startsWith('doctor.')) return 'ASSIGNMENT';
    return 'OTHER';
  };

  const getActionBadge = (action: string) => {
    if (action.includes('emergency') || action.includes('revoke') || action.includes('delete')) {
      return 'bg-rose-50 text-rose-800 border-rose-200';
    }
    if (action.includes('override') || action.includes('noshow') || action.includes('cancel')) {
      return 'bg-amber-50 text-amber-800 border-amber-200';
    }
    if (action.includes('create') || action.includes('accept') || action.includes('complete')) {
      return 'bg-emerald-50 text-emerald-800 border-emerald-200';
    }
    return 'bg-slate-100 text-slate-800 border-slate-200';
  };

  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      const cat = getActionCategory(log.action);
      if (categoryFilter !== 'ALL' && cat !== categoryFilter) {
        return false;
      }

      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      const actionMatch = log.action.toLowerCase().includes(q);
      const actorMatch = (log.actor_id || '').toLowerCase().includes(q);
      const targetMatch = (log.target || '').toLowerCase().includes(q);
      const metaMatch = log.metadata ? JSON.stringify(log.metadata).toLowerCase().includes(q) : false;

      return actionMatch || actorMatch || targetMatch || metaMatch;
    });
  }, [logs, categoryFilter, searchQuery]);

  // Statistics
  const emergencyCount = useMemo(() => logs.filter((l) => l.action.startsWith('emergency.')).length, [logs]);
  const overrideCount = useMemo(() => logs.filter((l) => l.action.startsWith('override.')).length, [logs]);
  const governanceCount = useMemo(() => logs.filter((l) => l.action.startsWith('department.') || l.action.startsWith('member.')).length, [logs]);

  // Access control check
  if (!isHospitalAdmin && !isSuperAdmin) {
    return (
      <div className="max-w-xl mx-auto my-16 p-8 bg-white border border-slate-200 rounded-2xl text-center shadow-sm">
        <div className="w-16 h-16 bg-rose-50 text-rose-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <ShieldCheck className="w-8 h-8" />
        </div>
        <h2 className="text-2xl font-bold text-slate-900 mb-2">Hospital Admin Access Only</h2>
        <p className="text-slate-600 mb-6">
          Security audit trails and compliance inspection are restricted to Hospital Administrators.
        </p>
        <Link
          href="/"
          className="inline-flex items-center gap-2 px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl transition shadow-sm"
        >
          Return to Dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-slate-200 pb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200">
              Security & Compliance
            </span>
            <span className="text-xs text-slate-500">• Hospital Admin Master Console</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
            Hospital Audit Trail & Compliance Logs
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Append-only record of administrative governance, emergency cancellations, doctor assignments, and department member invitations.
          </p>
        </div>

        <button
          onClick={fetchAuditLogs}
          className="inline-flex items-center px-3.5 py-2 border border-slate-300 rounded-xl text-sm font-medium text-slate-700 bg-white hover:bg-slate-50 transition-colors shadow-xs cursor-pointer self-start md:self-auto"
          title="Refresh Logs"
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin text-emerald-600' : ''}`} />
          Refresh
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-5">
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Events</span>
            <FileText className="w-5 h-5 text-emerald-600" />
          </div>
          <p className="text-2xl font-bold text-slate-900 mt-2 font-mono">{logs.length}</p>
          <p className="text-xs text-slate-500 mt-1">Immutable log entries</p>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Governance Actions</span>
            <Building2 className="w-5 h-5 text-teal-600" />
          </div>
          <p className="text-2xl font-bold text-slate-900 mt-2 font-mono">{governanceCount}</p>
          <p className="text-xs text-slate-500 mt-1">Departments & members</p>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Emergency Events</span>
            <AlertTriangle className="w-5 h-5 text-rose-600" />
          </div>
          <p className="text-2xl font-bold text-slate-900 mt-2 font-mono">{emergencyCount}</p>
          <p className="text-xs text-slate-500 mt-1">Standby & cancellations</p>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Capacity Overrides</span>
            <ShieldCheck className="w-5 h-5 text-amber-600" />
          </div>
          <p className="text-2xl font-bold text-slate-900 mt-2 font-mono">{overrideCount}</p>
          <p className="text-xs text-slate-500 mt-1">Doctor bypass decisions</p>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
          <input
            id="audit-search"
            type="text"
            placeholder="Search action, actor, target ID, or metadata..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-slate-50/50"
          />
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          {[
            { id: 'ALL', label: 'All Events' },
            { id: 'GOVERNANCE', label: 'Governance' },
            { id: 'EMERGENCY', label: 'Emergency' },
            { id: 'OVERRIDE', label: 'Overrides' },
            { id: 'CONSULTATION', label: 'Consultations' },
            { id: 'ASSIGNMENT', label: 'Assignments' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setCategoryFilter(tab.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                categoryFilter === tab.id
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'text-slate-600 hover:bg-slate-100 bg-slate-50 border border-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="rounded-xl bg-rose-50 border border-rose-200 p-4 flex items-start gap-2.5 text-sm text-rose-800">
          <AlertCircle className="w-5 h-5 text-rose-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Unable to load audit trail</p>
            <p className="text-xs text-rose-700 mt-0.5">{error}</p>
          </div>
        </div>
      )}

      {/* Logs Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">
              <tr>
                <th className="px-6 py-3.5">Timestamp</th>
                <th className="px-6 py-3.5">Action Event</th>
                <th className="px-6 py-3.5">Actor (User ID)</th>
                <th className="px-6 py-3.5">Target</th>
                <th className="px-6 py-3.5 text-right">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-slate-500">
                    <div className="inline-flex items-center gap-2">
                      <RefreshCw className="w-5 h-5 animate-spin text-emerald-600" />
                      Loading audit logs...
                    </div>
                  </td>
                </tr>
              ) : filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-slate-500">
                    No audit records match your filters.
                  </td>
                </tr>
              ) : (
                filteredLogs.map((log) => {
                  const isExpanded = expandedLogIds.has(log.id);
                  const badgeClass = getActionBadge(log.action);

                  return (
                    <React.Fragment key={log.id}>
                      <tr className="hover:bg-slate-50/80 transition-colors">
                        <td className="px-6 py-4 whitespace-nowrap text-xs text-slate-600 font-mono">
                          <div className="flex items-center gap-1.5">
                            <Clock className="w-3.5 h-3.5 text-slate-400" />
                            <span>{new Date(log.created_at).toLocaleString()}</span>
                          </div>
                        </td>

                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold border font-mono ${badgeClass}`}>
                            {log.action}
                          </span>
                        </td>

                        <td className="px-6 py-4 whitespace-nowrap text-xs text-slate-800 font-mono">
                          <div className="flex items-center gap-1.5">
                            <User className="w-3.5 h-3.5 text-slate-400" />
                            <span>{log.actor_id ? log.actor_id.substring(0, 12) + '...' : 'System'}</span>
                          </div>
                        </td>

                        <td className="px-6 py-4 whitespace-nowrap text-xs text-slate-600 font-mono">
                          {log.target ? (
                            <span className="px-2 py-0.5 rounded bg-slate-100 border border-slate-200">
                              {log.target.substring(0, 12)}...
                            </span>
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>

                        <td className="px-6 py-4 whitespace-nowrap text-right text-xs">
                          <button
                            onClick={() => toggleExpand(log.id)}
                            className="inline-flex items-center gap-1 text-emerald-700 hover:text-emerald-900 font-semibold cursor-pointer"
                          >
                            <span>{isExpanded ? 'Hide' : 'Inspect'}</span>
                            {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          </button>
                        </td>
                      </tr>

                      {isExpanded && (
                        <tr className="bg-slate-50/60">
                          <td colSpan={5} className="px-6 py-3 border-t border-slate-100">
                            <div className="p-3 bg-slate-900 text-slate-200 rounded-xl font-mono text-xs space-y-2 overflow-x-auto">
                              <div className="flex items-center justify-between text-slate-400 border-b border-slate-800 pb-1.5">
                                <span>Event ID: {log.id}</span>
                                {log.ip_address && <span>IP: {log.ip_address}</span>}
                              </div>
                              <pre className="text-[11px] leading-relaxed text-emerald-400">
                                {JSON.stringify(log.metadata || {}, null, 2)}
                              </pre>
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
    </div>
  );
}

export default function AuditLogsPage() {
  return (
    <Suspense fallback={
      <div className="max-w-7xl mx-auto px-4 py-16 text-center text-slate-500">
        Loading audit logs...
      </div>
    }>
      <AuditLogsContent />
    </Suspense>
  );
}
