# Reflow / RRN SaaS 0.3.2

Reflow helps salons fill quiet hours with longer appointments at the normal service price. Offers always add at least 30% service time and never discount the standard price. Multiple independent salons are supported, each with one location and shared chair capacity.

This is a tested source-code release, open source under the [MIT License](LICENSE). No operated business, customers, revenue, domain, hosting or provider account is included or implied.

## Start locally

Use Node.js 22.13+ with built-in SQLite. Release 0.3.2 was tested on Node 22.13.0, 24 and 26. No npm dependencies need installing.

```sh
npm start
```

Open http://localhost:8787. Data is stored in `data/local.sqlite`. The demo creates disposable sample data, not real traction. To configure local mail output, copy `.env.example` to `.env`, then run `node --env-file=.env local.js`. Console mail prints private links locally. Never commit `.env` or database files.

## Included

| Area | Functionality |
|---|---|
| Booking | Up to three upgraded offers, atomic capacity guards, temporary holds, waitlist, confirmation |
| Lifecycle | Search and pagination, completed/no-show outcomes, cancellation and self-service rescheduling |
| Availability | Weekly quiet windows, chair capacity, holiday and external-booking blocks |
| Accounts | Owner/staff roles, single-use invitations, up to 10 users per salon, email verification, reset and session revocation |
| Email | Outbox, retry/backoff, revision checks, reminders and cancellation notifications |
| Subscriptions | Lemon Squeezy or Stripe, signatures, provider API verification, price/mode checks and event ordering |
| Reporting | Booking funnel, booked value and completed-service value; neither is a payment ledger |
| Distribution | Salon link, QR poster, calendar feed/ICS and CSV export |
| Operations | Operator page, audit chain, migrations, production configuration gate and doctor command |
| Languages | English, German, French, Spanish, Italian, Brazilian Portuguese and Dutch; 617 keys checked per translated dictionary |

A request carries the price and the total duration the client was shown. If the salon edits either between the page and the request, the request is refused and the client sees the current offers; the same holds for rescheduling.

Clients need no account. Private request links allow viewing and changing appointments: treat them like credentials. Changes require POST and same-origin checks. Pending requests expire after a configurable hold (default 24 hours) or when their start time passes. Confirmed appointments can be changed by clients until the configured cutoff (default 120 minutes). Rescheduling needs the salon's confirmation again.

## Verify

```sh
npm test
npm run build
node --env-file=.env doctor.js
```

The doctor checks configuration only and deliberately fails with the empty example. See QA_REPORT.md for measured results and untested boundaries.

## Architecture

`src/app.js` is the shared Request/Response application. Routes and server-rendered views are in `src/routes/` and `src/views/`. `src/db/schema.js` contains the base schema and migrations (current version 3). `src/billing-state.js`, `src/availability.js` and `src/lifecycle.js` guard critical transitions. `local.js` runs Node/SQLite; `worker.js` runs Workers/D1. The dependency-free `build.js` produces `dist/worker.js`.

`dist/schema.sql` contains only the original base schema for reference; it is not a full migration or restore script. The app applies versioned migrations on startup.

## Limits

Reflow is implemented. Relay and Nexus are roadmap/interest placeholders. There is no two-way booking-platform integration, per-employee calendar allocation, client service-payment collection, SMS, native mobile app or multi-location management. Enter external bookings as availability blocks. Subscriptions charge salons for software, not clients for services.

Read DEPLOY.md before launch and HANDOVER.md before taking over a running installation. Live payment/email delivery, Cloudflare deployment, visual browser checks, load testing and backup restoration remain to be validated in the target environment. Do not claim independent audit, certification or proven scalability.

## License

[MIT](LICENSE) — Copyright (c) 2026 Miloš Petrović (Trench Logic Studio). Provided as is, without warranty, support or maintenance commitments. Reflow, Relay and Nexus are the names of the three engines in `engines/`.

**Trench Logic Studio** — Miloš Petrović · milos@trench-logic.com · trenchlogicstudio.com
