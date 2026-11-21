# Special Strike Gacha
Open `index.html` (or run `python3 -m http.server` and visit localhost:8000). Players must sign in with Discord to play. Progress saves in the browser and, through the account, online.

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

## Accounts (Sign in with Discord)
Nobody can play until they are signed in (`js/auth.js`). Sign-in uses Discord and needs no server. The online setup above must be working, because accounts live in GitHub Issues.
- Each account is an issue titled `account:d<discord id>` holding the Discord ID, the Discord name at sign-up and the ID of the player's save. There are no passwords.
- The first time someone signs in, an account is made and their profile starts with their Discord name and avatar. Both can still be changed in Edit profile; signing in again never overwrites them.
- Your save uploads to your account a few seconds after every change (and when you close the tab). Signing in on a new device, or after clearing site data, loads it back. If two devices changed things, the saves are merged and no card is lost.
- Limits: this is a client-side gate. The page, not a server, decides who you are, so someone technical can pretend to be another Discord user. Fine for a friends game, not for anything sensitive. The Discord token is only used once to read the profile (ID, name, avatar) and is never stored.

### Setting up Discord sign-in
1. Go to https://discord.com/developers/applications > **New Application**.
2. Open **OAuth2**. Copy the **Client ID** into `js/config.js` (`window.SSG_DISCORD.clientId`). Never put the Client Secret on the site; it is not needed.
3. Under **OAuth2 > Redirects** add the exact address of the site, for example `https://yourname.github.io/SS-Gacha/` (with the trailing slash). For local testing also add `http://localhost:8000/`. If the address differs from the page's own, set it in `SSG_DISCORD.redirect`.
4. Publish. The Discord button shows on the sign-in page.

### Retiring the old username/password accounts (v27)
- Old accounts are ignored by the site, their sessions are signed out, and players without a Discord account are hidden from the leaderboard. `data/leaderboard.json` was reset and is rebuilt by the Action, which also only lists Discord players.
- Old progress is not carried over: everyone starts a fresh Discord account. (A device that never had an account keeps its local progress when its owner signs in with Discord for the first time.)
- To also close the old issues, run once: `GITHUB_TOKEN=<token with Issues read & write> node tools/purge-old-accounts.mjs owner/repo` (prints what it would close), then add `--yes` to do it. It never touches Discord accounts, the admin config or card pictures.

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

## v16 notes
- Home has the code box, collection progress, recent/rarest rows and community feeds.
- Opening several packs at once slices open a stack; the home pile shows how many packs you hold.
- Trades and the board use the same variant-aware card picker (normal / skibidi).
- New **Monster** rarity (a little rarer than Sigma) and an updated roster (ROTA and HORROR sets added).

## v17 notes
- Home timer is back to the circular ring.
- Profile: banner no longer covers the name/bio.
- Skibidi holo foil is a soft sheen that keeps the artwork's contrast.
- Showcase replaced by a **Best cards** row (your 7 most valuable) at the bottom of every profile; pick favourites via Favorite cards.

## v18 notes
- Packs are now 3D foil pouches with crimped edges and a moving holo sheen; they tilt with your pointer on the home page and on the opening screen.

## v19 notes
- Opening a stack of packs shows a fanned deck with shadows.

## v27 notes
- Sign in with Discord replaces usernames and passwords. Old accounts are retired (see Accounts).
- Skibidi holo foil now covers the whole card, including the top and bottom strips.

## v28 notes
- Click any badge on a profile for details: what it is for, your current progress, what is needed for the next level and every level's target.
- Best cards row has room around it, so a hovered card is no longer clipped.
- The profile rank sits under the picture instead of over it.

## v29 notes
- **Quiet refreshes**: background syncs redraw without the entrance animation, keep your scroll position and never interrupt typing. Updates no longer reload the page by themselves: a small "A new version is out. Refresh" bar appears instead.
- **Stays signed in**: an account is only treated as deleted if it is missing from several complete listings over 3+ minutes, and a save that lost its account link is re-attached instead of signing you out.
- **Card close-up**: in the card popup, click any copy to see it large (arrows or the on-screen buttons step through copies). Each copy shows what it is worth.
- **Dupes**: the Nth copy of a card is worth 1/N of the first (skibidi copies are counted first).
- **Pack opening**: the pack tears, light bursts out, the cards jump out backs-first, land face down and flip one at a time. Card size no longer changes on hover while opening, and the layout no longer shifts (scrollbar gutter, reserved label space).
- **Monster**: every card in the MONSTER set is of the Monster rarity, and *Ess Ess Gee* was added. Monster cards still only drop (or arrive from codes/gifts) while the monster is let in.
- **Admin**: rename rarities and sets (every reference is updated); drag sets (or use arrow keys on the handle) to change their Index order; the two old built-in codes (SIGMA, MGJ) are moved into the editable Codes list the first time the admin page opens, so they can be deleted.
- **Notifications** (bell in the header): trade offers, counter-offers, answers to your offers, friend requests and answers, messages, comments on your board posts, new badges, power hours, admin gifts and image decisions.
- **Friends** (More > Friends): add players, accept/decline, message friends (comments on a `friend:` issue), remove friends. **Board comments**: every board post has a comments thread.
- **Card image requests**: Settings > Request a card image. Admin > Image requests shows each picture next to the card; Approve makes it the card's picture for everyone.
- **Whitelist**: accounts made after `WL_START` in `js/data.js` see a "Waiting for approval" page until the admin approves them (Admin > Players > Waiting for approval). Older accounts are let in automatically; "Revoke access" in an account's menu removes access. The admin can sign in from the waiting page ("I am the admin"). Like everything here this is a client-side gate, fine for a friends game, not real security. Pending players are not uploaded or listed on the leaderboard.

