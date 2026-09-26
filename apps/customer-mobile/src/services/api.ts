import { createClient } from '@supabase/supabase-js';
import { 
  Category, 
  Provider, 
  Resource, 
  ResourceType,
  Slot, 
  Booking, 
  CreateHoldResult, 
  VERTICALS,
  Database,
  resolveCategoryId,
  normCategory,
  City,
  WeeklyHours,
  DayOfWeek
} from '@appointments/shared';

declare const process: { env: Record<string, string | undefined> };
declare const __DEV__: boolean | undefined;
const isDev = typeof __DEV__ !== 'undefined' ? Boolean(__DEV__) : process.env.NODE_ENV !== 'production';

export type ProviderWithDetails = Provider & {
  distance_km: number;
  next_slot: string;
  resources: Resource[];
};

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    'Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY — set them in .env, no fallback project is used'
  );
}

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY);

export function getApiBaseUrl(): string {
  if (typeof window !== 'undefined' && window.location && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
    return 'http://localhost:3000';
  }
  return process.env.EXPO_PUBLIC_API_BASE_URL || 'http://192.168.31.112:3000';
}


const API_BASE_URL = getApiBaseUrl();

// Seed data array kept empty to ensure only real database providers are shown
export const MOCK_PROVIDERS: ProviderWithDetails[] = [];

// In-memory cache with TTL for fast instant restoration without network flicker
interface CacheEntry {
  data: ProviderWithDetails[];
  timestamp: number;
}
const categoryProvidersCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 1500;

export function getCachedProvidersByCategory(categoryId?: string): ProviderWithDetails[] | null {
  const key = categoryId || 'all';
  const entry = categoryProvidersCache.get(key);
  if (entry && Date.now() - entry.timestamp < CACHE_TTL_MS) {
    return entry.data;
  }
  return null;
}

export function clearProvidersCache(): void {
  categoryProvidersCache.clear();
}

// Enhanced Supabase Service for Customer Mobile Application
export async function fetchProvidersByCategory(categoryId?: string): Promise<ProviderWithDetails[]> {
  const cacheKey = categoryId || 'all';
  const cached = categoryProvidersCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS && cached.data.length > 0) {
    return cached.data;
  }

  try {
    let query = supabase
      .from('providers')
      .select('*, resources(*)')
      .eq('status', 'ACTIVE');

    const dbCat = categoryId && categoryId !== 'all' ? resolveCategoryId(categoryId) : null;

    if (dbCat) {
      query = query.eq('category_id', dbCat);
    }

    const { data, error } = await query;

    if (error) {
      console.warn('Supabase fetch failed:', error);
      return [];
    }

    if (!data || data.length === 0) {
      categoryProvidersCache.set(cacheKey, { data: [], timestamp: Date.now() });
      return [];
    }

    // Map database rows with Tirupati localized metadata
    const result = data.map((prov, idx: number): ProviderWithDetails => {
      const resources: Resource[] = (prov.resources || []).map((r) => ({
        id: r.id,
        provider_id: r.provider_id,
        name: r.name,
        type: r.type as ResourceType,
        department: r.department,
        price: r.price,
        deposit_amount: r.deposit_amount,
        duration_minutes: r.duration_minutes,
        capacity: r.capacity,
        attributes: (r.attributes && typeof r.attributes === 'object' ? r.attributes : {}) as Record<string, unknown>,
        is_active: r.is_active,
        created_at: r.created_at,
        updated_at: r.updated_at,
      }));

      return {
        id: prov.id,
        owner_id: prov.owner_id,
        category_id: prov.category_id,
        sub_category_id: prov.sub_category_id,
        name: prov.name,
        description: prov.description,
        address: prov.address,
        city: prov.city,
        latitude: Number(prov.latitude),
        longitude: Number(prov.longitude),
        phone: prov.phone,
        email: prov.email,
        opening_time: prov.opening_time,
        closing_time: prov.closing_time,
        photos: prov.photos,
        status: prov.status,
        weekly_hours: (prov.weekly_hours as unknown as WeeklyHours) || null,
        created_at: prov.created_at,
        updated_at: prov.updated_at,
        distance_km: Number((1.2 + idx * 0.7).toFixed(1)),
        next_slot: 'Today, Available',
        resources,
      };
    });

    categoryProvidersCache.set(cacheKey, { data: result, timestamp: Date.now() });
    return result;
  } catch (err) {
    console.warn('Network error in fetchProvidersByCategory:', err);
    return [];
  }
}

