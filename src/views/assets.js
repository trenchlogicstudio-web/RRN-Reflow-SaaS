// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// Static assets served by the app itself: one stylesheet, one small script,
// the icon. No fonts or files are loaded from anywhere else.

export const CSS = `
:root {
  --paper: #f5f7f5;
  --surface: #ffffff;
  --ink: #1c2a29;
  --muted: #566563;
  --line: #d6dedb;
  --line-strong: #a9b6b2;
  --berry: #8c2c4b;
  --berry-ink: #ffffff;
  --berry-soft: #f6e7ed;
  --sage: #3f6f5c;
  --sage-ink: #ffffff;
  --sage-soft: #e2eee8;
  --amber: #7f560b;
  --amber-soft: #f7edd8;
  --danger: #a3261b;
  --danger-soft: #fbe5e2;
  --serif: "Iowan Old Style", "Palatino Linotype", Palatino, "URW Palladio L", P052, "Book Antiqua", Georgia, serif;
  --sans: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif;
  --r-sm: 6px;
  --r-md: 10px;
  --r-lg: 18px;
  color-scheme: light;
}

@media (prefers-color-scheme: dark) {
  :root {
    --paper: #101817;
    --surface: #17211f;
    --ink: #e4ebe9;
    --muted: #9daba8;
    --line: #2a3936;
    --line-strong: #46564f;
    --berry: #e48aa6;
    --berry-ink: #2a0e18;
    --berry-soft: #3a1e29;
    --sage: #8cc2a9;
    --sage-ink: #0f1f18;
    --sage-soft: #1c2f28;
    --amber: #e3b866;
    --amber-soft: #382d16;
    --danger: #f1958a;
    --danger-soft: #3b1f1b;
    color-scheme: dark;
  }
}

*, *::before, *::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  background: var(--paper);
  color: var(--ink);
  font: 400 1rem/1.55 var(--sans);
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}
main { flex: 1; }
img, svg { max-width: 100%; }
a { color: var(--berry); text-underline-offset: 0.18em; text-decoration-thickness: 1px; }
code { overflow-wrap: anywhere; }
a:hover { text-decoration-thickness: 2px; }
:focus-visible { outline: 3px solid var(--berry); outline-offset: 2px; border-radius: 2px; }
.skip { position: absolute; left: -999px; top: 0; background: var(--surface); padding: .5rem 1rem; z-index: 10; }
.skip:focus { left: 1rem; }

h1, h2, h3 {
  font-family: var(--serif);
  font-weight: 600;
  line-height: 1.15;
  margin: 0 0 .5em;
  text-wrap: balance;
}
h1 { font-size: clamp(2rem, 1.4rem + 2.6vw, 3.1rem); letter-spacing: -0.01em; }
h2 { font-size: clamp(1.4rem, 1.2rem + 0.9vw, 1.85rem); }
h3 { font-size: 1.2rem; }
p { margin: 0 0 1rem; }
.lead { font-size: 1.125rem; color: var(--muted); max-width: 38rem; }
.muted { color: var(--muted); }
.small { font-size: .875rem; }
.num { font-variant-numeric: lining-nums tabular-nums; }
.nowrap { white-space: nowrap; }
.visually-hidden { position: absolute !important; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

.wrap { width: 100%; max-width: 66rem; margin: 0 auto; padding: 0 1rem; }
.narrow { max-width: 36rem; }
.stack > * + * { margin-top: 1rem; }
.section { padding: 2.5rem 0; }
.section + .section { border-top: 1px solid var(--line); }

/* ---------- header and footer ---------- */
.bar { background: var(--surface); border-bottom: 1px solid var(--line); }
.bar-inner { display: flex; align-items: center; gap: 1rem; min-height: 3.75rem; flex-wrap: wrap; padding-top: .4rem; padding-bottom: .4rem; }
.brand { font-family: var(--serif); font-size: 1.3rem; font-weight: 600; color: var(--ink); text-decoration: none; display: inline-flex; align-items: center; gap: .55rem; }
.brand svg { width: 1.6rem; height: 1.6rem; flex: none; }
.bar-actions { order: 1; margin-left: auto; display: flex; gap: .5rem; align-items: center; }
.nav { order: 2; width: 100%; margin: 0 -.25rem; }
.nav ul { list-style: none; display: flex; flex-wrap: wrap; gap: .15rem .25rem; margin: 0; padding: 0; }
.nav a { display: block; padding: .45rem .75rem; border-radius: var(--r-sm); color: var(--muted); text-decoration: none; white-space: nowrap; font-weight: 500; }
.nav a:hover { color: var(--ink); background: var(--paper); }
.nav a[aria-current="page"] { color: var(--ink); background: var(--paper); box-shadow: inset 0 -2px 0 var(--berry); }
@media (min-width: 52rem) {
  /* Long translations wrap inside the menu instead of pushing "Log out" to its own line. */
  .nav { order: 1; width: auto; margin: 0; flex: 1 1 0; min-width: 0; }
  .nav a { padding: .45rem .6rem; }
  .bar-actions { order: 2; }
}
.footer { margin-top: 3rem; padding: 1.5rem 0 2rem; border-top: 1px solid var(--line); color: var(--muted); font-size: .875rem; }
.footer-inner { display: flex; flex-wrap: wrap; gap: .5rem 1.5rem; }
.footer a { color: var(--muted); }

/* ---------- buttons and forms ---------- */
.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: .4rem;
  min-height: 44px; padding: .55rem 1.1rem;
  border-radius: var(--r-sm); border: 1px solid transparent;
  font: 600 1rem/1.2 var(--sans); cursor: pointer; text-decoration: none;
  background: transparent; color: var(--ink);
}
.btn-primary { background: var(--berry); color: var(--berry-ink); }
.btn-primary:hover { filter: brightness(1.08); }
.btn-confirm { background: var(--sage); color: var(--sage-ink); }
.btn-confirm:hover { filter: brightness(1.08); }
.btn-outline { border-color: var(--line-strong); background: var(--surface); }
.btn-outline:hover { border-color: var(--ink); }
.btn-link { padding-left: .25rem; padding-right: .25rem; color: var(--berry); text-decoration: underline; text-underline-offset: .18em; font-weight: 500; }
.btn-danger { border-color: var(--danger); color: var(--danger); background: var(--surface); }
.btn-small { min-height: 36px; padding: .35rem .8rem; font-size: .9375rem; }
.btn-block { width: 100%; }
.actions { display: flex; flex-wrap: wrap; gap: .6rem; align-items: center; }
form.inline { display: inline; }

.field { margin: 0 0 1.1rem; }
.field > label, .label { display: block; font-weight: 600; margin: 0 0 .35rem; }
.hint { display: block; color: var(--muted); font-size: .875rem; margin-top: .3rem; }
.error-text { display: block; color: var(--danger); font-size: .875rem; margin-top: .3rem; font-weight: 500; }
input[type="text"], input[type="email"], input[type="password"], input[type="number"], input[type="time"], input[type="url"], input[type="tel"], select, textarea {
  width: 100%; font: inherit; color: var(--ink);
  padding: .6rem .75rem; min-height: 44px;
  background: var(--surface); border: 1px solid var(--line-strong); border-radius: var(--r-sm);
}
textarea { min-height: 5.5rem; resize: vertical; }
input:hover, select:hover, textarea:hover { border-color: var(--ink); }
[aria-invalid="true"] { border-color: var(--danger) !important; box-shadow: 0 0 0 1px var(--danger); }
.check, .field > .check { display: flex; gap: .65rem; align-items: flex-start; font-weight: 400; }
.check input { width: 1.15rem; height: 1.15rem; margin: .2rem 0 0; flex: none; accent-color: var(--berry); }
.row { display: grid; gap: 0 1rem; }
@media (min-width: 36rem) {
  .row-2 { grid-template-columns: 1fr 1fr; }
  .row-3 { grid-template-columns: 1fr 1fr 1fr; }
}
.trap { position: absolute; left: -10000px; width: 1px; height: 1px; overflow: hidden; }

.notice { padding: .8rem 1rem; border-radius: var(--r-sm); margin: 0 0 1.25rem; border-left: 4px solid; background: var(--surface); }
.notice-ok { border-color: var(--sage); background: var(--sage-soft); }
.notice-error { border-color: var(--danger); background: var(--danger-soft); }
.notice-info { border-color: var(--amber); background: var(--amber-soft); }
.notice p:last-child { margin-bottom: 0; }

.panel { background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-md); padding: 1.25rem; }
.panel + .panel { margin-top: 1rem; }
.panel h2:first-child, .panel h3:first-child { margin-top: 0; }

/* ---------- badges ---------- */
.badge { display: inline-block; padding: .1rem .6rem; border-radius: 999px; font-size: .8125rem; font-weight: 600; border: 1px solid transparent; white-space: nowrap; }
.badge-pending { color: var(--amber); background: var(--amber-soft); }
.badge-confirmed, .badge-closed, .badge-ok { color: var(--sage); background: var(--sage-soft); }
.badge-declined, .badge-expired, .badge-off { color: var(--muted); border-color: var(--line-strong); }
.badge-warn { color: var(--danger); background: var(--danger-soft); }

/* ---------- the salon price list (client page) ---------- */
.menu { list-style: none; margin: 0 0 1.5rem; padding: 0; border-top: 1px solid var(--line); }
.menu li { border-bottom: 1px solid var(--line); }
.menu a { display: flex; align-items: baseline; gap: .6rem; padding: 1.05rem .2rem; color: var(--ink); text-decoration: none; }
.menu a:hover .menu-name { text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: .2em; }
.menu-name { font-family: var(--serif); font-size: 1.2rem; line-height: 1.3; }
.menu-leader { flex: 1 1 1.5rem; min-width: 1.5rem; border-bottom: 2px dotted var(--line-strong); transform: translateY(-.32em); }
.menu-time { color: var(--muted); white-space: nowrap; font-variant-numeric: tabular-nums; }
.menu-price { font-weight: 600; white-space: nowrap; font-variant-numeric: lining-nums tabular-nums; }

.salon-head { padding: 2.25rem 0 1rem; }
.salon-head h1 { margin-bottom: .35rem; }
.public main { padding-bottom: 1rem; }

/* ---------- appointment cards ---------- */
.offers { border: 0; padding: 0; margin: 0 0 1.75rem; display: grid; gap: .75rem; min-width: 0; }
.offers legend { font-family: var(--serif); font-size: 1.25rem; font-weight: 600; margin-bottom: .75rem; padding: 0; }
.offer {
  display: grid; grid-template-columns: auto 1fr; gap: .15rem .9rem;
  padding: 1rem 1.1rem; background: var(--surface);
  border: 1px solid var(--line); border-left: 5px solid var(--sage); border-radius: var(--r-md);
  cursor: pointer;
}
.offer:hover { border-color: var(--line-strong); border-left-color: var(--sage); }
.offer:has(input:checked) { border-color: var(--berry); border-left-color: var(--berry); box-shadow: 0 0 0 1px var(--berry); }
.offer input { grid-row: 1 / span 4; width: 1.2rem; height: 1.2rem; margin: .35rem 0 0; accent-color: var(--berry); }
.offer-when { font-family: var(--serif); font-size: 1.3rem; font-weight: 600; line-height: 1.25; }
.offer-time { font-variant-numeric: tabular-nums; }
.offer-what { color: var(--ink); }
.offer-extra { color: var(--muted); font-size: .9375rem; }
.offer-price { font-weight: 600; }
.offer-price span { color: var(--sage); font-weight: 500; }

.ticket {
  background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-lg);
  padding: 1.5rem 1.4rem; margin: 0 0 1.5rem; position: relative;
}
.ticket-when { font-family: var(--serif); font-size: 1.6rem; font-weight: 600; line-height: 1.2; margin: .35rem 0; }
.ticket dl { display: grid; grid-template-columns: max-content 1fr; gap: .35rem 1rem; margin: 1rem 0 0; }
.ticket dt { color: var(--muted); }
.ticket dd { margin: 0; }

/* ---------- landing: the reflow demonstration ---------- */
.hero { padding: 3rem 0 2.5rem; }
.hero h1 { max-width: 20ch; }
.hero .lead { margin-bottom: 1.5rem; }
.demo {
  margin-top: 2.5rem; display: grid; gap: 1rem; align-items: center;
  grid-template-columns: 1fr;
}
@media (min-width: 48rem) { .demo { grid-template-columns: 1fr 3.5rem 1fr; } }
.day { background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-md); padding: 1rem 1rem 1.1rem; }
.day-name { font-family: var(--serif); font-size: 1.15rem; font-weight: 600; margin: 0 0 .7rem; display: flex; justify-content: space-between; align-items: baseline; gap: .5rem; }
.day-name small { font-family: var(--sans); font-size: .8125rem; font-weight: 600; }
.day-full .day-name small { color: var(--berry); }
.day-quiet .day-name small { color: var(--sage); }
.slots { list-style: none; margin: 0; padding: 0; display: grid; grid-auto-rows: 2.6rem; gap: 4px; }
.slot { display: grid; grid-template-columns: 3.2rem 1fr; align-items: center; border-radius: var(--r-sm); padding: 0 .6rem; font-size: .9375rem; color: var(--muted); border: 1px dashed var(--line-strong); }
.slot > span:first-child { font-variant-numeric: tabular-nums; font-weight: 600; color: var(--ink); }
.slot-busy { background: var(--berry-soft); border: 1px solid transparent; color: var(--berry); }
.slot-wanted { box-shadow: inset 0 0 0 2px var(--berry); }
.slot-offer { grid-row: span 2; background: var(--sage-soft); border: 1px solid var(--sage); color: var(--ink); align-items: start; padding-top: .55rem; line-height: 1.35; }
.slot-offer b { font-weight: 600; }
.slot-offer em { font-style: normal; color: var(--sage); font-weight: 600; }
.demo-arrow { display: flex; justify-content: center; color: var(--line-strong); }
.demo-arrow svg { width: 2.5rem; height: 2.5rem; transform: rotate(90deg); }
@media (min-width: 48rem) { .demo-arrow svg { transform: none; } }
.demo-caption { grid-column: 1 / -1; color: var(--muted); font-size: .9375rem; margin: .25rem 0 0; }

.steps { list-style: none; counter-reset: step; margin: 0; padding: 0; display: grid; gap: 1.5rem; }
@media (min-width: 48rem) { .steps { grid-template-columns: repeat(3, 1fr); } }
.steps li { counter-increment: step; padding-top: 2.6rem; position: relative; }
.steps li::before {
  content: counter(step); position: absolute; top: 0; left: 0;
  width: 2rem; height: 2rem; border-radius: 50%; border: 1.5px solid var(--berry); color: var(--berry);
  display: grid; place-items: center; font-family: var(--serif); font-weight: 600;
}
.rules { display: grid; gap: 1.5rem 2.5rem; }
@media (min-width: 48rem) { .rules { grid-template-columns: 1fr 1fr; } }
.rules h3 { margin-bottom: .3rem; }
.rules p { margin: 0; color: var(--muted); }

.tiers { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--line); }
.panel + .tiers, .notice + .tiers { margin-top: 1.5rem; }
.tiers li { display: grid; gap: .25rem 2rem; padding: 1.25rem 0; border-bottom: 1px solid var(--line); }
@media (min-width: 48rem) { .tiers li { grid-template-columns: 11rem 1fr 13rem; align-items: baseline; } }
.tier-name { font-family: var(--serif); font-size: 1.35rem; font-weight: 600; }
.tier-scope { display: block; font-family: var(--sans); font-size: .875rem; font-weight: 500; color: var(--muted); }
.tier-state { font-weight: 600; }
.tier-live .tier-state { color: var(--sage); }
.tier-soon .tier-state { color: var(--muted); }
.section-end { margin-top: 1.75rem; }
.section-title { margin-top: 2.25rem; }

/* ---------- salon dashboard ---------- */
.page-head { padding: 2rem 0 1.25rem; display: flex; flex-wrap: wrap; gap: .5rem 1rem; align-items: flex-end; justify-content: space-between; }
.page-head h1 { margin: 0; font-size: clamp(1.75rem, 1.4rem + 1.4vw, 2.4rem); }
.page-head p { margin: .35rem 0 0; }

.ledger { display: grid; grid-template-columns: 1fr 1fr; margin: 0 0 2rem; background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-md); }
@media (min-width: 48rem) { .ledger { grid-template-columns: repeat(4, 1fr); } }
.ledger > div { padding: 1rem 1.1rem; border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); }
.ledger > div:nth-child(2n) { border-right: 0; }
.ledger > div:nth-last-child(-n + 2) { border-bottom: 0; }
@media (min-width: 48rem) {
  .ledger > div { border-bottom: 0; border-right: 1px solid var(--line); }
  .ledger > div:nth-child(2n) { border-right: 1px solid var(--line); }
  .ledger > div:last-child { border-right: 0; }
}
.ledger.ledger-two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.request p { margin: 0; overflow-wrap: anywhere; }
.ledger dt { color: var(--muted); font-size: .875rem; }
.ledger dd { margin: .2rem 0 0; font-family: var(--serif); font-size: 1.7rem; font-weight: 600; font-variant-numeric: lining-nums tabular-nums; line-height: 1.2; }
.ledger .proof dd { color: var(--sage); }

.checklist { list-style: none; counter-reset: task; margin: 0; padding: 0; display: grid; gap: .6rem; }
.checklist li { counter-increment: task; display: grid; grid-template-columns: 2rem 1fr; gap: .2rem .75rem; align-items: start; }
.checklist li::before { content: counter(task); width: 1.75rem; height: 1.75rem; border-radius: 50%; display: grid; place-items: center; font-weight: 700; font-size: .875rem; border: 1.5px solid var(--line-strong); color: var(--muted); }
.checklist li.done::before { content: "\\2713"; background: var(--sage); border-color: var(--sage); color: var(--sage-ink); }
.checklist li.done a { color: var(--muted); }

.share { display: grid; gap: .75rem; }
.share-link { display: flex; flex-wrap: wrap; gap: .5rem; align-items: center; }
.share-link code { font-family: var(--sans); font-weight: 600; background: var(--paper); padding: .4rem .65rem; border-radius: var(--r-sm); border: 1px solid var(--line); word-break: break-all; }
.snippets { display: grid; gap: .75rem; margin-top: .5rem; }
.snippet { border: 1px solid var(--line); border-radius: var(--r-sm); padding: .75rem .9rem; background: var(--paper); }
.snippet p { margin: 0 0 .5rem; }
.snippet .where { font-size: .875rem; color: var(--muted); margin-bottom: .25rem; }

.requests { list-style: none; margin: 0 0 2rem; padding: 0; display: grid; gap: .75rem; }
.request { background: var(--surface); border: 1px solid var(--line); border-left: 5px solid var(--amber); border-radius: var(--r-md); padding: 1rem 1.1rem; display: grid; gap: .6rem; }
.request.is-confirmed { border-left-color: var(--sage); }
.request.is-closed, .request.is-declined, .request.is-expired { border-left-color: var(--line-strong); }
.request-top { display: flex; flex-wrap: wrap; gap: .4rem .9rem; align-items: baseline; justify-content: space-between; }
.request-when { font-family: var(--serif); font-size: 1.25rem; font-weight: 600; }
.request-who a { font-weight: 600; }
.request details summary { cursor: pointer; color: var(--berry); font-weight: 500; }
.request textarea { margin-top: .5rem; font-size: .9375rem; }

.table-wrap { overflow-x: auto; }
table.list { width: 100%; border-collapse: collapse; margin: 0 0 1.5rem; }
.list th, .list td { text-align: left; padding: .7rem .6rem; border-bottom: 1px solid var(--line); vertical-align: top; }
.list th { font-size: .875rem; color: var(--muted); font-weight: 600; }
.day-short { display: none; }
@media (max-width: 30rem) {
  .list th, .list td { padding: .6rem .35rem; }
  .day-long { display: none; }
  .day-short { display: inline; }
}

.items { list-style: none; margin: 0 0 2rem; padding: 0; display: grid; gap: .75rem; }
.item { background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-md); padding: 1rem 1.1rem; }
.item.is-off { opacity: .72; }
.item-head { display: flex; flex-wrap: wrap; gap: .3rem .9rem; align-items: baseline; justify-content: space-between; margin-bottom: .35rem; }
.item-title { font-family: var(--serif); font-size: 1.2rem; font-weight: 600; }
.item details { margin-top: .5rem; }
.item details summary { cursor: pointer; color: var(--berry); font-weight: 500; }
.item details[open] summary { margin-bottom: .75rem; }
.readiness { font-size: .9375rem; }
.readiness.ok { color: var(--sage); }
.readiness.bad { color: var(--danger); }

.week { display: block; width: 100%; max-width: 40rem; height: auto; margin: 0 0 1.5rem; background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-md); }
.week .grid-line { stroke: var(--line); stroke-width: 1; }
.week .day-label { fill: var(--ink); font: 600 15px var(--sans); }
.week .hour-label { fill: var(--muted); font: 12.5px var(--sans); }
.week .qh { fill: var(--sage-soft); stroke: var(--sage); stroke-width: 1.2; }
.week .qh-label { fill: var(--ink); font: 600 12.5px var(--sans); }
.days { display: flex; flex-wrap: wrap; gap: .4rem .9rem; border: 0; padding: 0; margin: 0 0 1.1rem; }
.days legend { font-weight: 600; margin-bottom: .4rem; padding: 0; }
.days label { display: inline-flex; align-items: center; gap: .35rem; font-weight: 400; }
.days input { width: 1.1rem; height: 1.1rem; accent-color: var(--berry); }

.events { list-style: none; margin: 0 0 1.5rem; padding: 0; border-top: 1px solid var(--line); }
.events li { display: grid; gap: .1rem 1rem; padding: .75rem 0; border-bottom: 1px solid var(--line); }
@media (min-width: 44rem) { .events li { grid-template-columns: 9rem 12rem 1fr; align-items: baseline; } }
.events time { color: var(--muted); font-size: .9375rem; font-variant-numeric: tabular-nums; }
.events strong { font-weight: 600; }
.fingerprint { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: .8125rem; }

.center-card { max-width: 28rem; margin: 3rem auto; }
.center-card h1 { font-size: 2rem; }

.empty { color: var(--muted); padding: 1rem 0 1.5rem; }


/* ---------- language switcher ---------- */
.langs { margin-top: .75rem; }
.langs ul { list-style: none; display: flex; flex-wrap: wrap; gap: .25rem .9rem; margin: 0; padding: 0; }
.langs a { color: var(--muted); text-decoration: none; }
.langs a:hover { text-decoration: underline; }
.langs a[aria-current="true"] { color: var(--ink); font-weight: 600; }

.salon-meta { color: var(--muted); margin: -.1rem 0 .8rem; font-size: .9375rem; }
.banners { padding-top: 1rem; }
.banners .notice { margin-bottom: .5rem; }

/* ---------- results funnel ---------- */
.funnel { margin: 0 0 2rem; }
.funnel-steps { list-style: none; margin: 0; padding: 0; display: grid; gap: .65rem; }
.funnel-steps li { display: grid; grid-template-columns: 1fr; gap: .2rem; }
@media (min-width: 40rem) { .funnel-steps li { grid-template-columns: 13rem 1fr 11rem; align-items: center; gap: 1rem; } }
.funnel-label { font-weight: 500; }
.funnel-n { font-weight: 600; }
.funnel-n small { font-weight: 400; color: var(--muted); }
.funnel progress { width: 100%; height: .8rem; appearance: none; -webkit-appearance: none; border: 0; border-radius: 999px; background: var(--paper); overflow: hidden; }
.funnel progress::-webkit-progress-bar { background: var(--paper); border-radius: 999px; }
.funnel progress::-webkit-progress-value { background: var(--sage); border-radius: 999px; }
.funnel progress::-moz-progress-bar { background: var(--sage); border-radius: 999px; }

/* ---------- guided setup ---------- */
.choices { list-style: none; margin: 0 0 1.5rem; padding: 0; display: grid; gap: .75rem; }
@media (min-width: 40rem) { .choices { grid-template-columns: 1fr 1fr; } }
.choice { display: block; height: 100%; padding: 1rem 1.1rem; background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-md); color: var(--ink); text-decoration: none; }
.choice:hover { border-color: var(--berry); }
.choice-title { display: block; font-family: var(--serif); font-size: 1.25rem; font-weight: 600; margin-bottom: .25rem; }
.setup-table td { vertical-align: middle; }
.setup-table input[type="text"], .setup-table input[type="number"] { min-height: 40px; padding: .4rem .55rem; }
.setup-table input[type="checkbox"] { width: 1.2rem; height: 1.2rem; accent-color: var(--berry); }
.setup-table td:nth-child(3) { width: 6.5rem; }
.setup-table td:nth-child(4) { width: 8rem; }
.setup .panel { margin-bottom: 1rem; }

/* ---------- share kit and QR ---------- */
.qr-row { display: flex; flex-wrap: wrap; gap: 1rem 1.5rem; align-items: center; }
.qr { width: 168px; height: 168px; background: #fff; border: 1px solid var(--line); border-radius: var(--r-sm); padding: 6px; }
textarea[readonly] { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: .8125rem; }

/* ---------- printable poster ---------- */
.poster-page { background: #fff; color: #111; }
.poster { max-width: 34rem; margin: 0 auto; padding: 2.5rem 1.5rem; text-align: center; }
.poster-salon { font-family: var(--serif); font-size: 1.4rem; margin: 0 0 1.5rem; }
.poster-title { font-size: 3.4rem; margin: 0 0 .5rem; color: #8c2c4b; }
.poster-lead { font-size: 1.35rem; line-height: 1.4; margin: 0 auto 1.75rem; max-width: 26rem; color: #1c2a29; }
.poster-qr { width: 15rem; height: 15rem; display: block; margin: 0 auto 1rem; }
.poster-url { font-size: 1.1rem; font-weight: 600; margin: 0 0 2rem; word-break: break-all; color: #1c2a29; }
.poster-foot { color: #566563; font-size: .9rem; margin: 0 0 1.5rem; }
@media print {
  .poster-actions, .skip { display: none !important; }
  .poster { padding-top: 0; }
  @page { margin: 1.5cm; }
}

@media (prefers-reduced-motion: no-preference) {
  .offer, .btn { transition: border-color .15s ease, box-shadow .15s ease, filter .15s ease; }
}
@media print {
  .bar, .footer, .actions { display: none; }
}
`;

