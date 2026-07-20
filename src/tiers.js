// Stage 3 — Tier-tag sources.
//
// The whole point of the project: an aggregator is NOT a source. If we let
// @monitoring_56 (which reposts everything) count toward independence, one
// event looks corroborated when it is a single echo chamber.
//
//   Tier A — originators (local channels, chats, eyewitnesses)  -> COUNT
//   Tier B — aggregators / rebroadcasters                        -> do NOT count
//   Tier C — official (okes.ru, ЖКХ portals)                     -> separate flag
//
// Classification: explicit overrides first, then an empirical heuristic over
// the ingest window (how much a channel forwards, how much of its text was
// seen elsewhere first).

import { TIER_OVERRIDES } from './config.js';

/**
 * @param {object[]} messages  normalized messages (need .channel, .is_forward,
 *   .canonical_text, .ts, and a resolved .contentGroup id)
 * @param {object} config
 * @returns {Map<string, {tier: 'A'|'B'|'C', forwardRatio: number,
 *   borrowRatio: number, reason: string}>} keyed by channel
 */
export function classifyTiers(messages, config) {
  const byChannel = new Map();
  for (const m of messages) {
    if (!byChannel.has(m.channel)) byChannel.set(m.channel, []);
    byChannel.get(m.channel).push(m);
  }

  // For "borrow ratio": for each content group, who posted it first? Anyone
  // posting the same content later "borrowed" it.
  const firstSeenByGroup = new Map();
  for (const m of messages) {
    const g = m.contentGroup;
    const prev = firstSeenByGroup.get(g);
    if (prev === undefined || m.tsMs < prev.tsMs) firstSeenByGroup.set(g, m);
  }

  const result = new Map();
  for (const [channel, msgs] of byChannel) {
    const override = resolveOverride(channel);
    if (override) {
      result.set(channel, {
        tier: override,
        forwardRatio: null,
        borrowRatio: null,
        reason: 'explicit override',
      });
      continue;
    }

    const forwards = msgs.filter((m) => m.is_forward).length;
    const forwardRatio = forwards / msgs.length;

    let borrowed = 0;
    for (const m of msgs) {
      const first = firstSeenByGroup.get(m.contentGroup);
      if (first && first.channel !== channel) borrowed++;
    }
    const borrowRatio = borrowed / msgs.length;

    let tier = 'A';
    let reason = 'originates its own content';
    if (
      forwardRatio >= config.aggregatorForwardRatio ||
      borrowRatio >= config.aggregatorBorrowRatio
    ) {
      tier = 'B';
      reason = `aggregator (forwards ${(forwardRatio * 100) | 0}%, borrowed ${(borrowRatio * 100) | 0}%)`;
    }

    result.set(channel, { tier, forwardRatio, borrowRatio, reason });
  }

  return result;
}

function resolveOverride(channel) {
  if (!channel) return null;
  const key = String(channel).replace(/^@/, '').toLowerCase();
  return TIER_OVERRIDES[key] || null;
}
