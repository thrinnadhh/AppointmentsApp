// scripts/generate-ui-inventory.mjs
// Static inventory analysis script for Mobile App & Web App UI surfaces.
// Scans for all pressable/clickable controls, handlers, backend calls, roles,
// and flags dead/suspect controls or placeholder texts.

import fs from 'fs';
import path from 'path';

const mobileFiles = [
  { screen: 'Main App / Navigation / Auth Container', path: 'apps/customer-mobile/App.tsx', role: 'Customer / Guest' },
  { screen: 'Home Screen', path: 'apps/customer-mobile/src/screens/HomeScreen.tsx', role: 'Customer / Guest' },
  { screen: 'Hospital / Doctor Detail', path: 'apps/customer-mobile/src/screens/ProviderDetailScreen.tsx', role: 'Customer / Guest' },
  { screen: 'Patient Details Modal', path: 'apps/customer-mobile/src/screens/CustomerDetailsModal.tsx', role: 'Customer / Guest' },
  { screen: 'Booking & Checkout Modal', path: 'apps/customer-mobile/src/screens/CheckoutModal.tsx', role: 'Customer' },
  { screen: 'OPD Digital Booking Pass Modal', path: 'apps/customer-mobile/src/screens/BookingPassModal.tsx', role: 'Customer' },
  { screen: 'My Appointments Screen', path: 'apps/customer-mobile/src/screens/MyBookingsScreen.tsx', role: 'Customer' },
  { screen: 'Account & Profile Screen', path: 'apps/customer-mobile/src/screens/AccountScreen.tsx', role: 'Customer' },
  { screen: 'DPDPA Consent Notice Screen', path: 'apps/customer-mobile/src/screens/ConsentScreen.tsx', role: 'Customer / Guest' },
  { screen: 'Doctor Emergency Modal', path: 'apps/customer-mobile/src/components/DoctorEmergencyModal.tsx', role: 'Customer' },
  { screen: 'Error Boundary Screen', path: 'apps/customer-mobile/src/components/ErrorBoundary.tsx', role: 'Customer / Guest' },
];

const webPages = [
  { route: '/', name: 'Dashboard Overview', path: 'apps/merchant-web/src/app/page.tsx', role: 'Hospital Admin, Front Desk, Consultant' },
  { route: '/login', name: 'Merchant Login', path: 'apps/merchant-web/src/app/login/page.tsx', role: 'Anonymous' },
  { route: '/register', name: 'Merchant Registration', path: 'apps/merchant-web/src/app/register/page.tsx', role: 'Anonymous' },
  { route: '/bookings', name: 'Bookings Desk', path: 'apps/merchant-web/src/app/bookings/page.tsx', role: 'Hospital Admin, Front Desk' },
  { route: '/consultation', name: 'Doctor Consultation Desk', path: 'apps/merchant-web/src/app/consultation/page.tsx', role: 'Consultant, Hospital Admin' },
  { route: '/departments', name: 'Departments Console', path: 'apps/merchant-web/src/app/departments/page.tsx', role: 'Hospital Admin' },
  { route: '/resources', name: 'Doctors & Resources', path: 'apps/merchant-web/src/app/resources/page.tsx', role: 'Hospital Admin' },
  { route: '/schedule', name: 'Schedule & Shifts', path: 'apps/merchant-web/src/app/schedule/page.tsx', role: 'Hospital Admin, Consultant' },
  { route: '/team', name: 'Team & Staff Access Control', path: 'apps/merchant-web/src/app/team/page.tsx', role: 'Hospital Admin' },
  { route: '/venues', name: 'Venues & Profiles', path: 'apps/merchant-web/src/app/venues/page.tsx', role: 'Hospital Admin' },
  { route: '/settings', name: 'Settings & Hospital Policies', path: 'apps/merchant-web/src/app/settings/page.tsx', role: 'Hospital Admin' },
  { route: '/audit-logs', name: 'Audit Logs', path: 'apps/merchant-web/src/app/audit-logs/page.tsx', role: 'Hospital Admin' },
  { route: '/account', name: 'Merchant Profile & Account', path: 'apps/merchant-web/src/app/account/page.tsx', role: 'Merchant User' },
  { route: '/admin', name: 'Platform Admin Dashboard', path: 'apps/merchant-web/src/app/admin/page.tsx', role: 'Platform Admin' },
  { route: '/admin/login', name: 'Platform Admin Login', path: 'apps/merchant-web/src/app/admin/login/page.tsx', role: 'Anonymous' },
  { route: '/admin/logs', name: 'Platform Admin System Logs', path: 'apps/merchant-web/src/app/admin/logs/page.tsx', role: 'Platform Admin' },
  { route: '/ticket/[id]', name: 'Public Web Ticket Pass', path: 'apps/merchant-web/src/app/ticket/[id]/page.tsx', role: 'Customer / Public' },
  { route: '/customer', name: 'Customer Web Landing', path: 'apps/merchant-web/src/app/customer/page.tsx', role: 'Public' },
  { route: '/demo', name: 'Interactive Demo Workspace', path: 'apps/merchant-web/src/app/demo/page.tsx', role: 'Public' },
  { route: '/privacy', name: 'Privacy Policy', path: 'apps/merchant-web/src/app/privacy/page.tsx', role: 'Public' },
  { route: '/terms', name: 'Terms of Service', path: 'apps/merchant-web/src/app/terms/page.tsx', role: 'Public' },
  { route: '/refund-policy', name: 'Refund Policy', path: 'apps/merchant-web/src/app/refund-policy/page.tsx', role: 'Public' },
];