export const JS = `(function () {
  'use strict';
  document.addEventListener('submit', function(event) {
    var form = event.target;
    if (form.dataset.confirm && !window.confirm(form.dataset.confirm)) { event.preventDefault(); return; }
    if (form.dataset.sending === 'true') { event.preventDefault(); return; }
    form.dataset.sending = 'true';
    setTimeout(function() { form.dataset.sending = ''; }, 12000);
  });

  // Copy buttons: <button data-copy="#target"> copies the target's text or value.
  document.addEventListener('click', function (event) {
    var button = event.target.closest('[data-copy]');
    if (!button) return;
    var target = document.querySelector(button.getAttribute('data-copy'));
    if (!target) return;
    var text = 'value' in target && target.value !== undefined ? target.value : target.textContent;
    var done = function () {
      var label = button.getAttribute('data-label') || button.textContent;
      button.setAttribute('data-label', label);
      button.textContent = 'Copied';
      setTimeout(function () { button.textContent = label; }, 1600);
    };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text.trim()).then(done, function () {});
    } else if (target.select) {
      target.select();
      try { document.execCommand('copy'); done(); } catch (e) {}
    }
  });
  // Printable poster.
  document.addEventListener('click', function (event) {
    if (event.target.closest('[data-print]')) window.print();
  });
  // Demo form: pass the browser's time zone along.
  document.querySelectorAll('input[data-detect-timezone-input]').forEach(function (input) {
    try { input.value = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) {}
  });
  // Sign-up: preselect the browser's own time zone.
  var tz = document.querySelector('select[data-detect-timezone]');
  if (tz && !tz.getAttribute('data-chosen')) {
    try {
      var zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (zone && tz.querySelector('option[value="' + zone.replace(/"/g, '') + '"]')) tz.value = zone;
    } catch (e) {}
  }
})();
`;

