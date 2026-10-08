// iNaturalist + Nominatim clients. No DOM use, so scripts/snapshot.mjs can import this in Node.
import { nearestPlace } from './places.js';

const INAT = 'https://api.inaturalist.org/v1';
const RADII_KM = [1, 3, 10, 30];
const MIN_SPECIES = 30;

// --- Throttled fetch: at most one request per second per host ----------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const queues = new Map();

function throttled(host, task) {
  const q = queues.get(host) ?? { tail: Promise.resolve(), lastAt: 0 };
  const run = q.tail.then(async () => {
    const wait = q.lastAt + 1000 - Date.now();
    if (wait > 0) await sleep(wait);
    q.lastAt = Date.now();
    return task();
  });
  q.tail = run.catch(() => {});
  queues.set(host, q);
  return run;
}

export function fetchJson(url, { timeout = 10000 } = {}) {
  return throttled(new URL(url).host, async () => {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeout) });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
    return res.json();
  });
}

// --- Cache: memory + sessionStorage ------------------------------------------
const memo = new Map();

function cacheGet(key) {
  if (memo.has(key)) return memo.get(key);
  try {
    const raw = globalThis.sessionStorage?.getItem(key);
    if (raw) {
      const value = JSON.parse(raw);
      memo.set(key, value);
      return value;
    }
  } catch {}
  return undefined;
}

function cacheSet(key, value) {
  memo.set(key, value);
  try {
    globalThis.sessionStorage?.setItem(key, JSON.stringify(value));
  } catch {}
}

const coordKey = (lat, lng) => `${lat.toFixed(3)},${lng.toFixed(3)}`;

// --- Species pool --------------------------------------------------------------
const capitalize = (s) => s.charAt(0).toLocaleUpperCase('fi') + s.slice(1);

export function trimSpecies(results) {
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
      attribution: t.default_photo.attribution || '',
      wiki: t.wikipedia_url || null,
    }));
}

// Fetches the species observed around a point, widening the radius when the area is sparse.
export async function getSpeciesPool(lat, lng, { onProgress, timeout } = {}) {
  let best;
  for (const radiusKm of RADII_KM) {
    const key = `pool:${coordKey(lat, lng)}:${radiusKm}`;
    let pool = cacheGet(key);
    if (!pool) {
      if (radiusKm > RADII_KM[0]) {
        onProgress?.(`Vähän havaintoja lähellä – laajennetaan aluetta ${radiusKm} km:iin…`);
      }
      const url =
        `${INAT}/observations/species_counts?lat=${lat}&lng=${lng}&radius=${radiusKm}` +
        `&per_page=200&verifiable=true&locale=fi`;
      const json = await fetchJson(url, { timeout });
      pool = { species: trimSpecies(json.results), total: json.total_results, radiusKm };
      cacheSet(key, pool);
    }
    best = pool;
    if (pool.species.length >= MIN_SPECIES) break;
  }
  return best;
}

// Live pool, or the bundled snapshot of the nearest quick place when the API is unreachable.
export async function loadPool(lat, lng, opts) {
  try {
    const pool = await getSpeciesPool(lat, lng, opts);
    return { ...pool, widened: pool.radiusKm > RADII_KM[0], fallback: null };
  } catch (err) {
    console.warn('iNaturalist unavailable, using fallback data', err);
    const place = nearestPlace(lat, lng);
    const base = import.meta.env?.BASE_URL ?? '/';
    const res = await fetch(`${base}fallback/${place.slug}.json`);
    if (!res.ok) throw err;
    const pool = await res.json();
    return { ...pool, widened: false, fallback: place };
  }
}

// --- Species details (one batch request per round) ------------------------------
export async function getTaxa(ids) {
  const json = await fetchJson(`${INAT}/taxa/${ids.join(',')}?locale=fi`, { timeout: 15000 });
  const out = new Map();
  for (const t of json.results ?? []) {
    out.set(t.id, {
      summary: t.wikipedia_summary || '',
      wiki: t.wikipedia_url || null,
      photos: (t.taxon_photos ?? [])
        .map((tp) => ({ url: tp.photo?.medium_url, attribution: tp.photo?.attribution || '' }))
        .filter((p) => p.url),
    });
  }
  return out;
}

export async function getLastSighting(taxonId, lat, lng, radiusKm) {
  const json = await fetchJson(
    `${INAT}/observations?taxon_id=${taxonId}&lat=${lat}&lng=${lng}&radius=${radiusKm}` +
      `&per_page=1&order_by=observed_on&order=desc&photos=true&locale=fi`,
    { timeout: 8000 }
  );
  const o = json.results?.[0];
  if (!o?.location) return null;
  const [oLat, oLng] = o.location.split(',').map(Number);
  return { date: o.observed_on, place: o.place_guess || '', lat: oLat, lng: oLng };
}

// --- Place name ------------------------------------------------------------------
export async function reverseGeocode(lat, lng) {
  const key = `geo:${coordKey(lat, lng)}`;
  const cached = cacheGet(key);
  if (cached !== undefined) return cached;
  const j = await fetchJson(
    `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}` +
      `&format=jsonv2&zoom=14&accept-language=fi`,
    { timeout: 6000 }
  );
  const a = j.address ?? {};
  const local = a.suburb || a.quarter || a.neighbourhood || a.city_district || a.village || a.hamlet;
  const town = a.city || a.town || a.municipality;
  const name = [...new Set([local, town].filter(Boolean))].join(', ') || j.name || null;
  cacheSet(key, name);
  return name;
}
