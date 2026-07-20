// Synthetic "fuel in Оренбуржье, 48h" corpus for the hypothesis check.
// It is engineered so the TRUTH is known: 6 genuine independent origins (one
// per city), buried under aggregator forwards, copypaste, a multi-chat author,
// an official confirmation, a coordinated injection burst, and recirculated
// old content. A correct engine must recover exactly 6.

const BASE = Date.parse('2026-07-18T00:00:00Z');
const H = 3600 * 1000;
const BUCKET = 6 * H; // must match DEFAULT_CONFIG.timeBucketHours

let seq = 0;
const iso = (ms) => new Date(ms).toISOString();
const msg = (o) => ({ id: `m${++seq}`, ...o });

// One genuine city report + its echo cloud.
function city({ channel, geo, bucket, text, authorId = null, aggregators, copyChannels, copies }) {
  const t0 = BASE + bucket * BUCKET + 1 * H;
  const out = [];

  // The genuine origin (self-authored, distinct wording).
  const origin = msg({ channel, author_id: authorId, ts: iso(t0), text });
  out.push(origin);

  // Aggregator forwards — MTProto fwd_from present. Pure echo, Tier B.
  aggregators.forEach((agg, a) => {
    out.push(
      msg({
        channel: agg,
        ts: iso(t0 + (a + 1) * 11 * 60 * 1000),
        text: text + ' (via канал)',
        fwd_from: { channel, msg_id: origin.id },
        is_forward: true,
      }),
    );
  });

  // Copypaste without forward metadata — near-dup, minor cosmetic edits.
  for (let i = 0; i < copies; i++) {
    out.push(
      msg({
        channel: `${copyChannels}_${String(i).padStart(3, '0')}`,
        ts: iso(t0 + (i + 1) * 7 * 60 * 1000),
        text: text + (i % 2 ? ' 🔥🔥' : ' #оренбург'),
      }),
    );
  }
  return out;
}

export function buildFixture() {
  seq = 0;
  const messages = [];

  const aggregators = ['monitoring_56', 'oren_region_news', 'info56_agg', 'chp_orenburg', 'region56_life'];

  // 1) Six genuine, independent city reports (the ground truth = 6 origins).
  messages.push(
    ...city({
      channel: 'orsk_life', geo: 'Орск', bucket: 0,
      text: 'В Орске третий день перебои с бензином. На АЗС Лукойл очереди, А95 нет.',
      aggregators, copyChannels: 'repost_orsk', copies: 26,
    }),
    ...city({
      channel: 'buzuluk_news', geo: 'Бузулук', bucket: 1,
      text: 'Бузулук: заправки стоят без топлива, дизель закончился на трассе М5.',
      aggregators, copyChannels: 'repost_buz', copies: 26,
    }),
    ...city({
      channel: 'solileck_chat', geo: 'Соль-Илецк', bucket: 0, authorId: 'U100',
      text: 'Соль-Илецк — не могу заправиться, бензина нет нигде в городе.',
      aggregators, copyChannels: 'repost_sol', copies: 20,
    }),
    ...city({
      channel: 'orenburg_typ', geo: 'Оренбург', bucket: 2,
      text: 'Оренбург: на нескольких АЗС пропал А92, водители жалуются на очереди.',
      aggregators, copyChannels: 'repost_orb', copies: 26,
    }),
    ...city({
      channel: 'novotroitsk_go', geo: 'Новотроицк', bucket: 4,
      text: 'В Новотроицке дефицит дизельного топлива, заправки закрываются.',
      aggregators, copyChannels: 'repost_nov', copies: 26,
    }),
    ...city({
      channel: 'gay_online', geo: 'Гай', bucket: 6,
      text: 'Город Гай: бензин А95 не завозят, на АЗС пусто.',
      aggregators, copyChannels: 'repost_gay', copies: 26,
    }),
  );

  // 2) Trap: the SAME person in two more chats about Соль-Илецк. Different
  //    wording, so it survives near-dup — must still dedup to one origin.
  const b0 = BASE + 0 * BUCKET + 1 * H;
  messages.push(
    msg({ channel: 'orb_chat', author_id: 'U100', ts: iso(b0 + 2 * H), text: 'Соль-Илецк без бензина совсем, объехал три заправки — пусто.' }),
    msg({ channel: 'oren_chat', author_id: 'U100', ts: iso(b0 + 3 * H), text: 'В Соль-Илецке заправок с бензином не осталось, беда.' }),
  );

  // 3) Official confirmation for Орск (Tier C — separate flag, not an origin).
  messages.push(
    msg({ channel: 'okes.ru', ts: iso(b0 + 2 * H), text: 'АО «Оренбургнефтепродукт»: поставки бензина в Орск восстанавливаются, дефицит временный.' }),
  );

  // 4) Trap: coordinated injection in Оренбург — 6 identical texts from
  //    day-old accounts inside 10 minutes. Must be FLAGGED, never counted.
  const inj = BASE + 2 * BUCKET + 0.2 * H;
  for (let i = 0; i < 6; i++) {
    messages.push(
      msg({
        channel: `throwaway_${i}`,
        ts: iso(inj + i * 90 * 1000),
        account_age_days: 1,
        text: 'СРОЧНО! В Оренбурге пропал бензин ВЕЗДЕ, очереди на АЗС, власти молчат! Репост!',
      }),
    );
  }

  // 5) Trap: recirculated old content (Сорочинск) — same text seen 10 days ago.
  const recircText = 'Сорочинск: на АЗС нет бензина, ажиотаж, машины в очередях.';
  const sorMs = BASE + 6 * BUCKET + 2 * H;
  messages.push(msg({ channel: 'sorochinsk_news', ts: iso(sorMs), text: recircText }));

  // History store: contentHash -> earliest seen (10 days before this run).
  return { messages, recircText, recircSeenMs: sorMs - 10 * 24 * H };
}
