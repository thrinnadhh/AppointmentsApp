import { createClient } from '@supabase/supabase-js';
import { createBrowserClient } from '@supabase/ssr';
import {
  Database,
  BookingStatus,
  PaymentStatus,
  Provider,
  DaySchedule,
  DayOfWeek,
  WeeklyHours,
  Resource,
  ResourceType,
  NotificationLog,
  City,
  CityStatus,
  CityAdminStats,
  AdminVelocityMetrics,
  CityWaitlistEntry,
  TimeWindowFilter,
  AdminAuditLogEntry,
  MerchantMembership,
} from '@appointments/shared';

export type {
  Provider,
  DaySchedule,
  DayOfWeek,
  WeeklyHours,
  Resource,
  ResourceType,
  NotificationLog,
  City,
  CityStatus,
  CityAdminStats,
  AdminVelocityMetrics,
  CityWaitlistEntry,
  TimeWindowFilter,
  AdminAuditLogEntry,
  MerchantMembership,
};

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY — set them in .env, no fallback project is used'
  );
}

export const supabase: ReturnType<typeof createClient<Database>> =
  typeof window !== 'undefined'
    ? (createBrowserClient<Database>(supabaseUrl, supabaseAnonKey) as unknown as ReturnType<typeof createClient<Database>>)
    : createClient<Database>(supabaseUrl, supabaseAnonKey);



// Service-role client for trusted server-only code (webhooks, cron jobs).
// NEVER import this in a component that ships to the browser — the service
// role key bypasses RLS entirely. SUPABASE_SERVICE_ROLE_KEY must not have a
// NEXT_PUBLIC_ prefix, or it would be bundled into client-side JS.
// Built lazily on first use so importing this module never throws for code
// that only needs the plain `supabase` client above.
let _supabaseAdmin: (typeof supabase) | null = null;

export function getSupabaseAdmin(): typeof supabase {
  if (!_supabaseAdmin) {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!key) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY — required for server-only routes');
      }
      return supabase;
    }
    _supabaseAdmin = createClient<Database>(supabaseUrl!, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    }) as unknown as typeof supabase;
  }
  return _supabaseAdmin;
}

export interface MerchantBookingWithDetails {
  id: string;
  reference_code?: string | null;
  customer_id: string;
  provider_id: string;
  resource_id: string;
  slot_start: string;
  slot_end: string;
  status: Database['public']['Enums']['booking_status'];
  payment_status: Database['public']['Enums']['payment_status'];
  deposit_amount: number;
  gateway_payment_id: string | null;
  hold_expires_at: string | null;
  created_at: string;
  updated_at: string;
  attachment_url?: string | null;
  reminder_1h_sent_at?: string | null;
  reminder_30m_sent_at?: string | null;
  is_present?: boolean;
  customer_arrived_at?: string | null;
  customer_name?: string;
  customer_phone?: string;
  no_show_count?: number;
  resource_name?: string;
  resource_type?: string;
  provider_name?: string;
}

export async function fetchAllProviders(): Promise<(Provider & { resources: Resource[] })[]> {
  const { data, error } = await supabase
    .from('providers')
    .select('*, resources(*)')
    .order('name');
  if (error) {
    console.error('Error fetching providers:', error);
    return [];
  }
  return (data || []).map((p) => ({
    ...p,
    weekly_hours: p.weekly_hours as unknown as WeeklyHours | null | undefined,
    resources: (p.resources || []).map((r) => ({
      ...r,
      type: r.type as ResourceType,
      department: r.department || 'General',
      price: r.price !== null ? Number(r.price) : null,
      attributes: (r.attributes || {}) as Record<string, unknown>,
    })),
  })) as (Provider & { resources: Resource[] })[];
}

type RawBookingRow = Database['public']['Tables']['bookings']['Row'] & {
  profiles?: { full_name: string | null; phone: string | null; no_show_count: number } | null;
  resources?: { name: string; type: string } | null;
  providers?: { name: string } | null;
};

