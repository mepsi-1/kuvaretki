# Kuvaretki

Softamestari 2026 -esikarsinnan työ, teema *Löytöretki*.

Karttapeli oman alueesi eliöistä. Valitse maakunta, ja peli näyttää lajikortin kerrallaan:
kuva, nimi ja lyhyt kuvaus. Napauta karttaa siihen kohtaan, jossa luulet lajin elävän. Sen jälkeen
kartalle ilmestyvät lajin todelliset havainnot alueelta, ja pisteet määräytyvät etäisyydestä
lähimpään havaintoon. Kierroksessa on kymmenen kysymystä: kuusi lajia sijoitetaan kartalle, kahdessa
arvataan, minä kuukautena lajia havaitaan eniten, ja lopuksi tulee kaksi käänteistä, joissa kartalle
merkitään paikka ja kolmesta lajikuvasta pitää valita se, joka on havaittu siellä.

> Tunnet kotiseutusi kartan. Tiedätkö, kuka siellä asuu?

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
Sivua ei kannata avata suoraan `file://`-osoitteesta.

Sovellus toimii kokonaan selaimessa eikä tarvitse taustajärjestelmää tai API-avaimia.
Pelin aineisto (19 maakuntaa) on haettu valmiiksi `public/data/`-kansioon, joten pelatessa verkosta
ladataan vain karttatiilet, lajikuvat ja fontit (Google Fonts).

## Aineisto ja lajien valinta

Aineisto on haettu skriptillä `node scripts/build-data.mjs` (noin minuutti maakuntaa kohden;
yksittäisen maakunnan voi päivittää antamalla sen tunnuksen, esim. `node scripts/build-data.mjs lappi`).
Pelkät kuukausijakaumat voi hakea olemassa oleviin kortteihin arpomatta kortteja uudelleen:
`node scripts/build-data.mjs --months [maakunta ...]`.
Aloitusnäkymän laji- ja havaintomäärät (laskettu iNaturalistin maakuntapaikan rajojen sisältä)
päivittyvät samoin: `node scripts/build-data.mjs --stats [maakunta ...]`.

1. Maakunnan rajat haetaan Nominatimista (OSM:n hallinnolliset rajat).
2. Maakunnan rajaavan suorakulmion alueella havaitut lajit haetaan iNaturalistin `species_counts`-rajapinnasta.
   Ehdokkaiksi otetaan suomenkielisen nimen omaavat lajit, joilla on 5–200 havaintoa (enintään 120 lajia,
   arvottuna havaintomäärällä painottaen).
3. Ehdokaslajien tutkimustasoiset havainnot haetaan. Mukaan otetaan vain maakunnan rajojen
   sisällä olevat, sijainniltaan avoimet ja alle kilometrin tarkat havainnot.
4. Lajit, joiden havainnoista yli puolet on maakunnan pääkaupungin lähellä, hylätään, jotta
   "arvaa aina kaupunki" ei kannata.
5. Jäljelle jääneistä valitaan enintään 30 lajia, joiden havainnot ovat tiiveimmin keskittyneet
   (eli lajin paikan voi oikeasti päätellä kartasta), ja yksikään eliöryhmä (esim. kasvit) ei saa viedä
   yli 40 %:a korteista. Maakunnasta riippuen kortteja on 15–30. Kierrokselle arvotaan kuusi
   sijoitettavaa lajia (enintään kaksi samasta ryhmästä, viime kierroksilla pelattuja vältellen),
   kaksi milloin-kysymyksiin ja kaksi käänteisiin kysymyksiin.
6. Käänteisissä kysymyksissä paikaksi valitaan oikean lajin havainto, josta kahden väärän
   vaihtoehdon lähimmät havainnot ovat mahdollisimman kaukana (vähintään `2·d0`, tarvittaessa
   löysäten `d0`:aan asti). Oikea vastaus on 1000 pistettä.
7. Milloin-kysymyksiin kelpaavat lajit, joilla on maakunnassa vähintään 20 havaintoa ja selvä sesonki
   (kuukausien keskivektorin pituus kehällä vähintään 0,3). Kahden kysymyksen huippukuukaudet pyritään
   pitämään vähintään kahden kuukauden päässä toisistaan. Pisteet ovat
   `1000 × valitun kuukauden havainnot / huippukuukauden havainnot`.

Paikkakysymysten pisteet: `1000 × exp(−d / d0)`, missä `d` on etäisyys lähimpään havaintoon ja `d0`
riippuu maakunnan koosta. Kierroksen maksimi on 10 000 pistettä (jos kaikkia kysymystyyppejä ei saada muodostettua,
kierros on lyhyempi ja maksimi pienempi).

## Tekniikka

- [Vite](https://vite.dev/) + [Leaflet](https://leafletjs.com/) + tavallinen JavaScript
- OpenStreetMap-karttatiilet
- [Nominatim](https://nominatim.org/) aluerajoihin ja [iNaturalist API](https://api.inaturalist.org/)
  lajeihin, havaintoihin ja kuvauksiin (vain aineiston esihaussa)

## Lähteet ja lisenssit

- Karttadata ja aluerajat © OpenStreetMapin tekijät, [ODbL](https://www.openstreetmap.org/copyright).
- Havainnot: [iNaturalist](https://www.inaturalist.org/) ja sen käyttäjät. Lajikuvien tekijät ja
  lisenssit näytetään jokaisen kuvan alla.
- Lajikuvaukset: Wikipedia, [CC BY-SA](https://creativecommons.org/licenses/by-sa/4.0/).
