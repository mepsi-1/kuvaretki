// Pre-fetches the game data for all 19 maakunnat into public/data/.
//   public/data/regions.json   index: name, boundary and species totals of every maakunta
//   public/data/{slug}.json    the region's playable cards with their sightings
// Run: node scripts/build-data.mjs [slug ...]   (about a minute per maakunta, ~1 request/s)
//      node scripts/build-data.mjs --months [slug ...]   only (re)fetch the cards' month histograms
//      node scripts/build-data.mjs --stats [slug ...]    only (re)fetch the species totals
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { getRegion, getSightingsMany, getTaxa, getMonthHistogram, getSpeciesCounts, getPlaceStats } from './api.js';
import { regionMetrics, capPerGroup } from '../src/cards.js';
import { pointInGeometry, polygonsOf, spread, haversine, areaM2 } from '../src/geo.js';

// Each maakunta's iNaturalist place (for the species totals) and one point inside it (its
// main town); the point finds the boundary and is the "big city" whose sightings shouldn't
// dominate a card.
const MAAKUNNAT = [
  ['uusimaa', 118859, 60.1699, 24.9384],
  ['varsinais-suomi', 118860, 60.4518, 22.2666],
  ['satakunta', 118861, 61.4851, 21.7974],
  ['kanta-hame', 118862, 60.9959, 24.4643],
  ['pirkanmaa', 118925, 61.4978, 23.761],
  ['paijat-hame', 118863, 60.9827, 25.6612],
  ['kymenlaakso', 118864, 60.8679, 26.7042],
  ['etela-karjala', 118877, 61.0587, 28.1887],
  ['etela-savo', 118879, 61.6886, 27.2723],
  ['pohjois-savo', 118890, 62.8924, 27.677],
  ['pohjois-karjala', 118873, 62.601, 29.7636],
  ['keski-suomi', 118871, 62.2426, 25.7473],
  ['etela-pohjanmaa', 118870, 62.7903, 22.8403],
  ['pohjanmaa', 118869, 63.0951, 21.6165],
  // Small region where most sightings are around Kokkola: allow more town-centred species.
  ['keski-pohjanmaa', 118868, 63.8385, 23.1307, { cityShare: 0.75, candidates: 240 }],
  ['pohjois-pohjanmaa', 118867, 65.0121, 25.4651],
  ['kainuu', 118866, 64.2273, 27.7285],
  ['lappi', 118865, 66.5039, 25.7294],
  ['ahvenanmaa', 118889, 60.0973, 19.9348, { name: 'Ahvenanmaa' }], // Nominatim: "Ahvenanmaan maakunta"
].map(([slug, place, lat, lng, opts = {}]) => ({ slug, place, lat, lng, ...opts }));

const MIN_COUNT = 5;
const MAX_COUNT = 200; // all of a species' sightings fit one page
const MAX_CANDIDATES = 120;
// Widest accepted spread, as a share of the radius of a circle with the region's area.
// Loose on purpose: the tightest 30 are picked anyway.
const MAX_SPREAD = 0.6;
const BATCH_COUNT = 200;
const MIN_SIGHTINGS = 4;
const MAX_CITY_SHARE = 0.5; // reject species seen mostly around the main town
const CARDS = 30;
const MAX_GROUP_SHARE = 0.4;

const outDir = new URL('../public/data/', import.meta.url);
await mkdir(outDir, { recursive: true });

// Month histograms for the "when" questions; a failed fetch leaves the card without one.
async function monthsFor(ids, bbox) {
  return Promise.all(
    ids.map((id) =>
      getMonthHistogram(id, bbox).catch((err) => {
        console.warn(`  no months for ${id}: ${err.message}`);
        return null;
      })
    )
  );
}

const round = (x, d) => Math.round(x * 10 ** d) / 10 ** d;
const roundCoords = (c) => (typeof c[0] === 'number' ? c.map((x) => round(x, 4)) : c.map(roundCoords));

// Species totals for the start screen; a failed fetch leaves the region without them.
function statsFor(m) {
  return getPlaceStats(m.place).catch((err) => {
    console.warn(`  no stats for ${m.slug}: ${err.message}`);
    return null;
  });
}

function weightedShuffle(items, weight) {
  return items
    .map((item) => ({ item, key: Math.random() ** (1 / weight(item)) }))
    .sort((a, b) => b.key - a.key)
    .map((x) => x.item);
}

// Bounding box of a Polygon/MultiPolygon, in the shape getRegion returns.
function bboxOf(geojson) {
  const pts = polygonsOf(geojson).flat(2);
  const lats = pts.map((p) => p[1]);
  const lngs = pts.map((p) => p[0]);
  return { south: Math.min(...lats), north: Math.max(...lats), west: Math.min(...lngs), east: Math.max(...lngs) };
}

