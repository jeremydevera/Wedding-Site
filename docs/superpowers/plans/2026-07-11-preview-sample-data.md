# Preview Sample-Data Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show-to-Home modal previews fall back to labeled sample content when the client's module has no data.

**Architecture:** A `V2_SAMPLES` constant + tiny `sampleOr(list, samples)` helper + `SampleTag` pill live beside the accessV2 modal code in `src/admin/manage.jsx`; each modal sim swaps its items through `sampleOr` and shows the tag only on fallback. Nothing touches the Store, Save payloads, or public renders.

**Tech Stack:** React (manage.jsx accessV2 components), vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-07-11-preview-sample-data-design.md`

---

### Task 1: Samples + helper + tag (with test)

**Files:**
- Modify: `src/admin/manage.jsx` (above `STHLink`)
- Test: `src/admin/__tests__/accessV2.test.jsx` (append)

- [ ] **Step 1: Failing test** — empty schedule → sample tag in the Schedule modal sim; real events → no tag.

```jsx
  it("Show-to-Home preview falls back to SAMPLE data with a tag when the module is empty", async () => {
    Store.set({ clientId: "c1", loading: false, schedule: [] });
    Store.updateSettings({ accessV2: true, features: {}, showTimeline: true });
    Store.setAuth({ session: { user: { email: "su@x" } }, role: "superadmin", clientId: null, email: "su@x" });
    const { container } = render(<AdminApp />);
    fireEvent.click([...container.querySelectorAll("nav.admin__nav button")].find((b) => b.textContent.trim() === "Schedule"));
    fireEvent.click(container.querySelector(".panel__title a"));
    expect(container.textContent).toMatch(/Sample data/);
    expect(container.textContent).toMatch(/Wedding Ceremony/);
  });

  it("Show-to-Home preview uses REAL data (no tag) when the module has items", () => {
    Store.set({ clientId: "c1", loading: false, schedule: [{ time: "1:00 PM", title: "Real Thing", desc: "", loc: "" }] });
    Store.updateSettings({ accessV2: true, features: {}, showTimeline: true });
    Store.setAuth({ session: { user: { email: "su@x" } }, role: "superadmin", clientId: null, email: "su@x" });
    const { container } = render(<AdminApp />);
    fireEvent.click([...container.querySelectorAll("nav.admin__nav button")].find((b) => b.textContent.trim() === "Schedule"));
    fireEvent.click(container.querySelector(".panel__title a"));
    expect(container.textContent).toMatch(/Real Thing/);
    expect(container.textContent).not.toMatch(/Sample data/);
  });
