import { Provider, Resource, Booking } from '@appointments/shared';

export const INITIAL_MERCHANT_PROVIDER: Provider = {
  id: '11111111-1111-1111-1111-111111111111',
  category_id: 'clinics',
  sub_category_id: 'dental',
  name: 'Sri Venkateswara Dental & Implant Care',
  description: 'Comprehensive oral surgery, smile design, and pediatric dental services in central Tirupati.',
  address: 'Shop 12, Bhavani Nagar, Near RTC Bus Stand',
  city: 'Tirupati',
  latitude: 13.6328,
  longitude: 79.4197,
  phone: '+91 98765 43210',
  email: 'svdental@tirupati.example.com',
  opening_time: '09:00:00',
  closing_time: '20:00:00',
  photos: ['https://images.unsplash.com/photo-1629909613654-28e377c37b09?w=800'],
  status: 'ACTIVE',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

export const INITIAL_RESOURCES: Resource[] = [
  {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    provider_id: '11111111-1111-1111-1111-111111111111',
    name: 'Dr. S. K. Murthy, MDS (Implantologist)',
    type: 'doctor',
    duration_minutes: 30,
    capacity: 1,
    deposit_amount: 100,
    attributes: {
      specialization: 'Dental Implants & Oral Surgery',
      qualification: 'MDS (AIIMS)',
      room: 'Chamber 101',
    },
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
    attributes: {
      specialization: 'Braces & Invisible Aligners',
      qualification: 'BDS, MDS',
      room: 'Chamber 102',
    },
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

export const SALON_MERCHANT_PROVIDER: Provider = {
  id: '44444444-4444-4444-4444-444444444444',
  category_id: 'salons',
  sub_category_id: 'hair_styling',
  name: 'Naturals Luxury Salon & Spa',
  description: 'Premium hair styling, beard grooming, and rejuvenating facials by senior stylists in Tirupati.',
  address: 'Air Bypass Road, Beside Domino’s Pizza',
  city: 'Tirupati',
  latitude: 13.6355,
  longitude: 79.4123,
  phone: '+91 98765 43213',
  email: 'naturals.salon@tirupati-appointments.com',
  opening_time: '09:30:00',
  closing_time: '21:00:00',
  photos: ['https://images.unsplash.com/photo-1560066984-138dadb4c035?w=800'],
  status: 'ACTIVE',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

export const SALON_RESOURCES: Resource[] = [
  {
    id: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
    provider_id: '44444444-4444-4444-4444-444444444444',
    name: 'Stylist Vikram (Senior Hair & Beard Artist)',
    type: 'stylist',
    duration_minutes: 45,
    capacity: 1,
    deposit_amount: 75,
    attributes: {
      specialty: 'Trending Fade & Beard Sculpting',
      station: 'Styling Station 1',
    },
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'ddddddde-dddd-dddd-dddd-dddddddddddd',
    provider_id: '44444444-4444-4444-4444-444444444444',
    name: 'Stylist Kavya (Hair Spa & Makeover Specialist)',
    type: 'stylist',
    duration_minutes: 45,
    capacity: 1,
    deposit_amount: 75,
    attributes: {
      specialty: 'Hair Spa & Rejuvenation Therapy',
      station: 'Styling Station 2',
    },
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

export const INITIAL_BOOKINGS: (Booking & {
  customer_name?: string;
  customer_phone?: string;
  provider_name?: string;
  resource_name?: string;
  resource_type?: string;
})[] = [
  {
    id: 'b1111111-1111-1111-1111-111111111111',
    customer_id: 'c1',
    customer_name: 'P. Rajesh Kumar',
    customer_phone: '+91 94401 23456',
    provider_id: '11111111-1111-1111-1111-111111111111',
    provider_name: 'Sri Venkateswara Dental & Implant Care',
    resource_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    resource_name: 'Dr. S. K. Murthy (Dental Implant Specialist)',
    resource_type: 'doctor',
    slot_start: new Date(Date.now() + 1000 * 60 * 90).toISOString(), // in 1.5 hrs
    slot_end: new Date(Date.now() + 1000 * 60 * 120).toISOString(),
    status: 'CONFIRMED',
    payment_status: 'CAPTURED',
    deposit_amount: 100,
    gateway_payment_id: 'pay_RPZ_9841294',
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'b2222222-2222-2222-2222-222222222222',
    customer_id: 'c2',
    customer_name: 'K. Sneha Lata',
    customer_phone: '+91 98480 54321',
    provider_id: '11111111-1111-1111-1111-111111111111',
    provider_name: 'Sri Venkateswara Dental & Implant Care',
    resource_id: 'aaaaaaab-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    resource_name: 'Dr. A. Radhika (Orthodontics & Braces)',
    resource_type: 'doctor',
    slot_start: new Date(Date.now() + 1000 * 60 * 240).toISOString(), // in 4 hrs
    slot_end: new Date(Date.now() + 1000 * 60 * 270).toISOString(),
    status: 'CONFIRMED',
    payment_status: 'CAPTURED',
    deposit_amount: 100,
    gateway_payment_id: 'pay_RPZ_8721389',
    created_at: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'b3333333-3333-3333-3333-333333333333',
    customer_id: 'c3',
    customer_name: 'V. Naresh Babu',
    customer_phone: '+91 99887 76655',
    provider_id: '11111111-1111-1111-1111-111111111111',
    provider_name: 'Sri Venkateswara Dental & Implant Care',
    resource_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    resource_name: 'Dr. S. K. Murthy (Dental Implant Specialist)',
    resource_type: 'doctor',
    slot_start: new Date(Date.now() + 1000 * 60 * 15).toISOString(), // in 15 mins
    slot_end: new Date(Date.now() + 1000 * 60 * 45).toISOString(),
    status: 'HELD',
    payment_status: 'PENDING',
    deposit_amount: 100,
    hold_expires_at: new Date(Date.now() + 1000 * 60 * 3).toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'b4444444-4444-4444-4444-444444444444',
    customer_id: 'c4',
    customer_name: 'M. Haritha',
    customer_phone: '+91 91234 56780',
    provider_id: '11111111-1111-1111-1111-111111111111',
    provider_name: 'Sri Venkateswara Dental & Implant Care',
    resource_id: 'aaaaaaab-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    resource_name: 'Dr. A. Radhika (Orthodontics & Braces)',
    resource_type: 'doctor',
    slot_start: new Date(Date.now() - 1000 * 60 * 180).toISOString(),
    slot_end: new Date(Date.now() - 1000 * 60 * 150).toISOString(),
    status: 'COMPLETED',
    payment_status: 'CAPTURED',
    deposit_amount: 100,
    gateway_payment_id: 'pay_RPZ_6541290',
    created_at: new Date(Date.now() - 1000 * 60 * 360).toISOString(),
    updated_at: new Date().toISOString(),
  },
];

export const SALON_BOOKINGS: (Booking & {
  customer_name?: string;
  customer_phone?: string;
  provider_name?: string;
  resource_name?: string;
  resource_type?: string;
})[] = [
  {
    id: 'b5555555-5555-5555-5555-555555555551',
    customer_id: 'c5',
    customer_name: 'Divya Teja',
    customer_phone: '+91 94411 22334',
    provider_id: '44444444-4444-4444-4444-444444444444',
    provider_name: 'Naturals Luxury Salon & Spa',
    resource_id: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
    resource_name: 'Stylist Vikram (Senior Hair & Beard Artist)',
    resource_type: 'stylist',
    slot_start: new Date(Date.now() + 1000 * 60 * 60).toISOString(), // in 1 hr
    slot_end: new Date(Date.now() + 1000 * 60 * 105).toISOString(),
    status: 'CONFIRMED',
    payment_status: 'CAPTURED',
    deposit_amount: 75,
    gateway_payment_id: 'pay_RPZ_9811231',
    created_at: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'b5555555-5555-5555-5555-555555555552',
    customer_id: 'c6',
    customer_name: 'K. V. Sai Krishna',
    customer_phone: '+91 98499 55667',
    provider_id: '44444444-4444-4444-4444-444444444444',
    provider_name: 'Naturals Luxury Salon & Spa',
    resource_id: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
    resource_name: 'Stylist Vikram (Senior Hair & Beard Artist)',
    resource_type: 'stylist',
    slot_start: new Date(Date.now() + 1000 * 60 * 150).toISOString(), // in 2.5 hrs
    slot_end: new Date(Date.now() + 1000 * 60 * 195).toISOString(),
    status: 'CONFIRMED',
    payment_status: 'CAPTURED',
    deposit_amount: 75,
    gateway_payment_id: 'pay_RPZ_9811232',
    created_at: new Date(Date.now() - 1000 * 60 * 120).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'b5555555-5555-5555-5555-555555555553',
    customer_id: 'c7',
    customer_name: 'Meghana Rao',
    customer_phone: '+91 91234 98765',
    provider_id: '44444444-4444-4444-4444-444444444444',
    provider_name: 'Naturals Luxury Salon & Spa',
    resource_id: 'ddddddde-dddd-dddd-dddd-dddddddddddd',
    resource_name: 'Stylist Kavya (Hair Spa & Makeover Specialist)',
    resource_type: 'stylist',
    slot_start: new Date(Date.now() + 1000 * 60 * 210).toISOString(),
    slot_end: new Date(Date.now() + 1000 * 60 * 255).toISOString(),
    status: 'HELD',
    payment_status: 'PENDING',
    deposit_amount: 75,
    hold_expires_at: new Date(Date.now() + 1000 * 60 * 4).toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

export function getFallbackTenantData(providerId?: string | null) {
  if (providerId === SALON_MERCHANT_PROVIDER.id) {
    return {
      provider: SALON_MERCHANT_PROVIDER,
      resources: SALON_RESOURCES,
      bookings: SALON_BOOKINGS,
    };
  }
  return {
    provider: INITIAL_MERCHANT_PROVIDER,
    resources: INITIAL_RESOURCES,
    bookings: INITIAL_BOOKINGS,
  };
}
