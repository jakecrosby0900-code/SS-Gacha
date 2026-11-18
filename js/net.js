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
    const net = { dir: [], trades: [], accounts: [], grants: [], cfg: G.cleanConfig(null), cfgNum: 0, imgNum: {}, cfgKey: '', status: 'off', msg: '', last: 0, busy: false, lastKey: '', lastBeat: 0, createdAt: 0, loaded: false, cfgChanged: false };
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
      return derive({ id: id, name: nm(b.name), hue: Number.isFinite(+b.hue) ? ((+b.hue % 360) + 360) % 360 : 28, pfp: okImg(b.pfp), banner: okImg(b.banner), joined: +b.joined || 0, seen: +b.seen || 0,
        mod: +(b.save && b.save.mod) || +b.seen || 0, opened: +(b.opened) || 0, pulls: +(b.pulls) || 0, cards: cards, num: num, full: true, raw: b.save && typeof b.save === 'object' ? b.save : null });
    }
    const items = (a) => (Array.isArray(a) ? a.slice(0, 60).map((x) => ({ id: String(x && x.id), h: x && x.h ? 1 : 0 })).filter((x) => BYID[x.id]) : []);
    function cleanTrade(b, num) {
      const tid = idOk(b.id), f = b.from || {}, t = b.to || {};
      if (!tid || !idOk(f.id) || !idOk(t.id)) return null;
      return { id: tid, num: num, from: { id: f.id, name: nm(f.name) }, to: { id: t.id, name: nm(t.name) }, give: items(b.give), want: items(b.want), msg: String(b.msg == null ? '' : b.msg).replace(/[\r\n\t]+/g, ' ').trim().slice(0, 140), at: +b.at || 0,
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
      try { localStorage.setItem(CFG_CACHE, JSON.stringify({ cfg: net.cfg, imgs: imgs })); }
      catch (e) { try { localStorage.setItem(CFG_CACHE, JSON.stringify({ cfg: net.cfg, imgs: {} })); } catch (e2) { /* ignore */ } }
    }
    async function refresh() {
      const c = conf(); let all = [];
      for (let page = 1; page <= 20; page++) {
        const r = await gh('GET', `/repos/${c.repo}/issues?state=open&per_page=100&page=${page}`);
        all = all.concat(r.filter((i) => !i.pull_request)); if (r.length < 100) break;
      }
      const parsed = [];
      all.forEach((i) => { let b; try { b = JSON.parse(i.body); } catch (e) { return; } if (b && typeof b === 'object') parsed.push({ i: i, b: b }); });
      // 1) admin config, card pictures and accounts first, so custom cards exist before players are read
      let cfgIssue = null; const imgs = {}, imgNum = {}, accounts = {}, grants = [];
      parsed.forEach((x) => {
        const b = x.b, num = x.i.number;
        if (b.t === 'config') { if (!cfgIssue || num < cfgIssue.num) cfgIssue = { num: num, b: b }; }
        else if (b.t === 'cardimg' && typeof b.id === 'string') { const im = okImg(b.img); if (im && (imgNum[b.id] == null || num < imgNum[b.id])) { imgs[b.id] = im; imgNum[b.id] = num; } }
        else if (b.t === 'grant' && typeof b.gid === 'string' && /^[a-z0-9]{6,40}$/.test(b.gid) && typeof b.k === 'string') {
          const cs = Array.isArray(b.cards) ? b.cards.slice(0, 60).map((x) => ({ id: String(x && x.id), h: x && x.h ? 1 : 0, n: Math.min(99, Math.max(1, +(x && x.n) | 0 || 1)) })).filter((x) => BYID[x.id]) : [];
          const tk = Array.isArray(b.take) ? b.take.slice(0, 120).map((x) => ({ id: String(x && x.id), h: x && x.h ? 1 : 0, n: Math.min(9999, Math.max(1, +(x && x.n) | 0 || 1)) })).filter((x) => BYID[x.id]) : [];
          grants.push({ gid: b.gid, k: b.k.toLowerCase(), num: num, cards: cs, take: tk, wipe: !!b.wipe, opened: b.opened == null || !Number.isFinite(+b.opened) ? null : Math.min(1000000, Math.max(0, Math.floor(+b.opened))), packs: Math.min(1000, Math.max(0, +b.packs | 0)), at: +b.at || 0 });
        }
        else if (b.t === 'account' && typeof b.k === 'string' && /^[a-z0-9_]{3,20}$/.test(b.k) && typeof b.salt === 'string' && typeof b.hash === 'string' && idOk(b.pid)) {
          if (!accounts[b.k] || accounts[b.k].num > num) accounts[b.k] = { k: b.k, u: String(b.u || b.k).slice(0, 20), salt: b.salt.slice(0, 64), hash: b.hash.slice(0, 128), iter: +b.iter || 0, pid: b.pid, created: +b.created || 0, num: num };
        }
      });
      net.cfgNum = cfgIssue ? cfgIssue.num : 0; net.imgNum = imgNum;
      applyCfg(cfgIssue ? cfgIssue.b : null, imgs); cacheCfg(imgs);
      net.accounts = Object.keys(accounts).map((k) => accounts[k]); net.grants = grants;
      const byPid = {}; net.accounts.forEach((a) => { byPid[a.pid] = a; });
      // 2) players and trades
      const blocked = {}; net.cfg.blocked.forEach((x) => { blocked[x.id] = 1; });
      const players = {}, trades = [];
      parsed.forEach((x) => {
        const b = x.b, num = x.i.number;
        if (b.t === 'player') { const p = cleanPlayer(b, num); if (p && !blocked[p.id] && (!players[p.id] || players[p.id].num > p.num)) players[p.id] = p; }
        else if (b.t === 'trade') { const t = cleanTrade(b, num); if (t && !blocked[t.from.id] && !blocked[t.to.id]) trades.push(t); }
      });
      net.dir = Object.keys(players).map((k) => { const p = players[k]; p.acct = byPid[p.id] ? byPid[p.id].u : null; return p; }); net.trades = trades; net.last = Date.now(); net.loaded = true;
    }
    // Admin writes. Re-reads the config issue first so two edits do not overwrite each other.
    async function updateConfig(fn) {
      const c = conf(); let cfg = G.cleanConfig(null);
      if (net.cfgNum) { try { const cur = await gh('GET', `/repos/${c.repo}/issues/${net.cfgNum}`); cfg = G.cleanConfig(JSON.parse(cur.body)); } catch (e) { if (e.status && e.status !== 404 && e.status !== 410) throw e; } }
      try { localStorage.setItem('ss-gacha-cfg-undo', JSON.stringify(cfg)); } catch (e) { /* ignore */ } // what "Undo last change" goes back to
      fn(cfg); cfg = G.cleanConfig(cfg);
      const body = JSON.stringify(Object.assign({ t: 'config', v: 1 }, cfg));
      if (body.length > MAX_BODY) throw new Error('Config is too big for one GitHub issue');
      if (net.cfgNum) await gh('PATCH', `/repos/${c.repo}/issues/${net.cfgNum}`, { body: body });
      else { const r = await gh('POST', `/repos/${c.repo}/issues`, { title: 'config:game', body: body }); net.cfgNum = r.number; }
      await refresh();
    }
    // dataUrl = null removes the custom picture.
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
      return { t: 'player', v: 1, id: p.id, name: p.name, hue: p.hue, pfp: p.pfp, banner: p.banner, joined: p.joined, seen: Date.now(), opened: s.stats.opened, pulls: s.stats.pulls, cards: cards,
        save: { mod: s.mod || 0, granted: s.granted, packs: s.packs, last: s.last, sinceRare: s.sinceRare, started: s.started, stats: s.stats, codes: s.codes, net: s.net } };
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
        g.cards.forEach((it) => { for (let i = 0; i < it.n; i++) ctx.addCopy(it.id, it.h); });
        if (g.packs) s.packs += g.packs;
        if (g.wipe) { Object.keys(s.cards).forEach((id) => { delete s.cards[id]; }); hist('The admin removed all your cards.'); }
        else if (g.take.length) { g.take.forEach((it) => { for (let i = 0; i < it.n; i++) { if (!ctx.takeCopy(it.id, it.h)) break; } }); hist('The admin removed: ' + g.take.map((it) => BYID[it.id].name + (it.h ? ' (skibidi)' : '') + (it.n > 1 ? ' x' + it.n : '')).join(', ') + '.'); }
        if (g.opened != null) { s.stats.opened = g.opened; hist('The admin set your packs opened to ' + g.opened + '.'); }
        s.granted[g.gid] = Date.now(); any = true;
        const parts = g.cards.map((it) => BYID[it.id].name + (it.h ? ' (skibidi)' : '') + (it.n > 1 ? ' x' + it.n : '')); if (g.packs) parts.push(g.packs + ' pack' + (g.packs === 1 ? '' : 's'));
        if (!g.wipe && !g.take.length && (g.cards.length || g.packs)) hist('The admin gave you: ' + (parts.join(', ') || 'a gift') + '.');
      });
      const ks = Object.keys(s.granted); if (ks.length > 300) ks.sort((a, b) => s.granted[a] - s.granted[b]).slice(0, ks.length - 300).forEach((k) => delete s.granted[k]);
      if (any) { ctx.save(); toast('The admin changed your collection.'); }
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
        const s = S(); if (!enabled() || !ctx.loggedIn() || ctx.busy() || (s.mod || 0) <= (s.syncMod || 0)) return;
        const mine = net.dir.find(isMe); if (!mine) return;
        publish(true, true).catch(() => {});
      } catch (e) { /* ignore */ }
    }

    // ---------- trading ----------
    // Trade lists hold one entry per copy; group them for display ("Freddy ×3").
    const group = (list) => { const m = {}, o = []; list.forEach((it) => { const k = it.id + '|' + it.h; if (!m[k]) { m[k] = { id: it.id, h: it.h, n: 0 }; o.push(m[k]); } m[k].n++; }); return o; };
    const names = (a) => group(a).map((it) => BYID[it.id].name + (it.h ? ' (skibidi)' : '') + (it.n > 1 ? ' ×' + it.n : '')).join(', ');
    function hist(text) { const h = S().net.hist; h.unshift({ at: Date.now(), text: text }); h.length = Math.min(h.length, 30); }
    const incoming = () => net.trades.filter((t) => t.status === 'open' && t.to.id === S().profile.id && !S().net.done[t.id]);
    const outgoing = () => Object.keys(S().net.out).map((tid) => Object.assign({ id: tid }, S().net.out[tid], { live: net.trades.find((t) => t.id === tid) }));
    function prune() { const d = S().net.done, k = Object.keys(d); if (k.length > 200) k.slice(0, k.length - 200).forEach((x) => delete d[x]); }
    function completeOut(tid, kind) {
      const s = S(), o = s.net.out[tid]; if (!o) return;
      if (kind === 'accepted') { o.want.forEach((it) => ctx.addCopy(it.id, it.h)); hist(`${o.toName} accepted your trade. You got ${o.want.length ? names(o.want) : 'nothing (a gift)'}.`); }
      else { o.give.forEach((it) => ctx.addCopy(it.id, it.h)); hist(`Your trade with ${o.toName} was ${kind}. Your cards came back.`); }
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
    async function createTrade(toId, give, want, msg) {
      const s = S(), c = conf(), to = net.dir.find((p) => p.id === toId);
      if (!to) throw new Error('Player not found');
      if (!give.length && !want.length) throw new Error('Pick at least one card');
      give.forEach((it) => { if (!ctx.hasCopy(it.id, it.h)) throw new Error('You no longer own ' + BYID[it.id].name); });
      const tid = ctx.uid().replace(/[^a-z0-9]/g, '');
      give.forEach((it) => ctx.takeCopy(it.id, it.h));
      msg = String(msg || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 140);
      s.net.out[tid] = { to: toId, toName: to.name, give: give, want: want, msg: msg, at: Date.now(), num: 0 }; ctx.save();
      const body = { t: 'trade', id: tid, from: { id: s.profile.id, name: s.profile.name }, to: { id: to.id, name: to.name }, give: give, want: want, msg: msg, status: 'open', at: Date.now() };
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
      s.net.done[tid] = 1; prune(); hist(`You accepted ${tr.from.name}'s trade: got ${tr.give.length ? names(tr.give) : 'nothing'}, gave ${tr.want.length ? names(tr.want) : 'nothing'}.`);
      s.net.q.push({ num: tr.num, tid: tid, set: { status: 'accepted', by: s.profile.id, at: Date.now() } }); ctx.save();
      toast('Trade accepted'); await flushQ(); repaint(true);
    }
    async function decline(tid) {
      const s = S(), tr = net.trades.find((t) => t.id === tid); if (!tr) return;
      s.net.done[tid] = 1; hist(`You declined ${tr.from.name}'s trade.`);
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
          await flushQ(); if (ctx.loggedIn()) { if (reconcile()) changedFlag = true; if (applyGrants()) changedFlag = true; await publish(force); closeGrants(); }
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
      const st = $('#plstatus'); if (st) st.textContent = statusText();
      const ss = $('#netstatus'); if (ss) ss.textContent = statusText();
    }
    function repaint(changed) {
      if ($('.modal-bg') || ctx.busy() || !ctx.loggedIn()) return;
      const h = location.hash.slice(1) || 'home';
      if (h === 'leaderboard' || h === 'players') drawPlayers(); else if (h === 'trades') drawTrades(); else if (h.indexOf('user-') === 0) ctx.route();
      else if (changed && h !== 'options' && h !== 'admin') ctx.route();
    }

    // ---------- pages ----------
    const SORTS = [['score', 'Score'], ['unique', 'Unique cards'], ['opened', 'Packs opened'], ['skibidi', 'Skibidi cards'], ['seen', 'Recently online']];
    function pagePlayers() {
      $('#main').innerHTML = `<h1>Leaderboard</h1><p class="muted" id="plstatus"></p>
        <div class="filters panel"><label class="f">Find a player<input id="plq" type="search" value="${esc(view.q)}" placeholder="Name or username" autocomplete="off"></label>
        <label class="f">Rank by<select id="plsort">${SORTS.map(([v, l]) => `<option value="${v}" ${view.by === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div><div id="pllist"></div>`;
      $('#plq').oninput = (e) => { view.q = e.target.value; drawPlayers(); };
      $('#plsort').onchange = (e) => { view.by = e.target.value; drawPlayers(); };
      drawPlayers(); paint(); if (Date.now() - net.last > 20000) cycle();
    }
    function drawPlayers() {
      const box = $('#pllist'); if (!box) return;
      const q = view.q.trim().toLowerCase(), key = view.by;
      let list = net.dir.filter((p) => (p.acct || !net.accounts.length || !net.loaded || !enabled()) && (!q || p.name.toLowerCase().includes(q) || (p.acct || '').toLowerCase().includes(q)));
      list = list.slice().sort((a, b) => (b[key] - a[key]) || (b.score - a.score) || a.name.localeCompare(b.name));
      const medal = ['🥇', '🥈', '🥉'];
      box.innerHTML = list.length ? `<div class="pl-list">${list.map((p, i) => `<a class="pl-row ${isMe(p) ? 'me' : ''}" href="#user-${p.id}"><span class="pl-rank">${!q && i < 3 ? medal[i] : i + 1}</span>${ctx.avatarHTML(42, p)}
          <span class="pl-name"><span class="pl-top"><b>${esc(p.name)}</b>${p.acct && p.acct.toLowerCase() !== p.name.toLowerCase() ? ` <small class="muted">@${esc(p.acct)}</small>` : ''}${isMe(p) ? ' <small class="muted">(you)</small>' : ''}${online(p) ? ' <span class="online-dot" title="Online now"></span>' : ''}</span><small class="muted">${p.unique}/${CARDS.length} cards · ${p.opened} packs · ${p.skibidi} skibidi</small></span>
          <span class="pl-score"><b>${ctx.fmt(p.score)}</b><small>pts</small></span></a>`).join('')}</div>`
        : `<div class="empty"><h2>${net.loaded ? 'No players found' : 'Loading...'}</h2><p class="muted">${net.loaded && !q ? 'Nobody has published a profile yet.' : ''}</p></div>`;
    }
    function pageUser(id) {
      const p = net.dir.find((x) => x.id === id);
      if (!p) { $('#main').innerHTML = `<div class="empty"><h2>${net.loaded ? 'Player not found' : 'Loading...'}</h2><p><a class="btn" href="#leaderboard">← Leaderboard</a></p></div>`; if (!net.loaded || Date.now() - net.last > 20000) cycle(); return; }
      const me = isMe(p), can = enabled() && !me && p.full;
      const actions = `<a class="btn" href="#leaderboard">← Leaderboard</a>${me ? '<button class="btn" data-act="edit-profile">✎ Edit profile</button>' : ''}${can ? `<button class="btn primary" data-net="trade" data-id="${p.id}">⇄ Trade with ${esc(p.name)}</button>` : ''}`;
      $('#main').innerHTML = ctx.profileHTML(p, p.cards, { opened: p.opened }, actions, true, { score: p.score, unique: p.unique, skibidi: p.skibidi, rarest: p.rarest, lite: !p.full, online: online(p), acct: p.acct });
      $$('.card', $('#main')).forEach(ctx.tilt);
    }
    const mini = (list) => `<div class="tr-cards">${list.length ? group(list).map((it) => `<div class="tr-card">${ctx.cardHTML(BYID[it.id], { holo: !!it.h, count: it.n, size: 84 })}</div>`).join('') : '<span class="muted small">nothing</span>'}</div>`;
    function pageTrades() {
      $('#main').innerHTML = `<div class="row wrap between"><h1>Trades</h1><button class="btn primary" data-net="trade" ${enabled() ? '' : 'disabled'}>⇄ New trade</button></div><p class="muted" id="plstatus"></p><div id="trlist"></div>`;
      drawTrades(); paint(); if (Date.now() - net.last > 20000) cycle();
    }
    function drawTrades() {
      const box = $('#trlist'); if (!box) return;
      if (!enabled()) { box.innerHTML = '<div class="panel"><h2>Trading needs GitHub</h2><p class="muted">Add a GitHub token in <a href="#options">Settings</a> (or ask whoever runs this site for the shared one) to trade with other players.</p></div>'; return; }
      const s = S(), inc = incoming(), out = outgoing();
      box.innerHTML = `<section><h2>Offers for you <span class="muted small">${inc.length}</span></h2>${inc.length ? inc.map((t) => {
          const ok = t.want.every((it) => ctx.hasCopy(it.id, it.h));
          return `<div class="panel tr-offer"><div class="tr-head"><b>${esc(t.from.name)}</b> <span class="muted">offers</span></div>${t.msg ? `<p class="tr-msg">“${esc(t.msg)}”</p>` : ''}${mini(t.give)}<div class="tr-head"><span class="muted">${t.want.length ? 'and wants' : 'as a gift'}</span></div>${t.want.length ? mini(t.want) : ''}
            <div class="row wrap"><button class="btn primary" data-net="accept" data-id="${t.id}" ${ok ? '' : 'disabled'}>Accept</button><button class="btn" data-net="decline" data-id="${t.id}">Decline</button>${ok ? '' : '<span class="muted small">You do not have the cards they want.</span>'}</div></div>`;
        }).join('') : '<div class="empty"><p>No offers right now.</p></div>'}</section>
        <section><h2>Your offers <span class="muted small">${out.length}</span></h2>${out.length ? out.map((o) => `<div class="panel tr-offer"><div class="tr-head">To <b>${esc(o.toName)}</b> <span class="muted small">· waiting for an answer · your cards are held until it is settled</span></div>${o.msg ? `<p class="tr-msg">“${esc(o.msg)}”</p>` : ''}${mini(o.give)}<div class="tr-head"><span class="muted">${o.want.length ? 'for' : 'as a gift'}</span></div>${o.want.length ? mini(o.want) : ''}
          <div class="row wrap"><button class="btn" data-net="cancel" data-id="${o.id}">Cancel offer</button></div></div>`).join('') : '<div class="empty"><p>You have no offers out.</p></div>'}</section>
        <section><h2>History</h2>${s.net.hist.length ? `<ul class="tr-hist">${s.net.hist.map((h) => `<li><span class="muted small">${new Date(h.at).toLocaleString('en-GB')}</span> ${esc(h.text)}</li>`).join('')}</ul>` : '<div class="empty"><p>Nothing yet.</p></div>'}</section>`;
    }
    // Two pickers: what you give (from your collection) and what you want (from theirs).
    function tradeModal(pre) {
      if (!enabled()) { toast('Add a GitHub token in Settings first', true); return; }
      const s = S(), others = net.dir.filter((p) => !isMe(p) && p.full);
      if (!others.length) { toast('No other players are online yet', true); return; }
      const st = { to: others.some((p) => p.id === pre) ? pre : others[0].id, give: {}, want: {} }, MAXN = 60;
      const bg = ctx.modal(`<h2>New trade</h2><label class="f">Trade with<select id="trTo">${others.map((p) => `<option value="${p.id}" ${p.id === st.to ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
        <div class="tr-cols"><div><h3>You give <span class="muted small" id="trGn"></span></h3><div id="trGive" class="tr-pick"></div></div>
        <div><h3>You get <span class="muted small" id="trWn"></span></h3><p class="muted small">Pick nothing to send a gift.</p><div id="trWant" class="tr-pick"></div></div></div>
        <label class="f" style="margin-top:12px">Message (optional)<textarea id="trMsg" maxlength="140" rows="2" placeholder="Say something with your offer..."></textarea></label>
        <div class="row wrap" style="margin-top:14px"><button class="btn primary" id="trSend" type="button">Send offer</button><button class="btn" data-act="close-modal" type="button">Cancel</button></div>`, 'wide');
      // One entry per card, with a side tab listing its copy types so you can choose how many of each (normal or skibidi) to trade.
      const entries = (cards) => Object.keys(cards).filter((id) => BYID[id] && cards[id].n > 0).sort((a, b) => BYID[a].rank - BYID[b].rank).map((id) => { const e = cards[id], v = []; if (e.n - e.h > 0) v.push({ h: 0, max: e.n - e.h }); if (e.h > 0) v.push({ h: 1, max: e.h }); return { id: id, v: v }; });
      const total = (m) => Object.keys(m).reduce((a, k) => a + (m[k] || 0), 0);
      const fill = (el, list, sel, cnt) => {
        el.innerHTML = list.length ? list.map((en) => { const picked = en.v.some((x) => sel[en.id + '|' + x.h]);
          return `<div class="tr-item ${picked ? 'picked' : ''}"><button type="button" class="card-btn" data-add="${en.id}|${en.v[0].h}">${ctx.cardHTML(BYID[en.id], { holo: en.v.length === 1 && en.v[0].h === 1, size: 84 })}</button>
          <div class="dupe-tab inline">${en.v.map((x) => { const k = en.id + '|' + x.h, n = sel[k] || 0; return `<div class="tr-var ${x.h ? 'holo' : ''}"><span>${x.h ? '✦ Skibidi' : 'Normal'} <small class="muted">own ${x.max}</small></span><span class="stepper"><button type="button" data-step="${k}|-1" aria-label="One fewer">−</button><b>${n}</b><button type="button" data-step="${k}|1" aria-label="One more">+</button><button type="button" class="all" data-step="${k}|all" title="All ${x.max}">All</button></span></div>`; }).join('')}</div></div>`; }).join('') : '<p class="muted small">Nothing to pick.</p>';
        const t = total(sel); $(cnt, bg).textContent = t ? `(${t} card${t === 1 ? '' : 's'})` : '';
      };
      const maxOf = (cards, k) => { const [id, h] = k.split('|'), e = cards[id]; return e ? (h === '1' ? e.h : e.n - e.h) : 0; };
      const draw = () => { const them = net.dir.find((p) => p.id === st.to);
        fill($('#trGive', bg), entries(s.cards), st.give, '#trGn'); fill($('#trWant', bg), them ? entries(them.cards) : [], st.want, '#trWn'); };
      draw();
      $('#trTo', bg).onchange = (e) => { st.to = e.target.value; st.want = {}; draw(); };
      const click = (key) => (e) => {
        const cards = key === 'give' ? s.cards : (net.dir.find((p) => p.id === st.to) || { cards: {} }).cards, sel = st[key];
        const add = e.target.closest('[data-add]'), stp = e.target.closest('[data-step]');
        if (add) { const k = add.dataset.add; sel[k] = Math.min(maxOf(cards, k), (sel[k] || 0) + 1); }
        else if (stp) { const parts = stp.dataset.step.split('|'), k = parts[0] + '|' + parts[1], d = parts[2], max = maxOf(cards, k); const cur = sel[k] || 0; sel[k] = d === 'all' ? max : Math.max(0, Math.min(max, cur + +d)); if (total(sel) > MAXN) sel[k] -= total(sel) - MAXN; if (!sel[k]) delete sel[k]; }
        else return;
        if (add && total(sel) > MAXN) { sel[add.dataset.add]--; toast('You can trade up to ' + MAXN + ' cards at once', true); }
        draw();
      };
      $('#trGive', bg).onclick = click('give'); $('#trWant', bg).onclick = click('want');
      $('#trSend', bg).onclick = async () => {
        const conv = (m) => { const out = []; Object.keys(m).forEach((k) => { const [id, h] = k.split('|'); for (let i = 0; i < m[k]; i++) out.push({ id: id, h: +h }); }); return out; };
        const btn = $('#trSend', bg); btn.disabled = true;
        try { await createTrade(st.to, conv(st.give), conv(st.want), $('#trMsg', bg).value); ctx.closeModal(bg); toast('Offer sent'); location.hash = '#trades'; if (location.hash === '#trades') drawTrades(); }
        catch (e) { toast(e.message, true); btn.disabled = false; }
      };
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
          ctx.restore(Object.assign({}, p.raw, { cards: cards, profile: { id: p.id, name: p.name, hue: p.hue, pfp: p.pfp, banner: p.banner, joined: p.joined }, settings: S().settings }));
        } catch (e) { toast('Could not restore: ' + e.message, true); }
      };
    }

    function start() {
      document.addEventListener('click', (e) => {
        const t = e.target.closest('[data-net]'); if (!t || t.disabled) return;
        const a = t.dataset.net, id = t.dataset.id;
        if (a === 'trade') tradeModal(id); else if (a === 'accept') accept(id); else if (a === 'decline') decline(id); else if (a === 'cancel') cancel(id);
      });
      setInterval(() => { if (!document.hidden) cycle(); }, EVERY);
      document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - net.last > 15000) cycle(); });
      addEventListener('pagehide', flush); document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
      paint(); setTimeout(() => cycle(true), 600);
    }
    // The Online panel in Settings is switched off. Return settingsHTML/bindSettings below to bring it back (share toggle, own token, restore from cloud).
    const SHOW_SETTINGS = false;
    return { gh: gh, conf: conf, enabled: enabled, refresh: refresh, updateConfig: updateConfig, saveCardImage: saveCardImage, closeIssue: closeIssue, createIssue: createIssue, loadCache: loadCache, start: start, touch: touch, flush: flush, diag: diag, paint: paint, cycle: cycle, pagePlayers: pagePlayers, pageUser: pageUser, pageTrades: pageTrades, settingsHTML: () => (SHOW_SETTINGS ? settingsHTML() : ''), bindSettings: () => { if (SHOW_SETTINGS) bindSettings(); }, state: net, build: build };
  };
})();
