// Runs the full pipeline on the synthetic fixture and prints the report.
//   node test/demo.js
import { run } from '../src/index.js';
import { normalize } from '../src/normalize.js';
import { fnv1a64 } from '../src/simhash.js';
import { buildFixture } from './fixtures.js';

const { messages, recircText, recircSeenMs } = buildFixture();

// Seed the recirculation history with the old-content hash.
const history = new Map([
  [fnv1a64(normalize(recircText)).toString(16), recircSeenMs],
]);

const result = run(messages, { history });

import { printReport } from '../src/report.js';
printReport(result);

const fuelOrigins = result.events
  .filter((e) => e.topic === 'fuel' && !e.recirculated)
  .reduce((s, e) => s + e.independent_origins, 0);
console.log(`Ground truth = 6 genuine fuel origins. Engine recovered: ${fuelOrigins}.`);
console.log(
  fuelOrigins === 6
    ? '✓ echo, aggregators, multi-chat author, injection and recirculation all handled.\n'
    : '✗ mismatch — inspect the events above.\n',
);
