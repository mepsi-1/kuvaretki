# Know Your Neighbours ("Tunnista naapurisi"): implementation plan

Softamestari 2026 qualifier. Theme: **Löytöretki (Voyage of discovery)**. Deadline **Thu 8 Oct 2026, 20:00** (Europe/Helsinki).

## 1. Concept

A photo quiz that teaches you to recognise the **species in your own surroundings**. The user picks a place on the map (or uses their location), and the app fetches the species that have actually been observed there from iNaturalist. Each question shows a photo of a species and four answer options. The wrong options come **from the same species group and the same area**, which keeps the quiz challenging and educational.

Core promise: *"You know your neighbours, but do you know the ones that aren't human?"*

At the end, the user sees how many of the area's most common species they can recognise ("You recognise 34/50 of Hervanta's most common species").

UI language: **Finnish** (species names via `locale=fi`).

## 2. Contest constraints (from the contest README)

- Runs **in the browser only**: no own server, database or backend. Calling public APIs from the browser is fine.
- Libraries and frameworks are allowed. Uses OpenStreetMap.
- Submit as a zip, **max 50 MB, without `node_modules`**. Must include a **README with instructions for starting the app**.
- Upload form: https://softamestari.curious.fi/esikarsinta/palautus. **Only one submission is allowed.**
- Judging: 1) idea and originality, 2) user experience and "wow", 3) technical reliability.

## 3. Tech stack

The existing starter in this repo is **Vite 6 + Leaflet 1.9 + vanilla JS** (`src/main.js`, `src/style.css`, `src/overpass.js`). We keep it.

- Start: `npm install && npm run dev`. Also `npm run build` so the `dist/` folder works as a static site.
- Leaflet with OSM raster tiles `https://tile.openstreetmap.org/{z}/{x}/{y}.png`.
- OSM attribution must be visible on the map: `© OpenStreetMap contributors`.
- `src/overpass.js` is not needed for the MVP. Remove it or keep it for an optional layer, such as parks and forests on the map.
- No other dependencies unless necessary. Confetti via e.g. `canvas-confetti` if time allows.

## 4. Data and APIs (tested 8 Oct, 17:00–18:00)

All of these return CORS `*`, and none needs an API key.

### 4.1 Species in an area (primary source)
```
GET https://api.inaturalist.org/v1/observations/species_counts
    ?lat={lat}&lng={lng}&radius={km}&per_page=200&verifiable=true&locale=fi
```
- Returns `results[]` of `{ count, taxon }`. Useful `taxon` fields: `id`, `name` (scientific name), `preferred_common_name` (Finnish), `iconic_taxon_name` (Plantae, Aves, Insecta, Fungi, Mammalia, Arachnida, Mollusca, …), `ancestor_ids`, `default_photo.medium_url`, `default_photo.square_url`, `default_photo.attribution`, `wikipedia_url`.
- A response is about 246 kB and takes about 3 s. Trimmed to the needed fields it is about 33 kB.
- Coverage within 1 km: 600–1,700 species in cities, dozens in small towns, 0 in wilderness. Finnish names exist for about 90–99 % of species and photos for 100 %.

| Place | 300 m | 1 km | 5 km |
|---|---|---|---|
| Helsinki centre | 576 | 1,359 | 4,099 |
| Tampere, Hervanta | 239 | 671 | 2,804 |
| Oulu centre | 152 | 661 | 2,006 |
| Inari village | 57 | 195 | 282 |
| Kuhmoinen (small town) | 14 | 71 | 168 |
| Kainuu forest | 0 | 0 | 9 |

### 4.2 Species details (feedback card)
```
GET https://api.inaturalist.org/v1/taxa/{id}?locale=fi
```
- `wikipedia_summary` is a Finnish summary that contains HTML (`<b>`, `<i>`). Clean it and shorten it to 1–2 sentences.
- `taxon_photos[]` has more photos, so the same species doesn't always look the same.
- Multiple IDs can likely be fetched at once with a comma-separated list (`/v1/taxa/1,2,3`). Verify before relying on it.

### 4.3 Where the species was last seen (feedback card, optional)
```
GET https://api.inaturalist.org/v1/observations
    ?taxon_id={id}&lat={lat}&lng={lng}&radius={km}&per_page=1&order_by=observed_on&photos=true
```
- Fields: `observed_on`, `place_guess` (e.g. "Ahvenisraitti, Tampere"), `location` = `"lat,lng"`. Show the observation as a point on a mini map.

### 4.4 Place name (optional)
```
GET https://nominatim.openstreetmap.org/reverse?lat={lat}&lon={lng}&format=jsonv2&zoom=14&accept-language=fi
```
- District name ("Hervanta"). Max 1 request/s, so make only one request per place.

### 4.5 Backup sources (optional)
- GBIF `https://api.gbif.org/v1/occurrence/search` works but is heavier to use. **Not needed for the MVP.**
- Laji.fi requires an access token. **Do not use.**

### 4.6 Limits
- iNaturalist allows about 1 request/s. **Cache** results in an in-memory `Map` plus `sessionStorage`, with storage access wrapped in try/catch. The cache key is the rounded coordinates (3 decimals) plus the radius.
- **Debounce** map clicks, and don't start a new fetch while one is in progress.

## 5. Quiz logic

