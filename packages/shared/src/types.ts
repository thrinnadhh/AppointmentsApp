export type UserRole = 'customer' | 'merchant' | 'admin';

export type ProviderStatus = 'PENDING_APPROVAL' | 'ACTIVE' | 'SUSPENDED';

export type BookingStatus =
  | 'HELD'
  | 'PENDING_PAYMENT'
  | 'CONFIRMED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'NO_SHOW';

export type PaymentStatus = 'PENDING' | 'CAPTURED' | 'REFUNDED' | 'FORFEITED';

export type ResourceType = 'doctor' | 'table' | 'court' | 'stylist' | 'groomer' | 'vet';

export interface Category {
  id: string;
  name: string;
  icon?: string;
  display_order: number;
}

export interface SubCategory {
  id: string;
  category_id: string;
  name: string;
  display_order: number;
}

export interface Provider {
  id: string;
  owner_id?: string | null;
  category_id: string;
  sub_category_id?: string | null;
  name: string;
  description?: string | null;
  address: string;
  city: string;
  latitude: number;
  longitude: number;
  phone: string;
  email?: string | null;
  opening_time: string; // '09:00:00'
  closing_time: string; // '21:00:00'
  photos?: string[] | null;
  status: ProviderStatus;
  created_at: string;
  updated_at: string;
}

export interface Resource {
  id: string;
  provider_id: string;
  name: string;
  type: ResourceType;
  duration_minutes: number;
  capacity: number;
  deposit_amount: number;
  price?: number | null;
  department?: string | null;
  attributes: Record<string, unknown>;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ResourceAvailability {
  id: string;
  resource_id: string;
  day_of_week: number; // 0=Sunday, 6=Saturday
  start_time: string;
  end_time: string;
  slot_interval_minutes: number;
}

export interface Slot {
  id?: string;
  resource_id: string;
  start_time: string; // ISO string
  end_time: string;   // ISO string
  is_available: boolean;
  capacity_remaining?: number;
}

export interface Booking {
  id: string;
  reference_code?: string | null;
  customer_id: string;
  provider_id: string;
  resource_id: string;
  slot_start: string;
  slot_end: string;
  status: BookingStatus;
  payment_status: PaymentStatus;
  deposit_amount: number;
  hold_expires_at?: string | null;
  gateway_payment_id?: string | null;
  created_at: string;
  updated_at: string;
  provider?: Provider;
  resource?: Resource;
}

export interface Payment {
  id: string;
  booking_id: string;
  gateway_payment_id?: string | null;
  amount: number;
  currency: string;
  status: PaymentStatus;
  metadata?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface UserProfile {
  id: string;
  phone?: string | null;
  email?: string | null;
  full_name?: string | null;
  role: UserRole;
  no_show_count: number;
  is_flagged: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateHoldResult {
  success: boolean;
  booking_id?: string;
  reference_code?: string;
  deposit_amount?: number;
  hold_expires_at?: string;
  error?: string;
}
