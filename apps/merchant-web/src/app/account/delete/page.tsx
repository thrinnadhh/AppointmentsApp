'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';

export default function AccountDeletionPage() {
  const [identifier, setIdentifier] = useState('');
  const [reason, setReason] = useState('No longer using the service');
  const [customReason, setCustomReason] = useState('');
  const [hasConfirmed, setHasConfirmed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [currentUser, setCurrentUser] = useState<{ email?: string; id?: string } | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const [scheduledDate, setScheduledDate] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function checkAuth() {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          setCurrentUser({ email: user.email, id: user.id });
          if (user.email) setIdentifier(user.email);
        }
      } catch {
        // Unauthenticated visitor is valid for this public page
      }
    }
    checkAuth();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!identifier.trim()) {
      setError('Please provide your registered mobile number or email address.');
      return;
    }

    if (!hasConfirmed) {
      setError('Please confirm that you understand the 30-day grace period and irreversible deletion.');
      return;
    }

    setIsLoading(true);

    try {
      const finalReason = reason === 'Other' ? customReason : reason;
      const res = await fetch('/api/account/delete-public-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identifier: identifier.trim(),
          reason: finalReason,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to submit account deletion request.');
      }

      setIsSuccess(true);
      setResultMessage(data.message);
      if (data.scheduled_for) {
        const formatted = new Date(data.scheduled_for).toLocaleDateString('en-IN', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        });
        setScheduledDate(formatted);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred while submitting your request.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Header */}
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 flex items-center justify-between">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm text-emerald-700 font-semibold hover:text-emerald-800 transition-colors"
          >
            ← Back to Platform
          </Link>
          <span className="text-xs font-semibold px-2.5 py-1 bg-slate-100 text-slate-700 rounded-full border border-slate-200">
            DPDPA 2023 & Play Store Compliant
          </span>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-10 space-y-8">
        {/* Title & Overview Banner */}
        <div className="space-y-3">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-rose-50 border border-rose-200 text-rose-800 text-xs font-medium rounded-full">
            <svg className="w-3.5 h-3.5 text-rose-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            Account & Personal Data Erasure Portal
          </div>
          <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">
            Request Account Deletion
          </h1>
          <p className="text-base text-slate-600 leading-relaxed">
            This public portal allows you to request the permanent deletion of your <strong>Appointments4u</strong> account and all associated personal data, even if you have uninstalled the mobile app or cannot log in.
          </p>
        </div>

        {/* Data Retention & Deletion Policy Matrix */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-5 shadow-sm">
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <svg className="w-5 h-5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
            What happens to your data?
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-xl bg-rose-50/50 border border-rose-100 p-4 space-y-2">
              <span className="text-xs font-bold text-rose-700 uppercase tracking-wider block">
                Permanently Anonymized & Removed
              </span>
              <ul className="text-xs text-slate-700 space-y-1.5 list-disc list-inside">
                <li>Full name, display name, and avatar</li>
                <li>Registered mobile phone number & email address</li>
                <li>Device push notification tokens (Expo tokens)</li>
                <li>Booking notes, attachments & uploaded prescriptions</li>
                <li>DPDPA affirmative consent records</li>
              </ul>
            </div>

            <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 space-y-2">
              <span className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
                Retained for Legal & Tax Compliance
              </span>
              <ul className="text-xs text-slate-600 space-y-1.5 list-disc list-inside">
                <li>Historical payment records & invoices (anonymized)</li>
                <li>Platform fee GST tax filings under Indian Law</li>
                <li>Merchant settlement auditing logs</li>
                <li><em>Retained strictly without identifying personal data</em></li>
              </ul>
            </div>
          </div>

          <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 text-xs text-amber-900 leading-relaxed flex items-start gap-3">
            <span className="text-lg">⏳</span>
            <div>
              <strong>30-Day Grace Period:</strong> In compliance with industry standards, your account will enter a 30-day scheduled grace period. You may cancel this deletion request at any time during these 30 days by emailing <a href="mailto:grievance@appointments4u.in" className="underline font-semibold text-amber-950">grievance@appointments4u.in</a>. After 30 days, personal data is permanently and irreversibly scrubbed.
            </div>
          </div>
        </div>

        {/* Form or Success State */}
        {isSuccess ? (
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-8 text-center space-y-4 shadow-sm">
            <div className="w-14 h-14 rounded-full bg-emerald-100 text-emerald-700 mx-auto flex items-center justify-center text-2xl font-bold">
              ✓
            </div>
            <h2 className="text-2xl font-bold text-emerald-950">Deletion Request Scheduled</h2>
            <p className="text-sm text-emerald-800 max-w-md mx-auto leading-relaxed">
              {resultMessage}
            </p>
            {scheduledDate && (
              <div className="inline-block bg-white px-4 py-2 rounded-xl border border-emerald-200 text-sm font-semibold text-emerald-900">
                Scheduled Anonymization Date: {scheduledDate}
              </div>
            )}
            <p className="text-xs text-emerald-700 pt-2">
              Need to cancel this request? Contact our Grievance Officer at{' '}
              <a href="mailto:grievance@appointments4u.in" className="underline font-semibold">
                grievance@appointments4u.in
              </a>{' '}
              within the next 30 days.
            </p>
            <div className="pt-4">
              <Link
                href="/"
                className="inline-block px-5 py-2.5 bg-emerald-700 text-white rounded-xl text-sm font-semibold hover:bg-emerald-800 transition-colors shadow-sm"
              >
                Return to Home
              </Link>
            </div>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 space-y-6 shadow-sm"
          >
            <h2 className="text-xl font-bold text-slate-900">Submit Your Erasure Request</h2>

            {error && (
              <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-xs font-medium text-rose-800 flex items-start gap-2">
                <span className="text-rose-600 font-bold">✕</span>
                <span>{error}</span>
              </div>
            )}

            {currentUser && (
              <div className="p-3 bg-emerald-50/60 border border-emerald-100 rounded-xl text-xs text-emerald-800 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-600"></span>
                <span>Detected active session: <strong>{currentUser.email}</strong></span>
              </div>
            )}

            <div className="space-y-1.5">
              <label htmlFor="identifier" className="block text-sm font-semibold text-slate-800">
                Registered Mobile Number or Email Address <span className="text-rose-500">*</span>
              </label>
              <input
                id="identifier"
                type="text"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="e.g. +91 98480 12345 or user@example.com"
                className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:border-transparent text-sm"
                required
              />
              <p className="text-xs text-slate-500">
                Enter the primary contact method associated with your customer or merchant account.
              </p>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="reason" className="block text-sm font-semibold text-slate-800">
                Reason for Leaving (Optional)
              </label>
              <select
                id="reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:border-transparent bg-white"
              >
                <option value="No longer using the service">No longer using the service</option>
                <option value="Privacy concerns">Privacy or data concerns</option>
                <option value="Too many notifications">Too many notifications</option>
                <option value="Switching to another provider">Switching to another provider</option>
                <option value="Other">Other (Please specify)</option>
              </select>
            </div>

            {reason === 'Other' && (
              <div className="space-y-1.5">
                <label htmlFor="customReason" className="block text-sm font-semibold text-slate-800">
                  Please tell us more
                </label>
                <textarea
                  id="customReason"
                  rows={3}
                  value={customReason}
                  onChange={(e) => setCustomReason(e.target.value)}
                  placeholder="Your feedback helps us improve..."
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:border-transparent placeholder:text-slate-400"
                />
              </div>
            )}

            <div className="pt-2">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={hasConfirmed}
                  onChange={(e) => setHasConfirmed(e.target.checked)}
                  className="mt-1 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                />
                <span className="text-xs text-slate-600 leading-normal select-none">
                  I understand that submitting this request initiates a <strong>30-day grace period</strong>. After 30 days, my personal profile, contact information, and bookings history will be permanently and irreversibly anonymized.
                </span>
              </label>
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={isLoading}
                className="w-full sm:w-auto px-6 py-3 bg-rose-600 hover:bg-rose-700 disabled:bg-slate-300 text-white rounded-xl text-sm font-semibold transition-colors shadow-sm flex items-center justify-center gap-2 cursor-pointer"
              >
                {isLoading ? (
                  <>
                    <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Processing Erasure Request...
                  </>
                ) : (
                  'Confirm & Request Account Deletion'
                )}
              </button>
            </div>
          </form>
        )}

        {/* Footer Support Information */}
        <div className="text-center text-xs text-slate-500 space-y-1">
          <p>
            Appointments4u · Hyperlocal Appointments Platform · Tirupati, Andhra Pradesh, India
          </p>
          <p>
            Official Data Protection Officer & Grievance Contact:{' '}
            <a href="mailto:grievance@appointments4u.in" className="text-emerald-700 underline font-medium">
              grievance@appointments4u.in
            </a>
          </p>
        </div>
      </main>
    </div>
  );
}
