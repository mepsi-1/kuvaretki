import 'leaflet/dist/leaflet.css';
import './style.css';
import { createMap } from './map.js';
import { loadRegions, loadCards } from './data.js';
import {
  dealRound, scoreFor, feedbackFor, choicePoints, choiceFeedbackFor, whenPoints, whenFeedbackFor, titleFor,
  loadBest, saveBest, ROUND_LENGTH,
} from './cards.js';
import { nearest, pointInGeometry } from './geo.js';
import * as ui from './ui.js';

const state = {
  regions: [],
  region: null, // one of state.regions
  cards: null, // the region's cards, once loaded
  played: new Map(), // slug → Set of card ids played recently
  loadToken: 0,
  round: null,
};

const panelEl = document.getElementById('panel');
const isNarrow = () => window.matchMedia('(max-width: 720px)').matches;

const map = createMap(document.getElementById('map'), {
  onPick: (lat, lng) => {
    const region = state.regions.find((r) => pointInGeometry(lat, lng, r.geojson));
    if (region) selectRegion(region);
    else ui.toast('Valitse jokin Suomen maakunnista.');
  },
  onGuess: (g) => lockGuess(g),
  onOutside: () => ui.toast('Arvaa alueen sisältä: raja näkyy katkoviivana.', 2500),
  // Keep the map content visible beside (desktop) or above (phone) the panel.
  getPadding: () =>
    isNarrow()
      ? { paddingTopLeft: [20, 20], paddingBottomRight: [20, panelEl.offsetHeight + 20] }
      : { paddingTopLeft: [panelEl.offsetWidth + 40, 20], paddingBottomRight: [60, 20] },
});

// --- Start screen: choosing a region ------------------------------------------------
function showStart() {
  state.round = null;
  map.lockToRegion(false);
  map.clearRound();
  map.setMode('pick');
  map.showOverview(true);
  ui.renderStart({
    regions: state.regions,
    selected: state.region?.slug,
    onRegion: (slug) => selectRegion(state.regions.find((r) => r.slug === slug)),
    onChange: () => map.fitFinland(),
  });
  if (state.region && state.cards) {
    ui.markRegion(state.region.slug);
    showRegionReady();
  }
}

async function selectRegion(region) {
  if (!region) return;
  const token = ++state.loadToken;
  state.region = region;
  state.cards = null;
  ui.markRegion(region.slug);
  map.showRegion(region.geojson);
  ui.showRegionLoading('Ladataan lajeja…');
  try {
    const cards = await loadCards(region.slug);
    if (token !== state.loadToken) return;
    state.cards = cards;
    showRegionReady();
  } catch (err) {
    if (token !== state.loadToken) return;
    console.error(err);
    ui.showRegionError('Alueen tietoja ei saatu ladattua. Yritä uudelleen.');
  }
}

function showRegionReady() {
  const r = state.region;
  ui.showRegionReady({
    name: r.name,
    stats: r.stats,
    best: loadBest(r.slug),
    onStart: startRound,
  });
  // The panel changed height (on a phone), so frame the region against its final size.
  map.fitRegion();
}

// --- Round ------------------------------------------------------------------------------
function startRound() {
  if (!state.cards?.length) return showStart();
  const slug = state.region.slug;
  if (!state.played.has(slug)) state.played.set(slug, new Set());
  const deck = dealRound(state.cards, state.played.get(slug), state.region.metrics.d0);
  // Without month data the region deals no "when" questions, so the round may be shorter.
  state.round = { deck, total: deck.length, results: [], score: 0, card: null };
  map.showOverview(false);
  nextCard();
}

function nextCard() {
  const r = state.round;
  if (!r) return;
  const card = r.deck.shift();
  if (!card) return finishRound();
  r.card = card;
  map.clearRound();
  if (card.choice) return showChoice(card);
  if (card.when) return showWhen(card);
  map.setMode('guess');
  ui.renderCard({ ...progress(), card, regionName: state.region.name });
  // Measure the lock and the fit against the card panel that is now on screen.
  map.lockToRegion(true);
  map.fitRegion();
}

