'use client';

import React, { useState, useEffect, useCallback, Suspense } from 'react';
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
  Layers, 
  IndianRupee, 
  BadgePercent,
  Search,
  Filter
} from 'lucide-react';
import { 
  supabase, 
  fetchAllProviders, 
  fetchProviderResources,
  Provider 
} from '@/lib/supabase';
import { INITIAL_RESOURCES, INITIAL_MERCHANT_PROVIDER } from '@/lib/mock-data';
import { Resource, ResourceType } from '@appointments/shared';

const DEPARTMENT_SUGGESTIONS = [
  'General Medicine',
  'Cardiology',
  'Orthopedics',
  'Pediatrics',
  'Dental & Implantology',
  'Dermatology & Skin',
  'Neurology',
  'General Surgery',
  'Hair Styling & Spa',
  'Cricket Arena & Turf',
];

function ResourcesManagementContent() {
  const searchParams = useSearchParams();
  const providerParam = searchParams.get('providerId');

  const [providers, setProviders] = useState<Provider[]>([INITIAL_MERCHANT_PROVIDER]);
  const [selectedProviderId, setSelectedProviderId] = useState<string>(
    providerParam || INITIAL_MERCHANT_PROVIDER.id
  );
  const [resources, setResources] = useState<Resource[]>(INITIAL_RESOURCES);
  const [loading, setLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [feedbackToast, setFeedbackToast] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDepartment, setSelectedDepartment] = useState('all');

  const [formData, setFormData] = useState({
    name: '',
    type: 'doctor' as ResourceType,
    department: 'General Medicine',
    price: 500,
    deposit_amount: 50,
    duration_minutes: 30,
    capacity: 1,
    specialization: '',
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [fetchedProviders, fetchedResources] = await Promise.all([
        fetchAllProviders(),
        fetchProviderResources(selectedProviderId),
      ]);

      if (fetchedProviders && fetchedProviders.length > 0) {
        setProviders(fetchedProviders);
        if (providerParam && fetchedProviders.some((p) => p.id === providerParam)) {
          setSelectedProviderId(providerParam);
        }
      }
      if (fetchedResources && fetchedResources.length > 0) {
        setResources(fetchedResources as Resource[]);
      }
    } catch (err) {
      console.warn('Fallback to local resources:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedProviderId, providerParam]);

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
          depositAmount: Number(formData.deposit_amount),
          durationMinutes: Number(formData.duration_minutes),
          capacity: Number(formData.capacity),
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Failed to create resource');
      }

      setFeedbackToast(`Added "${formData.name}" in Department "${formData.department}" (Fee: ₹${formData.price})!`);
      await loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error adding resource';
      setFeedbackToast(`Error: ${msg}`);
    } finally {
      setIsAdding(false);
      setFormData({
        name: '',
        type: 'doctor',
        department: 'General Medicine',
        price: 500,
        deposit_amount: 50,
        duration_minutes: 30,
        capacity: 1,
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
      setFeedbackToast(`Doctor / Unit status updated.`);
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

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Toast */}
      {feedbackToast && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 px-4 py-3 rounded-xl flex items-center justify-between text-sm shadow-sm animate-fade-in">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-emerald-600" />
            <span className="font-semibold">{feedbackToast}</span>
          </div>
          <span className="text-xs bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded font-mono">
            Database Live
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
            <span className="text-xs text-slate-500">• Individual Pricing & Booking Deposits</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
            Doctors, Departments & Services
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Assign doctors to departments (Cardiology, Ortho, Dental) and set custom appointment fees and slot deposits.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Venue Selector */}
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
            Add Doctor / Service
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
            aria-label="Search doctor name or department"
            type="text"
            placeholder="Search doctor name or department..."
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
                  <Stethoscope className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900">Add Doctor / Service Unit</h3>
                  <p className="text-xs text-slate-500">Configure department, consultation fee, and booking deposit</p>
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
                    Doctor / Specialist Name *
                  </label>
                  <input
                    id="doctor-name"
                    name="doctorName"
                    aria-label="Doctor or Specialist Name"
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="e.g. Dr. A. V. Ramana Rao, MD (Cardiology)"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label htmlFor="doctor-department" className="block text-xs font-semibold text-slate-700 mb-1">
                    Department *
                  </label>
                  <input
                    id="doctor-department"
                    name="doctorDepartment"
                    aria-label="Department"
                    type="text"
                    required
                    list="dept-list"
                    value={formData.department}
                    onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                    placeholder="e.g. Cardiology, Orthopedics, Dental"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  />
                  <datalist id="dept-list">
                    {DEPARTMENT_SUGGESTIONS.map((d) => (
                      <option key={d} value={d} />
                    ))}
                  </datalist>
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
                    Appointment Price (₹) *
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-2 text-slate-400 font-bold text-sm">₹</span>
                    <input
                      id="doctor-price"
                      name="doctorPrice"
                      aria-label="Appointment Price in Rupees"
                      type="number"
                      required
                      min="0"
                      step="50"
                      value={formData.price}
                      onChange={(e) => setFormData({ ...formData, price: Number(e.target.value) })}
                      className="w-full pl-7 pr-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:outline-none font-semibold"
                    />
                  </div>
                  <span className="text-[11px] text-slate-500">Total consultation / service charge</span>
                </div>

                <div>
                  <label htmlFor="doctor-deposit" className="block text-xs font-semibold text-slate-700 mb-1">
                    Slot Advance Deposit (₹) *
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-2 text-slate-400 font-bold text-sm">₹</span>
                    <input
                      id="doctor-deposit"
                      name="doctorDeposit"
                      aria-label="Slot Advance Deposit in Rupees"
                      type="number"
                      required
                      min="0"
                      step="10"
                      value={formData.deposit_amount}
                      onChange={(e) => setFormData({ ...formData, deposit_amount: Number(e.target.value) })}
                      className="w-full pl-7 pr-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:outline-none font-semibold"
                    />
                  </div>
                  <span className="text-[11px] text-slate-500">Advance token to lock appointment</span>
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
                  Save Doctor / Unit
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
          Loading doctors and departments...
        </div>
      ) : filteredResources.length === 0 ? (
        <div className="py-16 text-center bg-white rounded-2xl border border-slate-200 p-8">
          <Users className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-base font-bold text-slate-800">No doctors or units found</p>
          <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
            Click &quot;Add Doctor / Service&quot; to assign the first doctor, department, and consultation price.
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

                  {/* Doctor Info */}
                  <div>
                    <h3 className="text-lg font-bold text-slate-900 leading-snug">
                      {res.name}
                    </h3>
                    <p className="text-xs text-slate-500 capitalize mt-0.5 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                      {res.type}
                    </p>
                  </div>

                  {/* Pricing Box */}
                  <div className="bg-slate-50 rounded-xl p-3.5 border border-slate-100 grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-[10px] uppercase font-bold text-slate-500 tracking-wider flex items-center gap-1">
                        <IndianRupee className="w-3 h-3 text-slate-400" />
                        Fee / Price
                      </p>
                      <p className="text-lg font-bold text-slate-900 mt-0.5">
                        ₹{Number(price).toFixed(0)}
                      </p>
                    </div>

                    <div>
                      <p className="text-[10px] uppercase font-bold text-slate-500 tracking-wider flex items-center gap-1">
                        <BadgePercent className="w-3 h-3 text-emerald-600" />
                        Advance Deposit
                      </p>
                      <p className="text-lg font-bold text-emerald-700 mt-0.5">
                        ₹{Number(deposit).toFixed(0)}
                      </p>
                    </div>
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

                {/* Footer Toggle */}
                <div className="pt-4 mt-4 border-t border-slate-100 flex items-center justify-between">
                  <span className="text-[11px] text-slate-400 font-mono">
                    ID: {res.id.substring(0, 8)}
                  </span>
                  <button
                    onClick={() => toggleActive(res.id, res.is_active)}
                    className="text-xs font-bold text-slate-600 hover:text-emerald-700 transition-colors"
                  >
                    {res.is_active ? 'Pause Bookings' : 'Reactivate Unit'}
                  </button>
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

