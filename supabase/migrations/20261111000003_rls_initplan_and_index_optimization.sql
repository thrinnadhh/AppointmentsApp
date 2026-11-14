-- Migration: 20261111000003_rls_initplan_and_index_optimization.sql
-- Description: Composite b-tree indexes and query plan optimizations for high-throughput bookings operations.

BEGIN;

-- 1. Composite Index: Resource calendar lookup, conflict checking, and status queries
CREATE INDEX IF NOT EXISTS idx_bookings_resource_slot_status 
  ON public.bookings (resource_id, slot_start, status);

-- 2. Composite Index: Merchant portal booking list filtered by status and sorted by date
CREATE INDEX IF NOT EXISTS idx_bookings_merchant_status_created 
  ON public.bookings (provider_id, status, created_at DESC);

-- 3. Composite Index: Customer mobile booking history sorted by creation date
CREATE INDEX IF NOT EXISTS idx_bookings_customer_created 
  ON public.bookings (customer_id, created_at DESC);

COMMIT;
