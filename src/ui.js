import L from 'leaflet';

const $ = (sel, root = document) => root.querySelector(sel);

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

const GROUPS = {
  Plantae: { emoji: '🌿', label: 'kasvi', question: 'Mikä kasvi tämä on?' },
  Aves: { emoji: '🐦', label: 'lintu', question: 'Mikä lintu tämä on?' },
  Insecta: { emoji: '🦋', label: 'hyönteinen', question: 'Mikä hyönteinen tämä on?' },
  Fungi: { emoji: '🍄', label: 'sieni', question: 'Mikä sieni tämä on?' },
  Mammalia: { emoji: '🦊', label: 'nisäkäs', question: 'Mikä nisäkäs tämä on?' },
  Arachnida: { emoji: '🕷️', label: 'hämähäkkieläin', question: 'Mikä hämähäkkieläin tämä on?' },
  Mollusca: { emoji: '🐌', label: 'nilviäinen', question: 'Mikä nilviäinen tämä on?' },
  Amphibia: { emoji: '🐸', label: 'sammakkoeläin', question: 'Mikä sammakkoeläin tämä on?' },
  Reptilia: { emoji: '🦎', label: 'matelija', question: 'Mikä matelija tämä on?' },
  Actinopterygii: { emoji: '🐟', label: 'kala', question: 'Mikä kala tämä on?' },
};
const OTHER_GROUP = { emoji: '🔬', label: 'muu eliö', question: 'Kuka naapurisi tämä on?' };
export const groupInfo = (g) => GROUPS[g] ?? OTHER_GROUP;

const largePhoto = (url) => url.replace('/medium.', '/large.');

// Wikipedia summary contains HTML; keep the first 1–2 sentences as plain text.
function cleanSummary(html) {
  if (!html) return '';
  const text = new DOMParser().parseFromString(html, 'text/html').body.textContent.trim();
  const sentences = text.split(/(?<=[.!?])\s+(?=[A-ZÅÄÖ])/);
  let out = sentences[0] ?? '';
  if (out.length < 140 && sentences[1]) out += ' ' + sentences[1];
  return out.length > 320 ? out.slice(0, 317).trimEnd() + '…' : out;
}

const formatDate = (iso) => {
  const d = new Date(iso);
  return isNaN(d) ? iso : d.toLocaleDateString('fi-FI', { day: 'numeric', month: 'numeric', year: 'numeric' });
};

// --- Toast -----------------------------------------------------------------------
let toastTimer;
export function toast(msg, ms = 4000) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// --- Start panel --------------------------------------------------------------------
const info = () => $('#place-info');

export function renderQuickPlaces(places, onPick) {
  const box = $('#quick-places');
  box.innerHTML = places
    .map((p, i) => `<button type="button" class="chip" data-i="${i}">${escapeHtml(p.name)}</button>`)
    .join('');
  box.onclick = (e) => {
    const b = e.target.closest('[data-i]');
    if (b) onPick(places[Number(b.dataset.i)]);
  };
}

export function showPlaceLoading(msg) {
  info().hidden = false;
  info().innerHTML = `<div class="loading"><span class="spinner" aria-hidden="true"></span><span>${escapeHtml(msg)}</span></div>`;
}

export function showPlaceError(msg) {
  info().hidden = false;
  info().innerHTML = `<p class="error">${escapeHtml(msg)}</p>`;
}

export function showPlaceReady({ name, pool, best, onStart }) {
  const counts = {};
  for (const s of pool.species) counts[s.group] = (counts[s.group] ?? 0) + 1;
  const groups = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([g, n]) => {
      const gi = groupInfo(g);
      return `<span class="group" title="${gi.label}">${gi.emoji} ${n}</span>`;
    })
    .join('');
  info().hidden = false;
  info().innerHTML = `
    <h2 class="place-name">${escapeHtml(name)}</h2>
    <p class="species-count"><strong>${pool.total.toLocaleString('fi-FI')}</strong>
      lajia havaittu ${pool.radiusKm} km säteellä</p>
    <div class="groups" aria-label="Yleisimpien lajien ryhmät">${groups}</div>
    ${best ? `<p class="best">🏆 Paras tuloksesi täällä: ${best.toLocaleString('fi-FI')} p</p>` : ''}
    <button type="button" class="btn primary big" id="start-btn">Aloita visa →</button>`;
  $('#start-btn').onclick = onStart;
}