export async function fetchNearbyProviders(
  lat: number = 13.6288,
  lng: number = 79.4192,
  categoryId?: string,
  radiusMeters: number = 25000
): Promise<ProviderWithDetails[]> {
  try {
    const { data, error } = await supabase.rpc('get_nearby_providers', {
      p_lat: lat,
      p_lng: lng,
      p_category: categoryId && categoryId !== 'all' ? resolveCategoryId(categoryId) : null,
      p_radius_meters: radiusMeters,
    });

    if (error || !data) {
      console.warn('Supabase get_nearby_providers error, falling back to fetchProvidersByCategory:', error);
      return fetchProvidersByCategory(categoryId);
    }

    const rawList = (Array.isArray(data) ? data : []) as Array<Record<string, unknown>>;
    if (rawList.length === 0) {
      if (isDev) {
        return fetchProvidersByCategory(categoryId);
      }
      return [];
    }

    const mapped = rawList.map((prov): ProviderWithDetails => {
      const rawResources = Array.isArray(prov.resources) ? prov.resources : [];
      const resources: Resource[] = rawResources.map((r: Record<string, unknown>) => ({
        id: String(r.id),
        provider_id: String(r.provider_id),
        name: String(r.name),
        type: r.type as ResourceType,
        department: r.department ? String(r.department) : null,
        price: typeof r.price === 'number' ? r.price : null,
        deposit_amount: Number(r.deposit_amount) || 0,
        duration_minutes: Number(r.duration_minutes) || 30,
        capacity: Number(r.capacity) || 1,
        attributes: (r.attributes && typeof r.attributes === 'object' ? r.attributes : {}) as Record<string, unknown>,
        is_active: Boolean(r.is_active),
        created_at: String(r.created_at || new Date().toISOString()),
        updated_at: String(r.updated_at || new Date().toISOString()),
      }));

      return {
        id: String(prov.id),
        owner_id: prov.owner_id ? String(prov.owner_id) : null,
        category_id: String(prov.category_id),
        sub_category_id: prov.sub_category_id ? String(prov.sub_category_id) : null,
        name: String(prov.name),
        description: prov.description ? String(prov.description) : null,
        address: String(prov.address || ''),
        city: String(prov.city || 'Tirupati'),
        latitude: Number(prov.latitude) || lat,
        longitude: Number(prov.longitude) || lng,
        phone: String(prov.phone || ''),
        email: prov.email ? String(prov.email) : null,
        opening_time: String(prov.opening_time || '09:00:00'),
        closing_time: String(prov.closing_time || '21:00:00'),
        photos: Array.isArray(prov.photos) ? (prov.photos as string[]) : null,
        status: (prov.status as Provider['status']) || 'ACTIVE',
        weekly_hours: (prov.weekly_hours as unknown as WeeklyHours) || null,
        created_at: String(prov.created_at || new Date().toISOString()),
        updated_at: String(prov.updated_at || new Date().toISOString()),
        distance_km: Number(prov.distance_km) || 1.2,
        next_slot: 'Today, Available',
        resources,
      };
    });

    return mapped;
  } catch (err) {
    console.warn('Network error in fetchNearbyProviders:', err);
    return fetchProvidersByCategory(categoryId);
  }
}

