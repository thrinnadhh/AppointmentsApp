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
  normCategory
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

// Base URL for the merchant-web backend API (e.g. the reschedule route).
// Must be set to the deployed backend URL in any non-local build — localhost
// only resolves on the same machine the app is running on, never on a real device.
const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL;

// Seed data for immediate local preview/offline operation
export const MOCK_PROVIDERS: ProviderWithDetails[] = [
  {
    id: '11111111-1111-1111-1111-111111111111',
    category_id: 'clinics',
    sub_category_id: 'dental',
    name: 'Sri Venkateswara Dental & Implant Care',
    description: 'Specialized painless root canals, smile makeovers, and dental implants.',
    address: 'Shop 12, Bhavani Nagar, Near RTC Bus Stand',
    city: 'Tirupati',
    latitude: 13.6328,
    longitude: 79.4197,
    phone: '+91 98765 43210',
    opening_time: '09:00:00',
    closing_time: '20:00:00',
    photos: ['https://images.unsplash.com/photo-1629909613654-28e377c37b09?w=800'],
    status: 'ACTIVE',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    distance_km: 1.2,
    next_slot: 'Today, 11:30 AM',
    resources: [
      {
        id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        provider_id: '11111111-1111-1111-1111-111111111111',
        name: 'Dr. S. K. Murthy, MDS (Implantologist)',
        type: 'doctor',
        duration_minutes: 30,
        capacity: 1,
        deposit_amount: 100,
        attributes: { specialization: 'Dental Implants', experience: '14 yrs' },
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: 'aaaaaaab-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        provider_id: '11111111-1111-1111-1111-111111111111',
        name: 'Dr. Ananya Reddy (Orthodontist)',
        type: 'doctor',
        duration_minutes: 30,
        capacity: 1,
        deposit_amount: 100,
        attributes: { specialization: 'Braces & Aligners', experience: '8 yrs' },
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ],
  },
  {
    id: '22222222-2222-2222-2222-222222222222',
    category_id: 'restaurants',
    sub_category_id: 'fine_dining',
    name: 'Saptagiri Heritage Dining',
    description: 'Authentic royal Andhra thalis and reserved AC table seating.',
    address: 'Renigunta Road, Opp. Reliance Trends',
    city: 'Tirupati',
    latitude: 13.6288,
    longitude: 79.4285,
    phone: '+91 98765 43211',
    opening_time: '11:30:00',
    closing_time: '22:30:00',
    photos: ['https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=800'],
    status: 'ACTIVE',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    distance_km: 2.1,
    next_slot: 'Today, 1:00 PM',
    resources: [
      {
        id: 'bbbbbbba-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        provider_id: '22222222-2222-2222-2222-222222222222',
        name: 'Family AC Booth (4 Seater)',
        type: 'table',
        duration_minutes: 60,
        capacity: 4,
        deposit_amount: 150,
        attributes: { section: 'AC Hall', seats: 4 },
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ],
  },
  {
    id: '33333333-3333-3333-3333-333333333333',
    category_id: 'gaming',
    sub_category_id: 'box_cricket',
    name: 'Tirupati Premier Turf & Gaming Arena',
    description: 'FIFA-grade Astroturf with floodlights for box cricket and football.',
    address: 'Korlagunta Main Road, Near Reliance Mart',
    city: 'Tirupati',
    latitude: 13.6412,
    longitude: 79.4310,
    phone: '+91 98765 43212',
    opening_time: '06:00:00',
    closing_time: '23:00:00',
    photos: ['https://images.unsplash.com/photo-1574629810360-7efbbe195018?w=800'],
    status: 'ACTIVE',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    distance_km: 3.4,
    next_slot: 'Today, 5:00 PM',
    resources: [
      {
        id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
        provider_id: '33333333-3333-3333-3333-333333333333',
        name: 'Pitch 1 (Box Cricket Arena)',
        type: 'court',
        duration_minutes: 60,
        capacity: 14,
        deposit_amount: 200,
        attributes: { lights: '1000W LED', surface: 'Astroturf' },
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ],
  },
  {
    id: '44444444-4444-4444-4444-444444444444',
    category_id: 'salons',
    sub_category_id: 'hair_styling',
    name: 'Elite Looks Luxury Salon',
    description: 'Expert hair styling, beard grooming, and spa facials.',
    address: 'Air Bypass Road, Beside Domino’s Pizza',
    city: 'Tirupati',
    latitude: 13.6355,
    longitude: 79.4123,
    phone: '+91 98765 43213',
    opening_time: '09:30:00',
    closing_time: '21:00:00',
    photos: ['https://images.unsplash.com/photo-1560066984-138dadb4c035?w=800'],
    status: 'ACTIVE',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    distance_km: 0.8,
    next_slot: 'Today, 2:30 PM',
    resources: [
      {
        id: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
        provider_id: '44444444-4444-4444-4444-444444444444',
        name: 'Stylist Chair 1 (Master Stylist Vikram)',
        type: 'stylist',
        duration_minutes: 45,
        capacity: 1,
        deposit_amount: 75,
        attributes: { specialty: 'Hair Sculpting & Fade' },
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ],
  },
  {
    id: '55555555-5555-5555-5555-555555555555',
    category_id: 'pets',
    sub_category_id: 'pet_hospital',
    name: 'Tirumala Pet Clinic & Grooming Spa',
    description: 'Experienced vets, vaccination schedules, and dog grooming suites.',
    address: 'Alipiri Bypass Road, Near Balaji Colony',
    city: 'Tirupati',
    latitude: 13.6450,
    longitude: 79.4080,
    phone: '+91 98765 43214',
    opening_time: '09:00:00',
    closing_time: '20:00:00',
    photos: ['https://images.unsplash.com/photo-1583337130417-3346a1be7dee?w=800'],
    status: 'ACTIVE',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    distance_km: 2.8,
    next_slot: 'Today, 4:00 PM',
    resources: [
      {
        id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
        provider_id: '55555555-5555-5555-5555-555555555555',
        name: 'Dr. K. Srinivas (Veterinary Surgeon)',
        type: 'vet',
        duration_minutes: 30,
        capacity: 1,
        deposit_amount: 100,
        attributes: { qualification: 'BVSc & AH' },
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ],
  },
];

// In-memory cache for fast instant restoration without network flicker
const categoryProvidersCache = new Map<string, ProviderWithDetails[]>();

export function getCachedProvidersByCategory(categoryId?: string): ProviderWithDetails[] | null {
  const key = categoryId || 'all';
  return categoryProvidersCache.get(key) || null;
}

// Enhanced Supabase Service for Customer Mobile Application
export async function fetchProvidersByCategory(categoryId?: string): Promise<ProviderWithDetails[]> {
  const cacheKey = categoryId || 'all';
  if (categoryProvidersCache.has(cacheKey)) {
    const cached = categoryProvidersCache.get(cacheKey)!;
    if (cached.length > 0) {
      return cached;
    }
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
      if (isDev) {
        if (!categoryId || categoryId === 'all') return MOCK_PROVIDERS;
        return MOCK_PROVIDERS.filter((p) => normCategory(p.category_id) === normCategory(categoryId));
      }
      return [];
    }

    if (!data || data.length === 0) {
      if (isDev) {
        if (!categoryId || categoryId === 'all') return MOCK_PROVIDERS;
        return MOCK_PROVIDERS.filter((p) => normCategory(p.category_id) === normCategory(categoryId));
      }
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
        created_at: prov.created_at,
        updated_at: prov.updated_at,
        distance_km: Number((1.2 + idx * 0.7).toFixed(1)),
        next_slot: 'Today, Available',
        resources,
      };
    });

    categoryProvidersCache.set(cacheKey, result);
    return result;
  } catch (err) {
    console.warn('Network error in fetchProvidersByCategory:', err);
    if (isDev) {
      if (!categoryId || categoryId === 'all') return MOCK_PROVIDERS;
      return MOCK_PROVIDERS.filter((p) => normCategory(p.category_id) === normCategory(categoryId));
    }
    return [];
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
      if (isDev) {
        return MOCK_PROVIDERS.find((p) => p.id === providerId) || MOCK_PROVIDERS[0];
      }
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
      created_at: data.created_at,
      updated_at: data.updated_at,
      distance_km: 1.5,
      next_slot: 'Today, Available',
      resources,
    };
  } catch {
    if (isDev) {
      return MOCK_PROVIDERS.find((p) => p.id === providerId) || MOCK_PROVIDERS[0];
    }
    return null;
  }
}

interface CustomerBookingRow extends Booking {
  providers?: { name: string } | null;
  resources?: { name: string } | null;
}

export async function fetchCustomerBookingsFromSupabase(customerId: string = '99999999-9999-9999-9999-999999999991') {
  try {
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
  paymentGatewayId: string = 'pay_simulated_upi'
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
    const { data, error } = await supabase
      .from('bookings')
      .update({
        status: 'CONFIRMED',
        payment_status: 'CAPTURED',
        gateway_payment_id: paymentGatewayId,
        updated_at: new Date().toISOString(),
      })
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

export async function cancelBookingOnSupabase(bookingId: string, slotStart: string) {
  const diffHours = (new Date(slotStart).getTime() - Date.now()) / (1000 * 60 * 60);
  const isLate = diffHours <= 1;

  try {
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

export function generateAvailableSlots(resource: Resource, selectedDate: Date): Slot[] {
  const slots: Slot[] = [];
  const startHour = 10;
  const endHour = 18;

  for (let hour = startHour; hour < endHour; hour++) {
    for (let min = 0; min < 60; min += resource.duration_minutes) {
      const start = new Date(selectedDate);
      start.setHours(hour, min, 0, 0);
      const end = new Date(start.getTime() + resource.duration_minutes * 60000);
      
      // Mark one slot as busy for demonstration
      const isBusy = (hour === 12 && min === 0) || (hour === 15 && min === 30);

      slots.push({
        resource_id: resource.id,
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        is_available: !isBusy,
        capacity_remaining: isBusy ? 0 : resource.capacity,
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
    // Attempt via backend API first if configured
    const apiBase = process.env.EXPO_PUBLIC_API_BASE_URL;
    if (apiBase) {
      try {
        const resp = await fetch(`${apiBase}/api/bookings/reschedule`, {
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
        // Fallback directly to Supabase update
      }
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

