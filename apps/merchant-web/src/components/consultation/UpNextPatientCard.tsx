'use client';

import React from 'react';
import { 
  UserCheck, 
  Clock, 
  ArrowRight, 
  Loader2, 
  AlertCircle, 
  CheckCircle,
  HelpCircle,
  ShieldCheck,
  Sparkles
} from 'lucide-react';
import { ActiveConsultationBooking } from './ActiveConsultationCard';

interface UpNextPatientCardProps {
  candidate: ActiveConsultationBooking | null;
  priorityReason: string;
  onCallPatient: () => Promise<void>;
  isCalling: boolean;
  hasActiveConsultation: boolean;
}

export default function UpNextPatientCard({
  candidate,
  priorityReason,
  onCallPatient,
  isCalling,
  hasActiveConsultation,
}: UpNextPatientCardProps) {
  if (!candidate) {
    return (
      <div 
        data-testid="up-next-empty"
        className="bg-slate-50 border border-slate-200 rounded-2xl p-6 text-center"
      >
        <p className="text-sm text-slate-500 flex items-center justify-center gap-2">
          <HelpCircle className="w-4 h-4 text-slate-400" />
          No checked-in patients currently waiting in queue.
        </p>
      </div>
    );
  }

  const patientName = candidate.patient_name || candidate.customer?.full_name || 'Next Patient';
  const slotFormatted = `${new Date(candidate.slot_start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${new Date(candidate.slot_end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

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
            Standby (Late)
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
    <div 
      data-testid="up-next-patient-card"
      className="bg-gradient-to-r from-emerald-50/60 to-teal-50/40 border border-emerald-200 rounded-2xl p-6 shadow-xs relative"
    >
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-white border border-emerald-200 flex items-center justify-center font-bold text-emerald-800 text-lg shadow-2xs shrink-0">
            <UserCheck className="w-6 h-6 text-emerald-700" />
          </div>

          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span 
                data-testid="up-next-badge"
                className="text-xs font-bold text-emerald-800 uppercase tracking-wider bg-emerald-100/80 px-2.5 py-0.5 rounded-md"
              >
                Up Next In Queue
              </span>
              {getArrivalBadge(candidate.arrival_tag)}
            </div>

            <h3 className="text-xl font-bold text-slate-900 mt-1">
              {patientName}
            </h3>

            <p className="text-xs text-slate-600 mt-1 flex items-center gap-2 flex-wrap">
              <span className="font-mono bg-white px-2 py-0.5 rounded border border-slate-200">
                {candidate.reference_code}
              </span>
              <span>•</span>
              <span className="flex items-center gap-1 text-slate-700">
                <Clock className="w-3.5 h-3.5 text-slate-400" />
                Slot: {slotFormatted}
              </span>
              <span>•</span>
              <span className="text-emerald-800 font-medium flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-emerald-600" />
                {priorityReason || 'Scheduled consultation'}
              </span>
            </p>
          </div>
        </div>

        {/* Action Button */}
        <div className="shrink-0">
          {hasActiveConsultation ? (
            <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 px-4 py-2.5 rounded-xl flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
              <span>Complete current consultation before calling next patient.</span>
            </div>
          ) : (
            <button
              type="button"
              data-testid="start-consultation-btn"
              onClick={onCallPatient}
              disabled={isCalling}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-sm rounded-xl transition shadow-sm hover:shadow cursor-pointer disabled:opacity-50"
            >
              {isCalling ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Calling Patient...
                </>
              ) : (
                <>
                  <span>Call Patient / Start Consultation</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
