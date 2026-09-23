import React from 'react';
import type { Metadata } from 'next';
import './globals.css';
import Navigation from '@/components/Navigation';
import { MerchantTenantProvider } from '@/contexts/MerchantTenantContext';

export const metadata: Metadata = {
  title: 'Merchant Dashboard | Tirupati Hyperlocal Appointments',
  description: 'Manage appointments, staff schedules, and deposit-backed bookings in Tirupati',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full bg-slate-50">
      <body className="h-full flex flex-col antialiased text-slate-900 selection:bg-emerald-500 selection:text-white">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-white focus:text-emerald-700 focus:font-semibold focus:shadow-lg focus:rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
        >
          Skip to main content
        </a>
        <MerchantTenantProvider>
          <Navigation />
          <main id="main-content" tabIndex={-1} className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 outline-none">
            {children}
          </main>
        </MerchantTenantProvider>
        <footer className="bg-white border-t border-slate-200 py-5 text-xs text-slate-500">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-3">
            <p>© 2026 Appointments4u · Tirupati Hyperlocal Appointments Platform</p>
            <nav aria-label="Legal" className="flex items-center gap-4 flex-wrap justify-center">
              <a href="/privacy" className="hover:text-emerald-700 transition-colors">Privacy Policy</a>
              <a href="/terms" className="hover:text-emerald-700 transition-colors">Terms of Service</a>
              <a href="/refund-policy" className="hover:text-emerald-700 transition-colors">Refund Policy</a>
              <a href="mailto:grievance@appointments4u.in" className="hover:text-emerald-700 transition-colors">Grievance Officer</a>
            </nav>
          </div>
        </footer>
      </body>
    </html>
  );
}
