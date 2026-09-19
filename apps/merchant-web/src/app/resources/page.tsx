'use client';

import React, { useState, useEffect, useCallback, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { 
  Users, 
  Plus, 
  Clock, 
  Check, 
  X, 
  Sparkles, 
  RefreshCw, 
  Building2, 
  Stethoscope, 
  Scissors,
  Gamepad2,
  Utensils,
  Layers, 
  IndianRupee, 
  Search,
  Filter,
  Trash2,
  CheckCircle2
} from 'lucide-react';
import { 
  supabase, 
  fetchAllProviders, 
  fetchProviderResources,
  Provider 
} from '@/lib/supabase';
import { Resource, ResourceType } from '@appointments/shared';
import { useMerchantTenant } from '@/contexts/MerchantTenantContext';

function ResourcesManagementContent() {
  const searchParams = useSearchParams();
  const providerParam = searchParams.get('providerId');

  const { activeProvider: tenantProvider, verticalConfig, isSuperAdmin, isLocked } = useMerchantTenant();

  const [providers, setProviders] = useState<Provider[]>(tenantProvider ? [tenantProvider] : []);
  const [selectedProviderId, setSelectedProviderId] = useState<string>(
    tenantProvider?.id || (isSuperAdmin ? providerParam || '' : '')
  );
  const [resources, setResources] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [feedbackToast, setFeedbackToast] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDepartment, setSelectedDepartment] = useState('all');

  const defaultResourceType: ResourceType = (
    verticalConfig.id === 'salons' ? 'stylist' :
    verticalConfig.id === 'gaming' ? 'court' :
    verticalConfig.id === 'restaurants' ? 'table' :
    verticalConfig.id === 'pets' ? 'vet' :
    'doctor'
  );

  const [formData, setFormData] = useState<{
    name: string;
    type: ResourceType;
    department: string;
    price: number;
    deposit_amount: number;
    duration_minutes: number;
    capacity: number;
    specialization: string;
  }>({
    name: '',
    type: defaultResourceType,
    department: '',
    price: verticalConfig.defaultPrice,
    deposit_amount: verticalConfig.defaultPrice,
    duration_minutes: verticalConfig.defaultDurationMinutes,
    capacity: verticalConfig.id === 'gaming' ? 14 : (verticalConfig.id === 'restaurants' ? 4 : 1),
    specialization: '',
  });

  // Keep selectedProviderId and formData in sync with tenant context
  useEffect(() => {
    if (tenantProvider?.id && !isSuperAdmin) {
      setSelectedProviderId(tenantProvider.id);
      setProviders([tenantProvider]);
      setFormData((prev) => ({
        ...prev,
        type: defaultResourceType,
        department: '',
        price: verticalConfig.defaultPrice,
        deposit_amount: verticalConfig.defaultPrice,
        duration_minutes: verticalConfig.defaultDurationMinutes,
      }));
    }
  }, [tenantProvider?.id, isSuperAdmin, verticalConfig, defaultResourceType]);

  const loadData = useCallback(async () => {
    if (!selectedProviderId && !isSuperAdmin) {
      setLoading(false);
      setResources([]);
      return;
    }
    setLoading(true);
    try {
      const [fetchedProviders, fetchedResources] = await Promise.all([
        isSuperAdmin ? fetchAllProviders() : Promise.resolve(tenantProvider ? [tenantProvider] : []),
        selectedProviderId ? fetchProviderResources(selectedProviderId) : Promise.resolve([]),
      ]);

      if (fetchedProviders && fetchedProviders.length > 0) {
        setProviders(fetchedProviders);
        if (isSuperAdmin && providerParam && fetchedProviders.some((p) => p.id === providerParam)) {
          setSelectedProviderId(providerParam);
        }
      }
      setResources((fetchedResources || []) as Resource[]);
    } catch (err) {
      console.warn('Error fetching resources:', err);
      setResources([]);
    } finally {
      setLoading(false);
    }
  }, [selectedProviderId, providerParam, isSuperAdmin, tenantProvider]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleCreateResource = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name) return;

    try {
      const res = await fetch('/api/admin/resources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerId: selectedProviderId,
          name: formData.name.trim(),
          type: formData.type,
          department: formData.department.trim() || 'General',
          price: Number(formData.price),
          depositAmount: Number(formData.price),
          durationMinutes: Number(formData.duration_minutes),
          capacity: Number(formData.capacity),
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Failed to create resource');
      }

      setFeedbackToast(`${verticalConfig.resourceLabelSingular} "${formData.name}" added successfully.`);
      await loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error adding resource';
      setFeedbackToast(`Error: ${msg}`);
    } finally {
      setIsAdding(false);
      setFormData({
        name: '',
        type: defaultResourceType,
        department: '',
        price: verticalConfig.defaultPrice,
        deposit_amount: verticalConfig.defaultPrice,
        duration_minutes: verticalConfig.defaultDurationMinutes,
        capacity: verticalConfig.id === 'gaming' ? 14 : (verticalConfig.id === 'restaurants' ? 4 : 1),
        specialization: '',
      });
      setTimeout(() => setFeedbackToast(null), 5000);
    }
  };

  const toggleActive = async (id: string, currentActive: boolean) => {
    try {
      await supabase
        .from('resources')
        .update({ is_active: !currentActive, updated_at: new Date().toISOString() })
        .eq('id', id);
      setFeedbackToast(`${verticalConfig.resourceLabelSingular} status updated.`);
      await loadData();
    } catch (err) {
      console.warn('Toggling locally:', err);
      setResources((prev) =>
        prev.map((r) => (r.id === id ? { ...r, is_active: !r.is_active } : r))
      );
    } finally {
      setTimeout(() => setFeedbackToast(null), 3000);
    }
  };

  const handleDeleteResource = async (id: string, name: string) => {
    if (!window.confirm(`Are you sure you want to delete "${name}"? This action cannot be undone.`)) {
      return;
    }
    try {
      const res = await fetch(`/api/admin/resources?id=${id}`, {
        method: 'DELETE',
      });
      const json = await res.json();
      if (!res.ok || json.error) {
        throw new Error(json.error || 'Failed to delete resource');
      }
      // Optimistically remove from state immediately
      setResources((prev) => prev.filter((r) => r.id !== id));
      setFeedbackToast(`Deleted "${name}" successfully.`);
      await loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error deleting resource';
      setFeedbackToast(`Error: ${msg}`);
    } finally {
      setTimeout(() => setFeedbackToast(null), 4000);
    }
  };

  // Group resources by department
  const departments = Array.from(
    new Set(resources.map((r) => r.department || 'General'))
  );

  const filteredResources = resources.filter((r) => {
    const matchesSearch =
      r.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (r.department || '').toLowerCase().includes(searchQuery.toLowerCase());

    if (selectedDepartment === 'all') return matchesSearch;
    return matchesSearch && (r.department || 'General') === selectedDepartment;
  });

  const selectedVenue = providers.find((p) => p.id === selectedProviderId);

  if (!tenantProvider && !isSuperAdmin) {
    return (
      <div className="max-w-xl mx-auto my-16 p-8 bg-white border border-slate-200 rounded-2xl text-center shadow-sm">
        <div className="w-16 h-16 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <Building2 className="w-8 h-8" />
        </div>
        <h2 className="text-2xl font-bold text-slate-900 mb-2">Register Your Shop First</h2>
        <p className="text-slate-600 mb-6">
          To manage staff, chairs, or consultation units, please register or sign in to your shop first.
        </p>
        <Link
          href="/login?mode=register"
          className="inline-flex items-center gap-2 px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl transition shadow-sm"
        >
          Register Your Shop
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Toast */}
      {feedbackToast && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 px-4 py-3 rounded-xl flex items-center justify-between text-sm shadow-sm animate-fade-in">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span className="font-semibold">{feedbackToast}</span>
          </div>
          <button
            onClick={() => setFeedbackToast(null)}
            className="text-emerald-600 hover:text-emerald-900 px-2 py-0.5 text-xs font-bold rounded transition"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200">
              Department & Resource Builder
            </span>
            <span className="text-xs text-slate-500">• Total Consultation & Service Fees (Total Cash Payable)</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
            {verticalConfig.resourceLabelPlural}, Departments & Services
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            {verticalConfig.id === 'salons'
              ? 'Manage senior hair stylists, aesthetic specialists, chairs/stations, and salon service pricing.'
              : verticalConfig.id === 'gaming'
              ? 'Manage box cricket pitches, turf arenas, badminton courts, and booking rates.'
              : verticalConfig.id === 'restaurants'
              ? 'Configure dining tables, rooftop cabanas, and table reservation rates.'
              : verticalConfig.id === 'pets'
              ? 'Manage veterinary doctors, pet groomers, wellness consultation bays, and care pricing.'
              : 'Add doctors/staff to any department of your choice (e.g. Cardiology, Ortho, General Medicine) with total cash consultation fees.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Venue Selector or Locked Badge */}
          {isLocked ? (
            <div 
              data-testid="locked-tenant-badge"
              className="inline-flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-3.5 py-2 text-xs font-bold text-emerald-800 shadow-xs"
            >
              <Building2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
              <span>{tenantProvider?.name || 'Dedicated Space'}</span>
              <span className="text-[10px] bg-white px-1.5 py-0.5 rounded text-emerald-700 border border-emerald-200">
                {verticalConfig.badgeLabel}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2 bg-white border border-slate-300 rounded-xl px-3 py-2 shadow-xs">
              <Building2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
              <label htmlFor="resource-venue-select" className="sr-only">Select Business</label>
              <select
                id="resource-venue-select"
                value={selectedProviderId}
                onChange={(e) => setSelectedProviderId(e.target.value)}
                className="text-xs font-bold text-slate-800 bg-transparent focus:outline-none cursor-pointer pr-2"
              >
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.category_id})
                  </option>
                ))}
              </select>
            </div>
          )}

          <button
            onClick={() => loadData()}
            disabled={loading}
            className="p-2.5 rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition shadow-xs"
            title="Refresh Resources"
            aria-label="Refresh Resources"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-emerald-600' : ''}`} />
          </button>

          <button
            onClick={() => setIsAdding(true)}
            className="inline-flex items-center px-4 py-2.5 rounded-xl text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition shadow-sm"
          >
            <Plus className="w-4 h-4 mr-1.5" />
            Add {verticalConfig.resourceLabelSingular} / Service
          </button>
        </div>
      </div>

      {/* Active Venue Banner */}
      {selectedVenue && (
        <div className="bg-slate-900 text-white p-5 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-sm">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider bg-emerald-500/20 text-emerald-300 border border-emerald-400/30">
                Current Venue
              </span>
              <span className="text-xs text-slate-300 capitalize">{selectedVenue.category_id}</span>
            </div>
            <h2 className="text-lg font-bold text-white">{selectedVenue.name}</h2>
            <p className="text-xs text-slate-400">{selectedVenue.address}, Tirupati • {selectedVenue.phone}</p>
          </div>

          <div className="flex items-center gap-6 border-t sm:border-t-0 sm:border-l border-slate-800 pt-3 sm:pt-0 sm:pl-6 text-xs">
            <div>
              <p className="text-slate-400 uppercase text-[10px] tracking-wider font-semibold">Total Staff</p>
              <p className="text-xl font-bold text-white mt-0.5">{resources.length}</p>
            </div>
            <div>
              <p className="text-slate-400 uppercase text-[10px] tracking-wider font-semibold">Departments</p>
              <p className="text-xl font-bold text-emerald-400 mt-0.5">{departments.length}</p>
            </div>
          </div>
        </div>
      )}

      {/* Search & Department Filters */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
          <input
            id="resource-search"
            name="resourceSearch"
            aria-label={`Search ${verticalConfig.resourceLabelSingular.toLowerCase()} or department`}
            type="text"
            placeholder={`Search ${verticalConfig.resourceLabelSingular.toLowerCase()} name or department...`}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-slate-50/50"
          />
        </div>

        <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
          <span className="text-xs font-semibold text-slate-500 flex items-center gap-1">
            <Filter className="w-3.5 h-3.5" />
            Dept:
          </span>
          <button
            onClick={() => setSelectedDepartment('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors whitespace-nowrap ${
              selectedDepartment === 'all'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'text-slate-600 hover:bg-slate-100 bg-slate-50 border border-slate-200'
            }`}
          >
            All ({resources.length})
          </button>
          {departments.map((dept) => (
            <button
              key={dept}
              onClick={() => setSelectedDepartment(dept)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors whitespace-nowrap ${
                selectedDepartment === dept
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'text-slate-600 hover:bg-slate-100 bg-slate-50 border border-slate-200'
              }`}
            >
              {dept}
            </button>
          ))}
        </div>
      </div>

      {/* Add Resource Modal */}
      {isAdding && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-xl w-full p-6 sm:p-8 shadow-xl border border-slate-200 relative animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-lg bg-emerald-100 text-emerald-800 flex items-center justify-center">
                  {verticalConfig.id === 'salons' ? (
                    <Scissors className="w-5 h-5" />
                  ) : verticalConfig.id === 'gaming' ? (
                    <Gamepad2 className="w-5 h-5" />
                  ) : verticalConfig.id === 'restaurants' ? (
                    <Utensils className="w-5 h-5" />
                  ) : (
                    <Stethoscope className="w-5 h-5" />
                  )}
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900">Add {verticalConfig.resourceLabelSingular} / Service Unit</h3>
                  <p className="text-xs text-slate-500">Configure department, {verticalConfig.actionVerb.toLowerCase()} fee, and booking deposit</p>
                </div>
              </div>
              <button
                onClick={() => setIsAdding(false)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold p-1"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateResource} className="mt-5 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <label htmlFor="doctor-name" className="block text-xs font-semibold text-slate-700 mb-1">
                    {verticalConfig.resourceLabelSingular} Name *
                  </label>
                  <input
                    id="doctor-name"
                    name="doctorName"
                    aria-label={`${verticalConfig.resourceLabelSingular} Name`}
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder={
                      verticalConfig.id === 'salons' ? 'e.g. Priya Sharma (Senior Stylist)' :
                      verticalConfig.id === 'gaming' ? 'e.g. Box Cricket Pitch 1 (Floodlit)' :
                      verticalConfig.id === 'restaurants' ? 'e.g. Family Dining Table 4 (AC Hall)' :
                      verticalConfig.id === 'pets' ? 'e.g. Dr. K. Suresh (Veterinary Surgeon)' :
                      'e.g. Dr. A. V. Ramana Rao, MD (Cardiology)'
                    }
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label htmlFor="doctor-department" className="block text-xs font-semibold text-slate-700 mb-1">
                    Department / Specialty *
                  </label>
                  <input
                    id="doctor-department"
                    name="doctorDepartment"
                    aria-label="Department"
                    type="text"
                    required
                    value={formData.department}
                    onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                    placeholder="Enter any department (e.g. Cardiology, Pediatrics, General Medicine, Skin Care...)"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  />
                  <p className="text-[11px] text-slate-500 mt-1">Add any custom department or category you want</p>
                </div>

                <div>
                  <label htmlFor="doctor-unit-type" className="block text-xs font-semibold text-slate-700 mb-1">
                    Unit Type *
                  </label>
                  <select
                    id="doctor-unit-type"
                    name="doctorUnitType"
                    aria-label="Unit Type"
                    value={formData.type}
                    onChange={(e) => setFormData({ ...formData, type: e.target.value as ResourceType })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:outline-none bg-white"
                  >
                    <option value="doctor">Doctor / Consultant</option>
                    <option value="stylist">Stylist / Therapist</option>
                    <option value="court">Turf / Arena / Court</option>
                    <option value="table">Table / Dining Booth</option>
                    <option value="vet">Veterinarian</option>
                    <option value="groomer">Pet Groomer</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="doctor-price" className="block text-xs font-semibold text-slate-700 mb-1">
                    Total Fee (₹) *
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-2 text-slate-400 font-bold text-sm">₹</span>
                    <input
                      id="doctor-price"
                      name="doctorPrice"
                      aria-label="Total Fee in Rupees"
                      type="number"
                      required
                      min="0"
                      step="50"
                      value={formData.price}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        setFormData({ ...formData, price: val, deposit_amount: val });
                      }}
                      className="w-full pl-7 pr-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:outline-none font-semibold"
                    />
                  </div>
                  <span className="text-[11px] text-slate-500">Total cash amount to be paid by customer (No advance deposit)</span>
                </div>

                <div>
                  <label htmlFor="doctor-duration" className="block text-xs font-semibold text-slate-700 mb-1">
                    Slot Duration (Mins)
                  </label>
                  <input
                    id="doctor-duration"
                    name="doctorDuration"
                    aria-label="Slot Duration in Minutes"
                    type="number"
                    min="10"
                    step="5"
                    value={formData.duration_minutes}
                    onChange={(e) => setFormData({ ...formData, duration_minutes: Number(e.target.value) })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label htmlFor="doctor-capacity" className="block text-xs font-semibold text-slate-700 mb-1">
                    Capacity (Concurrent)
                  </label>
                  <input
                    id="doctor-capacity"
                    name="doctorCapacity"
                    aria-label="Concurrent Capacity"
                    type="number"
                    min="1"
                    value={formData.capacity}
                    onChange={(e) => setFormData({ ...formData, capacity: Number(e.target.value) })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsAdding(false)}
                  className="px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-sm transition-colors flex items-center gap-2"
                >
                  <Plus className="w-4 h-4" />
                  Save {verticalConfig.resourceLabelSingular}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Resources Cards Grid */}
      {loading ? (
        <div className="py-16 text-center text-slate-500">
          <RefreshCw className="w-6 h-6 animate-spin mx-auto text-emerald-600 mb-2" />
          Loading {verticalConfig.resourceLabelPlural.toLowerCase()} and departments...
        </div>
      ) : filteredResources.length === 0 ? (
        <div className="py-16 text-center bg-white rounded-2xl border border-slate-200 p-8">
          <Users className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-base font-bold text-slate-800">No {verticalConfig.resourceLabelPlural.toLowerCase()} found</p>
          <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
            Click &quot;Add {verticalConfig.resourceLabelSingular}&quot; to assign your first {verticalConfig.resourceLabelSingular.toLowerCase()}, department, and pricing.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredResources.map((res) => {
            const price = res.price ?? 500;
            const deposit = res.deposit_amount ?? 50;
            const department = res.department || 'General';

            return (
              <div
                key={res.id}
                className={`bg-white rounded-2xl border transition-all p-5 flex flex-col justify-between ${
                  res.is_active
                    ? 'border-slate-200 hover:border-emerald-300 shadow-xs hover:shadow-md'
                    : 'border-slate-200 bg-slate-50/60 opacity-80'
                }`}
              >
                <div className="space-y-4">
                  {/* Card Header: Department & Status */}
                  <div className="flex items-start justify-between gap-2">
                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                      <Layers className="w-3 h-3 mr-1 text-emerald-600" />
                      {department}
                    </span>
                    <button
                      onClick={() => toggleActive(res.id, res.is_active)}
                      className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold transition-colors ${
                        res.is_active
                          ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                          : 'bg-slate-200 text-slate-600 hover:bg-slate-300'
                      }`}
                    >
                      {res.is_active ? 'Active' : 'On Break'}
                    </button>
                  </div>

                  {/* Resource Info */}
                  <div>
                    <h3 className="text-lg font-bold text-slate-900 leading-snug">
                      {res.name}
                    </h3>
                    <p className="text-xs text-slate-500 capitalize mt-0.5 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                      {res.type}
                    </p>
                  </div>

                  {/* Pricing Box - Total Cash Fee */}
                  <div className="bg-slate-50 rounded-xl p-3.5 border border-slate-100 flex items-center justify-between">
                    <div>
                      <p className="text-[10px] uppercase font-bold text-slate-500 tracking-wider flex items-center gap-1">
                        <IndianRupee className="w-3 h-3 text-emerald-600" />
                        Total Fee
                      </p>
                      <p className="text-xl font-bold text-slate-900 mt-0.5">
                        ₹{Number(price).toFixed(0)}
                      </p>
                    </div>
                    <span className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200">
                      Pay Total Cash
                    </span>
                  </div>

                  {/* Slot Details */}
                  <div className="flex items-center justify-between text-xs text-slate-500 pt-1">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5 text-slate-400" />
                      {res.duration_minutes} mins / slot
                    </span>
                    <span>Max {res.capacity} concurrent</span>
                  </div>
                </div>

                {/* Footer Toggle & Delete */}
                <div className="pt-4 mt-4 border-t border-slate-100 flex items-center justify-between">
                  <span className="text-[11px] text-slate-400 font-mono">
                    ID: {res.id.substring(0, 8)}
                  </span>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => toggleActive(res.id, res.is_active)}
                      className="text-xs font-bold text-slate-600 hover:text-emerald-700 transition-colors"
                    >
                      {res.is_active ? 'Pause Bookings' : 'Reactivate Unit'}
                    </button>
                    <button
                      onClick={() => handleDeleteResource(res.id, res.name)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                      title={`Delete ${res.name}`}
                      aria-label={`Delete ${res.name}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function ResourcesManagementPage() {
  return (
    <Suspense fallback={
      <div className="max-w-7xl mx-auto px-4 py-16 text-center text-slate-500">
        Loading doctors and departments...
      </div>
    }>
      <ResourcesManagementContent />
    </Suspense>
  );
}

