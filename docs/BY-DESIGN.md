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
