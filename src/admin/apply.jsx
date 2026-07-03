import React from "react";
import { submitSiteRequest, checkRequestSubdomainFree } from "@/lib/api.js";
import { THEMES } from "@/themes";
import { isPremiumTheme } from "@/themes";
import { themesForEvent, DEFAULT_EVENT_TYPE } from "@/config/eventTypes.js";
import { Button, Field, Icon, Input, Select } from "@/ui/components.jsx";
import { LocationPicker } from "@/ui/location-picker.jsx";
import { Logo } from "@/admin/core.jsx";
const { useState, useEffect, useRef } = React;

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

// Date picker that never shows the native "mm/dd/yyyy, --:--" segments: a
// read-only text box with a friendly value/placeholder; the real hidden
// datetime-local opens via showPicker() on click.
function NiceDateInput({ id, value, onChange, placeholder }) {
  const ref = useRef(null);
  const fmt = (v) => {
    if (!v) return "";
    const d = new Date(v);
    return isNaN(d.getTime()) ? v : d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  };
  const openPicker = () => { const el = ref.current; if (!el) return; try { el.showPicker ? el.showPicker() : el.focus(); } catch (_) { el.focus(); } };
  return (
    <div style={{ position: "relative" }}>
      <Input id={id} readOnly value={fmt(value)} placeholder={placeholder} onClick={openPicker} style={{ cursor: "pointer", paddingRight: value ? 64 : 40 }} />
      <button type="button" onClick={openPicker} aria-label="Pick a date"
        style={{ position: "absolute", top: "50%", right: 8, transform: "translateY(-50%)", display: "grid", placeItems: "center", width: 30, height: 30, background: "none", border: "none", color: "var(--muted)", cursor: "pointer" }}>
        {Icon.calendar({ style: { width: 18, height: 18 } })}
      </button>
      {value && (
        <button type="button" onClick={() => onChange({ target: { value: "" } })} aria-label="Clear date"
          style={{ position: "absolute", top: "50%", right: 36, transform: "translateY(-50%)", display: "grid", placeItems: "center", width: 26, height: 26, background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 20, lineHeight: 1 }}>&times;</button>
      )}
      <input ref={ref} type="datetime-local" value={value || ""} onChange={onChange} tabIndex={-1} aria-hidden="true"
        style={{ position: "absolute", left: 12, bottom: 0, width: 1, height: 1, opacity: 0, pointerEvents: "none" }} />
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

export function ApplyWizard() {
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);
  const [touchedSub, setTouchedSub] = useState(false);
  const [subState, setSubState] = useState("idle");
  const [f, setF] = useState({
    partnerA: "", partnerB: "", email: "", subdomain: "", weddingDate: "",
    theme: "classic",
    venueName: "", venueAddress: "", mapQuery: "", mapLat: "", mapLng: "",
    schedule: [
      { time: "3:00 PM", title: "Ceremony", loc: "" },
      { time: "5:30 PM", title: "Reception", loc: "" },
    ],
    entourage: [],
    strictRsvp: false,
  });
  const set = (k) => (e) => { setErr(""); setF((p) => ({ ...p, [k]: e && e.target ? e.target.value : e })); };

  // suggest the address from the names until edited
  useEffect(() => {
    if (touchedSub) return;
    if (f.partnerA.trim() && f.partnerB.trim()) setF((p) => ({ ...p, subdomain: slug(p.partnerA, p.partnerB) }));
  }, [f.partnerA, f.partnerB, touchedSub]);

  // debounced availability
  const t = useRef(null);
  useEffect(() => {
    const sub = f.subdomain.trim().toLowerCase();
    if (!sub) { setSubState("idle"); return; }
    if (!/^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/.test(sub)) { setSubState("invalid"); return; }
    setSubState("checking");
    clearTimeout(t.current);
    t.current = setTimeout(() => {
      checkRequestSubdomainFree(sub).then((free) => setSubState(free ? "free" : "taken")).catch(() => setSubState("idle"));
    }, 450);
    return () => clearTimeout(t.current);
  }, [f.subdomain]);

  const themes = themesForEvent(DEFAULT_EVENT_TYPE).filter((k) => THEMES[k] && !isPremiumTheme(k));

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
      if (subState === "taken") return "That site address is already taken — try another.";
      if (subState === "invalid") return "Site address: 3–30 characters, letters/numbers/hyphens.";
    }
    return "";
  };
  const next = () => { const e = validateStep(step); if (e) { setErr(e); return; } setErr(""); setStep(step + 1); };

  async function submit() {
    if (busy) return;
    setBusy(true); setErr("");
    try {
      await submitSiteRequest({
        email: f.email.trim(), partnerA: f.partnerA.trim(), partnerB: f.partnerB.trim(),
        subdomain: f.subdomain.trim().toLowerCase(), templateKey: f.theme,
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
      });
      setDone(true);
    } catch (e2) {
      setErr(e2.message || "Could not submit your request.");
    } finally {
      setBusy(false);
    }
  }

  const steps = [
    { title: "Tell us about you", short: "About you", body: (
      <>
        <div className="field-row field-row--2">
          <Field label="Partner A — first name" id="a-pa"><Input id="a-pa" value={f.partnerA} onChange={set("partnerA")} placeholder="Romeo" /></Field>
          <Field label="Partner B — first name" id="a-pb"><Input id="a-pb" value={f.partnerB} onChange={set("partnerB")} placeholder="Juliet" /></Field>
        </div>
        <Field label="Your email" id="a-email" hint="We'll reach you here once your site is approved."><Input id="a-email" type="email" value={f.email} onChange={set("email")} placeholder="you@example.com" /></Field>
        <Field label="Wedding date & time" id="a-date" hint="Optional — leave blank if you haven't picked one."><NiceDateInput id="a-date" value={f.weddingDate} onChange={set("weddingDate")} placeholder="Tap to pick a date" /></Field>
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
    { title: "Pick your look", short: "Theme", body: (
      <>
        <p style={{ color: "var(--muted)", fontSize: 14, margin: "0 0 14px" }}>Choose a theme — it can be changed later.</p>
        <div className="wizard__themes">
          {themes.map((key) => {
            const v = THEMES[key].vars;
            const on = f.theme === key;
            return (
              <button key={key} type="button" className={"theme-sw" + (on ? " theme-sw--on" : "")} onClick={() => setF((p) => ({ ...p, theme: key }))}>
                <span className="theme-sw__prev" style={{ background: v["--bg"] }}>
                  <i style={{ background: v["--accent"] }} />
                  <i style={{ background: v["--gold"] }} />
                  <i style={{ background: v["--ink"] }} />
                </span>
                <span className="theme-sw__name">{THEMES[key].label}{on ? " ✓" : ""}</span>
              </button>
            );
          })}
        </div>
      </>
    ) },
    { title: "Where's the celebration?", short: "Venue", body: (
      <>
        <Field label="Pin your venue on the map" hint="Search the venue, then click the map or drag the pin to the exact spot.">
          <LocationPicker value={f.mapQuery} lat={f.mapLat} lng={f.mapLng}
            onChange={({ query, lat, lng }) => setF((p) => ({ ...p, mapQuery: query, mapLat: lat, mapLng: lng }))} />
        </Field>
      </>
    ) },
    { title: "The day's schedule", short: "Schedule", body: (
      <>
        <p style={{ color: "var(--muted)", fontSize: 14, margin: "0 0 14px" }}>Rough times are fine — you can refine everything later.</p>
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
    { title: "Your entourage", short: "Entourage", skippable: true, body: (
      <>
        <div className="apply-optional">This step is optional — use <strong>Skip this step</strong> below if you'd rather add these later.</div>
        <p style={{ color: "var(--muted)", fontSize: 14, margin: "0 0 14px" }}>Groups like Principal Sponsors, Groomsmen, Bridesmaids.</p>
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
    { title: "How should RSVPs work?", short: "RSVP", body: (
      <>
        <div className="apply-rsvp">
          {[
            { v: false, label: "Open RSVP", desc: "Anyone with the link can respond. Simple and friction-free." },
            { v: true, label: "Strict RSVP (invited guests only)", desc: "Only guests on your list can respond, capped at their allotted seats. You manage the guest list in the admin." },
          ].map((o) => (
            <button key={String(o.v)} type="button" className={"apply-rsvp__opt" + (f.strictRsvp === o.v ? " is-on" : "")} onClick={() => setF((p) => ({ ...p, strictRsvp: o.v }))}>
              <span className="apply-rsvp__label">{o.label}{f.strictRsvp === o.v ? " ✓" : ""}</span>
              <span className="apply-rsvp__desc">{o.desc}</span>
            </button>
          ))}
        </div>
      </>
    ) },
    { title: "Review & submit", short: "Review", body: (
      <div className="apply-review">
        {[
          ["Couple", `${f.partnerA} & ${f.partnerB}`],
          ["Email", f.email],
          ["Site address", `${f.subdomain}.celebrately.us`],
          ["Date", f.weddingDate ? dateLabelOf(f.weddingDate) : "Not set yet"],
          ["Theme", (THEMES[f.theme] || {}).label || f.theme],
          ["Venue", f.venueName || f.mapQuery || "Not set yet"],
          ["Schedule", `${f.schedule.filter((r) => r.title.trim()).length} item(s)`],
          ["Entourage", f.entourage.length ? `${f.entourage.length} group(s)` : "Skipped"],
          ["RSVP", f.strictRsvp ? "Strict (invited guests only)" : "Open"],
        ].map(([k, v]) => (
          <div key={k} className="apply-review__row"><span>{k}</span><strong>{v}</strong></div>
        ))}
        <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 14 }}>
          We'll review your request and email you at <strong>{f.email}</strong> when your site is approved.
        </p>
      </div>
    ) },
  ];

  if (done) {
    return (
      <div className="signin admin--sa">
        <div className="signin__pane">
          <header className="signin__top"><div className="signin__brand"><Logo size={30} /><span className="signin__word">Celebrately</span></div></header>
          <div className="signin__center">
            <div className="signin__form" style={{ textAlign: "center" }}>
              <div style={{ color: "#16a34a", marginBottom: 14 }}>{Icon.check({ style: { width: 42, height: 42 } })}</div>
              <h1 className="signin__title">Request sent!</h1>
              <p className="signin__sub">Thanks, {f.partnerA}! We'll review your setup and email you at <strong>{f.email}</strong> once <strong>{f.subdomain}.celebrately.us</strong> is approved.</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const last = step === steps.length - 1;
  const s = steps[step];
  return (
    <div className="signin admin--sa">
      <div className="signin__pane">
        <header className="signin__top"><div className="signin__brand"><Logo size={30} /><span className="signin__word">Celebrately</span></div></header>
        <div className="signin__center">
          <div className="signin__form apply-form">
            <div className="apply-steps" aria-label={`Step ${step + 1} of ${steps.length}`}>
              {steps.map((st, i) => (
                <button
                  key={st.short}
                  type="button"
                  className={"apply-steps__it" + (i === step ? " is-current" : i < step ? " is-done" : "")}
                  disabled={i >= step}
                  aria-current={i === step ? "step" : undefined}
                  onClick={() => { if (i < step) { setErr(""); setStep(i); } }}
                >
                  <span className="apply-steps__num">{i < step ? "✓" : i + 1}</span>
                  <span className="apply-steps__lbl">{st.short}</span>
                </button>
              ))}
            </div>
            <h1 className="signin__title" style={{ fontSize: 26 }}>{s.title}</h1>
            <div className="apply-body">{s.body}</div>
            {err && <div className="signin__err" style={{ margin: "12px 0" }}>{err}</div>}
            <div className="wizard__nav">
              <span>{s.skippable && !last && <button type="button" className="wizard__skip" onClick={() => { setF((p) => ({ ...p, entourage: [] })); setStep(step + 1); }}>Skip this step</button>}</span>
              <div style={{ display: "flex", gap: 10 }}>
                {step > 0 && <Button variant="ghost" onClick={() => { setErr(""); setStep(step - 1); }} disabled={busy}>Back</Button>}
                {last
                  ? <Button variant="primary" onClick={submit} disabled={busy}>{busy ? "Sending…" : "Submit for approval"}</Button>
                  : <Button variant="primary" onClick={next}>Next</Button>}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
