// One-off clean-up for the switch to Discord sign-in.
// Closes every GitHub issue that belongs to an OLD (username/password) account or to a player that has no Discord account:
//   account issues without a Discord id, player saves, trades, board posts, code redemptions and gifts tied to them.
// Never touches the admin config ("config") or uploaded card pictures ("cardimg"), and never touches Discord accounts or their saves.
//
// Usage (Node 18+):
//   GITHUB_TOKEN=<token with Issues: read & write on the repo> node tools/purge-old-accounts.mjs owner/repo          (dry run: only prints what it would close)
//   GITHUB_TOKEN=<token> node tools/purge-old-accounts.mjs owner/repo --yes                                         (really closes them)
const repo = process.argv[2], yes = process.argv.includes('--yes'), token = process.env.GITHUB_TOKEN;
if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo) || !token) { console.error('Usage: GITHUB_TOKEN=... node tools/purge-old-accounts.mjs owner/repo [--yes]'); process.exit(1); }
const H = { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const ID = /^[a-z0-9]{6,40}$/, isDiscord = (b) => b && b.t === 'account' && b.v === 2 && /^\d{15,19}$/.test(b.did || '') && ID.test(b.pid || '');

let issues = [];
for (let page = 1; ; page++) {
  const r = await fetch(`https://api.github.com/repos/${repo}/issues?state=open&per_page=100&page=${page}`, { headers: H });
  if (!r.ok) { console.error('GitHub API error', r.status, await r.text()); process.exit(1); }
  const raw = await r.json(); issues = issues.concat(raw.filter((i) => !i.pull_request));
  if (raw.length < 100) break;
}
const rows = issues.map((i) => { let b = null; try { b = JSON.parse(i.body); } catch { /* not a game issue */ } return { i, b }; });
const keepPids = new Set(), keepKeys = new Set();
for (const { b } of rows) if (isDiscord(b)) { keepPids.add(b.pid); keepKeys.add('d' + b.did); }

const doomed = [];
for (const { i, b } of rows) {
  if (!b || typeof b !== 'object') continue;
  let why = null;
  if (b.t === 'account') { if (!isDiscord(b)) why = 'old account'; }
  else if (b.t === 'player') { if (!keepPids.has(b.id)) why = 'player with no Discord account'; }
  else if (b.t === 'trade') { const f = (b.from || {}).id, t = (b.to || {}).id; if (!keepPids.has(f) || !keepPids.has(t)) why = 'trade with a removed player'; }
  else if (b.t === 'board') { if (!keepPids.has(b.pid)) why = 'board post of a removed player'; }
  else if (b.t === 'redeem') { if (!keepPids.has(b.pid)) why = 'code redeemed by a removed player'; }
  else if (b.t === 'grant') { if (b.k !== '*' && !keepKeys.has(String(b.k).toLowerCase())) why = 'gift for a removed account'; }
  if (why) doomed.push({ n: i.number, title: String(i.title).slice(0, 60), why });
}
const by = {}; doomed.forEach((d) => { by[d.why] = (by[d.why] || 0) + 1; });
console.log(`${issues.length} open issues, ${keepPids.size} Discord account(s) kept.`);
console.log(doomed.length ? 'To close:' : 'Nothing to close.'); Object.entries(by).forEach(([k, v]) => console.log(`  ${v} x ${k}`));
if (!yes) { doomed.slice(0, 15).forEach((d) => console.log(`   #${d.n} ${d.title}`)); if (doomed.length) console.log('\nDry run only. Re-run with --yes to close them.'); process.exit(0); }
let ok = 0;
for (const d of doomed) {
  const r = await fetch(`https://api.github.com/repos/${repo}/issues/${d.n}`, { method: 'PATCH', headers: H, body: JSON.stringify({ state: 'closed', state_reason: 'not_planned' }) });
  if (r.ok) ok++; else console.error(`#${d.n} failed: ${r.status}`);
  await new Promise((res) => setTimeout(res, 350));
}
console.log(`Closed ${ok} of ${doomed.length}.`);