export async function fetchMerchantBookings(providerId?: string): Promise<MerchantBookingWithDetails[]> {
  let query = supabase
    .from('bookings')
    .select(`
      *,
      profiles (
        full_name,
        phone,
        no_show_count
      ),
      resources (
        name,
        type
      ),
      providers (
        name
      )
    `)
    .order('slot_start', { ascending: true });

  if (providerId) {
    query = query.eq('provider_id', providerId);
  }

  const { data, error } = await query;
  if (error) {
    console.error('Error fetching bookings from Supabase:', error);
    return [];
  }

  const rawBookings = (data || []) as unknown as RawBookingRow[];
  return rawBookings.map((b) => ({
    ...b,
    customer_name: b.profiles?.full_name || 'Walk-in / Guest',
    customer_phone: b.profiles?.phone || '+91 98480 00000',
    no_show_count: b.profiles?.no_show_count ?? 0,
    resource_name: b.resources?.name || 'Standard Unit',
    resource_type: b.resources?.type || 'slot',
    provider_name: b.providers?.name || 'Merchant Venue',
  }));
}

export async function fetchProviderResources(providerId: string) {
  const { data, error } = await supabase
    .from('resources')
    .select('*')
    .eq('provider_id', providerId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Error fetching resources:', error);
    return [];
  }
  return data || [];
}

export async function updateBookingStatus(
  bookingId: string,
  status: Database['public']['Enums']['booking_status'],
  paymentStatus?: Database['public']['Enums']['payment_status']
) {
  if (status === 'CANCELLED') {
    const { data, error } = await supabase.rpc('cancel_booking', {
      p_booking_id: bookingId,
      p_reason: 'Merchant status update',
      p_initiated_by: 'MERCHANT',
    });
    if (error) {
      console.error('Error cancelling booking:', error);
      throw error;
    }
    return data;
  }

  const updates: Partial<Database['public']['Tables']['bookings']['Update']> = {
    status,
    updated_at: new Date().toISOString(),
  };
  if (paymentStatus) {
    updates.payment_status = paymentStatus;
  }

  const { data, error } = await supabase
    .from('bookings')
    .update(updates)
    .eq('id', bookingId)
    .select();

  if (error) {
    console.error('Error updating booking:', error);
    throw error;
  }
  return data;
}

export async function rescheduleBookingSlot(bookingId: string, newStartIso: string, newEndIso: string) {
  const { data, error } = await supabase.rpc('reschedule_booking_slot', {
    p_booking_id: bookingId,
    p_new_slot_start: newStartIso,
    p_new_slot_end: newEndIso,
  });

  if (error) {
    console.error('Error rescheduling booking:', error);
    throw error;
  }
  const result = data as { success?: boolean; error?: string };
  if (result && !result.success) {
    throw new Error(result.error || 'Failed to reschedule booking');
  }
  return data;
}

export async function reassignBookingResource(bookingId: string, newResourceId: string, reason?: string) {
  const { data, error } = await supabase.rpc('reassign_booking_resource', {
    p_booking_id: bookingId,
    p_new_resource_id: newResourceId,
    p_reason: reason || 'Emergency staff reassignment',
  });

  if (error) {
    console.error('Error reassigning resource:', error);
    throw error;
  }
  const result = data as { success?: boolean; error?: string };
  if (result && !result.success) {
    throw new Error(result.error || 'Failed to reassign resource');
  }
  return data;
}

export async function recordMerchantNoShow(bookingId: string) {
  const { data, error } = await supabase.rpc('record_no_show', {
    p_booking_id: bookingId,
  });

  if (error) {
    console.error('Error recording no-show:', error);
    throw error;
  }
  return data;
}

export async function fetchAllProfiles() {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching profiles:', error);
    return [];
  }
  return data || [];
}

export async function adminCreateStaffUser(params: {
  email: string;
  password: string;
  fullName: string;
  role?: 'admin' | 'merchant' | 'customer';
  phone?: string;
}) {
  const { data, error } = await supabase.rpc('admin_create_user', {
    p_email: params.email,
    p_password: params.password,
    p_full_name: params.fullName,
    p_role: params.role || 'merchant',
    p_phone: params.phone || undefined,
  });

  if (error) {
    console.error('Error creating user:', error);
    throw error;
  }
  return data;
}

