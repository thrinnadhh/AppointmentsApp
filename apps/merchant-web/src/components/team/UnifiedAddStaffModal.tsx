'use client';

import React, { useState, useEffect } from 'react';
import { 
  UserPlus, 
  Mail, 
  KeyRound, 
  Eye, 
  EyeOff, 
  CreditCard, 
  AlertCircle, 
  RefreshCw, 
  Check, 
  Building2, 
  Stethoscope, 
  Users, 
  ShieldCheck, 
  Clock, 
  IndianRupee 
} from 'lucide-react';
import { DoctorWithAssignments } from './AssignFrontDeskModal';

export interface DepartmentOption {
  id: string;
  name: string;
  member_count: number;
  allowed_modules?: string[];
  is_active: boolean;
}

interface UnifiedAddStaffModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (msg: string) => void;
  providerId: string | null | undefined;
  doctors: DoctorWithAssignments[];
}

export function UnifiedAddStaffModal({
  isOpen,
  onClose,
  onSuccess,
  providerId,
  doctors,
}: UnifiedAddStaffModalProps) {
  const [role, setRole] = useState<'consultant' | 'front_desk' | 'administrator'>('consultant');
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [loadingDepts, setLoadingDepts] = useState(false);
  const [selectedDeptId, setSelectedDeptId] = useState('');

  // Form fields
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Consultant specific
  const [consultationFee, setConsultationFee] = useState('500');
  const [durationMinutes, setDurationMinutes] = useState('15');

  // Front Desk specific
  const [idCardNumber, setIdCardNumber] = useState('');
  const [assignDoctorId, setAssignDoctorId] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    async function fetchDepartments() {
      setLoadingDepts(true);
      try {
        const res = await fetch('/api/hospital/departments');
        const json = await res.json();
        if (res.ok && json.success) {
          setDepartments(json.departments || []);
          if (json.departments?.length > 0) {
            // Pick first non-full department if possible
            const available = json.departments.find((d: DepartmentOption) => (d.member_count || 0) < 3);
            setSelectedDeptId((prev) => prev || (available ? available.id : json.departments[0].id));
          }
        }
      } catch (err) {
        console.error('Failed to fetch departments:', err);
      } finally {
        setLoadingDepts(false);
      }
    }
    fetchDepartments();
  }, [isOpen]);

  if (!isOpen) return null;

  const sanitizePhone = (val: string) => {
    let cleaned = val.replace(/[^0-9+\s-]/g, '');
    if (cleaned.includes('+')) {
      const startsWithPlus = cleaned.startsWith('+');
      cleaned = (startsWithPlus ? '+' : '') + cleaned.replace(/\+/g, '');
    }
    return cleaned;
  };

  const selectedDepartment = departments.find((d) => d.id === selectedDeptId);
  const isDeptFull = (selectedDepartment?.member_count || 0) >= 3;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!fullName.trim() || !email.trim()) {
      setError('Full Name and Email Address are required.');
      return;
    }

    if (role !== 'administrator' && !selectedDeptId) {
      setError('Please select a department for this staff member.');
      return;
    }

    if (role !== 'administrator' && isDeptFull) {
      setError('Selected department already has 3 members (maximum allowed by hospital policy).');
      return;
    }

    if (password && password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    setSubmitting(true);
    try {
      // 1. If department member (consultant or front_desk), invite/add to department
      if (role !== 'administrator' && selectedDeptId) {
        const memberRes = await fetch('/api/hospital/members', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            department_id: selectedDeptId,
            email: email.trim().toLowerCase(),
            role,
          }),
        });

        const memberJson = await memberRes.json();
        if (!memberRes.ok || !memberJson.success) {
          throw new Error(memberJson.error || 'Failed to add department member');
        }
      }

      // 2. If Consultant, create or link doctor resource
      if (role === 'consultant' && providerId) {
        const docDeptName = selectedDepartment?.name || 'General';
        const res = await fetch('/api/resources', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            provider_id: providerId,
            name: fullName.trim(),
            type: 'doctor',
            department: docDeptName,
            deposit_amount: Number(consultationFee) || 500,
            duration_minutes: Number(durationMinutes) || 15,
            capacity: 1,
            doctor_email: email.trim().toLowerCase(),
            is_active: true,
          }),
        });
        const resJson = await res.json();
        if (!res.ok) {
          console.warn('Consultant resource registration notice:', resJson);
        }
      }

      // 3. If Front Desk and doctor assigned, create assignment
      if (role === 'front_desk' && assignDoctorId && providerId) {
        const assignRes = await fetch('/api/admin/doctor-assignments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            providerId,
            doctorId: assignDoctorId,
            fullName: fullName.trim(),
            email: email.trim().toLowerCase(),
            password: password || 'TempPass123!',
            phone: phone.trim() || undefined,
            idCardNumber: idCardNumber.trim() || undefined,
          }),
        });
        const assignJson = await assignRes.json();
        if (!assignRes.ok && assignJson.error) {
          console.warn('Doctor assignment notice:', assignJson.error);
        }
      }

      onSuccess(`Successfully added ${fullName.trim()} as ${
        role === 'consultant' ? 'Consultant' : role === 'front_desk' ? 'Front Desk Staff' : 'Hospital Admin'
      }.`);
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to provision staff member';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-xl w-full p-6 sm:p-8 shadow-xl border border-slate-200 relative animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between pb-4 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-800 flex items-center justify-center font-bold">
              <UserPlus className="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900">
                Unified Staff Provisioning
              </h3>
              <p className="text-xs text-slate-500">
                1-Step onboarding for Doctors, Receptionists, and Department Staff.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-lg font-bold p-1 cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Role Selection Tabs */}
        <div className="grid grid-cols-3 gap-2 mt-4 p-1 bg-slate-100 rounded-xl text-xs font-semibold">
          <button
            type="button"
            onClick={() => setRole('consultant')}
            className={`py-2 px-2 rounded-lg flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
              role === 'consultant'
                ? 'bg-white text-emerald-800 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Stethoscope className="w-3.5 h-3.5" />
            <span>Consultant / Doctor</span>
          </button>
          <button
            type="button"
            onClick={() => setRole('front_desk')}
            className={`py-2 px-2 rounded-lg flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
              role === 'front_desk'
                ? 'bg-white text-emerald-800 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>Front Desk</span>
          </button>
          <button
            type="button"
            onClick={() => setRole('administrator')}
            className={`py-2 px-2 rounded-lg flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
              role === 'administrator'
                ? 'bg-white text-emerald-800 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Hospital Admin</span>
          </button>
        </div>

        {error && (
          <div className="mt-4 rounded-lg bg-rose-50 border border-rose-200 p-3 flex items-start gap-2 text-xs text-rose-700">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          {/* Department Selection (Required for consultant & front_desk) */}
          {role !== 'administrator' && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label htmlFor="staff-dept" className="block text-xs font-semibold text-slate-700">
                  Assign to Department *
                </label>
                <span className="text-[11px] text-slate-400">Policy: Max 3 members per department</span>
              </div>
              {loadingDepts ? (
                <div className="text-xs text-slate-500 py-2">Loading departments...</div>
              ) : (
                <select
                  id="staff-dept"
                  value={selectedDeptId}
                  onChange={(e) => setSelectedDeptId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:outline-none bg-white"
                >
                  {departments.map((dept) => {
                    const count = dept.member_count || 0;
                    const full = count >= 3;
                    return (
                      <option key={dept.id} value={dept.id} disabled={full}>
                        {dept.name} ({count}/3 Members) {full ? '— [FULL]' : ''}
                      </option>
                    );
                  })}
                </select>
              )}
              {isDeptFull && (
                <p className="text-[11px] text-rose-600 mt-1 font-medium">
                  ⚠️ This department already has 3 members. Please select another department or revoke an existing member.
                </p>
              )}
            </div>
          )}

          {/* Name & Email */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="staff-name" className="block text-xs font-semibold text-slate-700 mb-1">
                Full Name *
              </label>
              <input
                id="staff-name"
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder={role === 'consultant' ? 'Dr. Ramesh Kumar' : 'Sunita Rao'}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="staff-email" className="block text-xs font-semibold text-slate-700 mb-1">
                Email Address *
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  id="staff-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="doctor@hospital.com"
                  className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:outline-none font-mono text-xs"
                />
              </div>
            </div>
          </div>

          {/* Password & Phone */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="staff-password" className="block text-xs font-semibold text-slate-700 mb-1">
                Temporary Password (min 6 chars)
              </label>
              <div className="relative">
                <KeyRound className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  id="staff-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-9 pr-10 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:outline-none font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 cursor-pointer"
                  title={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div>
              <label htmlFor="staff-phone" className="block text-xs font-semibold text-slate-700 mb-1">
                Phone Number (Optional)
              </label>
              <input
                id="staff-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(sanitizePhone(e.target.value))}
                placeholder="+91 98480 12345"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:outline-none font-mono text-xs"
              />
            </div>
          </div>

          {/* Role-Specific Fields */}
          {role === 'consultant' && (
            <div className="p-3.5 bg-emerald-50/50 border border-emerald-100 rounded-xl space-y-3">
              <span className="text-[11px] font-bold text-emerald-800 uppercase tracking-wider flex items-center gap-1.5">
                <Stethoscope className="w-3.5 h-3.5 text-emerald-700" />
                Consultant OPD Parameters
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="fee" className="block text-xs font-semibold text-slate-700 mb-1">
                    Consultation Fee (₹)
                  </label>
                  <div className="relative">
                    <IndianRupee className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                    <input
                      id="fee"
                      type="number"
                      min="0"
                      value={consultationFee}
                      onChange={(e) => setConsultationFee(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 font-mono"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="duration" className="block text-xs font-semibold text-slate-700 mb-1">
                    Slot Duration (Minutes)
                  </label>
                  <div className="relative">
                    <Clock className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                    <input
                      id="duration"
                      type="number"
                      min="5"
                      step="5"
                      value={durationMinutes}
                      onChange={(e) => setDurationMinutes(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 font-mono"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {role === 'front_desk' && (
            <div className="p-3.5 bg-teal-50/50 border border-teal-100 rounded-xl space-y-3">
              <span className="text-[11px] font-bold text-teal-800 uppercase tracking-wider flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-teal-700" />
                Front Desk Desk Link & Badge
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="badge-id" className="block text-xs font-semibold text-slate-700 mb-1">
                    Staff ID Badge Number
                  </label>
                  <div className="relative">
                    <CreditCard className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                    <input
                      id="badge-id"
                      type="text"
                      value={idCardNumber}
                      onChange={(e) => setIdCardNumber(e.target.value.toUpperCase())}
                      placeholder="e.g. HOSP-FD-101"
                      className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 font-mono text-xs uppercase"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="assign-doc" className="block text-xs font-semibold text-slate-700 mb-1">
                    Doctor Desk (Optional)
                  </label>
                  <select
                    id="assign-doc"
                    value={assignDoctorId}
                    onChange={(e) => setAssignDoctorId(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 bg-white"
                  >
                    <option value="">-- General Department Desk --</option>
                    {doctors.map((d) => (
                      <option key={d.id} value={d.id}>
                        Dr. {d.name} ({d.department})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || (role !== 'administrator' && isDeptFull)}
              className="px-5 py-2 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-sm transition-colors disabled:opacity-50 flex items-center gap-2 cursor-pointer"
            >
              {submitting ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Provisioning...
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  Provision Account
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
