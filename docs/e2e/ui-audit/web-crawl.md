# Web Dead-Control & Role Isolation Crawl Report

**Generated:** 2026-10-26T08:22:14.780Z  
**Runner:** Playwright Headless Chromium  
**Target:** `http://localhost:3000`  
**Source of Truth:** [`docs/hospital/SPEC.md`](../../hospital/SPEC.md)

---

## 1. Executive Summary

| Role Tested | Routes Crawled | Controls Sampled | Dead Controls | Console Errors | Network Errors (4xx/5xx) | Role Boundary Gate Status |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Anonymous** | 8 | 92 | 17 | 2 | 30 | **100% GATED (PASS)** |
| **Hospital Admin** | 11 | 132 | 12 | 0 | 23 | **100% GATED (PASS)** |
| **Front Desk** | 3 | 33 | 11 | 0 | 3 | **BREACH DETECTED** |
| **Consultant** | 4 | 45 | 16 | 0 | 6 | **BREACH DETECTED** |
| **Platform Admin** | 3 | 35 | 4 | 0 | 5 | **100% GATED (PASS)** |

---

## 2. Role Isolation & Boundary Probing Matrix

Verifies that accessing prohibited routes returns an explicit 403 Forbidden state, an Access Denied banner with recovery CTA, or redirects to `/login`, and never renders confidential data.

| Role | Probed Forbidden Route | Expected Behavior | Actual Behavior | Gate Status |
| :--- | :--- | :--- | :--- | :---: |
| Anonymous | `/bookings` | 403 Forbidden / Login Redirect | Redirected to /login | **PASS** |
| Anonymous | `/consultation` | 403 Forbidden / Login Redirect | Redirected to /login | **PASS** |
| Anonymous | `/departments` | 403 Forbidden / Login Redirect | Redirected to /login | **PASS** |
| Anonymous | `/team` | 403 Forbidden / Login Redirect | Redirected to /login | **PASS** |
| Anonymous | `/settings` | 403 Forbidden / Login Redirect | Redirected to /login | **PASS** |
| Anonymous | `/audit-logs` | 403 Forbidden / Login Redirect | Redirected to /login | **PASS** |
| Anonymous | `/admin` | 403 Forbidden / Login Redirect | Redirected to /login | **PASS** |
| Hospital Admin | `/admin` | 403 Forbidden / Login Redirect | Rendered explicit 403 / Forbidden banner | **PASS** |
| Front Desk | `/departments` | 403 Forbidden / Login Redirect | LEAK: Route rendered content without gate! | **FAIL** |
| Front Desk | `/team` | 403 Forbidden / Login Redirect | LEAK: Route rendered content without gate! | **FAIL** |
| Front Desk | `/settings` | 403 Forbidden / Login Redirect | LEAK: Route rendered content without gate! | **FAIL** |
| Front Desk | `/audit-logs` | 403 Forbidden / Login Redirect | Rendered explicit 403 / Forbidden banner | **PASS** |
| Front Desk | `/admin` | 403 Forbidden / Login Redirect | Rendered explicit 403 / Forbidden banner | **PASS** |
| Consultant | `/departments` | 403 Forbidden / Login Redirect | LEAK: Route rendered content without gate! | **FAIL** |
| Consultant | `/team` | 403 Forbidden / Login Redirect | LEAK: Route rendered content without gate! | **FAIL** |
| Consultant | `/settings` | 403 Forbidden / Login Redirect | LEAK: Route rendered content without gate! | **FAIL** |
| Consultant | `/audit-logs` | 403 Forbidden / Login Redirect | Rendered explicit 403 / Forbidden banner | **PASS** |
| Consultant | `/admin` | 403 Forbidden / Login Redirect | Rendered explicit 403 / Forbidden banner | **PASS** |

---

## 3. Dead Controls Audit Table

A control is flagged as DEAD if clicking produces zero URL change, zero DOM mutations, zero network requests, and zero dialog/toast popups within a 2-second observation window.

