'use client';

import React, { useState, useEffect, useCallback, Suspense } from 'react';
import Link from 'next/link';
import { 
  Building2, 
  Layers, 
  Plus, 
  RefreshCw, 
  CheckCircle2, 
  AlertCircle, 
  Users, 
  UserPlus, 
  ShieldCheck, 
  Mail, 
  Calendar, 
  Check, 
  Trash2, 
  Clock, 
  ExternalLink,
  ChevronRight,
  Sparkles
} from 'lucide-react';
import { useMerchantTenant } from '@/contexts/MerchantTenantContext';

interface Department {
  id: string;
  merchant_id: string;
  name: string;
  is_preset: boolean;
  is_active: boolean;
  allowed_modules: ('appointments' | 'queue_schedule' | 'check_in')[];
  member_count: number;
  created_at: string;
  updated_at: string;
}

interface Member {
  id: string;
  department_id: string;
  merchant_id: string;
  email: string;
  user_id?: string | null;
  role: 'consultant' | 'front_desk';
  status: 'invited' | 'active' | 'revoked';
  invited_at: string;
  invite_expires_at: string;
  department_name?: string;
  is_expired?: boolean;
}

const PRESET_SPECIALTIES = [
  'General Medicine',
  'Cardiology',
  'Orthopedics',
  'Pediatrics',
  'Dermatology',
  'Gynecology & Obstetrics',
  'ENT',
  'Ophthalmology',
  'Neurology'
];

