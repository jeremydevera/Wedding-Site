# Feature Permissions v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One per-client None/View/Edit table replaces Features + Access, with each module's home-page presence controlled inside its own admin tab — live only on the `accessV2`-flagged sandbox client; every legacy client's behavior byte-identical.

**Architecture:** A single resolver `featureLevel(settings, key)` in `src/lib/roles.js` is the only permission authority. It reads the new `content.features` map when `settings.accessV2 === true` and *derives* the identical legacy answer from `modules` + `ownerEdit` otherwise, so every consumer (guest nav, routes, home sections, owner tabs, superadmin table) switches through one function. All UI restructuring (promoted tabs, "Home section" panels, slimmed Settings) renders only under the flag.

**Tech Stack:** React SPA (Vite), vitest + @testing-library/react, existing Store (`src/lib/store.jsx`), Supabase content JSON per client, Playwright for live verification.

**Spec:** `docs/superpowers/specs/2026-07-11-feature-permissions-v2-design.md`

**Hard rule for every task:** run the FULL suite (`npm test`) before each commit — all pre-existing tests must pass untouched except where a task explicitly says it updates a test. That is the "no legacy behavior change" proof.

---

## File map

| File | Role in this plan |
|---|---|
| `src/lib/roles.js` | + `FEATURE_DEFAULTS`, `FEATURE_ROWS`, `featureLevel()`, `featureVisible()` |
| `src/lib/__tests__/featureLevel.test.js` | NEW — resolver unit tests (both models) |
| `src/lib/store.jsx` | + defaults `accessV2: false`, `features: null` |
| `src/app/App.jsx` | guest nav + route gating via `featureVisible` |
| `src/pages/PublicPages.jsx` | home sections gated via `featureVisible` (legacy-identical) |
| `src/admin/manage.jsx` | owner tab visibility, promoted Music/Entourage tabs, `HomeSectionPanel`, Home-tab slimming, Details+Attire, Settings folders |
| `src/admin/superadmin.jsx` | AccessFields v2 table (Edit client + request editor) |
| `src/admin/__tests__/accessV2.test.jsx` | NEW — tab visibility + settings folders under the flag |
| `docs/WEDDING-STATUS.md` | note that 0012 is superseded by this work |

---

### Task 1: Resolver — `featureLevel` in roles.js

**Files:**
- Modify: `src/lib/roles.js` (append after `moduleEnabled`, ~line 118)
- Test: `src/lib/__tests__/featureLevel.test.js` (create)

- [ ] **Step 1: Write the failing tests**

```js
// src/lib/__tests__/featureLevel.test.js
import { describe, it, expect } from "vitest";
import { featureLevel, featureVisible, FEATURE_DEFAENTS as _ignore } from "@/lib/roles.js"; // (import check below)
import { featureLevel as fl, FEATURE_DEFAULTS } from "@/lib/roles.js";

describe("featureLevel — accessV2 model", () => {
  const s = (features, extra = {}) => ({ accessV2: true, features, ...extra });

  it("reads explicit levels from the features map", () => {
    expect(fl(s({ story: "view" }), "story")).toBe("view");
    expect(fl(s({ music: "edit" }), "music")).toBe("edit");
    expect(fl(s({ quiz: "none" }), "quiz")).toBe("none");
  });

  it("falls back to the new-client defaults for absent keys", () => {
    expect(fl(s({}), "story")).toBe("none");
    expect(fl(s({}), "music")).toBe("none");
    expect(fl(s({}), "details")).toBe("edit");
    expect(fl(s({}), "home")).toBe("edit");
  });

  it("clamps home to at least view (landing page always renders)", () => {
    expect(fl(s({ home: "none" }), "home")).toBe("view");
  });

  it("rsvp is always edit; kill-switched modules are always none", () => {
    expect(fl(s({ }), "rsvp")).toBe("edit");
    expect(fl({ accessV2: false }, "rsvp")).toBe("edit");
    expect(fl(s({ gallery: "edit" }), "gallery")).toBe("none");
  });

  it("ignores junk values in the map (falls back to default)", () => {
    expect(fl(s({ details: "banana" }), "details")).toBe("edit");
  });
});

describe("featureLevel — legacy derivation (no flag) matches today", () => {
  it("module off -> none", () => {
    expect(fl({ modules: { story: false } }, "story")).toBe("none");
  });
  it("module on + grant on -> edit; grant off -> view", () => {
    expect(fl({ modules: { venue: true }, ownerEdit: { venue: true } }, "venue")).toBe("edit");
    expect(fl({ modules: { venue: true }, ownerEdit: {} }, "venue")).toBe("view");
  });
  it("grantless modules (guestbook/quiz) on -> edit (owners get those tabs today)", () => {
    expect(fl({ modules: { guestbook: true } }, "guestbook")).toBe("edit");
    expect(fl({ modules: {} }, "quiz")).toBe("edit"); // absent module key = on
  });
  it("non-module home folders follow their ownerEdit grant", () => {
    expect(fl({ ownerEdit: { music: true } }, "music")).toBe("edit");
    expect(fl({ ownerEdit: {} }, "music")).toBe("view");
    expect(fl({ ownerEdit: { entourage: true } }, "entourage")).toBe("edit");
  });
  it("featureVisible is level !== none", () => {
    expect(featureVisible({ modules: { story: false } }, "story")).toBe(false);
    expect(featureVisible({ modules: {} }, "details")).toBe(true);
  });
});
```

