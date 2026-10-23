'use client';

import React, { useState, useEffect } from 'react';
import { 
  UserCheck, 
  Clock, 
  FileEdit, 
  CheckCircle, 
  Loader2, 
  AlertCircle,
  Tag,
  Stethoscope,
  Sparkles
} from 'lucide-react';

export interface ActiveConsultationBooking {
  id: string;
  reference_code: string;
  status?: string;
  patient_name?: string;
  customer?: {
    full_name?: string;
    phone?: string;
  };
  slot_start: string;
  slot_end: string;
  arrival_tag?: 'On Time' | 'Early' | 'Late' | 'Expected';
  checked_in_method?: string;
  checked_in_at?: string;
  updated_at?: string;
  version?: number;
  consultation_notes?: string;
}

interface ActiveConsultationCardProps {
  booking: ActiveConsultationBooking | null;
  notes: string;
  onNotesChange: (notes: string) => void;
  onComplete: () => Promise<void>;
  isCompleting: boolean;
}

export default function ActiveConsultationCard({
  booking,
  notes,
  onNotesChange,
  onComplete,
  isCompleting,
}: ActiveConsultationCardProps) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // Live consultation stopwatch
  useEffect(() => {
    if (!booking) {
      setElapsedSeconds(0);
      return;
    }

    const startTime = booking.updated_at ? new Date(booking.updated_at).getTime() : Date.now();
    const updateTimer = () => {
      const now = Date.now();
      const diff = Math.max(0, Math.floor((now - startTime) / 1000));
      setElapsedSeconds(diff);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [booking]);

  const formatTimer = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

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
            Late (Standby)
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

  const insertQuickNote = (phrase: string) => {
    if (!notes.trim()) {
      onNotesChange(phrase);
    } else {
      onNotesChange(`${notes.trim()}\n• ${phrase}`);
    }
  };

  if (!booking) {
    return (
      <div className="bg-white border border-dashed border-slate-300 rounded-2xl p-8 text-center flex flex-col items-center justify-center min-h-[300px]">
        <div className="w-16 h-16 rounded-full bg-emerald-50 text-emerald-700 flex items-center justify-center mb-4">
          <Stethoscope className="w-8 h-8 opacity-80" />
        </div>
        <h3 className="text-lg font-semibold text-slate-800 mb-1">
          Consultation Room Ready
        </h3>
        <p className="text-sm text-slate-500 max-w-sm mb-4">
          No consultation is currently active. Select the next patient from the queue below to start.
        </p>
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-600 border border-slate-200">
          <span className="w-2 h-2 rounded-full bg-emerald-500" />
          Doctor Status: Available
        </span>
      </div>
    );
  }

  const patientName = booking.patient_name || booking.customer?.full_name || 'Patient';
  const slotFormatted = `${new Date(booking.slot_start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${new Date(booking.slot_end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

  return (
    <div className="bg-white border-2 border-emerald-500/80 rounded-2xl p-6 shadow-md relative overflow-hidden space-y-6">
      <div className="absolute top-0 right-0 bg-emerald-700 text-white text-[11px] font-bold tracking-wider px-4 py-1 rounded-bl-xl uppercase shadow-xs flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping" />
        In Consultation
      </div>

      {/* Patient Meta & Timer */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-2">
        <div className="flex items-start gap-3.5">
          <div className="w-12 h-12 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center font-bold text-lg shrink-0">
            {patientName.charAt(0).toUpperCase()}
          </div>
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <h2 className="text-xl font-bold text-slate-900">{patientName}</h2>
              {getArrivalBadge(booking.arrival_tag)}
            </div>
            <p className="text-xs text-slate-500 mt-1 flex items-center gap-2 flex-wrap">
              <span className="font-mono bg-slate-100 text-slate-700 px-2 py-0.5 rounded border border-slate-200">
                {booking.reference_code}
              </span>
              <span>•</span>
              <span className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-slate-400" />
                Slot: {slotFormatted}
              </span>
              <span>•</span>
              <span>Check-in: {booking.checked_in_method || 'Verified Code'}</span>
            </p>
          </div>
        </div>

        {/* Stopwatch counter */}
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-2.5 flex flex-col items-center justify-center shrink-0">
          <span className="text-[10px] font-bold text-emerald-800 uppercase tracking-wider">
            Elapsed Time
          </span>
          <span className="font-mono text-2xl font-black text-emerald-900">
            {formatTimer(elapsedSeconds)}
          </span>
        </div>
      </div>

      {/* Clinical Notes & Prescription Area */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5 uppercase tracking-wider">
            <FileEdit className="w-3.5 h-3.5 text-emerald-700" />
            Clinical Notes & Prescription
          </label>
          <span className="text-xs text-slate-400">Saved automatically upon completion</span>
        </div>

        <textarea
          rows={4}
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          placeholder="Document symptoms, physical examination findings, differential diagnosis, and prescribed medication..."
          className="w-full text-sm text-slate-800 bg-slate-50/70 border border-slate-200 rounded-xl p-3.5 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:bg-white transition resize-y"
        />

        {/* Quick Prescription Chips */}
        <div className="flex items-center gap-1.5 flex-wrap pt-1">
          <span className="text-[11px] font-semibold text-slate-400 flex items-center gap-1 mr-1">
            <Sparkles className="w-3 h-3 text-emerald-600" />
            Quick Notes:
          </span>
          {[
            'Vitals stable & normal',
            'Paracetamol 500mg TDS x 3 days',
            'Advised hydration & bed rest',
            'Refer for blood panel / CBC',
            'Review in 1 week if unresolved',
          ].map((chip) => (
            <button
              key={chip}
              type="button"
              onClick={() => insertQuickNote(chip)}
              className="text-xs px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-emerald-50 hover:text-emerald-800 text-slate-700 border border-slate-200 transition"
            >
              + {chip}
            </button>
          ))}
        </div>
      </div>

      {/* Footer Complete CTA */}
      <div className="pt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-slate-100">
        <div className="text-xs text-slate-500">
          Completing consultation marks patient <strong className="text-slate-800">Completed</strong> and enables calling the next patient.
        </div>

        <button
          type="button"
          onClick={onComplete}
          disabled={isCompleting}
          className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-sm rounded-xl transition shadow-sm hover:shadow disabled:opacity-50 cursor-pointer"
        >
          {isCompleting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Completing...
            </>
          ) : (
            <>
              <CheckCircle className="w-4 h-4" />
              Complete Consultation
            </>
          )}
        </button>
      </div>
    </div>
  );
}
