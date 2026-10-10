import { COLORS } from './map.js';
import { ROUND_LENGTH, MONTHS_FI, seasonality } from './cards.js';

const $ = (sel, root = document) => root.querySelector(sel);
const panel = () => $('#panel');

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

const GROUPS = {
  Plantae: { emoji: '🌿', label: 'kasvi' },
  Aves: { emoji: '🐦', label: 'lintu' },
  Insecta: { emoji: '🦋', label: 'hyönteinen' },
  Fungi: { emoji: '🍄', label: 'sieni' },
  Mammalia: { emoji: '🦊', label: 'nisäkäs' },
  Arachnida: { emoji: '🕷️', label: 'hämähäkkieläin' },
  Mollusca: { emoji: '🐌', label: 'nilviäinen' },
  Amphibia: { emoji: '🐸', label: 'sammakkoeläin' },
  Reptilia: { emoji: '🦎', label: 'matelija' },
  Actinopterygii: { emoji: '🐟', label: 'kala' },
};
const OTHER_GROUP = { emoji: '🔬', label: 'muu eliö' };
const groupInfo = (g) => GROUPS[g] ?? OTHER_GROUP;

const fmt = (n) => n.toLocaleString('fi-FI');

// Wikipedia summary contains HTML; keep 1–2 sentences of plain text and drop any sentence
// that names the region (that would give the answer away).
function cleanSummary(html, regionName) {
  if (!html) return '';
  const text = new DOMParser().parseFromString(html, 'text/html').body.textContent.trim();
  const stem = regionName ? regionName.slice(0, Math.max(4, regionName.length - 2)).toLowerCase() : null;
  const sentences = text
    .split(/(?<=[.!?])\s+(?=[A-ZÅÄÖ])/)
    .filter((s) => !stem || !s.toLowerCase().includes(stem));
  let out = sentences[0] ?? '';
  if (out.length < 120 && sentences[1]) out += ' ' + sentences[1];
  return out.length > 220 ? out.slice(0, 217).trimEnd() + '…' : out;
}

// --- Toast -----------------------------------------------------------------------
let toastTimer;
export function toast(msg, ms = 4000) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// --- Start screen -------------------------------------------------------------------
export function renderStart({ regions, selected, onRegion, onChange }) {
  const el = panel();
  el.className = 'card panel start';
  el.innerHTML = `
    <header class="brand">
      <span class="logo" aria-hidden="true">🦉</span>
      <div>
        <h1>Kuvaretki</h1>
        <p class="tagline">Kuinka hyvin tunnet luonnon?</p>
      </div>
    </header>
    <p class="hint">Valitse maakunta kartalta ja tutustu sen lajistoon kymmenen kysymyksen retkellä.</p>
    <select class="region-select" aria-label="Maakunta">
      <option value="" ${selected ? '' : 'selected'} disabled>…tai valitse listasta</option>
      ${regions
        .map((r) => `<option value="${r.slug}" ${r.slug === selected ? 'selected' : ''}>${escapeHtml(r.name)}</option>`)
        .join('')}
    </select>
    <section id="region-info" hidden aria-live="polite"></section>`;
  $('.region-select', el).onchange = (e) => onRegion(e.target.value);
  el.onclick = (e) => {
    if (e.target.closest('[data-act=reselect]')) {
      // Phone only: bring the region list back after it was folded away.
      el.classList.remove('chosen');
      el.scrollTop = 0;
      onChange();
    }
  };
}

// Once a region is chosen the phone layout folds the list away, so the start button fits.
export function markRegion(slug) {
  const el = panel();
  el.classList.toggle('chosen', Boolean(slug));
  el.scrollTop = 0;
  const select = $('.region-select', el);
  if (select) select.value = slug ?? '';
}

const info = () => $('#region-info');

export function showRegionLoading(msg) {
  const el = info();
  if (!el) return;
  el.hidden = false;
  el.innerHTML = `<div class="loading"><span class="spinner" aria-hidden="true"></span><span>${escapeHtml(msg)}</span></div>`;
}

