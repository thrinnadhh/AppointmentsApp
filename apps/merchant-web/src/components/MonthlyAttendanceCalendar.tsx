'use client';

import React, { useState } from 'react';
import { 
  Calendar as CalendarIcon, 
  ChevronLeft, 
  ChevronRight, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  Sparkles, 
  UserCheck, 
  Building2, 
  Stethoscope, 
  Users, 
  Zap, 
  Filter, 
  ArrowRight,
  TrendingUp,
  AlertCircle
} from 'lucide-react';
import { MonthlyAttendanceSummary, DayAttendance } from '@/lib/queue-scheduler';
import { RollingTenSlotQueue } from './RollingTenSlotQueue';

interface MonthlyAttendanceCalendarProps {
  summary: MonthlyAttendanceSummary;
  onMonthChange?: (year: number, month: number) => void;
  isLoading?: boolean;
  selectedDoctorName?: string;
  selectedDepartment?: string;
  onSelectDate?: (dateString: string) => void;
}

export function MonthlyAttendanceCalendar({
  summary,
  onMonthChange,
  isLoading = false,
  selectedDoctorName = 'Specialist Consultant',
  selectedDepartment = 'OPD Clinic',
  onSelectDate,
}: MonthlyAttendanceCalendarProps) {
  // Current selected day state
  const [selectedDateString, setSelectedDateString] = useState<string>(() => {
    const todayMatch = summary.days.find((d) => d.isToday && d.totalAppointments > 0);
    if (todayMatch) return todayMatch.dateString;
    const firstActive = summary.days.find((d) => d.totalAppointments > 0);
    if (firstActive) return firstActive.dateString;
    return summary.days.find((d) => d.isToday)?.dateString || summary.days[0]?.dateString || '';
  });

  // Filter state for calendar days
  const [activeFilter, setActiveFilter] = useState<'ALL' | 'ACTIVE' | 'PRESENT' | 'ABSENT' | 'GAPS'>('ALL');

  // Sub-tab for selected day view (defaults to Style 3 Attendance Matrix)
  const [dayViewMode, setDayViewMode] = useState<'roster_matrix' | 'rolling_10'>('roster_matrix');
  const [dayMatrixFilter, setDayMatrixFilter] = useState<'ALL' | 'PRESENT' | 'WAITING' | 'ABSENT' | 'LATE'>('ALL');
  const [selectedDayMatrixApptId, setSelectedDayMatrixApptId] = useState<string | null>(null);

  const selectedDay = summary.days.find((d) => d.dateString === selectedDateString) || summary.days[0] || null;

  const handlePrevMonth = () => {
    let newMonth = summary.month - 1;
    let newYear = summary.year;
    if (newMonth < 1) {
      newMonth = 12;
      newYear -= 1;
    }
    onMonthChange?.(newYear, newMonth);
  };

  const handleNextMonth = () => {
    let newMonth = summary.month + 1;
    let newYear = summary.year;
    if (newMonth > 12) {
      newMonth = 1;
      newYear += 1;
    }
    onMonthChange?.(newYear, newMonth);
  };

  const handleJumpToToday = () => {
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    if (summary.year === today.getFullYear() && summary.month === today.getMonth() + 1) {
      setSelectedDateString(todayStr);
      onSelectDate?.(todayStr);
    } else {
      onMonthChange?.(today.getFullYear(), today.getMonth() + 1);
      setSelectedDateString(todayStr);
      onSelectDate?.(todayStr);
    }
  };

  const handleSelectDay = (day: DayAttendance) => {
    setSelectedDateString(day.dateString);
    onSelectDate?.(day.dateString);
  };

  // Determine starting weekday of the month (0 = Sun, 1 = Mon, ..., 6 = Sat)
  const firstDayOfMonth = new Date(summary.year, summary.month - 1, 1).getDay();
  const leadingBlankDays = Array.from({ length: firstDayOfMonth });
  const weekDayHeaders = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // Filter summary counts
  const daysWithQueues = summary.days.filter((d) => d.totalAppointments > 0).length;
  const daysWithAbsences = summary.days.filter((d) => d.absentCount > 0).length;
  const daysWithGaps = summary.days.filter((d) => d.hasGaps).length;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden space-y-0" data-testid="monthly-queue-calendar-container">
      {/* ========================================================================= */}
      {/* 1. TOP HEADER: Month Selector, Doctor Indicator, Quick Nav                */}
      {/* ========================================================================= */}
      <div className="p-5 border-b border-slate-100 flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-emerald-50 text-emerald-700 shrink-0">
            <CalendarIcon className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                Patient Queue Calendar
              </span>
              <span className="text-xs text-slate-400">•</span>
              <span className="text-xs font-semibold text-slate-600 flex items-center gap-1">
                <Stethoscope className="w-3.5 h-3.5 text-emerald-600" />
                {selectedDoctorName} ({selectedDepartment})
              </span>
            </div>
            <h3 className="font-bold text-slate-900 text-lg tracking-tight mt-0.5">
              Monthly Patient Queues &amp; Attendance Matrix
            </h3>
            <p className="text-xs text-slate-500">
              Interactive month overview: daily token queues, verified reception PIN arrivals, and vacant gap allocations.
            </p>
          </div>
        </div>

        {/* Month Navigation & Action Controls */}
        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={handleJumpToToday}
            className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold transition border border-slate-200 flex items-center gap-1.5 cursor-pointer shadow-2xs"
            title="Snap calendar directly to Today's queue"
          >
            <Clock className="w-3.5 h-3.5 text-emerald-600" />
            <span>Today</span>
          </button>

          <div className="flex items-center bg-slate-100 rounded-xl p-1 border border-slate-200 shadow-2xs">
            <button
              onClick={handlePrevMonth}
              disabled={isLoading}
              className="p-1.5 rounded-lg hover:bg-white text-slate-600 hover:text-slate-900 transition disabled:opacity-50 cursor-pointer"
              aria-label="Previous Month"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="px-3 text-xs font-bold text-slate-800 min-w-[128px] text-center font-mono">
              {summary.monthName} {summary.year}
            </span>
            <button
              onClick={handleNextMonth}
              disabled={isLoading}
              className="p-1.5 rounded-lg hover:bg-white text-slate-600 hover:text-slate-900 transition disabled:opacity-50 cursor-pointer"
              aria-label="Next Month"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <div className="px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 text-center shadow-2xs">
            <div className="text-[10px] uppercase font-bold text-emerald-800 tracking-wider">Attendance Rate</div>
            <div className="text-sm font-black text-emerald-700 font-mono">{summary.attendanceRatePercentage}%</div>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 2. OVERALL MONTH STATS CARDS                                              */}
      {/* ========================================================================= */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 bg-slate-50/70 border-b border-slate-100">
        <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs">
          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5 text-emerald-600" />
            <span>Total Queued</span>
          </div>
          <div className="text-lg font-black text-slate-900 font-mono mt-0.5">
            {summary.totalAppointments} <span className="text-xs font-semibold text-slate-500">Tokens</span>
          </div>
        </div>

        <div className="bg-white p-3 rounded-xl border border-emerald-200 shadow-2xs">
          <div className="text-[11px] font-bold text-emerald-800 uppercase tracking-wider flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            <span>Verified Present</span>
          </div>
          <div className="text-lg font-black text-emerald-700 font-mono mt-0.5">
            {summary.presentCount} <span className="text-xs font-semibold text-emerald-600">Patients</span>
          </div>
        </div>

        <div className="bg-white p-3 rounded-xl border border-rose-200 shadow-2xs">
          <div className="text-[11px] font-bold text-rose-800 uppercase tracking-wider flex items-center gap-1.5">
            <XCircle className="w-3.5 h-3.5 text-rose-600" />
            <span>Absent / No-Show</span>
          </div>
          <div className="text-lg font-black text-rose-700 font-mono mt-0.5">
            {summary.absentCount} <span className="text-xs font-semibold text-rose-600">Missed</span>
          </div>
        </div>

        <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs">
          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5 text-amber-500" />
            <span>Peak Day Queue</span>
          </div>
          <div className="text-lg font-black text-slate-900 font-mono mt-0.5">
            {summary.peakTokensCount > 0 ? (
              <>
                #{summary.peakTokensCount} <span className="text-xs font-semibold text-slate-500">(Day {summary.peakDayNumber})</span>
              </>
            ) : (
              <span className="text-xs font-semibold text-slate-400">No Peak</span>
            )}
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 3. CALENDAR FILTER BAR                                                    */}
      {/* ========================================================================= */}
      <div className="px-5 py-2.5 bg-white border-b border-slate-100 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-1.5 overflow-x-auto">
          <span className="text-slate-400 font-bold text-[11px] flex items-center gap-1 mr-1">
            <Filter className="w-3 h-3 text-slate-500" />
            Filter Days:
          </span>
          <button
            type="button"
            onClick={() => setActiveFilter('ALL')}
            className={`px-2.5 py-1 rounded-lg font-bold text-[11px] transition cursor-pointer ${
              activeFilter === 'ALL'
                ? 'bg-slate-900 text-white shadow-2xs'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            All Days ({summary.days.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveFilter('ACTIVE')}
            className={`px-2.5 py-1 rounded-lg font-bold text-[11px] transition cursor-pointer ${
              activeFilter === 'ACTIVE'
                ? 'bg-emerald-600 text-white shadow-2xs'
                : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
            }`}
          >
            Active Queues ({daysWithQueues})
          </button>
          <button
            type="button"
            onClick={() => setActiveFilter('PRESENT')}
            className={`px-2.5 py-1 rounded-lg font-bold text-[11px] transition cursor-pointer ${
              activeFilter === 'PRESENT'
                ? 'bg-emerald-700 text-white shadow-2xs'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            Present Days
          </button>
          <button
            type="button"
            onClick={() => setActiveFilter('ABSENT')}
            className={`px-2.5 py-1 rounded-lg font-bold text-[11px] transition cursor-pointer ${
              activeFilter === 'ABSENT'
                ? 'bg-rose-600 text-white shadow-2xs'
                : 'bg-rose-50 text-rose-800 hover:bg-rose-100'
            }`}
          >
            With Absences ({daysWithAbsences})
          </button>
        </div>

        <div className="text-[11px] text-slate-500 font-medium">
          Click any date cell to inspect its 10-Slot Queue &amp; Roster
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 3B. COLOR-CODED PATIENT BADGE LEGEND                                      */}
      {/* ========================================================================= */}
      <div className="px-5 py-2.5 bg-slate-50/90 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-black uppercase tracking-wider text-slate-700 mr-2 flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-emerald-600" />
            Patient Number Indicators:
          </span>
          <span className="text-slate-500 text-[11px] hidden sm:inline">(#1 = Patient 1, #2 = Patient 2)</span>
        </div>

        <div className="flex items-center gap-3 flex-wrap text-[11px] font-bold">
          {/* Green = Present */}
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-emerald-100 text-emerald-900 border border-emerald-300">
            <span className="w-4 h-4 rounded-full bg-emerald-500 text-white flex items-center justify-center font-mono text-[9px] shadow-2xs font-bold">1</span>
            <span>Green = Present (Verified)</span>
          </span>

          {/* Yellow = Still Waiting */}
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-amber-100 text-amber-950 border border-amber-300">
            <span className="w-4 h-4 rounded-full bg-amber-300 text-amber-950 flex items-center justify-center font-mono text-[9px] shadow-2xs font-bold">2</span>
            <span>Yellow = Still Waiting</span>
          </span>

          {/* Red = Absent */}
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-rose-100 text-rose-900 border border-rose-300">
            <span className="w-4 h-4 rounded-full bg-rose-500 text-white flex items-center justify-center font-mono text-[9px] shadow-2xs font-bold">3</span>
            <span>Red = Absent (No-Show)</span>
          </span>

          {/* Yellow L = Late Queue Waiting */}
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-amber-100 text-amber-950 border border-amber-300">
            <span className="w-5 h-4 rounded-full bg-amber-400 text-amber-950 flex items-center justify-center font-mono text-[8px] shadow-2xs font-black">L1</span>
            <span>Late Queue Waiting</span>
          </span>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 4. MAIN MONTH CALENDAR GRID                                               */}
      {/* ========================================================================= */}
      <div className="p-4 sm:p-5">
        {/* Day-of-week header */}
        <div className="grid grid-cols-7 gap-1.5 text-center mb-2">
          {weekDayHeaders.map((day) => (
            <div key={day} className="text-[11px] font-bold text-slate-500 uppercase tracking-wider py-1 font-mono">
              {day}
            </div>
          ))}
        </div>

        {/* Calendar Day Cells */}
        <div className="grid grid-cols-7 gap-1.5 sm:gap-2.5">
          {leadingBlankDays.map((_, i) => (
            <div key={`blank-${i}`} className="min-h-[70px] sm:min-h-[86px] rounded-xl bg-slate-50/50 border border-transparent" />
          ))}

          {summary.days.map((day) => {
            const isSelected = selectedDateString === day.dateString;
            const hasAppts = day.totalAppointments > 0;
            const isAllPresent = day.status === 'PRESENT';
            const isAbsent = day.absentCount > 0;
            const isUpcoming = day.status === 'UPCOMING';

            // Filter check
            let isMuted = false;
            if (activeFilter === 'ACTIVE' && !hasAppts) isMuted = true;
            if (activeFilter === 'PRESENT' && day.presentCount === 0) isMuted = true;
            if (activeFilter === 'ABSENT' && day.absentCount === 0) isMuted = true;
            if (activeFilter === 'GAPS' && !day.hasGaps) isMuted = true;

            return (
              <button
                key={day.dateString}
                onClick={() => handleSelectDay(day)}
                type="button"
                data-testid={`calendar-day-cell-${day.dateString}`}
                className={`min-h-[70px] sm:min-h-[86px] rounded-xl p-2 sm:p-2.5 text-left transition-all border flex flex-col justify-between cursor-pointer relative overflow-hidden group ${
                  isMuted ? 'opacity-35 hover:opacity-100' : ''
                } ${
                  isSelected
                    ? 'border-2 border-emerald-600 ring-4 ring-emerald-500/20 bg-emerald-50/70 shadow-sm'
                    : isAllPresent
                    ? 'bg-emerald-50/60 border-emerald-300 hover:border-emerald-500 hover:shadow-2xs'
                    : isAbsent
                    ? 'bg-rose-50/60 border-rose-300 hover:border-rose-500 hover:shadow-2xs'
                    : isUpcoming
                    ? 'bg-sky-50/60 border-sky-300 hover:border-sky-500 hover:shadow-2xs'
                    : day.isToday
                    ? 'bg-slate-50 border-slate-400 font-bold hover:border-slate-600'
                    : 'bg-white border-slate-200 hover:border-slate-400 hover:bg-slate-50/50'
                }`}
              >
                {/* Day Header (Date number & Today indicator) */}
                <div className="flex items-center justify-between w-full">
                  <span
                    className={`font-mono text-xs font-bold ${
                      day.isToday
                        ? 'w-6 h-6 rounded-full bg-slate-900 text-white flex items-center justify-center text-[11px] shadow-xs'
                        : isSelected
                        ? 'text-emerald-950 font-black'
                        : 'text-slate-800'
                    }`}
                  >
                    {day.dayNumber}
                  </span>

                  {day.isToday && (
                    <span className="inline-flex items-center gap-1 text-[9px] font-black text-emerald-700 uppercase tracking-wider bg-emerald-100 px-1.5 py-0.5 rounded-full border border-emerald-300">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-ping" />
                      Today
                    </span>
                  )}
                </div>

                {/* Queue Content inside Day Cell */}
                <div className="w-full mt-1.5 space-y-1">
                  {hasAppts ? (
                    <>
                      {/* Queue token summary pill */}
                      <div className="text-[10px] font-mono font-bold text-slate-800 bg-white/95 border border-slate-200/90 rounded px-1.5 py-0.5 truncate flex items-center justify-between shadow-2xs">
                        <span>OPD:</span>
                        <span className="font-black text-emerald-900">{day.totalAppointments} Tokens</span>
                      </div>

                      {/* Small Numbered Patient Queue Badges (1 = Patient 1, 2 = Patient 2; Green = Present, Yellow = Waiting, Red = Absent, Yellow L = Late Queue) */}
                      <div className="flex items-center gap-1 flex-wrap py-0.5" title="Patient Queue Numbers: Green=Present, Yellow=Waiting, Red=Absent">
                        {day.appointments.slice(0, 8).map((appt, i) => {
                          const isPresent = appt.isPresent;
                          const isAbsent = appt.status === 'NO_SHOW';
                          const isLate = Boolean(appt.isLateQueue);
                          const patientNum = isLate 
                            ? `L${appt.queuePosition || (i + 1)}` 
                            : `${appt.tokenNumber || (i + 1)}`;

                          return (
                            <span
                              key={appt.bookingId || i}
                              title={`Patient #${patientNum}: ${appt.customerName || 'Patient'} • ${
                                isPresent 
                                  ? 'Present (Green)' 
                                  : isAbsent 
                                  ? 'Absent (Red)' 
                                  : isLate 
                                  ? 'Late Queue (Yellow)' 
                                  : 'Still Waiting (Yellow)'
                              }`}
                              className={`w-4.5 h-4.5 min-w-[18px] rounded-full flex items-center justify-center text-[9px] font-mono font-bold shrink-0 shadow-2xs transition-transform hover:scale-110 ${
                                isPresent
                                  ? 'bg-emerald-500 text-white ring-1 ring-emerald-600'
                                  : isAbsent
                                  ? 'bg-rose-500 text-white ring-1 ring-rose-600'
                                  : isLate
                                  ? 'bg-amber-400 text-amber-950 font-black ring-1 ring-amber-500'
                                  : 'bg-amber-300 text-amber-950 font-bold ring-1 ring-amber-400'
                              }`}
                            >
                              {patientNum}
                            </span>
                          );
                        })}
                        {day.appointments.length > 8 && (
                          <span className="text-[8px] font-mono font-bold text-slate-500 px-1 py-0.5 rounded bg-slate-100 border border-slate-200">
                            +{day.appointments.length - 8}
                          </span>
                        )}
                      </div>

                      {/* Mini presence indicators */}
                      <div className="flex items-center gap-1 flex-wrap text-[9px] font-bold">
                        {day.presentCount > 0 && (
                          <span className="px-1 py-0.2 rounded bg-emerald-100 text-emerald-800 border border-emerald-300 flex items-center gap-0.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-600" />
                            {day.presentCount}P
                          </span>
                        )}
                        {day.upcomingCount > 0 && (
                          <span className="px-1 py-0.2 rounded bg-amber-100 text-amber-900 border border-amber-300 flex items-center gap-0.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                            {day.upcomingCount}W
                          </span>
                        )}
                        {day.absentCount > 0 && (
                          <span className="px-1 py-0.2 rounded bg-rose-100 text-rose-800 border border-rose-300 flex items-center gap-0.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-rose-600" />
                            {day.absentCount}A
                          </span>
                        )}
                      </div>

                      {/* Proportional Queue Distribution Bar */}
                      <div className="w-full h-1 bg-slate-200 rounded-full overflow-hidden flex">
                        <div
                          style={{ width: `${(day.presentCount / day.totalAppointments) * 100}%` }}
                          className="bg-emerald-500 h-full"
                          title={`${day.presentCount} Present`}
                        />
                        <div
                          style={{ width: `${(day.absentCount / day.totalAppointments) * 100}%` }}
                          className="bg-rose-500 h-full"
                          title={`${day.absentCount} Absent`}
                        />
                        <div
                          style={{ width: `${(day.upcomingCount / day.totalAppointments) * 100}%` }}
                          className="bg-amber-400 h-full"
                          title={`${day.upcomingCount} Waiting`}
                        />
                      </div>
                    </>
                  ) : (
                    <div className="text-[10px] text-slate-400 font-medium italic py-1">
                      No queue
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 5. SELECTED DAY PATIENT QUEUE COMMAND CENTER                               */}
      {/* ========================================================================= */}
      {selectedDay && (
        <div className="border-t border-slate-200 bg-slate-50/80 p-5 space-y-4" data-testid="selected-day-queue-panel">
          {/* Header Bar for Selected Day */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-emerald-100 text-emerald-800 shrink-0">
                <Users className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
                    Selected Date Queue
                  </span>
                  {selectedDay.isToday && (
                    <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-600 text-white">
                      Today&apos;s Live OPD
                    </span>
                  )}
                </div>
                <h4 className="text-base font-bold text-slate-900 tracking-tight mt-0.5">
                  {new Date(`${selectedDay.dateString}T00:00:00`).toLocaleDateString('en-IN', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </h4>
                <p className="text-xs text-slate-500">
                  {selectedDay.queueTokensSummary} • {selectedDay.presentCount} verified present, {selectedDay.absentCount} missed no-shows
                </p>
              </div>
            </div>

            {/* Sub-view switcher for this day: Attendance Matrix (Style 3) vs 10-Slot Rolling Queue */}
            <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-xl self-start sm:self-auto">
              <button
                type="button"
                data-testid="selected-day-tab-matrix"
                onClick={() => setDayViewMode('roster_matrix')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                  dayViewMode === 'roster_matrix'
                    ? 'bg-white text-emerald-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Users className="w-3.5 h-3.5" />
                <span>🔲 Attendance Matrix (Style 3) [{selectedDay.totalAppointments}]</span>
              </button>

              <button
                type="button"
                data-testid="selected-day-tab-rolling"
                onClick={() => setDayViewMode('rolling_10')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                  dayViewMode === 'rolling_10'
                    ? 'bg-white text-emerald-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Zap className="w-3.5 h-3.5" />
                <span>⚡ 10-Slot Rolling Queue</span>
              </button>
            </div>
          </div>

          {/* Day Patient Number Sequence Strip (Green = Present, Yellow = Waiting, Red = Absent, Yellow L = Late Queue) */}
          {selectedDay.appointments.length > 0 && (
            <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs space-y-2">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 text-xs">
                <span className="font-extrabold text-slate-800 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
                  Day Patient Sequence ({selectedDay.appointments.length} Patients):
                </span>
                <span className="text-[11px] text-slate-500 font-mono">
                  #1 = Patient 1, #2 = Patient 2 • 🟢 Green = Present | 🟡 Yellow = Waiting | 🔴 Red = Absent
                </span>
              </div>
              <div className="flex items-center gap-2 overflow-x-auto pb-1 pt-0.5">
                {selectedDay.appointments.map((appt, i) => {
                  const isPresent = appt.isPresent;
                  const isAbsent = appt.status === 'NO_SHOW';
                  const isLate = Boolean(appt.isLateQueue);
                  const patientNum = isLate 
                    ? `L${appt.queuePosition || (i + 1)}` 
                    : `${appt.tokenNumber || (i + 1)}`;

                  return (
                    <div
                      key={appt.bookingId || i}
                      title={`Patient #${patientNum}: ${appt.customerName || 'Patient'} • ${
                        isPresent ? 'Present (Green)' : isAbsent ? 'Absent (Red)' : isLate ? 'Late Queue (Yellow)' : 'Still Waiting (Yellow)'
                      }`}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-mono font-bold shrink-0 shadow-2xs border ${
                        isPresent
                          ? 'bg-emerald-500 text-white border-emerald-600 ring-1 ring-emerald-300'
                          : isAbsent
                          ? 'bg-rose-500 text-white border-rose-600 ring-1 ring-rose-300'
                          : isLate
                          ? 'bg-amber-400 text-amber-950 border-amber-500 ring-1 ring-amber-300 font-black'
                          : 'bg-amber-300 text-amber-950 border-amber-400 ring-1 ring-amber-300'
                      }`}
                    >
                      <span className="w-4 h-4 rounded-full bg-white/25 flex items-center justify-center text-[10px]">
                        {patientNum}
                      </span>
                      <span className="text-[11px] font-sans font-medium truncate max-w-[85px]">
                        {appt.customerName.split(' ')[0]}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* SUB-VIEW 1: Style 3 Attendance Matrix for the selected day */}
          {dayViewMode === 'roster_matrix' && (() => {
            const dayPresentCount = selectedDay.appointments.filter((a) => a.isPresent).length;
            const dayAbsentCount = selectedDay.appointments.filter((a) => a.status === 'NO_SHOW').length;
            const dayLateCount = selectedDay.appointments.filter((a) => Boolean(a.isLateQueue)).length;
            const dayWaitingCount = selectedDay.appointments.filter((a) => !a.isPresent && a.status !== 'NO_SHOW').length;

            const filteredAppointments = selectedDay.appointments.filter((appt) => {
              if (dayMatrixFilter === 'PRESENT') return appt.isPresent;
              if (dayMatrixFilter === 'WAITING') return !appt.isPresent && appt.status !== 'NO_SHOW';
              if (dayMatrixFilter === 'ABSENT') return appt.status === 'NO_SHOW';
              if (dayMatrixFilter === 'LATE') return Boolean(appt.isLateQueue);
              return true;
            });

            return (
              <div className="space-y-4" data-testid="day-attendance-matrix">
                {/* Filter Pills */}
                <div className="flex items-center gap-1.5 flex-wrap text-xs pt-1">
                  <button
                    type="button"
                    onClick={() => setDayMatrixFilter('ALL')}
                    className={`px-2.5 py-1 rounded-lg font-bold transition cursor-pointer ${
                      dayMatrixFilter === 'ALL'
                        ? 'bg-slate-900 text-white shadow-2xs'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    All ({selectedDay.appointments.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setDayMatrixFilter('PRESENT')}
                    className={`px-2.5 py-1 rounded-lg font-bold transition cursor-pointer flex items-center gap-1 ${
                      dayMatrixFilter === 'PRESENT'
                        ? 'bg-emerald-600 text-white shadow-2xs'
                        : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                    }`}
                  >
                    <span className="w-2 h-2 rounded-full bg-emerald-500" />
                    Present ({dayPresentCount})
                  </button>
                  <button
                    type="button"
                    onClick={() => setDayMatrixFilter('WAITING')}
                    className={`px-2.5 py-1 rounded-lg font-bold transition cursor-pointer flex items-center gap-1 ${
                      dayMatrixFilter === 'WAITING'
                        ? 'bg-amber-500 text-white shadow-2xs'
                        : 'bg-amber-50 text-amber-900 hover:bg-amber-100'
                    }`}
                  >
                    <span className="w-2 h-2 rounded-full bg-amber-400" />
                    Waiting ({dayWaitingCount})
                  </button>
                  <button
                    type="button"
                    onClick={() => setDayMatrixFilter('ABSENT')}
                    className={`px-2.5 py-1 rounded-lg font-bold transition cursor-pointer flex items-center gap-1 ${
                      dayMatrixFilter === 'ABSENT'
                        ? 'bg-rose-600 text-white shadow-2xs'
                        : 'bg-rose-50 text-rose-800 hover:bg-rose-100'
                    }`}
                  >
                    <span className="w-2 h-2 rounded-full bg-rose-500" />
                    Absent ({dayAbsentCount})
                  </button>
                  {dayLateCount > 0 && (
                    <button
                      type="button"
                      onClick={() => setDayMatrixFilter('LATE')}
                      className={`px-2.5 py-1 rounded-lg font-bold transition cursor-pointer flex items-center gap-1 ${
                        dayMatrixFilter === 'LATE'
                          ? 'bg-amber-600 text-white shadow-2xs'
                          : 'bg-amber-50 text-amber-900 hover:bg-amber-100'
                      }`}
                    >
                      <span className="w-2 h-2 rounded-full bg-amber-500" />
                      Late ({dayLateCount})
                    </button>
                  )}
                </div>

                {filteredAppointments.length === 0 ? (
                  <div className="bg-white rounded-2xl p-8 border border-slate-200 text-center text-slate-500 text-xs">
                    No patient tokens match this filter for {selectedDay.dateString}.
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                    {filteredAppointments.map((appt, i) => {
                      const isPresent = appt.isPresent;
                      const isAbsent = appt.status === 'NO_SHOW';
                      const isLate = Boolean(appt.isLateQueue);
                      const patientNum = isLate 
                        ? `L${appt.queuePosition || (i + 1)}` 
                        : `${appt.tokenNumber || (i + 1)}`;
                      const isSelected = selectedDayMatrixApptId === appt.bookingId;

                      return (
                        <div
                          key={appt.bookingId || i}
                          onClick={() => setSelectedDayMatrixApptId(isSelected ? null : appt.bookingId)}
                          className={`rounded-2xl p-3.5 border-2 transition-all flex flex-col justify-between gap-2.5 cursor-pointer shadow-2xs hover:shadow-md ${
                            isPresent
                              ? 'bg-emerald-50/70 border-emerald-500 hover:border-emerald-600 ring-1 ring-emerald-400/20'
                              : isAbsent
                              ? 'bg-rose-50/70 border-rose-400 hover:border-rose-500 ring-1 ring-rose-300/20'
                              : isLate
                              ? 'bg-amber-50/80 border-amber-400 hover:border-amber-500 ring-1 ring-amber-300/30'
                              : 'bg-amber-50/50 border-amber-300 hover:border-amber-400 ring-1 ring-amber-200/30'
                          } ${isSelected ? 'ring-4 ring-emerald-500/30 scale-[1.02]' : ''}`}
                        >
                          {/* Tile Top: Number Badge and Status Tag */}
                          <div className="flex items-center justify-between gap-1.5">
                            <span
                              className={`w-7 h-7 rounded-xl flex items-center justify-center font-mono font-black text-xs shadow-2xs shrink-0 ${
                                isPresent
                                  ? 'bg-emerald-500 text-white ring-1 ring-emerald-600'
                                  : isAbsent
                                  ? 'bg-rose-500 text-white ring-1 ring-rose-600'
                                  : isLate
                                  ? 'bg-amber-400 text-amber-950 font-black ring-1 ring-amber-500'
                                  : 'bg-amber-300 text-amber-950 font-bold ring-1 ring-amber-400'
                              }`}
                            >
                              {patientNum}
                            </span>

                            <span
                              className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider shrink-0 ${
                                isPresent
                                  ? 'bg-emerald-600 text-white'
                                  : isAbsent
                                  ? 'bg-rose-600 text-white'
                                  : isLate
                                  ? 'bg-amber-400 text-amber-950 border border-amber-500 font-black'
                                  : 'bg-amber-300 text-amber-950 font-bold'
                              }`}
                            >
                              {isPresent
                                ? 'PRESENT'
                                : isAbsent
                                ? 'ABSENT'
                                : isLate
                                ? 'LATE'
                                : 'WAITING'}
                            </span>
                          </div>

                          {/* Tile Middle: Patient Name & Time */}
                          <div className="py-0.5">
                            <p className="text-xs font-bold text-slate-900 truncate" title={appt.customerName}>
                              {appt.customerName}
                            </p>
                            <p className="text-[10px] text-slate-500 font-medium font-mono flex items-center gap-1 mt-0.5">
                              <Clock className="w-3 h-3 text-slate-400" />
                              <span>{appt.time}</span>
                            </p>
                          </div>

                          {/* Tile Bottom: Compact Presence Indicator */}
                          <div className="pt-2 border-t border-slate-200/60 flex items-center justify-between text-[10px] font-semibold text-slate-600">
                            {isPresent ? (
                              <span className="inline-flex items-center gap-1 text-emerald-700 font-bold">
                                <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                                <span>PIN Verified</span>
                              </span>
                            ) : isAbsent ? (
                              <span className="inline-flex items-center gap-1 text-rose-700 font-bold">
                                <XCircle className="w-3 h-3 text-rose-600" />
                                <span>Missed</span>
                              </span>
                            ) : isLate ? (
                              <span className="inline-flex items-center gap-1 text-amber-800 font-bold">
                                <Clock className="w-3 h-3 text-amber-600" />
                                <span>Late Queue</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-amber-700 font-medium">
                                <Clock className="w-3 h-3 text-amber-500" />
                                <span>Awaiting PIN</span>
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Selected Day Matrix Item Inspector */}
                {selectedDayMatrixApptId && (() => {
                  const appt = selectedDay.appointments.find((a) => a.bookingId === selectedDayMatrixApptId);
                  if (!appt) return null;
                  const isP = appt.isPresent;
                  const isA = appt.status === 'NO_SHOW';
                  const isL = Boolean(appt.isLateQueue);
                  const pNum = isL ? `L${appt.queuePosition || 1}` : `${appt.tokenNumber || 1}`;

                  return (
                    <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/90 flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-in fade-in duration-150">
                      <div className="flex items-center gap-3">
                        <span className={`w-9 h-9 rounded-xl flex items-center justify-center font-mono font-black text-sm text-white shadow-2xs ${
                          isP ? 'bg-emerald-500' : isA ? 'bg-rose-500' : isL ? 'bg-amber-500' : 'bg-amber-400 text-amber-950'
                        }`}>
                          {pNum}
                        </span>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-slate-900">{appt.customerName}</span>
                            <span className={`px-2 py-0.2 rounded-full text-[10px] font-bold uppercase ${
                              isP ? 'bg-emerald-100 text-emerald-800' : isA ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-900'
                            }`}>
                              {isP ? 'Present' : isA ? 'Absent' : isL ? 'Late Queue' : 'Still Waiting'}
                            </span>
                          </div>
                          <p className="text-xs text-slate-500">
                            Time: {appt.time} • Doctor: {appt.doctorName} • Ref: {appt.referenceCode}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSelectedDayMatrixApptId(null)}
                        className="text-xs font-bold text-slate-500 hover:text-slate-800 underline underline-offset-2 self-end sm:self-center cursor-pointer"
                      >
                        Close Details
                      </button>
                    </div>
                  );
                })()}
              </div>
            );
          })()}

          {/* SUB-VIEW 2: 10-Slot Rolling Queue for the selected day */}
          {dayViewMode === 'rolling_10' && (
            <div className="space-y-3">
              {selectedDay.rollingQueueSlots && selectedDay.rollingQueueSlots.length > 0 ? (
                <RollingTenSlotQueue
                  slots={selectedDay.rollingQueueSlots}
                  doctorName={selectedDoctorName}
                  department={selectedDepartment}
                  slotDurationMinutes={2}
                  onRefresh={() => {
                    const [y, m] = selectedDay.dateString.split('-').map(Number);
                    onMonthChange?.(y, m);
                  }}
                  isLoading={isLoading}
                />
              ) : (
                <div className="bg-white rounded-2xl p-8 border border-slate-200 text-center space-y-2">
                  <div className="w-10 h-10 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
                    <Clock className="w-5 h-5" />
                  </div>
                  <h5 className="font-bold text-slate-800 text-sm">No Patient Queue Scheduled on this Date</h5>
                  <p className="text-xs text-slate-500 max-w-sm mx-auto">
                    There are no patient appointments or walk-in tokens booked for {selectedDay.dateString}. Select an active date from the calendar above to view its live 10-slot queue.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Backwards-compatibility alias
export const MonthlyPatientQueueCalendar = MonthlyAttendanceCalendar;