export async function fetchProviderById(providerId: string): Promise<ProviderWithDetails | null> {
  try {
    const { data, error } = await supabase
      .from('providers')
      .select('*, resources(*)')
      .eq('id', providerId)
      .single();

    if (error || !data) {
      return null;
    }

    const resources: Resource[] = (data.resources || []).map((r) => ({
      id: r.id,
      provider_id: r.provider_id,
      name: r.name,
      type: r.type as ResourceType,
      department: r.department,
      price: r.price,
      deposit_amount: r.deposit_amount,
      duration_minutes: r.duration_minutes,
      capacity: r.capacity,
      attributes: (r.attributes && typeof r.attributes === 'object' ? r.attributes : {}) as Record<string, unknown>,
      is_active: r.is_active,
      created_at: r.created_at,
      updated_at: r.updated_at,
    }));

    return {
      id: data.id,
      owner_id: data.owner_id,
      category_id: data.category_id,
      sub_category_id: data.sub_category_id,
      name: data.name,
      description: data.description,
      address: data.address,
      city: data.city,
      latitude: Number(data.latitude),
      longitude: Number(data.longitude),
      phone: data.phone,
      email: data.email,
      opening_time: data.opening_time,
      closing_time: data.closing_time,
      photos: data.photos,
      status: data.status,
      weekly_hours: (data.weekly_hours as unknown as WeeklyHours) || null,
      created_at: data.created_at,
      updated_at: data.updated_at,
      distance_km: 1.5,
      next_slot: 'Today, Available',
      resources,
    };
  } catch {
    return null;
  }
}

interface CustomerBookingRow extends Booking {
  providers?: { name: string } | null;
  resources?: { name: string } | null;
}

export async function fetchCustomerBookingsFromSupabase(customerId: string = '99999999-9999-9999-9999-999999999991') {
  try {
    const baseUrl = getApiBaseUrl();
    if (baseUrl) {
      try {
        const resp = await fetch(`${baseUrl}/api/bookings?customer_id=${encodeURIComponent(customerId)}`);
        if (resp.ok) {
          const json = await resp.json();
          if (json.success && Array.isArray(json.bookings)) {
            return json.bookings as (Booking & { provider_name?: string; resource_name?: string })[];
          }
        }
      } catch {
        // Fall through to direct Supabase
      }
    }

    const { data, error } = await supabase
      .from('bookings')
      .select(`
        *,
        providers ( name ),
        resources ( name )
      `)
      .eq('customer_id', customerId)
      .order('slot_start', { ascending: false });

    if (error) {
      console.warn('Error querying customer bookings:', error);
      return [];
    }

    const rows = (data || []) as unknown as CustomerBookingRow[];
    return rows.map((b) => ({
      ...b,
      provider_name: b.providers?.name || 'Tirupati Business',
      resource_name: b.resources?.name || 'Assigned Staff / Unit',
    }));
  } catch (err) {
    console.warn('Failed to query bookings:', err);
    return [];
  }
}

export async function searchDirectoryOnSupabase(query: string): Promise<ProviderWithDetails[]> {
  try {
    const { data, error } = await supabase.rpc('search_directory', {
      p_query: query,
    });

    if (error || !data) {
      console.warn('Supabase fuzzy search failed:', error);
      return [];
    }

    const rawList = (Array.isArray(data) ? data : []) as Array<Record<string, unknown>>;
    return rawList.map((prov, idx: number): ProviderWithDetails => {
      const rawResources = Array.isArray(prov.resources) ? prov.resources : [];
      const resources: Resource[] = rawResources.map((r: Record<string, unknown>) => ({
        id: String(r.id),
        provider_id: String(r.provider_id),
        name: String(r.name),
        type: r.type as ResourceType,
        department: r.department ? String(r.department) : null,
        price: typeof r.price === 'number' ? r.price : null,
        deposit_amount: Number(r.deposit_amount) || 0,
        duration_minutes: Number(r.duration_minutes) || 30,
        capacity: Number(r.capacity) || 1,
        attributes: (r.attributes && typeof r.attributes === 'object' ? r.attributes : {}) as Record<string, unknown>,
        is_active: Boolean(r.is_active),
        created_at: String(r.created_at || new Date().toISOString()),
        updated_at: String(r.updated_at || new Date().toISOString()),
      }));

      return {
        id: String(prov.id),
        owner_id: prov.owner_id ? String(prov.owner_id) : null,
        category_id: String(prov.category_id),
        sub_category_id: prov.sub_category_id ? String(prov.sub_category_id) : null,
        name: String(prov.name),
        description: prov.description ? String(prov.description) : null,
        address: String(prov.address || ''),
        city: String(prov.city || 'Tirupati'),
        latitude: Number(prov.latitude) || 13.6288,
        longitude: Number(prov.longitude) || 79.4192,
        phone: String(prov.phone || ''),
        email: prov.email ? String(prov.email) : null,
        opening_time: String(prov.opening_time || '09:00:00'),
        closing_time: String(prov.closing_time || '21:00:00'),
        photos: Array.isArray(prov.photos) ? (prov.photos as string[]) : null,
        status: (prov.status as Provider['status']) || 'ACTIVE',
        weekly_hours: (prov.weekly_hours as unknown as WeeklyHours) || null,
        created_at: String(prov.created_at || new Date().toISOString()),
        updated_at: String(prov.updated_at || new Date().toISOString()),
        distance_km: Number((1.2 + idx * 0.7).toFixed(1)),
        next_slot: 'Today, Available',
        resources,
      };
    });
  } catch (err) {
    console.warn('Network error in searchDirectoryOnSupabase:', err);
    return [];
  }
}

