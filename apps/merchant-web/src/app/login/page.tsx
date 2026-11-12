'use client';

import React, { useState, useEffect } from 'react';
import { 
  Building2, 
  ShieldCheck, 
  Lock, 
  Mail, 
  ArrowRight, 
  AlertCircle, 
  CheckCircle2,
  Sparkles,
  User
} from 'lucide-react';
import { supabase, fetchTenantContextData } from '@/lib/supabase';
import { isGoogleAuthConfigured, getMissingGoogleAuthVars } from '@/lib/env';
import { GoogleAuthSection } from '@/components/GoogleAuthSection';

/**
 * Validates return URLs to prevent Open Redirect attacks.
 * Disallows protocol-relative URLs (e.g. //evil.com) and absolute external origins.
 */
const SAFE_REDIRECT_REGEX = /^\/(?!\/)[a-zA-Z0-9\-_./]*$/;

function getSafeRedirectUrl(target: string | null | undefined): string {
  if (!target) return '/';
  const trimmed = target.trim();
  if (SAFE_REDIRECT_REGEX.test(trimmed)) {
    return trimmed;
  }
  return '/';
}

export default function LoginPage() {
  // Mode: 'signin' by default, or 'register'
  const [authMode, setAuthMode] = useState<'signin' | 'register'>('signin');

  // Sign In Form State
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // Register Form State
  const [regFullName, setRegFullName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirmPassword, setRegConfirmPassword] = useState('');

  // UI State
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);

    if (typeof window !== 'undefined') {
      // Clear any stale test/mock merchant session storage keys
      window.sessionStorage.removeItem('test_merchant_user');

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
          const userRole = session.user.user_metadata?.role;
          const isAdmin = userRole === 'admin' || userEmail.includes('admin');

          if (isAdmin) {
            setSuccessMsg('Session detected! Redirecting to Merchant Workspace...');
            const params = new URLSearchParams(window.location.search);
            const redirectPath = getSafeRedirectUrl(params.get('redirect'));
            setTimeout(() => {
              window.location.href = redirectPath;
            }, 600);
            return;
          }

          const tenantData = await fetchTenantContextData();
          const hasShop = Boolean(
            tenantData.activeProvider ||
            tenantData.isSuperAdmin ||
            (tenantData.memberships && tenantData.memberships.length > 0)
          );

          if (!hasShop) {
            const { data: provs } = await supabase
              .from('providers')
              .select('id')
              .or(`owner_id.eq.${session.user.id},email.ilike.${userEmail}`)
              .limit(1);

            if (!provs || provs.length === 0) {
              setSuccessMsg('Email verified with Google! Please register your venue details...');
              setTimeout(() => {
                window.location.href = '/register';
              }, 600);
              return;
            }
          }

          setSuccessMsg('Session detected! Redirecting to Merchant Workspace...');
          const params = new URLSearchParams(window.location.search);
          const redirectPath = getSafeRedirectUrl(params.get('redirect'));
          setTimeout(() => {
            window.location.href = redirectPath;
          }, 600);
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
        const userRole = data.session.user.user_metadata?.role;
        const isAdmin = userRole === 'admin' || userEmail.includes('admin');

        if (isAdmin) {
          setSuccessMsg('Authentication successful. Redirecting to Merchant Hub...');
          const params = new URLSearchParams(window.location.search);
          const redirectPath = getSafeRedirectUrl(params.get('redirect'));
          window.location.href = redirectPath;
          return;
        }

        const tenantData = await fetchTenantContextData();
        const hasShop = Boolean(
          tenantData.activeProvider ||
          tenantData.isSuperAdmin ||
          (tenantData.memberships && tenantData.memberships.length > 0)
        );

        if (!hasShop) {
          const { data: provs } = await supabase
            .from('providers')
            .select('id')
            .or(`owner_id.eq.${data.session.user.id},email.ilike.${userEmail}`)
            .limit(1);

          if (!provs || provs.length === 0) {
            setSuccessMsg('Authentication successful! Please register your venue details...');
            window.location.href = '/register';
            return;
          }
        }

        setSuccessMsg('Authentication successful. Redirecting to Merchant Hub...');
        const params = new URLSearchParams(window.location.search);
        const redirectPath = getSafeRedirectUrl(params.get('redirect'));
        window.location.href = redirectPath;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Invalid login credentials.';
      setErrorMsg(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = regFullName.trim();
    const cleanEmail = regEmail.trim().toLowerCase();

    if (!cleanName || !cleanEmail || !regPassword) {
      setErrorMsg('Please enter your full name, email, and password.');
      return;
    }
    if (regPassword.length < 6) {
      setErrorMsg('Password must be at least 6 characters.');
      return;
    }
    if (regPassword !== regConfirmPassword) {
      setErrorMsg('Passwords do not match. Please verify your password confirmation.');
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      if (typeof window !== 'undefined') {
        window.sessionStorage.removeItem('test_merchant_user');
      }

      const { data, error } = await supabase.auth.signUp({
        email: cleanEmail,
        password: regPassword,
        options: {
          data: {
            full_name: cleanName,
            role: 'merchant',
          },
        },
      });

      if (error) {
        throw error;
      }

      if (data.user || data.session) {
        setSuccessMsg('Account registered successfully! Redirecting to venue setup...');
        setTimeout(() => {
          window.location.href = '/register';
        }, 500);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Registration failed. Please try again.';
      setErrorMsg(msg);
    } finally {
      setLoading(false);
    }
  };

  // Google OAuth configuration & state
  // Do not rename these variables without updating env.ts, .env.example and tests.
  const isGoogleFlagEnabled = process.env.NEXT_PUBLIC_ENABLE_GOOGLE_AUTH === 'true';
  const isDev = process.env.NODE_ENV === 'development';
  const [supabaseGoogleActive, setSupabaseGoogleActive] = useState<boolean | null>(null);

  useEffect(() => {
    if (isGoogleFlagEnabled && typeof window !== 'undefined') {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
      fetch(`${supabaseUrl}/auth/v1/settings`, {
        headers: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY } : {},
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          setSupabaseGoogleActive(Boolean(data?.external?.google));
        })
        .catch(() => {
          setSupabaseGoogleActive(false);
        });
    }
  }, [isGoogleFlagEnabled]);

  const isGoogleFullyConfigured =
    isGoogleFlagEnabled &&
    isGoogleAuthConfigured(undefined, {
      supabaseSettingsGoogle: supabaseGoogleActive === true,
    });
  const missingGoogleVars = getMissingGoogleAuthVars();

  const handleGoogleSignIn = async () => {
    if (!isGoogleFullyConfigured) {
      const reason =
        supabaseGoogleActive === false
          ? 'NEXT_PUBLIC_ENABLE_GOOGLE_AUTH=true, but Supabase /auth/v1/settings reports external.google=false.'
          : `Missing: ${missingGoogleVars.join(', ') || 'NEXT_PUBLIC_GOOGLE_CLIENT_ID'} in apps/merchant-web/.env.local`;
      setErrorMsg(`Google OAuth is not configured in this environment. ${reason}`);
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    try {
      const redirectOrigin = typeof window !== 'undefined' && window.location?.origin
        ? window.location.origin
        : '';

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
      setErrorMsg(msg);
      setLoading(false);
    }
  };

  return (
    <div
      data-hydrated={mounted ? "true" : "false"}
      style={{
        minHeight: '88vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '40px 16px',
        background: 'var(--color-surface-raised)',
      }}
    >
      <div
        style={{
          maxWidth: 440,
          width: '100%',
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-xl)',
          boxShadow: '0 4px 24px rgba(0,0,0,0.07), 0 1px 4px rgba(0,0,0,0.05)',
          overflow: 'hidden',
        }}
      >
        {/* Card Top Accent */}
        <div style={{ height: 4, background: 'linear-gradient(90deg, #047857 0%, #059669 60%, #10b981 100%)' }} />

        <div style={{ padding: '32px 32px 28px' }}>
          {/* Header */}
          <div style={{ textAlign: 'center', marginBottom: 28 }}>
            <div style={{
              width: 48,
              height: 48,
              margin: '0 auto 16px',
              borderRadius: 12,
              background: 'linear-gradient(135deg, #047857 0%, #065f46 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 12px rgba(4,120,87,0.3)',
            }}>
              <Building2 style={{ width: 24, height: 24, color: '#fff' }} />
            </div>
            <h2 style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-ink)', letterSpacing: '-0.02em', margin: '0 0 6px' }}>
              Merchant &amp; Admin Access
            </h2>
            <p style={{ fontSize: 13, color: 'var(--color-ink-tertiary)', margin: 0 }}>
              Workspace &amp; business registration for Tirupati providers
            </p>
          </div>

          {/* Mode Switcher */}
          <div style={{
            display: 'flex',
            background: 'var(--color-surface-sunken)',
            padding: 4,
            borderRadius: 'var(--radius-md)',
            marginBottom: 24,
            gap: 4,
          }}>
            {(['signin', 'register'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                data-testid={`auth-tab-${mode}`}
                onClick={() => { setAuthMode(mode); setErrorMsg(null); }}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  fontSize: 13,
                  fontWeight: 600,
                  borderRadius: 'var(--radius-sm)',
                  border: 'none',
                  cursor: 'pointer',
                  transition: 'all 120ms ease',
                  background: authMode === mode ? 'var(--color-surface)' : 'transparent',
                  color: authMode === mode ? (mode === 'register' ? 'var(--color-primary)' : 'var(--color-ink)') : 'var(--color-ink-tertiary)',
                  boxShadow: authMode === mode ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                }}
              >
                {mode === 'signin' ? 'Sign In' : 'Register Business'}
              </button>
            ))}
          </div>

          {/* Alerts */}
          {errorMsg && (() => {
            const isNotice = errorMsg.includes('Google OAuth is not configured');
            return (
              <div style={{
                borderRadius: 'var(--radius-md)',
                background: isNotice ? 'var(--color-accent-amber-bg)' : 'var(--color-error-bg)',
                border: `1px solid ${isNotice ? '#fde68a' : 'var(--color-error-border)'}`,
                padding: '12px 14px',
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
                marginBottom: 20,
              }}>
                <AlertCircle style={{ width: 16, height: 16, flexShrink: 0, color: isNotice ? 'var(--color-accent-amber)' : 'var(--color-error)', marginTop: 1 }} />
                <div>
                  <p style={{ fontSize: 12, fontWeight: 600, color: isNotice ? 'var(--color-accent-amber)' : 'var(--color-error)', margin: '0 0 2px' }}>
                    {isNotice ? 'Local Development Notice' : 'Authentication failed'}
                  </p>
                  <p style={{ fontSize: 12, color: isNotice ? '#92400e' : '#9f1239', margin: 0, lineHeight: 1.5 }}>{errorMsg}</p>
                </div>
              </div>
            );
          })()}

          {successMsg && (
            <div style={{
              borderRadius: 'var(--radius-md)',
              background: 'var(--color-success-bg)',
              border: '1px solid var(--color-primary-muted)',
              padding: '12px 14px',
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              marginBottom: 20,
            }}>
              <CheckCircle2 style={{ width: 16, height: 16, flexShrink: 0, color: 'var(--color-primary)', marginTop: 1 }} />
              <p style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-success)', margin: 0 }}>{successMsg}</p>
            </div>
          )}

          {/* Google Auth Section: Strict 3-state guard */}
          <GoogleAuthSection
            authMode={authMode}
            loading={loading}
            onGoogleSignIn={handleGoogleSignIn}
            isGoogleFlagEnabled={isGoogleFlagEnabled}
            isGoogleFullyConfigured={isGoogleFullyConfigured}
            isDev={isDev}
            missingReason={
              supabaseGoogleActive === false
                ? 'NEXT_PUBLIC_ENABLE_GOOGLE_AUTH=true, but Supabase /auth/v1/settings reports external.google=false.'
                : undefined
            }
            missingVars={missingGoogleVars}
          />

          {/* Sign In Form */}
          {authMode === 'signin' && (
            <form style={{ display: 'flex', flexDirection: 'column', gap: 16 }} onSubmit={handleLogin}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--color-ink-secondary)', marginBottom: 6 }}>
                  Merchant or Admin Email
                </label>
                <div style={{ position: 'relative' }}>
                  <Mail style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', width: 15, height: 15, color: 'var(--color-ink-tertiary)', pointerEvents: 'none' }} />
                  <input
                    id="login-email"
                    name="loginEmail"
                    data-testid="login-email"
                    aria-label="Authorized Email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@company.com"
                    className="input"
                    style={{ paddingLeft: 34 }}
                  />
                </div>
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <label htmlFor="login-password" style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-ink-secondary)' }}>
                    Password
                  </label>
                  <span style={{ fontSize: 11, color: 'var(--color-ink-tertiary)' }}>Min 6 characters</span>
                </div>
                <div style={{ position: 'relative' }}>
                  <Lock style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', width: 15, height: 15, color: 'var(--color-ink-tertiary)', pointerEvents: 'none' }} />
                  <input
                    id="login-password"
                    name="loginPassword"
                    data-testid="login-password"
                    aria-label="Password"
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••••"
                    className="input"
                    style={{ paddingLeft: 34 }}
                  />
                </div>
              </div>

              <button
                type="submit"
                data-testid="login-submit"
                disabled={loading}
                className="btn btn-primary"
                style={{ width: '100%', justifyContent: 'center', padding: '11px 20px', fontSize: 14 }}
              >
                {loading ? (
                  <>
                    <span style={{ width: 16, height: 16, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.6s linear infinite' }} />
                    Verifying...
                  </>
                ) : (
                  <>
                    Sign In to Workspace
                    <ArrowRight style={{ width: 15, height: 15 }} />
                  </>
                )}
              </button>
            </form>
          )}

          {/* Business Registration Form */}
          {authMode === 'register' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <form style={{ display: 'flex', flexDirection: 'column', gap: 14 }} onSubmit={handleRegister}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--color-ink-secondary)', marginBottom: 6 }}>
                    Administrator / Owner Full Name *
                  </label>
                  <div style={{ position: 'relative' }}>
                    <User style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', width: 15, height: 15, color: 'var(--color-ink-tertiary)', pointerEvents: 'none' }} />
                    <input
                      id="register-full-name"
                      name="registerFullName"
                      data-testid="register-full-name"
                      aria-label="Administrator Full Name"
                      type="text"
                      required
                      value={regFullName}
                      onChange={(e) => setRegFullName(e.target.value)}
                      placeholder="e.g. Dr. Rajesh Kumar"
                      className="input"
                      style={{ paddingLeft: 34 }}
                    />
                  </div>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--color-ink-secondary)', marginBottom: 6 }}>
                    Business or Hospital Email *
                  </label>
                  <div style={{ position: 'relative' }}>
                    <Mail style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', width: 15, height: 15, color: 'var(--color-ink-tertiary)', pointerEvents: 'none' }} />
                    <input
                      id="register-email"
                      name="registerEmail"
                      data-testid="register-email"
                      aria-label="Business Email"
                      type="email"
                      required
                      value={regEmail}
                      onChange={(e) => setRegEmail(e.target.value)}
                      placeholder="e.g. contact@cityhospital.com"
                      className="input"
                      style={{ paddingLeft: 34 }}
                    />
                  </div>
                </div>

                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <label htmlFor="register-password" style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-ink-secondary)' }}>
                      Create Password *
                    </label>
                    <span style={{ fontSize: 11, color: 'var(--color-ink-tertiary)' }}>Min 6 characters</span>
                  </div>
                  <div style={{ position: 'relative' }}>
                    <Lock style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', width: 15, height: 15, color: 'var(--color-ink-tertiary)', pointerEvents: 'none' }} />
                    <input
                      id="register-password"
                      name="registerPassword"
                      data-testid="register-password"
                      aria-label="Password"
                      type="password"
                      required
                      value={regPassword}
                      onChange={(e) => setRegPassword(e.target.value)}
                      placeholder="••••••••••"
                      className="input"
                      style={{ paddingLeft: 34 }}
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="register-confirm-password" style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--color-ink-secondary)', marginBottom: 6 }}>
                    Confirm Password *
                  </label>
                  <div style={{ position: 'relative' }}>
                    <Lock style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', width: 15, height: 15, color: 'var(--color-ink-tertiary)', pointerEvents: 'none' }} />
                    <input
                      id="register-confirm-password"
                      name="registerConfirmPassword"
                      data-testid="register-confirm-password"
                      aria-label="Confirm Password"
                      type="password"
                      required
                      value={regConfirmPassword}
                      onChange={(e) => setRegConfirmPassword(e.target.value)}
                      placeholder="••••••••••"
                      className="input"
                      style={{ paddingLeft: 34 }}
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  data-testid="register-submit"
                  disabled={loading}
                  className="btn btn-primary"
                  style={{ width: '100%', justifyContent: 'center', padding: '11px 20px', fontSize: 14, marginTop: 4 }}
                >
                  {loading ? (
                    <>
                      <span style={{ width: 16, height: 16, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.6s linear infinite' }} />
                      Registering Account...
                    </>
                  ) : (
                    <>
                      Create Account &amp; Proceed to Venue Setup
                      <ArrowRight style={{ width: 15, height: 15 }} />
                    </>
                  )}
                </button>
              </form>

              {/* Register Explanation */}
              <div style={{
                borderRadius: 'var(--radius-lg)',
                border: '1px solid var(--color-primary-muted)',
                background: 'var(--color-primary-light)',
                padding: '16px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
                  <Sparkles style={{ width: 15, height: 15, color: 'var(--color-primary)' }} />
                  <h4 style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-success)', textTransform: 'uppercase', letterSpacing: '0.07em', margin: 0 }}>
                    Two-Step Business Registration
                  </h4>
                </div>
                <ol style={{ listStyle: 'none', padding: 0, margin: '0 0 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {[
                    { n: 1, label: 'Step 1: Admin Account (Current Screen):', desc: 'Enter your name, email, and password in the form above and click Create Account.' },
                    { n: 2, label: 'Step 2: Venue Details & Storefront Photo (Next Screen):', desc: 'Enter your hospital/business name, contact, address, and upload your storefront picture.' },
                  ].map(({ n, label, desc }) => (
                    <li key={n} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                      <span style={{
                        flexShrink: 0,
                        width: 18,
                        height: 18,
                        borderRadius: '50%',
                        background: n === 1 ? 'var(--color-primary)' : 'var(--color-primary-muted)',
                        color: n === 1 ? '#fff' : 'var(--color-primary)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 10,
                        fontWeight: 700,
                        fontFamily: 'var(--font-mono)',
                      }}>{n}</span>
                      <div style={{ fontSize: 12, color: 'var(--color-ink-secondary)', lineHeight: 1.4 }}>
                        <strong style={{ color: 'var(--color-ink)', fontWeight: 600 }}>{label}</strong>{' '}{desc}
                      </div>
                    </li>
                  ))}
                </ol>
                <div style={{ borderTop: '1px solid var(--color-primary-muted)', paddingTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 12, color: 'var(--color-ink-tertiary)' }}>Already registered?</span>
                  <button
                    type="button"
                    onClick={() => { setAuthMode('signin'); setErrorMsg(null); }}
                    style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-primary)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                  >
                    Sign In →
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Trust Footer */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 24, paddingTop: 20, borderTop: '1px solid var(--color-border)' }}>
            <ShieldCheck style={{ width: 13, height: 13, color: 'var(--color-primary)' }} />
            <span style={{ fontSize: 11, color: 'var(--color-ink-tertiary)', fontFamily: 'var(--font-mono)' }}>
              RLS · Multi-Tenant Isolated · TLS
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
