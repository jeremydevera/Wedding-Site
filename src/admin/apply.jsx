import React from "react";
import { submitSiteRequest, checkRequestSubdomainFree } from "@/lib/api.js";
import { THEMES } from "@/themes";
import { isPremiumTheme } from "@/themes";
import { themesForEvent, DEFAULT_EVENT_TYPE } from "@/config/eventTypes.js";
import { Button, Field, FloatingDecor, Icon, Input, Select } from "@/ui/components.jsx";
import { LocationPicker } from "@/ui/location-picker.jsx";
import { Logo } from "@/admin/core.jsx";
const { useState, useEffect, useRef, useCallback } = React;

// Live theme simulator for the register wizard: embeds the real DEMO site
// (same-origin via ?client=demo so the postMessage preview bridge is allowed)
// and pushes the picked theme + falling petals — the exact look a new site
// opens with. Scaled down to fit; pointer-events off (preview only).
function ApplyThemePreview({ theme }) {
  const ref = useRef(null);
  const wrapRef = useRef(null);
  const [scale, setScale] = useState(0.4);
  const baseW = 1280, baseH = 800, MAX_H = 440;
  useEffect(() => {
    const el = wrapRef.current; if (!el) return;
    const measure = () => { const w = el.clientWidth || baseW; setScale(Math.min(w / baseW, MAX_H / baseH, 1)); };
    measure();
    const ro = new ResizeObserver(measure); ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const post = useCallback(() => {
    const w = ref.current && ref.current.contentWindow;
    if (w) w.postMessage({ type: "evermore:preview", theme, decorOn: true, decorStyle: "petals" }, window.location.origin);
  }, [theme]);
  useEffect(() => { post(); }, [post]);
  useEffect(() => {
    const onReady = (e) => { if (e.origin === window.location.origin && e.data && e.data.type === "evermore:preview-ready") post(); };
    window.addEventListener("message", onReady);
    return () => window.removeEventListener("message", onReady);
  }, [post]);
  return (
    <div ref={wrapRef} style={{ width: "100%", marginTop: 14 }}>
      <div style={{ width: Math.round(baseW * scale), height: Math.round(baseH * scale), margin: "0 auto", overflow: "hidden", borderRadius: 12, border: "1px solid var(--line)", boxShadow: "0 8px 28px -14px rgba(0,0,0,.35)", background: "#fff" }}>
        <iframe ref={ref} title="Live theme preview" src="/?preview=1&client=demo" loading="lazy" onLoad={post}
          style={{ width: baseW, height: baseH, border: 0, transform: `scale(${scale})`, transformOrigin: "top left", pointerEvents: "none" }} />
      </div>
      <p style={{ textAlign: "center", color: "var(--muted)", fontSize: 12, margin: "8px 0 0" }}>Live sample site · updates as you pick a theme</p>
    </div>
  );
}

// ============================================================================
// apply.jsx — public prospect intake wizard (/apply on the apex hub).
// Sent to prospective clients like an RSVP link; the finished setup is
// submitted for superadmin approval (site_requests table) — nothing goes
// live until approved.
// ============================================================================

const slug = (a, b) =>
  (a + "-" + b).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30);

const dateLabelOf = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
};

const uidv = () => Math.random().toString(36).slice(2, 9);

