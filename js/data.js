// Card data, tiers, difficulties. Everything is defined here so you can balance the game from one file.
(function () {
  const TIERS = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Mythic', 'Sigma', 'Monster'];
  const TIER0 = TIERS.slice(); // the built-in rarities; the admin can add more between them (see rebuild)
  const TIER_COLOR = { Common: '#8b97a3', Uncommon: '#4cc38a', Rare: '#4aa3ff', Epic: '#b36bff', Legendary: '#ffb02e', Mythic: '#ff4d6d', Sigma: '#ffffff', Monster: '#34f5a0' };

  // Your roster, exactly as supplied: category header lines, then "Name Rarity" per line.
  const RAW = `SS
Freddy Common
Bonnie Common
Chica Common
Foxy Common
Shadow Droid Common
Golden Freddy Common
RXQ Uncommon
General Uncommon
Mecha Rare
Chief Rare
Shadow Man Epic
Obese Legendary

SSR
Freddy Common
Bonnie Common
Chica Common
Foxy Common
Helpy Common
Plushtrap Common
Puppet Common
Security Puppet Common
Candy Common
Cindy Common
Blank Common
Springtrap Uncommon
Withered Bonnie Uncommon
Lefty Uncommon
Destroyed Foxy Uncommon
Destroyed Chica Uncommon
Destroyed Withered Bonnie Uncommon
Destroyed Springtrap Uncommon
Ennard Uncommon
Rat Uncommon
Cat Uncommon
Vinnie Uncommon
Bon Uncommon
Fredbro Uncommon
Mecha Uncommon
General Rare
Penguin Rare
Chester Rare
Miniontrap Rare
Pittrap Rare
Scythetrap Rare
Withered Chief Rare
German Freddy Rare
QXR Epic
Glitchtrap Epic
Mighty Jimmy Epic
Corrupted Chief Epic
1, 2, and 3 Epic
Bugtrap Legendary
Berserk Chief Legendary
Officer Egg Baby Mythic
The End Mythic

SS3
Ennard Common
Cindy Common
Blank Common
Endo Fredbear Common
Withered Bonnie Common
Withered Chica Common
Withered Foxy Common
Rat Uncommon
Cat Uncommon
Candy Uncommon
Withered Freddy Uncommon
Fredbear Uncommon
Vinnie Rare
RXQ Rare
Hooded Guy Legendary

SSC
Stitchtrap Rare
Shadowtrap Epic
XQR Legendary
The Mimic Legendary
Redacted Mythic

BU
Infected Bonnie Common
Infected Chica Common
Infected Foxy Common
Infected Springtrap Common
Infected General Uncommon
Infected Candy Uncommon
RXQ Rare
Glendo Legendary
Fancy Scythetrap Legendary
Revived Glitchtrap Mythic
Humuhumunukunukuapua’a Mythic
Wall Sigma
Horse Sigma

ROTA
Tinytrap Common
FT1 Common
Epilogue Golden Freddy Common
Raine Common
Molten Glitchtrap Uncommon
Fametrap Uncommon
Robobrute Rare
Lankytrap Rare
Reformed Chief Rare
Roboclone Epic
Springbonnie Epic
Black Rabbit Epic
Dream Machine Epic
Robobun Legendary
Split QXR Legendary
Berserk Obese Legendary
Scythe Supreme Mythic
Robottrap Mythic
Sparky Doooo Sigma

HORROR
Verity Rare
Larper Larry Epic
The Aura Farmer Legendary
Lord Verity Legendary

EXTRA
SSO Chief Epic
Good Chief Epic
SS3 RXQ Epic
Split Sparky Doo Sigma
The Shed Sigma
Fazgirl Sigma
Awesome Garfield NFT from like 10 years ago Sigma
The Coon of Doom Sigma
The Ringtone of Despair Sigma

MONSTER
The Big M Monster
The Big G Monster
The Big J Monster`;

  // Colour of each set's card art and pack label.
  const CATS = {
    SS:    { hue: 8,   name: 'SS',    blurb: 'The original strike team.' },
    SSR:   { hue: 42,  name: 'SSR',   blurb: 'The big roster: the largest set in the game.' },
    SS3:   { hue: 172, name: 'SS3',   blurb: 'Third-wave versions.' },
    SSC:   { hue: 268, name: 'SSC',   blurb: 'Few cards, all of them rare.' },
    BU:    { hue: 348, name: 'BU',    blurb: 'Glitched, revived and broken.' },
    EXTRA: { hue: 200, name: 'EXTRA', blurb: 'Odds and ends. Hard to find.' },
    ROTA:  { hue: 318,  name: 'ROTA',  blurb: 'Robots, rabbits and rare machines.' },
    HORROR: { hue: 96,  name: 'HORROR', blurb: 'The Horror Skunx crew.' },
    MONSTER: { hue: 135, name: 'MONSTER', blurb: 'Only drops while the monster is let in (Settings).', monster: true }
  };

  const CAT_BASE = Object.keys(CATS); // the built-in sets; the admin can add more
  const CAT_DEF = {}; CAT_BASE.forEach(function (k) { CAT_DEF[k] = { hue: CATS[k].hue, blurb: CATS[k].blurb }; });

  function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(seed) { let a = seed; return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  // Points each card is worth, by tier. A player's score is the sum over every copy they own (skibidi copies count extra).
  const POINTS = [1, 3, 8, 20, 50, 125, 400, 600];
  const W0 = [50, 28, 14, 5, 2, 0.8, 0.08, 0.05], P0 = POINTS.slice(), C0 = Object.assign({}, TIER_COLOR);
  const TIER_DEF = {}; TIER0.forEach(function (n, i) { TIER_DEF[n] = { color: C0[n], pts: P0[i], weight: W0[i] }; });
  // Game-wide settings the admin can change. holoMult: a skibidi (holo) copy is worth this many times a normal copy's points.
  const GS = { holoMult: 2 };
  // Collection score: every copy counts. A skibidi copy is worth holoMult times as much.
  function cardScore(c, e) { return c.pts * (e.n - e.h) + c.pts * GS.holoMult * e.h; }
  function scoreOf(cards) { let t = 0; Object.keys(cards).forEach(function (id) { const c = BYID[id], e = cards[id]; if (c && e && e.n > 0) t += cardScore(c, e); }); return t; }
  const TIER_FX = [0, 1, 2, 3, 4, 5, 6, 7]; // how fancy the reveal is (built-ins: their own index; custom rarities sit half a step above the one they follow)
  // Base chance weight of each tier for one card slot, before a difficulty's luck is applied to Rare and above.
  const BASE_WEIGHTS = W0.slice();

  // Cards with their own picture instead of the generated face.
  const IMAGES = Object.assign({ 'EXTRA:Awesome Garfield NFT from like 10 years ago': 'images/garfield-nft.jpg' }, window.SSG_IMAGES || {});

  // ---- base roster (parsed once from RAW) ----
  const BASE = [];
  const ssNames = {}; // names seen in the SS set, so SSR copies of them can be marked Epilogue
  let cat = null;
  RAW.split('\n').forEach(function (line) {
    line = line.trim(); if (!line) return;
    if (CATS[line] && line.split(' ').length === 1) { cat = line; return; }
    const parts = line.split(' '); let tierWord = parts.pop();
    tierWord = tierWord.charAt(0).toUpperCase() + tierWord.slice(1).toLowerCase();
    const tier = TIERS.indexOf(tierWord) >= 0 ? tierWord : 'Common';
    const baseName = parts.join(' ');
    const id = cat + ':' + baseName; // id keeps the original name so old saves still work
    if (cat === 'SS') ssNames[baseName] = true;
    const RENAME = { 'SSR:Mecha': 'Withered Mecha', 'SSR:General': 'The Cooler General' };
    const EPI_SSR = ['Helpy', 'Lefty', 'Puppet', 'Security Puppet', 'Plushtrap', 'Springtrap', 'Withered Bonnie'];
    const name = RENAME[id] || ((cat === 'SS3' || (cat === 'SSR' && (ssNames[baseName] || EPI_SSR.indexOf(baseName) >= 0))) ? 'Epilogue ' + baseName : baseName);
    BASE.push({ id: id, name: name, cat: cat, tier: tier });
  });

  // ---- live card lists ----
  // These objects are filled IN PLACE by rebuild(), so every part of the game that already holds a reference to them keeps working
  // when the admin edits cards or adds new ones.
  const CARDS = [], BYID = {};
  const BYTIER = TIERS.map(function () { return []; });
  const POOL = TIERS.map(function () { return []; });
  const MONSTER_POOL = [];
  const MONSTER_CHANCE = 0.05; // chance per card slot, only while the monster is let in

  // Admin config (stored online by the admin page): { blocked: [{id,name}], edits: { cardId: {name,tier,cat} }, added: [{id,name,cat,tier}] }
  const isObj = function (x) { return x && typeof x === 'object' && !Array.isArray(x); };
  function cleanConfig(b) {
    const o = { blocked: [], edits: {}, added: [], tiers: [], sets: [], tierEdits: {}, setEdits: {}, events: [], codes: [], announce: [], log: [], settings: { holoMult: 2 } };
    if (!isObj(b)) return o;
    const nmOk = function (v, n) { v = String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); return v.length >= 1 && v.length <= n && /^[A-Za-z0-9 ]+$/.test(v) ? v : null; };
    const tierNames = TIER0.slice(), catNames = CAT_BASE.slice();
    // Custom sets and rarities first, so cards can use them.
    if (Array.isArray(b.sets)) b.sets.slice(0, 40).forEach(function (x) {
      const n = isObj(x) && nmOk(x.name, 12); if (!n || catNames.indexOf(n) >= 0) return;
      catNames.push(n); o.sets.push({ name: n, hue: Number.isFinite(+x.hue) ? ((Math.round(+x.hue) % 360) + 360) % 360 : 200, blurb: String(x.blurb == null ? '' : x.blurb).replace(/[\r\n\t]+/g, ' ').trim().slice(0, 90) });
    });
    if (Array.isArray(b.tiers)) b.tiers.slice(0, 20).forEach(function (x) {
      const n = isObj(x) && nmOk(x.name, 14); if (!n || tierNames.some(function (t) { return t.toLowerCase() === n.toLowerCase(); })) return;
      const after = tierNames.indexOf(x.after) >= 0 ? x.after : tierNames[tierNames.length - 1];
      tierNames.push(n);
      o.tiers.push({ name: n, color: /^#[0-9a-fA-F]{6}$/.test(x.color) ? x.color : '#ffffff', pts: Math.min(100000, Math.max(1, Math.round(+x.pts) || 1)), weight: Math.min(1000, Math.max(0.01, +x.weight || 1)), after: after });
    });
    // Changes to the built-in rarities and sets
    if (isObj(b.tierEdits)) TIER0.forEach(function (n) {
      const e = b.tierEdits[n]; if (!isObj(e)) return; const r = {};
      if (/^#[0-9a-fA-F]{6}$/.test(e.color)) r.color = e.color;
      if (Number.isFinite(+e.pts) && e.pts !== null && e.pts !== '') r.pts = Math.min(100000, Math.max(0, Math.round(+e.pts)));
      if (Number.isFinite(+e.weight) && e.weight !== null && e.weight !== '') r.weight = Math.min(1000, Math.max(0, +e.weight));
      if (Object.keys(r).length) o.tierEdits[n] = r;
    });
    if (isObj(b.setEdits)) CAT_BASE.forEach(function (n) {
      const e = b.setEdits[n]; if (!isObj(e)) return; const r = {};
      if (Number.isFinite(+e.hue) && e.hue !== null && e.hue !== '') r.hue = ((Math.round(+e.hue) % 360) + 360) % 360;
      if (typeof e.blurb === 'string') r.blurb = e.blurb.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 90);
      if (Object.keys(r).length) o.setEdits[n] = r;
    });
    if (isObj(b.settings) && Number.isFinite(+b.settings.holoMult)) o.settings.holoMult = Math.min(20, Math.max(1, +(+b.settings.holoMult).toFixed(2)));
    // Power hours: a boost that makes cards more likely for a while. kind: 'weight' (how often the card drops) or 'holo' (skibidi chance).
    if (Array.isArray(b.events)) b.events.slice(0, 30).forEach(function (x) {
      if (!isObj(x) || typeof x.id !== 'string' || !/^[a-z0-9]{4,40}$/.test(x.id)) return;
      const scope = ['all', 'rare', 'tier', 'set', 'card'].indexOf(x.scope) >= 0 ? x.scope : 'all', val = String(x.value == null ? '' : x.value).slice(0, 120);
      if (scope === 'tier' && tierNames.indexOf(val) < 0) return; if (scope === 'set' && catNames.indexOf(val) < 0) return; if (scope === 'card' && !val) return;
      const end = +x.end || 0; if (!(end > 0)) return;
      o.events.push({ id: x.id, name: String(x.name == null ? '' : x.name).replace(/[\r\n\t]+/g, ' ').trim().slice(0, 40) || 'Power hour', kind: x.kind === 'holo' ? 'holo' : 'weight', scope: scope, value: scope === 'all' || scope === 'rare' ? '' : val,
        mult: Math.min(1000, Math.max(0.01, +(+x.mult).toFixed(3) || 2)), start: +x.start || 0, end: end });
    });
    // Pack codes made in the admin panel: a code word that gives packs and/or cards, once per save.
    if (Array.isArray(b.codes)) b.codes.slice(0, 100).forEach(function (x) {
      if (!isObj(x)) return; const code = String(x.code == null ? '' : x.code).toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 24); if (code.length < 2 || o.codes.some(function (y) { return y.code === code; })) return;
      const cards = Array.isArray(x.cards) ? x.cards.filter(function (id) { return typeof id === 'string' && id.length < 100; }).slice(0, 20) : [];
      const packs = Math.min(1000, Math.max(0, Math.floor(+x.packs) || 0)); if (!packs && !cards.length) return;
      o.codes.push({ code: code, packs: packs, cards: cards, note: String(x.note == null ? '' : x.note).replace(/[\r\n\t]+/g, ' ').trim().slice(0, 60), off: !!x.off, max: Math.min(100000, Math.max(0, Math.floor(+x.max) || 0)), until: Math.max(0, +x.until || 0) });
    });
    // Announcements shown as a banner to every player, and the admin activity log (newest first).
    if (Array.isArray(b.announce)) b.announce.slice(0, 5).forEach(function (x) {
      if (!isObj(x)) return; const text = String(x.text == null ? '' : x.text).replace(/[\r\n\t]+/g, ' ').trim().slice(0, 240); if (!text) return;
      o.announce.push({ id: String(x.id || '').replace(/[^a-z0-9]/g, '').slice(0, 20) || String(o.announce.length), text: text, kind: x.kind === 'event' || x.kind === 'warn' ? x.kind : 'info', until: Math.max(0, +x.until || 0), at: +x.at || 0 });
    });
    if (Array.isArray(b.log)) b.log.slice(0, 100).forEach(function (x) { if (isObj(x) && x.text) o.log.push({ at: +x.at || 0, text: String(x.text).replace(/[\r\n\t]+/g, ' ').slice(0, 140) }); });
    if (Array.isArray(b.blocked)) b.blocked.slice(0, 500).forEach(function (x) {
      if (x && typeof x.id === 'string' && /^[a-z0-9]{6,40}$/.test(x.id)) o.blocked.push({ id: x.id, name: String(x.name == null ? 'Player' : x.name).replace(/[\r\n\t]+/g, ' ').trim().slice(0, 20) || 'Player' });
    });
    if (isObj(b.edits)) Object.keys(b.edits).slice(0, 1000).forEach(function (k) {
      const e = b.edits[k]; if (!isObj(e)) return; const r = {};
      if (typeof e.name === 'string' && e.name.trim()) r.name = e.name.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 60);
      if (tierNames.indexOf(e.tier) >= 0) r.tier = e.tier;
      if (typeof e.cat === 'string' && catNames.indexOf(e.cat) >= 0) r.cat = e.cat;
      if (e.pts !== undefined && e.pts !== null && e.pts !== '' && Number.isFinite(+e.pts)) r.pts = Math.min(1000000, Math.max(0, Math.round(+e.pts)));
      if (e.w !== undefined && e.w !== null && e.w !== '' && Number.isFinite(+e.w)) r.w = Math.min(1000, Math.max(0, +(+e.w).toFixed(4)));
      if (e.holo !== undefined && e.holo !== null && e.holo !== '' && Number.isFinite(+e.holo)) r.holo = Math.min(1, Math.max(0, +(+e.holo).toFixed(4)));
      if (e.off) r.off = 1;
      o.edits[String(k).slice(0, 120)] = r;
    });
    if (Array.isArray(b.added)) b.added.slice(0, 500).forEach(function (a) {
      if (!isObj(a) || typeof a.id !== 'string' || !a.id || a.id.length > 120 || a.id.indexOf('|') >= 0) return;
      const name = String(a.name == null ? '' : a.name).replace(/[\r\n\t]+/g, ' ').trim().slice(0, 60);
      if (!name || catNames.indexOf(a.cat) < 0 || tierNames.indexOf(a.tier) < 0) return;
      o.added.push({ id: a.id, name: name, cat: a.cat, tier: a.tier });
    });
    return o;
  }

  let CONFIG = cleanConfig(null), CONFIG_IMAGES = {};
  const slug = function (t) { return String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-'); };
  // Puts the admin's custom sets and rarities into the live TIERS / CATS / weights, in place.
  function rebuildTiers() {
    Object.keys(CATS).forEach(function (k) { if (CAT_BASE.indexOf(k) < 0) delete CATS[k]; });
    CAT_BASE.forEach(function (k) { const e = CONFIG.setEdits[k] || {}; CATS[k].hue = e.hue != null ? e.hue : CAT_DEF[k].hue; CATS[k].blurb = e.blurb != null && e.blurb !== '' ? e.blurb : CAT_DEF[k].blurb; });
    CONFIG.sets.forEach(function (x) { CATS[x.name] = { hue: x.hue, name: x.name, blurb: x.blurb || 'A custom set.', custom: true }; });
    GS.holoMult = CONFIG.settings.holoMult;
    const L = TIER0.map(function (n, i) { const e = CONFIG.tierEdits[n] || {}; return { name: n, color: e.color || C0[n], pts: e.pts != null ? e.pts : P0[i], w: e.weight != null ? e.weight : W0[i], fx: i, edited: !!CONFIG.tierEdits[n] }; });
    CONFIG.tiers.forEach(function (x) {
      let at = -1; L.forEach(function (t, i) { if (t.name === x.after) at = i; });
      if (at < 0) at = L.length - 1;
      L.splice(at + 1, 0, { name: x.name, color: x.color, pts: x.pts, w: x.weight, fx: L[at].fx + (L[at].fx % 1 ? 0 : 0.5), custom: true });
    });
    TIERS.length = 0; POINTS.length = 0; BASE_WEIGHTS.length = 0; TIER_FX.length = 0;
    Object.keys(TIER_COLOR).forEach(function (k) { delete TIER_COLOR[k]; });
    L.forEach(function (t) { TIERS.push(t.name); POINTS.push(t.pts); BASE_WEIGHTS.push(t.w); TIER_FX.push(t.fx); TIER_COLOR[t.name] = t.color; });
    BYTIER.length = 0; POOL.length = 0; TIERS.forEach(function () { BYTIER.push([]); POOL.push([]); });
    if (typeof document !== 'undefined') {
      let st = document.getElementById('ssg-tiers'); if (!st) { st = document.createElement('style'); st.id = 'ssg-tiers'; document.head.appendChild(st); }
      st.textContent = ':root{' + L.filter(function (t) { return t.custom || t.color !== C0[t.name]; }).map(function (t) { return '--t-' + slug(t.name) + ':' + t.color + ';'; }).join('') + '}' + L.filter(function (t) { return t.custom; }).map(function (t) {
        const c = 'var(--t-' + slug(t.name) + ')', k = '.t-' + slug(t.name);
        return k + ' .tier-text,.tier-text' + k + '{color:' + c + '}.card' + k + ',.special' + k + ',.unit' + k + '{--tc:' + c + '}.slot.revealed' + k + ' .flipper{filter:drop-shadow(0 0 20px ' + c + ')}.idx-item' + k + ' .dot{background:' + c + '}.tier-prog>' + k + '{--tc:' + c + '}';
      }).join('');
    }
  }
  function rebuild() {
    rebuildTiers();
    const list = [], seen = {};
    const extra = function (e) { return { ptsOv: e.pts != null ? e.pts : null, wm: e.w != null ? e.w : 1, holoOv: e.holo != null ? e.holo : null, off: !!e.off, edited: Object.keys(e).length > 0 }; };
    BASE.forEach(function (b) { const e = CONFIG.edits[b.id] || {}; seen[b.id] = 1; list.push(Object.assign({ id: b.id, name: e.name || b.name, cat: e.cat || b.cat, tier: e.tier || b.tier, custom: false, img: CONFIG_IMAGES[b.id] || IMAGES[b.id] || null, base: b }, extra(e))); });
    CONFIG.added.forEach(function (a) { if (seen[a.id]) return; seen[a.id] = 1; const e = CONFIG.edits[a.id] || {}; list.push(Object.assign({ id: a.id, name: e.name || a.name, cat: e.cat || a.cat, tier: e.tier || a.tier, custom: true, img: CONFIG_IMAGES[a.id] || null, base: a }, extra(e))); });
    CARDS.length = 0; Object.keys(BYID).forEach(function (k) { delete BYID[k]; });
    MONSTER_POOL.length = 0;
    list.forEach(function (c) {
      c.ti = TIERS.indexOf(c.tier); c.fx = TIER_FX[c.ti]; c.pts = c.ptsOv != null ? c.ptsOv : POINTS[c.ti]; c.monster = !!CATS[c.cat].monster;
      CARDS.push(c); BYID[c.id] = c; BYTIER[c.ti].push(c); if (!c.off) { if (c.monster) MONSTER_POOL.push(c); else POOL[c.ti].push(c); }
    });
    // Rank 1 = hardest to pull. Ties break by set order, then name.
    const catOrder = Object.keys(CATS);
    CARDS.slice().sort(function (a, b) { return b.ti - a.ti || catOrder.indexOf(a.cat) - catOrder.indexOf(b.cat) || a.name.localeCompare(b.name); })
      .forEach(function (c, i) { c.rank = i + 1; });
  }
  function applyConfig(cfg, images) {
    CONFIG = cleanConfig(cfg); CONFIG_IMAGES = {};
    if (isObj(images)) Object.keys(images).forEach(function (k) { if (typeof images[k] === 'string') CONFIG_IMAGES[k] = images[k]; });
    rebuild(); return CONFIG;
  }
  // Build the starting roster now (the admin config is applied later, once it has loaded).
  rebuild();

  // Coins gained when recycling a spare copy.
  const SELL = [5, 12, 30, 80, 200, 500, 1500, 2500];

  // Difficulty settings. interval = minutes per free pack. luck multiplies the weight of Rare and above.
  // pity = packs in a row with nothing Rare+ before the next one is guaranteed (0 = off).
  const DIFFS = {
    sigma: { label: 'Sigma', sub: 'Sigma', color: '#e6edf2', interval: 10, cap: 10, start: 10, luck: 0.45, holo: 0.02, pity: 0, packCost: 0 }
  };

  // Pack codes. Players type these into the "Code" box. Each code works once per save, case doesn't matter.
  // packs: free packs added. cards: optional list of card ids to give (e.g. 'SSR:Freddy').
  // Heads up: this file is public on GitHub Pages, so anyone can read the codes. Treat them as fun, not secret.
  const CODES = {
    SIGMA: { packs: 3, note: 'Sigma grindset' },
    MGJ:   { packs: 10, note: 'The Big three' }
  };

  // ---- power hours ----
  // Every running event whose scope matches the card multiplies its drop weight (kind 'weight') or its skibidi chance (kind 'holo').
  function findCode(raw) {
    const k = String(raw || '').trim().toUpperCase(); if (!k) return null;
    const a = CONFIG.codes.find(function (c) { return c.code === k; }); if (a) return a.off ? null : { code: k, packs: a.packs, cards: a.cards, max: a.max, until: a.until, managed: true };
    const st = Object.keys(CODES).find(function (x) { return x.toUpperCase() === k; }); return st ? Object.assign({ code: k }, CODES[st]) : null;
  }
  // Profile badges, worked out from a player's stats (nothing is stored). rank = leaderboard position by score, if known.
  function badgesOf(cards, opened, rank) {
    const out = [], ids = Object.keys(cards).filter(function (id) { return BYID[id] && cards[id] && cards[id].n > 0; });
    let sk = 0, best = null, score = 0; ids.forEach(function (id) { const c = BYID[id]; score += cardScore(c, cards[id]); if (cards[id].h > 0) sk++; if (!best || c.ti > best.ti) best = c; });
    const add = function (ic, name, tip) { out.push({ ic: ic, name: name, tip: tip }); };
    if (rank >= 1 && rank <= 3) add(['👑', '🥈', '🥉'][rank - 1], '#' + rank + ' on the leaderboard', 'Currently number ' + rank + ' by score');
    [[2000, '🏭', 'Pack machine'], [500, '📦', 'Pack hoarder'], [100, '🎁', 'Pack fan'], [1, '🎴', 'First pack']].some(function (r) { if (opened >= r[0]) { add(r[1], r[2], 'Opened ' + r[0] + '+ packs'); return true; } return false; });
    [[50000, '🏆', 'Legend'], [10000, '🥇', 'Veteran'], [1000, '🥉', 'Collector']].some(function (r) { if (score >= r[0]) { add(r[1], r[2], r[0].toLocaleString('en-GB') + '+ points'); return true; } return false; });
    [[10, '✨', 'Skibidi star'], [1, '✦', 'First skibidi']].some(function (r) { if (sk >= r[0]) { add(r[1], r[2], r[0] + '+ skibidi cards'); return true; } return false; });
    if (best && best.ti >= TIERS.length - 2 && TIERS.length > 3) add('💎', 'Owns ' + best.tier, 'Has a ' + best.tier + ' card (' + best.name + ')');
    Object.keys(CATS).forEach(function (k) { const all = CARDS.filter(function (c) { return c.cat === k && !c.off; }); if (all.length >= 3 && all.every(function (c) { return cards[c.id] && cards[c.id].n > 0; })) add('📚', k + ' complete', 'Owns every ' + k + ' card'); });
    const live = CARDS.filter(function (c) { return !c.off; }); if (live.length && live.every(function (c) { return cards[c.id] && cards[c.id].n > 0; })) add('🌟', 'Completionist', 'Owns every card in the game');
    return out;
  }
  function eventsNow(now) { now = now || Date.now(); return CONFIG.events.filter(function (e) { return e.start <= now && e.end > now; }); }
  function evHit(e, c) { return e.scope === 'all' || (e.scope === 'rare' && c.fx >= 2) || (e.scope === 'tier' && c.tier === e.value) || (e.scope === 'set' && c.cat === e.value) || (e.scope === 'card' && c.id === e.value); }
  function eventMult(c, kind, now) { let m = 1; eventsNow(now).forEach(function (e) { if (e.kind === (kind || 'weight') && evHit(e, c)) m *= e.mult; }); return m; }

  window.SSG = { badgesOf: badgesOf, findCode: findCode, GS: GS, TIER_DEF: TIER_DEF, CAT_DEF: CAT_DEF, cardScore: cardScore, scoreOf: scoreOf, eventsNow: eventsNow, eventMult: eventMult, evHit: evHit, applyConfig: applyConfig, cleanConfig: cleanConfig, getConfig: function () { return CONFIG; }, BASE: BASE, TIERS: TIERS, TIER_COLOR: TIER_COLOR, CATS: CATS, CARDS: CARDS, BYID: BYID, BYTIER: BYTIER, POOL: POOL, MONSTER_POOL: MONSTER_POOL, MONSTER_CHANCE: MONSTER_CHANCE,
    BASE_WEIGHTS: BASE_WEIGHTS, TIER_FX: TIER_FX, TIER0: TIER0, CAT_BASE: CAT_BASE, SELL: SELL, POINTS: POINTS, CODES: CODES, DIFFS: DIFFS, hash: hash, rng: rng };
})();
