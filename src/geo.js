// Small geometry helpers. Points are { lat, lng }; GeoJSON coordinates are [lng, lat].
const RAD = Math.PI / 180;
const R = 6371008.8;

export function haversine(a, b) {
  const dLat = (b.lat - a.lat) * RAD;
  const dLng = (b.lng - a.lng) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Polygon coordinate arrays of a Polygon or MultiPolygon, as a list of polygons (each a list of rings).
export function polygonsOf(geojson) {
  if (geojson.type === 'Polygon') return [geojson.coordinates];
  if (geojson.type === 'MultiPolygon') return geojson.coordinates;
  return [];
}

function inRing(lat, lng, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function pointInGeometry(lat, lng, geojson) {
  return polygonsOf(geojson).some(
    ([outer, ...holes]) => inRing(lat, lng, outer) && !holes.some((h) => inRing(lat, lng, h))
  );
}

// Equirectangular shoelace area in m², good enough at municipality/maakunta scale.
function ringArea(ring) {
  const lat0 = ring[0][1] * RAD;
  const kx = R * Math.cos(lat0) * RAD;
  const ky = R * RAD;
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += ring[j][0] * kx * (ring[i][1] * ky) - ring[i][0] * kx * (ring[j][1] * ky);
  }
  return Math.abs(sum) / 2;
}

export function areaM2(geojson) {
  return polygonsOf(geojson).reduce(
    (total, [outer, ...holes]) => total + ringArea(outer) - holes.reduce((s, h) => s + ringArea(h), 0),
    0
  );
}

export function centroid(points) {
  const n = points.length;
  return {
    lat: points.reduce((s, p) => s + p.lat, 0) / n,
    lng: points.reduce((s, p) => s + p.lng, 0) / n,
  };
}

// Root-mean-square distance (m) of the points from their centroid.
export function spread(points) {
  const c = centroid(points);
  return Math.sqrt(points.reduce((s, p) => s + haversine(c, p) ** 2, 0) / points.length);
}

export function nearest(from, points) {
  let best = null;
  let bestD = Infinity;
  for (const p of points) {
    const d = haversine(from, p);
    if (d < bestD) [best, bestD] = [p, d];
  }
  return { point: best, distance: bestD };
}
