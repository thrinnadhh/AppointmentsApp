import Link from 'next/link';
import { ArrowLeft, Building2 } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="min-h-[70vh] flex flex-col items-center justify-center text-center px-4">
      <div className="w-12 h-12 rounded-2xl bg-emerald-100 text-emerald-800 flex items-center justify-center mb-4">
        <Building2 className="w-6 h-6" />
      </div>
      <span className="text-xs font-bold uppercase tracking-wider text-emerald-600 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full mb-2">
        404 • Page Not Found
      </span>
      <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 mt-2">
        Location or Route Not Found
      </h1>
      <p className="text-sm text-slate-500 max-w-md mt-2 mb-6">
        The merchant page, clinic directory, or resource unit you are looking for does not exist or has been moved.
      </p>
      <Link
        href="/"
        className="inline-flex items-center px-4 py-2 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition-colors shadow-xs"
      >
        <ArrowLeft className="w-4 h-4 mr-2" />
        Return to Overview
      </Link>
    </div>
  );
}
