// Public API for the nearmatch dedup / independent-source engine.
export { run } from './pipeline.js';
export { normalize, shingles } from './normalize.js';
export { simhash, hamming, fnv1a64, groupNearDuplicates } from './simhash.js';
export { collapseEchoes } from './echo.js';
export { classifyTiers } from './tiers.js';
export { clusterEvents, detectTopic, detectGeo } from './cluster.js';
export { scoreEvents } from './score.js';
export { DEFAULT_CONFIG, TIER_OVERRIDES } from './config.js';
