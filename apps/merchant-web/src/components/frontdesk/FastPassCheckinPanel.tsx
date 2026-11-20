'use client';

import React, { useState, useEffect, useRef } from 'react';
import { 
  Ticket, 
  UserCheck, 
  RefreshCw, 
  CheckCircle2, 
  AlertTriangle, 
  Clock, 
  Lock, 
  UserPlus, 
  ShieldAlert,
  Users
} from 'lucide-react';

export interface CheckinSuccessData {
  booking_id?: string;
  patient_name?: string;
  service_doctor?: string;
  slot_time?: string;
  is_late?: boolean;
  arrival_tag?: 'On Time' | 'Early' | 'Late';
  checked_in_at?: string;
  queue_name?: string;
}

export interface CheckinMatchOption {
  booking_id: string;
  consultant_name: string;
  slot_time: string;
  customer_first_name: string;
  phone_last_2: string;
}

interface FastPassCheckinPanelProps {
  onVerifyCode: (code: string, bookingId?: string) => Promise<{
    success: boolean;
    data?: CheckinSuccessData;
    error?: string;
    message?: string;
    multiple_matches?: boolean;
    matches?: CheckinMatchOption[];
  }>;
  onOpenManualCheckin: () => void;
  selectedDoctorName?: string;
}

export default function FastPassCheckinPanel({
  onVerifyCode,
  onOpenManualCheckin,
  selectedDoctorName,
}: FastPassCheckinPanelProps) {
  const [codeInput, setCodeInput] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successData, setSuccessData] = useState<CheckinSuccessData | null>(null);
  const [multipleMatches, setMultipleMatches] = useState<CheckinMatchOption[] | null>(null);
  const [pendingCode, setPendingCode] = useState<string>('');

  // 5 wrong attempts lock staff for 60 seconds (SPEC line 16)
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [lockoutSeconds, setLockoutSeconds] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Handle Lockout countdown
  useEffect(() => {
    if (lockoutSeconds <= 0) return;
    const timer = setInterval(() => {
      setLockoutSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          setFailedAttempts(0);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [lockoutSeconds]);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (lockoutSeconds > 0) return;

    const trimmed = codeInput.trim();
    if (!trimmed) return;

    setIsVerifying(true);
    setErrorMessage(null);
    setSuccessData(null);

    try {
      const res = await onVerifyCode(trimmed);
      if (res.success && res.data) {
        setSuccessData(res.data);
        setCodeInput('');
        setFailedAttempts(0);
        setMultipleMatches(null);
        setPendingCode('');
      } else if (res.multiple_matches && Array.isArray(res.matches) && res.matches.length > 1) {
        setMultipleMatches(res.matches);
        setPendingCode(trimmed);
        setErrorMessage(null);
        setSuccessData(null);
      } else {
        setMultipleMatches(null);
        setPendingCode('');
        const nextFailed = failedAttempts + 1;
        setFailedAttempts(nextFailed);
        
        if (nextFailed >= 5) {
          setLockoutSeconds(60);
          setErrorMessage('Security Lockout: 5 consecutive failed attempts. Reception desk locked for 60 seconds.');
        } else {
          const remainingBeforeLock = 5 - nextFailed;
          setErrorMessage(
            res.message || 
            `Invalid check-in code. (${remainingBeforeLock} attempt${remainingBeforeLock === 1 ? '' : 's'} remaining before 60s lockout)`
          );
        }
        inputRef.current?.focus();
      }
    } catch (err) {
      setMultipleMatches(null);
      setPendingCode('');
      setErrorMessage(err instanceof Error ? err.message : 'Invalid check-in code');
    } finally {
      setIsVerifying(false);
    }
  };

  const handleSelectMatch = async (bookingId: string) => {
    if (!pendingCode || isVerifying || lockoutSeconds > 0) return;
    setIsVerifying(true);
    setErrorMessage(null);
    try {
      const res = await onVerifyCode(pendingCode, bookingId);
      if (res.success && res.data) {
        setSuccessData(res.data);
        setCodeInput('');
        setMultipleMatches(null);
        setPendingCode('');
        setFailedAttempts(0);
      } else {
        setErrorMessage(res.message || 'Failed to check in selected appointment');
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Check-in failed');
    } finally {
      setIsVerifying(false);
    }
  };

  const isLockedOut = lockoutSeconds > 0;

  return (
    <div 
      data-testid="reception-checkin-panel"
      className="bg-white rounded-2xl border-2 border-emerald-500/30 p-5 sm:p-6 shadow-xs relative overflow-hidden space-y-4"
    >
      {/* Header and Action Callouts */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-emerald-50 text-emerald-700">
            <Ticket className="w-5 h-5 text-emerald-600" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900 tracking-tight flex items-center gap-2">
              Reception Fast-Pass Check-In
              <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 uppercase tracking-wider font-mono">
                4-Digit OTP
              </span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Ask arriving patient for their 4-digit booking code to verify and admit into waiting queue.
            </p>
          </div>
        </div>

        {/* Fallback Manual Check-In Button */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="manual-checkin-btn"
            onClick={onOpenManualCheckin}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-200 transition cursor-pointer"
          >
            <UserPlus className="w-3.5 h-3.5 text-slate-600" />
            <span>Manual Check-In Fallback</span>
          </button>
        </div>
      </div>

      {/* Security Lockout Banner */}
      {isLockedOut && (
        <div 
          data-testid="checkin-lockout-alert"
          className="p-4 rounded-xl bg-rose-50 border border-rose-300 text-rose-950 flex items-center gap-3 animate-pulse"
        >
          <div className="p-2 rounded-lg bg-rose-200 text-rose-900 shrink-0">
            <ShieldAlert className="w-5 h-5" />
          </div>
          <div>
            <p className="text-xs font-bold text-rose-900">
              Reception Terminal Rate-Limited
            </p>
            <p className="text-xs text-rose-800 mt-0.5">
              5 consecutive incorrect code submissions entered. Input locked for security:{' '}
              <span className="font-mono font-black text-rose-950 text-sm">
                {lockoutSeconds}s
              </span>
            </p>
          </div>
        </div>
      )}

      {/* Code Input Form */}
      <form 
        onSubmit={handleSubmit}
        className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3"
      >
        <div className="relative flex-1">
          <input
            ref={inputRef}
            type="text"
            data-testid="checkin-code-input"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            disabled={isLockedOut || isVerifying}
            value={codeInput}
            onChange={(e) => {
              const val = e.target.value.replace(/\D/g, '');
              setCodeInput(val);
              if (errorMessage && !isLockedOut) setErrorMessage(null);
            }}
            placeholder={isLockedOut ? `Locked (${lockoutSeconds}s)` : "Enter 4-digit code"}
            autoFocus
            className={`w-full px-4 py-3 bg-slate-50 border-2 rounded-xl text-center font-mono text-xl font-black tracking-widest text-slate-900 placeholder:text-slate-400 placeholder:tracking-normal placeholder:font-sans placeholder:text-sm transition outline-none ${
              isLockedOut
                ? 'border-rose-300 bg-rose-50/50 cursor-not-allowed opacity-75'
                : 'border-slate-300 focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/20'
            }`}
          />
        </div>

        <button
          type="submit"
          data-testid="verify-checkin-btn"
          disabled={isLockedOut || isVerifying || !codeInput.trim()}
          className="px-6 py-3 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white transition disabled:opacity-50 disabled:cursor-not-allowed shadow-xs flex items-center justify-center gap-2 shrink-0 cursor-pointer"
        >
          {isVerifying ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin" />
              <span>Verifying…</span>
            </>
          ) : isLockedOut ? (
            <>
              <Lock className="w-4 h-4" />
              <span>Locked ({lockoutSeconds}s)</span>
            </>
          ) : (
            <>
              <UserCheck className="w-4 h-4" />
              <span>Verify &amp; Admit</span>
            </>
          )}
        </button>
      </form>

      {/* Multiple Matches Collision Picker */}
      {multipleMatches && multipleMatches.length > 0 && (
        <div
          data-testid="multiple-matches-picker"
          className="p-4 rounded-xl bg-amber-50 border-2 border-amber-300 text-amber-950 space-y-3"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="w-5 h-5 text-amber-700 shrink-0" />
              <div>
                <h3 className="text-sm font-bold text-amber-950">
                  Multiple Patients Match PIN {pendingCode}
                </h3>
                <p className="text-xs text-amber-800">
                  Select the patient at the reception desk to complete check-in:
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setMultipleMatches(null);
                setPendingCode('');
              }}
              className="text-xs font-semibold text-amber-800 hover:text-amber-950 px-2 py-1 rounded-lg hover:bg-amber-100 transition cursor-pointer"
            >
              Cancel
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
            {multipleMatches.map((match) => (
              <button
                key={match.booking_id}
                type="button"
                data-testid={`match-select-btn-${match.booking_id}`}
                disabled={isVerifying}
                onClick={() => handleSelectMatch(match.booking_id)}
                className="p-3 bg-white border border-amber-200 hover:border-emerald-500 hover:ring-2 hover:ring-emerald-500/20 rounded-xl text-left transition flex items-center justify-between group cursor-pointer"
              >
                <div>
                  <p className="text-sm font-bold text-slate-900 group-hover:text-emerald-700">
                    {match.customer_first_name} (••{match.phone_last_2})
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {match.consultant_name} • <span className="font-semibold text-slate-700">{match.slot_time}</span>
                  </p>
                </div>
                <div className="px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-bold border border-emerald-200 group-hover:bg-emerald-600 group-hover:text-white transition">
                  Check In
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Success Notification Banner */}
      {successData && (
        <div
          role="status"
          data-testid="checkin-success-banner"
          className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-950 flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-fadeIn"
        >
          <div className="flex items-start sm:items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-200 text-emerald-800 shrink-0">
              <CheckCircle2 className="w-5 h-5 text-emerald-700" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-bold text-emerald-950">
                  {successData.patient_name || 'Patient'} successfully checked in!
                </p>
                {successData.is_late || successData.arrival_tag === 'Late' ? (
                  <span 
                    data-testid="checkin-late-badge"
                    className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300"
                  >
                    <Clock className="w-3 h-3 text-amber-700" />
                    <span>Late Arrival (&gt;10m after slot) → Standby Queue</span>
                  </span>
                ) : successData.arrival_tag === 'Early' ? (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-sky-100 text-sky-900 border border-sky-300">
                    <Clock className="w-3 h-3 text-sky-700" />
                    <span>Early Arrival → Waiting Queue</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-200 text-emerald-900">
                    <CheckCircle2 className="w-3 h-3 text-emerald-700" />
                    <span>On Time → Waiting Queue</span>
                  </span>
                )}
              </div>
              <p className="text-xs text-emerald-800 mt-1">
                {successData.service_doctor ? `${successData.service_doctor} • ` : ''}
                {successData.slot_time ? `Booked Slot: ${successData.slot_time} • ` : ''}
                Checked in at {successData.checked_in_at ? new Date(successData.checked_in_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'now'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setSuccessData(null)}
            className="text-xs font-bold text-emerald-800 hover:text-emerald-950 underline underline-offset-2 self-end sm:self-center cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Error Banner */}
      {errorMessage && !isLockedOut && (
        <div
          role="alert"
          data-testid="checkin-error-banner"
          className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 flex items-center justify-between gap-3 animate-fadeIn"
        >
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            <p className="text-xs font-semibold text-rose-900">{errorMessage}</p>
          </div>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="text-xs font-bold text-rose-700 hover:text-rose-900 p-1 cursor-pointer"
            aria-label="Dismiss error"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
