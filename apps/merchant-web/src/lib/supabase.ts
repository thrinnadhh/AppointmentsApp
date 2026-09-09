import { createClient } from '@supabase/supabase-js';
import { Database, BookingStatus, PaymentStatus, Provider, Resource, ResourceType } from '@appointments/shared';

export type { Provider, Resource, ResourceType };

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://ynkdnwhubfknnnzjtpeg.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_PQ0ToJguSqBpF6eWP3aP9w_NT4hFLef';

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey);

export interface MerchantBookingWithDetails {
  id: string;
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
    resources: (p.resources || []).map((r) => ({
      ...r,
      type: r.type as ResourceType,
      department: r.department || 'General',
      price: r.price !== null ? Number(r.price) : null,
      attributes: (r.attributes || {}) as Record<string, unknown>,
    })),
  }));
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
  const { data, error } = await supabase
    .from('bookings')
    .update({
      slot_start: newStartIso,
      slot_end: newEndIso,
      updated_at: new Date().toISOString(),
    })
    .eq('id', bookingId)
    .select();

  if (error) {
    console.error('Error rescheduling booking:', error);
    throw error;
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
    p_phone: params.phone || null,
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
    p_description: params.description || null,
    p_email: params.email || null,
    p_owner_id: params.ownerId || null,
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
