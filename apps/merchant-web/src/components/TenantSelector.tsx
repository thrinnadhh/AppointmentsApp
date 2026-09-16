'use client';

import React, { useEffect, useState } from 'react';
import { Building2, ShieldCheck, ChevronDown, Check } from 'lucide-react';
import { useMerchantTenant } from '@/contexts/MerchantTenantContext';
import { fetchAllProviders, Provider } from '@/lib/supabase';

export function TenantSelector() {
  const { activeProvider, isSuperAdmin, isLocked, memberships, switchActiveProvider, verticalConfig } = useMerchantTenant();
  const [availableProviders, setAvailableProviders] = useState<Provider[]>([]);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    async function loadOptions() {
      if (isSuperAdmin) {
        // Super admin can select any provider across Tirupati
        const all = await fetchAllProviders();
        setAvailableProviders(all);
      } else if (memberships.length > 1) {
        // Multi-branch merchant: list only their authorized venues
        const owned = memberships
          .map((m) => m.provider)
          .filter(Boolean) as Provider[];
        setAvailableProviders(owned);
      } else if (activeProvider) {
        setAvailableProviders([activeProvider]);
      }
    }
    loadOptions();
  }, [isSuperAdmin, memberships, activeProvider]);

  // If single-venue merchant (locked space)
  if (isLocked || availableProviders.length <= 1) {
    return (
      <div 
        data-testid="locked-tenant-badge"
        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-50/80 border border-emerald-200/80 text-xs font-semibold text-emerald-900"
      >
        <Building2 className="w-4 h-4 text-emerald-600" />
        <span className="font-bold">{activeProvider?.name || 'Authorized Venue'}</span>
        <span className="text-[10px] bg-white px-1.5 py-0.5 rounded text-emerald-700 border border-emerald-200">
          {verticalConfig.badgeLabel}
        </span>
        <span className="text-[10px] text-slate-500 ml-1 font-normal">(Dedicated Space)</span>
      </div>
    );
  }

  return (
    <div className="relative inline-block text-left">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-white border border-slate-300 hover:border-emerald-500 shadow-xs text-xs font-semibold text-slate-800 transition-colors"
      >
        <Building2 className="w-4 h-4 text-emerald-600" />
        <span>{activeProvider?.name || 'Select Venue'}</span>
        <span className="text-[10px] bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded font-bold">
          {isSuperAdmin ? 'Admin Lens' : 'Branch'}
        </span>
        <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setIsOpen(false)} />
          <div className="absolute left-0 mt-1.5 w-72 rounded-xl bg-white border border-slate-200 shadow-lg z-30 py-1.5 divide-y divide-slate-100 animate-in fade-in zoom-in-95 duration-100">
            <div className="px-3 py-1.5 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
              {isSuperAdmin ? 'Platform Venues (Admin Oversight)' : 'Your Authorized Branches'}
            </div>
            <div className="max-h-60 overflow-y-auto py-1">
              {availableProviders.map((p) => {
                const isSelected = p.id === activeProvider?.id;
                return (
                  <button
                    key={p.id}
                    onClick={() => {
                      switchActiveProvider(p.id);
                      setIsOpen(false);
                    }}
                    className={`w-full text-left px-3 py-2 flex items-center justify-between hover:bg-emerald-50/60 transition-colors text-xs ${
                      isSelected ? 'bg-emerald-50 font-bold text-emerald-900' : 'text-slate-700'
                    }`}
                  >
                    <div>
                      <p className="font-semibold leading-snug">{p.name}</p>
                      <p className="text-[11px] text-slate-400 capitalize">{p.category_id} • {p.city}</p>
                    </div>
                    {isSelected && <Check className="w-4 h-4 text-emerald-600" />}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
