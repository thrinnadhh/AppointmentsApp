'use client';

import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { 
  Building2, 
  Stethoscope, 
  Clock, 
  Search, 
  CheckCircle2, 
  User, 
  Calendar as CalendarIcon, 
  ShieldCheck, 
  ArrowRight,
  RefreshCw,
  Sparkles,
  Users,
  Zap
} from 'lucide-react';
import { RollingTenSlotQueue } from '@/components/RollingTenSlotQueue';
import { MonthlyAttendanceCalendar } from '@/components/MonthlyAttendanceCalendar';
import { QueueSlot, MonthlyAttendanceSummary } from '@/lib/queue-scheduler';

interface DoctorOption {
  id: string;
  name: string;
  department: string;
  duration_minutes: number;
}

export default function CustomerDashboardPage() {
  const [selectedDoctorId, setSelectedDoctorId] = useState<string>('');
  const [doctors, setDoctors] = useState<DoctorOption[]>([]);
  const [hospitalName, setHospitalName] = useState('tri-test-hospital');
  
  // Patient search & selection
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(null);

  // Queue & Calendar state
  const [queueSlots, setQueueSlots] = useState<QueueSlot[]>([]);
  const [attendanceSummary, setAttendanceSummary] = useState<MonthlyAttendanceSummary | null>(null);
  const [calendarYear, setCalendarYear] = useState<number>(new Date().getFullYear());
  const [calendarMonth, setCalendarMonth] = useState<number>(new Date().getMonth() + 1);
  const [loading, setLoading] = useState(true);
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());
  const [dashboardViewTab, setDashboardViewTab] = useState<'calendar_first' | 'queue_first' | 'both'>('calendar_first');

  // Quick select patients for tri-test-hospital testing
  const demoPatients = [
    { label: 'P1: Rahul (Neuro)', phone: '9888800001' },
    { label: 'P2: Priya (Dental)', phone: '9888800002' },
    { label: 'P3: Amit (Neuro)', phone: '9888800003' },
    { label: 'P4: Sneha (Dental)', phone: '9888800004' },
    { label: 'P5: Vikram (Neuro)', phone: '9888800005' },
    { label: 'P6: Ananya (Dental)', phone: '9888800006' },
  ];

  // Fetch initial doctors & queue data
  const loadDashboardData = useCallback(async (year = calendarYear, month = calendarMonth, docId = selectedDoctorId) => {
    try {
      const queryParams = new URLSearchParams({
        year: year.toString(),
        month: month.toString(),
      });
      if (docId) queryParams.set('resource_id', docId);
      if (selectedBookingId) queryParams.set('booking_id', selectedBookingId);
      if (searchQuery.trim()) queryParams.set('phone', searchQuery.trim());

      const res = await fetch(`/api/customer/queue-and-history?${queryParams.toString()}`, {
        cache: 'no-store',
      });

      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          setQueueSlots(json.queue || []);
          setAttendanceSummary(json.attendance || null);
          if (json.hospital?.name) setHospitalName(json.hospital.name);
          if (json.doctor && !selectedDoctorId) {
            setSelectedDoctorId(json.doctor.id);
          }
          setLastRefreshed(new Date());
        }
      }
    } catch (err) {
      console.warn('Error loading customer dashboard:', err);
    } finally {
      setLoading(false);
    }
  }, [calendarYear, calendarMonth, selectedDoctorId, selectedBookingId, searchQuery]);

  // Load available hospital doctors
  useEffect(() => {
    async function initDoctors() {
      try {
        const res = await fetch('/api/customer/queue-and-history', { cache: 'no-store' });
        if (res.ok) {
          const json = await res.json();
          if (json.doctor) {
            setDoctors([
              { id: '628896c8-097c-4bcb-b9d6-45d886fa3a56', name: 'Dr. Ramesh Neuro', department: 'Neurologist', duration_minutes: 2 },
              { id: '94624fa8-67f4-4855-8b8a-7993a12c3aae', name: 'Dr. Kavitha Dental', department: 'Dental Surgeon', duration_minutes: 2 }
            ]);
            setSelectedDoctorId(json.doctor.id);
          }
        }
      } catch (err) {
        console.warn('Failed initializing doctors:', err);
      }
    }
    initDoctors();
  }, []);

  // Poll for live queue updates every 3.5 seconds
  useEffect(() => {
    loadDashboardData();
    const timer = setInterval(() => {
      loadDashboardData();
    }, 3500);
    return () => clearInterval(timer);
  }, [loadDashboardData]);

  const activeDoc = doctors.find((d) => d.id === selectedDoctorId) || {
    name: 'Dr. Ramesh Neuro',
    department: 'Neurologist',
    duration_minutes: 2,
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-12">
      {/* Top Navigation Bar */}
      <header className="bg-slate-900 text-white border-b border-slate-800 sticky top-0 z-40 shadow-md">
        <div className="max-w-6xl mx-auto px-4 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs uppercase font-extrabold tracking-wider text-emerald-400">
                  Patient Portal
                </span>
                <span className="text-slate-500">•</span>
                <span className="text-xs text-slate-300 font-medium">Tirupati Care</span>
              </div>
              <h1 className="text-base font-bold text-white tracking-tight">{hospitalName}</h1>
            </div>
          </div>

          <div className="flex items-center gap-3 self-end sm:self-auto">
            <span className="text-xs text-slate-400 hidden sm:inline">
              Live Sync: {lastRefreshed.toLocaleTimeString()}
            </span>
            <Link
              href="/"
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 transition border border-slate-700 flex items-center gap-1.5"
            >
              <span>Merchant Admin</span>
              <ArrowRight className="w-3.5 h-3.5 text-emerald-400" />
            </Link>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {/* Controls Ribbon: Doctor Switcher & Quick Patient Lookup */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            {/* Doctor Selector */}
            <div className="flex items-center gap-3">
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block shrink-0 flex items-center gap-1.5">
                <Stethoscope className="w-4 h-4 text-emerald-600" />
                Select Specialist:
              </label>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setSelectedDoctorId('628896c8-097c-4bcb-b9d6-45d886fa3a56');
                    loadDashboardData(calendarYear, calendarMonth, '628896c8-097c-4bcb-b9d6-45d886fa3a56');
                  }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition border cursor-pointer ${
                    selectedDoctorId === '628896c8-097c-4bcb-b9d6-45d886fa3a56'
                      ? 'bg-emerald-600 text-white border-emerald-700 shadow-xs'
                      : 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200'
                  }`}
                >
                  Dr. Ramesh (Neuro)
                </button>
                <button
                  onClick={() => {
                    setSelectedDoctorId('94624fa8-67f4-4855-8b8a-7993a12c3aae');
                    loadDashboardData(calendarYear, calendarMonth, '94624fa8-67f4-4855-8b8a-7993a12c3aae');
                  }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition border cursor-pointer ${
                    selectedDoctorId === '94624fa8-67f4-4855-8b8a-7993a12c3aae'
                      ? 'bg-emerald-600 text-white border-emerald-700 shadow-xs'
                      : 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200'
                  }`}
                >
                  Dr. Kavitha (Dental)
                </button>
              </div>
            </div>

            {/* Quick Demo Patients Pills */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
              <span className="text-slate-400 font-medium text-[11px] shrink-0">Quick Patient:</span>
              {demoPatients.map((dp) => (
                <button
                  key={dp.phone}
                  onClick={() => {
                    setSearchQuery(dp.phone);
                    loadDashboardData(calendarYear, calendarMonth, selectedDoctorId);
                  }}
                  className={`px-2.5 py-1 rounded-lg font-mono text-[11px] font-semibold border transition shrink-0 cursor-pointer ${
                    searchQuery === dp.phone
                      ? 'bg-emerald-100 text-emerald-900 border-emerald-400 ring-1 ring-emerald-400'
                      : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  {dp.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* VIEW MODE TABS: Calendar Month vs Live Queue vs Split View               */}
        {/* ========================================================================= */}
        <div className="flex items-center justify-between gap-4 p-1.5 bg-slate-200/80 rounded-2xl border border-slate-300/80 shadow-2xs">
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              data-testid="customer-tab-calendar-month"
              onClick={() => setDashboardViewTab('calendar_first')}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 cursor-pointer ${
                dashboardViewTab === 'calendar_first'
                  ? 'bg-white text-emerald-800 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <CalendarIcon className="w-4 h-4 text-emerald-600" />
              <span>📅 Calendar Month Patient Queues</span>
            </button>

            <button
              type="button"
              data-testid="customer-tab-live-queue"
              onClick={() => setDashboardViewTab('queue_first')}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 cursor-pointer ${
                dashboardViewTab === 'queue_first'
                  ? 'bg-white text-emerald-800 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Zap className="w-4 h-4 text-amber-500" />
              <span>⚡ Live 10-Slot Queue</span>
            </button>

            <button
              type="button"
              data-testid="customer-tab-both"
              onClick={() => setDashboardViewTab('both')}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 cursor-pointer ${
                dashboardViewTab === 'both'
                  ? 'bg-white text-emerald-800 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Users className="w-4 h-4 text-slate-700" />
              <span>👁️ Split View</span>
            </button>
          </div>

          <div className="text-[11px] text-slate-500 font-medium hidden md:inline px-3 font-mono">
            Synchronized with Hospital Reception
          </div>
        </div>

        {/* Transparent Patient Queue Sequence Strip */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-2xs space-y-2.5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h4 className="text-xs font-black uppercase tracking-wider text-slate-800 flex items-center gap-2">
                <span>Transparent Live Queue Sequence</span>
                <span className="text-[10px] font-normal normal-case text-slate-500">
                  (#1 = Patient 1, #2 = Patient 2)
                </span>
              </h4>
              <p className="text-[11px] text-slate-500">
                Hospital OPD status synchronized: Green is present in clinic, Yellow is waiting in queue.
              </p>
            </div>

            {/* Status Legend */}
            <div className="flex items-center gap-2.5 flex-wrap text-[11px] font-bold">
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-emerald-100 text-emerald-900 border border-emerald-300">
                <span className="w-4 h-4 rounded-full bg-emerald-500 text-white flex items-center justify-center font-mono text-[9px] shadow-2xs font-bold">1</span>
                <span>Green = Present</span>
              </span>
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-amber-100 text-amber-950 border border-amber-300">
                <span className="w-4 h-4 rounded-full bg-amber-300 text-amber-950 flex items-center justify-center font-mono text-[9px] shadow-2xs font-bold">2</span>
                <span>Yellow = Still Waiting</span>
              </span>
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-rose-100 text-rose-900 border border-rose-300">
                <span className="w-4 h-4 rounded-full bg-rose-500 text-white flex items-center justify-center font-mono text-[9px] shadow-2xs font-bold">3</span>
                <span>Red = Absent</span>
              </span>
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-amber-100 text-amber-950 border border-amber-300">
                <span className="w-5 h-4 rounded-full bg-amber-400 text-amber-950 flex items-center justify-center font-mono text-[8px] shadow-2xs font-black">L1</span>
                <span>Late Queue</span>
              </span>
            </div>
          </div>

          {/* Sequence Pills */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1 pt-0.5">
            {queueSlots.filter((s) => s.tokenNumber).length === 0 ? (
              <span className="text-xs text-slate-400 italic">No patients active in queue currently.</span>
            ) : (
              queueSlots.filter((s) => s.tokenNumber).map((slot) => {
                const isPresent = slot.isPresent;
                const isLate = slot.type === 'LATE_WAITING' || slot.type === 'LATE_ACCOMMODATED';
                const patientNum = isLate ? `L${slot.tokenNumber}` : `${slot.tokenNumber}`;
                const patientName = slot.patientName || `Patient #${patientNum}`;

                return (
                  <div
                    key={slot.slotIndex}
                    title={`Patient #${patientNum}: ${patientName} • ${
                      isPresent ? 'Present (Green)' : isLate ? 'Late Queue (Yellow)' : 'Still Waiting (Yellow)'
                    }`}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-mono font-bold shrink-0 shadow-2xs border ${
                      isPresent
                        ? 'bg-emerald-500 text-white border-emerald-600 ring-1 ring-emerald-300'
                        : isLate
                        ? 'bg-amber-400 text-amber-950 border-amber-500 ring-1 ring-amber-300 font-black'
                        : 'bg-amber-300 text-amber-950 border-amber-400 ring-1 ring-amber-300'
                    }`}
                  >
                    <span className="w-4 h-4 rounded-full bg-white/25 flex items-center justify-center text-[10px]">
                      {patientNum}
                    </span>
                    <span className="text-[11px] font-sans font-medium truncate max-w-[85px]">
                      {patientName.split(' ')[0]}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* 1. CALENDAR MONTH VIEW (Primary when calendar_first or both) */}
        {(dashboardViewTab === 'calendar_first' || dashboardViewTab === 'both') && (
          <section data-testid="section-monthly-queue-calendar">
            {attendanceSummary && (
              <MonthlyAttendanceCalendar
                summary={attendanceSummary}
                onMonthChange={(y, m) => {
                  setCalendarYear(y);
                  setCalendarMonth(m);
                  loadDashboardData(y, m);
                }}
                isLoading={loading}
                selectedDoctorName={activeDoc.name}
                selectedDepartment={activeDoc.department}
              />
            )}
          </section>
        )}

        {/* 2. ROLLING 10-SLOT QUEUE ("WHO'S NEXT" LIVE SEQUENCE) */}
        {(dashboardViewTab === 'queue_first' || dashboardViewTab === 'both') && (
          <section data-testid="section-live-10-slot-queue">
            <RollingTenSlotQueue
              slots={queueSlots}
              doctorName={activeDoc.name}
              department={activeDoc.department}
              slotDurationMinutes={activeDoc.duration_minutes}
              currentBookingId={selectedBookingId}
              onRefresh={() => loadDashboardData()}
              isLoading={loading}
            />
          </section>
        )}
      </main>
    </div>
  );
}
