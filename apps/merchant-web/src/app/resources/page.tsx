'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { 
  Users, 
  Plus, 
  Clock, 
  Check, 
  X,
  Sparkles,
  RefreshCw,
  Building2
} from 'lucide-react';
import { 
  supabase, 
  fetchAllProviders, 
  fetchProviderResources 
} from '@/lib/supabase';
import { INITIAL_RESOURCES, INITIAL_MERCHANT_PROVIDER } from '@/lib/mock-data';
import { Resource, ResourceType, Provider } from '@appointments/shared';

export default function ResourcesManagementPage() {
  const [providers, setProviders] = useState<Provider[]>([INITIAL_MERCHANT_PROVIDER]);
  const [selectedProviderId, setSelectedProviderId] = useState<string>(INITIAL_MERCHANT_PROVIDER.id);
  const [resources, setResources] = useState<Resource[]>(INITIAL_RESOURCES);
  const [loading, setLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [feedbackToast, setFeedbackToast] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    type: 'doctor' as ResourceType,
    duration_minutes: 30,
    capacity: 1,
    deposit_amount: 100,
    specialization: '',
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [fetchedProviders, fetchedResources] = await Promise.all([
        fetchAllProviders(),
        fetchProviderResources(selectedProviderId)
      ]);

      if (fetchedProviders && fetchedProviders.length > 0) {
        setProviders(fetchedProviders);
      }
      if (fetchedResources && fetchedResources.length > 0) {
        setResources(fetchedResources as Resource[]);
      }
    } catch (err) {
      console.warn('Fallback to local resources:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedProviderId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleCreateResource = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name) return;

    try {
      const { data, error } = await supabase
        .from('resources')
        .insert({
          provider_id: selectedProviderId,
          name: formData.name,
          type: formData.type,
          duration_minutes: Number(formData.duration_minutes),
          capacity: Number(formData.capacity),
          deposit_amount: Number(formData.deposit_amount),
          attributes: { specialization: formData.specialization },
          is_active: true,
        })
        .select();

      if (error) throw error;
      setFeedbackToast(`Created "${formData.name}" successfully on Supabase!`);
      await loadData();
    } catch (err) {
      console.warn('Saving resource locally due to error:', err);
      const newRes: Resource = {
        id: `res-${Date.now()}`,
        provider_id: selectedProviderId,
        name: formData.name,
        type: formData.type,
        duration_minutes: Number(formData.duration_minutes),
        capacity: Number(formData.capacity),
        deposit_amount: Number(formData.deposit_amount),
        attributes: { specialization: formData.specialization },
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      setResources([...resources, newRes]);
      setFeedbackToast(`Added "${formData.name}" locally`);
    } finally {
      setIsAdding(false);
      setFormData({
        name: '',
        type: 'doctor',
        duration_minutes: 30,
        capacity: 1,
        deposit_amount: 100,
        specialization: '',
      });
      setTimeout(() => setFeedbackToast(null), 4000);
    }
  };

  const toggleActive = async (id: string, currentActive: boolean) => {
    try {
      await supabase
        .from('resources')
        .update({ is_active: !currentActive, updated_at: new Date().toISOString() })
        .eq('id', id);
      setFeedbackToast(`Resource status updated on Supabase.`);
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

  return (
    <div className="space-y-6">
      {/* Toast */}
      {feedbackToast && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 px-4 py-3 rounded-xl flex items-center justify-between text-sm shadow-sm">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-emerald-600" />
            <span className="font-semibold">{feedbackToast}</span>
          </div>
          <span className="text-xs bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded font-mono">Supabase Live</span>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Staff & Bookable Units</h1>
          <p className="text-sm text-slate-500 mt-1">
            Configure doctors, tables, stylists, and set required booking deposit amounts
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Provider Filter */}
          <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-xl px-3 py-1.5 shadow-sm">
            <Building2 className="w-3.5 h-3.5 text-slate-400" />
            <label htmlFor="resource-venue-select" className="sr-only">Select Venue</label>
            <select
              id="resource-venue-select"
              value={selectedProviderId}
              onChange={(e) => setSelectedProviderId(e.target.value)}
              className="text-xs font-semibold text-slate-800 bg-transparent focus:outline-none cursor-pointer"
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={() => loadData()}
            disabled={loading}
            className="p-2 rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition shadow-sm"
            title="Refresh Resources"
            aria-label="Refresh Resources"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-emerald-600' : ''}`} />
          </button>

          <button
            onClick={() => setIsAdding(true)}
            className="inline-flex items-center px-4 py-2 rounded-xl text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition shadow-sm"
          >
            <Plus className="w-4 h-4 mr-1.5" />
            Add New Unit
          </button>
        </div>
      </div>

      {/* Add Resource Modal / Form */}
      {isAdding && (
        <div className="bg-white rounded-2xl border border-emerald-200 p-6 shadow-md animate-fade-in">
          <div className="flex items-center justify-between mb-4 border-b border-slate-100 pb-3">
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-emerald-600" />
              New Bookable Unit in Supabase
            </h2>
            <button onClick={() => setIsAdding(false)} className="text-slate-400 hover:text-slate-600">
              <X className="w-5 h-5" />
            </button>
          </div>

          <form onSubmit={handleCreateResource} className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <label htmlFor="resource-name" className="block text-xs font-semibold text-slate-700 mb-1">Resource / Staff Name</label>
              <input
                id="resource-name"
                name="resourceName"
                aria-label="Resource or Staff Name"
                type="text"
                placeholder="e.g. Dr. K. Raman (General Physician) or VIP Table 2"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
                className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-emerald-500 outline-none"
              />
            </div>

            <div>
              <label htmlFor="resource-type" className="block text-xs font-semibold text-slate-700 mb-1">Unit Type</label>
              <select
                id="resource-type"
                name="resourceType"
                aria-label="Resource Unit Type"
                value={formData.type}
                onChange={(e) => setFormData({ ...formData, type: e.target.value as ResourceType })}
                className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-emerald-500 outline-none bg-white"
              >
                <option value="doctor">Doctor / Specialist</option>
                <option value="table">Table / Booth</option>
                <option value="court">Turf / Court / Console</option>
                <option value="stylist">Stylist / Chair</option>
                <option value="vet">Veterinarian</option>
                <option value="groomer">Groomer</option>
              </select>
            </div>

            <div>
              <label htmlFor="resource-duration" className="block text-xs font-semibold text-slate-700 mb-1">Slot Duration (Minutes)</label>
              <input
                id="resource-duration"
                name="resourceDuration"
                aria-label="Slot Duration in Minutes"
                type="number"
                min="10"
                step="5"
                value={formData.duration_minutes}
                onChange={(e) => setFormData({ ...formData, duration_minutes: Number(e.target.value) })}
                className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-emerald-500 outline-none"
              />
            </div>

            <div>
              <label htmlFor="resource-capacity" className="block text-xs font-semibold text-slate-700 mb-1">Capacity (Persons)</label>
              <input
                id="resource-capacity"
                name="resourceCapacity"
                aria-label="Resource Capacity"
                type="number"
                min="1"
                value={formData.capacity}
                onChange={(e) => setFormData({ ...formData, capacity: Number(e.target.value) })}
                className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-emerald-500 outline-none"
              />
            </div>

            <div>
              <label htmlFor="resource-deposit" className="block text-xs font-semibold text-slate-700 mb-1">
                Deposit to Confirm (₹)
              </label>
              <input
                id="resource-deposit"
                name="resourceDeposit"
                aria-label="Deposit to Confirm in Rupees"
                type="number"
                min="0"
                step="10"
                value={formData.deposit_amount}
                onChange={(e) => setFormData({ ...formData, deposit_amount: Number(e.target.value) })}
                className="w-full px-3 py-2 border border-emerald-300 rounded-xl text-xs focus:ring-2 focus:ring-emerald-500 outline-none font-semibold text-emerald-800"
              />
            </div>

            <div className="md:col-span-3 flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsAdding(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2 rounded-xl text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm"
              >
                Save to Supabase
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Resources Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {resources.map((res) => (
          <div
            key={res.id}
            className={`p-5 rounded-2xl border transition bg-white shadow-sm flex flex-col justify-between ${
              res.is_active ? 'border-slate-200' : 'border-slate-200 opacity-60 bg-slate-50'
            }`}
          >
            <div>
              <div className="flex items-start justify-between">
                <div>
                  <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-600 mb-1">
                    {res.type}
                  </span>
                  <h2 className="text-base font-bold text-slate-900">{res.name}</h2>
                </div>
                <button
                  onClick={() => toggleActive(res.id, res.is_active)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium border transition ${
                    res.is_active
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : 'bg-slate-100 text-slate-500 border-slate-300'
                  }`}
                >
                  {res.is_active ? 'Active' : 'Paused'}
                </button>
              </div>

              {res.attributes && typeof res.attributes === 'object' && (
                <div className="mt-2 text-xs text-slate-500">
                  {Object.entries(res.attributes).map(([k, v]) => (
                    <span key={k} className="mr-3 inline-block">
                      <strong className="capitalize">{k.replace('_', ' ')}:</strong> {String(v)}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between text-xs">
              <div className="flex items-center gap-4 text-slate-600">
                <span className="flex items-center gap-1 font-medium">
                  <Clock className="w-3.5 h-3.5 text-slate-400" />
                  {res.duration_minutes} mins
                </span>
                <span className="flex items-center gap-1 font-medium">
                  <Users className="w-3.5 h-3.5 text-slate-400" />
                  Capacity: {res.capacity}
                </span>
              </div>

              <div className="text-right">
                <span className="text-xs text-slate-400 mr-1">Required Deposit:</span>
                <span className="text-sm font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-lg border border-emerald-200">
                  ₹{res.deposit_amount}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

