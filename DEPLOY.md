# Deployment — 0.3.2

## Configuration

Use `.env.example` as the inventory. `APP_ENV=production` returns 503 until required configuration passes.

| Variable | Requirement |
|---|---|
| PUBLIC_ORIGIN | Exact public HTTPS origin, e.g. https://app.example.com |
| ADMIN_KEY | Independent random secret, at least 32 characters |
| AUTH_PEPPER | Independent random secret, at least 32 characters; back up separately from the database |
| PBKDF2_ITERATIONS | 100000 |
| REQUIRE_EMAIL_VERIFICATION | on; production enables it automatically |
| MAIL_PROVIDER / MAIL_FROM | resend with a verified sender and RESEND_API_KEY, or supported Cloudflare EMAIL binding |
| OPERATOR_NAME / CONTACT_EMAIL | Actual operator and support address |
| Billing | Full settings below when subscriptions are enabled |

Run `node --env-file=.env doctor.js` to check equivalent settings without exposing secrets. Readiness also appears after operator login. Passing it does not test provider delivery or legal sufficiency. Review privacy/terms and any required business notice for your operation before launch.

Passwords use PBKDF2-SHA256 at 100,000 iterations by default with an HMAC pepper required by the production gate. Old hashes upgrade on successful login. This Workers-compatible compromise is below OWASP's published 600,000-iteration PBKDF2-SHA256 recommendation; do not describe it as meeting that recommendation. Preserve AUTH_PEPPER during deployment/transfer: losing or changing it invalidates peppered passwords and requires a reset process. Size Workers CPU allowance from real signup/login load; do not assume the free plan is sufficient.

## Cloudflare Workers and D1

1. Create a D1 database and a Worker; bind the database as DB.
2. Run `npm run build` and deploy dist/worker.js. Alternatively configure the real database ID in wrangler.toml and use your Wrangler deployment workflow.
3. Set variables/secrets and configure the exact public HTTPS domain. Other origins are rejected.
4. Set cron to `*/15 * * * *` for retries, reminders, hold expiry and retention. Traffic also triggers maintenance periodically.
5. Set APP_ENV=production, verify /healthz, then test signup, verification, owner login and staff invitation.

The application applies migrations on startup. Take a database export before upgrade and first upgrade a separate copy. No live Cloudflare deployment or remote D1 test was performed here; the local D1-compatible SQLite adapter and Worker bundle were tested.

## Node / Docker

Run `node --env-file=.env local.js` under a process supervisor behind an HTTPS reverse proxy. Preserve the public Host header. The server uses PUBLIC_ORIGIN for the request scheme and rejects mismatched hosts; it does not trust arbitrary forwarded headers. Restrict direct backend access. Persist DB_PATH and monitor disk space. Rate limiting sees the backend peer IP, so a proxy can group users under one limit: tune the deployment before growing traffic.

The supplied Dockerfile runs as non-root node. Build with `docker build -t reflow:0.3.2 .`; provide an env file, persistent volume at /app/data and appropriate network/proxy settings. The Docker build was not executed here.

## Subscriptions

Set all of BILLING_PROVIDER (stripe or lemonsqueezy), CHECKOUT_URL, BILLING_WEBHOOK_SECRET (at least 24 characters for production), BILLING_API_KEY (secret with subscription-read permissions), BILLING_PRICE_ID (Stripe recurring Price ID or Lemon Squeezy variant ID), BILLING_MODE (test on staging; live in production) and a usable BILLING_PORTAL_URL. Also set PRICE_LABEL, PRICE_MONTHLY_CENTS and BILLING_CURRENCY to match the provider; optionally configure TRIAL_DAYS and BILLING_GRACE_DAYS.

Blank billing settings mean free beta. Existing beta salons receive a trial on their next public/private visit when billing is enabled. Mixed modes, products or accounts prevent activation. The operator MRR figure is an estimate from active salon count and configured monthly price, not reconciled revenue.

Stripe: use a recurring Payment Link. Set webhook URL /billing/webhook for checkout.session.completed, checkout.session.async_payment_succeeded, checkout.session.async_payment_failed, customer.subscription.created, customer.subscription.updated and customer.subscription.deleted. Checkout adds a salon reference. Completion alone does not prove payment; production retrieves the subscription before granting access. Configure the customer portal for cancellations.

Lemon Squeezy: use a subscription checkout URL, exact variant ID and signed /billing/webhook. Enable subscription create/update/cancel/resume/expire/pause/unpause events. Checkout adds salon_id custom data; production retrieves the subscription through its API.

Provider lookup failures or temporarily missing ownership return 503 for retry. Duplicate events are acknowledged. Older events cannot revive a terminated subscription. A linked subscription moved to another plan loses access. Configure provider delivery alerts and periodically reconcile with the provider: a background reconciliation job is not included.

## Launch and recovery

On staging test subscription success, delayed/failed payment, cancellation, renewal, wrong product, duplicate delivery and API outage. Then test one authorized live purchase and cancel/refund it as appropriate. Verify signup/reset/invite/booking/cancellation/reminder mail in real inboxes and inspect /admin failures.

For SQLite, stop the app before copying the database, or use SQLite online backup/VACUUM INTO. Never copy only the main file during WAL writes. Encrypt backups, restrict access, keep the pepper separately and test restoration in isolation. For D1 use supported export/backup facilities and restore into a new database first. No recovery drill was performed here. Retain the old deployment and pre-upgrade backup until validation finishes.

Email uses retries and stable provider idempotency keys; obsolete reservation revisions are suppressed. Exactly-once delivery is not guaranteed across provider timeouts/retention. Reminders are eligible 2–24 hours before an appointment after at least 2 hours of confirmed status; cron must run. Downloaded ICS files do not update automatically after rescheduling; replace them. Salon feed refresh depends on the calendar client.

---

Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · MIT License
