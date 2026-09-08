-- Hyperlocal Booking Platform MVP v1 - Tirupati Seed Data

-- 1. Insert Categories
INSERT INTO public.categories (id, name, icon, display_order) VALUES
('clinics', 'Hospitals & Clinics', 'Stethoscope', 1),
('restaurants', 'Restaurants & Dining', 'Utensils', 2),
('gaming', 'Gaming & Turf', 'Gamepad2', 3),
('salons', 'Salons & Spas', 'Scissors', 4),
('pets', 'Pet Care & Clinic', 'Dog', 5)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, icon = EXCLUDED.icon;

-- 2. Insert Sub-Categories
INSERT INTO public.sub_categories (id, category_id, name, display_order) VALUES
('dental', 'clinics', 'Dental Clinic', 1),
('eye', 'clinics', 'Eye Specialist', 2),
('general_physician', 'clinics', 'General Physician', 3),
('fine_dining', 'restaurants', 'Fine Dining', 1),
('cafe', 'restaurants', 'Cafe & Bistro', 2),
('box_cricket', 'gaming', 'Box Cricket Turf', 1),
('badminton', 'gaming', 'Badminton Court', 2),
('console_vr', 'gaming', 'VR & Console Gaming', 3),
('hair_styling', 'salons', 'Haircut & Styling', 1),
('beauty_spa', 'salons', 'Beauty & Spa', 2),
('pet_hospital', 'pets', 'Veterinary Hospital', 1),
('pet_grooming', 'pets', 'Pet Grooming & Spa', 2)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

-- 3. Insert Verified Providers in Tirupati
-- Provider 1: Dental Clinic
INSERT INTO public.providers (
    id, category_id, sub_category_id, name, description, address, city, latitude, longitude, phone, email, opening_time, closing_time, photos, status
) VALUES (
    '11111111-1111-1111-1111-111111111111',
    'clinics',
    'dental',
    'Sri Venkateswara Dental & Implant Care',
    'Comprehensive oral surgery, smile design, and pediatric dental services in central Tirupati.',
    'Shop 12, Bhavani Nagar, Near RTC Bus Stand',
    'Tirupati',
    13.6328000,
    79.4197000,
    '+919876543210',
    'svdental@example.com',
    '09:00:00',
    '20:00:00',
    ARRAY['https://images.unsplash.com/photo-1629909613654-28e377c37b09?w=800'],
    'ACTIVE'
) ON CONFLICT (id) DO NOTHING;

-- Provider 2: Restaurant
INSERT INTO public.providers (
    id, category_id, sub_category_id, name, description, address, city, latitude, longitude, phone, email, opening_time, closing_time, photos, status
) VALUES (
    '22222222-2222-2222-2222-222222222222',
    'restaurants',
    'fine_dining',
    'Saptagiri Heritage Dining',
    'Authentic South Indian thalis and multi-cuisine table reservations with zero waiting.',
    'Renigunta Road, Opp. Reliance Trends',
    'Tirupati',
    13.6288000,
    79.4285000,
    '+919876543211',
    'dining@saptagiri.example.com',
    '11:30:00',
    '22:30:00',
    ARRAY['https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=800'],
    'ACTIVE'
) ON CONFLICT (id) DO NOTHING;

-- Provider 3: Turf & Box Cricket
INSERT INTO public.providers (
    id, category_id, sub_category_id, name, description, address, city, latitude, longitude, phone, email, opening_time, closing_time, photos, status
) VALUES (
    '33333333-3333-3333-3333-333333333333',
    'gaming',
    'box_cricket',
    'Tirupati Premier Turf & Gaming Arena',
    'FIFA-standard turf with floodlights for Box Cricket and 5-a-side Football.',
    'Korlagunta Main Road, Near Reliance Mart',
    'Tirupati',
    13.6412000,
    79.4310000,
    '+919876543212',
    'turf@tirupatipremier.com',
    '06:00:00',
    '23:00:00',
    ARRAY['https://images.unsplash.com/photo-1574629810360-7efbbe195018?w=800'],
    'ACTIVE'
) ON CONFLICT (id) DO NOTHING;