const webComponents = [
  { screen: 'Bookings Contact Badge', path: 'apps/merchant-web/src/components/CustomerContactBadge.tsx', role: 'Hospital Admin, Front Desk' },
  { screen: 'Main Navigation Bar', path: 'apps/merchant-web/src/components/Navigation.tsx', role: 'Merchant Staff' },
  { screen: 'Tenant Switcher', path: 'apps/merchant-web/src/components/TenantSelector.tsx', role: 'Hospital Admin' },
  { screen: 'Consultation: Active Card', path: 'apps/merchant-web/src/components/consultation/ActiveConsultationCard.tsx', role: 'Consultant, Hospital Admin' },
  { screen: 'Consultation: Urgency Override Modal', path: 'apps/merchant-web/src/components/consultation/MedicalUrgencyOverrideModal.tsx', role: 'Consultant, Hospital Admin' },
  { screen: 'Consultation: Up Next Card', path: 'apps/merchant-web/src/components/consultation/UpNextPatientCard.tsx', role: 'Consultant, Hospital Admin' },
  { screen: 'FrontDesk: FastPass Panel', path: 'apps/merchant-web/src/components/frontdesk/FastPassCheckinPanel.tsx', role: 'Front Desk, Hospital Admin' },
  { screen: 'FrontDesk: Manual Check-In Modal', path: 'apps/merchant-web/src/components/frontdesk/ManualCheckinModal.tsx', role: 'Front Desk, Hospital Admin' },
  { screen: 'FrontDesk: Waiting Lounge TV Modal', path: 'apps/merchant-web/src/components/frontdesk/WaitingLoungeDisplayModal.tsx', role: 'Front Desk, Hospital Admin' },
  { screen: 'Team: Assign Front Desk Modal', path: 'apps/merchant-web/src/components/team/AssignFrontDeskModal.tsx', role: 'Hospital Admin' },
  { screen: 'Team: Unified Add Staff Modal', path: 'apps/merchant-web/src/components/team/UnifiedAddStaffModal.tsx', role: 'Hospital Admin' },
];

function analyzeFile(filePath, surface, screenName, defaultRole) {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');

  const controls = [];

  // Patterns for interactive elements
  // 1. Mobile: <TouchableOpacity, <Pressable, <Button
  // 2. Web: <button, <Link, <a, <input type="button|submit"
  const tagRegex = surface === 'Mobile'
    ? /<(TouchableOpacity|Pressable|Button)\b([^>]*)/g
    : /<(button|Link|a)\b([^>]*)/g;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    let match;
    // Check for button/pressable in this line or nearby
    if (surface === 'Mobile' && (line.includes('<TouchableOpacity') || line.includes('<Pressable') || line.includes('<Button'))) {
      const chunk = lines.slice(i, Math.min(i + 35, lines.length)).join(' ');
      const control = parseControl(chunk, lineNum, filePath, surface, screenName, defaultRole);
      if (control) controls.push(control);
    } else if (surface === 'Web' && (line.includes('<button') || line.includes('<Link') || line.includes('<a '))) {
      const chunk = lines.slice(i, Math.min(i + 35, lines.length)).join(' ');
      const control = parseControl(chunk, lineNum, filePath, surface, screenName, defaultRole);
      if (control) controls.push(control);
    }
  }

  return controls;
}

