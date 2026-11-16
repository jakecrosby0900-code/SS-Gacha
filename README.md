# Special Strike Gacha
Open `index.html` (or run `python3 -m http.server` and visit localhost:8000). Everything saves in your browser's local storage.

## Card images (optional)
With Node 18+: `node tools/fetch-images.mjs`. It downloads each character's main image from the Special Strike wiki into `images/cards/` and writes `js/images.js`.
Cards it can't find keep the generated art; add the wiki page title to `tools/overrides.json` and rerun.

## Editing the game
- `js/data.js`: cards, `POINTS` per rarity, the `MONSTER` set (only drops with the monster on), `MONSTER_CHANCE`, and pack `CODES`.
- The profile (name, picture, banner) and used codes live in the save file.

## Online setup (leaderboard, profiles, trading, cloud save)
Everything online runs through GitHub Issues, so there is no server. The game works offline without any of this.

1. Make sure Issues are enabled on the repo (Settings > Features) and the site runs on GitHub Pages.
2. Create a token: GitHub > Settings > Developer settings > Fine-grained tokens > Generate. Repository access: **only this repo**. Permissions: **Issues: Read and write**. Nothing else.
3. Put it in the site, either way:
   - Shared (easiest for friends): run `node tools/encode-token.mjs <token>` and paste the printed `tokenEnc: [...]` line into `js/config.js`. Everyone who opens the site then uses it automatically.
   - Personal: each player pastes their own token in Settings > Online.
4. Move `.github/workflows/leaderboard.yml` to the repo's top-level `.github/workflows/` if your site is in a subfolder (and set its `working-directory`). It refreshes `data/leaderboard.json` every 15 minutes, which is what people without a token see.

What it does: while the site is open it publishes your profile and collection to your own "player:..." issue about every 60 seconds. The Players page lists everyone, with search and profiles. Trades are "trade:..." issues; the offered cards are held until the other player answers.
Anyone with the token can edit any issue, so this is built for friends, not for security.