-- Provider 4: Salon & Spa
INSERT INTO public.providers (
    id, category_id, sub_category_id, name, description, address, city, latitude, longitude, phone, email, opening_time, closing_time, photos, status
) VALUES (
    '44444444-4444-4444-4444-444444444444',
    'salons',
    'hair_styling',
    'Elite Looks Luxury Salon',
    'Premium hair styling, beard grooming, and rejuvenating facials by senior stylists.',
    'Air Bypass Road, Beside Domino’s Pizza',
    'Tirupati',
    13.6355000,
    79.4123000,
    '+919876543213',
    'appointments@elitelooks.com',
    '09:30:00',
    '21:00:00',
    ARRAY['https://images.unsplash.com/photo-1560066984-138dadb4c035?w=800'],
    'ACTIVE'
) ON CONFLICT (id) DO NOTHING;

-- Provider 5: Pet Care & Hospital
INSERT INTO public.providers (
    id, category_id, sub_category_id, name, description, address, city, latitude, longitude, phone, email, opening_time, closing_time, photos, status
) VALUES (
    '55555555-5555-5555-5555-555555555555',
    'pets',
    'pet_hospital',
    'Tirumala Pet Clinic & Grooming Spa',
    'Professional veterinary consultations, vaccination schedules, and dog grooming suites.',
    'Alipiri Bypass Road, Near Balaji Colony',
    'Tirupati',
    13.6450000,
    79.4080000,
    '+919876543214',
    'care@tirumalapets.com',
    '09:00:00',
    '20:00:00',
    ARRAY['https://images.unsplash.com/photo-1583337130417-3346a1be7dee?w=800'],
    'ACTIVE'
) ON CONFLICT (id) DO NOTHING;

-- 4. Insert Resources under each provider with realistic deposit amounts
INSERT INTO public.resources (id, provider_id, name, type, duration_minutes, capacity, deposit_amount, attributes) VALUES
-- Clinic Resources
('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'Dr. S. K. Murthy, MDS (Implantologist)', 'doctor', 30, 1, 100.00, '{"specialization": "Dental Implants & Surgery", "experience_years": 14}'),
('aaaaaaab-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'Dr. Ananya Reddy (Orthodontist)', 'doctor', 30, 1, 100.00, '{"specialization": "Braces & Aligners", "experience_years": 8}'),

-- Restaurant Resources (Tables)
('bbbbbbba-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'Family AC Booth (4 Seater)', 'table', 60, 4, 150.00, '{"seating_capacity": 4, "area": "AC Family Hall"}'),
('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'Celebration Table (8 Seater)', 'table', 90, 8, 200.00, '{"seating_capacity": 8, "area": "Private Terrace"}'),

-- Turf Resources
('cccccccc-cccc-cccc-cccc-cccccccccccc', '33333333-3333-3333-3333-333333333333', 'Pitch 1 (Box Cricket)', 'court', 60, 14, 200.00, '{"surface": "Imported Astroturf", "lights": "Floodlight 1000W"}'),

-- Salon Resources
('dddddddd-dddd-dddd-dddd-dddddddddddd', '44444444-4444-4444-4444-444444444444', 'Stylist Chair 1 (Master Stylist Vikram)', 'stylist', 45, 1, 75.00, '{"specialty": "Trending Fade & Beard Sculpting"}'),
('ddddddde-dddd-dddd-dddd-dddddddddddd', '44444444-4444-4444-4444-444444444444', 'Stylist Chair 2 (Senior Stylist Kavya)', 'stylist', 45, 1, 75.00, '{"specialty": "Hair Spa & Coloring"}'),

-- Pet Care Resources
('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '55555555-5555-5555-5555-555555555555', 'Dr. K. Srinivas (Veterinary Surgeon)', 'vet', 30, 1, 100.00, '{"qualification": "BVSc & AH", "services": "Consultation, Vaccination"}'),
('eeeeeeef-eeee-eeee-eeee-eeeeeeeeeeee', '55555555-5555-5555-5555-555555555555', 'Full Dog Grooming & Bath Suite', 'groomer', 60, 1, 150.00, '{"services": "Deep Bath, De-shedding, Nail Clipping"}')
ON CONFLICT (id) DO NOTHING;

-- 5. Insert Weekly Availability Schedules (Mon-Sat, 10:00 to 19:00 for doctor, etc.)
INSERT INTO public.resource_availability (resource_id, day_of_week, start_time, end_time, slot_interval_minutes)
SELECT r.id, d.day, '10:00:00'::TIME, '19:00:00'::TIME, r.duration_minutes
FROM public.resources r
CROSS JOIN (VALUES (1), (2), (3), (4), (5), (6)) AS d(day)
ON CONFLICT DO NOTHING;
