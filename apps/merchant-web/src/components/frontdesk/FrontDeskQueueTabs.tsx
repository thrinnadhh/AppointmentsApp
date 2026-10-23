'use client';

import React, { useState } from 'react';
import { 
  Users, 
  Clock, 
  CheckCircle2, 
  CalendarDays, 
  UserCheck, 
  AlertCircle, 
  ArrowRight,
  Phone,
  Play,
  Check,
  Search,
  UserX,
  Sparkles,
  HelpCircle,
  FileText,
  Stethoscope
} from 'lucide-react';
import { CustomerContactBadge } from '@/components/CustomerContactBadge';

export interface FrontDeskQueueBooking {
  id: string;
  reference_code: string;
  patient_name?: string;
  customer?: {
    full_name?: string;
    phone?: string;
  };
  slot_start: string;
  slot_end: string;
  status: string;
  arrival_tag?: 'On Time' | 'Early' | 'Late' | 'Expected';
  checked_in_at?: string;
  doctor_name?: string;
  department_name?: string;
  queue_position?: number;
  deposit_amount?: number;
}

interface FrontDeskQueueTabsProps {
  waitingBookings: FrontDeskQueueBooking[];
  standbyBookings: FrontDeskQueueBooking[];
  expectedBookings: FrontDeskQueueBooking[];
  completedBookings: FrontDeskQueueBooking[];
  inConsultationBookings?: FrontDeskQueueBooking[];
  upNextBookingId?: string | null;
  onAdmitPatient: (bookingId: string) => Promise<void>;
  onStartConsultation: (bookingId: string) => Promise<void>;
  onEndConsultation: (bookingId: string) => Promise<void>;
  onManualMarkPresent: (booking: FrontDeskQueueBooking) => void;
  onMarkNoShow: (bookingId: string, depositAmount?: number) => Promise<void>;
  isProcessingAction: boolean;
}

