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
  city_id?: string | null;
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
  attachment_url?: string | null;
  reminder_1h_sent_at?: string | null;
  reminder_30m_sent_at?: string | null;
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

export type NotificationEventType =
  | 'BOOKING_CONFIRMED'
  | 'BOOKING_REMINDER_1H'
  | 'BOOKING_REMINDER_30M'
  | 'BOOKING_CANCELLED';

export type NotificationChannel = 'whatsapp' | 'sms';

export interface NotificationLog {
  id: string;
  booking_id: string;
  recipient_phone: string;
  recipient_name?: string | null;
  event_type: NotificationEventType | string;
  channel: NotificationChannel | string;
  status: 'QUEUED' | 'SENT' | 'FAILED' | string;
  message_content: string;
  provider_response?: Record<string, unknown> | null;
  sent_at: string;
  created_at: string;
}

export type CityStatus = 'ACTIVE' | 'EXPANDING' | 'PLANNED' | 'PAUSED';

export interface City {
  id: string;
  name: string;
  state: string;
  country: string;
  status: CityStatus;
  latitude: number;
  longitude: number;
  radius_km: number;
  merchant_target: number;
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CityWaitlistEntry {
  id: string;
  city_id: string;
  user_id?: string | null;
  contact_info: string;
  role_interest: 'merchant' | 'customer' | string;
  notes?: string | null;
  created_at: string;
}

export type TimeWindowFilter = 'today' | '3days' | '7days' | '30days' | 'all';

export interface CityAdminStats {
  city_id: string;
  city_name: string;
  status: CityStatus;
  merchant_target: number;
  onboarded_merchants: number;
  in_progress_merchants: number;
  total_bookings: number;
  completed_bookings: number;
  deposit_volume: number;
  waitlist_count: number;
}

export interface AdminVelocityMetrics {
  time_window: TimeWindowFilter;
  since: string | null;
  total_bookings: number;
  completed_bookings: number;
  held_bookings: number;
  confirmed_bookings: number;
  no_show_bookings: number;
  cancelled_bookings: number;
  gross_deposit_amount: number;
  city_density: Array<{
    city_id: string;
    city_name: string;
    booking_count: number;
    deposit_sum: number;
  }>;
  merchant_funnel: {
    onboarded_count: number;
    in_progress_count: number;
    suspended_count: number;
    total_merchants: number;
  };
  cities_overview: {
    active_cities: number;
    expanding_cities: number;
    planned_cities: number;
    total_cities: number;
  };
}

export interface AdminAuditLogEntry {
  id: string;
  admin_id: string | null;
  admin_name: string | null;
  admin_email: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  details: Record<string, any>;
  ip_address: string | null;
  created_at: string;
}
