// Stage 2 — Collapse echoes (message level).
//
// Two signals, both required (the ORDER is explicit that either alone leaks):
//   2a. Forward chains — MTProto gives fwd_from; every forward of one original
//       is the same content, so they share one content group.
//   2b. Near-duplicate text — copypaste without forward metadata (someone
//       pasted the text and tweaked a tag/emoji). Caught by SimHash distance.
//
// Output: every message gets a `contentGroup` id. Messages in the same group
// are the same underlying post, no matter how many channels carry it.

import { simhash, hamming } from './simhash.js';

/**
 * @param {object[]} messages  each with .canonical_text, .shingleTokens,
 *   optional .id, optional .fwd_from {channel, msg_id}
 * @param {number} simhashMaxDistance
 * @returns {object[]} the same messages, mutated with .simhash and .contentGroup
 */
export function collapseEchoes(messages, simhashMaxDistance) {
  const n = messages.length;
  const parent = messages.map((_, i) => i);
  const find = (i) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  // Fingerprint every message once.
  for (const m of messages) m.simhash = simhash(m.shingleTokens);

  // 2a. Forward chains. Link a message to the original it forwards, if that
  // original is present in the corpus, and link all forwards of one original.
  const originIndex = new Map(); // "channel:msgId" -> index of the source post
  for (let i = 0; i < n; i++) {
    const m = messages[i];
    if (m.channel != null && m.id != null) {
      originIndex.set(originKey(m.channel, m.id), i);
    }
  }
  const forwardBucket = new Map(); // origin key -> [indices of its forwards]
  for (let i = 0; i < n; i++) {
    const f = messages[i].fwd_from;
    if (!f) continue;
    const key = originKey(f.channel, f.msg_id);
    if (originIndex.has(key)) union(i, originIndex.get(key)); // link to source
    if (!forwardBucket.has(key)) forwardBucket.set(key, []);
    forwardBucket.get(key).push(i); // ...and to sibling forwards
  }
  for (const idxs of forwardBucket.values()) {
    for (let k = 1; k < idxs.length; k++) union(idxs[0], idxs[k]);
  }

  // 2b. Near-duplicate text. O(n^2) — fine at pilot scale; band into LSH
  // buckets for corpus-wide use (see README "Scaling").
  for (let i = 0; i < n; i++) {
    if (!messages[i].canonical_text) continue;
    for (let j = i + 1; j < n; j++) {
      if (!messages[j].canonical_text) continue;
      if (hamming(messages[i].simhash, messages[j].simhash) <= simhashMaxDistance) {
        union(i, j);
      }
    }
  }

  for (let i = 0; i < n; i++) messages[i].contentGroup = find(i);
  return messages;
}

function originKey(channel, msgId) {
  return `${String(channel).replace(/^@/, '').toLowerCase()}:${msgId}`;
}
