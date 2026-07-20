# nearmatch

Deduplicate echoes and count **independent sources per event** for crisis
monitoring. Zero dependencies, plain ES modules, Node ≥ 18.

The value is not in collecting messages — it is in answering honestly: *how
many independent origins reported one event?* Publics repost each other and
aggregators (e.g. `@monitoring_56`) collect them all. Count messages and one
event looks like ten sources; the confidence label then lies. This engine
counts **distinct independent origins per event**, never message volume.

## Pipeline

```
ingest → normalize → collapse echoes → tier-tag sources → cluster into events → score
```

| Stage | File | What it does |
|---|---|---|
| 1. Normalize | `src/normalize.js` | strip URLs/@tags/#hashtags/emoji/boilerplate/RKN labels; fold case, ё→е, punctuation → `canonical_text` |
| 2. Collapse echoes | `src/echo.js` + `src/simhash.js` | forward chains (`fwd_from`) **and** near-duplicate text (64-bit SimHash) → one `contentGroup` per underlying post |
| 3. Tier-tag | `src/tiers.js` | A = originators (**counted**), B = aggregators/rebroadcasters (**not counted**), C = official (separate flag). Explicit overrides + empirical forward/borrow ratios |
| 4. Cluster | `src/cluster.js` | key = `(topic, geo_unit, time_bucket)`. Geo is **city/district**, never oblast |
| 5. Score | `src/score.js` | distinct Tier-A origins after dedup; injection & recirculation guards; confidence label |

### The counter

`independent_origins` = distinct Tier-A **author identities**, one per content
group (earliest wins), with forwards, aggregators, injection bursts and
recirculated content all excluded. A person posting in three chats is one
identity (`user:<id>`); a channel is its own identity (`chan:<name>`).

## Traps handled

1. **One person, many chats** — deduped by `author_id` across channels → 1 origin.
2. **Aggregator quotes an original** — near-dup + forward chain collapse it; the Tier-B tag stops any double count.
3. **Coordinated copypaste (вброс)** — a large, bursty, low-originator content group is **flagged `suspected_injection` and excluded**, not counted.
4. **Old content reposted as new** — `canonical_text` hash checked against history; older-than-N-days matches set `recirculated` and are not counted.

## Usage

```js
import { run } from 'nearmatch';

const { events, tiers, report } = run(rawMessages, { history });
```

Each raw message:

```js
{
  id, channel,                    // channel is normalized (strip @, lowercase)
  author_id,                      // optional; enables cross-chat dedup
  text, ts,                       // ISO 8601
  fwd_from: { channel, msg_id },  // optional; MTProto forward origin
  is_forward,                     // optional; inferred from fwd_from too
  geo_unit,                       // optional; honored over the gazetteer
  account_age_days,               // optional; strengthens injection detection
}
```

Event record (stored shape):

```json
{
  "event_id": "fuel|Орск|2828",
  "topic": "fuel",
  "geo_unit": "Орск",
  "first_seen_ts": "2026-07-18T01:00:00.000Z",
  "first_seen_channel": "orsk_life",
  "independent_origins": 1,
  "aggregator_hits": 30,
  "official_confirmed": true,
  "suspected_injection": false,
  "recirculated": false,
  "confidence_label": "единичное / не подтверждено · подтверждено официально"
}
```

CLI:

```bash
node src/cli.js messages.json      # or: cat messages.json | node src/cli.js
```

## Demo (hypothesis check)

```bash
npm run demo
```

Runs a synthetic "fuel in Оренбуржье, 48h" corpus with a **known** ground
truth of 6 genuine origins buried under aggregator forwards, copypaste, a
multi-chat author, an official confirmation, an injection burst and
recirculated content. Current run: **196 raw messages → 6 independent origins
(~18× echo compression)**. Heavy compression confirms echo dominates the raw
feed and the block is justified; near-zero compression would mean the near-dup
threshold needs revisiting.

```bash
npm test    # node --test — asserts the 6-origin recovery and every trap
```

## Confidence labels

| origins | label |
|---|---|
| 1 | единичное / не подтверждено |
| 2–4 | сообщается / требует проверки |
| 5+ | массовые сообщения |
| + Tier-C present | … · подтверждено официально |

A label is a **description of corroboration, not a decision to publish**.

## Privacy / security

Author identity is used **transiently**, only at the clustering stage, to
avoid double-counting one person. It is **not** written to the stored event
record — that keeps only hashes and an obfuscated origin identity. Store
hashes, not people. Raw text is meant to be discarded once the event record is
extracted; keep only the content hash (for recirculation checks) and the
event record. See `src/pipeline.js` for where `author_id` enters and exits.

## Calibration (levers in `src/config.js`)

- `simhashMaxDistance` (3) — raise if genuine copypaste slips through; lower if unrelated short posts collide.
- `aggregatorForwardRatio` / `aggregatorBorrowRatio` (0.6) — how much reposting makes a channel Tier B.
- `timeBucketHours` (6) — event window; tuned for АЗС queues.
- `labelThresholds` (2 / 5) — origin counts for the labels.
- `injection.*` — burst size, window, and max originator share for the вброс guard.
- `recirculationDays` (7) — age past which identical content is "recirculated".

Known channel anchors (`TIER_OVERRIDES`): `monitoring_56` → B, `okes.ru` → C.

## Scaling

Near-dup grouping is O(n²) **within a single event cluster**, so n stays small
in practice. For corpus-wide matching, band the 64-bit SimHash into LSH buckets
(e.g. 4×16-bit bands) and only compare within a band before the Hamming check.

## Not in this block

Full **geo extraction** (city/district from free text — morphology, ambiguity,
multi-mention) is the next ORDER (stage 4). Here `src/cluster.js` ships a
lightweight placeholder gazetteer and honors an upstream-provided `geo_unit`.
Telegram ingestion (MTProto) is upstream of `run()` and out of scope for this
block.
