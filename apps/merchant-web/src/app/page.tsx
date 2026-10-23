'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Link from 'next/link';
import { 
  Clock, 
  CheckCircle2, 
  TrendingUp, 
  Users, 
  ArrowRight, 
  Phone, 
  User, 
  ShieldCheck, 
  MapPin,
  RefreshCw,
  Sparkles,
  Building2,
  AlertTriangle,
  Plus,
  Zap,
  Power,
  Sliders,
  PauseCircle,
  Settings,
  X,
  Check,
  Calendar,
  Copy,
  UserCheck,
  UserPlus,
  Ticket,
  Stethoscope,
  ShieldAlert
} from 'lucide-react';
import { 
  supabase, 
  updateBookingStatus, 
  recordMerchantNoShow,
  manageLateQueueBooking,
  verifyCheckinCodeRpc,
  markPresentManuallyRpc,
  admitPatient,
  fetchMerchantBookingById,
  MerchantBookingWithDetails,
  Provider,
  Resource,
  WeeklyHours,
  DayOfWeek,
  DaySchedule
} from '@/lib/supabase';
import { useMerchantTenant } from '@/contexts/MerchantTenantContext';
import { CustomerContactBadge } from '@/components/CustomerContactBadge';
import FrontDeskHeader, { AssignedDoctor } from '@/components/frontdesk/FrontDeskHeader';
import FastPassCheckinPanel, { CheckinSuccessData } from '@/components/frontdesk/FastPassCheckinPanel';
import ManualCheckinModal, { UpcomingCandidateBooking } from '@/components/frontdesk/ManualCheckinModal';
import FrontDeskQueueTabs, { FrontDeskQueueBooking } from '@/components/frontdesk/FrontDeskQueueTabs';
import WaitingLoungeDisplayModal, { DisplayQueueItem } from '@/components/frontdesk/WaitingLoungeDisplayModal';