export const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#1c2a29"/><rect x="7" y="8" width="11" height="5" rx="2" fill="#e48aa6"/><rect x="7" y="17" width="18" height="7" rx="2" fill="#8cc2a9"/></svg>`;

export const ROBOTS = `User-agent: *
Disallow: /app
Disallow: /admin
Disallow: /r/
Disallow: /reset/
Disallow: /s/
`;

/* Link-preview image (1200×630) and home-screen icon (180×180), PNG, drawn without text so they suit any product name and language. */
export const OG_PNG = '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';
export const TOUCH_ICON_PNG = 'iVBORw0KGgoAAAANSUhEUgAAALQAAAC0BAMAAADP4xsBAAAAMFBMVEUcKimMwqnkiqZIZlw2OTtiiXhLRkooNDNWeWzTgpubZ3hvm4h4VmOCtJ2PYXG7d4zP/zQXAAAACXBIWXMAAAsTAAALEwEAmpwYAAABWUlEQVR42u3YwSoFURzH8VOTeyWpUxZKNicRK+UFrpIUxSPchZWNm52kKFsliY3yAjZKWdl4AyvKRvctlIXsZ47z6++/0Hw/D/Bt+s+ZOWcmBAAAAAAA0FKbn6nG7d3AXN5KDW6s7fHU6NKYfm5OL/RM5U7KuDalD3LpRVN6mEsn00QusukPr1GndO6z9H7MG9IT+fSsIT2WT8+RbnvacfE5PjKOD7rj6+mXl2rfkt732wqy99G47w695pG97CvrEWevcdL249Nu/QL86oU/sFpjEAAAwL+ytlxoRwx3z2KxN+0IcRIFU0r5MEoehfS9lp4uL49E0XZxekVNT3rNQ5hIN8pK11+lp5cK06N6+thrgZQvEdKkSZMm3fq04wbmuO129HTxf8UXtTzjcwTWjsFHavq1OF153UV9IspnQeV20SFsKOUH7RNs/ak0/H7KlzAAAAAAAG31DeIHH2j4TBxqAAAAAElFTkSuQmCC';