export default function FrontDeskQueueTabs({
  waitingBookings,
  standbyBookings,
  expectedBookings,
  completedBookings,
  inConsultationBookings = [],
  upNextBookingId,
  onAdmitPatient,
  onStartConsultation,
  onEndConsultation,
  onManualMarkPresent,
  onMarkNoShow,
  isProcessingAction,
}: FrontDeskQueueTabsProps) {
  const [activeTab, setActiveTab] = useState<'waiting' | 'standby' | 'expected' | 'completed'>('waiting');
  const [searchQuery, setSearchQuery] = useState('');
  const [noShowConfirmBooking, setNoShowConfirmBooking] = useState<FrontDeskQueueBooking | null>(null);

  const getArrivalBadge = (tag?: string) => {
    switch (tag) {
      case 'On Time':
        return (
          <span data-testid="patient-on-time-tag" className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
            On Time
          </span>
        );
      case 'Early':
        return (
          <span data-testid="patient-early-tag" className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-sky-50 text-sky-800 border border-sky-200">
            <Clock className="w-3 h-3 text-sky-600" />
            Early
          </span>
        );
      case 'Late':
        return (
          <span data-testid="patient-late-tag" className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200">
            <AlertCircle className="w-3 h-3 text-amber-600" />
            Late
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-50 text-slate-700 border border-slate-200">
            Expected
          </span>
        );
    }
  };

  // Filter expected bookings by search query
  const filteredExpected = expectedBookings.filter((b) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    const name = (b.patient_name || b.customer?.full_name || '').toLowerCase();
    const phone = (b.customer?.phone || '').toLowerCase();
    const ref = (b.reference_code || '').toLowerCase();
    return name.includes(q) || phone.includes(q) || ref.includes(q);
  });

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
      {/* Tab Navigation Ribbon */}
      <div className="flex border-b border-slate-200 bg-slate-50/60 overflow-x-auto scrollbar-thin">
        <button
          type="button"
          onClick={() => setActiveTab('waiting')}
          className={`flex items-center gap-2 px-5 py-3.5 text-xs font-bold border-b-2 transition shrink-0 cursor-pointer ${
            activeTab === 'waiting'
              ? 'border-emerald-600 text-emerald-700 bg-white'
              : 'border-transparent text-slate-500 hover:text-slate-900 hover:bg-slate-100/50'
          }`}
        >
          <UserCheck className="w-4 h-4" />
          <span>Waiting Queue</span>
          <span className={`px-2 py-0.2 rounded-full text-[10px] font-mono ${
            activeTab === 'waiting' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'
          }`}>
            {waitingBookings.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('standby')}
          className={`flex items-center gap-2 px-5 py-3.5 text-xs font-bold border-b-2 transition shrink-0 cursor-pointer ${
            activeTab === 'standby'
              ? 'border-emerald-600 text-emerald-700 bg-white'
              : 'border-transparent text-slate-500 hover:text-slate-900 hover:bg-slate-100/50'
          }`}
        >
          <Clock className="w-4 h-4 text-amber-600" />
          <span>Standby Queue (late patients)</span>
          <span className={`px-2 py-0.2 rounded-full text-[10px] font-mono ${
            activeTab === 'standby' ? 'bg-amber-100 text-amber-800' : 'bg-slate-200 text-slate-600'
          }`}>
            {standbyBookings.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('expected')}
          className={`flex items-center gap-2 px-5 py-3.5 text-xs font-bold border-b-2 transition shrink-0 cursor-pointer ${
            activeTab === 'expected'
              ? 'border-emerald-600 text-emerald-700 bg-white'
              : 'border-transparent text-slate-500 hover:text-slate-900 hover:bg-slate-100/50'
          }`}
        >
          <CalendarDays className="w-4 h-4" />
          <span>Expected Today</span>
          <span className={`px-2 py-0.2 rounded-full text-[10px] font-mono ${
            activeTab === 'expected' ? 'bg-sky-100 text-sky-800' : 'bg-slate-200 text-slate-600'
          }`}>
            {expectedBookings.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('completed')}
          className={`flex items-center gap-2 px-5 py-3.5 text-xs font-bold border-b-2 transition shrink-0 cursor-pointer ${
            activeTab === 'completed'
              ? 'border-emerald-600 text-emerald-700 bg-white'
              : 'border-transparent text-slate-500 hover:text-slate-900 hover:bg-slate-100/50'
          }`}
        >
          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          <span>Completed</span>
          <span className={`px-2 py-0.2 rounded-full text-[10px] font-mono ${
            activeTab === 'completed' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'
          }`}>
            {completedBookings.length}
          </span>
        </button>
      </div>

      {/* Tab Content */}
      <div className="p-5 sm:p-6">
        {/* Active In-Consultation Banner */}
        {inConsultationBookings && inConsultationBookings.length > 0 && (
          <div data-testid="in-consultation-panel" className="mb-6 p-4 rounded-xl bg-emerald-50 border border-emerald-300 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-2xs">
                <Stethoscope className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-800">In Consultation Now</span>
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                </div>
                <p className="text-sm font-black text-emerald-950 mt-0.5">
                  {inConsultationBookings[0].patient_name || inConsultationBookings[0].customer?.full_name || 'Patient'}
                  <span className="text-xs font-normal text-emerald-700 ml-2 font-mono">
                    ({inConsultationBookings[0].reference_code})
                  </span>
                </p>
                <p className="text-xs text-emerald-700">
                  Doctor: <strong>{inConsultationBookings[0].doctor_name || 'Consultant'}</strong> • Slot: {new Date(inConsultationBookings[0].slot_start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - {new Date(inConsultationBookings[0].slot_end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            </div>
            <button
              type="button"
              data-testid="end-consultation-btn"
              disabled={isProcessingAction}
              onClick={() => onEndConsultation(inConsultationBookings[0].id)}
              className="px-4 py-2 rounded-xl text-xs font-bold bg-slate-900 hover:bg-slate-800 text-white transition disabled:opacity-50 shadow-xs flex items-center gap-2 cursor-pointer self-start sm:self-center shrink-0"
            >
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>Complete Consultation</span>
            </button>
          </div>
        )}

        {/* TAB 1: WAITING QUEUE */}
        {activeTab === 'waiting' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Patients currently present in the hospital waiting lounge ({waitingBookings.length})</span>
              <span>Sorted by Queue Engine Priority</span>
            </div>

            {waitingBookings.length === 0 ? (
              <div className="py-12 text-center text-slate-400 space-y-2">
                <UserCheck className="w-8 h-8 mx-auto text-slate-300" />
                <p className="text-sm font-semibold">Waiting Queue is Empty</p>
                <p className="text-xs">No checked-in patients are currently waiting.</p>
              </div>
            ) : (
              <div data-testid="waiting-queue-list" className="border border-slate-200 rounded-xl divide-y divide-slate-100 overflow-hidden">
                {waitingBookings.map((booking, idx) => {
                  const patientName = booking.patient_name || booking.customer?.full_name || 'Patient';
                  const slotStr = `${new Date(booking.slot_start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${new Date(booking.slot_end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
                  const isUpNext = booking.id === upNextBookingId || (idx === 0 && (!upNextBookingId || upNextBookingId === booking.id));

                  return (
                    <div 
                      key={booking.id}
                      className="p-4 hover:bg-slate-50/70 transition flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-800 font-mono font-bold text-xs flex items-center justify-center shrink-0">
                          #{idx + 1}
                        </div>
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-bold text-slate-900">{patientName}</span>
                            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-slate-100 text-slate-600">
                              {booking.reference_code}
                            </span>
                            {getArrivalBadge(booking.arrival_tag)}
                            {isUpNext && (
                              <span 
                                data-testid="up-next-badge"
                                className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 shadow-2xs"
                              >
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse" />
                                Up Next
                              </span>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 mt-1">
                            {booking.doctor_name && (
                              <span>Doctor: <strong className="text-slate-700">{booking.doctor_name}</strong></span>
                            )}
                            <span>Slot: <strong className="font-mono text-slate-700">{slotStr}</strong></span>
                            {booking.checked_in_at && (
                              <span>Arrived: {new Date(booking.checked_in_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Action buttons */}
                      <div className="flex items-center gap-2 self-end sm:self-center">
                        <button
                          type="button"
                          data-testid="start-consultation-btn"
                          disabled={isProcessingAction}
                          onClick={() => onStartConsultation(booking.id)}
                          className="px-3.5 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white transition disabled:opacity-50 shadow-2xs flex items-center gap-1.5 cursor-pointer"
                        >
                          <Play className="w-3.5 h-3.5 fill-current" />
                          <span>Call Patient</span>
                        </button>
                        <button
                          type="button"
                          data-testid="mark-no-show-btn"
                          disabled={isProcessingAction}
                          onClick={() => setNoShowConfirmBooking(booking)}
                          className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-rose-50 hover:bg-rose-100 text-rose-800 border border-rose-200 transition cursor-pointer"
                        >
                          Mark No Show
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* TAB 2: STANDBY QUEUE */}
        {activeTab === 'standby' && (
          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-amber-50/70 border border-amber-200 text-xs text-amber-950 flex items-start gap-3">
              <AlertCircle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">Standby Queue Rules (SPEC line 19 &amp; 20)</p>
                <p className="text-amber-900 mt-0.5 leading-relaxed">
                  Patients arriving &gt;10m after their booked slot are placed in the Standby Queue in original booking order (FIFO). 
                  They are admitted into free gaps without displacing on-time patients.
                </p>
              </div>
            </div>

            {standbyBookings.length === 0 ? (
              <div className="py-12 text-center text-slate-400 space-y-2">
                <Clock className="w-8 h-8 mx-auto text-slate-300" />
                <p className="text-sm font-semibold">No Patients on Standby</p>
                <p className="text-xs">There are no late arrival patients waiting for gaps.</p>
              </div>
            ) : (
              <div data-testid="standby-queue-list" className="border border-slate-200 rounded-xl divide-y divide-slate-100 overflow-hidden">
                {standbyBookings.map((booking, idx) => {
                  const patientName = booking.patient_name || booking.customer?.full_name || 'Patient';
                  return (
                    <div 
                      key={booking.id}
                      className="p-4 hover:bg-slate-50/70 transition flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-amber-100 text-amber-800 font-mono font-bold text-xs flex items-center justify-center shrink-0">
                          S{idx + 1}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-slate-900">{patientName}</span>
                            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-slate-100 text-slate-600">
                              {booking.reference_code}
                            </span>
                            {getArrivalBadge('Late')}
                          </div>
                          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 mt-1">
                            {booking.doctor_name && <span>{booking.doctor_name}</span>}
                            <span>Original Slot: <strong className="font-mono text-slate-700">{new Date(booking.slot_start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</strong></span>
                            <span className="text-amber-800 font-medium">Eligible for next free gap</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 self-end sm:self-center">
                        <button
                          type="button"
                          disabled={isProcessingAction}
                          onClick={() => onStartConsultation(booking.id)}
                          className="px-3.5 py-2 rounded-xl text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white transition disabled:opacity-50 shadow-2xs flex items-center gap-1.5 cursor-pointer"
                        >
                          <Play className="w-3.5 h-3.5 fill-current" />
                          <span>Admit to Gap</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* TAB 3: EXPECTED TODAY */}
        {activeTab === 'expected' && (
          <div className="space-y-4">
            {/* Search and filter bar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter expected patients by name, phone, or booking reference..."
                  className="w-full pl-9 pr-4 py-2 rounded-xl border border-slate-300 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <span className="text-xs font-semibold text-slate-500 font-mono">
                {filteredExpected.length} upcoming
              </span>
            </div>

            {filteredExpected.length === 0 ? (
              <div className="py-12 text-center text-slate-400 space-y-2">
                <CalendarDays className="w-8 h-8 mx-auto text-slate-300" />
                <p className="text-sm font-semibold">No Remaining Expected Patients</p>
                <p className="text-xs">All scheduled patients for today have arrived or no appointments matched.</p>
              </div>
            ) : (
              <div data-testid="expected-queue-list" className="border border-slate-200 rounded-xl divide-y divide-slate-100 overflow-hidden">
                {filteredExpected.map((booking) => {
                  const patientName = booking.patient_name || booking.customer?.full_name || 'Patient';
                  const slotStart = new Date(booking.slot_start);
                  const isPastSlot = Date.now() > slotStart.getTime();

                  return (
                    <div 
                      key={booking.id}
                      className="p-4 hover:bg-slate-50/70 transition flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-slate-900">{patientName}</span>
                          <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-slate-100 text-slate-600">
                            {booking.reference_code}
                          </span>
                          {getArrivalBadge('Expected')}
                        </div>
                        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 mt-1">
                          {booking.doctor_name && <span>{booking.doctor_name}</span>}
                          <span>Booked Slot: <strong className="font-mono text-slate-700">{slotStart.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</strong></span>
                          {booking.customer?.phone && (
                            <span className="flex items-center gap-1 font-mono text-slate-600">
                              <Phone className="w-3 h-3 text-slate-400" />
                              {booking.customer.phone}
                            </span>
                          )}
                          {booking.deposit_amount && (
                            <span className="font-mono text-emerald-800">
                              Deposit: ₹{booking.deposit_amount}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Action buttons */}
                      <div className="flex items-center gap-2 self-end sm:self-center">
                        <button
                          type="button"
                          onClick={() => onManualMarkPresent(booking)}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 transition cursor-pointer"
                        >
                          Manual Mark Present
                        </button>
                        {isPastSlot && (
                          <button
                            type="button"
                            data-testid="mark-no-show-btn"
                            onClick={() => setNoShowConfirmBooking(booking)}
                            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-rose-50 hover:bg-rose-100 text-rose-800 border border-rose-200 transition cursor-pointer"
                          >
                            Mark No Show
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* TAB 4: COMPLETED TODAY */}
        {activeTab === 'completed' && (
          <div className="space-y-4">
            {completedBookings.length === 0 ? (
              <div className="py-12 text-center text-slate-400 space-y-2">
                <CheckCircle2 className="w-8 h-8 mx-auto text-slate-300" />
                <p className="text-sm font-semibold">No Completed Consultations Today</p>
                <p className="text-xs">Finished patient visits will appear here.</p>
              </div>
            ) : (
              <div data-testid="completed-queue-list" className="border border-slate-200 rounded-xl divide-y divide-slate-100 overflow-hidden">
                {completedBookings.map((booking) => {
                  const patientName = booking.patient_name || booking.customer?.full_name || 'Patient';
                  return (
                    <div 
                      key={booking.id}
                      className="p-4 hover:bg-slate-50/70 transition flex items-center justify-between"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-slate-900">{patientName}</span>
                          <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-slate-100 text-slate-600">
                            {booking.reference_code}
                          </span>
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                            Completed
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-slate-500 mt-1">
                          {booking.doctor_name && <span>{booking.doctor_name}</span>}
                          <span>Slot: <strong className="font-mono text-slate-700">{new Date(booking.slot_start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</strong></span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* No Show Confirmation Modal */}
      {noShowConfirmBooking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fadeIn">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-md overflow-hidden p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-rose-50 text-rose-700">
                <UserX className="w-5 h-5 text-rose-600" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">Confirm No Show</h3>
                <p className="text-xs text-slate-500">
                  {noShowConfirmBooking.patient_name || 'Patient'} did not check in before session end.
                </p>
              </div>
            </div>

            {/* Spec financial explanation per SPEC line 13 */}
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-1.5">
              <p className="font-bold text-slate-800">Deposit Settlement (SPEC line 13):</p>
              <div className="grid grid-cols-2 gap-2 pt-1 font-mono text-[11px]">
                <div className="p-2 rounded bg-white border border-slate-200">
                  <span className="text-slate-500 block">Doctor Share:</span>
                  <span className="font-bold text-slate-900">₹50</span>
                </div>
                <div className="p-2 rounded bg-white border border-slate-200">
                  <span className="text-slate-500 block">Platform Share:</span>
                  <span className="font-bold text-slate-900">₹10</span>
                </div>
              </div>
              <p className="text-[11px] text-slate-500 pt-1">
                Customer refund: Remaining deposit minus ₹60. Account flagged for reporting only.
              </p>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setNoShowConfirmBooking(null)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-700 hover:bg-slate-100 transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isProcessingAction}
                onClick={async () => {
                  await onMarkNoShow(noShowConfirmBooking.id, noShowConfirmBooking.deposit_amount);
                  setNoShowConfirmBooking(null);
                }}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white transition disabled:opacity-50 cursor-pointer"
              >
                Confirm No Show
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