export function showRegionError(msg) {
  const el = info();
  if (!el) return;
  el.hidden = false;
  panel().classList.remove('chosen');
  el.innerHTML = `<p class="error">${escapeHtml(msg)}</p>`;
}

// "N lajia, M havaintoa" and the species per group (biggest six), from regions.json.
function statsHtml(stats) {
  if (!stats) return '';
  const counts = {};
  for (const [g, n] of Object.entries(stats.groups)) {
    const key = GROUPS[g] ? g : 'Other';
    counts[key] = (counts[key] ?? 0) + n;
  }
  const groups = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([g, n]) => {
      const gi = groupInfo(g);
      return `<span class="group" title="${gi.label}">${gi.emoji} ${fmt(n)}</span>`;
    })
    .join('');
  return `
    <p class="species-count"><strong>${fmt(stats.species)}</strong> lajia ·
      ${fmt(stats.observations)} havaintoa iNaturalistissa</p>
    <div class="groups" aria-label="Lajeja ryhmittäin">${groups}</div>`;
}

export function showRegionReady({ name, stats, best, onStart }) {
  const el = info();
  if (!el) return;
  el.hidden = false;
  el.innerHTML = `
    <h2 class="place-name">${escapeHtml(name)}</h2>
    ${statsHtml(stats)}
    ${best ? `<p class="best">🏆 Paras tuloksesi täällä: ${fmt(best)} / ${fmt(ROUND_LENGTH * 1000)}</p>` : ''}
    <button type="button" class="btn primary big" data-act="start">Aloita →</button>
    <button type="button" class="link-btn" data-act="reselect">Vaihda aluetta</button>`;
  $('[data-act=start]', el).onclick = onStart;
}

// --- Card + guess --------------------------------------------------------------------
let cardGen = 0;

// Medium photo, then the small one; onFail once neither loads (unless the card has moved on).
function loadPhoto(img, card, gen, onFail) {
  const urls = [card.photo, card.photoSmall].filter(Boolean);
  img.onload = () => img.classList.add('loaded');
  img.onerror = () => {
    if (gen !== cardGen) return;
    const next = urls.shift();
    if (next) img.src = next;
    else onFail();
  };
  img.src = urls.shift();
}

// Each photo lands at its own slight angle, like prints tossed on a table.
const TILTS = [-2.2, 1.6, -1, 2.4, -1.8, 1.2, -1.4, 2];
const tilt = (i) => TILTS[i % TILTS.length];

const topBar = (index, total, score) => `
  <div class="strip">
    <button type="button" class="icon-btn" data-act="quit" aria-label="Lopeta kierros">✕</button>
    <div class="film" role="img" aria-label="Laji ${index + 1}/${total}">
      ${Array.from({ length: total }, (_, i) => `<i class="${i < index ? 'done' : i === index ? 'now' : ''}"></i>`).join('')}
    </div>
    <span class="score">· <b>${fmt(score)}</b> p</span>
  </div>`;

// A fresh question panel: progress strip on top of `body`. `gen` tags this question's photo loads.
function openQuestion({ index, total, score, onQuit }, body) {
  const gen = ++cardGen;
  const el = panel();
  el.className = 'panel playing';
  el.innerHTML = `${topBar(index, total, score)}${body}`;
  el.scrollTop = 0;
  $('[data-act=quit]', el).onclick = onQuit;
  return { el, gen };
}

const toneFor = (points) => (points >= 500 ? 'ok' : points >= 200 ? 'mid' : 'bad');

const verdictHtml = ({ tone, points, feedback, isLast }) => `
  <div class="verdict ${tone}">
    ${points != null ? `<span class="pts">+${fmt(points)}</span>` : ''}
    <b>${escapeHtml(feedback)}</b>
  </div>
  <button type="button" class="btn primary big" data-act="next">${isLast ? 'Katso tulokset →' : 'Seuraava →'}</button>`;

// After an answer: update the score and wire up the verdict's next button.
function finishReveal(el, score, onNext) {
  $('.score b', el).textContent = fmt(score);
  const next = $('[data-act=next]', el);
  next.onclick = onNext;
  next.focus({ preventScroll: true });
}

