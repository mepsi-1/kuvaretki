// iNaturalist + Nominatim clients for build-data.mjs.
const INAT = 'https://api.inaturalist.org/v1';
const INAT2 = 'https://api.inaturalist.org/v2';
const NOMINATIM = 'https://nominatim.openstreetmap.org';

// --- Throttled fetch: at most one request start per ~1.1 s per host -------------------
// Requests may overlap; iNaturalist answers take ~3 s, so waiting for each would be slow.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const queues = new Map();

function throttled(host, task) {
  const q = queues.get(host) ?? { tail: Promise.resolve(), lastAt: 0 };
  const slot = q.tail.then(async () => {
    const wait = q.lastAt + 1100 - Date.now();
    if (wait > 0) await sleep(wait);
    q.lastAt = Date.now();
  });
  q.tail = slot.catch(() => {});
  queues.set(host, q);
  return slot.then(task);
}

// Nominatim rejects Node's default user agent; iNaturalist answers 429 when we go too fast.
async function request(url, timeout) {
  const host = new URL(url).host;
  for (let attempt = 1; ; attempt++) {
    let res;
    try {
      res = await throttled(host, () =>
        fetch(url, { headers: { 'User-Agent': 'kuvaretki-build/1.0' }, signal: AbortSignal.timeout(timeout) })
      );
    } catch (err) {
      if (attempt >= 4) throw err;
      console.warn(`  ${err.message}, retrying`);
      await sleep(5000);
      continue;
    }
    if (res.status !== 429 || attempt >= 4) return res;
    console.warn(`  429, waiting ${attempt * 20} s`);
    await sleep(attempt * 20000);
  }
}

export async function fetchJson(url, { timeout = 10000 } = {}) {
  const res = await request(url, timeout);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

export const bboxParams = (b) => `swlat=${b.south}&swlng=${b.west}&nelat=${b.north}&nelng=${b.east}`;

// --- Maakunta boundary (Nominatim zoom 8) -----------------------------------------
export async function getRegion(lat, lng) {
  const j = await fetchJson(
    `${NOMINATIM}/reverse?lat=${lat.toFixed(4)}&lon=${lng.toFixed(4)}&format=jsonv2` +
      `&zoom=8&accept-language=fi&polygon_geojson=1&polygon_threshold=0.001`
  );
  const type = j?.geojson?.type;
  if (type !== 'Polygon' && type !== 'MultiPolygon') return null;
  const [south, north, west, east] = j.boundingbox.map(Number);
  return { name: j.name, bbox: { south, north, west, east }, geojson: j.geojson };
}

// --- Species in the region ----------------------------------------------------------
const capitalize = (s) => s.charAt(0).toLocaleUpperCase('fi') + s.slice(1);

// Up to 1500 species observed in the bbox, most observed first.
export async function getSpeciesCounts(bbox) {
  const all = [];
  for (let page = 1; page <= 3; page++) {
    const j = await fetchJson(
      `${INAT}/observations/species_counts?${bboxParams(bbox)}&verifiable=true&locale=fi&per_page=500&page=${page}`,
      { timeout: 60000 }
    );
    all.push(...trimSpecies(j.results ?? []));
    if ((j.results ?? []).length < 500) break;
  }
  return all;
}

// --- Region totals for the start screen ---------------------------------------------
// Counted inside an iNaturalist place (the real boundary, not the bbox).
// Returns { species, observations, groups: { iconicTaxon: speciesCount } }.
export async function getPlaceStats(placeId) {
  const q = `place_id=${placeId}&verifiable=true`;
  const species = await fetchJson(`${INAT}/observations/species_counts?${q}&per_page=1`, { timeout: 60000 });
  const obs = await fetchJson(`${INAT}/observations?${q}&per_page=0`, { timeout: 60000 });
  const iconic = await fetchJson(`${INAT}/observations/iconic_taxa_species_counts?${q}`, { timeout: 60000 });
  const groups = {};
  for (const r of iconic.results ?? []) groups[r.taxon.name] = r.count;
  return { species: species.total_results, observations: obs.total_results, groups };
}

function trimSpecies(results) {
  return results
    .filter((r) => r.taxon?.rank === 'species' && r.taxon.default_photo?.medium_url)
    .map(({ count, taxon: t }) => ({
      id: t.id,
      sci: t.name,
      fi: t.preferred_common_name ? capitalize(t.preferred_common_name) : t.name,
      hasFi: Boolean(t.preferred_common_name),
      group: t.iconic_taxon_name || 'Other',
      count,
      photo: t.default_photo.medium_url,
      photoSmall: t.default_photo.square_url,
      attribution: t.default_photo.attribution || '',
      wiki: t.wikipedia_url || null,
    }));
}

// --- Sightings of several species in one request (v2 + fields keeps the payload tiny) --
// The caller keeps the species' observation counts within one page (200), so nothing is
// cut off. Returns Map taxonId → sightings.
export async function getSightingsMany(taxonIds, bbox, maxAccuracy = 1000) {
  const json = await fetchJson(
    `${INAT2}/observations?taxon_id=${taxonIds.join(',')}&${bboxParams(bbox)}` +
      `&quality_grade=research&geoprivacy=open&taxon_geoprivacy=open&per_page=200` +
      `&fields=id,location,obscured,positional_accuracy,taxon.id,taxon.min_species_ancestry`,
    { timeout: 15000 }
  );
  const wanted = new Set(taxonIds);
  const out = new Map(taxonIds.map((id) => [id, []]));
  for (const o of json.results ?? []) {
    if (!o.location || o.obscured || o.positional_accuracy > maxAccuracy) continue;
    // Subspecies observations match their species through the ancestry.
    const ancestry = [o.taxon?.id, ...(o.taxon?.min_species_ancestry ?? '').split(',').map(Number)];
    const species = ancestry.find((id) => wanted.has(id));
    if (species === undefined) continue;
    const [lat, lng] = o.location.split(',').map(Number);
    out.get(species).push({ lat, lng });
  }
  return out;
}

// --- When the species is seen: observations per month of year (index 0 = January) ---
export async function getMonthHistogram(taxonId, bbox) {
  const json = await fetchJson(
    `${INAT}/observations/histogram?taxon_id=${taxonId}&${bboxParams(bbox)}` +
      `&verifiable=true&date_field=observed&interval=month_of_year`,
    { timeout: 15000 }
  );
  const months = json.results?.month_of_year ?? {};
  return Array.from({ length: 12 }, (_, i) => months[i + 1] ?? 0);
}

// --- Species descriptions (batched) ----------------------------------------------
export async function getTaxa(ids) {
  const json = await fetchJson(`${INAT}/taxa/${ids.join(',')}?locale=fi`, { timeout: 15000 });
  const out = new Map();
  for (const t of json.results ?? []) {
    out.set(t.id, { summary: t.wikipedia_summary || '', wiki: t.wikipedia_url || null });
  }
  return out;
}