// --- Quiz -----------------------------------------------------------------------------
const quizEl = () => $('#quiz');
const sheet = () => $('#quiz-sheet');
let renderGen = 0;
let miniMap = null;

function destroyMiniMap() {
  miniMap?.remove();
  miniMap = null;
}

export function openQuiz() {
  quizEl().hidden = false;
  requestAnimationFrame(() => quizEl().classList.add('open'));
}

export function closeQuiz() {
  renderGen++;
  destroyMiniMap();
  quizEl().classList.remove('open');
  quizEl().hidden = true;
}

export function renderQuestion({
  target, options, index, total, score, streak,
  getMorePhotos, onPhotoLoad, onPhotoFail, onAnswer, onQuit,
}) {
  const gen = ++renderGen;
  destroyMiniMap();
  const gi = groupInfo(target.group);
  const el = sheet();
  el.innerHTML = `
    <div class="quiz-top">
      <button type="button" class="icon-btn" data-act="quit" aria-label="Lopeta visa">✕</button>
      <div class="progress" aria-hidden="true"><div class="bar" style="width:${(index / total) * 100}%"></div></div>
      <span class="qnum">${index + 1}/${total}</span>
    </div>
    <div class="stats">
      <span class="score">⭐ <b>${score}</b></span>
      <span class="streak ${streak >= 2 ? 'hot' : ''}">🔥 ${streak}</span>
    </div>
    <figure class="photo">
      <div class="frame"><img alt="Tunnistettava ${gi.label}" /><span class="group-tag">${gi.emoji} ${gi.label}</span></div>
      <figcaption></figcaption>
    </figure>
    <h2 class="prompt">${gi.question}</h2>
    <div class="options">
      ${options
        .map(
          (o, i) => `<button type="button" class="option" data-i="${i}">
            <span class="key">${i + 1}</span>
            <span class="names"><span class="fi">${escapeHtml(o.fi)}</span>${
              o.hasFi ? `<span class="sci">${escapeHtml(o.sci)}</span>` : ''
            }</span></button>`
        )
        .join('')}
    </div>
    <div class="feedback" hidden></div>`;
  el.scrollTop = 0;

  // Photo: large default → medium default → other photos of the species → skip question.
  const img = $('.photo img', el);
  const caption = $('.photo figcaption', el);
  let queue = [
    { url: largePhoto(target.photo), attribution: target.attribution },
    { url: target.photo, attribution: target.attribution },
  ];
  let triedMore = false;
  const tryNext = async () => {
    if (!queue.length && !triedMore) {
      triedMore = true;
      queue = (await getMorePhotos()).filter((p) => p.url !== target.photo);
      if (gen !== renderGen) return;
    }
    const next = queue.shift();
    if (!next) return onPhotoFail();
    img.src = next.url;
    caption.textContent = next.attribution;
  };
  img.onload = () => {
    img.classList.add('loaded');
    onPhotoLoad();
  };
  img.onerror = () => tryNext();
  tryNext();

  $('.options', el).onclick = (e) => {
    const b = e.target.closest('[data-i]');
    if (b) onAnswer(Number(b.dataset.i));
  };
  $('[data-act=quit]', el).onclick = onQuit;
}

export function showAnswer({ chosenIdx, correctIdx, score, streak }) {
  const el = sheet();
  el.querySelectorAll('.option').forEach((b, i) => {
    b.disabled = true;
    if (i === correctIdx) b.classList.add('correct');
    else if (i === chosenIdx) b.classList.add('wrong');
    else b.classList.add('dim');
  });
  $('.score b', el).textContent = score;
  const st = $('.streak', el);
  st.textContent = `🔥 ${streak}`;
  st.classList.toggle('hot', streak >= 2);
  st.classList.add('bump');
}