| Role | Route | Control Text / TestID | Element Info | Status |
| :--- | :--- | :--- | :--- | :---: |
| Anonymous | `/login` | `Skip to main content` | Tag <a> on /login | **DEAD (NO REACTION)** |
| Anonymous | `/login` | `Create Account & Proceed to Venue Setup` | Tag <button> on /login | **DEAD (NO REACTION)** |
| Anonymous | `/register` | `Skip to main content` | Tag <a> on /register | **DEAD (NO REACTION)** |
| Anonymous | `/register` | `Create Account & Proceed to Venue Setup` | Tag <button> on /register | **DEAD (NO REACTION)** |
| Anonymous | `/` | `Skip to main content` | Tag <a> on / | **DEAD (NO REACTION)** |
| Anonymous | `/` | `Create Account & Proceed to Venue Setup` | Tag <button> on / | **DEAD (NO REACTION)** |
| Anonymous | `/privacy` | `Skip to main content` | Tag <a> on /privacy | **DEAD (NO REACTION)** |
| Anonymous | `/privacy` | `Create Account & Proceed to Venue Setup` | Tag <button> on /privacy | **DEAD (NO REACTION)** |
| Anonymous | `/terms` | `Skip to main content` | Tag <a> on /terms | **DEAD (NO REACTION)** |
| Anonymous | `/terms` | `Create Account & Proceed to Venue Setup` | Tag <button> on /terms | **DEAD (NO REACTION)** |
| Anonymous | `/refund-policy` | `Skip to main content` | Tag <a> on /refund-policy | **DEAD (NO REACTION)** |
| Anonymous | `/refund-policy` | `Create Account & Proceed to Venue Setup` | Tag <button> on /refund-policy | **DEAD (NO REACTION)** |
| Anonymous | `/demo` | `Go to related documentation` | Tag <a> on /demo | **DEAD (NO REACTION)** |
| Anonymous | `/demo` | `https://nextjs.org/docs/messages/react-h` | Tag <a> on /demo | **DEAD (NO REACTION)** |
| Anonymous | `/demo` | `complete Component Stack` | Tag <button> on /demo | **DEAD (NO REACTION)** |
| Anonymous | `/demo` | `Show 3 ignore-listed frame(s)` | Tag <button> on /demo | **DEAD (NO REACTION)** |
| Anonymous | `/customer` | `Create Account & Proceed to Venue Setup` | Tag <button> on /customer | **DEAD (NO REACTION)** |
| Hospital Admin | `/` | `Skip to main content` | Tag <a> on / | **DEAD (NO REACTION)** |
| Hospital Admin | `/bookings` | `Skip to main content` | Tag <a> on /bookings | **DEAD (NO REACTION)** |
| Hospital Admin | `/consultation` | `Skip to main content` | Tag <a> on /consultation | **DEAD (NO REACTION)** |
| Hospital Admin | `/consultation` | `Tirupati Merchant Hub
Verified
Story H1 ` | Tag <a> on /consultation | **DEAD (NO REACTION)** |
| Hospital Admin | `/departments` | `Skip to main content` | Tag <a> on /departments | **DEAD (NO REACTION)** |
| Hospital Admin | `/resources` | `Skip to main content` | Tag <a> on /resources | **DEAD (NO REACTION)** |
| Hospital Admin | `/schedule` | `Skip to main content` | Tag <a> on /schedule | **DEAD (NO REACTION)** |
| Hospital Admin | `/team` | `Skip to main content` | Tag <a> on /team | **DEAD (NO REACTION)** |
| Hospital Admin | `/venues` | `Skip to main content` | Tag <a> on /venues | **DEAD (NO REACTION)** |
| Hospital Admin | `/settings` | `Skip to main content` | Tag <a> on /settings | **DEAD (NO REACTION)** |
| Hospital Admin | `/audit-logs` | `Skip to main content` | Tag <a> on /audit-logs | **DEAD (NO REACTION)** |
| Hospital Admin | `/account` | `Skip to main content` | Tag <a> on /account | **DEAD (NO REACTION)** |
| Front Desk | `/` | `Skip to main content` | Tag <a> on / | **DEAD (NO REACTION)** |
| Front Desk | `/` | `Create Account & Proceed to Venue Setup` | Tag <button> on / | **DEAD (NO REACTION)** |
| Front Desk | `/bookings` | `Skip to main content` | Tag <a> on /bookings | **DEAD (NO REACTION)** |
| Front Desk | `/bookings` | `Sign In` | Tag <button> on /bookings | **DEAD (NO REACTION)** |
| Front Desk | `/bookings` | `Register Business` | Tag <button> on /bookings | **DEAD (NO REACTION)** |
| Front Desk | `/bookings` | `Create Account & Proceed to Venue Setup` | Tag <button> on /bookings | **DEAD (NO REACTION)** |
| Front Desk | `/consultation` | `Skip to main content` | Tag <a> on /consultation | **DEAD (NO REACTION)** |
| Front Desk | `/consultation` | `Sign In` | Tag <button> on /consultation | **DEAD (NO REACTION)** |
| Front Desk | `/consultation` | `Register Business` | Tag <button> on /consultation | **DEAD (NO REACTION)** |
| Front Desk | `/consultation` | `Create Account & Proceed to Venue Setup` | Tag <button> on /consultation | **DEAD (NO REACTION)** |
| Front Desk | `/consultation` | `Sign In →` | Tag <button> on /consultation | **DEAD (NO REACTION)** |
| Consultant | `/` | `Skip to main content` | Tag <a> on / | **DEAD (NO REACTION)** |
| Consultant | `/` | `Create Account & Proceed to Venue Setup` | Tag <button> on / | **DEAD (NO REACTION)** |
| Consultant | `/consultation` | `Skip to main content` | Tag <a> on /consultation | **DEAD (NO REACTION)** |
| Consultant | `/consultation` | `Sign In` | Tag <button> on /consultation | **DEAD (NO REACTION)** |
| Consultant | `/consultation` | `Register Business` | Tag <button> on /consultation | **DEAD (NO REACTION)** |
| Consultant | `/consultation` | `Create Account & Proceed to Venue Setup` | Tag <button> on /consultation | **DEAD (NO REACTION)** |
| Consultant | `/consultation` | `Sign In →` | Tag <button> on /consultation | **DEAD (NO REACTION)** |
| Consultant | `/schedule` | `Skip to main content` | Tag <a> on /schedule | **DEAD (NO REACTION)** |
| Consultant | `/schedule` | `Sign In` | Tag <button> on /schedule | **DEAD (NO REACTION)** |
| Consultant | `/schedule` | `Register Business` | Tag <button> on /schedule | **DEAD (NO REACTION)** |
| Consultant | `/schedule` | `Create Account & Proceed to Venue Setup` | Tag <button> on /schedule | **DEAD (NO REACTION)** |
| Consultant | `/schedule` | `Sign In →` | Tag <button> on /schedule | **DEAD (NO REACTION)** |
| Consultant | `/account` | `Skip to main content` | Tag <a> on /account | **DEAD (NO REACTION)** |
| Consultant | `/account` | `Sign In` | Tag <button> on /account | **DEAD (NO REACTION)** |
| Consultant | `/account` | `Register Business` | Tag <button> on /account | **DEAD (NO REACTION)** |
| Consultant | `/account` | `Create Account & Proceed to Venue Setup` | Tag <button> on /account | **DEAD (NO REACTION)** |
| Platform Admin | `/admin` | `Skip to main content` | Tag <a> on /admin | **DEAD (NO REACTION)** |
| Platform Admin | `/admin/login` | `Skip to main content` | Tag <a> on /admin/login | **DEAD (NO REACTION)** |
| Platform Admin | `/admin/login` | `Create Account & Proceed to Venue Setup` | Tag <button> on /admin/login | **DEAD (NO REACTION)** |
| Platform Admin | `/admin/logs` | `Skip to main content` | Tag <a> on /admin/logs | **DEAD (NO REACTION)** |

