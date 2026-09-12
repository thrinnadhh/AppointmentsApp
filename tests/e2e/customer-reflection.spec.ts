import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase Client mirroring Customer Mobile App configuration
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://ynkdnwhubfknnnzjtpeg.supabase.co';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_PQ0ToJguSqBpF6eWP3aP9w_NT4hFLef';
const customerSupabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Customer Mobile App data fetching engine (mirroring apps/customer-mobile/src/services/api.ts)
async function customerFetchProvidersByCategory(categoryId?: string) {
  let query = customerSupabase
    .from('providers')
    .select('*, resources(*)')
    .eq('status', 'ACTIVE');

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
  const dbCat = categoryId && categoryId !== 'all' ? (CATEGORY_MAP[categoryId.toLowerCase()] || categoryId) : null;

  if (dbCat) {
    query = query.eq('category_id', dbCat);
  }

  const { data, error } = await query;
  if (error) throw error;
  if (!data) return [];

  // Transform into customer presentation format with localized distance & slot metadata
  return data.map((prov, idx: number) => ({
    ...prov,
    distance_km: Number((1.2 + idx * 0.7).toFixed(1)),
    next_slot: 'Today, Available',
    resources: prov.resources || [],
  }));
}

test.describe.serial('Merchant Registration to Customer Dashboard Reflection E2E', () => {
  const timestamp = Date.now();
  const testClinicName = `Tirupati Apex Ortho Hospital ${timestamp.toString().slice(-4)}`;
  const testTurfName = `Tirupati Smashers Badminton Arena ${timestamp.toString().slice(-4)}`;
  const testDoctorName = `Dr. V. Mohan, MS (Orthopedics)`;

  let createdClinicId: string;
  let createdTurfId: string;

  test('1. Should register a new Clinic via Merchant API and verify instant reflection in Customer Dashboard data layer', async ({ request }) => {
    // 1. Merchant registers a new clinic
    const registerResponse = await request.post('http://localhost:3000/api/admin/venues', {
      data: {
        name: testClinicName,
        categoryId: 'clinic', // Test singular normalization
        address: 'Bhavani Nagar, Opp. SVIMS Hospital, Tirupati',
        phone: '+91 877 2288990',
        email: `ortho.${timestamp}@tirupati.care`,
        openingTime: '08:30',
        closingTime: '21:30',
        description: 'Multi-speciality joint replacement, spine surgery, and trauma ICU.',
      },
    });

    expect(registerResponse.status()).toBe(201);
    const registerJson = await registerResponse.json();
    expect(registerJson.success).toBe(true);
    expect(registerJson.venue).toBeDefined();
    expect(registerJson.venue.id).toBeDefined();
    createdClinicId = registerJson.venue.id;

    // 2. Query the Customer Dashboard feed
    const customerFeed = await customerFetchProvidersByCategory('all');
    
    // 3. Verify the registered business is reflected in customer feed
    const reflectedVenue = customerFeed.find((v) => v.id === createdClinicId || v.name === testClinicName);
    expect(reflectedVenue).toBeDefined();
    expect(reflectedVenue?.name).toBe(testClinicName);
    expect(reflectedVenue?.category_id).toBe('clinics');
    expect(reflectedVenue?.city).toBe('Tirupati');
    expect(reflectedVenue?.address).toBe('Bhavani Nagar, Opp. SVIMS Hospital, Tirupati');
    expect(reflectedVenue?.phone).toBe('+91 877 2288990');
    expect(reflectedVenue?.status).toBe('ACTIVE');
    expect(reflectedVenue?.distance_km).toBeGreaterThan(0);
    expect(reflectedVenue?.next_slot).toBe('Today, Available');
  });

  test('2. Should assign Doctor & Department in Merchant and verify reflection in Customer Provider details', async ({ request }) => {
    expect(createdClinicId).toBeDefined();

    // 1. Merchant attaches doctor to the registered business
    const resourceResponse = await request.post('http://localhost:3000/api/admin/resources', {
      data: {
        providerId: createdClinicId,
        name: testDoctorName,
        type: 'doctor',
        department: 'Orthopedics',
        price: 800,
        depositAmount: 100,
        durationMinutes: 30,
        capacity: 1,
      },
    });

    expect(resourceResponse.status()).toBe(201);
    const resourceJson = await resourceResponse.json();
    expect(resourceJson.success).toBe(true);

    // 2. Query customer data feed for this specific category
    const clinicsFeed = await customerFetchProvidersByCategory('clinics');
    const matchedClinic = clinicsFeed.find((v) => v.id === createdClinicId);

    expect(matchedClinic).toBeDefined();
    expect(matchedClinic?.resources).toBeDefined();
    expect(matchedClinic?.resources.length).toBeGreaterThanOrEqual(1);

    const matchedDoctor = matchedClinic?.resources.find((r: { name: string }) => r.name === testDoctorName);
    expect(matchedDoctor).toBeDefined();
    expect(matchedDoctor?.department).toBe('Orthopedics');
    expect(Number(matchedDoctor?.price)).toBe(800);
    expect(Number(matchedDoctor?.deposit_amount)).toBe(100);
  });

  test('3. Should verify Category Isolation: Clinic appears in Clinics feed and NOT in Gaming feed', async () => {
    // 1. Fetch clinics feed -> must include the registered clinic
    const clinicsFeed = await customerFetchProvidersByCategory('clinics');
    expect(clinicsFeed.some((v) => v.id === createdClinicId)).toBe(true);

    // 2. Fetch gaming feed -> MUST NOT include the clinic
    const gamingFeed = await customerFetchProvidersByCategory('gaming');
    expect(gamingFeed.some((v) => v.id === createdClinicId)).toBe(false);

    // 3. Fetch salons feed -> MUST NOT include the clinic
    const salonsFeed = await customerFetchProvidersByCategory('salons');
    expect(salonsFeed.some((v) => v.id === createdClinicId)).toBe(false);
  });

  test('4. Should register a Sports Turf and verify it reflects under Gaming in Customer Dashboard', async ({ request }) => {
    // 1. Register sports turf
    const turfResponse = await request.post('http://localhost:3000/api/admin/venues', {
      data: {
        name: testTurfName,
        categoryId: 'gaming',
        address: 'RC Road, Near Alipiri Tollgate, Tirupati',
        phone: '+91 94400 11223',
        openingTime: '06:00',
        closingTime: '23:00',
        description: 'BWF standard indoor badminton courts with wooden synthetic shock absorption.',
      },
    });

    expect(turfResponse.status()).toBe(201);
    const turfJson = await turfResponse.json();
    createdTurfId = turfJson.venue.id;

    // 2. Add court resource to the turf
    await request.post('http://localhost:3000/api/admin/resources', {
      data: {
        providerId: createdTurfId,
        name: 'Court 1 (Yonex Pro Mat)',
        type: 'court',
        department: 'Badminton',
        price: 400,
        depositAmount: 150,
        durationMinutes: 60,
        capacity: 4,
      },
    });

    // 3. Query Customer Gaming feed
    const gamingFeed = await customerFetchProvidersByCategory('gaming');
    const reflectedTurf = gamingFeed.find((v) => v.id === createdTurfId);

    expect(reflectedTurf).toBeDefined();
    expect(reflectedTurf?.name).toBe(testTurfName);
    expect(reflectedTurf?.category_id).toBe('gaming');
    expect(reflectedTurf?.resources.length).toBeGreaterThanOrEqual(1);
    expect(reflectedTurf?.resources[0].name).toBe('Court 1 (Yonex Pro Mat)');

    // 4. Verify Turf does not leak into Clinics
    const clinicsFeed = await customerFetchProvidersByCategory('clinics');
    expect(clinicsFeed.some((v) => v.id === createdTurfId)).toBe(false);
  });

  test('5. Should validate Customer HomeScreen UI Contract', async () => {
    const feed = await customerFetchProvidersByCategory('all');
    expect(feed.length).toBeGreaterThan(0);

    for (const venue of feed) {
      // Contract fields required by HomeScreen.tsx component
      expect(typeof venue.id).toBe('string');
      expect(typeof venue.name).toBe('string');
      expect(typeof venue.address).toBe('string');
      expect(typeof venue.category_id).toBe('string');
      expect(typeof venue.distance_km).toBe('number');
      expect(typeof venue.next_slot).toBe('string');
      expect(Array.isArray(venue.resources)).toBe(true);
    }
  });

  test('6. Should verify PostGIS spatial RPC get_nearby_providers calculates distance and sorts by proximity', async () => {
    // Call Supabase PostGIS spatial RPC from Tirupati town center (13.6288, 79.4192)
    const { data, error } = await customerSupabase.rpc('get_nearby_providers', {
      p_lat: 13.6288,
      p_lng: 79.4192,
      p_category: 'clinics',
      p_radius_meters: 50000,
    });

    expect(error).toBeNull();
    expect(data).toBeDefined();
    const providers = data as Array<{
      id: string;
      name: string;
      category_id: string;
      distance_meters: number;
      distance_km: number;
      resources: unknown[];
    }>;
    expect(providers.length).toBeGreaterThan(0);

    // Verify distance calculation and ascending proximity sort
    let previousDistance = -1;
    for (const p of providers) {
      expect(p.distance_meters).toBeGreaterThanOrEqual(0);
      expect(p.distance_km).toBeGreaterThanOrEqual(0);
      expect(p.distance_meters).toBeGreaterThanOrEqual(previousDistance);
      expect(Array.isArray(p.resources)).toBe(true);
      previousDistance = p.distance_meters;
    }
  });

  test('7. Should verify Supabase Storage Phase 3: Public venue-assets bucket & private prescriptions bucket with signed URLs', async () => {
    const testFileName = `test_storefront_${Date.now()}.png`;
    // Minimal 1x1 transparent PNG binary
    const pngBuffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

    // 1. Upload public venue asset (image/png)
    const { data: uploadVenueData, error: uploadVenueError } = await customerSupabase.storage
      .from('venue-assets')
      .upload(`test-venue/${testFileName}`, pngBuffer, {
        contentType: 'image/png',
        upsert: true,
      });

    expect(uploadVenueError).toBeNull();
    expect(uploadVenueData?.path).toBeDefined();

    // 2. Verify public URL generation
    const { data: publicUrlData } = customerSupabase.storage
      .from('venue-assets')
      .getPublicUrl(uploadVenueData!.path);

    expect(publicUrlData.publicUrl).toContain('venue-assets');

    // 3. Upload private patient prescription (application/pdf)
    const rxFileName = `test_rx_${Date.now()}.pdf`;
    const rxPath = `99999999-9999-9999-9999-999999999991/${rxFileName}`;
    const pdfBuffer = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');
    const { data: uploadRxData, error: uploadRxError } = await customerSupabase.storage
      .from('prescriptions-and-records')
      .upload(rxPath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    expect(uploadRxError).toBeNull();
    expect(uploadRxData?.path).toBe(rxPath);

    // 4. Generate time-limited signed URL for private record
    const { data: signedUrlData, error: signedUrlError } = await customerSupabase.storage
      .from('prescriptions-and-records')
      .createSignedUrl(rxPath, 60);

    expect(signedUrlError).toBeNull();
    expect(signedUrlData?.signedUrl).toBeDefined();
    expect(signedUrlData?.signedUrl).toContain('token=');

    // Clean up test objects
    await customerSupabase.storage.from('venue-assets').remove([uploadVenueData!.path]);
    await customerSupabase.storage.from('prescriptions-and-records').remove([rxPath]);
  });

  test('8. Should verify Supabase Phone OTP Authentication, Verification & Profile Auto-Linking flow', async ({ page }) => {
    const testPhone = '+919999999991';
    const testOtp = '123456';

    // 1. Backend Verification: Supabase Auth OTP request and verification
    const { error: otpSendError } = await customerSupabase.auth.signInWithOtp({ phone: testPhone });
    expect(otpSendError).toBeNull();

    const { data: verifyData, error: verifyError } = await customerSupabase.auth.verifyOtp({
      phone: testPhone,
      token: testOtp,
      type: 'sms',
    });
    expect(verifyError).toBeNull();
    expect(verifyData.session).toBeDefined();
    expect(verifyData.user).toBeDefined();
    expect(verifyData.user?.phone).toContain('9999999991');

    // 2. Verify public.profiles auto-linking trigger / profile existence
    const { data: profileRow, error: profileError } = await customerSupabase
      .from('profiles')
      .select('*')
      .eq('id', verifyData.user!.id)
      .single();

    expect(profileError).toBeNull();
    expect(profileRow).toBeDefined();
    expect(profileRow.role).toBe('customer');

    // 3. UI Verification: Customer Mobile App Phone OTP Sign In
    await page.goto('http://localhost:8081');
    await page.waitForLoadState('networkidle');

    // Open Profile Modal
    const profileBtn = page.getByLabel('Customer Profile');
    await expect(profileBtn).toBeVisible({ timeout: 10000 });
    await profileBtn.click();

    // Verify modal elements
    await expect(page.getByText('Customer Profile & Sign In')).toBeVisible();
    await expect(page.getByText('1-Tap Phone OTP Authentication')).toBeVisible();

    // Check Send OTP button
    const sendOtpBtn = page.getByTestId('btn-send-otp');
    if (await sendOtpBtn.isVisible()) {
      await page.waitForTimeout(1500);
      await sendOtpBtn.click();

      // Verify OTP Code Input appears
      const otpInput = page.getByTestId('input-otp-code');
      await expect(otpInput).toBeVisible();
      await otpInput.fill(testOtp);

      // Click Verify
      const verifyBtn = page.getByTestId('btn-verify-otp');
      await verifyBtn.click();

      // Expect Verified state
      await expect(page.getByText('✅ Verified')).toBeVisible();
      await expect(page.getByTestId('btn-sign-out')).toBeVisible();

      // Click Sign Out
      await page.getByTestId('btn-sign-out').click();
      await expect(page.getByText('⚡ Guest')).toBeVisible();
    } else {
      // If already authenticated from previous session, verify sign out works
      const signOutBtn = page.getByTestId('btn-sign-out');
      await expect(signOutBtn).toBeVisible();
      await signOutBtn.click();
      await expect(page.getByText('⚡ Guest')).toBeVisible();
    }

    // Clean up Supabase session
    await customerSupabase.auth.signOut();
  });

  test('9. Phase 4 Feature 7: Automated WhatsApp & SMS Notifications and 1-Hour & 30-Minute Reminders', async ({ page, request }) => {
    // 1. Fetch any confirmed booking
    const { data: bookings, error: bookingsError } = await customerSupabase
      .from('bookings')
      .select('id, reference_code, customer_id, provider_id')
      .eq('status', 'CONFIRMED')
      .limit(1);

    expect(bookingsError).toBeNull();
    expect(bookings && bookings.length > 0).toBeTruthy();
    const testBooking = bookings![0];

    // 2. Dispatch BOOKING_CONFIRMED notification via admin API
    const notifyRes = await request.post('http://localhost:3000/api/admin/notifications', {
      data: {
        booking_id: testBooking.id,
        event_type: 'BOOKING_CONFIRMED',
      },
    });
    expect(notifyRes.status()).toBe(200);
    const notifyJson = await notifyRes.json();
    expect(notifyJson.success).toBe(true);
    expect(notifyJson.dispatch.success).toBe(true);
    expect(notifyJson.dispatch.recipient_phone).toBeDefined();

    // 3. Verify notification_logs in Supabase contains both WhatsApp and SMS records
    const logsRes = await request.get(`http://localhost:3000/api/admin/notifications?bookingId=${testBooking.id}`);
    expect(logsRes.status()).toBe(200);
    const logsJson = await logsRes.json();
    expect(logsJson.success).toBe(true);
    const confirmedLogs = (logsJson.notifications as Array<{ channel: string; event_type: string }>).filter(
      (l) => l.event_type === 'BOOKING_CONFIRMED'
    );
    const channels = confirmedLogs.map((l) => l.channel);
    expect(channels).toContain('whatsapp');
    expect(channels).toContain('sms');

    // 4. Test 1-Hour and 30-Minute Reminders trigger
    // Update booking slot_start to 50 mins from now to test 1-hour window (40-75 min)
    const setSlotRes1 = await request.post('http://localhost:3000/api/admin/notifications', {
      data: {
        action: 'set_slot_time',
        booking_id: testBooking.id,
        minutes_from_now: 50,
      },
    });
    expect(setSlotRes1.status()).toBe(200);

    // Call check_reminders API
    const reminderRes1 = await request.post('http://localhost:3000/api/admin/notifications', {
      data: { action: 'check_reminders' },
    });
    expect(reminderRes1.status()).toBe(200);

    // Verify 1-hour reminder logged
    const logsRes1h = await request.get(`http://localhost:3000/api/admin/notifications?bookingId=${testBooking.id}`);
    const logsJson1h = await logsRes1h.json();
    const reminder1hLogs = (logsJson1h.notifications as Array<{ event_type: string }>).filter(
      (l) => l.event_type === 'BOOKING_REMINDER_1H'
    );
    expect(reminder1hLogs.length).toBeGreaterThan(0);

    // Update booking slot_start to 20 mins from now to test 30-minute window (10-35 min)
    const setSlotRes2 = await request.post('http://localhost:3000/api/admin/notifications', {
      data: {
        action: 'set_slot_time',
        booking_id: testBooking.id,
        minutes_from_now: 20,
      },
    });
    expect(setSlotRes2.status()).toBe(200);

    const reminderRes2 = await request.post('http://localhost:3000/api/admin/notifications', {
      data: { action: 'check_reminders' },
    });
    expect(reminderRes2.status()).toBe(200);

    // Verify 30-minute reminder logged
    const logsRes30m = await request.get(`http://localhost:3000/api/admin/notifications?bookingId=${testBooking.id}`);
    const logsJson30m = await logsRes30m.json();
    const reminder30mLogs = (logsJson30m.notifications as Array<{ event_type: string }>).filter(
      (l) => l.event_type === 'BOOKING_REMINDER_30M'
    );
    expect(reminder30mLogs.length).toBeGreaterThan(0);

    // 5. Test Cancellation notification dispatch
    const cancelRes = await request.post('http://localhost:3000/api/admin/notifications', {
      data: {
        booking_id: testBooking.id,
        event_type: 'BOOKING_CANCELLED',
      },
    });
    expect(cancelRes.status()).toBe(200);

    // 6. UI Verification in Merchant Web Bookings Queue
    await page.goto('http://localhost:3000/bookings');
    await page.waitForLoadState('networkidle');

    // Find and click the WA/SMS Logs button
    const logsBtn = page.getByRole('button', { name: /WA\/SMS Logs/i }).first();
    await expect(logsBtn).toBeVisible({ timeout: 10000 });
    await logsBtn.click();

    // Verify WhatsApp & SMS modal appears
    await expect(page.getByText('WhatsApp & SMS Communications')).toBeVisible();

    // Close modal
    const closeBtn = page.getByRole('button', { name: 'Close', exact: true });
    await closeBtn.click();
    await expect(page.getByText('WhatsApp & SMS Communications')).not.toBeVisible();
  });
});


