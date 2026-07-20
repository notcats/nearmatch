// Orchestrator: ingest -> normalize -> collapse echoes -> tier-tag ->
// cluster -> score. Returns event records plus a compression report (the
// hypothesis check: how much does echo dominate the raw feed?).

import { DEFAULT_CONFIG } from './config.js';
import { normalize, shingles } from './normalize.js';
import { collapseEchoes } from './echo.js';
import { classifyTiers } from './tiers.js';
import { clusterEvents } from './cluster.js';
import { scoreEvents } from './score.js';

/**
 * @param {object[]} rawMessages  {id, channel, author_id?, text, ts,
 *   fwd_from?:{channel,msg_id}, is_forward?, geo_unit?, account_age_days?}
 * @param {object} [opts]  { config?, history? }
 * @returns {{ events: object[], tiers: object[], report: object }}
 */
export function run(rawMessages, opts = {}) {
  const config = { ...DEFAULT_CONFIG, ...(opts.config || {}) };
  const history = opts.history || new Map();

  // Ingest + normalize (stage 1). Privacy: we carry author_id only transiently,
  // for cross-chat dedup; it never lands in the stored event record.
  const messages = rawMessages.map((r) => {
    const canonical_text = normalize(r.text);
    return {
      id: r.id,
      channel: normChannel(r.channel),
      author_id: r.author_id ?? null,
      ts: r.ts,
      tsMs: Date.parse(r.ts),
      is_forward: !!r.is_forward || !!r.fwd_from,
      fwd_from: r.fwd_from
        ? { channel: normChannel(r.fwd_from.channel), msg_id: r.fwd_from.msg_id }
        : null,
      geo_unit: r.geo_unit || null,
      account_age_days: r.account_age_days ?? null,
      canonical_text,
      shingleTokens: shingles(canonical_text),
    };
  });

  collapseEchoes(messages, config.simhashMaxDistance); // stage 2
  const tierMap = classifyTiers(messages, config); // stage 3
  const clusters = clusterEvents(messages, config); // stage 4
  const events = scoreEvents(clusters, tierMap, config, history); // stage 5

  const distinctContentGroups = new Set(messages.map((m) => m.contentGroup)).size;
  const totalOrigins = events.reduce((s, e) => s + e.independent_origins, 0);

  return {
    events,
    tiers: [...tierMap.entries()].map(([channel, t]) => ({ channel, ...t })),
    report: {
      raw_messages: messages.length,
      after_dedup_content_groups: distinctContentGroups,
      events: events.length,
      independent_origins_total: totalOrigins,
      compression_ratio:
        distinctContentGroups > 0
          ? +(messages.length / distinctContentGroups).toFixed(1)
          : null,
    },
  };
}

function normChannel(c) {
  return c == null ? c : String(c).replace(/^@/, '').toLowerCase();
}
