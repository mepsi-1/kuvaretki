// Round building and scoring. No DOM use, so the build script can import it too.
import { areaM2, nearest } from './geo.js';

const MAX_PER_GROUP = 2;
export const PLACE_COUNT = 6;
export const WHEN_COUNT = 2;
export const CHOICE_COUNT = 2;
export const ROUND_LENGTH = PLACE_COUNT + WHEN_COUNT + CHOICE_COUNT;
// "When" questions only for species with a clear season and enough observations.
const MIN_SEASONALITY = 0.3;
const MIN_MONTH_TOTAL = 20;
const MIN_PEAK_GAP = 2; // months between the two "when" peaks, when possible

export const MONTHS_FI = [
  'tammikuu', 'helmikuu', 'maaliskuu', 'huhtikuu', 'toukokuu', 'kesäkuu',
  'heinäkuu', 'elokuu', 'syyskuu', 'lokakuu', 'marraskuu', 'joulukuu',
];
// How far (in d0) the wrong options' nearest sighting must be from the shown spot;
// relaxed step by step when the region's species overlap too much.
const SEPARATIONS = [2, 1.5, 1];

// Region-dependent constants.
export function regionMetrics(geojson) {
  return { d0: Math.sqrt(areaM2(geojson)) / 8 };
}

// Up to `n` items of `list` in order, at most `maxPerGroup` from any one group.
export function capPerGroup(list, n, maxPerGroup) {
  const out = [];
  const perGroup = {};
  for (const c of list) {
    if (out.length >= n) break;
    if ((perGroup[c.group] ?? 0) >= maxPerGroup) continue;
    perGroup[c.group] = (perGroup[c.group] ?? 0) + 1;
    out.push(c);
  }
  return out;
}

function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// How concentrated a species' observations are in one season: the length of the mean vector
// of the months on a circle (0 = all year round, 1 = a single month), and the busiest month.
export function seasonality(m) {
  let x = 0;
  let y = 0;
  let total = 0;
  m.forEach((n, k) => {
    x += n * Math.cos((2 * Math.PI * k) / 12);
    y += n * Math.sin((2 * Math.PI * k) / 12);
    total += n;
  });
  return { r: total ? Math.hypot(x, y) / total : 0, peak: m.indexOf(Math.max(...m)), total };
}

const monthGap = (a, b) => Math.min(Math.abs(a - b), 12 - Math.abs(a - b));

// WHEN_COUNT seasonal cards from `targets` (in order), peaks apart from each other if possible.
function pickWhens(targets, used) {
  const seasonal = targets
    .filter((c) => !used.has(c) && c.m)
    .map((card) => ({ card, ...seasonality(card.m) }))
    .filter((s) => s.total >= MIN_MONTH_TOTAL && s.r >= MIN_SEASONALITY);
  const whens = [];
  for (const gap of [MIN_PEAK_GAP, 0]) {
    for (const s of seasonal) {
      if (whens.length >= WHEN_COUNT) break;
      if (whens.some((w) => w === s || monthGap(w.peak, s.peak) < gap)) continue;
      whens.push(s);
    }
  }
  return whens.map(({ card }) => ({ when: true, card }));
}

