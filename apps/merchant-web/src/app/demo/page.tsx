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
  Check,
  Building2,
  Users,
  Activity,
  CalendarDays,
  Flame,
  ArrowUpRight
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

export interface HospitalQueueToken {
  tokenNumber: number;
  patientName: string;
  slotTime: string;
  expectedTime: string;
  status: 'COMPLETED' | 'IN_CONSULTATION' | 'PRESENT_READY' | 'NOT_PRESENT' | 'LATE_QUEUE';
  code?: string;
  isCurrentCustomer?: boolean;
  lateTurnNumber?: number;
  estimatedWaitMinutes?: number;
}

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

const INITIAL_TRINADH_HOSPITAL_QUEUE: HospitalQueueToken[] = [
  {
    tokenNumber: 1,
    patientName: 'Suresh Babu',
    slotTime: '09:00 - 09:15',
    expectedTime: '09:00 AM',
    status: 'COMPLETED',
  },
  {
    tokenNumber: 2,
    patientName: 'Lakshmi Devi',
    slotTime: '09:15 - 09:30',
    expectedTime: '09:15 AM',
    status: 'IN_CONSULTATION',
  },
  {
    tokenNumber: 3,
    patientName: 'Rajesh Sharma',
    slotTime: '09:30 - 09:45',
    expectedTime: '09:30 AM',
    status: 'PRESENT_READY',
  },
  {
    tokenNumber: 4,
    patientName: 'Venkatesh Rao (You)',
    slotTime: '09:45 - 10:00',
    expectedTime: '09:45 AM',
    status: 'NOT_PRESENT', // Starts RED (Not present) until code is given to reception
    code: '4821',
    isCurrentCustomer: true,
    estimatedWaitMinutes: 15,
  },
  {
    tokenNumber: 5,
    patientName: 'Priya Nair',
    slotTime: '10:00 - 10:15',
    expectedTime: '10:00 AM',
    status: 'NOT_PRESENT',
    estimatedWaitMinutes: 30,
  },
  {
    tokenNumber: 6,
    patientName: 'Anand Mohan',
    slotTime: '10:15 - 10:30',
    expectedTime: '10:15 AM',
    status: 'NOT_PRESENT',
    estimatedWaitMinutes: 45,
  },
  {
    tokenNumber: 7,
    patientName: 'Haritha P.',
    slotTime: '10:30 - 10:45',
    expectedTime: '10:30 AM',
    status: 'NOT_PRESENT',
    estimatedWaitMinutes: 60,
  },
  {
    tokenNumber: 8,
    patientName: 'Subba Rao',
    slotTime: '10:45 - 11:00',
    expectedTime: '10:45 AM',
    status: 'NOT_PRESENT',
    estimatedWaitMinutes: 75,
  },
];

const DEFAULT_SAMPLE_BOOKINGS: DemoBookingState[] = [
  {
    id: 'demo-booking-001',
    reference_code: 'TNH-CARD-04',
    customer_name: 'Venkatesh Rao',
    customer_phone: '+91 98490 12345',
    provider_name: 'Trinadh Multi-Speciality Hospital',
    resource_name: 'Dr. K. Trinadh (Chief Physician & Cardiologist)',
    slot_start: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    slot_end: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    status: 'CONFIRMED',
    is_present: false,
    checked_in_at: null,
    checked_in_method: null,
    checkin_code: '4821',
    queue_position: null,
    estimated_wait_minutes: 15,
  },
  {
    id: 'demo-booking-002',
    reference_code: 'TNH-DENT-02',
    customer_name: 'Ananya Reddy',
    customer_phone: '+91 97012 34567',
    provider_name: 'Trinadh Multi-Speciality Hospital',
    resource_name: 'Dr. S. P. V. Raman (Dental Surgeon)',
    slot_start: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
    slot_end: new Date(Date.now() + 50 * 60 * 1000).toISOString(),
    status: 'CONFIRMED',
    is_present: false,
    checked_in_at: null,
    checked_in_method: null,
    checkin_code: '7194',
    queue_position: null,
    estimated_wait_minutes: 25,
  },
  {
    id: 'demo-booking-003',
    reference_code: 'TPT-SALON-105',
    customer_name: 'Kiran Kumar',
    customer_phone: '+91 94401 98765',
    provider_name: 'Royal Looks Salon Tirupati',
    resource_name: 'Styling Station 2 (Senior Stylist)',
    slot_start: new Date(Date.now() - 40 * 60 * 1000).toISOString(),
    slot_end: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    status: 'CONFIRMED',
    is_present: false,
    checked_in_at: null,
    checked_in_method: null,
    checkin_code: '9033',
    queue_position: null,
    estimated_wait_minutes: 30,
  },
];