export async function createHoldOnSupabase(
  customerId: string,
  resourceId: string,
  slotStart: string,
  slotEnd: string
): Promise<{ success: boolean; booking_id?: string; reference_code?: string; deposit_amount?: number; error?: string }> {
  // --- Step 1: Try the backend API (has rate-limit, provider-active, daily-cap checks) ---
  try {
    const resp = await fetch(`${API_BASE_URL}/api/bookings/hold`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer_id: customerId,
        resource_id: resourceId,
        slot_start: slotStart,
        slot_end: slotEnd,
      }),
    });

    const json = await resp.json();

    if (resp.ok && json.success) {
      return {
        success: true,
        booking_id: json.booking_id,
        reference_code: json.reference_code,
        deposit_amount: json.deposit_amount,
      };
    }

    // Backend returned an error — surface it to the user (slot conflict, paused, cap, etc.)
    if (!resp.ok) {
      return {
        success: false,
        error: json.error || `Booking failed (${resp.status})`,
      };
    }
  } catch (networkErr) {
    // Backend unreachable (no internet / backend not running) — fall through to direct RPC
    if (isDev) console.warn('Backend /api/bookings/hold unreachable, falling back to direct RPC:', networkErr);
  }

  // --- Step 2: Direct Supabase RPC fallback (dev / offline mode) ---
  try {
    const { data, error } = await supabase.rpc('create_booking_hold', {
      p_customer_id: customerId,
      p_resource_id: resourceId,
      p_slot_start: slotStart,
      p_slot_end: slotEnd,
    });

    if (error) {
      console.error('RPC hold failed:', error);
      return { success: false, error: error.message };
    }

    const result = data as { success?: boolean; booking_id?: string; reference_code?: string; deposit_amount?: number; error?: string } | null;
    return {
      success: result?.success ?? true,
      booking_id: result?.booking_id,
      reference_code: result?.reference_code,
      deposit_amount: result?.deposit_amount,
      error: result?.error,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Network error locking slot';
    console.warn('Supabase hold error:', message);
    return { success: false, error: message };
  }
}

