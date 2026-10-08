// Quick places: shown as chips, and each has a pre-fetched fallback pool in public/fallback/.
export const QUICK_PLACES = [
  { slug: 'helsinki', name: 'Helsingin keskusta', lat: 60.1699, lng: 24.9384 },
  { slug: 'tampere', name: 'Hervanta, Tampere', lat: 61.45, lng: 23.85 },
  { slug: 'oulu', name: 'Oulun keskusta', lat: 65.0121, lng: 25.4651 },
  { slug: 'jyvaskyla', name: 'Jyväskylä', lat: 62.2426, lng: 25.7473 },
  { slug: 'inari', name: 'Inari', lat: 68.9064, lng: 27.0288 },
];

export function distanceKm(aLat, aLng, bLat, bLng) {
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLng = (bLng - aLng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

export function nearestPlace(lat, lng) {
  return QUICK_PLACES.reduce((best, p) =>
    distanceKm(lat, lng, p.lat, p.lng) < distanceKm(lat, lng, best.lat, best.lng) ? p : best
  );
}
