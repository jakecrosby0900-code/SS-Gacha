// Online setup. All optional: the game works fully offline without it.
//
// repo:      "owner/name" of this GitHub repo. Leave empty to auto-detect from the GitHub Pages address
//            (https://owner.github.io/name/).
// tokenEnc:  a shared GitHub token that every visitor uses to publish their profile and trade. Create it with
//            `node tools/encode-token.mjs <your-token>` and paste the printed array here. See README, "Online setup".
//            Anyone can read it from the page source, so only ever use a fine-grained token limited to this repo's Issues.
// Players can also paste their own token in Settings instead, which overrides this one.
window.SSG_NET = {
  repo: 'jakecrosby0900-code/SS-Gacha',
  // All requests go to this Cloudflare Worker, which stores everything in a Cloudflare D1 database (no GitHub token involved).
  api: 'https://ssg-api.optimusswine09.workers.dev',
  // Placeholder only (the word "placeholder"). The site needs some value here to switch on online features; the Worker ignores it.
  tokenEnc: ["bGRlcg==","cGxhY2Vobw=="]
};

// Discord sign-in (see README, "Sign in with Discord").
// clientId: the "Client ID" of your Discord application (discord.com/developers/applications > your app > OAuth2). It is public, so it is safe here.
//           Never put the Client Secret anywhere on this site.
// redirect: leave empty to use this page's own address. Whatever it is, the exact same address must be added under OAuth2 > Redirects.
window.SSG_DISCORD = { clientId: '1573467424521457815', redirect: '' };
