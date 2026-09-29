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

  // The phone prop is server-side masked (e.g. *******456 or Not provided)
  const defaultDisplay = phone || 'Not provided';
  const isAvailable = defaultDisplay !== 'Not provided' && defaultDisplay.trim() !== '';
  const displayText = isRevealed && unmaskedPhone ? unmaskedPhone : defaultDisplay;

  const handleToggleReveal = async (e: React.MouseEvent) => {
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

    // Call server RPC to reveal contact and write audit entry
    setIsLoading(true);
    try {
      const res = await revealCustomerContact(bookingId);
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
    </div>
  );
}
