'use client';

import React, { useState } from 'react';
import { 
  X, 
  ShieldAlert, 
  ArrowUpCircle, 
  Loader2, 
  AlertTriangle 
} from 'lucide-react';
import { ActiveConsultationBooking } from './ActiveConsultationCard';

interface MedicalUrgencyOverrideModalProps {
  isOpen: boolean;
  onClose: () => void;
  booking: ActiveConsultationBooking | null;
  totalQueueLength: number;
  onSubmit: (targetPosition: number, reason: string) => Promise<void>;
  isSubmitting: boolean;
}

export default function MedicalUrgencyOverrideModal({
  isOpen,
  onClose,
  booking,
  totalQueueLength,
  onSubmit,
  isSubmitting,
}: MedicalUrgencyOverrideModalProps) {
  const [targetPosition, setTargetPosition] = useState(1);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!isOpen || !booking) return null;

  const patientName = booking.patient_name || booking.customer?.full_name || 'Patient';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) {
      setError('Clinical reason for medical urgency override is required.');
      return;
    }

    try {
      setError(null);
      await onSubmit(targetPosition, reason.trim());
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to override queue position');
    }
  };

  return (
    <div 
      data-testid="medical-urgency-override-modal"
      className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4"
    >
      <div className="bg-white rounded-2xl max-w-lg w-full border border-slate-200 shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-100 bg-rose-50/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-rose-100 text-rose-800 flex items-center justify-center">
              <ShieldAlert className="w-5 h-5 text-rose-700" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">Medical Urgency Override</h2>
              <p className="text-xs text-rose-700 font-medium">Logged in compliance audit trail per SPEC line 21</p>
            </div>
          </div>
          <button
            type="button"
            data-testid="close-override-modal-btn"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-white transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3.5 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-xl flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs space-y-2">
            <div className="flex justify-between">
              <span className="text-slate-500">Patient:</span>
              <strong className="text-slate-900">{patientName}</strong>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Reference Code:</span>
              <span className="font-mono text-slate-700">{booking.reference_code}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Scheduled Slot:</span>
              <span className="text-slate-700">
                {new Date(booking.slot_start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5 uppercase tracking-wider">
              Target Queue Position
            </label>
            <select
              data-testid="override-target-position-select"
              value={targetPosition}
              onChange={(e) => setTargetPosition(Number(e.target.value))}
              className="w-full text-sm bg-white border border-slate-300 rounded-xl px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-rose-500 cursor-pointer"
            >
              <option value={1}>Position #1 (Up Next / Immediate Next)</option>
              {Array.from({ length: Math.max(1, totalQueueLength) }).map((_, idx) => {
                if (idx === 0) return null;
                return (
                  <option key={idx + 1} value={idx + 1}>
                    Position #{idx + 1}
                  </option>
                );
              })}
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5 uppercase tracking-wider">
              Clinical Justification (Mandatory)
            </label>
            <textarea
              data-testid="override-reason-input"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Patient presents with acute dyspnea / severe vital instability requiring expedited triage."
              className="w-full text-sm text-slate-800 bg-white border border-slate-300 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-rose-500"
              required
            />
          </div>

          <div className="pt-2 flex items-center justify-end gap-3 border-t border-slate-100">
            <button
              type="button"
              data-testid="cancel-override-btn"
              onClick={onClose}
              className="px-4 py-2.5 text-xs font-semibold text-slate-600 hover:text-slate-900 transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              data-testid="submit-override-btn"
              disabled={isSubmitting}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-rose-700 hover:bg-rose-800 text-white font-bold text-xs rounded-xl transition shadow-xs disabled:opacity-50 cursor-pointer"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Applying Override...
                </>
              ) : (
                <>
                  <ArrowUpCircle className="w-4 h-4" />
                  Apply Priority Override
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
