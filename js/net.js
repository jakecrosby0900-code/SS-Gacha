// Online layer: leaderboard, public profiles, cloud save and trading, all through GitHub Issues.
//
// How it works (no server):
//  - Every player owns ONE issue titled "player:<id> <name>". Its body is JSON: their profile and collection.
//    While the site is open the client rewrites it about every 60 seconds. That is the "published save".
//  - A trade offer is ONE issue titled "trade:<id> ...". The JSON body holds who, what is offered and wanted, and a status.
//    The sender's offered cards are held in escrow (removed from their collection) until the offer is settled.
//  - Everybody reads the open issues list to get the leaderboard, other profiles and trade offers.
//  - A GitHub Action snapshots the players into data/leaderboard.json, which is the read-only fallback for visitors without a token.
(function () {
  'use strict';
  window.SSGNet = function (ctx) {
    const G = ctx.G, BYID = G.BYID, CARDS = G.CARDS, esc = ctx.esc, $ = ctx.$, $$ = ctx.$$;
    const S = () => ctx.S();
    const LS = 'ss-gacha-net', EVERY = 60000, ONLINE_MS = 150000, BEAT_MS = 240000, MAX_BODY = 64000;
    const net = { dir: [], trades: [], accounts: [], grants: [], redeems: [], board: [], cfg: G.cleanConfig(null), cfgNum: 0, imgNum: {}, cfgKey: '', status: 'off', msg: '', last: 0, busy: false, lastKey: '', lastBeat: 0, createdAt: 0, loaded: false, cfgChanged: false, friends: [], complete: false, sig: '', imgreqs: [] };
    const BOARD_MS = 7 * 86400000, BOARD_MAX = 3, BOARD_CARDS = 8;
    const CFG_CACHE = 'ss-gacha-cfg';
    const view = { by: 'score', q: '' };
    const okImg = (v) => (typeof v === 'string' && /^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(v) && v.length < 200000 ? v : null);
    const nm = (v) => String(v == null ? '' : v).replace(/[\r\n\t]+/g, ' ').trim().slice(0, 20) || 'Player';
    const idOk = (v) => (typeof v === 'string' && /^[a-z0-9]{6,40}$/.test(v) ? v : null);

    // ---------- connection ----------
    function stored() { try { return JSON.parse(localStorage.getItem(LS) || '{}') || {}; } catch (e) { return {}; } }
    function detectRepo() {
      const m = /^([^.]+)\.github\.io$/.exec(location.hostname); if (!m) return '';
      const seg = location.pathname.split('/').filter(Boolean)[0];
      return seg && !/\.html?$/.test(seg) ? m[1] + '/' + seg : m[1] + '/' + m[1] + '.github.io';
    }
    function conf() {
      const base = window.SSG_NET || {}, st = stored();
      let shared = ''; try { shared = Array.isArray(base.tokenEnc) && base.tokenEnc.length ? base.tokenEnc.slice().reverse().map(atob).join('') : ''; } catch (e) { shared = ''; }
      return { repo: st.repo || base.repo || detectRepo(), token: st.token || shared, api: String(st.api || base.api || 'https://api.github.com').replace(/\/$/, ''), personal: !!st.token };
    }
    const enabled = () => { const c = conf(); return !!(c.repo && c.token); };
    async function gh(method, path, body, keep) {
      const c = conf(), headers = { Accept: 'application/vnd.github+json' };
      if (c.token) headers.Authorization = 'Bearer ' + c.token;
      if (body) headers['Content-Type'] = 'application/json';
      const ac = new AbortController(), to = setTimeout(() => ac.abort(), 20000); let r;
      try { r = await fetch(c.api + path, { method, headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store', keepalive: !!keep, signal: ac.signal }); }
      catch (e) { throw new Error(e.name === 'AbortError' ? 'GitHub did not answer in time' : 'Network error: ' + e.message); } finally { clearTimeout(to); }
      if (!r.ok) {
        const e = new Error(r.status === 401 ? 'Token rejected (401)' : r.status === 403 || r.status === 429 ? 'GitHub rate limit or permission problem (' + r.status + ')' : r.status === 404 ? 'Repo or issue not found (404). Check the repo name and token access.' : 'GitHub error ' + r.status);
        e.status = r.status; throw e;
      }
      return r.status === 204 ? null : r.json();
    }

    // ---------- reading other players ----------
    // Monday 00:00 UTC of the week containing t: the leaderboard's "this week" tab resets then.
    const weekStart = (t) => { const d = new Date(t), day = (d.getUTCDay() + 6) % 7; return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day); };
    function derive(p) {
      let score = 0, unique = 0, sk = 0, best = null;
      Object.keys(p.cards).forEach((id) => { const c = BYID[id], e = p.cards[id]; unique++; score += G.cardScore(c, e); if (e.h > 0) sk++; if (!best || c.ti > best.ti || (c.ti === best.ti && c.rank < best.rank)) best = c; });
      p.score = score; p.unique = unique; p.skibidi = sk; p.rarest = best ? best.name : null;
      return p;
    }
    function cleanPlayer(b, num) {
      const id = idOk(b.id); if (!id) return null;
      const cards = {};
      if (b.cards && typeof b.cards === 'object') Object.keys(b.cards).forEach((cid) => { const a = b.cards[cid]; if (BYID[cid] && Array.isArray(a) && +a[0] > 0) { const n = Math.min(9999, +a[0] | 0); cards[cid] = { n: n, h: Math.min(n, Math.max(0, +a[1] | 0)), f: a[2] ? 1 : 0, t: +a[3] || 0, l: +a[4] || 0 }; } });
      const wish = Array.isArray(b.wish) ? b.wish.filter((x) => typeof x === 'string' && BYID[x]).slice(0, 300) : [];
      const wk = b.wk && +b.wk.t === weekStart(Date.now()) ? Math.max(0, +b.wk.s || 0) : null;
      const pl = derive({ id: id, name: nm(b.name), hue: Number.isFinite(+b.hue) ? ((+b.hue % 360) + 360) % 360 : 28, pfp: okImg(b.pfp), banner: okImg(b.banner), joined: +b.joined || 0, seen: +b.seen || 0,
        mod: +(b.save && b.save.mod) || +b.seen || 0, opened: +(b.opened) || 0, pulls: +(b.pulls) || 0, cards: cards, num: num, full: true, raw: b.save && typeof b.save === 'object' ? b.save : null });
      pl.show = Array.isArray(b.show) ? b.show.filter((x) => typeof x === 'string' && /\|[01]$/.test(x)).slice(0, 5) : [];
      pl.wish = wish; pl.week = wk == null ? 0 : Math.max(0, pl.score - wk); pl.bio = String(b.bio == null ? '' : b.bio).replace(/[\r\n\t]+/g, ' ').trim().slice(0, 120);
      return pl;
    }
    const items = (a) => (Array.isArray(a) ? a.slice(0, 60).map((x) => ({ id: String(x && x.id), h: x && x.h ? 1 : 0 })).filter((x) => BYID[x.id]) : []);
    function cleanTrade(b, num) {
      const tid = idOk(b.id), f = b.from || {}, t = b.to || {};
      if (!tid || !idOk(f.id) || !idOk(t.id)) return null;
      return { id: tid, num: num, from: { id: f.id, name: nm(f.name) }, to: { id: t.id, name: nm(t.name) }, give: items(b.give), want: items(b.want), msg: String(b.msg == null ? '' : b.msg).replace(/[\r\n\t]+/g, ' ').trim().slice(0, 140), at: +b.at || 0, re: idOk(b.re) || '',
        status: ['open', 'accepted', 'declined', 'cancelled'].indexOf(b.status) >= 0 ? b.status : 'open' };
    }
    // ---------- admin config (card edits, new cards, removed players) ----------
    function applyCfg(cfg, imgs) {
      const key = JSON.stringify([cfg, imgs]);
      net.cfg = G.applyConfig(cfg, imgs);
      if (key !== net.cfgKey) { net.cfgKey = key; net.cfgChanged = true; }
    }
    // Shows the cards the admin set up before the first online sync finishes.
    function loadCache() {
      try { const j = JSON.parse(localStorage.getItem(CFG_CACHE) || 'null'); if (j && j.cfg) { const imgs = {}; Object.keys(j.imgs || {}).forEach((k) => { const v = okImg(j.imgs[k]); if (v) imgs[k] = v; }); applyCfg(j.cfg, imgs); net.cfgChanged = false; } } catch (e) { /* ignore */ }
    }
    function cacheCfg(imgs) {
      let keep = imgs; try { if (JSON.stringify(imgs).length > 1200000) keep = {}; } catch (e) { keep = {}; } // big picture caches could fill the browser's storage and stop the save from being written
      try { localStorage.setItem(CFG_CACHE, JSON.stringify({ cfg: net.cfg, imgs: keep })); }
      catch (e) { try { localStorage.setItem(CFG_CACHE, JSON.stringify({ cfg: net.cfg, imgs: {} })); } catch (e2) { /* ignore */ } }
    }
    async function refresh() {
      const c = conf(); let all = [], done = false;
      for (let page = 1; page <= 30; page++) {
        const r = await gh('GET', `/repos/${c.repo}/issues?state=open&per_page=100&page=${page}`);
        all = all.concat(r.filter((i) => !i.pull_request)); if (r.length < 100) { done = true; break; }
      }
      net.complete = done; // false = there are more open issues than we read; absent things must then NOT be taken to mean "deleted"
      const parsed = [];
      all.forEach((i) => { let b; try { b = JSON.parse(i.body); } catch (e) { return; } if (b && typeof b === 'object') parsed.push({ i: i, b: b }); });
      // 1) admin config, card pictures and accounts first, so custom cards exist before players are read
      let cfgIssue = null; const imgs = {}, imgNum = {}, accounts = {}, grants = [], redeems = [], seenRd = {}, board = [], friends = [], imgreqs = [];
      parsed.forEach((x) => {
        const b = x.b, num = x.i.number;
        if (b.t === 'config') { if (!cfgIssue || num < cfgIssue.num) cfgIssue = { num: num, b: b }; }
        else if (b.t === 'cardimg' && typeof b.id === 'string') { const im = okImg(b.img); if (im && (imgNum[b.id] == null || num < imgNum[b.id])) { imgs[b.id] = im; imgNum[b.id] = num; } }
        else if (b.t === 'grant' && typeof b.gid === 'string' && /^[a-z0-9]{6,40}$/.test(b.gid) && typeof b.k === 'string') {
          const cs = Array.isArray(b.cards) ? b.cards.slice(0, 60).map((x) => ({ id: String(x && x.id), h: x && x.h ? 1 : 0, n: Math.min(99, Math.max(1, +(x && x.n) | 0 || 1)) })).filter((x) => BYID[x.id]) : [];
          const tk = Array.isArray(b.take) ? b.take.slice(0, 120).map((x) => ({ id: String(x && x.id), h: x && x.h ? 1 : 0, n: Math.min(9999, Math.max(1, +(x && x.n) | 0 || 1)) })).filter((x) => BYID[x.id]) : [];
          grants.push({ gid: b.gid, k: b.k.toLowerCase(), num: num, cards: cs, take: tk, wipe: !!b.wipe, opened: b.opened == null || !Number.isFinite(+b.opened) ? null : Math.min(1000000, Math.max(0, Math.floor(+b.opened))), packs: Math.min(1000, Math.max(0, +b.packs | 0)), at: +b.at || 0 });
        }
        else if (b.t === 'board' && idOk(b.pid)) { const ok = (a) => (Array.isArray(a) ? a.filter((x) => typeof x === 'string' && BYID[x.replace(/\|[01]$/, '')]).map((x) => (/\|0$/.test(x) ? x.slice(0, -2) : x)).slice(0, BOARD_CARDS) : []), want = ok(b.want), offer = ok(b.offer); if ((want.length || offer.length) && Date.now() - (+b.at || 0) < BOARD_MS) board.push({ num: num, id: String(b.id || num).slice(0, 24), pid: b.pid, name: nm(b.name), want: want, offer: offer, note: String(b.note || '').replace(/[\r\n\t]+/g, ' ').slice(0, 100), at: +b.at || 0, ccount: +x.i.comments || 0 }); }
        else if (b.t === 'imgreq' && idOk(b.id) && idOk(b.pid) && typeof b.card === 'string') { imgreqs.push({ id: b.id, num: num, card: b.card.slice(0, 120), pid: b.pid, name: nm(b.name), img: okImg(b.img), note: String(b.note || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 120), at: +b.at || 0, status: ['pending', 'approved', 'rejected'].indexOf(b.status) >= 0 ? b.status : 'pending' }); }
        else if (b.t === 'friend' && idOk(b.id) && b.from && b.to && idOk(b.from.id) && idOk(b.to.id)) { friends.push({ fid: b.id, num: num, from: { id: b.from.id, name: nm(b.from.name) }, to: { id: b.to.id, name: nm(b.to.name) }, status: ['pending', 'accepted', 'declined'].indexOf(b.status) >= 0 ? b.status : 'pending', at: +b.at || 0, ccount: +x.i.comments || 0 }); }
        else if (b.t === 'redeem' && typeof b.code === 'string' && idOk(b.pid)) { const k = b.pid + '|' + b.code; if (!seenRd[k]) { seenRd[k] = 1; redeems.push({ code: b.code.toUpperCase().slice(0, 24), pid: b.pid, name: nm(b.name), at: +b.at || 0 }); } }
        else if (b.t === 'account' && b.v === 2 && typeof b.did === 'string' && /^\d{15,19}$/.test(b.did) && idOk(b.pid)) {
          // Discord accounts only. Old username/password accounts (no "did") are ignored, so they never count as accounts or reach the leaderboard.
          const k = 'd' + b.did;
          if (!accounts[k] || accounts[k].num > num) accounts[k] = { k: k, u: String(b.u || 'Player').slice(0, 20), did: b.did, pid: b.pid, created: +b.created || 0, num: num };
        }
      });
      net.cfgNum = cfgIssue ? cfgIssue.num : 0; net.imgNum = imgNum;
      applyCfg(cfgIssue ? cfgIssue.b : null, imgs); cacheCfg(imgs);
      net.accounts = Object.keys(accounts).map((k) => accounts[k]); net.grants = grants; net.redeems = redeems;
      const byPid = {}; net.accounts.forEach((a) => { byPid[a.pid] = a; });
      // 2) players and trades
      const blocked = {}; net.cfg.blocked.forEach((x) => { blocked[x.id] = 1; });
      net.board = board.filter((x) => !blocked[x.pid]).sort((a, b) => b.at - a.at).slice(0, 200);
      const players = {}, trades = [];
      parsed.forEach((x) => {
        const b = x.b, num = x.i.number;
        if (b.t === 'player') { const p = cleanPlayer(b, num); if (p && !blocked[p.id] && (!players[p.id] || players[p.id].num > p.num)) players[p.id] = p; }
        else if (b.t === 'trade') { const t = cleanTrade(b, num); if (t && !blocked[t.from.id] && !blocked[t.to.id]) trades.push(t); }
      });
      net.dir = Object.keys(players).map((k) => { const p = players[k]; p.acct = byPid[p.id] ? byPid[p.id].u : null; return p; }); net.trades = trades; net.last = Date.now(); net.loaded = true;
      net.imgreqs = imgreqs.filter((r) => !blocked[r.pid]);
      net.friends = friends.filter((f) => !blocked[f.from.id] && !blocked[f.to.id]);
      // fingerprint of everything a page might show (not the "last seen" clock), so quiet redraws only happen when something really changed
      net.sig = net.dir.map((p) => p.id + ':' + p.mod + ':' + p.score + ':' + p.opened).join(',') + '|' + trades.map((t) => t.id + t.status).join(',') + '|' + net.board.map((b) => b.num + ':' + b.ccount).join(',') + '|' + net.friends.map((f) => f.fid + f.status + f.ccount).join(',');
    }
    // Admin writes. Re-reads the config issue first so two edits do not overwrite each other.
    async function updateConfig(fn, note) {
      const c = conf(); let cfg = G.cleanConfig(null);
      if (net.cfgNum) { try { const cur = await gh('GET', `/repos/${c.repo}/issues/${net.cfgNum}`); cfg = G.cleanConfig(JSON.parse(cur.body)); } catch (e) { if (e.status && e.status !== 404 && e.status !== 410) throw e; } }
      try { localStorage.setItem('ss-gacha-cfg-undo', JSON.stringify(cfg)); } catch (e) { /* ignore */ } // what "Undo last change" goes back to
      const before = JSON.parse(JSON.stringify(cfg)); fn(cfg); cfg = G.cleanConfig(cfg);
      const NAMES = { approved: 'approvals', revoked: 'approvals', setOrder: 'set order', edits: 'card edits', added: 'custom cards', tiers: 'custom rarities', sets: 'custom sets', tierEdits: 'rarity edits', setEdits: 'set edits', events: 'power hours', codes: 'codes', announce: 'announcements', blocked: 'leaderboard removals', settings: 'settings' };
      const changed = Object.keys(NAMES).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(cfg[k])).map((k) => NAMES[k]);
      if (note || changed.length) cfg.log = [{ at: Date.now(), text: note || 'Changed ' + changed.join(', ') }].concat(cfg.log || []).slice(0, 100);
      const body = JSON.stringify(Object.assign({ t: 'config', v: 1 }, cfg));
      if (body.length > MAX_BODY) throw new Error('Config is too big for one GitHub issue');
      if (net.cfgNum) await gh('PATCH', `/repos/${c.repo}/issues/${net.cfgNum}`, { body: body });
      else { const r = await gh('POST', `/repos/${c.repo}/issues`, { title: 'config:game', body: body }); net.cfgNum = r.number; }
      await refresh();
    }
    // dataUrl = null removes the custom picture.
    // Records that this player used a code (so the admin can see usage and enforce limits).
    function logRedeem(code) { const s = S(); return createIssue(`redeem:${code} ${s.profile.name}`.replace(/[\r\n]+/g, ' '), { t: 'redeem', code: code, pid: s.profile.id, name: s.profile.name, at: Date.now() }).catch(() => {}); }
    async function saveCardImage(id, dataUrl) {
      const c = conf(), num = net.imgNum[id];
      if (!dataUrl) { if (num) await gh('PATCH', `/repos/${c.repo}/issues/${num}`, { state: 'closed' }); }
      else {
        const body = JSON.stringify({ t: 'cardimg', v: 1, id: id, img: dataUrl });
        if (body.length > MAX_BODY) throw new Error('That picture is too big. Try a smaller one.');
        if (num) await gh('PATCH', `/repos/${c.repo}/issues/${num}`, { body: body });
        else await gh('POST', `/repos/${c.repo}/issues`, { title: `cardimg ${id}`.replace(/[\r\n]+/g, ' '), body: body });
      }
      await refresh();
    }
    async function closeIssue(num) { await gh('PATCH', `/repos/${conf().repo}/issues/${num}`, { state: 'closed' }); }
    async function createIssue(title, body) { const r = await gh('POST', `/repos/${conf().repo}/issues`, { title: title, body: JSON.stringify(body) }); return r.number; }
    async function fallback() {
      if (net.loaded && Date.now() - net.last < 60000) return;
      try {
        const r = await fetch('data/leaderboard.json?t=' + Date.now(), { cache: 'no-store' }); if (!r.ok) throw 0;
        const j = await r.json();
        net.dir = (j.players || []).filter((p) => idOk(p.id)).map((p) => ({ id: p.id, name: nm(p.name), hue: +p.hue || 28, pfp: okImg(p.pfp), banner: null, joined: +p.joined || 0, seen: +p.seen || 0, opened: +p.opened || 0, pulls: 0, cards: {},
          score: +p.score || 0, unique: +p.unique || 0, skibidi: +p.skibidi || 0, rarest: p.rarest ? String(p.rarest).slice(0, 40) : null, full: false }));
        net.last = Date.now(); net.loaded = true;
      } catch (e) { net.loaded = true; net.last = Date.now(); }
    }
    const isMe = (p) => p.id === S().profile.id;
    const online = (p) => isMe(p) ? net.status === 'ok' : Date.now() - p.seen < ONLINE_MS;

    // ---------- publishing my account ----------
    function build() {
      const s = S(), p = s.profile, cards = {};
      Object.keys(s.cards).forEach((id) => { const e = s.cards[id]; if (BYID[id] && e.n > 0) cards[id] = [e.n, e.h || 0, e.f ? 1 : 0, e.t || 0, e.l || 0]; });
      const ws = weekStart(Date.now()); if (!s.wk || s.wk.t < ws) s.wk = { t: ws, s: G.scoreOf(s.cards) };
      return { t: 'player', v: 1, id: p.id, name: p.name, bio: p.bio || '', hue: p.hue, pfp: p.pfp, banner: p.banner, joined: p.joined, seen: Date.now(), opened: s.stats.opened, pulls: s.stats.pulls, cards: cards, wish: Object.keys(s.wish || {}).filter((x) => BYID[x]).slice(0, 300), wk: s.wk, show: s.showcase || [],
        save: { wish: s.wish || {}, wk: s.wk, showcase: s.showcase || [], mod: s.mod || 0, granted: s.granted, packs: s.packs, bonus: s.bonus || 0, last: s.last, sinceRare: s.sinceRare, started: s.started, stats: s.stats, codes: s.codes, net: s.net, social: s.social } };
    }
    // Uploads this device's save to the account's player issue. s.syncMod remembers which version the cloud holds, so a stale device can tell it must merge first.
    async function publish(force, keep) {
      const s = S(), c = conf(), snap = build(), key = JSON.stringify(Object.assign({}, snap, { seen: 0 }));
      if (net.cfg.blocked.some((x) => x.id === s.profile.id)) return; // removed from the leaderboard by the admin
      const mine = net.dir.find(isMe) || (net.myNum && Date.now() - net.createdAt < 120000 ? { num: net.myNum } : null); // the new-issue shortcut only covers GitHub's short listing delay
      if (!force && key === net.lastKey && Date.now() - net.lastBeat < BEAT_MS && (mine || Date.now() - net.createdAt < 120000)) return;
      let body = JSON.stringify(snap);
      if (body.length > MAX_BODY) { delete snap.banner; body = JSON.stringify(snap); }
      if (body.length > MAX_BODY) { delete snap.pfp; body = JSON.stringify(snap); }
      if (body.length > MAX_BODY) { snap.save.net = { out: s.net.out, done: {}, q: s.net.q, hist: [], miss: s.net.miss }; body = JSON.stringify(snap); }
      if (body.length > MAX_BODY) { snap.save.social = { notes: [], nseen: {}, seen: s.social.seen, badges: s.social.badges }; body = JSON.stringify(snap); }
      const title = `player:${s.profile.id} ${s.profile.name}`.replace(/[\r\n]+/g, ' ');
      if (mine) await gh('PATCH', `/repos/${c.repo}/issues/${mine.num}`, { title: title, body: body }, keep);
      else if (Date.now() - net.createdAt > 120000) {
        const made = await gh('POST', `/repos/${c.repo}/issues`, { title: title, body: body }); net.myNum = made.number;
        net.createdAt = Date.now();
      } else return;
      net.lastKey = key; net.lastBeat = Date.now();
      s.syncMod = snap.save.mod; delete s.overwrite; ctx.save(true);
      if (mine) mine.mod = snap.save.mod;
    }
    // Plain-English report used by the Account panel in Settings.
    async function diag() {
      const c = conf(), s = S();
      if (!c.repo || !c.token) return 'Not connected: no GitHub repo/token configured (repo "' + (c.repo || 'none') + '").';
      for (let i = 0; i < 50 && net.busy; i++) await new Promise((r) => setTimeout(r, 300));
      if (net.busy) return 'A sync has been stuck for 15 seconds (GitHub is not answering). Reload the page and try again.';
      net.busy = true; let out = '';
      try {
        await refresh();
        if (net.cfg.blocked.some((x) => x.id === s.profile.id)) return 'Your player (id ' + s.profile.id + ') is on the admin\'s removed list (Admin page > Removed players), so it is never uploaded or shown. Press Restore there, then press this button again.';
        net.createdAt = 0; net.myNum = 0; net.lastKey = '';
        const before = net.dir.find(isMe);
        await publish(true);
        await refresh();
        const mine = net.dir.find(isMe), local = Object.keys(s.cards).filter((id) => s.cards[id].n > 0).length;
        if (mine) return 'Saved online (' + c.repo + ', issue #' + mine.num + '): ' + mine.unique + ' cards online, ' + local + ' on this device.';
        out = 'Upload ran (' + (before ? 'updated' : 'created') + ' issue #' + (net.myNum || '?') + ') but the leaderboard cannot read it back.';
        if (net.myNum) { const cur = await gh('GET', '/repos/' + c.repo + '/issues/' + net.myNum); out += ' Issue state: ' + cur.state + ', body ' + (cur.body || '').length + ' chars.'; try { out += cleanPlayer(JSON.parse(cur.body), cur.number) ? ' Body is valid.' : ' Body was rejected as invalid.'; } catch (e) { out += ' Body is not valid JSON (probably cut off).'; } }
        return out;
      } catch (e) { return 'Upload FAILED: ' + (e.message || e) + (e.status ? ' [HTTP ' + e.status + ']' : ''); }
      finally { net.busy = false; paint(); }
    }
    // If another device uploaded a newer save than the one this device last synced, bring it in (merging when this device also has new changes) before uploading.
    function reconcile() {
      const s = S(), mine = net.dir.find(isMe);
      if (ctx.busy() || s.overwrite || !mine || !mine.full) return false;
      const cm = mine.mod || 0;
      if (cm <= (s.syncMod || 0)) return false;
      const localChanged = (s.mod || 0) > (s.syncMod || 0) || (!s.mod && !s.syncMod && Object.keys(s.cards).length > 0);
      ctx.mergeCloud(mine, localChanged || !mine.raw);
      return true;
    }
    // Cards and packs the admin gave to this account: applied once, then the grant is closed online.
    const closedGrants = {};
    function applyGrants() {
      const s = S(); if (!s.account || ctx.busy()) return false; let any = false;
      const mine = net.accounts.find((a) => a.k === s.account);
      // k '*' = a gift for everyone (only accounts that existed when it was sent, for 14 days).
      net.grants.filter((g) => g.k === s.account || (g.k === '*' && mine && mine.created <= g.at && Date.now() - g.at < 1209600000)).forEach((g) => {
        if (s.granted[g.gid]) return;
        const held = g.cards.filter((it) => BYID[it.id].monster && !s.settings.monster);
        g.cards.forEach((it) => { if (BYID[it.id].monster && !s.settings.monster) return; for (let i = 0; i < it.n; i++) ctx.addCopy(it.id, it.h); }); // Monster cards only arrive while the monster is let in
        if (held.length) hist('Monster card(s) from the admin were held back because the monster is not let in: ' + held.map((it) => BYID[it.id].name).join(', ') + '.');
        if (g.packs) s.bonus = (s.bonus || 0) + g.packs;
        if (g.wipe) { Object.keys(s.cards).forEach((id) => { delete s.cards[id]; }); hist('The admin removed all your cards.'); }
        else if (g.take.length) { g.take.forEach((it) => { for (let i = 0; i < it.n; i++) { if (!ctx.takeCopy(it.id, it.h)) break; } }); hist('The admin removed: ' + g.take.map((it) => BYID[it.id].name + (it.h ? ' (skibidi)' : '') + (it.n > 1 ? ' x' + it.n : '')).join(', ') + '.'); }
        if (g.opened != null) { s.stats.opened = g.opened; hist('The admin set your packs opened to ' + g.opened + '.'); }
        s.granted[g.gid] = Date.now(); any = true;
        const parts = g.cards.map((it) => BYID[it.id].name + (it.h ? ' (skibidi)' : '') + (it.n > 1 ? ' x' + it.n : '')); if (g.packs) parts.push(g.packs + ' pack' + (g.packs === 1 ? '' : 's'));
        if (!g.wipe && !g.take.length && (g.cards.length || g.packs)) hist('The admin gave you: ' + (parts.join(', ') || 'a gift') + '.');
      });
      const ks = Object.keys(s.granted); if (ks.length > 300) ks.sort((a, b) => s.granted[a] - s.granted[b]).slice(0, ks.length - 300).forEach((k) => delete s.granted[k]);
      if (any) { ctx.save(); toast('The admin changed your collection.'); ctx.notify('gift:' + Date.now().toString(36), 'gift', (s.net.hist[0] && s.net.hist[0].text) || 'The admin changed your collection.', '#collection'); }
      return any;
    }
    async function closeGrants() {
      const s = S(), c = conf();
      // Removals stay open for 3 days so a second, out-of-date device also applies them instead of bringing the cards back.
      for (const g of net.grants.filter((x) => (x.k === s.account || x.k === '*') && s.granted[x.gid] && !closedGrants[x.num] && ((x.k !== '*' && !(x.wipe || x.take.length || x.opened != null)) || Date.now() - x.at > (x.k === '*' ? 1209600000 : 259200000)))) { closedGrants[g.num] = 1; try { await gh('PATCH', `/repos/${c.repo}/issues/${g.num}`, { state: 'closed' }); } catch (e) { /* retried after a reload */ } }
    }
    // Upload soon after any change instead of waiting for the next 60 second cycle.
    let touchT = 0;
    function touch() {
      if (!enabled()) return; clearTimeout(touchT);
      const go = () => { if (net.busy) { touchT = setTimeout(go, 800); return; } cycle(true); };
      touchT = setTimeout(go, 1000);
    }
    // The tab is closing or going to the background: push anything not yet uploaded.
    function flush() {
      try {
        const s = S(); if (!enabled() || !ctx.loggedIn() || !ctx.allowed() || ctx.busy() || (s.mod || 0) <= (s.syncMod || 0)) return;
        const mine = net.dir.find(isMe); if (!mine) return;
        publish(true, true).catch(() => {});
      } catch (e) { /* ignore */ }
    }

    // ---------- trading ----------
    // Trade lists hold one entry per copy; group them for display ("Freddy ×3").
    const group = (list) => { const m = {}, o = []; list.forEach((it) => { const k = it.id + '|' + it.h; if (!m[k]) { m[k] = { id: it.id, h: it.h, n: 0 }; o.push(m[k]); } m[k].n++; }); return o; };
    const names = (a) => group(a).map((it) => BYID[it.id].name + (it.h ? ' (skibidi)' : '') + (it.n > 1 ? ' ×' + it.n : '')).join(', ');
    // One line per settled trade for the home page. a = cards I gave, b = cards I got.
    function logTrade(dir, who, a, b, st) { const l = S().net.log; l.unshift({ at: Date.now(), dir: dir, who: String(who || '').slice(0, 20), a: a, b: b, st: st }); l.length = Math.min(l.length, 20); }
    function hist(text) { const h = S().net.hist; h.unshift({ at: Date.now(), text: text }); h.length = Math.min(h.length, 30); }
    const incoming = () => net.trades.filter((t) => t.status === 'open' && t.to.id === S().profile.id && !S().net.done[t.id]);
    const outgoing = () => Object.keys(S().net.out).map((tid) => Object.assign({ id: tid }, S().net.out[tid], { live: net.trades.find((t) => t.id === tid) }));
    function prune() { const d = S().net.done, k = Object.keys(d); if (k.length > 200) k.slice(0, k.length - 200).forEach((x) => delete d[x]); }
    function completeOut(tid, kind) {
      const s = S(), o = s.net.out[tid]; if (!o) return;
      if (kind === 'accepted') { o.want.forEach((it) => ctx.addCopy(it.id, it.h)); hist(`${o.toName} accepted your trade. You got ${o.want.length ? names(o.want) : 'nothing (a gift)'}.`); }
      else { o.give.forEach((it) => ctx.addCopy(it.id, it.h)); hist(`Your trade with ${o.toName} was ${kind}. Your cards came back.`); }
      logTrade('to', o.toName, o.give.length, o.want.length, kind === 'accepted' ? 'accepted' : kind === 'declined' ? 'denied' : kind === 'cancelled' ? 'cancelled' : 'invalid');
      ctx.notify('tr-res:' + tid, kind === 'accepted' ? 'trade-ok' : 'trade-no', kind === 'accepted' ? `${o.toName} accepted your trade${o.want.length ? ' and you got ' + names(o.want) : ' (your gift)'}.` : kind === 'declined' ? `${o.toName} declined your trade. Your cards came back.` : `Your trade with ${o.toName} was ${kind}. Your cards came back.`, '#trades');
      s.net.q.push({ num: o.num, tid: tid, set: { ack: 1 }, close: true });
      delete s.net.out[tid]; delete s.net.miss[tid]; s.net.done[tid] = 1; prune();
    }
    // Looks at the sent offers: pay out accepted ones, refund declined/cancelled/vanished ones.
    function settle() {
      const s = S(); let changed = false;
      Object.keys(s.net.out).forEach((tid) => {
        const o = s.net.out[tid], tr = net.trades.find((t) => t.id === tid);
        if (tr) { s.net.miss[tid] = 0; o.num = o.num || tr.num; if (tr.status === 'accepted') { completeOut(tid, 'accepted'); changed = true; } else if (tr.status !== 'open') { completeOut(tid, tr.status); changed = true; } }
        else if (Date.now() - o.at > 180000) { s.net.miss[tid] = (s.net.miss[tid] || 0) + 1; if (s.net.miss[tid] >= 3) { completeOut(tid, 'lost'); changed = true; } }
      });
      return changed;
    }
    async function flushQ() {
      const s = S(), c = conf(); let wrote = false;
      for (const it of s.net.q.slice()) {
        try {
          const cur = await gh('GET', `/repos/${c.repo}/issues/${it.num}`); let b = null; try { b = JSON.parse(cur.body); } catch (e) { /* not ours */ }
          if (b && b.t === 'trade') await gh('PATCH', `/repos/${c.repo}/issues/${it.num}`, { body: JSON.stringify(Object.assign(b, it.set)), state: it.close ? 'closed' : undefined });
          s.net.q.splice(s.net.q.indexOf(it), 1); wrote = true;
        } catch (e) { if (e.status === 404 || e.status === 410) s.net.q.splice(s.net.q.indexOf(it), 1); else break; }
      }
      if (wrote) ctx.save();
    }
    async function createTrade(toId, give, want, msg, re) {
      const s = S(), c = conf(), to = net.dir.find((p) => p.id === toId);
      if (!to) throw new Error('Player not found');
      if (!give.length && !want.length) throw new Error('Pick at least one card');
      give.forEach((it) => { if (!ctx.hasCopy(it.id, it.h)) throw new Error('You no longer own ' + BYID[it.id].name); });
      const tid = ctx.uid().replace(/[^a-z0-9]/g, '');
      give.forEach((it) => ctx.takeCopy(it.id, it.h));
      msg = String(msg || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 140);
      s.net.out[tid] = { to: toId, toName: to.name, give: give, want: want, msg: msg, at: Date.now(), num: 0 }; ctx.save();
      const body = { t: 'trade', id: tid, from: { id: s.profile.id, name: s.profile.name }, to: { id: to.id, name: to.name }, give: give, want: want, msg: msg, status: 'open', at: Date.now() };
      if (re) body.re = re;
      const issue = { title: `trade:${tid} ${s.profile.name} → ${to.name}`.replace(/[\r\n]+/g, ' '), body: JSON.stringify(body) };
      try {
        const r = await gh('POST', `/repos/${c.repo}/issues`, issue);
        s.net.out[tid].num = r.number; ctx.save();
      } catch (e) { give.forEach((it) => ctx.addCopy(it.id, it.h)); delete s.net.out[tid]; ctx.save(); throw e; }
    }
    async function accept(tid) {
      const s = S(), c = conf(), tr = net.trades.find((t) => t.id === tid);
      if (!tr || tr.status !== 'open' || s.net.done[tid]) { toast('That offer is not available any more', true); return; }
      try { const cur = await gh('GET', `/repos/${c.repo}/issues/${tr.num}`), b = JSON.parse(cur.body); if (b.status !== 'open') { toast('That offer is not available any more', true); await cycle(true); return; } }
      catch (e) { toast('Could not reach GitHub: ' + e.message, true); return; }
      const need = {}; tr.want.forEach((it) => { const k = it.id + '|' + it.h; need[k] = (need[k] || 0) + 1; });
      for (const k of Object.keys(need)) { const [id, h] = k.split('|'), e = s.cards[id]; const have = e ? (h === '1' ? e.h : e.n - e.h) : 0; if (have < need[k]) { toast('You do not have the cards they want', true); return; } }
      tr.want.forEach((it) => ctx.takeCopy(it.id, it.h)); tr.give.forEach((it) => ctx.addCopy(it.id, it.h));
      s.net.done[tid] = 1; prune(); logTrade('from', tr.from.name, tr.want.length, tr.give.length, 'accepted'); hist(`You accepted ${tr.from.name}'s trade: got ${tr.give.length ? names(tr.give) : 'nothing'}, gave ${tr.want.length ? names(tr.want) : 'nothing'}.`);
      s.net.q.push({ num: tr.num, tid: tid, set: { status: 'accepted', by: s.profile.id, at: Date.now() } }); ctx.save();
      toast('Trade accepted'); await flushQ(); repaint(true);
    }
    async function decline(tid) {
      const s = S(), tr = net.trades.find((t) => t.id === tid); if (!tr) return;
      s.net.done[tid] = 1; logTrade('from', tr.from.name, tr.want.length, tr.give.length, 'denied'); hist(`You declined ${tr.from.name}'s trade.`);
      s.net.q.push({ num: tr.num, tid: tid, set: { status: 'declined' } }); ctx.save(); await flushQ(); repaint(true);
    }
    async function cancel(tid) {
      const s = S(), c = conf(), o = s.net.out[tid]; if (!o) return;
      try {
        const num = o.num || (net.trades.find((t) => t.id === tid) || {}).num; if (!num) throw new Error('Offer not found yet, try again in a moment');
        const cur = await gh('GET', `/repos/${c.repo}/issues/${num}`), b = JSON.parse(cur.body);
        if (b.status === 'open') { b.status = 'cancelled'; await gh('PATCH', `/repos/${c.repo}/issues/${num}`, { body: JSON.stringify(b) }); }
        else toast('They already answered this offer');
        await refresh(); if (settle()) ctx.save(); repaint(true);
      } catch (e) { toast(e.message, true); }
    }
    const toast = (m, err) => ctx.toast(m, err);

    // ---------- sync loop ----------
    let changedFlag = false, pendingForce = false, lastWarn = 0;
    async function cycle(force) {
      if (net.busy) { if (force) pendingForce = true; return; } net.busy = true; changedFlag = false;
      try {
        if (!enabled()) { await fallback(); net.status = 'off'; net.msg = ''; }
        else {
          await refresh(); changedFlag = settle(); if (changedFlag) ctx.save();
          await flushQ(); if (ctx.loggedIn() && ctx.allowed()) { if (reconcile()) changedFlag = true; if (applyGrants()) changedFlag = true; await publish(force); closeGrants(); }
          net.status = 'ok'; net.msg = '';
        }
      } catch (e) { net.status = 'err'; net.msg = e.message || 'Sync failed'; if (ctx.loggedIn() && Date.now() - lastWarn > 30000) { lastWarn = Date.now(); toast('Could not save to your account: ' + net.msg, true); } }
      if (net.cfgChanged) { changedFlag = true; net.cfgChanged = false; }
      net.busy = false; paint(); repaint(changedFlag); if (ctx.onSync) ctx.onSync();
      if (pendingForce) { pendingForce = false; setTimeout(() => cycle(true), 50); }
    }
    function statusText() {
      if (net.status === 'ok') return `Online · synced ${Math.max(0, Math.round((Date.now() - net.last) / 1000))}s ago`;
      if (net.status === 'err') return 'Sync problem: ' + net.msg;
      return conf().repo ? 'Read-only: add a GitHub token in Settings to appear on the leaderboard and trade.' : 'Offline: no GitHub repo detected (set one in Settings).';
    }
    function paint() {
      const d = $('[data-netdot]'); if (d) { d.className = 'netdot ' + net.status; d.title = statusText(); }
      const n = incoming().length; $$('[data-tradebadge]').forEach((b) => { b.hidden = !n; b.textContent = n; });
      if (ctx.social) { const u = ctx.social.unread(), fr = ctx.social.friendAlerts(); $$('[data-notebadge]').forEach((b) => { b.hidden = !u; b.textContent = u > 99 ? '99+' : u; }); $$('[data-friendbadge]').forEach((b) => { b.hidden = !fr; b.textContent = fr; }); }
      const st = $('#plstatus'); if (st) st.textContent = statusText();
      const ss = $('#netstatus'); if (ss) ss.textContent = statusText();
    }
    let lastSig = '';
    function repaint(changed) {
      if ($('.modal-bg') || ctx.busy() || !ctx.loggedIn()) return;
      const h = location.hash.slice(1) || 'home', moved = net.sig !== lastSig; lastSig = net.sig;
      if (h === 'leaderboard' || h === 'players') drawPlayers(); else if (h === 'trades') drawTrades();
      else if (h.indexOf('user-') === 0 || h === 'profile') { if (moved || changed) ctx.route(true); }
      else if (h === 'trade' || h === 'post' || h.indexOf('chat-') === 0) { /* never redraw a half-filled trade, post or open conversation under the player's hands */ }
      else if (h === 'home') { if (changed) ctx.route(true); else if (ctx.refreshFeeds) ctx.refreshFeeds(); }
      else if (h === 'board') { if ((moved || changed) && !$('.cm-box:not([hidden])') && !$('.cm-send input:focus')) ctx.route(true); }
      else if (h === 'friends' || h === 'notifications') { if (ctx.social && (moved || changed || ctx.social.dirty())) ctx.route(true); }
      else if (changed && h !== 'options' && h !== 'admin') ctx.route(true);
    }

    // ---------- pages ----------
    // Legendary-or-better cards other players got most recently, read from their published collections (the home page feed).
    function recentPulls(limit) {
      const out = [], me = S().profile.id; let sawMe = false;
      shown().forEach((p) => {
        const mine = p.id === me; if (mine) sawMe = true; if (!mine && !p.full) return;
        const cards = mine ? S().cards : p.cards;
        Object.keys(cards).forEach((id) => { const c = BYID[id], e = cards[id]; if (c && e && e.n > 0 && c.fx >= 4 && e.l) out.push({ id: p.id, name: mine ? S().profile.name : p.name, card: c, at: e.l, holo: e.h > 0 }); });
      });
      if (!sawMe && ctx.loggedIn()) Object.keys(S().cards).forEach((id) => { const c = BYID[id], e = S().cards[id]; if (c && e && e.n > 0 && c.fx >= 4 && e.l) out.push({ id: me, name: S().profile.name, card: c, at: e.l, holo: e.h > 0 }); });
      return out.sort((a, b) => b.at - a.at).slice(0, limit || 12);
    }
    const TABS = [['score', 'Most points'], ['unique', 'Most unique cards'], ['opened', 'Most packs opened'], ['week', 'This week']];
    const shown = () => net.dir.filter((p) => (p.acct || !net.loaded || !enabled()) && (!p.acct || !net.loaded || approvedPid(p.id)));
    const approvedPid = (pid) => { const a = net.accounts.find((x) => x.pid === pid); return !a || G.isApproved(a); }; // players whose account is still waiting for approval are not listed
    const rankOf = (p) => { const l = shown().slice().sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)); return l.findIndex((x) => x.id === p.id) + 1; };
    const leftText = (ms) => { const m = Math.max(1, Math.ceil(ms / 60000)), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60); return d ? d + 'd ' + h + 'h' : h ? h + 'h ' + (m % 60) + 'm' : m + 'm'; };
    function pagePlayers() {
      if (!TABS.some((t) => t[0] === view.by)) view.by = 'score';
      $('#main').innerHTML = `<h1>Leaderboard</h1><p class="muted" id="plstatus"></p>
        <div class="lb-tabs" role="tablist">${TABS.map(([v, l]) => `<button type="button" role="tab" data-lb="${v}" aria-selected="${view.by === v}">${l}</button>`).join('')}</div>
        <p class="muted small" id="lbnote"></p>
        <div class="filters panel"><label class="f">Find a player<input id="plq" type="search" value="${esc(view.q)}" placeholder="Name or username" autocomplete="off"></label></div><div id="pllist"></div>`;
      $('#plq').oninput = (e) => { view.q = e.target.value; drawPlayers(); };
      $$('[data-lb]').forEach((b) => { b.onclick = () => { view.by = b.dataset.lb; $$('[data-lb]').forEach((x) => x.setAttribute('aria-selected', String(x === b))); drawPlayers(); }; });
      drawPlayers(); paint(); if (Date.now() - net.last > 20000) cycle();
    }
    function drawPlayers() {
      const box = $('#pllist'); if (!box) return;
      const q = view.q.trim().toLowerCase(), key = view.by;
      const note = $('#lbnote'); if (note) note.textContent = key === 'week' ? 'Points earned since Monday 00:00 UTC. Resets in ' + leftText(weekStart(Date.now()) + 604800000 - Date.now()) + '. Everyone starts the week on zero.' : '';
      const byScore = shown().slice().sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)), rk = {}; byScore.forEach((p, i) => { rk[p.id] = i + 1; });
      let list = shown().filter((p) => !q || p.name.toLowerCase().includes(q) || (p.acct || '').toLowerCase().includes(q));
      list = list.slice().sort((a, b) => (b[key] - a[key]) || (b.score - a.score) || a.name.localeCompare(b.name));
      const medal = ['🥇', '🥈', '🥉'], big = (p) => key === 'week' ? '+' + ctx.fmt(p.week) : ctx.fmt(p[key]), unit = { score: 'pts', unique: 'cards', opened: 'packs', week: 'pts this week' }[key];
      ctx.setHTML(box, list.length ? `<div class="pl-list">${list.map((p, i) => `<a class="pl-row ${isMe(p) ? 'me' : ''}" href="#user-${p.id}"><span class="pl-rank">${!q && i < 3 && (key !== 'week' || p.week > 0) ? medal[i] : i + 1}</span>${ctx.avatarHTML(42, p)}
          <span class="pl-name"><span class="pl-top"><b>${esc(p.name)}</b>${p.acct && p.acct.toLowerCase() !== p.name.toLowerCase() ? ` <small class="muted">@${esc(p.acct)}</small>` : ''}${isMe(p) ? ' <small class="muted">(you)</small>' : ''}${online(p) ? ' <span class="online-dot" title="Online now"></span>' : ''}<span class="pl-badges">${G.badgesOf(p.cards, p.opened, rk[p.id]).slice(0, 4).map((b) => `<span title="${esc(b.name)}">${b.ic}</span>`).join('')}</span></span><small class="muted">${p.unique}/${CARDS.length} cards · ${p.opened} packs<span class="hide-sm"> · ${p.skibidi} skibidi · ${ctx.fmt(p.score)} pts</span></small></span>
          <span class="pl-score"><b>${big(p)}</b><small>${unit}</small></span></a>`).join('')}</div>`
        : `<div class="empty"><h2>${net.loaded ? 'No players found' : 'Loading...'}</h2><p class="muted">${net.loaded && !q ? 'Nobody has published a profile yet.' : ''}</p></div>`);
    }
    function pageUser(id) {
      const p = net.dir.find((x) => x.id === id);
      if (!p) { $('#main').innerHTML = `<div class="empty"><h2>${net.loaded ? 'Player not found' : 'Loading...'}</h2><p><a class="btn" href="#leaderboard">← Leaderboard</a></p></div>`; if (!net.loaded || Date.now() - net.last > 20000) cycle(); return; }
      if (isMe(p)) { location.replace('#profile'); return; }
      const can = enabled() && p.full;
      const actions = `<a class="btn" href="#leaderboard">← Leaderboard</a>${can ? `<button class="btn primary" data-net="trade" data-id="${p.id}">⇄ Trade with ${esc(p.name)}</button><button class="btn" data-net="gift" data-id="${p.id}">🎁 Gift a card</button>` : ''}${ctx.social ? ctx.social.friendButton(p) : ''}`;
      const mine = S(), want = (p.wish || []).filter((id) => !(p.cards[id] && p.cards[id].n > 0)), theyHave = Object.keys(mine.wish || {}).filter((id) => p.cards[id] && p.cards[id].n > 0 && BYID[id]), iHave = want.filter((id) => mine.cards[id] && mine.cards[id].n > 0);
      const thumbs = (ids) => `<div class="card-row">${ids.slice(0, 24).map((id) => `<button class="card-btn" data-act="card" data-id="${id}">${ctx.cardHTML(BYID[id], { ghost: !mine.cards[id] })}</button>`).join('')}</div>`;
      const matches = p.full && (theyHave.length || iHave.length) ? `<section class="panel match"><h2>Trade matches</h2>${theyHave.length ? `<h3>${esc(p.name)} has ${theyHave.length} card${theyHave.length === 1 ? '' : 's'} on your wishlist</h3>${thumbs(theyHave)}` : ''}${iHave.length ? `<h3>You have ${iHave.length} card${iHave.length === 1 ? '' : 's'} on ${esc(p.name)}'s wishlist</h3>${thumbs(iHave)}` : ''}</section>` : '';
      const wl = p.full && want.length ? `<section><h2>Wishlist <span class="muted small">${want.length} card${want.length === 1 ? '' : 's'} they want</span></h2>${thumbs(want)}</section>` : '';
      $('#main').innerHTML = ctx.profileHTML(p, p.cards, { opened: p.opened }, actions, true, { score: p.score, unique: p.unique, skibidi: p.skibidi, rarest: p.rarest, lite: !p.full, online: online(p), acct: p.acct, rank: rankOf(p), show: p.show, src: p.id, after: matches, tail: wl });
      $$('.card', $('#main')).forEach(ctx.tilt);
    }
    const mini = (list) => `<div class="tr-cards">${list.length ? group(list).map((it) => `<div class="tr-card">${ctx.cardHTML(BYID[it.id], { holo: !!it.h, count: it.n, size: 84 })}</div>`).join('') : '<span class="muted small">nothing</span>'}</div>`;
    function pageTrades() {
      $('#main').innerHTML = `<div class="row wrap between"><h1>Trades</h1><div class="row"><a class="btn" href="#board">📋 Trade board</a><button class="btn primary" data-net="trade" ${enabled() ? '' : 'disabled'}>⇄ New trade</button></div></div><p class="muted" id="plstatus"></p><div id="trlist"></div>`;
      drawTrades(); paint(); if (Date.now() - net.last > 20000) cycle();
    }
    function drawTrades() {
      const box = $('#trlist'); if (!box) return;
      if (!enabled()) { box.innerHTML = '<div class="panel"><h2>Trading needs GitHub</h2><p class="muted">Add a GitHub token in <a href="#options">Settings</a> (or ask whoever runs this site for the shared one) to trade with other players.</p></div>'; return; }
      const s = S(), inc = incoming(), out = outgoing();
      ctx.setHTML(box, `<section><h2>Offers for you <span class="muted small">${inc.length}</span></h2>${inc.length ? inc.map((t) => {
          const ok = t.want.every((it) => ctx.hasCopy(it.id, it.h)), val = (l) => l.reduce((a, it) => a + BYID[it.id].pts * (it.h ? G.GS.holoMult : 1), 0), gv = val(t.give), wv = val(t.want), bad = t.want.length && wv >= 1.5 * gv && wv - gv >= 50;
          return `<div class="panel tr-offer"><div class="tr-head"><b>${esc(t.from.name)}</b> <span class="muted">${t.re ? 'sent a counter-offer:' : 'offers'}</span></div>${t.msg ? `<p class="tr-msg">“${esc(t.msg)}”</p>` : ''}${mini(t.give)}<div class="tr-head"><span class="muted">${t.want.length ? 'and wants' : 'as a gift'}</span></div>${t.want.length ? mini(t.want) : ''}
            ${t.want.length ? `<p class="tr-val ${bad ? 'warn' : ''}">You would get <b>${ctx.fmt(gv)}</b> pts and give <b>${ctx.fmt(wv)}</b> pts${bad ? ' · ⚠ this offer takes much more than it gives. Think before accepting, or counter it.' : ''}</p>` : ''}
            <div class="row wrap"><button class="btn primary" data-net="accept" data-id="${t.id}" ${ok ? '' : 'disabled'}>Accept</button><button class="btn" data-net="counter" data-id="${t.id}">Counter-offer</button><button class="btn" data-net="decline" data-id="${t.id}">Decline</button>${ok ? '' : '<span class="muted small">You do not have the cards they want.</span>'}</div></div>`;
        }).join('') : '<div class="empty"><p>No offers right now.</p></div>'}</section>
        <section><h2>Your offers <span class="muted small">${out.length}</span></h2>${out.length ? out.map((o) => `<div class="panel tr-offer"><div class="tr-head">To <b>${esc(o.toName)}</b> <span class="muted small">· waiting for an answer · your cards are held until it is settled</span></div>${o.msg ? `<p class="tr-msg">“${esc(o.msg)}”</p>` : ''}${mini(o.give)}<div class="tr-head"><span class="muted">${o.want.length ? 'for' : 'as a gift'}</span></div>${o.want.length ? mini(o.want) : ''}
          <div class="row wrap"><button class="btn" data-net="cancel" data-id="${o.id}">Cancel offer</button></div></div>`).join('') : '<div class="empty"><p>You have no offers out.</p></div>'}</section>
        <section><h2>History</h2>${s.net.hist.length ? `<ul class="tr-hist">${s.net.hist.map((h) => `<li><span class="muted small">${new Date(h.at).toLocaleString('en-GB')}</span> ${esc(h.text)}</li>`).join('')}</ul>` : '<div class="empty"><p>Nothing yet.</p></div>'}</section>`);
    }
    // ---------- card picker ----------
    // Shared by the trade page and the board. A filterable grid of cards: tap one to pick it. If there is more than one copy (or both a normal and
    // a skibidi version) a small panel opens next to the card so you can pick exactly which ones.
    //   o.cards()  the collection to pick from, { id: {n, h} }        o.sel   picked copies, { 'id|0': n, 'id|1': n } (0 normal, 1 skibidi)
    //   o.max      most cards that can be picked in total            o.kinds one pick per version instead of per copy (board posts)
    //   o.catalog  every card in the game, nobody "owns" it           o.neg   show values as what you give (red) instead of what you get (green)
    const unit = (id, h) => BYID[id].pts * (h ? G.GS.holoMult : 1);
    const selTotal = (m) => Object.keys(m).reduce((a, k) => a + (m[k] || 0), 0);
    const selVal = (m) => Object.keys(m).reduce((a, k) => { const [id, h] = k.split('|'); return a + m[k] * unit(id, h === '1'); }, 0);
    const FILTER0 = () => ({ q: '', sort: 'rank', tier: 'all', var: 'both', dupes: false, lack: false });
    const SORTS = [['rank', 'Rank (rarest first)'], ['rankdesc', 'Rank (commonest first)'], ['value', 'Most points'], ['copies', 'Most copies'], ['name', 'Name A-Z'], ['recent', 'Newest']];
    const catalogCards = () => { const m = {}; CARDS.forEach((c) => { if (!c.off && !c.monster) m[c.id] = { n: 2, h: 1, l: 0 }; }); return m; };
    function picker(o) {
      const f = o.f;
      o.el.innerHTML = `<div class="pk-bar"><input class="pk-q" type="search" placeholder="Search name or rank" value="${esc(f.q)}" autocomplete="off" aria-label="Search cards">
        <div class="pk-sel"><select class="pk-sort" aria-label="Sort">${SORTS.filter(([k]) => !(o.catalog && (k === 'copies' || k === 'recent'))).map(([k, l]) => `<option value="${k}" ${f.sort === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
          <select class="pk-tier" aria-label="Rarity"><option value="all">All rarities</option>${G.TIERS.map((t) => `<option ${f.tier === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
          <select class="pk-var" aria-label="Normal or skibidi">${[['both', 'Normal + skibidi'], ['normal', 'Normal only'], ['holo', 'Skibidi only']].map(([k, l]) => `<option value="${k}" ${f.var === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="pk-checks">${o.checks.map((c) => `<label class="check"><input type="checkbox" data-chk="${c.k}" ${f[c.k] ? 'checked' : ''}> ${esc(c.label)}</label>`).join('')}</div></div><div class="pk-grid"></div>`;
      const grid = $('.pk-grid', o.el), total = () => selTotal(o.sel);
      // what part of a stack counts under the "normal / skibidi" filter
      const view = (e) => { if (!e) return null; const n = f.var === 'normal' ? e.n - e.h : f.var === 'holo' ? e.h : e.n, h = f.var === 'normal' ? 0 : e.h; return n > 0 ? { n: n, h: h, l: e.l || 0 } : null; };
      const list = () => {
        const cards = o.cards(), q = f.q.trim().toLowerCase().replace(/^#/, '');
        const best = (id) => unit(id, view(cards[id]).h > 0);
        const by = { rank: (a, b) => BYID[a].rank - BYID[b].rank, rankdesc: (a, b) => BYID[b].rank - BYID[a].rank, name: (a, b) => BYID[a].name.localeCompare(BYID[b].name),
          value: (a, b) => best(b) - best(a) || BYID[a].rank - BYID[b].rank, copies: (a, b) => view(cards[b]).n - view(cards[a]).n || BYID[a].rank - BYID[b].rank, recent: (a, b) => view(cards[b]).l - view(cards[a]).l };
        return Object.keys(cards).filter((id) => BYID[id] && view(cards[id]) && (f.tier === 'all' || BYID[id].tier === f.tier) && (!q || BYID[id].name.toLowerCase().includes(q) || String(BYID[id].rank).startsWith(q)) && o.checks.every((c) => !f[c.k] || c.test(id, view(cards[id])))).sort(by[f.sort] || by.rank);
      };
      const tile = (id, e) => {
        const c = BYID[id], p = (o.sel[id + '|0'] || 0) + (o.sel[id + '|1'] || 0), cheapest = e.n - e.h > 0 ? unit(id, 0) : unit(id, 1);
        const pv = Object.keys(o.sel).filter((k) => k.split('|')[0] === id).reduce((a, k) => a + o.sel[k] * unit(id, k.slice(-2) === '|1'), 0);
        const chip = o.catalog || e.n < 2 ? '' : '×' + e.n + (e.h && e.h < e.n ? ' · ' + e.h + '✦' : ''), lab = o.label ? o.label(id, e) : null;
        return `<button type="button" class="pk-tile ${p ? 'picked' : ''}" data-pick="${id}" aria-pressed="${!!p}" aria-label="${esc(c.name)}">${ctx.cardHTML(c, { holo: e.h > 0, size: 112, copiesText: chip })}${p ? `<span class="tr-n">${o.kinds || o.catalog ? '✓' : p + '/' + e.n}</span>` : ''}${o.noval ? '' : `<span class="pk-val ${o.neg ? 'neg' : 'pos'} ${p ? 'on' : ''}">${o.neg ? '−' : '+'}${ctx.fmt(p ? pv : cheapest)}</span>`}${lab ? `<span class="pk-lab ${lab[0]}">${esc(lab[1])}</span>` : ''}</button>`;
      };
      const draw = () => {
        const cards = o.cards(), ids = list(), keep = grid.scrollTop;
        grid.innerHTML = ids.length ? ids.map((id) => tile(id, view(cards[id]))).join('') : '<p class="muted small pk-none">No cards match these filters.</p>';
        grid.scrollTop = keep; $$('.card', grid).forEach(ctx.tilt); if (o.onChange) o.onChange();
      };
      const flip = (id, h) => { const k = id + '|' + h; if (o.sel[k]) delete o.sel[k]; else if (total() >= o.max) toast('You can pick up to ' + o.max + ' cards here', true); else o.sel[k] = 1; };
      const setN = (k, n, max) => { const others = total() - (o.sel[k] || 0); n = Math.max(0, Math.min(max, n, o.max - others)); if (n) o.sel[k] = n; else delete o.sel[k]; if (others + n >= o.max) toast('You can pick up to ' + o.max + ' cards here'); };
      const popHTML = (id) => {
        const e = view(o.cards()[id]), c = BYID[id]; if (!e) return '';
        const nn = e.n - e.h, one = o.kinds || o.catalog, picked = (o.sel[id + '|0'] || 0) + (o.sel[id + '|1'] || 0), vchip = (h, on) => (o.noval ? '' : `<span class="pk-val ${o.neg ? 'neg' : 'pos'} ${on ? 'on' : ''}">${o.neg ? '−' : '+'}${ctx.fmt(unit(id, h))}</span>`);
        let tiles = '';
        if (one) tiles = [nn > 0 ? 0 : null, e.h > 0 ? 1 : null].filter((h) => h !== null).map((h) => `<button type="button" class="pop-copy ${o.sel[id + '|' + h] ? 'on' : ''}" data-kind="${h}" aria-pressed="${!!o.sel[id + '|' + h]}">${ctx.cardHTML(c, { holo: !!h, size: 112 })}<span class="pop-lab">${h ? '✦ Skibidi' : 'Normal'}${o.catalog ? '' : ' ×' + (h ? e.h : nn)}</span>${vchip(h, o.sel[id + '|' + h])}</button>`).join('');
        else [[0, nn], [1, e.h]].forEach(([h, n]) => { for (let i = 0; i < Math.min(n, 60); i++) { const on = i < (o.sel[id + '|' + h] || 0); tiles += `<button type="button" class="pop-copy ${on ? 'on' : ''}" data-copy="${id}|${h}|${i}" aria-pressed="${on}">${ctx.cardHTML(c, { holo: !!h, size: 112 })}${vchip(h, on)}</button>`; } });
        return `<div class="pop-head"><div class="pop-title"><b>#${c.rank} ${esc(c.name)}</b><span class="muted small">${one ? (o.catalog ? 'Pick the version you want' : 'Pick the version to use') : `${picked} / ${e.n} picked`}</span></div><button type="button" class="pop-x" data-act="close-pop" aria-label="Close">✕</button></div>
          <div class="pop-copies">${tiles}</div>${one ? '' : '<div class="pop-foot"><span class="muted small">Tap a copy to pick it</span><span class="row"><button type="button" class="btn sm" data-all>All</button><button type="button" class="btn sm" data-none>None</button></span></div>'}`;
      };
      grid.onclick = (ev) => {
        const t = ev.target.closest('[data-pick]'); if (!t) return; const id = t.dataset.pick, e = view(o.cards()[id]); if (!e) return;
        const nn = e.n - e.h, one = o.kinds || o.catalog, multi = one ? nn > 0 && e.h > 0 : e.n > 1, key = 'pick:' + o.name + ':' + id;
        if (!multi) { ctx.popClose(); const h = nn > 0 ? 0 : 1; if (one) flip(id, h); else setN(id + '|' + h, o.sel[id + '|' + h] ? 0 : 1, 1); draw(); return; }
        if (ctx.popup.key === key) { ctx.popClose(); return; }
        const el = ctx.popOpen(t, popHTML(id), { key: key, cls: 'pick' });
        el.onclick = (e2) => {
          const cp = e2.target.closest('[data-copy]'), kd = e2.target.closest('[data-kind]'), al = e2.target.closest('[data-all]'), no = e2.target.closest('[data-none]'), v = view(o.cards()[id]); if (!v) return;
          if (cp) { const [, h, i] = cp.dataset.copy.split('|'), k = id + '|' + h, cur = o.sel[k] || 0; setN(k, +i < cur ? +i : +i + 1, h === '1' ? v.h : v.n - v.h); }
          else if (kd) flip(id, +kd.dataset.kind);
          else if (al) { setN(id + '|0', v.n - v.h, v.n - v.h); setN(id + '|1', v.h, v.h); }
          else if (no) { delete o.sel[id + '|0']; delete o.sel[id + '|1']; }
          else return;
          ctx.popSet(popHTML(id)); draw();
        };
      };
      $('.pk-q', o.el).oninput = (ev) => { f.q = ev.target.value; draw(); };
      $('.pk-sort', o.el).onchange = (ev) => { f.sort = ev.target.value; draw(); };
      $('.pk-tier', o.el).onchange = (ev) => { f.tier = ev.target.value; draw(); };
      $('.pk-var', o.el).onchange = (ev) => { f.var = ev.target.value; draw(); };
      $$('[data-chk]', o.el).forEach((b) => (b.onchange = () => { f[b.dataset.chk] = b.checked; draw(); }));
      draw();
      return { draw: draw };
    }

    // ---------- trade page ----------
    const tb = { to: null, give: {}, want: {}, msg: '', replace: null, gift: false, fg: FILTER0(), fw: FILTER0() };
    const resetTb = () => Object.assign(tb, { to: null, give: {}, want: {}, msg: '', replace: null, gift: false, fg: FILTER0(), fw: FILTER0() });
    const toItems = (m) => { const out = []; Object.keys(m).forEach((k) => { const [id, h] = k.split('|'); for (let i = 0; i < m[k]; i++) out.push({ id: id, h: +h }); }); return out; };
    const lopsided = (g, w) => (g > 0 && w > 0 && Math.max(g, w) / Math.min(g, w) >= 2 && Math.abs(g - w) >= 50 ? { g: g, w: w } : null);
    const otherPlayers = () => net.dir.filter((p) => !isMe(p) && p.full);
    // Start a trade (or a counter-offer / gift) with someone and go to the trade page. opts.give / opts.want = cards to tick already.
    function openTrade(pre, opts) {
      opts = opts || {};
      if (!enabled()) { toast('Add a GitHub token in Settings first', true); return; }
      const others = otherPlayers(); if (!others.length) { toast('No other players are online yet', true); return; }
      resetTb(); tb.to = others.some((p) => p.id === pre) ? pre : others[0].id; tb.replace = opts.replace || null; tb.gift = !!opts.gift; tb.msg = opts.msg || '';
      const s = S(), them = others.find((p) => p.id === tb.to);
      const pre2 = (items, sel, cards) => (items || []).forEach((it) => { const x = cards[it.id]; if (!x) return; const k = it.id + '|' + (it.h ? 1 : 0), have = it.h ? x.h : x.n - x.h; if ((sel[k] || 0) < have) sel[k] = (sel[k] || 0) + 1; });
      pre2(opts.give, tb.give, s.cards); pre2(opts.want, tb.want, them.cards);
      if (location.hash === '#trade') ctx.route(); else location.hash = '#trade';
    }
    function pageTrade() {
      const main = $('#main'), s = S();
      if (!enabled()) { main.innerHTML = '<p><a class="btn sm" href="#trades">← Trades</a></p><div class="panel"><h2>Trading needs GitHub</h2><p class="muted">Add a GitHub token in <a href="#options">Settings</a> (or ask whoever runs this site for the shared one) to trade with other players.</p></div>'; return; }
      const others = otherPlayers();
      if (!others.length) { main.innerHTML = '<p><a class="btn sm" href="#trades">← Trades</a></p><div class="empty"><h2>No one to trade with yet</h2><p class="muted">Other players show up here once they have played with the site open.</p></div>'; if (Date.now() - net.last > 20000) cycle(); return; }
      if (!others.some((p) => p.id === tb.to)) tb.to = others[0].id;
      const them = others.find((p) => p.id === tb.to), title = tb.replace ? 'Counter-offer' : tb.gift ? 'Send a gift' : 'New trade';
      main.innerHTML = `<div class="row wrap between tb-top"><div><a class="btn sm" href="#trades">← Trades</a><h1>${title}</h1></div>
          <label class="f inline">Trade with<select id="tbTo">${others.map((p) => `<option value="${p.id}" ${p.id === tb.to ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label></div>
        ${tb.replace ? '<p class="muted small">Change the cards and send it back. Their original offer is declined when you send this one.</p>' : ''}<p class="muted small" id="plstatus"></p><div id="tbHint" class="tr-hint"></div>
        <div class="tb-cols ${tb.gift ? 'one' : ''}"><section class="panel tb-col"><h2>You give <span class="muted small" id="tbGn"></span></h2><div id="tbGive"></div></section>
          ${tb.gift ? '' : `<section class="panel tb-col"><h2>You get from ${esc(them.name)} <span class="muted small" id="tbWn"></span></h2><div id="tbWant"></div></section>`}</div>
        <div class="tb-bar" id="tbBar"><div class="tb-sum"><div><b id="tbGt">You give (0)</b><small id="tbGl">Nothing yet</small></div><span class="tb-arrow" aria-hidden="true">⇄</span><div><b id="tbWt">You get (0)</b><small id="tbWl">Nothing yet</small></div></div>
          <div id="tbVal" class="tr-val" hidden></div>
          <div class="tb-send"><input id="trMsg" maxlength="140" placeholder="Add a message (optional)" value="${esc(tb.msg)}" autocomplete="off"><button class="btn primary" id="tbReview" type="button">${tb.gift ? 'Review gift' : 'Review trade'}</button></div></div>`;
      const label = (id, e) => { const m = s.cards[id]; if (!m || m.n < 1) return ['new', 'New for you']; if (e.h > 0 && !(m.h > 0)) return ['newh', 'New skibidi · you have ' + (m.n - m.h) + ' normal']; return ['dupe', 'Dupe · you have ' + m.n + (m.h ? ' (' + m.h + ' skibidi)' : '')]; };
      const dupes = { k: 'dupes', label: 'Duplicates only', test: (id, e) => e.n > 1 };
      let pw = null;
      const bar = () => {
        const g = selVal(tb.give), w = tb.gift ? 0 : selVal(tb.want), gn = selTotal(tb.give), wn = tb.gift ? 0 : selTotal(tb.want), lop = lopsided(g, w);
        $('#tbGt').textContent = `You give (${gn})`; $('#tbWt').textContent = `You get (${wn})`;
        $('#tbGl').textContent = gn ? `${names(toItems(tb.give))} · ${ctx.fmt(g)} pts` : 'Nothing yet'; $('#tbWl').textContent = wn ? `${names(toItems(tb.want))} · ${ctx.fmt(w)} pts` : tb.gift ? 'A gift' : 'Nothing yet';
        const gnEl = $('#tbGn'), wnEl = $('#tbWn'); if (gnEl) gnEl.textContent = gn ? `${gn} picked` : ''; if (wnEl) wnEl.textContent = wn ? `${wn} picked` : '';
        const v = $('#tbVal'); v.hidden = !lop; v.className = 'tr-val warn'; if (lop) v.textContent = lop.g > lop.w ? '⚠ You are giving much more than you get.' : '⚠ You are asking for much more than you give. They may say no.';
      };
      const pg = picker({ el: $('#tbGive'), f: tb.fg, name: 'give', cards: () => s.cards, sel: tb.give, max: 60, neg: true, onChange: bar, checks: [dupes, { k: 'lack', label: `${them.name} doesn't have it`, test: (id) => !(them.cards[id] && them.cards[id].n > 0) }] });
      if (!tb.gift) pw = picker({ el: $('#tbWant'), f: tb.fw, name: 'want', cards: () => (net.dir.find((p) => p.id === tb.to) || { cards: {} }).cards, sel: tb.want, max: 60, label: label, onChange: bar, checks: [dupes, { k: 'lack', label: "I don't have it", test: (id) => !(s.cards[id] && s.cards[id].n > 0) }] });
      // wishlist matches as one-tap chips
      const theirs = (them.wish || []).filter((id) => s.cards[id] && s.cards[id].n > 0), mineW = Object.keys(s.wish || {}).filter((id) => them.cards[id] && them.cards[id].n > 0 && BYID[id]);
      const chip = (side, id) => `<button type="button" class="chip" data-quick="${side}|${id}">${esc(BYID[id].name)}</button>`;
      $('#tbHint').innerHTML = (!tb.gift && mineW.length ? `<p class="small"><b>${esc(them.name)} has ${mineW.length} card${mineW.length === 1 ? '' : 's'} on your wishlist:</b> ${mineW.slice(0, 8).map((id) => chip('want', id)).join(' ')}</p>` : '') + (theirs.length ? `<p class="small"><b>You have ${theirs.length} card${theirs.length === 1 ? '' : 's'} on their wishlist:</b> ${theirs.slice(0, 8).map((id) => chip('give', id)).join(' ')}</p>` : '');
      $('#tbHint').onclick = (e) => { const q = e.target.closest('[data-quick]'); if (!q) return; const [side, id] = q.dataset.quick.split('|'), cards = side === 'give' ? s.cards : them.cards, x = cards[id]; if (!x) return; const h = x.n - x.h > 0 ? 0 : 1; (side === 'give' ? tb.give : tb.want)[id + '|' + h] = Math.max((side === 'give' ? tb.give : tb.want)[id + '|' + h] || 0, 1); (side === 'give' ? pg : pw).draw(); };
      $('#tbTo').onchange = (e) => { tb.to = e.target.value; tb.want = {}; tb.fw = FILTER0(); pageTrade(); };
      $('#trMsg').oninput = (e) => { tb.msg = e.target.value; };
      $('#tbReview').onclick = reviewTrade; paint(); bar();
      if (Date.now() - net.last > 20000) cycle();
    }
    function reviewTrade() {
      const them = net.dir.find((p) => p.id === tb.to); if (!them) return;
      const give = toItems(tb.give), want = tb.gift ? [] : toItems(tb.want);
      if (!give.length && !want.length) { toast('Pick at least one card', true); return; }
      if (tb.gift && !give.length) { toast('Pick a card to give', true); return; }
      const g = selVal(tb.give), w = tb.gift ? 0 : selVal(tb.want), lop = lopsided(g, w), n = (l) => l.length + ' card' + (l.length === 1 ? '' : 's');
      const bg = ctx.modal(`<h2>${tb.replace ? 'Send counter-offer' : tb.gift ? 'Send gift' : 'Review trade'}</h2><p class="muted small">With <b>${esc(them.name)}</b>. The cards you give are held until they answer.</p>
        <div class="tr-cols"><div><h3>You give <span class="muted small">${n(give)}</span></h3>${mini(give)}</div><div><h3>You get <span class="muted small">${n(want)}</span></h3>${want.length ? mini(want) : '<p class="muted small">Nothing (a gift)</p>'}</div></div>
        <div class="tr-val ${lop ? 'warn' : ''}">You give <b>${ctx.fmt(g)}</b> pts · you get <b>${ctx.fmt(w)}</b> pts${lop ? ` · ⚠ ${lop.g > lop.w ? 'you are giving much more than you get' : 'you are asking for much more than you give'}` : ''}</div>
        ${tb.msg.trim() ? `<p class="tr-msg">“${esc(tb.msg.trim())}”</p>` : ''}
        <div class="row wrap" style="margin-top:14px"><button class="btn primary" id="trSend" type="button">${tb.gift ? 'Send gift' : 'Send offer'}</button><button class="btn" data-act="close-modal" type="button">Back</button></div>`, 'wide');
      $('#trSend', bg).onclick = async () => {
        const btn = $('#trSend', bg); btn.disabled = true;
        try { await createTrade(tb.to, give, want, tb.msg, tb.replace); if (tb.replace) await decline(tb.replace); ctx.closeModal(bg); toast(tb.gift ? 'Gift sent' : 'Offer sent'); resetTb(); location.hash = '#trades'; if (location.hash === '#trades') drawTrades(); }
        catch (e) { toast(e.message, true); btn.disabled = false; }
      };
    }

    // ---------- trade board ----------
    // Public "looking for / offering" posts. One issue each (t:'board'), shown for 7 days, up to 3 per player.
    // A card is "id" for a normal copy or "id|1" for a skibidi copy, so a post can say "a skibidi Freddy for my normal Big M".
    const myPosts = () => net.board.filter((x) => x.pid === S().profile.id);
    const bi = (x) => { const i = x.indexOf('|'); return i < 0 ? { id: x, h: 0 } : { id: x.slice(0, i), h: +x.slice(i + 1) ? 1 : 0 }; };
    const bp = { give: {}, want: {}, note: '', fo: FILTER0(), fw: FILTER0() };
    function openPost() {
      if (!enabled()) { toast('The board needs the online connection', true); return; }
      if (myPosts().length >= BOARD_MAX) { toast('You can have ' + BOARD_MAX + ' posts at once. Remove one first.', true); return; }
      Object.assign(bp, { give: {}, want: {}, note: '', fo: FILTER0(), fw: FILTER0() }); location.hash = '#post';
    }
    function pagePost() {
      const main = $('#main'), s = S();
      if (!enabled()) { main.innerHTML = '<p><a class="btn sm" href="#board">← Board</a></p><div class="panel"><h2>The board needs the online connection</h2><p class="muted">Add a GitHub token in <a href="#options">Settings</a>.</p></div>'; return; }
      main.innerHTML = `<div class="tb-top"><a class="btn sm" href="#board">← Board</a><h1>New board post</h1><p class="muted">Pick what you can offer and what you are after. Choose normal or skibidi for each card, like in a trade. Up to ${BOARD_CARDS} cards each, and posts last 7 days.</p></div>
        <div class="tb-cols"><section class="panel tb-col"><h2>You offer <span class="muted small" id="bpGn"></span></h2><div id="bpGive"></div></section>
          <section class="panel tb-col"><div class="row between"><h2>You want <span class="muted small" id="bpWn"></span></h2><button class="btn sm" id="bpWish" type="button">＋ My wishlist</button></div><div id="bpWant"></div></section></div>
        <div class="tb-bar"><div class="tb-sum"><div><b id="bpGt">Offering (0)</b><small id="bpGl">Nothing yet</small></div><span class="tb-arrow" aria-hidden="true">⇄</span><div><b id="bpWt">Looking for (0)</b><small id="bpWl">Nothing yet</small></div></div>
          <div class="tb-send"><input id="bnNote" maxlength="100" placeholder="Note (optional), e.g. Open to anything rare" value="${esc(bp.note)}" autocomplete="off"><button class="btn primary" id="bnGo" type="button">Post</button></div></div>`;
      const bar = () => {
        const g = selTotal(bp.give), w = selTotal(bp.want);
        $('#bpGt').textContent = `Offering (${g})`; $('#bpWt').textContent = `Looking for (${w})`; $('#bpGl').textContent = g ? names(toItems(bp.give)) : 'Nothing yet'; $('#bpWl').textContent = w ? names(toItems(bp.want)) : 'Nothing yet';
        $('#bpGn').textContent = g ? g + ' picked' : ''; $('#bpWn').textContent = w ? w + ' picked' : '';
      };
      picker({ el: $('#bpGive'), f: bp.fo, name: 'offer', cards: () => s.cards, sel: bp.give, max: BOARD_CARDS, kinds: true, noval: true, neg: true, onChange: bar, checks: [{ k: 'dupes', label: 'Duplicates only', test: (id, e) => e.n > 1 }] });
      const pw = picker({ el: $('#bpWant'), f: bp.fw, name: 'wantpost', cards: catalogCards, sel: bp.want, max: BOARD_CARDS, catalog: true, noval: true, onChange: bar, checks: [{ k: 'lack', label: "I don't have it", test: (id) => !(s.cards[id] && s.cards[id].n > 0) }],
        label: (id) => (s.cards[id] && s.cards[id].n > 0 ? ['dupe', 'You have ' + s.cards[id].n] : ['new', 'New for you']) });
      $('#bpWish').onclick = () => { Object.keys(s.wish || {}).filter((id) => BYID[id] && !bp.want[id + '|0'] && !bp.want[id + '|1']).forEach((id) => { if (selTotal(bp.want) < BOARD_CARDS) bp.want[id + '|0'] = 1; }); pw.draw(); };
      $('#bnNote').oninput = (e) => { bp.note = e.target.value; };
      $('#bnGo').onclick = async () => {
        if (!selTotal(bp.give) && !selTotal(bp.want)) { toast('Pick at least one card', true); return; }
        const enc = (m) => Object.keys(m).filter((k) => m[k]).map((k) => (k.slice(-2) === '|1' ? k : k.slice(0, -2))), btn = $('#bnGo'); btn.disabled = true;
        try { const id = ctx.uid().replace(/[^a-z0-9]/g, '').slice(0, 16); await createIssue(`board:${id} ${s.profile.name}`.replace(/[\r\n]+/g, ' '), { t: 'board', v: 2, id: id, pid: s.profile.id, name: s.profile.name, want: enc(bp.want), offer: enc(bp.give), note: bp.note, at: Date.now() });
          toast('Posted'); Object.assign(bp, { give: {}, want: {}, note: '' }); await refresh().catch(() => {}); location.hash = '#board'; }
        catch (e) { toast(e.message, true); btn.disabled = false; }
      };
      paint(); bar();
    }
    const ago = (t) => { const m = Math.max(1, Math.round((Date.now() - t) / 60000)); return m < 60 ? m + 'm ago' : m < 1440 ? Math.round(m / 60) + 'h ago' : Math.round(m / 1440) + 'd ago'; };
    function pageBoard() {
      const s = S(), list = net.board;
      const thumbs = (ids) => `<div class="card-row tight">${ids.map(bi).map((it) => `<button type="button" class="card-btn" data-act="card" data-id="${it.id}">${ctx.cardHTML(BYID[it.id], { holo: !!it.h, size: 92, ghost: !s.cards[it.id] })}</button>`).join('')}</div>`;
      $('#main').innerHTML = `<div class="row wrap between"><h1>Trade board</h1><div class="row"><a class="btn" href="#trades">← Trades</a><button class="btn primary" id="bdPost" type="button" ${enabled() ? '' : 'disabled'}>＋ New post</button></div></div>
        <p class="muted">Say what you are looking for and what you can offer. Anyone can answer a post with a trade offer. Posts last 7 days.</p><p class="muted" id="plstatus"></p>
        ${list.length ? `<div class="board">${list.map((x) => { const me = x.pid === s.profile.id, them = net.dir.find((p) => p.id === x.pid);
          return `<article class="panel board-post"><header><a class="pl-top" href="#user-${x.pid}">${them ? ctx.avatarHTML(34, them) : ''}<b>${esc(x.name)}</b></a><small class="muted">${ago(x.at)}</small></header>
          ${x.want.length ? `<h3>Looking for</h3>${thumbs(x.want)}` : ''}${x.offer.length ? `<h3>Offering</h3>${thumbs(x.offer)}` : ''}${x.note ? `<p class="tr-msg">${esc(x.note)}</p>` : ''}
          <div class="row wrap">${me ? `<button class="btn sm danger" data-bd-rm="${x.num}" type="button">Remove my post</button>` : `<button class="btn sm primary" data-bd-offer="${x.num}" type="button" ${them && them.full ? '' : 'disabled'}>Make an offer</button>`}<button class="btn sm cm-toggle" data-cm="${x.num}" data-owner="${x.pid}" type="button" aria-expanded="false">💬 Comments${x.ccount ? ' (' + x.ccount + ')' : ''}</button></div><div class="cm-box" id="cm-${x.num}" hidden></div></article>`; }).join('')}</div>` : '<div class="empty"><h2>Nothing posted yet</h2><p class="muted">Be the first. Post what you are hunting for.</p></div>'}`;
      $$('.card', $('#main')).forEach(ctx.tilt); paint();
      $('#bdPost').onclick = openPost;
      $('#main').onclick = async (e) => {
        const rm = e.target.closest('[data-bd-rm]'), of = e.target.closest('[data-bd-offer]');
        if (rm) { try { await closeIssue(+rm.dataset.bdRm); await refresh(); pageBoard(); toast('Removed'); } catch (er) { toast(er.message, true); } }
        else if (of) { const x = net.board.find((y) => y.num === +of.dataset.bdOffer), them = x && net.dir.find((p) => p.id === x.pid); if (!x || !them) return;
          const has = (cards, it) => { const c = cards[it.id]; return !!(c && (it.h ? c.h > 0 : c.n - c.h > 0)); };
          // what they ask for that I hold, and what they offer that they hold (the exact normal / skibidi version)
          openTrade(x.pid, { give: x.want.map(bi).filter((it) => has(s.cards, it)), want: x.offer.map(bi).filter((it) => has(them.cards, it)), msg: 'About your board post' }); }
      };
      if (Date.now() - net.last > 20000) cycle();
    }

    // ---------- settings panel ----------
    function settingsHTML() {
      const c = conf(), st = stored();
      return `<section class="panel"><h2>Online 🌐</h2><p class="muted small" id="netstatus">${esc(statusText())}</p>
        <label class="check"><input id="optShare" type="checkbox" ${S().settings.share ? 'checked' : ''}> Share my profile and save online (needed for the leaderboard and trading)</label>
        <div class="row wrap" style="margin-top:10px"><label class="f">GitHub repo<input id="netRepo" value="${esc(st.repo || '')}" placeholder="${esc(detectRepo() || (window.SSG_NET && window.SSG_NET.repo) || 'owner/name')}" autocomplete="off"></label>
        <label class="f">Your own GitHub token (optional)<input id="netTok" type="password" value="${esc(st.token || '')}" placeholder="${c.token && !c.personal ? 'Using the site\'s shared token' : 'github_pat_...'}" autocomplete="off"></label></div>
        <div class="row wrap" style="margin-top:10px"><button class="btn" id="netSave">Save connection</button><button class="btn" id="netSync">Sync now</button></div>
        <p class="muted small">Your player ID: <code>${esc(S().profile.id)}</code></p>
        <h3 style="margin:16px 0 6px">Restore from the cloud</h3><p class="muted small">Moving to a new device? Enter your player ID to pull your last published save. This replaces what is on this device.</p>
        <div class="row wrap"><label class="f"><input id="netRid" placeholder="Player ID" autocomplete="off"></label><button class="btn" id="netRestore">Restore</button></div></section>`;
    }
    function bindSettings() {
      $('#optShare').onchange = (e) => { S().settings.share = e.target.checked; ctx.save(); toast(e.target.checked ? 'Sharing on' : 'Sharing off'); cycle(true); };
      $('#netSave').onclick = () => { const o = {}, r = $('#netRepo').value.trim(), t = $('#netTok').value.trim(), old = stored(); if (r) o.repo = r; if (t) o.token = t; if (old.api) o.api = old.api; try { localStorage.setItem(LS, JSON.stringify(o)); } catch (e) { /* ignore */ } net.loaded = false; toast('Saved'); cycle(true); };
      $('#netSync').onclick = async () => { await cycle(true); paint(); toast(net.status === 'ok' ? 'Synced' : statusText(), net.status !== 'ok'); };
      $('#netRestore').onclick = async () => {
        const id = $('#netRid').value.trim().toLowerCase(); if (!id) return;
        try {
          await refresh(); const p = net.dir.find((x) => x.id === id);
          if (!p || !p.raw) { toast('No published save found for that ID', true); return; }
          if (!window.confirm(`Replace this device's save with the one published by ${p.name}?`)) return;
          const cards = {}; Object.keys(p.cards).forEach((k) => { cards[k] = { n: p.cards[k].n, h: p.cards[k].h, f: p.cards[k].f, t: p.cards[k].t, l: p.cards[k].l }; });
          ctx.restore(Object.assign({}, p.raw, { cards: cards, profile: { id: p.id, name: p.name, bio: p.bio || '', hue: p.hue, pfp: p.pfp, banner: p.banner, joined: p.joined }, settings: S().settings }));
        } catch (e) { toast('Could not restore: ' + e.message, true); }
      };
    }

    function start() {
      document.addEventListener('click', (e) => {
        const t = e.target.closest('[data-net]'); if (!t || t.disabled) return;
        const a = t.dataset.net, id = t.dataset.id;
        if (a === 'trade') openTrade(id); else if (a === 'accept') accept(id); else if (a === 'decline') decline(id); else if (a === 'gift') openTrade(id, { gift: true }); else if (a === 'counter') { const t = net.trades.find((x) => x.id === id); if (t) openTrade(t.from.id, { give: t.want, want: t.give, replace: id }); } else if (a === 'cancel') cancel(id);
      });
      setInterval(() => { if (!document.hidden) cycle(); }, EVERY);
      document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - net.last > 15000) cycle(); });
      addEventListener('pagehide', flush); document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
      paint(); setTimeout(() => cycle(true), 600);
    }
    // The Online panel in Settings is switched off. Return settingsHTML/bindSettings below to bring it back (share toggle, own token, restore from cloud).
    const SHOW_SETTINGS = false;
    return { approvedPid: approvedPid, rankOf: rankOf, logRedeem: logRedeem, weekStart: weekStart, log: (text) => updateConfig(() => {}, text), gh: gh, conf: conf, enabled: enabled, refresh: refresh, updateConfig: updateConfig, saveCardImage: saveCardImage, closeIssue: closeIssue, createIssue: createIssue, loadCache: loadCache, start: start, touch: touch, flush: flush, diag: diag, paint: paint, cycle: cycle, pageBoard: pageBoard, pagePost: pagePost, pageTrade: pageTrade, incoming: incoming, outgoing: outgoing, recentPulls: recentPulls, pagePlayers: pagePlayers, pageUser: pageUser, pageTrades: pageTrades, settingsHTML: () => (SHOW_SETTINGS ? settingsHTML() : ''), bindSettings: () => { if (SHOW_SETTINGS) bindSettings(); }, state: net, build: build };
  };
})();
