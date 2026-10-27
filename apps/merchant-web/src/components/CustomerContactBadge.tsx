'use client';

import React, { useState } from 'react';
import { Phone, Eye, EyeOff, ShieldCheck, Loader2, AlertCircle } from 'lucide-react';
import { revealCustomerContact } from '@/lib/supabase';

interface CustomerContactBadgeProps {
  phone?: string | null;
  bookingId: string;
  bookingStatus?: string;
  isArrived?: boolean;
  className?: string;
}

export function CustomerContactBadge({
  phone,
  bookingId,
  bookingStatus,
  isArrived = false,
  className = '',
}: CustomerContactBadgeProps) {
  const [isRevealed, setIsRevealed] = useState(false);
  const [unmaskedPhone, setUnmaskedPhone] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showReasonModal, setShowReasonModal] = useState(false);
  const [selectedReason, setSelectedReason] = useState('Urgent clinical follow-up');

  // The phone prop is server-side masked (e.g. *******456 or Not provided)
  const defaultDisplay = phone || 'Not provided';
  const isAvailable = defaultDisplay !== 'Not provided' && defaultDisplay.trim() !== '';
  const displayText = isRevealed && unmaskedPhone ? unmaskedPhone : defaultDisplay;

  const handleToggleReveal = (e: React.MouseEvent) => {
    e.stopPropagation();
    setErrorMsg(null);

    // If currently revealed, user wants to re-mask
    if (isRevealed) {
      setIsRevealed(false);
      return;
    }

    // If already previously fetched via RPC in this session, toggle back to visible
    if (unmaskedPhone) {
      setIsRevealed(true);
      return;
    }

    // Otherwise prompt for business justification reason
    setShowReasonModal(true);
  };

  const handleConfirmReveal = async (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setShowReasonModal(false);
    setIsLoading(true);
    try {
      const res = await revealCustomerContact(bookingId, selectedReason);
      if (!res.success || !res.phone) {
        setErrorMsg(res.error || 'Only confirmed bookings can be revealed');
      } else {
        setUnmaskedPhone(res.phone);
        setIsRevealed(true);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Access denied');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="inline-flex flex-col">
      <span
        className={`inline-flex items-center gap-1.5 text-xs text-slate-500 ${className}`}
        data-testid={`contact-badge-${bookingId}`}
      >
        <Phone className="w-3 h-3 text-slate-400 flex-shrink-0" />
        <span
          className="font-mono text-slate-600 font-medium tracking-tight"
          data-testid={`phone-display-${bookingId}`}
          title={isRevealed ? 'Raw customer contact (Audited)' : 'Server-side masked contact'}
        >
          {displayText}
        </span>

        {isAvailable && (
          <button
            type="button"
            onClick={handleToggleReveal}
            disabled={isLoading}
            className="inline-flex items-center text-slate-400 hover:text-emerald-700 p-0.5 rounded transition-colors cursor-pointer disabled:opacity-50"
            title={
              isRevealed
                ? 'Re-mask customer phone'
                : 'Reveal verified contact via RPC (Audited for Confirmed Bookings)'
            }
            aria-label={isRevealed ? 'Mask customer phone' : 'Reveal customer phone'}
            data-testid={`toggle-phone-mask-${bookingId}`}
          >
            {isLoading ? (
              <Loader2 className="w-3 h-3 text-emerald-600 animate-spin" />
            ) : isRevealed ? (
              <EyeOff className="w-3 h-3 text-slate-500" />
            ) : (
              <Eye className="w-3 h-3 text-slate-400" />
            )}
          </button>
        )}

        {!isRevealed && isAvailable && (
          <span
            className="inline-flex items-center gap-0.5 text-[9px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200/60 px-1 py-0.2 rounded"
            title="Protected by server-side masking & RLS"
          >
            <ShieldCheck className="w-2.5 h-2.5 text-emerald-600" />
            Masked
          </span>
        )}
      </span>

      {errorMsg && (
        <span
          className="inline-flex items-center gap-1 text-[10px] text-rose-600 font-medium mt-0.5"
          data-testid={`reveal-error-${bookingId}`}
        >
          <AlertCircle className="w-2.5 h-2.5 flex-shrink-0" />
          {errorMsg.includes('confirmed') ? 'Confirmed bookings only' : 'Access denied'}
        </span>
      )}

      {showReasonModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4"
          onClick={(e) => {
            e.stopPropagation();
            setShowReasonModal(false);
          }}
          data-testid={`reveal-reason-modal-${bookingId}`}
        >
          <div
            className="bg-white rounded-xl shadow-xl border border-slate-200 max-w-sm w-full p-5 text-left"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 mb-2">
              <ShieldCheck className="w-5 h-5 text-emerald-700" />
              <h3 className="text-sm font-bold text-slate-800">Operational Reason Required</h3>
            </div>
            <p className="text-xs text-slate-500 mb-4">
              To reveal this patient&apos;s contact number, please select the business or clinical justification. This action is permanently audited.
            </p>

            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Select Justification
            </label>
            <select
              value={selectedReason}
              onChange={(e) => setSelectedReason(e.target.value)}
              className="w-full text-xs border border-slate-300 rounded-lg p-2.5 bg-slate-50 text-slate-800 font-medium focus:ring-2 focus:ring-emerald-500 mb-4"
              data-testid={`select-reveal-reason-${bookingId}`}
            >
              <option value="Urgent clinical follow-up">Urgent clinical follow-up</option>
              <option value="Patient arrived / location assistance">Patient arrived / location assistance</option>
              <option value="Schedule change / doctor emergency">Schedule change / doctor emergency</option>
              <option value="Billing / payment inquiry">Billing / payment inquiry</option>
              <option value="Other operational check-in">Other operational check-in</option>
            </select>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowReasonModal(false);
                }}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmReveal}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 shadow-xs transition cursor-pointer"
                data-testid={`btn-confirm-reveal-${bookingId}`}
              >
                Confirm & Reveal
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