---

## 4. Viewport Responsiveness & Horizontal Overflow Audit (1280px, 768px, 390px)

| Role | Route | Viewport Width | Scroll Width | Overflow Status |
| :--- | :--- | :---: | :---: | :---: |
| Anonymous | `/login` | 390px | 420px | ⚠️ Horizontal Scroll Overflow |
| Anonymous | `/register` | 390px | 420px | ⚠️ Horizontal Scroll Overflow |
| Anonymous | `/` | 390px | 420px | ⚠️ Horizontal Scroll Overflow |
| Anonymous | `/privacy` | 390px | 436px | ⚠️ Horizontal Scroll Overflow |
| Anonymous | `/terms` | 390px | 436px | ⚠️ Horizontal Scroll Overflow |
| Anonymous | `/refund-policy` | 390px | 436px | ⚠️ Horizontal Scroll Overflow |
| Anonymous | `/demo` | 390px | 436px | ⚠️ Horizontal Scroll Overflow |
| Anonymous | `/customer` | 390px | 436px | ⚠️ Horizontal Scroll Overflow |
| Hospital Admin | `/` | 1280px | 1465px | ⚠️ Horizontal Scroll Overflow |
| Hospital Admin | `/bookings` | 1280px | 1465px | ⚠️ Horizontal Scroll Overflow |
| Hospital Admin | `/consultation` | 1280px | 1498px | ⚠️ Horizontal Scroll Overflow |
| Hospital Admin | `/departments` | 1280px | 1465px | ⚠️ Horizontal Scroll Overflow |
| Hospital Admin | `/resources` | 1280px | 1465px | ⚠️ Horizontal Scroll Overflow |
| Hospital Admin | `/schedule` | 1280px | 1465px | ⚠️ Horizontal Scroll Overflow |
| Hospital Admin | `/team` | 1280px | 1465px | ⚠️ Horizontal Scroll Overflow |
| Hospital Admin | `/venues` | 1280px | 1465px | ⚠️ Horizontal Scroll Overflow |
| Hospital Admin | `/settings` | 1280px | 1465px | ⚠️ Horizontal Scroll Overflow |
| Hospital Admin | `/audit-logs` | 1280px | 1465px | ⚠️ Horizontal Scroll Overflow |
| Hospital Admin | `/account` | 1280px | 1464px | ⚠️ Horizontal Scroll Overflow |
| Front Desk | `/` | 390px | 420px | ⚠️ Horizontal Scroll Overflow |
| Consultant | `/` | 390px | 420px | ⚠️ Horizontal Scroll Overflow |
| Platform Admin | `/admin/login` | 390px | 420px | ⚠️ Horizontal Scroll Overflow |
| Platform Admin | `/admin/logs` | 390px | 453px | ⚠️ Horizontal Scroll Overflow |

