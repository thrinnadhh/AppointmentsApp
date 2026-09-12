'use client';

import React, { useEffect, useState, useTransition } from 'react';
import {
  MapPin,
  Building2,
  CalendarCheck,
  TrendingUp,
  Clock,
  CheckCircle2,
  AlertCircle,
  Users,
  ChevronRight,
  ShieldCheck,
  RefreshCw,
  Plus,
  ArrowUpRight,
  Filter,
  Sparkles,
  Search,
  ExternalLink,
  PauseCircle,
  PlayCircle,
  Compass,
  DollarSign
} from 'lucide-react';
import {
  CityAdminStats,
  AdminVelocityMetrics,
  CityStatus,
  TimeWindowFilter,
} from '@/lib/supabase';

interface MerchantItem {
  id: string;
  name: string;
  city_id: string | null;
  city: string;
  status: 'PENDING_APPROVAL' | 'ACTIVE' | 'SUSPENDED';
  phone: string;
  email?: string | null;
  categories?: { name: string } | null;
  resources?: { count: number }[];
  created_at: string;
}

interface WaitlistEntry {
  id: string;
  city_id: string;
  contact_info: string;
  role_interest: string;
  notes?: string | null;
  created_at: string;
  cities?: { name: string } | null;
}

const TIME_WINDOWS: { id: TimeWindowFilter; label: string; sub: string }[] = [
  { id: 'today', label: 'Today', sub: 'Last 24 Hours' },
  { id: '3days', label: 'Last 3 Days', sub: '72h Velocity' },
  { id: '7days', label: 'Last Week', sub: '7-Day Rolling' },
  { id: '30days', label: 'Last 30 Days', sub: 'Monthly Horizon' },
  { id: 'all', label: 'All Time', sub: 'Lifetime Volume' },
];

