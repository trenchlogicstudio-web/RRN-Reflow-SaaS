// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// Read-only configuration check. It never prints secrets or calls providers.
import { readiness } from './src/readiness.js';
const report=readiness(process.env);
for(const check of report.checks)console.log(`${check.ok?'PASS':'FAIL'} ${check.id}: ${check.description}`);
console.log('These checks validate configuration, not live service delivery.');
process.exitCode=report.ready?0:1;
