import { createClient } from '@supabase/supabase-js';
import { Database, BookingStatus, PaymentStatus, Provider, Resource, ResourceType } from '@appointments/shared';

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

