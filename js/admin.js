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
    const view = { q: '', cat: '', busy: false };
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

    // ---------- custom rarities and sets ----------
    const NAME_RE = /^[A-Za-z0-9 ]+$/;
    function tierEditor(name) {
      const cur = name ? st().cfg.tiers.find((t) => t.name === name) : null, isNew = !cur;
      const bg = ctx.modal(`<h2>${isNew ? 'Add a rarity' : 'Edit ' + esc(name)}</h2>
        <div class="row wrap"><label class="f">Name<input id="rtName" maxlength="14" value="${esc(cur ? cur.name : '')}" ${cur ? 'disabled' : ''} autocomplete="off"></label>
        <label class="f">Colour<input id="rtColor" type="color" value="${cur ? cur.color : '#00e5c0'}"></label></div>
        <div class="row wrap"><label class="f">Points per card<input id="rtPts" type="number" min="1" max="100000" value="${cur ? cur.pts : 10}"></label>
        <label class="f">Drop weight<input id="rtW" type="number" min="0.01" max="1000" step="0.01" value="${cur ? cur.weight : 1}"></label></div>
        <label class="f">Sits just above<select id="rtAfter">${opts(G.TIERS.filter((t) => t !== name), cur ? cur.after : G.TIERS[G.TIERS.length - 1])}</select></label>
        <p class="muted small">Drop weight is relative: Common is 50, Rare 14, Epic 5, Legendary 2, Mythic 0.8, Sigma 0.08 (Rare and above are also cut by the game's luck setting). A rarity with no cards in it never drops. Where it sits decides its order and how dramatic its reveal is.</p>
        <div class="row wrap" style="margin-top:14px"><button class="btn primary" id="rtSave" type="button">${isNew ? 'Add rarity' : 'Save changes'}</button>${cur ? '<button class="btn danger" id="rtDel" type="button">Delete rarity</button>' : ''}<button class="btn" data-act="close-modal" type="button">Cancel</button></div>`);
      $('#rtSave', bg).onclick = guard(async () => {
        const n = $('#rtName', bg).value.replace(/\s+/g, ' ').trim();
        if (!n || !NAME_RE.test(n)) { toast('Use letters, numbers and spaces for the name', true); return; }
        if (isNew && G.TIERS.some((t) => t.toLowerCase() === n.toLowerCase())) { toast('A rarity with that name already exists', true); return; }
        const e = { name: n, color: $('#rtColor', bg).value, pts: Math.round(+$('#rtPts', bg).value) || 1, weight: +$('#rtW', bg).value || 1, after: $('#rtAfter', bg).value };
        await net.updateConfig((cfg) => { const i = cfg.tiers.findIndex((t) => t.name === n); if (i >= 0) cfg.tiers[i] = e; else cfg.tiers.push(e); });
        ctx.closeModal(bg); toast('Rarity saved'); page();
      });
      const dl = $('#rtDel', bg); if (dl) dl.onclick = guard(async () => {
        const used = G.CARDS.filter((c) => c.tier === name).length;
        if (used) { toast(`${used} card${used === 1 ? ' uses' : 's use'} this rarity. Move them to another rarity first.`, true); return; }
        if (G.TIERS.some((t) => (st().cfg.tiers.find((x) => x.name === t) || {}).after === name)) { toast('Another custom rarity sits above this one. Move or delete that one first.', true); return; }
        await net.updateConfig((cfg) => { cfg.tiers = cfg.tiers.filter((t) => t.name !== name); }); ctx.closeModal(bg); toast('Rarity deleted'); page();
      });
    }
    function setEditor(name) {
      const cur = name ? st().cfg.sets.find((t) => t.name === name) : null, isNew = !cur;
      const bg = ctx.modal(`<h2>${isNew ? 'Add a set' : 'Edit ' + esc(name)}</h2>
        <div class="row wrap"><label class="f">Name<input id="stName" maxlength="12" value="${esc(cur ? cur.name : '')}" ${cur ? 'disabled' : ''} autocomplete="off"></label>
        <label class="f">Colour (hue)<input id="stHue" type="range" min="0" max="359" value="${cur ? cur.hue : 200}"></label></div>
        <label class="f">Description<input id="stBlurb" maxlength="90" value="${esc(cur ? cur.blurb : '')}" autocomplete="off"></label>
        <p class="muted small">After adding a set, use "Add card" and pick it in the Set list, or edit an existing card to move it here.</p>
        <div class="row wrap" style="margin-top:14px"><button class="btn primary" id="stSave" type="button">${isNew ? 'Add set' : 'Save changes'}</button>${cur ? '<button class="btn danger" id="stDel" type="button">Delete set</button>' : ''}<button class="btn" data-act="close-modal" type="button">Cancel</button></div>`);
      $('#stSave', bg).onclick = guard(async () => {
        const n = $('#stName', bg).value.replace(/\s+/g, ' ').trim();
        if (!n || !NAME_RE.test(n)) { toast('Use letters, numbers and spaces for the name', true); return; }
        if (isNew && Object.keys(G.CATS).some((k) => k.toLowerCase() === n.toLowerCase())) { toast('A set with that name already exists', true); return; }
        const e = { name: n, hue: +$('#stHue', bg).value, blurb: $('#stBlurb', bg).value.trim() };
        await net.updateConfig((cfg) => { cfg.sets = cfg.sets.filter((t) => t.name !== n); cfg.sets.push(e); });
        ctx.closeModal(bg); toast('Set saved'); page();
      });
      const dl = $('#stDel', bg); if (dl) dl.onclick = guard(async () => {
        const used = G.CARDS.filter((c) => c.cat === name).length;
        if (used) { toast(`${used} card${used === 1 ? ' is' : 's are'} in this set. Move or delete them first.`, true); return; }
        await net.updateConfig((cfg) => { cfg.sets = cfg.sets.filter((t) => t.name !== name); }); ctx.closeModal(bg); toast('Set deleted'); page();
      });
    }

    // ---------- card editor ----------
    function cardForm(c) {
      const isNew = !c, cats = Object.keys(G.CATS);
      return `<h2>${isNew ? 'Add a card' : 'Edit card'}</h2>
        <div class="ad-edit"><div class="ad-prev" id="adPrev"></div><div class="ad-fields">
        <label class="f">Name<input id="cdName" maxlength="60" value="${esc(c ? c.name : '')}" autocomplete="off"></label>
        <div class="row wrap"><label class="f">Set<select id="cdCat">${opts(cats, c ? c.cat : 'SS')}</select></label>
        <label class="f">Rarity<select id="cdTier">${opts(G.TIERS, c ? c.tier : 'Common')}</select></label></div>
        <div class="row wrap"><label class="btn" style="cursor:pointer">Upload picture<input id="cdFile" type="file" accept="image/*" hidden></label><button class="btn" id="cdImgX" type="button">Remove custom picture</button></div>
        <p class="muted small">Pictures are cropped to the card art shape and shrunk. Rarity decides the points and how often it drops.</p></div></div>
        <div class="row wrap" style="margin-top:14px"><button class="btn primary" id="cdSave" type="button">${isNew ? 'Add card' : 'Save changes'}</button>
        ${c && !c.custom ? '<button class="btn" id="cdReset" type="button">Reset to original</button>' : ''}${c && c.custom ? '<button class="btn danger" id="cdDel" type="button">Delete card</button>' : ''}
        <button class="btn" data-act="close-modal" type="button">Cancel</button></div>`;
    }
    function cardEditor(id) {
      const c = id ? G.BYID[id] : null; if (id && !c) return;
      const draft = { img: undefined }; // undefined = unchanged, null = remove, string = new picture
      const bg = ctx.modal(cardForm(c), 'wide');
      const preview = () => {
        const base = c || { id: 'NEW:preview', name: 'x', cat: 'SS', tier: 'Common', ti: 0, pts: 1, rank: 999, monster: false, img: null };
        const t = G.TIERS.indexOf($('#cdTier', bg).value), cat = $('#cdCat', bg).value;
        const img = draft.img === undefined ? base.img : draft.img;
        const tmp = Object.assign({}, base, { name: $('#cdName', bg).value.trim() || 'Card name', cat: cat, tier: G.TIERS[t], ti: t, pts: G.POINTS[t], monster: !!G.CATS[cat].monster, img: img });
        $('#adPrev', bg).innerHTML = ctx.cardHTML(tmp, { size: 190 });
      };
      preview();
      ['#cdName', '#cdCat', '#cdTier'].forEach((s) => { $(s, bg).oninput = preview; $(s, bg).onchange = preview; });
      $('#cdFile', bg).onchange = async (e) => { const f = e.target.files[0]; if (!f) return; try { draft.img = await readCardImage(f); preview(); } catch (er) { toast(er.message, true); } e.target.value = ''; };
      $('#cdImgX', bg).onclick = () => { draft.img = null; preview(); };
      const done = () => { ctx.closeModal(bg); ctx.renderHeader(); page(); };
      $('#cdSave', bg).onclick = guard(async () => {
        const name = $('#cdName', bg).value.replace(/[\r\n\t]+/g, ' ').trim(), cat = $('#cdCat', bg).value, tier = $('#cdTier', bg).value;
        if (!name) { toast('Give the card a name', true); return; }
        $('#cdSave', bg).disabled = true;
        try {
          let cid = id;
          if (!id) {
            const stem = (cat + ':' + name).replace(/\|/g, ''); cid = stem; let n = 2; while (G.BYID[cid]) cid = stem + ' ' + n++;
            await net.updateConfig((cfg) => { cfg.added.push({ id: cid, name: name, cat: cat, tier: tier }); });
          } else if (c.custom) {
            await net.updateConfig((cfg) => { const a = cfg.added.find((x) => x.id === cid); if (a) { a.name = name; a.cat = cat; a.tier = tier; } delete cfg.edits[cid]; });
          } else {
            const base = G.BASE.find((b) => b.id === cid), d = {};
            if (name !== base.name) d.name = name; if (cat !== base.cat) d.cat = cat; if (tier !== base.tier) d.tier = tier;
            await net.updateConfig((cfg) => { if (Object.keys(d).length) cfg.edits[cid] = d; else delete cfg.edits[cid]; });
          }
          if (draft.img !== undefined) await net.saveCardImage(cid, draft.img);
          toast(id ? 'Card saved' : 'Card added'); done();
        } catch (e) { $('#cdSave', bg).disabled = false; throw e; }
      });
      const rs = $('#cdReset', bg); if (rs) rs.onclick = guard(async () => {
        if (!window.confirm('Reset this card to its original name, set and rarity? Its custom picture is kept.')) return;
        await net.updateConfig((cfg) => { delete cfg.edits[id]; }); toast('Card reset'); done();
      });
      const dl = $('#cdDel', bg); if (dl) dl.onclick = guard(async () => {
        if (!window.confirm('Delete this card? It disappears from packs and from everybody\'s collections.')) return;
        await net.updateConfig((cfg) => { cfg.added = cfg.added.filter((x) => x.id !== id); delete cfg.edits[id]; });
        await net.saveCardImage(id, null); toast('Card deleted'); done();
      });
    }

    // ---------- page ----------
    function cardsHTML() {
      const q = view.q.trim().toLowerCase();
      const list = G.CARDS.filter((c) => (!view.cat || c.cat === view.cat) && (!q || c.name.toLowerCase().includes(q)))
        .sort((a, b) => b.ti - a.ti || a.rank - b.rank);
      return list.length ? `<div class="card-grid small">${list.map((c) => `<button type="button" class="card-btn" data-ad-card="${esc(c.id)}" title="Edit ${esc(c.name)}">${ctx.cardHTML(c, {})}${c.custom ? '<span class="ad-tag">custom</span>' : ''}</button>`).join('')}</div>` : '<div class="empty"><p>No cards match.</p></div>';
    }
    function page() {
      if (!unlocked()) { toast('Log in as admin in Settings first', true); location.hash = '#options'; return; }
      if (!net.enabled()) { $('#main').innerHTML = '<h1>Admin</h1><div class="panel"><p class="muted">The online connection is not set up, so there is nothing to manage.</p></div>'; return; }
      const dir = st().dir, blocked = st().cfg.blocked, accounts = st().accounts.slice().sort((a, b) => a.u.localeCompare(b.u)), cfg = st().cfg;
      const byPid = {}; dir.forEach((p) => { byPid[p.id] = p; });
      const isBlocked = (id) => blocked.some((x) => x.id === id), acctOf = (id) => accounts.find((a) => a.pid === id);
      const orphans = dir.filter((p) => !acctOf(p.id));
      const row = (a) => {
        const p = byPid[a.pid], off = isBlocked(a.pid);
        const info = p ? `${ctx.fmt(p.score)} pts · ${p.unique} cards · ${p.opened} packs` : 'Nothing saved online yet';
        return `<div class="ad-row">${p ? ctx.avatarHTML(34, p) : ''}<span class="ad-main"><b>${esc(a.u)}</b>${p && p.name !== a.u ? ` <small class="muted">(${esc(p.name)})</small>` : ''}<small class="muted">${info}${off ? ' · <b>removed from leaderboard</b>' : ''}</small></span>
          <button class="btn sm" data-ad-give="${esc(a.k)}" type="button">Give</button>
          ${off ? `<button class="btn sm" data-ad-restore="${esc(a.pid)}" type="button">Restore</button>` : `<button class="btn sm" data-ad-rm="${esc(a.pid)}" data-name="${esc(a.u)}" type="button">Remove</button>`}
          <button class="btn sm danger" data-ad-acc="${esc(a.k)}" type="button">Delete</button></div>`;
      };
      const tierRows = G.TIERS.map((t) => { const c = cfg.tiers.find((x) => x.name === t), i = G.TIERS.indexOf(t); return `<div class="ad-row"><span class="ad-main"><b style="color:${esc(G.TIER_COLOR[t])}">${esc(t)}</b> <small class="muted">${G.POINTS[i]} pts · weight ${G.BASE_WEIGHTS[i]} · ${G.CARDS.filter((x) => x.tier === t).length} cards${c ? ' · custom' : ''}</small></span>${c ? `<button class="btn sm" data-ad-tier="${esc(t)}" type="button">Edit</button>` : ''}</div>`; }).join('');
      const setRows = Object.keys(G.CATS).map((k) => { const c = cfg.sets.find((x) => x.name === k); return `<div class="ad-row"><span class="ad-main"><b style="color:hsl(${G.CATS[k].hue},70%,62%)">${esc(k)}</b> <small class="muted">${G.CARDS.filter((x) => x.cat === k).length} cards${c ? ' · custom' : ''}</small></span>${c ? `<button class="btn sm" data-ad-set="${esc(k)}" type="button">Edit</button>` : ''}</div>`; }).join('');
      $('#main').innerHTML = `<div class="row wrap between"><h1>Admin</h1><div class="row"><button class="btn" id="adSync" type="button">↻ Refresh</button><button class="btn" id="adOut" type="button">Log out of admin</button></div></div>
        <section class="panel"><h2>Accounts <span class="muted small">${accounts.length}</span></h2>
        <p class="muted small">Every account is its own leaderboard entry. Give cards or packs, remove it from the leaderboard, or delete it.</p>
        ${accounts.length ? `<div class="ad-list">${accounts.map(row).join('')}</div>` : '<div class="empty"><p>No accounts yet.</p></div>'}
        ${blocked.length ? `<div class="row wrap between" style="margin-top:16px"><h3>Removed from the leaderboard <span class="muted small">${blocked.length}</span></h3><button class="btn sm" id="adRestoreAll" type="button">Restore all</button></div><div class="ad-list">${blocked.map((x) => { const a = acctOf(x.id); return `<div class="ad-row"><span class="ad-main"><b>${esc(a ? a.u : x.name)}</b>${a ? '' : ' <small class="muted">(no account)</small>'}</span><button class="btn sm" data-ad-restore="${esc(x.id)}" type="button">Restore</button></div>`; }).join('')}</div>` : ''}
        ${orphans.length ? `<h3 style="margin:16px 0 8px">Old players with no account <span class="muted small">${orphans.length}</span></h3><p class="muted small">These are hidden from the leaderboard until their owner creates an account on that device.</p><div class="ad-list">${orphans.map((p) => `<div class="ad-row">${ctx.avatarHTML(34, p)}<span class="ad-main"><b>${esc(p.name)}</b><small class="muted">${ctx.fmt(p.score)} pts · ${p.unique} cards</small></span>${isBlocked(p.id) ? '' : `<button class="btn sm danger" data-ad-rm="${esc(p.id)}" data-name="${esc(p.name)}" type="button">Remove</button>`}</div>`).join('')}</div>` : ''}</section>
        <section class="panel"><div class="row wrap between"><h2>Rarities <span class="muted small">${G.TIERS.length}</span></h2><button class="btn primary" id="adAddTier" type="button">＋ Add rarity</button></div><div class="ad-list">${tierRows}</div></section>
        <section class="panel"><div class="row wrap between"><h2>Sets <span class="muted small">${Object.keys(G.CATS).length}</span></h2><button class="btn primary" id="adAddSet" type="button">＋ Add set</button></div><div class="ad-list">${setRows}</div></section>
        <section class="panel"><div class="row wrap between"><h2>Cards <span class="muted small">${G.CARDS.length}</span></h2><button class="btn primary" id="adAdd" type="button">＋ Add card</button></div>
        <div class="filters"><label class="f">Search<input id="adQ" type="search" value="${esc(view.q)}" placeholder="Card name" autocomplete="off"></label>
        <label class="f">Set<select id="adCat"><option value="">All sets</option>${Object.keys(G.CATS).map((k) => `<option value="${esc(k)}" ${view.cat === k ? 'selected' : ''}>${esc(k)}</option>`).join('')}</select></label></div>
        <p class="muted small">Click a card to edit it or change its picture.</p><div id="adCards">${cardsHTML()}</div></section>`;
      $('#adOut').onclick = () => { lock(); location.hash = '#options'; };
      $('#adSync').onclick = guard(async () => { await net.refresh(); toast('Refreshed'); page(); });
      $('#adAdd').onclick = () => cardEditor(null);
      $('#adAddTier').onclick = () => tierEditor(null); $('#adAddSet').onclick = () => setEditor(null);
      const ra = $('#adRestoreAll'); if (ra) ra.onclick = () => restoreAll();
      const redraw = () => { $('#adCards').innerHTML = cardsHTML(); $$('#adCards .card').forEach(ctx.tilt); };
      $('#adQ').oninput = (e) => { view.q = e.target.value; redraw(); };
      $('#adCat').onchange = (e) => { view.cat = e.target.value; redraw(); };
      $$('#adCards .card').forEach(ctx.tilt);
      $('#main').onclick = (e) => {
        const t = e.target.closest('[data-ad-card],[data-ad-rm],[data-ad-restore],[data-ad-acc],[data-ad-give],[data-ad-tier],[data-ad-set]'); if (!t) return;
        if (t.dataset.adCard) cardEditor(t.dataset.adCard);
        else if (t.dataset.adRm) removePlayer(t.dataset.adRm, t.dataset.name || 'Player');
        else if (t.dataset.adRestore) restorePlayer(t.dataset.adRestore);
        else if (t.dataset.adGive) { const a = accounts.find((x) => x.k === t.dataset.adGive); if (a) giveModal(a); }
        else if (t.dataset.adTier) tierEditor(t.dataset.adTier);
        else if (t.dataset.adSet) setEditor(t.dataset.adSet);
        else if (t.dataset.adAcc) { const a = accounts.find((x) => x.k === t.dataset.adAcc); if (a) deleteAccount(a); }
      };
      if (Date.now() - st().last > 20000) net.cycle();
    }

    return { unlocked: unlocked, page: page, settingsHTML: settingsHTML, bindSettings: bindSettings };
  };
})();
