'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { 
  Clock, 
  Save, 
  CheckCircle2, 
  Zap, 
  ArrowRight, 
  Building2, 
  CalendarDays,
  AlertCircle,
  Stethoscope,
  Calendar,
  Trash2,
  Plus,
  ShieldCheck,
  UserCheck
} from 'lucide-react';
import { useMerchantTenant } from '@/contexts/MerchantTenantContext';
import { Resource } from '@appointments/shared';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

interface DoctorLeave {
  id: string;
  doctorId: string;
  doctorName: string;
  date: string;
  reason: string;
  createdAt: string;
}

export default function ScheduleManagementPage() {
  const { activeProvider, isHospitalAdmin, isSuperAdmin, verticalConfig } = useMerchantTenant();

  const resources: Resource[] = useMemo(() => {
    return (activeProvider?.resources as Resource[]) || [];
  }, [activeProvider?.resources]);
  const [selectedDoctorId, setSelectedDoctorId] = useState<string>('');

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

  // Leave & Absence management state
  const [leaves, setLeaves] = useState<DoctorLeave[]>([
    {
      id: 'leave-1',
      doctorId: resources[0]?.id || 'doc-1',
      doctorName: resources[0]?.name || 'Dr. Ramesh Kumar',
      date: new Date(Date.now() + 86400000 * 2).toISOString().split('T')[0],
      reason: 'Medical Conference Attendance',
      createdAt: new Date().toISOString(),
    }
  ]);
  const [leaveDate, setLeaveDate] = useState('');
  const [leaveReason, setLeaveReason] = useState('Planned Leave');
  const [leaveDoctorId, setLeaveDoctorId] = useState('');
  const [leaveSuccess, setLeaveSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (resources.length > 0 && !leaveDoctorId) {
      setLeaveDoctorId(resources[0].id);
    }
  }, [resources, leaveDoctorId]);

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

  const handleAddLeave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!leaveDate) return;

    const matchedDoc = resources.find((r) => r.id === leaveDoctorId);
    const docName = matchedDoc ? matchedDoc.name : 'Consultant Doctor';

    const newLeave: DoctorLeave = {
      id: `leave-${Date.now()}`,
      doctorId: leaveDoctorId || 'all',
      doctorName: docName,
      date: leaveDate,
      reason: leaveReason.trim() || 'Planned Leave',
      createdAt: new Date().toISOString(),
    };

    setLeaves((prev) => [newLeave, ...prev]);
    setLeaveDate('');
    setLeaveSuccess(`Leave marked for ${docName} on ${leaveDate}. Consultation bookings for this date will be unavailable.`);
    setTimeout(() => setLeaveSuccess(null), 4000);
  };

  const handleRemoveLeave = (leaveId: string) => {
    setLeaves((prev) => prev.filter((l) => l.id !== leaveId));
  };

  const filteredLeaves = useMemo(() => {
    if (!selectedDoctorId) return leaves;
    return leaves.filter((l) => l.doctorId === selectedDoctorId);
  }, [leaves, selectedDoctorId]);

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
            Configure weekly outpatient consultation hours, daily shifts, and doctor leave calendars for patient bookings.
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

      {/* Doctor Filter Bar */}
      {resources.length > 0 && (
        <div className="bg-white p-4 rounded-xl border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center gap-2">
            <Stethoscope className="w-4 h-4 text-emerald-600" />
            <span className="text-xs font-bold text-slate-800">Configure Schedule For:</span>
          </div>
          <select
            value={selectedDoctorId}
            onChange={(e) => setSelectedDoctorId(e.target.value)}
            className="text-xs font-bold px-3 py-2 rounded-lg border border-slate-300 bg-white text-slate-800 focus:ring-2 focus:ring-emerald-500 cursor-pointer"
          >
            <option value="">General Hospital Operating Schedule (All Doctors)</option>
            {resources.map((r) => (
              <option key={r.id} value={r.id}>
                Dr. {r.name} ({r.department || 'Consultant'})
              </option>
            ))}
          </select>
        </div>
      )}

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

      {/* SECTION 1: Weekly Operating Hours Form */}
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

      {/* SECTION 2: Doctor Leave & Holiday Marking */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <Calendar className="w-5 h-5 text-emerald-600" />
              <h2 className="text-lg font-bold text-slate-900">
                Doctor Leave &amp; Planned Absence Calendar
              </h2>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Mark specific calendar days where a doctor is unavailable for consultations. Appointment booking for those days will be blocked.
            </p>
          </div>
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 self-start sm:self-auto">
            {filteredLeaves.length} Marked Absences
          </span>
        </div>

        {leaveSuccess && (
          <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3.5 flex items-center gap-2.5 text-xs text-emerald-800">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
            <span>{leaveSuccess}</span>
          </div>
        )}

        {/* Mark Leave Form */}
        <form onSubmit={handleAddLeave} className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
          <span className="text-xs font-bold text-slate-800 uppercase tracking-wider block">
            + Mark New Absence
          </span>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label htmlFor="leave-doctor" className="block text-xs font-semibold text-slate-700 mb-1">
                Doctor / Consultant *
              </label>
              <select
                id="leave-doctor"
                value={leaveDoctorId}
                onChange={(e) => setLeaveDoctorId(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-medium text-slate-900 bg-white"
              >
                {resources.map((r) => (
                  <option key={r.id} value={r.id}>
                    Dr. {r.name} ({r.department || 'General'})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="leave-date" className="block text-xs font-semibold text-slate-700 mb-1">
                Absence Date *
              </label>
              <input
                id="leave-date"
                type="date"
                required
                value={leaveDate}
                onChange={(e) => setLeaveDate(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-medium text-slate-900 bg-white font-mono"
              />
            </div>

            <div>
              <label htmlFor="leave-reason" className="block text-xs font-semibold text-slate-700 mb-1">
                Reason (Optional)
              </label>
              <input
                id="leave-reason"
                type="text"
                value={leaveReason}
                onChange={(e) => setLeaveReason(e.target.value)}
                placeholder="e.g. Vacation, Conference"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-medium text-slate-900 bg-white"
              />
            </div>
          </div>

          <div className="flex justify-end pt-1">
            <button
              type="submit"
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg shadow-sm transition flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Record Doctor Absence</span>
            </button>
          </div>
        </form>

        {/* Existing Leaves List */}
        <div className="space-y-2">
          {filteredLeaves.length === 0 ? (
            <p className="text-xs text-slate-400 py-3 text-center italic">
              No planned absences recorded for this selection.
            </p>
          ) : (
            filteredLeaves.map((l) => (
              <div
                key={l.id}
                className="p-3 bg-white border border-slate-200 rounded-xl flex items-center justify-between gap-3 text-xs shadow-2xs hover:border-slate-300 transition"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-amber-50 text-amber-700 flex items-center justify-center font-bold">
                    <Calendar className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="font-bold text-slate-900">
                      {l.doctorName} — <span className="font-mono text-emerald-700">{l.date}</span>
                    </p>
                    <p className="text-[11px] text-slate-500">{l.reason}</p>
                  </div>
                </div>

                <button
                  onClick={() => handleRemoveLeave(l.id)}
                  className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition cursor-pointer"
                  title="Remove Leave"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))
          )}
        </div>
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
