import 'leaflet/dist/leaflet.css';
import './style.css';
import { createMap } from './map.js';
import { loadPool, getTaxa, getLastSighting, reverseGeocode } from './api.js';
import { QUICK_PLACES } from './places.js';
import {
  buildRound, makeOptions, scoreAnswer, titleFor, loadBest, saveBest, STREAK_FOR_DOUBLE,
} from './quiz.js';
import * as ui from './ui.js';

const MIN_SPECIES_TO_PLAY = 4;
const ROUND_LENGTH = 10;

const state = {
  place: null, // { lat, lng, name, key, radiusKm }
  pool: null,
  loadToken: 0,
  round: null,
};

const panel = document.getElementById('start-panel');
const isNarrow = () => window.matchMedia('(max-width: 720px)').matches;

const map = createMap(document.getElementById('map'), {
  onPick: (lat, lng) => selectPlace(lat, lng),
  // Keep the selected area visible beside (desktop) or above (phone) the start panel.
  getPadding: () =>
    isNarrow()
      ? { paddingTopLeft: [20, 20], paddingBottomRight: [20, panel.offsetHeight + 20] }
      : { paddingTopLeft: [panel.offsetWidth + 40, 20], paddingBottomRight: [60, 20] },
});

// --- Choosing a place ----------------------------------------------------------------
ui.renderQuickPlaces(QUICK_PLACES, (p) => selectPlace(p.lat, p.lng, p.name, p.slug));

document.getElementById('locate').addEventListener('click', () => {
  if (!navigator.geolocation) return ui.toast('Selaimesi ei tue paikannusta – napauta karttaa.');
  ui.showPlaceLoading('Paikannetaan…');
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => selectPlace(coords.latitude, coords.longitude),
    () => {
      ui.showPlaceError('Sijaintia ei saatu. Napauta karttaa tai valitse valmis paikka.');
    },
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
  );
});

async function selectPlace(lat, lng, knownName = null, slug = null) {
  const token = ++state.loadToken;
  const stale = () => token !== state.loadToken;
  state.pool = null;
  map.setPlace(lat, lng, 1);
  ui.showPlaceLoading('Haetaan alueella havaittuja lajeja…');

  const namePromise = knownName ? Promise.resolve(knownName) : reverseGeocode(lat, lng).catch(() => null);
  let pool;
  try {
    pool = await loadPool(lat, lng, { onProgress: (msg) => !stale() && ui.showPlaceLoading(msg) });
  } catch (err) {
    console.error(err);
    if (!stale()) ui.showPlaceError('Lajitietoja ei saatu haettua. Tarkista verkkoyhteys ja yritä uudelleen.');
    return;
  }
  if (stale()) return;

  if (pool.fallback) {
    const fb = pool.fallback;
    ui.toast(`Lajipalvelu ei vastannut – käytetään tallennettua aineistoa: ${fb.name}.`, 6000);
    ({ lat, lng, slug } = fb);
    knownName = fb.name;
  } else if (pool.widened) {
    ui.toast(`Lähellä oli vähän havaintoja, joten laajensimme aluetta ${pool.radiusKm} km:iin.`);
  }
  map.setPlace(lat, lng, pool.radiusKm);

  if (pool.species.length < MIN_SPECIES_TO_PLAY) {
    ui.showPlaceError(
      'Täällä on havaittu liian vähän lajeja visaa varten. Kokeile kaupunkia tai jotain valmiista paikoista.'
    );
    return;
  }

  const name = (pool.fallback ? knownName : await namePromise) || 'Valitsemasi paikka';
  if (stale()) return;
  state.pool = pool;
  state.place = { lat, lng, name, radiusKm: pool.radiusKm, key: slug ?? `${lat.toFixed(2)},${lng.toFixed(2)}` };
  ui.showPlaceReady({ name, pool, best: loadBest(state.place.key), onStart: startRound });
}

// --- Quiz flow ---------------------------------------------------------------------------
function startRound() {
  if (!state.pool) return;
  const species = buildRound(state.pool.species, ROUND_LENGTH);
  for (const s of species) new Image().src = s.photo.replace('/medium.', '/large.');
  state.round = {
    species,
    details: getTaxa(species.map((s) => s.id)).catch(() => new Map()),
    i: 0, score: 0, streak: 0, correct: 0, answers: [],
    options: [], answered: false, shownAt: 0,
  };
  ui.closeResults();
  ui.openQuiz();
  showQuestion();
}

function showQuestion() {
  const r = state.round;
  const target = r.species[r.i];
  r.options = makeOptions(target, state.pool.species);
  r.answered = false;
  r.shownAt = 0;
  ui.renderQuestion({
    target,
    options: r.options,
    index: r.i,
    total: r.species.length,
    score: r.score,
    streak: r.streak,
    getMorePhotos: async () => (await r.details).get(target.id)?.photos ?? [],
    onPhotoLoad: () => (r.shownAt ||= performance.now()),
    onPhotoFail: skipQuestion,
    onAnswer: answer,
    onQuit: quitRound,
  });
}

function answer(idx) {
  const r = state.round;
  if (!r || r.answered) return;
  r.answered = true;
  const target = r.species[r.i];
  const correctIdx = r.options.indexOf(target);
  const correct = idx === correctIdx;
  const elapsed = r.shownAt ? performance.now() - r.shownAt : 10000;
  const points = scoreAnswer(r, correct, elapsed);
  r.answers.push({ species: target, correct });

  ui.showAnswer({ chosenIdx: idx, correctIdx, score: r.score, streak: r.streak });
  const { lat, lng, radiusKm } = state.place;
  ui.showFeedback({
    target,
    correct,
    points,
    doubled: correct && r.streak >= STREAK_FOR_DOUBLE,
    isLast: r.i === r.species.length - 1,
    place: state.place,
    details: r.details,
    sighting: getLastSighting(target.id, lat, lng, radiusKm).catch(() => null),
    onNext: next,
  });
}

function next() {
  const r = state.round;
  if (!r?.answered) return;
  r.i++;
  if (r.i >= r.species.length) finishRound();
  else showQuestion();
}

function skipQuestion() {
  const r = state.round;
  r.species.splice(r.i, 1);
  if (r.i >= r.species.length) finishRound();
  else showQuestion();
}

function quitRound() {
  state.round = null;
  ui.closeQuiz();
}

function finishRound() {
  const r = state.round;
  ui.closeQuiz();
  state.round = null;
  if (!r.answers.length) {
    ui.toast('Kuvia ei saatu ladattua. Yritä hetken päästä uudelleen.');
    return;
  }
  const total = r.answers.length;
  const { isNew } = saveBest(state.place.key, r.score);
  ui.showResults({
    correct: r.correct,
    total,
    score: r.score,
    title: titleFor(r.correct, total),
    placeName: state.place.name,
    isNewBest: isNew,
    answers: r.answers,
    onAgain: startRound,
    onChange: () => {
      ui.closeResults();
      ui.showPlaceReady({ name: state.place.name, pool: state.pool, best: loadBest(state.place.key), onStart: startRound });
    },
  });
  if (r.correct / total >= 0.7) ui.confetti();
}

// --- Keyboard: 1–4 answer, Enter next, Esc closes ----------------------------------------
document.addEventListener('keydown', (e) => {
  const r = state.round;
  if (r && !r.answered && /^[1-4]$/.test(e.key) && Number(e.key) <= r.options.length) {
    answer(Number(e.key) - 1);
  } else if (e.key === 'Escape') {
    if (r) quitRound();
    else ui.closeResults();
  }
});
