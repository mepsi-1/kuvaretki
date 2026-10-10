// Bundled game data in public/data/, built by scripts/build-data.mjs.
import { regionMetrics } from './cards.js';

const base = import.meta.env.BASE_URL;

async function getJson(path) {
  const res = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${path}`);
  return res.json();
}

// All maakunnat: { slug, name, cards, geojson, metrics }.
export async function loadRegions() {
  const regions = await getJson('data/regions.json');
  return regions.filter((r) => r.cards > 0).map((r) => ({ ...r, metrics: regionMetrics(r.geojson) }));
}

const cardCache = new Map();

export function loadCards(slug) {
  if (!cardCache.has(slug)) {
    const p = getJson(`data/${slug}.json`).then((d) =>
      d.cards.map(({ s, ...c }) => ({ ...c, sightings: s.map(([lat, lng]) => ({ lat, lng })) }))
    );
    p.catch(() => cardCache.delete(slug));
    cardCache.set(slug, p);
  }
  return cardCache.get(slug);
}
