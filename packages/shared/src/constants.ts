export const APP_CONFIG = {
  CITY: 'Tirupati',
  DEFAULT_LATITUDE: 13.6288,
  DEFAULT_LONGITUDE: 79.4192,
  DEFAULT_RADIUS_KM: 15,
  HOLD_DURATION_MINUTES: 5,
  FREE_CANCELLATION_WINDOW_HOURS: 1,
  NO_SHOW_FLAG_THRESHOLD: 4,
  CURRENCY: 'INR',
  CURRENCY_SYMBOL: '₹',
};

export const VERTICALS = [
  {
    id: 'clinics',
    name: 'Hospitals & Clinics',
    description: 'Doctors, dentists & eye specialists with zero waiting',
    icon: 'stethoscope',
    defaultDeposit: 100,
    unitName: 'Doctor',
  },
  {
    id: 'restaurants',
    name: 'Restaurants & Dining',
    description: 'Reserve AC tables & private party booths instantly',
    icon: 'utensils',
    defaultDeposit: 150,
    unitName: 'Table',
  },
  {
    id: 'gaming',
    name: 'Gaming & Turf',
    description: 'Box cricket turfs, badminton courts & VR gaming',
    icon: 'gamepad',
    defaultDeposit: 200,
    unitName: 'Court / Station',
  },
  {
    id: 'salons',
    name: 'Salons & Spas',
    description: 'Book senior stylists, hair spa & grooming chairs',
    icon: 'scissors',
    defaultDeposit: 75,
    unitName: 'Stylist Chair',
  },
  {
    id: 'pets',
    name: 'Pet Care & Clinic',
    description: 'Veterinary consultation & professional pet grooming',
    icon: 'dog',
    defaultDeposit: 100,
    unitName: 'Vet / Groomer',
  },
] as const;

/**
 * Canonical mapping from user-facing category names (singular/plural)
 * to database category_id values. Single source of truth — do not
 * duplicate this in app-level code.
 */
export const CATEGORY_MAP: Record<string, string> = {
  clinic: 'clinics',
  clinics: 'clinics',
  hospital: 'clinics',
  hospitals: 'clinics',
  salon: 'salons',
  salons: 'salons',
  spa: 'salons',
  gaming: 'gaming',
  turf: 'gaming',
  restaurant: 'restaurants',
  restaurants: 'restaurants',
  dining: 'restaurants',
  pet: 'pets',
  pets: 'pets',
};

/** Normalize a category string for comparison (lowercase, strip trailing 's') */
export function normCategory(category: string): string {
  return (category || '').toLowerCase().replace(/s$/, '');
}

/** Resolve a user-supplied category to its database category_id */
export function resolveCategoryId(input: string): string {
  return CATEGORY_MAP[input.toLowerCase()] || input;
}