### 5.1 Building the species pool
1. Fetch species_counts with a 1 km radius.
2. **Adaptive radius:** if there are fewer than 30 valid species, retry with 3, 10 and 30 km. Tell the user: "Few observations nearby, we widened the area to 10 km."
3. Filter: the species must have a `default_photo`, and rank must be `species`.
4. Normalise names so the first letter is uppercase (the data mixes "Orava" and "pihlaja"). If the Finnish name is missing, fall back to the scientific name.

### 5.2 Picking questions
- A round has **10 questions**.
- Pick the target species weighted by **observation count**, so common species come up more often. Those are the "neighbours". One or two rarer species per round add surprises.
- No species repeats within a round.

### 5.3 Wrong options
- Three wrong options from the **same `iconic_taxon_name`** in the same pool.
- If the group is too small, fill from related groups (e.g. Insecta ↔ Arachnida), and finally from any group.
- Difficulty levels (optional): *easy* = options from different groups, *normal* = same group, *hard* = same genus or family, chosen by the closest `ancestor_ids`.

### 5.4 Scoring
- 1 point per correct answer, plus a speed bonus and a streak multiplier (3 correct in a row ⇒ ×2) for extra game feel.
- The end screen shows **"You recognise X/Y of the area's most common species"** and the round's right and wrong answers with photos.
- Store the best score per place in `localStorage` (try/catch). This is a convenience feature only.

## 6. Screens and UX

1. **Start / map**
   - Full-screen map with the title "Tunnista naapurisi".
   - A **"Use my location"** button and **quick places** (Helsinki, Tampere, Oulu, Jyväskylä, Inari). Judges will probably test indoors.
   - Clicking the map sets a pin and a radius circle.
   - Panel: place name, "**1,359** species have been observed here", and the group breakdown as small icons (🌿 🐦 🍄 🦋 🐾). A big **"Start quiz"** button.
2. **Question**
   - Large species photo, a progress bar (3/10), score and streak.
   - Four answer buttons with the Finnish name, plus the scientific name in small print.
   - Small photo credit and licence below the photo (`attribution`).
3. **Feedback (after answering)**
   - Green for correct, red for wrong, and the correct answer highlighted.
   - **Species card**: name, scientific name, a 1–2 sentence fact from Wikipedia, "Observed here 26 times", "Last seen 10 Jun 2026, Ahvenisraitti", and a mini map. Link to Wikipedia.
   - A "Next" button.
4. **Results**
   - "You recognised 7/10" and a title, e.g. *Pihapiirin tuntija* (Backyard expert), *Lähimetsän asiantuntija* (Local woods expert), *Retkikunnan johtaja* (Expedition leader).
   - A gallery of the round's species, a "New round here" button and a "Change place" button.

Visual style: nature theme (greens and earthy tones), rounded cards, smooth transitions, light and dark mode. Mobile-first, because the quiz is meant to be played outdoors too.

## 7. Reliability

- **Fallback data:** `public/fallback/*.json` holds pre-fetched, trimmed pools for the quick places (about 30 kB each, under 0.5 MB in total). Generate them with `scripts/snapshot.mjs` (Node, run during development). If the live fetch fails or times out (8 s), use the fallback and show a small notice.
- Photo load error: switch to the next `taxon_photos` image or skip the question.
- Empty area: use the adaptive radius, and finally show a friendly message suggesting a quick place.
- Wrap every `fetch` in try/catch, and show a loading indicator for each one.

## 8. Folder structure (building on the existing starter)

```
loytoretki/
  index.html           ← existing; replace the panels with the quiz UI
  package.json         ← existing (vite, leaflet)
  README.md            ← how to run (required)
  plan.md              ← this file
  public/fallback/     ← fallback pools
  scripts/snapshot.mjs
  src/
    main.js            ← existing; view switching / state
    map.js             ← Leaflet, pin, radius
    api.js             ← iNat + Nominatim, cache, timeout
    quiz.js            ← pool building, question picking, wrong options, scoring
    ui/                ← question, feedback and results views
    style.css          ← existing
```

`.gitignore` already excludes `node_modules`, `dist` and `*.zip`.

## 9. Schedule (estimate; deadline 20:00)

| Time | Task |
|---|---|
| 0:00–0:20 | Adapt the starter: map, click → pin + radius |
| 0:20–0:50 | `api.js`: species_counts, cache, adaptive radius, normalisation |
| 0:50–1:30 | `quiz.js` + question view + feedback → **playable MVP** |
| 1:30–2:00 | Species card (Wikipedia summary, last sighting), results view |
| 2:00–2:30 | Styling, animations, mobile, quick places, fallback data |
| 2:30–2:45 | Testing: different places, wilderness, network failure, phone size |
| 2:45–3:00 | README, `npm run build`, zip (without node_modules), **submit by 19:45 at the latest** |

If time runs out, drop features in this order: difficulty levels → last sighting and mini map → speed bonus → dark mode.

## 10. Submission checklist

- [ ] `npm install && npm run dev` works from a clean clone
- [ ] README: what the app is, how to start it, data sources and licences (OSM ODbL, iNaturalist photo licences, Wikipedia CC BY-SA)
- [ ] OSM attribution is visible on the map
- [ ] Works without location permission (quick places and map clicks)
- [ ] Works when iNaturalist doesn't respond (fallback data)
- [ ] Zip without `node_modules`, under 50 MB
- [ ] Submitted via the form before 20:00. **Only one submission!**
