#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const targetPath = path.resolve('supabase/signing_keys.json');

if (!fs.existsSync(targetPath)) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = privateKey.export({ format: 'jwk' });
  jwk.kid = crypto.randomUUID();
  jwk.use = 'sig';
  jwk.alg = 'ES256';
  fs.writeFileSync(targetPath, JSON.stringify([jwk], null, 2) + '\n');
  console.log('✅ Generated local PostgREST ES256 signing key at supabase/signing_keys.json');
} else {
  console.log('ℹ️  PostgREST signing key already exists at supabase/signing_keys.json');
}

