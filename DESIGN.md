---
version: "1.0.0"
name: Tirupati Trust & Velocity
description: Design system for Hyperlocal Multi-Vertical Appointments Platform (Merchant Web & Customer Mobile)
colors:
  primary: "#059669"
  primary-dark: "#064e3b"
  primary-light: "#f0fdf4"
  secondary: "#0284c7"
  accent: "#d97706"
  surface: "#ffffff"
  surface-subtle: "#f8fafc"
  border: "#e2e8f0"
  text-primary: "#0f172a"
  text-secondary: "#475569"
  error: "#e11d48"
  success: "#10b981"
typography:
  headline-1:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "32px"
    fontWeight: "700"
    lineHeight: "1.2"
    letterSpacing: "-0.02em"
  headline-2:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "24px"
    fontWeight: "600"
    lineHeight: "1.3"
    letterSpacing: "-0.01em"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "15px"
    fontWeight: "400"
    lineHeight: "1.5"
  caption:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "12px"
    fontWeight: "500"
    lineHeight: "1.4"
rounded:
  sm: "6px"
  md: "10px"
  lg: "16px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
---

# Tirupati Appointments Design Specification

## Overview
A high-trust, responsive visual system designed for multi-vertical booking across Tier-2/3 commerce (Clinics, Restaurants, Turfs, Salons, Pet Care in Tirupati).
The interface balances merchant operational efficiency with customer mobile speed and clarity.

## Colors
- **Emerald Green (`#059669`)**: Core primary tone representing confirmed appointments, vitality, health, and verified status.
- **Deep Slate (`#0f172a` / `#475569`)**: Authoritative text hierarchy ensuring maximum readability under varied sunlight and device conditions.
- **Amber Gold (`#d97706`)**: Highlights deposits, held slots (5-min countdown), and warning thresholds (late cancellation windows).
- **Subtle Surface (`#f8fafc`)**: Crisp, glare-free background with clean border definition (`#e2e8f0`).
- **No Purple Clause**: Strictly complies with the AG Kit Purple Ban — no indigo/purple SaaS gradients.

## Typography
- Native system font stack (`-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto`) for zero network latency, instant initial paint, and familiar platform rendering across iOS, Android, and Web.
- Clear numeric readability for slot times, countdown timers, deposit figures, and distance indications.

## Layout
- **Merchant Web**: Fixed top-bar + persistent desktop sub-nav / compact mobile nav. Clean information density with high data-to-ink ratio.
- **Customer Mobile**: Single-hand reachability, bottom-sheet slot selectors, sticky bottom confirmation bars, clear visual vertical categories.

## Elevation & Depth
- Flat, modern surfaces with subtle single-pixel borders (`#e2e8f0`) rather than heavy floating drop-shadows.
- Soft shadow (`box-shadow: 0 1px 3px rgba(0,0,0,0.06)`) on active cards and booking modals.

## Components
- **Category Badge**: Pill badges with vertical-specific icons and tint backgrounds.
- **Booking Card**: Displays resource name, customer contact, scheduled slot time, deposit payment state, and quick triage actions (Accept / Reschedule / Complete / No-Show).
- **Slot Button**: Interactive chip indicating available, held, or confirmed states with instant visual feedback.

## Do's and Don'ts
- **DO**: Display deposit amounts clearly with ₹ symbols everywhere to maintain upfront honesty.
- **DO**: Visually differentiate between customer late cancellation (forfeited) vs business change (full refund).
- **DON'T**: Use generic purple/violet aesthetic or generic corporate stock illustrations.
- **DON'T**: Hide slot hold timers; always make the 5-minute countdown explicit to prevent cart abandon confusion.