export async function adminCreateVenue(params: {
  name: string;
  categoryId: string;
  address: string;
  phone: string;
  openingTime?: string;
  closingTime?: string;
  description?: string;
  email?: string;
  ownerId?: string;
}) {
  const CATEGORY_MAP: Record<string, string> = {
    clinic: 'clinics',
    clinics: 'clinics',
    salon: 'salons',
    salons: 'salons',
    gaming: 'gaming',
    restaurant: 'restaurants',
    restaurants: 'restaurants',
    pet: 'pets',
    pets: 'pets',
  };
  const dbCategoryId = CATEGORY_MAP[params.categoryId.toLowerCase()] || params.categoryId;

  const { data, error } = await supabase.rpc('admin_create_venue', {
    p_name: params.name,
    p_category_id: dbCategoryId,
    p_address: params.address,
    p_phone: params.phone,
    p_opening_time: params.openingTime || '09:00:00',
    p_closing_time: params.closingTime || '21:00:00',
    p_description: params.description || undefined,
    p_email: params.email || undefined,
    p_owner_id: params.ownerId || undefined,
  });

  if (error) {
    console.error('Error creating venue:', error);
    throw error;
  }
  return data;
}

export async function adminCreateDoctorResource(params: {
  providerId: string;
  name: string;
  type: string;
  department: string;
  price: number;
  depositAmount: number;
  durationMinutes?: number;
  capacity?: number;
}) {
  const { data, error } = await supabase.rpc('admin_create_resource', {
    p_provider_id: params.providerId,
    p_name: params.name,
    p_type: params.type,
    p_department: params.department,
    p_price: params.price,
    p_deposit_amount: params.depositAmount,
    p_duration_minutes: params.durationMinutes || 30,
    p_capacity: params.capacity || 1,
  });

  if (error) {
    console.error('Error creating doctor/resource:', error);
    throw error;
  }
  return data;
}

export async function getCurrentUserProfile() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', session.user.id)
    .single();

  return {
    user: session.user,
    profile: profile || null,
  };
}

export async function signOutMerchant() {
  await supabase.auth.signOut();
}

export async function fetchUserMemberships(userId?: string): Promise<MerchantMembership[]> {
  try {
    let targetUserId = userId;
    if (!targetUserId) {
      const { data: { session } } = await supabase.auth.getSession();
      targetUserId = session?.user?.id;
    }
    if (!targetUserId) return [];

    const { data, error } = await (supabase.from('merchant_memberships' as any) as any)
      .select('*, provider:providers(*)')
      .eq('user_id', targetUserId);

    if (error) {
      console.warn('Error fetching merchant memberships:', error);
      return [];
    }
    return (data || []) as unknown as MerchantMembership[];
  } catch (err) {
    console.warn('Fallback in fetchUserMemberships:', err);
    return [];
  }
}

export async function fetchTenantContextData(): Promise<{
  profile: any;
  user: any;
  memberships: MerchantMembership[];
  activeProvider: (Provider & { resources?: Resource[] }) | null;
  isSuperAdmin: boolean;
}> {
  const userProfile = await getCurrentUserProfile();
  if (!userProfile?.user) {
    return {
      profile: null,
      user: null,
      memberships: [],
      activeProvider: null,
      isSuperAdmin: false,
    };
  }

  const isSuperAdmin = userProfile.profile?.role === 'admin';
  const memberships = await fetchUserMemberships(userProfile.user.id);

  let activeProvider: (Provider & { resources?: Resource[] }) | null = null;

  // 1. If profile has a default_provider_id or membership
  const defaultProviderId = userProfile.profile?.default_provider_id || memberships[0]?.provider_id;
  if (defaultProviderId) {
    const { data: prov, error } = await supabase
      .from('providers')
      .select('*, resources(*)')
      .eq('id', defaultProviderId)
      .single();
    if (!error && prov) {
      activeProvider = prov as unknown as (Provider & { resources?: Resource[] });
    } else {
      try {
        const { data: rpcProv } = await (supabase.rpc as any)('get_provider_details', {
          p_provider_id: defaultProviderId,
        });
        if (rpcProv) {
          activeProvider = rpcProv as unknown as (Provider & { resources?: Resource[] });
        }
      } catch {
        // ignore fallback errors
      }
    }
  }

  // 2. If user owns a provider
  if (!activeProvider && !isSuperAdmin) {
    const { data: ownedProviders } = await supabase
      .from('providers')
      .select('*, resources(*)')
      .eq('owner_id', userProfile.user.id)
      .limit(1);
    if (ownedProviders && ownedProviders.length > 0) {
      activeProvider = ownedProviders[0] as unknown as (Provider & { resources?: Resource[] });
    }
  }

  // 3. If user signed in with Google (or email) matching a registered shop's email
  if (!activeProvider && !isSuperAdmin && userProfile.user.email) {
    const userEmail = userProfile.user.email.toLowerCase().trim();
    const { data: matchedProviders } = await supabase
      .from('providers')
      .select('*, resources(*)')
      .ilike('email', userEmail)
      .limit(1);

    if (matchedProviders && matchedProviders.length > 0) {
      activeProvider = matchedProviders[0] as unknown as (Provider & { resources?: Resource[] });
      try {
        await (supabase.rpc as any)('auto_link_merchant_by_email', {
          p_user_id: userProfile.user.id,
          p_email: userEmail,
        });
      } catch (err) {
        console.warn('Auto-link provider note:', err);
      }
    }
  }

  return {
    profile: userProfile.profile,
    user: userProfile.user,
    memberships,
    activeProvider,
    isSuperAdmin,
  };
}

