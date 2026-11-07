import pg from 'pg';

const { Pool } = pg;

export const FIXTURE_IDS = {
  // Cities
  CITY_TIRUPATI: 'tirupati',
  CITY_OTHER: 'nellore',

  // Users (auth.users & profiles)
  CUSTOMER_A: 'a0000000-0000-0000-0000-000000000001',
  CUSTOMER_B: 'a0000000-0000-0000-0000-000000000002',
  MERCHANT_1: 'a0000000-0000-0000-0000-000000000003',
  MERCHANT_2: 'a0000000-0000-0000-0000-000000000004',
  HOSP_ADMIN_H1: 'a0000000-0000-0000-0000-000000000005',
  HOSP_ADMIN_H2: 'a0000000-0000-0000-0000-000000000006',
  DESK_ASSIGNED: 'a0000000-0000-0000-0000-000000000007',
  DESK_UNASSIGNED: 'a0000000-0000-0000-0000-000000000008',
  DOCTOR_H1: 'a0000000-0000-0000-0000-000000000009',
  DOCTOR_H2: 'a0000000-0000-0000-0000-000000000010',
  CITY_DIR: 'a0000000-0000-0000-0000-000000000011',
  PLATFORM_ADMIN: 'a0000000-0000-0000-0000-000000000012',

  // Providers (Hospitals & Non-hospital Merchants)
  PROVIDER_H1: 'b0000000-0000-0000-0000-000000000001',
  PROVIDER_H2: 'b0000000-0000-0000-0000-000000000002',
  PROVIDER_MERCH1: 'b0000000-0000-0000-0000-000000000003',
  PROVIDER_MERCH2: 'b0000000-0000-0000-0000-000000000004',

  // Departments
  DEPT_H1: 'c0000000-0000-0000-0000-000000000001',
  DEPT_H2: 'c0000000-0000-0000-0000-000000000002',

  // Resources
  RESOURCE_H1: 'd0000000-0000-0000-0000-000000000001',
  RESOURCE_H2: 'd0000000-0000-0000-0000-000000000002',
  RESOURCE_MERCH1: 'd0000000-0000-0000-0000-000000000003',
  RESOURCE_MERCH2: 'd0000000-0000-0000-0000-000000000004',

  // Bookings
  BOOKING_CUSTA_H1: 'e0000000-0000-0000-0000-000000000001',
  BOOKING_CUSTB_H2: 'e0000000-0000-0000-0000-000000000002',

  // Notifications
  NOTIF_CUSTA: 'f0000000-0000-0000-0000-000000000001',
  NOTIF_CUSTB: 'f0000000-0000-0000-0000-000000000002',

  // Push Tokens
  PUSH_CUSTA: 'f1000000-0000-0000-0000-000000000001',
  PUSH_CUSTB: 'f1000000-0000-0000-0000-000000000002',

  // City Settlements
  SETTLEMENT_TIRUPATI: 'f2000000-0000-0000-0000-000000000001',
  SETTLEMENT_OTHER: 'f2000000-0000-0000-0000-000000000002',

  // City Waitlist
  WAITLIST_ROW: 'f3000000-0000-0000-0000-000000000001',

  // Merchant Memberships
  MEMBERSHIP_MERCH1: 'f4000000-0000-0000-0000-000000000001',
  MEMBERSHIP_MERCH2: 'f4000000-0000-0000-0000-000000000002',

  // Department Members
  DEPT_MEMBER_DOC_H1: 'f5000000-0000-0000-0000-000000000001',
  DEPT_MEMBER_DESK_H1: 'f5000000-0000-0000-0000-000000000002',
  DEPT_MEMBER_DESK_UNASSIGNED_H1: 'f5000000-0000-0000-0000-000000000003',

  // Doctor Front Desk Assignments
  ASSIGNMENT_DESK_H1: 'f6000000-0000-0000-0000-000000000001',
};

