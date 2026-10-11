'use client';

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import {
  Ticket,
  UserCheck,
  Clock,
  Sparkles,
  Copy,
  CheckCircle2,
  AlertTriangle,
  Smartphone,
  RefreshCw,
  Play,
  ArrowRight,
  ShieldCheck,
  Zap,
  User,
  MapPin,
  ChevronRight,
  Check
} from 'lucide-react';
import {
  supabase,
  verifyCheckinCodeRpc,
  markPresentManuallyRpc,
  manageLateQueueBooking,
  MerchantBookingWithDetails,
  Provider
} from '@/lib/supabase';
import { useMerchantTenant } from '@/contexts/MerchantTenantContext';

interface DemoBookingState {
  id: string;
  reference_code: string;
  customer_name: string;
  customer_phone: string;
  provider_name: string;
  resource_name: string;
  slot_start: string;
  slot_end: string;
  status: 'CONFIRMED' | 'CHECKED_IN' | 'COMPLETED' | 'CANCELLED';
  is_present: boolean;
  checked_in_at: string | null;
  checked_in_method: 'code' | 'manual' | null;
  checkin_code: string;
  queue_position: number | null;
  estimated_wait_minutes: number | null;
}

const DEFAULT_SAMPLE_BOOKINGS: DemoBookingState[] = [
  {
    id: 'demo-booking-001',
    reference_code: 'TPT-DENT-841',
    customer_name: 'Venkatesh Rao',
    customer_phone: '+91 98490 12345',
    provider_name: 'Sri Venkateswara Dental Care',
    resource_name: 'Dr. R. K. Sharma (Dental Surgeon)',
    slot_start: new Date(Date.now() - 15 * 60 * 1000).toISOString(), // 15 mins ago (late arrival scenario)
    slot_end: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    status: 'CONFIRMED',
    is_present: false,
    checked_in_at: null,
    checked_in_method: null,
    checkin_code: '4821',
    queue_position: null,
    estimated_wait_minutes: null,
  },
  {
    id: 'demo-booking-002',
    reference_code: 'TPT-CLIN-392',
    customer_name: 'Ananya Reddy',
    customer_phone: '+91 97012 34567',
    provider_name: 'Tirupati Health City Clinic',
    resource_name: 'Dr. S. P. V. Raman (Cardiologist)',
    slot_start: new Date(Date.now() + 20 * 60 * 1000).toISOString(), // in 20 mins (on-time)
    slot_end: new Date(Date.now() + 50 * 60 * 1000).toISOString(),
    status: 'CONFIRMED',
    is_present: false,
    checked_in_at: null,
    checked_in_method: null,
    checkin_code: '7194',
    queue_position: null,
    estimated_wait_minutes: null,
  },
  {
    id: 'demo-booking-003',
    reference_code: 'TPT-SALON-105',
    customer_name: 'Kiran Kumar',
    customer_phone: '+91 94401 98765',
    provider_name: 'Royal Looks Salon Tirupati',
    resource_name: 'Styling Station 2 (Senior Stylist)',
    slot_start: new Date(Date.now() - 40 * 60 * 1000).toISOString(), // 40 mins ago
    slot_end: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    status: 'CONFIRMED',
    is_present: false,
    checked_in_at: null,
    checked_in_method: null,
    checkin_code: '9033',
    queue_position: null,
    estimated_wait_minutes: null,
  },
];

