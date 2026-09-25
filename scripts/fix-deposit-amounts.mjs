#!/usr/bin/env node
/**
 * One-shot seed fix script: sets deposit_amount on resources that have 0.
 * Run from the monorepo root: node scripts/fix-deposit-amounts.mjs
 * Uses the SUPABASE_SERVICE_ROLE_KEY env var for admin access.
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY   = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL) {
  console.error('ERROR: SUPABASE_URL not set');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY || ANON_KEY);

const DEPOSITS = [
  { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', amount: 100 }, // Dr. S. K. Murthy
  { id: 'aaaaaaab-aaaa-aaaa-aaaa-aaaaaaaaaaaa', amount: 100 }, // Dr. Ananya Reddy
  { id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', amount: 75  }, // Salon stylist
  { id: 'ced73567-6707-4199-83a5-8ec390aad8ce', amount: 100 }, // Zero deposit test
  { id: '99d3d14f-086f-4cb5-9bee-a79e1bdc2737', amount: 50  }, // Duplicate resource
];

console.log('Fixing deposit amounts on seed resources...\n');
for (const { id, amount } of DEPOSITS) {
  const { error } = await supabase.from('resources')
    .update({ deposit_amount: amount, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) {
    console.error(`  FAIL  ${id}:`, error.message);
  } else {
    console.log(`  OK    ${id} → deposit_amount = ₹${amount}`);
  }
}
console.log('\nDone.');
