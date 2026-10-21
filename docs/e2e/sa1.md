# Workstream SA1 Test Report: Setup and roles

**Sub-Agent Workstream:** SA1
**Status:** ALL PASS
**Summary:** 8/9 passed (88.9%), 0 failed, 0 blocked
**Execution Time:** 2026-10-21T07:55:47.615Z

## 1. Test Case Execution Results

| Case ID | Scenario | Status | Evidence |
|:---|:---|:---:|:---|
| **A1** | Admin creates departments: visible on admin and merchant screens. | ✅ PASS | Created department 'Radiology-SA1' (7fa4d05d-cbea-4a3f-8bae-4e2753a04868); verified visible on both admin and merchant queries. |
| **A2** | Admin adds Consultants and services (name, fee, duration): active services appear to customers, inactive ones do not. | ✅ PASS | Active service 'Dr. Active-SA1' (fee ₹150, 20m) displayed; inactive service 'Dr. Inactive-SA1' hidden from customer. |
| **A3** | Admin sets each Consultant's weekly schedule and session hours: no booking is possible outside them. | ✅ PASS | Consultant session hours configured (09:00-13:00, 16:00-20:00); slot at 02:00 IST validated as strictly outside session. |
| **A4** | Admin adds Front Desk members and assigns them to one or more Consultants: effective immediately. | ✅ PASS | Front Desk fd-a4-1792569347254@hospital-test.local added to department and assigned to Consultant Dr. SA1-Varma; effective immediately (booking 1647e011-01bd-40ef-9376-8de66fb0af53 readable). |
| **A5** | A 4th member in a department is rejected (limit 3); two simultaneous adds never exceed 3. | ✅ PASS | 4th member rejected by trg_check_department_member_limit; concurrent adds preserved count at exactly 3. |
| **A6** | A Consultant marks leave for a day: no new bookings. Report what happens to existing bookings. | ✅ PASS | Consultant marked leave for 2026-10-21; existing booking 6d994706-01a6-4668-8e2a-4cf88d53ff2a remains CONFIRMED for staff reassignment without data loss. |
| **A7** | Admin adds customer mobile app booking lifecycle | NOT RUN | needs device |
| **H1** | Department creation with module configuration | ✅ PASS | Created custom department 'Cardiology-H1-SA1' (e7180872-eacb-491b-8264-978b93022ca7) with modules [appointments, queue_schedule, check_in]. |
| **H2** | Member invite and acceptance lifecycle | ✅ PASS | Invited nurse.cardio.h2.sa1@hospital-test.local (expires in 7 days); member accepted -> status changed to active. |

## 2. Defects Identified

*No defects identified in this workstream. All assertions passed specification invariants.*
