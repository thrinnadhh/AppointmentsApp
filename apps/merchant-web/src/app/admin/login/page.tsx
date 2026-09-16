'use client';

import React, { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ShieldAlert,
  ShieldCheck,
  Lock,
  Mail,
  ArrowRight,
  KeyRound,
  CheckCircle2,
  Building2,
  Compass,
  Copy,
  Check,
  Smartphone,
  ArrowLeft,
  AlertTriangle
} from 'lucide-react';
import { supabase } from '@/lib/supabase';

type LoginStep = 'CREDENTIALS' | 'MFA_CHALLENGE' | 'MFA_ENROLL';

function AdminLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTarget = searchParams.get('redirect') || '/admin';

  // State Machine
  const [step, setStep] = useState<LoginStep>('CREDENTIALS');

  // Credentials State
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // MFA Challenge State
  const [factorId, setFactorId] = useState<string>('');
  const [challengeId, setChallengeId] = useState<string>('');
  const [mfaCode, setMfaCode] = useState('');

  // MFA Enrollment State
  const [enrollFactorId, setEnrollFactorId] = useState<string>('');
  const [qrCodeSvg, setQrCodeSvg] = useState<string>('');
  const [secretKey, setSecretKey] = useState<string>('');
  const [copiedSecret, setCopiedSecret] = useState(false);

  // Step 1: Handle Credentials Submission
  const handleCredentialsSubmit = async (e: React.FormEvent) => {
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

      // 3. Inspect MFA Factors for Authenticator Assurance Level 2 (AAL2)
      const { data: factorData, error: factorError } = await supabase.auth.mfa.listFactors();
      if (factorError) {
        console.warn('[MFA] Could not list factors:', factorError);
      }

      const verifiedTotp = factorData?.totp?.find((f) => f.status === 'verified');

      if (verifiedTotp) {
        // Verified factor exists -> Initiate MFA Challenge
        const { data: challengeData, error: chalError } = await supabase.auth.mfa.challenge({
          factorId: verifiedTotp.id,
        });

        if (chalError || !challengeData) {
          throw new Error(chalError?.message || 'Failed to initialize two-factor challenge.');
        }

        setFactorId(verifiedTotp.id);
        setChallengeId(challengeData.id);
        setStep('MFA_CHALLENGE');
        setSuccessMsg(null);
      } else {
        // First-time setup -> Clean up any stale unverified factors, then Enroll
        if (factorData?.all) {
          const unverified = factorData.all.filter((f) => (f.status as string) === 'unverified');
          for (const uf of unverified) {
            await supabase.auth.mfa.unenroll({ factorId: uf.id });
          }
        }

        const { data: enrollData, error: enrollError } = await supabase.auth.mfa.enroll({
          factorType: 'totp',
          issuer: 'Tirupati Appointments',
          friendlyName: 'Super Admin Key',
        });

        if (enrollError || !enrollData) {
          throw new Error(enrollError?.message || 'Failed to initialize two-factor enrollment.');
        }

        setEnrollFactorId(enrollData.id);
        setQrCodeSvg(enrollData.totp.qr_code);
        setSecretKey(enrollData.totp.secret);
        setStep('MFA_ENROLL');
        setSuccessMsg(null);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Authentication verification failed.';
      setErrorMsg(msg);
    } finally {
      setLoading(false);
    }
  };

  // Step 2A: Handle MFA Challenge Verification
  const handleMfaChallengeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mfaCode || mfaCode.trim().length !== 6) {
      setErrorMsg('Please enter a valid 6-digit verification code.');
      return;
    }

    setLoading(true);
    setErrorMsg(null);

    try {
      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId,
        challengeId,
        code: mfaCode.trim(),
      });

      if (verifyError) {
        throw new Error(verifyError.message || 'Invalid or expired 2FA code. Please try again.');
      }

      // Elevate session to AAL2 and redirect
      setSuccessMsg('Two-Factor Authentication verified. Transferring to Command Center...');
      setTimeout(() => {
        router.push(redirectTarget);
        router.refresh();
      }, 700);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'MFA Verification failed.';
      setErrorMsg(msg);
    } finally {
      setLoading(false);
    }
  };

  // Step 2B: Handle MFA Enrollment Verification
  const handleMfaEnrollSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mfaCode || mfaCode.trim().length !== 6) {
      setErrorMsg('Please enter the 6-digit code shown in your authenticator app.');
      return;
    }

    setLoading(true);
    setErrorMsg(null);

    try {
      const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({
        factorId: enrollFactorId,
        code: mfaCode.trim(),
      });

      if (verifyError) {
        throw new Error(verifyError.message || 'Verification code failed. Please check the current time on your device.');
      }

      setSuccessMsg('Authenticator device enrolled and verified! Access granted.');
      setTimeout(() => {
        router.push(redirectTarget);
        router.refresh();
      }, 700);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'MFA Enrollment verification failed.';
      setErrorMsg(msg);
    } finally {
      setLoading(false);
    }
  };

  // Copy secret key to clipboard
  const handleCopySecret = async () => {
    if (!secretKey) return;
    try {
      await navigator.clipboard.writeText(secretKey);
      setCopiedSecret(true);
      setTimeout(() => setCopiedSecret(false), 2000);
    } catch (err) {
      console.warn('Failed to copy secret:', err);
    }
  };

  // Return to credentials step
  const handleBackToLogin = async () => {
    await supabase.auth.signOut();
    setStep('CREDENTIALS');
    setMfaCode('');
    setErrorMsg(null);
    setSuccessMsg(null);
  };

  // Skip MFA for Dev Preview
  const handleSkipMfaDev = () => {
    setSuccessMsg('Bypassing 2FA requirement for local development preview...');
    setTimeout(() => {
      router.push(redirectTarget);
      router.refresh();
    }, 400);
  };

  const handleQuickFill = (presetEmail: string, presetPw: string) => {
    setEmail(presetEmail);
    setPassword(presetPw);
    setErrorMsg(null);
  };

  return (
    <div className="min-h-screen flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8 bg-slate-900 text-slate-100">
      <div className="max-w-md w-full space-y-7 bg-slate-800/90 border border-slate-700 p-8 rounded-2xl shadow-2xl backdrop-blur-sm">
        {/* Header Badge */}
        <div className="text-center">
          <div className="mx-auto h-14 w-14 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-700 flex items-center justify-center text-white shadow-lg shadow-emerald-950/40 mb-4 border border-emerald-400/30">
            {step === 'CREDENTIALS' && <ShieldCheck className="w-7 h-7" />}
            {step === 'MFA_CHALLENGE' && <Smartphone className="w-7 h-7" />}
            {step === 'MFA_ENROLL' && <KeyRound className="w-7 h-7" />}
          </div>

          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold tracking-wider uppercase bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 mb-2">
            <Compass className="w-3 h-3" />
            Executive Governance Gateway
          </div>

          <h1 className="text-2xl font-black tracking-tight text-white">
            {step === 'CREDENTIALS' && 'Super Admin Portal'}
            {step === 'MFA_CHALLENGE' && 'Two-Factor Challenge'}
            {step === 'MFA_ENROLL' && 'Setup Two-Factor (2FA)'}
          </h1>

          <p className="mt-2 text-xs text-slate-400 leading-relaxed">
            {step === 'CREDENTIALS' &&
              'Restricted authentication portal for territorial multi-city rollout, municipal licensing, and merchant compliance oversight.'}
            {step === 'MFA_CHALLENGE' &&
              'Enter the 6-digit cryptographic security code from your Google Authenticator or 1Password app to elevate session to AAL2.'}
            {step === 'MFA_ENROLL' &&
              'Scan the secure QR code with Google Authenticator or Authy to configure hardware-grade protection for this executive account.'}
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

        {/* ================= STAGE 1: CREDENTIALS FORM ================= */}
        {step === 'CREDENTIALS' && (
          <form className="space-y-4" onSubmit={handleCredentialsSubmit}>
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
                  Verifying Credentials...
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  Verify Credentials & Proceed
                  <ArrowRight className="w-4 h-4" />
                </span>
              )}
            </button>
          </form>
        )}

        {/* ================= STAGE 2A: MFA CHALLENGE FORM ================= */}
        {step === 'MFA_CHALLENGE' && (
          <form className="space-y-4" onSubmit={handleMfaChallengeSubmit}>
            <div className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-700 text-center">
              <span className="text-[11px] font-semibold text-emerald-400 uppercase tracking-wider block mb-1">
                AAL2 Security Verification
              </span>
              <p className="text-xs text-slate-300">
                A 6-digit verification code is required to complete authentication.
              </p>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-2 text-center">
                6-Digit Authenticator Code
              </label>
              <input
                id="admin-mfa-code"
                data-testid="admin-mfa-code"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                required
                autoFocus
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ''))}
                placeholder="123456"
                className="block w-full py-3 px-4 bg-slate-900 border-2 border-emerald-500/50 rounded-xl text-center font-mono text-2xl tracking-[0.4em] text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-400 transition-all"
              />
            </div>

            <button
              id="admin-mfa-submit"
              data-testid="admin-mfa-submit"
              type="submit"
              disabled={loading || mfaCode.length !== 6}
              className="w-full flex justify-center items-center py-3 px-4 rounded-xl shadow-lg text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-500 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                  Validating TOTP Code...
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  Verify & Elevate Session
                  <ArrowRight className="w-4 h-4" />
                </span>
              )}
            </button>

            <div className="pt-2 flex items-center justify-between text-xs text-slate-400">
              <button
                type="button"
                onClick={handleBackToLogin}
                className="inline-flex items-center gap-1.5 hover:text-slate-200 transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Sign In as Different User
              </button>
              {process.env.NODE_ENV === 'development' && (
                <button
                  type="button"
                  data-testid="admin-mfa-skip"
                  onClick={handleSkipMfaDev}
                  className="text-amber-400/90 hover:text-amber-300 transition-colors underline text-[11px]"
                >
                  Skip for now (Dev Preview)
                </button>
              )}
            </div>
          </form>
        )}

        {/* ================= STAGE 2B: MFA ENROLLMENT FORM ================= */}
        {step === 'MFA_ENROLL' && (
          <form className="space-y-5" onSubmit={handleMfaEnrollSubmit}>
            <div className="p-3 rounded-xl bg-amber-950/40 border border-amber-800/60 text-xs text-amber-300 flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 text-amber-400 mt-0.5" />
              <div>
                <span className="font-bold block">First-Time Setup Required</span>
                Your administrator account requires Multi-Factor Authentication before accessing operational data.
              </div>
            </div>

            {/* QR Code */}
            {qrCodeSvg && (
              <div className="text-center space-y-2">
                <div className="inline-block p-3 rounded-2xl bg-white shadow-xl border border-slate-300">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={qrCodeSvg}
                    alt="MFA QR Code"
                    data-testid="admin-mfa-qr"
                    className="w-44 h-44 mx-auto"
                  />
                </div>
                <p className="text-[11px] text-slate-400">Scan with Google Authenticator, 1Password, or Authy</p>
              </div>
            )}

            {/* Secret Key with Copy */}
            {secretKey && (
              <div>
                <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                  Or Enter Secret Key Manually
                </label>
                <div className="flex items-center gap-2">
                  <code
                    data-testid="admin-mfa-secret"
                    className="flex-1 px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl font-mono text-xs text-emerald-400 select-all overflow-x-auto"
                  >
                    {secretKey}
                  </code>
                  <button
                    type="button"
                    onClick={handleCopySecret}
                    className="px-3 py-2 bg-slate-700/80 hover:bg-slate-700 border border-slate-600 rounded-xl text-xs font-semibold text-slate-200 transition-colors flex items-center gap-1.5"
                    title="Copy Secret Key"
                  >
                    {copiedSecret ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    {copiedSecret ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>
            )}

            {/* Confirmation Code Input */}
            <div>
              <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1.5">
                Confirmation Code from App
              </label>
              <input
                id="admin-mfa-code"
                data-testid="admin-mfa-code"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                required
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ''))}
                placeholder="123456"
                className="block w-full py-2.5 px-4 bg-slate-900 border border-slate-700 rounded-xl text-center font-mono text-xl tracking-[0.3em] text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-400 transition-colors"
              />
            </div>

            <button
              id="admin-mfa-submit"
              data-testid="admin-mfa-submit"
              type="submit"
              disabled={loading || mfaCode.length !== 6}
              className="w-full flex justify-center items-center py-3 px-4 rounded-xl shadow-lg text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-500 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                  Activating 2FA Token...
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  Confirm & Activate 2FA
                  <ArrowRight className="w-4 h-4" />
                </span>
              )}
            </button>

            <div className="pt-2 flex items-center justify-between text-xs text-slate-400">
              <button
                type="button"
                onClick={handleBackToLogin}
                className="inline-flex items-center gap-1.5 hover:text-slate-200 transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Cancel & Sign Out
              </button>

              <button
                type="button"
                data-testid="admin-mfa-skip"
                onClick={handleSkipMfaDev}
                className="text-amber-400/90 hover:text-amber-300 transition-colors underline text-[11px]"
              >
                Skip for now (Dev Preview)
              </button>
            </div>
          </form>
        )}

        {/* Development Helper Switcher (Only on Credentials step) */}
        {process.env.NODE_ENV === 'development' && step === 'CREDENTIALS' && (
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
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-900 flex items-center justify-center text-white">
          Loading secure gateway...
        </div>
      }
    >
      <AdminLoginForm />
    </Suspense>
  );
}
