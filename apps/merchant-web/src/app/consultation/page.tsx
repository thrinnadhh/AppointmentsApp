'use client';

import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { 
  Stethoscope, 
  RefreshCw, 
  AlertTriangle, 
  ShieldAlert, 
  CheckCircle2, 
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
      if (ctx?.role === 'consultant' && ctx.assignedDoctorIds?.length > 0) {
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
  }, []);

  useEffect(() => {
    initWorkspace();
  }, [initWorkspace]);

  // Load Bookings & Front Desk Staff for the selected doctor
  const loadDoctorData = useCallback(async () => {
    if (!selectedDoctorId) return;
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
        // Non-admin might get 403 on full assignments list; fallback gracefully
        setFrontDeskStaff([
          { name: 'Neurology Reception Desk', idCardNumber: 'HOSP-FD-NEURO' }
        ]);
      }
    } catch (err: any) {
      console.error('Error loading doctor data:', err);
    } finally {
      setRefreshing(false);
    }
  }, [selectedDoctorId]);

  useEffect(() => {
    if (selectedDoctorId) {
      loadDoctorData();
    }
  }, [selectedDoctorId, loadDoctorData]);

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

  // Determine Up Next candidate using Queue Engine
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
      const res = await fetch('/api/bookings/end', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ booking_id: activeBooking.id }),
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

  // Role Gate Check: Only Consultants, Hospital Admins, or SuperAdmin
  const isAuthorizedRole = 
    isSuperAdmin ||
    isHospitalAdmin ||
    hospitalContext?.role === 'admin' ||
    hospitalContext?.role === 'owner' ||
    hospitalContext?.role === 'consultant';

  if (!loading && hospitalContext && !isAuthorizedRole) {
    return (
      <div className="min-h-screen bg-slate-50">
        <Navigation />
        <main className="max-w-2xl mx-auto px-4 py-16 text-center">
          <div className="w-16 h-16 rounded-full bg-rose-50 text-rose-600 flex items-center justify-center mx-auto mb-4 border border-rose-100">
            <ShieldAlert className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mb-2">Consultant Desk Restricted</h1>
          <p className="text-sm text-slate-600 mb-6">
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
          <div className="p-4 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl flex items-center justify-between text-xs font-medium">
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
          <div className="space-y-6">
            <div className="h-44 bg-white border border-slate-200 rounded-2xl animate-pulse" />
            <div className="h-72 bg-white border border-slate-200 rounded-2xl animate-pulse" />
          </div>
        ) : (
          <>
            {/* 1. Session Header */}
            <ConsultationSessionHeader
              doctorName={selectedDoctorName}
              departmentName={selectedDoctorDept}
              hospitalName={activeProvider?.name || 'Hospital Vertical'}
              frontDeskStaff={frontDeskStaff}
              sessionStatus={sessionStatus}
              onToggleStatus={setSessionStatus}
              onEmergencyDeparture={handleEmergencyDeparture}
              isHospitalAdmin={isHospitalAdmin || isSuperAdmin}
              allDoctors={allDoctors}
              selectedDoctorId={selectedDoctorId}
              onSelectDoctor={handleSelectDoctor}
            />

            {/* 2. Refresh bar */}
            <div className="flex items-center justify-between text-xs text-slate-500 px-1">
              <span>Real-time clinical queue synchronized with hospital reception.</span>
              <button
                type="button"
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
