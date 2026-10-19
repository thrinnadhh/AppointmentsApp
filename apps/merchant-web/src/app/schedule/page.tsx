'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { 
  Clock, 
  Save, 
  CheckCircle2, 
  Zap, 
  ArrowRight, 
  Building2, 
  CalendarDays,
  AlertCircle
} from 'lucide-react';
import { useMerchantTenant } from '@/contexts/MerchantTenantContext';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default function ScheduleManagementPage() {
  const { activeProvider } = useMerchantTenant();

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
    <div className="space-y-6 max-w-5xl mx-auto pb-12">
      {/* Top Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 sm:p-6 rounded-2xl border border-slate-200 shadow-xs">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
              Hospital Operations
            </span>
            <span className="text-xs text-slate-400">•</span>
            <span className="text-xs text-slate-600 font-semibold">{activeProvider?.name || 'Tirupati Clinic'}</span>
          </div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <span>Operating Schedule &amp; Shift Hours</span>
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Configure weekly outpatient consultation hours, daily shifts, and weekend closures for patient bookings.
          </p>
        </div>

        <button
          onClick={handleSave}
          className="inline-flex items-center px-4 py-2.5 rounded-xl text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-700 transition shadow-sm cursor-pointer self-start sm:self-auto"
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

      {/* Info notice about doctor slot generation */}
      <div className="rounded-xl bg-emerald-50/70 border border-emerald-200 p-4 flex items-start gap-3 text-xs text-emerald-950">
        <Clock className="w-4 h-4 text-emerald-700 flex-shrink-0 mt-0.5" />
        <div>
          <span className="font-bold text-emerald-900">Automatic Slot Generation:</span>
          <p className="mt-0.5 text-emerald-800 text-[11px] leading-relaxed">
            Patient appointment slots are automatically scheduled within these defined hours according to each doctor&apos;s individual consultation duration and capacity configured in{' '}
            <Link href="/resources" className="underline font-bold hover:text-emerald-950">
              Doctors &amp; Resources
            </Link>.
          </p>
        </div>
      </div>

      {/* Weekly Operating Hours Form */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden divide-y divide-slate-100">
        <div className="p-4 sm:p-5 bg-slate-50/60 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-slate-600" />
            <h2 className="text-sm font-bold text-slate-900">Weekly Operating Schedule</h2>
          </div>
          <span className="text-xs text-slate-500 font-medium">Standard Indian Standard Time (IST)</span>
        </div>

        {schedule.map((item) => (
          <div
            key={item.day}
            className={`p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-colors ${
              !item.enabled ? 'bg-slate-50/70 opacity-60' : 'hover:bg-slate-50/30'
            }`}
          >
            <div className="flex items-center space-x-4">
              <input
                type="checkbox"
                id={`day-${item.day}`}
                checked={item.enabled}
                onChange={() => toggleDay(item.day)}
                className="w-4 h-4 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500 cursor-pointer"
              />
              <label htmlFor={`day-${item.day}`} className="font-semibold text-sm text-slate-900 cursor-pointer w-28">
                {DAYS[item.day]}
              </label>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded ${
                item.enabled ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-slate-200 text-slate-600'
              }`}>
                {item.enabled ? 'Open for OPD' : 'Closed'}
              </span>
            </div>

            {item.enabled ? (
              <div className="flex items-center gap-3 self-end sm:self-center">
                <div className="flex items-center gap-1.5">
                  <label htmlFor={`start-time-${item.day}`} className="text-xs text-slate-500 font-medium">From:</label>
                  <input
                    id={`start-time-${item.day}`}
                    name={`startTime_${item.day}`}
                    aria-label={`${DAYS[item.day]} start time`}
                    type="time"
                    value={item.start}
                    onChange={(e) => updateTime(item.day, 'start', e.target.value)}
                    className="px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs font-medium focus:ring-2 focus:ring-emerald-500 outline-none bg-white text-slate-900"
                  />
                </div>
                <span className="text-slate-400 text-xs font-medium">to</span>
                <div className="flex items-center gap-1.5">
                  <label htmlFor={`end-time-${item.day}`} className="text-xs text-slate-500 font-medium">Until:</label>
                  <input
                    id={`end-time-${item.day}`}
                    name={`endTime_${item.day}`}
                    aria-label={`${DAYS[item.day]} closing time`}
                    type="time"
                    value={item.end}
                    onChange={(e) => updateTime(item.day, 'end', e.target.value)}
                    className="px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs font-medium focus:ring-2 focus:ring-emerald-500 outline-none bg-white text-slate-900"
                  />
                </div>
              </div>
            ) : (
              <div className="text-xs text-slate-400 italic">No appointments or patient tokens generated</div>
            )}
          </div>
        ))}
      </div>

      {/* Quick Navigation Footer */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white border border-slate-200 p-4 rounded-xl text-xs text-slate-700 shadow-2xs">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-emerald-600" />
          <span className="font-semibold text-slate-900">
            Need to manage today&apos;s real-time patient queue or staff shifts?
          </span>
        </div>
        <div className="flex items-center gap-4">
          <Link
            href="/"
            className="font-bold text-emerald-700 hover:text-emerald-800 flex items-center gap-1"
          >
            <span>Live Reception Queue</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
          <Link
            href="/team"
            className="font-bold text-slate-600 hover:text-slate-800 flex items-center gap-1"
          >
            <span>Team &amp; Front Desk</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>
    </div>
  );
}
