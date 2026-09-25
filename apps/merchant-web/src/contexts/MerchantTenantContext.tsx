'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { Provider, Resource, MerchantMembership, VerticalConfig } from '@appointments/shared';
import { supabase, fetchTenantContextData } from '@/lib/supabase';
import { getVerticalConfig } from '@/lib/vertical-config';

export interface MerchantTenantContextType {
  activeProvider: (Provider & { resources?: Resource[] }) | null;
  verticalConfig: VerticalConfig;
  memberships: MerchantMembership[];
  isSuperAdmin: boolean;
  isLocked: boolean; // True if merchant is locked to their single venue
  isLoading: boolean;
  isAuthenticated: boolean;
  error: string | null;
  switchActiveProvider: (providerId: string) => Promise<void>;
  refreshTenant: () => Promise<void>;
}

const defaultVerticalConfig = getVerticalConfig('clinics');

const MerchantTenantContext = createContext<MerchantTenantContextType>({
  activeProvider: null,
  verticalConfig: defaultVerticalConfig,
  memberships: [],
  isSuperAdmin: false,
  isLocked: true,
  isLoading: true,
  isAuthenticated: false,
  error: null,
  switchActiveProvider: async () => {},
  refreshTenant: async () => {},
});

export function MerchantTenantProvider({ children }: { children: React.ReactNode }) {
  const [activeProvider, setActiveProvider] = useState<(Provider & { resources?: Resource[] }) | null>(null);
  const [memberships, setMemberships] = useState<MerchantMembership[]>([]);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadTenant = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await fetchTenantContextData();
      setIsSuperAdmin(data.isSuperAdmin);
      setMemberships(data.memberships);
      setIsAuthenticated(Boolean(data.user));

      if (data.activeProvider) {
        setActiveProvider(data.activeProvider);
      } else {
        setActiveProvider(null);
      }
    } catch (err: unknown) {
      console.warn('Error loading merchant tenant:', err);
      setError('Unable to load tenant profile');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTenant();

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setIsAuthenticated(true);
        loadTenant();
      } else {
        // Logged out
        setIsAuthenticated(false);
        setIsSuperAdmin(false);
        setMemberships([]);
        setActiveProvider(null);
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
      } else {
        console.warn('Provider not found or error loading provider:', provError);
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
        isAuthenticated,
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
