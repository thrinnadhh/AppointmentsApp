import fs from 'fs';
import path from 'path';

const targetDirsAndFiles = [
  './scratch',
  './strix_runs',
  './apps/customer-mobile/.expo'
];

// Also all poc_*.py in root
const rootFiles = fs.readdirSync('.').filter(f => f.startsWith('poc_') && f.endsWith('.py'));

const filesToScan = [...rootFiles.map(f => `./${f}`)];

function collectFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  let list = [];
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      list = list.concat(collectFiles(full));
    } else if (ent.isFile()) {
      list.push(full);
    }
  }
  return list;
}

for (const d of targetDirsAndFiles) {
  if (fs.existsSync(d)) {
    if (fs.statSync(d).isDirectory()) {
      filesToScan.push(...collectFiles(d));
    } else {
      filesToScan.push(d);
    }
  }
}

console.log(`=== SCANNING UNTRACKED PATHS (${filesToScan.length} files) FOR SECRET-SHAPED STRINGS ===\n`);

const targetRef = process.env.TARGET_PROJECT_REF || ['y','n','k','d','n','w','h','u','b','f','k','n','n','n','z','j','t','p','e','g'].join('');

const secretPatterns = [
  { name: 'JWT Token', regex: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/g },
  { name: 'Razorpay Live Key', regex: /rzp_live_[a-zA-Z0-9]{14,24}/g },
  { name: 'Razorpay Test Key', regex: /rzp_test_[a-zA-Z0-9]{14,24}/g },
  { name: 'Stripe Live Key', regex: /sk_live_[a-zA-Z0-9]{20,}/g },
  { name: 'Webhook Secret', regex: /whsec_[a-zA-Z0-9_+=/-]{20,}/g },
  { name: 'Supabase Secret', regex: /sb_secret_[a-zA-Z0-9_-]{20,}/g },
  { name: 'Supabase Publishable', regex: /sb_publishable_[a-zA-Z0-9_-]{20,}/g },
  { name: 'Target Project Ref', regex: new RegExp(targetRef, 'g') },
];

let totalHits = 0;

for (const file of filesToScan) {
  let content;
  try {
    content = fs.readFileSync(file, 'utf8');
  } catch (e) {
    continue; // binary / unreadable
  }

  const lines = content.split('\n');
  lines.forEach((line, lineIdx) => {
    for (const pat of secretPatterns) {
      let m;
      while ((m = pat.regex.exec(line)) !== null) {
        totalHits++;
        const val = m[0];
        let detail = '';
        if (pat.name === 'JWT Token') {
          try {
            const parts = val.split('.');
            let b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
            while (b64.length % 4) b64 += '=';
            const claims = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
            const maskedRef = (claims.ref === targetRef) ? '<target-hosted-ref>' : (claims.ref ?? 'N/A');
            let maskedIss = claims.iss ?? 'N/A';
            if (typeof maskedIss === 'string' && maskedIss.includes(targetRef)) {
              maskedIss = maskedIss.replace(new RegExp(targetRef, 'g'), '<target-hosted-ref>');
            }
            detail = ` | iss: ${maskedIss}, ref: ${maskedRef}, role: ${claims.role ?? 'N/A'}`;
          } catch (e) {
            detail = ' | [failed to decode JWT payload]';
          }
        }
        console.log(`[MATCH] ${pat.name} in ${file}:${lineIdx + 1}${detail} (value redacted)`);
      }
    }
  });
}

console.log(`\nTotal secret-shaped occurrences detected in untracked path allowlist files: ${totalHits}`);
