# Product Requirements Document
## Hyperlocal Booking Platform (Working Title) — MVP v1

---

## 1. Overview

**Problem:** In Tirupati, discovering and booking a slot at a clinic, salon, restaurant, gaming zone, or pet-care provider means either calling ahead, walking in and waiting, or using a different single-purpose app per category — if one even exists locally.

**Solution:** A unified platform where customers discover and book appointments or reservations across five verticals via a dedicated mobile app, backed by a small upfront deposit that keeps both sides honest, while merchants manage listings, schedules, and bookings through a lightweight web dashboard.

**Platform:** 
- **Customer**: Native Mobile App (React Native / Expo for iOS & Android) for location discovery, slot booking, deposit payment, and push reminders.
- **Merchant**: Responsive Web Application (Next.js 15) for business onboarding, resource setup, calendar schedule management, and booking fulfillment.

---

## 2. Goals & Non-Goals (MVP)

**Goals:**
- Validate that a multi-vertical bundle attracts and retains users better than single-category apps, in a Tier-2/3 city context (Tirupati)
- Deliver an instant, delightful customer discovery and booking experience on mobile
- Provide merchants with a zero-install browser dashboard to manage appointments and staff availability
- Use a small booking deposit to cut no-shows from day one — a real pain point for every one of these five verticals
- Keep backend infra and database costs near-zero leveraging Supabase free/Pro tier

**Non-goals for v1:**
- Full checkout / itemized payment for the entire service — only a small confirmation deposit, not the full bill
- Loyalty programs, referral systems
- Multi-city expansion outside Tirupati
- Ratings/reviews (candidate for v1.1)
- Advanced AI search/recommendation engine

---

## 3. Verticals & Categories (MVP scope)

| Category | Sub-categories | Bookable unit |
|---|---|---|
| Hospitals/Clinics | General, Dental, Eye (expandable) | Doctor |
| Restaurants | — | Table |
| Gaming/Turf | Gaming zone, Turf/court | Console station / Court-lane |
| Salons | — | Stylist chair |
| Pets | Pet Hospital, Pet Grooming | Vet / Groomer |

---

## 4. User Personas

1. **Customer** — searches by category/location, pays a small deposit to book a slot, shows up.
2. **Business/Provider** — clinic, salon, restaurant, turf, or pet-care owner managing their own listing and bookings.
3. **Admin** (minimal for MVP) — approves new business signups, handles disputes, monitors repeat no-shows.

---

## 5. Core User Flows

**Discovery → Booking:**
1. Customer opens site → picks a category (e.g. Salons) → optionally a sub-category
2. Sees a list of nearby providers (name, distance, next available slot)
3. Opens a provider → sees bookable resources (stylists/tables/doctors) and available time slots
4. Picks a slot → slot is held for a few minutes → confirms with phone OTP
5. Pays the booking deposit → slot flips to CONFIRMED
6. Gets SMS/email confirmation; reminder sent before the slot

**Rescheduling (either side can initiate):**
1. Customer or business requests a new slot for an existing booking
2. If requested more than 1 hour before the original slot start → free, deposit carries over to the new slot automatically
3. If requested inside that 1-hour window → treated as a late change (see Policies)

**Business onboarding → Managing bookings:**
1. Business signs up, picks category/sub-category, adds location and hours
2. Adds their bookable resources (doctors, tables, stylists, courts) with duration/capacity and a deposit amount
3. Sets weekly availability
4. Views incoming bookings on a calendar; accepts/rejects/reschedules
5. Marks completed/no-show after the fact

---

## 6. Functional Requirements
 
**Customer-facing (Mobile App - iOS/Android):**
- Native location discovery: Browse/search by category + sub-category + GPS distance
- View provider profile: services, hours, location, photos
- Real-time slot availability per resource with interactive slot grid
- Phone-OTP login (Supabase Auth, passwordless)
- Hold slot with 5-minute reservation timer
- Book slot by paying deposit via Razorpay SDK/web checkout; view, cancel, or reschedule upcoming bookings
- Native push notifications and transactional SMS/email for reminders and confirmations
 
**Business dashboard (Web App - Next.js):**
- Sign up and onboard business details with authentication
- Add/edit bookable resources, durations/capacity, and deposit amounts
- Set/edit weekly availability & operating hours
- Interactive bookings calendar & list (day/week view)
- Accept, reject, reschedule, or mark completed/no-show
- Basic profile edit (hours, location, photos)
 
---
 
## 7. Booking Policies
 
**Deposit-to-confirm:** a booking only becomes CONFIRMED once the customer pays a small deposit (amount set per resource by the business — e.g. ₹50–200, not the full service cost).
 
**Cancellation / rescheduling — free window:**
- Either the customer or the business can cancel or reschedule **free of charge up to 1 hour before** the slot's start time
- On a free reschedule, the deposit simply carries over to the new slot — no re-payment needed
- On a free cancellation, the deposit is refunded in full
 
**Inside the 1-hour window or a no-show:**
- **Customer-initiated** late cancellation or no-show → deposit is forfeited to the business (minus the platform's cut)
- **Business-initiated** late cancellation or reschedule → customer is **always refunded in full**, regardless of timing — the customer should never be penalized for the business's change
 
**Repeat no-shows:** after 4 no-shows within 12 months (industry-standard threshold, e.g. OpenTable), a customer's account is flagged and may require phone re-verification or a temporary booking block. Free to build, meaningful protection for businesses.
 
---
 
## 8. Non-Functional Requirements
 
- Native mobile customer app (smooth 60fps animations, offline-ready cache)
- Responsive merchant web application (desktop, tablet, mobile browser)
- Concurrency protection: No double-booking under concurrent requests for the same slot (atomic Postgres holds)
- Payment capture and refund reliability: programmatic Razorpay refunds on cancellation
- Low operational cost: Supabase serverless PostgreSQL + Auth + Storage
- Fast schema evolution: JSONB attributes on resources for category-specific metadata
 
---
 
## 9. Out of Scope for v1
 
- Full-bill online payment (deposit only, remainder paid at venue)
- Loyalty/rewards
- Multi-language support (English/Telugu candidate for v1.1)
- Recommendation engine
- Ratings and reviews (candidate for v1.1)


---

## 10. Success Metrics

- Number of businesses onboarded, per vertical
- Completed bookings per week
- No-show rate, before vs. after the deposit policy
- % of customers who book a second time within 30 days
- Which vertical shows the strongest repeat-usage signal (decides where to double down)

---

## 11. Open Questions

1. Default deposit amount per vertical — flat platform-wide default (e.g. ₹50) vs. fully business-configurable from day one?
2. Which vertical launches first for seeding supply — salons/clinics (most business-owner-friendly to onboard) or restaurants (highest customer pull)?
3. Should the 1-hour cutoff be uniform across all verticals, or tighter/looser per category (e.g. restaurants same-day vs. clinics needing more lead time)?
