'use client';

import React, { useEffect, useState, use } from 'react';
import Link from 'next/link';
import {
  Clock,
  UserCheck,
  CheckCircle2,
  Copy,
  Check,
  Sparkles,
  RefreshCw,
  Building2,
  Stethoscope,
  Calendar,
  AlertCircle,
  ShieldCheck,
  ArrowRight,
  Lock
} from 'lucide-react';
import { RollingTenSlotQueue } from '@/components/RollingTenSlotQueue';
import { MonthlyAttendanceCalendar } from '@/components/MonthlyAttendanceCalendar';
import { QueueSlot, MonthlyAttendanceSummary } from '@/lib/queue-scheduler';
import { supabase } from '@/lib/supabase';

interface TicketData {
  booking: {
    id: string;
    resource_id?: string;
    provider_id?: string;
    reference_code: string;
    slot_start: string;
    slot_end: string;
    status: 'HELD' | 'CONFIRMED' | 'CHECKED_IN' | 'COMPLETED' | 'CANCELLED';
    payment_status: string;
    deposit_amount: number;
    is_present: boolean;
    checked_in_at: string | null;
    checked_in_method: string | null;
    queue_position?: number | null;
  };
  customer: {
    name: string;
    email: string;
    phone: string;
  };
  hospital: {
    name: string;
    address: string;
    phone: string;
  };
  doctor: {
    id?: string;
    name: string;
    department: string;
    duration_minutes: number;
    price: number;
  };
  is_window_open?: boolean;
  window_opens_at?: string;
  checkin_code: string | null;
  is_doctor_ahead?: boolean;
}