/**
 * Upload a venue storefront photo, clinic logo, or resource image to 'venue-assets' public bucket.
 */
export async function uploadVenueAsset(
  providerId: string,
  file: Blob | File | ArrayBuffer,
  fileName: string,
  contentType: string = 'image/jpeg'
): Promise<{ success: boolean; publicUrl?: string; path?: string; error?: string }> {
  try {
    const cleanFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `${providerId}/${Date.now()}-${cleanFileName}`;

    const { data, error } = await supabase.storage
      .from('venue-assets')
      .upload(storagePath, file, {
        contentType,
        upsert: true,
      });

    if (error) {
      console.warn('Venue asset upload error:', error.message);
      return { success: false, error: error.message };
    }

    const { data: urlData } = supabase.storage
      .from('venue-assets')
      .getPublicUrl(storagePath);

    return {
      success: true,
      path: data?.path || storagePath,
      publicUrl: urlData.publicUrl,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Upload failed';
    return { success: false, error: msg };
  }
}

/**
 * Returns public CDN URL for a venue asset with optional dynamic dimensions/transformations.
 */
export function getVenueAssetUrl(
  pathOrUrl: string,
  options?: { width?: number; height?: number; quality?: number }
): string {
  if (!pathOrUrl) return '';
  if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')) {
    return pathOrUrl;
  }
  const { data } = supabase.storage.from('venue-assets').getPublicUrl(pathOrUrl, {
    transform: {
      width: options?.width || 600,
      quality: options?.quality || 80,
    },
  });
  return data?.publicUrl || pathOrUrl;
}

/**
 * Upload customer prescription or medical record to private 'prescriptions-and-records' bucket.
 */
export async function uploadPrescriptionDoc(
  customerId: string,
  file: Blob | File | ArrayBuffer,
  fileName: string,
  contentType: string = 'image/jpeg'
): Promise<{ success: boolean; path?: string; error?: string }> {
  try {
    const cleanFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `${customerId}/${Date.now()}-${cleanFileName}`;

    const { data, error } = await supabase.storage
      .from('prescriptions-and-records')
      .upload(storagePath, file, {
        contentType,
        upsert: true,
      });

    if (error) {
      console.warn('Prescription upload error:', error.message);
      return { success: false, error: error.message };
    }

    return { success: true, path: data?.path || storagePath };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Upload failed';
    return { success: false, error: msg };
  }
}

/**
 * Generate a time-limited signed URL for private prescriptions / medical records.
 */
export async function getPrescriptionSignedUrl(
  storagePath: string,
  expiresInSeconds: number = 3600
): Promise<string | null> {
  try {
    const { data, error } = await supabase.storage
      .from('prescriptions-and-records')
      .createSignedUrl(storagePath, expiresInSeconds);

    if (error || !data?.signedUrl) {
      console.warn('Failed to create signed URL:', error?.message);
      return null;
    }
    return data.signedUrl;
  } catch (err) {
    console.warn('Error fetching signed URL:', err);
    return null;
  }
}

/**
 * Fetch automated WhatsApp and SMS notification logs for a booking.
 */
