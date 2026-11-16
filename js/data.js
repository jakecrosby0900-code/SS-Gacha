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
Shark Puppet Mythic
Split Sparky Doo Sigma
The Shed Sigma
Fazgirl Sigma
Awesome Garfield NFT from like 10 years ago Sigma
The Coon of Doom Sigma
The Ringtone of Despair Sigma`;

  // Colour of each set's card art and pack label.
  const CATS = {
    SS:    { hue: 8,   name: 'SS',    blurb: 'The original strike team.' },
    SSR:   { hue: 42,  name: 'SSR',   blurb: 'The big roster: the largest set in the game.' },
    SS3:   { hue: 172, name: 'SS3',   blurb: 'Third-wave versions.' },
    SSC:   { hue: 268, name: 'SSC',   blurb: 'Few cards, all of them rare.' },
    BU:    { hue: 348, name: 'BU',    blurb: 'Glitched, revived and broken.' },
    EXTRA: { hue: 200, name: 'EXTRA', blurb: 'Odds and ends. Hard to find.' }
  };

  function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(seed) { let a = seed; return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  // Duel stats by tier: [attack, health]. A little seeded variation is added per card.
  const BASE_STATS = [[2, 5], [3, 6], [4, 8], [6, 11], [8, 14], [10, 17], [13, 22]];
  const ABILITIES = {
    guard:  { name: 'Guard',  icon: '🛡', text: 'Takes 1 less damage from every hit.' },
    rush:   { name: 'Rush',   icon: '⚡', text: 'Strikes first in a clash, whatever the speeds.' },
    mend:   { name: 'Mend',   icon: '✚', text: 'Heals 2 after each clash it survives.' },
    frenzy: { name: 'Frenzy', icon: '🔥', text: 'Gains +1 attack after every clash.' },
    thorns: { name: 'Thorns', icon: '✦', text: 'When destroyed, deals 1 damage to whoever did it.' }
  };
  const AB_KEYS = Object.keys(ABILITIES);

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
    const ti = TIERS.indexOf(tier), r = rng(hash(id));
    const atk = Math.max(1, BASE_STATS[ti][0] + Math.floor(r() * 3) - 1);
    const hp = Math.max(3, BASE_STATS[ti][1] + Math.floor(r() * 5) - 2);
    const spd = Math.min(9, 1 + Math.floor(r() * 6) + Math.floor(ti / 2));
    const ab = AB_KEYS[Math.floor(r() * AB_KEYS.length)];
    CARDS.push({ img: IMAGES[id] || null, id: id, name: name, cat: cat, tier: tier, ti: ti, atk: atk, hp: hp, spd: spd, ab: ab });
  });
  // Rank 1 = hardest to pull. Ties break by set order, then name.
  const catOrder = Object.keys(CATS);
  CARDS.slice().sort(function (a, b) { return b.ti - a.ti || catOrder.indexOf(a.cat) - catOrder.indexOf(b.cat) || a.name.localeCompare(b.name); })
    .forEach(function (c, i) { c.rank = i + 1; });
  const BYID = {}; CARDS.forEach(function (c) { BYID[c.id] = c; });
  const BYTIER = TIERS.map(function (t) { return CARDS.filter(function (c) { return c.tier === t; }); });

  // Base chance weight of each tier for one card slot, before a difficulty's luck is applied to Rare and above.
  const BASE_WEIGHTS = [50, 28, 14, 5, 2, 0.8, 0.08];
  // Coins gained when recycling a spare copy.
  const SELL = [5, 12, 30, 80, 200, 500, 1500];

  // Difficulty settings. interval = minutes per free pack. luck multiplies the weight of Rare and above.
  // pity = packs in a row with nothing Rare+ before the next one is guaranteed (0 = off).
  // aiShift moves duel opponents up or down the AI ladder. botMult scales opponent stats.
  const DIFFS = {
    sigma: { label: 'Sigma', sub: 'Sigma', color: '#e6edf2', interval: 10, cap: 10, start: 10, luck: 0.45, holo: 0.02, pity: 0, packCost: 0 }
  };

  const OPPONENTS = [
    { id: 0, name: 'Night Guard Trainee',   mult: 0.75, reward: 60,  ai: 0, weights: [60, 30, 8, 2, 0, 0, 0],     blurb: 'Still learning the cameras.' },
    { id: 1, name: 'Security Veteran',      mult: 0.95, reward: 130,  ai: 1, weights: [35, 35, 20, 8, 2, 0, 0],    blurb: 'Has seen every animatronic twice.' },
    { id: 2, name: 'Special Strike Agent',  mult: 1.2,  reward: 260, ai: 2, weights: [10, 25, 30, 20, 10, 5, 0],  blurb: 'Fights with a plan.' },
    { id: 3, name: 'Sigma Protocol',        mult: 1.5,  reward: 600, ai: 3, weights: [0, 5, 20, 30, 25, 15, 5],   blurb: 'Wins pay a bonus pack.' }
  ];
  const AI_NAMES = ['picks at random', 'picks its strongest attacker', 'picks the best matchup', 'tries to read your pick'];

  window.SSG = { TIERS: TIERS, TIER_COLOR: TIER_COLOR, CATS: CATS, CARDS: CARDS, BYID: BYID, BYTIER: BYTIER, BASE_WEIGHTS: BASE_WEIGHTS, SELL: SELL,
    DIFFS: DIFFS, OPPONENTS: OPPONENTS, AI_NAMES: AI_NAMES, ABILITIES: ABILITIES, hash: hash, rng: rng };
})();
