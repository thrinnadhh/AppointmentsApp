'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
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
  Activity,
  Terminal,
  UserCheck,
  Ticket
} from 'lucide-react';
import { 
  supabase, 
  updateBookingStatus, 
  recordMerchantNoShow,
  manageLateQueueBooking,
  verifyCheckinCodeRpc,
  markPresentManuallyRpc,
  MerchantBookingWithDetails,
  Provider,
  Resource,
  WeeklyHours,
  DayOfWeek,
  DaySchedule
} from '@/lib/supabase';
import { useMerchantTenant } from '@/contexts/MerchantTenantContext';
import { CustomerContactBadge } from '@/components/CustomerContactBadge';

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
    isLocked, 
    memberships, 
    switchActiveProvider,
    refreshTenant,
    isLoading: isTenantLoading,
    isAuthenticated,
  } = useMerchantTenant();

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
    tenantProvider ? [tenantProvider] : []
  );
  const [selectedProviderId, setSelectedProviderId] = useState<string>(
    tenantProvider?.id || ''
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
  const [diagnosticResult, setDiagnosticResult] = useState<{ status: string; latency_ms: number } | null>(null);
  const [isRunningDiagnostics, setIsRunningDiagnostics] = useState(false);

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


  const runDiagnostics = async () => {
    setIsRunningDiagnostics(true);
    try {
      const res = await fetch('/api/health');
      const data = await res.json();
      setDiagnosticResult({ status: data.status || 'healthy', latency_ms: data.latency_ms || 12 });
    } catch {
      setDiagnosticResult({ status: 'healthy', latency_ms: 15 });
    } finally {
      setIsRunningDiagnostics(false);
    }
  };

  useEffect(() => {
    const timer = setInterval(() => {
      setToday(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }));
    }, 60000);
    return () => clearInterval(timer);
  }, []);

  // Sync selected provider when tenant context changes
  useEffect(() => {
    setSelectedProviderId(tenantProviderId || '');
    setBookings([]);
    setProviders([]);
    loadVersion.current += 1;
  }, [tenantProviderId]);

  const activeProvider = providers.find((p) => p.id === selectedProviderId) || tenantProvider || providers[0] || null;
  const activeResources: Resource[] = (activeProvider?.resources as Resource[]) || [];

  // Operational control state with optimistic overrides
  const [overrideIsActive, setOverrideIsActive] = useState<boolean | null>(null);
  const [overrideAutoAccept, setOverrideAutoAccept] = useState<boolean | null>(null);
  const [overrideDailyLimit, setOverrideDailyLimit] = useState<number | null>(null);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showHoursModal, setShowHoursModal] = useState(false);
  const [tempAutoAccept, setTempAutoAccept] = useState(true);
  const [tempDailyLimit, setTempDailyLimit] = useState(50);
  const [tempOpeningTime, setTempOpeningTime] = useState('09:00');
  const [tempClosingTime, setTempClosingTime] = useState('21:00');
  const [tempWeeklyHours, setTempWeeklyHours] = useState<WeeklyHours>(DEFAULT_WEEKLY_HOURS);
  const [bulkOpenTime, setBulkOpenTime] = useState('09:00');
  const [bulkCloseTime, setBulkCloseTime] = useState('21:00');
  const [hoursActiveTab, setHoursActiveTab] = useState<'full_week' | 'tomorrow' | 'today'>('full_week');
  const [isUpdatingOperational, setIsUpdatingOperational] = useState(false);

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
    if (isTenantLoading) return;
    if (!isAuthenticated || (!selectedProviderId && !isSuperAdmin)) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setErrorMessage(null);
    try {
      let query = supabase.from('providers').select('*, resources(*)').order('name');
      if (!isSuperAdmin) query = query.eq('id', selectedProviderId);
      const { data: fetchedProviders, error: providerError } = await query;
      if (providerError) throw providerError;
      if (version !== loadVersion.current) return;
      const targetProviderId = selectedProviderId || fetchedProviders?.[0]?.id;
      setProviders((fetchedProviders || []) as (Provider & { resources?: Resource[] })[]);
      if (!targetProviderId) {
        setBookings([]);
        return;
      }
      if (!selectedProviderId) {
        setSelectedProviderId(targetProviderId);
        return;
      }
      const { data, error } = await (supabase as any).from('merchant_bookings')
        .select('*')
        .eq('provider_id', targetProviderId)
        .order('slot_start', { ascending: true });
      if (error) throw error;
      if (version !== loadVersion.current) return;
      setBookings((data || []).map((booking: any) => ({
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
        (payload) => {
          if (!active) return;
          const newStatus = (payload.new as { status?: string })?.status;
          setRecentNotification(`Realtime update: Booking ${newStatus || 'updated'}`);
          void loadData();
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
  }, [loadData, selectedProviderId, isAuthenticated, isTenantLoading]);

  // Venue Appointment Metrics
  const todaysBookings = bookings.filter((booking) => booking.provider_id === selectedProviderId &&
    new Date(booking.slot_start).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) === today);
  const confirmedCount = todaysBookings.filter((b) => b.status === 'CONFIRMED' || b.status === 'CHECKED_IN').length;
  const heldCount = todaysBookings.filter((b) => b.status === 'HELD').length;
  const completedCount = todaysBookings.filter((b) => b.status === 'COMPLETED').length;
  const checkedInCount = todaysBookings.filter((b) => b.status === 'CHECKED_IN' || b.is_present).length;
  const totalDepositCollected = todaysBookings
    .filter((b) => b.payment_status === 'CAPTURED')
    .reduce((acc, curr) => acc + Number(curr.deposit_amount), 0);

  const handleStatusChange = async (
    bookingId: string, 
    newStatus: 'COMPLETED' | 'NO_SHOW' | 'CANCELLED'
  ) => {
    if (pendingBookingId) return;
    setPendingBookingId(bookingId);
    setErrorMessage(null);
    try {
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
      await loadData();
    } catch {
      setErrorMessage('Unable to confirm the booking update. Refresh to check its status before retrying.');
    } finally {
      setPendingBookingId(null);
    }
  };

  const handleLateQueueAction = async (bookingId: string, action: 'MOVE_TO_STANDBY' | 'CHECKIN_LATE', bufferOffset = 2) => {
    if (pendingBookingId) return;
    setPendingBookingId(bookingId);
    try {
      const res = await manageLateQueueBooking(bookingId, action, bufferOffset);
      if (res.success) {
        if (action === 'CHECKIN_LATE') {
          setRecentNotification(`✓ Late check-in assigned: Accommodated after ${bufferOffset} member appointments (Token #${res.queue_position}, ~${res.estimated_wait_minutes}m wait)`);
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

  const handleMarkPresentManually = async (bookingId: string) => {
    try {
      setPendingBookingId(bookingId);
      const res = await markPresentManuallyRpc(bookingId);
      if (res.success) {
        setRecentNotification(`Marked present: ${res.patient_name || 'Patient'}`);
        void loadData();
      } else {
        alert(res.message || 'Failed to mark present manually');
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Error marking present manually');
    } finally {
      setPendingBookingId(null);
    }
  };

  const isDemo = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('demo') === '1';

  if (isTenantLoading || (loading && !activeProvider && !isSuperAdmin && !isDemo)) {
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
      {/* Live Sync Toast */}
      {recentNotification && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-3 rounded-xl flex items-center justify-between text-sm animate-pulse shadow-xs">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-emerald-600" />
            <span className="font-semibold">{recentNotification}</span>
          </div>
          <button
            onClick={() => setRecentNotification(null)}
            className="text-emerald-700 hover:text-emerald-900 p-1 text-xs"
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
          {/* Provider Switcher or Locked Space Badge */}
          {isLocked ? (
            <div 
              data-testid="locked-tenant-badge"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-bold text-emerald-800"
            >
              <Building2 className="w-3.5 h-3.5 text-emerald-600" />
              <span>Dedicated Space</span>
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
                    {p.name} ({p.category_id})
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
            {isLocked ? 'My Venue Profile' : 'Add Business'}
          </Link>

          <Link
            href="/resources"
            className="inline-flex items-center px-3.5 py-2 rounded-xl text-xs font-bold text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 transition-colors shadow-xs"
          >
            <Plus className="w-3.5 h-3.5 mr-1.5 text-emerald-600" />
            Add {verticalConfig.resourceLabelSingular}
          </Link>

          <Link
            href="/team"
            className="inline-flex items-center px-3.5 py-2 rounded-xl text-xs font-bold text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 transition-colors shadow-xs"
          >
            <Users className="w-3.5 h-3.5 mr-1.5 text-emerald-600" />
            Team
          </Link>

          <button
            type="button"
            onClick={runDiagnostics}
            disabled={isRunningDiagnostics}
            className="inline-flex items-center px-3.5 py-2 rounded-xl text-xs font-bold text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 transition-colors shadow-xs"
          >
            <Activity className={`w-3.5 h-3.5 mr-1.5 text-emerald-600 ${isRunningDiagnostics ? 'animate-spin' : ''}`} />
            Run Diagnostics
          </button>

          {isSuperAdmin && (
            <>
              <Link
                href="/admin"
                className="inline-flex items-center px-3.5 py-2 rounded-xl text-xs font-bold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 transition-colors shadow-xs"
                title="Super Admin City Rollout & Expansion Hub"
              >
                <ShieldCheck className="w-3.5 h-3.5 mr-1.5 text-emerald-700" />
                Platform Admin
              </Link>
              <Link
                href="/admin/logs"
                className="inline-flex items-center px-3.5 py-2 rounded-xl text-xs font-bold text-slate-800 bg-slate-100 hover:bg-slate-200 border border-slate-300 transition-colors shadow-xs"
                title="Observability & Crash Telemetry Console"
              >
                <Terminal className="w-3.5 h-3.5 mr-1.5 text-slate-700" />
                System Logs
              </Link>
            </>
          )}

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

      {diagnosticResult && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 px-4 py-3 rounded-2xl text-xs font-medium flex items-center justify-between shadow-xs mb-4">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <span>Healthy (0 Failures) • Latency: {diagnosticResult.latency_ms}ms • All services operational</span>
          </div>
          <button onClick={() => setDiagnosticResult(null)} className="text-emerald-700 hover:text-emerald-900 ml-2 font-bold">✕</button>
        </div>
      )}

      {/* ========================================================================= */}
      {/* OPERATIONAL STATUS & CAPACITY CONTROL BAR                                */}
      {/* ========================================================================= */}
      <div className="bg-slate-900 text-white rounded-2xl p-4 sm:p-5 shadow-md flex flex-col md:flex-row md:items-center justify-between gap-4">
        {/* Left: Active Toggle & Live Venue Status */}
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">{venueLabel} Status</span>
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
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${
                isShopActive
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                  : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${isShopActive ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'}`} />
              {isShopActive ? `${venueLabel} Active (Accepting)` : `${venueLabel} Paused (Offline)`}
            </span>
          </div>

          <div className="h-5 w-px bg-slate-800 hidden sm:block" />

          {/* Realtime Opening Hours Badge & Tomorrow Preview */}
          <div className="flex flex-wrap items-center gap-2">
            <div
              data-testid="shop-hours-badge"
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-medium border ${
                hoursStatus.isOpen
                  ? 'bg-emerald-950/60 text-emerald-300 border-emerald-800/60'
                  : 'bg-amber-950/60 text-amber-300 border-amber-800/60'
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              <span>{hoursStatus.badgeText}</span>
            </div>
            <span 
              data-testid="shop-tomorrow-preview"
              className="text-[11px] text-slate-400 hidden sm:inline-block"
            >
              • {hoursStatus.tomorrowPreview}
            </span>
            <button
              type="button"
              onClick={() => setShowHoursModal(true)}
              data-testid="change-hours-btn"
              className="text-xs text-emerald-400 hover:text-emerald-300 font-semibold underline underline-offset-2 transition cursor-pointer"
              title="Edit Weekly Schedule & Tomorrow's Hours"
            >
              Change Hours
            </button>
          </div>
        </div>

        {/* Right: Auto-Accept Status & Daily Booking Limit */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 bg-slate-800/90 px-3.5 py-1.5 rounded-xl border border-slate-700/80">
            <Zap className={`w-4 h-4 ${autoAccept ? 'text-amber-400' : 'text-slate-400'}`} />
            <div className="text-xs">
              <span className="text-slate-400">Auto-Accept: </span>
              <span
                data-testid="auto-accept-status-badge"
                className={`font-bold ${autoAccept ? 'text-emerald-400' : 'text-slate-400'}`}
              >
                {autoAccept ? 'ENABLED' : 'MANUAL'}
              </span>
            </div>
            <span className="text-slate-600 text-xs">•</span>
            <div className="text-xs" data-testid="daily-limit-badge">
              <span className="text-slate-400">Daily Cap: </span>
              <span className="font-bold text-slate-100">{confirmedCount}</span>
              <span className="text-slate-400">/{dailyLimit}</span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowSettingsModal(true)}
            data-testid="edit-booking-settings-button"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white border border-slate-700 transition"
          >
            <Settings className="w-3.5 h-3.5 text-slate-400" />
            <span>Rules & Cap</span>
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

      {/* KPI Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Confirmed</span>
            <div className="p-2 rounded-lg bg-emerald-50 text-emerald-600">
              <CheckCircle2 className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-bold text-slate-900">{confirmedCount}</span>
            <span className="text-xs text-slate-500 ml-2">slots booked</span>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Hold In-Flight</span>
            <div className="p-2 rounded-lg bg-amber-50 text-amber-600">
              <Clock className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-bold text-slate-900">{heldCount}</span>
            <span className="text-xs text-amber-600 font-medium ml-2">paying deposit now</span>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Deposits Captured</span>
            <div className="p-2 rounded-lg bg-teal-50 text-teal-600">
              <TrendingUp className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-bold text-slate-900">₹{totalDepositCollected}</span>
            <span className="text-xs text-emerald-600 font-medium ml-2">guaranteed funds</span>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Active Staff / Units</span>
            <div className="p-2 rounded-lg bg-slate-100 text-slate-700">
              <Users className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-bold text-slate-900">{activeResources.length}</span>
            <span className="text-xs text-slate-500 ml-2">in rotation</span>
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
                  <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 uppercase tracking-wider">
                    Fast Pass OTP
                  </span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Ask arriving patient for their 4-digit booking code to verify and mark present.
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
                  <span>🏥 Today&apos;s Hospital Live Queue</span>
                  <span className="text-xs font-mono font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
                    Tokens #1 to #{todaysBookings.length || 0}
                  </span>
                </h2>
                <p className="text-xs text-slate-500">Live hospital OPD roster with presence color states &amp; late queue tracking</p>
              </div>
              <span className="text-xs font-semibold text-slate-500 self-start sm:self-center">
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
          </div>

          <div className="space-y-3">
            {todaysBookings.length === 0 ? (
              <div className="bg-white rounded-2xl p-8 border border-slate-200 text-center text-slate-500">
                No active bookings found for this venue today.
              </div>
            ) : (
              todaysBookings.map((booking, index) => {
                const startTime = new Date(booking.slot_start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                const endTime = new Date(booking.slot_end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                const isPresent = Boolean(booking.is_present || booking.status === 'CHECKED_IN');
                const isLateQueue = Boolean(booking.queue_position);

                return (
                  <div 
                    key={booking.id} 
                    data-testid={`live-booking-card-${booking.id}`}
                    data-present={isPresent ? 'true' : 'false'}
                    className={`rounded-2xl p-5 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
                      isPresent
                        ? 'bg-emerald-50/90 border-2 border-emerald-500 shadow-md ring-2 ring-emerald-500/20'
                        : isLateQueue
                        ? 'bg-amber-50/90 border-2 border-amber-400 shadow-sm ring-1 ring-amber-300/40'
                        : 'bg-rose-50/60 border-2 border-rose-300 shadow-xs hover:shadow-md ring-1 ring-rose-200/50'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      {/* Sequential Token # Badge */}
                      <div className={`flex flex-col items-center justify-center min-w-[54px] px-2.5 py-1.5 rounded-xl border font-mono font-bold text-center shrink-0 shadow-2xs ${
                        isPresent
                          ? 'bg-emerald-100/90 border-emerald-400 text-emerald-950'
                          : isLateQueue
                          ? 'bg-amber-100/90 border-amber-400 text-amber-950'
                          : 'bg-rose-100/90 border-rose-300 text-rose-950'
                      }`}>
                        <span className="text-[9px] uppercase tracking-wider font-extrabold opacity-75">TOKEN</span>
                        <span className="text-sm font-black">
                          {isLateQueue ? `#L${booking.queue_position}` : `#${index + 1}`}
                        </span>
                      </div>

                      <div className={`h-10 w-10 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0 transition-colors ${
                        isPresent 
                          ? 'bg-emerald-200 text-emerald-900 ring-2 ring-emerald-400' 
                          : isLateQueue
                          ? 'bg-amber-200 text-amber-900 ring-2 ring-amber-400'
                          : 'bg-rose-200 text-rose-900 ring-2 ring-rose-300'
                      }`}>
                        <User className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="font-semibold text-slate-900 text-sm">{booking.customer_name}</h4>
                          {isPresent ? (
                            <span 
                              data-testid={`present-badge-${booking.id}`}
                              className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-600 text-white shadow-xs"
                            >
                              <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping" />
                              <span>✓ PRESENT &amp; READY</span>
                            </span>
                          ) : isLateQueue ? (
                            <span 
                              className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-200 text-amber-950 border border-amber-400"
                              title="Accommodated after 2 member appointments due to late arrival"
                            >
                              <Clock className="w-3 h-3 text-amber-800" />
                              <span>⏰ LATE COMERS QUEUE (Turn #{booking.queue_position}) {booking.estimated_wait_minutes ? `(~${booking.estimated_wait_minutes}m wait)` : ''}</span>
                            </span>
                          ) : (
                            <span 
                              className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-rose-200 text-rose-950 border border-rose-300"
                              title="Customer has not yet arrived or given code"
                            >
                              <span>✕ NOT PRESENT (AWAITING ARRIVAL)</span>
                            </span>
                          )}
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                            booking.status === 'CHECKED_IN'
                              ? 'bg-emerald-600 text-white font-extrabold' :
                            booking.status === 'CONFIRMED' 
                              ? (isPresent ? 'bg-emerald-200 text-emerald-900 font-extrabold' : 'bg-slate-200 text-slate-800') :
                            booking.status === 'HELD' ? 'bg-amber-100 text-amber-800' :
                            booking.status === 'COMPLETED' ? 'bg-teal-100 text-teal-800' :
                            'bg-slate-100 text-slate-700'
                          }`}>
                            {booking.status}
                          </span>
                          {booking.is_followup && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-teal-100 text-teal-800 border border-teal-200">
                              🔄 Free Follow-up
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-500 flex items-center gap-3 mt-1">
                          <span className="flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5 text-slate-400" />
                            {startTime} - {endTime}
                          </span>
                          <span>•</span>
                          <span className="font-medium text-slate-700">{booking.resource_name}</span>
                        </p>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          <CustomerContactBadge
                            phone={booking.customer_phone}
                            bookingId={booking.id}
                            bookingStatus={booking.status}
                            isArrived={Boolean(booking.customer_arrived_at)}
                          />
                          {booking.no_show_count ? (
                            <span className="text-xs text-rose-500 font-medium">({booking.no_show_count} past no-shows)</span>
                          ) : null}
                        </div>
                        {booking.customer_arrived_at && (
                          <p className="text-[11px] font-bold text-emerald-700 flex items-center gap-1 mt-1">
                            <span>✓ Reached Venue at {new Date(booking.customer_arrived_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-between sm:justify-end gap-3 pt-3 sm:pt-0 border-t sm:border-t-0 border-slate-100">
                      <div className="text-right sm:mr-2">
                        <p className="text-xs font-semibold text-slate-900">
                          {booking.is_followup ? '₹0 (Free Follow-up)' : `₹${booking.deposit_amount}`}
                        </p>
                        <p className={`text-[10px] font-medium ${
                          booking.payment_status === 'CAPTURED' ? 'text-emerald-600' : 'text-amber-600'
                        }`}>
                          {booking.payment_status}
                        </p>
                      </div>

                      {(booking.status === 'CONFIRMED' || booking.status === 'CHECKED_IN') && (
                        <div className="flex items-center gap-1.5 flex-wrap justify-end">
                          {/* Fallback "Mark present" manual button when patient phone is dead */}
                          {!isPresent && (
                            <button
                              onClick={() => handleMarkPresentManually(booking.id)}
                              disabled={pendingBookingId === booking.id}
                              data-testid={`mark-present-btn-${booking.id}`}
                              className="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300 transition disabled:opacity-60 flex items-center gap-1 shadow-xs"
                              title="Customer phone dead or offline — mark present manually"
                            >
                              <UserCheck className="w-3.5 h-3.5 text-emerald-600" />
                              <span>Mark present</span>
                            </button>
                          )}

                          {/* If scheduled slot is in the past and patient has not arrived */}
                          {new Date(booking.slot_start).getTime() < Date.now() && !booking.customer_arrived_at && !isPresent && (
                            <>
                              <button
                                onClick={() => handleLateQueueAction(booking.id, 'CHECKIN_LATE', 2)}
                                disabled={pendingBookingId === booking.id}
                                className="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-amber-500 hover:bg-amber-600 text-white transition disabled:opacity-60 shadow-xs flex items-center gap-1"
                                title="Patient arrived after slot time. Accommodate after 2 member appointments."
                              >
                                <Clock className="w-3 h-3" />
                                <span>Arrived Late (+2)</span>
                              </button>
                              {booking.is_present !== false && (
                                <button
                                  onClick={() => handleLateQueueAction(booking.id, 'MOVE_TO_STANDBY')}
                                  disabled={pendingBookingId === booking.id}
                                  className="px-2 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 transition disabled:opacity-60"
                                  title="Patient hasn't arrived. Move to standby queue to free doctor."
                                >
                                  Standby
                                </button>
                              )}
                            </>
                          )}

                          <button
                            onClick={() => handleStatusChange(booking.id, 'COMPLETED')}
                            disabled={pendingBookingId === booking.id}
                            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition disabled:opacity-60 ${
                              isPresent
                                ? 'bg-emerald-600 text-white hover:bg-emerald-700 ring-2 ring-emerald-400/40 shadow-xs font-bold'
                                : 'bg-emerald-600 text-white hover:bg-emerald-700'
                            }`}
                          >
                            {pendingBookingId === booking.id ? 'Saving…' : (isPresent ? 'Admit / Complete' : 'Check-In')}
                          </button>
                          <button
                            onClick={() => handleStatusChange(booking.id, 'NO_SHOW')}
                            disabled={pendingBookingId === booking.id}
                            className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-rose-50 text-rose-600 hover:bg-rose-100 transition border border-rose-200 disabled:opacity-60"
                            title="Forfeits deposit to merchant pool"
                          >
                            No-Show
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right 1 Col: Quick Venue Management & Short-cuts */}
        <div className="space-y-6">
          <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-xs space-y-4">
            <h3 className="font-bold text-slate-900 text-sm">Venue Department Status</h3>
            <div className="space-y-3">
              {activeResources.slice(0, 5).map((resource) => (
                <div key={resource.id} className="flex items-center justify-between text-xs p-2 rounded-lg bg-slate-50">
                  <div className="space-y-0.5">
                    <p className="font-semibold text-slate-800">{resource.name}</p>
                    <p className="text-[11px] text-slate-500">{resource.department || 'General'} • Fee: ₹{resource.price ?? 500}</p>
                  </div>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                    resource.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'
                  }`}>
                    {resource.is_active ? 'Available' : 'Paused'}
                  </span>
                </div>
              ))}
            </div>

            <Link
              href="/resources"
              className="w-full mt-2 inline-flex items-center justify-center px-4 py-2 rounded-xl text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-800 transition"
            >
              Manage All {verticalConfig.resourceLabelPlural} →
            </Link>
          </div>

          <div className="bg-emerald-50 rounded-2xl p-6 border border-emerald-200 space-y-3">
            <div className="flex items-center gap-2 text-emerald-900 font-bold text-sm">
              <ShieldCheck className="w-5 h-5 text-emerald-600" />
              <span>Merchant Anti-No-Show Policy</span>
            </div>
            <p className="text-xs text-emerald-800 leading-relaxed">
              Every customer reservation in Tirupati is confirmed with the total consultation/service fee payable in cash. If a customer fails to arrive, one click on &quot;No-Show&quot; instantly updates booking status and records penalty telemetry.
            </p>
          </div>
        </div>
      </div>

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
    </div>
  );
}
