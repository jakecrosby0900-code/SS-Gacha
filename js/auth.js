// Accounts: "Sign in with Discord". The game cannot be played until you are signed in.
//
// There is no server, so (like the leaderboard and trading) accounts live in GitHub Issues:
//  - Each account is ONE issue titled "account:d<discord id>". Its JSON body holds the Discord ID, the name Discord gave at sign-up
//    and the ID of the player profile / cloud save that belongs to the account. There are no passwords any more.
//  - Sign-in uses Discord's "implicit" OAuth flow, which needs no secret and no server: Discord sends the player back to this page with a
//    short-lived token, the page reads the player's Discord profile (scope "identify": ID, name, avatar) and then throws the token away.
//  - Signing in loads the account's published save if this device does not already have it.
//
// Honest limits: this is a client-side gate. Anyone who knows how to use browser dev tools can pretend to be another Discord user, because
// the page (not a server) decides who you are. Fine for a friends game, not for anything sensitive.
(function () {
  'use strict';
  const ITER = 150000;
  const enc = new TextEncoder();
  const b64e = (u8) => btoa(String.fromCharCode.apply(null, Array.from(u8)));
  const b64d = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  // Still used by the admin page for its own login.
  async function derive(text, saltB64, iter) {
    if (!(window.crypto && crypto.subtle)) throw new Error('This browser cannot do secure sign-in. Open the site over https.');
    const key = await crypto.subtle.importKey('raw', enc.encode(text), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: b64d(saltB64), iterations: iter || ITER }, key, 256);
    return b64e(new Uint8Array(bits));
  }
  window.SSG_CRYPTO = { derive: derive, ITER: ITER };

  const DISCORD_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="currentColor"><path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.74 19.74 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.292a.074.074 0 0 1 .078-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .079.009c.12.1.246.199.373.293a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.06.06 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>';

  window.SSGAuth = function (ctx) {
    const $ = ctx.$, esc = ctx.esc, net = ctx.net;
    const SESS = 'ss-gacha-session', STATE = 'ss-gacha-dstate';
    const DKEY = /^d\d{15,19}$/; // account keys are "d" + the Discord user ID
    const view = { busy: false, msg: '', err: '' };
    const dcfg = () => window.SSG_DISCORD || {};

    // Sessions made by the old username/password system do not match DKEY, so they are dropped.
    function session() { try { const j = JSON.parse(localStorage.getItem(SESS) || 'null'); return j && DKEY.test(j.k) && typeof j.pid === 'string' ? j : null; } catch (e) { return null; } }
    function setSession(a) { try { localStorage.setItem(SESS, JSON.stringify({ k: a.k, u: a.u, pid: a.pid, at: Date.now() })); } catch (e) { /* ignore */ } }
    const loggedIn = () => !!session();
    const fail = (m) => { const e = new Error(m); e.user = true; return e; };
    const redirectUri = () => String(dcfg().redirect || '').trim() || (location.origin + location.pathname);

    // ---------- Discord ----------
    function start() {
      const id = String(dcfg().clientId || '').trim();
      if (!/^\d{15,25}$/.test(id)) { view.err = 'Discord sign-in is not set up yet. The site owner needs to add the Discord Client ID in js/config.js.'; page(); return; }
      const st = b64e(crypto.getRandomValues(new Uint8Array(16))).replace(/[^A-Za-z0-9]/g, 'x');
      try { localStorage.setItem(STATE, JSON.stringify({ s: st, at: Date.now() })); } catch (e) { view.err = 'This browser blocks storage, so Discord sign-in cannot work.'; page(); return; }
      location.href = 'https://discord.com/api/oauth2/authorize?' + new URLSearchParams({ client_id: id, response_type: 'token', redirect_uri: redirectUri(), scope: 'identify', state: st }).toString();
    }

    // Runs once at start-up. If Discord just sent the player back here, read the answer out of the address and finish signing in.
    function consumeRedirect() {
      const h = location.hash.replace(/^#/, ''), q = location.search.replace(/^\?/, '');
      let p = null;
      if (/(^|&)access_token=/.test(h) || /(^|&)error=/.test(h)) p = new URLSearchParams(h);
      else if (/(^|&)error=/.test(q) && /(^|&)state=/.test(q)) p = new URLSearchParams(q);
      if (!p) return false;
      try { history.replaceState(null, '', location.pathname); } catch (e) { /* ignore */ } // keep the token out of the address bar and history
      let want = null; try { want = JSON.parse(localStorage.getItem(STATE) || 'null'); localStorage.removeItem(STATE); } catch (e) { /* ignore */ }
      if (!want || !want.s || p.get('state') !== want.s || Date.now() - (want.at || 0) > 900000) { view.err = 'That sign-in expired. Please try again.'; return true; }
      if (p.get('error')) { view.err = 'Discord sign-in was cancelled.'; return true; }
      const token = p.get('access_token'); if (!token) { view.err = 'Discord did not send back a sign-in. Please try again.'; return true; }
      view.busy = true; view.msg = 'Signing you in with Discord...';
      finish(token).then((created) => {
        view.busy = false; view.err = ''; location.hash = '#home'; ctx.route(); net.cycle(true); ctx.toast(created ? 'Account created. Welcome!' : 'Signed in');
      }).catch((ex) => {
        view.busy = false; view.err = ex.user ? ex.message : 'Something went wrong: ' + (ex.message || ex); ctx.route();
      });
      return true;
    }

    // Small avatar for the new profile (the player can change it afterwards in Edit profile). Any failure just means no picture.
    function avatarData(url) {
      return new Promise((res) => {
        const done = (v) => { clearTimeout(t); res(v); }, t = setTimeout(() => res(null), 6000), im = new Image();
        im.crossOrigin = 'anonymous';
        im.onload = () => { try { const c = document.createElement('canvas'); c.width = c.height = 160; c.getContext('2d').drawImage(im, 0, 0, 160, 160); done(c.toDataURL('image/jpeg', 0.85)); } catch (e) { done(null); } };
        im.onerror = () => done(null); im.src = url;
      });
    }

    // Returns true if a new account was made, false if it signed in to an existing one.
    async function finish(token) {
      let me;
      try { const r = await fetch('https://discord.com/api/v10/users/@me', { headers: { Authorization: 'Bearer ' + token } }); if (!r.ok) throw new Error('HTTP ' + r.status); me = await r.json(); }
      catch (e) { throw fail('Could not read your Discord profile. Please try again.'); }
      if (!me || !/^\d{15,19}$/.test(String(me.id))) throw fail('Discord sent back something unexpected. Please try again.');
      const did = String(me.id), k = 'd' + did;
      const dname = String(me.global_name || me.username || 'Player').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 20) || 'Player';
      if (!net.enabled()) throw fail('Accounts need the online connection, which is not set up on this site yet.');
      try { await net.refresh(); } catch (e) { throw fail('Could not reach the server: ' + e.message); }
      const S = ctx.S(), existing = net.state.accounts.find((x) => x.k === k);

      if (existing) {
        const a = existing;
        if (!(S.account === k && S.profile.id === a.pid)) {
          // A different account (or none) is on this device: bring in this account's save.
          if (!S.account && S.stats.opened > 0 && S.profile.id !== a.pid && !window.confirm('This device has progress that is not linked to an account. Signing in will replace it with the saved progress of "' + a.u + '". Continue?')) throw fail('Sign in cancelled.');
          const cloud = net.state.dir.find((p) => p.id === a.pid);
          let next;
          if (cloud) {
            const cards = {}; Object.keys(cloud.cards).forEach((id) => { const c = cloud.cards[id]; cards[id] = { n: c.n, h: c.h, f: c.f, t: c.t, l: c.l }; });
            next = Object.assign(ctx.fresh(), cloud.raw || {}, { stats: Object.assign({ opened: cloud.opened, pulls: cloud.pulls }, (cloud.raw || {}).stats), cards: cards, profile: { id: cloud.id, name: cloud.name, hue: cloud.hue, pfp: cloud.pfp, banner: cloud.banner, joined: cloud.joined }, settings: Object.assign({}, S.settings) });
          } else { next = ctx.fresh(); next.profile.id = a.pid; next.profile.name = a.u; }
          next.account = k; next.mod = next.syncMod = (cloud && cloud.mod) || 0; ctx.adopt(next);
        }
        setSession(a); return false;
      }

      // First time with Discord: make the account.
      // Someone who played before accounts existed (no account at all on this device) keeps their progress. Anyone else starts fresh.
      let pid = S.account ? ctx.uid().replace(/[^a-z0-9]/g, '') : S.profile.id;
      if (net.state.accounts.some((a) => a.pid === pid) || net.state.cfg.blocked.some((x) => x.id === pid)) pid = ctx.uid().replace(/[^a-z0-9]/g, '');
      let num;
      try { num = await net.createIssue('account:' + k, { t: 'account', v: 2, u: dname, k: k, did: did, pid: pid, created: Date.now() }); }
      catch (e) { throw fail('Could not create the account: ' + e.message); }
      // Two tabs can create the same account at the same moment: the oldest issue wins, the other one backs off.
      await new Promise((r) => setTimeout(r, 1500));
      try { await net.refresh(); } catch (e) { /* the account is created; carry on */ }
      const older = net.state.accounts.find((a) => a.k === k && a.num < num);
      if (older) { try { await net.closeIssue(num); } catch (e) { /* ignore */ } throw fail('Your account was just created in another tab. Please sign in again.'); }
      const pfp = me.avatar ? await avatarData('https://cdn.discordapp.com/avatars/' + did + '/' + me.avatar + '.png?size=128') : null;
      if (S.account) { const f = ctx.fresh(); f.profile.id = pid; f.profile.name = dname; if (pfp) f.profile.pfp = pfp; f.account = k; ctx.adopt(f); }
      else { S.account = k; if (!S.profile.name || S.profile.name === 'Player') S.profile.name = dname; if (pfp && !S.profile.pfp) S.profile.pfp = pfp; S.profile.id = pid; ctx.save(); }
      setSession({ k: k, u: dname, pid: pid });
      return true;
    }

    async function logOut() {
      try { if (net.enabled()) await net.cycle(true); } catch (e) { /* ignore */ }
      try { localStorage.removeItem(SESS); } catch (e) { /* ignore */ }
      location.hash = '#home'; ctx.route();
    }
    // Called after every online sync: sign out only if the admin really deleted this account.
    // GitHub's issue list is sometimes short or lagging (rate limits, paging, a just-made issue), so one sync that does not show the account
    // proves nothing. It must be missing from several full, complete listings in a row, spread over time, before we believe it.
    let gone = 0, goneSince = 0;
    function watch() {
      const s = session(); if (!s || net.state.status !== 'ok' || !net.state.loaded || Date.now() - (s.at || 0) < 120000) return;
      if (!net.state.complete || !net.state.accounts.length) return; // partial or empty listing: learn nothing
      if (net.state.accounts.some((a) => a.k === s.k)) { gone = 0; goneSince = 0; return; } // the account exists (its save id is repaired by the app if it differs)
      if (!goneSince) goneSince = Date.now(); gone++;
      if (gone < 4 || Date.now() - goneSince < 180000) return;
      try { localStorage.removeItem(SESS); } catch (e) { /* ignore */ } ctx.toast('Your account was removed.', true); ctx.route();
    }

    // ---------- sign in page ----------
    function page() {
      const S = ctx.S(), old = S && S.account && !DKEY.test(S.account);
      $('#main').innerHTML = `<div class="auth-wrap"><section class="panel auth">
        <p class="eyebrow">Special Strike</p><h1>Sign in to play</h1>
        <p class="muted small">Sign in with your Discord account. Your cards and leaderboard spot are saved to it, so you can play on any device. The first time you sign in, your account is created for you.</p>
        ${old ? '<p class="small auth-note">Username and password accounts have been retired. Sign in with Discord to play.</p>' : ''}
        <button class="btn discord" id="auDiscord" type="button" ${view.busy ? 'disabled' : ''}>${DISCORD_ICON}<span>${view.busy ? esc(view.msg || 'Please wait...') : 'Continue with Discord'}</span></button>
        <p class="auth-err" id="auErr" role="alert">${esc(view.err)}</p>
        <p class="muted small">We only read your Discord username, ID and avatar. We never see your password or your messages. Your name and picture here can be changed any time in Edit profile.</p>
        </section></div>`;
      const b = $('#auDiscord'); if (b) b.onclick = () => { if (!view.busy) { view.err = ''; start(); } };
    }

    // ---------- settings panel ----------
    function settingsHTML() {
      const s = session();
      return s ? `<section class="panel"><h2>Account 👤</h2><p class="muted small">Signed in with Discord as <b>${esc(s.u)}</b>. Your cards save to your account automatically. Your display name and picture can be changed in Edit profile on your profile page.</p><p class="small" id="auDiag" role="status"></p><div class="row wrap"><button class="btn" id="auSync" type="button">Save to account now</button><button class="btn" id="auLogout" type="button">Log out</button></div></section>` : '';
    }
    function bindSettings() {
      const b = $('#auLogout'); if (b) b.onclick = async () => { b.disabled = true; b.textContent = 'Saving and logging out...'; await logOut(); };
      const y = $('#auSync'); if (y) y.onclick = async () => { y.disabled = true; const d = $('#auDiag'); d.textContent = 'Saving...'; try { d.textContent = await net.diag(); } catch (e) { d.textContent = 'Failed: ' + (e.message || e); } y.disabled = false; };
    }

    return { loggedIn: loggedIn, session: session, page: page, logOut: logOut, watch: watch, settingsHTML: settingsHTML, bindSettings: bindSettings, consumeRedirect: consumeRedirect };
  };
})();
