'use client';

import React, { useState } from 'react';
import { 
  Users, 
  Clock, 
  CheckCircle, 
  AlertCircle, 
  AlertTriangle,
  FileCheck,
  CalendarDays,
  ShieldAlert,
  ChevronRight,
  ArrowUpDown
} from 'lucide-react';
import { ActiveConsultationBooking } from './ActiveConsultationCard';

interface ConsultantQueueTabsProps {
  waitingPatients: ActiveConsultationBooking[];
  standbyPatients: ActiveConsultationBooking[];
  completedPatients: ActiveConsultationBooking[];
  allScheduledPatients: ActiveConsultationBooking[];
  onOverrideUrgency: (booking: ActiveConsultationBooking) => void;
}

export default function ConsultantQueueTabs({
  waitingPatients,
  standbyPatients,
  completedPatients,
  allScheduledPatients,
  onOverrideUrgency,
}: ConsultantQueueTabsProps) {
  const [activeTab, setActiveTab] = useState<'WAITING' | 'STANDBY' | 'COMPLETED' | 'ALL'>('WAITING');

  const getArrivalBadge = (tag?: string) => {
    switch (tag) {
      case 'On Time':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
            <CheckCircle className="w-3 h-3 text-emerald-600" />
            On Time
          </span>
        );
      case 'Early':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-sky-50 text-sky-800 border border-sky-200">
            <Clock className="w-3 h-3 text-sky-600" />
            Early
          </span>
        );
      case 'Late':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200">
            <AlertCircle className="w-3 h-3 text-amber-600" />
            Standby
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200">
            Expected
          </span>
        );
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
      {/* Navigation Tabs Bar */}
      <div className="flex border-b border-slate-200 bg-slate-50/70 overflow-x-auto text-xs font-bold">
        <button
          type="button"
          data-testid="tab-waiting"
          onClick={() => setActiveTab('WAITING')}
          className={`flex items-center gap-2 px-6 py-4 border-b-2 transition whitespace-nowrap cursor-pointer ${
            activeTab === 'WAITING'
              ? 'border-emerald-600 text-emerald-800 bg-white'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          <Users className="w-4 h-4 text-emerald-600" />
          <span>Waiting Lounge</span>
          <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[11px] font-bold">
            {waitingPatients.length}
          </span>
        </button>

        <button
          type="button"
          data-testid="tab-standby"
          onClick={() => setActiveTab('STANDBY')}
          className={`flex items-center gap-2 px-6 py-4 border-b-2 transition whitespace-nowrap cursor-pointer ${
            activeTab === 'STANDBY'
              ? 'border-emerald-600 text-emerald-800 bg-white'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          <AlertTriangle className="w-4 h-4 text-amber-600" />
          <span>Standby Queue (Late Arrivals)</span>
          <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[11px] font-bold">
            {standbyPatients.length}
          </span>
        </button>

        <button
          type="button"
          data-testid="tab-completed"
          onClick={() => setActiveTab('COMPLETED')}
          className={`flex items-center gap-2 px-6 py-4 border-b-2 transition whitespace-nowrap cursor-pointer ${
            activeTab === 'COMPLETED'
              ? 'border-emerald-600 text-emerald-800 bg-white'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          <FileCheck className="w-4 h-4 text-emerald-600" />
          <span>Completed Today</span>
          <span className="px-2 py-0.5 rounded-full bg-slate-200 text-slate-700 text-[11px] font-bold">
            {completedPatients.length}
          </span>
        </button>

        <button
          type="button"
          data-testid="tab-all-slots"
          onClick={() => setActiveTab('ALL')}
          className={`flex items-center gap-2 px-6 py-4 border-b-2 transition whitespace-nowrap cursor-pointer ${
            activeTab === 'ALL'
              ? 'border-emerald-600 text-emerald-800 bg-white'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          <CalendarDays className="w-4 h-4 text-slate-500" />
          <span>All Slots Today</span>
          <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[11px]">
            {allScheduledPatients.length}
          </span>
        </button>
      </div>

      {/* Tab 1: Waiting Lounge */}
      {activeTab === 'WAITING' && (
        <div data-testid="waiting-queue-list" className="p-6 space-y-4">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Checked-in on-time patients present in waiting area.</span>
            <span>Sorted by scheduled slot time</span>
          </div>

          {waitingPatients.length === 0 ? (
            <div data-testid="empty-waiting-queue" className="py-12 text-center text-slate-400 text-sm">
              No on-time patients currently in waiting lounge.
            </div>
          ) : (
            <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
              {waitingPatients.map((booking, idx) => {
                const patientName = booking.patient_name || booking.customer?.full_name || 'Patient';
                const slotTime = `${new Date(booking.slot_start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${new Date(booking.slot_end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
                return (
                  <div key={booking.id} className="p-4 hover:bg-slate-50 transition flex items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                      <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-800 font-bold text-xs flex items-center justify-center shrink-0">
                        #{idx + 1}
                      </div>

                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-slate-900 text-sm">{patientName}</span>
                          {getArrivalBadge(booking.arrival_tag)}
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-2">
                          <span className="font-mono bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">
                            {booking.reference_code}
                          </span>
                          <span>•</span>
                          <span>Slot: {slotTime}</span>
                          <span>•</span>
                          <span>Status: Checked In</span>
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        data-testid="open-medical-override-btn"
                        onClick={() => onOverrideUrgency(booking)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 transition cursor-pointer"
                      >
                        <ShieldAlert className="w-3.5 h-3.5 text-rose-600" />
                        Medical Override
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Standby Queue (Late Arrivals) */}
      {activeTab === 'STANDBY' && (
        <div data-testid="standby-queue-list" className="p-6 space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-xs text-amber-900 leading-relaxed space-y-1">
            <div className="font-bold flex items-center gap-1.5 text-amber-950">
              <AlertCircle className="w-4 h-4 text-amber-700" />
              Standby Queue Specification (SPEC Priority 2)
            </div>
            <p>
              Late arrivals (arrived &gt;10 min after slot) are automatically held in Standby. 
              They are dispatched in original booking order (FIFO) during schedule gaps or after all on-time patients are served. 
              An on-time patient is <strong className="font-semibold text-amber-950">never pushed back</strong> by a late patient.
            </p>
          </div>

          {standbyPatients.length === 0 ? (
            <div data-testid="empty-standby-queue" className="py-12 text-center text-slate-400 text-sm">
              No late patients currently held in Standby Queue.
            </div>
          ) : (
            <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
              {standbyPatients.map((booking, idx) => {
                const patientName = booking.patient_name || booking.customer?.full_name || 'Patient';
                const slotTime = `${new Date(booking.slot_start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
                return (
                  <div key={booking.id} className="p-4 hover:bg-slate-50 transition flex items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                      <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-800 font-bold text-xs flex items-center justify-center shrink-0">
                        S{idx + 1}
                      </div>

                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-slate-900 text-sm">{patientName}</span>
                          <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-900 border border-amber-200">
                            Standby (Late)
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-2">
                          <span className="font-mono bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">
                            {booking.reference_code}
                          </span>
                          <span>•</span>
                          <span>Original Slot: {slotTime}</span>
                          <span>•</span>
                          <span className="text-amber-800 font-medium">Eligible for Schedule Gaps</span>
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        data-testid="open-medical-override-btn"
                        onClick={() => onOverrideUrgency(booking)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 transition cursor-pointer"
                      >
                        <ShieldAlert className="w-3.5 h-3.5 text-rose-600" />
                        Medical Override
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Tab 3: Completed Today */}
      {activeTab === 'COMPLETED' && (
        <div data-testid="completed-queue-list" className="p-6 space-y-4">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Patients who completed consultation today.</span>
            <span>Total: {completedPatients.length} consultations</span>
          </div>

          {completedPatients.length === 0 ? (
            <div data-testid="empty-completed-queue" className="py-12 text-center text-slate-400 text-sm">
              No consultations completed yet today.
            </div>
          ) : (
            <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
              {completedPatients.map((booking) => {
                const patientName = booking.patient_name || booking.customer?.full_name || 'Patient';
                const slotTime = `${new Date(booking.slot_start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
                const completedTime = booking.updated_at ? new Date(booking.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Done';
                return (
                  <div key={booking.id} className="p-4 hover:bg-slate-50 transition flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3.5">
                      <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-800 flex items-center justify-center shrink-0">
                        <CheckCircle className="w-4 h-4 text-emerald-700" />
                      </div>

                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-900 text-sm">{patientName}</span>
                          <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
                            Completed
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-2">
                          <span className="font-mono bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">
                            {booking.reference_code}
                          </span>
                          <span>•</span>
                          <span>Slot: {slotTime}</span>
                          <span>•</span>
                          <span>Completed at: {completedTime}</span>
                        </p>
                      </div>
                    </div>

                    <div className="text-xs text-emerald-800 font-semibold bg-emerald-50 px-2.5 py-1 rounded-md border border-emerald-100">
                      Finished
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Tab 4: All Scheduled Today */}
      {activeTab === 'ALL' && (
        <div data-testid="all-slots-queue-list" className="p-6 space-y-4">
          <div className="text-xs text-slate-500">
            Master roster of all scheduled appointments for this consultant today.
          </div>

          {allScheduledPatients.length === 0 ? (
            <div data-testid="empty-all-slots" className="py-12 text-center text-slate-400 text-sm">
              No appointments scheduled for today.
            </div>
          ) : (
            <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
              {allScheduledPatients.map((booking) => {
                const patientName = booking.patient_name || booking.customer?.full_name || 'Patient';
                const slotTime = `${new Date(booking.slot_start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${new Date(booking.slot_end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
                return (
                  <div key={booking.id} className="p-4 hover:bg-slate-50 transition flex items-center justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900 text-sm">{patientName}</span>
                        <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${
                          booking.status === 'COMPLETED' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' :
                          booking.status === 'IN_CONSULTATION' ? 'bg-emerald-100 text-emerald-900 border-emerald-300' :
                          booking.status === 'CHECKED_IN' ? 'bg-sky-50 text-sky-800 border-sky-200' :
                          'bg-slate-100 text-slate-600 border-slate-200'
                        }`}>
                          {booking.status}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-2">
                        <span className="font-mono bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">
                          {booking.reference_code}
                        </span>
                        <span>•</span>
                        <span>{slotTime}</span>
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
