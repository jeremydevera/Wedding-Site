# By design — NOT bugs

Intentional behaviors. **When scanning for bugs, do NOT flag anything on this
list.** Each entry is a deliberate product decision by the owner (Jeremy). If a
scan finds one of these, treat it as correct and move on. Add new entries here
when a behavior is confirmed intentional.

---

## Media library "Choose from library" tab is superadmin-only
- **Where:** `src/admin/MediaPicker.jsx` → `MediaPickerModal` (`canLibrary = auth.role === "superadmin"`). Affects every media picker: music audio, track art, cover/hero images, any image upload.
- **Behavior:** Clients (owners) see an **upload-only** picker — no "Choose from library" tab. Only the superadmin sees the library tab and can reuse shared R2 assets.
- **Why:** The R2 media library is a superadmin tool for shared/curated assets; clients must only add their own files, never browse or pull from the shared pool.
- **Do NOT flag as:** "owner can't reuse uploaded media", "library tab missing for some users", "inconsistent picker UI", or a permissions regression. Intended.

---

## Owner-editing grants default OFF (owner sees fewer tabs than superadmin)
- **Where:** `src/lib/roles.js` `visibleAdminTabs` + `settings.ownerEdit`; toggles in Settings → Access → "Owner editing".
- **Behavior:** By default an owner does NOT see Home / Schedule / Venue / the Home sub-folders (Google Maps, Timeline, Attire, Music, Entourage). The superadmin grants each per client.
- **Why:** The superadmin builds the site; owners get only what they're explicitly granted.
- **Do NOT flag as:** "owner missing tabs", "content tabs hidden", "broken navigation". Intended — absence of a grant is the default.

---

## Settings / Media tabs are superadmin-only, never grantable
- **Where:** `src/lib/roles.js` `SUPERADMIN_ONLY` + `visibleAdminTabs`.
- **Behavior:** No owner-edit grant can open Settings or the R2 Media library to an owner. (Details, Schedule, Venue, and the Home folders ARE grantable via Settings → Access → Owner editing.)
- **Do NOT flag as:** "grant doesn't expose Settings/Media". Intended hard boundary.

---

## Home "Section header" editor is superadmin-only
- **Where:** `src/admin/manage.jsx` → `HomeHeadFields` (returns null unless `auth.role === "superadmin"`).
- **Behavior:** The per-section home header editor (Small Header / Big Header in each Home folder) renders only for the superadmin. Owners with Home-folder grants still edit the folder's content but never see this panel.
- **Why:** Header copy is curated by the platform owner; clients shouldn't rewrite section headers themselves.
- **Do NOT flag as:** "owner missing header fields", "grant doesn't expose header editor". Intended.

---

## "Enable arrange" toggle + "Arrange Now" button are superadmin-only
- **Where:** `src/admin/manage.jsx` — Settings → Theme "Tools" block gated `isSuper && isPremiumTheme(f.theme)`; nav `canArrange = auth.role === "superadmin" && settings.arrangeEnabled && isPremiumTheme(...)`.
- **Behavior:** Clients/owners never see the "Enable arrange" toggle nor the "Arrange Now" nav button, even if `settings.arrangeEnabled` is already true. `auth.role` stays `"superadmin"` while impersonating a client, so the SA still gets both on the client's console.
- **Why:** Arrange is a layout-authoring tool for the platform owner, not the couple.
- **Do NOT flag as:** "owner missing arrange", "stale arrangeEnabled not honored for client", "Tools panel hidden". Intended.

## Neon self-registration (phase 1, 2026-07-21)
- **No email verification on /register** — Neon Auth sign-up works without SMTP;
  verification is a later phase. Spam guard = AUTO APPROVE WEBSITE REQUEST off.
- **Cross-database subdomain uniqueness is client-side only** — the wizard checks
  BOTH Supabase and Neon before submitting, but Neon's `register_site` can only
  see Neon. A direct-RPC caller could claim a Supabase-taken name; resolution
  order (Supabase first) keeps the existing client's site winning. Accepted.
- **Neon clients in the console have no Edit (design wizard)** — status/donate/
  active/open-site only. Owner-side editing for Neon sites is a later phase.
- **Neon rows in the console Clients list are un-paginated/un-searched** —
  appended after the Supabase page rows; fine at current volume.
- **/register lives on celebrately.us (+www) and sandbox** — promoted from sandbox-only on owner request 2026-07-21; the login page's "Sign up →" links there. /apply remains the manual-request path.