// --- Easy wedding-date input --------------------------------------------------
// The single datetime-local calendar was the wizard's biggest drop-off point
// (couples skipped it) — a far-future date is a chore to reach in a calendar
// widget, especially on phones. Three dropdowns (month / day / year) + an
// optional time dropdown are native wheels on mobile: nothing to type, nothing
// to navigate. Composes to the same ISO string the rest of the pipeline uses.
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export function parseWeddingDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso || "");
  if (!m) return { y: "", mo: "", d: "", time: "" };
  const hh = +m[4], mm = m[5];
  const time = hh === 0 && mm === "00" ? "" : `${((hh + 11) % 12) + 1}:${mm} ${hh < 12 ? "AM" : "PM"}`;
  return { y: +m[1], mo: +m[2], d: +m[3], time };
}
export function composeWeddingDate(y, mo, d, time) {
  if (!y || !mo || !d) return "";
  const maxD = new Date(+y, +mo, 0).getDate();
  const dd = Math.min(+d, maxD); // e.g. Feb 31 → Feb 28/29
  let hhmm = "00:00";
  const t = /^(\d{1,2}):(\d{2}) (AM|PM)$/.exec(time || "");
  if (t) {
    const h = (+t[1] % 12) + (t[3] === "PM" ? 12 : 0);
    hhmm = `${String(h).padStart(2, "0")}:${t[2]}`;
  }
  return `${y}-${String(mo).padStart(2, "0")}-${String(dd).padStart(2, "0")}T${hhmm}`;
}
function EasyDateInput({ value, onChange }) {
  const { y, mo, d, time } = parseWeddingDate(value);
  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: 6 }, (_, i) => thisYear + i);
  const daysInMonth = y && mo ? new Date(+y, +mo, 0).getDate() : 31;
  const emit = (ny, nmo, nd, nt) => onChange({ target: { value: composeWeddingDate(ny, nmo, nd, nt) } });
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 1.1fr", gap: 8 }}>
        <Select aria-label="Month" value={mo || ""} onChange={(e) => emit(y || thisYear, e.target.value, d || 1, time)}>
          <option value="">Month…</option>
          {MONTH_NAMES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
        </Select>
        <Select aria-label="Day" value={d || ""} onChange={(e) => emit(y || thisYear, mo || 1, e.target.value, time)}>
          <option value="">Day…</option>
          {Array.from({ length: daysInMonth }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
        </Select>
        <Select aria-label="Year" value={y || ""} onChange={(e) => emit(e.target.value, mo || 1, d || 1, time)}>
          <option value="">Year…</option>
          {years.map((yy) => <option key={yy} value={yy}>{yy}</option>)}
        </Select>
      </div>
      <div style={{ marginTop: 8 }}>
        <Select aria-label="Time" value={time} onChange={(e) => emit(y, mo, d, e.target.value)} disabled={!y || !mo || !d}>
          <option value="">Time — optional</option>
          {TIME_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
        </Select>
      </div>
    </div>
  );
}

// Half-hour time options for the schedule dropdown (6:00 AM – 11:30 PM).
const TIME_OPTIONS = (() => {
  const out = [];
  for (let m = 6 * 60; m <= 23 * 60 + 30; m += 30) {
    const h24 = Math.floor(m / 60), min = m % 60;
    const h12 = ((h24 + 11) % 12) + 1;
    out.push(`${h12}:${String(min).padStart(2, "0")} ${h24 < 12 ? "AM" : "PM"}`);
  }
  return out;
})();

// Blank wizard state — the single definition of every field the wizard
// collects. Add a new wizard field HERE (+ its step UI + requestPayload) and
// both the public /apply flow and the superadmin request editor pick it up.
export function blankApplyState() {
  return {
    partnerA: "", partnerB: "", email: "", subdomain: "", weddingDate: "",
    theme: "", // unchosen until the user picks; falls back to Classic Ivory on submit
    venueName: "", venueAddress: "", mapQuery: "", mapLat: "", mapLng: "",
    schedule: [
      { time: "3:00 PM", title: "Ceremony", loc: "" },
      { time: "5:30 PM", title: "Reception", loc: "" },
    ],
    entourage: [],
    strictRsvp: false,
  };
}

// Serialize wizard state → the site_requests payload. The ONE serializer used
// by both the public submit and the superadmin edit-save, so they can't drift.
export function requestPayload(f) {
  return {
    email: f.email.trim(), partnerA: f.partnerA.trim(), partnerB: f.partnerB.trim(),
    subdomain: f.subdomain.trim().toLowerCase(), templateKey: f.theme || "classic",
    content: {
      ...(f.weddingDate ? { weddingDate: f.weddingDate, weddingDateLabel: dateLabelOf(f.weddingDate) } : {}),
      venueName: f.venueName.trim(), venueAddress: f.venueAddress.trim(),
      mapQuery: f.mapQuery, mapLat: f.mapLat, mapLng: f.mapLng,
      schedule: f.schedule.filter((r) => r.title.trim()),
      entourage: f.entourage
        .map((g) => ({ ...g, title: g.title.trim(), people: g.people.filter((x) => x.name.trim()) }))
        .filter((g) => g.title && g.people.length),
      strictRsvp: f.strictRsvp === true,
    },
  };
}

// Inverse: wizard state from an existing site_requests row (superadmin edit).
// Merges over the blank defaults, so requests submitted before a newer wizard
// field existed still load cleanly (missing keys fall back to defaults).
export function stateFromRequest(row) {
  const c = (row && row.content) || {};
  const base = blankApplyState();
  return {
    ...base,
    partnerA: row.partner_a || "", partnerB: row.partner_b || "",
    email: row.email || "", subdomain: row.subdomain || "",
    theme: row.template_key || base.theme,
    weddingDate: c.weddingDate || "",
    venueName: c.venueName || "", venueAddress: c.venueAddress || "",
    mapQuery: c.mapQuery || "", mapLat: c.mapLat ?? "", mapLng: c.mapLng ?? "",
    schedule: Array.isArray(c.schedule) && c.schedule.length ? c.schedule : base.schedule,
    entourage: (Array.isArray(c.entourage) ? c.entourage : []).map((g) => ({
      id: g.id || "ent-" + uidv(), title: g.title || "",
      people: (g.people || []).map((x) => ({ id: x.id || "p-" + uidv(), name: x.name || "", role: x.role || "" })),
    })),
    strictRsvp: c.strictRsvp === true,
  };
}

// Public /apply intake, and — with `initial` — the superadmin request editor:
// the same steps render prefilled inside the console modal, and the last step
// saves via onSave(requestPayload) instead of submitting a new request.
export function ApplyWizard({ initial = null, onSave, onCancel }) {
  const editing = !!initial;
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);
  const [touchedSub, setTouchedSub] = useState(editing); // editing: never auto-slug over a real subdomain
  const [subState, setSubState] = useState("idle");
  const [f, setF] = useState(() => (editing ? stateFromRequest(initial) : blankApplyState()));
  const set = (k) => (e) => { setErr(""); setF((p) => ({ ...p, [k]: e && e.target ? e.target.value : e })); };

  // suggest the address from the names until edited
  useEffect(() => {
    if (touchedSub) return;
    if (f.partnerA.trim() && f.partnerB.trim()) setF((p) => ({ ...p, subdomain: slug(p.partnerA, p.partnerB) }));
  }, [f.partnerA, f.partnerB, touchedSub]);

  // debounced availability — when editing, the request's own subdomain is
  // "taken" by itself, so an unchanged value always counts as fine.
  const t = useRef(null);
  useEffect(() => {
    const sub = f.subdomain.trim().toLowerCase();
    if (!sub) { setSubState("idle"); return; }
    if (editing && sub === (initial.subdomain || "").toLowerCase()) { setSubState("free"); return; }
    if (!/^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/.test(sub)) { setSubState("invalid"); return; }
    setSubState("checking");
    clearTimeout(t.current);
    t.current = setTimeout(() => {
      checkRequestSubdomainFree(sub).then((free) => setSubState(free ? "free" : "taken")).catch(() => setSubState("idle"));
    }, 450);
    return () => clearTimeout(t.current);
  }, [f.subdomain]); // eslint-disable-line react-hooks/exhaustive-deps

  // Include every wedding theme in the picker, incl. the premium Olive Envelope.
  const themes = themesForEvent(DEFAULT_EVENT_TYPE).filter((k) => THEMES[k]);

  // --- schedule editing ---
  const schedSet = (i, k) => (e) => setF((p) => ({ ...p, schedule: p.schedule.map((r, j) => (j === i ? { ...r, [k]: e.target.value } : r)) }));
  const schedAdd = () => setF((p) => ({ ...p, schedule: [...p.schedule, { time: "", title: "", loc: "" }] }));
  const schedDel = (i) => setF((p) => ({ ...p, schedule: p.schedule.filter((_, j) => j !== i) }));

  // --- entourage editing (groups of people) ---
  const entAddGroup = () => setF((p) => ({ ...p, entourage: [...p.entourage, { id: "ent-" + uidv(), title: "", people: [{ id: "p-" + uidv(), name: "", role: "" }] }] }));
  const entDelGroup = (gi) => setF((p) => ({ ...p, entourage: p.entourage.filter((_, j) => j !== gi) }));
  const entSetTitle = (gi) => (e) => setF((p) => ({ ...p, entourage: p.entourage.map((g, j) => (j === gi ? { ...g, title: e.target.value } : g)) }));
  const entAddPerson = (gi) => setF((p) => ({ ...p, entourage: p.entourage.map((g, j) => (j === gi ? { ...g, people: [...g.people, { id: "p-" + uidv(), name: "", role: "" }] } : g)) }));
  const entSetPerson = (gi, pi, k) => (e) => setF((p) => ({ ...p, entourage: p.entourage.map((g, j) => (j === gi ? { ...g, people: g.people.map((x, q) => (q === pi ? { ...x, [k]: e.target.value } : x)) } : g)) }));
  const entDelPerson = (gi, pi) => setF((p) => ({ ...p, entourage: p.entourage.map((g, j) => (j === gi ? { ...g, people: g.people.filter((_, q) => q !== pi) } : g)) }));

  const validateStep = (s) => {
    if (s === 0) {
      if (!f.partnerA.trim() || !f.partnerB.trim()) return "Please enter both names.";
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim())) return "Please enter a valid email.";
      if (!f.subdomain.trim()) return "Please choose a site address.";
      if (subState === "checking") return "Checking availability…";
      if (subState === "taken") return "That site address is already taken — try another.";
      if (subState === "invalid") return "Site address: 3–30 characters, letters/numbers/hyphens.";
    }
    return "";
  };
  const next = () => { const e = validateStep(step); if (e) { setErr(e); return; } setErr(""); setStep(step + 1); };

  async function submit() {
    if (busy) return;
    const e0 = validateStep(0);
    if (e0) { setErr(e0); setStep(0); return; }
    setBusy(true); setErr("");
    try {
      if (editing) {
        await onSave(requestPayload(f)); // caller persists + closes
      } else {
        await submitSiteRequest(requestPayload(f));
        setDone(true);
      }
    } catch (e2) {
      setErr(e2.message || (editing ? "Could not save the request." : "Could not submit your request."));
    } finally {
      setBusy(false);
    }
  }

  const steps = [
    { title: "Tell us about you", short: "About you", sub: "The basics we need to reserve your site address.", body: (
      <>
        <div className="field-row field-row--2">
          <Field label="Partner A — first name" id="a-pa"><Input id="a-pa" value={f.partnerA} onChange={set("partnerA")} placeholder="Romeo" /></Field>
          <Field label="Partner B — first name" id="a-pb"><Input id="a-pb" value={f.partnerB} onChange={set("partnerB")} placeholder="Juliet" /></Field>
        </div>
        <Field label="Your email" id="a-email" hint="We'll reach you here once your site is approved."><Input id="a-email" type="email" value={f.email} onChange={set("email")} placeholder="you@example.com" /></Field>
        <Field label="Event date" id="a-date" hint="Optional — skip it if you haven't picked a date yet.">
          <EasyDateInput value={f.weddingDate} onChange={set("weddingDate")} />
        </Field>
        <Field label="Site address" id="a-sub">
          <div className="reg-sub">
            <Input id="a-sub" value={f.subdomain} onChange={(e) => { setTouchedSub(true); set("subdomain")(e); }} spellCheck={false} placeholder="romeo-juliet" />
            <span className="reg-sub__suffix">.celebrately.us</span>
          </div>
          <div className="reg-sub__state" data-state={subState}>
            {subState === "checking" && "Checking availability…"}
            {subState === "free" && "✓ Available"}
            {subState === "taken" && "✕ Already taken — try another"}
            {subState === "invalid" && "3–30 characters: letters, numbers, hyphens"}
          </div>
        </Field>
      </>
    ) },
    { title: "Pick your look", short: "Theme", sub: "Choose a starting theme — you can change it anytime.", body: (
      <>
        <Field label="Theme" id="ap-theme" hint="Pick a starting look — you can change it anytime in your admin.">
          <Select id="ap-theme" value={f.theme} onChange={(e) => setF((p) => ({ ...p, theme: e.target.value }))}>
            <option value="">Choose a theme…</option>
            {themes.map((key) => <option key={key} value={key}>{THEMES[key].label}</option>)}
          </Select>
        </Field>
        {f.theme && <ApplyThemePreview theme={f.theme} />}
      </>
    ) },
    { title: "Where's the celebration?", short: "Venue", sub: "Pin the venue — guests get one-tap directions from your site.", body: (
      <>
        <Field label="Pin your venue on the map" hint="Search the venue, then click the map or drag the pin to the exact spot.">
          <LocationPicker value={f.mapQuery} lat={f.mapLat} lng={f.mapLng}
            onChange={({ query, lat, lng }) => setF((p) => ({ ...p, mapQuery: query, mapLat: lat, mapLng: lng }))} />
        </Field>
      </>
    ) },
    { title: "The day's schedule", short: "Schedule", sub: "Rough times are fine — you can refine everything later.", body: (
      <>
        <div className="apply-sched apply-sched--head" aria-hidden="true">
          <span>Time</span><span>What's happening</span><span>Location</span><span />
        </div>
        {f.schedule.map((r, i) => (
          <div key={i} className="apply-sched">
            <Select aria-label="Time" value={r.time} onChange={schedSet(i, "time")}>
              <option value="">Time…</option>
              {TIME_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
            <Input aria-label="What's happening" value={r.title} onChange={schedSet(i, "title")} placeholder="Ceremony" />
            <Input aria-label="Location" value={r.loc} onChange={schedSet(i, "loc")} placeholder="Optional" />
            <button type="button" className="icon-btn icon-btn--danger" aria-label="Remove" onClick={() => schedDel(i)}>{Icon.trash({})}</button>
          </div>
        ))}
        <Button variant="ghost" size="sm" onClick={schedAdd}>+ Add another</Button>
      </>
    ) },
    { title: "Your entourage", short: "Entourage", skippable: true, sub: "Groups like Principal Sponsors, Groomsmen, Bridesmaids.", body: (
      <>
        <div className="apply-optional">This step is optional — use <strong>Skip this step</strong> below if you'd rather add these later.</div>
        {f.entourage.map((g, gi) => (
          <div key={g.id} className="apply-ent">
            <div className="apply-ent__head">
              <Input aria-label="Group name" value={g.title} onChange={entSetTitle(gi)} placeholder="e.g. Groomsmen" />
              <button type="button" className="icon-btn icon-btn--danger" aria-label="Remove group" onClick={() => entDelGroup(gi)}>{Icon.trash({})}</button>
            </div>
            {g.people.map((x, pi) => (
              <div key={x.id} className="apply-ent__person">
                <Input aria-label="Name" value={x.name} onChange={entSetPerson(gi, pi, "name")} placeholder="Full name" />
                <Input aria-label="Role" value={x.role} onChange={entSetPerson(gi, pi, "role")} placeholder="Role (optional)" />
                <button type="button" className="icon-btn" aria-label="Remove person" onClick={() => entDelPerson(gi, pi)}>×</button>
              </div>
            ))}
            <Button variant="ghost" size="sm" onClick={() => entAddPerson(gi)}>+ Add person</Button>
          </div>
        ))}
        <Button variant="ghost" size="sm" onClick={entAddGroup}>+ Add group</Button>
      </>
    ) },
    { title: "How should RSVPs work?", short: "RSVP", sub: "You can switch modes later in your admin.", body: (
      <>
        <div className="apply-rsvp" role="radiogroup" aria-label="RSVP mode">
          {[
            { v: false, label: "Open RSVP", desc: "Anyone with the link can respond. Simple and friction-free." },
            { v: true, label: "Strict RSVP (invited guests only)", desc: "Only guests on your list can respond, capped at their allotted seats. You manage the guest list in the admin." },
          ].map((o) => (
            <button key={String(o.v)} type="button" role="radio" aria-checked={f.strictRsvp === o.v} className={"apply-rsvp__opt" + (f.strictRsvp === o.v ? " is-on" : "")} onClick={() => setF((p) => ({ ...p, strictRsvp: o.v }))}>
              <span className="apply-rsvp__radio" aria-hidden="true" />
              <span className="apply-rsvp__text">
                <span className="apply-rsvp__label">{o.label}</span>
                <span className="apply-rsvp__desc">{o.desc}</span>
              </span>
            </button>
          ))}
        </div>
      </>
    ) },
    { title: "Review & submit", short: "Review", sub: "Double-check everything before sending it our way.", body: (
      <div className="apply-review">
        {[
          ["Couple", `${f.partnerA} & ${f.partnerB}`],
          ["Email", f.email],
          ["Site address", `${f.subdomain}.celebrately.us`],
          ["Date", f.weddingDate ? dateLabelOf(f.weddingDate) : "Not set yet"],
          ["Theme", (THEMES[f.theme] || THEMES.classic).label],
          ["Venue", f.venueName || f.mapQuery || "Not set yet"],
          ["Schedule", `${f.schedule.filter((r) => r.title.trim()).length} item(s)`],
          ["Entourage", f.entourage.length ? `${f.entourage.length} group(s)` : "Skipped"],
          ["RSVP", f.strictRsvp ? "Strict (invited guests only)" : "Open"],
        ].map(([k, v]) => (
          <div key={k} className="apply-review__row"><span>{k}</span><strong>{v}</strong></div>
        ))}
        {!editing && (
          <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 14 }}>
            We'll review your request and email you at <strong>{f.email}</strong> when your site is approved.
          </p>
        )}
      </div>
    ) },
  ];

  if (done) {
    return (
      <div className="signin admin--sa apply-page">
        <div className="signin__pane">
          <header className="signin__top"><div className="signin__brand"><Logo size={30} /><span className="signin__word">Celebrately</span></div></header>
          <div className="signin__center">
            <div className="signin__form apply-done" style={{ textAlign: "center" }}>
              <div className="apply-done__badge">{Icon.check({ style: { width: 30, height: 30 } })}</div>
              <h1 className="signin__title">Request sent!</h1>
              <p className="signin__sub">Thanks! We'll review your setup and email you at <strong>{f.email}</strong> once <strong>{f.subdomain}.celebrately.us</strong> is approved.</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const last = step === steps.length - 1;
  const s = steps[step];
  // Editing (console modal): the data is already complete, so every step is
  // freely clickable. Creating: only completed steps can be revisited.
  const body = (
    <div className={"signin__form apply-form" + (editing ? " apply-form--edit" : "")}>
      <div className="apply-steps" aria-label={`Step ${step + 1} of ${steps.length}`}>
        {steps.map((st, i) => (
          <button
            key={st.short}
            type="button"
            className={"apply-steps__it" + (i === step ? " is-current" : (editing || i < step) ? " is-done" : "")}
            disabled={!editing && i >= step}
            aria-current={i === step ? "step" : undefined}
            onClick={() => { if (editing || i < step) { setErr(""); setStep(i); } }}
          >
            <span className="apply-steps__num">{editing || i < step ? "✓" : i + 1}</span>
            <span className="apply-steps__lbl">{st.short}</span>
          </button>
        ))}
      </div>
      <div className="apply-progress" aria-hidden="true"><i style={{ width: `${(step / (steps.length - 1)) * 100}%` }} /></div>
      <section className="panel apply-panel">
        <header className="panel__head apply-panel__head">
          <div>
            <div className="apply-eyebrow">Step {step + 1} of {steps.length}</div>
            <h1 className="panel__title apply-panel__title">{s.title}</h1>
            {s.sub && <p className="apply-panel__sub">{s.sub}</p>}
          </div>
        </header>
        <div className="panel__body">
          <div className="apply-body" key={step}>{s.body}</div>
          {err && <div className="signin__err" style={{ margin: "12px 0 0" }}>{err}</div>}
        </div>
        <div className="panel__foot apply-panel__foot">
          <span>{s.skippable && !last && <button type="button" className="wizard__skip" onClick={() => { setF((p) => ({ ...p, entourage: [] })); setStep(step + 1); }}>Skip this step</button>}</span>
          <div style={{ display: "flex", gap: 10 }}>
            {editing && <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>}
            {step > 0 && <Button variant="ghost" onClick={() => { setErr(""); setStep(step - 1); }} disabled={busy}>Back</Button>}
            {editing && <Button variant="primary" onClick={submit} disabled={busy}>{busy ? "Saving…" : "Save changes"}</Button>}
            {!last && <Button variant={editing ? "ghost" : "primary"} onClick={next}>Next</Button>}
            {!editing && last && <Button variant="primary" onClick={submit} disabled={busy}>{busy ? "Sending…" : "Submit for approval"}</Button>}
          </div>
        </div>
      </section>
    </div>
  );

  if (editing) return body; // rendered inside the console's Modal — no page chrome

  return (
    <div className="signin signin--themed admin--sa apply-page" style={THEMES.classic.vars}>
      {/* Classic Ivory palette (above) + falling petals, so the register page
          previews the default look a new site opens with. */}
      <FloatingDecor on style="petals" />
      <div className="signin__pane">
        <header className="signin__top"><div className="signin__brand"><Logo size={30} /><span className="signin__word">Celebrately</span></div></header>
        <div className="signin__center">{body}</div>
      </div>
    </div>
  );
}
