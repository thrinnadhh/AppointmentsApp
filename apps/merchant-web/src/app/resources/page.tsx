'use client';

import React, { useState, useEffect, useCallback, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { 
  Users, 
  UserPlus,
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
  CheckCircle2,
  Edit3,
  KeyRound,
  Mail,
  Eye,
  EyeOff,
  ShieldCheck,
  AlertTriangle
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

  const { activeProvider: tenantProvider, verticalConfig, isSuperAdmin, isHospitalAdmin, isLocked } = useMerchantTenant();

  const [providers, setProviders] = useState<Provider[]>(tenantProvider ? [tenantProvider] : []);
  const [selectedProviderId, setSelectedProviderId] = useState<string>(
    providerParam || tenantProvider?.id || ''
  );
  const [resources, setResources] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [feedbackToast, setFeedbackToast] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDepartment, setSelectedDepartment] = useState('all');
  const [showPassword, setShowPassword] = useState(false);
  const [showEditPassword, setShowEditPassword] = useState(false);

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
    doctorEmail?: string;
    doctorPassword?: string;
  }>({
    name: '',
    type: defaultResourceType,
    department: '',
    price: verticalConfig.defaultPrice,
    deposit_amount: verticalConfig.defaultPrice,
    duration_minutes: verticalConfig.defaultDurationMinutes,
    capacity: verticalConfig.id === 'gaming' ? 14 : (verticalConfig.id === 'restaurants' ? 4 : 1),
    specialization: '',
    doctorEmail: '',
    doctorPassword: '',
  });

  // Edit Resource Modal State
  const [editingResource, setEditingResource] = useState<Resource | null>(null);
  const [editFormData, setEditFormData] = useState<{
    name: string;
    type: ResourceType;
    department: string;
    price: number;
    deposit_amount: number;
    duration_minutes: number;
    capacity: number;
    doctorEmail?: string;
    doctorPassword?: string;
  }>({
    name: '',
    type: defaultResourceType,
    department: '',
    price: verticalConfig.defaultPrice,
    deposit_amount: verticalConfig.defaultPrice,
    duration_minutes: verticalConfig.defaultDurationMinutes,
    capacity: 1,
    doctorEmail: '',
    doctorPassword: '',
  });
  const [isUpdatingResource, setIsUpdatingResource] = useState(false);

  // Doctor Emergency Cancellation Modal State
  const [emergencyResource, setEmergencyResource] = useState<Resource | null>(null);
  const [emergencyReason, setEmergencyReason] = useState('Doctor Acute Medical Emergency / Unscheduled Departure');
  const [isEmergencySubmitting, setIsEmergencySubmitting] = useState(false);

  const handleConfirmEmergencyCancel = async () => {
    if (!emergencyResource) return;
    setIsEmergencySubmitting(true);
    try {
      const res = await fetch('/api/doctor/emergency-cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          doctor_resource_id: emergencyResource.id,
          reason: emergencyReason
        })
      });
      const data = await res.json();
      if (data.success) {
        setFeedbackToast(`🚨 Emergency cancelled ${data.cancelled_count} appointments for ${emergencyResource.name}. 100% full refund initiated.`);
        setEmergencyResource(null);
        await loadData();
      } else {
        setFeedbackToast(`⚠️ ${data.error || 'Failed to execute emergency cancellation'}`);
      }
    } catch (e: any) {
      setFeedbackToast(`⚠️ Error: ${e.message}`);
    } finally {
      setIsEmergencySubmitting(false);
      setTimeout(() => setFeedbackToast(null), 5000);
    }
  };

  // Keep selectedProviderId and formData in sync with tenant context
  useEffect(() => {
    const activeId = providerParam || tenantProvider?.id;
    if (activeId && !selectedProviderId) {
      setSelectedProviderId(activeId);
    }
    if (tenantProvider) {
      setProviders((prev) => {
        if (!prev.some((p) => p.id === tenantProvider.id)) {
          return [tenantProvider, ...prev];
        }
        return prev;
      });
      if (!isSuperAdmin) {
        setFormData((prev) => ({
          ...prev,
          type: defaultResourceType,
          department: '',
          price: verticalConfig.defaultPrice,
          deposit_amount: verticalConfig.defaultPrice,
          duration_minutes: verticalConfig.defaultDurationMinutes,
        }));
      }
    }
  }, [tenantProvider, isSuperAdmin, verticalConfig, defaultResourceType, providerParam, selectedProviderId]);

  const loadData = useCallback(async () => {
    const activeId = selectedProviderId || providerParam || tenantProvider?.id;
    if (!activeId && !isSuperAdmin) {
      setLoading(false);
      setResources([]);
      return;
    }
    setLoading(true);
    try {
      const [fetchedProviders, fetchedResources] = await Promise.all([
        isSuperAdmin ? fetchAllProviders() : Promise.resolve(tenantProvider ? [tenantProvider] : []),
        activeId ? fetchProviderResources(activeId) : Promise.resolve([]),
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

    const targetProviderId = selectedProviderId || providerParam || tenantProvider?.id;
    if (!targetProviderId) {
      setFeedbackToast('Error: No active business venue selected.');
      return;
    }

    if (formData.duration_minutes < 0) {
      setFeedbackToast('Error: Slot duration cannot be less than zero.');
      return;
    }

    try {
      const res = await fetch('/api/admin/resources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerId: targetProviderId,
          name: formData.name.trim(),
          type: formData.type,
          department: formData.department.trim() || 'General',
          price: Number(formData.price),
          depositAmount: Number(formData.price),
          durationMinutes: Number(formData.duration_minutes),
          capacity: Number(formData.capacity),
          doctorEmail: formData.doctorEmail?.trim() || undefined,
          doctorPassword: formData.doctorPassword || undefined,
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
        doctorEmail: '',
        doctorPassword: '',
      });
      setTimeout(() => setFeedbackToast(null), 5000);
    }
  };

  const handleStartEditResource = (res: Resource) => {
    const resAttr = (res as any)?.attributes || {};
    setEditingResource(res);
    setEditFormData({
      name: res.name,
      type: res.type,
      department: res.department || '',
      price: res.price ?? verticalConfig.defaultPrice,
      deposit_amount: res.deposit_amount ?? verticalConfig.defaultPrice,
      duration_minutes: res.duration_minutes ?? verticalConfig.defaultDurationMinutes,
      capacity: res.capacity ?? 1,
      doctorEmail: resAttr.email || '',
      doctorPassword: '',
    });
  };

  const handleUpdateResource = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingResource) return;
    if (!editFormData.name?.trim()) {
      setFeedbackToast('Error: Name cannot be empty.');
      return;
    }

    setIsUpdatingResource(true);
    try {
      const res = await fetch('/api/admin/resources', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingResource.id,
          name: editFormData.name.trim(),
          type: editFormData.type,
          department: editFormData.department.trim() || 'General',
          price: Number(editFormData.price),
          depositAmount: Number(editFormData.price),
          durationMinutes: Number(editFormData.duration_minutes),
          capacity: Number(editFormData.capacity),
          doctorEmail: editFormData.doctorEmail?.trim() || undefined,
          doctorPassword: editFormData.doctorPassword || undefined,
        }),
      });

      const json = await res.json();
      if (!res.ok || json.error) {
        throw new Error(json.error || 'Failed to update resource');
      }

      setFeedbackToast(`${verticalConfig.resourceLabelSingular} "${editFormData.name}" updated successfully.`);
      setEditingResource(null);
      await loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error updating resource';
      setFeedbackToast(`Error: ${msg}`);
    } finally {
      setIsUpdatingResource(false);
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

      {/* Desk Manager Role Banner */}
      {!isHospitalAdmin && (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 px-4 py-3 rounded-xl flex items-center justify-between text-xs shadow-xs animate-fade-in">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-amber-600 shrink-0" />
            <span>
              <strong>Desk Manager Mode:</strong> Registering new {verticalConfig.resourceLabelPlural.toLowerCase()} is restricted to the primary Hospital Administrator. Desk managers have operational queue access.
            </span>
          </div>
          <span className="px-2 py-0.5 rounded font-bold bg-amber-100 text-amber-800 text-[10px] uppercase tracking-wide">
            View Only
          </span>
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

          {isHospitalAdmin && selectedVenue && (
            <Link
              href={`/team?providerId=${selectedVenue.id}`}
              className="inline-flex items-center px-3.5 py-2.5 rounded-xl text-sm font-semibold border border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 transition shadow-xs"
              title="Manage Team & Assign Front Desk Managers to Doctors"
            >
              <UserPlus className="w-4 h-4 mr-1.5 text-emerald-700" />
              Manage Team & Desk Assignments
            </Link>
          )}

          {isHospitalAdmin ? (
            <button
              onClick={() => setIsAdding(true)}
              className="inline-flex items-center px-4 py-2.5 rounded-xl text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition shadow-sm cursor-pointer"
            >
              <Plus className="w-4 h-4 mr-1.5" />
              Add {verticalConfig.resourceLabelSingular} / Service
            </button>
          ) : (
            <div className="relative group">
              <button
                disabled
                className="inline-flex items-center px-4 py-2.5 rounded-xl text-sm font-semibold bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed opacity-40 shadow-none transition"
                title="Restricted: Only Hospital Administrator can add doctors"
                aria-label="Add doctor disabled for desk managers"
              >
                <Plus className="w-4 h-4 mr-1.5" />
                Add {verticalConfig.resourceLabelSingular} / Service
              </button>
              <div className="absolute right-0 top-full mt-1.5 hidden group-hover:flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 text-white text-xs rounded-lg shadow-lg whitespace-nowrap z-30">
                <ShieldCheck className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span>Only Hospital Administrator can add doctors</span>
              </div>
            </div>
          )}
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
                    min="0"
                    step="any"
                    value={formData.duration_minutes}
                    onChange={(e) => {
                      const val = e.target.value === '' ? 0 : Number(e.target.value);
                      setFormData({ ...formData, duration_minutes: val });
                    }}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  />
                  <span className="text-[11px] text-slate-500">Can be any number (0 or higher)</span>
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

              {/* Doctor / Staff Portal Login Credentials */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-emerald-100 text-emerald-800 flex items-center justify-center">
                    <KeyRound className="w-3.5 h-3.5" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-900">
                      {verticalConfig.resourceLabelSingular} Portal Login Credentials (Optional)
                    </h4>
                    <p className="text-[11px] text-slate-500">
                      Provision direct email and password so the {verticalConfig.resourceLabelSingular.toLowerCase()} can log in to their dashboard
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                  <div>
                    <label htmlFor="doctor-email" className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Login Email
                    </label>
                    <div className="relative">
                      <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                      <input
                        id="doctor-email"
                        name="doctorEmail"
                        type="email"
                        value={formData.doctorEmail || ''}
                        onChange={(e) => setFormData({ ...formData, doctorEmail: e.target.value })}
                        placeholder="doctor@hospital.com"
                        className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-xs text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:outline-none bg-white"
                      />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="doctor-password" className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Temporary Password (min 6 chars)
                    </label>
                    <div className="relative">
                      <input
                        id="doctor-password"
                        name="doctorPassword"
                        type={showPassword ? 'text' : 'password'}
                        value={formData.doctorPassword || ''}
                        onChange={(e) => setFormData({ ...formData, doctorPassword: e.target.value })}
                        placeholder="••••••••"
                        className="w-full px-3 py-2 pr-9 border border-slate-300 rounded-lg text-xs text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:outline-none bg-white font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600"
                        title={showPassword ? 'Hide password' : 'Show password'}
                      >
                        {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
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

      {/* Edit Doctor / Resource Modal */}
      {editingResource && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 sm:p-8 shadow-xl border border-slate-200 relative animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-800 flex items-center justify-center font-bold">
                  <Edit3 className="w-4 h-4 text-emerald-600" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900">Edit {verticalConfig.resourceLabelSingular} Details</h3>
                  <p className="text-xs text-slate-500">Update name, department, consultation fee, and slot duration</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditingResource(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
                aria-label="Close modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleUpdateResource} className="mt-6 space-y-4">
              <div>
                <label htmlFor="edit-doctor-name" className="block text-xs font-semibold text-slate-700 mb-1">
                  {verticalConfig.resourceLabelSingular} Full Name *
                </label>
                <input
                  id="edit-doctor-name"
                  type="text"
                  required
                  value={editFormData.name}
                  onChange={(e) => setEditFormData({ ...editFormData, name: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="edit-doctor-department" className="block text-xs font-semibold text-slate-700 mb-1">
                  Department / Specialty
                </label>
                <input
                  id="edit-doctor-department"
                  type="text"
                  value={editFormData.department}
                  onChange={(e) => setEditFormData({ ...editFormData, department: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="edit-doctor-fee" className="block text-xs font-semibold text-slate-700 mb-1">
                    {verticalConfig.actionVerb} Fee (₹)
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-2 text-slate-400 text-sm">₹</span>
                    <input
                      id="edit-doctor-fee"
                      type="number"
                      min="0"
                      step="50"
                      value={editFormData.price}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        setEditFormData({ ...editFormData, price: val, deposit_amount: val });
                      }}
                      className="w-full pl-7 pr-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:outline-none font-semibold font-mono"
                    />
                  </div>
                  <span className="text-[11px] text-slate-500">Applies to future bookings</span>
                </div>

                <div>
                  <label htmlFor="edit-doctor-duration" className="block text-xs font-semibold text-slate-700 mb-1">
                    Slot Duration (Mins)
                  </label>
                  <input
                    id="edit-doctor-duration"
                    type="number"
                    min="1"
                    step="1"
                    value={editFormData.duration_minutes}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      setEditFormData({ ...editFormData, duration_minutes: val });
                    }}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:outline-none font-mono"
                  />
                  <span className="text-[11px] text-slate-500">Standard consultation length</span>
                </div>
              </div>

              <div>
                <label htmlFor="edit-doctor-capacity" className="block text-xs font-semibold text-slate-700 mb-1">
                  Concurrent Capacity
                </label>
                <input
                  id="edit-doctor-capacity"
                  type="number"
                  min="1"
                  value={editFormData.capacity}
                  onChange={(e) => setEditFormData({ ...editFormData, capacity: Number(e.target.value) })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:outline-none font-mono"
                />
              </div>

              {/* Doctor Portal Login Credentials Edit */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-emerald-100 text-emerald-800 flex items-center justify-center">
                    <KeyRound className="w-3.5 h-3.5" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-900">
                      {verticalConfig.resourceLabelSingular} Portal Login Credentials
                    </h4>
                    <p className="text-[11px] text-slate-500">
                      Manage or reset {verticalConfig.resourceLabelSingular.toLowerCase()}&apos;s direct login email and OPD console password
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                  <div>
                    <label htmlFor="edit-doctor-email" className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Login Email
                    </label>
                    <div className="relative">
                      <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                      <input
                        id="edit-doctor-email"
                        name="editDoctorEmail"
                        type="email"
                        value={editFormData.doctorEmail || ''}
                        onChange={(e) => setEditFormData({ ...editFormData, doctorEmail: e.target.value })}
                        placeholder="doctor@hospital.com"
                        className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-xs text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:outline-none bg-white"
                      />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="edit-doctor-password" className="block text-[11px] font-semibold text-slate-700 mb-1">
                      New Password (Optional)
                    </label>
                    <div className="relative">
                      <input
                        id="edit-doctor-password"
                        name="editDoctorPassword"
                        type={showEditPassword ? 'text' : 'password'}
                        value={editFormData.doctorPassword || ''}
                        onChange={(e) => setEditFormData({ ...editFormData, doctorPassword: e.target.value })}
                        placeholder="Leave blank to keep current"
                        className="w-full px-3 py-2 pr-9 border border-slate-300 rounded-lg text-xs text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:outline-none bg-white font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => setShowEditPassword(!showEditPassword)}
                        className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600"
                        title={showEditPassword ? 'Hide password' : 'Show password'}
                      >
                        {showEditPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditingResource(null)}
                  className="px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isUpdatingResource}
                  className="px-5 py-2 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-sm transition-colors flex items-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  {isUpdatingResource ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4" />
                      Save Changes
                    </>
                  )}
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

                  {/* Doctor Portal Login Account Status */}
                  <div className="bg-slate-50/80 rounded-xl p-2.5 border border-slate-100 flex items-center justify-between text-xs">
                    <span className="text-[11px] text-slate-500 font-medium flex items-center gap-1.5">
                      <KeyRound className="w-3.5 h-3.5 text-slate-400" />
                      Login Access:
                    </span>
                    {(res as any)?.attributes?.email ? (
                      <span className="font-mono text-[11px] font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md truncate max-w-[170px]" title={(res as any)?.attributes?.email}>
                        {(res as any)?.attributes?.email}
                      </span>
                    ) : (
                      <span className="text-[11px] text-slate-400 italic">
                        No login set
                      </span>
                    )}
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

                {/* Footer Toggle & Actions */}
                <div className="pt-4 mt-4 border-t border-slate-100 flex items-center justify-between">
                  <Link
                    href={`/team?providerId=${res.provider_id}&doctorId=${res.id}`}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-emerald-50 text-emerald-700 hover:bg-emerald-100 hover:text-emerald-800 border border-emerald-200/70 transition-colors shadow-2xs"
                    title="Assign Front Desk Managers for this doctor"
                  >
                    <UserPlus className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Assign Front Desk</span>
                  </Link>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setEmergencyResource(res)}
                      className="p-1.5 rounded-lg text-amber-600 hover:text-amber-800 hover:bg-amber-50 transition-colors cursor-pointer"
                      title={`Doctor Emergency Cancellation for ${res.name}`}
                      aria-label={`Emergency Cancel for ${res.name}`}
                    >
                      <AlertTriangle className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleStartEditResource(res)}
                      className="p-1.5 rounded-lg text-slate-500 hover:text-emerald-700 hover:bg-emerald-50 transition-colors cursor-pointer"
                      title={`Edit ${res.name} details & credentials`}
                      aria-label={`Edit ${res.name}`}
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleActive(res.id, res.is_active)}
                      className="text-xs font-bold text-slate-600 hover:text-emerald-700 transition-colors cursor-pointer"
                    >
                      {res.is_active ? 'Pause' : 'Activate'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteResource(res.id, res.name)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
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

      {/* Doctor Emergency Cancellation Confirmation Modal */}
      {emergencyResource && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2.5 rounded-xl bg-amber-50 text-amber-700 border border-amber-200">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-bold text-slate-900">
                  Doctor Emergency Cancellation
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Unscheduled Medical Departure for <span className="font-bold text-slate-800">{emergencyResource.name}</span>
                </p>
              </div>
              <button
                onClick={() => setEmergencyResource(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3.5 rounded-xl bg-amber-50/70 border border-amber-200 text-xs text-amber-950 space-y-1.5">
              <p className="font-bold text-amber-900 flex items-center gap-1.5">
                <span>⚠️ Force Majeure Medical Exception</span>
              </p>
              <p className="text-[11px] leading-relaxed text-amber-900">
                This will immediately cancel all remaining appointments for this doctor today.
                Every affected patient receives an automated SMS and a <span className="font-bold underline">100% full refund</span>.
                Because this is an authorized medical emergency, <span className="font-bold">ZERO merchant cancellation strikes</span> will be applied to your clinic.
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Reason for Emergency Cancellation
              </label>
              <input
                type="text"
                value={emergencyReason}
                onChange={(e) => setEmergencyReason(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-800"
                placeholder="Reason provided to patients"
              />
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setEmergencyResource(null)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 transition cursor-pointer"
                disabled={isEmergencySubmitting}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmEmergencyCancel}
                disabled={isEmergencySubmitting}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-rose-600 text-white hover:bg-rose-700 transition shadow-sm flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {isEmergencySubmitting ? 'Cancelling Schedule...' : 'Confirm Emergency Cancellation'}
              </button>
            </div>
          </div>
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