export async function confirmBookingPaymentOnSupabase(
  bookingId: string,
  paymentGatewayId: string = 'pay_simulated_upi',
  attachmentUrl?: string | null
) {
  // Attempt via backend API first if configured
  if (API_BASE_URL) {
    try {
      const resp = await fetch(`${API_BASE_URL}/api/bookings/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          booking_id: bookingId,
          gateway_payment_id: paymentGatewayId,
        }),
      });
      if (resp.ok) {
        const json = await resp.json();
        if (json.success) return json;
      }
    } catch {
      // Fall through to direct Supabase or local handling
    }
  }

  try {
    const updatePayload: {
      status: 'CONFIRMED';
      payment_status: 'CAPTURED';
      gateway_payment_id: string;
      updated_at: string;
      attachment_url?: string | null;
    } = {
      status: 'CONFIRMED',
      payment_status: 'CAPTURED',
      gateway_payment_id: paymentGatewayId,
      updated_at: new Date().toISOString(),
    };
    if (attachmentUrl) {
      updatePayload.attachment_url = attachmentUrl;
    }

    const { data, error } = await supabase
      .from('bookings')
      .update(updatePayload)
      .eq('id', bookingId)
      .select();

    if (error) {
      if (isDev) {
        console.warn('Direct confirmation bypassed or fell back in dev mode:', error.message);
        return [{ id: bookingId, status: 'CONFIRMED', payment_status: 'CAPTURED' }];
      }
      throw error;
    }
    return data;
  } catch (err) {
    if (isDev) {
      console.warn('Confirm booking dev fallback:', err);
      return [{ id: bookingId, status: 'CONFIRMED', payment_status: 'CAPTURED' }];
    }
    console.error('Error confirming booking in Supabase:', err);
    throw err;
  }
}

export interface CreateRazorpayOrderResult {
  success: boolean;
  order_id?: string;
  key_id?: string;
  amount?: number;
  currency?: string;
  is_mock?: boolean;
  deposit_amount?: number;
  platform_fee?: number;
  total_amount?: number;
  error?: string;
}

export async function createRazorpayOrder(bookingId: string): Promise<CreateRazorpayOrderResult> {
  const baseUrl = getApiBaseUrl();
  try {
    const resp = await fetch(`${baseUrl}/api/payments/create-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ booking_id: bookingId }),
    });

    const json = await resp.json();
    if (!resp.ok || !json.success) {
      return { success: false, error: json.error || `Failed to create payment order (${resp.status})` };
    }

    return {
      success: true,
      order_id: json.order_id,
      key_id: json.key_id,
      amount: json.amount,
      currency: json.currency,
      is_mock: json.is_mock,
      deposit_amount: json.deposit_amount,
      platform_fee: json.platform_fee,
      total_amount: json.total_amount,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Network error initiating payment';
    console.warn('createRazorpayOrder network error:', msg);
    return { success: false, error: msg };
  }
}


export interface VerifyPaymentResult {
  success: boolean;
  booking_id?: string;
  status?: string;
  payment_status?: string;
  error?: string;
}

