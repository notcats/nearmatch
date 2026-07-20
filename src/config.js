// Central tunables. Thresholds are the levers you revisit after the first
// real-data run (see README "Calibration").

export const DEFAULT_CONFIG = {
  // Stage 2b — near-duplicate collapse.
  simhashMaxDistance: 3, // Hamming distance under which two texts are "the same"

  // Stage 3 — tier classification heuristics (used when a channel has no
  // explicit tier override). Measured over the ingest window.
  aggregatorForwardRatio: 0.6, // >= this share of forwards/reposts => Tier B
  aggregatorBorrowRatio: 0.6, // >= this share of text seen elsewhere first => Tier B

  // Stage 4 — event clustering.
  timeBucketHours: 6, // rolling window width for one event

  // Stage 5 — scoring / confidence labels.
  labelThresholds: { reported: 2, mass: 5 }, // origins >= reported / >= mass

  // Injection (coordinated-copypaste) guard.
  injection: {
    minCopies: 4, // a content group must be at least this large to be suspect
    windowMinutes: 30, // ...arriving within this window
    maxOriginatorShare: 0.25, // ...and mostly NOT from Tier-A channels with history
  },

  // Recirculation (old content reposted as new).
  recirculationDays: 7, // same content-hash seen older than this => recirculated
};

// Known channels for the Orenburg pilot. Empirical classification still runs
// for everything else; these are the anchors we are certain about.
export const TIER_OVERRIDES = {
  'monitoring_56': 'B', // pure aggregator — a discovery tool, never an origin
  'okes.ru': 'C', // official utility/ЖКХ portal
  'okes': 'C',
};
