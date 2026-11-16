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
  const CARDS = [];
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
    const ti = TIERS.indexOf(tier);
    CARDS.push({ img: IMAGES[id] || null, id: id, name: name, cat: cat, tier: tier, ti: ti, pts: POINTS[ti], monster: !!CATS[cat].monster });
  });
  // Rank 1 = hardest to pull. Ties break by set order, then name.
  const catOrder = Object.keys(CATS);
  CARDS.slice().sort(function (a, b) { return b.ti - a.ti || catOrder.indexOf(a.cat) - catOrder.indexOf(b.cat) || a.name.localeCompare(b.name); })
    .forEach(function (c, i) { c.rank = i + 1; });
  const BYID = {}; CARDS.forEach(function (c) { BYID[c.id] = c; });
  const BYTIER = TIERS.map(function (t) { return CARDS.filter(function (c) { return c.tier === t; }); });
  // What packs normally draw from (monster cards are left out), and the extra pool the monster adds.
  const POOL = BYTIER.map(function (l) { return l.filter(function (c) { return !c.monster; }); });
  const MONSTER_POOL = CARDS.filter(function (c) { return c.monster; });
  const MONSTER_CHANCE = 0.05; // chance per card slot, only while the monster is let in

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

  window.SSG = { TIERS: TIERS, TIER_COLOR: TIER_COLOR, CATS: CATS, CARDS: CARDS, BYID: BYID, BYTIER: BYTIER, POOL: POOL, MONSTER_POOL: MONSTER_POOL, MONSTER_CHANCE: MONSTER_CHANCE,
    BASE_WEIGHTS: BASE_WEIGHTS, SELL: SELL, POINTS: POINTS, CODES: CODES, DIFFS: DIFFS, hash: hash, rng: rng };
})();
