# Löytöretki

Softamestari 2026 -esikarsinnan työ: OpenStreetMapia hyödyntävä selainsovellus teemalla *Löytöretki*.

## Käynnistys

Vaatii Node.js 18+.

```bash
npm install
npm run dev
```

Avaa selaimessa terminaalin näyttämä osoite (oletuksena http://localhost:5173).

Tuotantoversio:

```bash
npm run build
npm run preview
```

`dist/`-kansion voi myös tarjoilla millä tahansa staattisella palvelimella (esim. `npx serve dist`).
Sivua ei kannata avata suoraan `file://`-osoitteesta, koska OSM:n karttatiilet vaativat HTTP-alkuperän.

## Tekniikka

- [Leaflet](https://leafletjs.com/) + OpenStreetMap-karttatiilet
- [Overpass API](https://wiki.openstreetmap.org/wiki/Overpass_API) kohteiden hakuun
- [Vite](https://vite.dev/), ei taustajärjestelmää

Karttadata © OpenStreetMapin tekijät, ODbL.
