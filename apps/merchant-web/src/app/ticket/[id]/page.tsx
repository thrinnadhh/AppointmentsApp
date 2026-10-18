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
  ArrowRight
} from 'lucide-react';
import { RollingTenSlotQueue } from '@/components/RollingTenSlotQueue';
import { MonthlyAttendanceCalendar } from '@/components/MonthlyAttendanceCalendar';
import { QueueSlot, MonthlyAttendanceSummary } from '@/lib/queue-scheduler';

interface TicketData {
  booking: {
    id: string;
    reference_code: string;
    slot_start: string;
    slot_end: string;
    status: 'HELD' | 'CONFIRMED' | 'CHECKED_IN' | 'COMPLETED' | 'CANCELLED';
    payment_status: string;
    deposit_amount: number;
    is_present: boolean;
    checked_in_at: string | null;
    checked_in_method: string | null;
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
    name: string;
    department: string;
    duration_minutes: number;
    price: number;
  };
  checkin_code: string;
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

  const fetchTicket = async (showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      const res = await fetch(`/api/ticket/${id}`, { cache: 'no-store' });
      if (!res.ok) {
        throw new Error(`Ticket not found (${res.status})`);
      }
      const json = await res.json();
      setData(json);
      setLastUpdated(new Date());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load ticket');
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  useEffect(() => {
    fetchTicket(true);
    fetchQueueAndHistory();
    // Poll every 3 seconds for instant live updates when reception checks in
    const interval = setInterval(() => {
      fetchTicket(false);
      fetchQueueAndHistory();
    }, 3000);
    return () => clearInterval(interval);
  }, [id]);

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

  // Status mapping
  const isCheckedIn = booking.status === 'CHECKED_IN' || booking.is_present;
  const isCompleted = booking.status === 'COMPLETED';

  return (
    <div className="max-w-4xl mx-auto py-6 px-4 sm:px-6 space-y-6">
      {/* Top Breadcrumb & Live Refresh indicator */}
      <div className="flex items-center justify-between mb-4 text-xs text-gray-500">
        <span className="flex items-center gap-1.5 font-medium text-emerald-800">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          Live Reception Sync Active
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

          <h2 className="text-sm font-medium text-gray-600 mb-3">
            Please tell this 4-digit PIN at the reception desk upon arrival:
          </h2>

          {/* Big PIN Box */}
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
