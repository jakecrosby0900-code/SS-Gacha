// Usage: node tools/fetch-images.mjs   (Node 18+). Downloads each character's lead image from the Special Strike wiki.
// Names the wiki calls something else? Add them to tools/overrides.json, e.g. { "SSR:Bon": "Bon (Special Strike)" }
import fs from 'fs'; import vm from 'vm';
const WIKI = 'https://special-strike.fandom.com/api.php';
const ctx = { window: {} }; vm.runInNewContext(fs.readFileSync('js/data.js', 'utf8'), ctx);
const cards = ctx.window.SSG.CARDS;
const over = fs.existsSync('tools/overrides.json') ? JSON.parse(fs.readFileSync('tools/overrides.json', 'utf8')) : {};
const current = fs.existsSync('js/images.js') ? {} : {};
fs.mkdirSync('images/cards', { recursive: true });
const api = async (q) => (await fetch(WIKI + '?format=json&origin=*&' + q)).json();
async function findImage(title) {
  let r = await api('action=query&redirects=1&prop=pageimages&piprop=thumbnail&pithumbsize=500&titles=' + encodeURIComponent(title));
  let p = Object.values(r.query?.pages || {})[0]; if (p?.thumbnail) return p.thumbnail.source;
  r = await api('action=query&generator=search&gsrlimit=1&prop=pageimages&piprop=thumbnail&pithumbsize=500&gsrsearch=' + encodeURIComponent(title));
  p = Object.values(r.query?.pages || {})[0]; return p?.thumbnail?.source;
}
const map = {}, byName = {}, missed = [];
for (const c of cards) {
  const title = over[c.id] || c.id.split(':')[1];
  try {
    let url = byName[title] ?? (byName[title] = await findImage(title));
    if (!url) { missed.push(c.id); continue; }
    const ext = (url.match(/\.(png|jpe?g|webp|gif)/i) || [, 'png'])[1].toLowerCase();
    const file = 'images/cards/' + c.id.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, '') + '.' + ext;
    const res = await fetch(url); fs.writeFileSync(file, Buffer.from(await res.arrayBuffer())); map[c.id] = file;
    console.log('ok  ', c.id);
  } catch (e) { missed.push(c.id); }
}
fs.writeFileSync('js/images.js', '// Written by tools/fetch-images.mjs\nwindow.SSG_IMAGES = ' + JSON.stringify(map, null, 2) + ';\n');
console.log('\nDone: ' + Object.keys(map).length + ' images. No image found for:\n' + missed.join('\n'));