function parseControl(chunk, lineNum, filePath, surface, screenName, defaultRole) {
  // Extract testID / data-testid / title / aria-label / inner text
  let label = '';
  const testIdMatch = chunk.match(/(?:testID|data-testid)=["']([^"']+)["']/);
  const ariaMatch = chunk.match(/aria-label=["']([^"']+)["']/);
  const titleMatch = chunk.match(/title=["']([^"']+)["']/);
  const hrefMatch = chunk.match(/href=["']([^"']+)["']/);
  const toMatch = chunk.match(/href=\{([^}]+)\}/);

  if (testIdMatch) label = testIdMatch[1];
  else if (ariaMatch) label = ariaMatch[1];
  else if (titleMatch) label = titleMatch[1];
  else if (hrefMatch) label = `Link to ${hrefMatch[1]}`;
  else {
    // Look for text between tags
    const textMatch = chunk.match(/>([^<>{}]*)</);
    if (textMatch && textMatch[1].trim()) label = textMatch[1].trim();
    else label = `Interactive Control at line ${lineNum}`;
  }

  // Extract handler
  let handler = 'None';
  let backendCall = 'None';
  let status = 'OK';

  const pressMatch = chunk.match(/(?:onPress|onClick)=\s*\{([^}]+)\}/);
  if (pressMatch) {
    handler = pressMatch[1].trim();
    if (handler.includes('console.log') && !handler.includes('await') && !handler.includes('fetch')) {
      status = 'suspect';
    } else if (handler === '() => {}' || handler === '() => null' || handler === 'undefined') {
      status = 'dead';
    }
  } else if (chunk.includes('<Link') || chunk.includes('<a ')) {
    handler = hrefMatch ? `Navigate(${hrefMatch[1]})` : 'Navigate(dynamic)';
  } else {
    // Button without onPress or onClick
    if (!chunk.includes('type="submit"')) {
      status = 'suspect';
    }
  }

  // Check disabled
  if (chunk.includes('disabled={true}') || chunk.includes('disabled={!false}') || chunk.includes('disabled className="opacity-50"')) {
    status = 'suspect';
  }

  // Identify backend calls associated with this handler or file context
  if (handler.includes('cancel') || chunk.includes('cancel')) {
    backendCall = 'POST /api/bookings/cancel';
  } else if (handler.includes('reschedule') || chunk.includes('reschedule')) {
    backendCall = 'POST /api/bookings/reschedule';
  } else if (handler.includes('reach') || chunk.includes('markBookingReached')) {
    backendCall = 'PATCH /rest/v1/bookings (customer_arrived_at)';
  } else if (handler.includes('reveal') || chunk.includes('revealCustomerContact')) {
    backendCall = 'RPC reveal_customer_contact';
  } else if (handler.includes('admit') || chunk.includes('admitPatient')) {
    backendCall = 'POST /api/bookings/admit';
  } else if (handler.includes('login') || handler.includes('Login')) {
    backendCall = 'POST /auth/v1/token or /auth/v1/otp';
  } else if (handler.includes('delete') || handler.includes('Delete')) {
    backendCall = 'DELETE /api/account or POST /api/account/delete-public-request';
  } else if (handler.includes('export') || handler.includes('Export')) {
    backendCall = 'GET /api/account/export';
  } else if (chunk.includes('fetch(') || chunk.includes('supabase.')) {
    backendCall = 'Supabase REST / PostgREST';
  }

  return {
    surface,
    screen: screenName,
    control: label,
    handler: handler.replace(/[\n\r\t]/g, ' ').substring(0, 50),
    backendCall,
    role: defaultRole,
    status,
    file: filePath,
    line: lineNum
  };
}

// Check for placeholder text across all files
function scanPlaceholders(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const placeholders = [];

  const badPatterns = [
    { pattern: /\bTODO\b/i, name: 'TODO comment/text' },
    { pattern: /\blorem\s+ipsum\b/i, name: 'Lorem Ipsum placeholder' },
    { pattern: />\s*undefined\s*</, name: 'Rendered literal "undefined"' },
    { pattern: />\s*null\s*</, name: 'Rendered literal "null"' },
    { pattern: />\s*NaN\s*</, name: 'Rendered literal "NaN"' },
    { pattern: /\[object Object\]/, name: 'Rendered "[object Object]"' },
    { pattern: /\bcoming\s+soon\b/i, name: '"Coming soon" placeholder' }
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip test files or comments if purely code comments
    for (const bp of badPatterns) {
      if (bp.pattern.test(line)) {
        placeholders.push({
          file: filePath,
          line: i + 1,
          type: bp.name,
          snippet: line.trim().substring(0, 80)
        });
      }
    }
  }

  return placeholders;
}

