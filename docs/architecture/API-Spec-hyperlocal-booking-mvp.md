# API Specification
## Hyperlocal Booking Platform (Working Title) — MVP v1

Protocol: REST / JSON over Supabase PostgREST, Supabase RPC, and Supabase Edge Functions.
Base URLs:
- Direct Data & Auth: `https://<supabase-project-id>.supabase.co/rest/v1` and `/auth/v1`
- RPC Database Functions: `https://<supabase-project-id>.supabase.co/rest/v1/rpc/<function_name>`
- Custom Workflows & Webhooks: `https://<supabase-project-id>.supabase.co/functions/v1/<function_name>`

---

## Auth

```
POST /auth/otp/request
  body: { "phone": string }
  -> { "requestId": string }

POST /auth/otp/verify
  body: { "requestId": string, "otp": string }
  -> { "token": string, "user": { id, phone, role } }
```

---

## Catalog

```
GET /categories
  -> [ { id, name, subCategories: [ { id, name } ] } ]

GET /providers
  query: category, subCategory?, lat, lng, radiusKm?, page?, pageSize?
  -> { items: [ { id, name, category, subCategory, distanceKm, nextAvailableSlot } ], total }

GET /providers/{providerId}
  -> { id, name, category, subCategory, location, hours, photos, resources: [ { id, name, type, depositAmount } ] }
```

---

## Resources & Availability

```
GET /providers/{providerId}/resources
  -> [ { id, name, type, depositAmount, attributes: { ... category-specific fields } } ]

GET /resources/{resourceId}/slots
  query: date (YYYY-MM-DD)
  -> [ { slotId, startTime, endTime, capacityRemaining } ]
```

---

## Booking (auth required)

```
POST /bookings/hold
  body: { resourceId, slotId }
  -> { holdId, expiresAt, depositAmount }

POST /bookings/{bookingId}/pay
  body: { holdId }
  -> { paymentUrl, paymentId }
  # customer is redirected to the gateway; booking status = PENDING_PAYMENT

GET /bookings
  -> [ { bookingId, providerName, resourceName, slotStart, status, paymentStatus } ]

POST /bookings/{bookingId}/cancel
  -> { bookingId, status: "CANCELLED", paymentStatus: "REFUNDED" | "FORFEITED" }
  # REFUNDED if > 1 hour before slotStart, FORFEITED if inside the window

POST /bookings/{bookingId}/reschedule
  body: { newSlotId }
  -> { bookingId, slotStart: newSlotStart, status: "CONFIRMED" }
  # free if requested > 1 hour before the original slotStart; deposit carries over
```

---

## Payments

```
POST /webhooks/payment
  # called by the payment gateway (Razorpay/PayU), not by the client
  body: gateway-specific payload
  -> 200 OK
  # on success: booking -> CONFIRMED, paymentStatus -> CAPTURED
  # on failure: booking -> CANCELLED, slot released

GET /bookings/{bookingId}/payment
  -> { paymentId, amount, status: "CAPTURED" | "REFUNDED" | "FORFEITED" }
```

---

## Business Dashboard (auth required, provider role)

```
POST /business/onboard
  body: { name, category, subCategory?, location, hours }
  -> { providerId, status: "PENDING_APPROVAL" }

POST /business/{providerId}/resources
  body: { name, type, attributes: { ... }, durationMinutes, capacity, depositAmount }
  -> { resourceId }

PUT /business/resources/{resourceId}/availability
  body: { weeklySchedule: [ { dayOfWeek, startTime, endTime } ] }
  -> { updated: true }

GET /business/{providerId}/bookings
  query: date
  -> [ { bookingId, customerName, resourceName, slotStart, status, paymentStatus } ]

POST /business/bookings/{bookingId}/status
  body: { status: "ACCEPTED" | "REJECTED" | "COMPLETED" | "NO_SHOW" }
  -> { bookingId, status }
  # marking NO_SHOW triggers paymentStatus -> FORFEITED and increments the customer's no-show count

POST /business/bookings/{bookingId}/reschedule
  body: { newSlotId }
  -> { bookingId, slotStart: newSlotStart, status: "CONFIRMED" }
  # business-initiated: customer is always kept whole — deposit carries over regardless of timing

POST /business/bookings/{bookingId}/cancel
  -> { bookingId, status: "CANCELLED", paymentStatus: "REFUNDED" }
  # business-initiated cancellation always refunds in full, regardless of timing
```

---

## Admin (auth required, admin role)

```
GET /admin/providers/pending
  -> [ { providerId, name, category, submittedAt } ]

POST /admin/providers/{providerId}/approve
  -> { providerId, status: "ACTIVE" }

GET /admin/customers/flagged
  -> [ { customerId, phone, noShowCount, lastNoShowAt } ]
  # customers with noShowCount >= 4 within a rolling 12 months

POST /admin/customers/{customerId}/block
  body: { durationDays }
  -> { customerId, blockedUntil }
```

---

## Internal Events (not exposed, triggered by the `booking`/`payment` modules)

- `booking.confirmed` → SMS + email to customer
- `booking.reminder` → SMS ~1 hour before slot start
- `booking.cancelled` → SMS + email to customer and provider
- `booking.refunded` → SMS + email confirming refund
- `booking.noshow` → increments customer no-show count; triggers admin review at threshold
