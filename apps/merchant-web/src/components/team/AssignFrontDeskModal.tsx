'use client';

import React, { useState } from 'react';
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
  Sparkles 
} from 'lucide-react';

export interface FrontDeskManager {
  assignment_id: string;
  user_id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  id_card_number?: string | null;
  role: string;
  assigned_at?: string;
}

export interface DoctorWithAssignments {
  id: string;
  name: string;
  type: string;
  department: string;
  deposit_amount: number;
  duration_minutes: number;
  capacity: number;
  doctor_email: string | null;
  has_login: boolean;
  is_active: boolean;
  front_desk_managers: FrontDeskManager[];
}

export interface TeamMember {
  id: string;
  email: string | null;
  full_name: string | null;
  role: 'admin' | 'merchant' | 'customer';
  membershipRole?: string;
  phone: string | null;
  created_at: string;
}

interface AssignFrontDeskModalProps {
  doctor: DoctorWithAssignments | null;
  providerId: string | null | undefined;
  allRosterMembers: TeamMember[];
  onClose: () => void;
  onSuccess: (msg: string) => void;
  getExistingStaffIdCard: (userId: string) => string | null;
  isDoctorUser: (member: TeamMember) => boolean;
}

export function AssignFrontDeskModal({
  doctor,
  providerId,
  allRosterMembers,
  onClose,
  onSuccess,
  getExistingStaffIdCard,
  isDoctorUser,
}: AssignFrontDeskModalProps) {
  const [modalMode, setModalMode] = useState<'new' | 'existing'>('new');
  const [newFdName, setNewFdName] = useState('');
  const [newFdEmail, setNewFdEmail] = useState('');
  const [newFdPassword, setNewFdPassword] = useState('');
  const [newFdPhone, setNewFdPhone] = useState('');
  const [newFdIdCard, setNewFdIdCard] = useState('');
  const [showFdPassword, setShowFdPassword] = useState(false);
  const [assignExistingUserId, setAssignExistingUserId] = useState('');
  const [isAssigning, setIsAssigning] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);

  if (!doctor) return null;

  const sanitizePhoneInput = (val: string) => {
    let cleaned = val.replace(/[^0-9+\s-]/g, '');
    if (cleaned.includes('+')) {
      const startsWithPlus = cleaned.startsWith('+');
      cleaned = (startsWithPlus ? '+' : '') + cleaned.replace(/\+/g, '');
    }
    return cleaned;
  };

  const handleAssignFrontDesk = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!doctor || !providerId) return;

    if (doctor.front_desk_managers.length >= 4) {
      setAssignError('Maximum of 4 Front Desk Managers can be assigned to this doctor.');
      return;
    }

    setIsAssigning(true);
    setAssignError(null);

    try {
      const payload: any = {
        providerId,
        doctorId: doctor.id,
      };

      const requiresIdCard = (doctor.front_desk_managers?.length || 0) >= 1;

      if (modalMode === 'existing') {
        if (!assignExistingUserId) {
          setAssignError('Please select a staff member to assign.');
          setIsAssigning(false);
          return;
        }
        const existingStaffId = getExistingStaffIdCard(assignExistingUserId);
        const finalIdCard = (existingStaffId || newFdIdCard).trim();
        if (requiresIdCard && !finalIdCard) {
          setAssignError(`Staff ID Card Number is mandatory because Dr. ${doctor.name} has more than 1 front desk manager.`);
          setIsAssigning(false);
          return;
        }
        payload.userId = assignExistingUserId;
        payload.idCardNumber = finalIdCard || undefined;
      } else {
        if (!newFdName || !newFdEmail || !newFdPassword) {
          setAssignError('Full Name, Email, and Password are required.');
          setIsAssigning(false);
          return;
        }
        if (newFdPassword.length < 6) {
          setAssignError('Password must be at least 6 characters.');
          setIsAssigning(false);
          return;
        }
        if (requiresIdCard && !newFdIdCard.trim()) {
          setAssignError(`Staff ID Card Number is mandatory because Dr. ${doctor.name} has more than 1 front desk manager.`);
          setIsAssigning(false);
          return;
        }
        payload.fullName = newFdName.trim();
        payload.email = newFdEmail.trim();
        payload.password = newFdPassword;
        payload.phone = newFdPhone.trim() || undefined;
        payload.idCardNumber = newFdIdCard.trim() || undefined;
      }

      const res = await fetch('/api/admin/doctor-assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const json = await res.json();
      if (!res.ok || json.error) {
        throw new Error(json.error || 'Failed to assign front desk manager');
      }

      onSuccess(`Front desk manager "${newFdName || 'Staff Member'}" assigned to Dr. ${doctor.name} successfully.`);
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error assigning front desk manager';
      setAssignError(msg);
    } finally {
      setIsAssigning(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-lg w-full p-6 sm:p-8 shadow-xl border border-slate-200 relative animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between pb-4 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-800 flex items-center justify-center font-bold">
              <UserPlus className="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900">
                Assign Front Desk Manager
              </h3>
              <p className="text-xs text-slate-500">
                Doctor: <span className="font-semibold text-slate-800">{doctor.name}</span> ({doctor.department})
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

        {/* Mode Selector Tabs */}
        <div className="grid grid-cols-2 gap-2 mt-4 p-1 bg-slate-100 rounded-xl text-xs font-semibold">
          <button
            type="button"
            onClick={() => setModalMode('new')}
            className={`py-2 px-3 rounded-lg transition-colors cursor-pointer ${
              modalMode === 'new'
                ? 'bg-white text-emerald-800 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Create New Receptionist
          </button>
          <button
            type="button"
            onClick={() => setModalMode('existing')}
            className={`py-2 px-3 rounded-lg transition-colors cursor-pointer ${
              modalMode === 'existing'
                ? 'bg-white text-emerald-800 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Assign Existing Staff
          </button>
        </div>

        {assignError && (
          <div className="mt-4 rounded-lg bg-rose-50 border border-rose-200 p-3 flex items-start gap-2 text-xs text-rose-700">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{assignError}</span>
          </div>
        )}

        <form onSubmit={handleAssignFrontDesk} className="mt-4 space-y-4">
          {modalMode === 'new' ? (
            <>
              <div>
                <label htmlFor="fd-name" className="block text-xs font-semibold text-slate-700 mb-1">
                  Front Desk Manager Full Name *
                </label>
                <input
                  id="fd-name"
                  type="text"
                  required
                  value={newFdName}
                  onChange={(e) => setNewFdName(e.target.value)}
                  placeholder="e.g. Kavitha Sharma (Token Desk 1)"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="fd-email" className="block text-xs font-semibold text-slate-700 mb-1">
                  Login Email Address *
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    id="fd-email"
                    type="email"
                    required
                    value={newFdEmail}
                    onChange={(e) => setNewFdEmail(e.target.value)}
                    placeholder="frontdesk.kavitha@hospital.com"
                    className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:outline-none font-mono text-xs"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="fd-password" className="block text-xs font-semibold text-slate-700 mb-1">
                  Temporary Password (min 6 characters) *
                </label>
                <div className="relative">
                  <KeyRound className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    id="fd-password"
                    type={showFdPassword ? 'text' : 'password'}
                    required
                    value={newFdPassword}
                    onChange={(e) => setNewFdPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full pl-9 pr-10 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:outline-none font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowFdPassword(!showFdPassword)}
                    className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 cursor-pointer"
                    title={showFdPassword ? 'Hide password' : 'Show password'}
                  >
                    {showFdPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="fd-phone" className="block text-xs font-semibold text-slate-700 mb-1">
                    Phone Number (Optional)
                  </label>
                  <input
                    id="fd-phone"
                    type="tel"
                    inputMode="tel"
                    pattern="[0-9+\s-]*"
                    value={newFdPhone}
                    onChange={(e) => setNewFdPhone(sanitizePhoneInput(e.target.value))}
                    placeholder="+91 98480 12345"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:outline-none font-mono text-xs"
                  />
                </div>

                <div>
                  <label htmlFor="fd-id-card" className="block text-xs font-semibold text-slate-700 mb-1">
                    Staff ID Card Number {(doctor.front_desk_managers?.length || 0) >= 1 ? '*' : '(Optional)'}
                  </label>
                  <div className="relative">
                    <CreditCard className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                    <input
                      id="fd-id-card"
                      type="text"
                      required={(doctor.front_desk_managers?.length || 0) >= 1}
                      value={newFdIdCard}
                      onChange={(e) => setNewFdIdCard(e.target.value.toUpperCase())}
                      placeholder={
                        (doctor.front_desk_managers?.length || 0) >= 1
                          ? "e.g. HOSP-FD-104 (Required)"
                          : "e.g. HOSP-FD-104 (Optional)"
                      }
                      className={`w-full pl-9 pr-3 py-2 border rounded-lg text-sm text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:outline-none font-mono text-xs uppercase ${
                        (doctor.front_desk_managers?.length || 0) >= 1 && !newFdIdCard.trim()
                          ? 'border-amber-300 bg-amber-50/20'
                          : 'border-slate-300'
                      }`}
                    />
                  </div>
                  {(doctor.front_desk_managers?.length || 0) >= 1 && (
                    <p className="text-[11px] text-amber-700 mt-1">
                      * Staff ID is mandatory because Dr. {doctor.name} has multiple receptionists.
                    </p>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="space-y-4">
              <div>
                <label htmlFor="existing-staff-select" className="block text-xs font-semibold text-slate-700 mb-1">
                  Select Staff Member to Assign *
                </label>
                <select
                  id="existing-staff-select"
                  value={assignExistingUserId}
                  onChange={(e) => {
                    const uid = e.target.value;
                    setAssignExistingUserId(uid);
                    const existingId = getExistingStaffIdCard(uid);
                    if (existingId) {
                      setNewFdIdCard(existingId);
                    } else {
                      setNewFdIdCard('');
                    }
                  }}
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:outline-none bg-white"
                >
                  <option value="">-- Choose a staff member --</option>
                  {allRosterMembers
                    .filter(
                      (m) =>
                        !m.id.startsWith('doc-') &&
                        !m.id.startsWith('fd-') &&
                        !isDoctorUser(m) &&
                        !doctor.front_desk_managers.some((fd) => fd.user_id === m.id)
                    )
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.full_name || 'Staff'} ({m.email || 'No email'})
                      </option>
                    ))}
                </select>
              </div>

              {assignExistingUserId && (
                <>
                  {getExistingStaffIdCard(assignExistingUserId) ? (
                    <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-900 flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <CreditCard className="w-4 h-4 text-emerald-600 shrink-0" />
                        <div>
                          <p className="font-semibold text-emerald-950">Existing Verified Staff ID</p>
                          <p className="font-mono text-emerald-700 text-sm font-bold mt-0.5">
                            {getExistingStaffIdCard(assignExistingUserId)}
                          </p>
                        </div>
                      </div>
                      <span className="text-[10px] font-bold uppercase tracking-wider bg-emerald-100 text-emerald-800 border border-emerald-300 px-2 py-0.5 rounded-full">
                        Preserved
                      </span>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-600 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <CreditCard className="w-4 h-4 text-slate-400 shrink-0" />
                          <span>No existing ID card found for this staff member</span>
                        </div>
                        {(doctor.front_desk_managers?.length || 0) >= 1 ? (
                          <span className="text-[10px] font-bold uppercase tracking-wider bg-amber-100 text-amber-800 border border-amber-300 px-2 py-0.5 rounded-full">
                            ID Required
                          </span>
                        ) : (
                          <span className="text-[10px] text-slate-400 font-medium">Optional</span>
                        )}
                      </div>

                      <div>
                        <label htmlFor="existing-fd-id-card" className="block text-xs font-semibold text-slate-700 mb-1">
                          Staff ID Card Number {(doctor.front_desk_managers?.length || 0) >= 1 ? '*' : '(Optional)'}
                        </label>
                        <div className="relative">
                          <CreditCard className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                          <input
                            id="existing-fd-id-card"
                            type="text"
                            required={(doctor.front_desk_managers?.length || 0) >= 1}
                            value={newFdIdCard}
                            onChange={(e) => setNewFdIdCard(e.target.value.toUpperCase())}
                            placeholder={
                              (doctor.front_desk_managers?.length || 0) >= 1
                                ? "e.g. HOSP-FD-104 (Required for multiple desks)"
                                : "e.g. HOSP-FD-104 (Optional)"
                            }
                            className={`w-full pl-9 pr-3 py-2 border rounded-lg text-sm text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:outline-none font-mono text-xs uppercase ${
                              (doctor.front_desk_managers?.length || 0) >= 1 && !newFdIdCard.trim()
                                ? 'border-amber-300 bg-amber-50/20'
                                : 'border-slate-300'
                            }`}
                          />
                        </div>
                        {(doctor.front_desk_managers?.length || 0) >= 1 && (
                          <p className="text-[11px] text-amber-700 mt-1">
                            * Staff ID is mandatory because Dr. {doctor.name} has more than 1 front desk manager.
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          <div className="p-3 bg-emerald-50/70 border border-emerald-200 rounded-lg text-xs text-emerald-900 flex items-start gap-2">
            <Sparkles className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <span>
              Front desk managers can independently sign in with these credentials to register patients, issue live tokens, and print OPD receipts.
            </span>
          </div>

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
              disabled={isAssigning}
              className="px-5 py-2 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-sm transition-colors disabled:opacity-50 flex items-center gap-2 cursor-pointer"
            >
              {isAssigning ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Assigning...
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  Assign to {doctor.name}
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
