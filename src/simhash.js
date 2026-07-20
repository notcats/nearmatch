// SimHash — a 64-bit locality-sensitive fingerprint of a token set.
// Near-identical texts (copypaste with small edits) produce fingerprints with
// small Hamming distance, which lets us group them without exact matching.
// Zero dependencies: FNV-1a for per-feature hashing, BigInt for 64-bit math.

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK64 = (1n << 64n) - 1n;

/** Deterministic 64-bit FNV-1a hash of a string. */
export function fnv1a64(str) {
  let h = FNV_OFFSET;
  for (let i = 0; i < str.length; i++) {
    h ^= BigInt(str.charCodeAt(i));
    h = (h * FNV_PRIME) & MASK64;
  }
  return h;
}

/**
 * Compute the 64-bit SimHash of a list of features.
 * @param {string[]} tokens
 * @returns {bigint}
 */
export function simhash(tokens) {
  const v = new Int32Array(64);
  for (const tok of tokens) {
    const h = fnv1a64(tok);
    for (let i = 0; i < 64; i++) {
      v[i] += (h >> BigInt(i)) & 1n ? 1 : -1;
    }
  }
  let out = 0n;
  for (let i = 0; i < 64; i++) {
    if (v[i] > 0) out |= 1n << BigInt(i);
  }
  return out;
}

/** Hamming distance between two 64-bit fingerprints. */
export function hamming(a, b) {
  let x = a ^ b;
  let count = 0;
  while (x) {
    x &= x - 1n; // clear lowest set bit
    count++;
  }
  return count;
}

/**
 * Group items by SimHash near-duplication using union-find.
 * O(n^2) within the call — callers should scope it to a single event cluster
 * so n stays small. For corpus-wide use, band the fingerprint into LSH buckets
 * first (see README "Scaling").
 * @param {{simhash: bigint}[]} items
 * @param {number} maxDistance  Hamming threshold for "same content".
 * @returns {number[]} parent array (union-find roots); items[i] and items[j]
 *   are near-dups iff find(i) === find(j).
 */
export function groupNearDuplicates(items, maxDistance) {
  const parent = items.map((_, i) => i);
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
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (hamming(items[i].simhash, items[j].simhash) <= maxDistance) {
        union(i, j);
      }
    }
  }
  return parent.map((_, i) => find(i));
}
