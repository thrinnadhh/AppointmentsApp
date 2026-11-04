'use client';

import React, { useState, useMemo } from 'react';
import { 
  X, 
  UserCheck, 
  Search, 
  FileText, 
  AlertCircle, 
  Clock, 
  Loader2, 
  CheckCircle2,
  Calendar
} from 'lucide-react';

export interface UpcomingCandidateBooking {
  id: string;
  reference_code: string;
  patient_name?: string;
  phone?: string;
  slot_start: string;
  slot_end: string;
  status: string;
  doctor_name?: string;
  department_name?: string;
}

interface ManualCheckinModalProps {
  isOpen: boolean;
  onClose: () => void;
  candidateBookings: UpcomingCandidateBooking[];
  onConfirmManualCheckin: (bookingId: string, reason: string) => Promise<boolean>;
}

const COMMON_REASONS = [
  'Patient phone battery depleted',
  'SMS / App network outage at reception',
  'Elderly patient without smartphone',
  'Physical appointment letter presented',
  'Reception verification check'
];

export default function ManualCheckinModal({
  isOpen,
  onClose,
  candidateBookings,
  onConfirmManualCheckin,
}: ManualCheckinModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(null);
  const [justificationReason, setJustificationReason] = useState(COMMON_REASONS[0]);
  const [customReason, setCustomReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Filter bookings by search query
  const filteredBookings = useMemo(() => {
    if (!searchQuery.trim()) return candidateBookings;
    const q = searchQuery.toLowerCase().trim();
    return candidateBookings.filter((b) => {
      const name = (b.patient_name || '').toLowerCase();
      const phone = (b.phone || '').toLowerCase();
      const ref = (b.reference_code || '').toLowerCase();
      const doc = (b.doctor_name || '').toLowerCase();
      return name.includes(q) || phone.includes(q) || ref.includes(q) || doc.includes(q);
    });
  }, [candidateBookings, searchQuery]);

  if (!isOpen) return null;

  const selectedBooking = candidateBookings.find((b) => b.id === selectedBookingId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBookingId) {
      setErrorMessage('Please select a patient appointment to mark present.');
      return;
    }

    const finalReason = justificationReason === 'Other (custom reason)' 
      ? customReason.trim() 
      : justificationReason;

    if (!finalReason) {
      setErrorMessage('Staff justification reason is required for manual mark-present audit.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const success = await onConfirmManualCheckin(selectedBookingId, finalReason);
      if (success) {
        onClose();
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Manual check-in failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fadeIn">
      <div 
        role="dialog"
        aria-modal="true"
        aria-labelledby="manual-checkin-title"
        className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-xl overflow-hidden max-h-[90vh] flex flex-col"
      >
        {/* Modal Header */}
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-emerald-50 text-emerald-700">
              <UserCheck className="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <h2 id="manual-checkin-title" className="text-base font-bold text-slate-900 tracking-tight">
                Manual Fallback Check-In
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Mark patient present without 4-digit code. Reason will be logged in audit trail.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition cursor-pointer"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5 overflow-y-auto flex-1">
          {errorMessage && (
            <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 flex items-center gap-2.5 text-xs font-semibold">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Search Box */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-700">Find Appointment</label>
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by patient name, phone, or token/reference code..."
                className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-slate-300 text-xs font-medium text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
              />
            </div>
          </div>

          {/* Bookings Candidate List */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Matching Appointments ({filteredBookings.length})</span>
              <span>Select one to mark present</span>
            </div>

            <div className="border border-slate-200 rounded-xl divide-y divide-slate-100 max-h-48 overflow-y-auto">
              {filteredBookings.length === 0 ? (
                <div className="p-4 text-center text-xs text-slate-400">
                  No upcoming appointments found matching query.
                </div>
              ) : (
                filteredBookings.map((b) => {
                  const isSelected = selectedBookingId === b.id;
                  const slotStr = new Date(b.slot_start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                  return (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => setSelectedBookingId(b.id)}
                      className={`w-full p-3 text-left transition flex items-center justify-between gap-3 cursor-pointer ${
                        isSelected ? 'bg-emerald-50/70 border-l-4 border-emerald-600' : 'hover:bg-slate-50'
                      }`}
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-xs text-slate-900">{b.patient_name || 'Patient'}</span>
                          <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-slate-100 text-slate-600">
                            {b.reference_code}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-slate-500 mt-0.5">
                          <span>{b.doctor_name || 'Doctor'}</span>
                          <span>•</span>
                          <span className="flex items-center gap-1 font-mono">
                            <Clock className="w-3 h-3 text-slate-400" />
                            {slotStr}
                          </span>
                          {b.phone && (
                            <>
                              <span>•</span>
                              <span>{b.phone}</span>
                            </>
                          )}
                        </div>
                      </div>

                      <div className="shrink-0">
                        {isSelected ? (
                          <div className="w-5 h-5 rounded-full bg-emerald-600 text-white flex items-center justify-center">
                            <CheckCircle2 className="w-4 h-4" />
                          </div>
                        ) : (
                          <div className="w-5 h-5 rounded-full border border-slate-300" />
                        )}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Justification Reason Selector */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-700">
              Staff Justification Reason (Mandatory Audit Requirement)
            </label>
            <select
              value={justificationReason}
              onChange={(e) => setJustificationReason(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl border border-slate-300 text-xs font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 cursor-pointer"
            >
              {COMMON_REASONS.map((reason) => (
                <option key={reason} value={reason}>
                  {reason}
                </option>
              ))}
              <option value="Other (custom reason)">Other (custom reason)...</option>
            </select>

            {justificationReason === 'Other (custom reason)' && (
              <textarea
                rows={2}
                value={customReason}
                onChange={(e) => setCustomReason(e.target.value)}
                placeholder="Enter specific audit explanation for marking patient present..."
                className="w-full mt-2 p-3 rounded-xl border border-slate-300 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            )}
          </div>

          {/* Selected Booking Summary */}
          {selectedBooking && (
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700 flex items-center justify-between">
              <div>
                <p className="font-bold text-slate-900">
                  Ready to mark {selectedBooking.patient_name || 'Patient'} present
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Slot: {new Date(selectedBooking.slot_start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • {selectedBooking.doctor_name}
                </p>
              </div>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                Authorized Fallback
              </span>
            </div>
          )}

          {/* Modal Actions */}
          <div className="pt-2 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-700 hover:bg-slate-100 transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !selectedBookingId}
              className="px-5 py-2.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white transition disabled:opacity-50 disabled:cursor-not-allowed shadow-xs flex items-center gap-1.5 cursor-pointer"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Logging Check-In…</span>
                </>
              ) : (
                <>
                  <UserCheck className="w-4 h-4" />
                  <span>Mark Present &amp; Admit</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
