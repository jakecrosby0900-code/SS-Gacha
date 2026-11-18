// Admin: login lives in Settings and opens the #admin page, where you can
//  - manage accounts: remove from the leaderboard (restore one or all), give cards or packs, delete,
//  - add new cards, edit any card (name, set, rarity) and upload card pictures,
//  - add custom rarities and sets.
//
// Changes are saved online through GitHub Issues (see net.js), so every player sees them.
//
// The admin username and password are NOT stored here. Only a salted PBKDF2 hash of them is, so reading this file does not reveal them.
// Honest limit: this check runs in the browser, so it keeps ordinary players out of the page but is not real security. Anyone who can
// edit the repo's issues (everyone who has the site's shared token, i.e. anyone who reads the page source) could change the same data by hand.
(function () {
  'use strict';
  const ADMIN = { salt: '0MfMxikwfSmMt/rb6fO8cQ==', hash: 'TdZ10xvZRDIqN9XBFDu2Jj4vFkEsJ6tMGydDMj74o4M=', iter: 150000 };
  const FLAG = 'ss-gacha-admin';

  window.SSGAdmin = function (ctx) {
    const G = ctx.G, $ = ctx.$, $$ = ctx.$$, esc = ctx.esc, net = ctx.net, toast = ctx.toast;
    const st = () => net.state;
    const view = { q: '', cat: '', tier: '', only: '', mode: 'list', busy: false };
    const unlocked = () => { try { return sessionStorage.getItem(FLAG) === '1'; } catch (e) { return false; } };
    const lock = () => { try { sessionStorage.removeItem(FLAG); } catch (e) { /* ignore */ } };

    // ---------- login (Settings) ----------
    function settingsHTML() {
      if (unlocked()) return `<section class="panel"><h2>Admin 🛠️</h2><p class="muted small">You are logged in as admin.</p><div class="row wrap"><a class="btn primary" href="#admin">Open admin page</a><button class="btn" id="adLock" type="button">Log out of admin</button></div></section>`;
      return `<section class="panel"><h2>Admin 🔒</h2><p class="muted small">Admin login for managing the leaderboard and cards.</p>
        <form id="adForm" novalidate><div class="row wrap"><label class="f">Admin username<input id="adUser" autocomplete="off" autocapitalize="none" spellcheck="false"></label>
        <label class="f">Admin password<input id="adPass" type="password" autocomplete="off"></label></div>
        <p class="auth-err" id="adErr" role="alert"></p><button class="btn" id="adGo" type="submit">Log in as admin</button></form></section>`;
    }
    function bindSettings() {
      const lk = $('#adLock'); if (lk) lk.onclick = () => { lock(); ctx.rerenderSettings(); toast('Admin logged out'); };
      const f = $('#adForm'); if (!f) return;
      f.onsubmit = async (e) => {
        e.preventDefault(); const go = $('#adGo'), err = $('#adErr'); err.textContent = ''; go.disabled = true;
        try {
          const h = await window.SSG_CRYPTO.derive($('#adUser').value.trim() + '\n' + $('#adPass').value, ADMIN.salt, ADMIN.iter);
          if (h !== ADMIN.hash) { err.textContent = 'Wrong admin username or password.'; go.disabled = false; return; }
          try { sessionStorage.setItem(FLAG, '1'); } catch (ex) { /* ignore */ }
          toast('Admin unlocked'); location.hash = '#admin';
        } catch (ex) { err.textContent = ex.message || 'Could not check the login.'; go.disabled = false; }
      };
    }

    // ---------- helpers ----------
    // Crops to the card art ratio (10:7) and shrinks until it fits in one GitHub issue.
    function readCardImage(file) {
      return new Promise((res, rej) => {
        const url = URL.createObjectURL(file), img = new Image();
        img.onload = () => {
          URL.revokeObjectURL(url);
          for (const [w, h] of [[420, 294], [340, 238], [260, 182]]) {
            const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
            g.fillStyle = '#111'; g.fillRect(0, 0, w, h);
            const sc = Math.max(w / img.width, h / img.height), dw = img.width * sc, dh = img.height * sc; g.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
            for (const q of [0.85, 0.7, 0.55, 0.4]) { const d = c.toDataURL('image/jpeg', q); if (d.length < 56000) return res(d); }
          }
          rej(new Error('That picture is too detailed to store. Try a simpler one.'));
        };
        img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Could not read that image')); };
        img.src = url;
      });
    }
    function guard(fn) { return async function () { if (view.busy) return; view.busy = true; try { await fn.apply(null, arguments); } catch (e) { toast(e.message || 'Something went wrong', true); } view.busy = false; }; }
    const opts = (list, cur) => list.map((v) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(v)}</option>`).join('');

    // ---------- actions ----------
    const block = async (id, name) => { await net.updateConfig((cfg) => { cfg.blocked = cfg.blocked.filter((x) => x.id !== id); cfg.blocked.push({ id: id, name: name }); }); };
    const removePlayer = guard(async (id, name) => {
      if (!window.confirm(`Remove ${name} from the leaderboard? They stay unlisted until you restore them.`)) return;
      const p = st().dir.find((x) => x.id === id); if (p) await net.closeIssue(p.num);
      await block(id, name); toast(name + ' removed'); page();
    });
    const restorePlayer = guard(async (id) => {
      await net.updateConfig((cfg) => { cfg.blocked = cfg.blocked.filter((x) => x.id !== id); });
      toast('Restored. They reappear the next time they play online.'); page();
    });
    const restoreAll = guard(async () => {
      const n = st().cfg.blocked.length; if (!n) return;
      if (!window.confirm(`Restore all ${n} removed player${n === 1 ? '' : 's'}?`)) return;
      await net.updateConfig((cfg) => { cfg.blocked = []; }); toast('Everyone restored. They reappear the next time they play online.'); page();
    });
    const deleteAccount = guard(async (a) => {
      if (!window.confirm(`Delete the account "${a.u}"? Their username becomes free and they disappear from the leaderboard. This cannot be undone.`)) return;
      await net.closeIssue(a.num);
      const p = st().dir.find((x) => x.id === a.pid); if (p) await net.closeIssue(p.num);
      await net.refresh(); toast('Account deleted'); page();
    });

    // ---------- giving cards ----------
    // A gift is one "grant" issue. The player's own device applies it the next time it syncs (their save is published by their device, so
    // writing straight into it would just get overwritten), then closes the issue.
    function giveModal(acc) {
      const cart = {}; let q = '';
      const bg = ctx.modal(`<h2>Give to ${esc(acc.u)}</h2>
        <label class="f">Find a card<input id="gvQ" type="search" placeholder="Card name" autocomplete="off"></label>
        <label class="check"><input id="gvHolo" type="checkbox"> Skibidi (holo) copy</label>
        <div id="gvList" class="ad-pick"></div>
        <h3 style="margin:12px 0 6px">Gift</h3><div id="gvCart" class="ad-pick"></div>
        <label class="f">Packs to give (optional)<input id="gvPacks" type="number" min="0" max="1000" value="0"></label>
        <div class="row wrap" style="margin-top:14px"><button class="btn primary" id="gvSend" type="button">Send gift</button><button class="btn" data-act="close-modal" type="button">Cancel</button></div>`, 'wide');
      const draw = () => {
        const f = q.trim().toLowerCase(), list = G.CARDS.filter((c) => !f || c.name.toLowerCase().includes(f) || c.cat.toLowerCase() === f).sort((a, b) => b.ti - a.ti || a.rank - b.rank).slice(0, 40);
        $('#gvList', bg).innerHTML = list.length ? list.map((c) => `<button type="button" class="btn sm" data-gv="${esc(c.id)}">${esc(c.name)} <small class="muted">${esc(c.cat)} · ${esc(c.tier)}</small></button>`).join('') : '<span class="muted small">No cards match.</span>';
        const ks = Object.keys(cart);
        $('#gvCart', bg).innerHTML = ks.length ? ks.map((k) => { const [id, h] = k.split('|'); return `<button type="button" class="btn sm" data-gx="${esc(k)}" title="Click to remove one">${esc(G.BYID[id].name)}${h === '1' ? ' (skibidi)' : ''} ×${cart[k]}</button>`; }).join('') : '<span class="muted small">Nothing picked yet. Click cards above to add them.</span>';
      };
      draw();
      $('#gvQ', bg).oninput = (e) => { q = e.target.value; draw(); };
      bg.addEventListener('click', (e) => {
        const a = e.target.closest('[data-gv]'), x = e.target.closest('[data-gx]');
        if (a) { const k = a.dataset.gv + '|' + ($('#gvHolo', bg).checked ? 1 : 0); cart[k] = Math.min(99, (cart[k] || 0) + 1); draw(); }
        else if (x) { const k = x.dataset.gx; if (--cart[k] <= 0) delete cart[k]; draw(); }
      });
      $('#gvSend', bg).onclick = guard(async () => {
        const cards = Object.keys(cart).map((k) => { const [id, h] = k.split('|'); return { id: id, h: +h, n: cart[k] }; }), packs = Math.min(1000, Math.max(0, Math.floor(+$('#gvPacks', bg).value) || 0));
        if (!cards.length && !packs) { toast('Pick at least one card or some packs', true); return; }
        $('#gvSend', bg).disabled = true;
        try {
          const gid = ctx.uid().replace(/[^a-z0-9]/g, '');
          await net.createIssue('grant:' + gid + ' ' + acc.k, { t: 'grant', v: 1, gid: gid, k: acc.k, cards: cards, packs: packs, at: Date.now() });
          ctx.closeModal(bg); toast('Gift sent. ' + acc.u + ' gets it the next time they are online.');
        } catch (e) { $('#gvSend', bg).disabled = false; throw e; }
      });
    }

    function statsModal(acc) {
      const p = st().dir.find((x) => x.id === acc.pid);
      const bg = ctx.modal(`<h2>Packs opened: ${esc(acc.u)}</h2><p class="muted small">This is the "packs opened" number on their profile and the leaderboard. It does not change their cards.</p>
        <label class="f">Packs opened<input id="stOpen" type="number" min="0" max="1000000" value="${p ? p.opened : 0}"></label>
        <div class="row wrap" style="margin-top:14px"><button class="btn primary" id="stGo" type="button">Save</button><button class="btn" data-act="close-modal" type="button">Cancel</button></div>`);
      $('#stGo', bg).onclick = guard(async () => {
        const v = Math.floor(+$('#stOpen', bg).value); if (!(v >= 0)) { toast('Enter a number', true); return; }
        const gid = ctx.uid().replace(/[^a-z0-9]/g, '');
        await net.createIssue('grant:' + gid + ' ' + acc.k, { t: 'grant', v: 1, gid: gid, k: acc.k, cards: [], packs: 0, opened: v, at: Date.now() });
        ctx.closeModal(bg); toast('Done. It updates the next time ' + acc.u + ' is online.');
      });
    }
    // Removing cards works the same way: a grant that carries a "take" list (or wipe = everything), applied by the player's own device.
    function takeModal(acc) {
      const p = st().dir.find((x) => x.id === acc.pid);
      if (!p || !p.full || !Object.keys(p.cards).length) { toast(acc.u + ' has no cards saved online.', true); return; }
      const pick = {}, tiles = [];
      Object.keys(p.cards).sort((a, b) => G.BYID[a].rank - G.BYID[b].rank).forEach((id) => { const e = p.cards[id]; if (e.n - e.h > 0) tiles.push({ id: id, h: 0, n: e.n - e.h }); if (e.h > 0) tiles.push({ id: id, h: 1, n: e.h }); });
      const bg = ctx.modal(`<h2>Remove cards from ${esc(acc.u)}</h2>
        <label class="f">Find a card<input id="tkQ" type="search" placeholder="Card name" autocomplete="off"></label>
        <p class="muted small">Click a card to mark one copy for removal (click again for more). This is what they had at their last upload.</p>
        <div id="tkList" class="ad-pick" style="max-height:260px"></div>
        <h3 style="margin:12px 0 6px">To remove</h3><div id="tkPick" class="ad-pick"></div>
        <div class="row wrap" style="margin-top:14px"><button class="btn primary" id="tkGo" type="button">Remove selected</button><button class="btn danger" id="tkAll" type="button">Remove ALL their cards</button><button class="btn" data-act="close-modal" type="button">Cancel</button></div>`, 'wide');
      const draw = () => {
        const f = $('#tkQ', bg).value.trim().toLowerCase(), list = tiles.filter((t) => !f || G.BYID[t.id].name.toLowerCase().includes(f));
        $('#tkList', bg).innerHTML = list.map((t) => { const k = t.id + '|' + t.h; return `<button type="button" class="btn sm" data-tk="${esc(k)}">${esc(G.BYID[t.id].name)}${t.h ? ' (skibidi)' : ''} <small class="muted">own ${t.n}</small></button>`; }).join('') || '<span class="muted small">No cards match.</span>';
        const ks = Object.keys(pick);
        $('#tkPick', bg).innerHTML = ks.length ? ks.map((k) => { const [id, h] = k.split('|'); return `<button type="button" class="btn sm danger" data-tx="${esc(k)}" title="Click to undo one">${esc(G.BYID[id].name)}${h === '1' ? ' (skibidi)' : ''} ×${pick[k]}</button>`; }).join('') : '<span class="muted small">Nothing marked.</span>';
      };
      draw(); $('#tkQ', bg).oninput = draw;
      bg.addEventListener('click', (e) => {
        const a = e.target.closest('[data-tk]'), x = e.target.closest('[data-tx]');
        if (a) { const k = a.dataset.tk, t = tiles.find((y) => y.id + '|' + y.h === k); pick[k] = Math.min(t.n, (pick[k] || 0) + 1); draw(); }
        else if (x) { const k = x.dataset.tx; if (--pick[k] <= 0) delete pick[k]; draw(); }
      });
      const send = async (body, msg) => {
        const gid = ctx.uid().replace(/[^a-z0-9]/g, '');
        await net.createIssue('grant:' + gid + ' ' + acc.k, Object.assign({ t: 'grant', v: 1, gid: gid, k: acc.k, cards: [], packs: 0, at: Date.now() }, body));
        ctx.closeModal(bg); toast(msg);
      };
      $('#tkGo', bg).onclick = guard(async () => {
        const take = Object.keys(pick).map((k) => { const [id, h] = k.split('|'); return { id: id, h: +h, n: pick[k] }; });
        if (!take.length) { toast('Mark at least one card', true); return; }
        await send({ take: take }, 'Done. The cards are removed the next time ' + acc.u + ' is online.');
      });
      $('#tkAll', bg).onclick = guard(async () => {
        if (!window.confirm(`Remove EVERY card from ${acc.u}? They keep their packs. This cannot be undone.`)) return;
        await send({ wipe: true }, 'Done. All cards are removed the next time ' + acc.u + ' is online.');
      });
    }

    // ---------- rarities and sets (built-in ones can be edited too) ----------
    const NAME_RE = /^[A-Za-z0-9 ]+$/;
    function tierEditor(name) {
      const builtin = name && G.TIER0.indexOf(name) >= 0, idx = name ? G.TIERS.indexOf(name) : -1;
      const cur = !name ? null : builtin ? { name: name, color: G.TIER_COLOR[name], pts: G.POINTS[idx], weight: G.BASE_WEIGHTS[idx] } : st().cfg.tiers.find((t) => t.name === name), isNew = !cur;
      const def = builtin ? G.TIER_DEF[name] : null;
      const bg = ctx.modal(`<h2>${isNew ? 'Add a rarity' : 'Edit ' + esc(name)}</h2>
        <div class="row wrap"><label class="f">Name<input id="rtName" maxlength="14" value="${esc(cur ? cur.name : '')}" ${cur ? 'disabled' : ''} autocomplete="off"></label>
        <label class="f">Colour<input id="rtColor" type="color" value="${cur ? cur.color : '#00e5c0'}"></label></div>
        <div class="row wrap"><label class="f">Points per card<input id="rtPts" type="number" min="0" max="100000" value="${cur ? cur.pts : 10}"></label>
        <label class="f">Drop weight<input id="rtW" type="number" min="0" max="1000" step="0.01" value="${cur ? cur.weight : 1}"></label></div>
        ${builtin ? `<p class="muted small">Default: ${def.pts} points, weight ${def.weight}, colour <span style="color:${def.color}">${def.color}</span>.</p>` : `<label class="f">Sits just above<select id="rtAfter">${opts(G.TIERS.filter((t) => t !== name), cur ? cur.after : G.TIERS[G.TIERS.length - 1])}</select></label>`}
        <p class="muted small">Drop weight is relative to the others (Common 50, Rare 14, Epic 5, Legendary 2, Mythic 0.8, Sigma 0.08 by default; Rare and above are also cut by the game's luck setting). Setting it to 0 stops the whole rarity dropping. A rarity with no cards never drops. Points changes apply to everyone's score straight away.</p>
        <div class="row wrap" style="margin-top:14px"><button class="btn primary" id="rtSave" type="button">${isNew ? 'Add rarity' : 'Save changes'}</button>${builtin ? '<button class="btn" id="rtReset" type="button">Reset to default</button>' : cur ? '<button class="btn danger" id="rtDel" type="button">Delete rarity</button>' : ''}<button class="btn" data-act="close-modal" type="button">Cancel</button></div>`);
      $('#rtSave', bg).onclick = guard(async () => {
        const n = $('#rtName', bg).value.replace(/\s+/g, ' ').trim();
        if (!n || !NAME_RE.test(n)) { toast('Use letters, numbers and spaces for the name', true); return; }
        if (isNew && G.TIERS.some((t) => t.toLowerCase() === n.toLowerCase())) { toast('A rarity with that name already exists', true); return; }
        const color = $('#rtColor', bg).value, pts = Math.max(0, Math.round(+$('#rtPts', bg).value) || 0), weight = Math.max(0, +$('#rtW', bg).value || 0);
        if (builtin) {
          const d = {}; if (color !== def.color) d.color = color; if (pts !== def.pts) d.pts = pts; if (Math.abs(weight - def.weight) > 1e-9) d.weight = weight;
          await net.updateConfig((cfg) => { if (Object.keys(d).length) cfg.tierEdits[n] = d; else delete cfg.tierEdits[n]; });
        } else {
          const e = { name: n, color: color, pts: Math.max(1, pts), weight: Math.max(0.01, weight), after: $('#rtAfter', bg).value };
          await net.updateConfig((cfg) => { const i = cfg.tiers.findIndex((t) => t.name === n); if (i >= 0) cfg.tiers[i] = e; else cfg.tiers.push(e); });
        }
        ctx.closeModal(bg); toast('Rarity saved'); page();
      });
      const rs = $('#rtReset', bg); if (rs) rs.onclick = guard(async () => { await net.updateConfig((cfg) => { delete cfg.tierEdits[name]; }); ctx.closeModal(bg); toast('Back to the default'); page(); });
      const dl = $('#rtDel', bg); if (dl) dl.onclick = guard(async () => {
        const used = G.CARDS.filter((c) => c.tier === name).length;
        if (used) { toast(`${used} card${used === 1 ? ' uses' : 's use'} this rarity. Move them to another rarity first.`, true); return; }
        if (st().cfg.tiers.some((x) => x.after === name)) { toast('Another custom rarity sits above this one. Move or delete that one first.', true); return; }
        await net.updateConfig((cfg) => { cfg.tiers = cfg.tiers.filter((t) => t.name !== name); }); ctx.closeModal(bg); toast('Rarity deleted'); page();
      });
    }
    function setEditor(name) {
      const builtin = name && G.CAT_BASE.indexOf(name) >= 0, cur = !name ? null : builtin ? { name: name, hue: G.CATS[name].hue, blurb: G.CATS[name].blurb } : st().cfg.sets.find((t) => t.name === name), isNew = !cur;
      const bg = ctx.modal(`<h2>${isNew ? 'Add a set' : 'Edit ' + esc(name)}</h2>
        <div class="row wrap"><label class="f">Name<input id="stName" maxlength="12" value="${esc(cur ? cur.name : '')}" ${cur ? 'disabled' : ''} autocomplete="off"></label>
        <label class="f">Colour (hue)<input id="stHue" type="range" min="0" max="359" value="${cur ? cur.hue : 200}"></label></div>
        <label class="f">Description<input id="stBlurb" maxlength="90" value="${esc(cur ? cur.blurb : '')}" autocomplete="off"></label>
        <p class="muted small">${builtin ? 'Built-in set: you can change its colour and description. Its name stays (saves refer to it).' : 'After adding a set, use "Add card" and pick it in the Set list, or edit an existing card to move it here.'}</p>
        <div class="row wrap" style="margin-top:14px"><button class="btn primary" id="stSave" type="button">${isNew ? 'Add set' : 'Save changes'}</button>${builtin ? '<button class="btn" id="stReset" type="button">Reset to default</button>' : cur ? '<button class="btn danger" id="stDel" type="button">Delete set</button>' : ''}<button class="btn" data-act="close-modal" type="button">Cancel</button></div>`);
      $('#stSave', bg).onclick = guard(async () => {
        const n = $('#stName', bg).value.replace(/\s+/g, ' ').trim();
        if (!n || !NAME_RE.test(n)) { toast('Use letters, numbers and spaces for the name', true); return; }
        if (isNew && Object.keys(G.CATS).some((k) => k.toLowerCase() === n.toLowerCase())) { toast('A set with that name already exists', true); return; }
        const e = { name: n, hue: +$('#stHue', bg).value, blurb: $('#stBlurb', bg).value.trim() };
        if (builtin) { const d = G.CAT_DEF[n], o = {}; if (e.hue !== d.hue) o.hue = e.hue; if (e.blurb !== d.blurb) o.blurb = e.blurb; await net.updateConfig((cfg) => { if (Object.keys(o).length) cfg.setEdits[n] = o; else delete cfg.setEdits[n]; }); }
        else await net.updateConfig((cfg) => { cfg.sets = cfg.sets.filter((t) => t.name !== n); cfg.sets.push(e); });
        ctx.closeModal(bg); toast('Set saved'); page();
      });
      const rs = $('#stReset', bg); if (rs) rs.onclick = guard(async () => { await net.updateConfig((cfg) => { delete cfg.setEdits[name]; }); ctx.closeModal(bg); toast('Back to the default'); page(); });
      const dl = $('#stDel', bg); if (dl) dl.onclick = guard(async () => {
        const used = G.CARDS.filter((c) => c.cat === name).length;
        if (used) { toast(`${used} card${used === 1 ? ' is' : 's are'} in this set. Move or delete them first.`, true); return; }
        await net.updateConfig((cfg) => { cfg.sets = cfg.sets.filter((t) => t.name !== name); }); ctx.closeModal(bg); toast('Set deleted'); page();
      });
    }

    // ---------- power hours ----------
    const fmtLeft = (ms) => { const m = Math.max(0, Math.ceil(ms / 60000)); return m >= 60 ? Math.floor(m / 60) + 'h ' + (m % 60 ? (m % 60) + 'm' : '') : m + 'm'; };
    const scopeText = (e) => (e.scope === 'all' ? 'every card' : e.scope === 'rare' ? 'Rare and above' : e.scope === 'tier' ? e.value + ' cards' : e.scope === 'set' ? 'the ' + e.value + ' set' : (G.BYID[e.value] ? G.BYID[e.value].name : e.value));
    const evText = (e) => (e.kind === 'holo' ? 'Skibidi chance for ' + scopeText(e) + ' ×' + e.mult : scopeText(e).replace(/^./, (x) => x.toUpperCase()) + ' ×' + e.mult + ' more likely');
    function powerModal() {
      const bg = ctx.modal(`<h2>Start a power hour ⚡</h2>
        <label class="f">Name<input id="phName" maxlength="40" placeholder="Power hour" autocomplete="off"></label>
        <div class="row wrap"><label class="f">Boost<select id="phKind"><option value="weight">How often cards drop</option><option value="holo">Skibidi chance</option></select></label>
        <label class="f">Applies to<select id="phScope"><option value="all">Every card</option><option value="rare">Rare and above</option><option value="tier">One rarity</option><option value="set">One set</option><option value="card">One card</option></select></label></div>
        <div id="phValBox"></div>
        <div class="row wrap"><label class="f">Times more likely<input id="phMult" type="number" min="0.1" max="1000" step="0.1" value="3"></label>
        <label class="f">Lasts (minutes)<input id="phDur" type="number" min="1" max="10080" value="60"></label>
        <label class="f">Starts in (minutes)<input id="phIn" type="number" min="0" max="10080" value="0"></label></div>
        <div class="row wrap">${[[15, '15m'], [30, '30m'], [60, '1h'], [120, '2h'], [360, '6h'], [1440, '24h']].map(([m, l]) => `<button class="btn sm" type="button" data-dur="${m}">${l}</button>`).join('')}</div>
        <p class="muted small" id="phNote"></p>
        <div class="row wrap" style="margin-top:14px"><button class="btn primary" id="phGo" type="button">Start</button><button class="btn" data-act="close-modal" type="button">Cancel</button></div>`);
      const box = $('#phValBox', bg);
      const draw = () => {
        const sc = $('#phScope', bg).value;
        box.innerHTML = sc === 'tier' ? `<label class="f">Rarity<select id="phVal">${opts(G.TIERS, G.TIERS[3])}</select></label>` : sc === 'set' ? `<label class="f">Set<select id="phVal">${opts(Object.keys(G.CATS), 'SS')}</select></label>`
          : sc === 'card' ? `<label class="f">Card<select id="phVal">${G.CARDS.slice().sort((a, b) => a.name.localeCompare(b.name)).map((c) => `<option value="${esc(c.id)}">${esc(c.name)} (${esc(c.cat)})</option>`).join('')}</select></label>` : '';
        $('#phNote', bg).textContent = $('#phKind', bg).value === 'holo' ? 'Multiplies the chance that a pulled copy is a skibidi one (capped at 100%).' : 'Multiplies the drop weight of the matching cards, so they take a bigger share of every pack.';
      };
      $('#phScope', bg).onchange = draw; $('#phKind', bg).onchange = draw; draw();
      bg.addEventListener('click', (e) => { const d = e.target.closest('[data-dur]'); if (d) $('#phDur', bg).value = d.dataset.dur; });
      $('#phGo', bg).onclick = guard(async () => {
        const scope = $('#phScope', bg).value, v = $('#phVal', bg), mult = +$('#phMult', bg).value, dur = Math.round(+$('#phDur', bg).value), inn = Math.max(0, Math.round(+$('#phIn', bg).value) || 0);
        if (!(mult > 0) || !(dur >= 1)) { toast('Enter a multiplier and how long it lasts', true); return; }
        const start = Date.now() + inn * 60000, ev = { id: ctx.uid().replace(/[^a-z0-9]/g, '').slice(0, 20), name: $('#phName', bg).value.trim() || 'Power hour', kind: $('#phKind', bg).value, scope: scope, value: v ? v.value : '', mult: mult, start: start, end: start + dur * 60000 };
        await net.updateConfig((cfg) => { cfg.events = cfg.events.filter((x) => x.end > Date.now() - 86400000); cfg.events.push(ev); });
        ctx.closeModal(bg); toast(inn ? 'Power hour scheduled' : 'Power hour started'); page();
      });
    }

    // ---------- bulk changes, backup, gifts for everyone ----------
    const sel = new Set(); // card ids ticked in the card list
    const bulk = guard(async (what, value) => {
      const ids = Array.from(sel); if (!ids.length) { toast('Tick some cards first', true); return; }
      await net.updateConfig((cfg) => {
        ids.forEach((id) => {
          const c = G.BYID[id]; if (!c) return;
          if (what === 'reset') { delete cfg.edits[id]; return; }
          if (c.custom && (what === 'tier' || what === 'cat')) { const a = cfg.added.find((x) => x.id === id); if (a) a[what] = value; return; }
          const e = cfg.edits[id] || (cfg.edits[id] = {});
          if (what === 'tier' || what === 'cat') { const base = c.base; if (value === base[what]) delete e[what]; else e[what] = value; }
          else if (what === 'off') { if (value) e.off = 1; else delete e.off; }
          else if (what === 'w') { if (Math.abs(value - 1) < 1e-6) delete e.w; else e.w = value; }
          if (!Object.keys(e).length) delete cfg.edits[id];
        });
      });
      toast('Updated ' + ids.length + ' card' + (ids.length === 1 ? '' : 's')); page();
    });

    // ---------- chance maths (mirrors the game's own roll) ----------
    // draft = { id, ti, fx, wm, off, monster }. Returns the chance of that card per slot, its rarity's chance per slot, and the card's weight without its multiplier.
    function chanceOf(draft) {
      const luck = G.DIFFS.sigma.luck, list = G.CARDS.filter((c) => c.id !== draft.id && !c.off && (!c.monster || draft.monster)).map((c) => ({ ti: c.ti, fx: c.fx, wm: c.wm }));
      if (!draft.off) list.push({ ti: draft.ti, fx: draft.fx, wm: draft.wm });
      const cnt = {}; list.forEach((c) => { cnt[c.ti] = (cnt[c.ti] || 0) + 1; });
      const w = (c, wm) => G.BASE_WEIGHTS[c.ti] * (c.fx >= 2 ? luck : 1) / cnt[c.ti] * wm;
      const tot = list.reduce((a, c) => a + w(c, c.wm), 0) || 1;
      const tier = list.filter((c) => c.ti === draft.ti).reduce((a, c) => a + w(c, c.wm), 0) / tot;
      const mine = draft.off ? 0 : w(draft, draft.wm) / tot;
      const base = draft.off ? 0 : w(draft, 1), others = tot - (draft.off ? 0 : w(draft, draft.wm));
      return { tier: tier, mine: mine, base: base, others: others };
    }
    const pct = (x) => (x * 100).toFixed(x < 0.01 ? 3 : 2).replace(/\.?0+$/, '') + '%';
    const perPack = (p) => (p > 0 ? 'about 1 in ' + Math.round(1 / (1 - Math.pow(1 - p, 5))).toLocaleString() : 'never');

    // ---------- card editor ----------
    function cardForm(c) {
      const isNew = !c, cats = Object.keys(G.CATS);
      return `<h2>${isNew ? 'Add a card' : 'Edit card'}</h2>
        <div class="ad-edit"><div class="ad-prev" id="adPrev"></div><div class="ad-fields">
        <label class="f">Name<input id="cdName" maxlength="60" value="${esc(c ? c.name : '')}" autocomplete="off"></label>
        <div class="row wrap"><label class="f">Set<select id="cdCat">${opts(cats, c ? c.cat : 'SS')}</select></label>
        <label class="f">Rarity<select id="cdTier">${opts(G.TIERS, c ? c.tier : 'Common')}</select></label></div>
        <div class="row wrap"><label class="btn" style="cursor:pointer">Upload picture<input id="cdFile" type="file" accept="image/*" hidden></label><button class="btn" id="cdImgX" type="button">Remove custom picture</button></div></div></div>
        <h3 style="margin:14px 0 6px">Stats</h3>
        <div class="ad-stats">
          <label class="f">Points<input id="cdPts" type="number" min="0" max="1000000" step="1" value="${c && c.ptsOv != null ? c.ptsOv : ''}" placeholder="rarity default"></label>
          <label class="f">Drop chance multiplier<input id="cdW" type="number" min="0" max="1000" step="0.01" value="${c ? c.wm : 1}"></label>
          <label class="f">…or exact chance per slot (%)<input id="cdExact" type="number" min="0" max="99" step="0.001" placeholder="type a % to set it"></label>
          <label class="f">Skibidi chance (%)<input id="cdHolo" type="number" min="0" max="100" step="0.1" value="${c && c.holoOv != null ? +(c.holoOv * 100).toFixed(2) : ''}" placeholder="default ${+(G.DIFFS.sigma.holo * 100).toFixed(2)}"></label>
          <label class="check" style="grid-column:1/-1"><input id="cdOn" type="checkbox" ${c && c.off ? '' : 'checked'}> Drops from packs</label>
        </div>
        <dl class="ad-calc" id="cdCalc"></dl>
        <div class="row wrap" style="margin-top:14px"><button class="btn primary" id="cdSave" type="button">${isNew ? 'Add card' : 'Save changes'}</button>
        ${c ? '<button class="btn" id="cdDup" type="button">Duplicate</button>' : ''}
        ${c && !c.custom ? '<button class="btn" id="cdReset" type="button">Reset to original</button>' : ''}${c && c.custom ? '<button class="btn danger" id="cdDel" type="button">Delete card</button>' : ''}
        <button class="btn" data-act="close-modal" type="button">Cancel</button></div>`;
    }
    function cardEditor(id, clone) {
      const c = id ? G.BYID[id] : null; if (id && !c) return;
      const draft = { img: undefined }; // undefined = unchanged, null = remove, string = new picture
      const bg = ctx.modal(cardForm(c), 'wide');
      if (clone) { /* nothing extra: a clone opens the normal "add" form filled from the card */ }
      const vals = () => {
        const t = G.TIERS.indexOf($('#cdTier', bg).value), cat = $('#cdCat', bg).value, pts = $('#cdPts', bg).value.trim(), w = Math.max(0, +$('#cdW', bg).value || 0), ho = $('#cdHolo', bg).value.trim();
        return { t: t, cat: cat, pts: pts === '' ? null : Math.max(0, Math.round(+pts) || 0), w: w, holo: ho === '' ? null : Math.min(1, Math.max(0, +ho / 100)), on: $('#cdOn', bg).checked };
      };
      const calc = () => {
        const v = vals(), d = { id: c ? c.id : 'NEW:preview', ti: v.t, fx: G.TIER_FX[v.t], wm: v.w, off: !v.on, monster: !!G.CATS[v.cat].monster }, r = chanceOf(d);
        const pts = v.pts != null ? v.pts : G.POINTS[v.t];
        $('#cdCalc', bg).innerHTML = `<dt>Points</dt><dd>${pts} (${pts * G.GS.holoMult} skibidi)</dd><dt>Chance per slot (this rarity)</dt><dd>${pct(r.tier)}</dd><dt>This exact card</dt><dd>${v.on ? pct(r.mine) : 'not in packs'}</dd><dt>Per pack</dt><dd>${v.on ? perPack(r.mine) : '-'}</dd><dt>Skibidi chance</dt><dd>${pct(v.holo != null ? v.holo : G.DIFFS.sigma.holo)}</dd>`;
        return r;
      };
      const preview = () => {
        const base = c || { id: 'NEW:preview', name: 'x', cat: 'SS', tier: 'Common', ti: 0, pts: 1, rank: 999, monster: false, img: null };
        const v = vals(), cat = v.cat, img = draft.img === undefined ? base.img : draft.img;
        const tmp = Object.assign({}, base, { name: $('#cdName', bg).value.trim() || 'Card name', cat: cat, tier: G.TIERS[v.t], ti: v.t, fx: G.TIER_FX[v.t], pts: v.pts != null ? v.pts : G.POINTS[v.t], monster: !!G.CATS[cat].monster, img: img });
        $('#adPrev', bg).innerHTML = ctx.cardHTML(tmp, { size: 190 }); calc();
      };
      preview();
      ['#cdName', '#cdCat', '#cdTier', '#cdPts', '#cdW', '#cdHolo', '#cdOn'].forEach((s) => { $(s, bg).oninput = preview; $(s, bg).onchange = preview; });
      // Typing an exact chance works out the multiplier that gives it.
      $('#cdExact', bg).oninput = (e) => {
        const P = +e.target.value / 100; if (!(P > 0 && P < 1)) return;
        const v = vals(), r = chanceOf({ id: c ? c.id : 'NEW:preview', ti: v.t, fx: G.TIER_FX[v.t], wm: 1, off: false, monster: !!G.CATS[v.cat].monster });
        if (!(r.base > 0)) return; $('#cdW', bg).value = Math.min(1000, +(P * r.others / (r.base * (1 - P))).toFixed(4)); $('#cdOn', bg).checked = true; preview();
      };
      $('#cdFile', bg).onchange = async (e) => { const f = e.target.files[0]; if (!f) return; try { draft.img = await readCardImage(f); preview(); } catch (er) { toast(er.message, true); } e.target.value = ''; };
      $('#cdImgX', bg).onclick = () => { draft.img = null; preview(); };
      const done = () => { ctx.closeModal(bg); ctx.renderHeader(); page(); };
      const statEdit = (v) => { const d = {}; if (v.pts != null && v.pts !== G.POINTS[v.t]) d.pts = v.pts; if (Math.abs(v.w - 1) > 1e-6) d.w = v.w; if (v.holo != null) d.holo = v.holo; if (!v.on) d.off = 1; return d; };
      const dup = $('#cdDup', bg); if (dup) dup.onclick = guard(async () => {
        const v = vals(), name = $('#cdName', bg).value.replace(/[\r\n\t]+/g, ' ').trim() + ' copy'; const stem = (v.cat + ':' + name).replace(/\|/g, ''); let cid = stem, n = 2; while (G.BYID[cid]) cid = stem + ' ' + n++;
        await net.updateConfig((cfg) => { cfg.added.push({ id: cid, name: name, cat: v.cat, tier: G.TIERS[v.t] }); const d = statEdit(v); if (Object.keys(d).length) cfg.edits[cid] = d; });
        toast('Duplicated as "' + name + '"'); done();
      });
      $('#cdSave', bg).onclick = guard(async () => {
        const name = $('#cdName', bg).value.replace(/[\r\n\t]+/g, ' ').trim(), v = vals(), cat = v.cat, tier = G.TIERS[v.t], stats = statEdit(v);
        if (!name) { toast('Give the card a name', true); return; }
        $('#cdSave', bg).disabled = true;
        try {
          let cid = id;
          if (!id) {
            const stem = (cat + ':' + name).replace(/\|/g, ''); cid = stem; let n = 2; while (G.BYID[cid]) cid = stem + ' ' + n++;
            await net.updateConfig((cfg) => { cfg.added.push({ id: cid, name: name, cat: cat, tier: tier }); if (Object.keys(stats).length) cfg.edits[cid] = stats; });
          } else if (c.custom) {
            await net.updateConfig((cfg) => { const a = cfg.added.find((x) => x.id === cid); if (a) { a.name = name; a.cat = cat; a.tier = tier; } if (Object.keys(stats).length) cfg.edits[cid] = stats; else delete cfg.edits[cid]; });
          } else {
            const base = G.BASE.find((b) => b.id === cid), d = Object.assign({}, stats);
            if (name !== base.name) d.name = name; if (cat !== base.cat) d.cat = cat; if (tier !== base.tier) d.tier = tier;
            await net.updateConfig((cfg) => { if (Object.keys(d).length) cfg.edits[cid] = d; else delete cfg.edits[cid]; });
          }
          if (draft.img !== undefined) await net.saveCardImage(cid, draft.img);
          toast(id ? 'Card saved' : 'Card added'); done();
        } catch (e) { $('#cdSave', bg).disabled = false; throw e; }
      });
      const rs = $('#cdReset', bg); if (rs) rs.onclick = guard(async () => {
        if (!window.confirm('Reset this card to its original name, set, rarity and stats? Its custom picture is kept.')) return;
        await net.updateConfig((cfg) => { delete cfg.edits[id]; }); toast('Card reset'); done();
      });
      const dl = $('#cdDel', bg); if (dl) dl.onclick = guard(async () => {
        if (!window.confirm('Delete this card? It disappears from packs and from everybody\'s collections.')) return;
        await net.updateConfig((cfg) => { cfg.added = cfg.added.filter((x) => x.id !== id); delete cfg.edits[id]; });
        await net.saveCardImage(id, null); toast('Card deleted'); done();
      });
    }

    // ---------- page ----------
    const secOpen = { overview: true, power: true, accounts: true, tiers: false, sets: false, scoring: false, cards: true };
    function visibleCards() {
      const q = view.q.trim().toLowerCase(), e = view.only;
      return G.CARDS.filter((c) => (!view.cat || c.cat === view.cat) && (!view.tier || c.tier === view.tier) && (!q || c.name.toLowerCase().includes(q))
        && (!e || (e === 'edited' && (c.edited || c.custom)) || (e === 'custom' && c.custom) || (e === 'off' && c.off)))
        .sort((a, b) => b.ti - a.ti || a.rank - b.rank);
    }
    function cardsHTML() {
      const list = visibleCards();
      if (!list.length) return '<div class="empty"><p>No cards match.</p></div>';
      if (view.mode === 'grid') return `<div class="card-grid small">${list.map((c) => `<div class="ad-cell ${sel.has(c.id) ? 'ticked' : ''}"><label class="ad-tick"><input type="checkbox" data-ad-tick="${esc(c.id)}" ${sel.has(c.id) ? 'checked' : ''} aria-label="Select ${esc(c.name)}"></label><button type="button" class="card-btn" data-ad-card="${esc(c.id)}" title="Edit ${esc(c.name)}">${ctx.cardHTML(c, {})}${c.custom ? '<span class="ad-tag">custom</span>' : c.off ? '<span class="ad-tag">off</span>' : c.edited ? '<span class="ad-tag">edited</span>' : ''}</button></div>`).join('')}</div>`;
      const cats = Object.keys(G.CATS);
      return `<div class="ad-tablewrap"><table class="ad-table"><thead><tr><th></th><th>Card</th><th>Set</th><th>Rarity</th><th>Pts</th><th>Weight ×</th><th>Chance / slot</th><th>Skibidi</th><th></th></tr></thead><tbody>${list.map((c) => {
        const r = chanceOf({ id: c.id, ti: c.ti, fx: c.fx, wm: c.wm, off: c.off, monster: c.monster });
        return `<tr class="${c.off ? 'is-off' : ''}"><td><input type="checkbox" data-ad-tick="${esc(c.id)}" ${sel.has(c.id) ? 'checked' : ''} aria-label="Select ${esc(c.name)}"></td>
          <td><b>${esc(c.name)}</b>${c.custom ? ' <small class="ad-tag inl">custom</small>' : c.edited ? ' <small class="ad-tag inl">edited</small>' : ''}${c.off ? ' <small class="ad-tag inl">off</small>' : ''}</td>
          <td><select data-inl="${esc(c.id)}|cat" aria-label="Set">${opts(cats, c.cat)}</select></td><td><select data-inl="${esc(c.id)}|tier" aria-label="Rarity">${opts(G.TIERS, c.tier)}</select></td>
          <td>${c.pts}${c.ptsOv != null ? '*' : ''}</td><td>${c.wm !== 1 ? c.wm : '1'}</td><td>${c.off ? '-' : pct(r.mine)}</td><td>${pct(c.holoOv != null ? c.holoOv : G.DIFFS.sigma.holo)}${c.holoOv != null ? '*' : ''}</td>
          <td><button class="btn sm" type="button" data-ad-card="${esc(c.id)}">Edit</button></td></tr>`; }).join('')}</tbody></table></div>`;
    }
    const det = (key, title, body, extra) => `<details class="panel ad-sec" data-sec="${key}" ${secOpen[key] ? 'open' : ''}><summary><h2>${title}</h2>${extra || ''}</summary>${body}</details>`;
    function page() {
      if (!unlocked()) { toast('Log in as admin in Settings first', true); location.hash = '#options'; return; }
      if (!net.enabled()) { $('#main').innerHTML = '<h1>Admin</h1><div class="panel"><p class="muted">The online connection is not set up, so there is nothing to manage.</p></div>'; return; }
      const dir = st().dir, blocked = st().cfg.blocked, accounts = st().accounts.slice().sort((a, b) => a.u.localeCompare(b.u)), cfg = st().cfg, now = Date.now();
      const byPid = {}; dir.forEach((p) => { byPid[p.id] = p; });
      const isBlocked = (id) => blocked.some((x) => x.id === id), acctOf = (id) => accounts.find((a) => a.pid === id);
      const orphans = dir.filter((p) => !acctOf(p.id));
      const row = (a) => {
        const p = byPid[a.pid], off = isBlocked(a.pid);
        const info = p ? `${ctx.fmt(p.score)} pts · ${p.unique} cards · ${p.opened} packs` : 'Nothing saved online yet';
        return `<div class="ad-row" data-u="${esc((a.u + ' ' + (p ? p.name : '')).toLowerCase())}">${p ? ctx.avatarHTML(34, p) : ''}<span class="ad-main"><b>${esc(a.u)}</b>${p && p.name !== a.u ? ` <small class="muted">(${esc(p.name)})</small>` : ''}<small class="muted">${info}${off ? ' · <b>removed from leaderboard</b>' : ''}</small></span>
          <span class="ad-btns"><button class="btn sm" data-ad-give="${esc(a.k)}" type="button">Give</button><button class="btn sm" data-ad-take="${esc(a.k)}" type="button">Take</button><button class="btn sm" data-ad-stats="${esc(a.k)}" type="button">Packs opened</button>
          ${off ? `<button class="btn sm" data-ad-restore="${esc(a.pid)}" type="button">Restore</button>` : `<button class="btn sm" data-ad-rm="${esc(a.pid)}" data-name="${esc(a.u)}" type="button">Remove</button>`}
          <button class="btn sm danger" data-ad-acc="${esc(a.k)}" type="button">Delete</button></span></div>`;
      };
      const tierRows = G.TIERS.map((t) => { const c = cfg.tiers.find((x) => x.name === t), i = G.TIERS.indexOf(t), d = G.TIER_DEF[t], ed = d && cfg.tierEdits[t]; return `<div class="ad-row"><span class="ad-main"><b style="color:${esc(G.TIER_COLOR[t])}">${esc(t)}</b> <small class="muted">${G.POINTS[i]} pts · weight ${G.BASE_WEIGHTS[i]} · ${G.CARDS.filter((x) => x.tier === t).length} cards${c ? ' · custom' : ''}${ed ? ' · edited' : ''}</small></span><button class="btn sm" data-ad-tier="${esc(t)}" type="button">Edit</button></div>`; }).join('');
      const setRows = Object.keys(G.CATS).map((k) => { const c = cfg.sets.find((x) => x.name === k), ed = cfg.setEdits[k]; return `<div class="ad-row"><span class="ad-main"><b style="color:hsl(${G.CATS[k].hue},70%,62%)">${esc(k)}</b> <small class="muted">${G.CARDS.filter((x) => x.cat === k).length} cards${c ? ' · custom' : ''}${ed ? ' · edited' : ''}</small></span><button class="btn sm" data-ad-set="${esc(k)}" type="button">Edit</button></div>`; }).join('');
      const evs = cfg.events.slice().sort((a, b) => b.end - a.end), live = evs.filter((e) => e.start <= now && e.end > now), soon = evs.filter((e) => e.start > now), past = evs.filter((e) => e.end <= now);
      const evRow = (e, tag) => `<div class="ad-row ${tag === 'past' ? 'dim' : ''}"><span class="ad-main"><b>${esc(e.name)}</b> <small class="muted">${esc(evText(e))}</small><small class="muted">${tag === 'live' ? '⚡ running · ' + fmtLeft(e.end - now) + ' left' : tag === 'soon' ? 'starts in ' + fmtLeft(e.start - now) + ' · lasts ' + fmtLeft(e.end - e.start) : 'ended'}</small></span><button class="btn sm ${tag === 'live' ? 'danger' : ''}" data-ad-evx="${esc(e.id)}" type="button">${tag === 'live' ? 'End now' : tag === 'soon' ? 'Cancel' : 'Remove'}</button></div>`;
      const totalPacks = dir.reduce((a, p) => a + (p.opened || 0), 0), totalCards = dir.reduce((a, p) => a + Object.keys(p.cards).reduce((x, k) => x + p.cards[k].n, 0), 0), top = dir.slice().sort((a, b) => b.score - a.score)[0];
      const hasUndo = (() => { try { return !!localStorage.getItem('ss-gacha-cfg-undo'); } catch (e) { return false; } })();
      $('#main').innerHTML = `<div class="row wrap between"><h1>Admin</h1><div class="row"><button class="btn" id="adSync" type="button">↻ Refresh</button><button class="btn" id="adOut" type="button">Log out of admin</button></div></div>
        ${det('overview', 'Overview', `<div class="facts ad-facts"><div><b>${accounts.length}</b><span>accounts</span></div><div><b>${dir.length}</b><span>players with a save</span></div><div><b>${ctx.fmt(totalPacks)}</b><span>packs opened</span></div><div><b>${ctx.fmt(totalCards)}</b><span>cards held</span></div><div><b>${top ? esc(top.name) : '-'}</b><span>top score ${top ? ctx.fmt(top.score) : ''}</span></div></div>
          <div class="row wrap" style="margin-top:12px"><button class="btn" id="adUndo" type="button" ${hasUndo ? '' : 'disabled'} title="Puts the game settings back how they were before your last change">↶ Undo last change</button><button class="btn" id="adExport" type="button">⬇ Back up settings</button><label class="btn" style="cursor:pointer">⬆ Restore backup<input id="adImport" type="file" accept="application/json,.json" hidden></label></div>
          <p class="muted small">A backup holds every card edit, custom card, rarity, set and power hour (not pictures or accounts).</p>`)}
        ${det('power', 'Power hours ⚡', `<p class="muted small">Make some cards more likely for a while. Everyone playing sees a banner while one is running.</p>
          ${live.concat(soon).length ? `<div class="ad-list">${live.map((e) => evRow(e, 'live')).join('')}${soon.map((e) => evRow(e, 'soon')).join('')}</div>` : '<p class="muted small">Nothing running.</p>'}
          ${past.length ? `<details class="ad-past"><summary class="muted small">Ended (${past.length})</summary><div class="ad-list">${past.map((e) => evRow(e, 'past')).join('')}</div></details>` : ''}`, '<button class="btn primary sm" id="adPower" type="button">＋ Start power hour</button>')}
        ${det('accounts', `Accounts <span class="muted small">${accounts.length}</span>`, `<p class="muted small">Every account is its own leaderboard entry.</p>
          <div class="row wrap"><label class="f grow"><input id="adAcctQ" type="search" placeholder="Find an account" autocomplete="off"></label><button class="btn" id="adGiveAll" type="button">🎁 Give to everyone</button></div>
          ${accounts.length ? `<div class="ad-list" id="adAcctList">${accounts.map(row).join('')}</div>` : '<div class="empty"><p>No accounts yet.</p></div>'}
          ${blocked.length ? `<div class="row wrap between" style="margin-top:16px"><h3>Removed from the leaderboard <span class="muted small">${blocked.length}</span></h3><button class="btn sm" id="adRestoreAll" type="button">Restore all</button></div><div class="ad-list">${blocked.map((x) => { const a = acctOf(x.id); return `<div class="ad-row"><span class="ad-main"><b>${esc(a ? a.u : x.name)}</b>${a ? '' : ' <small class="muted">(no account)</small>'}</span><button class="btn sm" data-ad-restore="${esc(x.id)}" type="button">Restore</button></div>`; }).join('')}</div>` : ''}
          ${orphans.length ? `<h3 style="margin:16px 0 8px">Old players with no account <span class="muted small">${orphans.length}</span></h3><p class="muted small">Hidden from the leaderboard until their owner creates an account on that device.</p><div class="ad-list">${orphans.map((p) => `<div class="ad-row">${ctx.avatarHTML(34, p)}<span class="ad-main"><b>${esc(p.name)}</b><small class="muted">${ctx.fmt(p.score)} pts · ${p.unique} cards</small></span>${isBlocked(p.id) ? '' : `<button class="btn sm danger" data-ad-rm="${esc(p.id)}" data-name="${esc(p.name)}" type="button">Remove</button>`}</div>`).join('')}</div>` : ''}`)}
        ${det('tiers', `Rarities <span class="muted small">${G.TIERS.length}</span>`, `<p class="muted small">Edit any rarity: colour, points and how often it drops. Built-in ones can be reset.</p><div class="ad-list">${tierRows}</div>`, '<button class="btn primary sm" id="adAddTier" type="button">＋ Add rarity</button>')}
        ${det('sets', `Sets <span class="muted small">${Object.keys(G.CATS).length}</span>`, `<div class="ad-list">${setRows}</div>`, '<button class="btn primary sm" id="adAddSet" type="button">＋ Add set</button>')}
        ${det('scoring', 'Scoring', `<p class="muted small">Every copy of a card counts towards a player's score. A skibidi copy is worth this many times a normal copy.</p><div class="row wrap"><label class="f">Skibidi points multiplier<input id="adHoloMult" type="number" min="1" max="20" step="0.25" value="${G.GS.holoMult}"></label><button class="btn primary" id="adSaveScoring" type="button">Save</button></div>`)}
        ${det('cards', `Cards <span class="muted small">${G.CARDS.length}</span>`, `<div class="filters"><label class="f">Search<input id="adQ" type="search" value="${esc(view.q)}" placeholder="Card name" autocomplete="off"></label>
          <label class="f">Set<select id="adCat"><option value="">All sets</option>${Object.keys(G.CATS).map((k) => `<option value="${esc(k)}" ${view.cat === k ? 'selected' : ''}>${esc(k)}</option>`).join('')}</select></label>
          <label class="f">Rarity<select id="adTier"><option value="">All rarities</option>${G.TIERS.map((k) => `<option value="${esc(k)}" ${view.tier === k ? 'selected' : ''}>${esc(k)}</option>`).join('')}</select></label>
          <label class="f">Show<select id="adOnly">${[['', 'Everything'], ['edited', 'Edited or custom'], ['custom', 'Custom only'], ['off', 'Not dropping']].map(([v, l]) => `<option value="${v}" ${view.only === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="f">View<select id="adMode"><option value="list" ${view.mode === 'list' ? 'selected' : ''}>List (edit inline)</option><option value="grid" ${view.mode === 'grid' ? 'selected' : ''}>Pictures</option></select></label></div>
          <div class="ad-bulk" id="adBulk"></div>
          <div id="adCards">${cardsHTML()}</div>`, '<button class="btn primary sm" id="adAdd" type="button">＋ Add card</button>')}`;
      const bulkBar = () => {
        const n = sel.size, vis = visibleCards();
        $('#adBulk').innerHTML = `<span class="muted small">${n} selected</span> <button class="btn sm" type="button" id="adSelAll">Select all ${vis.length} shown</button>${n ? `<button class="btn sm" type="button" id="adSelNone">Clear</button>
          <select id="adBulkTier" aria-label="Rarity"><option value="">Set rarity…</option>${opts(G.TIERS, '')}</select><select id="adBulkCat" aria-label="Set"><option value="">Move to set…</option>${opts(Object.keys(G.CATS), '')}</select>
          <label class="f inline">Weight ×<input id="adBulkW" type="number" min="0" max="1000" step="0.1" placeholder="1" style="width:70px"></label><button class="btn sm" type="button" id="adBulkWgo">Apply</button>
          <button class="btn sm" type="button" id="adBulkOff">Stop dropping</button><button class="btn sm" type="button" id="adBulkOn">Resume dropping</button><button class="btn sm danger" type="button" id="adBulkReset">Reset edits</button>` : ''}`;
        const g = (id) => $(id); if (g('#adSelAll')) g('#adSelAll').onclick = () => { vis.forEach((c) => sel.add(c.id)); redraw(); };
        if (g('#adSelNone')) { g('#adSelNone').onclick = () => { sel.clear(); redraw(); };
          g('#adBulkTier').onchange = (e) => { if (e.target.value) bulk('tier', e.target.value); }; g('#adBulkCat').onchange = (e) => { if (e.target.value) bulk('cat', e.target.value); };
          g('#adBulkWgo').onclick = () => { const v = +g('#adBulkW').value; if (g('#adBulkW').value === '' || !(v >= 0)) { toast('Enter a weight multiplier', true); return; } bulk('w', v); };
          g('#adBulkOff').onclick = () => bulk('off', true); g('#adBulkOn').onclick = () => bulk('off', false);
          g('#adBulkReset').onclick = () => { if (window.confirm('Reset ' + sel.size + ' card(s) to their original name, set, rarity and stats?')) bulk('reset'); }; }
      };
      const redraw = () => { $('#adCards').innerHTML = cardsHTML(); $$('#adCards .card').forEach(ctx.tilt); bulkBar(); };
      bulkBar();
      $('#adOut').onclick = () => { lock(); location.hash = '#options'; };
      $('#adSync').onclick = guard(async () => { await net.refresh(); toast('Refreshed'); page(); });
      $('#adAdd').onclick = (e) => { e.preventDefault(); cardEditor(null); };
      $('#adAddTier').onclick = (e) => { e.preventDefault(); tierEditor(null); }; $('#adAddSet').onclick = (e) => { e.preventDefault(); setEditor(null); };
      $('#adPower').onclick = (e) => { e.preventDefault(); powerModal(); };
      $('#adGiveAll').onclick = () => giveModal({ u: 'everyone', k: '*' });
      const ra = $('#adRestoreAll'); if (ra) ra.onclick = () => restoreAll();
      $('#adAcctQ').oninput = (e) => { const q = e.target.value.trim().toLowerCase(); $$('#adAcctList .ad-row').forEach((r) => { r.hidden = !!q && r.dataset.u.indexOf(q) < 0; }); };
      $('#adQ').oninput = (e) => { view.q = e.target.value; redraw(); };
      $('#adCat').onchange = (e) => { view.cat = e.target.value; redraw(); }; $('#adTier').onchange = (e) => { view.tier = e.target.value; redraw(); };
      $('#adOnly').onchange = (e) => { view.only = e.target.value; redraw(); }; $('#adMode').onchange = (e) => { view.mode = e.target.value; redraw(); };
      $('#adSaveScoring').onclick = guard(async () => { const v = Math.min(20, Math.max(1, +$('#adHoloMult').value || 2)); await net.updateConfig((c) => { c.settings.holoMult = v; }); toast('Saved. Every score updates straight away.'); page(); });
      $('#adUndo').onclick = guard(async () => {
        let prev = null; try { prev = JSON.parse(localStorage.getItem('ss-gacha-cfg-undo') || 'null'); } catch (e) { prev = null; } if (!prev) return;
        if (!window.confirm('Put the game settings back to how they were before your last change?')) return;
        await net.updateConfig((c) => { Object.keys(c).forEach((k) => { delete c[k]; }); Object.assign(c, prev); }); toast('Undone'); page();
      });
      $('#adExport').onclick = () => {
        const blob = new Blob([JSON.stringify(Object.assign({ t: 'config', v: 1 }, st().cfg), null, 1)], { type: 'application/json' }), a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = 'ss-gacha-settings-' + new Date().toISOString().slice(0, 10) + '.json'; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      };
      $('#adImport').onchange = guard(async (e) => {
        const f = e.target.files[0]; e.target.value = ''; if (!f) return;
        let j; try { j = JSON.parse(await f.text()); } catch (er) { throw new Error('That is not a valid backup file'); }
        if (!j || typeof j !== 'object') throw new Error('That is not a valid backup file');
        if (!window.confirm('Replace ALL current card edits, custom cards, rarities, sets and power hours with this backup? (Use "Undo last change" to go back.)')) return;
        await net.updateConfig((c) => { const keep = c.blocked; Object.keys(c).forEach((k) => { delete c[k]; }); Object.assign(c, j); c.blocked = keep; }); toast('Backup restored'); page();
      });
      $$('details.ad-sec').forEach((d) => d.addEventListener('toggle', () => { secOpen[d.dataset.sec] = d.open; }));
      $('#main').onchange = (e) => {
        const tk = e.target.closest('[data-ad-tick]'); if (tk) { if (tk.checked) sel.add(tk.dataset.adTick); else sel.delete(tk.dataset.adTick); const cell = tk.closest('.ad-cell'); if (cell) cell.classList.toggle('ticked', tk.checked); bulkBar(); return; }
        const inl = e.target.closest('[data-inl]'); if (inl) { const [id, what] = inl.dataset.inl.split('|'), keep = new Set(sel); sel.clear(); sel.add(id); Promise.resolve(bulk(what, inl.value)).then(() => { keep.forEach((x) => sel.add(x)); }); }
      };
      $('#main').onclick = (e) => {
        const t = e.target.closest('[data-ad-card],[data-ad-rm],[data-ad-restore],[data-ad-acc],[data-ad-give],[data-ad-take],[data-ad-stats],[data-ad-tier],[data-ad-set],[data-ad-evx]'); if (!t) return;
        if (t.dataset.adCard) cardEditor(t.dataset.adCard);
        else if (t.dataset.adRm) removePlayer(t.dataset.adRm, t.dataset.name || 'Player');
        else if (t.dataset.adRestore) restorePlayer(t.dataset.adRestore);
        else if (t.dataset.adGive) { const a = accounts.find((x) => x.k === t.dataset.adGive); if (a) giveModal(a); }
        else if (t.dataset.adTake) { const a = accounts.find((x) => x.k === t.dataset.adTake); if (a) takeModal(a); }
        else if (t.dataset.adStats) { const a = accounts.find((x) => x.k === t.dataset.adStats); if (a) statsModal(a); }
        else if (t.dataset.adTier) tierEditor(t.dataset.adTier);
        else if (t.dataset.adSet) setEditor(t.dataset.adSet);
        else if (t.dataset.adEvx) { const id = t.dataset.adEvx; guard(async () => { await net.updateConfig((c) => { c.events = c.events.filter((x) => x.id !== id); }); toast('Done'); page(); })(); }
        else if (t.dataset.adAcc) { const a = accounts.find((x) => x.k === t.dataset.adAcc); if (a) deleteAccount(a); }
      };
      if (Date.now() - st().last > 20000) net.cycle();
    }

    return { unlocked: unlocked, page: page, settingsHTML: settingsHTML, bindSettings: bindSettings };
  };
})();