export default function AdminDashboardPage() {
  const [isPending, startTransition] = useTransition();
  const [selectedWindow, setSelectedWindow] = useState<TimeWindowFilter>('7days');
  const [selectedCityFilter, setSelectedCityFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [merchantTab, setMerchantTab] = useState<'all' | 'pending' | 'active'>('all');

  // Core Data
  const [cities, setCities] = useState<CityAdminStats[]>([]);
  const [velocity, setVelocity] = useState<AdminVelocityMetrics | null>(null);
  const [merchants, setMerchants] = useState<MerchantItem[]>([]);
  const [waitlist, setWaitlist] = useState<WaitlistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);

  // New City Modal
  const [showAddCityModal, setShowAddCityModal] = useState(false);
  const [newCityId, setNewCityId] = useState('');
  const [newCityName, setNewCityName] = useState('');
  const [newCityState, setNewCityState] = useState('Andhra Pradesh');
  const [newCityLat, setNewCityLat] = useState('14.4426');
  const [newCityLng, setNewCityLng] = useState('79.9865');
  const [newCityRadius, setNewCityRadius] = useState('20');
  const [newCityTarget, setNewCityTarget] = useState('15');
  const [newCityStatus, setNewCityStatus] = useState<CityStatus>('EXPANDING');
  const [isSubmittingCity, setIsSubmittingCity] = useState(false);

  // Load All Dashboard Intel
  const loadDashboardData = async (windowFilter = selectedWindow, cityFilter = selectedCityFilter) => {
    try {
      setRefreshing(true);

      const cityParam = cityFilter !== 'all' ? `&cityId=${cityFilter}` : '';
      const [citiesRes, velocityRes, merchantsRes, waitlistRes] = await Promise.all([
        fetch('/api/admin/cities'),
        fetch(`/api/admin/analytics?window=${windowFilter}${cityParam}`),
        fetch(`/api/admin/merchants${cityFilter !== 'all' ? `?cityId=${cityFilter}` : ''}`),
        fetch(`/api/admin/waitlist${cityFilter !== 'all' ? `?cityId=${cityFilter}` : ''}`),
      ]);

      if (citiesRes.ok) {
        const data = await citiesRes.json();
        setCities(data.cities || []);
      }
      if (velocityRes.ok) {
        const data = await velocityRes.json();
        setVelocity(data.analytics || null);
      }
      if (merchantsRes.ok) {
        const data = await merchantsRes.json();
        setMerchants(data.merchants || []);
      }
      if (waitlistRes.ok) {
        const data = await waitlistRes.json();
        setWaitlist(data.waitlist || []);
      }
    } catch (err) {
      console.error('Failed to load admin dashboard data:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadDashboardData(selectedWindow, selectedCityFilter);
  }, [selectedWindow, selectedCityFilter]);

  // Handle City Status Toggle
  const handleUpdateCityStatus = async (cityId: string, newStatus: CityStatus) => {
    try {
      setActionFeedback(`Updating ${cityId} status to ${newStatus}...`);
      const res = await fetch('/api/admin/cities', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cityId, status: newStatus }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to update city status');
      }

      setActionFeedback(`✓ City ${cityId.toUpperCase()} transitioned to ${newStatus}`);
      await loadDashboardData();
      setTimeout(() => setActionFeedback(null), 3500);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error updating city';
      setActionFeedback(`⚠️ ${msg}`);
      setTimeout(() => setActionFeedback(null), 4000);
    }
  };

  // Handle Merchant Approval
  const handleUpdateMerchantStatus = async (providerId: string, newStatus: 'ACTIVE' | 'SUSPENDED') => {
    try {
      setActionFeedback(`Updating merchant status to ${newStatus}...`);
      const res = await fetch('/api/admin/merchants', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId, status: newStatus }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to update merchant');
      }

      setActionFeedback(`✓ Merchant ${newStatus === 'ACTIVE' ? 'Approved & Onboarded' : 'Suspended'}`);
      await loadDashboardData();
      setTimeout(() => setActionFeedback(null), 3500);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error updating merchant';
      setActionFeedback(`⚠️ ${msg}`);
      setTimeout(() => setActionFeedback(null), 4000);
    }
  };

  // Handle Create City
  const handleCreateCity = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCityId || !newCityName) return;

    try {
      setIsSubmittingCity(true);
      const res = await fetch('/api/admin/cities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: newCityId.toLowerCase().trim(),
          name: newCityName.trim(),
          state: newCityState,
          status: newCityStatus,
          latitude: parseFloat(newCityLat),
          longitude: parseFloat(newCityLng),
          radiusKm: parseFloat(newCityRadius),
          merchantTarget: parseInt(newCityTarget, 10),
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to create city');
      }

      setShowAddCityModal(false);
      setNewCityId('');
      setNewCityName('');
      setActionFeedback(`✓ City ${newCityName} added successfully to expansion radar!`);
      await loadDashboardData();
      setTimeout(() => setActionFeedback(null), 3500);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error creating city';
      alert(msg);
    } finally {
      setIsSubmittingCity(false);
    }
  };

  // Filtered lists
  const filteredCities = cities.filter((c) =>
    c.city_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.city_id.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredMerchants = merchants.filter((m) => {
    const matchesSearch =
      m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.city.toLowerCase().includes(searchQuery.toLowerCase());
    if (!matchesSearch) return false;
    if (merchantTab === 'pending') return m.status === 'PENDING_APPROVAL';
    if (merchantTab === 'active') return m.status === 'ACTIVE';
    return true;
  });

  const getStatusBadge = (status: CityStatus) => {
    switch (status) {
      case 'ACTIVE':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-300">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 mr-1.5 animate-pulse"></span>
            ACTIVE (LIVE)
          </span>
        );
      case 'EXPANDING':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-900 border border-amber-300">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-600 mr-1.5"></span>
            EXPANDING (ONBOARDING)
          </span>
        );
      case 'PLANNED':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-300">
            <span className="w-1.5 h-1.5 rounded-full bg-slate-400 mr-1.5"></span>
            PLANNED (RADAR)
          </span>
        );
      case 'PAUSED':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-100 text-rose-800 border border-rose-300">
            PAUSED
          </span>
        );
      default:
        return null;
    }
  };

  const getMerchantStatusBadge = (status: 'PENDING_APPROVAL' | 'ACTIVE' | 'SUSPENDED') => {
    switch (status) {
      case 'ACTIVE':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <CheckCircle2 className="w-3 h-3 mr-1 text-emerald-600" />
            ONBOARDED
          </span>
        );
      case 'PENDING_APPROVAL':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-300 animate-pulse">
            <Clock className="w-3 h-3 mr-1 text-amber-600" />
            IN PROGRESS
          </span>
        );
      case 'SUSPENDED':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200">
            <AlertCircle className="w-3 h-3 mr-1 text-rose-600" />
            SUSPENDED
          </span>
        );
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 pb-20">
      {/* Action Toast Feedback */}
      {actionFeedback && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white px-5 py-3 rounded-xl shadow-xl flex items-center gap-3 border border-slate-700 text-sm font-medium animate-in fade-in slide-in-from-bottom-2">
          <span>{actionFeedback}</span>
        </div>
      )}

      {/* Hero Header */}
      <div className="bg-white border-b border-slate-200 sticky top-16 z-30 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <div className="flex items-center gap-2.5">
                <div className="h-9 w-9 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-700">
                  <Compass className="w-5 h-5" />
                </div>
                <div>
                  <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
                    Super Admin City Rollout & Expansion Hub
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                      Live Ops
                    </span>
                  </h1>
                  <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
                    Multi-city launch gating, merchant pipeline conversion, and velocity analytics
                  </p>
                </div>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="flex items-center gap-2.5">
              <button
                onClick={() => loadDashboardData()}
                disabled={refreshing}
                className="inline-flex items-center px-3.5 py-2 rounded-lg border border-slate-200 bg-white text-xs sm:text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors shadow-xs disabled:opacity-50"
                title="Refresh Metrics"
              >
                <RefreshCw className={`w-4 h-4 mr-1.5 text-slate-500 ${refreshing ? 'animate-spin' : ''}`} />
                Refresh
              </button>

              <button
                onClick={() => setShowAddCityModal(true)}
                className="inline-flex items-center px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-semibold transition-colors shadow-xs"
              >
                <Plus className="w-4 h-4 mr-1.5" />
                Expand New City
              </button>
            </div>
          </div>

          {/* Time-Window and City Scope Bar */}
          <div className="mt-5 pt-4 border-t border-slate-100 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
            {/* Dynamic Time Filters */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider mr-1 flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                Horizon:
              </span>
              {TIME_WINDOWS.map((win) => {
                const isActive = selectedWindow === win.id;
                return (
                  <button
                    key={win.id}
                    onClick={() => setSelectedWindow(win.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                      isActive
                        ? 'bg-emerald-600 text-white shadow-xs'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900'
                    }`}
                  >
                    {win.label}
                  </button>
                );
              })}
            </div>

            {/* City Scope Selector */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5" />
                Scope:
              </span>
              <select
                value={selectedCityFilter}
                onChange={(e) => setSelectedCityFilter(e.target.value)}
                className="text-xs font-semibold bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                <option value="all">All Expansion Territories ({cities.length})</option>
                {cities.map((c) => (
                  <option key={c.city_id} value={c.city_id}>
                    {c.city_name} ({c.status})
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Main Executive Body */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 space-y-8">
        {/* Top KPI Cards Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {/* Card 1: Completed Appointments */}
          <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-xs relative overflow-hidden">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Completed Bookings
              </span>
              <div className="p-2 rounded-lg bg-emerald-50 text-emerald-600">
                <CalendarCheck className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-2xl font-extrabold text-slate-900">
                {velocity?.completed_bookings ?? 0}
              </span>
              <span className="text-xs text-slate-500">
                of {velocity?.total_bookings ?? 0} total
              </span>
            </div>
            <div className="mt-2 flex items-center text-xs font-medium text-emerald-600">
              <TrendingUp className="w-3 h-3 mr-1" />
              {velocity && velocity.total_bookings > 0
                ? Math.round((velocity.completed_bookings / velocity.total_bookings) * 100)
                : 100}
              % Completion Velocity
            </div>
          </div>

          {/* Card 2: Merchant Pipeline */}
          <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-xs relative overflow-hidden">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Merchant Funnel
              </span>
              <div className="p-2 rounded-lg bg-blue-50 text-blue-600">
                <Building2 className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-2xl font-extrabold text-slate-900">
                {velocity?.merchant_funnel?.onboarded_count ?? 0}
              </span>
              <span className="text-xs font-bold text-amber-600">
                + {velocity?.merchant_funnel?.in_progress_count ?? 0} in progress
              </span>
            </div>
            <div className="mt-2 text-xs text-slate-500">
              Total Managed: {velocity?.merchant_funnel?.total_merchants ?? 0} providers
            </div>
          </div>

          {/* Card 3: Cities Rollout Ratio */}
          <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-xs relative overflow-hidden">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Rollout Coverage
              </span>
              <div className="p-2 rounded-lg bg-teal-50 text-teal-600">
                <MapPin className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-2xl font-extrabold text-slate-900">
                {velocity?.cities_overview?.active_cities ?? 0} Active
              </span>
              <span className="text-xs text-amber-600 font-bold">
                {velocity?.cities_overview?.expanding_cities ?? 0} Expanding
              </span>
            </div>
            <div className="mt-2 text-xs text-slate-500">
              {velocity?.cities_overview?.planned_cities ?? 0} Planned on Radar
            </div>
          </div>

          {/* Card 4: Gross Deposit Volume */}
          <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-xs relative overflow-hidden">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Deposit Volume
              </span>
              <div className="p-2 rounded-lg bg-amber-50 text-amber-600">
                <DollarSign className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-3 flex items-baseline gap-1">
              <span className="text-2xl font-extrabold text-slate-900">
                ₹{Number(velocity?.gross_deposit_amount || 0).toLocaleString('en-IN')}
              </span>
            </div>
            <div className="mt-2 text-xs text-slate-500">
              Across confirmed slots ({selectedWindow})
            </div>
          </div>

          {/* Card 5: Pre-Launch Demand Waitlist */}
          <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-xs relative overflow-hidden">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Expansion Waitlist
              </span>
              <div className="p-2 rounded-lg bg-emerald-50 text-emerald-600">
                <Sparkles className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-2xl font-extrabold text-slate-900">
                {waitlist.length}
              </span>
              <span className="text-xs font-medium text-emerald-600">
                Inbound Demand
              </span>
            </div>
            <div className="mt-2 text-xs text-slate-500">
              Consumer & Merchant Leads
            </div>
          </div>
        </div>

        {/* SECTION 1: Multi-City Launch & Rollout Control Matrix */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="p-5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <MapPin className="w-4 h-4 text-emerald-600" />
                City Expansion & Territory Control Matrix
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Regulate which cities receive live consumer booking traffic vs merchant pre-onboarding
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Filter cities..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 w-44"
                />
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider font-semibold">
                <tr>
                  <th className="px-6 py-3.5">Territory</th>
                  <th className="px-6 py-3.5">Launch State</th>
                  <th className="px-6 py-3.5">Merchant Progress (Active / Target)</th>
                  <th className="px-6 py-3.5">Appts in Horizon</th>
                  <th className="px-6 py-3.5">Gross Volume</th>
                  <th className="px-6 py-3.5">Waitlist Signals</th>
                  <th className="px-6 py-3.5 text-right">Expansion Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                {filteredCities.map((city) => {
                  const target = city.merchant_target || 10;
                  const onboarded = city.onboarded_merchants || 0;
                  const percent = Math.min(100, Math.round((onboarded / target) * 100));

                  return (
                    <tr key={city.city_id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="px-6 py-4">
                        <div className="font-bold text-slate-900 text-sm">{city.city_name}</div>
                        <div className="text-[11px] text-slate-400 uppercase font-mono">ID: {city.city_id}</div>
                      </td>

                      <td className="px-6 py-4">
                        {getStatusBadge(city.status)}
                      </td>

                      <td className="px-6 py-4">
                        <div className="w-48">
                          <div className="flex justify-between text-xs font-semibold mb-1">
                            <span className="text-slate-900">{onboarded} active</span>
                            <span className="text-slate-400">Target: {target}</span>
                          </div>
                          <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                            <div
                              className={`h-2 rounded-full transition-all ${
                                percent >= 100
                                  ? 'bg-emerald-500'
                                  : percent >= 50
                                  ? 'bg-teal-500'
                                  : 'bg-amber-400'
                              }`}
                              style={{ width: `${percent}%` }}
                            ></div>
                          </div>
                          <div className="text-[10px] text-slate-400 mt-1">
                            {city.in_progress_merchants} in onboarding pipeline
                          </div>
                        </div>
                      </td>

                      <td className="px-6 py-4">
                        <div className="font-bold text-slate-900">{city.completed_bookings} Completed</div>
                        <div className="text-[11px] text-slate-400">of {city.total_bookings} total</div>
                      </td>

                      <td className="px-6 py-4">
                        <div className="font-bold text-slate-900">
                          ₹{Number(city.deposit_volume || 0).toLocaleString('en-IN')}
                        </div>
                      </td>

                      <td className="px-6 py-4">
                        {city.waitlist_count > 0 ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200">
                            {city.waitlist_count} waiting
                          </span>
                        ) : (
                          <span className="text-slate-400 text-xs">0 waiting</span>
                        )}
                      </td>

                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {city.status === 'EXPANDING' && (
                            <button
                              onClick={() => handleUpdateCityStatus(city.city_id, 'ACTIVE')}
                              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs transition-colors shadow-xs flex items-center gap-1"
                              title="Go live for customer bookings"
                            >
                              <PlayCircle className="w-3.5 h-3.5" />
                              Launch Active
                            </button>
                          )}

                          {city.status === 'PLANNED' && (
                            <button
                              onClick={() => handleUpdateCityStatus(city.city_id, 'EXPANDING')}
                              className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold text-xs transition-colors shadow-xs flex items-center gap-1"
                              title="Open for merchant onboarding"
                            >
                              <ArrowUpRight className="w-3.5 h-3.5" />
                              Start Expansion
                            </button>
                          )}

                          {city.status === 'ACTIVE' && (
                            <button
                              onClick={() => handleUpdateCityStatus(city.city_id, 'PAUSED')}
                              className="px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-rose-50 hover:text-rose-700 text-slate-600 font-semibold text-xs transition-colors flex items-center gap-1"
                              title="Temporarily freeze customer bookings"
                            >
                              <PauseCircle className="w-3.5 h-3.5" />
                              Pause
                            </button>
                          )}

                          {city.status === 'PAUSED' && (
                            <button
                              onClick={() => handleUpdateCityStatus(city.city_id, 'ACTIVE')}
                              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs transition-colors shadow-xs flex items-center gap-1"
                            >
                              <PlayCircle className="w-3.5 h-3.5" />
                              Resume
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* SECTION 2: Merchant Onboarding & Pipeline Funnel */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="p-5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Building2 className="w-4 h-4 text-emerald-600" />
                Merchant Onboarding Pipeline Funnel
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Review merchant applications, approve verified venues, and manage provider status
              </p>
            </div>

            {/* Sub Filter Tabs */}
            <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg">
              <button
                onClick={() => setMerchantTab('all')}
                className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${
                  merchantTab === 'all'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                All ({merchants.length})
              </button>
              <button
                onClick={() => setMerchantTab('pending')}
                className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${
                  merchantTab === 'pending'
                    ? 'bg-white text-amber-800 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                In Progress ({merchants.filter((m) => m.status === 'PENDING_APPROVAL').length})
              </button>
              <button
                onClick={() => setMerchantTab('active')}
                className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${
                  merchantTab === 'active'
                    ? 'bg-white text-emerald-800 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Active ({merchants.filter((m) => m.status === 'ACTIVE').length})
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider font-semibold">
                <tr>
                  <th className="px-6 py-3.5">Merchant / Business</th>
                  <th className="px-6 py-3.5">Category</th>
                  <th className="px-6 py-3.5">City Territory</th>
                  <th className="px-6 py-3.5">Bookable Resources</th>
                  <th className="px-6 py-3.5">Current Status</th>
                  <th className="px-6 py-3.5 text-right">Verification Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                {filteredMerchants.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-8 text-center text-slate-400 text-xs">
                      No merchants found matching current filter.
                    </td>
                  </tr>
                ) : (
                  filteredMerchants.map((merchant) => (
                    <tr key={merchant.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="px-6 py-4">
                        <div className="font-bold text-slate-900 text-sm">{merchant.name}</div>
                        <div className="text-[11px] text-slate-400">{merchant.phone || merchant.email}</div>
                      </td>

                      <td className="px-6 py-4">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700">
                          {merchant.categories?.name || 'General'}
                        </span>
                      </td>

                      <td className="px-6 py-4">
                        <span className="font-semibold text-slate-800 uppercase tracking-wider text-[11px]">
                          {merchant.city}
                        </span>
                      </td>

                      <td className="px-6 py-4">
                        <div className="font-bold text-slate-900">
                          {merchant.resources?.[0]?.count ?? 0} resources
                        </div>
                      </td>

                      <td className="px-6 py-4">
                        {getMerchantStatusBadge(merchant.status)}
                      </td>

                      <td className="px-6 py-4 text-right">
                        {merchant.status === 'PENDING_APPROVAL' ? (
                          <button
                            onClick={() => handleUpdateMerchantStatus(merchant.id, 'ACTIVE')}
                            className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs transition-colors shadow-xs inline-flex items-center gap-1"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Approve & Launch
                          </button>
                        ) : merchant.status === 'ACTIVE' ? (
                          <button
                            onClick={() => handleUpdateMerchantStatus(merchant.id, 'SUSPENDED')}
                            className="px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-rose-50 hover:text-rose-700 text-slate-600 font-semibold text-xs transition-colors"
                          >
                            Suspend
                          </button>
                        ) : (
                          <button
                            onClick={() => handleUpdateMerchantStatus(merchant.id, 'ACTIVE')}
                            className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs transition-colors"
                          >
                            Re-Activate
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* SECTION 3: Expansion Demand Waitlist Leaderboard */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="p-5 border-b border-slate-200 flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-500" />
                Pre-Launch Expansion Waitlist & Demand Signals
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Inbound customer & merchant requests from non-active cities to prioritize next territory unlocks
              </p>
            </div>
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
              {waitlist.length} Inbound Requests
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider font-semibold">
                <tr>
                  <th className="px-6 py-3.5">City Territory</th>
                  <th className="px-6 py-3.5">Role Interest</th>
                  <th className="px-6 py-3.5">Contact Details</th>
                  <th className="px-6 py-3.5">Notes / Vertical Interest</th>
                  <th className="px-6 py-3.5 text-right">Registered</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                {waitlist.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-8 text-center text-slate-400 text-xs">
                      No waitlist entries yet for this territory.
                    </td>
                  </tr>
                ) : (
                  waitlist.map((entry) => (
                    <tr key={entry.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="px-6 py-4">
                        <span className="font-bold text-slate-900 uppercase">
                          {entry.cities?.name || entry.city_id}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${
                          entry.role_interest === 'merchant'
                            ? 'bg-blue-50 text-blue-700 border border-blue-200'
                            : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        }`}>
                          {entry.role_interest.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-6 py-4 font-mono text-slate-800">
                        {entry.contact_info}
                      </td>
                      <td className="px-6 py-4 text-slate-600">
                        {entry.notes || '—'}
                      </td>
                      <td className="px-6 py-4 text-right text-slate-400">
                        {new Date(entry.created_at).toLocaleDateString()}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Modal: Add New City */}
      {showAddCityModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 animate-in zoom-in-95">
            <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <MapPin className="w-5 h-5 text-emerald-600" />
              Expand to New Territory
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Add a new municipality to the expansion roadmap and configure its merchant quota
            </p>

            <form onSubmit={handleCreateCity} className="mt-5 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase">City Unique ID (Slug)</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. nellore, kadapa, vijayawada"
                  value={newCityId}
                  onChange={(e) => setNewCityId(e.target.value)}
                  className="mt-1 w-full text-xs font-mono rounded-lg border border-slate-200 px-3 py-2 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase">City Display Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Nellore"
                  value={newCityName}
                  onChange={(e) => setNewCityName(e.target.value)}
                  className="mt-1 w-full text-xs rounded-lg border border-slate-200 px-3 py-2 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase">Latitude</label>
                  <input
                    type="number"
                    step="any"
                    required
                    value={newCityLat}
                    onChange={(e) => setNewCityLat(e.target.value)}
                    className="mt-1 w-full text-xs rounded-lg border border-slate-200 px-3 py-2 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase">Longitude</label>
                  <input
                    type="number"
                    step="any"
                    required
                    value={newCityLng}
                    onChange={(e) => setNewCityLng(e.target.value)}
                    className="mt-1 w-full text-xs rounded-lg border border-slate-200 px-3 py-2 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase">Radius (km)</label>
                  <input
                    type="number"
                    required
                    value={newCityRadius}
                    onChange={(e) => setNewCityRadius(e.target.value)}
                    className="mt-1 w-full text-xs rounded-lg border border-slate-200 px-3 py-2 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase">Merchant Target</label>
                  <input
                    type="number"
                    required
                    value={newCityTarget}
                    onChange={(e) => setNewCityTarget(e.target.value)}
                    className="mt-1 w-full text-xs rounded-lg border border-slate-200 px-3 py-2 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase">Initial Launch Status</label>
                <select
                  value={newCityStatus}
                  onChange={(e) => setNewCityStatus(e.target.value as CityStatus)}
                  className="mt-1 w-full text-xs rounded-lg border border-slate-200 px-3 py-2 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                >
                  <option value="EXPANDING">EXPANDING (Merchant Onboarding & Waitlist)</option>
                  <option value="PLANNED">PLANNED (Radar & Survey)</option>
                  <option value="ACTIVE">ACTIVE (Immediate Live Consumer Bookings)</option>
                </select>
              </div>

              <div className="mt-6 flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAddCityModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingCity}
                  className="px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-xs transition-colors disabled:opacity-50"
                >
                  {isSubmittingCity ? 'Adding Territory...' : 'Add City to Radar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
