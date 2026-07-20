// Human-readable rendering of a pipeline result.

export function printReport({ events, tiers, report }) {
  console.log('\n=== COMPRESSION (hypothesis check) ===');
  console.log(`  raw messages ............ ${report.raw_messages}`);
  console.log(`  after dedup (content) ... ${report.after_dedup_content_groups}`);
  console.log(`  distinct events ......... ${report.events}`);
  console.log(`  independent origins ..... ${report.independent_origins_total}`);
  console.log(`  echo compression ........ ${report.compression_ratio}x`);

  console.log('\n=== SOURCE TIERS ===');
  const order = { A: 0, B: 1, C: 2 };
  for (const t of [...tiers].sort((a, b) => order[a.tier] - order[b.tier])) {
    console.log(`  [${t.tier}] ${t.channel.padEnd(20)} ${t.reason}`);
  }

  console.log('\n=== EVENTS ===');
  for (const e of events) {
    console.log(
      `\n  • ${e.topic.toUpperCase()} @ ${e.geo_unit}  —  ${e.confidence_label}`,
    );
    console.log(`    independent origins : ${e.independent_origins}  (${e.origin_identities.join(', ') || '—'})`);
    console.log(`    aggregator hits     : ${e.aggregator_hits} (not counted)`);
    console.log(`    official confirmed  : ${e.official_confirmed}`);
    console.log(`    first seen          : ${e.first_seen_ts} via @${e.first_seen_channel}`);
    console.log(`    raw messages here   : ${e.raw_message_count}`);
    if (e.suspected_injection) {
      for (const g of e.injection_groups) {
        console.log(
          `    ⚠ suspected injection: ${g.copies} copies in ${g.span_minutes}m across ${g.channels.length} accts — "${g.sample}…"`,
        );
      }
    }
    if (e.recirculated) console.log('    ⚠ recirculated old content present');
  }
  console.log('');
}
