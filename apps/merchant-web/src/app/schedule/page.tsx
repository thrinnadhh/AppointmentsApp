'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { 
  Clock, 
  Calendar as CalendarIcon, 
  Save, 
  CheckCircle2, 
  Users, 
  Zap, 
  ArrowRight, 
  Building2, 
  Stethoscope, 
  Settings,
  RefreshCw
} from 'lucide-react';
import { useMerchantTenant } from '@/contexts/MerchantTenantContext';
import { MonthlyAttendanceCalendar } from '@/components/MonthlyAttendanceCalendar';
import { MonthlyAttendanceSummary, QueueSlot } from '@/lib/queue-scheduler';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default function ScheduleManagementPage() {
  const { activeProvider, isLoading: isTenantLoading } = useMerchantTenant();

  // Top tab: Patient Queue Month Calendar vs Hours Setup
  const [activeTab, setActiveTab] = useState<'queue_calendar' | 'hours'>('queue_calendar');

  // Month Queue Calendar state
  const [calendarYear, setCalendarYear] = useState<number>(() => new Date().getFullYear());
  const [calendarMonth, setCalendarMonth] = useState<number>(() => new Date().getMonth() + 1);
  const [attendanceSummary, setAttendanceSummary] = useState<MonthlyAttendanceSummary | null>(null);
  const [isLoadingQueue, setIsLoadingQueue] = useState(false);
  const [selectedDoctorId, setSelectedDoctorId] = useState<string>('');
  const [activeDoctorName, setActiveDoctorName] = useState('Specialist Doctor');
  const [activeDepartment, setActiveDepartment] = useState('OPD Clinic');

  // Weekly hours state
  const [schedule, setSchedule] = useState([
    { day: 0, enabled: false, start: '10:00', end: '18:00' }, // Sun
    { day: 1, enabled: true, start: '09:00', end: '20:00' },  // Mon
    { day: 2, enabled: true, start: '09:00', end: '20:00' },  // Tue
    { day: 3, enabled: true, start: '09:00', end: '20:00' },  // Wed
    { day: 4, enabled: true, start: '09:00', end: '20:00' },  // Thu
    { day: 5, enabled: true, start: '09:00', end: '20:00' },  // Fri
    { day: 6, enabled: true, start: '09:00', end: '19:00' },  // Sat
  ]);
  const [saved, setSaved] = useState(false);

  // Fetch Monthly Queue & Attendance Data
  const loadMonthQueueData = useCallback(async (
    year = calendarYear,
    month = calendarMonth,
    docId = selectedDoctorId
  ) => {
    try {
      setIsLoadingQueue(true);
      const params = new URLSearchParams({
        year: year.toString(),
        month: month.toString(),
      });
      if (activeProvider?.id) params.set('provider_id', activeProvider.id);
      if (docId) params.set('resource_id', docId);

      const res = await fetch(`/api/customer/queue-and-history?${params.toString()}`, {
        cache: 'no-store',
      });
      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          setAttendanceSummary(json.attendance || null);
          if (json.doctor) {
            setActiveDoctorName(json.doctor.name || 'Specialist Doctor');
            setActiveDepartment(json.doctor.department || 'OPD Clinic');
            if (!selectedDoctorId) setSelectedDoctorId(json.doctor.id);
          }
        }
      }
    } catch (err) {
      console.warn('Failed loading month queue calendar:', err);
    } finally {
      setIsLoadingQueue(false);
    }
  }, [calendarYear, calendarMonth, selectedDoctorId, activeProvider?.id]);

  useEffect(() => {
    loadMonthQueueData();
  }, [loadMonthQueueData]);

  const toggleDay = (dayIndex: number) => {
    setSchedule(prev => prev.map(s => s.day === dayIndex ? { ...s, enabled: !s.enabled } : s));
  };

  const updateTime = (dayIndex: number, field: 'start' | 'end', val: string) => {
    setSchedule(prev => prev.map(s => s.day === dayIndex ? { ...s, [field]: val } : s));
  };

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-12">
      {/* Top Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
              Hospital Operations
            </span>
            <span className="text-xs text-slate-400">•</span>
            <span className="text-xs text-slate-600 font-semibold">{activeProvider?.name || 'tri-test-hospital'}</span>
          </div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <span>Patient Queue Schedule &amp; Month Calendar</span>
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Manage month-wide patient queue rosters, daily token sequences, presence verification, and clinic operating hours.
          </p>
        </div>

        {/* View Switcher Tabs */}
        <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-xl border border-slate-200 self-start sm:self-auto shadow-2xs">
          <button
            type="button"
            data-testid="tab-queue-calendar"
            onClick={() => setActiveTab('queue_calendar')}
            className={`px-3.5 py-2 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'queue_calendar'
                ? 'bg-white text-emerald-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <CalendarIcon className="w-4 h-4 text-emerald-600" />
            <span>📅 Month Queue Calendar</span>
          </button>

          <button
            type="button"
            data-testid="tab-hours-setup"
            onClick={() => setActiveTab('hours')}
            className={`px-3.5 py-2 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'hours'
                ? 'bg-white text-emerald-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Clock className="w-4 h-4 text-slate-600" />
            <span>⚙️ Operating Hours</span>
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: MONTHLY PATIENT QUEUE CALENDAR                                     */}
      {/* ========================================================================= */}
      {activeTab === 'queue_calendar' && (
        <section className="space-y-4" data-testid="month-queue-calendar-section">
          {attendanceSummary ? (
            <MonthlyAttendanceCalendar
              summary={attendanceSummary}
              onMonthChange={(y, m) => {
                setCalendarYear(y);
                setCalendarMonth(m);
                loadMonthQueueData(y, m);
              }}
              isLoading={isLoadingQueue}
              selectedDoctorName={activeDoctorName}
              selectedDepartment={activeDepartment}
            />
          ) : (
            <div className="bg-white rounded-2xl p-12 border border-slate-200 text-center space-y-3">
              <RefreshCw className="w-8 h-8 text-emerald-600 animate-spin mx-auto" />
              <p className="text-sm font-semibold text-slate-700">Loading Patient Queue Month Calendar...</p>
            </div>
          )}

          {/* Quick links to Live Queue and Customer Dashboard */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-emerald-50/70 border border-emerald-200 p-4 rounded-xl text-xs text-emerald-950">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-emerald-600" />
              <span className="font-semibold">
                Looking for Today&apos;s real-time OPD reception desk or customer view?
              </span>
            </div>
            <div className="flex items-center gap-3">
              <Link
                href="/"
                className="font-bold text-emerald-800 hover:text-emerald-900 underline flex items-center gap-1"
              >
                <span>Merchant Live Queue</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
              <Link
                href="/customer/dashboard"
                className="font-bold text-slate-700 hover:text-slate-900 underline flex items-center gap-1"
              >
                <span>Customer Portal</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: OPERATING HOURS CONFIGURATION                                      */}
      {/* ========================================================================= */}
      {activeTab === 'hours' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-900">Weekly OPD Operating Schedule</h2>
            <button
              onClick={handleSave}
              className="inline-flex items-center px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-700 transition shadow-sm cursor-pointer"
            >
              {saved ? (
                <>
                  <CheckCircle2 className="w-4 h-4 mr-1.5 text-emerald-200" />
                  Saved!
                </>
              ) : (
                <>
                  <Save className="w-4 h-4 mr-1.5" />
                  Save Schedule
                </>
              )}
            </button>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden divide-y divide-slate-100">
            {schedule.map((item) => (
              <div
                key={item.day}
                className={`p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
                  !item.enabled ? 'bg-slate-50/70 opacity-60' : ''
                }`}
              >
                <div className="flex items-center space-x-4">
                  <input
                    type="checkbox"
                    id={`day-${item.day}`}
                    checked={item.enabled}
                    onChange={() => toggleDay(item.day)}
                    className="w-4 h-4 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500"
                  />
                  <label htmlFor={`day-${item.day}`} className="font-semibold text-sm text-slate-900 cursor-pointer w-28">
                    {DAYS[item.day]}
                  </label>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded ${
                    item.enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-200 text-slate-600'
                  }`}>
                    {item.enabled ? 'Open' : 'Closed'}
                  </span>
                </div>

                {item.enabled ? (
                  <div className="flex items-center gap-3 self-end sm:self-center">
                    <div className="flex items-center gap-1.5">
                      <label htmlFor={`start-time-${item.day}`} className="text-xs text-slate-500">From:</label>
                      <input
                        id={`start-time-${item.day}`}
                        name={`startTime_${item.day}`}
                        aria-label={`${DAYS[item.day]} start time`}
                        type="time"
                        value={item.start}
                        onChange={(e) => updateTime(item.day, 'start', e.target.value)}
                        className="px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs font-medium focus:ring-2 focus:ring-emerald-500 outline-none"
                      />
                    </div>
                    <span className="text-slate-400 text-xs">to</span>
                    <div className="flex items-center gap-1.5">
                      <label htmlFor={`end-time-${item.day}`} className="text-xs text-slate-500">Until:</label>
                      <input
                        id={`end-time-${item.day}`}
                        name={`endTime_${item.day}`}
                        aria-label={`${DAYS[item.day]} closing time`}
                        type="time"
                        value={item.end}
                        onChange={(e) => updateTime(item.day, 'end', e.target.value)}
                        className="px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs font-medium focus:ring-2 focus:ring-emerald-500 outline-none"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-slate-400 italic">No slots will be generated</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