// PLACE_COUNT placement cards not played recently in this region (at most two per group), easiest
// (tightest cluster) first, then WHEN_COUNT "when is it seen?" and CHOICE_COUNT "which one lives
// here?" questions. `played` is a Set of card ids, updated in place. Questions are cards,
// { when: true, card } or { choice: true, card, options, spot }.
export function dealRound(cards, played, d0) {
  let fresh = cards.filter((c) => !played.has(c.id));
  if (fresh.length < ROUND_LENGTH) {
    played.clear();
    fresh = cards;
  }
  const round = capPerGroup(shuffle(fresh), PLACE_COUNT, MAX_PER_GROUP);
  // Too few groups for the cap: fill up with anything.
  for (const c of shuffle(fresh)) {
    if (round.length >= PLACE_COUNT) break;
    if (!round.includes(c)) round.push(c);
  }
  round.sort((a, b) => a.spread - b.spread);

  const used = new Set(round);
  const targets = [...shuffle(fresh), ...shuffle(cards.filter((c) => !fresh.includes(c)))];
  const whens = pickWhens(targets, used);
  whens.forEach((q) => used.add(q.card));
  const choices = [];
  for (const target of targets) {
    if (choices.length >= CHOICE_COUNT) break;
    if (used.has(target)) continue;
    const q = buildChoice(target, cards.filter((c) => !used.has(c) && c !== target), d0);
    if (!q) continue;
    choices.push(q);
    q.options.forEach((c) => used.add(c));
  }
  for (const c of [...round, ...whens.map((q) => q.card), ...choices.map((q) => q.card)]) played.add(c.id);
  return [...round, ...whens, ...choices];
}

// A spot where the target was seen and two other species from `pool` whose nearest
// sightings are clearly farther away, so only one option fits. null if none is found.
export function buildChoice(target, pool, d0) {
  // For each of the target's sightings, how far each candidate's nearest sighting is.
  const spots = target.sightings.map((spot) => ({
    spot,
    gaps: pool.map((c) => ({ card: c, d: nearest(spot, c.sightings).distance })),
  }));
  for (const k of SEPARATIONS) {
    let best = null;
    for (const { spot, gaps } of spots) {
      const ok = gaps.filter((g) => g.d >= k * d0);
      if (ok.length < 2) continue;
      // Prefer the spot where the two most distant wrong options are farthest away.
      const two = shuffle(ok).sort((a, b) => b.d - a.d).slice(0, 2);
      const score = Math.min(two[0].d, two[1].d);
      if (!best || score > best.score) best = { spot, two, score };
    }
    if (best) {
      return { choice: true, card: target, spot: best.spot, options: shuffle([target, ...best.two.map((g) => g.card)]) };
    }
  }
  return null;
}

export const scoreFor = (distance, d0) => Math.round(1000 * Math.exp(-distance / d0));

export function feedbackFor(points) {
  if (points >= 850) return 'Osuit kotikulmille!';
  if (points >= 500) return 'Lähellä!';
  if (points >= 200) return 'Oikeaan suuntaan.';
  return 'Se asuu muualla.';
}

export const choicePoints = (correct) => (correct ? 1000 : 0);

export function choiceFeedbackFor(correct, card) {
  return correct ? 'Oikein! Se asuu juuri täällä.' : `Ei aivan, täällä asuu ${card.fi.toLowerCase()}.`;
}

export const whenPoints = (card, month) => Math.round((1000 * card.m[month]) / Math.max(...card.m));

export function whenFeedbackFor(points, card) {
  const peak = MONTHS_FI[seasonality(card.m).peak].replace(/kuu$/, 'kuussa');
  if (points >= 850) return 'Juuri silloin!';
  if (points >= 200) return `Lähellä! Eniten ${peak}.`;
  return `Ohi. Eniten ${peak}.`;
}

export function titleFor(total, max) {
  const r = max ? total / max : 0;
  if (r >= 0.75) return 'Retkikunnan johtaja';
  if (r >= 0.5) return 'Paikallisasiantuntija';
  if (r >= 0.25) return 'Luontokartoittaja';
  return 'Retkeilijä';
}

// The round grew from 8 to 10 questions, so older bests are kept apart.
const bestKey = (key) => `best10:${key}`;

export function loadBest(key) {
  try {
    return Number(localStorage.getItem(bestKey(key))) || 0;
  } catch {
    return 0;
  }
}

export function saveBest(key, score) {
  const previous = loadBest(key);
  if (score <= previous) return false;
  try {
    localStorage.setItem(bestKey(key), String(score));
  } catch {}
  return previous > 0;
}