export function runFullInventory() {
  console.log('🔍 Running full UI Static Inventory Scan...');

  let allControls = [];
  let allPlaceholders = [];

  // 1. Mobile Files
  for (const mf of mobileFiles) {
    const controls = analyzeFile(mf.path, 'Mobile', mf.screen, mf.role);
    allControls.push(...controls);
    const ph = scanPlaceholders(mf.path);
    allPlaceholders.push(...ph);
  }

  // 2. Web Pages
  for (const wp of webPages) {
    const controls = analyzeFile(wp.path, 'Web', `${wp.route} (${wp.name})`, wp.role);
    allControls.push(...controls);
    const ph = scanPlaceholders(wp.path);
    allPlaceholders.push(...ph);
  }

  // 3. Web Components
  for (const wc of webComponents) {
    const controls = analyzeFile(wc.path, 'Web Component', wc.screen, wc.role);
    allControls.push(...controls);
    const ph = scanPlaceholders(wc.path);
    allPlaceholders.push(...ph);
  }

  console.log(`Found ${allControls.length} interactive controls across mobile & web.`);
  console.log(`Found ${allPlaceholders.length} placeholder occurrences.`);

  // Generate markdown report
  let md = `# Production-Readiness UI Inventory & Control Audit

**Generated:** ${new Date().toISOString()}  
**Scope:** Mobile App (\`apps/customer-mobile\`) and Web App (\`apps/merchant-web\`)  
**Source of Truth:** [\`docs/hospital/SPEC.md\`](../../hospital/SPEC.md)

---

## 1. Executive Summary

| Surface | Scanned Files | Total Controls | OK | Suspect | Dead |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Mobile App (Customer)** | ${mobileFiles.length} | ${allControls.filter(c => c.surface === 'Mobile').length} | ${allControls.filter(c => c.surface === 'Mobile' && c.status === 'OK').length} | ${allControls.filter(c => c.surface === 'Mobile' && c.status === 'suspect').length} | ${allControls.filter(c => c.surface === 'Mobile' && c.status === 'dead').length} |
| **Web App (Merchant & Admin)** | ${webPages.length + webComponents.length} | ${allControls.filter(c => c.surface.includes('Web')).length} | ${allControls.filter(c => c.surface.includes('Web') && c.status === 'OK').length} | ${allControls.filter(c => c.surface.includes('Web') && c.status === 'suspect').length} | ${allControls.filter(c => c.surface.includes('Web') && c.status === 'dead').length} |
| **Total** | **${mobileFiles.length + webPages.length + webComponents.length}** | **${allControls.length}** | **${allControls.filter(c => c.status === 'OK').length}** | **${allControls.filter(c => c.status === 'suspect').length}** | **${allControls.filter(c => c.status === 'dead').length}** |

---

## 2. Static Inventory Table

| # | Surface | Screen or Route | Control (Label / TestID) | Handler | Backend Call | Role | Status | File & Line |
| :---: | :--- | :--- | :--- | :--- | :--- | :--- | :---: | :--- |
`;

  allControls.forEach((c, idx) => {
    md += `| ${idx + 1} | ${c.surface} | ${c.screen} | \`${c.control}\` | \`${c.handler}\` | \`${c.backendCall}\` | ${c.role} | **${c.status.toUpperCase()}** | [\`${path.basename(c.file)}:${c.line}\`](file://${path.resolve(c.file)}#L${c.line}) |\n`;
  });

  md += `\n---

## 3. Placeholder & Dead Content Scanner Findings

| # | File & Line | Issue Type | Code Snippet | Severity |
| :---: | :--- | :--- | :--- | :---: |
`;

  allPlaceholders.forEach((p, idx) => {
    md += `| ${idx + 1} | [\`${path.basename(p.file)}:${p.line}\`](file://${path.resolve(p.file)}#L${p.line}) | ${p.type} | \`${p.snippet.replace(/\|/g, '\\|')}\` | ${p.type.includes('literal') ? 'HIGH' : 'LOW'} |\n`;
  });

  md += `\n---

## 4. Suspect & Dead Control Triage Summary

`;

  const suspects = allControls.filter(c => c.status !== 'OK');
  if (suspects.length === 0) {
    md += `> ✅ Zero dead or orphaned controls detected across all primary production routes.\n`;
  } else {
    suspects.forEach(s => {
      md += `- **[${s.status.toUpperCase()}]** \`${s.control}\` on **${s.screen}** (${s.surface}): Handler \`${s.handler}\` at [\`${path.basename(s.file)}:${s.line}\`](file://${path.resolve(s.file)}#L${s.line})\n`;
    });
  }

  const outPath = path.resolve(process.cwd(), 'docs/e2e/ui-audit/inventory.md');
  fs.writeFileSync(outPath, md, 'utf8');
  console.log(`📄 Written inventory to: ${outPath}`);
  return { allControls, allPlaceholders };
}

if (process.argv[1]?.endsWith('generate-ui-inventory.mjs')) {
  runFullInventory();
}
