'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { 
  Building2, 
  CheckCircle2, 
  AlertCircle, 
  Store, 
  Phone, 
  MapPin, 
  Layers, 
  Sparkles, 
  ArrowRight,
  ShieldCheck,
  RefreshCw,
  UploadCloud,
  ImageIcon,
  X,
  Camera,
  User
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useMerchantTenant } from '@/contexts/MerchantTenantContext';

export default function ShopRegistrationPage() {
  const router = useRouter();
  const { activeProvider, refreshTenant } = useMerchantTenant();

  const [user, setUser] = useState<{ id: string; email?: string; user_metadata?: any } | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  // Registration Form State
  const [fullName, setFullName] = useState('');
  const [shopName, setShopName] = useState('');
  const [category, setCategory] = useState('clinics');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('AIR Bypass Road, Tirupati');

  // Shop Image Upload State
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  // Derive venue label from category for user-facing strings
  const CATEGORY_VENUE_LABELS: Record<string, string> = {
    salons: 'Salon',
    clinics: 'Hospital',
    gaming: 'Turf / Arena',
    restaurants: 'Restaurant',
    pets: 'Pet Clinic',
  };
  const venueLabel = CATEGORY_VENUE_LABELS[category] || 'Venue';

  // UI State
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    async function checkAuthAndShop() {
      setCheckingAuth(true);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        let authUser: any = session?.user;
        if (!authUser && typeof window !== 'undefined') {
          const testUserRaw = window.sessionStorage.getItem('test_merchant_user');
          if (testUserRaw) {
            try {
              authUser = JSON.parse(testUserRaw);
            } catch {}
          }
          if (!authUser && window.location.search.includes('dev=true')) {
            authUser = {
              id: 'mock-first-time-dev-user',
              email: 'new.owner@tirupati-appointments.com',
              user_metadata: { full_name: 'Dr. Trinadh Reddy' },
            };
          }
        }

        if (!authUser) {
          // Not authenticated yet -> Must log in through Google first to verify email
          router.replace('/login');
          return;
        }

        setUser(authUser);
        setFullName(authUser.user_metadata?.full_name || authUser.user_metadata?.name || '');

        // Check if this user already has a registered shop
        const userEmail = authUser.email ? authUser.email.toLowerCase().trim() : '';
        const { data: existingShop } = await supabase
          .from('providers')
          .select('id, name')
          .or(`owner_id.eq.${authUser.id},email.ilike.${userEmail}`)
          .limit(1);

        if (existingShop && existingShop.length > 0 && !window.location.search.includes('dev=true')) {
          // User already has a shop! Send directly to workspace
          router.replace('/');
          return;
        }
      } catch (err) {
        console.warn('Shop registration auth check error:', err);
      } finally {
        setCheckingAuth(false);
      }
    }

    checkAuthAndShop();
  }, [router]);

  const handlePhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setPhotoError('Please select a valid image file (JPG, PNG, or WebP).');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setPhotoError('Image size exceeds 5MB limit. Please upload a smaller image.');
      return;
    }

    setPhotoError(null);
    const localUrl = URL.createObjectURL(file);
    setPhotoPreview(localUrl);
    setUploadingPhoto(true);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('providerId', user?.id || 'new-merchant');

      const res = await fetch('/api/merchant/upload-image', {
        method: 'POST',
        body: formData,
      });

      const json = await res.json();
      if (!res.ok || !json.publicUrl) {
        throw new Error(json.error || 'Failed to upload photo to storage.');
      }

      setPhotoUrl(json.publicUrl);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Photo upload failed';
      setPhotoError(msg);
      // Keep local preview if available so user knows what was selected
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleRemovePhoto = () => {
    setPhotoPreview(null);
    setPhotoUrl(null);
    setPhotoError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shopName.trim() || !phone.trim() || !category) {
      setErrorMsg(`Please enter your ${venueLabel} Name, Category, and Phone Number.`);
      return;
    }

    if (!user) {
      setErrorMsg('Session expired. Please sign in with Google again.');
      router.replace('/login');
      return;
    }

    setSubmitting(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await fetch('/api/merchant/register-shop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          fullName: fullName.trim() || user.user_metadata?.full_name || 'Merchant Owner',
          shopName: shopName.trim(),
          categoryId: category,
          phone: phone.trim(),
          address: address.trim() || 'AIR Bypass Road, Tirupati',
          photoUrl: photoUrl || null,
        }),
      });

      const result = await res.json();
      if (!res.ok || result.error) {
        throw new Error(result.error || `${venueLabel} registration failed.`);
      }

      setSuccessMsg(`"${shopName}" registered successfully! Launching your workspace...`);
      await refreshTenant();

      setTimeout(() => {
        window.location.href = '/';
      }, 1000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : `Error registering ${venueLabel}.`;
      setErrorMsg(msg);
    } finally {
      setSubmitting(false);
    }
  };

  if (checkingAuth) {
    return (
      <div className="min-h-[80vh] flex flex-col items-center justify-center space-y-3">
        <RefreshCw className="w-8 h-8 text-emerald-600 animate-spin" />
        <p className="text-sm font-medium text-slate-500">Checking verified Google account...</p>
      </div>
    );
  }

  return (
    <div className="min-h-[85vh] flex items-center justify-center py-10 px-4 sm:px-6 lg:px-8 bg-slate-50/50">
      <div className="max-w-xl w-full space-y-6 bg-white p-8 rounded-2xl border border-slate-200 shadow-sm">
        
        {/* Header */}
        <div className="text-center">
          <div className="mx-auto h-12 w-12 rounded-xl bg-gradient-to-br from-emerald-600 to-teal-700 flex items-center justify-center text-white shadow-sm mb-3">
            <Store className="w-6 h-6" />
          </div>
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 mb-2">
            <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
            Step 2: Shop Registration
          </span>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Register Your Business
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            Set up your shop details to activate your isolated merchant workspace
          </p>
        </div>

        {/* Verified Google Account Pill */}
        {user?.email && (
          <div className="bg-emerald-50/70 border border-emerald-200 rounded-xl p-3.5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 overflow-hidden">
              <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-800 font-bold text-xs flex-shrink-0">
                {user.email.charAt(0).toUpperCase()}
              </div>
              <div className="truncate">
                <p className="text-[11px] font-semibold text-emerald-900 uppercase tracking-wider">Verified Business Email</p>
                <p className="text-xs font-mono font-medium text-slate-700 truncate">{user.email}</p>
              </div>
            </div>
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-600 text-white shadow-xs shrink-0">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Verified
            </span>
          </div>
        )}

        {/* Error / Success Alerts */}
        {errorMsg && (
          <div className="rounded-lg bg-rose-50 border border-rose-200 p-3.5 flex items-start gap-2.5 text-sm text-rose-700">
            <AlertCircle className="w-5 h-5 flex-shrink-0 text-rose-500 mt-0.5" />
            <div>
              <p className="font-semibold text-xs">Registration Failed</p>
              <p className="text-xs text-rose-600">{errorMsg}</p>
            </div>
          </div>
        )}

        {successMsg && (
          <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3.5 flex items-start gap-2.5 text-sm text-emerald-700">
            <CheckCircle2 className="w-5 h-5 flex-shrink-0 text-emerald-600 mt-0.5" />
            <div>
              <p className="font-semibold text-xs">{successMsg}</p>
            </div>
          </div>
        )}

        {/* Registration Form */}
        <form className="space-y-4" onSubmit={handleSubmit}>
          {/* Owner Full Name */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Owner / Manager Full Name *
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                <User className="w-4 h-4" />
              </div>
              <input
                id="owner-full-name"
                data-testid="register-owner-name"
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="e.g. Dr. Trinadh Reddy"
                className="w-full pl-9 pr-3.5 py-2.5 border border-slate-300 rounded-xl text-xs sm:text-sm text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Shop / Business Name */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Shop / Hospital / Venue Name *
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                <Store className="w-4 h-4" />
              </div>
              <input
                id="shopName"
                data-testid="register-shop-name"
                type="text"
                required
                value={shopName}
                onChange={(e) => setShopName(e.target.value)}
                placeholder="e.g. Venkateswara Super Specialty Hospital"
                className="w-full pl-9 pr-3.5 py-2.5 border border-slate-300 rounded-xl text-xs sm:text-sm text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:outline-none font-semibold"
              />
            </div>
          </div>

          {/* Vertical / Category Selector */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Business Vertical *
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                <Layers className="w-4 h-4" />
              </div>
              <select
                id="categoryId"
                data-testid="register-category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full pl-9 pr-3.5 py-2.5 border border-slate-300 rounded-xl text-xs sm:text-sm text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:outline-none bg-white font-medium"
              >
                <option value="clinics">Hospitals & Clinics (Doctors, OPD Chambers, Token Queue)</option>
                <option value="salons">Salons & Spas (Stylists, Hair Spa, Styling Chairs)</option>
                <option value="gaming">Gaming & Turf Arenas (Box Cricket, Pitches, Courts)</option>
                <option value="restaurants">Restaurants & Dining (Tables, Rooftop Cabanas)</option>
                <option value="pets">Pet Care & Vet (Veterinarians, Grooming Bays)</option>
              </select>
            </div>
          </div>

          {/* Phone Number */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Owner Phone Number *
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                <Phone className="w-4 h-4" />
              </div>
              <input
                id="phone"
                data-testid="register-phone"
                type="tel"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="e.g. +91 98480 12345"
                className="w-full pl-9 pr-3.5 py-2.5 border border-slate-300 rounded-xl text-xs sm:text-sm text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Shop Address */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Address (Tirupati) *
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                <MapPin className="w-4 h-4" />
              </div>
              <input
                id="address"
                data-testid="register-address"
                type="text"
                required
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="e.g. AIR Bypass Road, Near Alipiri, Tirupati"
                className="w-full pl-9 pr-3.5 py-2.5 border border-slate-300 rounded-xl text-xs sm:text-sm text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Shop Storefront / Listing Image Upload */}
          <div className="pt-2 border-t border-slate-100">
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-semibold text-slate-800">
                Shop Storefront Photo *
              </label>
              <span className="text-[11px] font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                Shows in Customer Mobile App
              </span>
            </div>
            <p className="text-[11px] text-slate-500 mb-2.5 leading-relaxed">
              Upload a clear photo of your venue storefront, clinic entrance, salon chairs, or turf arena. Customers browse and book based on this image.
            </p>

            {photoError && (
              <div className="mb-3 rounded-lg bg-rose-50 border border-rose-200 p-2.5 flex items-center gap-2 text-xs text-rose-700">
                <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />
                <span>{photoError}</span>
              </div>
            )}

            {photoPreview ? (
              <div className="relative rounded-2xl overflow-hidden border border-slate-200 bg-slate-50 p-2 group shadow-xs">
                <div className="relative h-44 w-full rounded-xl overflow-hidden bg-slate-900">
                  <img
                    src={photoPreview}
                    alt="Shop storefront preview"
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute top-2.5 left-2.5 bg-slate-900/80 backdrop-blur-md px-2.5 py-1 rounded-full text-[11px] font-bold text-white flex items-center gap-1.5 border border-white/20">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Customer App Ready</span>
                  </div>
                  {uploadingPhoto && (
                    <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-xs flex flex-col items-center justify-center text-white gap-2">
                      <RefreshCw className="w-6 h-6 animate-spin text-emerald-400" />
                      <span className="text-xs font-semibold">Uploading to Cloud Storage...</span>
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between mt-2 px-1">
                  <span className="text-xs text-slate-500 font-medium truncate max-w-[200px]">
                    {photoUrl ? '✓ Photo saved to venue-assets' : 'Ready to save with registration'}
                  </span>
                  <div className="flex items-center gap-2">
                    <label
                      htmlFor="shop-photo-replace"
                      className="cursor-pointer text-xs font-semibold text-emerald-700 hover:text-emerald-800 px-2.5 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 transition-colors"
                    >
                      Change Photo
                    </label>
                    <input
                      id="shop-photo-replace"
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/jpg"
                      onChange={handlePhotoSelect}
                      className="sr-only"
                    />
                    <button
                      type="button"
                      onClick={handleRemovePhoto}
                      className="text-xs font-semibold text-rose-600 hover:text-rose-700 px-2.5 py-1 rounded-lg hover:bg-rose-50 transition-colors"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <label
                htmlFor="shop-photo-input"
                className="cursor-pointer border-2 border-dashed border-slate-300 hover:border-emerald-500 rounded-2xl p-6 flex flex-col items-center justify-center text-center bg-slate-50/50 hover:bg-emerald-50/30 transition-all group"
              >
                <div className="w-12 h-12 rounded-xl bg-white border border-slate-200 group-hover:border-emerald-300 group-hover:bg-emerald-50 flex items-center justify-center text-slate-400 group-hover:text-emerald-600 shadow-xs mb-2 transition-all">
                  <UploadCloud className="w-6 h-6" />
                </div>
                <p className="text-xs font-bold text-slate-800 group-hover:text-emerald-900">
                  Click to choose or drag & drop storefront photo
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  PNG, JPG, or WebP up to 5MB • Instant Cloud Sync
                </p>
                <input
                  id="shop-photo-input"
                  data-testid="shop-photo-input"
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/jpg"
                  onChange={handlePhotoSelect}
                  className="sr-only"
                />
              </label>
            )}
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            data-testid="register-submit"
            disabled={submitting}
            className="w-full flex justify-center items-center gap-2 py-3 px-4 border border-transparent rounded-xl shadow-sm text-xs sm:text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500 transition-colors cursor-pointer mt-6"
          >
            {submitting ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <>
                <span>Complete Registration & Open Workspace</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        {/* Security Footer */}
        <div className="pt-4 border-t border-slate-100 flex items-center justify-center gap-2 text-xs text-slate-400">
          <ShieldCheck className="w-4 h-4 text-emerald-600" />
          <span>Verified Merchant Account • Postgres Row-Level Security</span>
        </div>
      </div>
    </div>
  );
}
