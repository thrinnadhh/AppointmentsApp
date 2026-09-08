'use client';

import React, { useState } from 'react';
import { Clock, Calendar, Save, CheckCircle2 } from 'lucide-react';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default function ScheduleManagementPage() {
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
    <div className="space-y-6 max-w-4xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Weekly Availability & Hours</h1>
          <p className="text-sm text-slate-500 mt-1">
            Control when your slots are open for online booking in Tirupati
          </p>
        </div>
        <button
          onClick={handleSave}
          className="inline-flex items-center px-4 py-2 rounded-xl text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition shadow-sm"
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
            className={`p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
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
  );
}
