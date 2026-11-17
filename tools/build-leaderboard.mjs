// Run by the GitHub Action: reads every player issue and writes data/leaderboard.json (a read-only snapshot of the leaderboard).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
globalThis.window = {};
await import(path.join(root, 'js/data.js'));
const G = window.SSG;
const repo = process.env.GITHUB_REPOSITORY, token = process.env.GITHUB_TOKEN;
if (!repo) { console.error('GITHUB_REPOSITORY is not set'); process.exit(1); }
const headers = { Accept: 'application/vnd.github+json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
let issues = [];
for (let page = 1; page <= 10; page++) {
  const r = await fetch(`https://api.github.com/repos/${repo}/issues?state=open&per_page=100&page=${page}`, { headers });
  if (!r.ok) { console.error('GitHub API error', r.status); process.exit(1); }
  const list = await r.json(); issues = issues.concat(list.filter((i) => !i.pull_request)); if (list.length < 100) break;
}
// Admin settings (cards added or edited, players removed from the leaderboard) live in one "config" issue; apply them first.
let cfgIssue = null; const cardImgs = {};
for (const i of issues) {
  let b; try { b = JSON.parse(i.body); } catch { continue; }
  if (b && b.t === 'config' && (!cfgIssue || i.number < cfgIssue.number)) cfgIssue = { number: i.number, b };
}
G.applyConfig(cfgIssue ? cfgIssue.b : null, cardImgs);
const BYID = G.BYID, blocked = new Set(G.getConfig().blocked.map((x) => x.id));
const seen = {}, players = [];
for (const i of issues.sort((a, b) => a.number - b.number)) {
  let b; try { b = JSON.parse(i.body); } catch { continue; }
  if (!b || b.t !== 'player' || !/^[a-z0-9]{6,40}$/.test(b.id || '') || seen[b.id] || blocked.has(b.id)) continue;
  seen[b.id] = 1;
  let score = 0, unique = 0, skibidi = 0, best = null;
  for (const [id, a] of Object.entries(b.cards || {})) {
    const c = BYID[id]; if (!c || !(a[0] > 0)) continue;
    unique++; score += c.pts; if (a[1] > 0) skibidi++;
    if (!best || c.ti > best.ti || (c.ti === best.ti && c.rank < best.rank)) best = c;
  }
  players.push({ id: b.id, name: String(b.name || 'Player').slice(0, 20), hue: b.hue, pfp: typeof b.pfp === 'string' && b.pfp.length < 30000 ? b.pfp : null,
    joined: b.joined, seen: b.seen, opened: b.opened || 0, score, unique, skibidi, rarest: best ? best.name : null });
}
players.sort((a, b) => b.score - a.score);
const file = path.join(root, 'data/leaderboard.json');
const next = JSON.stringify({ players }, null, 1);
const prev = fs.existsSync(file) ? JSON.stringify({ players: JSON.parse(fs.readFileSync(file, 'utf8')).players }, null, 1) : '';
if (next !== prev) fs.writeFileSync(file, JSON.stringify({ updated: Date.now(), players }, null, 1) + '\n');
console.log(`${players.length} players`);
