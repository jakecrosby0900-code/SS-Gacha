// Online setup. All optional: the game works fully offline without it.
//
// repo:      "owner/name" of this GitHub repo. Leave empty to auto-detect from the GitHub Pages address
//            (https://owner.github.io/name/).
// tokenEnc:  a shared GitHub token that every visitor uses to publish their profile and trade. Create it with
//            `node tools/encode-token.mjs <your-token>` and paste the printed array here. See README, "Online setup".
//            Anyone can read it from the page source, so only ever use a fine-grained token limited to this repo's Issues.
// Players can also paste their own token in Settings instead, which overrides this one.
window.SSG_NET = {
  repo: '',
  tokenEnc: []
};