async function buildRegion(m) {
  const region = await getRegion(m.lat, m.lng);
  if (!region) throw new Error(`No boundary for ${m.slug}`);
  if (m.name) region.name = m.name;
  const { d0 } = regionMetrics(region.geojson);
  const maxSpread = MAX_SPREAD * Math.sqrt(areaM2(region.geojson) / Math.PI);
  const species = await getSpeciesCounts(region.bbox);

  const candidates = weightedShuffle(
    species.filter((s) => s.hasFi && s.count >= MIN_COUNT && s.count <= MAX_COUNT),
    (s) => s.count ** 0.8
  ).slice(0, m.candidates ?? MAX_CANDIDATES);

  const batches = [];
  for (let i = 0; i < candidates.length; ) {
    const batch = [];
    let sum = 0;
    while (i < candidates.length && (!batch.length || sum + candidates[i].count <= BATCH_COUNT)) {
      sum += candidates[i].count;
      batch.push(candidates[i++]);
    }
    batches.push(batch);
  }
  // fetchJson spaces the request starts ~1.1 s apart; the answers may overlap.
  const results = await Promise.all(
    batches.map((batch) =>
      getSightingsMany(batch.map((s) => s.id), region.bbox).then(
        (sightings) => ({ batch, sightings }),
        (err) => {
          console.warn(`  skipped ${batch.length} species: ${err.message}`);
          return { batch, sightings: new Map() };
        }
      )
    )
  );

  const stats = { enough: 0, city: 0, wide: 0 };
  const accepted = [];
  for (const { batch, sightings } of results) {
    for (const s of batch) {
      const inside = (sightings.get(s.id) ?? []).filter((p) => pointInGeometry(p.lat, p.lng, region.geojson));
      if (inside.length < MIN_SIGHTINGS) continue;
      stats.enough++;
      const sp = spread(inside);
      const cityShare = inside.filter((p) => haversine(m, p) < d0).length / inside.length;
      if (cityShare > (m.cityShare ?? MAX_CITY_SHARE)) stats.city++;
      else if (sp > maxSpread) stats.wide++;
      else accepted.push({ ...s, sightings: inside, spread: sp });
    }
  }

  // Tightest clusters first, without letting one group (usually plants) take over.
  accepted.sort((a, b) => a.spread - b.spread);
  const cards = capPerGroup(accepted, CARDS, Math.ceil(CARDS * MAX_GROUP_SHARE));

  // CARDS ≤ 30, so the descriptions fit one getTaxa request.
  const ids = cards.map((c) => c.id);
  const [details, months, totals] = await Promise.all([
    getTaxa(ids),
    monthsFor(ids, region.bbox),
    statsFor(m),
  ]);

  const index = {
    slug: m.slug,
    name: region.name,
    cards: cards.length,
    ...(totals && { stats: totals }),
    geojson: { type: region.geojson.type, coordinates: roundCoords(region.geojson.coordinates) },
  };
  const data = {
    slug: m.slug,
    name: region.name,
    cards: cards.map((c, i) => ({
      id: c.id, sci: c.sci, fi: c.fi, group: c.group,
      photo: c.photo, photoSmall: c.photoSmall, attribution: c.attribution,
      wiki: details.get(c.id)?.wiki || c.wiki,
      summary: details.get(c.id)?.summary || '',
      spread: Math.round(c.spread),
      ...(months[i] && { m: months[i] }),
      s: c.sightings.map((p) => [round(p.lat, 5), round(p.lng, 5)]),
    })),
  };
  console.log(
    `${m.slug}: ${region.name}, ${candidates.length} candidates, ${stats.enough} with sightings, ` +
      `${stats.city} town-centred, ${stats.wide} too wide → ${cards.length} cards`
  );
  return { index, data };
}

// Rebuilding a subset keeps the other regions in the index.
const indexUrl = new URL('regions.json', outDir);
let regions = [];
try {
  regions = JSON.parse(await readFile(indexUrl, 'utf8'));
} catch {}

const args = process.argv.slice(2);
const monthsOnly = args.includes('--months');
const statsOnly = args.includes('--stats');
const only = args.filter((a) => !a.startsWith('--'));
const chosen = MAAKUNNAT.filter((x) => !only.length || only.includes(x.slug));

// --months: add the histograms to the existing cards without re-picking them.
if (monthsOnly) {
  for (const m of chosen) {
    try {
      const file = new URL(`${m.slug}.json`, outDir);
      const data = JSON.parse(await readFile(file, 'utf8'));
      const region = regions.find((r) => r.slug === m.slug);
      if (!region) throw new Error(`${m.slug} is not in regions.json`);
      const months = await monthsFor(data.cards.map((c) => c.id), bboxOf(region.geojson));
      data.cards = data.cards.map(({ s, m: _, ...c }, i) => ({ ...c, ...(months[i] && { m: months[i] }), s }));
      await writeFile(file, JSON.stringify(data));
      console.log(`${m.slug}: months for ${months.filter(Boolean).length}/${data.cards.length} cards`);
    } catch (err) {
      console.error(`${m.slug}: FAILED ${err.message}`);
    }
  }
  process.exit(0);
}

// --stats: refresh the totals in regions.json without touching the cards.
if (statsOnly) {
  for (const m of chosen) {
    const region = regions.find((r) => r.slug === m.slug);
    if (!region) {
      console.error(`${m.slug}: FAILED not in regions.json`);
      continue;
    }
    const stats = await statsFor(m);
    if (!stats) continue;
    // Keep the boundary last so the file stays readable.
    const { geojson, stats: _, ...rest } = region;
    regions[regions.indexOf(region)] = { ...rest, stats, geojson };
    console.log(`${m.slug}: ${stats.species} species, ${stats.observations} observations`);
  }
  await writeFile(indexUrl, JSON.stringify(regions));
  process.exit(0);
}

for (const m of chosen) {
  try {
    const { index, data } = await buildRegion(m);
    await writeFile(new URL(`${m.slug}.json`, outDir), JSON.stringify(data));
    regions = [...regions.filter((r) => r.slug !== m.slug), index];
    regions.sort((a, b) => MAAKUNNAT.findIndex((x) => x.slug === a.slug) - MAAKUNNAT.findIndex((x) => x.slug === b.slug));
    await writeFile(indexUrl, JSON.stringify(regions));
  } catch (err) {
    console.error(`${m.slug}: FAILED ${err.message}`);
  }
}
