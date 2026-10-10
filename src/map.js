import L from 'leaflet';
import { polygonsOf, pointInGeometry } from './geo.js';

const FINLAND = [64.5, 26];
const WORLD = [[-89, -360], [-89, 360], [89, 360], [89, -360]];
export const COLORS = ['#e4572e', '#2e86ab', '#8e44ad', '#f0a202', '#17a398', '#d63af9', '#5c8001', '#b5651d'];

const toLatLngs = (ring) => ring.map(([lng, lat]) => [lat, lng]);

export function formatDistance(m) {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toLocaleString('fi-FI', { maximumFractionDigits: 1 })} km`;
}

// mode: 'pick' (tap chooses a region) | 'guess' (tap moves the guess pin) | 'locked'
export function createMap(el, { onPick, onGuess, onOutside, getPadding }) {
  const map = L.map(el, { zoomControl: false, attributionControl: false, zoomSnap: 0.25 }).setView(FINLAND, 5);
  L.control.zoom({ position: 'topright' }).addTo(map);
  L.control.attribution({ position: 'bottomright', prefix: false }).addTo(map);

  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · ' +
      'Havainnot: <a href="https://www.inaturalist.org/">iNaturalist</a>',
  }).addTo(map);

  let mode = 'pick';
  let regionLayer = null;
  let regionGeojson = null;
  let regionBounds = null;
  const guessPin = L.marker(FINLAND, {
    icon: L.divIcon({ className: 'guess-pin', html: '<span></span>', iconSize: [22, 30], iconAnchor: [11, 30] }),
    interactive: false,
  });
  const roundLayer = L.layerGroup().addTo(map);

  let clickTimer;
  map.on('click', (e) => {
    // Debounce so a double-click zoom doesn't count as a tap.
    clearTimeout(clickTimer);
    clickTimer = setTimeout(() => {
      const { lat, lng } = e.latlng;
      if (mode === 'pick') onPick(lat, lng);
      else if (mode === 'guess') {
        // Guesses must land inside the region; the dimmed area outside doesn't count.
        if (regionGeojson && !pointInGeometry(lat, lng, regionGeojson)) return onOutside?.();
        guessPin.setLatLng([lat, lng]).addTo(map);
        onGuess({ lat, lng });
      }
    }, 250);
  });
  map.on('dblclick', () => clearTimeout(clickTimer));

  const fit = (bounds, opts = {}) => map.flyToBounds(bounds, { ...getPadding(), duration: 1, maxZoom: 16, ...opts });

  // The photo pin hangs above its point (see .photo-pin in style.css): ~64px wide, ~95px tall
  // with the tape. Padding every edge by that much keeps it on screen wherever the point lands.
  const PHOTO_PAD = { x: 36, y: 100 };
  function fitWithPhoto(bounds, opts) {
    const { paddingTopLeft: tl, paddingBottomRight: br } = getPadding();
    fit(bounds, {
      paddingTopLeft: [tl[0] + PHOTO_PAD.x, tl[1] + PHOTO_PAD.y],
      paddingBottomRight: [br[0] + PHOTO_PAD.x, br[1]],
      ...opts,
    });
  }

  let overview = null;
  let spotPin = null;

  function drawSightings(card) {
    card.sightings.forEach((p, i) => {
      const dot = L.circleMarker([p.lat, p.lng], {
        radius: 7, color: '#fff', weight: 2, fillColor: '#c8322b', fillOpacity: 0.95, className: 'sighting-dot',
      }).addTo(roundLayer);
      dot.getElement().style.animationDelay = `${0.6 + Math.min(i * 0.06, 2)}s`;
    });
  }

  // A small print of the card's photo gets pinned where it was actually taken.
  function pinPhoto(card, point) {
    const thumb = String(card.photoSmall || card.photo || '').replace(/"/g, '%22');
    if (!thumb) return;
    L.marker([point.lat, point.lng], {
      icon: L.divIcon({ className: 'photo-pin', html: `<div class="mini"><img src="${thumb}" alt="" /></div>`, iconSize: null }),
      interactive: false,
      zIndexOffset: 1000,
    }).addTo(roundLayer);
  }

  return {
    // Faint outlines of every region, shown on the start screen.
    setOverview(geojsons) {
      overview?.remove();
      overview = L.layerGroup(
        geojsons.map((g) =>
          L.polygon(polygonsOf(g).flat().map(toLatLngs), { className: 'region-overview', interactive: false })
        )
      );
    },

    showOverview(visible) {
      if (!overview) return;
      if (visible) overview.addTo(map);
      else overview.remove();
    },

    fitFinland() {
      fit(L.latLngBounds([59.7, 19.5], [70.1, 31.6]));
    },

    setMode(m) {
      mode = m;
      el.classList.toggle('guessing', m === 'guess');
    },

    showRegion(geojson) {
      regionLayer?.remove();
      const rings = polygonsOf(geojson).flat().map(toLatLngs);
      const outline = L.polygon(rings, { className: 'region-outline', interactive: false, fill: false });
      const mask = L.polygon([WORLD, ...rings], { className: 'region-mask', interactive: false, stroke: false });
      regionLayer = L.layerGroup([mask, outline]).addTo(map);
      regionGeojson = geojson;
      regionBounds = outline.getBounds();
      fit(regionBounds);
    },

    // Keep the player inside the region while playing. The limits are measured with the
    // panel's padding: on a phone the panel covers the bottom half, so the region has to be
    // able to sit above it at a lower zoom than a full-screen fit would need.
    lockToRegion(locked) {
      map.setMaxBounds(null);
      map.setMinZoom(0);
      if (locked && regionBounds) {
        const { paddingTopLeft: tl, paddingBottomRight: br } = getPadding();
        const zoom = map.getBoundsZoom(regionBounds, false, L.point(tl).add(br));
        const slack = map.getSize().multiplyBy(0.25);
        const sw = map.project(regionBounds.getSouthWest(), zoom).add([-tl[0] - slack.x, br[1] + slack.y]);
        const ne = map.project(regionBounds.getNorthEast(), zoom).add([br[0] + slack.x, -tl[1] - slack.y]);
        map.setMinZoom(Math.max(Math.floor(zoom) - 1, 3));
        map.setMaxBounds(L.latLngBounds(map.unproject(sw, zoom), map.unproject(ne, zoom)));
      }
    },

    fitRegion() {
      if (regionBounds) fit(regionBounds);
    },

    clearRound() {
      roundLayer.clearLayers();
      guessPin.remove();
    },

    reveal(card, guessPoint, nearestPoint, distance) {
      drawSightings(card);
      L.polyline([[guessPoint.lat, guessPoint.lng], [nearestPoint.lat, nearestPoint.lng]], {
        className: 'guess-line', interactive: false,
      })
        .bindTooltip(formatDistance(distance), { permanent: true, direction: 'center', className: 'distance-label' })
        .addTo(roundLayer);
      pinPhoto(card, nearestPoint);
      const bounds = L.latLngBounds([[guessPoint.lat, guessPoint.lng], ...card.sightings.map((p) => [p.lat, p.lng])]);
      fitWithPhoto(bounds, { maxZoom: 15 });
    },

    // "When is it seen?": where the species lives, while the player thinks about when.
    showSightings(card) {
      drawSightings(card);
      fitWithPhoto(L.latLngBounds(card.sightings.map((p) => [p.lat, p.lng])), { maxZoom: 12 });
    },

    // "Which one lives here?": a circled spot, zoomed out enough to recognise the place.
    showSpot(spot, radius) {
      const circle = L.circle([spot.lat, spot.lng], { radius, className: 'spot-circle', interactive: false }).addTo(roundLayer);
      spotPin = L.marker([spot.lat, spot.lng], {
        icon: L.divIcon({ className: 'spot-pin', html: '<span></span>', iconSize: [18, 18] }),
        interactive: false,
      }).addTo(roundLayer);
      fit(circle.getBounds().pad(2), { maxZoom: 11 });
    },

    // Only the asked-about spot stays on the map: the species' other sightings would be
    // ambiguous next to a wrong pick.
    revealSpot(card, spot, correct) {
      if (correct) spotPin?.getElement()?.classList.add('correct');
      pinPhoto(card, spot);
    },

    // End map: every card's sightings in its own colour, the guess (or the shown spot) as a
    // hollow ring. "When" questions have neither.
    showSummary(results) {
      this.clearRound();
      results.forEach(({ card, guess, spot }, i) => {
        const color = COLORS[i % COLORS.length];
        for (const p of card.sightings) {
          L.circleMarker([p.lat, p.lng], {
            radius: 6, color: '#fff', weight: 1.5, fillColor: color, fillOpacity: 0.9, interactive: false,
          }).addTo(roundLayer);
        }
        const g = guess ?? spot;
        if (!g) return;
        L.circleMarker([g.lat, g.lng], { radius: 10, color, weight: 4, fill: false, dashArray: guess ? null : '4 5' })
          .bindTooltip(guess ? `Arvauksesi: ${card.fi}` : `Täällä: ${card.fi}`)
          .addTo(roundLayer);
      });
      this.fitRegion();
    },
  };
}