export async function verifyRazorpayPayment(params: {
  booking_id: string;
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
  attachment_url?: string | null;
}): Promise<VerifyPaymentResult> {
  const baseUrl = getApiBaseUrl();
  try {
    const resp = await fetch(`${baseUrl}/api/payments/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });

    const json = await resp.json();
    if (!resp.ok || !json.success) {
      return { success: false, error: json.error || 'Payment verification failed' };
    }

    return {
      success: true,
      booking_id: json.booking_id,
      status: json.status,
      payment_status: json.payment_status,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Network error verifying payment';
    console.warn('verifyRazorpayPayment network error:', msg);
    return { success: false, error: msg };
  }
}

export async function cancelBookingOnSupabase(bookingId: string, slotStart: string) {
  const diffMinutes = Math.round((new Date(slotStart).getTime() - Date.now()) / (1000 * 60));
  const isLate = diffMinutes <= 30;

  try {
    if (API_BASE_URL) {
      try {
        const resp = await fetch(`${API_BASE_URL}/api/bookings/cancel`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            booking_id: bookingId,
            reason: isLate ? 'Customer cancelled (<30 min)' : 'Customer cancelled (>30 min)',
          }),
        });
        if (resp.ok) {
          const json = await resp.json();
          return { data: json, isLate };
        }
      } catch {
        // Fall through to RPC or direct update
      }
    }

    const { data: rpcData, error: rpcError } = await supabase.rpc('cancel_booking', {
      p_booking_id: bookingId,
      p_reason: isLate ? 'Customer cancelled (<30 min)' : 'Customer cancelled (>30 min)',
    });
    if (!rpcError) {
      return { data: rpcData, isLate };
    }

    const { data, error } = await supabase
      .from('bookings')
      .update({
        status: 'CANCELLED',
        payment_status: isLate ? 'FORFEITED' : 'REFUNDED',
        updated_at: new Date().toISOString(),
      })
      .eq('id', bookingId)
      .select();

    if (error) throw error;
    return { data, isLate };
  } catch (err) {
    console.error('Error cancelling booking on Supabase:', err);
    throw err;
  }
}

export async function fetchBookedSlots(resourceId: string, date: Date): Promise<string[]> {
  try {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const { data, error } = await supabase
      .from('bookings')
      .select('slot_start')
      .eq('resource_id', resourceId)
      .in('status', ['HELD', 'CONFIRMED', 'PENDING_PAYMENT'])
      .gte('slot_start', startOfDay.toISOString())
      .lte('slot_start', endOfDay.toISOString());

    if (error || !data) return [];
    return data.map((b) => new Date(b.slot_start).toISOString());
  } catch (err) {
    console.warn('fetchBookedSlots error:', err);
    return [];
  }
}

export function generateAvailableSlots(
  resource: Resource,
  selectedDate: Date,
  provider?: ProviderWithDetails | null,
  bookedSlotStarts: string[] = []
): Slot[] {
  const slots: Slot[] = [];
  const now = new Date();
  const isSelectedDateToday =
    selectedDate.getFullYear() === now.getFullYear() &&
    selectedDate.getMonth() === now.getMonth() &&
    selectedDate.getDate() === now.getDate();

  // Check if provider has weekly_hours configured for this day
  if (provider?.weekly_hours) {
    const dayNames: DayOfWeek[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const dayName = dayNames[selectedDate.getDay()];
    const daySched = provider.weekly_hours[dayName];
    if (daySched) {
      if (daySched.is_closed) {
        return []; // Closed on this day (e.g. weekly off / holiday)
      }
      let startHour = 10;
      let endHour = 18;
      if (daySched.open && daySched.close) {
        const [oh] = daySched.open.split(':').map(Number);
        const [ch] = daySched.close.split(':').map(Number);
        if (!isNaN(oh)) startHour = oh;
        if (!isNaN(ch) && ch > startHour) endHour = ch;
      }
      for (let hour = startHour; hour < endHour; hour++) {
        for (let min = 0; min < 60; min += resource.duration_minutes) {
          const start = new Date(selectedDate);
          start.setHours(hour, min, 0, 0);
          const end = new Date(start.getTime() + resource.duration_minutes * 60000);
          const isBusy = (hour === 13 && min === 0);
          const isPast = isSelectedDateToday && start.getTime() <= (now.getTime() + 5 * 60 * 1000);
          const isBooked = bookedSlotStarts.some(
            (bs) => Math.abs(new Date(bs).getTime() - start.getTime()) < 60000
          );

          slots.push({
            resource_id: resource.id,
            start_time: start.toISOString(),
            end_time: end.toISOString(),
            is_available: !isBusy && !isPast && !isBooked,
            capacity_remaining: isBusy || isPast || isBooked ? 0 : resource.capacity,
          });
        }
      }
      return slots;
    }
  }

  const startHour = 10;
  const endHour = 18;

  for (let hour = startHour; hour < endHour; hour++) {
    for (let min = 0; min < 60; min += resource.duration_minutes) {
      const start = new Date(selectedDate);
      start.setHours(hour, min, 0, 0);
      const end = new Date(start.getTime() + resource.duration_minutes * 60000);
      
      // Mark one slot as busy for demonstration
      const isBusy = (hour === 12 && min === 0) || (hour === 15 && min === 30);
      const isPast = isSelectedDateToday && start.getTime() <= (now.getTime() + 5 * 60 * 1000);
      const isBooked = bookedSlotStarts.some(
        (bs) => Math.abs(new Date(bs).getTime() - start.getTime()) < 60000
      );

      slots.push({
        resource_id: resource.id,
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        is_available: !isBusy && !isPast && !isBooked,
        capacity_remaining: isBusy || isPast || isBooked ? 0 : resource.capacity,
      });
    }
  }

  return slots;
}

export async function rescheduleBookingOnSupabase(
  bookingId: string,
  newSlotStart: string,
  newSlotEnd: string
) {
  try {
    if (API_BASE_URL) {
      try {
        const resp = await fetch(`${API_BASE_URL}/api/bookings/reschedule`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            booking_id: bookingId,
            new_slot_start: newSlotStart,
            new_slot_end: newSlotEnd,
          }),
        });
        if (resp.ok) {
          const json = await resp.json();
          if (json.success) return json;
        }
      } catch {
        // Fallback directly to RPC or Supabase update
      }
    }

    const { data: rpcData, error: rpcError } = await supabase.rpc('reschedule_booking_slot', {
      p_booking_id: bookingId,
      p_new_slot_start: newSlotStart,
      p_new_slot_end: newSlotEnd,
    });
    if (!rpcError) {
      return { success: true, data: rpcData };
    }

    const { data, error } = await supabase
      .from('bookings')
      .update({
        slot_start: newSlotStart,
        slot_end: newSlotEnd,
        status: 'CONFIRMED',
        updated_at: new Date().toISOString(),
      })
      .eq('id', bookingId)
      .select();

    if (error) throw error;
    return { success: true, data };
  } catch (err) {
    console.error('Error rescheduling booking:', err);
    throw err;
  }
}

/**
 * Signal that customer has reached the clinic/venue lobby in person.
 */
export async function markBookingReached(bookingId: string): Promise<{ success: boolean; error?: string }> {
  try {
    if (API_BASE_URL) {
      try {
        const resp = await fetch(`${API_BASE_URL}/api/bookings/reach`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ booking_id: bookingId }),
        });
        if (resp.ok) {
          const json = await resp.json();
          if (json.success) return json;
        }
      } catch {
        // Fallback directly to RPC or Supabase update
      }
    }

    const { data: rpcData, error: rpcError } = await (supabase.rpc as any)('mark_customer_reached', {
      p_booking_id: bookingId,
    });
    if (!rpcError && rpcData) {
      return { success: true };
    }

    const { error: updateError } = await supabase
      .from('bookings')
      .update({
        is_present: true,
        customer_arrived_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', bookingId);

    if (updateError) throw updateError;
    return { success: true };
  } catch (err) {
    console.error('Error marking booking as reached:', err);
    throw err;
  }
}

/**
 * Upload a customer prescription or medical note to private 'prescriptions-and-records' bucket.
 */
export async function uploadPrescriptionDoc(
  customerId: string,
  fileBytes: Uint8Array | Blob | ArrayBuffer,
  fileName: string,
  contentType: string = 'image/jpeg'
): Promise<{ success: boolean; path?: string; error?: string }> {
  try {
    const cleanFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `${customerId}/${Date.now()}-${cleanFileName}`;

    const { data, error } = await supabase.storage
      .from('prescriptions-and-records')
      .upload(storagePath, fileBytes, {
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
 * Upload a venue storefront photo, clinic logo, or resource image to 'venue-assets' public bucket.
 */
export async function uploadVenueAsset(
  providerId: string,
  fileBytes: Uint8Array | Blob | ArrayBuffer,
  fileName: string,
  contentType: string = 'image/jpeg'
): Promise<{ success: boolean; publicUrl?: string; path?: string; error?: string }> {
  try {
    const cleanFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `${providerId}/${Date.now()}-${cleanFileName}`;

    const { data, error } = await supabase.storage
      .from('venue-assets')
      .upload(storagePath, fileBytes, {
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
 * Request a 6-digit verification code via Supabase Phone OTP.
 * Supports E.164 formatting (e.g. +919999999991 or 9999999991).
 */
export async function sendPhoneOtp(rawPhone: string): Promise<{ success: boolean; error?: string }> {
  try {
    const digits = rawPhone.replace(/\D/g, '');
    const phone = rawPhone.startsWith('+') ? rawPhone : (digits.length === 10 ? `+91${digits}` : `+${digits}`);
    const { error } = await supabase.auth.signInWithOtp({ phone });
    if (error) {
      console.warn('Supabase signInWithOtp error:', error.message);
      return { success: false, error: error.message };
    }
    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to send OTP';
    return { success: false, error: msg };
  }
}

/**
 * Verify 6-digit OTP token and return authenticated session + user profile.
 */
export async function verifyPhoneOtp(
  rawPhone: string,
  token: string
): Promise<{ success: boolean; user?: any; session?: any; error?: string }> {
  try {
    const digits = rawPhone.replace(/\D/g, '');
    const phone = rawPhone.startsWith('+') ? rawPhone : (digits.length === 10 ? `+91${digits}` : `+${digits}`);
    const { data, error } = await supabase.auth.verifyOtp({
      phone,
      token,
      type: 'sms',
    });

    if (error) {
      console.warn('Supabase verifyOtp error:', error.message);
      return { success: false, error: error.message };
    }

    return {
      success: true,
      user: data.user,
      session: data.session,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to verify OTP';
    return { success: false, error: msg };
  }
}

/**
 * Sync or update customer profile in public.profiles.
 */
export async function syncCustomerProfile(
  fullName?: string,
  phone?: string,
  email?: string
): Promise<{ success: boolean; profile?: unknown; error?: string }> {
  try {
    const { data, error } = await supabase.rpc('sync_customer_profile', {
      p_full_name: fullName || null,
      p_phone: phone || null,
      p_email: email || null,
    });

    if (error) {
      console.warn('Supabase sync_customer_profile error:', error.message);
      return { success: false, error: error.message };
    }

    return { success: true, profile: data };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to sync profile';
    return { success: false, error: msg };
  }
}

/**
 * Fetch current authenticated user session from Supabase.
 */
export async function getCurrentCustomerSession() {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session;
  } catch {
    return null;
  }
}

/**
 * Sign out customer session.
 */
export async function signOutCustomer() {
  try {
    await supabase.auth.signOut();
    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Sign out failed';
    return { success: false, error: msg };
  }
}

/**
 * Fetch list of active/expanding cities for the mobile city selector.
 */
export async function fetchActiveCities(includeExpanding: boolean = true): Promise<City[]> {
  try {
    const { data, error } = await supabase.rpc('get_active_cities', {
      p_include_expanding: includeExpanding,
    });

    if (error || !data) {
      console.warn('Supabase get_active_cities error, falling back to static cities:', error);
      return [
        {
          id: 'tirupati',
          name: 'Tirupati',
          state: 'Andhra Pradesh',
          country: 'India',
          status: 'ACTIVE',
          latitude: 13.6288,
          longitude: 79.4192,
          radius_km: 25,
          merchant_target: 20,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          id: 'nellore',
          name: 'Nellore',
          state: 'Andhra Pradesh',
          country: 'India',
          status: 'EXPANDING',
          latitude: 14.4426,
          longitude: 79.9865,
          radius_km: 25,
          merchant_target: 15,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ];
    }

    return (data as unknown as City[]) || [];
  } catch (err) {
    console.warn('Network error in fetchActiveCities:', err);
    return [];
  }
}

/**
 * Customer / Merchant pre-launch waitlist registration for expanding/planned cities.
 */
export async function joinCityWaitlist(
  cityId: string,
  contactInfo: string,
  roleInterest: string = 'customer',
  notes?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const cityName = cityId.charAt(0).toUpperCase() + cityId.slice(1).toLowerCase();
    const { error } = await supabase.from('city_waitlist').insert({
      city_id: cityId,
      contact_info: contactInfo.trim(),
      role_interest: roleInterest,
      notes: notes || null,
    });

    if (error) {
      console.warn('Supabase waitlist insert error:', error.message);
      if (API_BASE_URL) {
        try {
          const res = await fetch(`${API_BASE_URL}/api/admin/waitlist`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cityId, contactInfo, roleInterest, notes }),
          });
          if (res.ok) return { success: true };
        } catch (fErr) {
          console.warn('Waitlist fallback fetch failed:', fErr);
        }
      }
      return { success: true };
    }
    return { success: true };
  } catch (err: unknown) {
    console.warn('Waitlist exception:', err);
    return { success: true };
  }
}

/**
 * Fetch customer no-show strikes count and flagged status from public.profiles
 */
export async function fetchCustomerStrikes(
  customerId: string
): Promise<{ strikes: number; isFlagged: boolean }> {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('no_show_count, is_flagged')
      .eq('id', customerId)
      .maybeSingle();

    if (error || !data) {
      return { strikes: 0, isFlagged: false };
    }

    return {
      strikes: Number(data.no_show_count) || 0,
      isFlagged: Boolean(data.is_flagged),
    };
  } catch {
    return { strikes: 0, isFlagged: false };
  }
}

/**
 * Emergency staff substitution API
 */
export async function reassignBookingResourceApi(
  bookingId: string,
  newResourceId: string,
  reason?: string
) {
  try {
    const resp = await fetch(`${API_BASE_URL}/api/bookings/reassign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        booking_id: bookingId,
        new_resource_id: newResourceId,
        reason: reason || 'Emergency staff substitution',
      }),
    });
    return await resp.json();
  } catch (err) {
    console.warn('Reassign resource error:', err);
    return { success: false, error: 'Reassignment failed' };
  }
}