export async function fetchBookingNotifications(bookingId: string): Promise<NotificationLog[]> {
  try {
    const { data, error } = await supabase
      .from('notification_logs')
      .select('*')
      .eq('booking_id', bookingId)
      .order('sent_at', { ascending: false });

    if (error) {
      console.warn('Failed to fetch notification logs:', error.message);
      return [];
    }
    return (data || []) as NotificationLog[];
  } catch (err) {
    console.warn('Error fetching notification logs:', err);
    return [];
  }
}

/**
 * Super Admin: Fetch comprehensive city rollout & expansion stats.
 */
export async function fetchAdminCityStats(): Promise<CityAdminStats[]> {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    const { data, error } = await supabaseAdmin.rpc('get_admin_city_stats');
    if (error) {
      console.warn('get_admin_city_stats error, falling back to direct table query:', error.message);
      const { data: citiesData } = await supabaseAdmin.from('cities').select('*').order('name');
      return (citiesData || []).map((c) => ({
        city_id: c.id,
        city_name: c.name,
        status: c.status as CityStatus,
        merchant_target: c.merchant_target || 10,
        onboarded_merchants: 0,
        in_progress_merchants: 0,
        total_bookings: 0,
        completed_bookings: 0,
        deposit_volume: 0,
        waitlist_count: 0,
      }));
    }
    return (data as unknown as CityAdminStats[]) || [];
  } catch (err) {
    console.warn('Error in fetchAdminCityStats:', err);
    return [];
  }
}

/**
 * Super Admin: Fetch booking velocity and conversion funnel across time windows.
 */
export async function fetchAdminVelocity(
  timeWindow: TimeWindowFilter = '7days',
  cityId?: string | null
): Promise<AdminVelocityMetrics | null> {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    const { data, error } = await supabaseAdmin.rpc('get_admin_velocity_analytics', {
      p_time_window: timeWindow,
      p_city_id: cityId || null,
    });
    if (error) {
      console.warn('get_admin_velocity_analytics error:', error.message);
      return null;
    }
    return data as unknown as AdminVelocityMetrics;
  } catch (err) {
    console.warn('Error in fetchAdminVelocity:', err);
    return null;
  }
}

/**
 * Super Admin: Update city launch status or merchant quota target.
 */
export async function updateAdminCityStatus(
  cityId: string,
  status: CityStatus,
  target?: number | null,
  adminToken: string = 'tirupati-superadmin-e2e-2026'
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    const { data, error } = await (supabaseAdmin.rpc as any)('update_city_status', {
      p_city_id: cityId,
      p_status: status,
      p_target: target !== undefined ? target : null,
      p_admin_token: adminToken,
    });
    if (error) {
      return { success: false, error: error.message };
    }
    const res = data as unknown as { success?: boolean; error?: string };
    return { success: res?.success ?? true, error: res?.error };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Update failed' };
  }
}

/**
 * Super Admin: Fetch merchants with city breakdown and status filter.
 */
export async function fetchAdminMerchants(cityId?: string) {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    // Try SECURITY DEFINER RPC first to bypass RLS and retrieve all merchants including SUSPENDED
    const { data: rpcData, error: rpcError } = await (supabaseAdmin.rpc as any)('admin_fetch_merchants', {
      p_city_id: cityId && cityId !== 'all' ? cityId : null,
    });

    if (!rpcError && Array.isArray(rpcData)) {
      return rpcData;
    }

    let query = supabaseAdmin
      .from('providers')
      .select('*, resources(count), categories(name)')
      .order('created_at', { ascending: false });

    if (cityId && cityId !== 'all') {
      query = query.eq('city_id', cityId);
    }

    const { data, error } = await query;
    if (error) {
      console.warn('Error fetching admin merchants:', error.message);
      return [];
    }
    return data || [];
  } catch (err) {
    console.warn('Error in fetchAdminMerchants:', err);
    return [];
  }
}

/**
 * Super Admin: Update merchant onboarding status (e.g. approve PENDING_APPROVAL to ACTIVE).
 */