const DEMO_PROVIDER: Provider & { resources?: Resource[] } = {
  id: 'b66cb1fc-0248-4c13-97d3-73b0519b59f9',
  name: 'Tirupati Multispecialty Hospital',
  category_id: 'hospital',
  city: 'Tirupati',
  address: 'Near Alipiri Gate, Tirupati, Andhra Pradesh',
  phone: '+91 877 222 3456',
  owner_id: '84e3a93b-f60f-4620-be52-505eb397913e',
  latitude: 13.6288,
  longitude: 79.4192,
  opening_time: '09:00',
  closing_time: '21:00',
  status: 'ACTIVE',
  resources: [
    {
      id: 'res-dr-suresh',
      name: 'Dr. Suresh Sharma',
      type: 'doctor',
      department: 'Cardiology',
      provider_id: 'b66cb1fc-0248-4c13-97d3-73b0519b59f9',
      is_active: true,
      duration_minutes: 15,
      capacity: 1,
      deposit_amount: 100,
      attributes: { doctor_left: false },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: 'res-dr-priya',
      name: 'Dr. Priya Nair',
      type: 'doctor',
      department: 'Pediatrics',
      provider_id: 'b66cb1fc-0248-4c13-97d3-73b0519b59f9',
      is_active: true,
      duration_minutes: 15,
      capacity: 1,
      deposit_amount: 100,
      attributes: { doctor_left: false },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ],
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

function getDemoBookings(providerId: string, resources: Resource[]): any[] {
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const doc1 = resources[0]?.id || 'res-dr-suresh';
  const doc1Name = resources[0]?.name || 'Dr. Suresh Sharma';
  const doc2 = resources[1]?.id || 'res-dr-priya';
  const doc2Name = resources[1]?.name || 'Dr. Priya Nair';

  return [
    {
      id: 'demo-b-1',
      customer_id: 'cust-1',
      customer_name: 'Rajesh Kumar',
      customer_phone: '+91 98765 43210',
      provider_id: providerId,
      resource_id: doc1,
      resource_name: doc1Name,
      slot_start: `${todayStr}T09:00:00+05:30`,
      slot_end: `${todayStr}T09:15:00+05:30`,
      status: 'CHECKED_IN',
      is_present: true,
      customer_arrived_at: `${todayStr}T08:55:00+05:30`,
      checked_in_at: `${todayStr}T08:55:00+05:30`,
      deposit_amount: 100,
      payment_status: 'CAPTURED',
    },
    {
      id: 'demo-b-2',
      customer_id: 'cust-2',
      customer_name: 'Lakshmi Narayana',
      customer_phone: '+91 94401 23456',
      provider_id: providerId,
      resource_id: doc1,
      resource_name: doc1Name,
      slot_start: `${todayStr}T09:15:00+05:30`,
      slot_end: `${todayStr}T09:30:00+05:30`,
      status: 'CHECKED_IN',
      is_present: true,
      customer_arrived_at: `${todayStr}T09:10:00+05:30`,
      checked_in_at: `${todayStr}T09:10:00+05:30`,
      deposit_amount: 100,
      payment_status: 'CAPTURED',
    },
    {
      id: 'demo-b-3',
      customer_id: 'cust-3',
      customer_name: 'Sravani Reddy',
      customer_phone: '+91 99887 76655',
      provider_id: providerId,
      resource_id: doc2,
      resource_name: doc2Name,
      slot_start: `${todayStr}T09:30:00+05:30`,
      slot_end: `${todayStr}T09:45:00+05:30`,
      status: 'CHECKED_IN',
      is_present: true,
      customer_arrived_at: `${todayStr}T09:25:00+05:30`,
      checked_in_at: `${todayStr}T09:25:00+05:30`,
      deposit_amount: 100,
      payment_status: 'CAPTURED',
    },
    {
      id: 'demo-b-4',
      customer_id: 'cust-4',
      customer_name: 'Venkatesh Babu',
      customer_phone: '+91 91234 56789',
      provider_id: providerId,
      resource_id: doc1,
      resource_name: doc1Name,
      slot_start: `${todayStr}T09:45:00+05:30`,
      slot_end: `${todayStr}T10:00:00+05:30`,
      status: 'CONFIRMED',
      is_present: false,
      deposit_amount: 100,
      payment_status: 'CAPTURED',
    },
    {
      id: 'demo-b-5',
      customer_id: 'cust-5',
      customer_name: 'Padmavathi Amma',
      customer_phone: '+91 98480 11223',
      provider_id: providerId,
      resource_id: doc1,
      resource_name: doc1Name,
      slot_start: `${todayStr}T10:00:00+05:30`,
      slot_end: `${todayStr}T10:15:00+05:30`,
      status: 'CONFIRMED',
      is_present: false,
      deposit_amount: 100,
      payment_status: 'CAPTURED',
    },
    {
      id: 'demo-b-6',
      customer_id: 'cust-6',
      customer_name: 'Manoj Prasad',
      customer_phone: '+91 93910 99887',
      provider_id: providerId,
      resource_id: doc2,
      resource_name: doc2Name,
      slot_start: `${todayStr}T10:15:00+05:30`,
      slot_end: `${todayStr}T10:30:00+05:30`,
      status: 'CONFIRMED',
      is_present: false,
      deposit_amount: 100,
      payment_status: 'CAPTURED',
    },
    {
      id: 'demo-b-7',
      customer_id: 'cust-7',
      customer_name: 'Ananya Sharma',
      customer_phone: '+91 95500 33445',
      provider_id: providerId,
      resource_id: doc2,
      resource_name: doc2Name,
      slot_start: `${todayStr}T10:30:00+05:30`,
      slot_end: `${todayStr}T10:45:00+05:30`,
      status: 'CONFIRMED',
      is_present: false,
      deposit_amount: 100,
      payment_status: 'CAPTURED',
    },
    {
      id: 'demo-b-8',
      customer_id: 'cust-8',
      customer_name: 'Karthik Raja',
      customer_phone: '+91 97000 12345',
      provider_id: providerId,
      resource_id: doc1,
      resource_name: doc1Name,
      slot_start: `${todayStr}T08:30:00+05:30`,
      slot_end: `${todayStr}T08:45:00+05:30`,
      status: 'CONFIRMED',
      is_present: true,
      queue_position: 1,
      estimated_wait_minutes: 15,
      deposit_amount: 100,
      payment_status: 'CAPTURED',
    },
    {
      id: 'demo-b-9',
      customer_id: 'cust-9',
      customer_name: 'Govind Swamy',
      customer_phone: '+91 96180 55667',
      provider_id: providerId,
      resource_id: doc1,
      resource_name: doc1Name,
      slot_start: `${todayStr}T08:15:00+05:30`,
      slot_end: `${todayStr}T08:30:00+05:30`,
      status: 'NO_SHOW',
      is_present: false,
      deposit_amount: 100,
      payment_status: 'FORFEITED',
    },
    {
      id: 'demo-b-10',
      customer_id: 'cust-10',
      customer_name: 'Sunita Rao',
      customer_phone: '+91 98490 77889',
      provider_id: providerId,
      resource_id: doc2,
      resource_name: doc2Name,
      slot_start: `${todayStr}T08:45:00+05:30`,
      slot_end: `${todayStr}T09:00:00+05:30`,
      status: 'NO_SHOW',
      is_present: false,
      deposit_amount: 100,
      payment_status: 'FORFEITED',
    },
  ];
}

const DEFAULT_WEEKLY_HOURS: WeeklyHours = {
  monday: { open: '09:00', close: '21:00', is_closed: false },
  tuesday: { open: '09:00', close: '21:00', is_closed: false },
  wednesday: { open: '09:00', close: '21:00', is_closed: false },
  thursday: { open: '09:00', close: '21:00', is_closed: false },
  friday: { open: '09:00', close: '21:00', is_closed: false },
  saturday: { open: '09:00', close: '21:00', is_closed: false },
  sunday: { open: '10:00', close: '18:00', is_closed: false },
};

const DAYS_OF_WEEK: { key: DayOfWeek; label: string; short: string }[] = [
  { key: 'monday', label: 'Monday', short: 'Mon' },
  { key: 'tuesday', label: 'Tuesday', short: 'Tue' },
  { key: 'wednesday', label: 'Wednesday', short: 'Wed' },
  { key: 'thursday', label: 'Thursday', short: 'Thu' },
  { key: 'friday', label: 'Friday', short: 'Fri' },
  { key: 'saturday', label: 'Saturday', short: 'Sat' },
  { key: 'sunday', label: 'Sunday', short: 'Sun' },
];

function getKolkataDayKeys(): { todayKey: DayOfWeek; tomorrowKey: DayOfWeek } {
  const now = new Date();
  const dayNameToday = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', weekday: 'long' })
    .format(now)
    .toLowerCase() as DayOfWeek;

  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const dayNameTomorrow = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', weekday: 'long' })
    .format(tomorrow)
    .toLowerCase() as DayOfWeek;

  return { todayKey: dayNameToday, tomorrowKey: dayNameTomorrow };
}

export default function MerchantOverviewPage() {
  const { 
    activeProvider: tenantProvider, 
    verticalConfig, 
    isSuperAdmin, 
    isHospitalAdmin,
    isLocked, 
    memberships, 
    switchActiveProvider,
    refreshTenant,
    isLoading: isTenantLoading,
    isAuthenticated,
  } = useMerchantTenant();

  const isDemo = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('demo') === '1';

  const venueLabel = verticalConfig?.venueLabel || 'Shop';

  // Enforce unauthenticated redirect to /login or /register for new users
  useEffect(() => {
    if (!isTenantLoading && !isAuthenticated) {
      const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
      if (params?.get('demo') !== '1') {
        window.location.href = '/login';
      }
    } else if (!isTenantLoading && isAuthenticated && !tenantProvider && !isSuperAdmin) {
      const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
      if (params?.get('demo') !== '1') {
        window.location.href = '/register';
      }
    }
  }, [isTenantLoading, isAuthenticated, tenantProvider, isSuperAdmin]);

  const [providers, setProviders] = useState<(Provider & { resources?: Resource[] })[]>(
    tenantProvider ? [tenantProvider] : isDemo ? [DEMO_PROVIDER] : []
  );
  const [selectedProviderId, setSelectedProviderId] = useState<string>(
    tenantProvider?.id || (isDemo ? DEMO_PROVIDER.id : '')
  );
  const [bookings, setBookings] = useState<MerchantBookingWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [isLiveConnected, setIsLiveConnected] = useState(false);
  const [recentNotification, setRecentNotification] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingBookingId, setPendingBookingId] = useState<string | null>(null);
  const loadVersion = useRef(0);
  const tenantProviderId = tenantProvider?.id;
  const [today, setToday] = useState(() => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }));

  // Reception Check-in Desk State
  const [checkinCodeInput, setCheckinCodeInput] = useState('');
  const [isVerifyingCheckin, setIsVerifyingCheckin] = useState(false);
  const [checkinSuccessData, setCheckinSuccessData] = useState<{
    booking_id?: string;
    patient_name?: string;
    service_doctor?: string;
    slot_time?: string;
    is_late?: boolean;
    checked_in_at?: string;
  } | null>(null);
  const [checkinErrorMessage, setCheckinErrorMessage] = useState<string | null>(null);
  const checkinInputRef = useRef<HTMLInputElement>(null);

  // Front Desk Hospital Workspace State (Phase 5c)
  const [hospitalContext, setHospitalContext] = useState<{
    role?: string;
    accessibleResourceIds?: string[];
    departments?: any[];
    members?: any[];
    assignments?: any[];
  } | null>(null);
  const [userEmail, setUserEmail] = useState('');
  const [isDisplayModalOpen, setIsDisplayModalOpen] = useState(false);
  const [isManualCheckinModalOpen, setIsManualCheckinModalOpen] = useState(false);
  const [isProcessingFrontDeskAction, setIsProcessingFrontDeskAction] = useState(false);

  useEffect(() => {
    async function loadUserAndHospitalContext() {
      if (!selectedProviderId) return;
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;
        setUserEmail(sessionData.session?.user?.email || '');
        if (!token) return;

        const res = await fetch(`/api/hospital/context?provider_id=${selectedProviderId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          setHospitalContext(data);
        }
      } catch (err) {
        console.error('Failed to load hospital context:', err);
      }
    }
    loadUserAndHospitalContext();
  }, [selectedProviderId]);


  useEffect(() => {
    const timer = setInterval(() => {
      setToday(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }));
    }, 60000);
    return () => clearInterval(timer);
  }, []);

  // Auto-dismiss floating notifications without layout shifts
  useEffect(() => {
    if (!recentNotification) return;
    const timer = setTimeout(() => {
      setRecentNotification(null);
    }, 4000);
    return () => clearTimeout(timer);
  }, [recentNotification]);

  // Sync selected provider when tenant context changes
  useEffect(() => {
    setSelectedProviderId(tenantProviderId || '');
    setBookings([]);
    setProviders([]);
    loadVersion.current += 1;
  }, [tenantProviderId]);

  const activeProvider = providers.find((p) => p.id === selectedProviderId) || tenantProvider || providers[0] || (isDemo ? DEMO_PROVIDER : null);
  const activeResources: Resource[] = useMemo(() => {
    return (activeProvider?.resources as Resource[]) || [];
  }, [activeProvider?.resources]);

  // Operational control state with optimistic overrides
  const [overrideIsActive, setOverrideIsActive] = useState<boolean | null>(null);
  const [overrideAutoAccept, setOverrideAutoAccept] = useState<boolean | null>(null);
  const [overrideDailyLimit, setOverrideDailyLimit] = useState<number | null>(null);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showHoursModal, setShowHoursModal] = useState(false);
  const [hoursActiveTab, setHoursActiveTab] = useState<'today' | 'tomorrow' | 'full_week'>('full_week');
  const [tempAutoAccept, setTempAutoAccept] = useState(true);
  const [tempDailyLimit, setTempDailyLimit] = useState(50);
  const [tempOpeningTime, setTempOpeningTime] = useState('09:00');
  const [tempClosingTime, setTempClosingTime] = useState('21:00');
  const [tempWeeklyHours, setTempWeeklyHours] = useState<WeeklyHours>(DEFAULT_WEEKLY_HOURS);
  const [bulkOpenTime, setBulkOpenTime] = useState('09:00');
  const [bulkCloseTime, setBulkCloseTime] = useState('21:00');
  const [isUpdatingOperational, setIsUpdatingOperational] = useState(false);

  // Doctor Shift & Departure Status
  const [doctorLeftMap, setDoctorLeftMap] = useState<Record<string, boolean>>({});

  // Offline / Walk-in Patient Booking Modal State
  const [showOfflineModal, setShowOfflineModal] = useState(false);
  const [offlineName, setOfflineName] = useState('');
  const [offlinePhone, setOfflinePhone] = useState('');
  const [offlineDoctorId, setOfflineDoctorId] = useState('');
  const [offlineTimeOption, setOfflineTimeOption] = useState<'now' | 'custom'>('now');
  const [offlineCustomTime, setOfflineCustomTime] = useState('');
  const [offlineMarkPresent, setOfflineMarkPresent] = useState(true);
  const [isSubmittingOffline, setIsSubmittingOffline] = useState(false);

  // Live Patient Queue Attendance Matrix filter state
  const [selectedDepartmentFilter, setSelectedDepartmentFilter] = useState<string>('');
  const [merchantSelectedDoctorId, setMerchantSelectedDoctorId] = useState<string>('');
  const [matrixFilter, setMatrixFilter] = useState<'ALL' | 'PRESENT' | 'WAITING' | 'ABSENT' | 'LATE'>('ALL');
  const [selectedMatrixBookingId, setSelectedMatrixBookingId] = useState<string | null>(null);
  const [urlDoctorId, setUrlDoctorId] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      return params.get('doctor_id') || params.get('resource_id') || null;
    }
    return null;
  });

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const docParam = params.get('doctor_id') || params.get('resource_id');
      if (docParam) {
        setUrlDoctorId(docParam);
        setMerchantSelectedDoctorId(docParam);
      }
    }
  }, []);

  const availableDepartments = useMemo(() => {
    const depts = new Set<string>();
    activeResources.forEach((r) => {
      if (r.department) depts.add(r.department);
    });
    return Array.from(depts).sort();
  }, [activeResources]);

  const departmentFilteredResources = useMemo(() => {
    if (!selectedDepartmentFilter) return activeResources;
    return activeResources.filter((r) => (r.department || 'General') === selectedDepartmentFilter);
  }, [activeResources, selectedDepartmentFilter]);

  const isHospitalVenue = Boolean(
    activeProvider?.category_id === 'hospital' || 
    verticalConfig?.venueLabel === 'Hospital'
  );

  const isFrontDesk = useMemo(() => {
    if (hospitalContext?.role === 'front_desk') return true;
    if (typeof window !== 'undefined') {
      const roleParam = new URLSearchParams(window.location.search).get('role');
      if (roleParam === 'front_desk') return true;
    }
    return false;
  }, [hospitalContext?.role]);

  const frontDeskAssignedDoctors: AssignedDoctor[] = useMemo(() => {
    if (!isHospitalVenue) return [];
    const resources = (activeProvider?.resources as Resource[]) || [];
    
    // Explicit test/demo parameter check: ?assigned=none
    const isExplicitlyUnassigned = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('assigned') === 'none';
    if (isExplicitlyUnassigned) {
      return [];
    }

    if (isFrontDesk) {
      if (hospitalContext?.accessibleResourceIds && hospitalContext.accessibleResourceIds.length > 0) {
        return resources
          .filter((r) => hospitalContext.accessibleResourceIds?.includes(r.id))
          .map((r) => ({
            id: r.id,
            name: r.name,
            department: r.department,
            room: 'Room 204',
            is_active: r.is_active,
          }));
      }
      if (isDemo) {
        return resources.map((r) => ({
          id: r.id,
          name: r.name,
          department: r.department,
          room: 'Room 204',
          is_active: r.is_active,
        }));
      }
      return [];
    }
    return resources.map((r) => ({
      id: r.id,
      name: r.name,
      department: r.department,
      room: 'Room 204',
      is_active: r.is_active,
    }));
  }, [isHospitalVenue, activeProvider?.resources, hospitalContext, isFrontDesk]);

  const hasNoAssignedDoctors = Boolean(
    isHospitalVenue &&
    isFrontDesk &&
    frontDeskAssignedDoctors.length === 0
  );

  const isUnassignedDoctorUrlProbe = Boolean(
    isHospitalVenue &&
    isFrontDesk &&
    urlDoctorId &&
    !frontDeskAssignedDoctors.some((d) => d.id === urlDoctorId)
  );

  const hospitalTodayBookings = useMemo(() => {
    return bookings.filter((b) => {
      const isToday = b.slot_start?.startsWith(today);
      if (!isToday) return false;
      if (!merchantSelectedDoctorId) {
        if (hospitalContext?.role === 'front_desk' && hospitalContext.accessibleResourceIds?.length) {
          return hospitalContext.accessibleResourceIds.includes(b.resource_id);
        }
        return true;
      }
      return b.resource_id === merchantSelectedDoctorId;
    });
  }, [bookings, today, merchantSelectedDoctorId, hospitalContext]);

  const hospitalWaitingBookings: FrontDeskQueueBooking[] = useMemo(() => {
    return hospitalTodayBookings
      .filter((b) => (b.status === 'CHECKED_IN' || b.is_present) && !b.queue_position && b.status !== 'IN_CONSULTATION' && b.status !== 'COMPLETED')
      .map((b) => {
        let arrival_tag: 'On Time' | 'Early' | 'Late' = 'On Time';
        const checkinTime = (b as any).checked_in_at || b.customer_arrived_at;
        if (checkinTime) {
          const diffMs = new Date(checkinTime).getTime() - new Date(b.slot_start).getTime();
          if (diffMs > 10 * 60 * 1000) arrival_tag = 'Late';
          else if (diffMs < -10 * 60 * 1000) arrival_tag = 'Early';
        }
        return {
          id: b.id,
          reference_code: b.reference_code || '',
          patient_name: b.customer_name,
          customer: { full_name: b.customer_name, phone: b.customer_phone },
          slot_start: b.slot_start,
          slot_end: b.slot_end,
          status: b.status,
          arrival_tag,
          checked_in_at: checkinTime || undefined,
          doctor_name: b.resource_name,
          deposit_amount: b.deposit_amount,
        };
      })
      .sort((a, b) => {
        if (a.arrival_tag === 'On Time' && b.arrival_tag !== 'On Time') return -1;
        if (b.arrival_tag === 'On Time' && a.arrival_tag !== 'On Time') return 1;
        return new Date(a.slot_start).getTime() - new Date(b.slot_start).getTime();
      });
  }, [hospitalTodayBookings]);

  const hospitalStandbyBookings: FrontDeskQueueBooking[] = useMemo(() => {
    return hospitalTodayBookings
      .filter((b) => (b.status === 'CHECKED_IN' || b.is_present) && (Boolean(b.queue_position) || (b as any).arrival_tag === 'Late') && b.status !== 'IN_CONSULTATION' && b.status !== 'COMPLETED')
      .map((b) => {
        const checkinTime = (b as any).checked_in_at || b.customer_arrived_at;
        return {
          id: b.id,
          reference_code: b.reference_code || '',
          patient_name: b.customer_name,
          customer: { full_name: b.customer_name, phone: b.customer_phone },
          slot_start: b.slot_start,
          slot_end: b.slot_end,
          status: b.status,
          arrival_tag: 'Late' as const,
          checked_in_at: checkinTime || undefined,
          doctor_name: b.resource_name,
          deposit_amount: b.deposit_amount,
        };
      })
      .sort((a, b) => new Date(a.slot_start).getTime() - new Date(b.slot_start).getTime());
  }, [hospitalTodayBookings]);

  const hospitalInConsultationBookings: FrontDeskQueueBooking[] = useMemo(() => {
    return hospitalTodayBookings
      .filter((b) => b.status === 'IN_CONSULTATION')
      .map((b) => ({
        id: b.id,
        reference_code: b.reference_code || '',
        patient_name: b.customer_name,
        customer: { full_name: b.customer_name, phone: b.customer_phone },
        slot_start: b.slot_start,
        slot_end: b.slot_end,
        status: b.status,
        arrival_tag: 'On Time' as const,
        doctor_name: b.resource_name,
        deposit_amount: b.deposit_amount,
      }));
  }, [hospitalTodayBookings]);

  const upNextBookingId = useMemo(() => {
    if (hospitalWaitingBookings.length > 0) return hospitalWaitingBookings[0].id;
    if (hospitalStandbyBookings.length > 0) return hospitalStandbyBookings[0].id;
    return null;
  }, [hospitalWaitingBookings, hospitalStandbyBookings]);

  const hospitalExpectedBookings: FrontDeskQueueBooking[] = useMemo(() => {
    return hospitalTodayBookings
      .filter((b) => b.status === 'CONFIRMED' && !b.is_present)
      .map((b) => ({
        id: b.id,
        reference_code: b.reference_code || '',
        patient_name: b.customer_name,
        customer: { full_name: b.customer_name, phone: b.customer_phone },
        slot_start: b.slot_start,
        slot_end: b.slot_end,
        status: b.status,
        arrival_tag: 'Expected' as const,
        doctor_name: b.resource_name,
        deposit_amount: b.deposit_amount,
      }));
  }, [hospitalTodayBookings]);

  const hospitalCompletedBookings: FrontDeskQueueBooking[] = useMemo(() => {
    return hospitalTodayBookings
      .filter((b) => b.status === 'COMPLETED')
      .map((b) => ({
        id: b.id,
        reference_code: b.reference_code || '',
        patient_name: b.customer_name,
        customer: { full_name: b.customer_name, phone: b.customer_phone },
        slot_start: b.slot_start,
        slot_end: b.slot_end,
        status: b.status,
        doctor_name: b.resource_name,
        deposit_amount: b.deposit_amount,
      }));
  }, [hospitalTodayBookings]);

  const frontDeskStats = useMemo(() => ({
    checkedIn: hospitalWaitingBookings.length,
    standby: hospitalStandbyBookings.length,
    expected: hospitalExpectedBookings.length,
    completed: hospitalCompletedBookings.length,
  }), [hospitalWaitingBookings.length, hospitalStandbyBookings.length, hospitalExpectedBookings.length, hospitalCompletedBookings.length]);

  const candidateManualBookings: UpcomingCandidateBooking[] = useMemo(() => {
    return hospitalExpectedBookings.map((b) => ({
      id: b.id,
      reference_code: b.reference_code || '',
      patient_name: b.patient_name,
      phone: b.customer?.phone,
      slot_start: b.slot_start,
      slot_end: b.slot_end,
      status: b.status,
      doctor_name: b.doctor_name,
    }));
  }, [hospitalExpectedBookings]);

  const displayQueueItems: DisplayQueueItem[] = useMemo(() => {
    return hospitalTodayBookings
      .filter((b) => b.status === 'IN_CONSULTATION' || b.status === 'CHECKED_IN')
      .map((b, idx) => {
        const pName = b.customer_name || 'Patient';
        const parts = pName.trim().split(' ');
        const masked = parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0];
        return {
          id: b.id,
          tokenNumber: idx + 1,
          referenceCode: b.reference_code || '',
          maskedName: masked,
          doctorName: b.resource_name || 'Doctor',
          departmentName: (b as any).department || 'Consultation',
          roomNumber: 'Room 204',
          status: b.status === 'IN_CONSULTATION' ? ('IN_CONSULTATION' as const) : idx === 0 ? ('UP_NEXT' as const) : Boolean(b.queue_position) ? ('STANDBY' as const) : ('WAITING' as const),
          slotTime: new Date(b.slot_start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          estimatedWaitMinutes: (idx + 1) * 15,
        };
      });
  }, [hospitalTodayBookings]);

  const handleFrontDeskVerifyCode = async (code: string) => {
    const isDemo = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('demo') === '1';
    if (isDemo) {
      if (code === '1234') {
        return {
          success: true,
          data: {
            booking_id: 'demo-booking-1',
            patient_name: 'Jane Doe',
            service_doctor: 'Dr. Sarah Jenkins',
            slot_time: '10:00 AM',
            is_late: false,
            arrival_tag: 'On Time' as const,
            checked_in_at: new Date().toISOString(),
            queue_name: 'Waiting Queue',
          },
        };
      }
      return {
        success: false,
        error: 'INVALID_CODE',
        message: 'Invalid check-in code',
      };
    }

    const res = await verifyCheckinCodeRpc(selectedProviderId, code);
    if (res.success) {
      let arrival_tag: 'On Time' | 'Early' | 'Late' = 'On Time';
      if (res.is_late) arrival_tag = 'Late';
      void loadData();
      return {
        success: true,
        data: {
          booking_id: res.booking_id,
          patient_name: res.patient_name,
          service_doctor: res.service_doctor,
          slot_time: res.slot_time,
          is_late: res.is_late,
          arrival_tag,
          checked_in_at: res.checked_in_at,
        },
      };
    }
    return {
      success: false,
      error: res.error,
      message: res.message || 'Invalid check-in code',
    };
  };

  const handleFrontDeskStartConsultation = async (bookingId: string) => {
    setIsProcessingFrontDeskAction(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const res = await fetch('/api/bookings/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ booking_id: bookingId }),
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.message || 'Failed to start consultation');
      }
      setRecentNotification('Patient called into consultation');
      void loadData();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setIsProcessingFrontDeskAction(false);
    }
  };

  const handleFrontDeskEndConsultation = async (bookingId: string) => {
    setIsProcessingFrontDeskAction(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const res = await fetch('/api/bookings/end', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ booking_id: bookingId }),
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.message || 'Failed to end consultation');
      }
      setRecentNotification('Consultation marked completed');
      void loadData();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setIsProcessingFrontDeskAction(false);
    }
  };

  const handleFrontDeskAdmitPatient = async (bookingId: string) => {
    setIsProcessingFrontDeskAction(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const res = await fetch('/api/bookings/admit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ booking_id: bookingId }),
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.message || 'Failed to admit patient');
      }
      setRecentNotification('Patient admitted to waiting area');
      void loadData();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setIsProcessingFrontDeskAction(false);
    }
  };

  const handleFrontDeskManualCheckin = async (bookingId: string, reason: string) => {
    setIsProcessingFrontDeskAction(true);
    try {
      const res = await markPresentManuallyRpc(bookingId);
      if (!res.success) {
        throw new Error(res.message || 'Failed to mark present');
      }
      setRecentNotification('Patient marked present manually');
      void loadData();
      return true;
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Manual check-in failed');
      return false;
    } finally {
      setIsProcessingFrontDeskAction(false);
    }
  };

  const handleFrontDeskMarkNoShow = async (bookingId: string) => {
    setIsProcessingFrontDeskAction(true);
    try {
      await recordMerchantNoShow(bookingId);
      setRecentNotification('Patient marked as No Show with deposit settled');
      void loadData();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Mark No Show failed');
    } finally {
      setIsProcessingFrontDeskAction(false);
    }
  };

  useEffect(() => {
    if (activeProvider) {
      setTempAutoAccept(activeProvider.auto_accept_bookings ?? true);
      setTempDailyLimit(activeProvider.daily_booking_limit ?? 50);
      const openBase = (activeProvider.opening_time || '09:00:00').slice(0, 5);
      const closeBase = (activeProvider.closing_time || '21:00:00').slice(0, 5);
      setTempOpeningTime(openBase);
      setTempClosingTime(closeBase);
      setBulkOpenTime(openBase);
      setBulkCloseTime(closeBase);

      const weekly = activeProvider.weekly_hours as WeeklyHours | undefined;
      if (weekly && typeof weekly === 'object') {
        setTempWeeklyHours({
          monday: weekly.monday || { open: openBase, close: closeBase, is_closed: false },
          tuesday: weekly.tuesday || { open: openBase, close: closeBase, is_closed: false },
          wednesday: weekly.wednesday || { open: openBase, close: closeBase, is_closed: false },
          thursday: weekly.thursday || { open: openBase, close: closeBase, is_closed: false },
          friday: weekly.friday || { open: openBase, close: closeBase, is_closed: false },
          saturday: weekly.saturday || { open: openBase, close: closeBase, is_closed: false },
          sunday: weekly.sunday || { open: '10:00', close: '18:00', is_closed: false },
        });
      } else {
        setTempWeeklyHours({
          monday: { open: openBase, close: closeBase, is_closed: false },
          tuesday: { open: openBase, close: closeBase, is_closed: false },
          wednesday: { open: openBase, close: closeBase, is_closed: false },
          thursday: { open: openBase, close: closeBase, is_closed: false },
          friday: { open: openBase, close: closeBase, is_closed: false },
          saturday: { open: openBase, close: closeBase, is_closed: false },
          sunday: { open: '10:00', close: '18:00', is_closed: false },
        });
      }
    }
  }, [activeProvider]);

  const handleApplyToEntireWeek = () => {
    const updated: WeeklyHours = {
      monday: { open: bulkOpenTime, close: bulkCloseTime, is_closed: false },
      tuesday: { open: bulkOpenTime, close: bulkCloseTime, is_closed: false },
      wednesday: { open: bulkOpenTime, close: bulkCloseTime, is_closed: false },
      thursday: { open: bulkOpenTime, close: bulkCloseTime, is_closed: false },
      friday: { open: bulkOpenTime, close: bulkCloseTime, is_closed: false },
      saturday: { open: bulkOpenTime, close: bulkCloseTime, is_closed: false },
      sunday: { open: bulkOpenTime, close: bulkCloseTime, is_closed: false },
    };
    setTempWeeklyHours(updated);
    setRecentNotification(`Applied ${bulkOpenTime} - ${bulkCloseTime} across all 7 days of the week`);
  };

  const handleApplyPreset = (preset: 'standard' | 'extended' | 'clinic' | 'sunday_closed') => {
    if (preset === 'standard') {
      setBulkOpenTime('09:00');
      setBulkCloseTime('21:00');
      setTempWeeklyHours({
        monday: { open: '09:00', close: '21:00', is_closed: false },
        tuesday: { open: '09:00', close: '21:00', is_closed: false },
        wednesday: { open: '09:00', close: '21:00', is_closed: false },
        thursday: { open: '09:00', close: '21:00', is_closed: false },
        friday: { open: '09:00', close: '21:00', is_closed: false },
        saturday: { open: '09:00', close: '21:00', is_closed: false },
        sunday: { open: '09:00', close: '21:00', is_closed: false },
      });
      setRecentNotification('Loaded Standard Shift: 09:00 - 21:00 for all days');
    } else if (preset === 'sunday_closed') {
      setTempWeeklyHours((prev) => ({
        ...prev,
        sunday: { ...prev.sunday, is_closed: true },
      }));
      setRecentNotification('Sunday marked as Closed');
    } else if (preset === 'clinic') {
      setTempWeeklyHours({
        monday: { open: '10:00', close: '18:00', is_closed: false },
        tuesday: { open: '10:00', close: '18:00', is_closed: false },
        wednesday: { open: '10:00', close: '18:00', is_closed: false },
        thursday: { open: '10:00', close: '18:00', is_closed: false },
        friday: { open: '10:00', close: '18:00', is_closed: false },
        saturday: { open: '10:00', close: '14:00', is_closed: false },
        sunday: { open: '10:00', close: '14:00', is_closed: true },
      });
      setRecentNotification('Loaded Clinic Shift: Mon-Fri 10:00-18:00, Sat Half-day, Sun Closed');
    } else if (preset === 'extended') {
      setBulkOpenTime('08:00');
      setBulkCloseTime('22:00');
      setTempWeeklyHours({
        monday: { open: '08:00', close: '22:00', is_closed: false },
        tuesday: { open: '08:00', close: '22:00', is_closed: false },
        wednesday: { open: '08:00', close: '22:00', is_closed: false },
        thursday: { open: '08:00', close: '22:00', is_closed: false },
        friday: { open: '08:00', close: '22:00', is_closed: false },
        saturday: { open: '08:00', close: '22:00', is_closed: false },
        sunday: { open: '08:00', close: '22:00', is_closed: false },
      });
      setRecentNotification('Loaded Extended Shift: 08:00 - 22:00 for all days');
    }
  };

  const handleDayToggleClosed = (dayKey: DayOfWeek) => {
    setTempWeeklyHours((prev) => ({
      ...prev,
      [dayKey]: {
        ...prev[dayKey],
        is_closed: !prev[dayKey].is_closed,
      },
    }));
  };

  const handleDayTimeChange = (dayKey: DayOfWeek, field: 'open' | 'close', value: string) => {
    setTempWeeklyHours((prev) => ({
      ...prev,
      [dayKey]: {
        ...prev[dayKey],
        [field]: value,
      },
    }));
  };

  const handleCopyDayToAll = (sourceDayKey: DayOfWeek) => {
    const source = tempWeeklyHours[sourceDayKey];
    const updated: WeeklyHours = {
      monday: { ...source },
      tuesday: { ...source },
      wednesday: { ...source },
      thursday: { ...source },
      friday: { ...source },
      saturday: { ...source },
      sunday: { ...source },
    };
    setTempWeeklyHours(updated);
    setRecentNotification(`Copied ${DAYS_OF_WEEK.find(d => d.key === sourceDayKey)?.label} schedule to all 7 days`);
  };

  const isShopActive = overrideIsActive !== null ? overrideIsActive : (activeProvider?.is_active ?? true);
  const autoAccept = overrideAutoAccept !== null ? overrideAutoAccept : (activeProvider?.auto_accept_bookings ?? true);
  const dailyLimit = overrideDailyLimit !== null ? overrideDailyLimit : (activeProvider?.daily_booking_limit ?? 50);

  const handleToggleShopActive = async () => {
    if (!activeProvider || isUpdatingOperational) return;
    const nextActive = !isShopActive;
    setIsUpdatingOperational(true);
    setOverrideIsActive(nextActive);
    setProviders((prev) => {
      if (prev.some((p) => p.id === activeProvider.id)) {
        return prev.map((p) => (p.id === activeProvider.id ? { ...p, is_active: nextActive } : p));
      }
      return [...prev, { ...activeProvider, is_active: nextActive }];
    });
    setRecentNotification(`${venueLabel} is now ${nextActive ? 'Active (Accepting Appointments)' : 'Paused (Offline)'}`);
    try {
      const { error } = await supabase
        .from('providers')
        .update({ is_active: nextActive })
        .eq('id', activeProvider.id);
      if (error) throw error;
      await refreshTenant();
    } catch (err) {
      console.error('Failed to toggle shop active status:', err);
      setErrorMessage(`Failed to update ${venueLabel} status. Reverting change.`);
      setOverrideIsActive(!nextActive);
      loadData();
    } finally {
      setIsUpdatingOperational(false);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeProvider || isUpdatingOperational) return;
    setIsUpdatingOperational(true);
    setOverrideAutoAccept(tempAutoAccept);
    setOverrideDailyLimit(tempDailyLimit);
    setProviders((prev) => {
      if (prev.some((p) => p.id === activeProvider.id)) {
        return prev.map((p) =>
          p.id === activeProvider.id
            ? { ...p, auto_accept_bookings: tempAutoAccept, daily_booking_limit: tempDailyLimit }
            : p
        );
      }
      return [...prev, { ...activeProvider, auto_accept_bookings: tempAutoAccept, daily_booking_limit: tempDailyLimit }];
    });
    setShowSettingsModal(false);
    setRecentNotification(`Booking settings updated: Auto-accept ${tempAutoAccept ? 'ON' : 'OFF'} • Daily Limit: ${tempDailyLimit}`);
    try {
      const { error } = await supabase
        .from('providers')
        .update({
          auto_accept_bookings: tempAutoAccept,
          daily_booking_limit: tempDailyLimit,
        })
        .eq('id', activeProvider.id);
      if (error) throw error;
      await refreshTenant();
    } catch (err) {
      console.error('Failed to save booking settings:', err);
      setErrorMessage('Failed to save settings.');
      loadData();
    } finally {
      setIsUpdatingOperational(false);
    }
  };

  const handleSaveHours = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeProvider || isUpdatingOperational) return;
    setIsUpdatingOperational(true);

    const { todayKey, tomorrowKey } = getKolkataDayKeys();
    const todaySched = tempWeeklyHours[todayKey] || tempWeeklyHours.monday;
    const newOpen = todaySched.open.length === 5 ? `${todaySched.open}:00` : todaySched.open;
    const newClose = todaySched.close.length === 5 ? `${todaySched.close}:00` : todaySched.close;

    setProviders((prev) => {
      if (prev.some((p) => p.id === activeProvider.id)) {
        return prev.map((p) =>
          p.id === activeProvider.id
            ? { ...p, weekly_hours: tempWeeklyHours, opening_time: newOpen, closing_time: newClose }
            : p
        );
      }
      return [...prev, { ...activeProvider, weekly_hours: tempWeeklyHours, opening_time: newOpen, closing_time: newClose }];
    });

    setShowHoursModal(false);
    const todayName = DAYS_OF_WEEK.find((d) => d.key === todayKey)?.short || 'Today';
    setRecentNotification(`Weekly schedule updated! ${todayName}: ${todaySched.is_closed ? 'Closed' : `${todaySched.open} - ${todaySched.close} IST`}`);

    try {
      const { error } = await supabase
        .from('providers')
        .update({
          weekly_hours: tempWeeklyHours as any,
          opening_time: newOpen,
          closing_time: newClose,
        })
        .eq('id', activeProvider.id);
      if (error) throw error;
      await refreshTenant();
    } catch (err) {
      console.error('Failed to save weekly operating hours:', err);
      setErrorMessage('Failed to save weekly operating hours.');
      loadData();
    } finally {
      setIsUpdatingOperational(false);
    }
  };

  const getOperatingHoursStatus = (provider?: Provider | null) => {
    const { todayKey, tomorrowKey } = getKolkataDayKeys();
    const weekly = (provider?.weekly_hours as WeeklyHours | undefined) || tempWeeklyHours;

    const format12h = (t: string) => {
      const [h, m] = (t || '09:00').split(':').map(Number);
      const period = (h || 0) >= 12 ? 'PM' : 'AM';
      const h12 = (h || 0) % 12 || 12;
      return `${h12}:${(m || 0) < 10 ? '0' + (m || 0) : m} ${period}`;
    };

    const todaySched = weekly?.[todayKey] || {
      open: (provider?.opening_time || '09:00:00').slice(0, 5),
      close: (provider?.closing_time || '21:00:00').slice(0, 5),
      is_closed: false,
    };

    const tomorrowSched = weekly?.[tomorrowKey] || {
      open: (provider?.opening_time || '09:00:00').slice(0, 5),
      close: (provider?.closing_time || '21:00:00').slice(0, 5),
      is_closed: false,
    };

    const now = new Date();
    const kolkataStr = now.toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour12: false });
    const [nowH, nowM] = kolkataStr.split(':').map(Number);
    const nowMinutes = (nowH || 0) * 60 + (nowM || 0);

    const [openH, openM] = (todaySched.open || '09:00').split(':').map(Number);
    const openMinutes = (openH || 9) * 60 + (openM || 0);

    const [closeH, closeM] = (todaySched.close || '21:00').split(':').map(Number);
    const closeMinutes = (closeH || 21) * 60 + (closeM || 0);

    const todayName = DAYS_OF_WEEK.find((d) => d.key === todayKey)?.short || 'Today';
    const tomorrowName = DAYS_OF_WEEK.find((d) => d.key === tomorrowKey)?.short || 'Tomorrow';

    if (todaySched.is_closed) {
      return {
        isOpen: false,
        todayClosed: true,
        openFormatted: format12h(todaySched.open),
        closeFormatted: format12h(todaySched.close),
        badgeText: `Closed Today (${todayName})`,
        tomorrowPreview: tomorrowSched.is_closed
          ? `${tomorrowName}: Closed`
          : `${tomorrowName}: ${format12h(tomorrowSched.open)} - ${format12h(tomorrowSched.close)}`,
      };
    }

    const isOpen = nowMinutes >= openMinutes && nowMinutes < closeMinutes;

    return {
      isOpen,
      todayClosed: false,
      openFormatted: format12h(todaySched.open),
      closeFormatted: format12h(todaySched.close),
      badgeText: isOpen 
        ? `Open Now (${format12h(todaySched.open)} - ${format12h(todaySched.close)})`
        : nowMinutes < openMinutes
        ? `Closed (Opens ${format12h(todaySched.open)} Today)`
        : `Closed for Today (Opens ${format12h(tomorrowSched.open)} ${tomorrowName})`,
      tomorrowPreview: tomorrowSched.is_closed
        ? `${tomorrowName}: Closed`
        : `${tomorrowName}: ${format12h(tomorrowSched.open)} - ${format12h(tomorrowSched.close)}`,
    };
  };

  const hoursStatus = getOperatingHoursStatus(activeProvider);

  // If authenticated but no venue (first time user), automatically redirect to venue registration
  useEffect(() => {
    if (!isTenantLoading && !loading && isAuthenticated && !activeProvider && !isSuperAdmin && !errorMessage) {
      const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
      if (params?.get('demo') !== '1') {
        window.location.href = '/register';
      }
    }
  }, [isTenantLoading, loading, isAuthenticated, activeProvider, isSuperAdmin, errorMessage]);

  const loadData = useCallback(async () => {
    const version = ++loadVersion.current;
    const isDemoMode = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('demo') === '1';
    if (isTenantLoading && !isDemoMode) return;
    if (!isAuthenticated && !isDemoMode) {
      setLoading(false);
      return;
    }
    if (!selectedProviderId && !isSuperAdmin && !isDemoMode) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setErrorMessage(null);
    try {
      let query = supabase.from('providers').select('*, resources(*)').order('name');
      if (!isSuperAdmin && selectedProviderId) query = query.eq('id', selectedProviderId);
      const { data: fetchedProviders, error: providerError } = await query;
      if (providerError && !isDemoMode) throw providerError;
      if (version !== loadVersion.current) return;

      const activeList = (fetchedProviders && fetchedProviders.length > 0)
        ? (fetchedProviders as (Provider & { resources?: Resource[] })[])
        : isDemoMode
        ? [DEMO_PROVIDER]
        : [];

      setProviders(activeList);
      const targetProviderId = selectedProviderId || activeList[0]?.id;
      const initialDoctorMap: Record<string, boolean> = {};
      activeList.forEach((prov: any) => {
        (prov.resources || []).forEach((r: any) => {
          initialDoctorMap[r.id] = Boolean(r.attributes?.doctor_left);
        });
      });
      setDoctorLeftMap((prev) => ({ ...initialDoctorMap, ...prev }));

      if (!targetProviderId) {
        setBookings([]);
        return;
      }
      if (!selectedProviderId) {
        setSelectedProviderId(targetProviderId);
      }

      let bookingsData: any[] = [];
      const { data, error } = await (supabase as any).from('merchant_bookings')
        .select('*')
        .eq('provider_id', targetProviderId)
        .order('slot_start', { ascending: true });

      if (error && !isDemoMode) throw error;
      if (data && data.length > 0) {
        bookingsData = data;
      } else if (isDemoMode) {
        bookingsData = getDemoBookings(targetProviderId, activeList[0]?.resources || []);
      }

      if (version !== loadVersion.current) return;
      setBookings(bookingsData.map((booking: any) => ({
        ...booking,
        customer_name: booking.customer_name || 'Walk-in / Guest',
        customer_phone: booking.customer_phone || 'Not provided',
        no_show_count: booking.no_show_count ?? 0,
        resource_name: booking.resource_name || 'Standard Unit',
        resource_type: booking.resource_type || 'slot',
        provider_name: booking.provider_name || 'Merchant Venue',
      })));
    } catch {
      if (version === loadVersion.current) {
        setErrorMessage('Unable to refresh the dashboard. Displayed data may be out of date. Please retry.');
      }
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  }, [isSuperAdmin, selectedProviderId, isAuthenticated, isTenantLoading]);

  useEffect(() => {
    void loadData();
    return () => { loadVersion.current += 1; };
  }, [loadData]);



  useEffect(() => {
    setIsLiveConnected(false);
    setRecentNotification(null);
    if (!selectedProviderId || !isAuthenticated || isTenantLoading) return;
    let active = true;
    let notificationTimer: ReturnType<typeof setTimeout> | undefined;
    const channel = supabase
      .channel(`overview-bookings-${selectedProviderId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bookings', filter: `provider_id=eq.${selectedProviderId}` },
        async (payload) => {
          if (!active) return;
          const eventType = payload.eventType;
          const newRec = payload.new as any;
          const oldRec = payload.old as any;
          const newStatus = newRec?.status;
          setRecentNotification(`Realtime update: Booking ${newStatus || 'updated'}`);

          if (eventType === 'DELETE' && oldRec?.id) {
            setBookings((prev) => prev.filter((b) => b.id !== oldRec.id));
          } else if (newRec?.id) {
            // If joined fields are missing, fetch only the one changed row by id instead of reloading the list
            const hasJoinedFields = Boolean(newRec.customer_name && newRec.resource_name);
            if (!hasJoinedFields) {
              const fullRow = await fetchMerchantBookingById(newRec.id);
              if (active) {
                if (fullRow) {
                  setBookings((prev) => {
                    const exists = prev.some((b) => b.id === fullRow.id);
                    return exists
                      ? prev.map((b) => (b.id === fullRow.id ? { ...b, ...fullRow } : b))
                      : [fullRow, ...prev];
                  });
                } else {
                  setBookings((prev) => {
                    const exists = prev.some((b) => b.id === newRec.id);
                    return exists
                      ? prev.map((b) => (b.id === newRec.id ? { ...b, ...newRec } : b))
                      : [newRec, ...prev];
                  });
                }
              }
            } else {
              setBookings((prev) => {
                const exists = prev.some((b) => b.id === newRec.id);
                return exists
                  ? prev.map((b) => (b.id === newRec.id ? { ...b, ...newRec } : b))
                  : [newRec, ...prev];
              });
            }
          }

          clearTimeout(notificationTimer);
          notificationTimer = setTimeout(() => setRecentNotification(null), 5000);
        }
      )
      .subscribe((status) => {
        if (active) setIsLiveConnected(status === 'SUBSCRIBED');
      });

    return () => {
      active = false;
      clearTimeout(notificationTimer);
      void supabase.removeChannel(channel);
    };
  }, [selectedProviderId, isAuthenticated, isTenantLoading]);

  // Venue Appointment Metrics
  const todaysBookings = bookings.filter((booking) => booking.provider_id === selectedProviderId &&
    new Date(booking.slot_start).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) === today);
  const confirmedCount = todaysBookings.filter((b) => b.status === 'CONFIRMED' || b.status === 'CHECKED_IN').length;
  const heldCount = todaysBookings.filter((b) => b.status === 'HELD').length;
  const completedCount = todaysBookings.filter((b) => b.status === 'COMPLETED').length;
  const totalDepositCollected = todaysBookings
    .filter((b) => b.payment_status === 'CAPTURED')
    .reduce((acc, curr) => acc + Number(curr.deposit_amount), 0);

  const handleAdmitPatient = async (bookingId: string) => {
    if (pendingBookingId) return;
    setPendingBookingId(bookingId);
    setErrorMessage(null);
    try {
      const isDemoMode = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('demo') === '1';
      if (isDemoMode) {
        setBookings((prev) =>
          prev.map((b) =>
            b.id === bookingId
              ? {
                  ...b,
                  is_present: true,
                  status: 'CHECKED_IN',
                  customer_arrived_at: new Date().toISOString(),
                  checked_in_at: new Date().toISOString(),
                }
              : b
          )
        );
        const patient = bookings.find((b) => b.id === bookingId);
        setRecentNotification(`✓ Admitted: ${patient?.customer_name || 'Patient'} is now marked Present in OPD.`);
        return;
      }

      const res = await admitPatient(bookingId);
      if (res.success) {
        setRecentNotification(`✓ Patient admitted and marked Present in OPD.`);
        await loadData();
      } else {
        setErrorMessage(res.error || 'Failed to admit patient');
      }
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Error admitting patient');
    } finally {
      setPendingBookingId(null);
    }
  };

  const handleStatusChange = async (
    bookingId: string, 
    newStatus: 'COMPLETED' | 'NO_SHOW' | 'CANCELLED'
  ) => {
    if (pendingBookingId) return;
    setPendingBookingId(bookingId);
    setErrorMessage(null);
    try {
      const isDemoMode = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('demo') === '1';
      if (isDemoMode) {
        setBookings((prev) =>
          prev.map((b) =>
            b.id === bookingId
              ? {
                  ...b,
                  status: newStatus,
                  is_present: newStatus === 'COMPLETED' ? b.is_present : false,
                }
              : b
          )
        );
        setRecentNotification(
          newStatus === 'COMPLETED'
            ? '✓ Consultation marked as Completed.'
            : newStatus === 'NO_SHOW'
            ? '✕ Marked as No-Show.'
            : '✓ Status updated.'
        );
        return;
      }

      const result = newStatus === 'NO_SHOW'
        ? await recordMerchantNoShow(bookingId)
        : await updateBookingStatus(bookingId, newStatus);
      const confirmed = Array.isArray(result)
        ? (result as Array<Record<string, unknown>>).some(
            (row) => row && typeof row === 'object' && row.id === bookingId && row.status === newStatus
          )
        : Boolean(result) && typeof result === 'object' && 'success' in (result as Record<string, unknown>) &&
          (result as Record<string, unknown>).success === true;
      if (!confirmed) {
        throw new Error('The booking update was not confirmed.');
      }
      setRecentNotification(
        newStatus === 'COMPLETED'
          ? '✓ Consultation marked as Completed.'
          : newStatus === 'NO_SHOW'
          ? '✕ Marked as No-Show.'
          : '✓ Status updated.'
      );
      await loadData();
    } catch {
      setErrorMessage('Unable to confirm the booking update. Refresh to check its status before retrying.');
    } finally {
      setPendingBookingId(null);
    }
  };

  const handleLateQueueAction = async (bookingId: string, action: 'MOVE_TO_STANDBY' | 'CHECKIN_LATE') => {
    if (pendingBookingId) return;
    setPendingBookingId(bookingId);
    try {
      const isDemoMode = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('demo') === '1';
      if (isDemoMode) {
        setBookings((prev) =>
          prev.map((b) =>
            b.id === bookingId
              ? {
                  ...b,
                  is_present: true,
                  queue_position: action === 'CHECKIN_LATE' ? (b.queue_position || 1) : undefined,
                  customer_arrived_at: new Date().toISOString(),
                }
              : b
          )
        );
        setRecentNotification(
          action === 'CHECKIN_LATE'
            ? '✓ Late check-in assigned: Placed in Standby Queue in booking order'
            : '⏳ Patient moved to Standby Queue.'
        );
        return;
      }

      const res = await manageLateQueueBooking(bookingId, action);
      if (res.success) {
        if (action === 'CHECKIN_LATE') {
          setRecentNotification(`✓ Late check-in assigned: Placed in Standby Queue in booking order (Token #${res.queue_position}, ~${res.estimated_wait_minutes}m wait)`);
        } else {
          setRecentNotification('⏳ Patient moved to Standby Queue until physical arrival.');
        }
        await loadData();
      } else {
        setErrorMessage(res.error || 'Failed to update late queue');
      }
    } catch {
      setErrorMessage('Network error updating late queue');
    } finally {
      setPendingBookingId(null);
    }
  };

  const handleVerifyCheckinCode = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const code = checkinCodeInput.trim();
    if (!code) return;
    if (!selectedProviderId) {
      setCheckinErrorMessage('Please select an active venue to verify check-in code');
      return;
    }

    setIsVerifyingCheckin(true);
    setCheckinErrorMessage(null);
    setCheckinSuccessData(null);

    try {
      const isDemoMode = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('demo') === '1';
      if (isDemoMode) {
        const waitingBooking = bookings.find((b) => !b.is_present && b.status !== 'NO_SHOW' && b.status !== 'CANCELLED');
        if (waitingBooking) {
          setBookings((prev) =>
            prev.map((b) =>
              b.id === waitingBooking.id
                ? { ...b, is_present: true, status: 'CHECKED_IN', checked_in_at: new Date().toISOString() }
                : b
            )
          );
          setCheckinSuccessData({
            booking_id: waitingBooking.id,
            patient_name: waitingBooking.customer_name,
            service_doctor: waitingBooking.resource_name,
            slot_time: new Date(waitingBooking.slot_start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            is_late: false,
            checked_in_at: new Date().toISOString(),
          });
          setCheckinCodeInput('');
          setRecentNotification(`Checked in: ${waitingBooking.customer_name} (${waitingBooking.resource_name})`);
          return;
        }
      }

      const res = await verifyCheckinCodeRpc(selectedProviderId, code);
      if (res.success) {
        setCheckinSuccessData({
          booking_id: res.booking_id,
          patient_name: res.patient_name,
          service_doctor: res.service_doctor,
          slot_time: res.slot_time,
          is_late: res.is_late,
          checked_in_at: res.checked_in_at,
        });
        setCheckinCodeInput('');
        setRecentNotification(`Checked in: ${res.patient_name || 'Patient'} (${res.service_doctor || 'Appointment'})`);
        void loadData();
      } else {
        let msg = res.message || 'Check-in failed';
        if (res.error === 'INVALID_CODE') {
          msg = 'Invalid check-in code. Please verify the code with the customer.';
        } else if (res.error === 'ALREADY_CHECKED_IN') {
          msg = 'This appointment is already checked in.';
        } else if (res.error === 'TOO_EARLY') {
          msg = 'Check-in is only allowed within 60 minutes before the scheduled slot.';
        } else if (res.error === 'EXPIRED') {
          msg = 'This appointment date or check-in window has expired.';
        } else if (res.error === 'WRONG_SHOP') {
          msg = 'This check-in code belongs to another clinic or venue.';
        } else if (res.error === 'RATE_LIMITED') {
          msg = 'Too many failed attempts. Check-in is locked for 60 seconds.';
        }
        setCheckinErrorMessage(msg);
      }
    } catch (err: unknown) {
      setCheckinErrorMessage(err instanceof Error ? err.message : 'Check-in failed');
    } finally {
      setIsVerifyingCheckin(false);
      checkinInputRef.current?.focus();
    }
  };

  const handleToggleDoctorDeparture = async (resourceId: string, currentLeft: boolean) => {
    if (!activeProvider) return;
    const nextStatus = !currentLeft;
    // Optimistic local state update
    setDoctorLeftMap((prev) => ({ ...prev, [resourceId]: nextStatus }));
    const isDemoMode = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('demo') === '1';
    try {
      const { data: authData } = await supabase.auth.getSession();
      const token = authData?.session?.access_token;
      const res = await fetch('/api/merchant/doctor-status', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: 'include',
        body: JSON.stringify({
          provider_id: activeProvider.id,
          resource_id: resourceId,
          doctor_left: nextStatus,
        }),
      });
      const json = await res.json().catch(() => null);
      if (json?.success) {
        setRecentNotification(
          `✓ ${json.doctor_name || 'Doctor'} is now marked as ${nextStatus ? 'Left Hospital (Shift Ended)' : 'On Duty (In Clinic)'}`
        );
        void loadData();
      } else if (isDemoMode) {
        setRecentNotification(
          `✓ Doctor shift updated: ${nextStatus ? 'Left Hospital (Shift Ended)' : 'On Duty (In Clinic)'}`
        );
      } else {
        setDoctorLeftMap((prev) => ({ ...prev, [resourceId]: currentLeft }));
        setErrorMessage(json?.error || 'Failed to update doctor status');
      }
    } catch {
      if (isDemoMode) {
        setRecentNotification(
          `✓ Doctor shift updated: ${nextStatus ? 'Left Hospital (Shift Ended)' : 'On Duty (In Clinic)'}`
        );
      } else {
        setDoctorLeftMap((prev) => ({ ...prev, [resourceId]: currentLeft }));
        setErrorMessage('Network error updating doctor status');
      }
    }
  };

  const handleCreateOfflineBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeProvider || !offlineName.trim()) {
      setErrorMessage('Please enter the patient full name');
      return;
    }
    const selectedDocId = offlineDoctorId || (activeResources[0]?.id || '');
    if (!selectedDocId) {
      setErrorMessage('Please select a doctor');
      return;
    }

    setIsSubmittingOffline(true);
    setErrorMessage(null);
    try {
      const { data: authData } = await supabase.auth.getSession();
      const token = authData?.session?.access_token;
      const res = await fetch('/api/bookings/offline', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          provider_id: activeProvider.id,
          resource_id: selectedDocId,
          patient_name: offlineName.trim(),
          patient_phone: offlinePhone.trim(),
          slot_start_time: offlineTimeOption === 'custom' ? offlineCustomTime : 'now',
          is_present: offlineMarkPresent,
        }),
      });
      const json = await res.json();
      if (json.success) {
        setRecentNotification(
          `✓ Offline Walk-In booked for ${json.patient_name} (${json.doctor_name})! Slot: ${new Date(json.slot_start).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}. PIN: ${json.pin}`
        );
        setShowOfflineModal(false);
        setOfflineName('');
        setOfflinePhone('');
        setOfflineCustomTime('');
        await loadData();
      } else {
        setErrorMessage(json.error || 'Failed to book offline patient');
      }
    } catch {
      setErrorMessage('Network error booking offline patient');
    } finally {
      setIsSubmittingOffline(false);
    }
  };

  if ((isTenantLoading && !isDemo) || (loading && !activeProvider && !isSuperAdmin && !isDemo)) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center gap-3">
        <RefreshCw className="w-8 h-8 text-emerald-600 animate-spin" />
        <p className="text-sm font-medium text-slate-500">Loading merchant workspace...</p>
      </div>
    );
  }

  if (!isAuthenticated && !isDemo && typeof window !== 'undefined') {
    return null;
  }

  if (!loading && !activeProvider && !isSuperAdmin && !isDemo) {
    if (typeof window !== 'undefined') {
      window.location.href = '/register';
    }
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center gap-3">
        <RefreshCw className="w-8 h-8 text-emerald-600 animate-spin" />
        <p className="text-sm font-medium text-slate-500">Redirecting to venue registration...</p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Floating Bottom Corner Toast Notification (Zero layout shift) */}
      {recentNotification && (
        <div
          role="status"
          aria-live="polite"
          data-testid="doctor-status-toast"
          className="fixed bottom-6 right-6 z-50 max-w-sm w-auto bg-slate-900/95 text-white backdrop-blur-md px-4 py-3 rounded-xl shadow-xl border border-slate-700/60 flex items-center justify-between gap-3 animate-in fade-in slide-in-from-bottom-2 duration-200 pointer-events-auto"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <Sparkles className="w-4 h-4 text-emerald-400 shrink-0" />
            <span className="text-xs sm:text-sm font-medium text-slate-100">{recentNotification}</span>
          </div>
          <button
            onClick={() => setRecentNotification(null)}
            className="text-slate-400 hover:text-white p-1 rounded-md transition-colors shrink-0 ml-2"
            aria-label="Dismiss notification"
          >
            ✕
          </button>
        </div>
      )}

      {/* Error Banner */}
      {errorMessage && (
        <div
          data-testid="dashboard-error-banner"
          role="alert"
          className="bg-rose-50 border-2 border-rose-300 text-rose-900 px-4 py-3 rounded-xl flex items-center justify-between gap-3 text-sm shadow-xs"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            <span className="font-semibold">{errorMessage}</span>
          </div>
          <button
            onClick={() => loadData()}
            disabled={loading}
            className="px-3 py-1.5 rounded-lg text-xs font-bold bg-rose-600 text-white hover:bg-rose-700 transition disabled:opacity-60"
          >
            Retry
          </button>
        </div>
      )}

      {/* Suspended Alert Banner */}
      {activeProvider?.status === 'SUSPENDED' && (
        <div
          data-testid="merchant-suspended-banner"
          className="bg-rose-50 border-2 border-rose-300 text-rose-950 p-6 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-sm"
        >
          <div className="flex items-start sm:items-center gap-3.5">
            <div className="p-2.5 rounded-xl bg-rose-100 text-rose-700 shrink-0">
              <AlertTriangle className="w-6 h-6 text-rose-600" />
            </div>
            <div>
              <h3 className="text-base font-bold text-rose-900 flex items-center gap-2">
                Account Suspended & Blocked by Platform Administration
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-rose-200 text-rose-800 uppercase tracking-wider">
                  Blocked by Admin
                </span>
              </h3>
              <p className="text-xs sm:text-sm text-rose-700 mt-1">
                This business ({activeProvider?.name}) has been suspended by Platform Administration.
                New customer bookings, calendar appointments, and search visibility are paused.
              </p>
            </div>
          </div>
          <div className="shrink-0">
            <span className="inline-flex items-center px-3.5 py-2 rounded-xl text-xs font-bold bg-rose-600 text-white shadow-xs">
              Bookings Paused
            </span>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* DEDICATED VENUE OVERVIEW & APPOINTMENT HUB                                */}
      {/* ========================================================================= */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">{activeProvider?.name}</h2>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">
              <ShieldCheck className="w-3.5 h-3.5 mr-1 text-emerald-600" />
              Tirupati Active
            </span>
            {isLiveConnected && (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-sky-100 text-sky-800">
                <span className="w-1.5 h-1.5 rounded-full bg-sky-500 mr-1.5 animate-ping" />
                Live Synced
              </span>
            )}
          </div>
          <p className="text-xs sm:text-sm text-slate-600 mt-1 flex items-center gap-2">
            <MapPin className="w-4 h-4 text-slate-400 flex-shrink-0" />
            {activeProvider?.address}, {activeProvider?.city} • Hours: {activeProvider?.opening_time?.slice(0, 5)} - {activeProvider?.closing_time?.slice(0, 5)} IST
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Provider Space Badge */}
          {isLocked ? (
            <div 
              data-testid="locked-tenant-badge"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-bold text-emerald-800"
            >
              <Building2 className="w-3.5 h-3.5 text-emerald-600" />
              <span>Verified Merchant Space</span>
            </div>
          ) : (
            <div className="relative">
              <label htmlFor="provider-select" className="sr-only">Switch Business</label>
              <select
                id="provider-select"
                value={selectedProviderId}
                onChange={(e) => {
                  setSelectedProviderId(e.target.value);
                  switchActiveProvider(e.target.value);
                }}
                className="bg-slate-50 border border-slate-300 text-slate-800 text-xs font-semibold rounded-xl px-3 py-2 pr-8 focus:ring-2 focus:ring-emerald-500 focus:outline-none cursor-pointer"
              >
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <Link
            href="/venues"
            className="inline-flex items-center px-3.5 py-2 rounded-xl text-xs font-bold text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 transition-colors shadow-xs"
          >
            <Building2 className="w-3.5 h-3.5 mr-1.5 text-emerald-600" />
            {isLocked ? 'My Venue Profile' : 'Manage Venue'}
          </Link>

          <Link
            href="/resources"
            className="inline-flex items-center px-3.5 py-2 rounded-xl text-xs font-bold text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 transition-colors shadow-xs"
          >
            <Plus className="w-3.5 h-3.5 mr-1.5 text-emerald-600" />
            Add {verticalConfig.resourceLabelSingular}
          </Link>

          <Link
            href="/schedule"
            className="inline-flex items-center px-3.5 py-2 rounded-xl text-xs font-bold text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 transition-colors shadow-xs"
          >
            <Clock className="w-3.5 h-3.5 mr-1.5 text-emerald-600" />
            Shift Hours
          </Link>

          <button
            onClick={() => loadData()}
            disabled={loading}
            className="p-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 transition"
            title="Refresh Live Data"
            aria-label="Refresh Supabase Bookings Data"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-emerald-600' : ''}`} />
          </button>

          <Link
            href="/bookings"
            className="inline-flex items-center px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-700 transition shadow-sm"
          >
            Full Queue
            <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
          </Link>
        </div>
      </div>


      {/* ========================================================================= */}
      {/* OPERATIONAL STATUS & CAPACITY CONTROL BAR                                */}
      {/* ========================================================================= */}
      {/* ========================================================================= */}
      {/* OPERATIONAL STATUS & CAPACITY CONTROL BAR (DARK ZONE)                    */}
      {/* ========================================================================= */}
      <div 
        className="rounded-2xl p-4 sm:p-5 shadow-lg flex flex-col lg:flex-row lg:items-center justify-between gap-4 border"
        style={{
          backgroundColor: '#0f1f17',
          color: '#d1fae5',
          borderColor: 'rgba(4, 120, 87, 0.35)',
          boxShadow: '0 4px 20px rgba(15, 31, 23, 0.4)',
        }}
      >
        {/* Left: Active Toggle & Live Venue Status */}
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-3">
            <span className="text-[11px] font-mono uppercase tracking-wider text-emerald-400/80">{venueLabel} Ops</span>
            <button
              type="button"
              data-testid="shop-active-toggle"
              role="switch"
              aria-checked={isShopActive}
              disabled={isUpdatingOperational}
              onClick={handleToggleShopActive}
              className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-2 focus:ring-offset-slate-900 disabled:opacity-50 ${
                isShopActive ? 'bg-emerald-600' : 'bg-slate-700'
              }`}
            >
              <span className="sr-only">Toggle {venueLabel} active status</span>
              <span
                aria-hidden="true"
                className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out flex items-center justify-center ${
                  isShopActive ? 'translate-x-5' : 'translate-x-0'
                }`}
              >
                <Power className={`w-3.5 h-3.5 ${isShopActive ? 'text-emerald-700' : 'text-slate-400'}`} />
              </span>
            </button>
            <span
              data-testid="shop-status-text"
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold font-mono tracking-wide ${
                isShopActive
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                  : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${isShopActive ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'}`} />
              {isShopActive ? `${venueLabel} Active (Accepting)` : `${venueLabel} Paused (Offline)`}
            </span>
          </div>

          <div className="h-5 w-px bg-emerald-900/60 hidden sm:block" />

          {/* Realtime Opening Hours Badge & Tomorrow Preview */}
          <div className="flex flex-wrap items-center gap-2">
            <div
              data-testid="shop-hours-badge"
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-medium border ${
                hoursStatus.isOpen
                  ? 'bg-emerald-950/80 text-emerald-300 border-emerald-700/60'
                  : 'bg-amber-950/80 text-amber-300 border-amber-700/60'
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              <span>{hoursStatus.badgeText}</span>
            </div>
            <span 
              data-testid="shop-tomorrow-preview"
              className="text-[11px] text-emerald-400/70 hidden sm:inline-block font-mono"
            >
              • {hoursStatus.tomorrowPreview}
            </span>
            <button
              type="button"
              onClick={() => setShowHoursModal(true)}
              data-testid="change-hours-btn"
              className="text-xs text-emerald-400 hover:text-emerald-200 font-semibold underline underline-offset-2 transition cursor-pointer"
              title="Edit Weekly Schedule & Tomorrow's Hours"
            >
              Change Hours
            </button>
          </div>
        </div>

        {/* Right: Auto-Accept Status & Daily Booking Limit */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 bg-black/40 px-3.5 py-1.5 rounded-xl border border-emerald-900/50">
            <Zap className={`w-4 h-4 ${autoAccept ? 'text-amber-400' : 'text-slate-400'}`} />
            <div className="text-xs">
              <span className="text-emerald-400/80">Auto-Accept: </span>
              <span
                data-testid="auto-accept-status-badge"
                className={`font-bold font-mono ${autoAccept ? 'text-emerald-300' : 'text-slate-400'}`}
              >
                {autoAccept ? 'ENABLED' : 'MANUAL'}
              </span>
            </div>
            <span className="text-emerald-800 text-xs">•</span>
            <div className="text-xs" data-testid="daily-limit-badge">
              <span className="text-emerald-400/80">Cap: </span>
              <span className="font-bold text-white font-mono">{confirmedCount}</span>
              <span className="text-emerald-400/70 font-mono">/{dailyLimit}</span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowSettingsModal(true)}
            data-testid="edit-booking-settings-button"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-emerald-950/80 hover:bg-emerald-900/90 text-emerald-200 hover:text-white border border-emerald-800/60 transition cursor-pointer"
          >
            <Settings className="w-3.5 h-3.5 text-emerald-400" />
            <span>Rules & Cap</span>
          </button>

          <button
            type="button"
            onClick={() => setShowOfflineModal(true)}
            data-testid="offline-patient-btn"
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white transition shadow-sm cursor-pointer"
            title="Book and admit an offline walk-in patient at clinic reception"
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>+ Walk-In</span>
          </button>
        </div>
      </div>

      {/* Warning Banners if Paused or Limit Reached */}
      {!isShopActive && (
        <div
          data-testid="shop-paused-alert-banner"
          className="bg-amber-50 border-2 border-amber-300 text-amber-950 p-4 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs"
        >
          <div className="flex items-center gap-3">
            <PauseCircle className="w-5 h-5 text-amber-600 shrink-0" />
            <div>
              <p className="text-sm font-bold">{venueLabel} Acceptance is Currently Paused</p>
              <p className="text-xs text-amber-800">
                New customer bookings are temporarily rejected with a polite offline notice. Existing confirmed appointments remain active.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleToggleShopActive}
            disabled={isUpdatingOperational}
            className="shrink-0 px-3.5 py-1.5 rounded-xl text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white transition shadow-xs"
          >
            Resume Accepting Bookings
          </button>
        </div>
      )}

      {confirmedCount >= dailyLimit && (
        <div
          data-testid="daily-limit-alert-banner"
          className="bg-rose-50 border-2 border-rose-300 text-rose-950 p-4 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs"
        >
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" />
            <div>
              <p className="text-sm font-bold">Daily Booking Capacity Reached ({confirmedCount}/{dailyLimit})</p>
              <p className="text-xs text-rose-800">
                Your daily threshold of {dailyLimit} appointments has been met. Slot reservation requests will be blocked until capacity is raised or tomorrow.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowSettingsModal(true)}
            className="shrink-0 px-3.5 py-1.5 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white transition shadow-xs"
          >
            Increase Capacity
          </button>
        </div>
      )}

      {isHospitalVenue ? (
        isUnassignedDoctorUrlProbe ? (
          <div data-testid="frontdesk-unassigned-doctor-forbidden" className="bg-white rounded-2xl border border-rose-200 p-8 text-center max-w-xl mx-auto my-12 shadow-sm space-y-4">
            <div className="w-14 h-14 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center mx-auto">
              <ShieldAlert className="w-8 h-8 text-rose-600" />
            </div>
            <h2 className="text-xl font-bold text-slate-900">403 Forbidden: Consultant Data Unreachable</h2>
            <p className="text-sm text-slate-600 leading-relaxed">
              You do not have authorization to access or view appointments for consultant ID <span className="font-mono font-bold text-rose-700">{urlDoctorId}</span>. Front Desk personnel can only access assigned consultant queues.
            </p>
            <button
              type="button"
              onClick={() => {
                const url = new URL(window.location.href);
                url.searchParams.delete('doctor_id');
                url.searchParams.delete('resource_id');
                window.history.replaceState({}, '', url.toString());
                setUrlDoctorId(null);
                setMerchantSelectedDoctorId('');
              }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition cursor-pointer"
            >
              Return to Your Assigned Consultants
            </button>
          </div>
        ) : hasNoAssignedDoctors ? (
          <div data-testid="frontdesk-no-assignments-forbidden" className="bg-white rounded-2xl border border-rose-200 p-8 text-center max-w-xl mx-auto my-12 shadow-sm space-y-4">
            <div className="w-14 h-14 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center mx-auto">
              <ShieldAlert className="w-8 h-8 text-rose-600" />
            </div>
            <h2 className="text-xl font-bold text-slate-900">Reception Access Restricted: No Assigned Doctors</h2>
            <p className="text-sm text-slate-600 leading-relaxed">
              You are signed in as Front Desk staff, but you have not been assigned to any consultant desks yet. Per hospital governance policy, you can only view and manage appointments for your assigned consultants.
            </p>
            <p className="text-xs text-slate-400">
              Please contact your Hospital Administrator to assign consultant queues to your account in the Team Management screen.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            <FrontDeskHeader
              userEmail={userEmail}
              role={hospitalContext?.role || (isHospitalAdmin ? 'admin' : 'front_desk')}
              hospitalName={activeProvider?.name}
              assignedDoctors={frontDeskAssignedDoctors}
              selectedDoctorId={merchantSelectedDoctorId}
              onSelectDoctor={setMerchantSelectedDoctorId}
              stats={frontDeskStats}
              onOpenDisplayModal={() => setIsDisplayModalOpen(true)}
            />

            <FastPassCheckinPanel
              onVerifyCode={handleFrontDeskVerifyCode}
              onOpenManualCheckin={() => {
                setIsManualCheckinModalOpen(true);
              }}
              selectedDoctorName={frontDeskAssignedDoctors.find((d) => d.id === merchantSelectedDoctorId)?.name}
            />

            <FrontDeskQueueTabs
              waitingBookings={hospitalWaitingBookings}
              standbyBookings={hospitalStandbyBookings}
              expectedBookings={hospitalExpectedBookings}
              completedBookings={hospitalCompletedBookings}
              inConsultationBookings={hospitalInConsultationBookings}
              upNextBookingId={upNextBookingId}
              onAdmitPatient={handleFrontDeskAdmitPatient}
              onStartConsultation={handleFrontDeskStartConsultation}
              onEndConsultation={handleFrontDeskEndConsultation}
              onManualMarkPresent={() => {
                setIsManualCheckinModalOpen(true);
              }}
              onMarkNoShow={handleFrontDeskMarkNoShow}
              isProcessingAction={isProcessingFrontDeskAction}
            />

            <ManualCheckinModal
              isOpen={isManualCheckinModalOpen}
              onClose={() => setIsManualCheckinModalOpen(false)}
              candidateBookings={candidateManualBookings}
              onConfirmManualCheckin={handleFrontDeskManualCheckin}
            />

            <WaitingLoungeDisplayModal
              isOpen={isDisplayModalOpen}
              onClose={() => setIsDisplayModalOpen(false)}
              hospitalName={activeProvider?.name}
              queueItems={displayQueueItems}
            />
          </div>
        )
      ) : (
        <>
          {/* KPI Stats Grid */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-2xs hover:shadow-xs hover:border-emerald-500/30 transition duration-150">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Confirmed</span>
            <div className="p-2 rounded-xl bg-emerald-50 text-emerald-700">
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-black text-slate-900 font-mono tabular-nums">{confirmedCount}</span>
            <span className="text-xs text-slate-500">slots booked</span>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-2xs hover:shadow-xs hover:border-amber-500/30 transition duration-150">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Hold In-Flight</span>
            <div className="p-2 rounded-xl bg-amber-50 text-amber-700">
              <Clock className="w-5 h-5 text-amber-600" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-black text-slate-900 font-mono tabular-nums">{heldCount}</span>
            <span className="text-xs text-amber-600 font-medium">checkout now</span>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-2xs hover:shadow-xs hover:border-emerald-500/30 transition duration-150">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Deposits Captured</span>
            <div className="p-2 rounded-xl bg-emerald-50 text-emerald-700">
              <TrendingUp className="w-5 h-5 text-emerald-600" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-black text-slate-900 font-mono tabular-nums">₹{totalDepositCollected.toLocaleString('en-IN')}</span>
            <span className="text-xs text-emerald-600 font-medium">secured funds</span>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-2xs hover:shadow-xs hover:border-slate-300 transition duration-150">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Active {verticalConfig.resourceLabelSingular}s</span>
            <div className="p-2 rounded-xl bg-slate-100 text-slate-700">
              <Users className="w-5 h-5 text-slate-600" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-black text-slate-900 font-mono tabular-nums">{activeResources.length}</span>
            <span className="text-xs text-slate-500">in rotation</span>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* RECEPTION CHECK-IN DESK (RAPIDO-STYLE CODE VERIFICATION)                 */}
      {/* ========================================================================= */}
      <div 
        data-testid="reception-checkin-panel"
        className="bg-white rounded-2xl border-2 border-emerald-500/30 p-5 sm:p-6 shadow-xs relative overflow-hidden"
      >
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-5">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-xl bg-emerald-50 text-emerald-700">
                <Ticket className="w-5 h-5 text-emerald-600" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900 tracking-tight flex items-center gap-2">
                  Reception Check-In Desk
                  <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 uppercase tracking-wider font-mono">
                    Fast Pass OTP
                  </span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Ask arriving customer for their 4-digit booking code to verify and mark present.
                </p>
              </div>
            </div>
          </div>

          {/* Form */}
          <form 
            onSubmit={handleVerifyCheckinCode} 
            className="flex items-center gap-2.5 w-full md:w-auto"
          >
            <div className="relative flex-1 md:w-56">
              <input
                ref={checkinInputRef}
                type="text"
                data-testid="checkin-code-input"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={checkinCodeInput}
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, '');
                  setCheckinCodeInput(val);
                  if (checkinErrorMessage) setCheckinErrorMessage(null);
                }}
                placeholder="4-digit code"
                autoFocus
                className="w-full px-4 py-2.5 bg-slate-50 border-2 border-slate-300 focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/20 rounded-xl text-center font-mono text-lg font-bold tracking-widest text-slate-900 placeholder:text-slate-400 placeholder:tracking-normal placeholder:font-sans placeholder:text-sm transition outline-none"
              />
            </div>
            <button
              type="submit"
              data-testid="verify-checkin-btn"
              disabled={isVerifyingCheckin || !checkinCodeInput.trim()}
              className="px-5 py-2.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white transition disabled:opacity-50 disabled:cursor-not-allowed shadow-xs flex items-center gap-1.5 shrink-0"
            >
              {isVerifyingCheckin ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Verifying…</span>
                </>
              ) : (
                <>
                  <UserCheck className="w-4 h-4" />
                  <span>Verify Code</span>
                </>
              )}
            </button>
          </form>
        </div>

        {/* Success Banner */}
        {checkinSuccessData && (
          <div
            role="status"
            data-testid="checkin-success-banner"
            className="mt-4 p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-950 flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-fadeIn"
          >
            <div className="flex items-start sm:items-center gap-3">
              <div className="p-2 rounded-lg bg-emerald-200 text-emerald-800 shrink-0">
                <CheckCircle2 className="w-5 h-5 text-emerald-700" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-bold text-emerald-950">
                    {checkinSuccessData.patient_name || 'Patient'} successfully checked in!
                  </p>
                  {checkinSuccessData.is_late ? (
                    <span 
                      data-testid="checkin-late-badge"
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300"
                    >
                      <Clock className="w-3 h-3 text-amber-700" />
                      <span>Arrived Late (&gt;10m after slot)</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-200 text-emerald-900">
                      <span>On Time</span>
                    </span>
                  )}
                </div>
                <p className="text-xs text-emerald-800 mt-0.5">
                  {checkinSuccessData.service_doctor ? `${checkinSuccessData.service_doctor} • ` : ''}
                  {checkinSuccessData.slot_time ? `Slot: ${checkinSuccessData.slot_time} • ` : ''}
                  Checked in at {checkinSuccessData.checked_in_at ? new Date(checkinSuccessData.checked_in_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'now'}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setCheckinSuccessData(null)}
              className="text-xs font-bold text-emerald-800 hover:text-emerald-950 underline underline-offset-2 self-end sm:self-center"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Error Banner */}
        {checkinErrorMessage && (
          <div
            role="alert"
            data-testid="checkin-error-banner"
            className="mt-4 p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 flex items-center justify-between gap-3 animate-fadeIn"
          >
            <div className="flex items-center gap-2.5">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
              <p className="text-xs font-semibold text-rose-900">{checkinErrorMessage}</p>
            </div>
            <button
              type="button"
              onClick={() => setCheckinErrorMessage(null)}
              className="text-xs font-bold text-rose-700 hover:text-rose-900 p-1"
              aria-label="Dismiss error"
            >
              ✕
            </button>
          </div>
        )}
      </div>

      {/* Main Content Layout: Live Queue & Operations */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left 2 Cols: Live Bookings Queue */}
        <div className="lg:col-span-2 space-y-4">
          {/* Queue Header & Live Status Metrics */}
          <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-xs space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-slate-900 tracking-tight flex items-center gap-2">
                  <span>Today&apos;s {venueLabel} Live Queue</span>
                  <span className="text-xs font-mono font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
                    Tokens #1 to #{todaysBookings.length || 0}
                  </span>
                </h2>
                <p className="text-xs text-slate-500">Live service roster with attendance presence states &amp; late queue tracking</p>
              </div>
              <span className="text-xs font-semibold text-slate-500 self-start sm:self-center font-mono">
                Total: {todaysBookings.length} appointments
              </span>
            </div>

            {/* Quick Metrics Bar: Green, Red, Amber */}
            <div className="grid grid-cols-3 gap-2.5 pt-1">
              <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-950 flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0" />
                  <span className="text-[11px] font-bold">Present &amp; Ready</span>
                </div>
                <span className="text-sm font-black font-mono">
                  {todaysBookings.filter((b) => b.is_present || b.status === 'CHECKED_IN').length}
                </span>
              </div>

              <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-950 flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-500 shrink-0" />
                  <span className="text-[11px] font-bold">Not Present</span>
                </div>
                <span className="text-sm font-black font-mono">
                  {todaysBookings.filter((b) => !b.is_present && b.status !== 'CHECKED_IN' && !b.queue_position).length}
                </span>
              </div>

              <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-950 flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-500 shrink-0" />
                  <span className="text-[11px] font-bold">Late Comers Queue</span>
                </div>
                <span className="text-sm font-black font-mono">
                  {todaysBookings.filter((b) => Boolean(b.queue_position)).length}
                </span>
              </div>
            </div>


            {/* Attendance Matrix Subheader & Resource / Department Filter */}
            <div className="pt-3 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="px-3 py-1.5 rounded-xl bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs font-bold flex items-center gap-1.5 shadow-2xs">
                  <Users className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Live Queue &amp; Service Matrix ({todaysBookings.length} Tokens)</span>
                </span>
                {isHospitalAdmin && (
                  <Link
                    href="/departments"
                    className="hidden sm:inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-2.5 py-1 rounded-lg border border-emerald-200 transition"
                  >
                    <span>Manage Departments</span>
                    <ArrowRight className="w-3 h-3" />
                  </Link>
                )}
              </div>

              {/* Resource & Department filter dropdowns */}
              <div className="flex items-center gap-2 flex-wrap">
                {availableDepartments.length > 0 && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-bold text-slate-500">Department:</span>
                    <select
                      value={selectedDepartmentFilter}
                      onChange={(e) => {
                        setSelectedDepartmentFilter(e.target.value);
                        setMerchantSelectedDoctorId('');
                      }}
                      className="text-xs font-bold px-2.5 py-1.5 rounded-xl border border-slate-200 bg-white text-slate-800 shadow-2xs focus:outline-none focus:ring-2 focus:ring-emerald-500 cursor-pointer"
                    >
                      <option value="">All Departments ({availableDepartments.length})</option>
                      {availableDepartments.map((dept: string) => (
                        <option key={dept} value={dept}>
                          {dept}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {activeResources.length > 0 && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-bold text-slate-500">{verticalConfig.resourceLabelSingular}:</span>
                    <select
                      value={merchantSelectedDoctorId}
                      onChange={(e) => setMerchantSelectedDoctorId(e.target.value)}
                      className="text-xs font-bold px-2.5 py-1.5 rounded-xl border border-slate-200 bg-white text-slate-800 shadow-2xs focus:outline-none focus:ring-2 focus:ring-emerald-500 cursor-pointer"
                    >
                      <option value="">All {verticalConfig.resourceLabelSingular}s ({departmentFilteredResources.length})</option>
                      {departmentFilteredResources.map((doc: Resource) => (
                        <option key={doc.id} value={doc.id}>
                          {doc.name} ({doc.department || 'Active'})
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ========================================================================= */}
          {/* QUEUE NUMBER SEQUENCE STRIP (Green = Present, Yellow = Waiting, Red = Absent) */}
          {/* ========================================================================= */}
          <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-2xs space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="p-1.5 rounded-lg bg-emerald-50 text-emerald-700">
                  <Ticket className="w-4 h-4" />
                </span>
                <div>
                  <h4 className="text-xs font-black uppercase tracking-wider text-slate-800 flex items-center gap-2">
                    <span>Queue Number Sequence</span>
                    <span className="text-[10px] font-normal normal-case text-slate-500">
                      (#1 = Customer 1, #2 = Customer 2)
                    </span>
                  </h4>
                  <p className="text-[11px] text-slate-500">
                    Live glanceable status: click any token number to jump directly to their appointment record.
                  </p>
                </div>
              </div>

              {/* Status Color Legend */}
              <div className="flex items-center gap-2.5 flex-wrap text-[11px] font-bold">
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-emerald-100 text-emerald-900 border border-emerald-300">
                  <span className="w-4 h-4 rounded-full bg-emerald-500 text-white flex items-center justify-center font-mono text-[9px] shadow-2xs font-bold">1</span>
                  <span>Green = Present</span>
                </span>
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-amber-100 text-amber-950 border border-amber-300">
                  <span className="w-4 h-4 rounded-full bg-amber-300 text-amber-950 flex items-center justify-center font-mono text-[9px] shadow-2xs font-bold">2</span>
                  <span>Yellow = Still Waiting</span>
                </span>
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-rose-100 text-rose-900 border border-rose-300">
                  <span className="w-4 h-4 rounded-full bg-rose-500 text-white flex items-center justify-center font-mono text-[9px] shadow-2xs font-bold">3</span>
                  <span>Red = Absent</span>
                </span>
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-amber-100 text-amber-950 border border-amber-300">
                  <span className="w-5 h-4 rounded-full bg-amber-400 text-amber-950 flex items-center justify-center font-mono text-[8px] shadow-2xs font-black">L1</span>
                  <span>Late Queue</span>
                </span>
              </div>
            </div>

            {/* Sequence Number Badges */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1 pt-0.5">
              {todaysBookings.length === 0 ? (
                <span className="text-xs text-slate-400 italic py-1">No customer bookings queued today.</span>
              ) : (
                todaysBookings.map((b, idx) => {
                  const isPresent = Boolean(b.is_present || b.status === 'CHECKED_IN');
                  const isAbsent = b.status === 'NO_SHOW';
                  const isLate = Boolean(b.queue_position);
                  const patientNum = isLate ? `L${b.queue_position}` : `${idx + 1}`;
                  const patientName = b.customer_name || `Customer #${patientNum}`;

                  return (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => {
                        setSelectedMatrixBookingId(b.id);
                        const el = document.getElementById(`matrix-tile-${b.id}`);
                        if (el) {
                          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        }
                      }}
                      title={`Token #${patientNum}: ${patientName} • ${
                        isPresent ? 'Present (Green)' : isAbsent ? 'Absent (Red)' : isLate ? 'Late Queue (Yellow)' : 'Still Waiting (Yellow)'
                      }`}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-mono font-bold shrink-0 transition-all cursor-pointer shadow-2xs hover:scale-105 border ${
                        isPresent
                          ? 'bg-emerald-500 text-white border-emerald-600 ring-1 ring-emerald-300'
                          : isAbsent
                          ? 'bg-rose-500 text-white border-rose-600 ring-1 ring-rose-300'
                          : isLate
                          ? 'bg-amber-400 text-amber-950 border-amber-500 ring-1 ring-amber-300 font-black'
                          : 'bg-amber-300 text-amber-950 border-amber-400 ring-1 ring-amber-300'
                      }`}
                    >
                      <span className="w-4 h-4 rounded-full bg-white/25 flex items-center justify-center text-[10px]">
                        {patientNum}
                      </span>
                      <span className="text-[11px] font-sans font-medium truncate max-w-[85px]">
                        {patientName.split(' ')[0]}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Live Patient Queue Attendance Matrix (Style 3) */}
          {(() => {
            const baseBookings = todaysBookings.filter((b) => {
              if (b.status === 'CANCELLED') return false;
              if (merchantSelectedDoctorId && b.resource_id !== merchantSelectedDoctorId) return false;
              if (selectedDepartmentFilter) {
                const res = activeResources.find((r) => r.id === b.resource_id);
                if ((res?.department || 'General') !== selectedDepartmentFilter) return false;
              }
              return true;
            });

            const matrixCompletedCount = baseBookings.filter((b) => b.status === 'COMPLETED').length;
            const matrixPresentCount = baseBookings.filter((b) => (b.is_present || b.status === 'CHECKED_IN') && b.status !== 'COMPLETED').length;
            const matrixAbsentCount = baseBookings.filter((b) => b.status === 'NO_SHOW').length;
            const matrixLateCount = baseBookings.filter((b) => Boolean(b.queue_position)).length;
            const matrixWaitingCount = baseBookings.filter((b) => !b.is_present && b.status !== 'CHECKED_IN' && b.status !== 'NO_SHOW' && b.status !== 'COMPLETED').length;

            const filteredMatrixBookings = baseBookings.filter((b) => {
              const isCompleted = b.status === 'COMPLETED';
              const isPresent = Boolean(b.is_present || b.status === 'CHECKED_IN') && !isCompleted;
              const isAbsent = b.status === 'NO_SHOW';
              const isLate = Boolean(b.queue_position);
              if (matrixFilter === 'PRESENT') return isPresent;
              if (matrixFilter === 'WAITING') return !isPresent && !isAbsent && !isCompleted;
              if (matrixFilter === 'ABSENT') return isAbsent;
              if (matrixFilter === 'LATE') return isLate;
              return true;
            });

            return (
              <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4" data-testid="live-attendance-matrix-board">
                {/* Matrix Header & Status Filters */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-black uppercase tracking-wider">
                        Attendance Matrix
                      </span>
                      <h3 className="font-bold text-slate-900 text-base tracking-tight">
                        Live {venueLabel} Service Queue Matrix
                      </h3>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Glanceable matrix grid: 🟢 Green = Present, 🟡 Yellow = Waiting, 🔴 Red = Absent, 🟡 L = Late Queue
                    </p>
                  </div>

                  {/* Filter Pills */}
                  <div className="flex items-center gap-1.5 flex-wrap text-xs">
                    <button
                      type="button"
                      onClick={() => setMatrixFilter('ALL')}
                      className={`px-2.5 py-1 rounded-lg font-bold transition cursor-pointer ${
                        matrixFilter === 'ALL'
                          ? 'bg-slate-900 text-white shadow-2xs'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      All ({baseBookings.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setMatrixFilter('PRESENT')}
                      className={`px-2.5 py-1 rounded-lg font-bold transition cursor-pointer flex items-center gap-1 ${
                        matrixFilter === 'PRESENT'
                          ? 'bg-emerald-600 text-white shadow-2xs'
                          : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                      }`}
                    >
                      <span className="w-2 h-2 rounded-full bg-emerald-500" />
                      Present ({matrixPresentCount})
                    </button>
                    <button
                      type="button"
                      onClick={() => setMatrixFilter('WAITING')}
                      className={`px-2.5 py-1 rounded-lg font-bold transition cursor-pointer flex items-center gap-1 ${
                        matrixFilter === 'WAITING'
                          ? 'bg-amber-500 text-white shadow-2xs'
                          : 'bg-amber-50 text-amber-900 hover:bg-amber-100'
                      }`}
                    >
                      <span className="w-2 h-2 rounded-full bg-amber-400" />
                      Waiting ({matrixWaitingCount})
                    </button>
                    <button
                      type="button"
                      onClick={() => setMatrixFilter('ABSENT')}
                      className={`px-2.5 py-1 rounded-lg font-bold transition cursor-pointer flex items-center gap-1 ${
                        matrixFilter === 'ABSENT'
                          ? 'bg-rose-600 text-white shadow-2xs'
                          : 'bg-rose-50 text-rose-800 hover:bg-rose-100'
                      }`}
                    >
                      <span className="w-2 h-2 rounded-full bg-rose-500" />
                      Absent ({matrixAbsentCount})
                    </button>
                    {matrixLateCount > 0 && (
                      <button
                        type="button"
                        onClick={() => setMatrixFilter('LATE')}
                        className={`px-2.5 py-1 rounded-lg font-bold transition cursor-pointer flex items-center gap-1 ${
                          matrixFilter === 'LATE'
                            ? 'bg-amber-600 text-white shadow-2xs'
                            : 'bg-amber-50 text-amber-900 hover:bg-amber-100'
                        }`}
                      >
                        <span className="w-2 h-2 rounded-full bg-amber-500" />
                        Late ({matrixLateCount})
                      </button>
                    )}
                  </div>
                </div>

                {/* THE MATRIX TILES GRID */}
                {filteredMatrixBookings.length === 0 ? (
                  <div className="py-12 text-center text-slate-400 text-xs italic bg-slate-50 rounded-xl">
                    No bookings matching this filter in today&apos;s queue matrix.
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                    {filteredMatrixBookings.map((booking) => {
                      const originalIndex = todaysBookings.findIndex((b) => b.id === booking.id);
                      const isCompleted = booking.status === 'COMPLETED';
                      const isPresent = Boolean(booking.is_present || booking.status === 'CHECKED_IN') && !isCompleted;
                      const isAbsent = booking.status === 'NO_SHOW';
                      const isLate = Boolean(booking.queue_position);
                      const patientNumber = isLate ? `L${booking.queue_position}` : `${originalIndex + 1}`;
                      const patientName = booking.customer_name || `Patient #${patientNumber}`;
                      const isSelected = selectedMatrixBookingId === booking.id;

                      return (
                        <div
                          key={booking.id}
                          id={`matrix-tile-${booking.id}`}
                          data-testid={`matrix-patient-tile-${booking.id}`}
                          onClick={() => setSelectedMatrixBookingId(isSelected ? null : booking.id)}
                          className={`rounded-2xl p-3.5 border-2 transition-all flex flex-col justify-between gap-2.5 cursor-pointer shadow-2xs hover:shadow-md ${
                            isCompleted
                              ? 'bg-slate-50/70 border-slate-300 hover:border-slate-400 opacity-80'
                              : isPresent
                              ? 'bg-emerald-50/70 border-emerald-500 hover:border-emerald-600 ring-1 ring-emerald-400/20'
                              : isAbsent
                              ? 'bg-rose-50/70 border-rose-400 hover:border-rose-500 ring-1 ring-rose-300/20'
                              : isLate
                              ? 'bg-amber-50/80 border-amber-400 hover:border-amber-500 ring-1 ring-amber-300/30'
                              : 'bg-amber-50/50 border-amber-300 hover:border-amber-400 ring-1 ring-amber-200/30'
                          } ${isSelected ? 'ring-4 ring-emerald-500/30 scale-[1.02]' : ''}`}
                        >
                          {/* Tile Top: Number Badge and Status Tag */}
                          <div className="flex items-center justify-between gap-1.5">
                            <span
                              className={`w-7 h-7 rounded-xl flex items-center justify-center font-mono font-black text-xs shadow-2xs shrink-0 ${
                                isCompleted
                                  ? 'bg-slate-400 text-white'
                                  : isPresent
                                  ? 'bg-emerald-500 text-white ring-1 ring-emerald-600'
                                  : isAbsent
                                  ? 'bg-rose-500 text-white ring-1 ring-rose-600'
                                  : isLate
                                  ? 'bg-amber-400 text-amber-950 font-black ring-1 ring-amber-500'
                                  : 'bg-amber-300 text-amber-950 font-bold ring-1 ring-amber-400'
                              }`}
                            >
                              {patientNumber}
                            </span>

                            <span
                              className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider shrink-0 ${
                                isCompleted
                                  ? 'bg-slate-200 text-slate-700'
                                  : isPresent
                                  ? 'bg-emerald-600 text-white'
                                  : isAbsent
                                  ? 'bg-rose-600 text-white'
                                  : isLate
                                  ? 'bg-amber-400 text-amber-950 border border-amber-500 font-black'
                                  : 'bg-amber-300 text-amber-950 font-bold'
                              }`}
                            >
                              {isCompleted
                                ? 'DONE'
                                : isPresent
                                ? 'PRESENT'
                                : isAbsent
                                ? 'ABSENT'
                                : isLate
                                ? 'LATE'
                                : 'WAITING'}
                            </span>
                          </div>

                          {/* Tile Middle: Patient Name */}
                          <div className="py-0.5">
                            <p className="text-xs font-bold text-slate-900 truncate" title={patientName}>
                              {patientName}
                            </p>
                            <p className="text-[10px] text-slate-500 font-medium font-mono">
                              {new Date(booking.slot_start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </p>
                          </div>

                          {/* Tile Bottom: Contextual Action */}
                          <div className="pt-2 border-t border-slate-200/60 flex items-center justify-between gap-1" onClick={(e) => e.stopPropagation()}>
                            {isCompleted ? (
                              <span className="text-[10px] font-bold text-slate-500 text-center w-full flex items-center justify-center gap-1 py-0.5">
                                <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                                <span>Finished</span>
                              </span>
                            ) : isPresent ? (
                              <button
                                type="button"
                                onClick={() => handleStatusChange(booking.id, 'COMPLETED')}
                                disabled={pendingBookingId === booking.id}
                                className="w-full py-1 px-2 rounded-lg text-[10px] font-bold bg-emerald-600 hover:bg-emerald-700 text-white transition disabled:opacity-50 text-center shadow-2xs cursor-pointer flex items-center justify-center gap-1"
                              >
                                <CheckCircle2 className="w-3 h-3" />
                                <span>{pendingBookingId === booking.id ? 'Saving…' : 'Done'}</span>
                              </button>
                            ) : isAbsent ? (
                              <span className="text-[10px] font-bold text-rose-600 text-center w-full py-0.5">
                                ✕ Missed
                              </span>
                            ) : isLate ? (
                              <button
                                type="button"
                                onClick={() => handleLateQueueAction(booking.id, 'CHECKIN_LATE')}
                                disabled={pendingBookingId === booking.id}
                                className="w-full py-1 px-2 rounded-lg text-[10px] font-bold bg-amber-500 hover:bg-amber-600 text-white transition disabled:opacity-50 text-center shadow-2xs cursor-pointer"
                              >
                                Arrived Late
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleAdmitPatient(booking.id)}
                                disabled={pendingBookingId === booking.id}
                                className="w-full py-1 px-2 rounded-lg text-[10px] font-bold bg-emerald-600 hover:bg-emerald-700 text-white transition disabled:opacity-50 text-center shadow-2xs cursor-pointer flex items-center justify-center gap-1"
                              >
                                <UserCheck className="w-3 h-3" />
                                <span>{pendingBookingId === booking.id ? 'Admitting…' : 'Admit'}</span>
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Selected Patient Drawer / Quick Inspector */}
                {selectedMatrixBookingId && (() => {
                  const b = todaysBookings.find((item) => item.id === selectedMatrixBookingId);
                  if (!b) return null;
                  const isC = b.status === 'COMPLETED';
                  const isP = Boolean(b.is_present || b.status === 'CHECKED_IN') && !isC;
                  const isA = b.status === 'NO_SHOW';
                  const isL = Boolean(b.queue_position);
                  const pIdx = todaysBookings.findIndex((item) => item.id === b.id);
                  const pNum = isL ? `L${b.queue_position}` : `${pIdx + 1}`;

                  return (
                    <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/95 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-in fade-in duration-150">
                      <div className="flex items-center gap-3">
                        <span className={`w-10 h-10 rounded-xl flex items-center justify-center font-mono font-black text-sm text-white shadow-2xs ${
                          isC ? 'bg-slate-400' : isP ? 'bg-emerald-600' : isA ? 'bg-rose-500' : isL ? 'bg-amber-500' : 'bg-amber-400 text-amber-950'
                        }`}>
                          {pNum}
                        </span>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-slate-900">{b.customer_name}</span>
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                              isC
                                ? 'bg-slate-200 text-slate-700'
                                : isP
                                ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                                : isA
                                ? 'bg-rose-100 text-rose-800'
                                : isL
                                ? 'bg-amber-100 text-amber-900'
                                : 'bg-amber-100 text-amber-900 border border-amber-300'
                            }`}>
                              {isC ? 'Completed' : isP ? 'Present (In OPD)' : isA ? 'Absent (No-Show)' : isL ? 'Late Queue' : 'Still Waiting'}
                            </span>
                          </div>
                          <p className="text-xs text-slate-500 mt-0.5">
                            Slot: {new Date(b.slot_start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} – {new Date(b.slot_end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • Doctor: <span className="font-semibold text-slate-700">{b.resource_name}</span>
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                        {!isP && !isA && !isC && (
                          <button
                            type="button"
                            onClick={() => handleAdmitPatient(b.id)}
                            disabled={pendingBookingId === b.id}
                            className="px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white transition disabled:opacity-50 flex items-center gap-1.5 shadow-2xs cursor-pointer"
                          >
                            <UserCheck className="w-3.5 h-3.5" />
                            <span>{pendingBookingId === b.id ? 'Admitting…' : 'Admit Patient'}</span>
                          </button>
                        )}
                        {isP && !isC && (
                          <button
                            type="button"
                            onClick={() => handleStatusChange(b.id, 'COMPLETED')}
                            disabled={pendingBookingId === b.id}
                            className="px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-700 hover:bg-emerald-800 text-white transition disabled:opacity-50 flex items-center gap-1.5 shadow-2xs cursor-pointer"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>{pendingBookingId === b.id ? 'Saving…' : 'Done / Complete'}</span>
                          </button>
                        )}
                        {!isP && !isA && !isC && (
                          <button
                            type="button"
                            onClick={() => handleStatusChange(b.id, 'NO_SHOW')}
                            disabled={pendingBookingId === b.id}
                            className="px-3 py-1.5 rounded-lg text-xs font-bold bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 transition disabled:opacity-50 cursor-pointer"
                          >
                            No-Show
                          </button>
                        )}
                        <CustomerContactBadge phone={b.customer_phone} bookingId={b.id} bookingStatus={b.status} isArrived={Boolean(b.customer_arrived_at)} />
                        <button
                          type="button"
                          onClick={() => setSelectedMatrixBookingId(null)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition cursor-pointer"
                          aria-label="Close details"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })()}
              </div>
            );
          })()}
        </div>

        {/* Right 1 Col: Doctor Shift Status & Duty Management */}
        <div className="space-y-6">
          <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-xl bg-emerald-50 text-emerald-700">
                  <Users className="w-4 h-4 text-emerald-600" />
                </div>
                <h3 className="font-bold text-slate-900 text-sm">{verticalConfig.resourceLabelSingular} Shift &amp; Duty</h3>
              </div>
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-mono">
                {activeResources.length} Active
              </span>
            </div>

            <p className="text-xs text-slate-500">
              Live staff presence and operational duty status for station availability.
            </p>

            <div className="space-y-3">
              {activeResources.length === 0 ? (
                <div className="p-4 rounded-xl bg-slate-50 text-center text-xs text-slate-500 border border-slate-100">
                  No active {verticalConfig.resourceLabelSingular.toLowerCase()}s configured yet.
                </div>
              ) : (
                activeResources.map((doc) => {
                  const isLeft = Boolean(doctorLeftMap[doc.id] ?? (doc.attributes as Record<string, unknown> | null)?.doctor_left);
                  const docAppointmentsCount = todaysBookings.filter(
                    (b) => b.resource_id === doc.id && b.status !== 'CANCELLED'
                  ).length;

                  return (
                    <div
                      key={doc.id}
                      data-testid={`doctor-shift-card-${doc.id}`}
                      className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 space-y-2 hover:border-slate-300 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="space-y-0.5">
                          <p className="font-bold text-slate-900 text-xs">{doc.name}</p>
                          <p className="text-[11px] text-slate-500">
                            {doc.department || 'Active'} • {docAppointmentsCount} {docAppointmentsCount === 1 ? 'appointment' : 'appointments'} today
                          </p>
                        </div>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wide shrink-0 ${
                            isLeft
                              ? 'bg-slate-200 text-slate-700'
                              : 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                          }`}
                        >
                          {isLeft ? 'Away / Off' : 'On Duty'}
                        </span>
                      </div>

                      <div className="flex items-center justify-between pt-1 border-t border-slate-200/60 text-xs">
                        <span className="text-[11px] text-slate-500">
                          {isLeft ? 'Currently Away' : 'Available for Service'}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleToggleDoctorDeparture(doc.id, isLeft)}
                          data-testid={`toggle-doctor-duty-${doc.id}`}
                          className={`text-xs font-bold px-2.5 py-1 rounded-lg transition cursor-pointer ${
                            isLeft
                              ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-2xs'
                              : 'bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 shadow-2xs'
                          }`}
                        >
                          {isLeft ? 'Mark On Duty' : 'Mark Left'}
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2 text-xs">
              <Link
                href="/schedule"
                className="font-bold text-emerald-700 hover:text-emerald-800 transition"
              >
                Manage Shift Hours →
              </Link>
              <Link
                href="/resources"
                className="font-medium text-slate-500 hover:text-slate-700 transition"
              >
                View {verticalConfig.resourceLabelSingular}s
              </Link>
            </div>
          </div>
        </div>
      </div>
        </>
      )}

      {/* ========================================================================= */}
      {/* OPERATIONAL SETTINGS MODAL (Auto-Accept & Daily Limit)                     */}
      {/* ========================================================================= */}
      {showSettingsModal && (
        <div 
          data-testid="booking-settings-modal"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs"
        >
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-emerald-50 text-emerald-600">
                  <Sliders className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-base">Booking Acceptance & Limits</h3>
                  <p className="text-xs text-slate-500">Configure auto-approval and daily capacity</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowSettingsModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition cursor-pointer"
                aria-label="Close modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveSettings} className="space-y-4">
              {/* Auto-Accept Toggle */}
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <label htmlFor="auto-accept-modal-toggle" className="text-sm font-bold text-slate-900 block cursor-pointer">
                    Auto-Accept Bookings
                  </label>
                  <p className="text-xs text-slate-600">
                    Instantly confirm incoming patient or client reservations without requiring manual merchant approval.
                  </p>
                </div>
                <button
                  type="button"
                  id="auto-accept-modal-toggle"
                  data-testid="auto-accept-modal-toggle"
                  role="switch"
                  aria-checked={tempAutoAccept}
                  onClick={() => setTempAutoAccept(!tempAutoAccept)}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-emerald-500 ${
                    tempAutoAccept ? 'bg-emerald-600' : 'bg-slate-300'
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                      tempAutoAccept ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Daily Booking Limit */}
              <div className="space-y-2">
                <label htmlFor="daily-booking-limit-input" className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
                  Daily Booking Limit (Default 50)
                </label>
                <p className="text-xs text-slate-500">
                  Maximum appointments accepted per day across all staff/slots. Requests exceeding this cap are blocked.
                </p>
                <div className="flex items-center gap-3">
                  <input
                    id="daily-booking-limit-input"
                    data-testid="daily-limit-input"
                    type="number"
                    min="1"
                    max="1000"
                    required
                    value={tempDailyLimit}
                    onChange={(e) => setTempDailyLimit(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-28 px-3.5 py-2 rounded-xl border border-slate-300 text-slate-900 font-bold text-base focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  />
                  <span className="text-xs text-slate-500 font-medium">appointments / day</span>
                </div>
                {/* Preset quick buttons */}
                <div className="flex items-center gap-2 pt-1">
                  <span className="text-[11px] text-slate-400 font-medium">Presets:</span>
                  {[25, 50, 75, 100].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setTempDailyLimit(preset)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition cursor-pointer ${
                        tempDailyLimit === preset
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowSettingsModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  data-testid="save-booking-settings-button"
                  disabled={isUpdatingOperational}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white transition shadow-sm disabled:opacity-50 cursor-pointer"
                >
                  <Check className="w-3.5 h-3.5" />
                  Save Settings
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* OPERATING HOURS & WEEKLY SCHEDULE MODAL                                    */}
      {/* ========================================================================= */}
      {showHoursModal && (() => {
        const { todayKey, tomorrowKey } = getKolkataDayKeys();
        const todayDayObj = DAYS_OF_WEEK.find((d) => d.key === todayKey);
        const tomorrowDayObj = DAYS_OF_WEEK.find((d) => d.key === tomorrowKey);

        return (
          <div 
            data-testid="shop-hours-modal"
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto"
          >
            <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl border border-slate-200 space-y-5 my-8">
              {/* Modal Header */}
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2.5">
                  <div className="p-2.5 rounded-xl bg-emerald-50 text-emerald-600">
                    <Calendar className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-900 text-base">Weekly Operating Hours & Schedule</h3>
                    <p className="text-xs text-slate-500">Indian Standard Time (IST) • Set day-by-day hours, bulk update week, or configure Tomorrow</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowHoursModal(false)}
                  className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition cursor-pointer"
                  aria-label="Close modal"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Navigation Tabs */}
              <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-xl">
                <button
                  type="button"
                  data-testid="tab-full-week"
                  onClick={() => setHoursActiveTab('full_week')}
                  className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition cursor-pointer ${
                    hoursActiveTab === 'full_week'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  📅 Full Week (7 Days)
                </button>
                <button
                  type="button"
                  data-testid="tab-tomorrow"
                  onClick={() => setHoursActiveTab('tomorrow')}
                  className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition cursor-pointer ${
                    hoursActiveTab === 'tomorrow'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  🌅 Tomorrow ({tomorrowDayObj?.label})
                </button>
                <button
                  type="button"
                  data-testid="tab-today"
                  onClick={() => setHoursActiveTab('today')}
                  className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition cursor-pointer ${
                    hoursActiveTab === 'today'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  🕒 Today ({todayDayObj?.label})
                </button>
              </div>

              <form onSubmit={handleSaveHours} className="space-y-4">
                {/* 1. BULK / ENTIRE WEEK CONTROLS */}
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <span className="text-xs font-extrabold text-slate-800 flex items-center gap-1.5">
                      <Zap className="w-3.5 h-3.5 text-amber-500" />
                      Quick Set: Apply to Entire Week (Mon–Sun)
                    </span>
                    <button
                      type="button"
                      data-testid="apply-entire-week-button"
                      onClick={handleApplyToEntireWeek}
                      className="px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white transition shadow-xs cursor-pointer inline-flex items-center gap-1 self-start sm:self-auto"
                    >
                      <Check className="w-3.5 h-3.5" />
                      Apply to All Days
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="opening-time-input" className="text-[11px] font-bold text-slate-600 uppercase tracking-wider block mb-1">
                        Opening Time
                      </label>
                      <input
                        id="opening-time-input"
                        data-testid="opening-time-input"
                        type="time"
                        required
                        value={bulkOpenTime}
                        onChange={(e) => {
                          setBulkOpenTime(e.target.value);
                          setTempOpeningTime(e.target.value);
                        }}
                        className="w-full px-3 py-1.5 rounded-xl border border-slate-300 text-slate-900 font-semibold text-xs focus:ring-2 focus:ring-emerald-500 focus:outline-none bg-white"
                      />
                    </div>
                    <div>
                      <label htmlFor="closing-time-input" className="text-[11px] font-bold text-slate-600 uppercase tracking-wider block mb-1">
                        Closing Time
                      </label>
                      <input
                        id="closing-time-input"
                        data-testid="closing-time-input"
                        type="time"
                        required
                        value={bulkCloseTime}
                        onChange={(e) => {
                          setBulkCloseTime(e.target.value);
                          setTempClosingTime(e.target.value);
                        }}
                        className="w-full px-3 py-1.5 rounded-xl border border-slate-300 text-slate-900 font-semibold text-xs focus:ring-2 focus:ring-emerald-500 focus:outline-none bg-white"
                      />
                    </div>
                  </div>

                  {/* Standard presets */}
                  <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-200/60">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Presets:</span>
                    <button
                      type="button"
                      onClick={() => handleApplyPreset('standard')}
                      className="px-2 py-0.5 rounded-lg text-xs font-semibold bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 transition cursor-pointer"
                    >
                      09:00 - 21:00 (Standard)
                    </button>
                    <button
                      type="button"
                      onClick={() => handleApplyPreset('sunday_closed')}
                      className="px-2 py-0.5 rounded-lg text-xs font-semibold bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 transition cursor-pointer"
                    >
                      Mon–Sat Open, Sun Closed
                    </button>
                    <button
                      type="button"
                      onClick={() => handleApplyPreset('clinic')}
                      className="px-2 py-0.5 rounded-lg text-xs font-semibold bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 transition cursor-pointer"
                    >
                      10:00 - 18:00 (Clinic)
                    </button>
                  </div>
                </div>

                {/* 2. TAB CONTENT */}
                {hoursActiveTab === 'full_week' && (
                  <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1">
                    <div className="flex items-center justify-between px-1">
                      <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">Day-by-Day Schedule</span>
                      <span className="text-[11px] text-slate-400">Toggle Closed for weekly off days</span>
                    </div>

                    <div className="space-y-2">
                      {DAYS_OF_WEEK.map((day) => {
                        const sched = tempWeeklyHours[day.key] || { open: '09:00', close: '21:00', is_closed: false };
                        const isToday = day.key === todayKey;
                        const isTomorrow = day.key === tomorrowKey;

                        return (
                          <div
                            key={day.key}
                            data-testid={`day-row-${day.key}`}
                            className={`flex flex-col sm:flex-row sm:items-center justify-between p-3 rounded-xl border transition ${
                              isToday
                                ? 'bg-emerald-50/50 border-emerald-300'
                                : isTomorrow
                                ? 'bg-sky-50/50 border-sky-300'
                                : 'bg-white border-slate-200 hover:border-slate-300'
                            }`}
                          >
                            <div className="flex items-center gap-2 w-36 shrink-0 mb-2 sm:mb-0">
                              <span className="font-bold text-slate-900 text-xs">{day.label}</span>
                              {isToday && (
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-extrabold bg-emerald-100 text-emerald-800 uppercase">
                                  Today
                                </span>
                              )}
                              {isTomorrow && (
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-extrabold bg-sky-100 text-sky-800 uppercase">
                                  Tomorrow
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-3 flex-1 justify-end">
                              {/* Open/Closed toggle */}
                              <button
                                type="button"
                                data-testid={`toggle-${day.key}`}
                                onClick={() => handleDayToggleClosed(day.key)}
                                className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition cursor-pointer ${
                                  sched.is_closed
                                    ? 'bg-rose-50 text-rose-700 border-rose-200'
                                    : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                }`}
                              >
                                {sched.is_closed ? 'Closed' : 'Open'}
                              </button>

                              {!sched.is_closed ? (
                                <div className="flex items-center gap-1.5">
                                  <input
                                    type="time"
                                    data-testid={`${day.key}-open-input`}
                                    value={sched.open}
                                    onChange={(e) => handleDayTimeChange(day.key, 'open', e.target.value)}
                                    className="px-2 py-1 rounded-lg border border-slate-300 text-slate-800 font-semibold text-xs focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                                  />
                                  <span className="text-slate-400 text-xs">to</span>
                                  <input
                                    type="time"
                                    data-testid={`${day.key}-close-input`}
                                    value={sched.close}
                                    onChange={(e) => handleDayTimeChange(day.key, 'close', e.target.value)}
                                    className="px-2 py-1 rounded-lg border border-slate-300 text-slate-800 font-semibold text-xs focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                                  />
                                </div>
                              ) : (
                                <div className="text-xs text-rose-500 font-semibold italic flex-1 text-center">
                                  Closed All Day (Weekly Off)
                                </div>
                              )}

                              <button
                                type="button"
                                onClick={() => handleCopyDayToAll(day.key)}
                                data-testid={`copy-${day.key}-to-all`}
                                title={`Copy ${day.label}'s hours to all days`}
                                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition cursor-pointer"
                              >
                                <Copy className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {hoursActiveTab === 'tomorrow' && (
                  <div data-testid="tomorrow-schedule-panel" className="p-4 bg-sky-50/60 rounded-xl border border-sky-200 space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
                          <span>🌅 Tomorrow ({tomorrowDayObj?.label}) Schedule</span>
                        </h4>
                        <p className="text-xs text-slate-600">Quickly adjust hours for tomorrow or mark closed for holidays</p>
                      </div>
                      <button
                        type="button"
                        data-testid="tomorrow-toggle-closed"
                        onClick={() => handleDayToggleClosed(tomorrowKey)}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition cursor-pointer ${
                          tempWeeklyHours[tomorrowKey]?.is_closed
                            ? 'bg-rose-100 text-rose-800 border-rose-300'
                            : 'bg-emerald-100 text-emerald-800 border-emerald-300'
                        }`}
                      >
                        {tempWeeklyHours[tomorrowKey]?.is_closed ? `${venueLabel} Closed Tomorrow` : `${venueLabel} Open Tomorrow`}
                      </button>
                    </div>

                    {!tempWeeklyHours[tomorrowKey]?.is_closed ? (
                      <div className="grid grid-cols-2 gap-3 bg-white p-3 rounded-xl border border-sky-200">
                        <div>
                          <label className="text-[11px] font-bold text-slate-600 uppercase tracking-wider block mb-1">
                            Tomorrow Opening Time
                          </label>
                          <input
                            type="time"
                            data-testid="tomorrow-open-input"
                            value={tempWeeklyHours[tomorrowKey]?.open || '09:00'}
                            onChange={(e) => handleDayTimeChange(tomorrowKey, 'open', e.target.value)}
                            className="w-full px-3 py-1.5 rounded-xl border border-slate-300 text-slate-900 font-semibold text-xs focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                          />
                        </div>
                        <div>
                          <label className="text-[11px] font-bold text-slate-600 uppercase tracking-wider block mb-1">
                            Tomorrow Closing Time
                          </label>
                          <input
                            type="time"
                            data-testid="tomorrow-close-input"
                            value={tempWeeklyHours[tomorrowKey]?.close || '21:00'}
                            onChange={(e) => handleDayTimeChange(tomorrowKey, 'close', e.target.value)}
                            className="w-full px-3 py-1.5 rounded-xl border border-slate-300 text-slate-900 font-semibold text-xs focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="p-3 bg-rose-50 rounded-xl border border-rose-200 text-xs text-rose-800 font-medium">
                        {venueLabel} is marked <strong>Closed</strong> for tomorrow. No customer appointments will be booked.
                      </div>
                    )}

                    <div className="flex flex-wrap gap-2">
                      <span className="text-[11px] text-slate-500 font-medium">Quick Tomorrow Presets:</span>
                      <button
                        type="button"
                        onClick={() => {
                          handleDayTimeChange(tomorrowKey, 'open', '09:00');
                          handleDayTimeChange(tomorrowKey, 'close', '21:00');
                          if (tempWeeklyHours[tomorrowKey]?.is_closed) handleDayToggleClosed(tomorrowKey);
                        }}
                        className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 transition cursor-pointer"
                      >
                        Normal (09:00 - 21:00)
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          handleDayTimeChange(tomorrowKey, 'open', '10:00');
                          handleDayTimeChange(tomorrowKey, 'close', '14:00');
                          if (tempWeeklyHours[tomorrowKey]?.is_closed) handleDayToggleClosed(tomorrowKey);
                        }}
                        className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 transition cursor-pointer"
                      >
                        Half Day (10:00 - 14:00)
                      </button>
                    </div>
                  </div>
                )}

                {hoursActiveTab === 'today' && (
                  <div data-testid="today-schedule-panel" className="p-4 bg-emerald-50/60 rounded-xl border border-emerald-200 space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
                          <span>🕒 Today ({todayDayObj?.label}) Schedule</span>
                        </h4>
                        <p className="text-xs text-slate-600">Current active operating hours for today</p>
                      </div>
                      <button
                        type="button"
                        data-testid="today-toggle-closed"
                        onClick={() => handleDayToggleClosed(todayKey)}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition cursor-pointer ${
                          tempWeeklyHours[todayKey]?.is_closed
                            ? 'bg-rose-100 text-rose-800 border-rose-300'
                            : 'bg-emerald-100 text-emerald-800 border-emerald-300'
                        }`}
                      >
                        {tempWeeklyHours[todayKey]?.is_closed ? `${venueLabel} Closed Today` : `${venueLabel} Open Today`}
                      </button>
                    </div>

                    {!tempWeeklyHours[todayKey]?.is_closed ? (
                      <div className="grid grid-cols-2 gap-3 bg-white p-3 rounded-xl border border-emerald-200">
                        <div>
                          <label className="text-[11px] font-bold text-slate-600 uppercase tracking-wider block mb-1">
                            Today Opening Time
                          </label>
                          <input
                            type="time"
                            value={tempWeeklyHours[todayKey]?.open || '09:00'}
                            onChange={(e) => handleDayTimeChange(todayKey, 'open', e.target.value)}
                            className="w-full px-3 py-1.5 rounded-xl border border-slate-300 text-slate-900 font-semibold text-xs focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                          />
                        </div>
                        <div>
                          <label className="text-[11px] font-bold text-slate-600 uppercase tracking-wider block mb-1">
                            Today Closing Time
                          </label>
                          <input
                            type="time"
                            value={tempWeeklyHours[todayKey]?.close || '21:00'}
                            onChange={(e) => handleDayTimeChange(todayKey, 'close', e.target.value)}
                            className="w-full px-3 py-1.5 rounded-xl border border-slate-300 text-slate-900 font-semibold text-xs focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="p-3 bg-rose-50 rounded-xl border border-rose-200 text-xs text-rose-800 font-medium">
                        {venueLabel} is marked <strong>Closed</strong> for today.
                      </div>
                    )}
                  </div>
                )}

                {/* Modal Footer */}
                <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setShowHoursModal(false)}
                    className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 transition cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    data-testid="save-hours-button"
                    disabled={isUpdatingOperational}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white transition shadow-sm disabled:opacity-50 cursor-pointer"
                  >
                    <Check className="w-3.5 h-3.5" />
                    Save Weekly Schedule
                  </button>
                </div>
              </form>
            </div>
          </div>
        );
      })()}

      {/* ========================================================================= */}
      {/* OFFLINE / WALK-IN PATIENT BOOKING MODAL                                     */}
      {/* ========================================================================= */}
      {showOfflineModal && (
        <div 
          data-testid="offline-patient-modal"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs"
        >
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-emerald-50 text-emerald-700">
                  <UserPlus className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-base">New Offline Patient (Walk-In)</h3>
                  <p className="text-xs text-slate-500">Allocate a slot and admit a walk-in patient at reception</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowOfflineModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition cursor-pointer"
                aria-label="Close modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateOfflineBooking} className="space-y-4">
              <div>
                <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1.5">
                  Patient Full Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Ramesh Kumar"
                  value={offlineName}
                  onChange={(e) => setOfflineName(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1.5">
                  Phone Number
                </label>
                <input
                  type="tel"
                  inputMode="tel"
                  pattern="[0-9+\s-]*"
                  placeholder="e.g. 9876543210 (10-digit mobile)"
                  value={offlinePhone}
                  onChange={(e) => {
                    let cleaned = e.target.value.replace(/[^0-9+\s-]/g, '');
                    if (cleaned.includes('+')) {
                      const hasLeading = cleaned.startsWith('+');
                      cleaned = (hasLeading ? '+' : '') + cleaned.replace(/\+/g, '');
                    }
                    setOfflinePhone(cleaned);
                  }}
                  onKeyDown={(e) => {
                    if (e.key.length === 1 && /[a-zA-Z]/.test(e.key)) {
                      e.preventDefault();
                    }
                  }}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 font-mono"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1.5">
                  Doctor / Department *
                </label>
                <select
                  value={offlineDoctorId || activeResources[0]?.id || ''}
                  onChange={(e) => setOfflineDoctorId(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 bg-white"
                >
                  {activeResources.map((res) => (
                    <option key={res.id} value={res.id}>
                      {res.name} — {res.department || 'General'} ({res.duration_minutes || 2}m duration)
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
                  Time Slot Allocation *
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className={`p-3 rounded-xl border cursor-pointer flex flex-col gap-1 transition ${offlineTimeOption === 'now' ? 'bg-emerald-50/70 border-emerald-500 ring-1 ring-emerald-500' : 'bg-slate-50 border-slate-200 hover:bg-slate-100'}`}>
                    <div className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="time_opt"
                        checked={offlineTimeOption === 'now'}
                        onChange={() => setOfflineTimeOption('now')}
                        className="text-emerald-600 focus:ring-emerald-500"
                      />
                      <span className="text-xs font-bold text-slate-900">Immediate / Now</span>
                    </div>
                    <span className="text-[11px] text-slate-500 pl-5">Allocate next immediate window</span>
                  </label>

                  <label className={`p-3 rounded-xl border cursor-pointer flex flex-col gap-1 transition ${offlineTimeOption === 'custom' ? 'bg-emerald-50/70 border-emerald-500 ring-1 ring-emerald-500' : 'bg-slate-50 border-slate-200 hover:bg-slate-100'}`}>
                    <div className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="time_opt"
                        checked={offlineTimeOption === 'custom'}
                        onChange={() => setOfflineTimeOption('custom')}
                        className="text-emerald-600 focus:ring-emerald-500"
                      />
                      <span className="text-xs font-bold text-slate-900">Custom Time</span>
                    </div>
                    <span className="text-[11px] text-slate-500 pl-5">Select a specific time today</span>
                  </label>
                </div>

                {offlineTimeOption === 'custom' && (
                  <div className="pt-2">
                    <input
                      type="time"
                      required={offlineTimeOption === 'custom'}
                      value={offlineCustomTime}
                      onChange={(e) => setOfflineCustomTime(e.target.value)}
                      className="px-3.5 py-2 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono"
                    />
                  </div>
                )}
              </div>

              {/* Physical presence checkbox */}
              <div className="p-3.5 rounded-xl bg-emerald-50/60 border border-emerald-200 flex items-start gap-2.5">
                <input
                  type="checkbox"
                  id="offline-present"
                  checked={offlineMarkPresent}
                  onChange={(e) => setOfflineMarkPresent(e.target.checked)}
                  className="mt-0.5 rounded text-emerald-600 focus:ring-emerald-500"
                />
                <label htmlFor="offline-present" className="text-xs text-emerald-950 font-medium cursor-pointer">
                  <span className="font-bold block">Patient is physically present at reception</span>
                  Automatically mark as Present &amp; Checked-In so doctor can admit immediately.
                </label>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowOfflineModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-100 transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingOffline}
                  className="px-5 py-2.5 rounded-xl text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-700 shadow-md transition disabled:opacity-60 cursor-pointer flex items-center gap-1.5"
                >
                  {isSubmittingOffline ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Allocating Slot…</span>
                    </>
                  ) : (
                    <>
                      <UserPlus className="w-3.5 h-3.5" />
                      <span>Confirm &amp; Allocate Appointment</span>
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
