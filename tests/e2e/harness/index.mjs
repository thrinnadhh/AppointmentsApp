/**
 * tests/e2e/harness/index.mjs
 * 
 * Central export point for Phase 0 Shared Foundation test harness.
 */

export { TestClock } from './test-clock.mjs';
export { createTenant, cleanupTenant } from './tenant-factory.mjs';
export {
  RoleClient,
  getAdminClient,
  getConsultantClient,
  getFrontDeskClient,
  getCustomerClient,
  getSalonClient
} from './client-helpers.mjs';
export { SubAgentReportWriter } from './report-writer.mjs';
