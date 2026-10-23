'use client';

import React from 'react';
import { 
  Building2, 
  Stethoscope, 
  Tv, 
  Users, 
  Clock, 
  AlertCircle, 
  CheckCircle2, 
  ChevronRight,
  ShieldCheck,
  UserCheck
} from 'lucide-react';

export interface AssignedDoctor {
  id: string;
  name: string;
  department?: string | null;
  room?: string;
  is_active?: boolean;
}

interface FrontDeskHeaderProps {
  userEmail?: string;
  role?: string;
  hospitalName?: string;
  assignedDoctors: AssignedDoctor[];
  selectedDoctorId: string;
  onSelectDoctor: (doctorId: string) => void;
  stats: {
    checkedIn: number;
    standby: number;
    expected: number;
    completed: number;
  };
  onOpenDisplayModal: () => void;
}

export default function FrontDeskHeader({
  userEmail,
  role = 'front_desk',
  hospitalName = 'Hospital Reception Desk',
  assignedDoctors,
  selectedDoctorId,
  onSelectDoctor,
  stats,
  onOpenDisplayModal,
}: FrontDeskHeaderProps) {
  const isFrontDesk = role === 'front_desk';
  const roleBadgeLabel = isFrontDesk ? 'Front Desk Staff' : role === 'admin' ? 'Hospital Admin' : 'Staff';

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-xs space-y-5">
      {/* Top row: Hospital & Staff info + TV Display CTA */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-100">
        <div className="flex items-start sm:items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-emerald-600 text-white flex items-center justify-center font-bold text-lg shadow-2xs shrink-0">
            <Building2 className="w-6 h-6 text-white" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
                {hospitalName}
              </h1>
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-700" />
                {roleBadgeLabel}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-2">
              <span>{userEmail || 'frontdesk@hospital.local'}</span>
              <span>•</span>
              <span>Active Reception Session</span>
            </p>
          </div>
        </div>

        {/* Action Button: Waiting Lounge TV Kiosk Display */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onOpenDisplayModal}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition shadow-xs cursor-pointer"
          >
            <Tv className="w-4 h-4 text-emerald-400" />
            <span>Waiting Lounge TV View</span>
          </button>
        </div>
      </div>

      {/* Assigned Doctors Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Stethoscope className="w-4 h-4 text-emerald-600" />
            <span className="text-xs font-bold uppercase tracking-wider text-slate-600">
              {isFrontDesk ? 'Your Assigned Consultants' : 'Consultant Queues'}
            </span>
            <span className="px-2 py-0.2 rounded-full text-[10px] font-mono font-bold bg-slate-100 text-slate-700 border border-slate-200">
              {assignedDoctors.length}
            </span>
          </div>
          <p className="text-xs text-slate-500">
            {isFrontDesk 
              ? 'You are authorized to manage arrivals and queues for these consultants only.' 
              : 'Select a consultant to filter queues or view all.'}
          </p>
        </div>

        {/* Doctor Filter Selector */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-slate-500 shrink-0">Doctor Filter:</span>
          <select
            value={selectedDoctorId}
            onChange={(e) => onSelectDoctor(e.target.value)}
            className="text-xs font-bold px-3 py-2 rounded-xl border border-slate-300 bg-slate-50 text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 shadow-2xs cursor-pointer min-w-[200px]"
          >
            <option value="">All Assigned Doctors ({assignedDoctors.length})</option>
            {assignedDoctors.map((doc) => (
              <option key={doc.id} value={doc.id}>
                {doc.name} {doc.department ? `(${doc.department})` : ''}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Doctor Badges Ribbon */}
      {assignedDoctors.length > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto pb-1 pt-1 scrollbar-thin">
          {assignedDoctors.map((doc) => {
            const isSelected = selectedDoctorId === doc.id;
            return (
              <button
                key={doc.id}
                type="button"
                onClick={() => onSelectDoctor(isSelected ? '' : doc.id)}
                className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold border transition shrink-0 cursor-pointer ${
                  isSelected
                    ? 'bg-emerald-600 text-white border-emerald-600 shadow-2xs'
                    : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100 hover:border-slate-300'
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${doc.is_active !== false ? 'bg-emerald-400' : 'bg-slate-400'}`} />
                <span className="font-bold">{doc.name}</span>
                {doc.department && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-md ${isSelected ? 'bg-emerald-700 text-emerald-100' : 'bg-slate-200 text-slate-600'}`}>
                    {doc.department}
                  </span>
                )}
                {doc.room && (
                  <span className="text-[10px] font-mono text-slate-400">
                    {doc.room}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Quick Metrics Bar: 4 Cards per SPEC */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 pt-2">
        {/* Waiting Queue Count */}
        <div className="bg-emerald-50/70 border border-emerald-200/90 rounded-xl p-3.5 flex items-center justify-between">
          <div>
            <p className="text-[11px] font-bold text-emerald-900 uppercase tracking-wider">Waiting Queue</p>
            <p className="text-xl sm:text-2xl font-black text-emerald-950 font-mono tabular-nums mt-0.5">
              {stats.checkedIn}
            </p>
          </div>
          <div className="p-2.5 rounded-xl bg-emerald-200/60 text-emerald-800">
            <UserCheck className="w-5 h-5" />
          </div>
        </div>

        {/* Standby Queue Count */}
        <div className="bg-amber-50/70 border border-amber-200/90 rounded-xl p-3.5 flex items-center justify-between">
          <div>
            <p className="text-[11px] font-bold text-amber-900 uppercase tracking-wider">Standby Queue</p>
            <p className="text-xl sm:text-2xl font-black text-amber-950 font-mono tabular-nums mt-0.5">
              {stats.standby}
            </p>
          </div>
          <div className="p-2.5 rounded-xl bg-amber-200/60 text-amber-800">
            <Clock className="w-5 h-5" />
          </div>
        </div>

        {/* Expected Today Count */}
        <div className="bg-sky-50/70 border border-sky-200/90 rounded-xl p-3.5 flex items-center justify-between">
          <div>
            <p className="text-[11px] font-bold text-sky-900 uppercase tracking-wider">Expected Today</p>
            <p className="text-xl sm:text-2xl font-black text-sky-950 font-mono tabular-nums mt-0.5">
              {stats.expected}
            </p>
          </div>
          <div className="p-2.5 rounded-xl bg-sky-200/60 text-sky-800">
            <Users className="w-5 h-5" />
          </div>
        </div>

        {/* Completed Count */}
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 flex items-center justify-between">
          <div>
            <p className="text-[11px] font-bold text-slate-600 uppercase tracking-wider">Completed</p>
            <p className="text-xl sm:text-2xl font-black text-slate-900 font-mono tabular-nums mt-0.5">
              {stats.completed}
            </p>
          </div>
          <div className="p-2.5 rounded-xl bg-slate-200/70 text-slate-700">
            <CheckCircle2 className="w-5 h-5" />
          </div>
        </div>
      </div>
    </div>
  );
}
