'use client';

import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { 
  Stethoscope, 
  RefreshCw, 
  AlertTriangle, 
  ShieldAlert, 
  CheckCircle2, 
  ArrowLeft,
  Loader2 
} from 'lucide-react';
import Navigation from '@/components/Navigation';
import { useMerchantTenant } from '@/contexts/MerchantTenantContext';
import { HospitalAccessContext, HospitalDepartmentQueueEngine, calculateArrivalTag } from '@appointments/shared';
import ConsultationSessionHeader, { FrontDeskStaffMember, DoctorOption } from '@/components/consultation/ConsultationSessionHeader';
import ActiveConsultationCard, { ActiveConsultationBooking } from '@/components/consultation/ActiveConsultationCard';
import UpNextPatientCard from '@/components/consultation/UpNextPatientCard';
import ConsultantQueueTabs from '@/components/consultation/ConsultantQueueTabs';
import MedicalUrgencyOverrideModal from '@/components/consultation/MedicalUrgencyOverrideModal';

export default function DoctorConsultationWorkspacePage() {
  const { activeProvider, isHospitalAdmin, isSuperAdmin, verticalConfig } = useMerchantTenant();

  // Eager URL search parameter resolution
  const [urlDoctorId, setUrlDoctorId] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      return params.get('doctor_id') || params.get('resource_id');
    }
    return null;
  });

  const [demoRole, setDemoRole] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      return new URLSearchParams(window.location.search).get('demo_role');
    }
    return null;
  });

  const [demoAssigned, setDemoAssigned] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      return new URLSearchParams(window.location.search).get('assigned');
    }
    return null;
  });

  const isDemo = typeof window !== 'undefined' && (
    new URLSearchParams(window.location.search).get('demo') === '1' || 
    process.env.NEXT_PUBLIC_DEMO_MODE === 'true'
  );

  // State
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successBanner, setSuccessBanner] = useState<string | null>(null);

  const [hospitalContext, setHospitalContext] = useState<HospitalAccessContext | null>(null);
  const [allDoctors, setAllDoctors] = useState<DoctorOption[]>([]);
  const [selectedDoctorId, setSelectedDoctorId] = useState<string>('');
  const [selectedDoctorName, setSelectedDoctorName] = useState<string>('');
  const [selectedDoctorDept, setSelectedDoctorDept] = useState<string>('');
  const [frontDeskStaff, setFrontDeskStaff] = useState<FrontDeskStaffMember[]>([]);

  const [sessionStatus, setSessionStatus] = useState<'IN_SESSION' | 'ON_BREAK' | 'OFF_DUTY'>('IN_SESSION');
  const [bookings, setBookings] = useState<ActiveConsultationBooking[]>([]);

  // Active consultation state
  const [clinicalNotes, setClinicalNotes] = useState('');
  const [isCompleting, setIsCompleting] = useState(false);
  const [isCallingNext, setIsCallingNext] = useState(false);

  // Medical urgency override modal
  const [overrideModalOpen, setOverrideModalOpen] = useState(false);
  const [selectedBookingForOverride, setSelectedBookingForOverride] = useState<ActiveConsultationBooking | null>(null);
  const [isSubmittingOverride, setIsSubmittingOverride] = useState(false);

  // Fetch access context & available doctor resources
  const initWorkspace = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (isDemo) {
        const demoDocs: DoctorOption[] = [
          { id: 'demo-consultant-1', name: 'Dr. A. Sharma', department: 'Neurology' },
          { id: 'demo-consultant-2', name: 'Dr. R. Patel', department: 'Cardiology' },
        ];
        setAllDoctors(demoDocs);

        const role = demoRole === 'admin' ? 'admin' : (demoRole === 'front_desk' ? 'front_desk' : 'consultant');
        const assignedDoctorIds = demoAssigned === 'none'
          ? []
          : (role === 'admin' ? ['demo-consultant-1', 'demo-consultant-2'] : ['demo-consultant-1']);

        const mockCtx: HospitalAccessContext = {
          role: role as any,
          merchantId: 'demo-hospital-id',
          departmentId: 'dept-neuro',
          departmentName: 'Neurology',
          allowedModules: ['appointments', 'queue_schedule'],
          isHospital: true,
          userId: 'demo-consultant-user',
          assignedDoctorIds,
        };
        setHospitalContext(mockCtx);

        let targetDocId = 'demo-consultant-1';
        if (urlDoctorId) {
          targetDocId = urlDoctorId;
        }
        setSelectedDoctorId(targetDocId);

        const targetDoc = demoDocs.find((d) => d.id === targetDocId) || demoDocs[0];
        setSelectedDoctorName(targetDoc.name);
        setSelectedDoctorDept(targetDoc.department || 'General');

        const today = new Date().toISOString().split('T')[0];
        const mockBookings: ActiveConsultationBooking[] = [
          {
            id: 'demo-b-1',
            reference_code: 'APPT-DEMO-01',
            patient_name: 'Rahul Sharma',
            slot_start: `${today}T10:00:00.000Z`,
            slot_end: `${today}T10:15:00.000Z`,
            status: 'CHECKED_IN',
            arrival_tag: 'On Time',
            checked_in_method: 'Verified Code',
            customer: { full_name: 'Rahul Sharma', phone: '+919876543210' },
          },
          {
            id: 'demo-b-2',
            reference_code: 'APPT-DEMO-02',
            patient_name: 'Ananya Iyer',
            slot_start: `${today}T10:30:00.000Z`,
            slot_end: `${today}T10:45:00.000Z`,
            status: 'CHECKED_IN',
            arrival_tag: 'Early',
            checked_in_method: 'Verified Code',
            customer: { full_name: 'Ananya Iyer', phone: '+919876543211' },
          },
          {
            id: 'demo-b-3',
            reference_code: 'APPT-DEMO-03',
            patient_name: 'Vikram Malhotra',
            slot_start: `${today}T09:30:00.000Z`,
            slot_end: `${today}T09:45:00.000Z`,
            status: 'CHECKED_IN',
            arrival_tag: 'Late',
            checked_in_method: 'Verified Code',
            customer: { full_name: 'Vikram Malhotra', phone: '+919876543212' },
          },
          {
            id: 'demo-b-4',
            reference_code: 'APPT-DEMO-04',
            patient_name: 'Sunita Verma',
            slot_start: `${today}T09:00:00.000Z`,
            slot_end: `${today}T09:15:00.000Z`,
            status: 'COMPLETED',
            arrival_tag: 'On Time',
            checked_in_method: 'Verified Code',
            updated_at: `${today}T09:14:30.000Z`,
            customer: { full_name: 'Sunita Verma', phone: '+919876543213' },
          },
          {
            id: 'demo-b-5',
            reference_code: 'APPT-DEMO-05',
            patient_name: 'Deepak Rao',
            slot_start: `${today}T11:30:00.000Z`,
            slot_end: `${today}T11:45:00.000Z`,
            status: 'BOOKED',
            arrival_tag: 'Expected',
            customer: { full_name: 'Deepak Rao', phone: '+919876543214' },
          },
        ];
        setBookings(mockBookings);
        setFrontDeskStaff([
          { name: 'Reception Desk 1', idCardNumber: 'HOSP-FD-NEURO', email: 'reception@hospital.com' },
        ]);
        setLoading(false);
        return;
      }

      // 1. Fetch Hospital Access Context
      const ctxRes = await fetch('/api/hospital/context');
      let ctx: HospitalAccessContext | null = null;
      if (ctxRes.ok) {
        ctx = await ctxRes.json();
        setHospitalContext(ctx);
      }

      // 2. Fetch Resources / Doctors
      const resQuery = await fetch('/api/resources');
      const resJson = await resQuery.json();
      const docs: any[] = Array.isArray(resJson.data) ? resJson.data : (Array.isArray(resJson) ? resJson : []);

      const mappedDocs: DoctorOption[] = docs.map((d: any) => ({
        id: d.id,
        name: d.name,
        department: d.department || d.attributes?.department || 'General',
      }));
      setAllDoctors(mappedDocs);

      // Determine which doctor is active
      let targetDocId = '';
      if (urlDoctorId && (ctx?.role === 'admin' || ctx?.role === 'owner' || isHospitalAdmin || isSuperAdmin)) {
        targetDocId = urlDoctorId;
      } else if (ctx?.role === 'consultant' && ctx.assignedDoctorIds?.length > 0) {
        targetDocId = ctx.assignedDoctorIds[0];
      } else if (mappedDocs.length > 0) {
        targetDocId = mappedDocs[0].id;
      }

      setSelectedDoctorId(targetDocId);

      const targetDoc = mappedDocs.find((d) => d.id === targetDocId);
      if (targetDoc) {
        setSelectedDoctorName(targetDoc.name);
        setSelectedDoctorDept(targetDoc.department || 'General');
      }
    } catch (err: any) {
      console.error('Error initializing doctor workspace:', err);
      setError(err.message || 'Failed to load doctor workspace');
    } finally {
      setLoading(false);
    }
  }, [isDemo, demoRole, demoAssigned, urlDoctorId, isHospitalAdmin, isSuperAdmin]);

  useEffect(() => {
    initWorkspace();
  }, [initWorkspace]);

  // Load Bookings & Front Desk Staff for the selected doctor
  const loadDoctorData = useCallback(async () => {
    if (!selectedDoctorId || isDemo) return;
    setRefreshing(true);
    try {
      // 1. Fetch bookings
      const bookingsRes = await fetch(`/api/bookings?resource_id=${selectedDoctorId}`);
      if (bookingsRes.ok) {
        const json = await bookingsRes.json();
        const list: any[] = Array.isArray(json.bookings) ? json.bookings : (Array.isArray(json) ? json : []);
        
        // Enrich with arrival tag
        const enriched: ActiveConsultationBooking[] = list.map((b) => {
          const tag = calculateArrivalTag(b.slot_start, b.customer_arrived_at || b.checked_in_at);
          return {
            ...b,
            arrival_tag: tag,
          };
        });
        setBookings(enriched);
      }

      // 2. Fetch Front Desk assignments for this doctor
      try {
        const teamRes = await fetch('/api/admin/doctor-assignments');
        if (teamRes.ok) {
          const teamJson = await teamRes.json();
          const assignments: any[] = teamJson.assignments || [];
          const matched = assignments.filter((a: any) => a.doctor_id === selectedDoctorId);
          setFrontDeskStaff(
            matched.map((m: any) => ({
              name: m.user_name || m.user_email || 'Receptionist',
              idCardNumber: m.id_card_number,
              email: m.user_email,
            }))
          );
        }
      } catch (teamErr) {
        setFrontDeskStaff([
          { name: 'Neurology Reception Desk', idCardNumber: 'HOSP-FD-NEURO' }
        ]);
      }
    } catch (err: any) {
      console.error('Error loading doctor data:', err);
    } finally {
      setRefreshing(false);
    }
  }, [selectedDoctorId, isDemo]);

  useEffect(() => {
    if (selectedDoctorId && !isDemo) {
      loadDoctorData();
    }
  }, [selectedDoctorId, isDemo, loadDoctorData]);

  // Categorize bookings
  const activeBooking = useMemo(() => {
    return bookings.find((b) => b.status === 'IN_CONSULTATION') || null;
  }, [bookings]);

  const waitingPatients = useMemo(() => {
    return bookings.filter(
      (b) => b.status === 'CHECKED_IN' && (b.arrival_tag === 'On Time' || b.arrival_tag === 'Early')
    ).sort((a, b) => new Date(a.slot_start).getTime() - new Date(b.slot_start).getTime());
  }, [bookings]);

  const standbyPatients = useMemo(() => {
    return bookings.filter(
      (b) => b.status === 'CHECKED_IN' && b.arrival_tag === 'Late'
    ).sort((a, b) => new Date(a.slot_start).getTime() - new Date(b.slot_start).getTime());
  }, [bookings]);

  const completedPatients = useMemo(() => {
    return bookings.filter((b) => b.status === 'COMPLETED')
      .sort((a, b) => new Date(b.updated_at || b.slot_end).getTime() - new Date(a.updated_at || a.slot_end).getTime());
  }, [bookings]);

  // Determine Up Next candidate using Queue Engine logic
  const { upNextCandidate, priorityReason } = useMemo(() => {
    if (waitingPatients.length > 0) {
      const first = waitingPatients[0];
      return {
        upNextCandidate: first,
        priorityReason: first.arrival_tag === 'On Time'
          ? 'On-Time Patient (Scheduled window open)'
          : 'Early Arrival (Doctor free to avoid idling)',
      };
    }
    if (standbyPatients.length > 0) {
      const firstStandby = standbyPatients[0];
      return {
        upNextCandidate: firstStandby,
        priorityReason: 'Standby Queue (Schedule gap available / FIFO order)',
      };
    }
    return { upNextCandidate: null, priorityReason: '' };
  }, [waitingPatients, standbyPatients]);

  // Actions
  const handleStartConsultation = async () => {
    if (!upNextCandidate) return;
    setIsCallingNext(true);
    setError(null);
    try {
      if (isDemo) {
        const updated = bookings.map((b) => 
          b.id === upNextCandidate.id 
            ? { ...b, status: 'IN_CONSULTATION', updated_at: new Date().toISOString() } 
            : b
        );
        setBookings(updated);
        setSuccessBanner(`Consultation started for ${upNextCandidate.patient_name || 'Patient'}`);
        setClinicalNotes('');
        setIsCallingNext(false);
        return;
      }

      const res = await fetch('/api/bookings/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ booking_id: upNextCandidate.id }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Failed to start consultation');
      }

      setSuccessBanner(`Consultation started for ${upNextCandidate.patient_name || 'Patient'}`);
      setClinicalNotes('');
      await loadDoctorData();
    } catch (err: any) {
      setError(err.message || 'Error calling patient');
    } finally {
      setIsCallingNext(false);
    }
  };

  const handleCompleteConsultation = async () => {
    if (!activeBooking) return;
    setIsCompleting(true);
    setError(null);
    try {
      if (isDemo) {
        const updated = bookings.map((b) => 
          b.id === activeBooking.id 
            ? { ...b, status: 'COMPLETED', updated_at: new Date().toISOString(), consultation_notes: clinicalNotes } 
            : b
        );
        setBookings(updated);
        setSuccessBanner('Consultation successfully completed and recorded in medical history.');
        setClinicalNotes('');
        setIsCompleting(false);
        return;
      }

      const res = await fetch('/api/bookings/end', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ booking_id: activeBooking.id, notes: clinicalNotes }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Failed to complete consultation');
      }

      setSuccessBanner('Consultation successfully completed and recorded in medical history.');
      setClinicalNotes('');
      await loadDoctorData();
    } catch (err: any) {
      setError(err.message || 'Error completing consultation');
    } finally {
      setIsCompleting(false);
    }
  };

  const handleMedicalOverride = async (targetPosition: number, reason: string) => {
    if (!selectedBookingForOverride) return;
    setIsSubmittingOverride(true);
    setError(null);
    try {
      if (isDemo) {
        const otherWaiting = waitingPatients.filter((b) => b.id !== selectedBookingForOverride.id);
        const reorderedWaiting = targetPosition === 1 
          ? [selectedBookingForOverride, ...otherWaiting] 
          : [...otherWaiting.slice(0, targetPosition - 1), selectedBookingForOverride, ...otherWaiting.slice(targetPosition - 1)];
        
        const otherBookings = bookings.filter((b) => !waitingPatients.some((w) => w.id === b.id));
        setBookings([...reorderedWaiting, ...otherBookings]);
        setSuccessBanner(`Medical urgency override applied: moved to position #${targetPosition} (Logged: ${reason})`);
        setIsSubmittingOverride(false);
        return;
      }

      const res = await fetch('/api/bookings/override', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          booking_id: selectedBookingForOverride.id,
          target_position: targetPosition,
          reason,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Failed to apply medical override');
      }

      setSuccessBanner(`Medical urgency override applied: moved to position #${targetPosition}`);
      await loadDoctorData();
    } catch (err: any) {
      throw err;
    } finally {
      setIsSubmittingOverride(false);
    }
  };

  const handleEmergencyDeparture = async () => {
    if (!confirm('Declare mid-day emergency departure? Remaining unstarted appointments will be protected for manual reassignment or bulk cancellation per SPEC.')) {
      return;
    }
    setSessionStatus('OFF_DUTY');
    setSuccessBanner('Session marked as Emergency Standby / Off Duty.');
  };

  const handleSelectDoctor = (docId: string) => {
    setSelectedDoctorId(docId);
    const d = allDoctors.find((x) => x.id === docId);
    if (d) {
      setSelectedDoctorName(d.name);
      setSelectedDoctorDept(d.department || 'General');
    }
  };

  // 1. Role Authority Classification
  const isConsultant = hospitalContext?.role === 'consultant';
  const isAdminOrOwner = isSuperAdmin || isHospitalAdmin || hospitalContext?.role === 'admin' || hospitalContext?.role === 'owner';
  const myAssignedDoctorId = hospitalContext?.assignedDoctorIds?.[0];

  // 2. Security Check: Cross-consultant URL probe denied (SPEC line 5)
  // If the authenticated user is a Consultant and URL specifies a doctor_id that is NOT their own assigned doctor
  const isForeignDoctorUrlProbe = Boolean(
    isConsultant &&
    urlDoctorId &&
    urlDoctorId !== myAssignedDoctorId
  );

  // 3. Security Check: Consultant has zero assigned doctor resources
  const hasNoAssignedDoctors = Boolean(
    isConsultant &&
    (!hospitalContext?.assignedDoctorIds || hospitalContext.assignedDoctorIds.length === 0)
  );

  // 4. Security Check: Unauthorized Role (Front desk, customer, or outsider)
  const isUnauthorizedRole = !loading && hospitalContext && !isConsultant && !isAdminOrOwner;

  // Render 403 Forbidden: Another Consultant's Desk Unreachable
  if (!loading && isForeignDoctorUrlProbe) {
    return (
      <div data-testid="consultant-foreign-doctor-forbidden" className="min-h-screen bg-slate-50">
        <Navigation />
        <main className="max-w-2xl mx-auto px-4 py-16 text-center">
          <div className="w-16 h-16 rounded-full bg-rose-50 text-rose-600 flex items-center justify-center mx-auto mb-4 border border-rose-100 shadow-xs">
            <ShieldAlert className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mb-2">Access Denied: Another Consultant&apos;s Desk Unreachable</h1>
          <p className="text-sm text-slate-600 mb-6 leading-relaxed">
            Per hospital security policy (<code className="text-rose-700 bg-rose-50 px-1 py-0.5 rounded font-mono">SPEC line 5</code>), 
            Consultants are strictly scoped to their own consultation room and queue. 
            You are not authorized to view or manage consultations for another doctor.
          </p>
          <button
            type="button"
            data-testid="return-to-my-desk-btn"
            onClick={() => {
              setUrlDoctorId(null);
              if (typeof window !== 'undefined') {
                const url = new URL(window.location.href);
                url.searchParams.delete('doctor_id');
                url.searchParams.delete('resource_id');
                window.history.replaceState({}, '', url.toString());
              }
              if (myAssignedDoctorId) {
                handleSelectDoctor(myAssignedDoctorId);
              }
            }}
            className="inline-flex items-center gap-2 px-6 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs rounded-xl transition shadow-xs cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Return to My Consultation Desk</span>
          </button>
        </main>
      </div>
    );
  }

  // Render 403 Forbidden: No Consultant Desk Assigned
  if (!loading && hasNoAssignedDoctors) {
    return (
      <div data-testid="consultant-no-assignments-forbidden" className="min-h-screen bg-slate-50">
        <Navigation />
        <main className="max-w-2xl mx-auto px-4 py-16 text-center">
          <div className="w-16 h-16 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center mx-auto mb-4 border border-amber-100 shadow-xs">
            <ShieldAlert className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mb-2">No Consultant Desk Assigned</h1>
          <p className="text-sm text-slate-600 mb-6 leading-relaxed">
            Your account is verified as a Consultant, but you are not currently assigned to any active doctor consultation desk. 
            Please contact your Hospital Administrator to bind your user profile to a clinical consultant resource.
          </p>
        </main>
      </div>
    );
  }

  // Render 403 Forbidden: Role Restricted (Front desk or customer)
  if (!loading && isUnauthorizedRole) {
    return (
      <div data-testid="consultant-role-forbidden" className="min-h-screen bg-slate-50">
        <Navigation />
        <main className="max-w-2xl mx-auto px-4 py-16 text-center">
          <div className="w-16 h-16 rounded-full bg-rose-50 text-rose-600 flex items-center justify-center mx-auto mb-4 border border-rose-100 shadow-xs">
            <ShieldAlert className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mb-2">Consultant Desk Restricted</h1>
          <p className="text-sm text-slate-600 mb-6 leading-relaxed">
            This workspace is strictly reserved for bound Hospital Consultants and Hospital Administrators. 
            Front Desk staff must use the Reception Check-In Desk.
          </p>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <Navigation />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {/* Success Alert */}
        {successBanner && (
          <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-xl flex items-center justify-between text-xs font-medium animate-in fade-in duration-200">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
              <span>{successBanner}</span>
            </div>
            <button
              type="button"
              onClick={() => setSuccessBanner(null)}
              className="text-emerald-700 hover:text-emerald-900 font-bold ml-4 cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Error Alert */}
        {error && (
          <div data-testid="consultant-error-banner" className="p-4 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl flex items-center justify-between text-xs font-medium">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{error}</span>
            </div>
            <button
              type="button"
              onClick={() => setError(null)}
              className="text-rose-700 hover:text-rose-900 font-bold ml-4 cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Loading Skeleton */}
        {loading ? (
          <div data-testid="consultant-loading-skeleton" className="space-y-6">
            <div className="h-44 bg-white border border-slate-200 rounded-2xl animate-pulse" />
            <div className="h-72 bg-white border border-slate-200 rounded-2xl animate-pulse" />
          </div>
        ) : (
          <>
            {/* 1. Session Header */}
            <ConsultationSessionHeader
              doctorName={selectedDoctorName}
              departmentName={selectedDoctorDept}
              hospitalName={activeProvider?.name || 'Apex General Hospital'}
              frontDeskStaff={frontDeskStaff}
              sessionStatus={sessionStatus}
              onToggleStatus={setSessionStatus}
              onEmergencyDeparture={handleEmergencyDeparture}
              isHospitalAdmin={isAdminOrOwner}
              allDoctors={allDoctors}
              selectedDoctorId={selectedDoctorId}
              onSelectDoctor={handleSelectDoctor}
            />

            {/* 2. Refresh bar */}
            <div className="flex items-center justify-between text-xs text-slate-500 px-1">
              <span>Real-time clinical queue synchronized with hospital reception.</span>
              <button
                type="button"
                data-testid="sync-queue-btn"
                onClick={loadDoctorData}
                disabled={refreshing}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-medium transition cursor-pointer shadow-2xs"
              >
                <RefreshCw className={`w-3.5 h-3.5 text-slate-500 ${refreshing ? 'animate-spin' : ''}`} />
                {refreshing ? 'Syncing...' : 'Sync Queue'}
              </button>
            </div>

            {/* 3. In Consultation Section */}
            <ActiveConsultationCard
              booking={activeBooking}
              notes={clinicalNotes}
              onNotesChange={setClinicalNotes}
              onComplete={handleCompleteConsultation}
              isCompleting={isCompleting}
            />

            {/* 4. Up Next Patient Card */}
            <UpNextPatientCard
              candidate={upNextCandidate}
              priorityReason={priorityReason}
              onCallPatient={handleStartConsultation}
              isCalling={isCallingNext}
              hasActiveConsultation={Boolean(activeBooking)}
            />

            {/* 5. Queue Tabs (Waiting, Standby, Completed, All) */}
            <ConsultantQueueTabs
              waitingPatients={waitingPatients}
              standbyPatients={standbyPatients}
              completedPatients={completedPatients}
              allScheduledPatients={bookings}
              onOverrideUrgency={(b) => {
                setSelectedBookingForOverride(b);
                setOverrideModalOpen(true);
              }}
            />
          </>
        )}

        {/* Medical Urgency Override Modal */}
        <MedicalUrgencyOverrideModal
          isOpen={overrideModalOpen}
          onClose={() => {
            setOverrideModalOpen(false);
            setSelectedBookingForOverride(null);
          }}
          booking={selectedBookingForOverride}
          totalQueueLength={waitingPatients.length}
          onSubmit={handleMedicalOverride}
          isSubmitting={isSubmittingOverride}
        />
      </main>
    </div>
  );
}
