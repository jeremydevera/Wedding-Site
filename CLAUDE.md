# Project notes for Claude

## 🔴 CRITICAL — demo.celebrately.us is the client-facing demo
`demo.celebrately.us` is what the owner shows to prospective clients. **It MUST reflect every change.**

- These hosts are **ONE** Cloudflare Pages deployment. **Project name = `wedding-site`**
  (the `wedding-site-8nh` you see is the *subdomain*, not the project name — using it as the
  project name in the CF API returns `8000007 Project not found`). CF account id
  `4acf69efbeed54838dc0d5f004769933` (Jeremydevera03@gmail.com). Hosts:
  `demo.celebrately.us`, `www.celebrately.us`, `celebrately.us`, `wedding-site-8nh.pages.dev`.
  → A change deployed to the project is automatically live on **all** of them. There is no separate "demo" build.
- 🔴 **Do NOT verify deploys by matching the LOCAL build hash to the served hash — they DON'T match.**
  Cloudflare does a clean install and bakes in its own build-time env (Supabase vars, etc.), so the
  same commit builds to a **different** `index-*.js` hash on CF than `npm run build` does locally.
  Polling for your local hash will loop forever even though the deploy succeeded. (This wasted real time.)
  **Verify the deploy via the CF Pages API instead** — confirm the latest deployment's *commit* and stage
  status, using the `cloudflare-api` MCP `execute`:
  `GET /accounts/{accountId}/pages/projects/wedding-site` → `result.latest_deployment` →
  check `deployment_trigger.metadata.commit_hash` == your pushed commit and `stages[].status` all `success`.
  Then confirm **behavior/marker strings** in the served bundle (e.g. `curl -s <host>/assets/index-*.js | grep <marker>`),
  NOT the hash. All hosts serving the *same* hash as each other is still a good consistency check.
- If demo looks stale, it is almost always **browser cache** (there is **no service worker**). Hard-refresh
  (Cmd+Shift+R) or use an incognito window before assuming the deploy failed.

## Domains / redirects — do NOT repeat past mistakes
- A `*.pages.dev → custom domain` redirect via a **Pages Function is impossible here and WILL take the site
  down.** The Function receives the `wedding-site-8nh.pages.dev` host even for `demo.celebrately.us` requests,
  so any host-based redirect loops the custom domain (`ERR_TOO_MANY_REDIRECTS`). This was tried twice and
  broke prod both times. **Do not re-attempt.**
- `http → https` is handled by the celebrately.us zone setting **SSL/TLS → Edge Certificates → Always Use
  HTTPS** (it's ON). That keeps the host (http://demo → https://demo), it does NOT jump to pages.dev.
- `poseandclick.it.com` is a **separate, unrelated** Cloudflare zone — never touch it.

## Deploy workflow
- Build: `npm run build`. Tests: `npm test` (vitest, 51 tests). Cloudflare Pages auto-builds on push to `main`.
- "Deploy always": after build + tests pass, auto commit + push approved changes to `main` (no per-change confirm). End commit messages with the Co-Authored-By trailer. Stage ONLY this change's files.
- Verify via the **CF Pages API** (commit + stage status), NOT the local bundle hash — see the 🔴 note above. Then grep a behavior marker in the served bundle. All hosts serving the same hash as each other is a fine consistency check.

## Mobile pinned headers — use a flex-scroll shell, NOT position:fixed/sticky
Under `html/body { overflow-x: clip }`, BOTH `position: sticky` AND `position: fixed` fail on the user's browsers — sticky scrolls away; **fixed detaches and VANISHES on iOS Safari** (confirmed iPhone 17 Pro). Adding `transform: translateZ(0)`/`backface-visibility` to a fixed bar makes it worse (iOS drops the composited layer while the URL bar animates).
- **The working fix (verified, user-confirmed):** pin by LAYOUT, not positioning. Make the shell a full-height flex column where only the inner body scrolls; the header is an in-flow flex child OUTSIDE the scroll box, so it can't move. Mobile admin (`@media max-width:860px`): `.admin { height:100dvh; overflow:hidden; flex-direction:column }`, `.admin__main { display:flex; flex-direction:column; flex:1; min-height:0; overflow:hidden }`, `.admin__head { position:static; flex:none }`, `.admin__body { flex:1 1 auto; min-height:0; overflow-y:auto }`.
- Fixed children (drawer, saving overlay, modals) still float over everything — `.admin` has no transform, so its `overflow:hidden` doesn't clip fixed descendants. Use `100dvh` (not `100vh`) for the iOS toolbar.
- Don't re-introduce `position:fixed`/`sticky` for mobile pinned headers, and don't add `transform`/`will-change`/`filter` to an ancestor of a fixed element (creates a containing block → fixed breaks).
