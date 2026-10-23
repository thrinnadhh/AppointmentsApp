'use client';

import React, { useState } from 'react';
import { 
  Search, 
  Mail, 
  Copy, 
  Check, 
  ShieldCheck, 
  Stethoscope, 
  Users, 
  Building2, 
  Layers, 
  Phone, 
  RefreshCw 
} from 'lucide-react';
import { TeamMember, DoctorWithAssignments } from './AssignFrontDeskModal';

interface StaffRosterTableProps {
  members: TeamMember[];
  doctors: DoctorWithAssignments[];
  loading: boolean;
  ownerId?: string | null;
}

export function StaffRosterTable({
  members,
  doctors,
  loading,
  ownerId,
}: StaffRosterTableProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const getMemberRoleAndService = (member: TeamMember) => {
    // 1. Hospital Administrator
    if (
      member.role === 'admin' ||
      member.membershipRole === 'admin' ||
      member.membershipRole === 'owner' ||
      (ownerId && member.id === ownerId)
    ) {
      return {
        roleTitle: 'Hospital Administrator',
        roleType: 'admin' as const,
        badgeClass: 'bg-amber-100 text-amber-900 border-amber-300 font-bold',
        service: 'All Hospital Venues & Master Authority',
        idCard: null,
      };
    }

    // 2. Doctor / Specialist
    const matchedDoctor = doctors.find(
      (d) => (d.doctor_email && d.doctor_email.toLowerCase() === (member.email || '').toLowerCase()) ||
             (d as any)?.attributes?.user_id === member.id
    );
    if (matchedDoctor) {
      return {
        roleTitle: 'Doctor / Specialist',
        roleType: 'doctor' as const,
        badgeClass: 'bg-emerald-100 text-emerald-900 border-emerald-300 font-bold',
        service: `${matchedDoctor.department || 'General Medicine'} — Consultation Desk (Dr. ${matchedDoctor.name})`,
        idCard: null,
      };
    }

    // 3. Front Desk Manager
    const assignedDoctors: string[] = [];
    let fdIdCard: string | null = null;
    for (const doc of doctors) {
      const fdMatch = doc.front_desk_managers?.find(
        (fd) => fd.user_id === member.id || (fd.email && fd.email.toLowerCase() === (member.email || '').toLowerCase())
      );
      if (fdMatch) {
        assignedDoctors.push(`Dr. ${doc.name} (${doc.department})`);
        if (fdMatch.id_card_number && !fdIdCard) {
          fdIdCard = fdMatch.id_card_number;
        }
      }
    }
    if (assignedDoctors.length > 0) {
      return {
        roleTitle: 'Front Desk Manager',
        roleType: 'frontdesk' as const,
        badgeClass: 'bg-teal-100 text-teal-900 border-teal-300 font-bold',
        service: `Reception Desk for ${assignedDoctors.join(', ')}`,
        idCard: fdIdCard,
      };
    }

    // 4. General Staff
    return {
      roleTitle: member.role === 'merchant' ? 'Hospital Support Staff' : 'Customer Account',
      roleType: member.role as any,
      badgeClass: 'bg-slate-100 text-slate-700 border-slate-300 font-medium',
      service: 'General Hospital Operations & Support',
      idCard: null,
    };
  };

  const filteredMembers = members.filter((m) => {
    const meta = getMemberRoleAndService(m);
    const matchesSearch = 
      (m.full_name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (m.email || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (m.phone || '').includes(searchQuery) ||
      meta.roleTitle.toLowerCase().includes(searchQuery.toLowerCase()) ||
      meta.service.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (meta.idCard || '').toLowerCase().includes(searchQuery.toLowerCase());
    
    if (roleFilter === 'all') return matchesSearch;
    if (roleFilter === 'admin') return matchesSearch && (m.role === 'admin' || meta.roleType === 'admin');
    if (roleFilter === 'doctor') return matchesSearch && meta.roleType === 'doctor';
    if (roleFilter === 'frontdesk') return matchesSearch && meta.roleType === 'frontdesk';
    if (roleFilter === 'merchant') return matchesSearch && (m.role === 'merchant' || meta.roleType !== 'customer');
    return matchesSearch && m.role === roleFilter;
  });

  return (
    <div className="space-y-4 pt-4 border-t border-slate-200">
      <div>
        <h2 className="text-xl font-bold text-slate-900">
          Master Hospital Staff Accounts
        </h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Complete roster of all verified user accounts, roles, departments, and credentials linked to this hospital.
        </p>
      </div>

      {/* Search & Role Filters */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
          <input
            id="team-search"
            name="teamSearch"
            aria-label="Search by name, email, or phone"
            type="text"
            placeholder="Search by name, email, role, or department..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-slate-50/50"
          />
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          {[
            { id: 'all', label: 'All' },
            { id: 'admin', label: 'Admin' },
            { id: 'doctor', label: 'Doctor' },
            { id: 'frontdesk', label: 'Front Desk' },
            { id: 'merchant', label: 'Staff' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setRoleFilter(tab.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                roleFilter === tab.id
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'text-slate-600 hover:bg-slate-100 bg-slate-50 border border-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">
              <tr>
                <th className="px-6 py-3.5">Member / Name</th>
                <th className="px-6 py-3.5">Email & Credentials</th>
                <th className="px-6 py-3.5">Hospital Role</th>
                <th className="px-6 py-3.5">Assigned Service / Desk</th>
                <th className="px-6 py-3.5">Staff ID</th>
                <th className="px-6 py-3.5">Phone</th>
                <th className="px-6 py-3.5 text-right">Access Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-slate-500">
                    <div className="inline-flex items-center gap-2">
                      <RefreshCw className="w-5 h-5 animate-spin text-emerald-600" />
                      Loading team credentials...
                    </div>
                  </td>
                </tr>
              ) : filteredMembers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-slate-500">
                    No accounts match your search criteria.
                  </td>
                </tr>
              ) : (
                filteredMembers.map((member) => {
                  const meta = getMemberRoleAndService(member);

                  return (
                    <tr key={member.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full bg-emerald-100 text-emerald-800 font-bold flex items-center justify-center text-xs">
                            {(member.full_name || 'U').substring(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <p className="font-semibold text-slate-900">{member.full_name || 'Anonymous Staff'}</p>
                            <p className="text-[11px] text-slate-400 font-mono">ID: {member.id.substring(0, 8)}...</p>
                          </div>
                        </div>
                      </td>

                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <Mail className="w-4 h-4 text-slate-400" />
                          <span className="font-medium text-slate-800 font-mono text-xs">{member.email || 'Email unlinked'}</span>
                          {member.email && (
                            <button
                              onClick={() => copyToClipboard(member.email || '', member.id)}
                              className="text-slate-400 hover:text-emerald-600 p-1 cursor-pointer"
                              title="Copy email"
                            >
                              {copiedId === member.id ? (
                                <Check className="w-3.5 h-3.5 text-emerald-600" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                            </button>
                          )}
                        </div>
                      </td>

                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold border ${meta.badgeClass}`}>
                          {meta.roleType === 'admin' ? (
                            <ShieldCheck className="w-3.5 h-3.5 mr-1 text-amber-700" />
                          ) : meta.roleType === 'doctor' ? (
                            <Stethoscope className="w-3.5 h-3.5 mr-1 text-emerald-700" />
                          ) : meta.roleType === 'frontdesk' ? (
                            <Users className="w-3.5 h-3.5 mr-1 text-teal-700" />
                          ) : (
                            <Building2 className="w-3.5 h-3.5 mr-1 text-slate-600" />
                          )}
                          {meta.roleTitle}
                        </span>
                      </td>

                      <td className="px-6 py-4 whitespace-nowrap text-slate-700 text-xs font-medium">
                        <span className="inline-flex items-center gap-1.5">
                          <Layers className="w-3.5 h-3.5 text-slate-400" />
                          {meta.service}
                        </span>
                      </td>

                      <td className="px-6 py-4 whitespace-nowrap text-xs text-slate-600 font-mono">
                        {meta.idCard ? (
                          <span className="px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-800 font-bold">
                            {meta.idCard}
                          </span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>

                      <td className="px-6 py-4 whitespace-nowrap text-slate-600 text-xs">
                        <div className="flex items-center gap-1.5 font-mono">
                          <Phone className="w-3.5 h-3.5 text-slate-400" />
                          <span>{member.phone || 'N/A'}</span>
                        </div>
                      </td>

                      <td className="px-6 py-4 whitespace-nowrap text-right text-xs">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold">
                          Active Auth
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
