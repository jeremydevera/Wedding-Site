# Project notes for Claude

## 🔴 CRITICAL — demo.celebrately.us is the client-facing demo
`demo.celebrately.us` is what the owner shows to prospective clients. **It MUST reflect every change.**

- These hosts are **ONE** Cloudflare Pages deployment (project `wedding-site-8nh`):
  `demo.celebrately.us`, `www.celebrately.us`, `celebrately.us`, `wedding-site-8nh.pages.dev`.
  → A change deployed to the project is automatically live on **all** of them. There is no separate "demo" build.
- **After every deploy, VERIFY on `https://demo.celebrately.us`** (not only the pages.dev URL).
  Confirm the served bundle hash and/or the actual behavior on demo, e.g.:
  `curl -s https://demo.celebrately.us/ | grep -oE '/assets/index-[^"]+\.js'`
  and compare to the same on `wedding-site-8nh.pages.dev`.
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
- Build: `npm run build`. Tests: `npm test` (vitest, 41 tests). Cloudflare Pages auto-builds on push to `main`.
- Only deploy on explicit user instruction. End commit messages with the Co-Authored-By trailer.
- Verify by polling the served bundle hash on **both** demo.celebrately.us and wedding-site-8nh.pages.dev.
