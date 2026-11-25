// Special Strike Gacha: a client-only card game. Saves to localStorage; no server, no external data.
(function () {
  'use strict';
  const G = window.SSG, TIERS = G.TIERS, CARDS = G.CARDS, BYID = G.BYID, DIFFS = G.DIFFS, CATS = G.CATS;
  const SFX = (window.SFX && window.SFX.sfx) || new Proxy({}, { get: () => () => {} });
  const unlockAudio = (window.SFX && window.SFX.unlockAudio) || function () {};
  const configureAudio = (window.SFX && window.SFX.configureAudio) || function () {};

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const tcls = (t) => 't-' + String((G.TIER_KEY && G.TIER_KEY[t]) || t).toLowerCase().replace(/[^a-z0-9]+/g, '-'); // renamed built-in rarities keep their original look
  const reduceMotion = () => S.settings.motion === false || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const fmt = (n) => Math.round(n).toLocaleString('en-US');
  const pick = (a) => a[Math.floor(Math.random() * a.length)];

  // ---------- save ----------
  const KEY = 'ss-gacha-save-v1';
  let memorySave = null; // used if localStorage is blocked
  function fresh() {
    return { v: 1, mod: 0, syncMod: 0, granted: {}, started: false, diff: 'sigma', packs: DIFFS.sigma.start, bonus: 0, last: Date.now(), sinceRare: 0, cards: {}, wish: {}, wk: null, showcase: [], resetAt: Date.now(),
      stats: { opened: 0, pulls: 0 }, settings: { sound: true, volume: 0.6, motion: true, monster: false, share: true },
      // The "fake account": lives in the save file. id is random and only there so a leaderboard can tell players apart later.
      profile: { id: uid(), name: 'Player', bio: '', pfp: null, banner: null, hue: 28, joined: Date.now() }, codes: [], account: null,
      // trading + online bookkeeping: out = offers I sent (cards held in escrow), done = settled trade ids, q = updates still to send, hist = recent trade log
      net: { out: {}, done: {}, q: [], hist: [], miss: {}, log: [] },
      // notifications + friends/comments bookkeeping: notes = the notification list, nseen = ids already announced, seen = messages/comments already read, badges = badge names last seen
      social: { notes: [], nseen: {}, seen: {}, badges: null } };
  }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
  const okImg = (v) => (typeof v === 'string' && /^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(v) && v.length < 400000 ? v : null);
  // Turns any parsed save (old or new) into a complete, safe one.
  function normalize(j) {
    const f = fresh(), jp = (j && j.profile) || {};
    const s = Object.assign(f, j, { diff: 'sigma', stats: Object.assign(f.stats, j.stats), settings: Object.assign(f.settings, j.settings) });
    const times = Object.values(s.cards || {}).map((e) => e && e.t).filter(Boolean);
    s.profile = { id: String(jp.id || f.profile.id).slice(0, 40), name: String(jp.name || 'Player').slice(0, 20), bio: String(jp.bio == null ? '' : jp.bio).replace(/[\r\n\t]+/g, ' ').trim().slice(0, 120), pfp: okImg(jp.pfp), banner: okImg(jp.banner),
      hue: Number.isFinite(+jp.hue) ? ((+jp.hue % 360) + 360) % 360 : 28, joined: +jp.joined || (times.length ? Math.min.apply(null, times) : Date.now()) };
    s.granted = isObj(j.granted) ? j.granted : {};
    s.bonus = Math.max(0, Math.floor(+j.bonus) || 0); s.mod = +j.mod || 0; s.syncMod = +j.syncMod || 0; s.settings.share = true; // sharing is always on now: the account save depends on it
    s.wish = {}; if (isObj(j.wish)) Object.keys(j.wish).slice(0, 400).forEach((id) => { if (j.wish[id]) s.wish[id] = 1; });
    s.showcase = Array.isArray(j.showcase) ? j.showcase.filter((x) => typeof x === 'string' && /\|[01]$/.test(x)).slice(0, 5) : [];
    s.wk = isObj(j.wk) && +j.wk.t > 0 ? { t: +j.wk.t, s: Math.max(0, +j.wk.s || 0), v: +j.wk.v || 1 } : null; s.resetAt = +j.resetAt || 0;
    s.codes = Array.isArray(j.codes) ? j.codes.map(String) : [];
    s.account = typeof j.account === 'string' && j.account ? j.account.slice(0, 20) : null;
    const jn = (j && j.net) || {};
    s.net = { out: isObj(jn.out) ? jn.out : {}, done: isObj(jn.done) ? jn.done : {}, q: Array.isArray(jn.q) ? jn.q.slice(0, 50) : [], hist: Array.isArray(jn.hist) ? jn.hist.slice(0, 30) : [], miss: isObj(jn.miss) ? jn.miss : {},
      // recent settled trades, shown on the home page: dir from/to, who, a = cards I gave, b = cards I got, st = outcome
      log: Array.isArray(jn.log) ? jn.log.filter(isObj).slice(0, 20).map((x) => ({ at: +x.at || 0, dir: x.dir === 'to' ? 'to' : 'from', who: String(x.who || '').slice(0, 20), a: Math.max(0, +x.a | 0), b: Math.max(0, +x.b | 0), st: ['accepted', 'denied', 'cancelled', 'invalid'].indexOf(x.st) >= 0 ? x.st : 'invalid' })) : [] };
    const sj = isObj(j.social) ? j.social : {};
    s.social = { notes: Array.isArray(sj.notes) ? sj.notes.filter((x) => isObj(x) && typeof x.id === 'string').slice(0, 60).map((x) => ({ id: x.id.slice(0, 80), at: +x.at || 0, type: String(x.type || 'info').slice(0, 12), text: String(x.text || '').slice(0, 200), href: String(x.href || '').slice(0, 80), read: x.read ? Math.max(1, +x.read || 1) : 0 })) : [],
      nseen: isObj(sj.nseen) ? sj.nseen : {}, seen: isObj(sj.seen) ? sj.seen : {}, badges: Array.isArray(sj.badges) ? sj.badges.map(String).slice(0, 80) : null };
    return s;
  }
  function load() {
    let raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { raw = memorySave; }
    if (raw) { try { return normalize(JSON.parse(raw)); } catch (e) { /* fall through */ } }
    return fresh();
  }
  let S = load();
  // passive = a save that is not a player change (pack timer ticks). Real changes stamp S.mod, which is how the online sync tells which copy is newer,
  // and ask the online layer to upload soon so nothing waits for the next 60 second cycle.
  function save(passive) {
    if (passive !== true) { S.mod = Math.max(Date.now(), (S.mod || 0) + 1); if (net && auth && auth.loggedIn()) net.touch(); }
    const j = JSON.stringify(S); try { localStorage.setItem(KEY, j); } catch (e) { memorySave = j; }
  }
  // Another tab of this browser wrote the save: take it over, so a tab that has been sitting idle never saves its old copy over the newer one.
  addEventListener('storage', (e) => {
    if (e.key !== KEY || !e.newValue || e.storageArea !== localStorage) return;
    if (opening) { stalePending = true; return; }
    try { S = normalize(JSON.parse(e.newValue)); renderHeader(); route(true); } catch (er) { /* ignore */ }
  });
  let stalePending = false;
  const D = () => DIFFS.sigma;
  const CARDS_PER_PACK = 5;
  // Packs you can open = packs earned by waiting (S.packs, capped) + bonus packs from codes and gifts (S.bonus, no cap, never expire).
  const avail = () => S.packs + (S.bonus || 0);
  const bonusPill = () => (S.bonus > 0 ? `<span class="bonus-pill" title="From codes and gifts. These don't count toward your pack limit.">+${S.bonus} bonus</span>` : '');

  // ---------- packs ----------
  function tick() {
    const d = D(), now = Date.now(), iv = d.interval * 60000;
    if (S.packs >= d.cap) { S.last = now; return; }
    const n = Math.floor((now - S.last) / iv);
    if (n > 0) { S.packs += Math.min(n, d.cap - S.packs); S.last += n * iv; if (S.packs >= d.cap) S.last = now; save(true); }
  }
  // Every card that can drop for this player (monster cards only while the monster is let in) and its drop weight.
  // A card's weight = its rarity's weight shared out between the cards of that rarity, times the admin's per-card multiplier and any running power hour.
  function dropList() { const l = []; G.POOL.forEach((p) => p.forEach((c) => l.push(c))); if (S.settings.monster) G.MONSTER_POOL.forEach((c) => l.push(c)); return l; }
  function dropWeights(d, force, list, events) {
    const cnt = {}; list.forEach((c) => { cnt[c.ti] = (cnt[c.ti] || 0) + 1; });
    return list.map((c) => (force && c.fx < 2 ? 0 : G.BASE_WEIGHTS[c.ti] * (c.fx >= 2 ? d.luck : 1) / cnt[c.ti] * c.wm * (events === false ? 1 : G.eventMult(c, 'weight'))));
  }
  function pickIdx(w) { let t = w.reduce((a, b) => a + b, 0), r = Math.random() * t; for (let i = 0; i < w.length; i++) { r -= w[i]; if (r < 0) return i; } return w.length - 1; }
  function rollCard(d, force) { const l = dropList(); if (!l.length) return G.CARDS[0]; return l[pickIdx(dropWeights(d, force, l))]; }
  // Chance that a pulled copy of this card is a skibidi one.
  const holoP = (c, events) => Math.min(1, (c.holoOv != null ? c.holoOv : D().holo) * (events === false ? 1 : G.eventMult(c, 'holo')));
  function rollPack() {
    const d = D(), out = [];
    for (let i = 0; i < CARDS_PER_PACK; i++) {
      const c = rollCard(d, false); out.push({ card: c, holo: Math.random() < holoP(c), monsterDrop: !!c.monster });
    }
    if (out.some((o) => o.card.fx >= 2)) S.sinceRare = 0;
    else { S.sinceRare++; if (d.pity && S.sinceRare >= d.pity) { const pc = rollCard(d, true); out[out.length - 1] = { card: pc, holo: Math.random() < holoP(pc), pity: true }; S.sinceRare = 0; } }
    // The monster never eats its own cards.
    if (S.settings.monster && Math.random() < 0.25) { const ok = out.filter((o) => !o.card.monster); if (ok.length) pick(ok).eaten = true; }
    out.forEach((o) => {
      if (o.eaten) return;
      const e = S.cards[o.card.id];
      o.isNew = !e ? 'card' : (o.holo && !e.h ? 'holo' : '');
      if (!e) S.cards[o.card.id] = { n: 1, h: o.holo ? 1 : 0, t: Date.now(), l: Date.now(), p: Date.now(), f: 0 }; // p = last time it came out of a PACK (trades and gifts only set l); the Community rare pulls feed reads p
      else { e.n++; e.l = Date.now(); e.p = Date.now(); if (o.holo) e.h++; }
    });
    S.stats.opened++; S.stats.pulls += out.filter((o) => !o.eaten).length;
    return out;
  }
  const owned = () => Object.keys(S.cards).filter((id) => BYID[id] && S.cards[id].n > 0);
  // Moving single copies of cards in and out of the collection (used by trading). h = 1 means a skibidi copy.
  function hasCopy(id, h) { const e = S.cards[id]; return !!(BYID[id] && e && (h ? e.h > 0 : e.n - e.h > 0)); }
  function takeCopy(id, h) { if (!hasCopy(id, h)) return false; const e = S.cards[id]; e.n--; if (h) e.h--; if (e.n <= 0) delete S.cards[id]; return true; }
  function addCopy(id, h) { if (!BYID[id]) return; const now = Date.now(), e = S.cards[id]; if (!e) S.cards[id] = { n: 1, h: h ? 1 : 0, t: now, l: now, f: 0 }; else { e.n++; if (h) e.h++; e.l = now; } }
  // Collection score: points of every copy you own. Skibidi copies are worth extra (see G.GS.holoMult).
  const score = () => G.scoreOf(S.cards);
  const lastSeen = (e) => e.l || e.t;

  // ---------- card art (all procedural, no image files) ----------
  function art(c) {
    const img = c.img ? `<img class="art-img" src="${c.img}" alt="" draggable="false" onerror="this.remove()">` : '';
    const r = G.rng(G.hash(c.id)), hue = CATS[c.cat].hue, skin = (hue + Math.floor(r() * 50) - 25 + 360) % 360;
    const sat = 26 + Math.floor(r() * 30), lig = 44 + Math.floor(r() * 20), glow = `hsl(${hue},95%,62%)`;
    const head = Math.floor(r() * 4), ears = Math.floor(r() * 4), eyes = Math.floor(r() * 5), mouth = Math.floor(r() * 4);
    let s = `<svg viewBox="0 0 100 70" preserveAspectRatio="xMidYMid slice" aria-hidden="true">`;
    s += `<defs><linearGradient id="g${c.rank}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${hue},55%,22%)"/><stop offset="1" stop-color="hsl(${(hue + 30) % 360},60%,7%)"/></linearGradient><linearGradient id="h${c.rank}" x1="0" y1="0" x2="0.3" y2="1"><stop offset="0" stop-color="hsl(${skin},${sat}%,${Math.min(80, lig + 14)}%)"/><stop offset="1" stop-color="hsl(${skin},${sat + 6}%,${Math.max(18, lig - 12)}%)"/></linearGradient><radialGradient id="v${c.rank}" cx="0.5" cy="0.45" r="0.75"><stop offset="0.55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.55"/></radialGradient></defs>`;
    s += `<rect width="100" height="70" fill="url(#g${c.rank})"/>`;
    for (let i = 0; i < 4; i++) s += `<circle cx="50" cy="40" r="${12 + i * 11}" fill="none" stroke="hsl(${hue},80%,60%)" stroke-opacity="${0.18 - i * 0.03}" stroke-width="1"/>`;
    const bf = `url(#h${c.rank})`, body = `hsl(${skin},${sat}%,${lig}%)`, dark = `hsl(${skin},${sat + 5}%,${Math.max(12, lig - 24)}%)`;
    s += `<ellipse cx="50" cy="66" rx="30" ry="3.5" fill="#000" opacity=".35"/>`;
    if (ears === 1) s += `<circle cx="29" cy="17" r="8" fill="${bf}"/><circle cx="71" cy="17" r="8" fill="${bf}"/><circle cx="29" cy="17" r="4" fill="${dark}"/><circle cx="71" cy="17" r="4" fill="${dark}"/>`;
    else if (ears === 2) s += `<polygon points="26,26 30,4 42,20" fill="${bf}"/><polygon points="74,26 70,4 58,20" fill="${bf}"/>`;
    else if (ears === 3) s += `<rect x="36" y="2" width="28" height="16" rx="2" fill="${dark}"/><rect x="30" y="16" width="40" height="5" fill="${dark}"/>`;
    s += head === 0 ? `<rect x="22" y="16" width="56" height="48" rx="14" fill="${bf}"/>`
      : head === 1 ? `<ellipse cx="50" cy="40" rx="29" ry="25" fill="${bf}"/>`
      : head === 2 ? `<polygon points="30,16 70,16 80,42 64,64 36,64 20,42" fill="${bf}"/>`
      : `<rect x="20" y="18" width="60" height="46" rx="5" fill="${bf}"/><rect x="20" y="18" width="60" height="9" fill="${dark}" fill-opacity=".55"/>`;
    const ey = 36, L = 37, Rr = 63;
    if (eyes === 0) s += `<circle cx="${L}" cy="${ey}" r="7" fill="#fff"/><circle cx="${Rr}" cy="${ey}" r="7" fill="#fff"/><circle cx="${L + 1}" cy="${ey}" r="3.2" fill="#10151a"/><circle cx="${Rr - 1}" cy="${ey}" r="3.2" fill="#10151a"/>`;
    else if (eyes === 1) s += `<rect x="${L - 8}" y="${ey - 2}" width="16" height="4.5" rx="2" fill="${glow}"/><rect x="${Rr - 8}" y="${ey - 2}" width="16" height="4.5" rx="2" fill="${glow}"/>`;
    else if (eyes === 2) s += `<circle cx="${L}" cy="${ey}" r="6.5" fill="${glow}"/><circle cx="${Rr}" cy="${ey}" r="6.5" fill="${glow}"/><circle cx="${L}" cy="${ey}" r="2.2" fill="#10151a"/><circle cx="${Rr}" cy="${ey}" r="2.2" fill="#10151a"/>`;
    else if (eyes === 3) s += `<path d="M${L - 7} ${ey - 5}l14 10m0-10l-14 10M${Rr - 7} ${ey - 5}l14 10m0-10l-14 10" stroke="${glow}" stroke-width="3" stroke-linecap="round"/>`;
    else s += `<polygon points="${L - 8},${ey + 4} ${L + 8},${ey - 5} ${L + 8},${ey + 5}" fill="${glow}"/><polygon points="${Rr + 8},${ey + 4} ${Rr - 8},${ey - 5} ${Rr - 8},${ey + 5}" fill="${glow}"/>`;
    s += `<circle cx="50" cy="45" r="2.6" fill="${dark}"/>`;
    if (mouth === 0) s += `<path d="M36 53q14 9 28 0" stroke="${dark}" stroke-width="2.4" fill="none" stroke-linecap="round"/>`;
    else if (mouth === 1) { s += `<rect x="34" y="51" width="32" height="9" rx="2" fill="#10151a"/>`; for (let i = 0; i < 5; i++) s += `<rect x="${36 + i * 6}" y="51" width="4" height="4" fill="#f2f2f2"/>`; }
    else if (mouth === 2) s += `<polyline points="34,55 40,50 46,56 52,50 58,56 64,50" stroke="${dark}" stroke-width="2.4" fill="none" stroke-linejoin="round"/>`;
    else s += `<rect x="38" y="52" width="24" height="6" rx="3" fill="#10151a"/><path d="M42 52v6m5-6v6m5-6v6m5-6v6" stroke="${body}" stroke-width="1.2"/>`;
    // sets get a little signature so they read differently at a glance
    if (c.cat === 'BU') for (let i = 0; i < 4; i++) s += `<rect x="${Math.floor(r() * 60)}" y="${8 + Math.floor(r() * 54)}" width="${20 + Math.floor(r() * 40)}" height="${2 + Math.floor(r() * 4)}" fill="${glow}" fill-opacity=".35"/>`;
    if (c.cat === 'SSC') s += `<rect x="22" y="${28 + Math.floor(r() * 10)}" width="56" height="5" fill="#05070a" fill-opacity=".8"/>`;
    if (c.cat === 'SS3') s += `<path d="M10 62l8-9 8 9M74 62l8-9 8 9" stroke="${glow}" stroke-opacity=".5" fill="none" stroke-width="1.5"/>`;
    s += `<rect width="100" height="70" fill="url(#v${c.rank})"/></svg>`;
    return s + img;
  }

  // opts: holo, count, size (px), locked, ghost, fav
  const newLabel = (isNew) => (isNew ? `<span class="new-under">${isNew === 'holo' ? 'NEW SKIBIDI' : 'NEW!'}</span>` : '');
  function cardHTML(c, o) {
    o = o || {};
    const sp = o.holo || c.fx >= 4 ? Array.from({ length: 3 + c.ti }, (_, i) => `<i class="sparkle" style="left:${(i * 37) % 88 + 6}%;top:${(i * 53) % 80 + 8}%;animation-delay:${(i * 0.37).toFixed(2)}s"></i>`).join('') : '';
    const label = `${o.locked ? 'Not found yet' : c.name}, ${c.cat}, ${c.tier}${o.holo ? ', skibidi' : ''}`;
    return `<div class="card ${tcls(c.tier)} ${o.holo ? 'holo' : ''} ${o.locked ? 'locked' : ''} ${o.ghost ? 'ghost' : ''}" ${o.size ? `style="--cw:${o.size}px"` : ''} aria-label="${esc(label)}" data-id="${c.id}">
      <div class="card-in">
        <div class="card-top"><span class="rank">#${c.rank}</span><span class="set-tag">${c.cat}</span><span class="tier-badge">${c.tier}</span></div>
        <div class="art">${o.locked ? '<div class="lock">?</div>' : art(c)}</div>
        <div class="card-body"><div class="card-name ${c.name.length > 24 ? 'long' : ''}">${o.locked ? '???' : esc(c.name)}</div></div>
      </div>
      <div class="foil"></div><div class="glare"></div>${sp}
      ${(o.copiesText != null ? o.copiesText : copiesText(o.count, o.sk)) ? `<span class="copies">${o.copiesText != null ? o.copiesText : copiesText(o.count, o.sk)}</span>` : ''}${o.holo ? '<span class="holo-badge">✦ SKIBIDI</span>' : ''}${o.fav ? '<span class="fav">★</span>' : ''}
    </div>`;
  }
  // '×1 skibidi ×7 normal' for a stack with both kinds, '×N' when there is only one kind. Nothing for a single copy (the SKIBIDI badge already shows).
  function copiesText(n, h) { n = +n || 0; h = Math.min(n, Math.max(0, +h || 0)); if (n < 2) return ''; return h ? '×' + h + ' skibidi' + (n > h ? ' ×' + (n - h) + ' normal' : '') : '×' + n; }
  // 3D tilt for packs: rotates toward the pointer and moves the foil sheen.
  function packTilt(el) {
    if (!el || el._pt) return; el._pt = 1;
    el.addEventListener('pointermove', (e) => {
      if (e.buttons || reduceMotion()) return;
      const b = el.getBoundingClientRect(), x = (e.clientX - b.left) / b.width, y = (e.clientY - b.top) / b.height;
      el.classList.add('tilting');
      el.style.setProperty('--pry', ((x - .5) * 34).toFixed(1) + 'deg'); el.style.setProperty('--prx', ((.5 - y) * 26).toFixed(1) + 'deg');
      el.style.setProperty('--mx', (x * 100).toFixed(0) + '%'); el.style.setProperty('--my', (y * 100).toFixed(0) + '%');
    });
    const off = () => { el.classList.remove('tilting'); el.style.setProperty('--pry', '0deg'); el.style.setProperty('--prx', '0deg'); };
    el.addEventListener('pointerleave', off); el.addEventListener('pointerdown', off);
  }
  function tilt(el) {
    if (reduceMotion()) return;
    el.addEventListener('pointerenter', () => el.classList.add('tilting'));
    el.addEventListener('pointermove', (e) => { const b = el.getBoundingClientRect(), x = (e.clientX - b.left) / b.width, y = (e.clientY - b.top) / b.height, set = (k, v) => el.style.setProperty(k, v);
      set('--mx', (x * 100).toFixed(1) + '%'); set('--my', (y * 100).toFixed(1) + '%');
      set('--rx', ((0.5 - y) * 26).toFixed(1) + 'deg'); set('--ry', ((x - 0.5) * 26).toFixed(1) + 'deg');
      set('--px', ((x - 0.5) * 2).toFixed(2)); set('--py', ((y - 0.5) * 2).toFixed(2));
      set('--sx', (-(x - 0.5) * 26).toFixed(1) + 'px'); set('--sy', (((y - 0.5) * 26) + 16).toFixed(1) + 'px'); });
    el.addEventListener('pointerleave', () => { el.classList.remove('tilting'); ['--rx', '--ry'].forEach((k) => el.style.setProperty(k, '0deg')); ['--px', '--py'].forEach((k) => el.style.setProperty(k, '0')); });
  }

  // Every card gets the 3D tilt the first time the pointer reaches it (trade pickers, board, pop-ups and so on built their cards without it).
  document.addEventListener('pointerover', (e) => { const el = e.target.closest && e.target.closest('.card'); if (!el || el._tl || el.closest('.no-tilt')) return; el._tl = 1; tilt(el); el.classList.add('tilting'); });
  // Card names shrink until they fit their box (long names used to push the rarity and set off the card).
  const fitName = (el) => {
    if (el.dataset.fit === el.textContent) return; el.style.fontSize = ''; const base = parseFloat(getComputedStyle(el).fontSize) || 12; let size = base, guard = 0;
    while ((el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1) && size > base * 0.4 && guard++ < 30) { size -= base * 0.04; el.style.fontSize = size.toFixed(2) + 'px'; }
    el.dataset.fit = el.textContent;
  };
  let fitT = 0; const fitAll = () => { clearTimeout(fitT); fitT = setTimeout(() => $$('.card-name').forEach((el) => { if (el.offsetParent !== null) fitName(el); }), 30); };
  new MutationObserver(fitAll).observe(document.body, { childList: true, subtree: true }); addEventListener('resize', () => { $$('.card-name').forEach((el) => { delete el.dataset.fit; }); fitAll(); });
  // ---------- toast + modal ----------
  function toast(msg, err) {
    const t = document.createElement('div'); t.className = 'toast' + (err ? ' err' : ''); t.textContent = msg;
    $('#toasts').append(t); setTimeout(() => t.remove(), 3200);
  }
  function modal(inner, cls) {
    const bg = document.createElement('div'); bg.className = 'modal-bg';
    bg.innerHTML = `<div class="modal ${cls || ''}" role="dialog" aria-modal="true"><button class="x" data-act="close-modal" aria-label="Close">✕</button>${inner}</div>`;
    document.body.append(bg); document.documentElement.classList.add('modal-open');
    bg.addEventListener('pointerdown', (e) => { if (e.target === bg) closeModal(bg); });
    const f = $('button, a, input', $('.modal', bg)); if (f && f.dataset.act !== 'close-modal') f.focus();
    return bg;
  }
  function closeModal(bg) { (bg || $$('.modal-bg').pop())?.remove(); if (!$('.modal-bg')) document.documentElement.classList.remove('modal-open'); }

  // ---------- header ----------
  const NAV = [['home', 'Home', '🎴', 1], ['collection', 'Collection', '🗂️', 1], ['index', 'Index', '📖', 0], ['leaderboard', 'Leaderboard', '🏆', 1], ['trades', 'Trades', '⇄', 1], ['board', 'Board', '📋', 0]]; // Profile, Friends and Settings live in the account menu (top right)
  const MENU_PAGES = ['profile', 'friends', 'options', 'chat', 'imagereq', 'suggest']; // [page, label, icon, shown in the phone's bottom bar]
  let net = null, auth = null, admin = null, social = null; // the online layer (js/net.js), accounts (js/auth.js) and admin (js/admin.js), created at the bottom
  const BOLT = '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="M13.5 2 4 13.5h6.2L8.5 22 20 9.8h-6.6z" fill="currentColor"/></svg>';
  const navLink = ([h, l, ic], cur) => `<a href="#${h}" style="order:${NAV.findIndex((n) => n[0] === h)}" ${cur === h ? 'aria-current="page"' : ''}><span class="ni" aria-hidden="true">${ic}</span><span class="nl">${l}</span>${h === 'trades' ? '<span class="nbadge" data-tradebadge hidden></span>' : ''}</a>`;
  function renderHeader() {
    if (!auth || !auth.loggedIn() || gated()) { const hd0 = $('#header'); hd0.dataset.sig = ''; hd0.innerHTML = `<a class="logo" href="#home">${BOLT}<span>Special Strike <b>Gacha</b></span></a>`; return; }
    const cur0 = (location.hash.slice(1) || 'home').split('-')[0], cur = cur0 === 'user' ? 'leaderboard' : cur0 === 'players' ? 'leaderboard' : cur0 === 'trade' ? 'trades' : cur0 === 'post' ? 'board' : cur0;
    const hd = $('#header'), html = `<a class="logo" href="#home">${BOLT}<span>Special Strike <b>Gacha</b></span></a>
      <nav class="main" aria-label="Main">${NAV.filter((n) => n[3]).map((n) => navLink(n, cur)).join('')}<button type="button" class="nav-more${NAV.some(([h, , , pri]) => !pri && h === cur) ? ' on' : ''}" data-act="nav-more" aria-expanded="false" style="order:${NAV.length}"><span class="ni" aria-hidden="true">⋯</span><span class="nl">More</span></button><div class="more-sheet">${NAV.filter((n) => !n[3]).map((n) => navLink(n, cur)).join('')}</div></nav>
      <div class="top-right"><a class="chip" href="#home" title="Packs ready"><span class="pk"></span><b data-hud="packs">${S.packs}</b><small class="muted">/ ${D().cap}</small><i class="bonus-mini" data-hud-bonus title="Bonus packs from codes and gifts">${S.bonus ? '+' + S.bonus : ''}</i></a>
        <button type="button" class="icon-btn bell" data-bell aria-haspopup="true" aria-expanded="false" aria-label="Notifications" title="Notifications">🔔<b class="bell-n" data-notebadge hidden></b></button><button type="button" class="me${MENU_PAGES.indexOf(cur) >= 0 ? ' on' : ''}" data-prof aria-haspopup="true" aria-expanded="false" title="${esc(S.profile.name)}: account menu">${avatarHTML(32)}<i class="netdot" data-netdot></i><b class="me-n" data-friendbadge hidden></b><span class="me-caret" aria-hidden="true">▾</span></button></div>`;
    if (hd.dataset.sig !== html) { hd.innerHTML = html; hd.dataset.sig = html; } // unchanged header is left alone (no flicker, open menus stay open)
    if (net) net.paint();
  }
  // ---------- account menu (top right) ----------
  let profOpen = false;
  function profPlace() { const box = $('#profpanel'), btn = $('[data-prof]'); if (!box || !btn) return; const r = btn.getBoundingClientRect(); box.style.top = Math.round(r.bottom + 8) + 'px'; box.style.right = Math.max(8, Math.round(innerWidth - r.right)) + 'px'; }
  function profOpenMenu() {
    if (profOpen) return; profOpen = true; const box = document.createElement('div'); box.id = 'profpanel'; box.className = 'profpanel'; box.setAttribute('role', 'menu');
    const se = auth.session(), hud = net.state.dir.find((p) => p.id === S.profile.id);
    box.innerHTML = `<div class="pp-user">${avatarHTML(44)}<span><b>${esc(S.profile.name)}</b><small class="muted">${S.packs} / ${D().cap} packs</small></span><a class="pp-gear" href="#options" title="Settings" aria-label="Settings">⚙️</a></div>
      <a class="pp-item" role="menuitem" href="#profile">Profile</a>
      <a class="pp-item" role="menuitem" href="#friends">Friends<span class="nbadge" data-friendbadge hidden></span></a>
      ${admin && (admin.unlocked() || auth.adminHint()) ? '<a class="pp-item" role="menuitem" href="#admin">Admin</a>' : ''}
      <div class="pp-sep"></div><button type="button" class="pp-item pp-out" role="menuitem" data-pp="logout">Log out</button>`;
    document.body.append(box); const b = $('[data-prof]'); if (b) b.setAttribute('aria-expanded', 'true'); profPlace(); if (net) net.paint();
  }
  function profClose() { if (!profOpen) return; profOpen = false; const b = $('#profpanel'); if (b) b.remove(); const t = $('[data-prof]'); if (t) t.setAttribute('aria-expanded', 'false'); }
  document.addEventListener('click', (e) => {
    const t = e.target.closest && e.target.closest('[data-prof]'); if (t) { e.preventDefault(); profOpen ? profClose() : profOpenMenu(); return; }
    const o = e.target.closest && e.target.closest('[data-pp]'); if (o) { profClose(); if (o.dataset.pp === 'logout') auth.logOut(); return; }
    if (profOpen && (e.target.closest('#profpanel .pp-item') || !e.target.closest('#profpanel'))) profClose();
  });
  addEventListener('hashchange', profClose); addEventListener('resize', profPlace); addEventListener('scroll', profPlace, { passive: true });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && profOpen) { profClose(); const b = $('[data-prof]'); if (b) b.focus(); } });
  function updateHud() {
    tick();
    $$('[data-hud="packs"]').forEach((e) => (e.textContent = S.packs));
    $$('[data-hud-bonus]').forEach((e) => (e.textContent = S.bonus ? '+' + S.bonus : ''));
    const stk = $('[data-stack]'); if (stk && +stk.dataset.n !== avail()) { stk.dataset.n = avail(); stk.innerHTML = pileHTML(avail(), 'fan'); const pk = stk.closest('.pack'); if (pk) pk.style.setProperty('--cnt', pileCount(avail())); }
    const d = D(), ring = $('[data-ring]');
    if (ring) {
      const full = S.packs >= d.cap, iv = d.interval * 60000, left = Math.max(0, iv - (Date.now() - S.last)), C = 2 * Math.PI * 52;
      ring.style.strokeDasharray = C.toFixed(1); ring.style.strokeDashoffset = (full ? 0 : C * (left / iv)).toFixed(1);
      $('[data-ringtime]').textContent = full ? 'FULL' : `${Math.floor(left / 60000)}:${String(Math.floor(left / 1000) % 60).padStart(2, '0')}`;
      $('[data-ringlabel]').textContent = full ? 'pack storage' : 'next pack';
      ring.closest('.ring-wrap').classList.toggle('full', full);
    }
    const pc = $('[data-packcount]'); if (pc) pc.innerHTML = `${S.packs} <small>/ ${d.cap}</small>${bonusPill()}`;
    $$('[data-needpack]').forEach((b) => (b.disabled = avail() < 1 || opening));
    $$('[data-needall]').forEach((b) => { b.hidden = avail() < 2; b.textContent = `Open all (${avail()})`; });
  }

  // ---------- profile ----------
  const bannerCSS = (p) => (p.banner ? `background-image:url(${p.banner})` : `background-image:linear-gradient(120deg,hsl(${p.hue},62%,34%),hsl(${(p.hue + 55) % 360},60%,14%))`);
  function avatarHTML(size, prof) {
    const p = prof || S.profile, st = `--s:${size}px`;
    return p.pfp ? `<img class="avatar" src="${p.pfp}" alt="" style="${st}" draggable="false">` : `<span class="avatar ph" aria-hidden="true" style="${st};background:hsl(${p.hue},58%,42%)">${esc((p.name.trim()[0] || '?').toUpperCase())}</span>`;
  }
  // Crops the picked image to fill w x h and shrinks it so the save file stays small.
  function readImage(file, w, h, q) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.fillStyle = '#111'; g.fillRect(0, 0, w, h);
        const sc = Math.max(w / img.width, h / img.height), dw = img.width * sc, dh = img.height * sc; g.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh); URL.revokeObjectURL(url); res(c.toDataURL('image/jpeg', q)); };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('bad image')); }; img.src = url;
    });
  }
  const HUES = [8, 28, 48, 135, 172, 200, 268, 330];
  function editProfile() {
    const d = { name: S.profile.name, bio: S.profile.bio || '', pfp: S.profile.pfp, banner: S.profile.banner, hue: S.profile.hue };
    const bg = modal(`<h2>Edit profile</h2>
      <div class="pe-preview"><div class="pf-banner" id="peBanner"></div><span id="peAvatar"></span></div>
      <label class="f">Name<input id="peName" maxlength="20" value="${esc(d.name)}" autocomplete="off"></label>
      <label class="f" style="margin-top:10px">Bio<input id="peBio" maxlength="120" value="${esc(d.bio)}" placeholder="Say something about yourself" autocomplete="off"></label>
      <div class="row wrap pe-row"><label class="btn" style="cursor:pointer">Profile picture<input id="pePfp" type="file" accept="image/*" hidden></label><button class="btn" id="pePfpX" type="button">Remove</button></div>
      <div class="row wrap pe-row"><label class="btn" style="cursor:pointer">Banner<input id="peBan" type="file" accept="image/*" hidden></label><button class="btn" id="peBanX" type="button">Remove</button></div>
      <p class="muted small" style="margin:10px 0 6px">Accent colour (used when there is no picture)</p>
      <div class="swatches">${HUES.map((h) => `<button type="button" class="sw" data-hue="${h}" style="background:hsl(${h},62%,46%)" aria-label="Colour ${h}"></button>`).join('')}</div>
      <p class="muted small">Pictures are cropped and shrunk, then stored in your save file.</p>
      <div class="row wrap" style="margin-top:14px"><button class="btn primary" id="peSave" type="button">Save</button><button class="btn" data-act="close-modal" type="button">Cancel</button></div>`);
    const draw = () => {
      const tmp = Object.assign({}, S.profile, d); $('#peBanner', bg).setAttribute('style', bannerCSS(tmp));
      $('#peAvatar', bg).innerHTML = avatarHTML(84, tmp);
      $$('.sw', bg).forEach((b) => b.classList.toggle('on', +b.dataset.hue === d.hue));
    };
    draw();
    $('#peName', bg).oninput = (e) => { d.name = e.target.value; draw(); };
    $('#peBio', bg).oninput = (e) => { d.bio = e.target.value; };
    $$('.sw', bg).forEach((b) => (b.onclick = () => { d.hue = +b.dataset.hue; draw(); }));
    const pick1 = (sel, w, h, q, key) => ($(sel, bg).onchange = async (e) => { const f = e.target.files[0]; if (!f) return; try { d[key] = okImg(await readImage(f, w, h, q)); draw(); } catch (er) { toast('Could not read that image', true); } e.target.value = ''; });
    pick1('#pePfp', 160, 160, 0.85, 'pfp'); pick1('#peBan', 720, 240, 0.75, 'banner');
    $('#pePfpX', bg).onclick = () => { d.pfp = null; draw(); }; $('#peBanX', bg).onclick = () => { d.banner = null; draw(); };
    $('#peSave', bg).onclick = () => {
      S.profile.name = (d.name.trim() || 'Player').slice(0, 20); S.profile.bio = String(d.bio || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 120); S.profile.pfp = d.pfp; S.profile.banner = d.banner; S.profile.hue = d.hue;
      save(); closeModal(bg); renderHeader(); route(); toast('Profile saved');
    };
  }
  // Used for your own profile and for other players' profiles. ov overrides the computed numbers (for players we only have a summary of).
  const badgesHTML = (cards, opened, rank) => { const b = G.badgesOf(cards, opened, rank || 0); return b.length ? `<div class="badges" aria-label="Badges">${b.map((x) => `<span class="badge" title="${esc(x.tip)}"><i>${x.ic}</i>${esc(x.name)}</span>`).join('')}</div>` : ''; };
  function annHTML() {
    let hid = []; try { hid = JSON.parse(localStorage.getItem('ss-gacha-ann') || '[]'); } catch (e) { hid = []; }
    const now = Date.now(), list = (net.state.cfg.announce || []).filter((a) => (!a.until || a.until > now) && hid.indexOf(a.id + ':' + a.at) < 0);
    return list.map((a) => `<div class="ann ann-${a.kind}" role="status"><span class="ann-ic">${a.kind === 'warn' ? '⚠️' : a.kind === 'event' ? '🎉' : '📣'}</span><span class="ann-t">${esc(a.text)}</span><button type="button" class="ann-x" data-act="ann-x" data-id="${esc(a.id + ':' + a.at)}" aria-label="Dismiss">✕</button></div>`).join('');
  }
  // Tiered badges for the profile: each has up to 5 levels and a bar towards the next one. Worked out from the collection, nothing is stored.
  const BADGE_DEFS = [
    ['Dedicated', '📦', [1, 100, 500, 2000, 5000], (m) => m.opened, 'packs opened'],
    ['Collector', '🏆', [1000, 10000, 50000, 150000, 400000], (m) => m.score, 'points'],
    ['Completion', '📚', [10, 25, 50, 75, 100], (m) => m.pct, '% of all cards'],
    ['Skibidi Star', '✨', [1, 10, 25, 50, 100], (m) => m.sk, 'skibidi cards'],
    ['Copycat', '🐈', [10, 50, 200, 750, 2000], (m) => m.dupes, 'extra copies'],
    ['Rare Hunter', '💎', [1, 3, 6, 10, 15], (m) => m.rare, 'Legendary or better'],
  ];
  const RANK_STEPS = [100, 50, 10, 3, 1];
  // What each badge is for, shown when you click it.
  const BADGE_INFO = {
    'Dedicated': 'Earned by opening packs. Every pack you open counts.',
    'Collector': 'Earned by your total collection points. Every copy counts, and skibidi copies are worth extra.',
    'Completion': 'Earned by finding different cards. It is the share of the whole card list found at least once.',
    'Skibidi Star': 'Earned by owning skibidi (holo) versions of different cards. Each card only counts once.',
    'Copycat': 'Earned by duplicates: every extra copy of a card you already own counts.',
    'Rare Hunter': 'Earned by owning different cards of Legendary rarity or better.',
    'Top Player': 'Earned by your place on the leaderboard (most points). Climb the ranks to level it up.'
  };
  let badgeList = []; // the badges currently on screen, so a click can look one up
  function tierBadges(cards, opened, rank) {
    const ents = Object.keys(cards).filter((id) => BYID[id] && cards[id] && cards[id].n > 0), total = CARDS.length || 1;
    const m = { opened: opened || 0, score: G.scoreOf(cards), sk: ents.filter((id) => cards[id].h > 0).length, dupes: ents.reduce((a, id) => a + cards[id].n - 1, 0), pct: CARDS.length ? ents.length / CARDS.length * 100 : 0, rare: ents.filter((id) => BYID[id].fx >= 4).length };
    const out = BADGE_DEFS.map(([name, ic, th, val, unit]) => {
      const v = val(m), tier = th.filter((t) => v >= t).length, next = th[tier], isPct = name === 'Completion';
      const need = !next ? 'Max level reached. Nothing more to earn here.' : isPct ? `${Math.max(1, Math.ceil(next / 100 * total) - ents.length)} more card${Math.ceil(next / 100 * total) - ents.length === 1 ? '' : 's'} to find to reach level ${tier + 1} (${next}% of all cards).` : `${fmt(Math.ceil(next - v))} more ${unit} to reach level ${tier + 1} (${fmt(next)} in total).`;
      return { name, ic, tier, max: th.length, pct: next ? Math.max(0, Math.min(100, (v - (th[tier - 1] || 0)) / (next - (th[tier - 1] || 0)) * 100)) : 100, tip: `${fmt(v)} ${unit}${next ? ` · next level at ${fmt(next)}` : ' · max level'}`,
        info: BADGE_INFO[name], now: isPct ? `${ents.length} of ${CARDS.length} cards (${(Math.round(v * 10) / 10)}%)` : `${fmt(v)} ${unit}`, need, levels: th.map((t) => (isPct ? `${t}% (${Math.ceil(t / 100 * total)} cards)` : fmt(t))), unit: isPct ? 'of all cards found' : unit };
    });
    const rt = rank > 0 ? RANK_STEPS.filter((r) => rank <= r).length : 0, rnext = RANK_STEPS[rt];
    out.push({ name: 'Top Player', ic: '👑', tier: rt, max: RANK_STEPS.length, pct: rt === RANK_STEPS.length ? 100 : 0, tip: rank > 0 ? `Leaderboard rank #${fmt(rank)}` : 'Not ranked yet', sub: rank > 0 ? '#' + fmt(rank) : '',
      info: BADGE_INFO['Top Player'], now: rank > 0 ? `Rank #${fmt(rank)} on the leaderboard` : 'Not ranked yet', levels: RANK_STEPS.map((r) => (r === 1 ? 'Rank #1' : 'Top ' + r)),
      need: rt === RANK_STEPS.length ? 'Max level reached. This is the very top.' : rank > 0 ? `Reach rank #${rnext} or better to get level ${rt + 1} (${fmt(rank - rnext)} place${rank - rnext === 1 ? '' : 's'} to climb).` : `Earn points to appear on the leaderboard, then climb to the top ${rnext}.` });
    G.badgesOf(cards, opened, 0).filter((b) => b.ic === '📚' || b.ic === '🌟').forEach((b) => out.push({ name: b.name, ic: b.ic, tier: 1, max: 1, pct: 100, tip: b.tip, solo: true, info: b.tip, now: 'Earned', levels: [], need: 'A one-off badge. Nothing more to earn here.' }));
    return out;
  }
  const badgeTilesHTML = (list) => { badgeList = list; return `<div class="bdg-row" aria-label="Badges">${list.map((b, i) => `<button type="button" class="bdg ${b.tier ? 'on' : 'off'} bt${b.solo ? 5 : b.tier}" data-act="badge" data-i="${i}" title="${esc(b.tip)}" aria-label="${esc(b.name)}: show details"><span class="bdg-ic">${b.ic}</span><b>${esc(b.name)}</b>${b.solo ? '' : `<span class="bdg-dots" aria-label="Level ${b.tier} of ${b.max}">${Array.from({ length: b.max }, (_, i) => `<i class="${i < b.tier ? 'fl' : ''}"></i>`).join('')}</span>${b.sub ? `<small>${esc(b.sub)}</small>` : `<span class="bdg-bar"><i style="width:${b.pct.toFixed(0)}%"></i></span>`}`}</button>`).join('')}</div>`; };
  function badgeModal(i) {
    const b = badgeList[i]; if (!b) return;
    modal(`<div class="bd-detail bt${b.solo ? 5 : b.tier}"><div class="bd-head"><span class="bdg-ic">${b.ic}</span><div><h2>${esc(b.name)}</h2><p class="muted small">${b.solo ? 'One-off badge' : b.tier ? `Level ${b.tier} of ${b.max}` : `Not earned yet · ${b.max} levels`}</p></div></div>
      <p>${esc(b.info || '')}</p>
      <p class="bd-now"><span class="muted small">Right now</span><b>${esc(b.now)}</b></p>
      ${b.solo ? '' : `<div class="bdg-bar big"><i style="width:${b.pct.toFixed(0)}%"></i></div>`}
      <p class="bd-need">${esc(b.need)}</p>
      ${b.levels.length ? `<ol class="bd-levels">${b.levels.map((l, k) => `<li class="${k < b.tier ? 'done' : k === b.tier ? 'next' : ''}"><span>${k < b.tier ? '✓' : k + 1}</span>Level ${k + 1}<b>${esc(l)}</b></li>`).join('')}</ol>${b.name === 'Top Player' || b.unit === 'of all cards found' ? '' : `<p class="muted small">Levels are counted in ${esc(b.unit)}.</p>`}` : ''}</div>`);
  }
  const pct2 = (x) => (Math.round(x * 100) / 100).toFixed(2) + '%';
  const joinedTxt = (t) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  // Used for your own profile and for other players' profiles. ov overrides the computed numbers (for players we only have a summary of).
  // ov.after = html placed right under the header card, ov.tail = html at the very end, ov.src = player id when the cards are someone else's.
  // Admin tag: label only (the Worker decides who is really an admin). IDs come from SSG_ADMINS in js/config.js.
  const ADMIN_TAG = '<span class="admin-tag" title="Site admin">Admin</span>';
  const isAdminAcct = (k) => /^d\d{15,19}$/.test(k || '') && (window.SSG_ADMINS || []).map(String).indexOf(String(k).slice(1)) >= 0;
  const isAdminPid = (pid) => { const a = net && net.state.accounts.find((x) => x.pid === pid); return !!a && isAdminAcct(a.k); };
  function profileHTML(p, cards, stats, actions, full, ov) {
    ov = ov || {};
    const ents = Object.entries(cards).filter(([id, e]) => BYID[id] && e.n > 0), src = ov.src ? ` data-src="${esc(ov.src)}"` : '';
    const row = (list, empty) => list.length ? `<div class="card-row">${list.map(([id, e]) => `<button class="card-btn" data-act="card" data-id="${id}"${src}>${cardHTML(BYID[id], { holo: e.h > 0, count: e.n, sk: e.h, fav: e.f })}</button>`).join('')}</div>` : `<div class="empty"><p>${empty}</p></div>`;
    const byRar = (a, b) => BYID[b[0]].ti - BYID[a[0]].ti || BYID[a[0]].rank - BYID[b[0]].rank;
    const recent = ents.slice().sort((a, b) => lastSeen(b[1]) - lastSeen(a[1])).slice(0, 12);
    const favs = ents.filter(([, e]) => e.f).sort(byRar);
    const best = ents.slice().sort((a, b) => BYID[b[0]].pts * (b[1].h > 0 ? G.GS.holoMult : 1) - BYID[a[0]].pts * (a[1].h > 0 ? G.GS.holoMult : 1) || byRar(a, b)).slice(0, 7);
    const sc = ov.score != null ? ov.score : G.scoreOf(cards), uniq = ov.unique != null ? ov.unique : ents.length, sk = ov.skibidi != null ? ov.skibidi : ents.filter(([, e]) => e.h > 0).length;
    const copies = ents.reduce((a, [, e]) => a + e.n, 0), total = CARDS.length || 1, bio = (p.bio || '').trim();
    const tiles = [[fmt(sc), 'Points'], [pct2(uniq / total * 100), `Completion (${uniq} / ${CARDS.length})`], [ov.lite ? '–' : fmt(copies), 'Cards owned'], [pct2(sk / total * 100), `Skibidi (${sk} / ${CARDS.length})`], [fmt(stats.opened || 0), 'Packs opened']];
    const sections = ov.lite ? `<p class="muted">Only a summary is available right now. Connect GitHub in Settings to see their cards.</p>`
      : `<section><h2>Favorite cards</h2>${row(favs, ov.mine ? 'No favorites yet. Click a card and press Favorite.' : 'No favorites yet.')}</section><section><h2>Recently obtained</h2>${row(recent, 'No cards yet.')}</section>${full && !ov.mine ? `<section><h2>Collection <span class="muted small">${ents.length} cards</span></h2>${row(ents.slice().sort(byRar), 'Nothing yet.')}</section>` : ''}`;
    return `<section class="pf2"><div class="pf2-banner" style="${bannerCSS(p)}"><span class="pf2-joined">Joined ${joinedTxt(p.joined)}</span></div>
        <div class="pf2-head"><div class="pf2-av">${avatarHTML(104, p)}${ov.rank > 0 ? `<span class="pf2-rank"><small>RANK</small><b>#${fmt(ov.rank)}</b></span>` : ''}</div>
          <div class="pf2-id"><h1>${esc(p.name)}${ov.admin ? ' ' + ADMIN_TAG : ''}${ov.online ? ' <span class="online-dot" title="Online now"></span>' : ''}${ov.acct && ov.acct.toLowerCase() !== String(p.name).toLowerCase() ? ` <span class="pf2-user">@${esc(ov.acct)}</span>` : ''}</h1><p class="pf2-bio ${bio ? '' : 'muted'}">${bio ? esc(bio) : 'No bio yet.'}</p></div>
          <div class="pf2-actions">${actions || ''}</div></div></section>
      ${ov.after || ''}
      <section class="panel prog"><h2>Collection progress</h2><div class="bar thick"><i style="width:${Math.min(100, uniq / total * 100)}%"></i></div><div class="stat-tiles five">${tiles.map(([v, l]) => `<div class="stat-tile"><b>${v}</b><span>${l}</span></div>`).join('')}</div></section>
      ${ov.lite ? '' : `<section><h2>Badges</h2>${badgeTilesHTML(tierBadges(cards, stats.opened || 0, ov.rank || 0))}</section>`}
      ${sections}${ov.lite ? '' : `<section><h2>Best cards</h2>${best.length ? `<div class="best-row">${best.map(([id, e]) => `<button class="card-btn" data-act="card" data-id="${id}"${src}>${cardHTML(BYID[id], { holo: e.h > 0, count: e.n, sk: e.h, fav: e.f })}</button>`).join('')}</div>` : '<div class="muted">Your best cards show up here once you pull some.</div>'}</section>`}${ov.tail || ''}`;
  }
  function pageProfile() {
    main().innerHTML = profileHTML(S.profile, S.cards, S.stats, '<button class="btn" data-act="edit-profile">Edit profile</button><a class="btn" href="#collection">View collection</a>', false, { mine: true, admin: isAdminAcct(S.account), show: S.showcase, acct: (auth.session() || {}).u || null, rank: net.state.loaded ? net.rankOf(S.profile) : 0 });
    $$('.card', main()).forEach(tilt); if (Date.now() - net.state.last > 20000) net.cycle();
  }

  // ---------- pack codes ----------
  async function redeem(raw) {
    const k = String(raw).trim().toUpperCase(), c = G.findCode(k);
    if (!k) return false;
    if (!c) { toast('That code does not exist', true); return false; }
    if (S.codes.includes(k)) { toast('You already used that code', true); return false; }
    if (c.until && Date.now() > c.until) { toast('That code has expired', true); return false; }
    if (c.managed && c.max && net.enabled()) {
      try { await net.refresh(); } catch (e) { toast('Could not check that code right now. Try again in a moment.', true); return false; }
      if (net.state.redeems.filter((r) => r.code === k).length >= c.max) { toast('That code has run out', true); return false; }
    }
    if (S.codes.includes(k)) return false;
    S.codes.push(k); const now = Date.now(), got = [];
    if (c.packs) S.bonus = (S.bonus || 0) + c.packs;
    (c.cards || []).forEach((id) => { if (!BYID[id] || (BYID[id].monster && !S.settings.monster)) return; const e = S.cards[id]; if (!e) S.cards[id] = { n: 1, h: 0, t: now, l: now, f: 0 }; else { e.n++; e.l = now; } got.push(BYID[id].name); });
    save(); renderHeader(); if (!opening) route();
    if (net.enabled()) net.logRedeem(k);
    if ((c.cards || []).some((id) => BYID[id] && BYID[id].monster && !S.settings.monster)) setTimeout(() => toast('A Monster card in that code was held back: let the monster in (Settings) to receive them.', true), 600);
    toast(`Code accepted${c.packs ? `: +${c.packs} bonus pack${c.packs === 1 ? '' : 's'}` : ''}${got.length ? ` and ${got.join(', ')}` : ''}`);
    return true;
  }
  function redeemModal() {
    const bg = modal(`<h2>Enter a code</h2><p class="muted small">Pack codes give you free packs. Each code works once per save.</p>
      <label class="f">Code<input id="codeIn" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="e.g. WELCOME"></label>
      <div class="row wrap" style="margin-top:12px"><button class="btn primary" id="codeGo" type="button">Redeem</button></div>`);
    const go = async () => { if (await redeem($('#codeIn', bg).value)) closeModal(bg); };
    $('#codeGo', bg).onclick = go; $('#codeIn', bg).onkeydown = (e) => { if (e.key === 'Enter') go(); }; $('#codeIn', bg).focus();
  }

  // ---------- pack art ----------
  const packBag = (n) => `<span class="bag" aria-hidden="true"><span class="bag-top"><span class="seam"></span></span><span class="bag-body"><span class="pack-face">${BOLT}<span class="pack-title">Special<br>Strike</span><span class="pack-sub">${CARDS_PER_PACK} cards</span></span><span class="glints"><i style="left:14%;top:24%"></i><i style="left:78%;top:12%;animation-delay:.9s"></i><i style="left:60%;top:70%;animation-delay:1.7s"></i></span></span>${n > 1 ? `<span class="pack-n">×${n}</span>` : ''}</span>`;
  // A pile of packs: one pack for every pack you hold (up to 15 are drawn). 'fan' spreads them out on the home page,
  // 'tight' stacks them neatly for the opening screen, where one slice opens the whole stack.
  const pileCount = (n) => Math.max(1, Math.min(n, 15));
  function pileHTML(n, mode) {
    const c = pileCount(n);
    return `<span class="pile ${mode}" style="--cnt:${c};--st:${Math.max(2, Math.min(6, Math.round(70 / c)))}px">${Array.from({ length: c }, (_, k) => `<span class="ppk" style="--d:${c - 1 - k};--k:${k};z-index:${k}">${packBag(mode === 'tight' && k === c - 1 ? n : 0)}</span>`).join('')}</span>`;
  }

  // ---------- pages ----------
  const main = () => $('#main');
  const leftTxt = (ms) => { const m = Math.max(1, Math.ceil(ms / 60000)); return m >= 60 ? Math.floor(m / 60) + 'h ' + (m % 60) + 'm' : m + ' min'; };
  const since = (t) => { const s = Math.max(0, (Date.now() - t) / 1000); return s < 60 ? 'just now' : s < 3600 ? Math.floor(s / 60) + 'm ago' : s < 86400 ? Math.floor(s / 3600) + 'h ago' : Math.floor(s / 86400) + 'd ago'; };
  function powerBanner() {
    const evs = G.eventsNow(Date.now()); if (!evs.length) return '';
    const what = (e) => { const sc = e.scope === 'all' ? 'every card' : e.scope === 'rare' ? 'rare cards' : e.value || 'some cards', nm = e.scope === 'card' && G.BYID[e.value] ? G.BYID[e.value].name : sc; return e.kind === 'holo' ? `skibidi chance ×${e.mult} on ${nm}` : `${nm} ×${e.mult} more likely`; };
    return `<section class="power-banner" role="status">${evs.map((e) => `<div><span class="pb-ic">⚡</span><b>${esc(e.name)}</b> <span>${esc(what(e))}</span> <small>${leftTxt(e.end - Date.now())} left</small></div>`).join('')}</section>`;
  }
  // Rarest first: tier, then skibidi, then fewest copies.
  const rarityCmp = (a, b) => BYID[b[0]].ti - BYID[a[0]].ti || (b[1].h > 0) - (a[1].h > 0) || a[1].n - b[1].n || BYID[a[0]].rank - BYID[b[0]].rank;
  const TRADE_TAGS = { accepted: 'ACCEPTED', denied: 'DENIED', invalid: 'INVALID', cancelled: 'CANCELLED', pending: 'PENDING', offer: 'NEW OFFER' };
  // Your trades: offers waiting on you, offers you sent, then the settled ones. a ⇄ b = cards you give ⇄ cards you get.
  function tradesFeedHTML() {
    const rows = [];
    net.incoming().forEach((t) => rows.push({ st: 'offer', dir: 'from', who: t.from.name, a: t.want.length, b: t.give.length }));
    net.outgoing().forEach((o) => rows.push({ st: 'pending', dir: 'to', who: o.toName, a: o.give.length, b: o.want.length }));
    S.net.log.forEach((x) => { if (!x.at || x.at > G.feedClear().trades) rows.push(x); });
    return rows.length ? rows.slice(0, 10).map((x) => `<a class="feed-row" href="#trades"><span class="tag st-${x.st}">${TRADE_TAGS[x.st]}</span><span class="grow">${x.dir === 'from' ? 'From' : 'To'} <b>${esc(x.who)}</b>: ${x.a} ⇄ ${x.b} card${x.a === 1 && x.b === 1 ? '' : 's'}</span>${x.at ? `<small class="muted">${since(x.at)}</small>` : ''}</a>`).join('')
      : '<p class="muted small">No trades yet. Offers you send and receive show up here.</p>';
  }
  // Legendary-or-better cards other players picked up most recently (read from their published collections).
  function pullsFeedHTML() {
    const l = net.recentPulls(12);
    return l.length ? l.map((x) => `<a class="feed-row pull" style="--tc:var(--${tcls(x.card.tier)})" href="#user-${esc(x.id)}"><span class="tag">${esc(x.card.tier.toUpperCase())}</span><span class="grow"><b>${esc(x.name)}</b> pulled #${x.card.rank} ${esc(x.card.name)}${x.holo ? ' <b class="pull-sk">skibidi</b>' : ''}</span><small class="muted">${since(x.at)}</small></a>`).join('')
      : `<p class="muted small">${net.enabled() ? 'Nothing yet. Legendary and better pulls from every player show up here.' : 'Rare pulls from other players show up here once the site is online.'}</p>`;
  }
  function refreshFeeds() { const a = $('#feedTrades'), b = $('#feedPulls'); if (a) a.innerHTML = tradesFeedHTML(); if (b) b.innerHTML = pullsFeedHTML(); }

  function pageHome() {
    const d = D(), ents = Object.entries(S.cards).filter(([id, e]) => BYID[id] && e.n > 0), have = ents.length, total = CARDS.length || 1;
    const sk = ents.filter(([, e]) => e.h > 0).length, copies = ents.reduce((a, [, e]) => a + e.n, 0);
    const row = (list, empty) => list.length ? `<div class="card-row h">${list.map(([id, e]) => `<button class="card-btn" data-act="card" data-id="${id}">${cardHTML(BYID[id], { holo: e.h > 0, count: e.n, sk: e.h, fav: e.f })}</button>`).join('')}</div>` : `<div class="empty"><p>${empty}</p></div>`;
    const featured = CARDS.filter((c) => !c.monster || S.cards[c.id]).sort((a, b) => b.ti - a.ti || a.rank - b.rank).slice(0, 7);
    const tiles = [[pct2(have / total * 100), `Completion (${have} / ${CARDS.length})`], [fmt(copies), 'Cards owned'], [pct2(sk / total * 100), `Skibidi (${sk} / ${CARDS.length})`], [fmt(S.stats.opened), 'Packs opened'], [fmt(score()), 'Points']];
    main().innerHTML = `<section class="panel hero2">
        <div class="h2-left"><p class="eyebrow">PACKS AVAILABLE</p><div class="h2-count" data-packcount aria-live="polite"></div><p class="muted small">One pack every ${d.interval} minutes, up to ${d.cap} stored. They keep building up while you're away.</p></div>
        <div class="h2-mid"><button class="pack" data-act="open-1" data-needpack aria-label="Open a pack" style="--cnt:${pileCount(avail())}"><span class="stack" data-stack data-n="${avail()}">${pileHTML(avail(), 'fan')}</span></button>
          <div class="row center"><button class="btn primary" data-act="open-1" data-needpack>Open pack</button><button class="btn" data-act="open-all" data-needall hidden>Open all</button></div></div>
        <div class="h2-right"><div class="ring-wrap" role="timer" aria-label="Time until the next free pack"><svg class="ring" viewBox="0 0 120 120" aria-hidden="true"><circle class="ring-bg" cx="60" cy="60" r="52"/><circle class="ring-fg" data-ring cx="60" cy="60" r="52" transform="rotate(-90 60 60)"/></svg><div class="ring-text"><b data-ringtime>--:--</b><span data-ringlabel>next pack</span></div></div>
          <form class="codebox" id="homeCodeForm" autocomplete="off"><input id="homeCode" placeholder="Have a code?" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-label="Pack code"><button class="btn sm" type="submit">Redeem</button></form></div>
      </section>
      ${powerBanner()}${Object.keys(S.cards).length || S.stats.opened ? '' : '<div class="welcome"><b>New here?</b> Tap <i>Open pack</i>, then drag across the top of the pack to rip it open. Every card you pull counts towards your score.</div>'}
      <section class="panel prog"><div class="row between"><h2>Collection progress</h2><a class="more-link" href="#collection">Open collection →</a></div><div class="bar thick"><i style="width:${Math.min(100, have / total * 100)}%"></i></div>
        <div class="stat-tiles five">${tiles.map(([v, l]) => `<div class="stat-tile"><b>${v}</b><span>${l}</span></div>`).join('')}</div></section>
      <section><h2>Recently collected</h2>${row(ents.slice().sort((a, b) => lastSeen(b[1]) - lastSeen(a[1])).slice(0, 7), 'No cards yet. Open your first pack.')}</section>
      <section><h2>Your rarest cards</h2>${row(ents.slice().sort(rarityCmp).slice(0, 7), 'Your rarest cards show up here once you pull some.')}</section>
      <section><h2>Featured: the rarest cards in the game</h2><div class="card-row h">${featured.map((c) => { const x = S.cards[c.id]; return `<button class="card-btn" data-act="card" data-id="${c.id}">${cardHTML(c, { ghost: !x, holo: x && x.h > 0, count: x && x.n, sk: x && x.h })}</button>`; }).join('')}</div></section>
      <div class="feeds"><section class="panel feed"><h2>Recent trades</h2><div id="feedTrades">${tradesFeedHTML()}</div></section><section class="panel feed"><h2>Community rare pulls</h2><div id="feedPulls">${pullsFeedHTML()}</div></section></div>
      <p class="muted small hint">Shortcuts: <kbd>O</kbd> open pack · <kbd>A</kbd> open all · <kbd>1</kbd>–<kbd>7</kbd> switch pages · <kbd>/</kbd> search · right-click any card for its odds</p>`;
    $$('.h2-mid .pack', main()).forEach(packTilt); $$('.card', main()).forEach(tilt); updateHud(); if (net.enabled() && Date.now() - net.state.last > 20000) net.cycle();
  }

  const colState = { cat: 'all', tier: 'all', show: 'owned', sort: 'rank', q: '' };
  const colVar = {}; // which copy type (0 normal / 1 skibidi) each card in the collection is showing
  function pageCollection() {
    main().innerHTML = `<h1>Collection</h1><p class="muted">${owned().length} of ${CARDS.length} cards found. Tap a card for details.</p>
      <div class="filters panel">
        <label class="f">Search<input id="colq" type="search" value="${esc(colState.q)}" placeholder="Card name" autocomplete="off"></label>
        <label class="f">Set<select id="colcat"><option value="all">All sets</option>${Object.keys(CATS).map((k) => `<option ${colState.cat === k ? 'selected' : ''}>${k}</option>`).join('')}</select></label>
        <label class="f">Rarity<select id="coltier"><option value="all">All rarities</option>${TIERS.map((t) => `<option ${colState.tier === t ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <label class="f">Show<select id="colshow">${[['owned', 'Owned'], ['missing', 'Missing'], ['all', 'Everything'], ['holo', 'Skibidi only'], ['spare', 'Spares'], ['fav', 'Favorites'], ['wish', 'Wishlist']].map(([v, l]) => `<option value="${v}" ${colState.show === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="f">Sort<select id="colsort">${[['rank', 'Rank (rarest first)'], ['recent', 'Newest'], ['name', 'Name'], ['copies', 'Copies']].map(([v, l]) => `<option value="${v}" ${colState.sort === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      </div><div id="colgrid"></div>`;
    const draw = () => {
      let list = CARDS.filter((c) => (colState.cat === 'all' || c.cat === colState.cat) && (colState.tier === 'all' || c.tier === colState.tier) && (!colState.q || c.name.toLowerCase().includes(colState.q.toLowerCase())));
      const e = (c) => S.cards[c.id];
      list = list.filter((c) => { const x = e(c); switch (colState.show) { case 'owned': return !!x; case 'missing': return !x; case 'holo': return x && x.h > 0; case 'spare': return x && x.n > 1; case 'fav': return x && x.f; case 'wish': return !!S.wish[c.id]; default: return true; } });
      const by = { rank: (a, b) => a.rank - b.rank, name: (a, b) => a.name.localeCompare(b.name), recent: (a, b) => (e(b)?.t || 0) - (e(a)?.t || 0), copies: (a, b) => (e(b)?.n || 0) - (e(a)?.n || 0) || a.rank - b.rank };
      list.sort((a, b) => ((e(b) && e(b).f) ? 1 : 0) - ((e(a) && e(a).f) ? 1 : 0) || by[colState.sort](a, b)); // favorites always come first
      $('#colgrid').innerHTML = list.length ? `<div class="card-grid">${list.map((c) => { const x = e(c); const v = x ? (colVar[c.id] != null && (colVar[c.id] ? x.h > 0 : x.n - x.h > 0) ? colVar[c.id] : (x.h > 0 ? 1 : 0)) : 0; return `<div class="col-item ${x && x.n > 1 ? 'has-dupes' : ''} ${S.wish[c.id] ? 'wished' : ''}"><button class="card-btn" data-act="card" data-id="${c.id}" data-var="${v}" ${x ? '' : 'aria-label="Not found yet"'}>${cardHTML(c, { locked: !x, holo: x && v === 1, count: x && x.n, sk: x && x.h, fav: x && x.f })}</button></div>`; }).join('')}</div>` : '<div class="empty"><h2>Nothing here</h2><p class="muted">No cards match these filters.</p></div>';
      $$('#colgrid .card').forEach(tilt);
    };
    $('#colq').oninput = (ev) => { colState.q = ev.target.value; draw(); };
    $('#colcat').onchange = (ev) => { colState.cat = ev.target.value; draw(); };
    $('#coltier').onchange = (ev) => { colState.tier = ev.target.value; draw(); };
    $('#colshow').onchange = (ev) => { colState.show = ev.target.value; draw(); };
    $('#colsort').onchange = (ev) => { colState.sort = ev.target.value; draw(); };
    draw();
  }

  function pageIndex() {
    const cats = Object.keys(CATS);
    main().innerHTML = `<h1>Index</h1><p class="muted">Every card in the game, grouped by set. Greyed-out cards are ones you haven't pulled yet, and they light up the moment you get them. Right-click any card for its rarity and details.</p>` + cats.map((k) => {
      const list = CARDS.filter((c) => c.cat === k).sort((a, b) => b.ti - a.ti || a.name.localeCompare(b.name)), got = list.filter((c) => S.cards[c.id]).length;
      return `<section class="panel set"><div class="set-head"><div><h2>${k}</h2><p class="muted small">${CATS[k].blurb}</p></div><div class="set-prog"><b>${got}/${list.length}</b><div class="bar"><i style="width:${got / list.length * 100}%"></i></div></div></div>
        <div class="card-grid small idx-grid">${list.map((c) => { const x = S.cards[c.id]; return `<button class="card-btn" data-act="card" data-id="${c.id}">${cardHTML(c, { ghost: !x && !c.monster, locked: !x && c.monster, holo: x && x.h > 0, count: x && x.n, sk: x && x.h, size: 128 })}</button>`; }).join('')}</div></section>`;
    }).join('') + `<section class="panel"><h2>By rarity</h2><div class="tier-prog">${TIERS.map((t, i) => { const l = G.BYTIER[i], g = l.filter((c) => S.cards[c.id]).length; return `<div class="${tcls(t)}"><span>${t}</span><div class="bar"><i style="width:${l.length ? g / l.length * 100 : 0}%"></i></div><b>${g}/${l.length}</b></div>`; }).join('')}</div></section>`;
    $$('.idx-grid .card', main()).forEach(tilt);
  }

  // ---------- right-click card info ----------
  (function () {
    let box = null;
    const close = () => { if (box) { box.remove(); box = null; } };
    const pct = (x) => (x * 100).toFixed(x < 0.01 ? 2 : 1) + '%';
    const row = (k, v) => `<dt>${k}</dt><dd>${v}</dd>`;
    function show(c, x, y) {
      close();
      const d = D(), list = dropList(), live = G.eventMult(c, 'weight') !== 1 || G.eventMult(c, 'holo') !== 1;
      const w = dropWeights(d, false, list), tot = w.reduce((a, b) => a + b, 0) || 1, idx = list.indexOf(c);
      const p = list.reduce((a, x, i) => a + (x.ti === c.ti ? w[i] : 0), 0) / tot; // chance that a slot is this rarity
      const per = idx >= 0 ? w[idx] / tot : 0, perPack = 1 - Math.pow(1 - per, CARDS_PER_PACK), e = S.cards[c.id];
      const hp = holoP(c), sk = e && e.h > 0;
      box = document.createElement('div'); box.className = 'ctx'; box.setAttribute('role', 'dialog');
      box.style.setProperty('--tc', `var(--${tcls(c.tier)})`);
      if (c.monster && !e) { box.innerHTML = `<h3>???</h3><div class="sub">${esc(c.cat)} · ${c.tier}</div><dl>${row('Points', c.pts)}${row('Found in', 'Something hungry')}</dl>`; }
      else box.innerHTML = `<h3>${esc(c.name)}</h3><div class="sub">${esc(c.cat)} · Rank #${c.rank}</div><dl>
        ${row('Rarity', `<span style="color:var(--tc)">${c.tier}</span>`)}
        ${row('Points', c.pts + (G.GS.holoMult !== 1 ? ` <small class="muted">(${fmt(c.pts * G.GS.holoMult)} skibidi)</small>` : ''))}
        ${c.off ? row('Drops', 'Not in packs right now') : c.monster && !S.settings.monster ? row('Drops', 'Only with the monster let in') : row('Chance per slot', pct(p))}
        ${c.off || idx < 0 ? '' : row('This exact card', pct(per))}
        ${perPack > 0 ? row('Per pack', `about 1 in ${Math.round(1 / perPack).toLocaleString()}`) : ''}
        ${row('Skibidi chance', pct(hp))}
        ${live ? row('Power hour', '<span style="color:var(--tc)">boost running</span>') : ''}</dl><hr>
        <dl>${e ? row('Copies owned', e.n + (e.h ? ` (${e.h} skibidi)` : '')) + row('First pulled', new Date(e.t).toLocaleDateString('en-GB')) : row('Status', 'Not pulled yet')}</dl>`;
      document.body.append(box);
      const r = box.getBoundingClientRect();
      box.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + 'px';
      box.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + 'px';
    }
    document.addEventListener('contextmenu', (ev) => {
      const el = ev.target.closest && ev.target.closest('.card[data-id]'), c = el && BYID[el.dataset.id];
      if (!c) { close(); return; }
      ev.preventDefault(); show(c, ev.clientX + 12, ev.clientY + 12);
    });
    ['click', 'scroll', 'resize', 'blur'].forEach((t) => addEventListener(t, close, true));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  })();

  function pageSettings() {
    main().innerHTML = `<h1>Settings</h1>
      <section class="panel"><h2>Sound and motion</h2><div class="row wrap">
        <label class="check"><input id="optSound" type="checkbox" ${S.settings.sound ? 'checked' : ''}> Sound effects</label>
        <label class="f inline">Volume<input id="optVol" type="range" min="0" max="1" step="0.05" value="${S.settings.volume}"></label>
        <label class="check"><input id="optMotion" type="checkbox" ${S.settings.motion ? 'checked' : ''}> Animations</label></div></section>
      <section class="panel"><h2>The Monster 👹</h2><label class="check"><input id="optMonster" type="checkbox" ${S.settings.monster ? 'checked' : ''}> Let the monster in</label><p class="muted small">Each pack you open has a 25% chance that the monster eats one random card from it. Eaten cards are gone for good and never reach your collection. But with the monster in, ${G.MONSTER_POOL.length} special cards of the Monster rarity can also drop that cannot be found any other way. Monster is a little rarer than Sigma.</p></section>
      <section class="panel"><h2>Card images 🖼️</h2><p class="muted small">Think a card needs a better picture? Pick the card, send your image, and an admin can approve it. If it is approved, everyone sees it.</p><a class="btn" href="#imagereq">Request a card image</a></section>
      <section class="panel"><h2>Card suggestions 💡</h2><p class="muted small">Want a card or a whole set that is not in the game yet? Suggest it, with a picture if you have one. If an admin approves it, it is added for everyone.</p><a class="btn" href="#suggest">Suggest a card or set</a></section>
      ${net ? net.settingsHTML() : ''}
      ${auth ? auth.settingsHTML() : ''}
      ${admin ? admin.settingsHTML() : ''}`;
    $('#optSound').onchange = (e) => { S.settings.sound = e.target.checked; applyAudio(); save(); renderHeader(); };
    $('#optVol').oninput = (e) => { S.settings.volume = +e.target.value; applyAudio(); save(); };
    $('#optMotion').onchange = (e) => { S.settings.motion = e.target.checked; save(); };
    if (net) net.bindSettings();
    if (auth) auth.bindSettings();
    if (admin) admin.bindSettings();
    $('#optMonster').onchange = (e) => { S.settings.monster = e.target.checked; save(); toast(e.target.checked ? 'The monster is hungry...' : 'The monster went back to sleep'); };
  }
  function applyAudio() { configureAudio({ sound: S.settings.sound, volume: S.settings.volume }); }

  // ---------- popovers (click a card) ----------
  // One floating panel at a time, placed next to the thing that was clicked. Used for card info here and for picking copies in trades.
  const popup = { el: null, key: null, onClose: null };
  function popClose() { if (!popup.el) return; const f = popup.onClose; popup.el.remove(); popup.el = null; popup.key = null; popup.onClose = null; if (f) f(); }
  function popPlace(anchor) {
    const el = popup.el; if (!el) return;
    if (innerWidth <= 720 || !anchor || !anchor.isConnected) { el.classList.add('sheet'); el.style.left = el.style.top = ''; return; }
    el.classList.remove('sheet');
    const r = el.getBoundingClientRect(), a = anchor.getBoundingClientRect(); let left = a.right + 10;
    if (left + r.width > innerWidth - 8) left = a.left - r.width - 10;
    if (left < 8) left = Math.max(8, Math.min(innerWidth - r.width - 8, a.left + a.width / 2 - r.width / 2));
    el.style.left = left + 'px'; el.style.top = Math.max(8, Math.min(a.top, innerHeight - r.height - 8)) + 'px';
  }
  function popOpen(anchor, html, o) {
    o = o || {}; popClose();
    const el = document.createElement('div'); el.className = 'cardpop ' + (o.cls || ''); el.setAttribute('role', 'dialog'); el.innerHTML = html; document.body.append(el);
    popup.el = el; popup.key = o.key || null; popup.onClose = o.onClose || null; popPlace(anchor); $$('.card', el).forEach(tilt); return el;
  }
  function popSet(html) { if (popup.el) { popup.el.innerHTML = html; $$('.card', popup.el).forEach(tilt); } }
  // Click anywhere else (except on something that opens a popover itself) to close it. Capture phase, so a new popover can open straight after.
  document.addEventListener('click', (e) => { if (popup.el && !e.target.closest('.cardpop') && !e.target.closest('.zoomview') && !e.target.closest('[data-act="card"],[data-pick]')) popClose(); }, true);
  addEventListener('scroll', () => { if (popup.el && popup.key && popup.key.indexOf('card:') === 0) popClose(); }, true);
  addEventListener('resize', popClose);

  // Every copy of a card as its own card, like the reference. cards = whose collection to show (mine by default).
  function cardPopHTML(id, cards, who) {
    const c = BYID[id], e = cards[id], own = !!(e && e.n > 0), mine = !who, copies = [];
    if (own) { for (let i = 0; i < e.h; i++) copies.push(1); for (let i = 0; i < e.n - e.h; i++) copies.push(0); } // skibidi copies count first (see scoring)
    const n = copies.length, shown = copies.slice(0, 24), size = !own ? 176 : n <= 2 ? 176 : n <= 4 ? 150 : n <= 8 ? 120 : 96, mineE = S.cards[id], iOwn = !!(mineE && mineE.n > 0);
    const tiles = own ? shown.map((h, k) => `<button type="button" class="pop-copy" data-act="card-open" data-id="${id}" data-v="${h}" data-k="${k + 1}" aria-label="Open details for copy ${k + 1}">${cardHTML(c, { holo: !!h, size })}<small class="pop-val">${k ? `copy ${k + 1} · ` : ''}+${fmtPts(G.copyValue(c, k + 1, h))} pt${G.copyValue(c, k + 1, h) === 1 ? '' : 's'}</small></button>`).join('') : `<button type="button" class="pop-copy" data-act="zoom" data-id="${id}" data-h="0" data-k="0" data-locked="1" aria-label="Look closer">${cardHTML(c, { locked: !!c.monster, ghost: !c.monster, size })}</button>`;
    const action = mine ? (own ? `<button class="btn sm" data-act="fav" data-id="${id}">${e.f ? '★ Unfavorite' : '☆ Favorite'}</button>` : `<button class="btn sm ${S.wish[id] ? 'primary' : ''}" data-act="wish" data-id="${id}">${S.wish[id] ? '🔖 On your wishlist' : '🔖 Add to wishlist'}</button>`)
      : (!iOwn ? `<button class="btn sm ${S.wish[id] ? 'primary' : ''}" data-act="wish" data-id="${id}">${S.wish[id] ? '🔖 On your wishlist' : '🔖 Add to wishlist'}</button>` : '');
    return `<div class="pop-head"><div class="pop-title"><b>#${c.rank} ${own || !c.monster ? esc(c.name) : '???'}</b><span class="muted small">${own ? `${n} cop${n === 1 ? 'y' : 'ies'}${e.h ? ` · ${e.h} skibidi` : ''}${who ? ` · ${esc(who)}` : ''}` : who ? `${esc(who)} has none` : 'Not found yet'}</span></div><button type="button" class="pop-x" data-act="close-pop" aria-label="Close">✕</button></div>
      <div class="pop-copies">${tiles}</div>${n > shown.length ? `<p class="muted small">Showing ${shown.length} of ${n} copies.</p>` : ''}
      <div class="pop-foot"><span class="pop-meta"><span class="tier-text ${tcls(c.tier)}">${c.tier}</span> · ${esc(c.cat)} · ${c.pts} pt${c.pts === 1 ? '' : 's'}</span>${action}</div>`;
  }
  const fmtPts = (v) => (Math.abs(v - Math.round(v)) < 0.05 ? String(Math.round(v)) : v.toFixed(1));
  // Click a copy in the card popup to see it big. Arrow keys / buttons step through the copies.
  function zoomCard(tile) {
    const list = $$('.pop-copy[data-id]', popup.el || document).map((t) => ({ id: t.dataset.id, h: +t.dataset.h, k: +t.dataset.k, locked: !!t.dataset.locked }));
    if (!list.length) return;
    let i = Math.max(0, $$('.pop-copy[data-id]', popup.el || document).indexOf(tile));
    const bg = document.createElement('div'); bg.className = 'zoomview'; bg.setAttribute('role', 'dialog'); bg.setAttribute('aria-modal', 'true'); bg.setAttribute('aria-label', 'Card close-up');
    document.body.append(bg);
    const draw = () => {
      const it = list[i], c = BYID[it.id], w = Math.round(Math.max(180, Math.min(440, innerWidth * 0.86, (innerHeight - 190) * 5 / 7)));
      bg.innerHTML = `<button type="button" class="zoom-x" data-zoom="close" aria-label="Close">✕</button>
        ${list.length > 1 ? '<button type="button" class="zoom-nav prev" data-zoom="prev" aria-label="Previous copy">‹</button><button type="button" class="zoom-nav next" data-zoom="next" aria-label="Next copy">›</button>' : ''}
        <div class="zoom-stage">${cardHTML(c, { holo: !!it.h, size: w, locked: it.locked && c.monster, ghost: it.locked && !c.monster })}</div>
        <p class="zoom-cap"><b>#${c.rank} ${it.locked && c.monster ? '???' : esc(c.name)}</b><span class="muted">${esc(c.tier)} · ${esc(c.cat)}${list.length > 1 ? ` · copy ${i + 1} of ${list.length}` : ''}${it.k ? ` · worth ${fmtPts(G.copyValue(c, it.k, it.h))} pt${G.copyValue(c, it.k, it.h) === 1 ? '' : 's'}` : ''}</span></p>`;
      $$('.card', bg).forEach(tilt);
    };
    const close = () => { bg.remove(); removeEventListener('keydown', key, true); };
    const step = (d) => { i = (i + d + list.length) % list.length; draw(); };
    const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); } else if (list.length > 1 && e.key === 'ArrowRight') step(1); else if (list.length > 1 && e.key === 'ArrowLeft') step(-1); };
    bg.addEventListener('click', (e) => { const z = e.target.closest('[data-zoom]'); if (z) { z.dataset.zoom === 'close' ? close() : step(z.dataset.zoom === 'next' ? 1 : -1); } else if (!e.target.closest('.card')) close(); });
    addEventListener('keydown', key, true); draw(); SFX.click(); const x = $('.zoom-x', bg); if (x) x.focus({ preventScroll: true });
  }
  // ---------- card page ----------
  // Clicking a card opens this page: the card big and draggable in 3D on the left, its details on the right. Several copies are shown as a
  // switch between the normal and skibidi versions plus what each copy is worth, so there is no separate duplicates view any more.
  const cv = { id: '', src: '', v: 0, rx: 0, ry: 0 };
  const cvCards = () => { if (cv.src) { const o = net.state.dir.find((p) => p.id === cv.src); if (o) return o.cards; } return S.cards; };
  const odds = (p) => (p <= 0 ? 'Not in packs' : `${(p * 100).toFixed(p < 0.0001 ? 5 : p < 0.01 ? 4 : 2)}% (1 in ${Math.round(1 / p).toLocaleString('en-GB')})`);
  function cardPop(id, anchor, src, v) { cardView(id, src, v); }
  function cardView(id, src, v) {
    if (!BYID[id]) return; popClose();
    const old = $('.modal-bg .cardview'); if (old) closeModal(old.closest('.modal-bg'));
    const other = src ? net.state.dir.find((p) => p.id === src) : null; if (cv.stop) cv.stop(); cv.id = id; cv.src = other && other.id !== S.profile.id ? other.id : ''; cv.rx = cv.ry = 0;
    const e = cvCards()[id]; cv.v = e && e.h > 0 ? 1 : 0; if (v === 0 || v === 1) cv.v = v; // cvDraw corrects it if you do not own that version
    modal('<div class="cv"></div>', 'cardview'); cvDraw();
  }
  // The rim of the spinning card: its outline (straight sides plus the four rounded corners, each cut into short segments) extruded to the card's thickness, with a baked light from the top-left.
  // hex colour -> [hue, saturation %, lightness %]
  function hexHsl(hex) {
    const m = /^#([0-9a-f]{6})$/i.exec(String(hex || '')); if (!m) return [222, 0, 55];
    const n = parseInt(m[1], 16), r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
    if (!d) return [0, 0, Math.round(l * 100)];
    const sat = d / (1 - Math.abs(2 * l - 1)); let hu = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [Math.round(((hu * 60) + 360) % 360), Math.round(sat * 100), Math.round(l * 100)];
  }
  function cvSlab(w, color, gray) {
    const rim = gray ? [0, 0, 52] : hexHsl(color), h = w * 1.4, R = w * 0.0648, T = Math.max(7, Math.round(w * 0.03)), N = 16, pts = [];
    const arc = (cx, cy, a0) => { for (let i = 1; i < N; i++) { const t = (a0 + 90 * i / N) * Math.PI / 180; pts.push([cx + R * Math.cos(t), cy + R * Math.sin(t)]); } };
    pts.push([R, 0], [w - R, 0]); arc(w - R, R, 270); pts.push([w, R], [w, h - R]); arc(w - R, h - R, 0); pts.push([w - R, h], [R, h]); arc(R, h - R, 90); pts.push([0, h - R], [0, R]); arc(R, R, 180);
    let out = '';
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy); if (L < 0.01) continue;
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2; let nx = dy / L, ny = -dx / L; let flip = 90; if (nx * (mx - w / 2) + ny * (my - h / 2) < 0) { nx = -nx; ny = -ny; flip = -90; }
      const lit = Math.max(0, nx * -0.55 + ny * -0.7), light = gray ? Math.round(30 + 34 * lit) : Math.max(14, Math.min(94, Math.round(rim[2] * (0.5 + 0.75 * lit))));
      out += `<i class="cv-seg" style="width:${(L + 1.2).toFixed(2)}px;height:${T}px;background:hsl(${rim[0]} ${rim[1]}% ${light}%);transform:translate3d(${(mx - L / 2 - 0.6).toFixed(2)}px,${(my - T / 2).toFixed(2)}px,0) rotateZ(${Math.atan2(dy, dx).toFixed(4)}rad) rotateX(${flip}deg)"></i>`;
    }
    return out;
  }
  function cvApply() { const d = $('.cardview .cv-3d'); if (d) { d.style.setProperty('--rx', cv.rx + 'deg'); d.style.setProperty('--ry', cv.ry + 'deg'); d.style.setProperty('--gx', (50 + Math.sin(cv.ry * Math.PI / 180) * 70).toFixed(1) + '%'); d.style.setProperty('--gy', (45 - Math.sin(cv.rx * Math.PI / 180) * 70).toFixed(1) + '%'); } }
  function cvDraw() {
    const box = $('.cardview .cv'); if (!box) return;
    const id = cv.id, c = BYID[id], o = cv.src ? net.state.dir.find((p) => p.id === cv.src) : null, who = o ? o.name : '', cards = cvCards(), e = cards[id], own = !!(e && e.n > 0), mine = !cv.src;
    if (own) { if (cv.v && !(e.h > 0)) cv.v = 0; if (!cv.v && e.n - e.h <= 0) cv.v = 1; } else cv.v = 0;
    const hidden = c.monster && !own, both = own && e.h > 0 && e.n - e.h > 0;
    const w = Math.round(Math.max(190, Math.min(300, innerWidth * 0.64, (innerHeight - 250) * 5 / 7)));
    const d = D(), list = dropList(), idx = list.indexOf(c), wt = dropWeights(d, false, list), tot = wt.reduce((a, b) => a + b, 0) || 1, per = idx >= 0 ? wt[idx] / tot : 0, perPack = 1 - Math.pow(1 - per, CARDS_PER_PACK), hp = holoP(c);
    const vals = own ? Array.from({ length: Math.min(e.n, 8) }, (_, i) => G.copyValue(c, i + 1, i < e.h)) : [];
    const row = (k, v) => `<dt>${k}</dt><dd>${v}</dd>`, mult = G.GS.holoMult, fn = (v) => G.GS.holoMult && fmtPts(v);
    const action = mine ? (own ? `<button class="btn sm" data-act="fav" data-id="${id}">${e.f ? '★ Unfavorite' : '☆ Favorite'}</button>` : `<button class="btn sm ${S.wish[id] ? 'primary' : ''}" data-act="wish" data-id="${id}">${S.wish[id] ? '🔖 On your wishlist' : '🔖 Add to wishlist'}</button>`) : (!(S.cards[id] && S.cards[id].n > 0) ? `<button class="btn sm ${S.wish[id] ? 'primary' : ''}" data-act="wish" data-id="${id}">${S.wish[id] ? '🔖 On your wishlist' : '🔖 Add to wishlist'}</button>` : '');
    const frame = box.querySelector('.cv-3d'), keep = !!frame && frame.dataset.id === id + ':' + cv.v + ':' + (hidden ? 1 : 0);
    box.innerHTML = `<div class="cv-left"><div class="cv-stage no-tilt" title="Drag to spin"><div class="cv-3d${own ? '' : ' cv-gray'}" data-id="${id}:${cv.v}:${hidden ? 1 : 0}" style="--cw:${w}px;--thick:${Math.max(7, Math.round(w * 0.03))}px;--rx:${cv.rx}deg;--ry:${cv.ry}deg"><div class="cv-face cv-front">${cardHTML(c, { holo: !!cv.v, size: w, locked: hidden && !!c.monster })}<i class="cv-glare"></i></div>${cvSlab(w, G.TIER_COLOR[c.tier], !own)}<div class="cv-face cv-back"><div class="card-back">${BOLT}</div></div></div></div>
        <div class="cv-ctl"><button class="btn sm" data-cv="flip" type="button">Flip</button><button class="btn sm" data-cv="reset" type="button">Reset</button><span class="muted small">Drag to spin</span></div></div>
      <div class="cv-right"><h2 class="cv-title">#${c.rank} ${hidden ? '???' : esc(c.name)}</h2>
        <div class="cv-tier tier-text ${tcls(c.tier)}">${c.tier.toUpperCase()}</div>
        ${both ? `<div class="cv-vars" role="group" aria-label="Version"><button type="button" class="btn sm ${cv.v ? '' : 'primary'}" data-cv="v0">Normal ×${e.n - e.h}</button><button type="button" class="btn sm ${cv.v ? 'primary' : ''}" data-cv="v1">✦ Skibidi ×${e.h}</button></div>` : ''}
        <dl class="cv-dl">${row('Set', esc(c.cat))}${row('Rank', `#${c.rank} of ${CARDS.filter((x) => !x.off).length}`)}
          ${row('Score value', `${fmtPts(c.pts)} pts <span class="muted">(${fmtPts(c.pts * mult)} as a skibidi)</span>`)}
          ${row(who ? `${esc(who)}'s score from this card` : 'Your score from this card', own ? `${fmtPts(G.cardScore(c, e))} pts <span class="muted">(${e.n === 1 ? 'their only copy'.replace('their', who ? 'their' : 'your') : 'all ' + e.n + (who ? ' of their' : ' of your') + ' copies'})</span>` : '—')}
          ${vals.length > 1 ? row('Copy values', `<span class="cv-copies">${vals.map((v, i) => `<span class="${i < e.h ? 'holo' : ''}">${i + 1}${['st', 'nd', 'rd'][i] || 'th'}: ${fmtPts(v)}</span>`).join('')}${e.n > 8 ? '<span>…</span>' : ''}</span><small class="muted">Each extra copy is worth 1/N of the first.</small>`) : ''}
          ${row('Drop chance', c.monster && !S.settings.monster ? 'Only while the monster is let in (Settings)' : per > 0 ? `${odds(per)} per card<br><span class="muted">${(perPack * 100).toFixed(perPack < 0.01 ? 3 : 2)}% per pack</span>` : 'Not in packs')}
          ${per > 0 ? row('Skibidi chance', `${odds(per * hp)} per card`) : ''}
          ${row(who ? `${esc(who)} owns` : 'You own', own ? `${e.n - e.h} normal · ${e.h} skibidi` : who ? 'None' : 'Not found yet')}</dl>
        <p class="cv-blurb muted">${esc(CATS[c.cat] ? CATS[c.cat].blurb : '')}</p>
        <div class="row wrap">${action}</div></div>`;
    if (keep) { /* same card: nothing else to do */ }
    cvApply(); const st = $('.cardview .cv-3d'); if (st) st.style.transition = '';
  }
  function popRefresh() { if (popup.el && popup.key && popup.key.indexOf('card:') === 0) popSet(cardPopHTML(popup.key.slice(5), S.cards)); }
  function cardPopRefresh() { if ($('.cardview .cv')) cvDraw(); }
  // dragging the card spins it; Flip turns it over; Reset brings it back
  (function () {
    let dr = null, raf = 0, hist = [];
    // Letting go while spinning keeps the card turning: it carries the speed of the last moments of the drag and slows down by friction.
    const stopSpin = () => { if (raf) cancelAnimationFrame(raf); raf = 0; };
    cv.stop = stopSpin;
    function coast(v) {
      let last = performance.now();
      const frame = (now) => {
        const d = $('.cardview .cv-3d'); if (!d) { raf = 0; return; }
        const dt = Math.min(50, now - last), k = dt / 16.667; last = now;
        cv.ry += v * dt; v *= Math.pow(0.97, k); cv.rx += (0 - cv.rx) * (1 - Math.pow(0.9, k));
        if (Math.abs(v) < 0.01 && Math.abs(cv.rx) < 0.2) { cv.rx = 0; cvApply(); raf = 0; return; }
        cvApply(); raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
    }
    document.addEventListener('pointerdown', (e) => { const st = e.target.closest && e.target.closest('.cv-stage'); if (!st) return; stopSpin(); hist = [{ t: performance.now(), y: cv.ry }]; dr = { x: e.clientX, y: e.clientY, rx: cv.rx, ry: cv.ry }; try { st.setPointerCapture(e.pointerId); } catch (er) { /* ignore */ } const d = $('.cv-3d', st); if (d) d.style.transition = 'none'; });
    document.addEventListener('pointermove', (e) => {
      if (!dr) return; cv.ry = dr.ry + (e.clientX - dr.x) * 0.6; cv.rx = Math.max(-40, Math.min(40, dr.rx - (e.clientY - dr.y) * 0.4)); cvApply();
      const nw = performance.now(); hist.push({ t: nw, y: cv.ry }); while (hist.length > 2 && nw - hist[0].t > 100) hist.shift();
      const card = $('.cv-front .card'), st = $('.cv-stage'); if (card && st) { const b = st.getBoundingClientRect(), x = (e.clientX - b.left) / b.width, y = (e.clientY - b.top) / b.height; card.style.setProperty('--mx', (x * 100).toFixed(1) + '%'); card.style.setProperty('--my', (y * 100).toFixed(1) + '%'); }
    });
    const up = () => { if (!dr) return; dr = null; const d = $('.cv-3d');
      // speed over the last ~100ms of the drag (deg per ms); a pause before letting go means no coasting
      const nw = performance.now(), a = hist[0], b = hist[hist.length - 1]; let v = a && b && b.t > a.t && nw - b.t < 80 ? (b.y - a.y) / (b.t - a.t) : 0; hist = []; v = Math.max(-3, Math.min(3, v));
      if (d && !reduceMotion() && Math.abs(v) > 0.05) { d.style.transition = 'none'; coast(v); return; }
      if (d) { d.style.transition = 'transform .6s cubic-bezier(.2,.8,.2,1)'; cv.rx = 0; cvApply(); } };
    document.addEventListener('pointerup', up); document.addEventListener('pointercancel', up);
    document.addEventListener('click', (e) => {
      const t = e.target.closest && e.target.closest('[data-cv]'); if (!t) return; const a = t.dataset.cv, d = $('.cv-3d');
      if (a === 'v0' || a === 'v1') { cv.v = a === 'v1' ? 1 : 0; cvDraw(); return; }
      stopSpin(); if (d) d.style.transition = 'transform .7s cubic-bezier(.3,.9,.3,1)';
      if (a === 'flip') { cv.ry += 180; cv.rx = 0; } else if (a === 'reset') { cv.ry = Math.round(cv.ry / 360) * 360; cv.rx = 0; if (!cv.ry) cv.ry = 0; }
      SFX.click(); cvApply();
    });
  })();

  // ---------- pack opening ----------
  let opening = false;
  function particles(canvas) {
    const g = canvas.getContext('2d'); let ps = [], run = true;
    const fit = () => { canvas.width = innerWidth; canvas.height = innerHeight; }; fit(); addEventListener('resize', fit);
    function burst(colors, n, rain, bx, by) {
      if (reduceMotion()) n = Math.floor(n / 4);
      for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, v = 3 + Math.random() * 9; ps.push({ x: bx != null ? bx : canvas.width / 2, y: rain ? -10 : by != null ? by : canvas.height * 0.45, vx: rain ? (Math.random() - 0.5) * 6 : Math.cos(a) * v, vy: rain ? 2 + Math.random() * 5 : Math.sin(a) * v - 3, s: 2 + Math.random() * 5, l: 1, c: pick(colors) }); }
    }
    (function frame() { if (!run) return; g.clearRect(0, 0, canvas.width, canvas.height);
      ps = ps.filter((p) => p.l > 0); ps.forEach((p) => { p.x += p.vx; p.y += p.vy; p.vy += 0.18; p.vx *= 0.99; p.l -= 0.012; g.globalAlpha = Math.max(0, p.l); g.fillStyle = p.c; g.fillRect(p.x, p.y, p.s, p.s); });
      requestAnimationFrame(frame); })();
    return { burst, stop() { run = false; removeEventListener('resize', fit); } };
  }
  const TC = G.TIER_COLOR, RAINBOW = ['#ff4d6d', '#ffb02e', '#4cc38a', '#4aa3ff', '#b36bff', '#ffffff'];

  const MONSTER = '<div class="monster-card"><svg viewBox="0 0 100 140" aria-hidden="true"><path d="M24 44 L16 16 L40 36Z M76 44 L84 16 L60 36Z" fill="#4ade80"/><ellipse cx="50" cy="80" rx="42" ry="48" fill="#4a24a0"/><circle cx="34" cy="64" r="11" fill="#fff"/><circle cx="66" cy="64" r="11" fill="#fff"/><circle cx="37" cy="66" r="5" fill="#111"/><circle cx="63" cy="66" r="5" fill="#111"/><path d="M20 94 Q50 132 80 94 Q50 106 20 94Z" fill="#12061f"/><path d="M27 96 L33 108 L39 98 L45 110 L51 98 L57 110 L63 98 L69 108 L75 96 Z" fill="#fff"/></svg><span>CHOMP</span></div>';
  let preparing = false;
  async function openPacks(n) {
    if (opening || preparing) return;
    const want = n;
    // Another device may have opened packs since this one last synced: catch up first, so the same pack cannot be opened twice.
    if (net && auth && auth.loggedIn() && net.enabled()) { preparing = true; let ok = false; try { ok = await Promise.race([net.syncNow(), new Promise((r) => setTimeout(() => r(false), 10000))]); } catch (e) { ok = false; } preparing = false;
      if (!ok) { toast('Could not reach your account to check for other devices. Try again in a moment.', true); return; } }
    tick(); n = Math.min(n, avail());
    if (opening || n < 1) { if (want >= 1 && n < 1) { toast('No packs left. Your account was updated from another device.', true); renderHeader(); route(true); } return; }
    opening = true; unlockAudio(); applyAudio(); updateHud();
    const results = []; for (let i = 0; i < n; i++) { if (S.packs > 0) { S.packs--; S.sp = (S.sp || 0) + 1; } else S.bonus--; results.push(rollPack()); } // sp = regular packs spent since the last upload (merged by difference)
    if (S.packs < D().cap) S.last = Math.max(S.last, Date.now() - (Date.now() - S.last)); save();
    const eatenAll = results.flat().filter((o) => o.eaten); let all = results.flat().filter((o) => !o.eaten); const single = n === 1;
    const ov = document.createElement('div'); ov.className = 'opening'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', 'Opening ' + (single ? 'a pack' : n + ' packs'));
    ov.innerHTML = `<canvas aria-hidden="true"></canvas><div class="flash"></div><button class="btn skip">Skip</button><p class="sr-only" aria-live="assertive" id="announce"></p><div class="stage-pack"><div class="pack${n > 1 ? ' multi' : ''}" style="--cnt:${pileCount(n)}">${pileHTML(n, 'tight')}</div></div><p class="tap-hint">${single ? 'Drag across the top of the pack to rip it open' : `Drag across the top of the front pack to rip it open (all ${n} packs open together)`}</p>`;
    document.body.append(ov); document.documentElement.classList.add('modal-open', 'pack-open');
    const fx = particles($('canvas', ov)); let skipped = false;
    const wait = (ms) => sleep(skipped || reduceMotion() ? Math.min(ms, 25) : ms), say = (t) => ($('#announce', ov).textContent = t);
    let ripGo = null; $('.skip', ov).onclick = () => { skipped = true; if (ripGo) ripGo(); }; $('.skip', ov).focus();
    const stage = $('.stage-pack', ov);
    // Rip it open: press near the top of the pack and drag across. (Enter / Space or Skip also tear it, for keyboards.)
    const tapColors = ['#b794ff', '#4ade80', '#fff', '#8b5cf6'];
    const pack0 = $('.pack', stage); packTilt(pack0); stage.style.touchAction = 'none'; stage.tabIndex = 0; stage.setAttribute('aria-label', single ? 'Pack. Drag across the top to rip it open, or press Enter.' : n + ' packs stacked. Drag across the top to slice them all open, or press Enter.');
    const glint = document.createElement('i'); glint.className = 'tear-glint'; pack0.append(glint);
    // Cut the top strip into slices (each a copy of the strip, clipped) so it can peel up progressively along the drag instead of sliding off in one piece.
    (function () {
      const top = $('.ppk:last-child .bag-top', pack0) || $('.bag-top', pack0); if (!top || reduceMotion()) return; const bag = top.parentNode, N = 14, strip = document.createElement('div'); strip.className = 'tearstrip';
      for (let i = 0; i < N; i++) { const sl = document.createElement('div'); sl.className = 'ts'; sl.style.setProperty('--i', i); sl.style.clipPath = `inset(0 ${Math.max(0, 100 - (i + 1) / N * 100 - 0.25).toFixed(2)}% 0 ${(i / N * 100).toFixed(2)}%)`; sl.append(top.cloneNode(true)); strip.append(sl); }
      const slot = document.createElement('div'); slot.className = 'pack-slot'; bag.insertBefore(slot, top); bag.insertBefore(strip, top); top.style.display = 'none';
    })();
    const ripped = new Promise((resolve) => {
      let drag = null, lastTick = 0, done = false, lastSpark = 0;
      const set = (v) => { stage.style.setProperty('--rip', v.toFixed(3)); if (v - lastSpark > 0.06 && !done) { lastSpark = v; if (navigator.vibrate) navigator.vibrate(5); const r = pack0.getBoundingClientRect(); fx.burst(['#ffffff', '#e9e3ff', '#b794ff'], 3, false, r.left + r.width * Math.min(1, v), r.top + r.height * 0.1); } if (v < 0.05) lastSpark = 0; };
      const finishRip = () => { if (done) return; done = true; drag = null; set(1); stage.classList.remove('ripping'); if (!reduceMotion()) pack0.animate([{ scale: '1' }, { scale: '1.06' }, { scale: '1' }], { duration: 300, easing: 'ease-out' }); resolve(); };
      ripGo = finishRip;
      stage.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); finishRip(); } });
      stage.addEventListener('pointerdown', (ev) => {
        if (done) return;
        const r = pack0.getBoundingClientRect(), pk = ev.target.closest && ev.target.closest('.ppk'), onBack = !!pk && !pk.matches(':last-child'), // a tear only starts on the TOP edge of the FRONT pack: not on the packs peeking out behind it, not beside it
          nearTop = !onBack && ev.clientY >= r.top - 4 && ev.clientY < r.top + r.height * 0.3 && ev.clientX >= r.left - 4 && ev.clientX <= r.right + 4;
        if (nearTop) { drag = { x: ev.clientX, id: ev.pointerId, w: r.width }; try { stage.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ } stage.classList.add('ripping'); }
        else { pack0.classList.remove('tap'); void pack0.offsetWidth; pack0.classList.add('tap'); SFX.click(); fx.burst(tapColors, 10, false, ev.clientX, ev.clientY); const hint = $('.tap-hint', ov); if (hint) hint.classList.add('nudge'); }
      });
      stage.addEventListener('pointermove', (ev) => {
        if (!drag || done) return;
        const v = Math.min(1, Math.abs(ev.clientX - drag.x) / (drag.w * 0.75)); set(v);
        if (v - lastTick > 0.12) { lastTick = v; SFX.shake(1); }
        if (v >= 1) finishRip();
      });
      const up = () => { if (!drag || done) return; drag = null; lastTick = 0; stage.classList.remove('ripping'); set(0); };
      stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up);
    });
    const finish = () => { fx.stop(); ov.remove(); opening = false; if (stalePending) { stalePending = false; try { const j = JSON.parse(localStorage.getItem(KEY)); if (j && (+j.mod || 0) > (S.mod || 0)) S = normalize(j); } catch (er) { /* ignore */ } } document.documentElement.classList.remove('pack-open'); document.documentElement.classList.toggle('modal-open', !!$('.modal-bg')); renderHeader(); route(); };
    try {
      await ripped; $('.tap-hint', ov)?.remove();
      const fast = () => skipped || reduceMotion();
      if (!skipped) { SFX.tear(); stage.classList.add('torn'); $('.flash', ov).classList.add('go'); fx.burst(['#b794ff', '#4ade80', '#fff', '#8b5cf6'], 90); }
      const sorted = all.slice().sort((a, b) => b.card.ti - a.card.ti || (b.holo ? 1 : 0) - (a.holo ? 1 : 0) || a.card.rank - b.card.rank);
      // The cards leap out of the pack backs first, spin and land face down in `row` (the same for one pack or many).
      const jumpOut = async (row) => {
        if (fast()) return;
        const pr = pack0.getBoundingClientRect(), px = pr.left + pr.width / 2, py = pr.top + pr.height * 0.3, slots = $$('.slot', row); let end = 0;
        slots.forEach((slot, i) => {
          const r = $('.flipper', slot).getBoundingClientRect(), dx = px - (r.left + r.width / 2), dy = py - (r.top + r.height / 2), k = i - (slots.length - 1) / 2, d = 80 + i * (slots.length > 6 ? 70 : 120);
          end = Math.max(end, d + 980);
          slot.animate([
            { transform: `translate(${dx}px, ${dy}px) scale(.45) rotate(${-k * 7}deg)`, opacity: 0, offset: 0 },
            { transform: `translate(${dx}px, ${dy}px) scale(.45) rotate(${-k * 7}deg)`, opacity: 1, offset: 0.05, easing: 'cubic-bezier(.15,.75,.3,1)' },
            { transform: `translate(${dx * 0.5 - k * 30}px, ${dy - 170 - Math.abs(k) * 10}px) scale(1.12) rotate(${k * 11}deg)`, opacity: 1, offset: 0.44, easing: 'cubic-bezier(.5,0,.85,.55)' },
            { transform: `translate(${-k * 5}px, -12px) scale(1.04) rotate(${-k * 2}deg)`, opacity: 1, offset: 0.82, easing: 'ease-out' },
            { transform: 'translate(0, 0) scale(1) rotate(0deg)', opacity: 1, offset: 1 }
          ], { duration: 980, delay: d, fill: 'both' });
          setTimeout(() => { if (!skipped) SFX.draw(); }, d + 30); setTimeout(() => { if (!skipped) SFX.place(); }, d + 800);
        });
        setTimeout(() => stage.classList.add('emptying'), 360);
        await wait(end + 280);
      };
      // Turning a card over is animated explicitly (so it can never "snap", even straight after the shaking of a rare card).
      const flipSlot = (slot) => {
        const f = $('.flipper', slot); slot.classList.remove('suspense'); void f.offsetWidth; f.classList.add('flipped');
        if (!fast()) f.animate([{ transform: 'translateY(0) scale(1) rotateY(0deg)' }, { transform: 'translateY(-34px) scale(1.15) rotateY(90deg)', offset: 0.5 }, { transform: 'translateY(0) scale(1) rotateY(180deg)' }], { duration: 760, easing: 'cubic-bezier(.3,.8,.3,1)' });
      };
      const backs = (n) => Array.from({ length: n }, (_, i) => `<div class="slot" data-i="${i}"><div class="flipper"><div class="face back"><div class="card-back">${BOLT}</div></div></div></div>`).join('');
      if (!fast()) { const rays = document.createElement('div'); rays.className = 'pack-rays'; stage.append(rays); await wait(520); }
      if (single) {
        const cs = results[0].slice().sort((a, b) => a.card.ti - b.card.ti);
        const row = document.createElement('div'); row.className = 'reveal-row';
        row.innerHTML = cs.map((o, i) => `<div class="slot ${o.eaten ? 'eaten' : tcls(o.card.tier)}" data-i="${i}"><div class="flipper"><div class="face back"><div class="card-back">${BOLT}</div></div><div class="face front">${o.eaten ? MONSTER : cardHTML(o.card, { holo: o.holo })}</div></div><div class="reveal-label"></div></div>`).join('');
        ov.append(row); await jumpOut(row); stage.remove();
        // flip them over one at a time
        for (let i = 0; i < cs.length && !skipped; i++) {
          const o = cs[i], c = o.card, slot = $(`.slot[data-i="${i}"]`, row);
          await wait(380); if (skipped) break;
          if (o.eaten) { SFX.tear(); flipSlot(slot); slot.classList.add('revealed'); fx.burst(['#ff4d6d', '#4ade80', '#000'], 60); $('.reveal-label', slot).innerHTML = `<span class="monster-line">The monster ate <b>${esc(c.name)}</b>!</span>`; say(`The monster ate ${c.name}`); await wait(1200); continue; }
          if (c.fx >= 3) { slot.classList.add('suspense'); for (let k = 0; k < 3 && !skipped; k++) { SFX.shake(2); await wait(220); } }
          if (c.fx >= 4) { slot.classList.remove('suspense'); await specialReveal(ov, o, fx, () => skipped); await wait(300); }
          if (skipped) break;
          SFX.flip(); flipSlot(slot); slot.classList.add('revealed'); SFX.reveal(Math.floor(c.fx));
          if (o.holo) { setTimeout(() => SFX.holo(), 150); fx.burst(RAINBOW, 80, true); } else if (c.fx >= 3) fx.burst([TC[c.tier], '#fff'], 30 + c.ti * 16);
          $('.reveal-label', slot).innerHTML = `<span class="tier-text ${tcls(c.tier)}">${c.tier}</span>${o.holo ? ' <span class="holo-badge static">SKIBIDI</span>' : ''}${newLabel(o.isNew)}${o.monsterDrop ? '<span class="monster-drop">👹 Monster drop</span>' : ''}`;
          say(`Card ${i + 1}: ${c.name}, ${c.tier}${o.holo ? ', skibidi' : ''}${o.isNew ? ', new' : ''}`);
          await wait(c.fx >= 4 ? 1000 : 480);
        }
        if (!skipped) await wait(650);
        row.remove();
      } else {
        // Many packs: the same jump out of the pack (a handful of backs stand in for all the cards), then straight to the results.
        if (!fast()) { const row = document.createElement('div'); row.className = 'reveal-row multi'; row.innerHTML = backs(Math.min(10, all.length)); ov.append(row); await jumpOut(row); await wait(450); row.classList.add('leave'); await wait(300); row.remove(); }
        stage.remove();
        for (const o of sorted) { if (skipped) break; if (o.card.fx >= 4) await specialReveal(ov, o, fx, () => skipped); }
        if (!skipped) { SFX.reveal(Math.floor(sorted[0].card.fx)); }
      }
      $('.skip', ov)?.remove(); $('.special', ov)?.remove();
      // summary
      const best = sorted[0], fresh = all.filter((o) => o.isNew).length, holos = all.filter((o) => o.holo).length;
      const counts = TIERS.map((t) => [t, all.filter((o) => o.card.tier === t).length]).filter((x) => x[1]).reverse();
      const sum = document.createElement('div'); sum.className = 'summary';
      const shown = single ? sorted : sorted.slice(0, 40);
      sum.innerHTML = `<h2>${single ? 'Pack opened' : `Opened ${n} packs`}</h2><p class="muted">Best pull: <b class="tier-text ${tcls(best.card.tier)}">${best.card.tier}</b> ${esc(best.card.name)} (${best.card.cat})</p>
        <p class="pack-new ${fresh ? '' : 'none'}">${fresh ? `✦ ${fresh} new for your collection` : 'No new cards this time.'}${results.some((r) => r.some((o) => o.pity)) ? ' · Pity pull triggered' : ''}</p>
        <p class="row counts">${counts.map(([t, k]) => `<span class="${tcls(t)}"><span class="tier-text">${t}</span> ×${k}</span>`).join('')}${holos ? `<span class="holo-badge static">✦ SKIBIDI ×${holos}</span>` : ''}</p>
        <div class="card-grid summary-grid">${shown.map((o, i) => `<button class="card-btn" data-i="${i}">${cardHTML(o.card, { holo: o.holo })}${newLabel(o.isNew)}</button>`).join('')}</div>
        ${all.length > shown.length ? `<p class="muted small">Showing the best ${shown.length} of ${all.length} cards. All are saved to your collection.</p>` : ''}
        <div class="row center">${avail() >= 1 ? `<button class="btn primary" id="again">Open another (${avail()} left)</button>` : ''}${avail() >= 2 ? `<button class="btn" id="againAll">Open all (${avail()})</button>` : ''}<a class="btn" href="#collection" id="toCol">View collection</a><button class="btn" id="done">Continue</button></div>`;
      ov.append(sum); if (eatenAll.length) sum.insertAdjacentHTML('afterbegin', `<p class="monster-note">👹 The monster ate ${eatenAll.map((o) => '<b>' + esc(o.card.name) + '</b>').join(', ')}</p>`); $$('.card', sum).forEach((el, i) => { el.style.animationDelay = Math.min(i * 30, 900) + 'ms'; tilt(el); });
      if (all.some((o) => o.holo)) setTimeout(() => SFX.holo(), 200);
      $('#done', sum).focus({ preventScroll: true });
      sum.addEventListener('click', (ev) => { const b = ev.target.closest('.card-btn'); if (b) cardPop(shown[b.dataset.i].card.id, b); });
      const act = await new Promise((resolve) => {
        $('#done', sum).onclick = () => resolve('done'); $('#toCol', sum).onclick = () => resolve('col');
        if ($('#again', sum)) $('#again', sum).onclick = () => resolve('again'); if ($('#againAll', sum)) $('#againAll', sum).onclick = () => resolve('all');
      });
      finish();
      if (act === 'again') setTimeout(() => openPacks(1), 60); else if (act === 'all') setTimeout(() => openPacks(avail()), 60);
    } catch (err) { console.error(err); toast('Something went wrong showing the cards. They are saved in your collection.', true); finish(); }
  }
  async function specialReveal(ov, o, fx, isSkipped) {
    if (isSkipped()) return; const c = o.card;
    const sp = document.createElement('div'); sp.className = 'special ' + tcls(c.tier);
    sp.innerHTML = `<div class="sp-rays"></div><div class="sp-text">${c.tier.toUpperCase()} PULL</div>`;
    ov.append(sp); SFX[c.fx >= 6 ? 'apex' : 'reveal'](Math.floor(c.fx)); fx.burst(c.fx >= 6 ? RAINBOW : [TC[c.tier], '#fff'], 120);
    const ms = c.fx >= 6 ? 2300 : 1300; const t0 = Date.now();
    while (Date.now() - t0 < ms && !isSkipped()) await sleep(40);
    sp.remove();
  }

  // ---------- events ----------
  document.addEventListener('click', async (e) => {
    { const nv = document.querySelector('nav.main.open'); if (nv && !e.target.closest('[data-act="nav-more"]')) nv.classList.remove('open'); }
    const t = e.target.closest('[data-act]'); if (!t) return;
    const act = t.dataset.act, id = t.dataset.id; unlockAudio(); applyAudio();
    switch (act) {
      case 'close-modal': closeModal(t.closest('.modal-bg')); break;
      case 'badge': SFX.click(); badgeModal(+t.dataset.i); break;
      case 'toggle-sound': S.settings.sound = !S.settings.sound; applyAudio(); save(); renderHeader(); if (S.settings.sound) SFX.click(); break;
      case 'open-1': SFX.click(); openPacks(1); break;
      case 'open-all': SFX.click(); openPacks(avail()); break;
      case 'card': { SFX.click(); const mine = !t.dataset.src && S.cards[id]; if (mine && mine.n > 1 && !t.closest('.modal-bg')) popOpen(t, cardPopHTML(id, S.cards), { key: 'card:' + id }); else cardPop(id, t, t.dataset.src); break; } // your own card with copies to spare: a popover with every copy first; click a copy for its details
      case 'card-open': { SFX.click(); popClose(); cardPop(id, t, '', t.dataset.v == null ? undefined : +t.dataset.v); break; }
      case 'close-pop': popClose(); break;
      case 'zoom': zoomCard(t); break;
      case 'redeem': redeemModal(); break;
      case 'edit-profile': editProfile(); break;
      case 'nav-more': { const n = t.closest('nav'); const o = n.classList.toggle('open'); t.setAttribute('aria-expanded', String(o)); break; }
      case 'wish': { if (S.wish[id]) delete S.wish[id]; else S.wish[id] = 1; save(); route(); cardPopRefresh(); popRefresh(); toast(S.wish[id] ? 'Added to your wishlist. Others can see it when they trade with you.' : 'Removed from your wishlist'); break; }
      case 'ann-x': { try { const d = JSON.parse(localStorage.getItem('ss-gacha-ann') || '[]'); d.push(id); localStorage.setItem('ss-gacha-ann', JSON.stringify(d.slice(-30))); } catch (e) { /* ignore */ } const b = t.closest('.ann'); if (b) b.remove(); break; }
      case 'fav': { const x = S.cards[id]; if (x) { x.f = x.f ? 0 : 1; save(); route(); cardPopRefresh(); popRefresh(); } break; }
    }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (popup.el) { popClose(); return; } const m = $$('.modal-bg').pop(); if (m && !$('.welcome', m)) closeModal(m); } });
  // The code box on the home page.
  document.addEventListener('submit', (e) => { if (e.target.id !== 'homeCodeForm') return; e.preventDefault(); unlockAudio(); const i = $('#homeCode'); if (!i || !i.value.trim()) return; redeem(i.value).then((ok) => { const j = $('#homeCode'); if (ok && j) j.value = ''; }); });

  // ---------- router ----------
  // ---------- quality of life: keyboard shortcuts + pack count in tab title ----------
  (function () {
    const baseTitle = document.title.replace(/^\(\d+\)\s*/, '');
    setInterval(() => { document.title = (avail() > 0 ? `(${avail()}) ` : '') + baseTitle; }, 1000);
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test((e.target.tagName || ''))) return;
      if (document.documentElement.classList.contains('modal-open')) return;
      const k = e.key.toLowerCase(), click = (sel) => { const b = document.querySelector(sel); if (b && !b.disabled && !b.hidden) { e.preventDefault(); b.click(); } };
      if (k === 'o') click('[data-act="open-1"]'); else if (k === 'a') click('[data-act="open-all"]');
      else if (/^[1-9]$/.test(k) && NAV[k - 1]) { location.hash = '#' + NAV[k - 1][0]; }
      else if (k === '/') { e.preventDefault(); location.hash = '#collection'; setTimeout(() => { const q = document.getElementById('colq'); if (q) q.focus(); }, 80); }
    });
  })();

  const PAGES = { suggest: () => social.pageSuggest(), imagereq: () => social.pageImageReq(), notifications: () => { pageHome(); social.openBell(); }, friends: () => social.pageFriends(), home: pageHome, collection: pageCollection, index: pageIndex, leaderboard: () => net.pagePlayers(), players: () => net.pagePlayers(), trades: () => net.pageTrades(), trade: () => net.pageTrade(), post: () => net.pagePost(), board: () => net.pageBoard(), profile: pageProfile, options: pageSettings, admin: () => admin.page() };
  // ---------- admin reset ----------
  // The admin page can reset one account or everyone (config.resets / config.resetAll = a time). Each device applies it the next time it syncs:
  // cards, packs opened, score, packs, codes used and trades go back to a brand-new account's values. Name, picture and settings are kept.
  function checkReset() {
    if (!S.account) return false; const need = G.needReset(S.account); if (!need || need <= (S.resetAt || 0)) return false;
    const pid = S.profile.id, mineOpen = net.state.trades.filter((t) => t.from.id === pid);
    const t = Math.max(Date.now(), need + 1), f = fresh();
    S = normalize(Object.assign(f, { account: S.account, profile: S.profile, settings: S.settings, started: S.started, resetAt: t, mod: t, syncMod: t - 1 }));
    save(true); mineOpen.forEach((x) => net.closeIssue(x.num).catch(() => {}));
    toast('The admin reset everyone\'s progress. You are starting fresh.', true); return true;
  }
  // ---------- whitelist ----------
  // A new account cannot use the site until the admin approves it (admin page > Players). 'ok' = in, 'pending' = waiting, 'checking' = not known yet.
  const APPR = 'ss-gacha-approved';
  function accessState() {
    const se = auth && auth.session(); if (!se || !net.enabled()) return 'ok';
    if (admin && admin.unlocked()) return 'ok'; // the admin never waits for approval
    let cached = false; try { cached = localStorage.getItem(APPR) === se.k; } catch (e) { /* ignore */ }
    const st = net.state;
    if (st.loaded && st.complete && st.accounts.length) {
      const a = st.accounts.find((x) => x.k === se.k);
      if (a && G.isApproved(a)) { try { localStorage.setItem(APPR, se.k); } catch (e) { /* ignore */ } return 'ok'; }
      if (!a && cached) return 'ok'; // not in a (lagging) listing: trust what we last saw
      if (cached) { try { localStorage.removeItem(APPR); } catch (e) { /* ignore */ } }
      return 'pending';
    }
    return cached ? 'ok' : 'checking';
  }
  const gated = () => { const h = location.hash.slice(1); return auth.loggedIn() && accessState() !== 'ok' && !(h === 'admin' && admin.unlocked()); };
  let lastAccess = null; // access state at the last full draw: a change (approved, revoked) redraws the page
  function pendingPage(state) {
    const se = auth.session();
    main().innerHTML = `<div class="auth-wrap"><section class="panel auth"><p class="eyebrow">Special Strike</p>
      <h1>${state === 'checking' ? 'Checking your account…' : 'Waiting for approval'}</h1>
      ${state === 'checking' ? '<p class="muted">One moment.</p>' : `<p class="muted">Your account <b>${esc(se ? se.u : '')}</b> was created. An admin has to let you in before you can play. This page checks automatically, so you can leave it open.</p>`}
      <div class="row wrap"><button class="btn" id="pendCheck" type="button">Check again</button><button class="btn" id="pendOut" type="button">Log out</button></div>
      <details style="margin-top:14px"><summary class="muted small">I am the admin</summary>${admin.settingsHTML()}</details></section></div>`;
    $('#pendCheck').onclick = async (e) => { e.target.disabled = true; await net.cycle(true); route(); };
    $('#pendOut').onclick = () => auth.logOut();
    admin.bindSettings();
  }
  // route(true) is a quiet redraw used by background syncs: no entrance animation, scroll position and focus kept, and it never
  // interrupts someone who is typing. A plain route() (navigation, a button press) behaves as before.
  function route(soft) {
    if (!auth.loggedIn()) { renderHeader(); auth.page(); document.title = 'Sign in · Special Strike Gacha'; return; }
    lastAccess = accessState();
    if (gated()) { renderHeader(); pendingPage(lastAccess); document.title = 'Waiting for approval · Special Strike Gacha'; return; }
    const quiet = soft === true, m = main(), ae = document.activeElement;
    if (quiet && ae && m && m.contains(ae) && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) return;
    const y = window.scrollY, fid = quiet && ae && ae.id ? ae.id : '';
    const h = (location.hash.slice(1) || 'home'), fn = h.indexOf('user-') === 0 ? () => net.pageUser(h.slice(5)) : h.indexOf('chat-') === 0 ? () => social.pageChat(h.slice(5)) :  (PAGES[h] || pageHome);
    if (m) m.classList.toggle('soft', quiet);
    renderHeader(); fn(); updateHud();
    if (net.state.cfg) { const a = annHTML(); if (a) main().insertAdjacentHTML('afterbegin', a); }
    document.title = 'Special Strike Gacha';
    if (quiet) { window.scrollTo({ top: y, left: 0, behavior: 'instant' }); if (fid) { const e = document.getElementById(fid); if (e && e.focus) e.focus({ preventScroll: true }); } }
  }
  addEventListener('hashchange', () => { route(); scrollTo(0, 0); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) updateHud(); });
  setInterval(updateHud, 1000);
  applyAudio();
  const ctx = { G, S: () => S, isAdminPid, isAdminAcct, ADMIN_TAG, save, toast, modal, closeModal, popOpen, popSet, popClose, popup, esc, $, $$, cardHTML, tilt, avatarHTML, bannerCSS, profileHTML, route, renderHeader, fmt, uid, normalize, hasCopy, takeCopy, addCopy, copiesText, since, tcls, rarityCmp, busy: () => opening, refreshFeeds: () => refreshFeeds(), notify: function () { return social ? social.notify.apply(null, arguments) : null; },
    setHTML: (el, html) => { if (!el || el.innerHTML === html) return; const y = window.scrollY; el.innerHTML = html; el.classList.add('soft'); window.scrollTo({ top: y, left: 0, behavior: 'instant' }); },
    restore: (j) => { S = normalize(Object.assign({}, j, { account: S.account || null })); save(); location.reload(); },
    loggedIn: () => !!(auth && auth.loggedIn()), allowed: () => accessState() === 'ok', checkReset: () => checkReset(), onSync: () => { if (auth) auth.watch(); if (social) social.scan(); if (auth && auth.loggedIn()) { const a = accessState(); if (a !== lastAccess) route(); } },
    fresh, adopt: (j, fromCloud) => { S = normalize(j); if (fromCloud) { S.base = window.SSGMerge.makeBase(S, (id) => /^[\w-]{1,60}$/.test(id)); S.sp = 0; } save(true); }, rerenderSettings: () => pageSettings(),
    // Bring the account's newer cloud save in. keepLocal = this device has changes the cloud has not seen, so combine instead of replace (never loses a card).
    mergeCloud: (p, keepLocal) => {
      const M = window.SSGMerge, known = (id) => /^[\w-]{1,60}$/.test(id);
      const cc = {}; Object.keys(Object.assign({}, p.unk || {}, p.cards)).forEach((id) => { const c = p.cards[id] || p.unk[id]; cc[id] = { n: c.n, h: c.h, f: c.f, t: c.t, l: c.l, p: c.p }; });
      const raw = p.raw || {}, prof = { id: p.id, name: p.name, bio: p.bio || '', hue: p.hue, pfp: p.pfp, banner: p.banner, joined: p.joined };
      const cOpened = +(raw.stats && raw.stats.opened) || p.opened || 0, cPulls = +(raw.stats && raw.stats.pulls) || p.pulls || 0, cBonus = Math.max(0, Math.floor(+raw.bonus) || 0);
      let next;
      if (!keepLocal) { next = Object.assign(fresh(), raw, { cards: cc, profile: prof, settings: Object.assign({}, S.settings), account: S.account }); next.mod = next.syncMod = p.mod; }
      else {
        next = JSON.parse(JSON.stringify(S));
        const base = S.base && S.base.c ? S.base : null; // what the cloud held when this device last synced
        // Cards: the cloud's cards plus whatever this device added or spent since then (never "the larger of the two").
        next.cards = M.cards(next.cards, cc, base);
        const cloudNewer = p.mod > (S.mod || 0);
        next.codes = Array.from(new Set((next.codes || []).concat(raw.codes || []))); next.wish = Object.assign({}, raw.wish || {}, next.wish || {}); next.granted = Object.assign({}, S.granted || {});
        // Take over the cloud's applied-gift list, except for removals this device has not applied yet (it must still apply them, or old cards would come back).
        const pend = {}; net.state.grants.forEach((g) => { if (g.wipe || g.take.length || g.opened != null) pend[g.gid] = 1; });
        Object.keys(raw.granted || {}).forEach((k) => { if (!pend[k] || (S.granted || {})[k]) next.granted[k] = raw.granted[k]; });
        if (base) {
          next.stats = { opened: Math.max(0, cOpened + (S.stats.opened - base.o)), pulls: Math.max(0, cPulls + (S.stats.pulls - base.p)) };
          // Packs: the cloud's count and timer, minus the packs opened here that it has not seen. Opening more than it has left comes out of the bonus packs.
          let pk = raw.packs != null ? Math.floor(+raw.packs) - (S.sp || 0) : S.packs, owe = 0; if (pk < 0) { owe = -pk; pk = 0; }
          next.packs = Math.max(0, pk); if (raw.last != null) next.last = +raw.last || next.last;
          next.bonus = Math.max(0, cBonus + ((S.bonus || 0) - base.b) - owe);
          ['sinceRare', 'started'].forEach((k) => { if (cloudNewer && raw[k] != null) next[k] = raw[k]; });
          if (raw.net) next.net = M.net(S.net, raw.net, base);
        } else {
          next.stats = { opened: Math.max(S.stats.opened, cOpened), pulls: Math.max(S.stats.pulls, cPulls) };
          if (cloudNewer) { ['packs', 'last', 'sinceRare', 'started'].forEach((k) => { if (raw[k] != null) next[k] = raw[k]; }); }
          if (raw.net) next.net = M.net(S.net, raw.net, null);
        }
        if (cloudNewer) next.profile = Object.assign({}, S.profile, prof);
        next.syncMod = p.mod; next.mod = Math.max(Date.now(), p.mod + 1);
        const cs = raw.social || {}, ls = S.social || {}, byId = {}; (cs.notes || []).concat(ls.notes || []).forEach((x) => { if (!x || !x.id) return; const o = byId[x.id]; byId[x.id] = o ? Object.assign({}, o, x, { read: Math.max(o.read || 0, x.read || 0) }) : x; });
        next.social = { notes: Object.values(byId).sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 60), nseen: Object.assign({}, cs.nseen || {}, ls.nseen || {}), seen: Object.assign({}, cs.seen || {}, ls.seen || {}), badges: ls.badges || cs.badges || null };
      }
      next.resetAt = Math.max(S.resetAt || 0, p.ra || 0); // never go back to a state from before an admin reset
      // The cloud copy this merge started from is the new base: everything on top of it still has to be uploaded.
      next.base = M.makeBase({ cards: cc, bonus: cBonus, stats: { opened: cOpened, pulls: cPulls }, net: raw.net }, known);
      if (!keepLocal) next.sp = 0;
      S = normalize(next); save(true); renderHeader(); if (!opening) route(true);
    } };
  net = window.SSGNet(ctx);
  auth = window.SSGAuth(Object.assign({}, ctx, { net }));
  admin = window.SSGAdmin(Object.assign({}, ctx, { net, auth }));
  social = window.SSGSocial(Object.assign({}, ctx, { net, auth })); ctx.social = social;
  // If the saved game on this device does not belong to the signed-in account any more (for example site data was cleared), sign in again.
  // A different player's save on this device means signing out. A save that merely lost its account link (or has a different internal id) is re-attached to the
  // signed-in account instead, and the account's cloud copy is merged in by the next sync. That used to sign people out for no visible reason.
  (function () {
    const se = auth.session(); if (!se) return;
    if (S.account && S.account !== se.k) { try { localStorage.removeItem('ss-gacha-session'); } catch (e) { /* ignore */ } return; }
    if (S.account !== se.k || S.profile.id !== se.pid) { S.account = se.k; S.profile.id = se.pid; save(true); }
  })();
  if (!S.base && S.account && S.syncMod && (S.mod || 0) <= S.syncMod) { S.base = window.SSGMerge.makeBase(S, (id) => /^[\w-]{1,60}$/.test(id)); S.sp = 0; save(true); } // saves from before v54 that are fully synced get their merge base now
  net.loadCache(); // show admin-made card changes straight away; the online sync refreshes them
  // ---------- auto update ----------
  // version.json holds the newest version number. A tab running an older one reloads itself (after uploading its save), so old tabs do not overwrite newer data.
  const VERSION = 55;
  async function checkVersion() {
    try {
      const r = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' }); if (!r.ok) return;
      const j = await r.json(); if (!(+j.v > VERSION)) return;
      // Never reload by itself (that looked like random refreshes and could interrupt you): show a small bar and let the player choose when.
      if (!$('#updBar')) { const b = document.createElement('div'); b.id = 'updBar'; b.className = 'toast'; b.style.cssText = 'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:50;pointer-events:auto'; b.innerHTML = 'A new version is out. <a href="#" id="updGo">Refresh</a> <a href="#" id="updX" aria-label="Dismiss">✕</a>'; document.body.append(b);
        $('#updGo', b).onclick = (ev) => { ev.preventDefault(); save(true); try { if (net) net.flush(); } catch (e) { /* ignore */ } setTimeout(() => location.reload(), 600); }; $('#updX', b).onclick = (ev) => { ev.preventDefault(); b.remove(); }; }
    } catch (e) { /* offline: try again later */ }
  }
  setInterval(() => { if (!document.hidden) checkVersion(); }, 120000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkVersion(); });
  setTimeout(checkVersion, 8000);
  // finishes a sign-in if Discord just sent the player back; otherwise an admin whose short-lived admin pass ran out is quietly logged in again
  const redirecting = !auth.consumeRedirect() && auth.autoAdmin();
  if (!redirecting) { tick(); route(); net.start(); }
  window.__ssg = { get S() { return S; }, save, route, net };
})();
