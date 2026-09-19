-- =============================================================================
-- Migration 20260917000008: Fix resource deposit amounts (seed data)
-- Resources were inserted with deposit_amount = 0 which breaks the hold-and-pay
-- flow (customer sees ₹0, booking looks broken). Set category-appropriate values.
-- =============================================================================

-- Dental / Clinic resources → ₹100 deposit
UPDATE public.resources
SET deposit_amount = 100, updated_at = NOW()
WHERE deposit_amount = 0
  AND id IN (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'aaaaaaab-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  );

-- Salon resource → ₹75 deposit
UPDATE public.resources
SET deposit_amount = 75, updated_at = NOW()
WHERE deposit_amount = 0
  AND id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

-- Any other active resources with zero deposit — set per provider category
UPDATE public.resources r
SET deposit_amount = CASE
    WHEN p.category_id = 'clinics'     THEN 100
    WHEN p.category_id = 'salons'      THEN 75
    WHEN p.category_id = 'gaming'      THEN 200
    WHEN p.category_id = 'restaurants' THEN 150
    WHEN p.category_id = 'pets'        THEN 100
    ELSE 100
  END,
  updated_at = NOW()
FROM public.providers p
WHERE r.provider_id = p.id
  AND r.deposit_amount = 0
  AND r.is_active = true;
