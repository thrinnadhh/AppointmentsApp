#!/usr/bin/env python3
"""
STAGE 1: ELEPHANT DISCOVERY — EXHAUSTIVE BUTTON & FLOW INVENTORY
Crawls all TSX/JSX UI files across merchant-web and customer-mobile to build
.gsd/E2E_COVERAGE_LEDGER.json enumerating 100% of routes, interactive controls, and flows.
"""

import json
import os
import re
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent

# Files to crawl
WEB_DIR = ROOT_DIR / "apps" / "merchant-web" / "src"
MOBILE_DIR = ROOT_DIR / "apps" / "customer-mobile"

def extract_controls_from_file(file_path: Path, rel_path: str, route_or_screen: str):
    controls = []
    content = file_path.read_text(encoding="utf-8", errors="ignore")
    lines = content.splitlines()

    # Regex patterns for interactive elements
    patterns = [
        # Button tags
        (r'<button\b([^>]*)>(.*?)</button>', 'button'),
        # Link tags
        (r'<a\b([^>]*)>(.*?)</a>', 'link'),
        (r'<Link\b([^>]*)>(.*?)</Link>', 'link'),
        # Form tags
        (r'<form\b([^>]*)>', 'form'),
        # Select / Dropdown
        (r'<select\b([^>]*)>(.*?)</select>', 'select'),
        # Input buttons / checkboxes / submits
        (r'<input\b([^>]*type=[\'"](?:submit|button|checkbox|radio)[\'"][^>]*)>', 'input'),
        # React Native Touchable / Pressable
        (r'<(?:TouchableOpacity|Pressable|TouchableHighlight)\b([^>]*)>(.*?)</(?:TouchableOpacity|Pressable|TouchableHighlight)>', 'touchable')
    ]

    # Simple tag start matcher to find line numbers
    for line_idx, line in enumerate(lines, start=1):
        # Match <button
        if '<button' in line or '<Link' in line or '<a ' in line or '<form' in line or '<select' in line or '<TouchableOpacity' in line or '<Pressable' in line:
            # Extract attributes and potential text
            tag_match = re.search(r'<(button|Link|a|form|select|TouchableOpacity|Pressable|TouchableHighlight)\b([^>]*)', line)
            if tag_match:
                tag_name = tag_match.group(1)
                attrs = tag_match.group(2)
                
                # Determine label: data-testid, aria-label, title, or inner text
                label = ""
                testid_m = re.search(r'data-testid=[\'"]([^\'"]+)[\'"]', attrs)
                aria_m = re.search(r'aria-label=[\'"]([^\'"]+)[\'"]', attrs)
                text_m = re.search(r'>([^<]+)<', line)
                
                if aria_m:
                    label = aria_m.group(1)
                elif testid_m:
                    label = testid_m.group(1)
                elif text_m and text_m.group(1).strip():
                    label = text_m.group(1).strip()
                else:
                    # Look ahead a few lines for text
                    for ahead_idx in range(line_idx, min(line_idx + 4, len(lines))):
                        ahead_line = lines[ahead_idx].strip()
                        inner = re.sub(r'<[^>]+>', '', ahead_line).strip()
                        if inner and not inner.startswith('{/*') and not inner.startswith('//'):
                            label = inner
                            break
                    if not label:
                        label = f"{tag_name} action"

                # Infer expected outcome based on attributes and context
                outcome = "DOM change / state update"
                if 'type="submit"' in attrs or "type='submit'" in attrs:
                    outcome = "Form submission / Supabase mutation"
                elif 'onClick=' in attrs or 'onPress=' in attrs:
                    if 'router.push' in content or 'navigate' in content:
                        outcome = "Client-side navigation or modal open"
                    if 'fetch(' in content or 'supabase' in content:
                        outcome = "API mutation / Supabase RPC call"
                elif tag_name in ('a', 'Link'):
                    href_m = re.search(r'href=[\'"]([^\'"]+)[\'"]', attrs)
                    if href_m:
                        outcome = f"Navigate to {href_m.group(1)}"
                    else:
                        outcome = "Route navigation"

                # Clean label
                label = re.sub(r'[{}\'"$]', '', label).strip()[:40] or f"{tag_name} at line {line_idx}"

                controls.append({
                    "line": line_idx,
                    "tag": tag_name,
                    "attrs": attrs[:120],
                    "label": label,
                    "outcome": outcome
                })

    return controls

