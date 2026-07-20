import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../src/index.js';
import { normalize, shingles } from '../src/normalize.js';
import { simhash, hamming, fnv1a64 } from '../src/simhash.js';
import { buildFixture } from './fixtures.js';

test('normalize strips decoration and folds ё/case/punct', () => {
  const a = normalize('В Орске НЕТ бензина!!! 🔥 @orsk_life https://t.me/x #дефицит');
  const b = normalize('в орске нет бензина');
  assert.equal(a, b);
});

test('simhash: near-dup texts are within threshold, unrelated are far', () => {
  const base = simhash(shingles(normalize('в орске нет бензина на азс очереди')));
  const near = simhash(shingles(normalize('в орске нет бензина на азс очереди 🔥')));
  const far = simhash(shingles(normalize('в бузулуке отключили свет во всем районе')));
  assert.ok(hamming(base, near) <= 3, 'copypaste should be near');
  assert.ok(hamming(base, far) > 3, 'different event should be far');
});

function fuelResult() {
  const { messages, recircText, recircSeenMs } = buildFixture();
  const history = new Map([
    [fnv1a64(normalize(recircText)).toString(16), recircSeenMs],
  ]);
  return run(messages, { history });
}

test('recovers exactly 6 genuine fuel origins from the noisy corpus', () => {
  const origins = fuelResult()
    .events.filter((e) => e.topic === 'fuel' && !e.recirculated)
    .reduce((s, e) => s + e.independent_origins, 0);
  assert.equal(origins, 6);
});

test('aggregators are tiered B and never counted as origins', () => {
  const r = fuelResult();
  const mon = r.tiers.find((t) => t.channel === 'monitoring_56');
  assert.equal(mon.tier, 'B');
  for (const e of r.events) {
    assert.ok(!e.origin_identities.includes('chan:monitoring_56'));
    assert.ok(e.aggregator_hits >= 0);
  }
});

test('multi-chat author counts once', () => {
  const sol = fuelResult().events.find((e) => e.geo_unit === 'Соль-Илецк');
  assert.equal(sol.independent_origins, 1);
  assert.deepEqual(sol.origin_identities, ['user:U100']);
});

test('coordinated injection is flagged and excluded from Оренбург count', () => {
  const orb = fuelResult().events.find((e) => e.geo_unit === 'Оренбург');
  assert.equal(orb.suspected_injection, true);
  assert.equal(orb.independent_origins, 1); // genuine origin only, not the 6 bots
});

test('official confirmation sets the Tier-C flag for Орск', () => {
  const orsk = fuelResult().events.find((e) => e.geo_unit === 'Орск');
  assert.equal(orsk.official_confirmed, true);
  assert.match(orsk.confidence_label, /официально/);
});

test('recirculated old content is flagged and not counted', () => {
  const sor = fuelResult().events.find((e) => e.geo_unit === 'Сорочинск');
  assert.equal(sor.recirculated, true);
  assert.equal(sor.independent_origins, 0);
});

test('echo compression is substantial (raw >> content groups)', () => {
  const { report } = fuelResult();
  assert.ok(report.raw_messages >= 180, `expected ~200 raw, got ${report.raw_messages}`);
  assert.ok(report.compression_ratio >= 5, `expected heavy compression, got ${report.compression_ratio}x`);
});
