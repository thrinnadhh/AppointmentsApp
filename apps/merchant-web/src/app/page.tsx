'use client';

import React, { useState, useEffect, useCallback } from 'react';
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
  Building2
} from 'lucide-react';
import { 
  supabase, 
  fetchAllProviders, 
  fetchMerchantBookings, 
  updateBookingStatus, 
  recordMerchantNoShow,
  MerchantBookingWithDetails 
} from '@/lib/supabase';
import { INITIAL_MERCHANT_PROVIDER, INITIAL_BOOKINGS, INITIAL_RESOURCES } from '@/lib/mock-data';
import { Provider, Resource } from '@appointments/shared';

export default function MerchantOverviewPage() {
  const [providers, setProviders] = useState<(Provider & { resources?: Resource[] })[]>([INITIAL_MERCHANT_PROVIDER]);
  const [selectedProviderId, setSelectedProviderId] = useState<string>(INITIAL_MERCHANT_PROVIDER.id);
  const [bookings, setBookings] = useState<MerchantBookingWithDetails[]>(INITIAL_BOOKINGS as unknown as MerchantBookingWithDetails[]);
  const [loading, setLoading] = useState(true);
  const [isLiveConnected, setIsLiveConnected] = useState(false);
  const [recentNotification, setRecentNotification] = useState<string | null>(null);

  const activeProvider = providers.find((p) => p.id === selectedProviderId) || providers[0] || INITIAL_MERCHANT_PROVIDER;
  const activeResources: Resource[] = (activeProvider.resources as Resource[]) || INITIAL_RESOURCES;

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [fetchedProviders, fetchedBookings] = await Promise.all([
        fetchAllProviders(),
        fetchMerchantBookings(selectedProviderId)
      ]);

      if (fetchedProviders && fetchedProviders.length > 0) {
        setProviders(fetchedProviders);
      }
      if (fetchedBookings && fetchedBookings.length > 0) {
        setBookings(fetchedBookings);
      }
      setIsLiveConnected(true);
    } catch (err) {
      console.warn('Fallback to local state due to connectivity:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedProviderId]);

  useEffect(() => {
    loadData();

    // Supabase Realtime channel subscription
    const channel = supabase
      .channel(`overview-bookings-${selectedProviderId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bookings' },
        (payload) => {
          console.log('Realtime booking change detected on Supabase:', payload);
          const newStatus = (payload.new as { status?: string })?.status;
          setRecentNotification(`Live update: Booking ${newStatus || 'updated'}`);
          loadData();
          setTimeout(() => setRecentNotification(null), 5000);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadData, selectedProviderId]);

  const confirmedCount = bookings.filter((b) => b.status === 'CONFIRMED').length;
  const heldCount = bookings.filter((b) => b.status === 'HELD').length;
  const completedCount = bookings.filter((b) => b.status === 'COMPLETED').length;
  const totalDepositCollected = bookings
    .filter((b) => b.payment_status === 'CAPTURED')
    .reduce((acc, curr) => acc + Number(curr.deposit_amount), 0);

  const handleStatusChange = async (
    bookingId: string, 
    newStatus: 'COMPLETED' | 'NO_SHOW' | 'CANCELLED'
  ) => {
    try {
      if (newStatus === 'NO_SHOW') {
        await recordMerchantNoShow(bookingId);
      } else {
        await updateBookingStatus(
          bookingId, 
          newStatus, 
          newStatus === 'CANCELLED' ? 'REFUNDED' : undefined
        );
      }
      await loadData();
    } catch (err) {
      console.error('Error updating status on Supabase, falling back locally:', err);
      setBookings((prev) =>
        prev.map((b) => {
          if (b.id === bookingId) {
            return {
              ...b,
              status: newStatus,
              payment_status: newStatus === 'NO_SHOW' ? 'FORFEITED' : (newStatus === 'CANCELLED' ? 'REFUNDED' : b.payment_status),
            };
          }
          return b;
        })
      );
    }
  };

  return (
    <div className="space-y-6">
      {/* Live Sync Banner */}
      {recentNotification && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-3 rounded-xl flex items-center justify-between text-sm animate-pulse">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-emerald-600" />
            <span className="font-semibold">{recentNotification}</span>
          </div>
          <span className="text-xs bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded font-mono">Supabase Realtime</span>
        </div>
      )}

      {/* Welcome & Provider Switcher Banner */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{activeProvider.name}</h1>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">
              <ShieldCheck className="w-3.5 h-3.5 mr-1 text-emerald-600" />
              Tirupati Active
            </span>
            {isLiveConnected && (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-sky-100 text-sky-800">
                <span className="w-1.5 h-1.5 rounded-full bg-sky-500 mr-1.5 animate-ping" />
                Live Supabase Synced
              </span>
            )}
          </div>
          <p className="text-sm text-slate-600 mt-1 flex items-center gap-2">
            <MapPin className="w-4 h-4 text-slate-400 flex-shrink-0" />
            {activeProvider.address}, {activeProvider.city} • Open {activeProvider.opening_time?.slice(0, 5)} - {activeProvider.closing_time?.slice(0, 5)}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Provider Switcher Dropdown */}
          <div className="relative">
            <label htmlFor="provider-select" className="sr-only">Switch Tirupati Business</label>
            <select
              id="provider-select"
              value={selectedProviderId}
              onChange={(e) => setSelectedProviderId(e.target.value)}
              className="bg-slate-50 border border-slate-300 text-slate-800 text-xs font-semibold rounded-xl px-3 py-2 pr-8 focus:ring-2 focus:ring-emerald-500 focus:outline-none cursor-pointer"
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.category_id})
                </option>
              ))}
            </select>
          </div>

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
            className="inline-flex items-center px-4 py-2 rounded-xl text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700 transition shadow-sm"
          >
            Full Queue
            <ArrowRight className="w-4 h-4 ml-1.5" />
          </Link>
        </div>
      </div>

      {/* KPI Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
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

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
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

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
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

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Completed / Total</span>
            <div className="p-2 rounded-lg bg-sky-50 text-sky-600">
              <Users className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-bold text-slate-900">{completedCount}</span>
            <span className="text-xs text-slate-500 ml-2">of {bookings.length} reservations</span>
          </div>
        </div>
      </div>

      {/* Main Action Split: Live Bookings Queue vs Resource List */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Today's Bookings Queue (2 columns) */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Active Bookings Queue</h2>
              <p className="text-xs text-slate-500">Live arrivals backed by deposit security in Tirupati</p>
            </div>
            <Link
              href="/bookings"
              className="text-xs font-semibold text-emerald-600 hover:text-emerald-700 flex items-center"
            >
              View Full List <ArrowRight className="w-3.5 h-3.5 ml-1" />
            </Link>
          </div>

          {bookings.length === 0 ? (
            <div className="text-center py-12 border-2 border-dashed border-slate-100 rounded-xl">
              <Clock className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              <p className="text-sm font-semibold text-slate-700">No active bookings found</p>
              <p className="text-xs text-slate-400 mt-1">New customer bookings from the mobile app will show here instantly via Supabase Realtime.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {bookings.slice(0, 5).map((booking) => {
                const slotTime = new Date(booking.slot_start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                
                return (
                  <div key={booking.id} className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-start space-x-3">
                      <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center text-slate-700 font-semibold flex-shrink-0 mt-0.5">
                        <User className="w-5 h-5 text-slate-600" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-900 text-sm">{booking.customer_name || 'Customer'}</span>
                          <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                            booking.status === 'CONFIRMED'
                              ? 'bg-emerald-100 text-emerald-800'
                              : booking.status === 'HELD'
                              ? 'bg-amber-100 text-amber-800 animate-pulse'
                              : booking.status === 'COMPLETED'
                              ? 'bg-slate-100 text-slate-700'
                              : 'bg-rose-100 text-rose-700'
                          }`}>
                            {booking.status}
                          </span>
                          {(booking.no_show_count ?? 0) >= 3 && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300">
                              ⚠️ {booking.no_show_count} Strikes
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-600 mt-0.5">
                          Unit: <span className="font-medium text-slate-800">{booking.resource_name}</span>
                        </p>
                        <p className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-2">
                          <Clock className="w-3 h-3" /> {slotTime} • Deposit: ₹{booking.deposit_amount}
                          {booking.customer_phone && (
                            <span className="inline-flex items-center gap-1 text-slate-600">
                              • <Phone className="w-3 h-3" /> {booking.customer_phone}
                            </span>
                          )}
                        </p>
                      </div>
                    </div>

                    {/* Actions */}
                    {booking.status === 'CONFIRMED' && (
                      <div className="flex items-center gap-2 self-end sm:self-center">
                        <button
                          onClick={() => handleStatusChange(booking.id, 'COMPLETED')}
                          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 transition"
                        >
                          Mark Complete
                        </button>
                        <button
                          onClick={() => handleStatusChange(booking.id, 'NO_SHOW')}
                          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200 transition"
                          title="Forfeits deposit to merchant and increments 4-strike record"
                        >
                          No-Show
                        </button>
                      </div>
                    )}

                    {booking.status === 'HELD' && (
                      <div className="text-xs text-amber-600 font-medium flex items-center self-end sm:self-center">
                        <Clock className="w-3.5 h-3.5 mr-1 animate-spin" />
                        5-Min Hold In-Flight
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Quick Config & Resources Panel */}
        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold text-slate-900">Bookable Units</h2>
              <Link href="/resources" className="text-xs text-emerald-600 hover:underline">
                Manage All
              </Link>
            </div>
            <div className="space-y-3">
              {activeResources.map((res) => (
                <div key={res.id} className="p-3 rounded-xl border border-slate-100 bg-slate-50/50 flex justify-between items-center">
                  <div>
                    <p className="text-xs font-bold text-slate-800">{res.name}</p>
                    <p className="text-[11px] text-slate-500">{res.duration_minutes} min slot • Max {res.capacity}</p>
                  </div>
                  <div className="text-right">
                    <span className="text-xs font-bold text-emerald-700 bg-emerald-100/60 px-2 py-0.5 rounded-md">
                      ₹{res.deposit_amount}
                    </span>
                    <p className="text-[10px] text-slate-400 mt-0.5">deposit</p>
                  </div>
                </div>
              ))}
            </div>
            <Link
              href="/resources"
              className="mt-4 block text-center py-2 px-3 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
            >
              + Configure Staff / Tables / Turf
            </Link>
          </div>

          <div className="bg-gradient-to-br from-emerald-800 to-teal-900 text-white rounded-2xl p-6 shadow-sm">
            <h3 className="text-sm font-bold uppercase tracking-wider text-emerald-300">Supabase RLS & Hold Engine</h3>
            <p className="text-xs text-slate-200 mt-2 leading-relaxed">
              Appointments are locked atomically with the <code className="text-emerald-300">create_booking_hold</code> RPC. Free customer cancellation applies up to <strong>1 hour before slot</strong>.
            </p>
            <div className="mt-4 pt-3 border-t border-emerald-700/50 flex items-center justify-between text-xs">
              <span className="text-emerald-200">Anti-Ghost Protection</span>
              <span className="font-semibold text-white">Active (4-Strike Guard)</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

