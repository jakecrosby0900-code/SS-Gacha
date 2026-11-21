// Social layer (v29): notifications, friends + messages, and comments on the trade board.
//
// Like the rest of the game this runs on GitHub Issues, with no server:
//  - A friendship is ONE issue titled "friend:<id> A → B" whose JSON body holds who asked whom and a status (pending / accepted / declined).
//  - Messages between friends and comments on board posts are GitHub issue COMMENTS on those issues. Comments are appended one at a time,
//    so two people writing at once never overwrite each other. The issue list already tells us how many comments each issue has,
//    which is how "unread" is worked out without extra requests.
//  - Notifications are worked out on this device after every sync (new trade offers, answers to your offers, friend requests, messages,
//    comments on your posts, new badges, power hours, admin gifts) and stored in your save, so they follow you between devices.
(function () {
  'use strict';
  window.SSGSocial = function (ctx) {
    const G = ctx.G, BYID = G.BYID, esc = ctx.esc, $ = ctx.$, $$ = ctx.$$, net = ctx.net, toast = ctx.toast;
    const S = () => ctx.S();
    const ICON = { trade: '⇄', counter: '↩️', 'trade-ok': '✅', 'trade-no': '❌', friend: '🤝', 'friend-ok': '🎉', 'friend-no': '🙁', msg: '💬', comment: '🗨️', badge: '🏅', gift: '🎁', event: '⚡', info: '🔔' };
    const ONLINE_MS = 150000, MSG_MAX = 500, CM_MAX = 300;
    let dirty = false, busy = false, firstScan = true, chat = null;
    const me = () => S().profile.id;
    const sc = () => S().social;
    const repo = () => net.conf().repo;
    const gh = (m, path, body) => net.gh(m, `/repos/${repo()}${path}`, body);
    const idv = (p) => (p && p.id) || '';
    const person = (id, name) => net.state.dir.find((p) => p.id === id) || { id: id, name: name || 'Player', hue: 28, pfp: null, seen: 0 };
    const online = (p) => !!p && p.id !== me() && Date.now() - (p.seen || 0) < ONLINE_MS;
    const clean = (v, n) => String(v == null ? '' : v).replace(/[\r\t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, n);
    const hhmm = (t) => { const d = new Date(t), now = new Date(); return (d.toDateString() === now.toDateString() ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ' ') + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); };

    // ---------------------------------------------------------------- notifications
    // id makes a notification unique (so the same event is never announced twice, even after you delete it). upsert = refresh the text of an existing one (message counts).
    function notify(id, type, text, href, upsert) {
      const st = sc(); if (!st) return;
      const ex = st.notes.find((n) => n.id === id);
      if (ex) { if (upsert && ex.text !== text) { ex.text = text; ex.at = Date.now(); ex.read = 0; if (href) ex.href = href; dirty = true; ctx.save(true); net.paint(); if (!firstScan && !document.hidden && !ctx.busy()) toast('🔔 ' + text); } return; }
      if (st.nseen[id]) return;
      st.nseen[id] = Date.now(); const ks = Object.keys(st.nseen); if (ks.length > 500) ks.sort((a, b) => st.nseen[a] - st.nseen[b]).slice(0, ks.length - 500).forEach((k) => delete st.nseen[k]);
      st.notes.unshift({ id: id, at: Date.now(), type: type, text: String(text).slice(0, 200), href: href || '', read: 0 }); st.notes.length = Math.min(st.notes.length, 60);
      dirty = true; ctx.save(true); net.paint();
      if (!firstScan && !document.hidden && !ctx.busy()) toast('🔔 ' + text);
    }
    const unread = () => (sc() ? sc().notes.filter((n) => !n.read).length : 0);
    const markRead = (id) => { const n = sc().notes.find((x) => x.id === id); if (n && !n.read) { n.read = 1; dirty = true; ctx.save(true); net.paint(); } };
    const markAll = () => { sc().notes.forEach((n) => { n.read = 1; }); dirty = true; ctx.save(true); net.paint(); };

    // ---------------------------------------------------------------- friends (data)
    const rel = (pid) => net.state.friends.find((f) => (f.from.id === me() && f.to.id === pid) || (f.from.id === pid && f.to.id === me()));
    const isMine = (f) => f.from.id === me() || f.to.id === me();
    const other = (f) => (f.from.id === me() ? f.to : f.from);
    const friendsList = () => net.state.friends.filter((f) => f.status === 'accepted' && isMine(f));
    const requestsIn = () => net.state.friends.filter((f) => f.status === 'pending' && f.to.id === me());
    const requestsOut = () => net.state.friends.filter((f) => f.status === 'pending' && f.from.id === me());
    const fkey = (f) => 'f' + f.fid;
    const unreadMsgs = () => friendsList().reduce((a, f) => a + Math.max(0, f.ccount - (sc().seen[fkey(f)] || 0)), 0);
    const friendAlerts = () => requestsIn().length + friendsList().filter((f) => f.ccount > (sc().seen[fkey(f)] || 0)).length;
    const pairId = (a, b) => 'f' + ('00000000' + (G.hash([a, b].sort().join('|')) >>> 0).toString(36)).slice(-8);
    const unreadFor = (f) => Math.max(0, f.ccount - (sc().seen[fkey(f)] || 0));

    async function redraw() { try { await net.refresh(); } catch (e) { /* the next sync will retry */ } scan(); ctx.route(true); net.paint(); }
    function act(fn) { return async function () { if (busy) return; busy = true; try { await fn.apply(null, arguments); } catch (e) { toast(e.message || 'Something went wrong', true); } finally { busy = false; } }; }

    const sendRequest = act(async (pid) => {
      if (!net.enabled()) throw new Error('Friends need the online connection');
      const to = net.state.dir.find((p) => p.id === pid); if (!to || pid === me()) throw new Error('Player not found');
      const ex = rel(pid);
      if (ex && ex.status === 'accepted') { toast('You are already friends'); return; }
      if (ex && ex.status === 'pending') { if (ex.to.id === me()) { await accept(ex.fid, true); return; } toast('You already sent them a request'); return; }
      if (ex && ex.status === 'declined') { try { await net.closeIssue(ex.num); } catch (e) { /* ignore */ } }
      const fid = pairId(me(), pid), s = S();
      await net.createIssue(`friend:${fid} ${s.profile.name} → ${to.name}`.replace(/[\r\n]+/g, ' '), { t: 'friend', id: fid, from: { id: s.profile.id, name: s.profile.name }, to: { id: to.id, name: to.name }, status: 'pending', at: Date.now() });
      toast('Friend request sent to ' + to.name); await redraw();
    });
    async function setStatus(f, status) {
      const cur = await gh('GET', '/issues/' + f.num); let b; try { b = JSON.parse(cur.body); } catch (e) { throw new Error('That request is no longer valid'); }
      if (!b || b.t !== 'friend') throw new Error('That request is no longer valid');
      b.status = status; await gh('PATCH', '/issues/' + f.num, { body: JSON.stringify(b) });
    }
    const accept = act(async (fid, already) => {
      const f = net.state.friends.find((x) => x.fid === fid); if (!f) throw new Error('Request not found');
      await setStatus(f, 'accepted'); sc().seen['f' + fid] = 0; ctx.save(true);
      toast('You and ' + other(f).name + ' are friends now'); await redraw();
    });
    const decline = act(async (fid) => { const f = net.state.friends.find((x) => x.fid === fid); if (!f) return; await setStatus(f, 'declined'); toast('Request declined'); await redraw(); });
    const closeFriend = act(async (fid, msg) => {
      const f = net.state.friends.find((x) => x.fid === fid); if (!f) return;
      if (msg && !window.confirm(msg.replace('{n}', other(f).name))) return;
      await net.closeIssue(f.num); toast(f.status === 'accepted' ? 'Removed from your friends' : 'Request cancelled'); await redraw();
    });
    const answered = {};

    // ---------------------------------------------------------------- scanning (after every sync)
    function scan() {
      if (!ctx.loggedIn() || !ctx.allowed() || !sc() || net.state.status === 'err' || !net.state.loaded) return;
      const st = sc(), id = me();
      // trade offers sent to you (answers to YOUR offers are announced when they settle, see net.js)
      net.incoming().forEach((t) => notify('tr-in:' + t.id, t.re ? 'counter' : 'trade', t.re ? `${t.from.name} sent a counter-offer to your trade` : `${t.from.name} sent you a trade request`, '#trades'));
      // friends
      net.state.friends.forEach((f) => {
        if (!isMine(f)) return; const o = other(f), fromMe = f.from.id === id;
        if (f.status === 'pending' && !fromMe) notify('fr-in:' + f.fid + ':' + f.at, 'friend', `${o.name} sent you a friend request`, '#friends');
        else if (f.status === 'accepted' && fromMe) { notify('fr-ok:' + f.fid + ':' + f.at, 'friend-ok', `${o.name} accepted your friend request`, '#friends'); if (st.seen[fkey(f)] == null) st.seen[fkey(f)] = 0; }
        else if (f.status === 'declined' && fromMe) { notify('fr-no:' + f.fid + ':' + f.at, 'friend-no', `${o.name} declined your friend request`, '#friends'); if (!answered[f.num]) { answered[f.num] = 1; net.closeIssue(f.num).catch(() => {}); } }
        if (f.status === 'accepted') {
          const k = fkey(f), open = chat && chat.fid === f.fid && location.hash === '#chat-' + o.id;
          if (st.seen[k] == null) st.seen[k] = 0;
          if (open) { if (f.ccount > st.seen[k]) st.seen[k] = f.ccount; markRead('msg:' + f.fid); }
          else if (f.ccount > st.seen[k]) { const n = f.ccount - st.seen[k]; notify('msg:' + f.fid, 'msg', n > 1 ? `${o.name} sent you ${n} new messages` : `${o.name} sent you a message`, '#chat-' + o.id, true); }
        }
      });
      // comments on your board posts
      net.state.board.filter((x) => x.pid === id).forEach((x) => {
        const k = 'b' + x.num; if (st.seen[k] == null) st.seen[k] = 0;
        if (x.ccount > st.seen[k]) { const n = x.ccount - st.seen[k]; notify('cm:' + x.num, 'comment', n > 1 ? `${n} new comments on your board post` : 'New comment on your board post', '#board', true); }
      });
      // badges
      try {
        const s = S(), me0 = net.state.dir.find((p) => p.id === id), rank = me0 ? net.rankOf(me0) : 0, list = G.badgesOf(s.cards, s.stats.opened, rank), names = list.map((b) => b.name);
        if (st.badges == null) st.badges = names;
        else { list.forEach((b) => { if (st.badges.indexOf(b.name) < 0 && b.name.charAt(0) !== '#') notify('badge:' + b.name, 'badge', `New badge: ${b.ic} ${b.name}`, '#profile'); }); st.badges = names; }
      } catch (e) { /* badges are a nicety */ }
      // answers to your card image requests
      net.state.imgreqs.filter((r) => r.pid === id && r.status !== 'pending').forEach((r) => {
        const nm = BYID[r.card] ? BYID[r.card].name : 'a card';
        notify('img:' + r.id + r.status, 'info', r.status === 'approved' ? `🖼️ Your image for ${nm} was approved and is live now` : `🖼️ Your image for ${nm} was not approved`, '#imagereq');
        if (!answered[r.num]) { answered[r.num] = 1; net.closeIssue(r.num).catch(() => {}); }
      });
      // power hours
      G.eventsNow().forEach((e) => notify('ev:' + e.id, 'event', `⚡ ${e.name} is running`, '#home'));
      firstScan = false; net.paint();
    }

    // ---------------------------------------------------------------- pages
    const noteHTML = (n) => `<a class="note ${n.read ? '' : 'unread'}" href="${esc(n.href || '#notifications')}" data-soc="read" data-id="${esc(n.id)}"><span class="note-ic" aria-hidden="true">${ICON[n.type] || ICON.info}</span><span class="note-txt">${esc(n.text)}<small>${ctx.since(n.at)}</small></span><button type="button" class="note-x" data-soc="note-x" data-id="${esc(n.id)}" aria-label="Dismiss">✕</button></a>`;
    function pageNotifications() {
      const list = sc().notes;
      ctx.setHTML($('#main'), `<div class="row wrap between"><h1>Notifications</h1><div class="row"><button class="btn sm" type="button" data-soc="read-all" ${unread() ? '' : 'disabled'}>Mark all read</button><button class="btn sm" type="button" data-soc="clear-all" ${list.length ? '' : 'disabled'}>Clear all</button></div></div>
        <p class="muted small">Trade offers and answers, friend requests, messages, comments on your board posts, new badges and gifts show up here.</p>
        ${list.length ? `<div class="note-list">${list.map(noteHTML).join('')}</div>` : '<div class="empty"><h2>All quiet</h2><p class="muted">Nothing new. You will see things here when someone trades with you, adds you, or replies.</p></div>'}`);
      dirty = false;
    }
    const avatar = (size, p) => ctx.avatarHTML(size, p);
    function pageFriends() {
      if (!net.enabled()) { ctx.setHTML($('#main'), '<h1>Friends</h1><div class="panel"><p class="muted">Friends need the online connection.</p></div>'); return; }
      ctx.setHTML($('#main'), `<div class="row wrap between"><h1>Friends</h1></div><p class="muted small" id="plstatus"></p><div id="frlist"></div>
        <section class="panel fr-find"><h2>Add a friend</h2><label class="f">Find a player<input id="frq" type="search" placeholder="Name or username" autocomplete="off"></label><div id="frfound"></div></section>`);
      $('#frq').oninput = drawFound; drawFriends(); drawFound(); net.paint(); if (Date.now() - net.state.last > 20000) net.cycle(); dirty = false;
    }
    function drawFriends() {
      const box = $('#frlist'); if (!box) return;
      const inc = requestsIn(), out = requestsOut(), fl = friendsList().sort((a, b) => unreadFor(b) - unreadFor(a) || other(a).name.localeCompare(other(b).name));
      const row = (f, btns) => { const o = other(f), p = person(o.id, o.name); return `<div class="fr-row">${avatar(40, p)}<span class="fr-name"><a href="#user-${esc(o.id)}">${esc(p.name || o.name)}</a><small class="muted">${online(p) ? '<span class="online-dot"></span> online' : p.seen ? 'last seen ' + ctx.since(p.seen) : ''}</small></span><span class="fr-btns">${btns}</span></div>`; };
      ctx.setHTML(box, `${inc.length ? `<section><h2>Friend requests <span class="muted small">${inc.length}</span></h2><div class="fr-grid">${inc.map((f) => row(f, `<button class="btn sm primary" data-soc="fr-accept" data-id="${f.fid}" type="button">Accept</button><button class="btn sm" data-soc="fr-decline" data-id="${f.fid}" type="button">Decline</button>`)).join('')}</div></section>` : ''}
        <section><h2>Your friends <span class="muted small">${fl.length}</span></h2>${fl.length ? `<div class="fr-grid">${fl.map((f) => { const u = unreadFor(f); return row(f, `<a class="btn sm primary" href="#chat-${esc(other(f).id)}">💬 Message${u ? `<span class="fr-unread">${u}</span>` : ''}</a><button class="btn sm" data-net="trade" data-id="${esc(other(f).id)}" type="button">⇄ Trade</button><button class="btn sm" data-soc="fr-remove" data-id="${f.fid}" type="button" title="Remove friend">✕</button>`); }).join('')}</div>` : '<div class="empty"><p>No friends yet. Find someone below, or open a player from the leaderboard and press Add friend.</p></div>'}</section>
        ${out.length ? `<section><h2>Requests you sent <span class="muted small">${out.length}</span></h2><div class="fr-grid">${out.map((f) => row(f, `<span class="muted small">waiting…</span><button class="btn sm" data-soc="fr-cancel" data-id="${f.fid}" type="button">Cancel</button>`)).join('')}</div></section>` : ''}`);
    }
    function drawFound() {
      const box = $('#frfound'), qi = $('#frq'); if (!box || !qi) return; const q = qi.value.trim().toLowerCase();
      if (!q) { box.innerHTML = '<p class="muted small">Type a name to search.</p>'; return; }
      const list = net.state.dir.filter((p) => p.id !== me() && (p.acct || !net.state.loaded) && (p.name.toLowerCase().includes(q) || (p.acct || '').toLowerCase().includes(q))).slice(0, 8);
      box.innerHTML = list.length ? `<div class="fr-grid">${list.map((p) => { const r = rel(p.id); const b = !r || r.status === 'declined' ? `<button class="btn sm primary" data-soc="fr-add" data-id="${p.id}" type="button">➕ Add friend</button>` : r.status === 'accepted' ? '<span class="muted small">Friends</span>' : r.to.id === me() ? `<button class="btn sm primary" data-soc="fr-accept" data-id="${r.fid}" type="button">Accept</button>` : '<span class="muted small">Request sent</span>';
        return `<div class="fr-row">${avatar(40, p)}<span class="fr-name"><a href="#user-${esc(p.id)}">${esc(p.name)}</a>${p.acct && p.acct.toLowerCase() !== p.name.toLowerCase() ? `<small class="muted">@${esc(p.acct)}</small>` : ''}</span><span class="fr-btns">${b}</span></div>`; }).join('')}</div>` : '<p class="muted small">No players found.</p>';
    }
    // the button(s) shown on another player's profile
    function friendButton(p) {
      if (!net.enabled() || !p.full || p.id === me()) return '';
      const r = rel(p.id);
      if (!r || r.status === 'declined') return `<button class="btn" data-soc="fr-add" data-id="${esc(p.id)}" type="button">➕ Add friend</button>`;
      if (r.status === 'accepted') return `<a class="btn" href="#chat-${esc(p.id)}">💬 Message</a><button class="btn" data-soc="fr-remove" data-id="${r.fid}" type="button">Unfriend</button>`;
      return r.to.id === me() ? `<button class="btn primary" data-soc="fr-accept" data-id="${r.fid}" type="button">Accept friend request</button><button class="btn" data-soc="fr-decline" data-id="${r.fid}" type="button">Decline</button>` : `<button class="btn" data-soc="fr-cancel" data-id="${r.fid}" type="button">Request sent · Cancel</button>`;
    }

    // ---------------------------------------------------------------- chat
    function parseComment(c, f) {
      let b; try { b = JSON.parse(c.body); } catch (e) { return null; }
      if (!b || b.t !== 'msg' || typeof b.text !== 'string') return null;
      if (b.from !== f.from.id && b.from !== f.to.id) return null; // only the two friends can write here
      return { id: c.id, from: b.from, text: clean(b.text, MSG_MAX), at: +b.at || Date.parse(c.created_at) || 0 };
    }
    function chatDraw(stick) {
      const log = $('#chatlog'); if (!log || !chat) return;
      const near = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
      log.innerHTML = chat.msgs.length ? chat.msgs.map((m) => `<div class="msg ${m.from === me() ? 'mine' : ''}">${esc(m.text)}<small>${hhmm(m.at)}</small></div>`).join('') : '<p class="muted small" style="margin:auto">No messages yet. Say hi!</p>';
      if (stick || near) log.scrollTop = log.scrollHeight;
    }
    async function chatLoad(first) {
      if (!chat) return; const c = chat;
      if (first) {
        const cur = await gh('GET', '/issues/' + c.num), n = +cur.comments || 0, last = Math.max(1, Math.ceil(n / 100));
        let list = await gh('GET', `/issues/${c.num}/comments?per_page=100&page=${last}`);
        if (last > 1 && list.length < 100) list = (await gh('GET', `/issues/${c.num}/comments?per_page=100&page=${last - 1}`)).concat(list);
        if (chat !== c) return; c.total = n; c.msgs = list.map((x) => parseComment(x, c.f)).filter(Boolean); if (list.length) c.since = list[list.length - 1].created_at;
      } else {
        const list = await gh('GET', `/issues/${c.num}/comments?per_page=100${c.since ? '&since=' + encodeURIComponent(c.since) : ''}`);
        if (chat !== c) return; const have = {}; c.msgs.forEach((m) => { have[m.id] = 1; }); let added = 0;
        list.forEach((x) => { if (have[x.id]) return; const m = parseComment(x, c.f); if (m) { c.msgs.push(m); added++; } c.total++; if (!c.since || x.created_at > c.since) c.since = x.created_at; });
        if (!added) return;
      }
      c.msgs.sort((a, b) => a.at - b.at); c.msgs = c.msgs.slice(-150);
      const k = 'f' + c.fid; if (c.total > (sc().seen[k] || 0)) { sc().seen[k] = c.total; ctx.save(true); } markRead('msg:' + c.fid); net.paint();
      chatDraw(first);
    }
    function pageChat(pid) {
      const f = friendsList().find((x) => other(x).id === pid);
      if (!f) { ctx.setHTML($('#main'), `<div class="empty"><h2>${net.state.loaded ? 'You are not friends with this player' : 'Loading...'}</h2><p><a class="btn" href="#friends">← Friends</a></p></div>`); if (!net.state.loaded || Date.now() - net.state.last > 20000) net.cycle(); return; }
      const o = other(f), p = person(o.id, o.name);
      if (chat && chat.timer) clearInterval(chat.timer);
      const c = chat = { fid: f.fid, num: f.num, f: f, msgs: [], total: 0, since: '', timer: 0 };
      $('#main').innerHTML = `<div class="chat"><div class="chat-head"><a class="btn sm" href="#friends">← Friends</a>${avatar(38, p)}<b>${esc(p.name || o.name)}</b>${online(p) ? '<span class="online-dot" title="Online now"></span>' : ''}<span class="grow"></span><a class="btn sm" href="#user-${esc(o.id)}">Profile</a></div>
        <div class="chat-log" id="chatlog" aria-live="polite"><p class="muted small" style="margin:auto">Loading…</p></div>
        <form class="chat-send" id="chatform" autocomplete="off"><input id="chatin" maxlength="${MSG_MAX}" placeholder="Message ${esc(p.name || o.name)}" aria-label="Message"><button class="btn primary" type="submit">Send</button></form></div>`;
      $('#chatform').onsubmit = act(async (e) => {
        e.preventDefault(); const inp = $('#chatin'), text = clean(inp.value, MSG_MAX); if (!text) return; inp.value = '';
        const s = S(), body = { t: 'msg', from: s.profile.id, name: s.profile.name, text: text, at: Date.now() };
        try { const r = await gh('POST', `/issues/${c.num}/comments`, { body: JSON.stringify(body) }); if (chat !== c) return; c.msgs.push({ id: r.id, from: s.profile.id, text: text, at: body.at }); c.total++; c.since = r.created_at || c.since; sc().seen['f' + c.fid] = Math.max(sc().seen['f' + c.fid] || 0, c.total); ctx.save(true); chatDraw(true); }
        catch (er) { inp.value = text; throw er; }
      });
      chatLoad(true).catch((e) => { const l = $('#chatlog'); if (l) l.innerHTML = `<p class="muted small" style="margin:auto">Could not load messages: ${esc(e.message)}</p>`; });
      c.timer = setInterval(() => { if (chat !== c || location.hash !== '#chat-' + pid) { clearInterval(c.timer); if (chat === c) chat = null; return; } if (!document.hidden) chatLoad(false).catch(() => {}); }, 5000);
      const inp = $('#chatin'); if (inp) inp.focus({ preventScroll: true });
    }

    // ---------------------------------------------------------------- board comments
    const cmState = {}; // post issue number -> { list, total }
    function cmHTML(num, owner) {
      const st = cmState[num]; if (!st) return '<p class="muted small">Loading…</p>';
      return (st.list.length ? st.list.map((c) => { const p = person(c.pid, c.name), mine = c.pid === me();
        return `<div class="cm">${avatar(28, p)}<span class="cm-body"><a href="#user-${esc(c.pid)}">${esc(p.name || c.name)}</a><small>${ctx.since(c.at)}</small><br>${esc(c.text)}</span>${mine || owner === me() ? `<button type="button" class="cm-x" data-soc="cm-del" data-num="${num}" data-cid="${c.id}" aria-label="Delete comment" title="Delete">✕</button>` : '<span></span>'}</div>`; }).join('') : '<p class="muted small">No comments yet. Ask about a card or say you can help.</p>')
        + `<form class="cm-send" data-cmform="${num}" data-owner="${esc(owner)}" autocomplete="off"><input maxlength="${CM_MAX}" placeholder="Write a comment…" aria-label="Comment"><button class="btn sm primary" type="submit">Post</button></form>`;
    }
    async function cmLoad(num, owner, count) {
      const last = Math.max(1, Math.ceil((count || 1) / 100));
      let list = await gh('GET', `/issues/${num}/comments?per_page=100&page=${last}`);
      if (last > 1 && list.length < 100) list = (await gh('GET', `/issues/${num}/comments?per_page=100&page=${last - 1}`)).concat(list);
      const out = []; list.forEach((x) => { let b; try { b = JSON.parse(x.body); } catch (e) { return; } if (b && b.t === 'cmt' && typeof b.text === 'string' && /^[a-z0-9]{6,40}$/.test(b.pid || '')) out.push({ id: x.id, pid: b.pid, name: clean(b.name, 20) || 'Player', text: clean(b.text, CM_MAX), at: +b.at || Date.parse(x.created_at) || 0 }); });
      cmState[num] = { list: out, total: out.length };
      if (owner === me()) { sc().seen['b' + num] = Math.max(sc().seen['b' + num] || 0, count || 0); ctx.save(true); markRead('cm:' + num); }
      return cmState[num];
    }
    function cmRender(num, owner) { const box = document.getElementById('cm-' + num); if (!box) return; box.innerHTML = cmHTML(num, owner); const btn = $(`[data-cm="${num}"]`); if (btn) { const n = (cmState[num] || {}).total; btn.textContent = '💬 Comments' + (n ? ' (' + n + ')' : ''); } }

    // ---------------------------------------------------------------- card image requests
    // Crops to the card art ratio (10:7) and shrinks until it fits in one GitHub issue.
    function readImg(file) {
      return new Promise((res, rej) => {
        const url = URL.createObjectURL(file), img = new Image();
        img.onload = () => {
          URL.revokeObjectURL(url);
          for (const [w, h] of [[420, 294], [340, 238], [260, 182]]) {
            const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.fillStyle = '#111'; g.fillRect(0, 0, w, h);
            const k = Math.max(w / img.width, h / img.height), dw = img.width * k, dh = img.height * k; g.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
            for (const q of [0.85, 0.7, 0.55, 0.4]) { const d = c.toDataURL('image/jpeg', q); if (d.length < 56000) return res(d); }
          }
          rej(new Error('That picture is too detailed. Try a simpler or smaller one.'));
        };
        img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Could not read that image')); };
        img.src = url;
      });
    }
    const irView = { q: '', cat: 'all' }, MAX_REQ = 3;
    const myReqs = () => net.state.imgreqs.filter((r) => r.pid === me() && r.status === 'pending');
    function pageImageReq() {
      const mine = myReqs();
      ctx.setHTML($('#main'), `<div class="row wrap between"><h1>Request a card image</h1><a class="btn sm" href="#options">← Settings</a></div>
        <p class="muted">Pick a card, then send the picture you think it should have. An admin looks at it, and if it is approved the card is updated for everyone. You can have ${MAX_REQ} requests waiting at a time.</p>
        ${mine.length ? `<section class="panel"><h2>Waiting for approval <span class="muted small">${mine.length}</span></h2><div class="fr-grid">${mine.map((r) => { const c = BYID[r.card]; return `<div class="fr-row"><span>${c ? ctx.cardHTML(Object.assign({}, c, { img: r.img || c.img }), { size: 70 }) : ''}</span><span class="fr-name"><b>${esc(c ? c.name : r.card)}</b><small class="muted">sent ${ctx.since(r.at)}${r.note ? ' · ' + esc(r.note) : ''}</small></span><span class="fr-btns"><button class="btn sm" data-soc="img-cancel" data-num="${r.num}" type="button">Cancel</button></span></div>`; }).join('')}</div></section>` : ''}
        <div class="filters panel"><label class="f">Search<input id="irq" type="search" value="${esc(irView.q)}" placeholder="Card name" autocomplete="off"></label>
        <label class="f">Set<select id="ircat"><option value="all">All sets</option>${Object.keys(G.CATS).map((k) => `<option ${irView.cat === k ? 'selected' : ''}>${esc(k)}</option>`).join('')}</select></label></div><div id="irgrid"></div>`);
      const draw = () => {
        const q = irView.q.trim().toLowerCase(), own = S().cards;
        const list = G.CARDS.filter((c) => !c.off && (!c.monster || own[c.id]) && (irView.cat === 'all' || c.cat === irView.cat) && (!q || c.name.toLowerCase().includes(q))).sort((a, b) => a.rank - b.rank);
        $('#irgrid').innerHTML = list.length ? `<div class="card-grid small">${list.map((c) => `<button class="card-btn" type="button" data-soc="img-pick" data-id="${esc(c.id)}">${ctx.cardHTML(c, { size: 128 })}</button>`).join('')}</div>` : '<div class="empty"><p>No cards match.</p></div>';
        $$('#irgrid .card').forEach(ctx.tilt);
      };
      $('#irq').oninput = (e) => { irView.q = e.target.value; draw(); }; $('#ircat').onchange = (e) => { irView.cat = e.target.value; draw(); }; draw();
    }
    function imgModal(id) {
      const c = BYID[id]; if (!c) return;
      if (myReqs().length >= MAX_REQ) { toast(`You already have ${MAX_REQ} requests waiting. Wait for an answer or cancel one.`, true); return; }
      const dup = myReqs().find((r) => r.card === id); if (dup) { toast('You already have a request waiting for this card', true); return; }
      let data = null;
      const bg = ctx.modal(`<h2>New picture for ${esc(c.name)}</h2><div class="row wrap" style="align-items:flex-start"><div id="irCard">${ctx.cardHTML(c, { size: 190 })}</div>
        <div class="grow" style="min-width:220px;display:grid;gap:10px"><label class="f">Your picture<input id="irFile" type="file" accept="image/png,image/jpeg,image/webp,image/gif"></label><p class="muted small">It is cropped to the card's picture area (wide, about 10:7). Pick an image where the character is in the middle.</p>
        <label class="f">Note for the admin (optional)<input id="irNote" maxlength="120" autocomplete="off" placeholder="e.g. Official art from the wiki"></label><p class="auth-err" id="irErr" role="alert"></p>
        <div class="row wrap"><button class="btn primary" id="irSend" type="button" disabled>Send request</button><button class="btn" data-act="close-modal" type="button">Cancel</button></div></div></div>`);
      $('#irFile', bg).onchange = async (e) => {
        const f = e.target.files[0]; if (!f) return; $('#irErr', bg).textContent = '';
        try { data = await readImg(f); $('#irCard', bg).innerHTML = ctx.cardHTML(Object.assign({}, c, { img: data }), { size: 190 }); $('#irSend', bg).disabled = false; }
        catch (er) { data = null; $('#irSend', bg).disabled = true; $('#irErr', bg).textContent = er.message; }
      };
      $('#irSend', bg).onclick = act(async () => {
        if (!data) return; const b = $('#irSend', bg); b.disabled = true; const s = S(), rid = ctx.uid().replace(/[^a-z0-9]/g, '').slice(0, 20);
        try { await net.createIssue(`imgreq:${rid} ${c.name}`.replace(/[\r\n]+/g, ' ').slice(0, 100), { t: 'imgreq', v: 1, id: rid, card: id, pid: s.profile.id, name: s.profile.name, img: data, note: clean($('#irNote', bg).value, 120), at: Date.now(), status: 'pending' }); }
        catch (er) { b.disabled = false; throw er; }
        ctx.closeModal(bg); toast('Request sent. An admin will look at it.'); try { await net.refresh(); } catch (e) { /* later */ } ctx.route(true);
      });
    }

    // ---------------------------------------------------------------- events
    document.addEventListener('click', (e) => {
      const cm = e.target.closest('[data-cm]');
      if (cm) {
        const num = +cm.dataset.cm, owner = cm.dataset.owner, box = document.getElementById('cm-' + num); if (!box) return;
        if (!box.hidden) { box.hidden = true; cm.setAttribute('aria-expanded', 'false'); return; }
        box.hidden = false; cm.setAttribute('aria-expanded', 'true'); box.innerHTML = cmHTML(num, owner);
        const post = net.state.board.find((x) => x.num === num);
        cmLoad(num, owner, post ? post.ccount : 0).then(() => cmRender(num, owner)).catch((er) => { box.innerHTML = `<p class="muted small">Could not load comments: ${esc(er.message)}</p>`; });
        return;
      }
      const t = e.target.closest('[data-soc]'); if (!t) return; const a = t.dataset.soc, id = t.dataset.id;
      if (a === 'read') { markRead(id); return; } // the link itself navigates
      e.preventDefault(); e.stopPropagation();
      if (a === 'note-x') { const st = sc(); st.notes = st.notes.filter((n) => n.id !== id); dirty = true; ctx.save(true); net.paint(); pageNotifications(); }
      else if (a === 'read-all') { markAll(); pageNotifications(); }
      else if (a === 'clear-all') { if (window.confirm('Clear all notifications?')) { sc().notes = []; ctx.save(true); net.paint(); pageNotifications(); } }
      else if (a === 'img-pick') imgModal(id);
      else if (a === 'img-cancel') act(async () => { await net.closeIssue(+t.dataset.num); toast('Request cancelled'); try { await net.refresh(); } catch (e) { /* later */ } ctx.route(true); })();
      else if (a === 'fr-add') sendRequest(id);
      else if (a === 'fr-accept') accept(id);
      else if (a === 'fr-decline') decline(id);
      else if (a === 'fr-cancel') closeFriend(id);
      else if (a === 'fr-remove') closeFriend(id, 'Remove {n} from your friends? Your conversation with them is deleted.');
      else if (a === 'cm-del') {
        const num = +t.dataset.num, cid = t.dataset.cid; act(async () => { await gh('DELETE', '/issues/comments/' + cid); const st = cmState[num]; if (st) { st.list = st.list.filter((c) => String(c.id) !== String(cid)); st.total = st.list.length; } const b = $(`[data-cm="${num}"]`); cmRender(num, b ? b.dataset.owner : ''); })();
      }
    }, true);
    document.addEventListener('submit', (e) => {
      const f = e.target.closest('[data-cmform]'); if (!f) return; e.preventDefault();
      const num = +f.dataset.cmform, owner = f.dataset.owner, inp = f.querySelector('input'), text = clean(inp.value, CM_MAX); if (!text) return;
      act(async () => {
        const s = S(), body = { t: 'cmt', pid: s.profile.id, name: s.profile.name, text: text, at: Date.now() }; inp.value = '';
        let r; try { r = await gh('POST', `/issues/${num}/comments`, { body: JSON.stringify(body) }); } catch (er) { inp.value = text; throw er; }
        const st = cmState[num] || (cmState[num] = { list: [], total: 0 }); st.list.push({ id: r.id, pid: s.profile.id, name: s.profile.name, text: text, at: body.at }); st.total = st.list.length;
        if (owner === s.profile.id) { sc().seen['b' + num] = (sc().seen['b' + num] || 0) + 1; ctx.save(true); }
        cmRender(num, owner); const again = document.querySelector(`#cm-${num} .cm-send input`); if (again) again.focus({ preventScroll: true });
      })();
    }, true);

    return { notify: notify, scan: scan, unread: unread, friendAlerts: friendAlerts, dirty: () => dirty, pageNotifications: pageNotifications, pageFriends: pageFriends, pageChat: pageChat, pageImageReq: pageImageReq, friendButton: friendButton };
  };
})();
