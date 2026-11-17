// Admin: login lives in Settings and opens the #admin page, where you can
//  - remove people from the leaderboard (and restore them),
//  - delete accounts,
//  - add new cards, edit any card (name, set, rarity) and upload card pictures.
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
    const removePlayer = guard(async (p) => {
      if (!window.confirm(`Remove ${p.name} from the leaderboard? They will not be able to appear on it again unless you restore them.`)) return;
      await net.closeIssue(p.num);
      await net.updateConfig((cfg) => { cfg.blocked = cfg.blocked.filter((x) => x.id !== p.id); cfg.blocked.push({ id: p.id, name: p.name }); });
      toast(p.name + ' removed'); page();
    });
    const restorePlayer = guard(async (id) => {
      await net.updateConfig((cfg) => { cfg.blocked = cfg.blocked.filter((x) => x.id !== id); });
      toast('Restored. They will reappear the next time they play online.'); page();
    });
    const deleteAccount = guard(async (a) => {
      if (!window.confirm(`Delete the account "${a.u}"? Their username becomes free and they are removed from the leaderboard. This cannot be undone.`)) return;
      await net.closeIssue(a.num);
      const p = st().dir.find((x) => x.id === a.pid);
      if (p) { await net.closeIssue(p.num); await net.updateConfig((cfg) => { cfg.blocked = cfg.blocked.filter((x) => x.id !== p.id); cfg.blocked.push({ id: p.id, name: p.name }); }); }
      else await net.refresh();
      toast('Account deleted'); page();
    });

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
      const players = st().dir.slice().sort((a, b) => b.score - a.score), blocked = st().cfg.blocked, accounts = st().accounts.slice().sort((a, b) => a.u.localeCompare(b.u));
      $('#main').innerHTML = `<div class="row wrap between"><h1>Admin</h1><div class="row"><button class="btn" id="adSync" type="button">↻ Refresh</button><button class="btn" id="adOut" type="button">Log out of admin</button></div></div>
        <section class="panel"><h2>Leaderboard <span class="muted small">${players.length} players</span></h2>
        ${players.length ? `<div class="ad-list">${players.map((p) => `<div class="ad-row">${ctx.avatarHTML(34, p)}<span class="ad-main"><b>${esc(p.name)}</b><small class="muted">${ctx.fmt(p.score)} pts · ${p.unique} cards · ID ${esc(p.id.slice(-6))}</small></span><button class="btn sm danger" data-ad-rm="${esc(p.id)}" type="button">Remove</button></div>`).join('')}</div>` : '<div class="empty"><p>Nobody is on the leaderboard.</p></div>'}
        ${blocked.length ? `<h3 style="margin:16px 0 8px">Removed players</h3><div class="ad-list">${blocked.map((x) => `<div class="ad-row"><span class="ad-main"><b>${esc(x.name)}</b><small class="muted">ID ${esc(x.id.slice(-6))}</small></span><button class="btn sm" data-ad-restore="${esc(x.id)}" type="button">Restore</button></div>`).join('')}</div>` : ''}</section>
        <section class="panel"><h2>Accounts <span class="muted small">${accounts.length}</span></h2>
        ${accounts.length ? `<div class="ad-list">${accounts.map((a) => `<div class="ad-row"><span class="ad-main"><b>${esc(a.u)}</b><small class="muted">Created ${a.created ? new Date(a.created).toLocaleDateString('en-GB') : 'unknown'}</small></span><button class="btn sm danger" data-ad-acc="${esc(a.k)}" type="button">Delete</button></div>`).join('')}</div>` : '<div class="empty"><p>No accounts yet.</p></div>'}</section>
        <section class="panel"><div class="row wrap between"><h2>Cards <span class="muted small">${G.CARDS.length}</span></h2><button class="btn primary" id="adAdd" type="button">＋ Add card</button></div>
        <div class="filters"><label class="f">Search<input id="adQ" type="search" value="${esc(view.q)}" placeholder="Card name" autocomplete="off"></label>
        <label class="f">Set<select id="adCat"><option value="">All sets</option>${Object.keys(G.CATS).map((k) => `<option value="${k}" ${view.cat === k ? 'selected' : ''}>${k}</option>`).join('')}</select></label></div>
        <p class="muted small">Click a card to edit it or change its picture.</p><div id="adCards">${cardsHTML()}</div></section>`;
      $('#adOut').onclick = () => { lock(); location.hash = '#options'; };
      $('#adSync').onclick = guard(async () => { await net.refresh(); toast('Refreshed'); page(); });
      $('#adAdd').onclick = () => cardEditor(null);
      const redraw = () => { $('#adCards').innerHTML = cardsHTML(); $$('#adCards .card').forEach(ctx.tilt); };
      $('#adQ').oninput = (e) => { view.q = e.target.value; redraw(); };
      $('#adCat').onchange = (e) => { view.cat = e.target.value; redraw(); };
      $$('#adCards .card').forEach(ctx.tilt);
      $('#main').onclick = (e) => {
        const t = e.target.closest('[data-ad-card],[data-ad-rm],[data-ad-restore],[data-ad-acc]'); if (!t) return;
        if (t.dataset.adCard) cardEditor(t.dataset.adCard);
        else if (t.dataset.adRm) { const p = st().dir.find((x) => x.id === t.dataset.adRm); if (p) removePlayer(p); }
        else if (t.dataset.adRestore) restorePlayer(t.dataset.adRestore);
        else if (t.dataset.adAcc) { const a = st().accounts.find((x) => x.k === t.dataset.adAcc); if (a) deleteAccount(a); }
      };
      if (Date.now() - st().last > 20000) net.cycle();
    }

    return { unlocked: unlocked, page: page, settingsHTML: settingsHTML, bindSettings: bindSettings };
  };
})();
