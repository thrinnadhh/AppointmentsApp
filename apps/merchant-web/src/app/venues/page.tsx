'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { 
  Building2, 
  Plus, 
  Clock, 
  MapPin, 
  Phone, 
  Mail, 
  Search, 
  RefreshCw, 
  Users, 
  Stethoscope, 
  Scissors, 
  Gamepad2, 
  Utensils, 
  HeartHandshake,
  CheckCircle2,
  AlertCircle,
  ArrowRight
} from 'lucide-react';
import { fetchAllProviders, Provider, Resource } from '@/lib/supabase';

type ProviderWithResources = Provider & { resources: Resource[] };

const CATEGORIES = [
  { id: 'all', label: 'All Businesses', icon: Building2 },
  { id: 'clinic', label: 'Clinics & Hospitals', icon: Stethoscope },
  { id: 'salon', label: 'Salons & Spas', icon: Scissors },
  { id: 'gaming', label: 'Gaming & Turfs', icon: Gamepad2 },
  { id: 'restaurant', label: 'Restaurants', icon: Utensils },
  { id: 'pet', label: 'Pet Care', icon: HeartHandshake },
];

export default function VenuesPage() {
  const [venues, setVenues] = useState<ProviderWithResources[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('clinic');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [openingTime, setOpeningTime] = useState('09:00');
  const [closingTime, setClosingTime] = useState('21:00');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [successBanner, setSuccessBanner] = useState<string | null>(null);

  const loadVenues = async () => {
    setLoading(true);
    try {
      const data = await fetchAllProviders();
      setVenues(data);
    } catch (err) {
      console.error('Failed to load venues:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadVenues();
  }, []);

  const handleCreateVenue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !categoryId || !address || !phone) {
      setFormError('Please fill in Name, Category, Address, and Phone.');
      return;
    }

    setIsSubmitting(true);
    setFormError(null);

    try {
      const res = await fetch('/api/admin/venues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          categoryId,
          address: address.trim(),
          phone: phone.trim(),
          email: email.trim() || undefined,
          openingTime: `${openingTime}:00`,
          closingTime: `${closingTime}:00`,
          description: description.trim() || undefined,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Failed to create venue');
      }

      setSuccessBanner(`Venue "${name}" onboarded successfully into the Tirupati Hyperlocal Platform!`);
      setIsModalOpen(false);
      setName('');
      setAddress('');
      setPhone('');
      setEmail('');
      setDescription('');
      await loadVenues();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error adding venue';
      setFormError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const normCategory = (c: string) => (c || '').toLowerCase().replace(/s$/, '');

  const getCategoryIcon = (catId: string) => {
    const key = normCategory(catId);
    switch (key) {
      case 'clinic':
        return <Stethoscope className="w-4 h-4 text-emerald-600" />;
      case 'salon':
        return <Scissors className="w-4 h-4 text-amber-600" />;
      case 'gaming':
        return <Gamepad2 className="w-4 h-4 text-sky-600" />;
      case 'restaurant':
        return <Utensils className="w-4 h-4 text-orange-600" />;
      case 'pet':
        return <HeartHandshake className="w-4 h-4 text-rose-600" />;
      default:
        return <Building2 className="w-4 h-4 text-slate-600" />;
    }
  };

  const getCategoryBadgeClass = (catId: string) => {
    const key = normCategory(catId);
    switch (key) {
      case 'clinic':
        return 'bg-emerald-50 text-emerald-800 border-emerald-200';
      case 'salon':
        return 'bg-amber-50 text-amber-800 border-amber-200';
      case 'gaming':
        return 'bg-sky-50 text-sky-800 border-sky-200';
      case 'restaurant':
        return 'bg-orange-50 text-orange-800 border-orange-200';
      case 'pet':
        return 'bg-rose-50 text-rose-800 border-rose-200';
      default:
        return 'bg-slate-50 text-slate-800 border-slate-200';
    }
  };

  const filteredVenues = venues.filter((v) => {
    const matchesSearch = 
      v.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      v.address.toLowerCase().includes(searchQuery.toLowerCase()) ||
      v.phone.includes(searchQuery);

    if (selectedCategory === 'all') return matchesSearch;
    return matchesSearch && normCategory(v.category_id) === normCategory(selectedCategory);
  });

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-slate-200 pb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200">
              Multi-Business Onboarding
            </span>
            <span className="text-xs text-slate-500">• Live Tirupati Directory</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
            Venues, Clinics & Centers
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Register and manage clinics, hospitals, salons, gaming turfs, restaurants, and pet care hubs across Tirupati.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={loadVenues}
            className="inline-flex items-center px-3 py-2 border border-slate-300 rounded-lg text-sm font-medium text-slate-700 bg-white hover:bg-slate-50 transition-colors shadow-xs"
            title="Refresh List"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin text-emerald-600' : ''}`} />
            Refresh
          </button>
          <button
            onClick={() => {
              setIsModalOpen(true);
              setFormError(null);
            }}
            className="inline-flex items-center px-4 py-2 border border-transparent rounded-lg text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 transition-colors shadow-sm"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add New Business / Venue
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
            className="text-xs font-bold text-emerald-700 hover:text-emerald-900 px-2 py-1 rounded"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Category Pills & Search */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          {CATEGORIES.map((cat) => {
            const Icon = cat.icon;
            const isSelected = selectedCategory === cat.id;
            return (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
                className={`inline-flex items-center px-3.5 py-2 rounded-xl text-xs font-bold transition-all ${
                  isSelected
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 mr-1.5 ${isSelected ? 'text-white' : 'text-slate-500'}`} />
                {cat.label}
              </button>
            );
          })}
        </div>

        <div className="relative max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
          <input
            id="venue-search"
            name="venueSearch"
            aria-label="Search businesses by name, address, or phone"
            type="text"
            placeholder="Search businesses by name, address, or phone..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white"
          />
        </div>
      </div>

      {/* Venues Grid */}
      {loading ? (
        <div className="py-16 text-center text-slate-500">
          <RefreshCw className="w-6 h-6 animate-spin mx-auto text-emerald-600 mb-2" />
          Loading businesses...
        </div>
      ) : filteredVenues.length === 0 ? (
        <div className="py-16 text-center bg-white rounded-2xl border border-slate-200 p-8">
          <Building2 className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-base font-bold text-slate-800">No businesses found</p>
          <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
            No venues match your current filter. Click &quot;Add New Business / Venue&quot; to onboard the first clinic, salon, or gaming turf.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredVenues.map((venue) => {
            const resourceCount = venue.resources ? venue.resources.length : 0;
            return (
              <div
                key={venue.id}
                className="bg-white rounded-xl border border-slate-200 shadow-xs hover:shadow-md transition-shadow flex flex-col justify-between overflow-hidden"
              >
                <div className="p-5 space-y-4">
                  {/* Card Top */}
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${getCategoryBadgeClass(venue.category_id)}`}>
                        {getCategoryIcon(venue.category_id)}
                        <span className="ml-1 capitalize">{venue.category_id}</span>
                      </span>
                      <h3 className="text-lg font-bold text-slate-900 mt-2 line-clamp-1">
                        {venue.name}
                      </h3>
                    </div>
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                      {venue.status}
                    </span>
                  </div>

                  {venue.description && (
                    <p className="text-xs text-slate-500 line-clamp-2">
                      {venue.description}
                    </p>
                  )}

                  {/* Details */}
                  <div className="space-y-2 text-xs text-slate-600 pt-2 border-t border-slate-100">
                    <div className="flex items-start gap-2">
                      <MapPin className="w-3.5 h-3.5 text-slate-400 mt-0.5 flex-shrink-0" />
                      <span className="line-clamp-1">{venue.address}, Tirupati</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Clock className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                      <span>{venue.opening_time.substring(0, 5)} - {venue.closing_time.substring(0, 5)} IST</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Phone className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                      <span>{venue.phone}</span>
                    </div>
                    {venue.email && (
                      <div className="flex items-center gap-2">
                        <Mail className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                        <span className="truncate">{venue.email}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Footer Action */}
                <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs text-slate-600 font-semibold">
                    <Users className="w-3.5 h-3.5 text-emerald-600" />
                    <span>{resourceCount} {venue.category_id === 'clinic' ? 'Doctors' : 'Resources / Units'}</span>
                  </div>
                  <Link
                    href={`/resources?providerId=${venue.id}`}
                    aria-label={`Manage Staff for ${venue.name}`}
                    className="inline-flex items-center text-xs font-bold text-emerald-700 hover:text-emerald-900 group"
                  >
                    Manage Staff
                    <ArrowRight className="w-3.5 h-3.5 ml-1 group-hover:translate-x-0.5 transition-transform" />
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add Business Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 sm:p-8 shadow-xl border border-slate-200 relative animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-lg bg-emerald-100 text-emerald-800 flex items-center justify-center">
                  <Building2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900">Onboard New Business / Venue</h3>
                  <p className="text-xs text-slate-500">Register a clinic, salon, turf or restaurant</p>
                </div>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold p-1"
              >
                ✕
              </button>
            </div>

            {formError && (
              <div className="my-4 rounded-lg bg-rose-50 border border-rose-200 p-3 flex items-start gap-2 text-xs text-rose-700">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleCreateVenue} className="mt-5 space-y-4">
              <div>
                <label htmlFor="venue-name" className="block text-xs font-semibold text-slate-700 mb-1">
                  Business / Venue Name *
                </label>
                <input
                  id="venue-name"
                  name="venueName"
                  aria-label="Business / Venue Name"
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g., Apollo Multi-Speciality Clinic, Tirupati"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="venue-category" className="block text-xs font-semibold text-slate-700 mb-1">
                  Business Category *
                </label>
                <select
                  id="venue-category"
                  name="venueCategory"
                  aria-label="Business Category"
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:outline-none bg-white"
                >
                  <option value="clinic">Clinic & Hospital (Doctors & Appointments)</option>
                  <option value="salon">Salon & Spa (Hair, Skin & Beauty)</option>
                  <option value="gaming">Gaming Arena & Sports Turf (Box Cricket, Badminton)</option>
                  <option value="restaurant">Restaurant & Dining (Table Reservations)</option>
                  <option value="pet">Pet Care & Clinic (Grooming & Veterinary)</option>
                </select>
              </div>

              <div>
                <label htmlFor="venue-address" className="block text-xs font-semibold text-slate-700 mb-1">
                  Address & Locality *
                </label>
                <input
                  id="venue-address"
                  name="venueAddress"
                  aria-label="Address and Locality"
                  type="text"
                  required
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="e.g., Near Leela Mahal Circle, KT Road, Tirupati"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="venue-phone" className="block text-xs font-semibold text-slate-700 mb-1">
                    Phone Number *
                  </label>
                  <input
                    id="venue-phone"
                    name="venuePhone"
                    aria-label="Phone Number"
                    type="text"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+91 877 2233445"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label htmlFor="venue-email" className="block text-xs font-semibold text-slate-700 mb-1">
                    Email (Optional)
                  </label>
                  <input
                    id="venue-email"
                    name="venueEmail"
                    aria-label="Email Address"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="contact@apollo-tirupati.com"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="venue-opening-time" className="block text-xs font-semibold text-slate-700 mb-1">
                    Opening Time
                  </label>
                  <input
                    id="venue-opening-time"
                    name="venueOpeningTime"
                    aria-label="Opening Time"
                    type="time"
                    value={openingTime}
                    onChange={(e) => setOpeningTime(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:outline-none bg-white"
                  />
                </div>

                <div>
                  <label htmlFor="venue-closing-time" className="block text-xs font-semibold text-slate-700 mb-1">
                    Closing Time
                  </label>
                  <input
                    id="venue-closing-time"
                    name="venueClosingTime"
                    aria-label="Closing Time"
                    type="time"
                    value={closingTime}
                    onChange={(e) => setClosingTime(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:outline-none bg-white"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="venue-description" className="block text-xs font-semibold text-slate-700 mb-1">
                  Description & Facilities
                </label>
                <textarea
                  id="venue-description"
                  name="venueDescription"
                  aria-label="Description and Facilities"
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Multi-speciality outpatient consultations, digital diagnostics, 24/7 emergency care..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-sm transition-colors disabled:opacity-50 flex items-center gap-2"
                >
                  {isSubmitting ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    <>
                      <Plus className="w-4 h-4" />
                      Onboard Business
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
