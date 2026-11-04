'use client';

import React from 'react';
import { UserCheck, Stethoscope, Users, ShieldCheck } from 'lucide-react';

interface TeamMetricsCardsProps {
  totalStaffCount: number;
  doctorCount: number;
  frontDeskCount: number;
  adminCount: number;
  resourceLabelPlural: string;
}

export function TeamMetricsCards({
  totalStaffCount,
  doctorCount,
  frontDeskCount,
  adminCount,
  resourceLabelPlural,
}: TeamMetricsCardsProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-4 gap-5">
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Staff Accounts</span>
          <UserCheck className="w-5 h-5 text-emerald-600" />
        </div>
        <p className="text-2xl font-bold text-slate-900 mt-2 font-mono">{totalStaffCount}</p>
        <p className="text-xs text-slate-500 mt-1">Verified Supabase profiles</p>
      </div>

      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{resourceLabelPlural}</span>
          <Stethoscope className="w-5 h-5 text-emerald-600" />
        </div>
        <p className="text-2xl font-bold text-slate-900 mt-2 font-mono">{doctorCount}</p>
        <p className="text-xs text-slate-500 mt-1">Active consultation desks</p>
      </div>

      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Front Desk Desks</span>
          <Users className="w-5 h-5 text-teal-600" />
        </div>
        <p className="text-2xl font-bold text-slate-900 mt-2 font-mono">{frontDeskCount}</p>
        <p className="text-xs text-slate-500 mt-1">Receptionists assigned</p>
      </div>

      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Hospital Admins</span>
          <ShieldCheck className="w-5 h-5 text-amber-600" />
        </div>
        <p className="text-2xl font-bold text-slate-900 mt-2 font-mono">{adminCount}</p>
        <p className="text-xs text-slate-500 mt-1">Master authority accounts</p>
      </div>
    </div>
  );
}
