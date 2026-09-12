'use client';

import React, { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ShieldAlert,
  ShieldCheck,
  Lock,
  Mail,
  ArrowRight,
  AlertCircle,
  KeyRound,
  CheckCircle2,
  Building2,
  Compass
} from 'lucide-react';
import { supabase } from '@/lib/supabase';

function AdminLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTarget = searchParams.get('redirect') || '/admin';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setErrorMsg('Please provide both administrator email and master password.');
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      // 1. Authenticate with Supabase Auth
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (authError || !authData.user) {
        throw new Error(authError?.message || 'Invalid administrator credentials.');
      }

      // 2. Strict Role Verification: Ensure user has 'admin' role in public.profiles
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('role, full_name')
        .eq('id', authData.user.id)
        .single();

      if (profileError || !profile) {
        await supabase.auth.signOut();
        throw new Error('Access Denied: Unable to verify platform authority record.');
      }

      if (profile.role !== 'admin') {
        // Immediately terminate session for non-admin accounts attempting access
        await supabase.auth.signOut();
        throw new Error('Access Denied: This account lacks Super Administrator privileges.');
      }

      // 3. Authorized access granted
      setSuccessMsg(`Welcome, ${profile.full_name || 'Administrator'}. Transferring to Command Center...`);
      setTimeout(() => {
        router.push(redirectTarget);
        router.refresh();
      }, 750);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Authentication verification failed.';
      setErrorMsg(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleQuickFill = (presetEmail: string, presetPw: string) => {
    setEmail(presetEmail);
    setPassword(presetPw);
    setErrorMsg(null);
  };

  return (
    <div className="min-h-screen flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8 bg-slate-900 text-slate-100">
      <div className="max-w-md w-full space-y-8 bg-slate-800/90 border border-slate-700 p-8 rounded-2xl shadow-2xl backdrop-blur-sm">
        {/* Header Badge */}
        <div className="text-center">
          <div className="mx-auto h-14 w-14 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-700 flex items-center justify-center text-white shadow-lg shadow-emerald-950/40 mb-4 border border-emerald-400/30">
            <ShieldCheck className="w-7 h-7" />
          </div>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold tracking-wider uppercase bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 mb-2">
            <Compass className="w-3 h-3" />
            Executive Governance Gateway
          </div>
          <h1 className="text-2xl font-black tracking-tight text-white">
            Super Admin Portal
          </h1>
          <p className="mt-2 text-xs text-slate-400 leading-relaxed">
            Restricted authentication portal for territorial multi-city rollout, municipal licensing, and merchant compliance oversight.
          </p>
        </div>

        {/* Security Alerts */}
        {errorMsg && (
          <div
            data-testid="admin-login-error"
            className="rounded-xl bg-rose-950/60 border border-rose-800/80 p-4 flex items-start gap-3 text-sm text-rose-200 animate-in fade-in"
          >
            <ShieldAlert className="w-5 h-5 flex-shrink-0 text-rose-400 mt-0.5" />
            <div>
              <p className="font-bold text-rose-300">Access Rejected</p>
              <p className="text-xs text-rose-300/90 mt-0.5">{errorMsg}</p>
            </div>
          </div>
        )}

        {successMsg && (
          <div
            data-testid="admin-login-success"
            className="rounded-xl bg-emerald-950/60 border border-emerald-800/80 p-4 flex items-start gap-3 text-sm text-emerald-200 animate-in fade-in"
          >
            <CheckCircle2 className="w-5 h-5 flex-shrink-0 text-emerald-400 mt-0.5" />
            <div>
              <p className="font-bold text-emerald-300">Authority Verified</p>
              <p className="text-xs text-emerald-300/90 mt-0.5">{successMsg}</p>
            </div>
          </div>
        )}

        {/* Form */}
        <form className="mt-6 space-y-4" onSubmit={handleAdminLogin}>
          <div>
            <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1.5">
              Administrator Email
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                <Mail className="h-4 w-4" />
              </div>
              <input
                id="admin-login-email"
                data-testid="admin-login-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@appointments-tirupati.com"
                className="block w-full pl-10 pr-3.5 py-2.5 bg-slate-900/90 border border-slate-700 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-colors"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider">
                Master Password
              </label>
              <span className="text-[10px] text-slate-500 font-medium">Zero-Trust Protected</span>
            </div>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                <Lock className="h-4 w-4" />
              </div>
              <input
                id="admin-login-password"
                data-testid="admin-login-password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••••••"
                className="block w-full pl-10 pr-3.5 py-2.5 bg-slate-900/90 border border-slate-700 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-colors"
              />
            </div>
          </div>

          <button
            id="admin-login-submit"
            data-testid="admin-login-submit"
            type="submit"
            disabled={loading}
            className="w-full mt-2 flex justify-center items-center py-3 px-4 rounded-xl shadow-lg text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-500 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                Verifying Cryptographic Credentials...
              </span>
            ) : (
              <span className="flex items-center gap-2">
                Authenticate Administrator
                <ArrowRight className="w-4 h-4" />
              </span>
            )}
          </button>
        </form>

        {/* Development Helper Switcher */}
        {process.env.NODE_ENV === 'development' && (
          <div className="pt-6 border-t border-slate-700/80">
            <div className="flex items-center gap-1.5 mb-2.5">
              <KeyRound className="w-4 h-4 text-emerald-400" />
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Test Credentials (Dev Harness)
              </span>
            </div>

            <div className="space-y-2">
              <button
                type="button"
                data-testid="quick-fill-admin"
                onClick={() => handleQuickFill('admin@appointments-tirupati.com', 'AdminSecure2026!')}
                className="w-full text-left p-2.5 rounded-xl border border-slate-700 bg-slate-900/60 hover:border-emerald-500/50 hover:bg-emerald-950/20 transition-all flex items-center justify-between group"
              >
                <div>
                  <p className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                    Platform Owner (Super Admin)
                    <span className="px-1.5 py-0.5 text-[9px] bg-emerald-500/20 text-emerald-400 rounded font-bold border border-emerald-500/30">
                      ROLE: ADMIN
                    </span>
                  </p>
                  <p className="text-[11px] text-slate-400">admin@appointments-tirupati.com</p>
                </div>
                <span className="text-[11px] font-bold text-emerald-400 opacity-0 group-hover:opacity-100 transition-opacity">
                  Autofill →
                </span>
              </button>

              <button
                type="button"
                data-testid="quick-fill-merchant"
                onClick={() => handleQuickFill('naturals.salon@tirupati-appointments.com', 'NaturalsSalon2026!')}
                className="w-full text-left p-2.5 rounded-xl border border-slate-700 bg-slate-900/60 hover:border-rose-500/50 hover:bg-rose-950/20 transition-all flex items-center justify-between group"
              >
                <div>
                  <p className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                    Salon Manager (Standard Merchant)
                    <span className="px-1.5 py-0.5 text-[9px] bg-amber-500/20 text-amber-400 rounded font-bold border border-amber-500/30">
                      ROLE: MERCHANT (UNAUTHORIZED)
                    </span>
                  </p>
                  <p className="text-[11px] text-slate-400">naturals.salon@tirupati-appointments.com</p>
                </div>
                <span className="text-[11px] font-bold text-rose-400 opacity-0 group-hover:opacity-100 transition-opacity">
                  Test Rejection →
                </span>
              </button>
            </div>
          </div>
        )}

        {/* Footer Security Seal */}
        <div className="text-center pt-2 text-[11px] text-slate-500 flex items-center justify-center gap-1.5">
          <Building2 className="w-3.5 h-3.5 text-slate-400" />
          <span>Postgres RLS Guarded • Tirupati Central Platform Authority</span>
        </div>
      </div>
    </div>
  );
}

export default function AdminLoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-900 flex items-center justify-center text-white">Loading secure gateway...</div>}>
      <AdminLoginForm />
    </Suspense>
  );
}
