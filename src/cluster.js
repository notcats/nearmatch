// Stage 4 — Cluster messages into events.
//
// Cluster key: (topic_tag, geo_unit, time_bucket).
//   topic  — keyword match (fuel / power / food ...)
//   geo    — CITY/DISTRICT level, never oblast. Орск != Бузулук != Соль-Илецк
//            are different events. Full geo extraction is its own (next) ORDER;
//            here we use a lightweight gazetteer and honor a pre-set m.geo_unit.
//   time   — rolling bucket (default 6h, tuned for AЗС queues).

const TOPICS = {
  fuel: ['бензин', 'дизель', 'дт', 'азс', 'заправк', 'топлив', 'а95', 'а92', 'солярк', 'горючее'],
  power: ['свет', 'электричеств', 'отключ', 'подстанц', 'обесточ', 'энерго', 'напряжен'],
  food: ['продукт', 'хлеб', 'магазин', 'полк', 'сахар', 'дефицит', 'очеред'],
  water: ['вода', 'водоснабж', 'водоканал', 'без воды'],
};

// Placeholder city gazetteer for the Orenburg pilot. The real stage-4 geo ORDER
// replaces this with proper extraction (district level, morphology, ambiguity).
const GAZETTEER = {
  'орск': 'Орск',
  'бузулук': 'Бузулук',
  'соль-илецк': 'Соль-Илецк',
  'соль илецк': 'Соль-Илецк',
  'новотроицк': 'Новотроицк',
  'оренбург': 'Оренбург',
  'гай': 'Гай',
  'сорочинск': 'Сорочинск',
};

export function detectTopic(canonical) {
  for (const [topic, kws] of Object.entries(TOPICS)) {
    if (kws.some((k) => canonical.includes(k))) return topic;
  }
  return 'other';
}

export function detectGeo(canonical, preset) {
  if (preset) return preset; // trust an upstream-provided unit
  for (const [needle, name] of Object.entries(GAZETTEER)) {
    if (canonical.includes(needle)) return name;
  }
  return 'unknown';
}

/**
 * @param {object[]} messages  normalized + echo-collapsed
 * @param {object} config
 * @returns {Map<string, object[]>} clusterKey -> messages
 */
export function clusterEvents(messages, config) {
  const bucketMs = config.timeBucketHours * 3600 * 1000;
  const clusters = new Map();
  for (const m of messages) {
    m.topic = detectTopic(m.canonical_text);
    m.geo_unit = detectGeo(m.canonical_text, m.geo_unit);
    const bucket = Math.floor(m.tsMs / bucketMs);
    const key = `${m.topic}|${m.geo_unit}|${bucket}`;
    if (!clusters.has(key)) clusters.set(key, []);
    clusters.get(key).push(m);
  }
  return clusters;
}
