# Handover — 0.3.2

Included: source, tests, Worker bundle, configuration example, CI workflow, Dockerfile and documentation. Not included: hosting, domain, provider accounts, customer data or evidence of commercial traction.

To hand over a running installation, transfer a tested database backup, configuration inventory, secrets through a secure channel, domain and provider-account arrangements. Preserve AUTH_PEPPER for existing passwords. Rotate the operator key and other credentials through a planned process. Source-code transfer does not transfer merchant accounts or customer payment agreements.

Restore to an isolated environment first. Disable production mail/webhooks on that test copy. Re-enable only after confirming routing. Keep the old environment until launch checks in DEPLOY.md pass.

Data is scoped by salon ID. Owners control business settings, billing, exports and team access. Staff manage appointments/availability and their own preferences. Newly created salons have one owner; owner transfer and multi-location organizations have no UI flow.

Run npm test and npm run build after edits. CI runs the suite on Node 22.13.0, 22.x, 24.x and 26.x; QA_REPORT.md states what was checked locally. The custom builder rejects unsupported module syntax. Keep source and dist together.

Remaining operational work: provider validation, visual browser checks, external security review, load profiling, monitoring and recovery drills. Read QA_REPORT.md before promising scale, compliance or availability.

---

Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · MIT License