// Fields every question panel shows and needs.
function progress() {
  const r = state.round;
  return { index: r.results.length, total: r.total, score: r.score, onQuit: showStart, onPhotoFail: nextCard };
}

function lockGuess(guess) {
  const r = state.round;
  if (!r?.card) return;
  map.setMode('locked');
  const card = r.card;
  r.card = null;
  const { point, distance } = nearest(guess, card.sightings);
  const points = scoreFor(distance, state.region.metrics.d0);
  r.score += points;
  r.results.push({ card, guess, points });
  // Render first so the fit leaves room for the (taller) verdict panel.
  ui.renderReveal({
    points,
    feedback: feedbackFor(points),
    score: r.score,
    isLast: !r.deck.length,
    onNext: nextCard,
  });
  map.reveal(card, guess, point, distance);
}

// "When is it seen?": `q` is { card } from dealRound.
function showWhen(q) {
  const r = state.round;
  map.setMode('locked');
  ui.renderWhen({
    ...progress(),
    card: q.card,
    regionName: state.region.name,
    firstWhen: !r.results.some((x) => x.month != null),
    onPick: pickWhen,
  });
  map.lockToRegion(true);
  // The sightings are no hint about the month, so they're on the map from the start.
  map.showSightings(q.card);
}

function pickWhen(month) {
  const r = state.round;
  const q = r?.card;
  if (!q?.when) return;
  r.card = null;
  const points = whenPoints(q.card, month);
  r.score += points;
  r.results.push({ card: q.card, month, points });
  ui.renderWhenReveal({
    card: q.card,
    month,
    points,
    feedback: whenFeedbackFor(points, q.card),
    score: r.score,
    isLast: !r.deck.length,
    onNext: nextCard,
  });
}

// "Which one lives here?": `q` is { card, options, spot } from dealRound.
function showChoice(q) {
  const r = state.round;
  map.setMode('locked');
  ui.renderChoice({
    ...progress(),
    options: q.options,
    firstChoice: !r.results.some((x) => x.spot),
    onPick: pickChoice,
  });
  map.lockToRegion(true);
  map.showSpot(q.spot, state.region.metrics.d0 / 2);
}

function pickChoice(picked) {
  const r = state.round;
  const q = r?.card;
  if (!q?.choice) return;
  r.card = null;
  const correct = q.options[picked] === q.card;
  const points = choicePoints(correct);
  r.score += points;
  r.results.push({ card: q.card, spot: q.spot, points, correct });
  ui.renderChoiceReveal({
    pickedIndex: picked,
    correct,
    feedback: choiceFeedbackFor(correct, q.card),
    score: r.score,
    isLast: !r.deck.length,
    onNext: nextCard,
  });
  map.revealSpot(q.card, q.spot, correct);
}

function finishRound() {
  const r = state.round;
  state.round = null;
  if (!r?.results.length) {
    ui.toast('Lajikuvia ei saatu ladattua. Yritä hetken päästä uudelleen.');
    return showStart();
  }
  map.setMode('locked');
  map.lockToRegion(false);
  map.showSummary(r.results);
  const max = r.results.length * 1000;
  const isNewBest = r.results.length === ROUND_LENGTH && saveBest(state.region.slug, r.score);
  ui.renderResults({
    regionName: state.region.name,
    results: r.results,
    total: r.score,
    max,
    title: titleFor(r.score, max),
    isNewBest,
    onAgain: startRound,
    onChange: () => {
      showStart();
      map.fitFinland();
    },
  });
  if (r.score / max >= 0.6) ui.confetti();
}

// --- Boot ---------------------------------------------------------------------------------
async function boot() {
  showStart();
  ui.showRegionLoading('Ladataan maakuntia…');
  try {
    state.regions = await loadRegions();
  } catch (err) {
    console.error(err);
    ui.showRegionError('Pelin tietoja ei saatu ladattua. Päivitä sivu.');
    return;
  }
  map.setOverview(state.regions.map((r) => r.geojson));
  showStart();
  map.fitFinland();
}

boot();
