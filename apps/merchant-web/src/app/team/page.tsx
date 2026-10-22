'use client';

import React, { useEffect, useState, useCallback, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { 
  UserCheck, 
  UserPlus, 
  ShieldCheck, 
  Mail, 
  KeyRound, 
  Phone, 
  CheckCircle2, 
  AlertCircle, 
  Search,
  Building2,
  RefreshCw,
  Eye,
  EyeOff,
  Copy,
  Check,
  Stethoscope,
  Layers,
  Users,
  UserMinus,
  Sparkles,
  ArrowRight,
  CreditCard
} from 'lucide-react';
import { fetchAllProfiles, supabase } from '@/lib/supabase';
import { useMerchantTenant } from '@/contexts/MerchantTenantContext';

interface TeamMember {
  id: string;
  email: string | null;
  full_name: string | null;
  role: 'admin' | 'merchant' | 'customer';
  membershipRole?: string;
  phone: string | null;
  created_at: string;
  no_show_count?: number;
}

interface FrontDeskManager {
  assignment_id: string;
  user_id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  id_card_number?: string | null;
  role: string;
  assigned_at?: string;
}

interface DoctorWithAssignments {
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

function TeamManagementContent() {
  const searchParams = useSearchParams();
  const doctorParam = searchParams.get('doctorId');

  const { activeProvider, isSuperAdmin, isHospitalAdmin, verticalConfig } = useMerchantTenant();
  
  // Staff Directory state
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  
  // Doctor-Centric Cards state
  const [doctors, setDoctors] = useState<DoctorWithAssignments[]>([]);
  const [loadingDoctors, setLoadingDoctors] = useState(true);
  const [selectedDoctorForAssignment, setSelectedDoctorForAssignment] = useState<DoctorWithAssignments | null>(null);
  const [assignmentModalMode, setAssignmentModalMode] = useState<'new' | 'existing'>('new');
  const [newFdName, setNewFdName] = useState('');
  const [newFdEmail, setNewFdEmail] = useState('');
  const [newFdPassword, setNewFdPassword] = useState('');
  const [newFdPhone, setNewFdPhone] = useState('');
  const [newFdIdCard, setNewFdIdCard] = useState('');
  const [showFdPassword, setShowFdPassword] = useState(false);
  const [assignExistingUserId, setAssignExistingUserId] = useState('');
  const [isAssigning, setIsAssigning] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [doctorSearch, setDoctorSearch] = useState('');

  const [successBanner, setSuccessBanner] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Helper to sanitize phone input: strip letters, allow digits and leading +
  const sanitizePhoneInput = (val: string) => {
    let cleaned = val.replace(/[^0-9+\s-]/g, '');
    if (cleaned.includes('+')) {
      const startsWithPlus = cleaned.startsWith('+');
      cleaned = (startsWithPlus ? '+' : '') + cleaned.replace(/\+/g, '');
    }
    return cleaned;
  };

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

  // Helper to identify if a roster member is a doctor (should not appear in staff assignment list)
  const isDoctorUser = useCallback((member: TeamMember) => {
    if (member.membershipRole === 'doctor') return true;
    if (member.full_name?.toLowerCase().startsWith('dr.') || member.full_name?.toLowerCase().startsWith('dr ')) return true;
    return doctors.some(
      (doc) =>
        doc.id === member.id ||
        (doc as any)?.attributes?.user_id === member.id ||
        (doc.doctor_email && doc.doctor_email.toLowerCase() === (member.email || '').toLowerCase())
    );
  }, [doctors]);

  const loadTeam = useCallback(async () => {
    setLoading(true);
    try {
      if (isSuperAdmin) {
        const data = await fetchAllProfiles();
        setMembers(data as TeamMember[]);
      } else if (activeProvider?.id) {
        const { data, error } = await supabase
          .from('merchant_memberships' as any)
          .select('user_id, role, profile:profiles(*)')
          .eq('provider_id', activeProvider.id);
        if (!error && data) {
          const mapped = data
            .map((m: any) => (m.profile ? { ...m.profile, membershipRole: m.role } : null))
            .filter(Boolean);
          setMembers(mapped as TeamMember[]);
        } else {
          setMembers([]);
        }
      } else {
        setMembers([]);
      }
    } catch (err) {
      console.error('Failed to load team:', err);
      setMembers([]);
    } finally {
      setLoading(false);
    }
  }, [activeProvider?.id, isSuperAdmin]);

  const loadDoctorAssignments = useCallback(async () => {
    if (!activeProvider?.id) {
      setDoctors([]);
      setLoadingDoctors(false);
      return;
    }
    setLoadingDoctors(true);
    try {
      const res = await fetch(`/api/admin/doctor-assignments?providerId=${activeProvider.id}`);
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
  }, [activeProvider?.id]);

  useEffect(() => {
    loadTeam();
    loadDoctorAssignments();
  }, [loadTeam, loadDoctorAssignments]);

  // Handle URL query parameter ?doctorId=...
  useEffect(() => {
    if (doctorParam && doctors.length > 0 && !selectedDoctorForAssignment) {
      const match = doctors.find((d) => d.id === doctorParam);
      if (match) {
        setSelectedDoctorForAssignment(match);
      }
    }
  }, [doctorParam, doctors, selectedDoctorForAssignment]);

  const handleAssignFrontDesk = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDoctorForAssignment || !activeProvider?.id) return;

    if (selectedDoctorForAssignment.front_desk_managers.length >= 4) {
      setAssignError('Maximum of 4 Front Desk Managers can be assigned to this doctor.');
      return;
    }

    setIsAssigning(true);
    setAssignError(null);

    try {
      let payload: any = {
        providerId: activeProvider.id,
        doctorId: selectedDoctorForAssignment.id,
      };

      const requiresIdCard = (selectedDoctorForAssignment.front_desk_managers?.length || 0) >= 1;

      if (assignmentModalMode === 'existing') {
        if (!assignExistingUserId) {
          setAssignError('Please select a staff member to assign.');
          setIsAssigning(false);
          return;
        }
        const existingStaffId = getExistingStaffIdCard(assignExistingUserId);
        const finalIdCard = (existingStaffId || newFdIdCard).trim();
        if (requiresIdCard && !finalIdCard) {
          setAssignError(`Staff ID Card Number is mandatory because Dr. ${selectedDoctorForAssignment.name} has more than 1 front desk manager.`);
          setIsAssigning(false);
          return;
        }
        payload.userId = assignExistingUserId;
        payload.idCardNumber = finalIdCard || undefined;
      } else {
        if (!newFdName || !newFdEmail || !newFdPassword) {
          setAssignError('Full Name, Email, and Password are required.');
          setIsAssigning(false);
          return;
        }
        if (newFdPassword.length < 6) {
          setAssignError('Password must be at least 6 characters.');
          setIsAssigning(false);
          return;
        }
        if (requiresIdCard && !newFdIdCard.trim()) {
          setAssignError(`Staff ID Card Number is mandatory because Dr. ${selectedDoctorForAssignment.name} has more than 1 front desk manager.`);
          setIsAssigning(false);
          return;
        }
        payload.fullName = newFdName.trim();
        payload.email = newFdEmail.trim();
        payload.password = newFdPassword;
        payload.phone = newFdPhone.trim() || undefined;
        payload.idCardNumber = newFdIdCard.trim() || undefined;
      }

      const res = await fetch('/api/admin/doctor-assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const json = await res.json();
      if (!res.ok || json.error) {
        throw new Error(json.error || 'Failed to assign front desk manager');
      }

      setSuccessBanner(
        `Front desk manager "${newFdName || 'Staff Member'}" assigned to Dr. ${selectedDoctorForAssignment.name} successfully.`
      );
      setSelectedDoctorForAssignment(null);
      setNewFdName('');
      setNewFdEmail('');
      setNewFdPassword('');
      setNewFdPhone('');
      setNewFdIdCard('');
      setAssignExistingUserId('');
      await Promise.all([loadDoctorAssignments(), loadTeam()]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error assigning front desk manager';
      setAssignError(msg);
    } finally {
      setIsAssigning(false);
    }
  };

  const handleUnassignFrontDesk = async (
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
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Helper to determine exact hospital role and assigned service for each account
  const getMemberRoleAndService = (member: TeamMember) => {
    // 1. Hospital Administrator
    if (
      member.role === 'admin' ||
      member.membershipRole === 'admin' ||
      member.membershipRole === 'owner' ||
      (activeProvider?.owner_id && member.id === activeProvider.owner_id)
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

  // Merge members with any doctors or front desk managers who are part of this provider
  const allRosterMembers = React.useMemo(() => {
    const list = [...members];
    const existingIds = new Set(list.map((m) => m.id));
    const existingEmails = new Set(list.map((m) => (m.email || '').toLowerCase()).filter(Boolean));

    // Ensure all doctors appear in directory
    doctors.forEach((doc) => {
      const email = doc.doctor_email?.toLowerCase();
      const attrUserId = (doc as any)?.attributes?.user_id;
      if (attrUserId && !existingIds.has(attrUserId)) {
        list.push({
          id: attrUserId,
          email: doc.doctor_email || null,
          full_name: `Dr. ${doc.name}`,
          role: 'merchant',
          membershipRole: 'doctor',
          phone: null,
          created_at: new Date().toISOString(),
        });
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
        });
        existingEmails.add(email);
      }

      // Ensure all assigned front desk managers appear in directory
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

  const filteredMembers = allRosterMembers.filter((m) => {
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

  const filteredDoctors = doctors.filter((doc) => {
    const matches = 
      doc.name.toLowerCase().includes(doctorSearch.toLowerCase()) ||
      (doc.department || '').toLowerCase().includes(doctorSearch.toLowerCase()) ||
      (doc.doctor_email || '').toLowerCase().includes(doctorSearch.toLowerCase()) ||
      doc.front_desk_managers.some((fd) => 
        (fd.full_name || '').toLowerCase().includes(doctorSearch.toLowerCase()) ||
        (fd.email || '').toLowerCase().includes(doctorSearch.toLowerCase()) ||
        (fd.id_card_number || '').toLowerCase().includes(doctorSearch.toLowerCase())
      );
    return matches;
  });

  const adminCount = allRosterMembers.filter((m) => m.role === 'admin' || (activeProvider?.owner_id && m.id === activeProvider.owner_id)).length;
  const totalFrontDeskCount = doctors.reduce((sum, d) => sum + (d.front_desk_managers?.length || 0), 0);

  if (!activeProvider && !isSuperAdmin) {
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
          <button
            onClick={() => {
              loadTeam();
              loadDoctorAssignments();
            }}
            className="inline-flex items-center px-3.5 py-2 border border-slate-300 rounded-xl text-sm font-medium text-slate-700 bg-white hover:bg-slate-50 transition-colors shadow-xs cursor-pointer"
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
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-5">
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Staff Accounts</span>
            <UserCheck className="w-5 h-5 text-emerald-600" />
          </div>
          <p className="text-2xl font-bold text-slate-900 mt-2 font-mono">{allRosterMembers.length}</p>
          <p className="text-xs text-slate-500 mt-1">Verified Supabase profiles</p>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{verticalConfig.resourceLabelPlural}</span>
            <Stethoscope className="w-5 h-5 text-emerald-600" />
          </div>
          <p className="text-2xl font-bold text-slate-900 mt-2 font-mono">{doctors.length}</p>
          <p className="text-xs text-slate-500 mt-1">Active consultation desks</p>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Front Desk Desks</span>
            <Users className="w-5 h-5 text-teal-600" />
          </div>
          <p className="text-2xl font-bold text-slate-900 mt-2 font-mono">{totalFrontDeskCount}</p>
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
            {filteredDoctors.map((doc) => {
              const assignedCount = doc.front_desk_managers?.length || 0;
              const isFull = assignedCount >= 4;

              return (
                <div
                  key={doc.id}
                  id={`doctor-card-${doc.id}`}
                  className="bg-white rounded-2xl border border-slate-200 hover:border-emerald-300 transition-all p-5 shadow-xs flex flex-col justify-between space-y-5"
                >
                  <div className="space-y-4">
                    {/* Doctor Header */}
                    <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200 inline-flex items-center gap-1">
                            <Layers className="w-3 h-3 text-emerald-600" />
                            {doc.department || 'General'}
                          </span>
                          <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                            doc.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'
                          }`}>
                            {doc.is_active ? 'Active Desk' : 'On Break'}
                          </span>
                        </div>
                        <h3 className="text-lg font-bold text-slate-900 mt-1.5 flex items-center gap-1.5">
                          <Stethoscope className="w-4 h-4 text-emerald-700 shrink-0" />
                          <span>{doc.name}</span>
                        </h3>
                      </div>

                      <div className="text-right">
                        <span className="text-[10px] uppercase font-bold text-slate-400">Consultation</span>
                        <p className="text-base font-bold text-slate-900 font-mono">
                          ₹{Number(doc.deposit_amount || 500).toFixed(0)}
                        </p>
                      </div>
                    </div>

                    {/* Doctor OPD Login Credentials Bar */}
                    <div className="bg-slate-50 rounded-xl p-3 border border-slate-200/80 flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2 truncate">
                        <KeyRound className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span className="text-slate-500 font-medium">Doctor OPD Login:</span>
                        {doc.doctor_email ? (
                          <span className="font-mono font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md truncate max-w-[200px]" title={doc.doctor_email}>
                            {doc.doctor_email}
                          </span>
                        ) : (
                          <span className="text-slate-400 italic">
                            No direct login set
                          </span>
                        )}
                      </div>

                      {doc.doctor_email && (
                        <button
                          onClick={() => copyToClipboard(doc.doctor_email || '', `doc-${doc.id}`)}
                          className="text-slate-400 hover:text-emerald-700 p-1 shrink-0 cursor-pointer"
                          title="Copy login email"
                        >
                          {copiedId === `doc-${doc.id}` ? (
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
                          <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold font-mono ${
                            assignedCount === 0
                              ? 'bg-amber-100 text-amber-800'
                              : isFull
                              ? 'bg-slate-200 text-slate-700'
                              : 'bg-emerald-100 text-emerald-800'
                          }`}>
                            {assignedCount} / 4 Assigned
                          </span>
                        </div>

                        <button
                          onClick={() => {
                            setSelectedDoctorForAssignment(doc);
                            setAssignError(null);
                            setAssignmentModalMode('new');
                          }}
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
                          {doc.front_desk_managers.map((fd, index) => (
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
                                    onClick={() => copyToClipboard(fd.email || '', `fd-${doc.id}-${fd.user_id}`)}
                                    className="p-1 rounded text-slate-400 hover:text-emerald-700 hover:bg-slate-50 cursor-pointer"
                                    title="Copy receptionist email"
                                  >
                                    {copiedId === `fd-${doc.id}-${fd.user_id}` ? (
                                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                                    ) : (
                                      <Copy className="w-3.5 h-3.5" />
                                    )}
                                  </button>
                                )}
                                <button
                                  onClick={() => handleUnassignFrontDesk(doc.id, doc.name, fd.user_id, fd.full_name)}
                                  className="p-1 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                                  title={`Unassign ${fd.full_name} from ${doc.name}`}
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
                    <span className="font-mono">ID: {doc.id.substring(0, 8)}</span>
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
            })}
          </div>
        )}
      </div>

      {/* SECTION 2: Master Hospital Staff Directory */}
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

        {/* Team Members Table with Explicit Roles and Services */}
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

      {/* MODAL: Assign Front Desk Manager to Specific Doctor (With Optional ID Card Number) */}
      {selectedDoctorForAssignment && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 sm:p-8 shadow-xl border border-slate-200 relative animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-800 flex items-center justify-center font-bold">
                  <UserPlus className="w-5 h-5 text-emerald-600" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900">
                    Assign Front Desk Manager
                  </h3>
                  <p className="text-xs text-slate-500">
                    Doctor: <span className="font-semibold text-slate-800">{selectedDoctorForAssignment.name}</span> ({selectedDoctorForAssignment.department})
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedDoctorForAssignment(null)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold p-1 cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Mode Selector Tabs */}
            <div className="grid grid-cols-2 gap-2 mt-4 p-1 bg-slate-100 rounded-xl text-xs font-semibold">
              <button
                type="button"
                onClick={() => setAssignmentModalMode('new')}
                className={`py-2 px-3 rounded-lg transition-colors cursor-pointer ${
                  assignmentModalMode === 'new'
                    ? 'bg-white text-emerald-800 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Create New Receptionist
              </button>
              <button
                type="button"
                onClick={() => setAssignmentModalMode('existing')}
                className={`py-2 px-3 rounded-lg transition-colors cursor-pointer ${
                  assignmentModalMode === 'existing'
                    ? 'bg-white text-emerald-800 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Assign Existing Staff
              </button>
            </div>

            {assignError && (
              <div className="mt-4 rounded-lg bg-rose-50 border border-rose-200 p-3 flex items-start gap-2 text-xs text-rose-700">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>{assignError}</span>
              </div>
            )}

            <form onSubmit={handleAssignFrontDesk} className="mt-4 space-y-4">
              {assignmentModalMode === 'new' ? (
                <>
                  <div>
                    <label htmlFor="fd-name" className="block text-xs font-semibold text-slate-700 mb-1">
                      Front Desk Manager Full Name *
                    </label>
                    <input
                      id="fd-name"
                      type="text"
                      required
                      value={newFdName}
                      onChange={(e) => setNewFdName(e.target.value)}
                      placeholder="e.g. Kavitha Sharma (Token Desk 1)"
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label htmlFor="fd-email" className="block text-xs font-semibold text-slate-700 mb-1">
                      Login Email Address *
                    </label>
                    <div className="relative">
                      <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                      <input
                        id="fd-email"
                        type="email"
                        required
                        value={newFdEmail}
                        onChange={(e) => setNewFdEmail(e.target.value)}
                        placeholder="frontdesk.kavitha@hospital.com"
                        className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:outline-none font-mono text-xs"
                      />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="fd-password" className="block text-xs font-semibold text-slate-700 mb-1">
                      Temporary Password (min 6 characters) *
                    </label>
                    <div className="relative">
                      <KeyRound className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                      <input
                        id="fd-password"
                        type={showFdPassword ? 'text' : 'password'}
                        required
                        value={newFdPassword}
                        onChange={(e) => setNewFdPassword(e.target.value)}
                        placeholder="••••••••"
                        className="w-full pl-9 pr-10 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:outline-none font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => setShowFdPassword(!showFdPassword)}
                        className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 cursor-pointer"
                        title={showFdPassword ? 'Hide password' : 'Show password'}
                      >
                        {showFdPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="fd-phone" className="block text-xs font-semibold text-slate-700 mb-1">
                        Phone Number (Optional)
                      </label>
                      <input
                        id="fd-phone"
                        type="tel"
                        inputMode="tel"
                        pattern="[0-9+\s-]*"
                        value={newFdPhone}
                        onChange={(e) => setNewFdPhone(sanitizePhoneInput(e.target.value))}
                        onKeyDown={(e) => {
                          if (e.key.length === 1 && /[a-zA-Z]/.test(e.key)) {
                            e.preventDefault();
                          }
                        }}
                        placeholder="+91 98480 12345"
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:outline-none font-mono text-xs"
                      />
                    </div>

                    <div>
                      <label htmlFor="fd-id-card" className="block text-xs font-semibold text-slate-700 mb-1">
                        Staff ID Card Number {(selectedDoctorForAssignment.front_desk_managers?.length || 0) >= 1 ? '*' : '(Optional)'}
                      </label>
                      <div className="relative">
                        <CreditCard className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                        <input
                          id="fd-id-card"
                          type="text"
                          required={(selectedDoctorForAssignment.front_desk_managers?.length || 0) >= 1}
                          value={newFdIdCard}
                          onChange={(e) => setNewFdIdCard(e.target.value.toUpperCase())}
                          placeholder={
                            (selectedDoctorForAssignment.front_desk_managers?.length || 0) >= 1
                              ? "e.g. HOSP-FD-104 (Required)"
                              : "e.g. HOSP-FD-104 (Optional)"
                          }
                          className={`w-full pl-9 pr-3 py-2 border rounded-lg text-sm text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:outline-none font-mono text-xs uppercase ${
                            (selectedDoctorForAssignment.front_desk_managers?.length || 0) >= 1 && !newFdIdCard.trim()
                              ? 'border-amber-300 bg-amber-50/20'
                              : 'border-slate-300'
                          }`}
                        />
                      </div>
                      {(selectedDoctorForAssignment.front_desk_managers?.length || 0) >= 1 && (
                        <p className="text-[11px] text-amber-700 mt-1">
                          * Staff ID is mandatory because Dr. {selectedDoctorForAssignment.name} has multiple receptionists.
                        </p>
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <div className="space-y-4">
                  <div>
                    <label htmlFor="existing-staff-select" className="block text-xs font-semibold text-slate-700 mb-1">
                      Select Staff Member to Assign *
                    </label>
                    <select
                      id="existing-staff-select"
                      value={assignExistingUserId}
                      onChange={(e) => {
                        const uid = e.target.value;
                        setAssignExistingUserId(uid);
                        const existingId = getExistingStaffIdCard(uid);
                        if (existingId) {
                          setNewFdIdCard(existingId);
                        } else {
                          setNewFdIdCard('');
                        }
                      }}
                      className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:outline-none bg-white"
                    >
                      <option value="">-- Choose a staff member --</option>
                      {allRosterMembers
                        .filter(
                          (m) =>
                            !m.id.startsWith('doc-') &&
                            !m.id.startsWith('fd-') &&
                            !isDoctorUser(m) &&
                            !selectedDoctorForAssignment.front_desk_managers.some((fd) => fd.user_id === m.id)
                        )
                        .map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.full_name || 'Staff'} ({m.email || 'No email'})
                          </option>
                        ))}
                    </select>
                  </div>

                  {assignExistingUserId && (
                    <>
                      {getExistingStaffIdCard(assignExistingUserId) ? (
                        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-900 flex items-center justify-between">
                          <div className="flex items-center gap-2.5">
                            <CreditCard className="w-4 h-4 text-emerald-600 shrink-0" />
                            <div>
                              <p className="font-semibold text-emerald-950">Existing Verified Staff ID</p>
                              <p className="font-mono text-emerald-700 text-sm font-bold mt-0.5">
                                {getExistingStaffIdCard(assignExistingUserId)}
                              </p>
                            </div>
                          </div>
                          <span className="text-[10px] font-bold uppercase tracking-wider bg-emerald-100 text-emerald-800 border border-emerald-300 px-2 py-0.5 rounded-full">
                            Preserved
                          </span>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-600 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <CreditCard className="w-4 h-4 text-slate-400 shrink-0" />
                              <span>No existing ID card found for this staff member</span>
                            </div>
                            {(selectedDoctorForAssignment.front_desk_managers?.length || 0) >= 1 ? (
                              <span className="text-[10px] font-bold uppercase tracking-wider bg-amber-100 text-amber-800 border border-amber-300 px-2 py-0.5 rounded-full">
                                ID Required
                              </span>
                            ) : (
                              <span className="text-[10px] text-slate-400 font-medium">Optional</span>
                            )}
                          </div>

                          <div>
                            <label htmlFor="existing-fd-id-card" className="block text-xs font-semibold text-slate-700 mb-1">
                              Staff ID Card Number {(selectedDoctorForAssignment.front_desk_managers?.length || 0) >= 1 ? '*' : '(Optional)'}
                            </label>
                            <div className="relative">
                              <CreditCard className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                              <input
                                id="existing-fd-id-card"
                                type="text"
                                required={(selectedDoctorForAssignment.front_desk_managers?.length || 0) >= 1}
                                value={newFdIdCard}
                                onChange={(e) => setNewFdIdCard(e.target.value.toUpperCase())}
                                placeholder={
                                  (selectedDoctorForAssignment.front_desk_managers?.length || 0) >= 1
                                    ? "e.g. HOSP-FD-104 (Required for multiple desks)"
                                    : "e.g. HOSP-FD-104 (Optional)"
                                }
                                className={`w-full pl-9 pr-3 py-2 border rounded-lg text-sm text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:outline-none font-mono text-xs uppercase ${
                                  (selectedDoctorForAssignment.front_desk_managers?.length || 0) >= 1 && !newFdIdCard.trim()
                                    ? 'border-amber-300 bg-amber-50/20'
                                    : 'border-slate-300'
                                }`}
                              />
                            </div>
                            {(selectedDoctorForAssignment.front_desk_managers?.length || 0) >= 1 && (
                              <p className="text-[11px] text-amber-700 mt-1">
                                * Staff ID is mandatory because Dr. {selectedDoctorForAssignment.name} has more than 1 front desk manager.
                              </p>
                            )}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              <div className="p-3 bg-emerald-50/70 border border-emerald-200 rounded-lg text-xs text-emerald-900 flex items-start gap-2">
                <Sparkles className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <span>
                  Front desk managers can independently sign in with these credentials to register patients, issue live tokens, and print OPD receipts.
                </span>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setSelectedDoctorForAssignment(null)}
                  className="px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isAssigning}
                  className="px-5 py-2 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-sm transition-colors disabled:opacity-50 flex items-center gap-2 cursor-pointer"
                >
                  {isAssigning ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Assigning...
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4" />
                      Assign to {selectedDoctorForAssignment.name}
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
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
