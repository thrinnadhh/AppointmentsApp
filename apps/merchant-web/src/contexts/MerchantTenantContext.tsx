'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { Provider, Resource, MerchantMembership, VerticalConfig } from '@appointments/shared';
import { supabase, fetchTenantContextData } from '@/lib/supabase';
import { getVerticalConfig } from '@/lib/vertical-config';
import { INITIAL_MERCHANT_PROVIDER, SALON_MERCHANT_PROVIDER } from '@/lib/mock-data';

export interface MerchantTenantContextType {
  activeProvider: (Provider & { resources?: Resource[] }) | null;
  verticalConfig: VerticalConfig;
  memberships: MerchantMembership[];
  isSuperAdmin: boolean;
  isLocked: boolean; // True if merchant is locked to their single venue
  isLoading: boolean;
  error: string | null;
  switchActiveProvider: (providerId: string) => Promise<void>;
  refreshTenant: () => Promise<void>;
}

const defaultVerticalConfig = getVerticalConfig('clinics');

const MerchantTenantContext = createContext<MerchantTenantContextType>({
  activeProvider: INITIAL_MERCHANT_PROVIDER,
  verticalConfig: defaultVerticalConfig,
  memberships: [],
  isSuperAdmin: false,
  isLocked: true,
  isLoading: true,
  error: null,
  switchActiveProvider: async () => {},
  refreshTenant: async () => {},
});

export function MerchantTenantProvider({ children }: { children: React.ReactNode }) {
  const [activeProvider, setActiveProvider] = useState<(Provider & { resources?: Resource[] }) | null>(
    INITIAL_MERCHANT_PROVIDER
  );
  const [memberships, setMemberships] = useState<MerchantMembership[]>([]);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadTenant = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await fetchTenantContextData();
      setIsSuperAdmin(data.isSuperAdmin);
      setMemberships(data.memberships);

      if (data.activeProvider) {
        setActiveProvider(data.activeProvider);
      } else if (!data.isSuperAdmin) {
        // Fallback resolution for email-based demo credentials
        const email = data.user?.email || '';
        if (email.includes('naturals.salon') || email.includes('salon')) {
          setActiveProvider(SALON_MERCHANT_PROVIDER);
        } else {
          setActiveProvider(INITIAL_MERCHANT_PROVIDER);
        }
      }
    } catch (err: unknown) {
      console.warn('Error loading merchant tenant:', err);
      setError('Unable to load tenant profile, falling back to local workspace');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTenant();

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        loadTenant();
      } else {
        // Logged out
        setIsSuperAdmin(false);
        setMemberships([]);
        setActiveProvider(INITIAL_MERCHANT_PROVIDER);
        setIsLoading(false);
      }
    });

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, [loadTenant]);

  const switchActiveProvider = async (providerId: string) => {
    // Only allow switching if user is super admin or is member/owner of that provider
    const hasMembership = memberships.some((m) => m.provider_id === providerId);
    if (!isSuperAdmin && !hasMembership && activeProvider?.id !== providerId) {
      console.warn('Unauthorized provider switch attempt blocked');
      return;
    }

    try {
      const { data, error: provError } = await supabase
        .from('providers')
        .select('*, resources(*)')
        .eq('id', providerId)
        .single();

      if (!provError && data) {
        setActiveProvider(data as unknown as (Provider & { resources?: Resource[] }));
      } else if (providerId === SALON_MERCHANT_PROVIDER.id) {
        setActiveProvider(SALON_MERCHANT_PROVIDER);
      } else {
        setActiveProvider(INITIAL_MERCHANT_PROVIDER);
      }
    } catch (err) {
      console.warn('Failed to switch provider:', err);
    }
  };

  const verticalConfig = getVerticalConfig(activeProvider?.category_id);
  // A merchant is locked to their space unless they own multiple venues or are Super Admin
  const isLocked = !isSuperAdmin && memberships.length <= 1;

  return (
    <MerchantTenantContext.Provider
      value={{
        activeProvider,
        verticalConfig,
        memberships,
        isSuperAdmin,
        isLocked,
        isLoading,
        error,
        switchActiveProvider,
        refreshTenant: loadTenant,
      }}
    >
      {children}
    </MerchantTenantContext.Provider>
  );
}

export function useMerchantTenant() {
  const context = useContext(MerchantTenantContext);
  if (!context) {
    throw new Error('useMerchantTenant must be used within a MerchantTenantProvider');
  }
  return context;
}
