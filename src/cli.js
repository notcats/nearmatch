#!/usr/bin/env node
// CLI: read a JSON array of raw messages (file arg or stdin), print the
// event report. Usage:
//   node src/cli.js messages.json
//   cat messages.json | node src/cli.js
import { readFileSync } from 'node:fs';
import { run } from './pipeline.js';
import { printReport } from './report.js';

const arg = process.argv[2];
const raw = arg ? readFileSync(arg, 'utf8') : readFileSync(0, 'utf8');
const messages = JSON.parse(raw);
if (!Array.isArray(messages)) {
  console.error('Expected a JSON array of messages.');
  process.exit(1);
}
printReport(run(messages));
