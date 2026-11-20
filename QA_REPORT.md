# QA report — Reflow 0.3.2

## 0.3.2 — 20 November 2026

The open-source release. Reflow is released under the MIT License, and nothing in
the application's behaviour, schema or translations changed.

- **Changed:** `LICENSE` (MIT) added; every source file carries a copyright and
  `SPDX-License-Identifier: MIT` line, and so does the Worker bundle; `package.json`
  names the licence and the author. The draft marketplace listing and the paragraph
  of the handover notes about a sale are removed. `SHA256SUMS.txt` is no longer
  shipped: in a git repository every file is already identified by its content.
  This report is now in English. CI runs on `actions/checkout@v7` and
  `actions/setup-node@v7`, on Node.js 22.13.0, 22.x, 24.x and 26.x.
- **Checks:** 105 of 105 tests pass, none skipped, on Node.js 22.13.0, 22.23.4, 24
  and 26, with the workflow run locally and with colour forced; the Worker bundle
  builds byte for byte the same on all of them. The landing page, the demo and 15
  app pages open in Chrome without errors. The Docker build was not run: the
  official Node.js image could not be downloaded here.
  [TEST_RESULTS.txt](TEST_RESULTS.txt) holds the full output of the run recorded with
  this release.

The rest of this document is the record of 0.3.1 and 0.3.0.

## 0.3.1 — 16 November 2026

Starting point: RRN 0.3.0. One change of behaviour, with no change to the database
schema and no new translations.

- **What it was:** if a salon changed the price or the length of a service between
  the moment the offer was shown and the moment the request was sent, the request
  was stored at the new terms. A client who saw €40 on the page was recorded at €80.
  The rules "never a discount" and "at least +30% time" were not broken by this, but
  the stored terms were not the ones the client chose.
- **What it is now:** choosing a time carries the price and the total duration the
  client saw (`src/quote.js`). If either has changed in the meantime, the request is
  refused with the existing message and the client gets a fresh offer. The same
  holds for rescheduling.
- **Checks on Node 22.23.4:** 105 of 105 tests pass, none skipped (101 existing and
  4 new in `test/quote.test.js`). The test that the built Worker matches the source
  passes after the rebuild.
- **Not checked in this update:** Cloudflare Workers/D1, a real browser and load.
  Every limit stated below for 0.3.0 still applies.

## 0.3.0 — 27 October 2026

Starting point: RRN 0.2.1. This release brings functional and security
improvements; it is not a confirmation that the product is free of faults or ready
for any volume of production traffic.

### What was done

- Added an appointment overview and search, filters and pagination, completed
  service and no-show.
- Added cancelling and rescheduling through the client's private link; a
  rescheduled appointment waits for the salon's confirmation again.
- Added blocked periods and closing a whole day, a configurable cancellation
  deadline and expiry of a temporary hold.
- Added staff invitations, owner/staff permissions, email confirmation and
  management of one's own account.
- Strengthened the SQL capacity checks and the protection against concurrent
  changes. A stale decision cannot overwrite a newer booking.
- Strengthened billing: the current subscription state through the provider's API,
  a check of the plan and the mode, binding a subscription to its salon, and
  protection against stale events. An unpaid checkout does not activate access.
- Strengthened passwords, introduced a separate pepper, and made changing and
  resetting a password safer.
- Added reminders and cancellation messages; stale messages tied to an earlier
  version of a booking are skipped.
- Booked value and the value of completed services are kept apart from collected
  revenue. The estimates on the operator page are not accounting records.
- Completed the translations and the documentation; added a configuration example,
  a configuration check, a Dockerfile and CI.

### Checks performed

| Check | Result |
|---|---|
| Automated tests on Node 24.22.1 | 101 of 101 passed; none skipped |
| New regression tests | 22, including concurrent bookings and resets, deadlines, rescheduling, permissions, billing and email |
| Existing tests | Kept; expectations updated for intended changes of behaviour |
| Source and shipped Worker | The test that the built bundle matches the source passes |
| Database migration | A local test of an old database migrated to schema 3 passes |
| Local HTTP server | Home page, health, demo login, six working pages and CSS/JS return the expected statuses |
| Localisation | 617 keys per translated dictionary, six translations beside English; completeness and parameters checked |
| Production configuration | Incomplete settings refuse to start; the doctor does not show secrets |

The tests use controlled clocks, an in-memory or SQLite database and simulated
responses from outside services. They send no real email and charge no real card.

### What was not confirmed

A visual review on a phone or a computer was not completed: Playwright was
available, but no Chromium executable was installed in that environment. No
independent accessibility review was done, and no WCAG certification is claimed.
Old screenshots from an earlier release are not included as evidence of the new
interface.

No real Cloudflare deployment or D1 test, Docker build, load test, independent
security review, real purchase or cancellation of a subscription, delivery to real
mailboxes or restore of a production backup was performed. Those need the target
infrastructure and the owner's accounts. The supplied CI is a configuration, not
proof that it has already run on GitHub.

PBKDF2 at 100,000 iterations with a separate pepper is a compromise for the Workers
environment, not compliance with the OWASP recommendation of 600,000 iterations. Do
not lose or change the pepper without a plan for resetting passwords. Details and
the steps for going live are in DEPLOY.md.

Relay and Nexus remain directions of development. No two-way integration with
other booking services, calendars of individual staff members, charging clients
for services or management of a chain of salons was added. This was work on the
Reflow product, with no claim that every conceivable module is finished.

The technical tests confirm substantial progress in the flows they cover. A claim
of production readiness would also need the external checks listed above, real use
and measurable commercial results.

---

Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · MIT License
