// Pre-fetches species pools for the quick places into public/fallback/*.json.
// The app uses them when iNaturalist can't be reached. Run: node scripts/snapshot.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import { QUICK_PLACES } from '../src/places.js';
import { getSpeciesPool } from '../src/api.js';

const outDir = new URL('../public/fallback/', import.meta.url);
await mkdir(outDir, { recursive: true });

for (const place of QUICK_PLACES) {
  const { species, total, radiusKm } = await getSpeciesPool(place.lat, place.lng, { timeout: 60000 });
  await writeFile(
    new URL(`${place.slug}.json`, outDir),
    JSON.stringify({ species, total, radiusKm, name: place.name })
  );
  console.log(`${place.slug}: ${species.length} species (of ${total}) within ${radiusKm} km`);
}
