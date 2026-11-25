// v54: three-way merge of a device's save with the account's cloud save.
// "base" is what the cloud held the last time this device synced. Local changes since then (local - base) are laid on top of the newest
// cloud state, so a card spent in a trade on one device and a pack opened on another both survive. The old merge took the larger count of
// each card, which brought traded-away cards back and threw away anything one device had that the other did not.
(function (root) {
  'use strict';
  const num = (v) => Math.max(0, Math.round(+v || 0));
  // What the cloud holds for a save: only cards the site knows (the cloud copy never lists the others), plus the counters that are merged by difference.
  function makeBase(s, known) {
    const c = {};
    Object.keys(s.cards || {}).forEach((id) => { const e = s.cards[id]; if (e && e.n > 0 && (!known || known(id))) c[id] = [num(e.n), num(e.h)]; });
    return { c: c, b: num(s.bonus), o: num(s.stats && s.stats.opened), p: num(s.stats && s.stats.pulls), out: Object.keys((s.net && s.net.out) || {}) };
  }
  // local, cloud: { id: {n,h,f,t,l,p} }. base: makeBase() result or null (an old save with no base falls back to the larger count).
  function mergeCards(local, cloud, base) {
    const out = {}, ids = {}; Object.keys(local || {}).forEach((i) => { ids[i] = 1; }); Object.keys(cloud || {}).forEach((i) => { ids[i] = 1; });
    Object.keys(ids).forEach((id) => {
      const L = (local && local[id]) || { n: 0, h: 0 }, C = (cloud && cloud[id]) || { n: 0, h: 0 }; let n, h;
      if (base) { const B = base.c[id] || [0, 0]; n = C.n + (L.n - B[0]); h = (C.h || 0) + ((L.h || 0) - B[1]); }
      else { n = Math.max(L.n, C.n); h = Math.max(L.h || 0, C.h || 0); }
      n = num(n); h = Math.min(n, num(h)); if (n <= 0) return;
      const a = L.n > 0 ? L : {}, b = C.n > 0 ? C : {}, tt = [a.t, b.t].filter(Boolean);
      out[id] = { n: n, h: h, f: a.f || b.f ? 1 : 0, t: tt.length ? Math.min.apply(null, tt) : 0, l: Math.max(a.l || 0, b.l || 0), p: Math.max(a.p || 0, b.p || 0) };
    });
    return out;
  }
  // Trade bookkeeping: sent offers (out), settled ids (done), writes still to send (q), and the two history lists.
  function mergeNet(L, C, base) {
    L = L || {}; C = C || {}; const lo = L.out || {}, co = C.out || {}, bo = {}; ((base && base.out) || []).forEach((k) => { bo[k] = 1; });
    const done = Object.assign({}, C.done || {}, L.done || {}), out = {};
    Object.keys(Object.assign({}, co, lo)).forEach((k) => {
      if (done[k]) return; const inL = k in lo, inC = k in co;
      if (inL && inC) out[k] = lo[k]; else if (!bo[k]) out[k] = inL ? lo[k] : co[k]; // only on one side: new there, unless the other side settled it
    });
    const seen = {}, q = (L.q || []).concat(C.q || []).filter((x) => { const k = JSON.stringify(x); if (seen[k]) return false; seen[k] = 1; return true; }).slice(0, 50);
    const uni = (a, b, key, cap) => { const m = {}; (a || []).concat(b || []).forEach((x) => { if (x) m[key(x)] = x; }); return Object.keys(m).map((k) => m[k]).sort((x, y) => (y.at || 0) - (x.at || 0)).slice(0, cap); };
    const miss = {}; Object.keys(Object.assign({}, C.miss || {}, L.miss || {})).forEach((k) => { if (out[k]) miss[k] = (L.miss || {})[k] || (C.miss || {})[k] || 0; });
    return { out: out, done: done, q: q, miss: miss, hist: uni(L.hist, C.hist, (x) => x.at + '|' + x.text, 30), log: uni(L.log, C.log, (x) => [x.at, x.dir, x.who, x.a, x.b, x.st].join('|'), 20) };
  }
  const M = { makeBase: makeBase, cards: mergeCards, net: mergeNet };
  if (typeof module !== 'undefined' && module.exports) module.exports = M; else root.SSGMerge = M;
})(typeof window !== 'undefined' ? window : this);