(Drop the first import line with `FEATURE_DEFAENTS` — it's shown only to say: import exactly `featureLevel`, `featureVisible`, `FEATURE_DEFAULTS`.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/__tests__/featureLevel.test.js`
Expected: FAIL — `featureLevel` is not exported.

- [ ] **Step 3: Implement in roles.js**

Append after the `moduleEnabled` block:

```js
// ── Feature Permissions v2 (spec: docs/superpowers/specs/2026-07-11-…) ──────
// One level per module per client: none | view | edit.
//   none  → not on the guest site, no owner tab
//   view  → live on the guest site, NO owner tab (superadmin does the CRUD)
//   edit  → owner gets the tab (full CRUD + "Home section" panel)
// RSVP is core → always "edit". Home always renders → floor "view".
// Only clients with settings.accessV2 use the new map; everyone else derives
// the SAME answer from the legacy modules+ownerEdit model (zero behavior change).
export const FEATURE_LEVELS = ["none", "view", "edit"];
export const FEATURE_DEFAULTS = {
  home: "edit", story: "none", details: "edit", schedule: "edit",
  venue: "edit", guestbook: "edit", quiz: "edit", entourage: "edit", music: "none",
};
// Rows for the superadmin table, in display order. lock:"core" renders a
// disabled Edit row (rsvp); noNone hides the None option (home).
export const FEATURE_ROWS = [
  { k: "home", label: "Home", noNone: true, desc: "Couple & event + invitation (landing page always renders)" },
  { k: "story", label: "Our Story", desc: "Milestones page" },
  { k: "details", label: "Details", desc: "Info cards + FAQ + attire guide" },
  { k: "schedule", label: "Schedule", desc: "Wedding-day timeline (+ home glimpse)" },
  { k: "venue", label: "Venue & Map", desc: "Locations, maps, home map" },
  { k: "guestbook", label: "Guestbook", desc: "Guest messages" },
  { k: "quiz", label: "Quiz", desc: "Couple quiz" },
  { k: "entourage", label: "Entourage", desc: "Wedding party groups" },
  { k: "music", label: "Music playlist", desc: "Home page player + tracks" },
];
// Legacy ownerEdit grant key per feature (guestbook/quiz have no grant today —
// module on has always meant the owner gets the tab, i.e. "edit").
const LEGACY_GRANT = { home: "home", story: "story", details: "details", schedule: "schedule", venue: "venue", music: "music", entourage: "entourage" };

export function featureLevel(settings, key) {
  const s = settings || {};
  if (DISABLED_MODULES.has(key)) return "none";   // platform kill switch
  if (key === "rsvp") return "edit";              // core feature, always
  if (s.accessV2 === true) {
    const raw = (s.features || {})[key];
    let lvl = FEATURE_LEVELS.includes(raw) ? raw : (FEATURE_DEFAULTS[key] || "edit");
    if (key === "home" && lvl === "none") lvl = "view";
    return lvl;
  }
  // Legacy derivation — must reproduce today's behavior exactly.
  if (!moduleEnabled(s.modules, key)) return "none";
  const g = LEGACY_GRANT[key];
  if (!g) return "edit";
  return (s.ownerEdit || {})[g] === true ? "edit" : "view";
}
export function featureVisible(settings, key) { return featureLevel(settings, key) !== "none"; }
```

- [ ] **Step 4: Run the new tests** — `npx vitest run src/lib/__tests__/featureLevel.test.js` → PASS.
- [ ] **Step 5: Full suite + commit**

```bash
npm test   # all pass, nothing else touched
git add src/lib/roles.js src/lib/__tests__/featureLevel.test.js
git commit -m "feat(accessV2): featureLevel resolver — one authority for none/view/edit (legacy-derived when unflagged)"
```

---

### Task 2: Store defaults

**Files:** Modify `src/lib/store.jsx` (DEFAULT_SETTINGS, near `strictRsvp`).

- [ ] **Step 1: Add defaults**

```js
  // Feature Permissions v2 trial (spec 2026-07-11). accessV2 flips a client to
  // the features map; null map = FEATURE_DEFAULTS via featureLevel().
  accessV2: false,
  features: null,
```

- [ ] **Step 2:** `npm run build && npm test` → green. Commit:

```bash
git add src/lib/store.jsx
git commit -m "feat(accessV2): store defaults (flag off, empty features map)"
```

---

### Task 3: Guest-site gating through the resolver

**Files:**
- Modify `src/app/App.jsx` — `visibleNav` (~line 69) + `routeBlocked` (~line 478)
- Modify `src/pages/PublicPages.jsx` — home sections (~lines 605-678)

Legacy answers are identical by construction (Task 1 tests prove it), so these are pure swaps — no new conditionals in the callers.

- [ ] **Step 1: App.jsx — import + nav filter**

`visibleNav` currently filters with `moduleEnabled(modules, l.key)`. Change its signature to take settings and use the resolver:

```js
function visibleNav(eventType, settings) {
  return NAV_LINKS.filter((l) => l.key === "home" || (hasSection(eventType, l.key) && featureVisible(settings, l.key)));
}
```

Update BOTH call sites (desktop links + drawer links) from `visibleNav(settings.eventType, settings.modules)` to `visibleNav(settings.eventType, settings)`. Add `featureVisible` to the roles.js import. In `routeBlocked` (~478) replace `!moduleEnabled(settings.modules, route)` with `!featureVisible(settings, route)`.

- [ ] **Step 2: PublicPages.jsx — home sections**

Replace the module gates and add flag-safe gates for the non-module sections (legacy value shown in the comment must remain `true` so nothing changes for unflagged clients):

```jsx
// line ~605  (venue map block)
{featureVisible(s, "venue") && s.showMap !== false && homeMaps.length > 0 && (
// line ~618  (timeline)
{s.showTimeline !== false && featureVisible(s, "schedule") && (
// line ~635  (home details)
{s.showHomeDetails === true && featureVisible(s, "details") && detailCards.filter(...).length > 0 && (
// line ~662  (home FAQ)
{s.showHomeFaq === true && featureVisible(s, "details") && (Array.isArray(faq) ? faq : []).filter((f) => f.home !== false).length > 0 && (
// line ~672  (attire folds into Details under accessV2; legacy: always allowed)
{s.showAttire !== false && (s.accessV2 !== true || featureVisible(s, "details")) && <AttireView groups={attire} />}
// line ~675  (music: accessV2 gates by level; legacy always allowed)
{s.showMusic !== false && (s.accessV2 !== true || featureVisible(s, "music")) && <VinylPlayer tracks={playlist} />}
// line ~678  (entourage)
{s.showEntourage !== false && (s.accessV2 !== true || featureVisible(s, "entourage")) && <EntourageView groups={entourage} />}
```

Import `featureVisible` from `@/lib/roles.js` (moduleEnabled import stays for other uses). Note: `MusicMount` in App.jsx also gets the music gate so a "none" client doesn't autoplay audio: wrap its `setTracks(playlist)` input — pass `playlist={featureVisible(settings, "music") || settings.accessV2 !== true ? playlist : []}`… simpler and explicit:

```jsx
<MusicMount /* App.jsx render */ />
// inside MusicMount's useStore() destructure add settings and change:
const tracks = (settings.accessV2 === true && !featureVisible(settings, "music")) ? [] : (playlist || []);
useEffect(() => { setTracks(tracks); }, [playlist, settings.accessV2, settings.features]);
```

- [ ] **Step 3:** `npm run build && npm test` → all green (legacy identical). Commit:

```bash
git add src/app/App.jsx src/pages/PublicPages.jsx src/features/music.jsx
git commit -m "feat(accessV2): guest nav, routes and home sections gate through featureLevel"
```

---

### Task 4: Owner tab visibility + promoted tabs (admin shell)

**Files:**
- Modify `src/admin/manage.jsx` — `ADMIN_TABS` consumers in `AdminApp` (~line 3530 region)
- Test: `src/admin/__tests__/accessV2.test.jsx` (create)

- [ ] **Step 1: Write failing tests**

```jsx
// src/admin/__tests__/accessV2.test.jsx
import { describe, it, expect, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import React from "react";
import { Store } from "@/lib/store.jsx";
import { AdminApp } from "@/admin/manage.jsx";

const navLabels = (c) => [...c.querySelectorAll("nav.admin__nav button")].map((b) => b.textContent.trim());

describe("accessV2 owner tabs", () => {
  beforeEach(() => cleanup());

  const ownerAuth = () => Store.setAuth({ session: { user: { email: "o@x" } }, role: "owner", clientId: "c1", email: "o@x" });

  it("edit level shows the tab; view/none hide it; music+entourage promoted", () => {
    Store.set({ clientId: "c1", loading: false });
    Store.updateSettings({ accessV2: true, features: { story: "view", quiz: "none", music: "edit", entourage: "edit" } });
    ownerAuth();
    const { container } = render(<AdminApp />);
    const tabs = navLabels(container);
    expect(tabs).not.toContain("Our Story");   // view -> no tab
    expect(tabs).not.toContain("Quiz");        // none -> no tab
    expect(tabs).toContain("Music playlist");  // promoted, edit
    expect(tabs).toContain("Entourage");       // promoted, edit
    expect(tabs).toContain("RSVPs");           // core, always
  });

  it("legacy client (no flag) tab set is unchanged", () => {
    Store.set({ clientId: "c1", loading: false });
    Store.updateSettings({ accessV2: false, features: null, modules: {}, ownerEdit: {} });
    ownerAuth();
    const { container } = render(<AdminApp />);
    const tabs = navLabels(container);
    expect(tabs).not.toContain("Music playlist"); // not promoted on legacy
    expect(tabs).toContain("Guestbook");
  });
});
```

- [ ] **Step 2:** `npx vitest run src/admin/__tests__/accessV2.test.jsx` → FAIL.

- [ ] **Step 3: Implement in AdminApp**

Right after the existing `tabs` computation (`tabs = tabsForClient(...)` / superadmin branch, ~line 3533-3536) add:

```js
  // Feature Permissions v2: the resolver is the only tab authority. Owners see
  // a module tab only at "edit"; music + entourage are promoted to top-level
  // tabs. Superadmin-on-client sees every feature tab. Legacy clients skip
  // this block entirely (their tabs computed above stay untouched).
  if (settings.accessV2 === true && clientId) {
    const V2_TAB_FEATURE = { home: "home", story: "story", guestbook: "guestbook", schedule: "schedule", quiz: "quiz", details: "details", venue: "venue" };
    const lvl = (k) => featureLevel(settings, k);
    tabs = tabs.filter((t) => {
      const fk = V2_TAB_FEATURE[t.key];
      if (!fk) return true;                       // dashboard, rsvps, settings…
      return auth.role === "superadmin" ? true : lvl(fk) === "edit";
    });
    const promoted = [
      { key: "music", label: "Music playlist", icon: "play" },
      { key: "entourage", label: "Entourage", icon: "user" },
    ].filter((t) => auth.role === "superadmin" || lvl(t.key) === "edit");
    // insert before Settings so Settings/Support stay last
    const si = tabs.findIndex((t) => t.key === "settings");
    tabs = si === -1 ? [...tabs, ...promoted] : [...tabs.slice(0, si), ...promoted, ...tabs.slice(si)];
  }
```

Import `featureLevel` from roles.js in manage.jsx. `Icon.play` / `Icon.user` already exist (used elsewhere); if `Icon.play` is absent use `"music"`→`icon: "calendar"`-adjacent existing key — check `Icon` map and pick existing keys (`play` exists in amedia badge, `user` exists in profile menu).

- [ ] **Step 4: Render the two promoted tab bodies** (same `AdminApp` switch where `activeTab === "…"` panels render):

```jsx
      {settings.accessV2 === true && activeTab === "music" && (
        <>
          <HomeSectionPanel feature="music" title="Music player" showKey="showMusic" />
          <R2MigratePanel />
          <MusicAdmin />
        </>
      )}
      {settings.accessV2 === true && activeTab === "entourage" && (
        <>
          <HomeSectionPanel feature="entourage" title="Entourage" showKey="showEntourage" />
          <EntourageAdmin />
        </>
      )}
```

(`HomeSectionPanel` arrives in Task 5 — for THIS commit stub the two bodies with just `<MusicAdmin />` / `<EntourageAdmin />` so the tests pass, and add the panels in Task 5.)

- [ ] **Step 5:** `npx vitest run src/admin/__tests__/accessV2.test.jsx` → PASS. `npm test` → all green. Commit:

```bash
git add src/admin/manage.jsx src/admin/__tests__/accessV2.test.jsx
git commit -m "feat(accessV2): owner tabs from featureLevel; music + entourage promoted to top-level tabs"
```

---

### Task 5: `HomeSectionPanel` + module-tab restructure

**Files:** Modify `src/admin/manage.jsx` only (all render-side, flag-gated).

- [ ] **Step 1: Add the shared panel component** (near `HomeHeadFields`, which already renders the eyebrow/title override fields):

```jsx
// One standard "how this feature shows on the HOME PAGE" panel, rendered at the
// top of each feature's own tab for accessV2 clients (spec 2026-07-11): the
// show-on-home switch, the small/big header overrides, the guest-nav tab
// rename, and any module-specific extras passed as children.
export function HomeSectionPanel({ feature, title, showKey, defEyebrow, defTitle, children }) {
  const { settings } = useStore();
  const f = settings;
  const toggleShow = (k, v) => Store.updateSettings({ [k]: v });
  return (
    <div className="panel">
      <div className="panel__head" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div className="panel__title">Home section</div>
        <HeadSwitch label={`Show ${title.toLowerCase()} on the home page`} checked={f[showKey] !== false} onChange={(v) => toggleShow(showKey, v)} />
      </div>
      <div className="panel__body">
        <HomeHeadFields k={feature} defEyebrow={defEyebrow} defTitle={defTitle} />
        <Field label="Tab name in the guest menu" id={`rn-${feature}`} hint="Blank keeps the default.">
          <Input id={`rn-${feature}`} value={(f.moduleLabels && f.moduleLabels[feature]) || ""} placeholder={moduleLabel(feature)}
            onChange={(e) => Store.updateSettings({ moduleLabels: { ...(f.moduleLabels || {}), [feature]: e.target.value } })} />
        </Field>
        {children}
      </div>
    </div>
  );
}
```

Check `HomeHeadFields` prop names before wiring (`k`, `defEyebrow`, `defTitle` per existing call `HomeHeadFields k="schedule" defEyebrow="The Day" defTitle="A glimpse of the schedule"`). For features with no guest-nav entry (music, entourage) omit the rename Field: wrap it in `{["story","details","schedule","venue","guestbook","quiz"].includes(feature) && (…)}`.

- [ ] **Step 2: Flag-gated module tab additions** (each in its existing `activeTab === "…"` block, rendered ABOVE current content, all inside `settings.accessV2 === true &&`):

- **Schedule tab**: `HomeSectionPanel feature="schedule" title="Timeline" showKey="showTimeline"` with the vertical/horizontal `tl-pick` markup moved in as `children` (copy the existing block from the Home→Timeline folder verbatim).
- **Venue & Map tab**: `HomeSectionPanel feature="venue" title="Map" showKey="showMap"` with `<VenueAdmin section="home" />`'s picker content as children (reuse the component directly under the panel instead of duplicating).
- **Details tab**: `HomeSectionPanel feature="details" title="Details" showKey="showHomeDetails"` plus a second panel for FAQ (`showKey="showHomeFaq"`), and `<AttireAdmin headRight={…same HeadSwitch as today…} />` rendered at the bottom of the Details tab.
- **Home tab (`HomeAdmin`)**: when `settings.accessV2 === true`, filter `TABS` to `couple` + `invite` only:

```js
  const TABS_V2 = TABS.filter((t) => ["couple", "invite"].includes(t.k));
  const folders = settings.accessV2 === true ? TABS_V2 : TABS;
```

(and render from `folders`). Legacy clients keep every folder.

- [ ] **Step 3: Replace the Task-4 stubs** for the promoted Music/Entourage tabs with the `HomeSectionPanel` versions shown in Task 4 Step 4.

- [ ] **Step 4:** `npm run build && npm test` → green (accessV2 tests still pass; legacy suites untouched). Commit:

```bash
git add src/admin/manage.jsx
git commit -m "feat(accessV2): Home section panel in every feature tab; Home tab slims to Couple+Invitation; Attire lives in Details"
```

---

### Task 6: Client Settings under the flag

**Files:** Modify `src/admin/manage.jsx` (`SettingsAdmin`, STABS ~line 2008).

- [ ] **Step 1:**

```js
  // accessV2: feature membership + permissions moved to the superadmin table;
  // module toggles, renames and owner-grants disappear here. RSVP options and
  // guestbook moderation stay (RSVP has no content tab).
  const STABS_ALL = [["features", "Features", "check"], ["appearance", "Theme", "grid"], ["access", "Access", "check"], ["account", "Account", "user"]];
  const STABS = settings.accessV2 === true
    ? [["rsvp", "RSVP & moderation", "check"], ["appearance", "Theme", "grid"], ["account", "Account", "user"]]
    : STABS_ALL;
```

Add a `tab === "rsvp"` panel (accessV2 only) containing EXACTLY the pieces lifted from today's Features folder: Strict RSVP checkbox, Require-contact-number checkbox, auto-approve guestbook toggle. Copy the existing JSX blocks verbatim (they already write via `setKey`). Do NOT render module toggles or "Rename tabs" there.

- [ ] **Step 2: Extend accessV2 test** (same new test file) —

```jsx
  it("accessV2 Settings loses Features/Access folders, gains RSVP & moderation", () => {
    Store.set({ clientId: "c1", loading: false });
    Store.updateSettings({ accessV2: true });
    Store.setAuth({ session: { user: { email: "su@x" } }, role: "superadmin", clientId: null, email: "su@x" });
    const { container } = render(<AdminApp />);
    // navigate to Settings tab
    [...container.querySelectorAll("nav.admin__nav button")].find((b) => b.textContent.trim() === "Settings").click();
    const folders = [...container.querySelectorAll(".folders .folder")].map((b) => b.textContent.trim());
    expect(folders).toContain("RSVP & moderation");
    expect(folders).not.toContain("Features");
    expect(folders).not.toContain("Access");
  });
```

Use `fireEvent.click` (import it) rather than bare `.click()` if the bare call doesn't flush.

- [ ] **Step 3:** `npm test` → green. Commit:

```bash
git add src/admin/manage.jsx src/admin/__tests__/accessV2.test.jsx
git commit -m "feat(accessV2): client Settings = RSVP & moderation + Theme + Account (Features/Access folders removed)"
```

---

### Task 7: Superadmin table (Edit client + request editor)

**Files:** Modify `src/admin/superadmin.jsx` (`AccessFields`, line ~35).

- [ ] **Step 1: v2 table inside AccessFields**

`AccessFields({ v, set, … })` receives the editable client draft `v` and setter `set(key, value)`. At the top of its render:

```jsx
  if (v.accessV2 === true) {
    const level = (k) => (v.features && FEATURE_LEVELS.includes(v.features[k]) ? v.features[k] : FEATURE_DEFAULTS[k]);
    const setLevel = (k, lvl) => set("features", { ...(v.features || {}), [k]: lvl });
    return (
      <div className="field">
        <span className="field__label">Features &amp; permissions</span>
        <p style={{ color: "var(--muted)", fontSize: 13, margin: "0 0 10px" }}>
          None = not on their site · View = on the site, you manage the content · Edit = they get the admin tab.
        </p>
        <table className="tbl" style={{ width: "100%" }}>
          <tbody>
            {FEATURE_ROWS.map((r) => (
              <tr key={r.k}>
                <td><strong>{r.label}</strong><div style={{ color: "var(--muted)", fontSize: 12 }}>{r.desc}</div></td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <div className="seg">
                    {["none", "view", "edit"].filter((l) => !(r.noNone && l === "none")).map((l) => (
                      <button key={l} type="button" className={level(r.k) === l ? "on" : ""} onClick={() => setLevel(r.k, l)}>
                        {l === "none" ? "None" : l === "view" ? "View" : "Edit"}
                      </button>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
            <tr>
              <td><strong>RSVP</strong><div style={{ color: "var(--muted)", fontSize: 12 }}>Core feature of the system</div></td>
              <td><span className="tag tag--hidden">Edit — always</span></td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  }
```

Import `FEATURE_ROWS`, `FEATURE_LEVELS`, `FEATURE_DEFAULTS` from `@/lib/roles.js`. Legacy clients fall through to the existing AccessFields body unchanged. The Edit-client save path already persists arbitrary `content` keys (`features` rides along).

- [ ] **Step 2: Request editor** — where the request/Edit-client modal seeds `v`, add a small superadmin-only checkbox above AccessFields:

```jsx
  <AdminToggle label="New permission model (accessV2 trial)" desc="One None/View/Edit table instead of Features + Access. Sandbox trial."
    checked={v.accessV2 === true} onChange={(x) => set("accessV2", x)} />
```

Toggling on shows the table (seeded by `FEATURE_DEFAULTS` via the `level()` fallback); toggling off returns the legacy editors. This satisfies the spec's "same table in the request approval editor" while keeping every real client off the flag.

- [ ] **Step 3:** `npm run build && npm test` → green. Commit:

```bash
git add src/admin/superadmin.jsx
git commit -m "feat(accessV2): superadmin None/View/Edit table in Edit-client + request editor (flag toggle, defaults seeded)"
```

---

### Task 8: Flip sandbox + live E2E

- [ ] **Step 1: Deploy** (push already done per-task; wait for CF Pages deploy of the last commit — verify via the CF Pages API commit hash + a served-bundle marker like `"New permission model"`).

- [ ] **Step 2: Flag sandbox via SQL** (Supabase MCP):

```sql
update public.clients set content = jsonb_set(content, '{accessV2}', 'true'::jsonb)
where subdomain = 'sandbox' returning subdomain, content->'accessV2';
```

- [ ] **Step 3: Playwright pass on sandbox** (script in scratchpad, SA creds via env):
  1. Superadmin → console → Edit client sandbox → table renders; set Story=View, Music=Edit, Quiz=None; save.
  2. `sandbox.celebrately.us` guest: nav shows Story (view=visible), hides Quiz; music player renders.
  3. Owner tabs (superadmin-on-client shows all — assert the owner set via the render tests instead; live check: admin nav contains Music playlist + Entourage tabs, Home tab shows only Couple & Event + Invitation folders, Settings shows RSVP & moderation).
  4. Home-section panel on Schedule tab edits eyebrow/title → public home reflects after save.
  5. Reset sandbox levels to the defaults afterwards.

- [ ] **Step 4: Legacy regression probe** — load `demo.celebrately.us` (unflagged) admin + public home, assert tab list and home sections identical to before (no Music tab, Home folders present, Settings has Features/Access).

- [ ] **Step 5: Commit any test-script docs; update tracker**

```bash
git add docs/WEDDING-STATUS.md
git commit -m "docs: enhancement 0012 superseded by feature-permissions v2 (accessV2 sandbox trial live)"
```

Mark enhancement 0012 in `docs/WEDDING-STATUS.md` as `Superseded — accessV2 table (spec 2026-07-11)` and add a new tracker entry for the trial with status In Progress → Done when sign-off.

---

## Self-review notes (done)

- **Spec coverage:** data model (T1/T2), resolver + both models (T1), guest gating (T3), owner tabs + promotions (T4), Home-section panels + Home slim + Attire→Details (T5), client Settings (T6), superadmin table + request editor (T7), sandbox flag + E2E + legacy regression (T8). Migration of 20 clients: explicitly out of scope (spec).
- **Placeholder scan:** all code steps carry code; the two "copy existing JSX verbatim" steps name the exact source blocks (Home→Timeline folder tl-pick; Features folder strict/require-phone/auto-approve) — they are moves, not inventions.
- **Type consistency:** `featureLevel(settings, key)` / `featureVisible(settings, key)` / `FEATURE_ROWS{k,label,desc,noNone}` used identically across T1/T3/T4/T7.
