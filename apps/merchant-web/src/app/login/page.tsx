'use client';

import React, { useState, useEffect } from 'react';
import { 
  Building2, 
  ShieldCheck, 
  Lock, 
  Mail, 
  ArrowRight, 
  AlertCircle, 
  KeyRound, 
  CheckCircle2,
  Sparkles
} from 'lucide-react';
import { supabase } from '@/lib/supabase';

export default function LoginPage() {
  // Mode: 'signin' by default, or 'register'
  const [authMode, setAuthMode] = useState<'signin' | 'register'>('signin');

  // Sign In Form State
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // UI State
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);

    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const modeParam = params.get('mode');
      if (modeParam === 'signin' || modeParam === 'register') {
        setAuthMode(modeParam);
      }
    }

    // Only auto-redirect if returning from an OAuth callback
    if (typeof window !== 'undefined' && (window.location.search.includes('oauth=') || window.location.hash.includes('access_token'))) {
      const checkSession = async () => {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          const userEmail = session.user.email ? session.user.email.toLowerCase().trim() : '';
          const { data: provs } = await supabase
            .from('providers')
            .select('id')
            .or(`owner_id.eq.${session.user.id},email.ilike.${userEmail}`)
            .limit(1);

          const hasShop = Boolean(provs && provs.length > 0);
          if (!hasShop) {
            setSuccessMsg('Email verified with Google! Please register your venue details...');
            setTimeout(() => {
              window.location.href = '/register';
            }, 600);
          } else {
            setSuccessMsg('Session detected! Redirecting to Merchant Workspace...');
            const params = new URLSearchParams(window.location.search);
            const redirectPath = params.get('redirect') || '/';
            setTimeout(() => {
              window.location.href = redirectPath;
            }, 600);
          }
        }
      };
      checkSession();
    }
  }, []);

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
        const userEmail = data.session.user.email ? data.session.user.email.toLowerCase().trim() : '';
        const { data: provs } = await supabase
          .from('providers')
          .select('id')
          .or(`owner_id.eq.${data.session.user.id},email.ilike.${userEmail}`)
          .limit(1);

        const hasShop = Boolean(provs && provs.length > 0);
        if (!hasShop) {
          setSuccessMsg('Authentication successful! Please register your venue details...');
          window.location.href = '/register';
        } else {
          setSuccessMsg('Authentication successful. Redirecting to Merchant Hub...');
          const params = new URLSearchParams(window.location.search);
          const redirectPath = params.get('redirect') || '/';
          window.location.href = redirectPath;
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Invalid login credentials.';
      setErrorMsg(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const redirectOrigin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${redirectOrigin}/auth/callback`,
          queryParams: {
            access_type: 'offline',
            prompt: 'consent',
          },
        },
      });

      if (error) throw error;
      if (data?.url) {
        window.location.href = data.url;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Google OAuth authentication failed.';
      if (msg.toLowerCase().includes('provider is not enabled') || msg.toLowerCase().includes('validation_failed')) {
        setErrorMsg('Google OAuth is not enabled yet in your Supabase project (Authentication → Providers → Google). You can sign in immediately below using your registered email and password.');
      } else {
        setErrorMsg(msg);
      }
      setLoading(false);
    }
  };

  const handleQuickLogin = async (presetEmail: string, presetPw: string) => {
    setEmail(presetEmail);
    setPassword(presetPw);
    setErrorMsg(null);
    setLoading(true);
    try {
      let { data, error } = await supabase.auth.signInWithPassword({
        email: presetEmail,
        password: presetPw,
      });

      if (error && (presetEmail.includes('svims.clinic') || presetEmail.includes('naturals.salon'))) {
        const signUpRes = await supabase.auth.signUp({
          email: presetEmail,
          password: presetPw,
          options: {
            data: {
              full_name: presetEmail.includes('svims') ? 'Dr. Sundararajan (SVIMS Clinic)' : 'Naturals Salon Staff',
              role: 'merchant',
            },
          },
        });
        if (signUpRes.data?.session) {
          data = signUpRes.data as any;
          error = null;
        } else {
          const retrySignIn = await supabase.auth.signInWithPassword({
            email: presetEmail,
            password: presetPw,
          });
          data = retrySignIn.data as any;
          error = retrySignIn.error;
        }
      }

      if (error) {
        throw error;
      }

      if (data.session) {
        setSuccessMsg('Authentication successful. Redirecting to Merchant Hub...');
        const params = new URLSearchParams(window.location.search);
        const redirectPath = params.get('redirect') || '/';
        window.location.href = redirectPath;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Invalid login credentials.';
      setErrorMsg(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div data-hydrated={mounted ? "true" : "false"} className="min-h-[85vh] flex items-center justify-center py-10 px-4 sm:px-6 lg:px-8 bg-slate-50/50">
      <div className="max-w-lg w-full space-y-6 bg-white p-8 rounded-2xl border border-slate-200 shadow-sm">
        
        {/* Header */}
        <div className="text-center">
          <div className="mx-auto h-12 w-12 rounded-xl bg-gradient-to-br from-emerald-600 to-teal-700 flex items-center justify-center text-white shadow-sm mb-4">
            <Building2 className="w-6 h-6" />
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">
            Merchant & Admin Access Portal
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Unified workspace & business registration for Tirupati providers
          </p>
        </div>

        {/* Mode Switcher Tabs */}
        <div className="flex bg-slate-100 p-1 rounded-xl">
          <button
            type="button"
            data-testid="auth-tab-signin"
            onClick={() => {
              setAuthMode('signin');
              setErrorMsg(null);
            }}
            className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${
              authMode === 'signin'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            data-testid="auth-tab-register"
            onClick={() => {
              setAuthMode('register');
              setErrorMsg(null);
            }}
            className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${
              authMode === 'register'
                ? 'bg-white text-emerald-800 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Register Business
          </button>
        </div>

        {/* Alerts */}
        {errorMsg && (
          <div className="rounded-lg bg-rose-50 border border-rose-200 p-3.5 flex items-start gap-2.5 text-sm text-rose-700">
            <AlertCircle className="w-5 h-5 flex-shrink-0 text-rose-500 mt-0.5" />
            <div>
              <p className="font-semibold text-xs">Action failed</p>
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

        {/* Primary Entry Point: Google Verified Authentication */}
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 text-center space-y-3">
          <div className="flex items-center justify-center gap-1.5 text-xs font-bold text-slate-800 uppercase tracking-wider">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span>Google Verified Authentication</span>
          </div>
          <p className="text-xs text-slate-600 leading-relaxed max-w-sm mx-auto">
            {authMode === 'register'
              ? 'Authenticate with Google to verify your business email. After signing in, you will configure your shop profile, address, and upload your storefront photo in Step 2.'
              : 'Sign in with your Google account. First-time merchants will be prompted to set up their venue profile and storefront photo; returning merchants enter directly into their workspace.'}
          </p>
          <button
            type="button"
            data-testid="google-auth-btn"
            onClick={handleGoogleSignIn}
            disabled={loading}
            className="w-full flex justify-center items-center gap-3 py-3 px-4 border border-slate-300 rounded-xl shadow-xs text-xs sm:text-sm font-semibold text-slate-800 bg-white hover:bg-slate-100 hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500 transition-all cursor-pointer"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"
              />
              <path
                fill="#34A853"
                d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.35 24 12 24z"
              />
              <path
                fill="#FBBC05"
                d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.99 0 12s.45 3.82 1.25 5.42l4.03-3.15z"
              />
              <path
                fill="#EA4335"
                d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.35 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
              />
            </svg>
            <span>{authMode === 'register' ? 'Register with Google' : 'Continue with Google'}</span>
          </button>
          <div className="flex items-center justify-center gap-3 text-[11px] text-slate-500 pt-0.5">
            <span>✓ Verified Email</span>
            <span>•</span>
            <span>✓ Storefront Photo Sync</span>
            <span>•</span>
            <span>✓ Direct Workspace</span>
          </div>

          <div className="relative pt-2">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-200"></div>
            </div>
            <div className="relative flex justify-center text-[10px] uppercase tracking-wider font-semibold">
              <span className="bg-slate-50 px-2 text-slate-400">
                {authMode === 'signin' ? 'Or sign in with password' : 'How registration works'}
              </span>
            </div>
          </div>
        </div>

        {/* TAB 1: Sign In Mode (Password Login) */}
        {authMode === 'signin' && (
          <form className="space-y-4" onSubmit={handleLogin}>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Merchant or Admin Email
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                  <Mail className="h-4 w-4" />
                </div>
                <input
                  id="login-email"
                  name="loginEmail"
                  data-testid="login-email"
                  aria-label="Authorized Email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="owner@tirupati-salon.com"
                  className="block w-full pl-9 pr-3 py-2.5 border border-slate-300 rounded-xl text-xs sm:text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 bg-white"
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
                  data-testid="login-password"
                  aria-label="Password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="block w-full pl-9 pr-3 py-2.5 border border-slate-300 rounded-xl text-xs sm:text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 bg-white"
                />
              </div>
            </div>

            <button
              type="submit"
              data-testid="login-submit"
              disabled={loading}
              className="w-full flex justify-center items-center py-2.5 px-4 border border-transparent rounded-xl shadow-xs text-xs sm:text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500 transition-colors disabled:opacity-50 cursor-pointer"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                  Verifying Credentials...
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  Sign In to Workspace
                  <ArrowRight className="w-4 h-4" />
                </span>
              )}
            </button>
          </form>
        )}

        {/* TAB 2: Register Explanation (2-Step Flow) */}
        {authMode === 'register' && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-emerald-600" />
              <h4 className="text-xs font-bold text-emerald-950 uppercase tracking-wider">
                Two-Step Business Registration
              </h4>
            </div>
            <ol className="space-y-2.5 text-xs text-slate-700">
              <li className="flex items-start gap-2.5">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-emerald-600 text-white font-bold flex items-center justify-center text-[10px]">1</span>
                <div>
                  <span className="font-semibold text-slate-900">Verify Email with Google:</span> Click &ldquo;Register with Google&rdquo; above to link your official business email address.
                </div>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-emerald-200 text-emerald-900 font-bold flex items-center justify-center text-[10px]">2</span>
                <div>
                  <span className="font-semibold text-slate-900">Shop Profile & Photo Setup:</span> On the next screen, enter your venue name, owner contact, address, and upload your storefront photo.
                </div>
              </li>
            </ol>
            <div className="pt-2 border-t border-emerald-200/60 flex items-center justify-between text-xs">
              <span className="text-slate-500">Already have an account?</span>
              <button
                type="button"
                onClick={() => setAuthMode('signin')}
                className="font-bold text-emerald-700 hover:text-emerald-800 cursor-pointer"
              >
                Sign In with Password →
              </button>
            </div>
          </div>
        )}

        {/* Quick Demo Credentials Switcher — DEV ONLY */}
        {process.env.NODE_ENV === 'development' && (
          <div className="pt-4 border-t border-slate-200">
            <div className="flex items-center gap-1.5 mb-2.5">
              <KeyRound className="w-3.5 h-3.5 text-emerald-600" />
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
                Preset Demo Credentials (Dev Only)
              </h3>
            </div>
            <div className="space-y-1.5">
              <button
                type="button"
                data-testid="demo-login-admin"
                onClick={() => handleQuickLogin('admin@appointments-tirupati.com', 'AdminSecure2026!')}
                className="w-full text-left p-2 rounded-lg border border-slate-200 hover:border-emerald-300 hover:bg-emerald-50/50 transition-colors flex items-center justify-between group cursor-pointer"
              >
                <div>
                  <p className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    Super Admin (Platform Owner)
                    <span className="px-1.5 py-0.5 text-[9px] bg-emerald-100 text-emerald-800 rounded font-semibold">
                      Full Governance
                    </span>
                  </p>
                  <p className="text-[10px] text-slate-500">admin@appointments-tirupati.com</p>
                </div>
                <span className="text-[10px] font-semibold text-emerald-600 opacity-0 group-hover:opacity-100 transition-opacity">
                  Select →
                </span>
              </button>

              <button
                type="button"
                data-testid="demo-login-clinic"
                onClick={() => handleQuickLogin('svims.clinic@tirupati-appointments.com', 'SvimsClinic2026!')}
                className="w-full text-left p-2 rounded-lg border border-slate-200 hover:border-emerald-300 hover:bg-emerald-50/50 transition-colors flex items-center justify-between group cursor-pointer"
              >
                <div>
                  <p className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    SVIMS Specialty Clinic
                    <span className="px-1.5 py-0.5 text-[9px] bg-sky-100 text-sky-800 rounded font-semibold">
                      Hospital Staff
                    </span>
                  </p>
                  <p className="text-[10px] text-slate-500">svims.clinic@tirupati-appointments.com</p>
                </div>
                <span className="text-[10px] font-semibold text-emerald-600 opacity-0 group-hover:opacity-100 transition-opacity">
                  Select →
                </span>
              </button>

              <button
                type="button"
                data-testid="demo-login-salon"
                onClick={() => handleQuickLogin('naturals.salon@tirupati-appointments.com', 'NaturalsSalon2026!')}
                className="w-full text-left p-2 rounded-lg border border-slate-200 hover:border-emerald-300 hover:bg-emerald-50/50 transition-colors flex items-center justify-between group cursor-pointer"
              >
                <div>
                  <p className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    Naturals Beauty Salon
                    <span className="px-1.5 py-0.5 text-[9px] bg-amber-100 text-amber-800 rounded font-semibold">
                      Salon Staff
                    </span>
                  </p>
                  <p className="text-[10px] text-slate-500">naturals.salon@tirupati-appointments.com</p>
                </div>
                <span className="text-[10px] font-semibold text-emerald-600 opacity-0 group-hover:opacity-100 transition-opacity">
                  Select →
                </span>
              </button>
            </div>
          </div>
        )}

        <div className="flex items-center justify-center gap-2 text-[11px] text-slate-400 text-center pt-2">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
          <span>Postgres Row Level Security (RLS) & Multi-Tenant Isolated</span>
        </div>
      </div>
    </div>
  );
}
