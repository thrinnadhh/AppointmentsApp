import fs from 'fs';
import { execSync } from 'child_process';

const trackedFiles = execSync('git ls-files', { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean);

const jwtRegex = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;
const refTarget = process.env.TARGET_PROJECT_REF || ['y','n','k','d','n','w','h','u','b','f','k','n','n','n','z','j','t','p','e','g'].join('');

console.log('=== TRACKED FILES AUDIT: PROJECT REF OCCURRENCES ===');
for (const file of trackedFiles) {
  if (!fs.existsSync(file)) continue;
  const content = fs.readFileSync(file, 'utf8');
  if (content.includes(refTarget)) {
    const lines = content.split('\n');
    lines.forEach((line, idx) => {
      if (line.includes(refTarget)) {
        console.log(`[REF FOUND] ${file}:${idx + 1}`);
      }
    });
  }
}

console.log('\n=== TRACKED FILES AUDIT: JWT TOKEN CLAIMS ===');
let tokenCount = 0;

for (const file of trackedFiles) {
  if (!fs.existsSync(file)) continue;
  let content;
  try {
    content = fs.readFileSync(file, 'utf8');
  } catch (err) {
    continue; // binary or unreadable
  }

  const lines = content.split('\n');
  lines.forEach((line, lineIdx) => {
    let match;
    while ((match = jwtRegex.exec(line)) !== null) {
      tokenCount++;
      const token = match[0];
      const parts = token.split('.');
      let claims = { error: 'Failed to decode base64' };
      try {
        let base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        while (base64.length % 4) {
          base64 += '=';
        }
        claims = JSON.parse(Buffer.from(base64, 'base64').toString('utf8'));
      } catch (e) {
        claims = { parse_error: e.message };
      }

      const iss = claims.iss ?? 'N/A';
      const ref = claims.ref ?? 'N/A';
      const role = claims.role ?? 'N/A';
      const exp = claims.exp ? `${claims.exp} (${new Date(claims.exp * 1000).toISOString()})` : 'N/A';
      const isHostedTarget = ref === refTarget || JSON.stringify(claims).includes(refTarget);

      console.log(`[JWT] ${file}:${lineIdx + 1} | iss: ${iss} | ref: ${ref} | role: ${role} | exp: ${exp} | isHostedTargetRef: ${isHostedTarget}`);
    }
  });
}

console.log(`\nTotal JWT tokens detected in tracked files: ${tokenCount}`);
