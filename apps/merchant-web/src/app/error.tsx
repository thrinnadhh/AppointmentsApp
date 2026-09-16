'use client';

import React from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowLeft, RefreshCw } from 'lucide-react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-[70vh] flex flex-col items-center justify-center text-center px-4">
      <div className="w-12 h-12 rounded-2xl bg-rose-100 text-rose-700 flex items-center justify-center mb-4">
        <AlertTriangle className="w-6 h-6" />
      </div>
      <span className="text-xs font-bold uppercase tracking-wider text-rose-600 bg-rose-50 border border-rose-200 px-2.5 py-1 rounded-full mb-2">
        Application Error
      </span>
      <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 mt-2">
        Something went wrong
      </h1>
      <p className="text-sm text-slate-500 max-w-md mt-2 mb-6">
        {error.message || 'An unexpected error occurred while loading this page.'}
      </p>
      <div className="flex items-center gap-3">
        <button
          onClick={reset}
          className="inline-flex items-center px-4 py-2 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition-colors shadow-xs"
        >
          <RefreshCw className="w-4 h-4 mr-2" />
          Try Again
        </button>
        <Link
          href="/"
          className="inline-flex items-center px-4 py-2 text-sm font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Overview
        </Link>
      </div>
      {error.digest && (
        <p className="text-xs text-slate-400 mt-6 font-mono">
          Error digest: {error.digest}
        </p>
      )}
    </div>
  );
}