def build_inventory():
    pages = [
        {"route": "/", "type": "web", "title": "Public Landing Page", "file": "apps/merchant-web/src/app/page.tsx"},
        {"route": "/login", "type": "web", "title": "Merchant / Staff Login", "file": "apps/merchant-web/src/app/login/page.tsx"},
        {"route": "/register", "type": "web", "title": "Merchant Onboarding", "file": "apps/merchant-web/src/app/register/page.tsx"},
        {"route": "/admin/login", "type": "web", "title": "Superadmin Auth", "file": "apps/merchant-web/src/app/admin/login/page.tsx"},
        {"route": "/admin", "type": "web", "title": "Platform Admin Portal", "file": "apps/merchant-web/src/app/admin/page.tsx"},
        {"route": "/admin/logs", "type": "web", "title": "Admin Audit & Incident Logs", "file": "apps/merchant-web/src/app/admin/logs/page.tsx"},
        {"route": "/audit-logs", "type": "web", "title": "Hospital Audit Logs", "file": "apps/merchant-web/src/app/audit-logs/page.tsx"},
        {"route": "/bookings", "type": "web", "title": "Merchant Bookings Management", "file": "apps/merchant-web/src/app/bookings/page.tsx"},
        {"route": "/consultation", "type": "web", "title": "Consultant Queue & Active Session", "file": "apps/merchant-web/src/app/consultation/page.tsx"},
        {"route": "/customer", "type": "web", "title": "Customer Web Booking Directory", "file": "apps/merchant-web/src/app/customer/page.tsx"},
        {"route": "/customer/dashboard", "type": "web", "title": "Customer Web Dashboard", "file": "apps/merchant-web/src/app/customer/dashboard/page.tsx"},
        {"route": "/departments", "type": "web", "title": "Hospital Departments", "file": "apps/merchant-web/src/app/departments/page.tsx"},
        {"route": "/queue", "type": "web", "title": "Front Desk Queue & FastPass Check-in", "file": "apps/merchant-web/src/app/queue/page.tsx"},
        {"route": "/schedule", "type": "web", "title": "Doctor / Consultant Schedule", "file": "apps/merchant-web/src/app/schedule/page.tsx"},
        {"route": "/settings", "type": "web", "title": "Merchant Settings & Cashfree KYB", "file": "apps/merchant-web/src/app/settings/page.tsx"},
        {"route": "/team", "type": "web", "title": "Staff & Front Desk Assignment", "file": "apps/merchant-web/src/app/team/page.tsx"},
        {"route": "/ticket/[id]", "type": "web", "title": "Public Token & FastPass Ticket", "file": "apps/merchant-web/src/app/ticket/[id]/page.tsx"},
        {"route": "/venues", "type": "web", "title": "Hospital Locations & Venues", "file": "apps/merchant-web/src/app/venues/page.tsx"},
        {"route": "/refund-policy", "type": "web", "title": "Legal Refund Policy", "file": "apps/merchant-web/src/app/refund-policy/page.tsx"},
        {"route": "/privacy", "type": "web", "title": "Legal Privacy Policy", "file": "apps/merchant-web/src/app/privacy/page.tsx"},
        {"route": "/terms", "type": "web", "title": "Legal Terms of Service", "file": "apps/merchant-web/src/app/terms/page.tsx"},
        {"route": "/demo", "type": "web", "title": "Interactive Demo", "file": "apps/merchant-web/src/app/demo/page.tsx"},
        {"route": "/resources", "type": "web", "title": "Resources & Calendars", "file": "apps/merchant-web/src/app/resources/page.tsx"},
        {"route": "/account/delete", "type": "web", "title": "Account Deletion Request", "file": "apps/merchant-web/src/app/account/delete/page.tsx"},
        {"route": "mobile://HomeScreen", "type": "mobile", "title": "Customer Mobile Home", "file": "apps/customer-mobile/src/screens/HomeScreen.tsx"},
        {"route": "mobile://ProviderDetailScreen", "type": "mobile", "title": "Doctor Profile & Slot Picker", "file": "apps/customer-mobile/src/screens/ProviderDetailScreen.tsx"},
        {"route": "mobile://CustomerDetailsModal", "type": "mobile", "title": "Patient Details Form", "file": "apps/customer-mobile/src/screens/CustomerDetailsModal.tsx"},
        {"route": "mobile://CheckoutModal", "type": "mobile", "title": "Fee Checkout Modal", "file": "apps/customer-mobile/src/screens/CheckoutModal.tsx"},
        {"route": "mobile://BookingPassModal", "type": "mobile", "title": "FastPass Token & PIN", "file": "apps/customer-mobile/src/screens/BookingPassModal.tsx"},
        {"route": "mobile://MyBookingsScreen", "type": "mobile", "title": "Customer My Bookings", "file": "apps/customer-mobile/src/screens/MyBookingsScreen.tsx"},
        {"route": "mobile://AccountScreen", "type": "mobile", "title": "Customer Profile & Security", "file": "apps/customer-mobile/src/screens/AccountScreen.tsx"},
        {"route": "mobile://ConsentScreen", "type": "mobile", "title": "DPDP Statutory Consent", "file": "apps/customer-mobile/src/screens/ConsentScreen.tsx"}
    ]

    all_controls = []
    control_counter = 1

    # Map files and components
    component_files = list(WEB_DIR.glob("**/*.tsx")) + list(MOBILE_DIR.glob("**/*.tsx"))
    
    for f in component_files:
        rel = f.relative_to(ROOT_DIR).as_posix()
        # Find matching route/screen
        matched_screen = "component"
        for p in pages:
            if p["file"] == rel:
                matched_screen = p["route"]
                break
        if matched_screen == "component":
            if "customer-mobile" in rel:
                matched_screen = f"mobile://{f.stem}"
            else:
                matched_screen = f"web://components/{f.stem}"

        raw_controls = extract_controls_from_file(f, rel, matched_screen)
        for c in raw_controls:
            ctrl_id = f"CTRL_{c['tag'][:3].upper()}_{control_counter:04d}"
            control_counter += 1
            all_controls.append({
                "control_id": ctrl_id,
                "route_or_screen": matched_screen,
                "component_file": f"{rel}:{c['line']}",
                "tag": c["tag"],
                "visible_label": c["label"],
                "expected_outcome": c["outcome"],
                "status": "PENDING"
            })

    # Critical User Flows
    flows = [
        {
            "flow_id": "FLOW_A_GUEST_DISCOVERY_TO_BOOKING",
            "name": "Guest Discovery -> Provider Detail -> Slot Select -> Auth -> Payment -> FastPass Ticket",
            "surface": "Web + Mobile",
            "steps": [
                "1. User lands on / or mobile HomeScreen and selects category (Hospitals & Clinics)",
                "2. User selects Dr. K. S. Rao / Apex Hospital",
                "3. User picks date and available time slot",
                "4. User enters patient name, phone, age, gender",
                "5. User views summary with ₹10 platform fee",
                "6. User proceeds to Cashfree payment / mock gateway verification",
                "7. Booking pass / token is created and displayed with FastPass QR code and 4-digit PIN",
                "8. Confirmation message / notification logged"
            ],
            "controls_involved": [c["control_id"] for c in all_controls if any(k in c["route_or_screen"] for k in ["/customer", "ProviderDetail", "Checkout", "HomeScreen"])][:10],
            "status": "PENDING"
        },
        {
            "flow_id": "FLOW_B_RESCHEDULE_AND_CANCELLATION",
            "name": "Customer Booking Management -> Reschedule Slot -> Cancel Booking -> State & Refund Verification",
            "surface": "Web + Mobile",
            "steps": [
                "1. User navigates to /customer/dashboard or MyBookingsScreen",
                "2. User views active booking card with status CONFIRMED",
                "3. User clicks Reschedule, selects new future slot, and submits",
                "4. Previous slot is released to available pool; new slot is locked",
                "5. User clicks Cancel Booking",
                "6. System computes cancellation policy (>60m = full refund, <=60m = forfeited)",
                "7. Booking status updates to CANCELLED and audit log is recorded"
            ],
            "controls_involved": [c["control_id"] for c in all_controls if any(k in c["route_or_screen"] for k in ["/customer/dashboard", "MyBookings", "BookingPass"])][:8],
            "status": "PENDING"
        },
        {
            "flow_id": "FLOW_C_VENDOR_ONBOARDING_AND_QUEUE",
            "name": "Vendor Onboarding -> KYB / Settings -> Slot Creation -> Front Desk Check-in -> Consultant Queue",
            "surface": "Web",
            "steps": [
                "1. Merchant registers via /register or logs into /login",
                "2. Hospital Admin configures Departments (/departments) and staff roster (/team)",
                "3. Consultant configures weekly schedule (/schedule)",
                "4. Front Desk logs into /queue and monitors patient queue",
                "5. Front Desk checks in patient with 4-digit PIN (/api/bookings/checkin)",
                "6. Patient appears in Consultant Queue (/consultation)",
                "7. Consultant marks patient 'In Consultation' then 'Completed' (/api/bookings/end)"
            ],
            "controls_involved": [c["control_id"] for c in all_controls if any(k in c["route_or_screen"] for k in ["/queue", "/consultation", "/team", "/departments", "/schedule", "/login"])][:12],
            "status": "PENDING"
        },
        {
            "flow_id": "FLOW_D_ADMIN_OPERATIONS_AND_RECONCILIATION",
            "name": "Superadmin Login -> Platform Metrics -> Tenant Moderation -> Refund & Payout Ledger",
            "surface": "Web",
            "steps": [
                "1. Superadmin logs in via /admin/login with MFA / bypass key",
                "2. Dashboard displays total merchants, GMV, fee collected, and active queues (/admin)",
                "3. Admin inspects audit logs (/admin/logs) and refund statuses (/api/admin/refunds)",
                "4. Admin toggles merchant active status / moderation",
                "5. Admin verifies ledger reconciliation"
            ],
            "controls_involved": [c["control_id"] for c in all_controls if any(k in c["route_or_screen"] for k in ["/admin", "/admin/login", "/admin/logs"])][:8],
            "status": "PENDING"
        },
        {
            "flow_id": "FLOW_E_NEGATIVE_AND_EDGE_CASES",
            "name": "Race Conditions -> Double Submit -> Taken Slot -> Unauthorized Access -> 42501 Prevention",
            "surface": "Web + Mobile",
            "steps": [
                "1. Two parallel requests attempt to hold/book the exact same slot -> GiST exclusion constraint blocks second with 409",
                "2. Rapid double-click on payment/booking button -> Idempotency key prevents duplicate booking",
                "3. Customer submits empty/invalid phone number -> HTML5 constraint and Zod validation block submit",
                "4. Consultant attempts to access another consultant's queue -> RLS prevents cross-tenant data leak",
                "5. Unauthenticated user attempts direct POST to /api/bookings/checkin -> 401 Unauthorized"
            ],
            "controls_involved": [c["control_id"] for c in all_controls if any(k in c["route_or_screen"] for k in ["/customer", "/login", "/queue", "/consultation"])][:10],
            "status": "PENDING"
        }
    ]

    ledger = {
        "metadata": {
            "title": "AppointmentsApp Full E2E & UI Functional Coverage Ledger",
            "created_at": "2026-11-21T12:17:00Z",
            "version": "1.0.0",
            "frameworks": [
                "GoogleChrome/modern-web-guidance-src",
                "google/artemis",
                "google/elephant-goldfish-model (EGM)"
            ],
            "total_pages_routes": len(pages),
            "total_interactive_controls": len(all_controls),
            "total_critical_flows": len(flows)
        },
        "pages_and_routes": pages,
        "critical_flows": flows,
        "interactive_controls": all_controls
    }

    out_file = ROOT_DIR / ".gsd" / "E2E_COVERAGE_LEDGER.json"
    out_file.write_text(json.dumps(ledger, indent=2), encoding="utf-8")
    print(f"Generated {out_file} with:")
    print(f"  - {len(pages)} Pages/Routes")
    print(f"  - {len(flows)} Critical Flows")
    print(f"  - {len(all_controls)} Interactive Controls")

if __name__ == "__main__":
    build_inventory()
