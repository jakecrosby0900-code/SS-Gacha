// Accounts: sign up / sign in. The game cannot be played until you are signed in.
//
// There is no server, so (like the leaderboard and trading) accounts live in GitHub Issues:
//  - Each account is ONE issue titled "account:<username>". Its JSON body holds the username, a random salt, a PBKDF2 hash of the
//    password (never the password itself) and the ID of the player profile / cloud save that belongs to the account.
//  - Signing in checks the password against that hash, then loads the account's published save if this device does not already have it.
//
// Honest limits: this is a client-side gate. Anyone who knows how to use browser dev tools can get past it, and the hashes are readable
// by anyone who can read the repo's issues, so a weak password can be guessed offline. Fine for a friends game, not for anything sensitive.
(function () {
  'use strict';
  const ITER = 150000;
  const enc = new TextEncoder();
  const b64e = (u8) => btoa(String.fromCharCode.apply(null, Array.from(u8)));
  const b64d = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  // Shared with the admin page.
  async function derive(text, saltB64, iter) {
    if (!(window.crypto && crypto.subtle)) throw new Error('This browser cannot do secure sign-in. Open the site over https.');
    const key = await crypto.subtle.importKey('raw', enc.encode(text), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: b64d(saltB64), iterations: iter || ITER }, key, 256);
    return b64e(new Uint8Array(bits));
  }
  window.SSG_CRYPTO = { derive: derive, ITER: ITER };

  window.SSGAuth = function (ctx) {
    const $ = ctx.$, esc = ctx.esc, net = ctx.net;
    const SESS = 'ss-gacha-session';
    const view = { mode: 'in', busy: false, err: '', user: '' };

    function session() { try { const j = JSON.parse(localStorage.getItem(SESS) || 'null'); return j && typeof j.k === 'string' && typeof j.pid === 'string' ? j : null; } catch (e) { return null; } }
    function setSession(a) { try { localStorage.setItem(SESS, JSON.stringify({ k: a.k, u: a.u, pid: a.pid, at: Date.now() })); } catch (e) { /* ignore */ } }
    const loggedIn = () => !!session();
    const fail = (m) => { const e = new Error(m); e.user = true; return e; };

    function check(name) {
      const u = String(name || '').trim();
      if (!/^[A-Za-z0-9_]{3,20}$/.test(u)) throw fail('Username must be 3 to 20 letters, numbers or underscores.');
      return u;
    }

    // ---------- actions ----------
    async function signUp(name, pw, pw2) {
      const u = check(name), k = u.toLowerCase();
      if (pw.length < 6) throw fail('Password must be at least 6 characters.');
      if (pw !== pw2) throw fail('The two passwords do not match.');
      if (!net.enabled()) throw fail('Accounts need the online connection, which is not set up on this site yet.');
      try { await net.refresh(); } catch (e) { throw fail('Could not reach the server: ' + e.message); }
      if (net.state.accounts.some((a) => a.k === k)) throw fail('That username is already taken.');
      const S = ctx.S();
      // Someone who already played before accounts existed keeps their progress. A second person on the same device starts fresh.
      let pid = S.account ? ctx.uid().replace(/[^a-z0-9]/g, '') : S.profile.id;
      if (net.state.accounts.some((a) => a.pid === pid)) pid = ctx.uid().replace(/[^a-z0-9]/g, '');
      const salt = b64e(crypto.getRandomValues(new Uint8Array(16))), hash = await derive(pw, salt, ITER);
      let num;
      try { num = await net.createIssue('account:' + k, { t: 'account', v: 1, u: u, k: k, salt: salt, iter: ITER, hash: hash, pid: pid, created: Date.now() }); }
      catch (e) { throw fail('Could not create the account: ' + e.message); }
      // Two people can pick the same name at the same moment: the oldest issue wins, the other one backs off.
      // GitHub can take a moment to list a brand-new issue, so not seeing ours yet is fine. Only an OLDER account with this name means we lost.
      await new Promise((r) => setTimeout(r, 1500));
      try { await net.refresh(); } catch (e) { /* the account is created; carry on */ }
      if (net.state.accounts.some((a) => a.k === k && a.num < num)) { try { await net.closeIssue(num); } catch (e) { /* ignore */ } throw fail('That username was just taken. Try another.'); }
      const acc = { k: k, u: u, pid: pid };
      if (S.account) { const f = ctx.fresh(); f.profile.id = pid; f.profile.name = u; f.account = k; ctx.adopt(f); }
      else { S.account = k; if (!S.profile.name || S.profile.name === 'Player') S.profile.name = u; S.profile.id = pid; ctx.save(); }
      setSession(acc);
    }

    async function signIn(name, pw) {
      const k = String(name || '').trim().toLowerCase();
      if (!k || !pw) throw fail('Enter your username and password.');
      if (!net.enabled()) throw fail('Accounts need the online connection, which is not set up on this site yet.');
      try { await net.refresh(); } catch (e) { throw fail('Could not reach the server: ' + e.message); }
      const a = net.state.accounts.find((x) => x.k === k), bad = 'Wrong username or password.';
      if (!a) throw fail(bad);
      if ((await derive(pw, a.salt, a.iter)) !== a.hash) throw fail(bad);
      const S = ctx.S();
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
      setSession(a);
    }

    async function logOut() {
      try { if (net.enabled()) await net.cycle(true); } catch (e) { /* ignore */ }
      try { localStorage.removeItem(SESS); } catch (e) { /* ignore */ }
      location.hash = '#home'; ctx.route();
    }
    // Called after every online sync: if the admin deleted this account, sign out.
    function watch() {
      const s = session(); if (!s || net.state.status !== 'ok' || !net.state.loaded || Date.now() - (s.at || 0) < 120000) return;
      if (!net.state.accounts.some((a) => a.k === s.k && a.pid === s.pid)) { try { localStorage.removeItem(SESS); } catch (e) { /* ignore */ } ctx.toast('Your account was removed.', true); ctx.route(); }
    }

    // ---------- sign in / sign up page ----------
    function page() {
      const up = view.mode === 'up';
      $('#main').innerHTML = `<div class="auth-wrap"><section class="panel auth">
        <p class="eyebrow">Special Strike</p><h1>${up ? 'Create your account' : 'Sign in to play'}</h1>
        <p class="muted small">${up ? 'Pick a username and password. Your cards and leaderboard spot are saved to your account, so you can play on any device.' : 'You need an account to play. Your progress follows you to any device.'}</p>
        <div class="tabs" role="tablist"><button type="button" class="btn sm" role="tab" data-auth-tab="in" aria-pressed="${!up}">Sign in</button><button type="button" class="btn sm" role="tab" data-auth-tab="up" aria-pressed="${up}">Create account</button></div>
        <form id="auForm" novalidate>
          <label class="f">Username<input id="auUser" maxlength="20" autocomplete="username" autocapitalize="none" spellcheck="false" value="${esc(view.user)}"></label>
          <label class="f">Password<input id="auPass" type="password" autocomplete="${up ? 'new-password' : 'current-password'}"></label>
          ${up ? '<label class="f">Confirm password<input id="auPass2" type="password" autocomplete="new-password"></label>' : ''}
          <p class="auth-err" id="auErr" role="alert">${esc(view.err)}</p>
          <button class="btn primary" id="auGo" type="submit">${up ? 'Create account' : 'Sign in'}</button>
        </form></section></div>`;
      document.querySelectorAll('[data-auth-tab]').forEach((b) => (b.onclick = () => { view.mode = b.dataset.authTab; view.err = ''; view.user = $('#auUser').value; page(); }));
      $('#auForm').onsubmit = async (e) => {
        e.preventDefault(); if (view.busy) return;
        const u = $('#auUser').value, p = $('#auPass').value, p2 = up ? $('#auPass2').value : '', go = $('#auGo'), err = $('#auErr');
        view.user = u; view.busy = true; go.disabled = true; go.textContent = 'Please wait...'; err.textContent = '';
        try { if (up) await signUp(u, p, p2); else await signIn(u, p); view.err = ''; view.busy = false; location.hash = '#home'; ctx.route(); net.cycle(true); ctx.toast(up ? 'Account created. Welcome!' : 'Signed in'); return; }
        catch (ex) { view.err = ex.user ? ex.message : 'Something went wrong: ' + (ex.message || ex); err.textContent = view.err; }
        view.busy = false; go.disabled = false; go.textContent = up ? 'Create account' : 'Sign in';
      };
      const f = $(view.user ? '#auPass' : '#auUser'); if (f) f.focus();
    }

    // ---------- settings panel ----------
    function settingsHTML() {
      const s = session();
      return s ? `<section class="panel"><h2>Account 👤</h2><p class="muted small">Signed in as <b>${esc(s.u)}</b>. Your cards save to your account automatically.</p><p class="small" id="auDiag" role="status"></p><div class="row wrap"><button class="btn" id="auSync" type="button">Save to account now</button><button class="btn" id="auLogout" type="button">Log out</button></div></section>` : '';
    }
    function bindSettings() {
      const b = $('#auLogout'); if (b) b.onclick = async () => { b.disabled = true; b.textContent = 'Saving and logging out...'; await logOut(); };
      const y = $('#auSync'); if (y) y.onclick = async () => { y.disabled = true; const d = $('#auDiag'); d.textContent = 'Saving...'; try { d.textContent = await net.diag(); } catch (e) { d.textContent = 'Failed: ' + (e.message || e); } y.disabled = false; };
    }

    return { loggedIn: loggedIn, session: session, page: page, logOut: logOut, watch: watch, settingsHTML: settingsHTML, bindSettings: bindSettings };
  };
})();