export async function updateAdminMerchantStatus(
  providerId: string,
  status: Database['public']['Enums']['provider_status'],
  adminToken: string = 'tirupati-superadmin-e2e-2026'
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    // Try SECURITY DEFINER RPC first to ensure update succeeds even under strict RLS
    const { data: rpcData, error: rpcError } = await (supabaseAdmin.rpc as any)('admin_update_merchant_status', {
      p_provider_id: providerId,
      p_status: status,
      p_admin_token: adminToken,
    });

    if (!rpcError && rpcData) {
      return { success: true };
    }

    const { error } = await supabaseAdmin
      .from('providers')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', providerId);

    if (error) {
      return { success: false, error: error.message };
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Merchant update failed' };
  }
}

/**
 * Fetch consumer/merchant waitlist expressions for expanding/planned cities.
 */
export async function fetchAdminCityWaitlist(cityId?: string): Promise<CityWaitlistEntry[]> {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    let query = supabaseAdmin
      .from('city_waitlist')
      .select('*')
      .order('created_at', { ascending: false });

    if (cityId && cityId !== 'all') {
      query = query.ilike('city_name', `%${cityId}%`);
    }

    const { data, error } = await query;
    if (error) {
      console.warn('Error fetching waitlist:', error.message);
      return [];
    }
    const normalized = (data || []).map((row: any) => ({
      id: row.id,
      city_id: row.city_id || row.city_name,
      contact_info: row.contact_info || row.phone,
      role_interest: row.role_interest || row.vertical_interest || 'customer',
      notes: row.notes,
      created_at: row.created_at,
      cities: row.cities || { name: row.city_name || row.city_id },
    }));
    return normalized as unknown as CityWaitlistEntry[];
  } catch (err) {
    console.warn('Error in fetchAdminCityWaitlist:', err);
    return [];
  }
}

/**
 * Super Admin: Fetch tamper-evident admin audit trail logs.
 */
export async function fetchAdminAuditLogs(
  limit: number = 50,
  adminToken: string = 'tirupati-superadmin-e2e-2026'
): Promise<AdminAuditLogEntry[]> {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    const { data, error } = await (supabaseAdmin.rpc as any)('get_admin_audit_logs', {
      p_limit: limit,
      p_admin_token: adminToken,
    });

    if (error) {
      console.warn('Error fetching admin audit logs via RPC, falling back to direct table:', error.message);
      const { data: tableData, error: tableError } = await supabaseAdmin
        .from('admin_audit_logs' as any)
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (tableError) {
        console.warn('Error fetching admin audit logs table:', tableError.message);
        return [];
      }
      return (tableData || []) as unknown as AdminAuditLogEntry[];
    }

    return (data || []) as unknown as AdminAuditLogEntry[];
  } catch (err) {
    console.warn('Error in fetchAdminAuditLogs:', err);
    return [];
  }
}

export interface AdminMfaStatus {
  hasMfa: boolean;
  currentLevel: 'aal1' | 'aal2';
  nextLevel: 'aal1' | 'aal2';
  enrolledFactors: Array<{
    id: string;
    friendly_name?: string;
    factor_type: string;
    status: string;
    created_at: string;
  }>;
}

/**
 * Check current user's Multi-Factor Authentication status and enrolled factors.
 */
export async function checkAdminMfaStatus(): Promise<AdminMfaStatus> {
  try {
    const { data: aalData, error: aalError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    const { data: factorData, error: factorError } = await supabase.auth.mfa.listFactors();

    if (aalError || factorError) {
      return {
        hasMfa: false,
        currentLevel: 'aal1',
        nextLevel: 'aal1',
        enrolledFactors: [],
      };
    }

    const verifiedTotp = (factorData?.totp || []).filter((f) => f.status === 'verified');

    return {
      hasMfa: verifiedTotp.length > 0,
      currentLevel: (aalData?.currentLevel as 'aal1' | 'aal2') || 'aal1',
      nextLevel: (aalData?.nextLevel as 'aal1' | 'aal2') || 'aal1',
      enrolledFactors: factorData?.all || [],
    };
  } catch (err) {
    console.warn('[checkAdminMfaStatus] Error:', err);
    return {
      hasMfa: false,
      currentLevel: 'aal1',
      nextLevel: 'aal1',
      enrolledFactors: [],
    };
  }
}

/**
 * Unenroll an MFA factor (for factor reset or device removal).
 */
export async function unenrollAdminMfaFactor(factorId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await supabase.auth.mfa.unenroll({ factorId });
    if (error) {
      return { success: false, error: error.message };
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to unenroll MFA factor' };
  }
}