// The species print and its note; `action` fills the bottom of the note.
function cardRow(card, index, regionName, action) {
  const gi = groupInfo(card.group);
  const summary = cleanSummary(card.summary, regionName);
  return `
    <div class="card-row">
      <figure class="polaroid" style="--tilt:${tilt(index)}deg">
        <div class="shot"><img alt="${escapeHtml(card.fi)}" /></div>
        <figcaption class="name${card.fi.length > 13 ? ' long' : ''}">${escapeHtml(card.fi)}</figcaption>
      </figure>
      <div class="note">
        <p class="sci">${gi.emoji} ${gi.label} · <i>${escapeHtml(card.sci)}</i></p>
        ${summary ? `<p class="summary">${escapeHtml(summary)}</p>` : ''}
        <p class="credit" tabindex="0">📷 ${escapeHtml(card.attribution)}</p>
        <div class="action">${action}</div>
      </div>
    </div>`;
}

export function renderCard({ card, regionName, onPhotoFail, ...progress }) {
  const { el, gen } = openQuestion(
    progress,
    cardRow(card, progress.index, regionName, '<p class="hint">Missä tämä on havaittu? Napauta karttaa.</p>')
  );
  loadPhoto($('.shot img', el), card, gen, onPhotoFail);
}

export function renderReveal({ points, feedback, score, isLast, onNext }) {
  const el = panel();
  $('.action', el).innerHTML = verdictHtml({ tone: toneFor(points), points, feedback, isLast });
  finishReveal(el, score, onNext);
}

// --- When is it seen? ------------------------------------------------------------------
const monthShort = (name) => name.replace(/kuu$/, '');

export function renderWhen({ card, regionName, firstWhen, onPick, onPhotoFail, ...progress }) {
  const { el, gen } = openQuestion(
    progress,
    cardRow(
      card,
      progress.index,
      regionName,
      `<p class="hint">${firstWhen ? '<span class="lead">Nyt ajan kanssa! </span>' : ''}Milloin tätä näkee täällä eniten?</p>
      <div class="months" role="group" aria-label="Kuukaudet">
        ${MONTHS_FI.map(
          (name, i) => `<button type="button" class="month" data-month="${i}" aria-label="${name}" style="--i:${i}"><i></i><span>${monthShort(name)}</span></button>`
        ).join('')}
      </div>
      <div class="when-result"></div>`
    )
  );
  // On a phone the month grid needs the room, so style.css hides the description there.
  el.classList.add('when');
  loadPhoto($('.shot img', el), card, gen, onPhotoFail);
  el.querySelectorAll('.month').forEach((b) => (b.onclick = () => onPick(Number(b.dataset.month))));
}

// The month buttons turn into the region's observations per month; the pick is outlined.
export function renderWhenReveal({ card, month, points, feedback, score, isLast, onNext }) {
  const el = panel();
  $('.hint', el).remove();
  const max = Math.max(...card.m);
  const { peak } = seasonality(card.m);
  const tone = toneFor(points);
  el.querySelectorAll('.month').forEach((b, i) => {
    b.disabled = true;
    b.style.setProperty('--h', String(card.m[i] / max));
    b.classList.toggle('peak', i === peak);
    if (i === month) b.classList.add('picked', tone);
    b.title = `${MONTHS_FI[i]}: ${fmt(card.m[i])} havaintoa`;
  });
  $('.months', el).classList.add('revealed');
  $('.when-result', el).outerHTML = verdictHtml({ tone, points, feedback, isLast });
  finishReveal(el, score, onNext);
}

