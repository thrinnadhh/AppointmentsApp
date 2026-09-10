'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { 
  Building2, 
  ShieldCheck, 
  Lock, 
  Mail, 
  ArrowRight, 
  AlertCircle,
  KeyRound,
  CheckCircle2
} from 'lucide-react';
import { supabase } from '@/lib/supabase';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setErrorMsg('Please enter both email and password.');
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) {
        throw error;
      }

      if (data.session) {
        setSuccessMsg('Authentication successful. Redirecting to Merchant Hub...');
        setTimeout(() => {
          router.push('/');
        }, 800);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Invalid login credentials.';
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
    <div className="min-h-[85vh] flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8 bg-slate-50/50">
      <div className="max-w-md w-full space-y-8 bg-white p-8 rounded-2xl border border-slate-200 shadow-sm">
        
        {/* Header */}
        <div className="text-center">
          <div className="mx-auto h-12 w-12 rounded-xl bg-gradient-to-br from-emerald-600 to-teal-700 flex items-center justify-center text-white shadow-sm mb-4">
            <Building2 className="w-6 h-6" />
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">
            Merchant & Admin Access
          </h2>
          <p className="mt-2 text-sm text-slate-500">
            Secure authentication portal for authorized Tirupati providers & platform managers.
          </p>
        </div>

        {/* Alerts */}
        {errorMsg && (
          <div className="rounded-lg bg-rose-50 border border-rose-200 p-3.5 flex items-start gap-2.5 text-sm text-rose-700">
            <AlertCircle className="w-5 h-5 flex-shrink-0 text-rose-500 mt-0.5" />
            <div>
              <p className="font-semibold">Sign in failed</p>
              <p className="text-xs text-rose-600">{errorMsg}</p>
            </div>
          </div>
        )}

        {successMsg && (
          <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3.5 flex items-start gap-2.5 text-sm text-emerald-700">
            <CheckCircle2 className="w-5 h-5 flex-shrink-0 text-emerald-600 mt-0.5" />
            <div>
              <p className="font-semibold">{successMsg}</p>
            </div>
          </div>
        )}

        {/* Login Form */}
        <form className="mt-8 space-y-5" onSubmit={handleLogin}>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Authorized Email
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                <Mail className="h-4 w-4" />
              </div>
              <input
                id="login-email"
                name="loginEmail"
                aria-label="Authorized Email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@appointments-tirupati.com"
                className="block w-full pl-9 pr-3 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 bg-white"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor="login-password" className="block text-xs font-semibold text-slate-700">
                Password
              </label>
              <span className="text-[11px] text-slate-400">Min 6 characters</span>
            </div>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                <Lock className="h-4 w-4" />
              </div>
              <input
                id="login-password"
                name="loginPassword"
                aria-label="Password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="block w-full pl-9 pr-3 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 bg-white"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full flex justify-center items-center py-2.5 px-4 border border-transparent rounded-lg shadow-sm text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500 transition-colors disabled:opacity-50"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                Verifying Access...
              </span>
            ) : (
              <span className="flex items-center gap-2">
                Sign In to Dashboard
                <ArrowRight className="w-4 h-4" />
              </span>
            )}
          </button>
        </form>

        {/* Quick Demo Credentials Switcher — DEV ONLY */}
        {process.env.NODE_ENV === 'development' && (
        <div className="pt-6 border-t border-slate-200">
          <div className="flex items-center gap-1.5 mb-3">
            <KeyRound className="w-4 h-4 text-emerald-600" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600">
              Demo Credentials (Dev Only)
            </h3>
          </div>
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => handleQuickFill('admin@appointments-tirupati.com', 'AdminSecure2026!')}
              className="w-full text-left p-2.5 rounded-lg border border-slate-200 hover:border-emerald-300 hover:bg-emerald-50/50 transition-colors flex items-center justify-between group"
            >
              <div>
                <p className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                  Super Admin (Primary Owner)
                  <span className="px-1.5 py-0.5 text-[10px] bg-emerald-100 text-emerald-800 rounded font-semibold">
                    Full Access
                  </span>
                </p>
                <p className="text-[11px] text-slate-500">admin@appointments-tirupati.com</p>
              </div>
              <span className="text-[11px] font-semibold text-emerald-600 opacity-0 group-hover:opacity-100 transition-opacity">
                Select →
              </span>
            </button>

            <button
              type="button"
              onClick={() => handleQuickFill('svims.clinic@tirupati-appointments.com', 'SvimsClinic2026!')}
              className="w-full text-left p-2.5 rounded-lg border border-slate-200 hover:border-emerald-300 hover:bg-emerald-50/50 transition-colors flex items-center justify-between group"
            >
              <div>
                <p className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                  SVIMS Specialty Clinic
                  <span className="px-1.5 py-0.5 text-[10px] bg-sky-100 text-sky-800 rounded font-semibold">
                    Hospital Staff
                  </span>
                </p>
                <p className="text-[11px] text-slate-500">svims.clinic@tirupati-appointments.com</p>
              </div>
              <span className="text-[11px] font-semibold text-emerald-600 opacity-0 group-hover:opacity-100 transition-opacity">
                Select →
              </span>
            </button>

            <button
              type="button"
              onClick={() => handleQuickFill('naturals.salon@tirupati-appointments.com', 'NaturalsSalon2026!')}
              className="w-full text-left p-2.5 rounded-lg border border-slate-200 hover:border-emerald-300 hover:bg-emerald-50/50 transition-colors flex items-center justify-between group"
            >
              <div>
                <p className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                  Naturals Salon & Spa
                  <span className="px-1.5 py-0.5 text-[10px] bg-amber-100 text-amber-800 rounded font-semibold">
                    Salon Manager
                  </span>
                </p>
                <p className="text-[11px] text-slate-500">naturals.salon@tirupati-appointments.com</p>
              </div>
              <span className="text-[11px] font-semibold text-emerald-600 opacity-0 group-hover:opacity-100 transition-opacity">
                Select →
              </span>
            </button>
          </div>
        </div>
        )}

        <div className="flex items-center justify-center gap-2 text-xs text-slate-400 text-center">
          <ShieldCheck className="w-4 h-4 text-emerald-600" />
          <span>Postgres Row Level Security (RLS) & Bcrypt Protected</span>
        </div>
      </div>
    </div>
  );
}
