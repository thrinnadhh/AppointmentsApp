import { test as base, expect, Page, BrowserContext } from '@playwright/test';
import { CustomerAppPage } from '../pages/customer-app.page';
import { MerchantPortalPage } from '../pages/merchant-portal.page';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://ynkdnwhubfknnnzjtpeg.supabase.co';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_PQ0ToJguSqBpF6eWP3aP9w_NT4hFLef';

export interface BookingApiHelper {
  createHold: (params: {
    customerId?: string;
    resourceId?: string;
    slotStart?: string;
    slotEnd?: string;
    depositAmount?: number;
  }) => Promise<{ booking_id: string; reference_code?: string }>;
  confirmBooking: (bookingId: string) => Promise<{ success: boolean; booking_id: string }>;
  rescheduleBooking: (bookingId: string, newSlotStart: string, newSlotEnd: string) => Promise<{ success: boolean }>;
  sendNotification: (params: {
    bookingId: string;
    eventType?: 'BOOKING_CONFIRMED' | 'BOOKING_REMINDER_1H' | 'BOOKING_REMINDER_30M';
    channel?: 'whatsapp' | 'sms';
    recipientPhone?: string;
  }) => Promise<{ success: boolean; dispatch?: unknown }>;
}

export interface MultiRoleFixtures {
  customerApp: CustomerAppPage;
  customerPage: Page;
  merchantPortal: MerchantPortalPage;
  merchantPage: Page;
}

/**
 * Playwright Custom Fixtures Type definition adhering to webapp-testing/SKILL.md (Section 4).
 */
export interface AppTestFixtures {
  customerApp: CustomerAppPage;
  merchantPortal: MerchantPortalPage;
  multiRole: MultiRoleFixtures;
  supabaseClient: SupabaseClient;
  bookingApi: BookingApiHelper;
}

/**
 * Extended Playwright test instance with reusable fixtures for Customer & Merchant testing.
 */
export const test = base.extend<AppTestFixtures>({
  supabaseClient: async ({}, use) => {
    const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    await use(client);
  },

  customerApp: async ({ browser }, use) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const customer = new CustomerAppPage(page);
    await customer.goto();
    await use(customer);
    await context.close();
  },

  merchantPortal: async ({ browser }, use) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const merchant = new MerchantPortalPage(page);
    await merchant.goto();
    await use(merchant);
    await context.close();
  },

  bookingApi: async ({ request }, use) => {
    const api: BookingApiHelper = {
      async createHold(params) {
        const slotStart = params.slotStart || new Date(Date.now() + 86400000).toISOString();
        const slotEnd = params.slotEnd || new Date(Date.now() + 86400000 + 1800000).toISOString();
        const customerId = params.customerId || '99999999-9999-9999-9999-999999999991';
        const resourceId = params.resourceId || 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

        const res = await request.post('http://localhost:3000/api/bookings/hold', {
          data: {
            customer_id: customerId,
            resource_id: resourceId,
            slot_start: slotStart,
            slot_end: slotEnd,
            deposit_amount: params.depositAmount || 100,
          },
        });
        if (!res.ok()) {
          const body = await res.text();
          throw new Error(`Failed to hold booking: HTTP ${res.status()} - ${body}`);
        }
        const json = await res.json();
        let referenceCode = json.reference_code;
        if (!referenceCode && json.booking_id) {
          const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
          const { data } = await client.from('bookings').select('reference_code').eq('id', json.booking_id).maybeSingle();
          if (data?.reference_code) {
            referenceCode = data.reference_code;
          }
        }
        return { booking_id: json.booking_id, reference_code: referenceCode };
      },

      async confirmBooking(bookingId) {
        const res = await request.post('http://localhost:3000/api/bookings/confirm', {
          data: {
            booking_id: bookingId,
            gateway_payment_id: `pay_fixture_${Date.now()}`,
          },
        });
        if (!res.ok()) {
          const body = await res.text();
          throw new Error(`Failed to confirm booking: HTTP ${res.status()} - ${body}`);
        }
        const json = await res.json();
        return { success: json.success ?? true, booking_id: bookingId };
      },

      async rescheduleBooking(bookingId, newSlotStart, newSlotEnd) {
        const res = await request.post('http://localhost:3000/api/bookings/reschedule', {
          data: {
            booking_id: bookingId,
            new_slot_start: newSlotStart,
            new_slot_end: newSlotEnd,
          },
        });
        if (!res.ok()) {
          const body = await res.text();
          throw new Error(`Failed to reschedule booking: HTTP ${res.status()} - ${body}`);
        }
        const json = await res.json();
        return { success: json.success ?? true };
      },

      async sendNotification(params) {
        const res = await request.post('http://localhost:3000/api/admin/notifications', {
          data: {
            booking_id: params.bookingId,
            event_type: params.eventType || 'BOOKING_CONFIRMED',
          },
        });
        if (!res.ok()) {
          const body = await res.text();
          throw new Error(`Failed to send notification: HTTP ${res.status()} - ${body}`);
        }
        const json = await res.json();
        return json;
      },
    };

    await use(api);
  },

  multiRole: async ({ browser }, use) => {
    const customerContext: BrowserContext = await browser.newContext();
    const customerPage = await customerContext.newPage();
    const customerApp = new CustomerAppPage(customerPage);
    await customerApp.goto();

    const merchantContext: BrowserContext = await browser.newContext();
    const merchantPage = await merchantContext.newPage();
    const merchantPortal = new MerchantPortalPage(merchantPage);
    await merchantPortal.goto();

    await use({
      customerApp,
      customerPage,
      merchantPortal,
      merchantPage,
    });

    await customerContext.close();
    await merchantContext.close();
  },
});

export { expect } from '@playwright/test';
export { CustomerAppPage } from '../pages/customer-app.page';
export { MerchantPortalPage } from '../pages/merchant-portal.page';
