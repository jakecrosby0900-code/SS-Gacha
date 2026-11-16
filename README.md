# Special Strike Gacha
Open `index.html` (or run `python3 -m http.server` and visit localhost:8000). Everything saves in your browser's local storage.

## Card images (optional)
With Node 18+: `node tools/fetch-images.mjs`. It downloads each character's main image from the Special Strike wiki into `images/cards/` and writes `js/images.js`.
Cards it can't find keep the generated art; add the wiki page title to `tools/overrides.json` and rerun.