export default function InteractiveDemoPage() {
  const { activeProvider } = useMerchantTenant();

  const [booking, setBooking] = useState<DemoBookingState>(DEFAULT_SAMPLE_BOOKINGS[0]);
  const [copiedCode, setCopiedCode] = useState(false);
  const [mobileActiveTab, setMobileActiveTab] = useState<'pass' | 'queue'>('pass');

  // Hospital Live OPD Queue State (Tokens #1 to #N)
  const [hospitalQueue, setHospitalQueue] = useState<HospitalQueueToken[]>(INITIAL_TRINADH_HOSPITAL_QUEUE);
  const [lateComersQueue, setLateComersQueue] = useState<Array<{
    turnNumber: number;
    patientName: string;
    originalSlot: string;
    expectedWait: string;
    code: string;
    isCurrentCustomer?: boolean;
  }>>([
    {
      turnNumber: 12,
      patientName: 'Ramesh Varma',
      originalSlot: '08:45 AM',
      expectedWait: '~25 mins wait',
      code: '3109',
    },
  ]);

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
    { id: '1', time: new Date().toLocaleTimeString(), text: 'Trinadh Hospital OPD Live Queue Initialized (Tokens #1 to #8)', type: 'info' },
  ]);

  const inputRef = useRef<HTMLInputElement>(null);

  const addLog = (text: string, type: 'info' | 'success' | 'warn' = 'info') => {
    setEventLogs((prev) => [
      { id: Math.random().toString(), time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }), text, type },
      ...prev.slice(0, 24),
    ]);
  };

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

    setTimeout(() => {
      setIsVerifying(false);

      if (code === booking.checkin_code || code === '4821') {
        if (booking.status === 'CHECKED_IN' && booking.is_present) {
          setVerifyError('This patient is already verified and present.');
          addLog(`Attempted check-in on already verified booking`, 'warn');
          return;
        }

        const nowStr = new Date().toISOString();
        const nowTimeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        // Flip booking state to CHECKED_IN (GREEN)
        setBooking((prev) => ({
          ...prev,
          status: 'CHECKED_IN',
          is_present: true,
          checked_in_at: nowStr,
          checked_in_method: 'code',
        }));

        // Flip Token #4 on Hospital Queue from RED to GREEN!
        setHospitalQueue((prev) =>
          prev.map((tok) =>
            tok.tokenNumber === 4
              ? {
                  ...tok,
                  status: 'PRESENT_READY',
                }
              : tok
          )
        );

        setVerifySuccess({
          patient_name: booking.customer_name,
          slot_time: formatTime(booking.slot_start),
          is_late: false,
          checked_in_at: nowStr,
          message: 'Code 4821 verified! Token #4 turned GREEN (Present & Ready in Lobby).',
        });

        addLog(`✓ Reception verified OTP ${code} for ${booking.customer_name} — Token #4 turned GREEN (Present & Ready)!`, 'success');
      } else {
        setVerifyError('Invalid check-in code. Please verify the code on the customer pass.');
        addLog(`❌ Check-in rejected: Code ${code} does not match active booking`, 'warn');
      }
    }, 350);
  };

  // Handle Manual Fallback (Dead Phone)
  const handleMarkPresentManual = () => {
    const nowStr = new Date().toISOString();
    setBooking((prev) => ({
      ...prev,
      status: 'CHECKED_IN',
      is_present: true,
      checked_in_at: nowStr,
      checked_in_method: 'manual',
    }));

    setHospitalQueue((prev) =>
      prev.map((tok) =>
        tok.tokenNumber === 4
          ? {
              ...tok,
              status: 'PRESENT_READY',
            }
          : tok
      )
    );

    setVerifySuccess({
      patient_name: booking.customer_name,
      slot_time: formatTime(booking.slot_start),
      is_late: false,
      checked_in_at: nowStr,
      message: 'Patient marked present manually (Offline / Dead phone fallback).',
    });

    addLog(`Staff marked ${booking.customer_name} present manually — Token #4 turned GREEN!`, 'success');
  };

  // Handle Throw into Late Comers Queue (+2 Rule)
  const handleThrowToLateQueue = (customTurn = 14) => {
    setBooking((prev) => ({
      ...prev,
      queue_position: customTurn,
      estimated_wait_minutes: 35,
    }));

    // Update hospital queue state
    setHospitalQueue((prev) =>
      prev.map((tok) =>
        tok.tokenNumber === 4
          ? {
              ...tok,
              status: 'LATE_QUEUE',
              lateTurnNumber: customTurn,
              estimatedWaitMinutes: 35,
            }
          : tok
      )
    );

    // Add to late comers list if not present
    setLateComersQueue((prev) => {
      if (prev.some((l) => l.isCurrentCustomer)) return prev;
      return [
        ...prev,
        {
          turnNumber: customTurn,
          patientName: `${booking.customer_name} (Late Arrival)`,
          originalSlot: formatTime(booking.slot_start),
          expectedWait: '~35 mins wait',
          code: booking.checkin_code,
          isCurrentCustomer: true,
        },
      ];
    });

    addLog(`⏰ Patient threw into Late Comers Queue (+2 buffer rule): Assigned Turn #${customTurn} (~35m wait)`, 'warn');
  };

  // Reset to initial state
  const handleResetSample = (sampleIndex: number) => {
    const sample = DEFAULT_SAMPLE_BOOKINGS[sampleIndex] || DEFAULT_SAMPLE_BOOKINGS[0];
    setBooking({ ...sample });
    setVerifySuccess(null);
    setVerifyError(null);
    setCodeInput('');
    setHospitalQueue(INITIAL_TRINADH_HOSPITAL_QUEUE);
    setLateComersQueue([
      {
        turnNumber: 12,
        patientName: 'Ramesh Varma',
        originalSlot: '08:45 AM',
        expectedWait: '~25 mins wait',
        code: '3109',
      },
    ]);
    addLog(`Reset sandbox to: ${sample.customer_name} at ${sample.provider_name}`, 'info');
  };

  // One-click Auto Demo Runner
  const handleRunAutoDemo = () => {
    const target = DEFAULT_SAMPLE_BOOKINGS[0];
    handleResetSample(0);
    addLog('Starting 1-click end-to-end hospital queue flow…', 'info');

    setTimeout(() => {
      // Step 1: Customer approaches desk, staff enters code
      setCodeInput(target.checkin_code);
      addLog(`Receptionist enters 4-digit code: ${target.checkin_code}`, 'info');

      setTimeout(() => {
        // Step 2: Code verified -> Status turns GREEN!
        handleVerifyCode(undefined, target.checkin_code);

        setTimeout(() => {
          // Step 3: Demonstrate Late Comers Queue throwing
          handleThrowToLateQueue(14);
        }, 1300);
      }, 700);
    }, 500);
  };

  function formatTime(isoStr: string) {
    return new Date(isoStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  const isCheckedIn = booking.status === 'CHECKED_IN' || Boolean(booking.checked_in_at);
  const isInLateQueue = Boolean(booking.queue_position);

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
              Hospital Live OPD Queue &amp; Check-In Simulator
            </h1>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800">
              Interactive Testbench
            </span>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Simulate <strong>Trinadh Multi-Speciality Hospital</strong>: tokens #1 to #N, green present indicator on OTP match, red for unarrived, and dynamic late-comers queue.
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
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-bold text-slate-700">Hospital Scenarios:</span>
          <button
            onClick={() => handleResetSample(0)}
            className={`px-3 py-1 rounded-lg font-semibold transition ${
              booking.id === 'demo-booking-001'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            1. Trinadh Hospital OPD Queue (Tokens #1–#8)
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
            Live Reactive (Sub-50ms)
          </span>
        </div>
      </div>

      {/* Main Split Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* ========================================================================= */}
        {/* LEFT COLUMN: CUSTOMER MOBILE DIGITAL PASS & QUEUE TRACKER (5 cols)        */}
        {/* ========================================================================= */}
        <div className="lg:col-span-5 flex flex-col items-center">
          <div className="w-full max-w-[390px] mb-2 flex items-center justify-between px-2">
            <span className="text-xs font-bold text-slate-600 flex items-center gap-1.5">
              <Smartphone className="w-4 h-4 text-emerald-600" />
              Patient Mobile App (Live Queue View)
            </span>
            <span className="text-[11px] text-slate-400">iOS / Android Viewport</span>
          </div>

          {/* Realistic Mobile Device Frame */}
          <div className="w-full max-w-[390px] rounded-[44px] bg-slate-900 p-3 shadow-2xl border-4 border-slate-800 ring-1 ring-slate-700/50">
            {/* Screen Inner */}
            <div className="bg-slate-100 rounded-[34px] overflow-hidden min-h-[660px] flex flex-col text-slate-900 border border-slate-200">
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
                  <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">Digital OPD Pass</p>
                  <h3 className="text-sm font-bold text-slate-900 truncate max-w-[220px]">
                    {booking.provider_name}
                  </h3>
                </div>
                <div className="flex items-center gap-1 text-[11px] font-mono font-bold bg-slate-100 text-slate-600 px-2 py-0.5 rounded-md">
                  <span>OPD #4</span>
                </div>
              </div>

              {/* Customer View Tabs: Pass vs Full Queue */}
              <div className="flex border-b border-slate-200 bg-white text-xs font-bold">
                <button
                  onClick={() => setMobileActiveTab('pass')}
                  className={`flex-1 py-2.5 text-center transition border-b-2 ${
                    mobileActiveTab === 'pass'
                      ? 'border-emerald-600 text-emerald-700 bg-emerald-50/40'
                      : 'border-transparent text-slate-500 hover:text-slate-900'
                  }`}
                >
                  🎟️ My OPD Pass
                </button>
                <button
                  onClick={() => setMobileActiveTab('queue')}
                  className={`flex-1 py-2.5 text-center transition border-b-2 ${
                    mobileActiveTab === 'queue'
                      ? 'border-emerald-600 text-emerald-700 bg-emerald-50/40'
                      : 'border-transparent text-slate-500 hover:text-slate-900'
                  }`}
                >
                  🏥 Hospital Live Queue (#1–#8)
                </button>
              </div>

              {/* Content Area */}
              <div className="p-4 space-y-3 flex-1 overflow-y-auto">
                {mobileActiveTab === 'pass' ? (
                  <>
                    {/* Live Queue Status Summary Box */}
                    <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-2xs space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Live Hospital OPD Token</span>
                        <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
                          Dr. K. Trinadh
                        </span>
                      </div>

                      <div className="flex items-center justify-between pt-1">
                        <div>
                          <p className="text-[11px] text-slate-500">Your Assigned Token</p>
                          <p className="text-2xl font-black font-mono text-slate-900">
                            {isInLateQueue ? `Token #14` : `Token #4`}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-[11px] text-slate-500">Now Serving</p>
                          <p className="text-lg font-bold font-mono text-emerald-700">
                            Token #2
                          </p>
                        </div>
                      </div>

                      <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs">
                        <span className="text-slate-500">Expected Time:</span>
                        <span className="font-bold text-slate-900">
                          {isInLateQueue ? '10:20 AM (~35m wait)' : '09:45 AM (~15m wait)'}
                        </span>
                      </div>
                    </div>

                    {/* READINESS & PRESENCE COLOR CARD (THE MAIN FEATURE REQUESTED) */}
                    {isCheckedIn ? (
                      /* 🟢 GREEN: Customer gave code to receptionist -> MARKED PRESENT & READY */
                      <div className="p-4 rounded-2xl bg-emerald-50 border-2 border-emerald-500 text-emerald-950 shadow-sm space-y-2 animate-fadeIn">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold text-xs shrink-0">
                            ✓
                          </div>
                          <div>
                            <h4 className="text-xs font-black uppercase tracking-wider text-emerald-900">
                              🟢 Present &amp; Ready in Lobby
                            </h4>
                            <p className="text-[11px] text-emerald-700">
                              Reception verified your check-in code at {formatTime(booking.checked_in_at || new Date().toISOString())}
                            </p>
                          </div>
                        </div>
                        <div className="p-2.5 rounded-xl bg-white/80 border border-emerald-200 text-xs text-emerald-900">
                          <p className="font-medium">
                            Please take a seat in the OPD waiting lobby. Dr. K. Trinadh will call <strong>Token #4</strong> shortly.
                          </p>
                        </div>
                      </div>
                    ) : (
                      /* 🔴 RED: Customer has NOT checked in -> SHOWN IN RED COLOR */
                      <div className="p-4 rounded-2xl bg-rose-50 border-2 border-rose-400 text-rose-950 shadow-sm space-y-3">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-rose-500 text-white flex items-center justify-center font-bold text-xs shrink-0">
                            ✕
                          </div>
                          <div>
                            <h4 className="text-xs font-black uppercase tracking-wider text-rose-900">
                              🔴 Awaiting Check-In (Not Present)
                            </h4>
                            <p className="text-[11px] text-rose-700">
                              Tell this 4-digit code to the receptionist upon arrival
                            </p>
                          </div>
                        </div>

                        {/* 4-Digit OTP Display */}
                        <div className="p-3.5 bg-white rounded-xl border border-rose-200 text-center space-y-1">
                          <span className="text-[10px] font-extrabold uppercase tracking-widest text-rose-600">
                            RECEPTION CHECK-IN OTP
                          </span>
                          <div className="text-3xl font-black font-mono tracking-widest text-slate-900">
                            {booking.checkin_code}
                          </div>
                          <p className="text-[10px] text-slate-500">
                            Once entered by staff, your card turns <strong>GREEN</strong>
                          </p>
                        </div>

                        <button
                          onClick={handleCopyCode}
                          className="w-full py-2 rounded-xl text-xs font-bold bg-white hover:bg-rose-100 text-rose-800 border border-rose-300 transition flex items-center justify-center gap-1.5 shadow-2xs"
                        >
                          {copiedCode ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                          <span>{copiedCode ? 'Copied to Clipboard!' : 'Copy 4-Digit Code'}</span>
                        </button>
                      </div>
                    )}

                    {/* LATE COMERS QUEUE CARD (AMBER) */}
                    {isInLateQueue && (
                      <div className="p-4 rounded-2xl bg-amber-50 border-2 border-amber-400 text-amber-950 shadow-sm space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-200 text-amber-900 border border-amber-300">
                            <Clock className="w-3 h-3 text-amber-700" />
                            <span>⏰ LATE COMERS QUEUE</span>
                          </span>
                          <span className="text-xs font-mono font-black text-amber-900">
                            Token #14
                          </span>
                        </div>
                        <p className="text-xs text-amber-900 font-medium">
                          Accommodated after 2 ongoing appointments due to late arrival.
                        </p>
                        <p className="text-[11px] text-amber-700">
                          Estimated Wait: <strong>~35 mins</strong> • Rescheduled turn
                        </p>
                      </div>
                    )}

                    {/* Hospital Doctor & Details */}
                    <div className="bg-white rounded-2xl p-4 border border-slate-200 text-xs space-y-2">
                      <div className="flex items-center gap-2">
                        <Building2 className="w-4 h-4 text-emerald-600 shrink-0" />
                        <div>
                          <p className="font-bold text-slate-900">{booking.provider_name}</p>
                          <p className="text-[11px] text-slate-500">{booking.resource_name}</p>
                        </div>
                      </div>
                      <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-slate-600 text-[11px]">
                        <span>Scheduled Slot:</span>
                        <span className="font-semibold text-slate-900">09:45 AM - 10:00 AM</span>
                      </div>
                    </div>
                  </>
                ) : (
                  /* FULL HOSPITAL QUEUE VIEW (#1 to #N) ON CUSTOMER PHONE */
                  <div className="space-y-2.5">
                    <div className="bg-white p-3 rounded-xl border border-slate-200 flex items-center justify-between text-xs">
                      <div>
                        <p className="font-bold text-slate-900">Trinadh Hospital OPD Queue</p>
                        <p className="text-[10px] text-slate-500">8 total appointments scheduled today</p>
                      </div>
                      <span className="text-[11px] font-mono font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                        Serving #2
                      </span>
                    </div>

                    <div className="space-y-1.5">
                      {hospitalQueue.map((tok) => {
                        const isCurrent = tok.tokenNumber === 4;
                        return (
                          <div
                            key={tok.tokenNumber}
                            className={`p-2.5 rounded-xl border transition flex items-center justify-between text-xs ${
                              isCurrent
                                ? isCheckedIn
                                  ? 'bg-emerald-50 border-2 border-emerald-500 shadow-2xs'
                                  : 'bg-rose-50 border-2 border-rose-400 shadow-2xs'
                                : tok.status === 'COMPLETED'
                                ? 'bg-slate-50 border-slate-200 opacity-60'
                                : tok.status === 'IN_CONSULTATION'
                                ? 'bg-blue-50 border-blue-300'
                                : tok.status === 'PRESENT_READY'
                                ? 'bg-emerald-50/80 border-emerald-300'
                                : 'bg-white border-slate-200'
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <span className="w-7 h-7 rounded-lg bg-slate-100 font-mono font-bold flex items-center justify-center text-xs text-slate-700">
                                #{tok.tokenNumber}
                              </span>
                              <div>
                                <p className="font-bold text-slate-900 flex items-center gap-1.5">
                                  <span>{tok.patientName}</span>
                                  {isCurrent && (
                                    <span className="text-[9px] px-1.5 py-0.2 rounded-full bg-slate-900 text-white font-mono">
                                      YOU
                                    </span>
                                  )}
                                </p>
                                <p className="text-[10px] text-slate-500">
                                  {tok.slotTime} • Est: {tok.expectedTime}
                                </p>
                              </div>
                            </div>

                            <div>
                              {tok.status === 'COMPLETED' ? (
                                <span className="text-[10px] font-semibold text-slate-500">Done</span>
                              ) : tok.status === 'IN_CONSULTATION' ? (
                                <span className="text-[10px] font-bold text-blue-700 bg-blue-100 px-2 py-0.5 rounded-full">
                                  Inside Dr.
                                </span>
                              ) : tok.status === 'PRESENT_READY' || (isCurrent && isCheckedIn) ? (
                                <span className="text-[10px] font-extrabold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-full border border-emerald-300">
                                  🟢 Present
                                </span>
                              ) : (
                                <span className="text-[10px] font-extrabold text-rose-800 bg-rose-100 px-2 py-0.5 rounded-full border border-rose-200">
                                  🔴 Waiting
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Late Comers Queue on Phone */}
                    <div className="mt-3 p-3 bg-amber-50 rounded-xl border border-amber-200 space-y-1.5">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-amber-900 flex items-center gap-1">
                        <Clock className="w-3 h-3 text-amber-700" />
                        <span>Late Comers Queue (Buffer +2)</span>
                      </p>
                      {lateComersQueue.map((l, idx) => (
                        <div key={idx} className="flex items-center justify-between text-xs text-amber-950 bg-white/80 p-2 rounded-lg border border-amber-200">
                          <div>
                            <span className="font-mono font-bold">Turn #{l.turnNumber}:</span> {l.patientName}
                          </div>
                          <span className="text-[10px] text-amber-800 font-medium">{l.expectedWait}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* RIGHT COLUMN: RECEPTION DESK & HOSPITAL LIVE OPD BOARD (7 cols)           */}
        {/* ========================================================================= */}
        <div className="lg:col-span-7 space-y-5">
          {/* Desk Header */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center text-emerald-700">
                <UserCheck className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900 tracking-tight">
                  Trinadh Hospital Reception Desk Console
                </h2>
                <p className="text-xs text-slate-500">
                  Front-desk check-in terminal with instant verification &amp; late queue controls
                </p>
              </div>
            </div>

            <div className="text-right">
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
                Venue: Trinadh Hospital
              </span>
            </div>
          </div>

          {/* FRONT DESK CHECK-IN CODE ENTRY FORM */}
          <div className="bg-white rounded-2xl border-2 border-emerald-500/40 p-5 sm:p-6 shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                  <Ticket className="w-4 h-4 text-emerald-600" />
                  <span>Enter Customer Check-In Code</span>
                </h3>
                <p className="text-xs text-slate-500">
                  Ask arriving patient for their 4-digit numeric booking pass code.
                </p>
              </div>

              <button
                onClick={handlePasteCodeToDesk}
                className="self-start sm:self-auto inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-emerald-50 text-emerald-800 hover:bg-emerald-100 border border-emerald-200 transition"
              >
                <Copy className="w-3 h-3" />
                <span>Fill Code ({booking.checkin_code})</span>
              </button>
            </div>

            <form onSubmit={handleVerifyCode} className="space-y-3">
              <div className="flex flex-col sm:flex-row items-stretch gap-2.5">
                <div className="relative flex-1">
                  <input
                    ref={inputRef}
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={codeInput}
                    onChange={(e) => {
                      setCodeInput(e.target.value.replace(/\D/g, ''));
                      setVerifyError(null);
                    }}
                    placeholder="e.g. 4821"
                    className="w-full px-4 py-3 bg-slate-50 border-2 border-slate-300 focus:border-emerald-500 focus:bg-white rounded-xl text-center font-mono text-xl font-bold tracking-widest text-slate-900 transition outline-none"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isVerifying || !codeInput.trim()}
                  className="px-6 py-3 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white transition disabled:opacity-50 disabled:cursor-not-allowed shadow-xs flex items-center justify-center gap-1.5 shrink-0"
                >
                  {isVerifying ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Checking…</span>
                    </>
                  ) : (
                    <>
                      <UserCheck className="w-4 h-4" />
                      <span>Verify &amp; Check In</span>
                    </>
                  )}
                </button>
              </div>

              <div className="flex items-center gap-3 text-xs">
                <button
                  type="button"
                  onClick={() => {
                    setCodeInput('9999');
                    handleVerifyCode(undefined, '9999');
                  }}
                  className="text-slate-500 hover:text-rose-600 underline"
                >
                  Test Wrong Code
                </button>
              </div>
            </form>

            {/* Success Feedback */}
            {verifySuccess && (
              <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-950 flex items-center justify-between gap-3 animate-fadeIn">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-emerald-200 text-emerald-800 flex items-center justify-center font-bold">
                    <CheckCircle2 className="w-5 h-5 text-emerald-700" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-emerald-950">
                      {verifySuccess.patient_name} marked as present!
                    </p>
                    <p className="text-xs text-emerald-800">
                      Token #4 turned GREEN (Present &amp; Ready in Lobby) • {verifySuccess.message}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setVerifySuccess(null)}
                  className="text-xs font-bold text-emerald-800 hover:underline"
                >
                  Dismiss
                </button>
              </div>
            )}

            {/* Error Feedback */}
            {verifyError && (
              <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-950 flex items-center justify-between gap-3 animate-fadeIn">
                <div className="flex items-center gap-2.5">
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                  <p className="text-xs font-semibold text-rose-900">{verifyError}</p>
                </div>
                <button
                  onClick={() => setVerifyError(null)}
                  className="text-xs font-bold text-rose-700 p-1"
                >
                  ✕
                </button>
              </div>
            )}
          </div>

          {/* ========================================================================= */}
          {/* TRINADH HOSPITAL LIVE OPD QUEUE BOARD (TOKENS #1 TO #8)                   */}
          {/* ========================================================================= */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <span>🏥 Trinadh Hospital OPD Queue Board</span>
                  <span className="text-xs font-mono font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
                    Tokens #1 to #8
                  </span>
                </h3>
                <p className="text-xs text-slate-500">
                  Doctor: <strong>Dr. K. Trinadh</strong> • Colors: 🟢 Green = Present, 🔴 Red = Awaiting, ⏰ Amber = Late Queue
                </p>
              </div>

              {/* Status Counters */}
              <div className="flex items-center gap-2 text-xs">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 font-bold">
                  🟢 2 Present
                </span>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-rose-100 text-rose-800 font-bold">
                  🔴 {isCheckedIn ? '4' : '5'} Awaiting
                </span>
              </div>
            </div>

            {/* Tokens Roster */}
            <div className="space-y-2">
              {hospitalQueue.map((tok) => {
                const isTarget = tok.tokenNumber === 4;
                const isPresent = tok.status === 'PRESENT_READY' || (isTarget && isCheckedIn);
                const isLate = tok.status === 'LATE_QUEUE' || (isTarget && isInLateQueue);

                return (
                  <div
                    key={tok.tokenNumber}
                    className={`p-3 rounded-xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                      isPresent
                        ? 'bg-emerald-50/90 border-2 border-emerald-500 shadow-2xs'
                        : isLate
                        ? 'bg-amber-50/90 border-2 border-amber-400 shadow-2xs'
                        : tok.status === 'IN_CONSULTATION'
                        ? 'bg-blue-50/70 border-2 border-blue-400'
                        : tok.status === 'COMPLETED'
                        ? 'bg-slate-50 border-slate-200 opacity-60'
                        : 'bg-rose-50/60 border-2 border-rose-300'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-xl font-mono font-bold flex flex-col items-center justify-center shrink-0 border ${
                        isPresent
                          ? 'bg-emerald-100 border-emerald-300 text-emerald-950'
                          : isLate
                          ? 'bg-amber-100 border-amber-300 text-amber-950'
                          : tok.status === 'IN_CONSULTATION'
                          ? 'bg-blue-100 border-blue-300 text-blue-950'
                          : tok.status === 'COMPLETED'
                          ? 'bg-slate-100 border-slate-200 text-slate-500'
                          : 'bg-rose-100 border-rose-300 text-rose-950'
                      }`}>
                        <span className="text-[9px] uppercase tracking-wider opacity-75">TKN</span>
                        <span className="text-xs font-black">
                          {isLate ? `#14` : `#${tok.tokenNumber}`}
                        </span>
                      </div>

                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="font-bold text-slate-900 text-xs sm:text-sm">
                            {tok.patientName}
                          </h4>
                          {isTarget && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-slate-900 text-white font-mono font-bold">
                              CUSTOMER DEMO
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-500">
                          Slot: {tok.slotTime} • Expected: {tok.expectedTime}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 self-end sm:self-center flex-wrap">
                      {/* Status Badges */}
                      {tok.status === 'COMPLETED' ? (
                        <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-slate-200 text-slate-700">
                          ✓ Consultation Completed
                        </span>
                      ) : tok.status === 'IN_CONSULTATION' ? (
                        <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800 border border-blue-300">
                          👨‍⚕️ In Consultation with Doctor
                        </span>
                      ) : isPresent ? (
                        <span className="px-2.5 py-1 rounded-full text-[10px] font-extrabold bg-emerald-600 text-white shadow-xs">
                          ✓ PRESENT &amp; READY
                        </span>
                      ) : isLate ? (
                        <span className="px-2.5 py-1 rounded-full text-[10px] font-extrabold bg-amber-200 text-amber-950 border border-amber-400">
                          ⏰ LATE COMERS QUEUE (Turn #14)
                        </span>
                      ) : (
                        <span className="px-2.5 py-1 rounded-full text-[10px] font-extrabold bg-rose-200 text-rose-950 border border-rose-300">
                          ✕ NOT PRESENT (AWAITING ARRIVAL)
                        </span>
                      )}

                      {/* Interactive Buttons for Token #4 */}
                      {isTarget && (
                        <div className="flex items-center gap-1.5">
                          {!isPresent && (
                            <button
                              onClick={() => handleVerifyCode(undefined, '4821')}
                              className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-emerald-600 hover:bg-emerald-700 text-white transition shadow-2xs"
                              title="Enter code 4821 and turn green"
                            >
                              Check-In (4821)
                            </button>
                          )}
                          {!isLate && (
                            <button
                              onClick={() => handleThrowToLateQueue(14)}
                              className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-amber-500 hover:bg-amber-600 text-white transition shadow-2xs"
                              title="Throw patient to Late Comers Queue"
                            >
                              Throw to Late Queue (+2)
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* FRONT-DESK OPERATIONAL ACTIONS & LATE QUEUE CONTROLS */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Dead Phone Fallback */}
            <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                  <UserCheck className="w-4 h-4 text-emerald-600" />
                  <span>Dead Phone Fallback</span>
                </span>
                <span className="text-[10px] text-slate-400 uppercase font-bold">Offline</span>
              </div>
              <p className="text-xs text-slate-500">
                If customer phone ran out of battery, receptionist marks them present manually.
              </p>
              <button
                onClick={handleMarkPresentManual}
                disabled={isCheckedIn}
                className="w-full py-2 rounded-xl text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300 transition disabled:opacity-50"
              >
                {isCheckedIn ? '✓ Already Checked In' : 'Mark Present Manually'}
              </button>
            </div>

            {/* Late Queue (+2 Buffer) */}
            <div className="bg-white rounded-2xl border border-amber-200 p-4 shadow-xs space-y-2.5 bg-amber-50/20">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-amber-900 flex items-center gap-1.5">
                  <Clock className="w-4 h-4 text-amber-600" />
                  <span>Late Queue (+2 Buffer)</span>
                </span>
                <span className="text-[10px] text-amber-700 font-mono font-bold">Rule: Turn +2</span>
              </div>
              <p className="text-xs text-amber-800">
                Arrived late: Inserts patient after 2 ongoing appointments without disrupting others.
              </p>
              <button
                onClick={() => handleThrowToLateQueue(14)}
                className="w-full py-2 rounded-xl text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white transition shadow-xs"
              >
                Throw to Late Queue (Token #14)
              </button>
            </div>
          </div>

          {/* REALTIME EVENT LOGS AUDIT TRAIL */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span>Realtime Event Stream &amp; Hospital Audit Trail</span>
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
