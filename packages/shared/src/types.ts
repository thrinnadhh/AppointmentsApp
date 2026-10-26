export type UserRole = 'customer' | 'merchant' | 'admin' | 'city_director';

export type ProviderStatus = 'PENDING_APPROVAL' | 'ACTIVE' | 'SUSPENDED';

export type BookingStatus =
  | 'HELD'
  | 'PENDING_PAYMENT'
  | 'CONFIRMED'
  | 'CHECKED_IN'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'NO_SHOW'
  | 'IN_CONSULTATION'
  | 'ADMITTED';

export type PaymentStatus = 'PENDING' | 'CAPTURED' | 'REFUNDED' | 'REFUND_PENDING' | 'REFUND_FAILED' | 'FORFEITED';

export type PlatformPaymentStatus = 'PENDING' | 'CAPTURED' | 'REFUNDED' | 'WAIVED';
export type ConsultationPaymentStatus = 'PENDING_OFFLINE' | 'COLLECTED_AT_DESK' | 'WAIVED' | 'REFUNDED';

export type ResourceType = 'doctor' | 'table' | 'court' | 'stylist' | 'groomer' | 'vet';

export interface DaySchedule {
  open: string;
  close: string;
  is_closed: boolean;
}

export type DayOfWeek = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';

export type WeeklyHours = Record<DayOfWeek, DaySchedule>;

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
  weekly_hours?: WeeklyHours | null;
  photos?: string[] | null;
  status: ProviderStatus;
  is_active?: boolean;
  auto_accept_bookings?: boolean;
  daily_booking_limit?: number;
  cancellation_strikes?: number;
  strike_reset_date?: string;
  penalty_balance?: number;
  is_booking_frozen?: boolean;
  cooling_period_days?: number;
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
  department_id?: string | null;
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
  platform_fee?: number | null;
  total_amount?: number | null;
  platform_fee_amount?: number | null;
  consultation_fee_amount?: number | null;
  platform_payment_status?: PlatformPaymentStatus;
  consultation_payment_status?: ConsultationPaymentStatus;
  consultation_collected_at?: string | null;
  consultation_collected_by?: string | null;
  hold_expires_at?: string | null;
  is_followup?: boolean;
  followup_original_booking_id?: string | null;

  gateway_payment_id?: string | null;
  created_at: string;
  updated_at: string;
  attachment_url?: string | null;
  reminder_1h_sent_at?: string | null;
  reminder_30m_sent_at?: string | null;
  is_present?: boolean;
  customer_arrived_at?: string | null;
  checked_in_at?: string | null;
  checked_in_by?: string | null;
  checked_in_method?: 'code' | 'manual' | null;
  queue_position?: number | null;
  estimated_wait_minutes?: number | null;
  department_id?: string | null;
  department_name?: string | null;
  emergency_cancelled?: boolean;
  emergency_doctor_arrived?: boolean;
  emergency_patient_choice?: string | null;
  booking_for_someone_else?: boolean;
  patient_name?: string | null;
  patient_phone?: string | null;
  patient_relationship?: string | null;
  total_charged?: number | null;
  version?: number;
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
  assigned_city_id?: string | null;
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
  platform_fee?: number;
  total_amount?: number;
  platform_fee_amount?: number;
  consultation_fee_amount?: number;
  platform_payment_status?: PlatformPaymentStatus;
  consultation_payment_status?: ConsultationPaymentStatus;
  hold_expires_at?: string;
  is_followup?: boolean;
  followup_original_booking_id?: string | null;
  error?: string;
}

export type NotificationEventType =
  | 'BOOKING_CONFIRMED'
  | 'BOOKING_REMINDER_1H'
  | 'BOOKING_REMINDER_30M'
  | 'BOOKING_CANCELLED'
  | 'BOOKING_COMPLETED';

export type NotificationChannel = 'whatsapp' | 'sms' | 'email' | 'push';

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

export type TenantRole = 'owner' | 'manager' | 'staff';

export interface MerchantMembership {
  id: string;
  user_id: string;
  provider_id: string;
  role: TenantRole;
  created_at: string;
  updated_at?: string;
  provider?: Provider;
}

export type BusinessVertical = 'clinics' | 'salons' | 'gaming' | 'restaurants' | 'pets';

export interface VerticalConfig {
  id: BusinessVertical;
  name: string;
  badgeLabel: string;
  venueLabel: string; // e.g. 'Hospital', 'Salon', 'Turf', 'Restaurant', 'Pet Clinic'
  venueLabelPlural: string;
  resourceLabelSingular: string;
  resourceLabelPlural: string;
  unitLabelSingular: string;
  unitLabelPlural: string;
  customerLabel: string;
  actionVerb: string;
  departments: string[];
  defaultDurationMinutes: number;
  defaultPrice: number;
  defaultDeposit: number;
  features: {
    hasPrescriptions: boolean;
    hasTokenNumbers: boolean;
    hasCustomDurations: boolean;
    hasTeamCovers: boolean;
  };
}

export interface CreateRazorpayOrderRequest {
  booking_id: string;
  amount?: number;
  currency?: string;
}

export interface CreateRazorpayOrderResponse {
  success: boolean;
  order_id?: string;
  key_id?: string;
  amount?: number; // in paise
  currency?: string;
  is_mock?: boolean;
  deposit_amount?: number; // merchant deposit in INR
  platform_fee?: number;   // platform fee in INR (₹10 or ₹50)
  total_amount?: number;   // total payable online in INR (platform_fee)
  platform_fee_amount?: number;
  consultation_fee_amount?: number;
  error?: string;
}

