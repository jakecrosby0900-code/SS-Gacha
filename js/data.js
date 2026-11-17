// Card data, tiers, difficulties. Everything is defined here so you can balance the game from one file.
(function () {
  const TIERS = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Mythic', 'Sigma'];
  const TIER_COLOR = { Common: '#8b97a3', Uncommon: '#4cc38a', Rare: '#4aa3ff', Epic: '#b36bff', Legendary: '#ffb02e', Mythic: '#ff4d6d', Sigma: '#ffffff' };

  // Your roster, exactly as supplied: category header lines, then "Name Rarity" per line.
  const RAW = `SS
Freddy Common
Bonnie Common
Chica Common
Foxy Common
Chief Rare
RXQ Rare
General Uncommon
Mecha Rare

SSR
Freddy Common
Bonnie Common
Chica Common
Foxy Common
Springtrap Uncommon
General Uncommon
Withered Bonnie Uncommon
Helpy Common
Plushtrap Common
Lefty Common
Puppet Common
Security Puppet Common
Withered Chief Rare
Berserk Chief Rare
Corrupted Chief Rare
QXR Uncommon
Mecha Uncommon
Glitchtrap Rare
Bugtrap Epic
Miniontrap Rare
Scythetrap Rare
Pittrap Rare
Chester Uncommon
Penguin Uncommon
Candy Uncommon
Cindy Uncommon
Rat Uncommon
Cat Uncommon
Vinnie Uncommon
Destroyed Foxy Common
Destroyed Chica Common
Destroyed Withered Bonnie Common
Destroyed Springtrap Common
Ennard Uncommon
Fredbro Rare
Officer Egg Baby Mythic
Bon Epic
German Freddy Rare
Mighty Jimmy Epic

SS3
Candy Rare
Cindy Rare
Blank Rare
Rat Rare
Cat Rare
Vinnie Rare
Ennard Rare

SSC
Redacted Mythic
XQR Legendary
Stitchtrap Legendary
Shadowtrap Legendary
The Mimic Legendary

BU
The Chud Mythic
Revived Glitchtrap Mythic
RXQ Legendary
Wall Sigma
The End (Robot Form) Mythic

EXTRA
SSO Chief Mythic
Good Chief Mythic
SS3 RXQ Mythic
Split Sparky Doo Sigma
The Shed Sigma
Fazgirl Sigma
Awesome Garfield NFT from like 10 years ago Sigma
The Coon of Doom Sigma
The Ringtone of Despair Sigma

MONSTER
The Big M Epic
The Big G Legendary
The Big J Mythic`;

  // Colour of each set's card art and pack label.
  const CATS = {
    SS:    { hue: 8,   name: 'SS',    blurb: 'The original strike team.' },
    SSR:   { hue: 42,  name: 'SSR',   blurb: 'The big roster: the largest set in the game.' },
    SS3:   { hue: 172, name: 'SS3',   blurb: 'Third-wave versions.' },
    SSC:   { hue: 268, name: 'SSC',   blurb: 'Few cards, all of them rare.' },
    BU:    { hue: 348, name: 'BU',    blurb: 'Glitched, revived and broken.' },
    EXTRA: { hue: 200, name: 'EXTRA', blurb: 'Odds and ends. Hard to find.' },
    MONSTER: { hue: 135, name: 'MONSTER', blurb: 'Only drops while the monster is let in (Settings).', monster: true }
  };

  function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(seed) { let a = seed; return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  // Points each card is worth, by tier. A player's score is the sum over every different card they own.
  const POINTS = [1, 3, 8, 20, 50, 125, 400];

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
    const EPI_SSR = ['Helpy', 'Lefty', 'Puppet', 'Security Puppet'];
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
    const o = { blocked: [], edits: {}, added: [] };
    if (!isObj(b)) return o;
    if (Array.isArray(b.blocked)) b.blocked.slice(0, 500).forEach(function (x) {
      if (x && typeof x.id === 'string' && /^[a-z0-9]{6,40}$/.test(x.id)) o.blocked.push({ id: x.id, name: String(x.name == null ? 'Player' : x.name).replace(/[\r\n\t]+/g, ' ').trim().slice(0, 20) || 'Player' });
    });
    if (isObj(b.edits)) Object.keys(b.edits).slice(0, 1000).forEach(function (k) {
      const e = b.edits[k]; if (!isObj(e)) return; const r = {};
      if (typeof e.name === 'string' && e.name.trim()) r.name = e.name.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 60);
      if (TIERS.indexOf(e.tier) >= 0) r.tier = e.tier;
      if (typeof e.cat === 'string' && CATS[e.cat]) r.cat = e.cat;
      o.edits[String(k).slice(0, 120)] = r;
    });
    if (Array.isArray(b.added)) b.added.slice(0, 500).forEach(function (a) {
      if (!isObj(a) || typeof a.id !== 'string' || !a.id || a.id.length > 120 || a.id.indexOf('|') >= 0) return;
      const name = String(a.name == null ? '' : a.name).replace(/[\r\n\t]+/g, ' ').trim().slice(0, 60);
      if (!name || !CATS[a.cat] || TIERS.indexOf(a.tier) < 0) return;
      o.added.push({ id: a.id, name: name, cat: a.cat, tier: a.tier });
    });
    return o;
  }

  let CONFIG = cleanConfig(null), CONFIG_IMAGES = {};
  function rebuild() {
    const list = [], seen = {};
    BASE.forEach(function (b) { const e = CONFIG.edits[b.id] || {}; seen[b.id] = 1; list.push({ id: b.id, name: e.name || b.name, cat: e.cat || b.cat, tier: e.tier || b.tier, custom: false, img: CONFIG_IMAGES[b.id] || IMAGES[b.id] || null }); });
    CONFIG.added.forEach(function (a) { if (seen[a.id]) return; seen[a.id] = 1; const e = CONFIG.edits[a.id] || {}; list.push({ id: a.id, name: e.name || a.name, cat: e.cat || a.cat, tier: e.tier || a.tier, custom: true, img: CONFIG_IMAGES[a.id] || null }); });
    CARDS.length = 0; Object.keys(BYID).forEach(function (k) { delete BYID[k]; });
    BYTIER.forEach(function (l) { l.length = 0; }); POOL.forEach(function (l) { l.length = 0; }); MONSTER_POOL.length = 0;
    list.forEach(function (c) {
      c.ti = TIERS.indexOf(c.tier); c.pts = POINTS[c.ti]; c.monster = !!CATS[c.cat].monster;
      CARDS.push(c); BYID[c.id] = c; BYTIER[c.ti].push(c); if (c.monster) MONSTER_POOL.push(c); else POOL[c.ti].push(c);
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

  // Base chance weight of each tier for one card slot, before a difficulty's luck is applied to Rare and above.
  const BASE_WEIGHTS = [50, 28, 14, 5, 2, 0.8, 0.08];
  // Coins gained when recycling a spare copy.
  const SELL = [5, 12, 30, 80, 200, 500, 1500];

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

  window.SSG = { applyConfig: applyConfig, cleanConfig: cleanConfig, getConfig: function () { return CONFIG; }, BASE: BASE, TIERS: TIERS, TIER_COLOR: TIER_COLOR, CATS: CATS, CARDS: CARDS, BYID: BYID, BYTIER: BYTIER, POOL: POOL, MONSTER_POOL: MONSTER_POOL, MONSTER_CHANCE: MONSTER_CHANCE,
    BASE_WEIGHTS: BASE_WEIGHTS, SELL: SELL, POINTS: POINTS, CODES: CODES, DIFFS: DIFFS, hash: hash, rng: rng };
})();