export async function setupAccessMatrixFixture(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Ensure we run with superuser privileges
    await client.query("SET LOCAL app.trusted_write = 'true'");

    // 1. Ensure Cities exist
    await client.query(`
      INSERT INTO public.cities (id, name, state, status, latitude, longitude)
      VALUES 
        ('${FIXTURE_IDS.CITY_TIRUPATI}', 'Tirupati', 'Andhra Pradesh', 'ACTIVE', 13.6288, 79.4192),
        ('${FIXTURE_IDS.CITY_OTHER}', 'Nellore', 'Andhra Pradesh', 'PLANNED', 14.4426, 79.9865)
      ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status;
    `);

    // 2. Ensure Users exist in auth.users and public.profiles
    const users = [
      { id: FIXTURE_IDS.CUSTOMER_A, email: 'matrix.customer.a@test.local', role: 'customer', name: 'Matrix Customer A' },
      { id: FIXTURE_IDS.CUSTOMER_B, email: 'matrix.customer.b@test.local', role: 'customer', name: 'Matrix Customer B' },
      { id: FIXTURE_IDS.MERCHANT_1, email: 'matrix.merchant.1@test.local', role: 'merchant', name: 'Matrix Merchant 1' },
      { id: FIXTURE_IDS.MERCHANT_2, email: 'matrix.merchant.2@test.local', role: 'merchant', name: 'Matrix Merchant 2' },
      { id: FIXTURE_IDS.HOSP_ADMIN_H1, email: 'matrix.admin.h1@test.local', role: 'merchant', name: 'Matrix Admin H1' },
      { id: FIXTURE_IDS.HOSP_ADMIN_H2, email: 'matrix.admin.h2@test.local', role: 'merchant', name: 'Matrix Admin H2' },
      { id: FIXTURE_IDS.DESK_ASSIGNED, email: 'matrix.desk.assigned@test.local', role: 'merchant', name: 'Matrix Desk Assigned' },
      { id: FIXTURE_IDS.DESK_UNASSIGNED, email: 'matrix.desk.unassigned@test.local', role: 'merchant', name: 'Matrix Desk Unassigned' },
      { id: FIXTURE_IDS.DOCTOR_H1, email: 'matrix.doc.h1@test.local', role: 'merchant', name: 'Matrix Doctor H1' },
      { id: FIXTURE_IDS.DOCTOR_H2, email: 'matrix.doc.h2@test.local', role: 'merchant', name: 'Matrix Doctor H2' },
      { id: FIXTURE_IDS.CITY_DIR, email: 'matrix.director@test.local', role: 'city_director', name: 'Matrix City Director', assigned_city_id: FIXTURE_IDS.CITY_TIRUPATI },
      { id: FIXTURE_IDS.PLATFORM_ADMIN, email: 'matrix.platform.admin@test.local', role: 'admin', name: 'Matrix Platform Admin' },
    ];

    for (const u of users) {
      await client.query(`
        INSERT INTO auth.users (
          id, aud, role, email, encrypted_password, email_confirmed_at,
          raw_app_meta_data, raw_user_meta_data, created_at, updated_at
        )
        VALUES (
          $1::uuid, 'authenticated', 'authenticated', $2::text, 'encrypted_test_pwd', now(),
          jsonb_build_object('provider', 'email', 'providers', array['email']),
          jsonb_build_object('role', $3::text, 'full_name', $4::text),
          now(), now()
        )
        ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;
      `, [u.id, u.email, u.role, u.name]);

      await client.query(`
        INSERT INTO public.profiles (id, role, full_name, email, assigned_city_id, updated_at)
        VALUES ($1::uuid, $2::public.user_role, $3::text, $4::text, $5::text, now())
        ON CONFLICT (id) DO UPDATE SET
          role = EXCLUDED.role,
          full_name = EXCLUDED.full_name,
          email = EXCLUDED.email,
          assigned_city_id = EXCLUDED.assigned_city_id;
      `, [u.id, u.role, u.name, u.email, u.assigned_city_id || null]);
    }

    // 3. Providers
    // H1 and H2 are hospital vertical; MERCH1 and MERCH2 are salon vertical
    await client.query(`
      INSERT INTO public.providers (id, name, owner_id, status, is_active, city, category_id, address, phone, latitude, longitude)
      VALUES
        ('${FIXTURE_IDS.PROVIDER_H1}', 'Matrix Hospital 1', '${FIXTURE_IDS.HOSP_ADMIN_H1}', 'ACTIVE', true, '${FIXTURE_IDS.CITY_TIRUPATI}', 'clinics', 'Medical Rd 1', '+919999900001', 13.6288, 79.4192),
        ('${FIXTURE_IDS.PROVIDER_H2}', 'Matrix Hospital 2', '${FIXTURE_IDS.HOSP_ADMIN_H2}', 'ACTIVE', true, '${FIXTURE_IDS.CITY_TIRUPATI}', 'clinics', 'Medical Rd 2', '+919999900002', 13.6288, 79.4192),
        ('${FIXTURE_IDS.PROVIDER_MERCH1}', 'Matrix Salon 1', '${FIXTURE_IDS.MERCHANT_1}', 'ACTIVE', true, '${FIXTURE_IDS.CITY_TIRUPATI}', 'salons', 'Market Rd 1', '+919999900003', 13.6288, 79.4192),
        ('${FIXTURE_IDS.PROVIDER_MERCH2}', 'Matrix Salon 2', '${FIXTURE_IDS.MERCHANT_2}', 'ACTIVE', true, '${FIXTURE_IDS.CITY_TIRUPATI}', 'salons', 'Market Rd 2', '+919999900004', 13.6288, 79.4192)
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, owner_id = EXCLUDED.owner_id, status = EXCLUDED.status;
    `);

    // 4. Departments
    await client.query(`
      INSERT INTO public.departments (id, merchant_id, name, allowed_modules)
      VALUES
        ('${FIXTURE_IDS.DEPT_H1}', '${FIXTURE_IDS.PROVIDER_H1}', 'General Medicine H1', ARRAY['appointments', 'queue_schedule', 'check_in']),
        ('${FIXTURE_IDS.DEPT_H2}', '${FIXTURE_IDS.PROVIDER_H2}', 'General Medicine H2', ARRAY['appointments', 'queue_schedule', 'check_in'])
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, merchant_id = EXCLUDED.merchant_id;
    `);

    // 5. Resources
    await client.query(`
      INSERT INTO public.resources (id, provider_id, name, type, is_active)
      VALUES
        ('${FIXTURE_IDS.RESOURCE_H1}', '${FIXTURE_IDS.PROVIDER_H1}', 'Dr. Matrix H1', 'doctor', true),
        ('${FIXTURE_IDS.RESOURCE_H2}', '${FIXTURE_IDS.PROVIDER_H2}', 'Dr. Matrix H2', 'doctor', true),
        ('${FIXTURE_IDS.RESOURCE_MERCH1}', '${FIXTURE_IDS.PROVIDER_MERCH1}', 'Stylist 1', 'staff', true),
        ('${FIXTURE_IDS.RESOURCE_MERCH2}', '${FIXTURE_IDS.PROVIDER_MERCH2}', 'Stylist 2', 'staff', true)
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, is_active = EXCLUDED.is_active;
    `);

    // 6. Department Members
    await client.query(`
      INSERT INTO public.department_members (id, department_id, merchant_id, user_id, role, status, email)
      VALUES
        ('${FIXTURE_IDS.DEPT_MEMBER_DOC_H1}', '${FIXTURE_IDS.DEPT_H1}', '${FIXTURE_IDS.PROVIDER_H1}', '${FIXTURE_IDS.DOCTOR_H1}', 'consultant', 'active', 'matrix.doc.h1@test.local'),
        ('${FIXTURE_IDS.DEPT_MEMBER_DESK_H1}', '${FIXTURE_IDS.DEPT_H1}', '${FIXTURE_IDS.PROVIDER_H1}', '${FIXTURE_IDS.DESK_ASSIGNED}', 'front_desk', 'active', 'matrix.desk.assigned@test.local'),
        ('${FIXTURE_IDS.DEPT_MEMBER_DESK_UNASSIGNED_H1}', '${FIXTURE_IDS.DEPT_H1}', '${FIXTURE_IDS.PROVIDER_H1}', '${FIXTURE_IDS.DESK_UNASSIGNED}', 'front_desk', 'active', 'matrix.desk.unassigned@test.local')
      ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status;
    `);

    // 7. Doctor Front Desk Assignment
    await client.query(`
      INSERT INTO public.doctor_front_desk_assignments (id, provider_id, doctor_id, user_id)
      VALUES
        ('${FIXTURE_IDS.ASSIGNMENT_DESK_H1}', '${FIXTURE_IDS.PROVIDER_H1}', '${FIXTURE_IDS.RESOURCE_H1}', '${FIXTURE_IDS.DESK_ASSIGNED}')
      ON CONFLICT (id) DO UPDATE SET doctor_id = EXCLUDED.doctor_id, user_id = EXCLUDED.user_id;
    `);

    // 8. Merchant Memberships
    await client.query(`
      INSERT INTO public.merchant_memberships (id, provider_id, user_id, role)
      VALUES
        ('${FIXTURE_IDS.MEMBERSHIP_MERCH1}', '${FIXTURE_IDS.PROVIDER_MERCH1}', '${FIXTURE_IDS.MERCHANT_1}', 'owner'),
        ('${FIXTURE_IDS.MEMBERSHIP_MERCH2}', '${FIXTURE_IDS.PROVIDER_MERCH2}', '${FIXTURE_IDS.MERCHANT_2}', 'owner')
      ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
    `);

    // 9. Bookings
    await client.query(`
      INSERT INTO public.bookings (
        id, customer_id, provider_id, resource_id, department_id,
        slot_start, slot_end, status, deposit_amount, payment_status
      )
      VALUES
        (
          '${FIXTURE_IDS.BOOKING_CUSTA_H1}', '${FIXTURE_IDS.CUSTOMER_A}', '${FIXTURE_IDS.PROVIDER_H1}',
          '${FIXTURE_IDS.RESOURCE_H1}', '${FIXTURE_IDS.DEPT_H1}',
          now() + interval '1 day', now() + interval '1 day 30 minutes', 'CONFIRMED', 100.00, 'CAPTURED'
        ),
        (
          '${FIXTURE_IDS.BOOKING_CUSTB_H2}', '${FIXTURE_IDS.CUSTOMER_B}', '${FIXTURE_IDS.PROVIDER_H2}',
          '${FIXTURE_IDS.RESOURCE_H2}', '${FIXTURE_IDS.DEPT_H2}',
          now() + interval '1 day', now() + interval '1 day 30 minutes', 'CONFIRMED', 100.00, 'CAPTURED'
        )
      ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status;
    `);

    // 10. Notification Logs
    await client.query(`
      INSERT INTO public.notification_logs (id, booking_id, recipient_phone, recipient_name, event_type, channel, status, message_content)
      VALUES
        ('${FIXTURE_IDS.NOTIF_CUSTA}', '${FIXTURE_IDS.BOOKING_CUSTA_H1}', '+919999900001', 'Customer A', 'booking_confirmed', 'sms', 'SENT', 'Your booking is confirmed'),
        ('${FIXTURE_IDS.NOTIF_CUSTB}', '${FIXTURE_IDS.BOOKING_CUSTB_H2}', '+919999900002', 'Customer B', 'booking_confirmed', 'sms', 'SENT', 'Your booking is confirmed')
      ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status;
    `);

    // 11. Push Tokens
    await client.query(`
      INSERT INTO public.push_tokens (id, user_id, token, device_type)
      VALUES
        ('${FIXTURE_IDS.PUSH_CUSTA}', '${FIXTURE_IDS.CUSTOMER_A}', 'ExponentPushToken[MatrixCustomerA]', 'android'),
        ('${FIXTURE_IDS.PUSH_CUSTB}', '${FIXTURE_IDS.CUSTOMER_B}', 'ExponentPushToken[MatrixCustomerB]', 'android')
      ON CONFLICT (id) DO UPDATE SET token = EXCLUDED.token;
    `);

    // 12. City Settlements
    await client.query(`
      INSERT INTO public.city_settlements (
        id, city_id, period_start, period_end, gross_revenue, gateway_fees, platform_alloc, refunds, status
      )
      VALUES
        ('${FIXTURE_IDS.SETTLEMENT_TIRUPATI}', '${FIXTURE_IDS.CITY_TIRUPATI}', '2026-10-01', '2026-10-31', 10000.00, 200.00, 1000.00, 0.00, 'APPROVED'),
        ('${FIXTURE_IDS.SETTLEMENT_OTHER}', '${FIXTURE_IDS.CITY_OTHER}', '2026-10-01', '2026-10-31', 5000.00, 100.00, 500.00, 0.00, 'DRAFT')
      ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status;
    `);

    // 13. City Waitlist
    await client.query(`
      INSERT INTO public.city_waitlist (id, city_name, phone, vertical_interest)
      VALUES
        ('${FIXTURE_IDS.WAITLIST_ROW}', 'Chittoor', '+919999900099', 'clinics')
      ON CONFLICT (id) DO UPDATE SET phone = EXCLUDED.phone;
    `);

    await client.query('COMMIT');
    console.log('✅ Access matrix fixture seeded successfully.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error setting up access matrix fixture:', err);
    throw err;
  } finally {
    client.release();
  }
}
