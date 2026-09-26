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
          const userRole = session.user.user_metadata?.role;
          const isAdmin = userRole === 'admin' || userEmail.includes('admin');

          if (isAdmin) {
            setSuccessMsg('Session detected! Redirecting to Merchant Workspace...');
            const params = new URLSearchParams(window.location.search);
            const redirectPath = params.get('redirect') || '/';
            setTimeout(() => {
              window.location.href = redirectPath;
            }, 600);
            return;
          }

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
        const userRole = data.session.user.user_metadata?.role;
        const isAdmin = userRole === 'admin' || userEmail.includes('admin');

        if (isAdmin) {
          setSuccessMsg('Authentication successful. Redirecting to Merchant Hub...');
          const params = new URLSearchParams(window.location.search);
          const redirectPath = params.get('redirect') || '/';
          window.location.href = redirectPath;
          return;
        }

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
              Merchant &amp; Admin Portal
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
          {errorMsg && (
            <div style={{
              borderRadius: 'var(--radius-md)',
              background: 'var(--color-error-bg)',
              border: '1px solid var(--color-error-border)',
              padding: '12px 14px',
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              marginBottom: 20,
            }}>
              <AlertCircle style={{ width: 16, height: 16, flexShrink: 0, color: 'var(--color-error)', marginTop: 1 }} />
              <div>
                <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-error)', margin: '0 0 2px' }}>Authentication failed</p>
                <p style={{ fontSize: 12, color: '#9f1239', margin: 0, lineHeight: 1.5 }}>{errorMsg}</p>
              </div>
            </div>
          )}

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

          {/* Google Auth Section */}
          <div style={{
            background: 'var(--color-surface-raised)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-lg)',
            padding: '20px',
            textAlign: 'center',
            marginBottom: 20,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 8 }}>
              <ShieldCheck style={{ width: 14, height: 14, color: 'var(--color-primary)' }} />
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-ink)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                Google Verified Authentication
              </span>
            </div>
            <p style={{ fontSize: 12, color: 'var(--color-ink-tertiary)', lineHeight: 1.6, maxWidth: 300, margin: '0 auto 16px' }}>
              {authMode === 'register'
                ? 'Verify your business email via Google. After signing in, configure your shop profile in Step 2.'
                : 'Sign in with Google. Returning merchants enter their workspace directly.'}
            </p>
            <button
              type="button"
              data-testid="google-auth-btn"
              onClick={handleGoogleSignIn}
              disabled={loading}
              className="btn btn-secondary"
              style={{ width: '100%', justifyContent: 'center', padding: '11px 16px', fontSize: 14 }}
            >
              <svg style={{ width: 16, height: 16, flexShrink: 0 }} viewBox="0 0 24 24">
                <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z" />
                <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.35 24 12 24z" />
                <path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.99 0 12s.45 3.82 1.25 5.42l4.03-3.15z" />
                <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.35 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z" />
              </svg>
              {authMode === 'register' ? 'Register with Google' : 'Continue with Google'}
            </button>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 10, fontSize: 11, color: 'var(--color-ink-tertiary)' }}>
              <span>✓ Verified Email</span>
              <span style={{ opacity: 0.4 }}>·</span>
              <span>✓ Storefront Photo Sync</span>
              <span style={{ opacity: 0.4 }}>·</span>
              <span>✓ Secure Workspace</span>
            </div>

            {/* Divider */}
            <div style={{ position: 'relative', marginTop: 16 }}>
              <div style={{ borderTop: '1px solid var(--color-border)', position: 'absolute', left: 0, right: 0, top: '50%' }} />
              <span style={{
                position: 'relative',
                display: 'inline-block',
                padding: '0 10px',
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: 'var(--color-ink-tertiary)',
                background: 'var(--color-surface-raised)',
              }}>
                {authMode === 'signin' ? 'Or sign in with password' : 'How registration works'}
              </span>
            </div>
          </div>

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
                    placeholder="owner@tirupati-clinic.com"
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

          {/* Register Explanation */}
          {authMode === 'register' && (
            <div style={{
              borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--color-primary-muted)',
              background: 'var(--color-primary-light)',
              padding: '20px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 14 }}>
                <Sparkles style={{ width: 15, height: 15, color: 'var(--color-primary)' }} />
                <h4 style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-success)', textTransform: 'uppercase', letterSpacing: '0.07em', margin: 0 }}>
                  Two-Step Business Registration
                </h4>
              </div>
              <ol style={{ listStyle: 'none', padding: 0, margin: '0 0 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                {[
                  { n: 1, label: 'Verify Email with Google:', desc: 'Click "Register with Google" above to link your official business email address.' },
                  { n: 2, label: 'Shop Profile & Photo Setup:', desc: 'Enter your venue name, owner contact, address, and upload your storefront photo.' },
                ].map(({ n, label, desc }) => (
                  <li key={n} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <span style={{
                      flexShrink: 0,
                      width: 20,
                      height: 20,
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
                    <div style={{ fontSize: 13, color: 'var(--color-ink-secondary)', lineHeight: 1.5 }}>
                      <strong style={{ color: 'var(--color-ink)', fontWeight: 600 }}>{label}</strong>{' '}{desc}
                    </div>
                  </li>
                ))}
              </ol>
              <div style={{ borderTop: '1px solid var(--color-primary-muted)', paddingTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: 'var(--color-ink-tertiary)' }}>Already have an account?</span>
                <button
                  type="button"
                  onClick={() => setAuthMode('signin')}
                  style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-primary)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                >
                  Sign In →
                </button>
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
