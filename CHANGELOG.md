# Changelog

## 0.3.2 — 2026-11-20

- Open-source release under the MIT License (`LICENSE`). Every source file and the Worker bundle carry a copyright and `SPDX-License-Identifier: MIT` line; `package.json` names the licence and the author.
- Removed the draft marketplace listing (`LISTING.md`) and the paragraph about a sale from `HANDOVER.md`. `SHA256SUMS.txt` is no longer shipped: in a git repository every file is already identified by its content.
- `QA_REPORT.md` is in English.
- CI on `actions/checkout@v7` and `actions/setup-node@v7`, Node.js 22.13.0, 22.x, 24.x and 26.x.
- No change to behaviour, schema or translations. Rebuilt Worker; `TEST_RESULTS.txt` regenerated.
- Verified: 105 of 105 tests pass on Node.js 22.13.0, 22.23.4, 24 and 26, and the bundle builds byte for byte the same on all of them; see `QA_REPORT.md`.

## 0.3.1 — 2026-11-16

- A request now carries the price and the total duration the client was shown (`src/quote.js`). Before, a request sent from a page that had since changed was stored at the new terms: a client who saw €40 was recorded at €80 when the salon raised the price in between. Such a request is now refused with the existing "That time was just taken or has changed" answer and the current offers; rescheduling follows the same rule.
- The two invariants were never broken by this: the stored price was always the standard price and the added time always at least 30%. What changed is that the stored terms are now the terms the client chose.
- Added 4 regression tests (`test/quote.test.js`): changed price, changed duration, a choice without its quote, and rescheduling from a stale page. 105 tests in total.
- Rebuilt Worker; `SHA256SUMS.txt` and `TEST_RESULTS.txt` regenerated.

## 0.3.0 — 2026-10-27

- Added searchable appointments, completed/no-show outcomes, client cancellation/rescheduling, time blocks and booking policy.
- Added owner/staff permissions, single-use invitations, email verification and account management.
- Enforced capacity atomically during creation, confirmation and rescheduling; added revision guards and temporary hold expiry.
- Added provider verification, price/mode checks, subscription ownership and event ordering; unpaid checkout no longer activates access and past-due access is bounded.
- Raised password cost to 100,000; added pepper, legacy upgrade and concurrency-safe password change/reset handling.
- Added revision-aware mail, retry keys, cancellation notifications and reminders.
- Distinguished booked/completed service values from collected revenue and added production readiness checks.
- Added 22 regression tests, updated six dictionaries to 617 keys, refreshed deployment/handover docs and supplied env example, Dockerfile and CI.
- Rebuilt Worker. See QA_REPORT.md for results and limitations.

## 0.2.1 baseline

Supplied baseline: Reflow engine, salon setup, translated public/dashboard pages, webhook handlers, mail outbox, QR/calendar/export utilities, operator console and dependency-free build. Earlier verification claims are not carried forward as evidence for this release.

---

Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · MIT License
