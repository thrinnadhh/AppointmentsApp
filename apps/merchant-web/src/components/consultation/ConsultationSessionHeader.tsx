'use client';

import React from 'react';
import { 
  Stethoscope, 
  Building2, 
  UserCheck, 
  AlertTriangle, 
  CheckCircle2, 
  Coffee, 
  LogOut,
  ChevronDown
} from 'lucide-react';

export interface FrontDeskStaffMember {
  name: string;
  idCardNumber?: string;
  email?: string;
}

export interface DoctorOption {
  id: string;
  name: string;
  department?: string;
}

interface ConsultationSessionHeaderProps {
  doctorName: string;
  departmentName: string;
  hospitalName: string;
  frontDeskStaff: FrontDeskStaffMember[];
  sessionStatus: 'IN_SESSION' | 'ON_BREAK' | 'OFF_DUTY';
  onToggleStatus: (newStatus: 'IN_SESSION' | 'ON_BREAK' | 'OFF_DUTY') => void;
  onEmergencyDeparture: () => void;
  isHospitalAdmin: boolean;
  allDoctors?: DoctorOption[];
  selectedDoctorId?: string;
  onSelectDoctor?: (doctorId: string) => void;
}

export default function ConsultationSessionHeader({
  doctorName,
  departmentName,
  hospitalName,
  frontDeskStaff,
  sessionStatus,
  onToggleStatus,
  onEmergencyDeparture,
  isHospitalAdmin,
  allDoctors = [],
  selectedDoctorId,
  onSelectDoctor,
}: ConsultationSessionHeaderProps) {
  const getStatusBadge = () => {
    switch (sessionStatus) {
      case 'IN_SESSION':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200">
            <span className="w-2 h-2 rounded-full bg-emerald-600 animate-pulse" />
            Active Session
          </span>
        );
      case 'ON_BREAK':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-200">
            <Coffee className="w-3.5 h-3.5 text-amber-700" />
            Taking Break
          </span>
        );
      case 'OFF_DUTY':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-300">
            <LogOut className="w-3.5 h-3.5 text-slate-500" />
            Off Duty
          </span>
        );
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6 pb-6 border-b border-slate-100">
        <div className="flex items-start gap-4">
          <div className="w-14 h-14 rounded-2xl bg-emerald-50 border border-emerald-100 flex items-center justify-center shrink-0">
            <Stethoscope className="w-7 h-7 text-emerald-700" />
          </div>

          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
                {doctorName || 'Consultant Desk'}
              </h1>
              {getStatusBadge()}
              {departmentName && (
                <span className="px-3 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200">
                  {departmentName}
                </span>
              )}
            </div>

            <p className="text-sm text-slate-500 mt-1 flex items-center gap-2">
              <Building2 className="w-4 h-4 text-slate-400" />
              <span>{hospitalName || 'Apex General Hospital'}</span>
              <span className="text-slate-300">•</span>
              <span>Room 204 • Consultation Desk</span>
            </p>
          </div>
        </div>

        {/* Action Controls & Admin Doctor Switcher */}
        <div className="flex items-center gap-3 flex-wrap">
          {isHospitalAdmin && allDoctors.length > 1 && (
            <div className="relative">
              <select
                value={selectedDoctorId || ''}
                onChange={(e) => onSelectDoctor?.(e.target.value)}
                className="appearance-none pl-3 pr-8 py-2 bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-800 text-xs font-medium rounded-xl transition cursor-pointer focus:outline-none focus:ring-2 focus:ring-emerald-600"
              >
                {allDoctors.map((doc) => (
                  <option key={doc.id} value={doc.id}>
                    Consultant: {doc.name} {doc.department ? `(${doc.department})` : ''}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-3 pointer-events-none" />
            </div>
          )}

          {/* Session Mode Selector */}
          <div className="flex items-center bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs font-semibold">
            <button
              type="button"
              onClick={() => onToggleStatus('IN_SESSION')}
              className={`px-3 py-1.5 rounded-lg transition ${
                sessionStatus === 'IN_SESSION'
                  ? 'bg-white text-emerald-800 shadow-xs font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              In Session
            </button>
            <button
              type="button"
              onClick={() => onToggleStatus('ON_BREAK')}
              className={`px-3 py-1.5 rounded-lg transition ${
                sessionStatus === 'ON_BREAK'
                  ? 'bg-white text-amber-800 shadow-xs font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Break
            </button>
            <button
              type="button"
              onClick={() => onToggleStatus('OFF_DUTY')}
              className={`px-3 py-1.5 rounded-lg transition ${
                sessionStatus === 'OFF_DUTY'
                  ? 'bg-white text-slate-800 shadow-xs font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Off Duty
            </button>
          </div>

          {/* Emergency Departure Button */}
          <button
            type="button"
            onClick={onEmergencyDeparture}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-semibold rounded-xl transition"
          >
            <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
            Emergency Departure
          </button>
        </div>
      </div>

      {/* Assigned Front Desk Personnel */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2 text-slate-600">
          <UserCheck className="w-4 h-4 text-emerald-700 shrink-0" />
          <span className="font-semibold text-slate-800">Assigned Front Desk Staff:</span>
          {frontDeskStaff.length === 0 ? (
            <span className="text-slate-400 italic">No receptionists currently assigned</span>
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              {frontDeskStaff.map((fd, idx) => (
                <span
                  key={idx}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-900 border border-emerald-100"
                >
                  <span className="font-medium">{fd.name}</span>
                  {fd.idCardNumber && (
                    <span className="font-mono text-[11px] text-emerald-700 bg-white px-1.5 py-0.5 rounded border border-emerald-200">
                      ID: {fd.idCardNumber}
                    </span>
                  )}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="text-slate-500 flex items-center gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
          <span>Patient arrival codes verified at reception</span>
        </div>
      </div>
    </div>
  );
}
