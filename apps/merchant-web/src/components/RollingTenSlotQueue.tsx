'use client';

import React from 'react';
import { 
  Clock, 
  UserCheck, 
  Sparkles, 
  ShieldCheck, 
  ArrowRight, 
  Hourglass, 
  CheckCircle2, 
  AlertCircle,
  Stethoscope,
  Zap,
  Info
} from 'lucide-react';
import { QueueSlot } from '@/lib/queue-scheduler';

interface RollingTenSlotQueueProps {
  slots: QueueSlot[];
  doctorName?: string;
  department?: string;
  slotDurationMinutes?: number;
  currentBookingId?: string | null;
  onRefresh?: () => void;
  isLoading?: boolean;
}

export function RollingTenSlotQueue({
  slots,
  doctorName = 'Consultant Doctor',
  department = 'OPD Clinic',
  slotDurationMinutes = 2,
  currentBookingId = null,
  onRefresh,
  isLoading = false,
}: RollingTenSlotQueueProps) {
  const currentSlot = slots[0];
  const upcomingSlots = slots.slice(1);

  // Statistics across the 10 slots
  const presentCount = slots.filter((s) => s.isPresent).length;
  const freeGapsCount = slots.filter((s) => s.type === 'FREE_GAP').length;
  const lateAccommodatedCount = slots.filter((s) => s.type === 'LATE_ACCOMMODATED').length;
  const hasFastTrack = slots.some((s) => s.isFastTracked);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden space-y-0">
      {/* Header bar */}
      <div className="bg-slate-900 text-white p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-extrabold uppercase tracking-wider bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
              Live Consultation Queue
            </span>
            <span className="text-xs text-slate-400">Next 10 Slots Sequence</span>
          </div>
          <h2 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
            <Stethoscope className="w-5 h-5 text-emerald-400" />
            <span>{doctorName}</span>
            <span className="text-sm font-normal text-slate-300">({department})</span>
          </h2>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right hidden sm:block">
            <div className="text-xs text-slate-400">Slot Duration</div>
            <div className="text-sm font-bold text-emerald-400">{slotDurationMinutes} mins / patient</div>
          </div>
          {onRefresh && (
            <button
              onClick={onRefresh}
              disabled={isLoading}
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 transition border border-slate-700 flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
            >
              <Clock className={`w-3.5 h-3.5 text-emerald-400 ${isLoading ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
          )}
        </div>
      </div>

      {/* Intelligent Status Insights Ribbon */}
      <div className="bg-emerald-50/70 border-b border-emerald-100 px-5 py-3 flex flex-wrap items-center justify-between gap-3 text-xs text-emerald-950">
        <div className="flex items-center gap-4 flex-wrap">
          <span className="inline-flex items-center gap-1 font-semibold text-emerald-800">
            <UserCheck className="w-3.5 h-3.5 text-emerald-600" />
            <span>{presentCount} Checked-In</span>
          </span>
          <span className="inline-flex items-center gap-1 font-semibold text-slate-600">
            <Clock className="w-3.5 h-3.5 text-slate-400" />
            <span>{freeGapsCount} Free Gaps</span>
          </span>
          {lateAccommodatedCount > 0 && (
            <span className="inline-flex items-center gap-1 font-semibold text-sky-800 bg-sky-100/70 px-2 py-0.5 rounded-md border border-sky-200">
              <ShieldCheck className="w-3.5 h-3.5 text-sky-600" />
              <span>{lateAccommodatedCount} Late Accommodated Safely</span>
            </span>
          )}
          {hasFastTrack && (
            <span className="inline-flex items-center gap-1 font-semibold text-amber-800 bg-amber-100/70 px-2 py-0.5 rounded-md border border-amber-200">
              <Zap className="w-3.5 h-3.5 text-amber-600" />
              <span>Doctor Free • Fast-Track Next Patient</span>
            </span>
          )}
        </div>
        <div className="text-[11px] text-slate-500 flex items-center gap-1">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
          <span>On-Time appointments guaranteed undisturbed</span>
        </div>
      </div>

      {/* Slots List / Grid */}
      <div className="p-5 space-y-3">
        {slots.map((slot) => {
          const isServing = slot.type === 'SERVING';
          const isBookedPresent = slot.type === 'BOOKED_PRESENT';
          const isAwaitingPin = slot.type === 'BOOKED_AWAITING_PIN';
          const isFree = slot.type === 'FREE_GAP';
          const isLateAccommodated = slot.type === 'LATE_ACCOMMODATED';
          const isLateWaiting = slot.type === 'LATE_WAITING';
          const isTargetPatient = slot.isCurrentPatient;

          return (
            <div
              key={slot.slotIndex}
              data-testid={`queue-slot-${slot.slotIndex}`}
              className={`rounded-xl p-4 transition-all border flex flex-col md:flex-row md:items-center justify-between gap-4 ${
                isTargetPatient
                  ? 'bg-emerald-50 border-2 border-emerald-500 shadow-md ring-2 ring-emerald-500/30'
                  : isServing
                  ? 'bg-emerald-50/90 border-2 border-emerald-500 shadow-sm'
                  : isLateAccommodated
                  ? 'bg-sky-50/80 border border-sky-300'
                  : isFree
                  ? 'bg-slate-50/70 border-dashed border-slate-300'
                  : isAwaitingPin
                  ? 'bg-amber-50/60 border border-amber-200'
                  : 'bg-white border-slate-200 hover:border-slate-300'
              }`}
            >
              {/* Left Column: Slot # & Time Window */}
              <div className="flex items-center gap-3">
                <div
                  className={`w-11 h-11 rounded-xl flex flex-col items-center justify-center shrink-0 font-mono font-bold text-center border shadow-2xs ${
                    isServing
                      ? 'bg-emerald-600 text-white border-emerald-700'
                      : isTargetPatient
                      ? 'bg-emerald-700 text-white border-emerald-800'
                      : isFree
                      ? 'bg-slate-100 text-slate-500 border-slate-200'
                      : isLateAccommodated
                      ? 'bg-sky-600 text-white border-sky-700'
                      : 'bg-slate-100 text-slate-800 border-slate-200'
                  }`}
                >
                  <span className="text-[10px] uppercase font-bold tracking-tight">Slot</span>
                  <span className="text-base leading-none">#{slot.slotIndex}</span>
                </div>

                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold text-slate-900 font-mono">
                      {slot.formattedStartTime} – {slot.formattedEndTime}
                    </span>
                    {isTargetPatient && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-600 text-white uppercase tracking-wider animate-pulse">
                        YOUR APPOINTMENT
                      </span>
                    )}
                    {isServing && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-100 text-emerald-800 border border-emerald-300 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-ping" />
                        IN CONSULTATION
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">{slot.statusDescription}</p>
                </div>
              </div>

              {/* Middle Column: Patient / Token Details */}
              <div className="flex items-center gap-3">
                {isFree ? (
                  <div className="px-3 py-1.5 rounded-lg bg-slate-100/90 border border-slate-200 text-xs font-medium text-slate-600 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-slate-400" />
                    <span>Free Vacant Slot (Open)</span>
                  </div>
                ) : isLateWaiting ? (
                  <div className="px-3 py-1.5 rounded-lg bg-amber-50 border border-amber-200 text-xs font-semibold text-amber-800 flex items-center gap-1.5">
                    <Hourglass className="w-3.5 h-3.5 text-amber-600" />
                    <span>Waiting for Next Free Slot (P14 Protected)</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    {slot.tokenNumber && (
                      <span className={`px-2.5 py-1 rounded-lg border font-mono text-xs font-bold shadow-2xs flex items-center gap-1.5 ${
                        slot.isPresent
                          ? 'bg-emerald-500 text-white border-emerald-600'
                          : slot.type === 'LATE_WAITING' || slot.type === 'LATE_ACCOMMODATED'
                          ? 'bg-amber-400 text-amber-950 border-amber-500 font-black'
                          : 'bg-amber-300 text-amber-950 border-amber-400'
                      }`}>
                        <span className="w-4 h-4 rounded-full bg-white/25 flex items-center justify-center text-[10px]">
                          {slot.type === 'LATE_WAITING' || slot.type === 'LATE_ACCOMMODATED' ? `L${slot.tokenNumber}` : slot.tokenNumber}
                        </span>
                        <span>
                          {slot.type === 'LATE_WAITING' || slot.type === 'LATE_ACCOMMODATED'
                            ? `Patient L${slot.tokenNumber}`
                            : `Patient #${slot.tokenNumber}`}
                        </span>
                      </span>
                    )}
                    <div>
                      <span className="text-xs font-bold text-slate-900 block">
                        {slot.patientName}
                      </span>
                      {slot.referenceCode && (
                        <span className="text-[11px] font-mono text-slate-500">
                          {slot.referenceCode}
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Right Column: Status Badges */}
              <div className="flex items-center gap-2 self-start md:self-center">
                {isBookedPresent && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Present (PIN Verified)</span>
                  </span>
                )}

                {isAwaitingPin && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-200">
                    <Hourglass className="w-3.5 h-3.5 text-amber-600" />
                    <span>Awaiting PIN</span>
                  </span>
                )}

                {isLateAccommodated && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-sky-100 text-sky-800 border border-sky-300">
                    <ShieldCheck className="w-3.5 h-3.5 text-sky-600" />
                    <span>Late Accommodated in Gap</span>
                  </span>
                )}

                {isFree && slot.isFastTracked && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200">
                    <Zap className="w-3.5 h-3.5 text-amber-500" />
                    <span>Pass Directly to Doctor</span>
                  </span>
                )}

                {isFree && !slot.isFastTracked && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium text-slate-500 bg-white border border-slate-200">
                    <span>Available</span>
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Rules & Logic Transparency Legend Footer */}
      <div className="bg-slate-50 border-t border-slate-200 p-4 text-[11px] text-slate-600 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <Info className="w-4 h-4 text-emerald-700 shrink-0" />
          <span>
            <strong>Queue Algorithm Guarantee:</strong> Gaps (e.g. P11-P13) accommodate late arrivals safely without disturbing scheduled patient times.
          </span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> Present
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-sky-500" /> Late Gap
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-slate-300 border border-slate-400" /> Free Slot
          </span>
        </div>
      </div>
    </div>
  );
}