// --- Which one lives here? -------------------------------------------------------------
export function renderChoice({ options, firstChoice, onPick, onPhotoFail, ...progress }) {
  const { index } = progress;
  const { el, gen } = openQuestion(
    progress,
    `
    <div class="note ask">
      <p class="hint">${firstChoice ? 'Nyt toisin päin! ' : ''}Mikä näistä on havaittu kartalle merkityllä paikalla?</p>
    </div>
    <div class="choices">
      ${options
        .map(
          (c, i) => `<button type="button" class="polaroid choice" data-pick="${i}" style="--tilt:${tilt(index + i)}deg">
            <span class="shot"><img alt="${escapeHtml(c.fi)}" /></span>
            <span class="name">${escapeHtml(c.fi)}</span>
          </button>`
        )
        .join('')}
    </div>
    <div class="note action" hidden></div>`
  );

  let failed = false;
  el.querySelectorAll('.choice').forEach((b, i) => {
    loadPhoto($('img', b), options[i], gen, () => {
      if (failed) return;
      failed = true;
      onPhotoFail();
    });
    b.onclick = () => onPick(i);
  });
}

// Only the picked print is marked, green or red; no points badge here.
export function renderChoiceReveal({ pickedIndex, correct, feedback, score, isLast, onNext }) {
  const el = panel();
  el.querySelectorAll('.choice').forEach((b, i) => {
    b.disabled = true;
    b.classList.toggle(correct ? 'correct' : 'wrong', i === pickedIndex);
  });
  const action = $('.action', el);
  action.hidden = false;
  action.innerHTML = verdictHtml({ tone: correct ? 'ok' : 'bad', feedback, isLast });
  finishReveal(el, score, onNext);
}

// --- Results --------------------------------------------------------------------------
export function renderResults({ regionName, results, total, max, title, isNewBest, onAgain, onChange }) {
  cardGen++;
  const el = panel();
  el.className = 'card panel results';
  el.innerHTML = `
    <div class="result-hero">
      <p class="eyebrow">${escapeHtml(regionName)}</p>
      <div class="total">${fmt(total)} <small>/ ${fmt(max)}</small></div>
      <h2>${escapeHtml(title)}</h2>
      ${isNewBest ? '<p class="new-best">🏆 Uusi ennätys!</p>' : ''}
    </div>
    <ol class="result-list">
      ${results
        .map(
          ({ card, points, spot, correct, month }, i) => `<li style="--tape-c:${COLORS[i % COLORS.length]};--tilt:${tilt(i)}deg">
            <img src="${escapeHtml(card.photoSmall || card.photo)}" alt="" loading="lazy" />
            <span class="names" title="${escapeHtml(card.fi)}">${escapeHtml(card.fi)}</span>
            <span class="pts">${spot ? (correct ? '✓ ' : '✗ ') : month != null ? `📅 ${monthShort(MONTHS_FI[month])} ` : ''}+${fmt(points)}</span>
            <span class="links">
              <a href="https://www.inaturalist.org/taxa/${card.id}" target="_blank" rel="noopener">iNat</a>
              ${card.wiki?.includes('//fi.') ? `· <a href="${escapeHtml(card.wiki)}" target="_blank" rel="noopener">Wiki</a>` : ''}
            </span>
          </li>`
        )
        .join('')}
    </ol>
    <div class="row">
      <button type="button" class="btn primary big" data-act="again">Uusi kierros</button>
      <button type="button" class="btn secondary big" data-act="change">Vaihda aluetta</button>
    </div>`;
  el.scrollTop = 0;
  $('[data-act=again]', el).onclick = onAgain;
  $('[data-act=change]', el).onclick = onChange;
}

export function confetti() {
  const box = document.createElement('div');
  box.className = 'confetti';
  box.setAttribute('aria-hidden', 'true');
  const bits = ['🍃', '🌸', '🦋', '🍂', '✨', '🌼'];
  for (let i = 0; i < 70; i++) {
    const s = document.createElement('span');
    s.textContent = bits[i % bits.length];
    s.style.left = `${Math.random() * 100}%`;
    s.style.animationDelay = `${Math.random() * 0.8}s`;
    s.style.animationDuration = `${2.2 + Math.random() * 1.8}s`;
    s.style.setProperty('--drift', `${(Math.random() - 0.5) * 160}px`);
    s.style.fontSize = `${16 + Math.random() * 18}px`;
    box.appendChild(s);
  }
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 5000);
}
