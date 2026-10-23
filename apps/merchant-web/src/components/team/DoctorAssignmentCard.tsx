'use client';

import React from 'react';
import Link from 'next/link';
import {
  Stethoscope,
  Layers,
  KeyRound,
  Copy,
  Check,
  Users,
  UserPlus,
  UserMinus,
  Mail,
} from 'lucide-react';

export interface FrontDeskManager {
  assignment_id: string;
  user_id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  id_card_number?: string | null;
  role: string;
  assigned_at?: string;
}

export interface DoctorWithAssignments {
  id: string;
  name: string;
  type: string;
  department: string;
  deposit_amount: number;
  duration_minutes: number;
  capacity: number;
  doctor_email: string | null;
  has_login: boolean;
  is_active: boolean;
  front_desk_managers: FrontDeskManager[];
}

interface DoctorAssignmentCardProps {
  doctor: DoctorWithAssignments;
  isHospitalAdmin: boolean;
  copiedId: string | null;
  onCopy: (text: string, id: string) => void;
  onOpenAssignModal: (doctor: DoctorWithAssignments) => void;
  onUnassign: (doctorId: string, doctorName: string, userId: string, managerName: string) => void;
}

export function DoctorAssignmentCard({
  doctor,
  isHospitalAdmin,
  copiedId,
  onCopy,
  onOpenAssignModal,
  onUnassign,
}: DoctorAssignmentCardProps) {
  const assignedCount = doctor.front_desk_managers?.length || 0;
  const isFull = assignedCount >= 4;

  return (
    <div
      id={`doctor-card-${doctor.id}`}
      className="bg-white rounded-2xl border border-slate-200 hover:border-emerald-300 transition-all p-5 shadow-xs flex flex-col justify-between space-y-5"
    >
      <div className="space-y-4">
        {/* Doctor Header */}
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200 inline-flex items-center gap-1">
                <Layers className="w-3 h-3 text-emerald-600" />
                {doctor.department || 'General'}
              </span>
              <span
                className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                  doctor.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'
                }`}
              >
                {doctor.is_active ? 'Active Desk' : 'On Break'}
              </span>
            </div>
            <h3 className="text-lg font-bold text-slate-900 mt-1.5 flex items-center gap-1.5">
              <Stethoscope className="w-4 h-4 text-emerald-700 shrink-0" />
              <span>{doctor.name}</span>
            </h3>
          </div>

          <div className="text-right">
            <span className="text-[10px] uppercase font-bold text-slate-400">Consultation</span>
            <p className="text-base font-bold text-slate-900 font-mono">
              ₹{Number(doctor.deposit_amount || 500).toFixed(0)}
            </p>
          </div>
        </div>

        {/* Doctor OPD Login Credentials Bar */}
        <div className="bg-slate-50 rounded-xl p-3 border border-slate-200/80 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 truncate">
            <KeyRound className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span className="text-slate-500 font-medium">Doctor OPD Login:</span>
            {doctor.doctor_email ? (
              <span
                className="font-mono font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md truncate max-w-[200px]"
                title={doctor.doctor_email}
              >
                {doctor.doctor_email}
              </span>
            ) : (
              <span className="text-slate-400 italic">No direct login set</span>
            )}
          </div>

          {doctor.doctor_email && (
            <button
              onClick={() => onCopy(doctor.doctor_email || '', `doc-${doctor.id}`)}
              className="text-slate-400 hover:text-emerald-700 p-1 shrink-0 cursor-pointer"
              title="Copy login email"
            >
              {copiedId === `doc-${doctor.id}` ? (
                <Check className="w-3.5 h-3.5 text-emerald-600" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
            </button>
          )}
        </div>

        {/* Assigned Front Desk Managers Subsection */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-slate-500" />
              <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                Assigned Front Desk Managers
              </h4>
              <span
                className={`px-2 py-0.5 rounded-full text-[11px] font-bold font-mono ${
                  assignedCount === 0
                    ? 'bg-amber-100 text-amber-800'
                    : isFull
                    ? 'bg-slate-200 text-slate-700'
                    : 'bg-emerald-100 text-emerald-800'
                }`}
              >
                {assignedCount} / 4 Assigned
              </span>
            </div>

            <button
              onClick={() => onOpenAssignModal(doctor)}
              disabled={isFull}
              className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                isFull
                  ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                  : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 shadow-2xs'
              }`}
              title={isFull ? 'Maximum 4 Front Desk Managers reached' : 'Assign receptionist'}
            >
              <UserPlus className="w-3 h-3" />
              <span>+ Add Front Desk Manager</span>
            </button>
          </div>

          {/* Front Desk Manager Cards */}
          {assignedCount === 0 ? (
            <div className="border border-dashed border-slate-200 rounded-xl p-4 text-center bg-slate-50/50">
              <p className="text-xs text-slate-500 font-medium">
                No front desk manager assigned to this doctor yet.
              </p>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Click &quot;+ Add Front Desk Manager&quot; to provision a receptionist login (1-4 receptionists allowed).
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {doctor.front_desk_managers.map((fd, index) => (
                <div
                  key={fd.user_id || index}
                  className="bg-white border border-slate-200 rounded-xl p-3 flex items-center justify-between gap-3 hover:border-slate-300 transition-colors shadow-2xs"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-800 font-bold flex items-center justify-center text-xs shrink-0">
                      {(fd.full_name || 'FD').substring(0, 2).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-xs font-bold text-slate-900 truncate">
                          {fd.full_name || 'Front Desk Staff'}
                        </p>
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-100 text-slate-600 font-semibold uppercase">
                          Desk {index + 1}
                        </span>
                        {fd.id_card_number && (
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-50 text-emerald-700 font-bold border border-emerald-200 font-mono">
                            ID: {fd.id_card_number}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-slate-500 font-mono truncate">
                        <Mail className="w-3 h-3 text-slate-400 shrink-0" />
                        <span className="truncate">{fd.email || 'Email unlinked'}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {fd.email && (
                      <button
                        onClick={() => onCopy(fd.email || '', `fd-${doctor.id}-${fd.user_id}`)}
                        className="p-1 rounded text-slate-400 hover:text-emerald-700 hover:bg-slate-50 cursor-pointer"
                        title="Copy receptionist email"
                      >
                        {copiedId === `fd-${doctor.id}-${fd.user_id}` ? (
                          <Check className="w-3.5 h-3.5 text-emerald-600" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>
                    )}
                    <button
                      onClick={() => onUnassign(doctor.id, doctor.name, fd.user_id, fd.full_name)}
                      className="p-1 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                      title={`Unassign ${fd.full_name} from ${doctor.name}`}
                    >
                      <UserMinus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400">
        <span className="font-mono">ID: {doctor.id.substring(0, 8)}</span>
        {isHospitalAdmin && (
          <Link
            href="/resources"
            className="text-emerald-700 hover:text-emerald-800 font-semibold hover:underline"
          >
            Edit Doctor in Resources →
          </Link>
        )}
      </div>
    </div>
  );
}
