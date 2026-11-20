# Special Strike Gacha
Open `index.html` (or run `python3 -m http.server` and visit localhost:8000). Players must sign in or create an account to play. Progress saves in the browser and, through the account, online.

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

What it does: while the site is open it publishes your profile and collection to your own "player:..." issue about every 60 seconds. The Leaderboard page lists everyone, with search and profiles. Trades are "trade:..." issues; the offered cards are held until the other player answers.
Anyone with the token can edit any issue, so this is built for friends, not for security.

## Accounts (sign in / sign up)
Nobody can play until they are signed in (`js/auth.js`). Accounts use the same GitHub Issues setup as the leaderboard, so the online setup above must be working.
- Each account is an issue titled `account:<username>` holding the username, a salt and a PBKDF2 hash of the password. The password itself is never stored.
- Your save uploads to your account a few seconds after every change (and when you close the tab). Signing in on a new device, or after clearing site data, loads it back. If two devices changed things, the saves are merged and no card is lost.
- Players who already had progress keep it: when they create an account on their device, that save becomes the account's save. Signing in on another device loads the account's last published save.
- Limits: this is a client-side gate, and the hashes are readable by anyone who can read the repo's issues. Fine for a friends game, not for anything sensitive.

## Admin page
Settings > Admin: log in with the admin username and password, then open the Admin page (`js/admin.js`). It can:
- list every account with its leaderboard stats: give it cards or packs, or take away chosen cards or all of them, change the packs-opened number, (applied the next time that player is online), remove it from the leaderboard, restore it (or restore everyone at once), or delete it,
- add custom rarities (name, colour, points, drop weight, where it sits in the order) and custom sets,
- add new cards and edit **any** card (built-in or custom): name, set, rarity, points, drop-weight multiplier or an exact chance per slot, skibidi chance, on/off, picture; tick several cards to change rarity/set/weight/on-off in bulk, or edit rarity/set inline in the list,
- edit every rarity and set (colour, points, drop weight, set colour/blurb), with Reset for built-in ones,
- post announcements (a dismissible banner for everyone), see an activity log of admin actions and code redemptions,
- create pack codes (packs and/or cards, optional max uses and expiry) in the Codes tab,
- start **power hours** (more-likely cards or higher skibidi chance for a set time; players see a banner), set the skibidi points multiplier, give a gift to everyone, back up / restore settings, and undo the last change.

Scoring: every copy counts, a skibidi copy is worth the multiplier (default 2x). Monster cards use their rarity's normal drop weight while the monster is enabled.

Changes are saved online (a `config:game` issue, plus one `cardimg` issue per uploaded picture), so every player sees them. Do not close or edit those issues by hand. The leaderboard Action reads the config too, so removed players stay off `data/leaderboard.json`.
The admin login is stored only as a salted hash in `js/admin.js`. To change it, run this in Node and paste the new `salt` and `hash` into `ADMIN`:
`node -e "const c=require('crypto');const s=c.randomBytes(16);console.log(s.toString('base64'),c.pbkdf2Sync('USER\\nPASSWORD',s,150000,32,'sha256').toString('base64'))"`
This check runs in the browser, so it keeps normal players out but is not real security (see the note on the shared token above).

## Releasing an update
Open tabs check `version.json` every couple of minutes and reload themselves when its number is higher than the `VERSION` constant in `js/app.js`. When you publish a new version, raise `VERSION` in `js/app.js` and `v` in `version.json` to the same new number (and the `?v=` on the script tags in `index.html` so browsers fetch fresh files).
