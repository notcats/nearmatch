// Stage 5 — Score each event.
//
// The one number that matters: distinct INDEPENDENT origins, after we remove
// echoes (forwards + copypaste), aggregators (Tier B), the same author counted
// twice (multi-chat), and coordinated injection bursts.
//
//   independent_origins  = distinct Tier-A author identities, one per content
//                          group (earliest wins), forwards & injection excluded
//   aggregator_hits      = Tier-B messages (shown, never counted)
//   official_confirmed   = any Tier-C message present
//
// Guards: injection (coordinated copypaste) and recirculation (old content
// reposted as new) both demote a group so it cannot inflate the count.

import { fnv1a64 } from './simhash.js';

/**
 * @param {Map<string, object[]>} clusters   clusterKey -> messages
 * @param {Map<string, {tier: string}>} tierMap  channel -> tier
 * @param {object} config
 * @param {Map<string, number>} [history]   contentHashHex -> earliest tsMs seen
 * @returns {object[]} event records
 */
export function scoreEvents(clusters, tierMap, config, history = new Map()) {
  const events = [];
  for (const [key, messages] of clusters) {
    events.push(scoreOne(key, messages, tierMap, config, history));
  }
  // Most-corroborated first; then earliest.
  events.sort(
    (a, b) =>
      b.independent_origins - a.independent_origins ||
      a.first_seen_ms - b.first_seen_ms,
  );
  return events;
}

function tierOf(tierMap, channel) {
  return (tierMap.get(channel) || {}).tier || 'A';
}

function identityOf(m) {
  // A person in three chats is one origin; a channel is its own origin.
  return m.author_id != null ? `user:${m.author_id}` : `chan:${m.channel}`;
}

function scoreOne(key, messages, tierMap, config, history) {
  const [topic, geo_unit] = key.split('|');

  // Group messages by content group within this event.
  const groups = new Map();
  for (const m of messages) {
    if (!groups.has(m.contentGroup)) groups.set(m.contentGroup, []);
    groups.get(m.contentGroup).push(m);
  }

  const originIdentities = new Set();
  const originMessages = [];
  const injectionGroups = [];
  let recirculated = false;

  for (const g of groups.values()) {
    g.sort((a, b) => a.tsMs - b.tsMs);

    // Injection guard: a big, bursty, low-originator copypaste group is a
    // suspected вброс — flag it and exclude it from the origin count.
    if (isInjection(g, tierMap, config)) {
      injectionGroups.push(groupSummary(g));
      continue;
    }

    // Recirculation guard: has this exact content been seen long before?
    const hashHex = fnv1a64(g[0].canonical_text).toString(16);
    const seenAt = history.get(hashHex);
    if (seenAt != null && g[0].tsMs - seenAt > config.recirculationDays * 86400000) {
      recirculated = true;
      continue; // old content resurfacing is not a new origin
    }

    // The earliest Tier-A, non-forward message is this content's origin.
    const origin = g.find(
      (m) => !m.is_forward && tierOf(tierMap, m.channel) === 'A',
    );
    if (origin) {
      originIdentities.add(identityOf(origin));
      originMessages.push(origin);
    }
  }

  const aggregatorHits = messages.filter(
    (m) => tierOf(tierMap, m.channel) === 'B',
  ).length;
  const officialConfirmed = messages.some(
    (m) => tierOf(tierMap, m.channel) === 'C',
  );

  // First signal = earliest COUNTED origin (a вброс/echo never gets credit for
  // being first). Fall back to earliest raw message only if nothing counted.
  const firstPool = originMessages.length ? originMessages : messages;
  const first = firstPool.reduce((a, b) => (a.tsMs <= b.tsMs ? a : b));
  const independent = originIdentities.size;

  return {
    event_id: key,
    topic,
    geo_unit,
    first_seen_ms: first.tsMs,
    first_seen_ts: first.ts,
    first_seen_channel: first.channel,
    independent_origins: independent,
    origin_identities: [...originIdentities],
    aggregator_hits: aggregatorHits,
    official_confirmed: officialConfirmed,
    suspected_injection: injectionGroups.length > 0,
    injection_groups: injectionGroups,
    recirculated,
    raw_message_count: messages.length,
    confidence_label: label(independent, officialConfirmed, config),
  };
}

function isInjection(group, tierMap, config) {
  const { minCopies, windowMinutes, maxOriginatorShare } = config.injection;
  if (group.length < minCopies) return false;
  const spanMin = (group[group.length - 1].tsMs - group[0].tsMs) / 60000;
  if (spanMin > windowMinutes) return false;
  const established = group.filter(
    (m) =>
      tierOf(tierMap, m.channel) === 'A' &&
      !(m.account_age_days != null && m.account_age_days < 7),
  ).length;
  return established / group.length <= maxOriginatorShare;
}

function label(origins, official, config) {
  const { reported, mass } = config.labelThresholds;
  let base;
  if (origins >= mass) base = 'массовые сообщения';
  else if (origins >= reported) base = 'сообщается / требует проверки';
  else base = 'единичное / не подтверждено';
  return official ? `${base} · подтверждено официально` : base;
}

function groupSummary(g) {
  return {
    copies: g.length,
    channels: [...new Set(g.map((m) => m.channel))],
    span_minutes: Math.round((g[g.length - 1].tsMs - g[0].tsMs) / 60000),
    sample: g[0].canonical_text.slice(0, 80),
  };
}
