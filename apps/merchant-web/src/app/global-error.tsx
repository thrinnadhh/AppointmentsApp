'use client';

import React, { useEffect } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { webLogger } from '@/lib/logger';

export default function RootGlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    webLogger.forComponent('RootGlobalError').error(
      error.message || 'Fatal root layout crash',
      error,
      { digest: error.digest }
    );
  }, [error]);

  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 flex items-center justify-center p-4 font-sans text-slate-800">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-sm text-center">
          <div className="w-12 h-12 rounded-2xl bg-rose-100 text-rose-700 mx-auto flex items-center justify-center mb-4">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <span className="text-xs font-bold uppercase tracking-wider text-rose-600 bg-rose-50 border border-rose-200 px-2.5 py-1 rounded-full">
            System Error
          </span>
          <h1 className="text-2xl font-bold text-slate-900 mt-3">
            Critical Platform Exception
          </h1>
          <p className="text-sm text-slate-500 mt-2 mb-6">
            An unexpected error interrupted the application lifecycle. Our technical administrators have been alerted.
          </p>
          <button
            onClick={() => reset()}
            className="w-full inline-flex items-center justify-center px-4 py-2.5 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition-colors shadow-xs"
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Reload Platform
          </button>
          {error.digest && (
            <p className="text-xs text-slate-400 mt-4 font-mono">
              Diagnostic ID: {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
