'use client';

import React from 'react';

/**
 * GoogleAuthSection.ts
 *
 * Dedicated, isolated component for rendering Google OAuth options on auth screens.
 * Implements strict 3-state rendering:
 * 1. Default (Flag OFF): Completely empty (null), no button, no notice.
 * 2. Flag ON, but unconfigured/mismatch: In development, renders actionable dev notice. In production, null.
 * 3. Flag ON and fully configured: Renders Google auth button.
 */

export interface GoogleAuthSectionProps {
  authMode?: 'signin' | 'register';
  loading?: boolean;
  onGoogleSignIn?: () => void;
  isGoogleFlagEnabled: boolean;
  isGoogleFullyConfigured: boolean;
  isDev: boolean;
  missingReason?: string;
  missingVars?: string[];
}

export function GoogleAuthSection({
  authMode = 'signin',
  loading = false,
  onGoogleSignIn,
  isGoogleFlagEnabled,
  isGoogleFullyConfigured,
  isDev,
  missingReason,
  missingVars = [],
}: GoogleAuthSectionProps): React.ReactElement | null {
  // Case 1: Flag is OFF (Default: Google OFF in all environments).
  if (!isGoogleFlagEnabled) {
    return null;
  }

  // Case 2: Flag is ON, but NOT fully configured or Supabase provider mismatch.
  if (!isGoogleFullyConfigured) {
    // Never show dev notice or broken buttons in production.
    if (!isDev) {
      return null;
    }

    const reasonText =
      missingReason ||
      (missingVars.length > 0
        ? `Missing required variables: ${missingVars.join(', ')} in apps/merchant-web/.env.local or supabase/.env.`
        : 'NEXT_PUBLIC_ENABLE_GOOGLE_AUTH=true, but Supabase /auth/v1/settings reports external.google=false.');

    return React.createElement(
      'div',
      {
        'data-testid': 'local-dev-notice',
        style: {
          borderRadius: 'var(--radius-md, 8px)',
          background: 'var(--color-accent-amber-bg, #fffbeb)',
          border: '1px solid #fde68a',
          padding: '12px 14px',
          display: 'flex',
          alignItems: 'flex-start',
          gap: '10px',
          marginBottom: '20px',
        },
      },
      React.createElement(
        'div',
        null,
        React.createElement(
          'p',
          {
            style: {
              fontSize: '12px',
              fontWeight: 600,
              color: 'var(--color-accent-amber, #b45309)',
              margin: '0 0 2px',
            },
          },
          'Local Development Notice'
        ),
        React.createElement(
          'p',
          {
            style: {
              fontSize: '12px',
              color: '#92400e',
              margin: 0,
              lineHeight: 1.5,
            },
          },
          'Google OAuth is not configured in this environment: ',
          reasonText,
          ' Email and password authentication below is fully configured and operational.'
        )
      )
    );
  }

  // Case 3: Flag is ON and Google is FULLY CONFIGURED.
  return React.createElement(
    'div',
    {
      style: {
        background: 'var(--color-surface-raised, #f9fafb)',
        border: '1px solid var(--color-border, #e5e7eb)',
        borderRadius: 'var(--radius-lg, 12px)',
        padding: '20px',
        marginBottom: '24px',
        textAlign: 'center',
      },
    },
    React.createElement(
      'button',
      {
        'data-testid': 'google-auth-btn',
        type: 'button',
        onClick: onGoogleSignIn,
        disabled: loading,
        style: {
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '10px',
          padding: '10px 16px',
          background: '#ffffff',
          color: '#374151',
          border: '1px solid #d1d5db',
          borderRadius: 'var(--radius-md, 8px)',
          fontSize: '14px',
          fontWeight: 600,
          cursor: loading ? 'not-allowed' : 'pointer',
          opacity: loading ? 0.6 : 1,
          boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
        },
      },
      React.createElement(
        'svg',
        {
          width: '18',
          height: '18',
          viewBox: '0 0 24 24',
        },
        React.createElement('path', {
          fill: '#4285F4',
          d: 'M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z',
        }),
        React.createElement('path', {
          fill: '#34A853',
          d: 'M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z',
        }),
        React.createElement('path', {
          fill: '#FBBC05',
          d: 'M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z',
        }),
        React.createElement('path', {
          fill: '#EA4335',
          d: 'M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z',
        })
      ),
      authMode === 'register' ? 'Sign up with Google' : 'Sign in with Google'
    ),
    React.createElement(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          margin: '20px 0 0',
        },
      },
      React.createElement('div', {
        style: { flex: 1, height: '1px', background: 'var(--color-border, #e5e7eb)' },
      }),
      React.createElement(
        'span',
        {
          style: {
            padding: '0 12px',
            fontSize: '11px',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            color: 'var(--color-ink-tertiary, #9ca3af)',
            fontWeight: 600,
          },
        },
        'Or continue with email'
      ),
      React.createElement('div', {
        style: { flex: 1, height: '1px', background: 'var(--color-border, #e5e7eb)' },
      })
    )
  );
}
export default GoogleAuthSection;
