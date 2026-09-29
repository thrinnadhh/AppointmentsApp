import React from 'react';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import Navigation from '@/components/Navigation';
import { MerchantTenantProvider } from '@/contexts/MerchantTenantContext';

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Merchant Dashboard | Tirupati Appointments',
  description: 'Manage appointments, staff schedules, and deposit-backed bookings in Tirupati',
};

const FOOTER_LINKS = [
  { label: 'Privacy Policy',    href: '/privacy' },
  { label: 'Terms of Service',  href: '/terms' },
  { label: 'Refund Policy',     href: '/refund-policy' },
  { label: 'Grievance Officer', href: 'mailto:grievance@appointments4u.in' },
];

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`h-full ${inter.variable}`}>
      <body
        className="h-full flex flex-col antialiased selection:bg-emerald-600 selection:text-white"
        style={{ fontFamily: 'var(--font-inter, var(--font-sans))', background: 'var(--color-surface-raised)', color: 'var(--color-ink-secondary)' }}
      >
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-white focus:rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:shadow-lg text-sm font-semibold text-emerald-700"
        >
          Skip to main content
        </a>
        <MerchantTenantProvider>
          <Navigation />
          <main
            id="main-content"
            tabIndex={-1}
            className="flex-1 w-full mx-auto outline-none"
            style={{ maxWidth: '1280px', padding: '24px 32px', paddingBottom: '48px' }}
          >
            {children}
          </main>
        </MerchantTenantProvider>

        <footer className="bg-white border-t border-gray-200 py-5">
          <div className="max-w-screen-xl mx-auto px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="text-xs text-gray-400">
              © 2026 Appointments4u · Tirupati Hyperlocal Appointments Platform
            </p>
            <nav aria-label="Legal" className="flex items-center gap-5 flex-wrap justify-center">
              {FOOTER_LINKS.map(({ label, href }) => (
                <a
                  key={label}
                  href={href}
                  className="text-xs text-gray-400 hover:text-emerald-700 transition-colors"
                  style={{ textDecoration: 'none' }}
                >
                  {label}
                </a>
              ))}
            </nav>
          </div>
        </footer>
      </body>
    </html>
  );
}
