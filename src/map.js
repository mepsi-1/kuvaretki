import L from 'leaflet';

const FINLAND = [62.5, 25.5];

export function createMap(el, { onPick, getPadding }) {
  const map = L.map(el, { zoomControl: false, attributionControl: false }).setView(FINLAND, 6);
  L.control.zoom({ position: 'topright' }).addTo(map);
  L.control.attribution({ position: 'topright', prefix: false }).addTo(map);

  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · ' +
      'Lajit: <a href="https://www.inaturalist.org/">iNaturalist</a>',
  }).addTo(map);

  const pin = L.marker(FINLAND, {
    icon: L.divIcon({ className: 'pin', html: '<span></span>', iconSize: [28, 28] }),
    interactive: false,
  });
  const circle = L.circle(FINLAND, { radius: 1000, className: 'radius' });
  const sighting = L.marker(FINLAND, {
    icon: L.divIcon({ className: 'sighting', html: '<span>👀</span>', iconSize: [34, 34] }),
    interactive: false,
  });

  let clickTimer;
  map.on('click', (e) => {
    // Debounce so a double-click zoom doesn't start two fetches.
    clearTimeout(clickTimer);
    clickTimer = setTimeout(() => onPick(e.latlng.lat, e.latlng.lng), 300);
  });
  map.on('dblclick', () => clearTimeout(clickTimer));

  return {
    setPlace(lat, lng, radiusKm) {
      pin.setLatLng([lat, lng]).addTo(map);
      circle.setLatLng([lat, lng]).setRadius(radiusKm * 1000).addTo(map);
      sighting.remove();
      map.flyToBounds(circle.getBounds(), { ...getPadding(), duration: 1.2, maxZoom: 16 });
    },
    showSighting(lat, lng) {
      sighting.setLatLng([lat, lng]).addTo(map);
    },
    hideSighting() {
      sighting.remove();
    },
  };
}