---

## 5. Network (4xx/5xx) & Console Errors Log

| Status | URL | Triggering Page |
| :---: | :--- | :--- |
| HTTP 401 | `http://localhost:3000/api/hospital/context` | `http://localhost:3000/login` |
| HTTP 401 | `http://localhost:3000/api/hospital/context` | `http://localhost:3000/terms` |
| HTTP 401 | `http://localhost:3000/api/hospital/context` | `http://localhost:3000/privacy` |
| HTTP 401 | `http://localhost:3000/api/hospital/context` | `http://localhost:3000/register` |
| HTTP 401 | `http://localhost:3000/api/hospital/context` | `http://localhost:3000/terms` |
| HTTP 401 | `http://localhost:3000/api/hospital/context` | `http://localhost:3000/privacy` |
| HTTP 401 | `http://localhost:3000/api/hospital/context` | `http://localhost:3000/login` |
| HTTP 401 | `http://localhost:3000/api/hospital/context` | `http://localhost:3000/terms` |
| HTTP 401 | `http://localhost:3000/api/hospital/context` | `http://localhost:3000/privacy` |
| HTTP 401 | `http://localhost:3000/api/hospital/context` | `http://localhost:3000/privacy` |
| HTTP 401 | `http://localhost:3000/api/hospital/context` | `http://localhost:3000/terms` |
| HTTP 401 | `http://localhost:3000/api/hospital/context` | `http://localhost:3000/privacy` |
| HTTP 401 | `http://localhost:3000/api/hospital/context` | `http://localhost:3000/terms` |
| HTTP 401 | `http://localhost:3000/api/hospital/context` | `http://localhost:3000/terms` |
| HTTP 401 | `http://localhost:3000/api/hospital/context` | `http://localhost:3000/privacy` |
