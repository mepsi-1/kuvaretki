// Minimal Overpass API client: https://wiki.openstreetmap.org/wiki/Overpass_API
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const PER_ENDPOINT_TIMEOUT_MS = 20000;

export async function overpass(query, { signal } = {}) {
  let lastError;
  for (const url of ENDPOINTS) {
    if (signal?.aborted) throw signal.reason;
    const timeout = AbortSignal.timeout(PER_ENDPOINT_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST',
        body: 'data=' + encodeURIComponent(query),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
      if (!res.ok) throw new Error(`Overpass ${res.status}`);
      return (await res.json()).elements;
    } catch (err) {
      if (signal?.aborted) throw err;
      lastError = err;
    }
  }
  throw lastError;
}

// Interesting things within `radius` metres of a point.
export async function findInteresting(lat, lng, radius = 1000, opts) {
  const around = `(around:${radius},${lat},${lng})`;
  const query = `
    [out:json][timeout:25];
    (
      nwr["tourism"~"artwork|viewpoint|attraction|museum"]${around};
      nwr["historic"]${around};
      nwr["natural"~"peak|spring|cave_entrance|tree"]["name"]${around};
      nwr["amenity"="fountain"]${around};
    );
    out center tags 200;
  `;
  const elements = await overpass(query, opts);
  return elements
    .map((el) => ({
      id: `${el.type}/${el.id}`,
      lat: el.lat ?? el.center?.lat,
      lng: el.lon ?? el.center?.lon,
      tags: el.tags ?? {},
    }))
    .filter((p) => p.lat != null);
}