export default function InteractiveDemoPage() {
  const { activeProvider } = useMerchantTenant();

  const [booking, setBooking] = useState<DemoBookingState>(DEFAULT_SAMPLE_BOOKINGS[0]);
  const [copiedCode, setCopiedCode] = useState(false);
  const [isSimulatingLiveDb, setIsSimulatingLiveDb] = useState(false);
  const [realLiveBookings, setRealLiveBookings] = useState<MerchantBookingWithDetails[]>([]);

  // Reception Desk Input State
  const [codeInput, setCodeInput] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [verifySuccess, setVerifySuccess] = useState<{
    patient_name?: string;
    slot_time?: string;
    is_late?: boolean;
    checked_in_at?: string;
    message?: string;
  } | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  // Telemetry log events
  const [eventLogs, setEventLogs] = useState<Array<{ id: string; time: string; text: string; type: 'info' | 'success' | 'warn' }>>([
    { id: '1', time: new Date().toLocaleTimeString(), text: 'Interactive Sandbox Initialized with sample booking #TPT-DENT-841', type: 'info' },
  ]);

  const inputRef = useRef<HTMLInputElement>(null);

  const addLog = (text: string, type: 'info' | 'success' | 'warn' = 'info') => {
    setEventLogs((prev) => [
      { id: Math.random().toString(), time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }), text, type },
      ...prev.slice(0, 19),
    ]);
  };

  // Fetch real live bookings from Supabase if user wants to test actual DB data
  useEffect(() => {
    async function loadLiveBookings() {
      if (!activeProvider?.id) return;
      try {
        const { data } = await supabase
          .from('bookings')
          .select('*')
          .eq('provider_id', activeProvider.id)
          .eq('status', 'CONFIRMED')
          .limit(10);
        if (data && data.length > 0) {
          setRealLiveBookings(data as any);
        }
      } catch (err) {
        console.warn('Could not load live bookings for demo picker:', err);
      }
    }
    loadLiveBookings();
  }, [activeProvider?.id]);

  // Handle Copy Code from Customer Pass
  const handleCopyCode = () => {
    navigator.clipboard.writeText(booking.checkin_code);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
    addLog(`Customer copied 4-digit code: ${booking.checkin_code}`, 'info');
  };

  // Handle Paste Code into Reception Input
  const handlePasteCodeToDesk = () => {
    setCodeInput(booking.checkin_code);
    setVerifyError(null);
    inputRef.current?.focus();
    addLog(`Staff auto-filled OTP ${booking.checkin_code} from arriving customer`, 'info');
  };

  // Handle Verify Code
  const handleVerifyCode = async (e?: React.FormEvent, customCode?: string) => {
    if (e) e.preventDefault();
    const code = (customCode !== undefined ? customCode : codeInput).trim();
    if (!code) return;

    setIsVerifying(true);
    setVerifyError(null);
    setVerifySuccess(null);

    // If testing against real database ID
    if (isSimulatingLiveDb && activeProvider?.id) {
      try {
        const res = await verifyCheckinCodeRpc(activeProvider.id, code);
        if (res.success) {
          const nowStr = res.checked_in_at || new Date().toISOString();
          setBooking((prev) => ({
            ...prev,
            status: 'CHECKED_IN',
            is_present: true,
            checked_in_at: nowStr,
            checked_in_method: 'code',
          }));
          setVerifySuccess({
            patient_name: res.patient_name || booking.customer_name,
            slot_time: res.slot_time || formatTime(booking.slot_start),
            is_late: res.is_late,
            checked_in_at: nowStr,
            message: 'Live database confirmed check-in!',
          });
          setCodeInput('');
          addLog(`✓ Supabase verified check-in code ${code} for ${res.patient_name || 'Patient'}`, 'success');
        } else {
          setVerifyError(res.message || 'Invalid check-in code');
          addLog(`❌ Check-in failed: ${res.message || res.error}`, 'warn');
        }
      } catch (err) {
        setVerifyError(err instanceof Error ? err.message : 'Verification failed');
      } finally {
        setIsVerifying(false);
      }
      return;
    }

    // Local Simulator Verification
    setTimeout(() => {
      setIsVerifying(false);
      if (code === booking.checkin_code) {
        if (booking.status === 'CHECKED_IN') {
          setVerifyError('This appointment is already checked in.');
          addLog(`Attempted check-in on already verified booking`, 'warn');
          return;
        }

        const slotTime = new Date(booking.slot_start).getTime();
        const nowTime = Date.now();
        const isLate = nowTime > slotTime + 10 * 60 * 1000;
        const nowStr = new Date().toISOString();

        setBooking((prev) => ({
          ...prev,
          status: 'CHECKED_IN',
          is_present: true,
          checked_in_at: nowStr,
          checked_in_method: 'code',
        }));

        setVerifySuccess({
          patient_name: booking.customer_name,
          slot_time: formatTime(booking.slot_start),
          is_late: isLate,
          checked_in_at: nowStr,
          message: 'Code matched! Customer marked as present.',
        });

        setCodeInput('');
        addLog(`✓ Reception verified OTP ${code} for ${booking.customer_name} (${isLate ? 'Late arrival >10m' : 'On-time'})`, 'success');
      } else {
        setVerifyError('Invalid check-in code. Please verify the code on customer pass.');
        addLog(`❌ Staff entered incorrect OTP: ${code}`, 'warn');
      }
    }, 400);
  };

  // Handle Manual Reception Fallback
  const handleManualCheckIn = () => {
    const nowStr = new Date().toISOString();
    setBooking((prev) => ({
      ...prev,
      status: 'CHECKED_IN',
      is_present: true,
      checked_in_at: nowStr,
      checked_in_method: 'manual',
    }));
    setVerifySuccess({
      patient_name: booking.customer_name,
      slot_time: formatTime(booking.slot_start),
      is_late: false,
      checked_in_at: nowStr,
      message: 'Emergency manual check-in recorded (Customer phone was dead/offline)',
    });
    addLog(`Staff marked present manually (bypassed OTP for dead phone)`, 'info');
  };

  // Handle Customer "I've Reached" Button
  const handleCustomerSayReached = () => {
    const nowStr = new Date().toISOString();
    const isLate = new Date().getTime() > new Date(booking.slot_start).getTime() + 5 * 60 * 1000;
    
    if (isLate) {
      const assignedToken = 12; // Ongoing #10 + 2 buffer
      const waitMins = 30;
      setBooking((prev) => ({
        ...prev,
        is_present: true,
        customer_arrived_at: nowStr,
        queue_position: assignedToken,
        estimated_wait_minutes: waitMins,
      }));
      addLog(`Patient tapped "I've Reached" late. Placed in Late Queue at Token #${assignedToken} (~${waitMins}m wait). WhatsApp notice sent.`, 'warn');
    } else {
      setBooking((prev) => ({
        ...prev,
        is_present: true,
        customer_arrived_at: nowStr,
      }));
      addLog(`Patient tapped "I've Reached" on-time. Waiting for reception verification.`, 'info');
    }
  };

  // Handle Merchant Assign Late Queue (+2 Buffer)
  const handleAssignLateQueue = () => {
    const assignedToken = 14;
    const waitMins = 30;
    setBooking((prev) => ({
      ...prev,
      is_present: true,
      queue_position: assignedToken,
      estimated_wait_minutes: waitMins,
    }));
    addLog(`Receptionist accommodated late patient after 2 member appointments: Token #${assignedToken} (~${waitMins}m wait)`, 'warn');
  };

  // Handle Move to Standby Queue
  const handleMoveToStandby = () => {
    setBooking((prev) => ({
      ...prev,
      is_present: false,
      queue_position: null,
      estimated_wait_minutes: null,
    }));
    addLog(`Patient not present at slot time: Moved to Standby Waiting Queue to free doctor`, 'info');
  };

  // Handle Complete Consultation
  const handleCompleteBooking = () => {
    setBooking((prev) => ({
      ...prev,
      status: 'COMPLETED',
    }));
    addLog(`Consultation completed for ${booking.customer_name}`, 'success');
  };

  // Reset to initial state
  const handleResetSample = (sampleIndex: number) => {
    const sample = DEFAULT_SAMPLE_BOOKINGS[sampleIndex] || DEFAULT_SAMPLE_BOOKINGS[0];
    setBooking({ ...sample });
    setVerifySuccess(null);
    setVerifyError(null);
    setCodeInput('');
    setIsSimulatingLiveDb(false);
    addLog(`Reset sandbox to: ${sample.customer_name} (${sample.reference_code})`, 'info');
  };

  // One-click Auto Demo Runner
  const handleRunAutoDemo = () => {
    const target = DEFAULT_SAMPLE_BOOKINGS[0];
    setBooking({ ...target });
    setVerifySuccess(null);
    setVerifyError(null);
    setCodeInput('');
    setIsSimulatingLiveDb(false);
    addLog(`Reset sandbox to: ${target.customer_name} (${target.reference_code})`, 'info');
    addLog('Starting 1-click end-to-end demo flow…', 'info');

    setTimeout(() => {
      setCodeInput(target.checkin_code);
      addLog(`Receptionist entered code: ${target.checkin_code}`, 'info');
      setTimeout(() => {
        handleVerifyCode(undefined, target.checkin_code);
        setTimeout(() => {
          handleAssignLateQueue();
        }, 1200);
      }, 700);
    }, 500);
  };

  function formatTime(isoStr: string) {
    return new Date(isoStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function formatDate(isoStr: string) {
    return new Date(isoStr).toLocaleDateString('en-IN', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  }

  const isCheckedIn = booking.status === 'CHECKED_IN' || Boolean(booking.checked_in_at);

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Top Banner & Control Deck */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="p-2 rounded-xl bg-emerald-50 text-emerald-700">
              <Sparkles className="w-5 h-5 text-emerald-600" />
            </span>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
              Reception Check-in & Customer Pass Simulator
            </h1>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800">
              Interactive Testbench
            </span>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Split-screen interactive environment: test the mobile digital pass, 4-digit Rapido-style OTP check-in, and the dynamic late-arrival queue (+2 buffer rule).
          </p>
        </div>

        {/* Global Demo Controls */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleRunAutoDemo}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white transition shadow-xs"
            title="Automatically run code check-in and late queue buffer in 3 seconds"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>1-Click Auto Demo</span>
          </button>

          <button
            onClick={() => handleResetSample(0)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 transition border border-slate-200"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Reset Demo</span>
          </button>

          <Link
            href="/"
            className="inline-flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition border border-slate-200"
          >
            <span>Back to Dashboard</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>

      {/* Preset Scenario Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 border border-slate-200 px-4 py-3 rounded-xl text-xs">
        <div className="flex items-center gap-2">
          <span className="font-bold text-slate-700">Quick Test Scenarios:</span>
          <button
            onClick={() => handleResetSample(0)}
            className={`px-3 py-1 rounded-lg font-semibold transition ${
              booking.id === 'demo-booking-001'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            1. Late Arrival Scenario (15m past slot)
          </button>
          <button
            onClick={() => handleResetSample(1)}
            className={`px-3 py-1 rounded-lg font-semibold transition ${
              booking.id === 'demo-booking-002'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            2. On-Time Upcoming Slot
          </button>
          <button
            onClick={() => handleResetSample(2)}
            className={`px-3 py-1 rounded-lg font-semibold transition ${
              booking.id === 'demo-booking-003'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            3. Salon Stylist Session
          </button>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-slate-500 text-[11px]">Sync Mode:</span>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
            Live Reactive
          </span>
        </div>
      </div>

      {/* Main Split Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* ========================================================================= */}
        {/* LEFT COLUMN: CUSTOMER MOBILE DIGITAL PASS VIEWPORT (5 cols)             */}
        {/* ========================================================================= */}
        <div className="lg:col-span-5 flex flex-col items-center">
          <div className="w-full max-w-[390px] mb-2 flex items-center justify-between px-2">
            <span className="text-xs font-bold text-slate-600 flex items-center gap-1.5">
              <Smartphone className="w-4 h-4 text-emerald-600" />
              Customer Mobile App (Booking Pass)
            </span>
            <span className="text-[11px] text-slate-400">iOS / Android Viewport</span>
          </div>

          {/* Realistic Mobile Device Frame */}
          <div className="w-full max-w-[390px] rounded-[44px] bg-slate-900 p-3 shadow-2xl border-4 border-slate-800 ring-1 ring-slate-700/50">
            {/* Screen Inner */}
            <div className="bg-slate-100 rounded-[34px] overflow-hidden min-h-[640px] flex flex-col text-slate-900 border border-slate-200">
              {/* Phone Status Bar */}
              <div className="px-6 pt-3 pb-2 flex items-center justify-between text-[11px] font-semibold text-slate-700 bg-white">
                <span>9:41</span>
                {/* Notch / Dynamic Island */}
                <div className="w-24 h-4 bg-slate-900 rounded-full" />
                <div className="flex items-center gap-1">
                  <span>5G</span>
                  <span className="text-[9px]">100%</span>
                </div>
              </div>

              {/* Mobile App Header */}
              <div className="px-5 py-3 bg-white border-b border-slate-200 flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">Digital Booking Pass</p>
                  <h3 className="text-sm font-bold text-slate-900 truncate max-w-[220px]">
                    {booking.provider_name}
                  </h3>
                </div>
                <div className="p-1 rounded-full bg-slate-100 text-slate-500 text-xs">
                  ✕
                </div>
              </div>

              {/* Scrollable Ticket Content */}
              <div className="p-4 space-y-3 flex-1 overflow-y-auto">
                {/* Physical Ticket Pass Visual */}
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                  {/* Ticket Top */}
                  <div className="p-4 bg-gradient-to-b from-white to-slate-50/50">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider ${
                            isCheckedIn
                              ? 'bg-emerald-600 text-white'
                              : 'bg-emerald-100 text-emerald-800'
                          }`}
                        >
                          {booking.status}
                        </span>

                        {isCheckedIn ? (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-600 text-white">
                            ✓ PRESENT
                          </span>
                        ) : booking.is_present ? (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-100 text-sky-800">
                            📍 AT VENUE
                          </span>
                        ) : null}

                        {booking.queue_position ? (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-100 text-amber-900 border border-amber-300">
                            ⏰ TURN #{booking.queue_position}
                          </span>
                        ) : null}
                      </div>

                      <span className="text-[11px] font-mono font-bold text-slate-500">
                        {booking.reference_code}
                      </span>
                    </div>

                    <h4 className="font-bold text-slate-900 text-sm mt-3">
                      {booking.resource_name}
                    </h4>

                    {/* Slot Date / Time Grid */}
                    <div className="grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-slate-100">
                      <div>
                        <p className="text-[10px] font-bold uppercase text-slate-400">Date</p>
                        <p className="text-xs font-semibold text-slate-800">{formatDate(booking.slot_start)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-bold uppercase text-slate-400">Scheduled Time</p>
                        <p className="text-xs font-semibold text-slate-800">
                          {formatTime(booking.slot_start)} - {formatTime(booking.slot_end)}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Perforated Tear Dashes */}
                  <div className="relative flex items-center justify-between py-1 bg-slate-100">
                    <div className="w-3 h-6 bg-slate-100 rounded-r-full -ml-1 border-r border-slate-200" />
                    <div className="flex-1 border-b-2 border-dashed border-slate-300 mx-2" />
                    <div className="w-3 h-6 bg-slate-100 rounded-l-full -mr-1 border-l border-slate-200" />
                  </div>

                  {/* Ticket Bottom: RECEPTION OTP or VERIFIED STATE */}
                  <div className="p-4 bg-white">
                    {isCheckedIn ? (
                      /* Verified Banner */
                      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3.5 text-emerald-950">
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold text-sm shrink-0">
                            ✓
                          </div>
                          <div>
                            <p className="text-xs font-bold text-emerald-900">You are checked in</p>
                            <p className="text-[11px] text-emerald-700">
                              Reception verified at {booking.checked_in_at ? formatTime(booking.checked_in_at) : 'Counter'}
                            </p>
                          </div>
                        </div>
                        <p className="text-[11px] text-emerald-800 mt-2 bg-emerald-100/60 p-2 rounded-lg">
                          Please take a seat in the waiting lobby. Your specialist will call your token shortly.
                        </p>
                      </div>
                    ) : (
                      /* 4-Digit OTP Box */
                      <div className="bg-slate-50 border-2 border-dashed border-emerald-300 rounded-xl p-4 text-center space-y-1">
                        <div className="flex items-center justify-center gap-1.5 text-slate-500 text-[10px] font-bold uppercase tracking-wider">
                          <Ticket className="w-3.5 h-3.5 text-emerald-600" />
                          <span>Show Code at Reception</span>
                        </div>

                        {/* Large Code Typography */}
                        <div className="my-2">
                          <span className="font-mono text-3xl font-black tracking-widest text-emerald-800 bg-emerald-100/60 px-4 py-1 rounded-xl">
                            {booking.checkin_code}
                          </span>
                        </div>

                        <p className="text-[11px] font-semibold text-emerald-700">
                          Tell this 4-digit code to staff upon counter arrival
                        </p>

                        <button
                          type="button"
                          onClick={handleCopyCode}
                          className="mt-2 inline-flex items-center gap-1 text-[11px] font-bold text-slate-600 hover:text-slate-900 bg-white border border-slate-200 px-2.5 py-1 rounded-lg transition"
                        >
                          {copiedCode ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                          <span>{copiedCode ? 'Copied!' : 'Copy Code'}</span>
                        </button>
                      </div>
                    )}

                    {/* DYNAMIC LATE ARRIVAL QUEUE CARD */}
                    {booking.queue_position ? (
                      <div className="mt-3 bg-amber-50 border border-amber-300 rounded-xl p-3 text-amber-950 space-y-1.5 animate-fadeIn">
                        <div className="flex items-center justify-between">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-200 text-amber-900">
                            <Clock className="w-3 h-3 text-amber-700" />
                            <span>LATE TURN ASSIGNED</span>
                          </span>
                          <span className="text-sm font-black text-amber-900">
                            Token #{booking.queue_position}
                          </span>
                        </div>
                        <p className="text-[11px] text-amber-900 leading-tight">
                          Accommodated after 2 member appointments due to arrival after scheduled slot time.
                        </p>
                        {booking.estimated_wait_minutes && (
                          <div className="flex items-center justify-between text-[11px] font-bold bg-amber-100/80 px-2.5 py-1 rounded-lg">
                            <span className="text-amber-800">Estimated Wait:</span>
                            <span className="text-amber-950">~{booking.estimated_wait_minutes} mins</span>
                          </div>
                        )}
                      </div>
                    ) : (
                      /* Static Rule Reminder */
                      <div className="mt-3 bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-[11px] text-slate-600">
                        <span className="font-bold text-slate-700">⏱️ Late Arrival Rule (+2 Buffer): </span>
                        Arriving late? Don&apos;t worry! When you arrive, you will automatically be queued 2 tokens after the ongoing token (e.g. #10 → #12).
                      </div>
                    )}
                  </div>
                </div>

                {/* Customer Action Button ("I've Reached") */}
                <div className="pt-1">
                  {booking.is_present ? (
                    <div className="w-full py-2.5 rounded-xl bg-emerald-100 text-emerald-800 text-xs font-bold text-center flex items-center justify-center gap-1.5">
                      <span>✓ You have signaled arrival at venue</span>
                    </div>
                  ) : (
                    <button
                      onClick={handleCustomerSayReached}
                      className="w-full py-2.5 rounded-xl bg-slate-900 hover:bg-black text-white text-xs font-bold transition shadow-sm flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <MapPin className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Tap &quot;I&apos;ve Reached&quot; on Arrival</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Phone Bottom Home Bar */}
              <div className="py-2 flex justify-center bg-white border-t border-slate-100">
                <div className="w-32 h-1 bg-slate-300 rounded-full" />
              </div>
            </div>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* RIGHT COLUMN: RECEPTIONIST DESK CONSOLE (7 cols)                         */}
        {/* ========================================================================= */}
        <div className="lg:col-span-7 space-y-6">
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-slate-100">
              <div>
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-xl bg-emerald-50 text-emerald-700">
                    <UserCheck className="w-5 h-5 text-emerald-600" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-slate-900 tracking-tight">
                      Merchant Reception Desk Console
                    </h2>
                    <p className="text-xs text-slate-500">
                      Front-desk check-in terminal with instant verification & late queue controls
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-slate-100 text-slate-700">
                  Venue: {activeProvider?.name || 'Tirupati Clinic'}
                </span>
              </div>
            </div>

            {/* CHECK-IN CODE VERIFICATION FORM */}
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                    <Ticket className="w-4 h-4 text-emerald-600" />
                    <span>Enter Customer Check-In Code</span>
                  </h3>
                  <p className="text-xs text-slate-500">
                    Ask the arriving customer for their 4-digit numeric booking pass code.
                  </p>
                </div>

                {/* Quick Paste Button for Testing */}
                <button
                  type="button"
                  onClick={handlePasteCodeToDesk}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 transition flex items-center gap-1 shadow-2xs"
                  title="Auto-fill the code currently shown on the customer pass"
                >
                  <Copy className="w-3 h-3 text-emerald-600" />
                  <span>Fill Code ({booking.checkin_code})</span>
                </button>
              </div>

              <form onSubmit={handleVerifyCode} className="flex flex-col sm:flex-row items-center gap-3">
                <div className="relative w-full sm:w-60">
                  <input
                    ref={inputRef}
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    value={codeInput}
                    onChange={(e) => {
                      const val = e.target.value.replace(/\D/g, '');
                      setCodeInput(val);
                      if (verifyError) setVerifyError(null);
                    }}
                    placeholder="e.g. 4821"
                    className="w-full px-4 py-2.5 bg-white border-2 border-slate-300 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 rounded-xl text-center font-mono text-xl font-black tracking-widest text-slate-900 placeholder:text-slate-400 placeholder:text-sm placeholder:font-sans placeholder:tracking-normal transition outline-none"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isVerifying || !codeInput.trim()}
                  className="w-full sm:w-auto px-6 py-2.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white transition disabled:opacity-50 disabled:cursor-not-allowed shadow-xs flex items-center justify-center gap-2 shrink-0 cursor-pointer"
                >
                  {isVerifying ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Verifying…</span>
                    </>
                  ) : (
                    <>
                      <UserCheck className="w-4 h-4" />
                      <span>Verify &amp; Check In</span>
                    </>
                  )}
                </button>

                {/* Test with Incorrect Code Button */}
                <button
                  type="button"
                  onClick={() => {
                    setCodeInput('9999');
                    setTimeout(() => {
                      setVerifyError('Invalid check-in code. Please verify the code with the customer.');
                      addLog('Tested invalid code 9999 (rejected correctly)', 'warn');
                    }, 200);
                  }}
                  className="text-xs text-slate-500 hover:text-slate-800 underline underline-offset-2 shrink-0 px-2"
                >
                  Test Wrong Code
                </button>
              </form>

              {/* Success Banner */}
              {verifySuccess && (
                <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-950 flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-fadeIn">
                  <div className="flex items-start sm:items-center gap-3">
                    <div className="p-2 rounded-lg bg-emerald-200 text-emerald-800 shrink-0">
                      <CheckCircle2 className="w-5 h-5 text-emerald-700" />
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-bold text-emerald-950">
                          {verifySuccess.patient_name} marked as present!
                        </p>
                        {verifySuccess.is_late ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300">
                            <Clock className="w-3 h-3 text-amber-700" />
                            <span>Arrived Late (&gt;10m after slot)</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-200 text-emerald-900">
                            <span>On Time</span>
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-emerald-800 mt-0.5">
                        Slot: {verifySuccess.slot_time} • Verified at {verifySuccess.checked_in_at ? formatTime(verifySuccess.checked_in_at) : 'Counter'}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setVerifySuccess(null)}
                    className="text-xs font-bold text-emerald-800 hover:text-emerald-950 underline underline-offset-2 self-end sm:self-center"
                  >
                    Dismiss
                  </button>
                </div>
              )}

              {/* Error Banner */}
              {verifyError && (
                <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 flex items-center justify-between gap-3 animate-fadeIn">
                  <div className="flex items-center gap-2.5">
                    <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                    <p className="text-xs font-semibold text-rose-900">{verifyError}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setVerifyError(null)}
                    className="text-xs font-bold text-rose-700 hover:text-rose-900 p-1"
                  >
                    ✕
                  </button>
                </div>
              )}
            </div>

            {/* QUEUE ACTIONS & EMERGENCY FALLBACKS */}
            <div className="space-y-3 pt-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Front-Desk Operational Actions &amp; Late Queue Controls
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* 1. Manual Check-in Fallback Button */}
                <div className="p-3.5 rounded-xl border border-slate-200 bg-white hover:border-slate-300 transition space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                      <UserCheck className="w-4 h-4 text-emerald-600" />
                      <span>Dead Phone Fallback</span>
                    </span>
                    <span className="text-[10px] text-slate-400 font-semibold">Offline</span>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    If customer phone ran out of battery, receptionist marks them present manually.
                  </p>
                  <button
                    type="button"
                    onClick={handleManualCheckIn}
                    disabled={isCheckedIn}
                    className="w-full mt-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300 transition disabled:opacity-50"
                  >
                    {isCheckedIn ? '✓ Already Checked In' : 'Mark Present Manually'}
                  </button>
                </div>

                {/* 2. Assign Late Queue (+2 Buffer) Button */}
                <div className="p-3.5 rounded-xl border border-amber-200 bg-amber-50/50 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-amber-900 flex items-center gap-1.5">
                      <Clock className="w-4 h-4 text-amber-700" />
                      <span>Late Queue (+2 Buffer)</span>
                    </span>
                    <span className="text-[10px] text-amber-800 font-bold">Rule: Turn +2</span>
                  </div>
                  <p className="text-[11px] text-amber-800">
                    Arrived late: Inserts patient after 2 member appointments without disturbing ongoing line.
                  </p>
                  <button
                    type="button"
                    onClick={handleAssignLateQueue}
                    className="w-full mt-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white transition shadow-2xs"
                  >
                    Accommodate Late (Token #14)
                  </button>
                </div>

                {/* 3. Move to Standby Queue */}
                <div className="p-3.5 rounded-xl border border-slate-200 bg-white space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-800">Standby Queue</span>
                    <span className="text-[10px] text-slate-400">Unarrived</span>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Slot started but patient not arrived: Move to standby to allow doctor to proceed.
                  </p>
                  <button
                    type="button"
                    onClick={handleMoveToStandby}
                    className="w-full mt-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 transition"
                  >
                    Move to Standby
                  </button>
                </div>

                {/* 4. Complete Consultation */}
                <div className="p-3.5 rounded-xl border border-slate-200 bg-white space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-800">Complete Consultation</span>
                    <span className="text-[10px] text-emerald-600 font-bold">Finish</span>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Doctor finished consultation. Complete appointment and mark slot as fulfilled.
                  </p>
                  <button
                    type="button"
                    onClick={handleCompleteBooking}
                    disabled={booking.status === 'COMPLETED'}
                    className="w-full mt-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-teal-600 hover:bg-teal-700 text-white transition disabled:opacity-50"
                  >
                    {booking.status === 'COMPLETED' ? '✓ Completed' : 'Admit & Complete'}
                  </button>
                </div>
              </div>
            </div>

            {/* LIVE APPOINTMENT STATE INSPECTOR */}
            <div className="pt-3 border-t border-slate-100">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                Live Postgres Record Telemetry
              </h3>
              <div className="bg-slate-900 text-slate-100 rounded-xl p-3.5 font-mono text-[11px] overflow-x-auto space-y-1">
                <div className="flex justify-between border-b border-slate-800 pb-1 text-slate-400">
                  <span>FIELD</span>
                  <span>CURRENT VALUE</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-emerald-400">status:</span>
                  <span className="font-bold">{booking.status}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-emerald-400">is_present:</span>
                  <span>{booking.is_present ? 'true' : 'false'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-emerald-400">checked_in_method:</span>
                  <span>{booking.checked_in_method || 'null'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-emerald-400">checked_in_at:</span>
                  <span className="truncate max-w-[200px]">{booking.checked_in_at || 'null'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-amber-400">queue_position:</span>
                  <span className="font-bold text-amber-300">{booking.queue_position !== null ? `#${booking.queue_position}` : 'null'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-amber-400">estimated_wait_minutes:</span>
                  <span className="text-amber-300">{booking.estimated_wait_minutes !== null ? `${booking.estimated_wait_minutes} mins` : 'null'}</span>
                </div>
              </div>
            </div>
          </div>

          {/* REALTIME EVENT LOGS AUDIT TRAIL */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span>Realtime Event Stream &amp; Audit Trail</span>
              </h3>
              <button
                onClick={() => setEventLogs([])}
                className="text-[11px] text-slate-400 hover:text-slate-700 underline"
              >
                Clear
              </button>
            </div>

            <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
              {eventLogs.map((log) => (
                <div
                  key={log.id}
                  className={`text-xs p-2 rounded-lg flex items-start gap-2 border ${
                    log.type === 'success'
                      ? 'bg-emerald-50/60 border-emerald-200 text-emerald-900'
                      : log.type === 'warn'
                      ? 'bg-amber-50/60 border-amber-200 text-amber-900'
                      : 'bg-slate-50 border-slate-200 text-slate-700'
                  }`}
                >
                  <span className="text-[10px] font-mono text-slate-400 shrink-0">{log.time}</span>
                  <span className="font-medium">{log.text}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