export default function CustomerTicketPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [data, setData] = useState<TicketData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [justReconnected, setJustReconnected] = useState<boolean>(false);

  // Phone verification state for unauthenticated web pass visitors (SMS/WhatsApp links)
  const [requiresVerification, setRequiresVerification] = useState(false);
  const [phoneDigits, setPhoneDigits] = useState('');
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleOnline = () => {
      setIsOnline(true);
      setJustReconnected(true);
      setTimeout(() => setJustReconnected(false), 4000);
    };
    const handleOffline = () => {
      setIsOnline(false);
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Live 10-Slot Queue & Monthly Attendance State
  const [queueSlots, setQueueSlots] = useState<QueueSlot[]>([]);
  const [attendanceSummary, setAttendanceSummary] = useState<MonthlyAttendanceSummary | null>(null);
  const [calendarYear, setCalendarYear] = useState<number>(new Date().getFullYear());
  const [calendarMonth, setCalendarMonth] = useState<number>(new Date().getMonth() + 1);
  const [isLoadingQueue, setIsLoadingQueue] = useState(false);

  const fetchQueueAndHistory = async (year = calendarYear, month = calendarMonth) => {
    setIsLoadingQueue(true);
    try {
      const res = await fetch(
        `/api/customer/queue-and-history?booking_id=${id}&year=${year}&month=${month}`,
        { cache: 'no-store' }
      );
      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          setQueueSlots(json.queue || []);
          setAttendanceSummary(json.attendance || null);
        }
      }
    } catch (err) {
      console.warn('Could not fetch queue or history:', err);
    } finally {
      setIsLoadingQueue(false);
    }
  };

  const fetchTicket = async (showLoading = false, digitsOverride?: string) => {
    if (showLoading) setLoading(true);
    try {
      const storedDigits = typeof window !== 'undefined' ? sessionStorage.getItem(`ticket_phone_${id}`) : null;
      const digits = digitsOverride !== undefined ? digitsOverride : (phoneDigits || storedDigits || '');
      const url = digits ? `/api/ticket/${id}?phone_last4=${encodeURIComponent(digits)}` : `/api/ticket/${id}`;
      const res = await fetch(url, { cache: 'no-store' });

      if (res.status === 401 || res.status === 403) {
        const json = await res.json().catch(() => ({}));
        if (json.requires_verification) {
          setRequiresVerification(true);
          if (digits) {
            setVerifyError('Incorrect digits. Please check the last 4 digits of your registered phone number.');
          }
          setData(null);
          return;
        }
        throw new Error(`Ticket not found (${res.status})`);
      }

      if (!res.ok) {
        throw new Error(`Ticket not found (${res.status})`);
      }

      const json = await res.json();
      if (digits) {
        if (typeof window !== 'undefined') {
          sessionStorage.setItem(`ticket_phone_${id}`, digits);
        }
        setPhoneDigits(digits);
      }
      setData(json);
      setRequiresVerification(false);
      setVerifyError(null);
      setLastUpdated(new Date());
      setError(null);
      fetchQueueAndHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load ticket');
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  const handleVerifySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanDigits = phoneDigits.trim();
    if (!/^\d{4}$/.test(cleanDigits)) {
      setVerifyError('Please enter exactly 4 numbers (digits only).');
      return;
    }
    setIsVerifying(true);
    setVerifyError(null);
    try {
      await fetchTicket(false, cleanDigits);
    } finally {
      setIsVerifying(false);
    }
  };

  // Determine if patient is within next 3 positions or ETA is <= 30 minutes
  const isNearPatientTurn = () => {
    // 1. Check position in current rolling queue
    const patientSlotIdx = queueSlots.findIndex(
      (s) => s.bookingId === id || s.isCurrentPatient
    );
    if (patientSlotIdx !== -1 && patientSlotIdx <= 3) {
      return true;
    }

    // 2. Check booking queue_position from DB
    if (data?.booking?.queue_position != null && data.booking.queue_position <= 3) {
      return true;
    }

    // 3. Check ETA within 30 minutes
    if (data?.booking?.slot_start) {
      const nowMs = Date.now();
      const slotStartMs = new Date(data.booking.slot_start).getTime();
      const etaMinutes = (slotStartMs - nowMs) / (60 * 1000);
      if (etaMinutes <= 30 && etaMinutes >= -60) {
        return true;
      }
    }

    return false;
  };

  // 1. Initial fetch & direct row realtime subscription
  useEffect(() => {
    fetchTicket(true);
    fetchQueueAndHistory();

    // Direct row subscription for own booking changes (check-in PIN verified, payment, cancellation)
    const channel = supabase
      .channel(`ticket-live-${id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'bookings',
          filter: `id=eq.${id}`,
        },
        (payload) => {
          if (payload.new && typeof payload.new === 'object') {
            const updated = payload.new as any;
            setData((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                booking: {
                  ...prev.booking,
                  status: updated.status ?? prev.booking.status,
                  payment_status: updated.payment_status ?? prev.booking.payment_status,
                  deposit_amount: updated.deposit_amount ?? prev.booking.deposit_amount,
                  is_present: updated.is_present ?? prev.booking.is_present,
                  checked_in_at: updated.checked_in_at ?? prev.booking.checked_in_at,
                  checked_in_method: updated.checked_in_method ?? prev.booking.checked_in_method,
                  queue_position: updated.queue_position ?? prev.booking.queue_position,
                },
              };
            });
            setLastUpdated(new Date());
          }
          fetchQueueAndHistory();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [id]);

  // 2. No-PII Realtime Broadcast channel per doctor and day (anonymous-safe)
  useEffect(() => {
    const doctorId = data?.doctor?.id || data?.booking?.resource_id;
    const dateStr = data?.booking?.slot_start
      ? data.booking.slot_start.slice(0, 10)
      : new Date().toISOString().slice(0, 10);

    if (!doctorId) return;

    const channelName = `doctor-queue-${doctorId}-${dateStr}`;
    const broadcastChannel = supabase.channel(channelName, {
      config: { broadcast: { self: false } },
    });

    broadcastChannel
      .on('broadcast', { event: 'queue_update' }, () => {
        fetchTicket(false);
        fetchQueueAndHistory();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(broadcastChannel);
    };
  }, [data?.doctor?.id, data?.booking?.resource_id, data?.booking?.slot_start]);

  // 3. Adaptive Refresh: 6s when within next 3 positions or ETA <= 30m, 35s otherwise, paused when hidden
  useEffect(() => {
    let timeoutId: NodeJS.Timeout | null = null;
    let isMounted = true;

    const scheduleNextPoll = () => {
      if (!isMounted) return;
      const nearTurn = isNearPatientTurn();
      // 5-10s (6000ms) near patient turn / <=30m ETA, 30-60s (35000ms) otherwise
      const pollDelayMs = nearTurn ? 6000 : 35000;

      timeoutId = setTimeout(async () => {
        if (!isMounted) return;
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
          // Paused while tab is hidden
          return;
        }
        await Promise.all([fetchTicket(false), fetchQueueAndHistory()]);
        if (isMounted) {
          scheduleNextPoll();
        }
      }, pollDelayMs);
    };

    scheduleNextPoll();

    // Visibility change handler: pause when hidden, immediately refetch and restart loop on visible
    const handleVisibilityChange = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        fetchTicket(false);
        fetchQueueAndHistory();
        if (timeoutId) clearTimeout(timeoutId);
        scheduleNextPoll();
      }
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }

    return () => {
      isMounted = false;
      if (timeoutId) clearTimeout(timeoutId);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
    };
  }, [data, queueSlots, id]);

  const handleCopyCode = () => {
    if (!data?.checkin_code) return;
    navigator.clipboard.writeText(data.checkin_code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) {
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center p-6 text-center">
        <RefreshCw className="w-10 h-10 text-emerald-600 animate-spin mb-4" />
        <h2 className="text-xl font-bold text-gray-800">Retrieving Appointment Ticket...</h2>
        <p className="text-sm text-gray-500 mt-1">Connecting to tri-test-hospital registry...</p>
      </div>
    );
  }

  if (requiresVerification) {
    return (
      <div data-testid="ticket-verification-gate" className="max-w-md mx-auto my-12 p-8 bg-white rounded-xl border border-gray-200 shadow-sm text-center">
        <div className="w-14 h-14 bg-emerald-50 text-emerald-700 rounded-full flex items-center justify-center mx-auto mb-4 border border-emerald-200">
          <ShieldCheck className="w-7 h-7 text-emerald-700" />
        </div>
        <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-50 text-emerald-800 rounded-full text-xs font-semibold uppercase tracking-wider mb-2 border border-emerald-200">
          <Lock className="w-3.5 h-3.5" />
          Patient Access Verification
        </div>
        <h2 className="text-xl font-bold text-gray-900 tracking-tight">Confirm Your Phone Number</h2>
        <p className="text-sm text-gray-600 mt-2 leading-relaxed">
          To protect patient medical privacy, please enter the <strong className="text-gray-900 font-semibold">last 4 digits</strong> of the phone number used when booking this appointment.
        </p>

        <form onSubmit={handleVerifySubmit} className="mt-6 space-y-4 text-left">
          <div>
            <label htmlFor="phone_digits" className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1.5">
              Last 4 Digits of Phone Number
            </label>
            <div className="relative">
              <input
                id="phone_digits"
                data-testid="phone-verification-input"
                type="tel"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={4}
                autoFocus
                placeholder="••••"
                value={phoneDigits}
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, '').slice(0, 4);
                  setPhoneDigits(val);
                  if (verifyError) setVerifyError(null);
                }}
                className="w-full text-center font-mono text-2xl font-bold tracking-[0.5em] px-4 py-3 rounded-lg border border-gray-300 focus:outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/20 text-gray-900 transition"
              />
            </div>
          </div>

          {verifyError && (
            <div data-testid="verification-error" className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
              <span>{verifyError}</span>
            </div>
          )}

          <button
            type="submit"
            data-testid="phone-verification-submit"
            disabled={isVerifying || phoneDigits.length !== 4}
            className="w-full py-3 px-4 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-lg text-sm shadow-sm transition flex items-center justify-center gap-2"
          >
            {isVerifying ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Verifying...</span>
              </>
            ) : (
              <>
                <span>Unlock Appointment Pass</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        <p className="text-xs text-gray-400 mt-5">
          💡 Tip: Check the SMS or WhatsApp confirmation message received on your phone.
        </p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="max-w-md mx-auto my-12 p-8 bg-white rounded-2xl border border-red-200 shadow-sm text-center">
        <div className="w-12 h-12 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4">
          <AlertCircle className="w-6 h-6" />
        </div>
        <h2 className="text-xl font-bold text-gray-900">Ticket Not Available</h2>
        <p className="text-sm text-gray-600 mt-2">{error || 'Unable to locate this appointment.'}</p>
        <button
          onClick={() => fetchTicket(true)}
          className="mt-6 inline-flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-semibold transition"
        >
          <RefreshCw className="w-4 h-4" /> Try Again
        </button>
      </div>
    );
  }

  const { booking, customer, hospital, doctor, checkin_code } = data;

  const slotStart = new Date(booking.slot_start);
  const slotEnd = new Date(booking.slot_end);
  const timeFormatted = `${slotStart.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })} – ${slotEnd.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}`;
  const dateFormatted = slotStart.toLocaleDateString('en-IN', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

  const arrivalStart = new Date(slotStart.getTime() - 10 * 60 * 1000).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  const arrivalEnd = new Date(slotStart.getTime() + 10 * 60 * 1000).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  const arrivalWindowFormatted = `${arrivalStart} – ${arrivalEnd}`;

  // Status mapping
  const isCheckedIn = booking.status === 'CHECKED_IN' || booking.is_present;
  const isCompleted = booking.status === 'COMPLETED';

  return (
    <div className="max-w-4xl mx-auto py-6 px-4 sm:px-6 space-y-6">
      {/* Network / Reconnection Banner */}
      {!isOnline ? (
        <div data-testid="ticket-network-status-banner" className="bg-red-50 border border-red-200 text-red-800 text-xs px-4 py-2.5 rounded-2xl flex items-center gap-2">
          <span>⚠️</span> Offline mode — showing cached ticket data. Reconnect to refresh live queue.
        </div>
      ) : justReconnected ? (
        <div data-testid="ticket-network-status-banner" className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs px-4 py-2.5 rounded-2xl flex items-center gap-2 animate-fade-in">
          <span>🟢</span> Reconnected — live queue status updated!
        </div>
      ) : null}

      {/* Top Breadcrumb & Live Refresh indicator */}
      <div className="flex items-center justify-between mb-4 text-xs text-gray-500">
        <span className="flex items-center gap-1.5 font-medium text-emerald-800">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          {isNearPatientTurn() ? 'Priority Queue Sync Active (6s)' : 'Live Reception Sync Active'}
        </span>
        <span>Updated: {lastUpdated.toLocaleTimeString()}</span>
      </div>

      {/* Main Ticket Card */}
      <div className="bg-white rounded-3xl border border-emerald-100 shadow-xl overflow-hidden">
        {/* Hospital Header Header */}
        <div className="bg-gradient-to-r from-emerald-800 via-emerald-700 to-teal-800 text-white p-6 sm:p-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-900/40 backdrop-blur-md rounded-full text-xs font-semibold text-emerald-200 uppercase tracking-wider mb-2 border border-emerald-500/30">
                <Building2 className="w-3.5 h-3.5" />
                {hospital.name}
              </div>
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
                OPD Patient Ticket
              </h1>
              <p className="text-xs sm:text-sm text-emerald-100/90 mt-1">
                {hospital.address}
              </p>
            </div>

            {/* Reference Badge */}
            <div className="text-right">
              <span className="text-[11px] uppercase tracking-wider text-emerald-200 block font-medium">Ref Code</span>
              <span className="font-mono text-sm sm:text-base font-bold text-white bg-white/10 px-2.5 py-1 rounded-lg border border-white/20 inline-block mt-0.5">
                {booking.reference_code}
              </span>
            </div>
          </div>
        </div>

        {/* RECEPTION PIN / OTP HIGHLIGHT SECTION */}
        <div className="p-6 sm:p-8 bg-gradient-to-b from-emerald-50/50 to-white border-b border-gray-100 text-center">
          <span className="text-xs font-bold uppercase tracking-widest text-emerald-800 bg-emerald-100/80 px-3 py-1 rounded-full inline-block mb-3">
            Reception Check-in PIN
          </span>

          {isCheckedIn ? (
            <div>
              <h2 className="text-sm font-medium text-gray-600 mb-3">
                Your presence has been verified by the reception desk.
              </h2>
              <div className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-emerald-100/80 text-emerald-800 border border-emerald-300 font-semibold shadow-sm">
                <UserCheck className="w-5 h-5 text-emerald-600" />
                <span>Verified Present in Waiting Lounge</span>
              </div>
            </div>
          ) : (!data.is_window_open || !checkin_code) ? (
            /* Locked 60m Countdown Gate */
            <div data-testid="checkin-pin-locked-box" className="max-w-md mx-auto bg-amber-50/80 border border-amber-200/80 rounded-2xl p-5 mb-2 text-center">
              <div className="w-10 h-10 rounded-full bg-amber-100 text-amber-800 flex items-center justify-center mx-auto mb-2 text-lg">
                🔒
              </div>
              <h3 className="text-sm font-bold text-amber-900 mb-1">Check-in PIN Unlocks 60m Before Slot</h3>
              <p className="text-xs text-amber-800/90 leading-relaxed">
                Your 4-digit reception PIN will unlock at{' '}
                <span className="font-semibold text-amber-950">
                  {data.window_opens_at
                    ? new Date(data.window_opens_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
                    : '60 minutes before your slot'}
                </span>
                . Show or tell it at the counter upon arrival.
              </p>
            </div>
          ) : (
            /* Open 4-digit PIN */
            <>
              <h2 className="text-sm font-medium text-gray-600 mb-3">
                Please tell this 4-digit PIN at the reception desk upon arrival:
              </h2>

              <div className="relative inline-flex items-center justify-center gap-3 bg-white border-2 border-emerald-600 px-8 py-4 rounded-2xl shadow-lg shadow-emerald-600/10 mb-4">
                <span
                  data-testid="customer-checkin-pin"
                  className="font-mono text-4xl sm:text-5xl font-black tracking-[0.25em] text-emerald-800 select-all"
                >
                  {checkin_code}
                </span>

                <button
                  onClick={handleCopyCode}
                  title="Copy PIN"
                  className="ml-2 p-2.5 hover:bg-emerald-50 active:scale-95 text-emerald-700 rounded-xl transition border border-emerald-200"
                >
                  {copied ? <Check className="w-5 h-5 text-emerald-600" /> : <Copy className="w-5 h-5" />}
                </button>
              </div>

              {copied && (
                <p className="text-xs text-emerald-600 font-semibold mb-2">
                  ✓ PIN copied to clipboard!
                </p>
              )}
            </>
          )}

          {/* Status Badge */}
          <div className="mt-3 flex items-center justify-center">
            {isCompleted ? (
              <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-semibold bg-blue-100 text-blue-800 border border-blue-200">
                <CheckCircle2 className="w-4 h-4 text-blue-600" />
                Appointment Completed
              </span>
            ) : isCheckedIn ? (
              <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-semibold bg-emerald-100 text-emerald-800 border border-emerald-300 shadow-sm animate-pulse">
                <UserCheck className="w-4 h-4 text-emerald-600" />
                Present • Verified at Reception
              </span>
            ) : (
              <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-semibold bg-amber-50 text-amber-800 border border-amber-200">
                <Clock className="w-4 h-4 text-amber-600" />
                Scheduled • Awaiting Reception Check-in
              </span>
            )}
          </div>
        </div>

        {/* Appointment Details Grid */}
        <div className="p-6 sm:p-8 space-y-6">
          {/* Patient & Doctor Row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-gray-50/80 rounded-2xl p-4 border border-gray-100">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider block mb-1">
                Patient Name
              </span>
              <p className="text-base font-bold text-gray-900">{customer.name}</p>
              <p className="text-xs text-gray-500 mt-0.5">{customer.phone}</p>
            </div>

            <div className="bg-emerald-50/40 rounded-2xl p-4 border border-emerald-100">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold text-emerald-800 uppercase tracking-wider">
                  Assigned Doctor
                </span>
                <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-emerald-200/60 text-emerald-800">
                  {doctor.department}
                </span>
              </div>
              <p className="text-base font-bold text-gray-900">{doctor.name}</p>
              <p className="text-xs text-emerald-700 mt-0.5">Consultation Fee: ₹{doctor.price}</p>
            </div>
          </div>

          {/* Time Slot Banner */}
          <div className="bg-gray-900 text-white rounded-2xl p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0 border border-emerald-500/30">
                <Clock className="w-5 h-5" />
              </div>
              <div>
                <span className="text-xs text-gray-400 block font-medium">Slot Time ({doctor.duration_minutes} Mins)</span>
                <p className="text-base font-bold text-white">{timeFormatted}</p>
              </div>
            </div>

            <div className="text-left sm:text-right border-t sm:border-t-0 pt-3 sm:pt-0 w-full sm:w-auto border-gray-800">
              <span className="text-xs text-gray-400 block font-medium">Appointment Date</span>
              <p className="text-sm font-semibold text-emerald-300">{dateFormatted}</p>
            </div>
          </div>

          {/* Arrival Window (±10 Mins) Card */}
          <div data-testid="ticket-arrival-window" className="bg-emerald-50/80 border border-emerald-200 rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0 border border-emerald-300">
                <Clock className="w-5 h-5 text-emerald-700" />
              </div>
              <div>
                <span className="text-xs text-emerald-800 font-semibold uppercase tracking-wider block">OPD Arrival Window (±10 Mins)</span>
                <p className="text-base font-extrabold text-emerald-950 font-mono">{arrivalWindowFormatted}</p>
              </div>
            </div>
            <div className="text-xs text-emerald-800/90 max-w-sm">
              💡 Booked time is a ceiling: starting earlier is always allowed when you are present and the doctor is free.
            </div>
          </div>

          {/* Standby Queue Honest Estimate Banner */}
          {booking.queue_position && isCheckedIn && (
            <div data-testid="ticket-standby-banner" className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-xs text-amber-900 flex items-start gap-3">
              <span className="text-xl">⏰</span>
              <div>
                <h4 className="font-bold text-amber-950">Standby Queue Assigned (Turn #{booking.queue_position})</h4>
                <p className="mt-1 text-amber-800 leading-relaxed">
                  You arrived after your scheduled window. You are placed in the Standby Queue in original booking order. The doctor will see you in gaps between on-time patients or at the end of the session. You will never be dropped!
                </p>
              </div>
            </div>
          )}

          {/* Optional Come Now Invite */}
          {data.is_doctor_ahead && !isCheckedIn && (
            <div data-testid="ticket-come-now-invite" className="bg-emerald-50 border-2 border-emerald-500 rounded-2xl p-4 text-xs text-emerald-950 flex items-start justify-between gap-3 shadow-md">
              <div className="flex items-start gap-2.5">
                <Sparkles className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-bold text-emerald-900 text-sm">Doctor Running Ahead of Schedule ⚡</h4>
                  <p className="text-emerald-800 mt-0.5">
                    Dr. {doctor.name} is ready early! If you are nearby, you are welcome to come in now.
                  </p>
                  <p className="text-[11px] text-emerald-700 mt-1 italic">
                    Optional: Declining changes nothing; your slot at {timeFormatted} remains 100% reserved.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* How to test instructions card */}
          <div className="bg-blue-50/60 border border-blue-200/80 rounded-2xl p-4 text-xs text-blue-900 space-y-1.5">
            <div className="flex items-center gap-1.5 font-bold text-blue-950">
              <ShieldCheck className="w-4 h-4 text-blue-600" />
              Live Reception Test Instructions:
            </div>
            <p>
              1. Keep this customer tab open. Notice your 4-digit PIN: <strong>{checkin_code}</strong>.
            </p>
            <p>
              2. Open the Merchant Dashboard tab, type <strong>{checkin_code}</strong> in the reception panel, and click <strong>Verify & Check-In</strong>.
            </p>
            <p>
              3. Watch this page automatically update to <strong>Present • Verified</strong>!
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="bg-gray-50 px-6 py-4 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500">
          <span>Deposit Paid: ₹{booking.deposit_amount}</span>
          <div className="flex items-center gap-4">
            <Link
              href="/customer/dashboard"
              className="text-emerald-700 hover:text-emerald-800 font-semibold inline-flex items-center gap-1"
            >
              Customer Portal <ArrowRight className="w-3.5 h-3.5" />
            </Link>
            <Link
              href="/"
              className="text-slate-600 hover:text-slate-800 font-semibold inline-flex items-center gap-1"
            >
              Merchant Dashboard <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 1. ROLLING 10-SLOT QUEUE: WHO'S NEXT & GAP SCHEDULING                    */}
      {/* ========================================================================= */}
      {queueSlots.length > 0 && (
        <RollingTenSlotQueue
          slots={queueSlots}
          doctorName={doctor.name}
          department={doctor.department}
          slotDurationMinutes={doctor.duration_minutes}
          currentBookingId={booking.id}
          onRefresh={() => fetchQueueAndHistory()}
          isLoading={isLoadingQueue}
        />
      )}

      {/* ========================================================================= */}
      {/* 2. MONTHLY ATTENDANCE CALENDAR: PRESENT VS ABSENT MATRIX                  */}
      {/* ========================================================================= */}
      {attendanceSummary && (
        <MonthlyAttendanceCalendar
          summary={attendanceSummary}
          onMonthChange={(y, m) => {
            setCalendarYear(y);
            setCalendarMonth(m);
            fetchQueueAndHistory(y, m);
          }}
          isLoading={isLoadingQueue}
          selectedDoctorName={doctor.name}
          selectedDepartment={doctor.department}
        />
      )}
    </div>
  );
}