```

- [ ] **Step 2:** `npx vitest run src/admin/__tests__/accessV2.test.jsx` → the two new tests FAIL.

- [ ] **Step 3: Implement** (above `function STHLink`):

```jsx
// Preview-only sample content (spec 2026-07-11-preview-sample-data): shown in
// the Show-to-Home simulators when the client's module is EMPTY, so the
// preview always demonstrates the layout. Never written to the Store, never
// saved, never rendered on the public site.
const V2_SAMPLES = {
  schedule: [
    { time: "3:00 PM", title: "Wedding Ceremony", desc: "Exchange of vows", loc: "Main chapel" },
    { time: "6:00 PM", title: "Dinner", desc: "Reception dinner with toasts", loc: "Grand ballroom" },
    { time: "9:00 PM", title: "Party", desc: "Dancing till late", loc: "Garden pavilion" },
  ],
  detailCards: [
    { title: "Parking", body: "Complimentary valet at the main entrance from 2:00 PM.", icon: "pin" },
    { title: "Dress Code", body: "Formal attire — soft neutrals encouraged.", icon: "rings" },
    { title: "Gifts", body: "Your presence is the present; a wishing well will be available.", icon: "heart" },
  ],
  faq: [
    { q: "Can I bring a plus one?", a: "Check your invitation — seats are reserved by name." },
    { q: "Is there parking at the venue?", a: "Yes, free valet parking from 2:00 PM." },
    { q: "What time should I arrive?", a: "Doors open 30 minutes before the ceremony." },
  ],
  venue: { name: "Sample venue", address: "Manila Cathedral, Intramuros, Manila", mapQuery: "Manila Cathedral, Intramuros, Manila" },
  playlist: [
    { id: "s1", title: "Perfect", artist: "Ed Sheeran", url: "" },
    { id: "s2", title: "At Last", artist: "Etta James", url: "" },
  ],
  entourage: [
    { id: "g1", title: "Principal Sponsors", people: [{ id: "p1", name: "Maria Santos" }, { id: "p2", name: "Jose Cruz" }] },
    { id: "g2", title: "Bridesmaids", people: [{ id: "p3", name: "Ana Reyes" }, { id: "p4", name: "Liza Ramos" }] },
  ],
};
// All-or-nothing fallback: real list wins with >=1 item.
const sampleOr = (list, samples) => ((list || []).length ? { items: list, sample: false } : { items: samples, sample: true });
function SampleTag() {
  return (
    <div style={{ position: "absolute", top: 10, right: 10, zIndex: 2, background: "rgba(90, 96, 108, .92)", color: "#fff", fontSize: 11, fontWeight: 600, letterSpacing: ".04em", padding: "4px 10px", borderRadius: 999 }}>
      Sample data — your real content will appear here
    </div>
  );
}
```

And in `ShowToHomeModal`, make the frame a positioning context: `.v2-sim-frame` already `overflow: hidden`; add `position: relative` via inline style on the frame div (`style={{ position: "relative", ... }}`).

- [ ] **Step 4: Wire the Schedule modal sim** (inside `ScheduleTabV2`): compute `const sch = sampleOr(schedule, V2_SAMPLES.schedule);` and render `{sch.sample && <SampleTag />}` inside the frame + feed `sch.items` to `ScheduleView` (slice(0,3) for vertical as today).

- [ ] **Step 5:** tests pass → `npm test` all green → commit `feat(accessV2): sample-data fallback + tag in the Schedule preview`.

### Task 2: Wire the other five sims

**Files:** `src/admin/manage.jsx` only.

- [ ] **Step 1:** DetailsTabV2 — `const dc = sampleOr(cards, V2_SAMPLES.detailCards)` (tag + items in both stack and carousel branches); FAQ modal — `const fq = sampleOr(homeFaqs, V2_SAMPLES.faq)` feeding `HomeFaqList`. Note: the "Questions on home" checklist keeps listing REAL faqs only (never samples).
- [ ] **Step 2:** VenueTabV2 — when `shown.length === 0`, render the sample map iframe from `V2_SAMPLES.venue.mapQuery` + tag (replaces the "No location selected." note).
- [ ] **Step 3:** MusicTabV2 — `const pl = sampleOr(playlist, V2_SAMPLES.playlist)` feeding `VinylPlayer` + tag.
- [ ] **Step 4:** EntourageTabV2 — `const ent = sampleOr(entourage, V2_SAMPLES.entourage)` feeding `EntourageView` + tag.
- [ ] **Step 5:** `npm run build && npm test` green → commit `feat(accessV2): sample fallback across Details/FAQ/Venue/Music/Entourage previews`.

### Task 3: Deploy + sandbox verification

- [ ] Push, wait for the CF deploy (bundle-hash change on sandbox).
- [ ] Playwright on sandbox: pick a module with no data (or temporarily read one that's empty), open its modal, assert the tag + sample content render; assert a data-filled module shows no tag. No saves.

## Self-review (done)

Spec coverage: samples (T1), all-or-nothing rule (`sampleOr`, T1), tag (T1), all six previews (T1 step 4 + T2), scope guarantee (constants only referenced in sims — T1/T2 touch sim JSX only), tests (T1) + live check (T3). No placeholders; names consistent (`V2_SAMPLES`, `sampleOr`, `SampleTag`).
