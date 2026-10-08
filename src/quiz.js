// Pure quiz logic: no DOM.

// Groups whose members make plausible wrong answers for each other.
const RELATED = {
  Insecta: ['Arachnida', 'Mollusca', 'Animalia'],
  Arachnida: ['Insecta', 'Animalia'],
  Mollusca: ['Insecta', 'Animalia'],
  Aves: ['Mammalia', 'Reptilia', 'Amphibia'],
  Mammalia: ['Aves', 'Reptilia', 'Amphibia'],
  Amphibia: ['Reptilia', 'Actinopterygii', 'Mammalia'],
  Reptilia: ['Amphibia', 'Mammalia'],
  Actinopterygii: ['Amphibia', 'Mollusca'],
  Plantae: ['Fungi', 'Chromista'],
  Fungi: ['Plantae', 'Protozoa'],
};

export function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function weightedPick(items, weight) {
  const weights = items.map(weight);
  let r = Math.random() * weights.reduce((sum, w) => sum + w, 0);
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

// Species with a Finnish name make for a much nicer question.
const nameWeight = (s) => (s.hasFi ? 1 : 0.15);

// Mostly common "neighbours", weighted by observation count, plus 1–2 rarer surprises.
export function buildRound(pool, n = 10) {
  const sorted = [...pool].sort((a, b) => b.count - a.count);
  n = Math.min(n, sorted.length);
  const rare = sorted.slice(Math.ceil(sorted.length / 2));
  const picked = [];
  // Each species already picked from a group makes that group less likely, so one
  // enthusiastic moth recorder doesn't turn the round into ten moths.
  const diversity = (s) => 0.35 ** picked.filter((p) => p.group === s.group).length;
  const take = (list, k, weight) => {
    let avail = list.filter((s) => !picked.includes(s));
    for (; k > 0 && avail.length; k--) {
      const s = weightedPick(avail, (x) => weight(x) * diversity(x));
      picked.push(s);
      avail = avail.filter((x) => x !== s);
    }
  };
  take(rare, n >= 6 ? 1 + Math.round(Math.random()) : 0, nameWeight);
  take(sorted, n - picked.length, (s) => Math.pow(s.count, 0.8) * nameWeight(s));
  return shuffle(picked);
}

// The target plus three wrong answers: same group first, then related groups, then anything.
export function makeOptions(target, pool, wrongCount = 3) {
  const usedNames = new Set([target.fi.toLowerCase()]);
  const wrong = [];
  const tiers = [
    (s) => s.group === target.group,
    (s) => (RELATED[target.group] ?? []).includes(s.group),
    () => true,
  ];
  for (const inTier of tiers) {
    const candidates = shuffle(pool.filter((s) => s.id !== target.id && inTier(s))).sort(
      (a, b) => b.hasFi - a.hasFi
    );
    for (const s of candidates) {
      if (wrong.length >= wrongCount) break;
      if (usedNames.has(s.fi.toLowerCase())) continue;
      usedNames.add(s.fi.toLowerCase());
      wrong.push(s);
    }
    if (wrong.length >= wrongCount) break;
  }
  return shuffle([target, ...wrong]);
}

export const STREAK_FOR_DOUBLE = 3;

// Mutates round { score, streak, correct } and returns the points earned.
export function scoreAnswer(round, correct, elapsedMs) {
  if (!correct) {
    round.streak = 0;
    return 0;
  }
  round.streak++;
  round.correct++;
  const speedBonus = Math.round(50 * Math.max(0, 1 - elapsedMs / 10000));
  const points = (100 + speedBonus) * (round.streak >= STREAK_FOR_DOUBLE ? 2 : 1);
  round.score += points;
  return points;
}

export function titleFor(correct, total) {
  const ratio = total ? correct / total : 0;
  if (ratio === 1) return 'Retkikunnan johtaja';
  if (ratio >= 0.7) return 'Lähimetsän asiantuntija';
  if (ratio >= 0.4) return 'Pihapiirin tuntija';
  return 'Utelias tutkimusmatkailija';
}

const bestKey = (placeKey) => `best:${placeKey}`;

export function loadBest(placeKey) {
  try {
    return Number(localStorage.getItem(bestKey(placeKey))) || 0;
  } catch {
    return 0;
  }
}

export function saveBest(placeKey, score) {
  const previous = loadBest(placeKey);
  if (score <= previous) return { best: previous, isNew: false };
  try {
    localStorage.setItem(bestKey(placeKey), String(score));
  } catch {}
  return { best: score, isNew: previous > 0 || score > 0 };
}