export interface VerifyRazorpayPaymentRequest {
  booking_id: string;
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
  attachment_url?: string | null;
}

export interface VerifyRazorpayPaymentResponse {
  success: boolean;
  booking_id?: string;
  reference_code?: string;
  queue_position?: number;
  status?: string;
  payment_status?: string;
  platform_payment_status?: PlatformPaymentStatus;
  consultation_payment_status?: ConsultationPaymentStatus;
  error?: string;
}

export interface CoolingPeriodEligibilityResult {
  eligible: boolean;
  cooling_period_days?: number;
  original_booking_id?: string;
  original_slot_start?: string;
  valid_until?: string;
  days_remaining?: number;
  prior_booking_id?: string;
  prior_slot_start?: string;
  prior_valid_until?: string;
  reason?: string;
}

export type AppPlatform = 'web' | 'mobile' | 'backend' | 'edge';
export type AppLogLevel = 'error' | 'warn' | 'info';

export type AppSeverity = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL';
export type AppLogCategory =
  | 'AUTH'
  | 'BOOKING'
  | 'PAYMENT'
  | 'HOSPITAL_QUEUE'
  | 'NOTIFICATION'
  | 'DATABASE'
  | 'NETWORK'
  | 'UI_CRASH'
  | 'SECURITY'
  | 'OTHER';
export type AppLogSource =
  | 'customer-mobile'
  | 'merchant-web'
  | 'admin-web'
  | 'edge-function'
  | 'database';

export interface AppLogEntry {
  id?: string;
  created_at?: string;
  platform: AppPlatform;
  level: AppLogLevel;
  severity?: AppSeverity;
  category?: AppLogCategory;
  source?: AppLogSource;
  component?: string;
  message: string;
  stack_trace?: string;
  error_code?: string | null;
  metadata?: Record<string, unknown>;
  device_info?: Record<string, unknown>;
  user_id?: string | null;
  session_id?: string | null;
  role?: string | null;
  city_id?: string | null;
  vertical?: string | null;
  appointment_id?: string | null;
  app_version?: string | null;
  platform_os?: string | null;
  device_model?: string | null;
  environment?: 'dev' | 'test' | 'prod';
  fingerprint?: string | null;
  duplicate_count?: number;
}

export interface AppLogsFilter {
  platform?: AppPlatform | 'all';
  level?: AppLogLevel | 'all';
  severity?: AppSeverity | 'all';
  category?: AppLogCategory | 'all';
  source?: AppLogSource | 'all';
  component?: string;
  search?: string;
  dateRange?: 'all' | 'today' | '24h' | '7d' | '30d';
  limit?: number;
  offset?: number;
}

export interface AppointmentCheckinCode {
  id: string;
  booking_id: string;
  provider_id: string;
  customer_id: string;
  appointment_date: string;
  code: string;
  created_at: string;
}

export type CheckinErrorCode =
  | 'INVALID_CODE'
  | 'ALREADY_CHECKED_IN'
  | 'TOO_EARLY'
  | 'EXPIRED'
  | 'WRONG_SHOP'
  | 'RATE_LIMITED'
  | 'UNAUTHORIZED'
  | 'NOT_FOUND'
  | 'INVALID_STATUS'
  | 'UNAUTHORIZED_DEPARTMENT'
  | 'APPOINTMENT_FUTURE';

export interface VerifyCheckinCodeResult {
  success: boolean;
  booking_id?: string;
  patient_name?: string;
  service_doctor?: string;
  slot_time?: string;
  is_late?: boolean;
  checked_in_at?: string;
  error?: CheckinErrorCode;
  message?: string;
  locked_until?: string;
}

export type HospitalModule = 'appointments' | 'queue_schedule' | 'check_in' | 'patients';

export interface HospitalDepartment {
  id: string;
  merchant_id: string;
  name: string;
  is_preset: boolean;
  is_active?: boolean;
  allowed_modules: HospitalModule[];
  member_count?: number;
  created_at: string;
  updated_at: string;
}

export type DepartmentMemberStatus = 'invited' | 'active' | 'revoked';
export type HospitalStaffRole = 'consultant' | 'front_desk';

export interface DepartmentMember {
  id: string;
  department_id: string;
  merchant_id: string;
  email: string;
  user_id?: string | null;
  role?: HospitalStaffRole;
  status: DepartmentMemberStatus;
  invited_by?: string | null;
  invited_at: string;
  accepted_at?: string | null;
  invite_expires_at: string;
  created_at: string;
  updated_at: string;
  department_name?: string;
}

export interface HospitalAuditLog {
  id: string;
  merchant_id: string;
  actor_id?: string | null;
  actor_name?: string | null;
  actor_email?: string | null;
  action: string;
  target: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export type HospitalRole = 'admin' | 'front_desk' | 'consultant' | 'none' | 'owner' | 'department_member' | 'superadmin';

export interface HospitalAccessContext {
  role: HospitalRole;
  merchantId: string | null;
  departmentId: string | null;
  departmentName?: string | null;
  allowedModules: HospitalModule[];
  isHospital: boolean;
  email?: string | null;
  userId: string | null;
  assignedDoctorIds: string[];
}