function DepartmentsContent() {
  const { activeProvider, isSuperAdmin, isHospitalAdmin } = useMerchantTenant();

  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successBanner, setSuccessBanner] = useState<string | null>(null);

  // Create / Edit modal state
  const [editingDept, setEditingDept] = useState<Department | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [deptName, setDeptName] = useState('');
  const [allowedModules, setAllowedModules] = useState<('appointments' | 'queue_schedule' | 'check_in')[]>([
    'appointments',
    'queue_schedule',
    'check_in'
  ]);
  const [isActive, setIsActive] = useState(true);
  const [savingDept, setSavingDept] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Member Management modal state
  const [managingDept, setManagingDept] = useState<Department | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [memberError, setMemberError] = useState<string | null>(null);

  // Invite state within member modal
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'consultant' | 'front_desk'>('consultant');
  const [inviting, setInviting] = useState(false);

  const fetchDepartments = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/hospital/departments');
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Failed to load departments');
      }
      setDepartments(json.departments || []);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error loading departments';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDepartments();
  }, [fetchDepartments]);

  const loadDepartmentMembers = async (deptId: string) => {
    setLoadingMembers(true);
    setMemberError(null);
    try {
      const res = await fetch(`/api/hospital/members?department_id=${deptId}`);
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Failed to load department members');
      }
      setMembers(json.members || []);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error loading members';
      setMemberError(msg);
    } finally {
      setLoadingMembers(false);
    }
  };

  const openManageMembers = (dept: Department) => {
    setManagingDept(dept);
    loadDepartmentMembers(dept.id);
    setInviteEmail('');
    setInviteRole('consultant');
    setMemberError(null);
  };

  const openCreateModal = () => {
    setEditingDept(null);
    setDeptName('');
    setAllowedModules(['appointments', 'queue_schedule', 'check_in']);
    setIsActive(true);
    setFormError(null);
    setIsFormOpen(true);
  };

  const openEditModal = (dept: Department) => {
    setEditingDept(dept);
    setDeptName(dept.name);
    setAllowedModules(dept.allowed_modules || ['appointments', 'queue_schedule', 'check_in']);
    setIsActive(dept.is_active);
    setFormError(null);
    setIsFormOpen(true);
  };

  const handleSaveDepartment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deptName.trim()) {
      setFormError('Department name is required');
      return;
    }

    setSavingDept(true);
    setFormError(null);

    try {
      if (editingDept) {
        // Update
        const res = await fetch('/api/hospital/departments', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: editingDept.id,
            name: deptName.trim(),
            allowed_modules: allowedModules,
            is_active: isActive,
          }),
        });
        const json = await res.json();
        if (!res.ok || !json.success) {
          throw new Error(json.error || 'Failed to update department');
        }
        setSuccessBanner(`Department "${deptName.trim()}" updated successfully.`);
      } else {
        // Create
        const isPreset = PRESET_SPECIALTIES.includes(deptName.trim());
        const res = await fetch('/api/hospital/departments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: deptName.trim(),
            is_preset: isPreset,
            allowed_modules: allowedModules,
            is_active: isActive,
          }),
        });
        const json = await res.json();
        if (!res.ok || !json.success) {
          throw new Error(json.error || 'Failed to create department');
        }
        setSuccessBanner(`Department "${deptName.trim()}" created successfully.`);
      }

      setIsFormOpen(false);
      await fetchDepartments();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error saving department';
      setFormError(msg);
    } finally {
      setSavingDept(false);
    }
  };

  const handleDeleteDepartment = async (dept: Department) => {
    if (!window.confirm(`Are you sure you want to delete "${dept.name}"? If it has active appointments, deletion will be blocked.`)) {
      return;
    }

    try {
      const res = await fetch(`/api/hospital/departments?id=${dept.id}`, {
        method: 'DELETE',
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Failed to delete department');
      }
      setSuccessBanner(`Department "${dept.name}" was removed.`);
      await fetchDepartments();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error deleting department';
      setSuccessBanner(`Error: ${msg}`);
    }
  };

  const handleInviteMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!managingDept) return;

    if (!inviteEmail.trim()) {
      setMemberError('Please enter an email address');
      return;
    }

    setInviting(true);
    setMemberError(null);

    try {
      const res = await fetch('/api/hospital/members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          department_id: managingDept.id,
          email: inviteEmail.trim().toLowerCase(),
          role: inviteRole,
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Failed to invite member');
      }

      setInviteEmail('');
      setSuccessBanner(`Invite sent to ${inviteEmail.trim()} (valid for 7 days).`);
      await Promise.all([
        loadDepartmentMembers(managingDept.id),
        fetchDepartments(),
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error inviting member';
      setMemberError(msg);
    } finally {
      setInviting(false);
    }
  };

  const handleMemberAction = async (memberId: string, action: 'resend' | 'cancel_invite' | 'revoke') => {
    if (!managingDept) return;
    try {
      const res = await fetch('/api/hospital/members', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ member_id: memberId, action }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || `Failed to perform ${action}`);
      }
      setSuccessBanner(`Member action "${action}" completed.`);
      await Promise.all([
        loadDepartmentMembers(managingDept.id),
        fetchDepartments(),
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Action failed';
      setMemberError(msg);
    }
  };

  const toggleModule = (module: 'appointments' | 'queue_schedule' | 'check_in') => {
    setAllowedModules((prev) => 
      prev.includes(module) ? prev.filter((m) => m !== module) : [...prev, module]
    );
  };

  // Access control check
  if (!isHospitalAdmin && !isSuperAdmin) {
    return (
      <div className="max-w-xl mx-auto my-16 p-8 bg-white border border-slate-200 rounded-2xl text-center shadow-sm">
        <div className="w-16 h-16 bg-rose-50 text-rose-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <ShieldCheck className="w-8 h-8" />
        </div>
        <h2 className="text-2xl font-bold text-slate-900 mb-2">Hospital Admin Access Only</h2>
        <p className="text-slate-600 mb-6">
          Department governance, clinical quotas, and staff assignments are restricted to the Hospital Administrator.
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

  const activeMembersInDept = members.filter((m) => m.status === 'active' || m.status === 'invited');
  const isDeptAtCapacity = managingDept ? (managingDept.member_count >= 3 || activeMembersInDept.length >= 3) : false;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-slate-200 pb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200">
              Governance & Clinical Units
            </span>
            <span className="text-xs text-slate-500">• Hospital Admin Master Console</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
            Departments & Clinical Units
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Configure clinical departments, assign allowed modules, and govern member limits (policy strictly enforces max 3 members per department).
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={openCreateModal}
            className="inline-flex items-center px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-xl transition shadow-sm cursor-pointer gap-2"
          >
            <Plus className="w-4 h-4" />
            <span>Create Department</span>
          </button>

          <button
            onClick={fetchDepartments}
            className="inline-flex items-center px-3.5 py-2 border border-slate-300 rounded-xl text-sm font-medium text-slate-700 bg-white hover:bg-slate-50 transition-colors shadow-xs cursor-pointer"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin text-emerald-600' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Success Notification */}
      {successBanner && (
        <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4 flex items-center justify-between text-sm text-emerald-800 shadow-xs">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
            <p className="font-medium">{successBanner}</p>
          </div>
          <button 
            onClick={() => setSuccessBanner(null)}
            className="text-xs font-bold text-emerald-700 hover:text-emerald-900 px-2 py-1 rounded cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Error Banner */}
      {error && (
        <div className="rounded-xl bg-rose-50 border border-rose-200 p-4 flex items-start gap-2.5 text-sm text-rose-800">
          <AlertCircle className="w-5 h-5 text-rose-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Failed to load departments</p>
            <p className="text-xs text-rose-700 mt-0.5">{error}</p>
          </div>
        </div>
      )}

      {/* Stats Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-5">
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Units</span>
            <Building2 className="w-5 h-5 text-emerald-600" />
          </div>
          <p className="text-2xl font-bold text-slate-900 mt-2 font-mono">{departments.length}</p>
          <p className="text-xs text-slate-500 mt-1">Configured clinical departments</p>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Active Units</span>
            <Check className="w-5 h-5 text-emerald-600" />
          </div>
          <p className="text-2xl font-bold text-slate-900 mt-2 font-mono">
            {departments.filter((d) => d.is_active).length}
          </p>
          <p className="text-xs text-slate-500 mt-1">Accepting appointments & queues</p>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Enrolled Staff</span>
            <Users className="w-5 h-5 text-teal-600" />
          </div>
          <p className="text-2xl font-bold text-slate-900 mt-2 font-mono">
            {departments.reduce((sum, d) => sum + (d.member_count || 0), 0)}
          </p>
          <p className="text-xs text-slate-500 mt-1">Across all departments</p>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Standard Presets</span>
            <Layers className="w-5 h-5 text-amber-600" />
          </div>
          <p className="text-2xl font-bold text-slate-900 mt-2 font-mono">
            {departments.filter((d) => d.is_preset).length}
          </p>
          <p className="text-xs text-slate-500 mt-1">Pre-configured specialty templates</p>
        </div>
      </div>

      {/* Departments Grid */}
      {loading ? (
        <div className="py-20 text-center text-slate-500 bg-white rounded-2xl border border-slate-200">
          <RefreshCw className="w-6 h-6 animate-spin mx-auto text-emerald-600 mb-2" />
          Loading clinical departments...
        </div>
      ) : departments.length === 0 ? (
        <div className="py-16 text-center bg-white rounded-2xl border border-slate-200 p-8 space-y-4">
          <Building2 className="w-12 h-12 text-slate-300 mx-auto" />
          <div>
            <h3 className="text-lg font-bold text-slate-800">No departments configured yet</h3>
            <p className="text-xs text-slate-500 max-w-md mx-auto mt-1">
              Add your hospital specialties (e.g. Cardiology, Orthopedics, Pediatrics) to route live OPD consultations and front desk assignments.
            </p>
          </div>
          <button
            onClick={openCreateModal}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-xl shadow-sm transition cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Create First Department</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {departments.map((dept) => {
            const count = dept.member_count || 0;
            const isFull = count >= 3;

            return (
              <div
                key={dept.id}
                className="bg-white rounded-2xl border border-slate-200 hover:border-emerald-300 transition-all p-5 shadow-xs flex flex-col justify-between space-y-4"
              >
                <div>
                  {/* Card Header */}
                  <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                          dept.is_preset 
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-200' 
                            : 'bg-slate-100 text-slate-700 border-slate-200'
                        }`}>
                          {dept.is_preset ? 'Preset Specialty' : 'Custom Specialty'}
                        </span>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          dept.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'
                        }`}>
                          {dept.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                      <h3 className="text-lg font-bold text-slate-900 flex items-center gap-1.5">
                        <Building2 className="w-4 h-4 text-emerald-700 shrink-0" />
                        <span>{dept.name}</span>
                      </h3>
                    </div>

                    <button
                      onClick={() => handleDeleteDepartment(dept)}
                      className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition-colors cursor-pointer"
                      title="Delete Department"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Modules Pill List */}
                  <div className="mt-3">
                    <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1.5">
                      Allowed Modules
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {(dept.allowed_modules || []).map((mod) => (
                        <span
                          key={mod}
                          className="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-slate-100 text-slate-700 border border-slate-200"
                        >
                          {mod === 'appointments' ? '📅 Appointments' : mod === 'queue_schedule' ? '⏱️ Live Queue' : '🎟️ Check-In Desk'}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Quota Progress Bar */}
                  <div className="mt-4 p-3 bg-slate-50 rounded-xl border border-slate-200/80">
                    <div className="flex items-center justify-between text-xs font-semibold mb-1.5">
                      <span className="text-slate-600 flex items-center gap-1.5">
                        <Users className="w-3.5 h-3.5 text-slate-500" />
                        Staff Membership
                      </span>
                      <span className={`font-mono text-xs px-2 py-0.5 rounded-full ${
                        isFull 
                          ? 'bg-amber-100 text-amber-900 border border-amber-300 font-bold' 
                          : 'bg-emerald-100 text-emerald-800 font-bold'
                      }`}>
                        {count} / 3 {isFull ? '(FULL)' : ''}
                      </span>
                    </div>
                    <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all duration-300 ${
                          isFull ? 'bg-amber-500' : 'bg-emerald-600'
                        }`}
                        style={{ width: `${Math.min(100, (count / 3) * 100)}%` }}
                      />
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1">
                      {isFull ? 'Department quota reached' : `${3 - count} slot(s) remaining`}
                    </p>
                  </div>
                </div>

                {/* Card Actions */}
                <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                  <button
                    onClick={() => openEditModal(dept)}
                    className="px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-lg transition border border-slate-200 cursor-pointer"
                  >
                    Edit
                  </button>

                  <button
                    onClick={() => openManageMembers(dept)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition border border-emerald-200 cursor-pointer"
                  >
                    <Users className="w-3.5 h-3.5" />
                    <span>Manage Members ({count}/3)</span>
                    <ChevronRight className="w-3 h-3" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* MODAL 1: Create / Edit Department */}
      {isFormOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 sm:p-8 shadow-xl border border-slate-200 relative animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-800 flex items-center justify-center font-bold">
                  <Building2 className="w-5 h-5 text-emerald-600" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900">
                    {editingDept ? 'Edit Department' : 'Create Department'}
                  </h3>
                  <p className="text-xs text-slate-500">
                    Configure specialty name and active modules.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsFormOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold p-1 cursor-pointer"
              >
                ✕
              </button>
            </div>

            {formError && (
              <div className="mt-4 rounded-lg bg-rose-50 border border-rose-200 p-3 flex items-start gap-2 text-xs text-rose-700">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleSaveDepartment} className="mt-4 space-y-4">
              <div>
                <label htmlFor="dept-name-input" className="block text-xs font-semibold text-slate-700 mb-1">
                  Department Name *
                </label>
                <input
                  id="dept-name-input"
                  type="text"
                  required
                  value={deptName}
                  onChange={(e) => setDeptName(e.target.value)}
                  placeholder="e.g. Cardiology"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                />

                {/* Preset suggestions */}
                <div className="mt-2">
                  <span className="text-[10px] text-slate-400 font-bold uppercase block mb-1">
                    Quick Specialty Presets:
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {PRESET_SPECIALTIES.map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setDeptName(preset)}
                        className={`text-[10px] px-2 py-0.5 rounded-md border transition-colors cursor-pointer ${
                          deptName === preset
                            ? 'bg-emerald-600 text-white border-emerald-600 font-bold'
                            : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                        }`}
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Module Toggles */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Allowed Clinical Modules *
                </label>
                <div className="space-y-2">
                  {[
                    { id: 'appointments' as const, label: 'Appointments Booking', desc: 'Accept direct doctor OPD booking holds' },
                    { id: 'queue_schedule' as const, label: 'Live Queue & OPD Schedule', desc: 'Enable live consultation queue tracking' },
                    { id: 'check_in' as const, label: 'Reception Check-In Desk', desc: 'Allow front desk token validation and printouts' },
                  ].map((mod) => (
                    <label
                      key={mod.id}
                      className="flex items-start gap-2.5 p-2.5 rounded-lg border border-slate-200 bg-slate-50/50 cursor-pointer hover:bg-slate-50"
                    >
                      <input
                        type="checkbox"
                        checked={allowedModules.includes(mod.id)}
                        onChange={() => toggleModule(mod.id)}
                        className="mt-0.5 rounded text-emerald-600 focus:ring-emerald-500"
                      />
                      <div>
                        <p className="text-xs font-semibold text-slate-800">{mod.label}</p>
                        <p className="text-[11px] text-slate-500">{mod.desc}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {/* Active Toggle */}
              <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-200">
                <div>
                  <p className="text-xs font-semibold text-slate-800">Unit Status</p>
                  <p className="text-[11px] text-slate-500">Enable or disable booking for this specialty</p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsActive(!isActive)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer ${
                    isActive ? 'bg-emerald-600' : 'bg-slate-300'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      isActive ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsFormOpen(false)}
                  className="px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingDept}
                  className="px-5 py-2 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-sm transition-colors disabled:opacity-50 flex items-center gap-2 cursor-pointer"
                >
                  {savingDept ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4" />
                      {editingDept ? 'Update Department' : 'Create Department'}
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: Department Members Management */}
      {managingDept && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-xl w-full p-6 sm:p-8 shadow-xl border border-slate-200 relative animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-teal-50 text-teal-800 flex items-center justify-center font-bold">
                  <Users className="w-5 h-5 text-teal-600" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900">
                    {managingDept.name} Members
                  </h3>
                  <p className="text-xs text-slate-500">
                    Quota: <span className="font-semibold text-slate-800">{activeMembersInDept.length} / 3 Allowed Members</span>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setManagingDept(null)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold p-1 cursor-pointer"
              >
                ✕
              </button>
            </div>

            {memberError && (
              <div className="mt-4 rounded-lg bg-rose-50 border border-rose-200 p-3 flex items-start gap-2 text-xs text-rose-700">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>{memberError}</span>
              </div>
            )}

            {/* Existing Members List */}
            <div className="mt-4 space-y-2">
              <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                Current Department Roster
              </h4>

              {loadingMembers ? (
                <div className="py-8 text-center text-xs text-slate-500">
                  <RefreshCw className="w-4 h-4 animate-spin text-emerald-600 mx-auto mb-1" />
                  Loading members...
                </div>
              ) : members.length === 0 ? (
                <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 text-center text-xs text-slate-500">
                  No staff members currently assigned to {managingDept.name}.
                </div>
              ) : (
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {members.map((m) => {
                    const isRevoked = m.status === 'revoked';
                    const isInvited = m.status === 'invited';
                    const isActiveMember = m.status === 'active';

                    return (
                      <div
                        key={m.id}
                        className="bg-white border border-slate-200 rounded-xl p-3 flex items-center justify-between gap-3 text-xs shadow-2xs"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-slate-900 font-mono">
                              {m.email}
                            </span>
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700 uppercase">
                              {m.role === 'consultant' ? '🩺 Consultant' : '💼 Front Desk'}
                            </span>
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              isActiveMember
                                ? 'bg-emerald-100 text-emerald-800'
                                : isInvited
                                ? (m.is_expired ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800')
                                : 'bg-slate-200 text-slate-600'
                            }`}>
                              {isActiveMember ? 'Active' : isInvited ? (m.is_expired ? 'Invite Expired' : 'Invite Sent (7d)') : 'Revoked'}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-400 mt-0.5">
                            Added: {new Date(m.invited_at).toLocaleDateString()}
                          </p>
                        </div>

                        {/* Action buttons */}
                        <div className="flex items-center gap-1.5 shrink-0">
                          {isInvited && (
                            <>
                              <button
                                onClick={() => handleMemberAction(m.id, 'resend')}
                                className="px-2 py-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded border border-emerald-200 transition cursor-pointer"
                                title="Resend 7-day invite"
                              >
                                Resend
                              </button>
                              <button
                                onClick={() => handleMemberAction(m.id, 'cancel_invite')}
                                className="px-2 py-1 text-[11px] font-semibold text-slate-600 hover:text-rose-600 rounded transition cursor-pointer"
                                title="Cancel invite"
                              >
                                Cancel
                              </button>
                            </>
                          )}
                          {isActiveMember && (
                            <button
                              onClick={() => handleMemberAction(m.id, 'revoke')}
                              className="px-2 py-1 text-[11px] font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 rounded border border-rose-200 transition cursor-pointer"
                              title="Revoke member access"
                            >
                              Revoke
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Invite Form or Quota Warning */}
            <div className="mt-5 pt-4 border-t border-slate-100">
              {isDeptAtCapacity ? (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-bold">Maximum Quota Reached (3 / 3 Members)</p>
                    <p className="text-[11px] text-amber-700 mt-0.5">
                      To invite a new member to {managingDept.name}, revoke an existing member first.
                    </p>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleInviteMember} className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                      <UserPlus className="w-3.5 h-3.5 text-emerald-600" />
                      Invite New Department Member
                    </h4>
                    <span className="text-[11px] text-emerald-700 font-semibold">
                      {3 - activeMembersInDept.length} slot(s) available
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <div className="sm:col-span-2 relative">
                      <Mail className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                      <input
                        type="email"
                        required
                        value={inviteEmail}
                        onChange={(e) => setInviteEmail(e.target.value)}
                        placeholder="doctor@hospital.com"
                        className="w-full pl-8 pr-3 py-1.5 border border-slate-300 rounded-lg text-xs font-mono text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                      />
                    </div>

                    <select
                      value={inviteRole}
                      onChange={(e) => setInviteRole(e.target.value as any)}
                      className="px-2 py-1.5 border border-slate-300 rounded-lg text-xs text-slate-900 bg-white"
                    >
                      <option value="consultant">🩺 Consultant</option>
                      <option value="front_desk">💼 Front Desk</option>
                    </select>
                  </div>

                  <button
                    type="submit"
                    disabled={inviting || !inviteEmail.trim()}
                    className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg shadow-sm transition disabled:opacity-50 flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    {inviting ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        Sending Invite...
                      </>
                    ) : (
                      <>
                        <Mail className="w-3.5 h-3.5" />
                        Send 7-Day Invite Link
                      </>
                    )}
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function DepartmentsPage() {
  return (
    <Suspense fallback={
      <div className="max-w-7xl mx-auto px-4 py-16 text-center text-slate-500">
        Loading departments...
      </div>
    }>
      <DepartmentsContent />
    </Suspense>
  );
}