export function showFeedback({ target, correct, points, doubled, isLast, place, details, sighting, onNext }) {
  const gen = renderGen;
  const el = sheet();
  const fb = $('.feedback', el);
  const times = target.count === 1 ? 'kerran' : `${target.count} kertaa`;
  fb.hidden = false;
  fb.innerHTML = `
    <div class="verdict ${correct ? 'ok' : 'bad'}">
      ${
        correct
          ? `✅ Oikein! <b>+${points}</b>${doubled ? ' <span class="double">🔥 tuplapisteet</span>' : ''}`
          : `❌ Ei aivan – oikea vastaus on <b>${escapeHtml(target.fi)}</b>`
      }
    </div>
    <article class="species-card">
      <h3>${escapeHtml(target.fi)} ${target.hasFi ? `<i>${escapeHtml(target.sci)}</i>` : ''}</h3>
      <p class="summary"><span class="shimmer"></span><span class="shimmer short"></span></p>
      <p class="meta">👀 Havaittu tällä alueella ${times}</p>
      <p class="meta sighting" hidden></p>
      <div class="mini-map" hidden></div>
      <a class="wiki" target="_blank" rel="noopener" hidden>Lue lisää Wikipediasta ↗</a>
    </article>
    <button type="button" class="btn primary big next" data-act="next">${isLast ? 'Katso tulokset →' : 'Seuraava →'}</button>`;

  const nextBtn = $('[data-act=next]', fb);
  nextBtn.onclick = onNext;
  nextBtn.focus({ preventScroll: true });
  requestAnimationFrame(() => fb.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));

  details.then((map) => {
    if (gen !== renderGen) return;
    const d = map.get(target.id);
    $('.summary', fb).textContent =
      cleanSummary(d?.summary) || 'Tästä lajista ei löytynyt suomenkielistä kuvausta.';
    const wiki = d?.wiki || target.wiki;
    if (wiki) Object.assign($('.wiki', fb), { href: wiki, hidden: false });
  });

  sighting.then((s) => {
    if (gen !== renderGen || !s) return;
    const line = $('.sighting', fb);
    line.textContent = `📍 Viimeksi nähty ${formatDate(s.date)}${s.place ? ` · ${s.place}` : ''}`;
    line.hidden = false;
    const box = $('.mini-map', fb);
    box.hidden = false;
    destroyMiniMap();
    miniMap = L.map(box, {
      zoomControl: false, attributionControl: false, dragging: false, scrollWheelZoom: false,
      doubleClickZoom: false, boxZoom: false, keyboard: false, touchZoom: false,
    });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(miniMap);
    L.control.attribution({ prefix: false }).addAttribution('&copy; OpenStreetMap').addTo(miniMap);
    L.circle([place.lat, place.lng], { radius: place.radiusKm * 1000, className: 'radius' }).addTo(miniMap);
    L.marker([s.lat, s.lng], {
      icon: L.divIcon({ className: 'sighting', html: '<span>👀</span>', iconSize: [34, 34] }),
    }).addTo(miniMap);
    miniMap.setView([s.lat, s.lng], 14);
  });
}

// --- Results --------------------------------------------------------------------------
const resultsEl = () => $('#results');

export function closeResults() {
  resultsEl().hidden = true;
}

export function showResults({ correct, total, score, title, placeName, isNewBest, answers, onAgain, onChange }) {
  const el = $('#results-sheet');
  el.innerHTML = `
    <div class="result-hero">
      <div class="ring" style="--p:${total ? correct / total : 0}"><span>${correct}/${total}</span></div>
      <p class="eyebrow">Arvonimesi</p>
      <h2>${escapeHtml(title)}</h2>
      <p>Tunnistit <b>${correct}/${total}</b> lajia alueelta <b>${escapeHtml(placeName)}</b>.</p>
      <p class="points">⭐ ${score.toLocaleString('fi-FI')} pistettä${isNewBest ? ' · <span class="new-best">🏆 Uusi ennätys!</span>' : ''}</p>
    </div>
    <h3 class="gallery-title">Kierroksen naapurit</h3>
    <div class="gallery">
      ${answers
        .map(
          (a) => `<figure class="${a.correct ? 'ok' : 'bad'}">
            <img src="${escapeHtml(a.species.photo)}" alt="" loading="lazy" />
            <figcaption><span>${a.correct ? '✅' : '❌'}</span> ${escapeHtml(a.species.fi)}</figcaption>
          </figure>`
        )
        .join('')}
    </div>
    <div class="row">
      <button type="button" class="btn primary big" data-act="again">Uusi kierros täällä</button>
      <button type="button" class="btn secondary big" data-act="change">Vaihda paikkaa</button>
    </div>`;
  $('[data-act=again]', el).onclick = onAgain;
  $('[data-act=change]', el).onclick = onChange;
  resultsEl().hidden = false;
  el.scrollTop = 0;
  $('[data-act=again]', el).focus({ preventScroll: true });
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
