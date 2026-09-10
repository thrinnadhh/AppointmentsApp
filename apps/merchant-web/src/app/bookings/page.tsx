'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { 
  CheckCircle2, 
  Clock, 
  Phone, 
  AlertTriangle,
  RotateCcw,
  Check,
  Search,
  RefreshCw,
  Building2,
  Sparkles
} from 'lucide-react';
import { 
  supabase, 
  fetchAllProviders, 
  fetchMerchantBookings, 
  updateBookingStatus, 
  rescheduleBookingSlot, 
  recordMerchantNoShow,
  MerchantBookingWithDetails 
} from '@/lib/supabase';
import { INITIAL_BOOKINGS, INITIAL_MERCHANT_PROVIDER } from '@/lib/mock-data';
import { BookingStatus, Provider, PaymentStatus } from '@appointments/shared';

export default function BookingsManagementPage() {
  const [providers, setProviders] = useState<Provider[]>([INITIAL_MERCHANT_PROVIDER]);
  const [selectedProviderId, setSelectedProviderId] = useState<string>('ALL');
  const [bookings, setBookings] = useState<MerchantBookingWithDetails[]>(INITIAL_BOOKINGS as unknown as MerchantBookingWithDetails[]);
  const [loading, setLoading] = useState(true);
  const [selectedFilter, setSelectedFilter] = useState<'ALL' | BookingStatus>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [rescheduleModalId, setRescheduleModalId] = useState<string | null>(null);
  const [newSlotTime, setNewSlotTime] = useState('');
  const [feedbackToast, setFeedbackToast] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [fetchedProviders, fetchedBookings] = await Promise.all([
        fetchAllProviders(),
        fetchMerchantBookings(selectedProviderId === 'ALL' ? undefined : selectedProviderId)
      ]);

      if (fetchedProviders && fetchedProviders.length > 0) {
        setProviders(fetchedProviders);
      }
      if (fetchedBookings && fetchedBookings.length > 0) {
        setBookings(fetchedBookings);
      }
    } catch (err) {
      console.warn('Fallback to local state due to error:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedProviderId]);

  useEffect(() => {
    loadData();

    const channel = supabase
      .channel('bookings-mgmt-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bookings' },
        (payload) => {
          const newStatus = (payload.new as { status?: string })?.status;
          setFeedbackToast(`Realtime Sync: Slot ${newStatus || 'updated'}`);
          loadData();
          setTimeout(() => setFeedbackToast(null), 4000);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadData]);

  const filteredBookings = bookings.filter((b) => {
    const matchesFilter = selectedFilter === 'ALL' || b.status === selectedFilter;
    const matchesSearch = 
      (b.customer_name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (b.customer_phone || '').includes(searchQuery) ||
      (b.resource_name || '').toLowerCase().includes(searchQuery.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  const handleStatusChange = async (
    bookingId: string, 
    newStatus: BookingStatus, 
    paymentStatus?: PaymentStatus
  ) => {
    try {
      if (newStatus === 'NO_SHOW') {
        await recordMerchantNoShow(bookingId);
        setFeedbackToast('No-show recorded in Supabase: deposit forfeited & strike incremented.');
      } else {
        await updateBookingStatus(bookingId, newStatus, paymentStatus);
        setFeedbackToast(`Booking updated to ${newStatus} on Supabase`);
      }
      await loadData();
    } catch (err) {
      console.error('Supabase error, updating locally:', err);
      setBookings((prev) =>
        prev.map((b) => {
          if (b.id === bookingId) {
            return {
              ...b,
              status: newStatus,
              payment_status: paymentStatus || (newStatus === 'NO_SHOW' ? 'FORFEITED' : (newStatus === 'CANCELLED' ? 'REFUNDED' : b.payment_status)),
              updated_at: new Date().toISOString(),
            };
          }
          return b;
        })
      );
    } finally {
      setTimeout(() => setFeedbackToast(null), 4000);
    }
  };

  const handleRescheduleSubmit = async (bookingId: string) => {
    if (!newSlotTime) return;
    const targetBooking = bookings.find((b) => b.id === bookingId);
    if (!targetBooking) return;

    const date = new Date(targetBooking.slot_start);
    const [hours, mins] = newSlotTime.split(':').map(Number);
    date.setHours(hours, mins, 0, 0);
    const newStart = date.toISOString();
    const newEnd = new Date(date.getTime() + 1000 * 60 * 30).toISOString();

    try {
      await rescheduleBookingSlot(bookingId, newStart, newEnd);
      setFeedbackToast(`Booking rescheduled to ${newSlotTime} on Supabase`);
      await loadData();
    } catch (err) {
      console.error('Reschedule error, updating locally:', err);
      setBookings((prev) =>
        prev.map((b) => {
          if (b.id === bookingId) {
            return {
              ...b,
              slot_start: newStart,
              slot_end: newEnd,
              status: 'CONFIRMED',
            };
          }
          return b;
        })
      );
    } finally {
      setRescheduleModalId(null);
      setNewSlotTime('');
      setTimeout(() => setFeedbackToast(null), 4000);
    }
  };

  return (
    <div className="space-y-6">
      {/* Toast Feedback */}
      {feedbackToast && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 px-4 py-3 rounded-xl flex items-center justify-between text-sm shadow-sm animate-fade-in">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-emerald-600" />
            <span className="font-semibold">{feedbackToast}</span>
          </div>
          <span className="text-xs bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded font-mono">Supabase Sync</span>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Bookings & Queue</h1>
          <p className="text-sm text-slate-500 mt-1">
            Real-time appointment triage, fulfillment, and no-show processing across Tirupati
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Provider Filter */}
          <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-xl px-3 py-1.5 shadow-sm">
            <Building2 className="w-3.5 h-3.5 text-slate-400" />
            <label htmlFor="venue-filter" className="sr-only">Filter by Venue</label>
            <select
              id="venue-filter"
              value={selectedProviderId}
              onChange={(e) => setSelectedProviderId(e.target.value)}
              className="text-xs font-semibold text-slate-800 bg-transparent focus:outline-none cursor-pointer"
            >
              <option value="ALL">All Tirupati Venues</option>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={() => loadData()}
            disabled={loading}
            className="p-2 rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition shadow-sm"
            title="Refresh Live Supabase Records"
            aria-label="Refresh bookings"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-emerald-600' : ''}`} />
          </button>
        </div>
      </div>

      {/* Filters & Search */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row gap-4 justify-between items-center">
        {/* Status Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto w-full md:w-auto pb-1 md:pb-0">
          {(['ALL', 'CONFIRMED', 'HELD', 'COMPLETED', 'NO_SHOW', 'CANCELLED'] as const).map((filter) => (
            <button
              key={filter}
              onClick={() => setSelectedFilter(filter)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition ${
                selectedFilter === filter
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {filter.replace('_', ' ')}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative w-full md:w-72">
          <label htmlFor="customer-search" className="sr-only">Search appointments</label>
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            id="customer-search"
            name="customerSearch"
            type="text"
            aria-label="Search by customer name, phone number, or unit"
            placeholder="Search customer, phone, unit..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-slate-50/50"
          />
        </div>
      </div>

      {/* Bookings List */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden divide-y divide-slate-100">
        {filteredBookings.length === 0 ? (
          <div className="p-12 text-center text-slate-500 text-sm">
            No bookings found matching the selected filters.
          </div>
        ) : (
          filteredBookings.map((booking) => {
            const slotDate = new Date(booking.slot_start);
            const formattedTime = slotDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const formattedDate = slotDate.toLocaleDateString('en-IN', { month: 'short', day: 'numeric', weekday: 'short' });

            return (
              <div key={booking.id} className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-slate-50/50 transition">
                <div className="flex items-start space-x-4">
                  <div className="w-12 h-12 rounded-xl bg-slate-100 border border-slate-200 flex flex-col items-center justify-center flex-shrink-0">
                    <span className="text-[10px] font-bold text-slate-500 uppercase">{slotDate.toLocaleDateString('en-IN', { weekday: 'short' })}</span>
                    <span className="text-sm font-bold text-slate-900">{slotDate.getDate()}</span>
                  </div>

                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="font-bold text-slate-900 text-sm">{booking.customer_name || 'Customer'}</h2>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        booking.status === 'CONFIRMED'
                          ? 'bg-emerald-100 text-emerald-800'
                          : booking.status === 'HELD'
                          ? 'bg-amber-100 text-amber-800'
                          : booking.status === 'COMPLETED'
                          ? 'bg-slate-100 text-slate-700'
                          : booking.status === 'NO_SHOW'
                          ? 'bg-rose-100 text-rose-800'
                          : 'bg-slate-100 text-slate-500'
                      }`}>
                        {booking.status.replace('_', ' ')}
                      </span>
                      {(booking.no_show_count ?? 0) >= 3 && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300">
                          ⚠️ {booking.no_show_count} Strikes
                        </span>
                      )}
                    </div>

                    <p className="text-xs text-slate-600 mt-1">
                      Venue: <strong className="text-slate-800">{booking.provider_name}</strong> • Unit: <strong className="text-slate-800">{booking.resource_name}</strong>
                    </p>

                    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 mt-1">
                      <span className="flex items-center gap-1 font-medium text-slate-700">
                        <Clock className="w-3.5 h-3.5 text-slate-400" />
                        {formattedTime} ({formattedDate})
                      </span>
                      {booking.customer_phone && (
                        <span className="flex items-center gap-1">
                          <Phone className="w-3.5 h-3.5 text-slate-400" />
                          {booking.customer_phone}
                        </span>
                      )}
                      <span className="text-emerald-700 font-semibold bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200/50">
                        Deposit: ₹{booking.deposit_amount} ({booking.payment_status})
                      </span>
                    </div>
                  </div>
                </div>

                {/* Status Action Buttons */}
                <div className="flex items-center gap-2 self-end md:self-center flex-wrap">
                  {booking.status === 'CONFIRMED' && (
                    <>
                      <button
                        onClick={() => handleStatusChange(booking.id, 'COMPLETED')}
                        className="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition"
                      >
                        <Check className="w-3.5 h-3.5 mr-1" />
                        Complete
                      </button>

                      <button
                        onClick={() => setRescheduleModalId(booking.id)}
                        className="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200 transition"
                      >
                        <RotateCcw className="w-3.5 h-3.5 mr-1" />
                        Reschedule
                      </button>

                      <button
                        onClick={() => handleStatusChange(booking.id, 'NO_SHOW', 'FORFEITED')}
                        className="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-semibold bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200 transition"
                        title="Customer didn't arrive. Forfeits deposit to merchant and counts toward no-show record"
                      >
                        <AlertTriangle className="w-3.5 h-3.5 mr-1 text-rose-500" />
                        No-Show
                      </button>

                      <button
                        onClick={() => handleStatusChange(booking.id, 'CANCELLED', 'REFUNDED')}
                        className="inline-flex items-center px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition"
                        title="Business cancellation: Always triggers full refund to customer"
                      >
                        Cancel & Refund
                      </button>
                    </>
                  )}

                  {booking.status === 'HELD' && (
                    <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-lg font-medium flex items-center">
                      <Clock className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                      Pending Payment (5-min hold)
                    </span>
                  )}

                  {booking.status === 'COMPLETED' && (
                    <span className="text-xs text-emerald-700 bg-emerald-50 px-3 py-1.5 rounded-lg font-medium flex items-center">
                      <CheckCircle2 className="w-3.5 h-3.5 mr-1 text-emerald-600" />
                      Fulfilled
                    </span>
                  )}

                  {booking.status === 'NO_SHOW' && (
                    <span className="text-xs text-rose-700 bg-rose-50 px-3 py-1.5 rounded-lg font-medium flex items-center">
                      <AlertTriangle className="w-3.5 h-3.5 mr-1 text-rose-600" />
                      Deposit Forfeited (₹{booking.deposit_amount})
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Reschedule Modal */}
      {rescheduleModalId && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-xl border border-slate-200">
            <h3 className="text-base font-bold text-slate-900">Reschedule Appointment</h3>
            <p className="text-xs text-slate-500 mt-1">
              Select a new time slot today. The customer’s deposit will automatically carry over.
            </p>
            <div className="mt-4">
              <label htmlFor="reschedule-new-slot" className="block text-xs font-medium text-slate-700 mb-1">New Slot Time</label>
              <input
                id="reschedule-new-slot"
                name="newSlotTime"
                type="time"
                aria-label="Select new slot time"
                value={newSlotTime}
                onChange={(e) => setNewSlotTime(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={() => setRescheduleModalId(null)}
                className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg transition"
              >
                Cancel
              </button>
              <button
                onClick={() => handleRescheduleSubmit(rescheduleModalId)}
                disabled={!newSlotTime}
                className="px-4 py-1.5 text-xs font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition"
              >
                Confirm Reschedule
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

