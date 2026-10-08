import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './style.css';
import { findInteresting } from './overpass.js';

// Vite rewrites asset URLs, so point Leaflet's default marker at the bundled images.
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
});

const HELSINKI = [60.1699, 24.9384];

const map = L.map('map', { zoomControl: false }).setView(HELSINKI, 15);
L.control.zoom({ position: 'topright' }).addTo(map);

L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map);

const finds = L.layerGroup().addTo(map);
let userMarker;

// --- UI helpers -------------------------------------------------------------
const toastEl = document.getElementById('toast');
let toastTimer;
function toast(msg, ms = 3000) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function describe(tags) {
  const name = tags.name || tags['name:fi'] || tags['name:en'];
  const kind = tags.tourism || tags.historic || tags.natural || tags.amenity || 'kohde';
  return { name: name || `Nimetön ${kind}`, kind };
}

// --- Location ---------------------------------------------------------------
document.getElementById('locate').addEventListener('click', () => {
  if (!navigator.geolocation) return toast('Selain ei tue paikannusta');
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => {
      const ll = [coords.latitude, coords.longitude];
      userMarker ??= L.circleMarker(ll, { radius: 8, className: 'me' }).addTo(map);
      userMarker.setLatLng(ll);
      map.flyTo(ll, 16);
    },
    () => toast('Paikannus epäonnistui'),
    { enableHighAccuracy: true, timeout: 10000 }
  );
});

// --- Discover ---------------------------------------------------------------
const discoverBtn = document.getElementById('discover');
const seen = new Set();

discoverBtn.addEventListener('click', async () => {
  const { lat, lng } = map.getCenter();
  discoverBtn.disabled = true;
  discoverBtn.textContent = 'Etsitään…';
  try {
    const places = await findInteresting(lat, lng, 1500);
    const fresh = places.filter((p) => !seen.has(p.id));
    if (!fresh.length) return toast('Ei uusia löytöjä täältä — siirry muualle!');

    const pick = fresh[Math.floor(Math.random() * fresh.length)];
    seen.add(pick.id);
    const { name, kind } = describe(pick.tags);

    L.marker([pick.lat, pick.lng])
      .addTo(finds)
      .bindPopup(`<strong>${escapeHtml(name)}</strong><br><small>${escapeHtml(kind)}</small>`)
      .openPopup();
    map.flyTo([pick.lat, pick.lng], 17);
  } catch (err) {
    console.error(err);
    toast('Hakupalvelu ei vastannut, yritä hetken päästä uudelleen');
  } finally {
    discoverBtn.disabled = false;
    discoverBtn.textContent = 'Löydä jotain uutta';
  }
});
