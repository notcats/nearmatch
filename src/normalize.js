// Stage 1 — Normalize.
// Reduce a raw message to a canonical form so that echoes/copypaste of the
// same content collapse together regardless of channel-specific decoration.
//
// We strip anything that copy-editors routinely add or change (links, @tags,
// hashtags, emoji, boilerplate CTAs, RKN labels) and fold orthographic noise
// (case, ё/е, punctuation, whitespace, zero-width chars).

const ZERO_WIDTH = /[​-‍⁠﻿]/g;
const URL = /https?:\/\/\S+|t\.me\/\S+|\b\S+\.(?:ru|com|org|net|рф)\/\S*/gi;
const MENTION = /@[a-z0-9_]+/gi;
const HASHTAG = /#[\p{L}0-9_]+/giu;
// Emoji + pictographs + variation selectors.
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{1F1E6}-\u{1F1FF}]/gu;

// Boilerplate that channels append and that carries no event signal.
const BOILERPLATE = [
  /подпис(ывайтесь|ка|аться)[^.!?\n]*/gi,
  /прислать\s+новост[ья][^.!?\n]*/gi,
  /прислать\s+фото[^.!?\n]*/gi,
  /наш\s+канал[^.!?\n]*/gi,
  /реклама[^.!?\n]*/gi,
  /erid[:\s][^\s]+/gi,
  /\bРКН\b[^.!?\n]*/gi,
  /включ[её]н\s+в\s+реестр[^.!?\n]*/gi,
  /иностранн(ый|ого)\s+агент[^.!?\n]*/gi,
  /\bбот[а-я]*\s+обратной\s+связи[^.!?\n]*/gi,
];

/**
 * @param {string} raw
 * @returns {string} canonical_text
 */
export function normalize(raw) {
  if (!raw) return '';
  let t = String(raw);

  t = t.replace(ZERO_WIDTH, '');
  t = t.replace(URL, ' ');
  t = t.replace(MENTION, ' ');
  t = t.replace(HASHTAG, ' ');
  t = t.replace(EMOJI, ' ');
  for (const re of BOILERPLATE) t = t.replace(re, ' ');

  t = t.toLowerCase();
  t = t.replace(/ё/g, 'е');
  // Keep letters/digits/spaces only (any script), collapse the rest.
  t = t.replace(/[^\p{L}\p{N}\s]/gu, ' ');
  t = t.replace(/\s+/g, ' ').trim();

  return t;
}

/**
 * Tokenize canonical text into features for SimHash: word unigrams + bigrams.
 * Bigrams make the fingerprint sensitive to word order, so unrelated messages
 * that merely share a vocabulary do not collide.
 * @param {string} canonical
 * @returns {string[]}
 */
export function shingles(canonical) {
  const words = canonical.split(' ').filter(Boolean);
  if (words.length === 0) return [];
  const out = words.slice();
  for (let i = 0; i < words.length - 1; i++) {
    out.push(words[i] + '_' + words[i + 1]);
  }
  return out;
}