## v30 notes
- **Scoring**: Common 10, Uncommon 30, Rare 100, Epic 300, Legendary 1000, Mythic 3000, Sigma 5000, Monster 6000, Good Luck 10000. Skibidi = 3x. Duplicates still give 1/N. The leaderboard is worked out from everyone's cards, so it follows the new system automatically (weekly baselines from the old scale are ignored). The points badge is gone from cards.
- **Good Luck rarity + Goofy Silly set**: every Sigma except *Split Sparky Doo* and *Wall* moved there (ids unchanged). Each Good Luck card is 10x rarer than a Monster card (0.00125 vs 0.0125 weight).
- **Card page**: click a card for the big draggable 3D card with Flip / Reset and its details. Several copies = a Normal/Skibidi switch plus per-copy values. 3D tilt now works on every card.
- **Packs**: the tear peels the top strip up slice by slice along your drag (glowing crack, sparks, glowing opening) and then tears into pieces. Glow/flash sit behind the pack. Multi-pack opens use the same jump-out animation, then cut to the results. The last card's flip is animated explicitly (no more snapping after the shake). Summary cards only fade in (no scale), so none can be stuck small.
- **Holo**: foil/shine now overlay the picture with normal blending, so blacks and whites show it too.
- **Card names** shrink to fit the card.
- **Admin**: delete built-in cards (with a Restore list), reset one account or everyone to 0 (applied on each device's next sync, and the leaderboard shows zeros immediately), clear the Community rare pulls / Recent trades lists, drag or use arrows to order sets, review card image requests and **card suggestions** (new cards and sets). Request limits removed.
- **Account menu** (top right) replaces the Profile, Friends and Settings tabs. **Messages dock** (round button bottom right) holds friend chats and **group chats** (a group is an issue; messages are comments). Notifications are a dropdown; read ones clear ~12s after being read.
- **Faster multiplayer**: the game polls every ~5s using incremental `since=` reads (full read every 3 min), automatically slowing down if the shared GitHub token's rate limit runs low.

## v31 notes
- Removed the header mute button (sound is still in Settings).
- Card backs have a real design: lattice, gold frame, corner studs, emblem and SPECIAL STRIKE wordmark.
- Admin > Overview > Trade board: delete any board post.
- Suggest a card page rebuilt in 3 steps with a live card preview and rarity chips.
- Pack tear: the glowing opening now fills the whole top strip.

## v32 notes
- Tear opening trimmed to fit the pack top (a little smaller than v31).

## v33 notes
- Tear opening resized and lowered to sit in the strip.

## v34 notes
- Tear opening trimmed by a few pixels.

## v35 notes
- Tear opening spans the full pack width.

## v36 notes
- Tear opening measured against the strip: stays inside it on every side.

## v37 notes
- Tear opening bottom edge sits exactly on the pack body top.

## v38 notes
- Tear opening top edge lowered.

## v39 notes
- Closed the hairline gap between the tear opening and the pack body.

## v40 notes
- Fixed the card-back design staying on cards after they flip in the pack opening.
- The spinning card in the card page has real thickness (edge layers).

## v41 notes
- Card page 3D rebuilt as a real slab: front/back faces, four edge faces, moving glare and a floor shadow.
- Cards, packs and the opening screen can no longer be text-selected by dragging.

## v42 notes
- Card page 3D: the card rim follows the rounded corners (outline extruded in short segments with baked lighting), so it reads as a real thick card.

## v43 notes
- Card rim: only outward-facing segments are drawn (back sides hidden), which removes the stray tab at the corners.

## v44 notes
- Card rim corners use 16 segments with overlap, so no seam lines show on the bevels.

## v45 notes
- Card page 3D: the card's rim is now drawn in the card's rarity colour (Mythic red, Legendary gold, Sigma white, custom rarities use their own colour), with the same baked lighting as before.
- Card page 3D: a card you do not own (for example in the Index) is grey all over: front, back and rim.
- Pack opening: the flip is smooth again. The v40 rule that hides the card back now waits until the card has turned past edge-on (0.15s) instead of hiding it on the first frame, which had left an empty card for the first part of the turn.

