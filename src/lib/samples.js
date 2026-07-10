// Preview-only sample content (spec 2026-07-11-preview-sample-data): used by
// the Show-to-Home emulators when a module is EMPTY — the admin preview
// iframe turns it on via the __previewSamples flag (never a real guest view,
// never saved).
export const PREVIEW_SAMPLES = {
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
