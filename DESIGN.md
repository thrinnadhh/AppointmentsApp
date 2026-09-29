---
version: "2.0.0"
name: Tirupati Merchant Command
description: Design system v2 for Hyperlocal Multi-Vertical Appointments Platform
colors:
  primary: "#047857"
  primary-hover: "#065f46"
  primary-light: "#ecfdf5"
  primary-muted: "#d1fae5"
  ink: "#0c1a14"
  ink-secondary: "#374151"
  ink-tertiary: "#6b7280"
  surface: "#ffffff"
  surface-raised: "#f9fafb"
  border: "#e5e7eb"
  border-strong: "#d1d5db"
  accent-amber: "#b45309"
  accent-amber-bg: "#fffbeb"
  error: "#be123c"
  error-bg: "#fff1f2"
  success: "#065f46"
  success-bg: "#ecfdf5"
  dark-zone: "#0f1f17"
  dark-zone-text: "#d1fae5"
typography:
  display:
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "30px"
    fontWeight: "700"
    lineHeight: "1.15"
    letterSpacing: "-0.03em"
  headline:
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "22px"
    fontWeight: "600"
    lineHeight: "1.25"
    letterSpacing: "-0.02em"
  title:
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "16px"
    fontWeight: "600"
    lineHeight: "1.4"
    letterSpacing: "-0.01em"
  body:
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "14px"
    fontWeight: "400"
    lineHeight: "1.55"
  label:
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "12px"
    fontWeight: "500"
    lineHeight: "1.4"
    letterSpacing: "0.01em"
  mono:
    fontFamily: "'Geist Mono', 'JetBrains Mono', 'Fira Code', monospace"
    fontSize: "13px"
    fontWeight: "500"
    lineHeight: "1.5"
rounded:
  none: "0px"
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "12px"
  xl: "16px"
  full: "9999px"
spacing:
  1: "4px"
  2: "8px"
  3: "12px"
  4: "16px"
  6: "24px"
  8: "32px"
  12: "48px"
components:
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
    padding: "24px"
    border: "1px solid {colors.border}"
    shadow: "0 1px 4px rgba(0,0,0,0.06), 0 0 0 1px rgba(0,0,0,0.03)"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: "10px 20px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-secondary}"
    rounded: "{rounded.md}"
    border: "1px solid {colors.border-strong}"
  input:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: "10px 12px"
    border: "1px solid {colors.border-strong}"
  nav:
    backgroundColor: "{colors.surface}"
    height: "60px"
  dark-control-bar:
    backgroundColor: "{colors.dark-zone}"
    textColor: "{colors.dark-zone-text}"
    rounded: "{rounded.lg}"
    padding: "16px 20px"
---

# Tirupati Merchant Command — Design System v2

## Overview
High-authority, operationally-dense visual system. Emotional register: Trust → Control → Speed.
Audience: Business owners aged 25-55, daily ops on tablets/desktops in commercial spaces.

## Colors
- **Primary Emerald (#047857)**: Deepened for 4.8:1 contrast on white. Confirmed/active/success states only.
- **Ink (#0c1a14)**: Near-black with green undertone. Headlines and critical data.
- **Surface Raised (#f9fafb)**: Page background. Warm off-white prevents eye strain.
- **Dark Zone (#0f1f17)**: Control bars and operational toggles. Signals "machine control panel."
- **Amber (#b45309)**: Deposit amounts, hold timers, cancellation warnings only.
- No Purple Clause: AG Kit Purple Ban strictly enforced.

## Typography
- Inter from Google Fonts (400/500/600/700). Better numeric rendering for ₹ amounts and time slots.
- Geist Mono for booking codes, timestamps, all numeric alignment in lists.
- Negative letter-spacing on headlines (-0.03em) for premium feel.

## Layout
- Page background: #f9fafb — not pure white, prevents cards from blending in.
- Content width: max-w-screen-xl (1280px). Padding: px-6 mobile, px-8 desktop.
- Cards: 24px internal padding minimum. Section gaps: gap-6 related, gap-8 major sections.
- Nav height: 60px.

## Elevation & Depth
- Level 0 (page): #f9fafb, no shadow.
- Level 1 (card): 0 1px 4px rgba(0,0,0,0.06) + 1px border.
- Level 2 (hover): 0 4px 16px rgba(0,0,0,0.08) + green ring.
- Level 3 (modal): 0 20px 60px rgba(0,0,0,0.18) with dark backdrop.

## Shapes
- Cards: rounded-xl (12px). Buttons: rounded-lg (8px). Badges: rounded-full. Inputs: rounded-lg.
- Never mix 24px and 8px radii on the same card layer.

## Do's and Don'ts
- DO use gap-6 minimum between sections — whitespace is clarity.
- DO put ₹ and slot times in mono font.
- DO use dark-zone for operational control bars.
- DON'T use rounded-2xl on cards — reads as mobile-port.
- DON'T use bg-slate-50 as page background — too cold.
- DON'T use purple/indigo/violet.
- DON'T use text-xs for primary body content — minimum 13px.
