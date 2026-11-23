'use client';

import React, { useEffect, useState, useCallback, Suspense, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { 
  Building2, 
  RefreshCw, 
  CheckCircle2, 
  Search, 
  Stethoscope, 
  ArrowRight,
  UserPlus
} from 'lucide-react';
import { fetchAllProfiles, supabase } from '@/lib/supabase';
import { useMerchantTenant } from '@/contexts/MerchantTenantContext';
import { TeamMetricsCards } from '@/components/team/TeamMetricsCards';
import { DoctorAssignmentCard } from '@/components/team/DoctorAssignmentCard';
import { AssignFrontDeskModal, TeamMember, DoctorWithAssignments } from '@/components/team/AssignFrontDeskModal';
import { StaffRosterTable } from '@/components/team/StaffRosterTable';
import { UnifiedAddStaffModal } from '@/components/team/UnifiedAddStaffModal';

function TeamManagementContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const doctorParam = searchParams.get('doctorId');
  const providerParam = searchParams.get('providerId');
  const handledDoctorParamRef = useRef<string | null>(null);

  const { activeProvider, isSuperAdmin, isHospitalAdmin, verticalConfig, switchActiveProvider, isLoading: tenantLoading } = useMerchantTenant();
  
  // State
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [doctors, setDoctors] = useState<DoctorWithAssignments[]>([]);
  const [loadingDoctors, setLoadingDoctors] = useState(true);
  const [selectedDoctorForAssignment, setSelectedDoctorForAssignment] = useState<DoctorWithAssignments | null>(null);
  const [isAddStaffOpen, setIsAddStaffOpen] = useState(false);
  const [doctorSearch, setDoctorSearch] = useState('');
  const [successBanner, setSuccessBanner] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Auto-sync activeProvider with providerParam if URL query param was provided
  useEffect(() => {
    if (providerParam && activeProvider?.id !== providerParam) {
      switchActiveProvider(providerParam);
    }
  }, [providerParam, activeProvider?.id, switchActiveProvider]);

  const copyToClipboard = useCallback((text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }, []);

  // Helper to find any existing ID card number already associated with a staff user
  const getExistingStaffIdCard = useCallback((userId: string): string | null => {
    if (!userId) return null;
    for (const doc of doctors) {
      const match = doc.front_desk_managers?.find((fd) => fd.user_id === userId);
      if (match?.id_card_number) {
        return match.id_card_number;
      }
    }
    return null;
  }, [doctors]);

  // Helper to identify if a roster member is a doctor
  const isDoctorUser = useCallback((member: TeamMember) => {
    if (member.membershipRole === 'doctor') return true;
    if (member.full_name?.toLowerCase().startsWith('dr.') || member.full_name?.toLowerCase().startsWith('dr ')) return true;
    return doctors.some(
      (doc) =>
        doc.id === member.id ||
        (doc as { attributes?: { user_id?: string } })?.attributes?.user_id === member.id ||
        (doc.doctor_email && doc.doctor_email.toLowerCase() === (member.email || '').toLowerCase())
    );
  }, [doctors]);

  const loadTeam = useCallback(async () => {
    const currentProviderId = providerParam || activeProvider?.id;
    if (!currentProviderId && !isSuperAdmin) {
      if (!tenantLoading) {
        setMembers([]);
        setLoading(false);
      }
      return;
    }

    setLoading(true);
    try {
      if (isSuperAdmin && !currentProviderId) {
        const data = await fetchAllProfiles();
        setMembers(data as TeamMember[]);
      } else if (currentProviderId) {
        const [membershipsRes, deptMembersRes] = await Promise.all([
          supabase
            .from('merchant_memberships' as never)
            .select('user_id, role, profile:profiles(id, full_name, email, phone, created_at)')
            .eq('provider_id', currentProviderId)
            .is('deleted_at', null),
          supabase
            .from('department_members' as never)
            .select('user_id, email, role, department_id, departments(name), profile:profiles(id, full_name, email, phone, created_at)')
            .eq('merchant_id', currentProviderId)
            .eq('status', 'active'),
        ]);

        const rosterMap = new Map<string, TeamMember>();

        if (membershipsRes.data) {
          membershipsRes.data.forEach((m: Record<string, unknown>) => {
            if (m.profile) {
              const prof = m.profile as Record<string, unknown>;
              rosterMap.set(prof.id as string, {
                ...prof,
                membershipRole: m.role as string,
              } as unknown as TeamMember);
            }
          });
        }

        if (deptMembersRes.data) {
          deptMembersRes.data.forEach((dm: Record<string, unknown>) => {
            const prof = dm.profile as Record<string, unknown> | null;
            const profileId = (prof?.id as string) || (dm.user_id as string);
            const existing = profileId ? rosterMap.get(profileId) : null;
            const deptObj = dm.departments as Record<string, unknown> | null;
            const deptName = (deptObj?.name as string) || null;
            if (existing) {
              if (dm.role === 'consultant' || dm.role === 'doctor') {
                existing.membershipRole = 'doctor';
              }
              const existingRecord = existing as unknown as Record<string, unknown>;
              existingRecord.department = deptName || existingRecord.department;
              existingRecord.department_id = (dm.department_id as string) || existingRecord.department_id;
            } else if (prof) {
              rosterMap.set(prof.id as string, {
                ...prof,
                membershipRole: (dm.role === 'consultant' || dm.role === 'doctor') ? 'doctor' : (dm.role as string),
                department: deptName,
                department_id: dm.department_id,
              } as unknown as TeamMember);
            } else if (dm.email) {
              const emailStr = dm.email as string;
              const syntheticId = (dm.user_id as string) || `dept-member-${emailStr}`;
              rosterMap.set(syntheticId, {
                id: syntheticId,
                email: emailStr,
                full_name: emailStr.split('@')[0],
                role: 'merchant',
                membershipRole: (dm.role === 'consultant' || dm.role === 'doctor') ? 'doctor' : (dm.role as string),
                phone: null,
                created_at: new Date().toISOString(),
                department: deptName,
                department_id: dm.department_id,
              } as unknown as TeamMember);
            }
          });
        }

        setMembers(Array.from(rosterMap.values()));
      } else {
        setMembers([]);
      }
    } catch (err) {
      console.error('Failed to load team:', err);
      setMembers([]);
    } finally {
      setLoading(false);
    }
  }, [providerParam, activeProvider?.id, isSuperAdmin, tenantLoading]);

  const loadDoctorAssignments = useCallback(async () => {
    const currentProviderId = providerParam || activeProvider?.id;
    if (!currentProviderId) {
      if (!tenantLoading) {
        setDoctors([]);
        setLoadingDoctors(false);
      }
      return;
    }
    setLoadingDoctors(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const headers: Record<string, string> = {};
      if (session?.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`;
      }
      const res = await fetch(`/api/admin/doctor-assignments?providerId=${currentProviderId}`, { headers });
      const json = await res.json();
      if (res.ok && json.success) {
        setDoctors(json.doctors || []);
      } else {
        setDoctors([]);
      }
    } catch (err) {
      console.error('Failed to load doctor assignments:', err);
      setDoctors([]);
    } finally {
      setLoadingDoctors(false);
    }
  }, [providerParam, activeProvider?.id, tenantLoading]);

  useEffect(() => {
    loadTeam();
    loadDoctorAssignments();
  }, [loadTeam, loadDoctorAssignments]);

  // Handle URL query parameter ?doctorId=...
  useEffect(() => {
    if (doctorParam && doctors.length > 0 && !selectedDoctorForAssignment && handledDoctorParamRef.current !== doctorParam) {
      const match = doctors.find((d) => d.id === doctorParam);
      if (match) {
        setSelectedDoctorForAssignment(match);
      }
    }
  }, [doctorParam, doctors, selectedDoctorForAssignment]);

  const handleCloseAssignModal = useCallback(() => {
    handledDoctorParamRef.current = doctorParam;
    setSelectedDoctorForAssignment(null);
    if (doctorParam) {
      const params = new URLSearchParams(searchParams.toString());
      params.delete('doctorId');
      const newQuery = params.toString();
      router.replace(newQuery ? `${pathname}?${newQuery}` : pathname);
    }
  }, [doctorParam, pathname, router, searchParams]);

  const handleOpenAssignModal = useCallback((d: DoctorWithAssignments) => {
    setSelectedDoctorForAssignment(d);
  }, []);

  const handleUnassignFrontDesk = useCallback(async (
    doctorId: string, 
    doctorName: string, 
    userId: string, 
    managerName: string
  ) => {
    if (!activeProvider?.id) return;
    if (!window.confirm(`Unassign "${managerName}" from ${doctorName}?`)) {
      return;
    }

    try {
      const res = await fetch(
        `/api/admin/doctor-assignments?providerId=${activeProvider.id}&doctorId=${doctorId}&userId=${userId}`,
        { method: 'DELETE' }
      );
      const json = await res.json();
      if (!res.ok || json.error) {
        throw new Error(json.error || 'Failed to unassign front desk manager');
      }

      setSuccessBanner(`Unassigned "${managerName}" from ${doctorName}.`);
      await loadDoctorAssignments();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error unassigning front desk manager';
      setSuccessBanner(`Error: ${msg}`);
    }
  }, [activeProvider?.id, loadDoctorAssignments]);

  // Merge members with doctors or front desk staff
  const allRosterMembers = useMemo(() => {
    const list = [...members];
    const existingIds = new Set(list.map((m) => m.id));
    const existingEmails = new Set(list.map((m) => (m.email || '').toLowerCase()).filter(Boolean));

    doctors.forEach((doc) => {
      const email = doc.doctor_email?.toLowerCase();
      const docRecord = doc as unknown as Record<string, unknown>;
      const docAttributes = docRecord?.attributes as Record<string, unknown> | undefined;
      const attrUserId = docAttributes?.user_id as string | undefined;

      // If already in list, ensure marked as doctor with department
      const existingMember = list.find(
        (m) => (attrUserId && m.id === attrUserId) || (email && (m.email || '').toLowerCase() === email)
      );

      if (existingMember) {
        existingMember.membershipRole = 'doctor';
        const existingRecord = existingMember as unknown as Record<string, unknown>;
        if (!existingRecord.department && doc.department) {
          existingRecord.department = doc.department;
        }
        if (!existingRecord.department_id && docRecord.department_id) {
          existingRecord.department_id = docRecord.department_id;
        }
        if (!existingMember.full_name?.toLowerCase().startsWith('dr.') && doc.name) {
          existingMember.full_name = `Dr. ${doc.name}`;
        }
      } else if (attrUserId && !existingIds.has(attrUserId)) {
        list.push({
          id: attrUserId,
          email: doc.doctor_email || null,
          full_name: `Dr. ${doc.name}`,
          role: 'merchant',
          membershipRole: 'doctor',
          phone: null,
          created_at: new Date().toISOString(),
          department: doc.department || null,
          department_id: (docRecord.department_id as string) || null,
        } as unknown as TeamMember);
        existingIds.add(attrUserId);
        if (email) existingEmails.add(email);
      } else if (email && !existingEmails.has(email)) {
        list.push({
          id: `doc-${doc.id}`,
          email: doc.doctor_email || null,
          full_name: `Dr. ${doc.name}`,
          role: 'merchant',
          membershipRole: 'doctor',
          phone: null,
          created_at: new Date().toISOString(),
          department: doc.department || null,
          department_id: (docRecord.department_id as string) || null,
        } as unknown as TeamMember);
        existingEmails.add(email);
      } else if (!existingIds.has(`doc-${doc.id}`)) {
        list.push({
          id: `doc-${doc.id}`,
          email: null,
          full_name: `Dr. ${doc.name}`,
          role: 'merchant',
          membershipRole: 'doctor',
          phone: null,
          created_at: new Date().toISOString(),
          department: doc.department || null,
          department_id: (docRecord.department_id as string) || null,
        } as unknown as TeamMember);
        existingIds.add(`doc-${doc.id}`);
      }

      doc.front_desk_managers?.forEach((fd) => {
        const fdEmail = fd.email?.toLowerCase();
        if (fd.user_id && !existingIds.has(fd.user_id)) {
          list.push({
            id: fd.user_id,
            email: fd.email || null,
            full_name: fd.full_name || 'Front Desk Staff',
            role: 'merchant',
            membershipRole: 'staff',
            phone: fd.phone || null,
            created_at: fd.assigned_at || new Date().toISOString(),
          });
          existingIds.add(fd.user_id);
          if (fdEmail) existingEmails.add(fdEmail);
        } else if (fdEmail && !existingEmails.has(fdEmail)) {
          list.push({
            id: `fd-${fd.assignment_id || Date.now()}`,
            email: fd.email || null,
            full_name: fd.full_name || 'Front Desk Staff',
            role: 'merchant',
            membershipRole: 'staff',
            phone: fd.phone || null,
            created_at: fd.assigned_at || new Date().toISOString(),
          });
          existingEmails.add(fdEmail);
        }
      });
    });

    return list;
  }, [members, doctors]);

  const filteredDoctors = useMemo(() => {
    return doctors.filter((doc) => {
      return (
        doc.name.toLowerCase().includes(doctorSearch.toLowerCase()) ||
        (doc.department || '').toLowerCase().includes(doctorSearch.toLowerCase()) ||
        (doc.doctor_email || '').toLowerCase().includes(doctorSearch.toLowerCase()) ||
        (doc.front_desk_managers || []).some((fd) => 
          (fd.full_name || '').toLowerCase().includes(doctorSearch.toLowerCase()) ||
          (fd.email || '').toLowerCase().includes(doctorSearch.toLowerCase()) ||
          (fd.id_card_number || '').toLowerCase().includes(doctorSearch.toLowerCase())
        )
      );
    });
  }, [doctors, doctorSearch]);

  const adminCount = useMemo(() => {
    return allRosterMembers.filter((m) => m.role === 'admin' || (activeProvider?.owner_id && m.id === activeProvider.owner_id)).length;
  }, [allRosterMembers, activeProvider?.owner_id]);

  const totalFrontDeskCount = useMemo(() => {
    return doctors.reduce((sum, d) => sum + (d.front_desk_managers?.length || 0), 0);
  }, [doctors]);

  if (tenantLoading && !activeProvider && !providerParam) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-16 text-center text-slate-500 bg-white rounded-2xl border border-slate-200 mt-8">
        <RefreshCw className="w-6 h-6 animate-spin mx-auto text-emerald-600 mb-2" />
        Loading team and desk credentials...
      </div>
    );
  }

  if (!activeProvider && !providerParam && !isSuperAdmin) {
    return (
      <div className="max-w-xl mx-auto my-16 p-8 bg-white border border-slate-200 rounded-2xl text-center shadow-sm">
        <div className="w-16 h-16 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <Building2 className="w-8 h-8" />
        </div>
        <h2 className="text-2xl font-bold text-slate-900 mb-2">Register Your Shop First</h2>
        <p className="text-slate-600 mb-6">
          To manage team members and staff credentials, please register or sign in to your shop first.
        </p>
        <Link
          href="/login?mode=register"
          className="inline-flex items-center gap-2 px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl transition shadow-sm"
        >
          Register Your Shop
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-slate-200 pb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200">
              Access Control & Auth
            </span>
            <span className="text-xs text-slate-500">• Hospital Admin Master Console</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
            Team & Merchant Credentials
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Manage authorized doctors and assign up to 4 front desk reception managers per doctor with direct email, password, and ID badge authentication.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {isHospitalAdmin && (
            <button
              onClick={() => setIsAddStaffOpen(true)}
              className="inline-flex items-center px-4 py-2 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 active:scale-[0.97] text-white text-sm font-semibold rounded-xl transition-all duration-75 select-none shadow-sm cursor-pointer gap-2"
            >
              <UserPlus className="w-4 h-4" />
              <span>+ Provision Staff</span>
            </button>
          )}

          <button
            onClick={() => {
              loadTeam();
              loadDoctorAssignments();
            }}
            className="inline-flex items-center px-3.5 py-2 border border-slate-300 rounded-xl text-sm font-medium text-slate-700 bg-white hover:bg-slate-50 active:bg-slate-100 active:scale-[0.97] transition-all duration-75 select-none shadow-xs cursor-pointer"
            title="Refresh All"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${(loading || loadingDoctors) ? 'animate-spin text-emerald-600' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Success Notification */}
      {successBanner && (
        <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4 flex items-center justify-between text-sm text-emerald-800 shadow-xs">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
            <p className="font-medium">{successBanner}</p>
          </div>
          <button 
            onClick={() => setSuccessBanner(null)}
            className="text-xs font-bold text-emerald-700 hover:text-emerald-900 px-2 py-1 rounded cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Metric KPI Cards */}
      <TeamMetricsCards
        totalStaffCount={allRosterMembers.length}
        doctorCount={doctors.length}
        frontDeskCount={totalFrontDeskCount}
        adminCount={adminCount}
        resourceLabelPlural={verticalConfig.resourceLabelPlural}
      />

      {/* SECTION 1: Doctor-Centric Cards & Front Desk Manager Assignments */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900 text-white p-5 rounded-2xl shadow-sm">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                Desk Routing
              </span>
              <h2 className="text-lg font-bold text-white">
                {verticalConfig.resourceLabelSingular} Desks & Front Desk Manager Assignments
              </h2>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Assign 1 to 4 Front Desk Managers per {verticalConfig.resourceLabelSingular.toLowerCase()} with unique login credentials and staff ID badges.
            </p>
          </div>

          <div className="relative w-full sm:w-72">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              placeholder={`Search ${verticalConfig.resourceLabelPlural.toLowerCase()} or staff...`}
              value={doctorSearch}
              onChange={(e) => setDoctorSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
        </div>

        {loadingDoctors ? (
          <div className="py-16 text-center text-slate-500 bg-white rounded-2xl border border-slate-200">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto text-emerald-600 mb-2" />
            Loading {verticalConfig.resourceLabelPlural.toLowerCase()} and desk assignments...
          </div>
        ) : filteredDoctors.length === 0 ? (
          <div className="py-12 text-center bg-white rounded-2xl border border-slate-200 p-8 space-y-3">
            <Stethoscope className="w-10 h-10 text-slate-300 mx-auto" />
            <p className="text-base font-bold text-slate-800">
              No {verticalConfig.resourceLabelPlural.toLowerCase()} found
            </p>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              Add your doctors and consultation fees in the Resources & Departments screen first, then return here to assign their front desk managers.
            </p>
            {isHospitalAdmin ? (
              <Link
                href="/resources"
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg shadow-sm transition"
              >
                Go to Resources & Departments
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            ) : (
              <span className="text-xs text-slate-400 italic">
                Only the Hospital Administrator can add doctors.
              </span>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {filteredDoctors.map((doc: DoctorWithAssignments) => (
              <DoctorAssignmentCard
                key={doc.id}
                doctor={doc}
                isHospitalAdmin={isHospitalAdmin}
                copiedId={copiedId}
                onCopy={copyToClipboard}
                onOpenAssignModal={handleOpenAssignModal}
                onUnassign={handleUnassignFrontDesk}
              />
            ))}
          </div>
        )}
      </div>

      {/* SECTION 2: Master Hospital Staff Directory */}
      <StaffRosterTable
        members={allRosterMembers}
        doctors={doctors}
        loading={loading}
        ownerId={activeProvider?.owner_id}
      />

      {/* MODAL 1: Assign Front Desk Manager to Specific Doctor */}
      {selectedDoctorForAssignment && (
        <AssignFrontDeskModal
          doctor={selectedDoctorForAssignment}
          providerId={activeProvider?.id || providerParam || undefined}
          allRosterMembers={allRosterMembers}
          onClose={handleCloseAssignModal}
          onSuccess={(msg) => {
            setSuccessBanner(msg);
            loadDoctorAssignments();
            loadTeam();
          }}
          getExistingStaffIdCard={getExistingStaffIdCard}
          isDoctorUser={isDoctorUser}
        />
      )}

      {/* MODAL 2: Unified Staff Provisioning */}
      {isAddStaffOpen && (
        <UnifiedAddStaffModal
          isOpen={isAddStaffOpen}
          onClose={() => setIsAddStaffOpen(false)}
          onSuccess={(msg) => {
            setSuccessBanner(msg);
            loadDoctorAssignments();
            loadTeam();
          }}
          providerId={activeProvider?.id || providerParam || undefined}
          doctors={doctors}
          hasHospitalAdmin={adminCount > 0 || isHospitalAdmin || Boolean(activeProvider?.owner_id)}
        />
      )}
    </div>
  );
}

export default function TeamManagementPage() {
  return (
    <Suspense fallback={
      <div className="max-w-7xl mx-auto px-4 py-16 text-center text-slate-500">
        Loading team and desk credentials...
      </div>
    }>
      <TeamManagementContent />
    </Suspense>
  );
}
