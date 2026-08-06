import React from "react";
import { go } from "@/lib/nav.js";
import { scrollToTop } from "@/lib/scroll.js";
import { Store, useStore } from "@/lib/store.jsx";
import { postRsvp, rsvpNameTaken, upsertRsvp, guestAllocation, guestMatchByName, guestPickById } from "@/lib/api.js";
import { isRsvpClosed, joinPlusOnes, isValidOptionalEmail, maxPartySize } from "@/lib/rsvp.js";
import { sectionLabel } from "@/lib/roles.js";
import { Button, Field, Icon, Input, Modal, Select, Textarea, confirmDialog } from "@/ui/components.jsx";
import { PageHero } from "@/pages/PublicPages.jsx";
const { useState, useEffect, useRef, useMemo, useCallback, useReducer } = React;

// ============================================================================
// rsvp.jsx — RSVP form with validation, duplicate detection, success state
// ============================================================================

export const DIET_OPTIONS = ["None", "Vegetarian", "Vegan", "Gluten-free", "Halal", "Kosher", "Seafood allergy", "Nut allergy", "Other"];

// The deadline is stored as a naive <datetime-local> string ("2026-08-15T23:00",
// no timezone). The server guard (0018) closes the form via `(dl)::timestamptz <
// now()`, which anchors that same naive string to the DB session timezone (UTC).
// Date.parse of a naive string uses the GUEST's browser-local timezone, so the
// client gate would drift per visitor and disagree with the server near the
// deadline. Anchor the naive string to UTC so client and server close at the
// same absolute instant. Strings that already carry a timezone (Z / ±hh:mm) and
// empty/unparseable values pass through unchanged (isRsvpClosed handles those).
export function deadlineUTC(dl) {
  if (!dl || typeof dl !== "string") return dl;
  // Already has an explicit timezone designator? leave as-is.
  if (/(?:Z|[+-]\d{2}:?\d{2})$/.test(dl)) return dl;
  // Naive datetime-local (with optional seconds): interpret as UTC.
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(dl) ? dl + "Z" : dl;
}

export function RSVPPage() {
  const { settings } = useStore();
  const [form, setForm] = useState({
    name: "", firstName: "", middleName: "", lastName: "", email: "", phone: "", status: "attending", count: 0,
    guestNames: [], diet: "None", dietNotes: "", song: "", notes: "",
  });
  const [errors, setErrors] = useState({});
  const [submitted, setSubmitted] = useState(false);
  // Guests submit from deep in a long form on phones — jump to the top AFTER
  // the confirmation card replaces the form (scrolling before the swap gets
  // cancelled by the layout change on iOS, leaving the guest staring at the
  // footer instead of the confirmation).
  useEffect(() => {
    if (!submitted) return;
    const r = requestAnimationFrame(() => scrollToTop({ top: 0, behavior: "auto" }));
    return () => cancelAnimationFrame(r);
  }, [submitted]);
  const [submitting, setSubmitting] = useState(false);

  const set = (k) => (e) => {
    const v = e && e.target ? e.target.value : e;
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((er) => ({ ...er, [k]: undefined }));
  };

  const attending = form.status === "attending";
  const strict = settings.strictRsvp === true;
  // Single-name mode (per-client settings.rsvpSingleName): ONE "Name" box that is
  // matched against the guest list as a whole, instead of first/middle/last
  // boxes that had to match exactly. The reply is still STORED under the invited
  // guest's canonical parts, so the admin table, reconcile, exports and the
  // duplicate check all keep working untouched.
  const singleName = settings.rsvpSingleName !== false; // default ON for every client (owner 2026-08-07); set false to opt a client out
  // Ambiguity picker: several invited guests fit the typed name, so the guest
  // says which one they are. Resolves the promise submit() is awaiting.
  const [picker, setPicker] = useState(null); // null | { candidates, resolve }
  const askWhichGuest = (candidates) => new Promise((resolve) => setPicker({ candidates, resolve }));
  const closePicker = (choice) => {
    setPicker((p) => { if (p) p.resolve(choice || null); return null; });
  };
  const phoneRequired = settings.rsvpRequirePhone === true;

  // Strict RSVP: once a first+last name is typed, look up the guest on the list
  // (the RPC returns only a status + a number — never the list itself) and show
  // live feedback: "checking…" while the debounce is pending, then found /
  // not-found / add-your-middle-name. Debounced; a stale response is ignored.
  // A lookup failure clears the hint — the submit gate re-checks and is the
  // source of truth either way.
  const [lookup, setLookup] = useState(null); // null | "checking" | { status, allocation }
  useEffect(() => {
    if (!strict) return;
    if (singleName) {
      // Wait for at least two words: one word is "too_vague" server-side, and a
      // hint on every keystroke of a first name would be noise.
      if (form.name.trim().split(/\s+/).filter(Boolean).length < 2) { setLookup(null); return; }
      setLookup("checking");
      let live = true;
      const t = setTimeout(() => {
        guestMatchByName(form.name)
          .then((res) => { if (live) setLookup(res); })
          .catch(() => { if (live) setLookup(null); });
      }, 450);
      return () => { live = false; clearTimeout(t); };
    }
    if (!form.firstName.trim() || !form.lastName.trim()) { setLookup(null); return; }
    setLookup("checking");
    let live = true;
    const t = setTimeout(() => {
      guestAllocation(form.firstName, form.middleName, form.lastName)
        .then((res) => { if (live) setLookup(res); })
        .catch(() => { if (live) setLookup(null); });
    }, 450);
    return () => { live = false; clearTimeout(t); };
  }, [strict, singleName, form.name, form.firstName, form.middleName, form.lastName]);
  const alloc = lookup && lookup !== "checking" && lookup.status === "ok" ? lookup.allocation : null;

  // Open mode: same live pattern, but against prior replies — tell the guest
  // right away if this name has already responded.
  const [openTaken, setOpenTaken] = useState(null); // null | "checking" | boolean
  useEffect(() => {
    if (strict) return;
    if (!form.firstName.trim() || !form.lastName.trim()) { setOpenTaken(null); return; }
    setOpenTaken("checking");
    let live = true;
    const t = setTimeout(() => {
      rsvpNameTaken(form.firstName, form.middleName, form.lastName)
        .then((v) => { if (live) setOpenTaken(!!v); })
        .catch(() => { if (live) setOpenTaken(null); });
    }, 450);
    return () => { live = false; clearTimeout(t); };
  }, [strict, form.firstName, form.middleName, form.lastName]);

  // Strict: the picker is TOTAL attending (allocation-capped) and unlocks at 1
  // once the name is verified. Open: the typed number IS the companions they
  // bring ("3" = you + 3), so no picker cap beyond the party-of-8 total rule.
  const maxCount = strict ? maxPartySize(alloc) : 8;
  useEffect(() => {
    if (!strict) return;
    setForm((f) => {
      const c = parseInt(f.count, 10) || 0;
      // Once the name verifies, default to the FULL party (owner request):
      // 2 allotted seats → picker preset to 1 plus-one (with their name slot
      // ready), 3 seats → 2. The guest can still lower it; the untouched
      // default is c <= 1, so an explicit smaller pick is never overridden.
      if (alloc != null && c <= 1) return { ...f, count: Math.max(1, alloc) };
      return c > maxCount ? { ...f, count: maxCount } : f;
    });
  }, [strict, maxCount, alloc]);

  // Companion-name slots shown under the count field.
  const slots = attending
    ? (strict ? Math.max(0, (parseInt(form.count, 10) || 0) - 1) : Math.min(7, Math.max(0, parseInt(form.count, 10) || 0)))
    : 0;

  function validate() {
    const er = {};
    if (singleName) {
      const words = form.name.trim().split(/\s+/).filter(Boolean);
      if (!words.length) er.name = "Please enter your name.";
      else if (words.length < 2) er.name = "Please enter your full name as it appears on your invitation.";
    } else {
      if (!form.firstName.trim()) er.firstName = "Please enter your first name.";
      if (!form.lastName.trim()) er.lastName = "Please enter your last name.";
    }
    if (!isValidOptionalEmail(form.email)) er.email = "Please enter a valid email, or leave it blank.";
    if (phoneRequired && !form.phone.trim()) er.phone = "Please enter your contact number.";
    if (attending) {
      const n = parseInt(form.count, 10);
      if (strict) {
        if (!n || n < 1) er.count = "Please enter how many will attend.";
        // The cap is the guest's allocation (can exceed 8).
        if (n > maxCount) er.count = alloc
          ? `Your invitation reserves ${maxCount} ${maxCount === 1 ? "seat" : "seats"}.`
          : "For parties larger than 8, please contact the couple directly.";
      } else {
        // Open mode: the number is companions brought along (0 = just you).
        if (Number.isNaN(n) || n < 0) er.count = "How many are you bringing? Enter 0 if it's just you.";
        if (n > 7) er.count = "For parties larger than 8, please contact the couple directly.";
      }
    }
    if (form.diet === "Other" && !form.dietNotes.trim()) er.dietNotes = "Please describe the dietary need.";
    if (form.notes.length > 1000) er.notes = "Please keep notes under 1000 characters.";
    return er;
  }

  // Show validation errors AND bring the first offending field into view —
  // on a long mobile form the message is otherwise off-screen.
  const FIELD_IDS = { name: "r-name", firstName: "r-first", lastName: "r-last", middleName: "r-middle", email: "r-email", phone: "r-phone", count: "r-count", dietNotes: "r-dietnote", notes: "r-notes" };
  function showErrors(er) {
    setErrors(er);
    // Order matches the form top-to-bottom; phone was missing, so a required
    // contact number never got scrolled to / focused on "Send RSVP".
    const first = ["name", "firstName", "middleName", "lastName", "email", "phone", "count", "dietNotes", "notes"].find((k) => er[k]);
    const el = first && document.getElementById(FIELD_IDS[first]);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      try { el.focus({ preventScroll: true }); } catch (_) {}
    }
  }

  async function submit(e, forceUpdate) {
    e.preventDefault();
    if (submitting) return;
    const er = validate();
    if (Object.keys(er).length) { showErrors(er); return; }
    // Resolve the typed name to ONE invited guest first (single-name mode); the
    // reply is then stored under that guest's canonical parts so everything
    // downstream — reconcile, the admin table, exports, the duplicate check —
    // keeps matching on first/middle/last exactly as before.
    let parts = { firstName: form.firstName, middleName: form.middleName, lastName: form.lastName };
    let matched = null;
    if (singleName) {
      if (strict) {
        let res;
        try { res = await guestMatchByName(form.name); }
        catch (err) {
          setSubmitting(false);
          await confirmDialog({ title: "We couldn't check the guest list", message: "Something went wrong looking up your name. Please try again in a moment.", confirmLabel: "OK", okOnly: true, noIcon: true });
          return;
        }
        if (res.status === "too_vague") {
          setSubmitting(false);
          showErrors({ name: "Please enter your full name as it appears on your invitation." });
          return;
        }
        if (res.status === "ambiguous") {
          // Several invited guests fit — let the guest say which one they are.
          setSubmitting(false);
          const chosen = await askWhichGuest(res.candidates);
          if (!chosen) return;                     // dismissed: nothing submitted
          setSubmitting(true);
          const picked = await guestPickById(chosen.id).catch(() => ({ status: "not_found" }));
          if (picked.status !== "ok") {
            setSubmitting(false);
            showErrors({ name: "We couldn't confirm that name — please try again." });
            return;
          }
          matched = picked;
        } else if (res.status === "ok") {
          matched = res;
        } else {
          setSubmitting(false);
          await confirmDialog({
            title: "We can't find your name",
            message: `${form.name.trim()} isn't on the guest list for this event. Please double-check the spelling matches your invitation, or contact the couple.`,
            confirmLabel: "OK", okOnly: true, noIcon: true,
          });
          return;
        }
        parts = { firstName: matched.first, middleName: matched.middle, lastName: matched.last };
      } else {
        // No guest list to match against: split the typed name so the stored
        // columns (and the admin table) still have something sensible.
        const w = form.name.trim().split(/\s+/).filter(Boolean);
        parts = { firstName: w[0] || "", middleName: w.slice(1, -1).join(" "), lastName: w.length > 1 ? w[w.length - 1] : "" };
      }
    }
    const fullName = [parts.firstName, parts.middleName, parts.lastName].map((s) => (s || "").trim()).filter(Boolean).join(" ");
    const picked = attending ? (parseInt(form.count, 10) || 0) : 0;
    const companions = (form.guestNames || []).slice(0, slots).map((s) => (s || "").trim()).filter(Boolean);
    const plusOne = companions.join(", ");
    // Head count: strict = who they NAMED plus themselves (slots are advisory);
    // open = typed companions + themselves (names optional there).
    const count = attending ? (strict ? companions.length + 1 : picked + 1) : 0;
    const payload = { ...form, ...parts, fullName, count, plusOne, companions };
    setSubmitting(true);
    try {
      // Strict RSVP: only invited guests may respond, capped at their seat
      // allocation. Checked server-side at submit (the live hint is advisory,
      // so editing the name after the lookup can't bypass the gate).
      let gateRes = null;
      if (strict && singleName) {
        // Already resolved server-side above; reuse it rather than re-querying
        // with parts the old exact-match RPC may not find.
        gateRes = { status: "ok", allocation: matched.allocation, guestStatus: matched.guestStatus };
        const seats = matched.allocation;
        if (attending && count > seats) {
          setSubmitting(false);
          showErrors({ count: `Your invitation reserves ${seats} ${seats === 1 ? "seat" : "seats"} — please choose up to ${seats}.` });
          return;
        }
      } else if (strict) {
        const res = await guestAllocation(form.firstName, form.middleName, form.lastName);
        gateRes = res;
        if (res.status === "ambiguous") {
          setSubmitting(false);
          showErrors({ middleName: "Please add your middle name so we know which guest you are." });
          await confirmDialog({
            title: "Which one are you?",
            message: `More than one ${fullName} is on the guest list. Please add your middle name so we know which one is you.`,
            confirmLabel: "OK",
            okOnly: true,
            noIcon: true,
          });
          return;
        }
        if (res.status !== "ok") {
          setSubmitting(false);
          await confirmDialog({
            title: "We can't find your name",
            message: `${fullName} isn't on the guest list for this event. Please double-check the spelling matches your invitation, or contact the couple.`,
            confirmLabel: "OK",
            okOnly: true,
            noIcon: true,
          });
          return;
        }
        const seats = res.allocation;
        if (attending && count > seats) {
          setSubmitting(false);
          showErrors({ count: `Your invitation reserves ${seats} ${seats === 1 ? "seat" : "seats"} — please choose up to ${seats}.` });
          return;
        }
      }
      // Duplicate name. Strict mode: verified guests may UPDATE their response
      // (coming or not + companions, via the rsvp_upsert RPC). Open mode stays
      // one-response-per-name — changes go through the couple.
      if (!forceUpdate && (await rsvpNameTaken(parts.firstName, parts.middleName, parts.lastName))) {
        setSubmitting(false);
        if (!strict) {
          await confirmDialog({
            title: "You've already RSVP'd",
            message: `This name has already responded — we've got you down. If something changed, please contact the couple.`,
            confirmLabel: "OK",
            okOnly: true,
            noIcon: true,
          });
          go("home");
          return;
        }
        const wantsUpdate = await confirmDialog({
          title: "You've already RSVP'd",
          message: `This name has already responded. Update your response with these details?`,
          confirmLabel: "Update it",
          noIcon: true,
        });
        if (wantsUpdate) return submit(e, true);
        return;
      }
      // Owner-curated list: a listed guest already counts as attending, so a
      // fresh "yes" is redundant — but let them save it to record companions
      // and details. Declines/maybes always record (the reply overrides).
      if (!forceUpdate && strict && attending && gateRes && gateRes.guestStatus === "attending") {
        setSubmitting(false);
        const proceed = await confirmDialog({
          title: "You're already listed",
          message: `${fullName} is already on the guest list as attending. Save this response to record your details${companions.length ? " and companions" : ""}?`,
          confirmLabel: "Save my response",
          noIcon: true,
        });
        if (!proceed) return;
        setSubmitting(true);
      }
      if (forceUpdate) await upsertRsvp(payload);
      else await postRsvp(payload);
      setForm((f) => ({ ...f, count })); // success card shows the real head count
      setSubmitted(true); // the submitted-effect scrolls AFTER the card renders
    } catch (err) {
      setErrors({ notes: "Could not submit right now. Please try again." });
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="fade-up">
        <section className="block">
          <div className="container container--narrow">
            <div className="card card--pad-lg confirm">
              <div className="confirm__seal">{Icon.check({})}</div>
              <h2 className="confirm__title">
                {attending ? "We can't wait to see you!" : "Thank you for letting us know."}
              </h2>
              <p className="confirm__text">
                {attending
                  ? `Your RSVP is in, ${form.firstName}. We've noted ${form.count} ${form.count > 1 ? "guests" : "guest"}. See you on the dance floor.`
                  : "We'll miss you, but we completely understand. Thank you for your kind reply."}
              </p>
              <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
                <Button variant="primary" onClick={() => go("guestbook")}>Sign the guestbook</Button>
                <Button variant="ghost" onClick={() => go("home")}>Back home</Button>
              </div>
            </div>
          </div>
        </section>
      </div>
    );
  }

  // The form auto-closes based on the "RSVP closes at" date alone (matching the
  // server-side rsvp_guard). The rsvpDeadlineOn toggle is display-only — it does
  // NOT reopen/close the form — so it must NOT gate this check, or the site would
  // show an open form the DB then rejects. Leave the date blank to keep RSVPs open.
  if (isRsvpClosed(deadlineUTC(settings.rsvpDeadlineDate), Date.now())) {
    return (
      <div className="fade-up">
        <section className="block">
          <div className="container container--narrow">
            <div className="card card--pad-lg confirm">
              <h2 className="confirm__title">RSVPs are now closed</h2>
              <p className="confirm__text">
                Thank you! The RSVP window closed on {settings.rsvpDeadline}. If you still
                need to reach us, please contact the couple directly.
              </p>
              <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
                <Button variant="ghost" onClick={() => go("home")}>Back home</Button>
              </div>
            </div>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="fade-up">
      <PageHero eyebrow={sectionLabel("rsvp", settings.moduleLabels, "RSVP")} title="Will you be there?" lead={settings.rsvpDeadlineOn !== false && settings.rsvpDeadline ? `Kindly respond by ${settings.rsvpDeadline}.` : undefined} />
      <section className="block" style={{ paddingTop: 20 }}>
        <div className="container container--narrow">
          <form className="card card--pad-lg" onSubmit={submit} noValidate>
            {singleName ? (
              <Field label="Name" required error={errors.name} id="r-name"
                hint={strict ? "As it appears on your invitation." : undefined}>
                <Input id="r-name" value={form.name} onChange={set("name")} autoComplete="name" placeholder="Juan Dela Cruz" />
              </Field>
            ) : (
              <div className="field-row field-row--3">
                <Field label="First name" required error={errors.firstName} id="r-first">
                  <Input id="r-first" value={form.firstName} onChange={set("firstName")} />
                </Field>
                <Field label="Middle name" error={errors.middleName} id="r-middle">
                  <Input id="r-middle" value={form.middleName} onChange={set("middleName")} />
                </Field>
                <Field label="Last name" required error={errors.lastName} id="r-last">
                  <Input id="r-last" value={form.lastName} onChange={set("lastName")} />
                </Field>
              </div>
            )}
            {strict && lookup && (
              <div style={{ marginTop: -8, marginBottom: 16, fontSize: 14 }} aria-live="polite">
                {lookup === "checking"
                  ? <span style={{ color: "var(--muted)" }}>Checking the guest list…</span>
                  : lookup.status === "ok"
                    ? <span style={{ color: "#2e7d32", fontWeight: 600 }}>✓ You're on the guest list — {lookup.allocation} {lookup.allocation === 1 ? "seat" : "seats"} reserved</span>
                    : lookup.status === "ambiguous"
                      ? <span style={{ color: "var(--muted)" }}>{singleName
                          ? "More than one guest matches — we'll ask which one you are."
                          : "More than one guest has this name — please add your middle name."}</span>
                      : lookup.status === "too_vague"
                        ? <span style={{ color: "var(--muted)" }}>Please enter your full name.</span>
                        : <span style={{ color: "var(--danger, #a33)" }}>We can't find this name on the guest list — please check the spelling.</span>}
              </div>
            )}
            {!strict && openTaken && (
              <div style={{ marginTop: -8, marginBottom: 16, fontSize: 14 }} aria-live="polite">
                {openTaken === "checking"
                  ? <span style={{ color: "var(--muted)" }}>Checking previous responses…</span>
                  : openTaken === true
                    ? <span style={{ color: "var(--danger, #a33)", fontWeight: 600 }}>This name has already RSVP&rsquo;d.</span>
                    : null}
              </div>
            )}
            <div className="field-row field-row--2">
              <Field label="Email" hint="Optional" error={errors.email} id="r-email">
                <Input id="r-email" type="email" inputMode="email" value={form.email} onChange={set("email")} />
              </Field>
              <Field label="Phone" hint={phoneRequired ? undefined : "Optional"} required={phoneRequired} error={errors.phone} id="r-phone">
                <Input id="r-phone" type="tel" inputMode="tel" value={form.phone} onChange={set("phone")} />
              </Field>
            </div>

            <Field label="Will you attend?" required>
              <div className="pills">
                {[["attending", "Joyfully accept"], ["not_attending", "Regretfully decline"], ["maybe", "Maybe"]].map(([val, lbl]) => (
                  <label key={val} className={"pill" + (form.status === val ? " pill--on" : "")}>
                    <input type="radio" name="status" checked={form.status === val} onChange={() => set("status")(val)} />
                    {lbl}
                  </label>
                ))}
              </div>
            </Field>

            {attending && (
              <div className="fade-up">
                <div className="field-row field-row--2">
                  {strict ? (alloc != null ? (
                    // Labelled "Plus 1s" (extra guests besides the responder), but
                    // form.count stays the TOTAL head count everywhere else — so the
                    // picker shows 0..alloc-1 and maps to count = picked + 1.
                    <Field label="Guests coming with you" required error={errors.count} id="r-count"
                      hint={`You have ${alloc} ${alloc === 1 ? "seat" : "seats"} — room for you plus ${alloc - 1} more`}>
                      <Select id="r-count" value={(parseInt(form.count, 10) || 1) - 1} onChange={(e) => set("count")(String((parseInt(e.target.value, 10) || 0) + 1))}>
                        {Array.from({ length: maxCount }, (_, i) => i).map((n) => <option key={n} value={n}>{n}</option>)}
                      </Select>
                    </Field>
                  ) : (
                    // Strict mode, name not verified yet: keep the picker locked so a
                    // guest can't choose a party size before their seats are known.
                    <Field label="Guests coming with you" id="r-count">
                      <Input id="r-count" value="" placeholder="—" disabled readOnly />
                    </Field>
                  )) : (
                    <Field label="Bringing with you" required error={errors.count} id="r-count">
                      <Input id="r-count" type="number" min={0} max={7} inputMode="numeric" value={form.count} onChange={set("count")} />
                    </Field>
                  )}
                  <Field label="Dietary preference" id="r-diet">
                    <Select id="r-diet" value={form.diet} onChange={set("diet")}>
                      {DIET_OPTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
                    </Select>
                  </Field>
                </div>
                {slots > 0 && (
                  <Field label="Names of the guests you're bringing" hint="You're Guest 1 — add the full name of everyone else attending with you, so we can set the table.">
                    <div style={{ display: "grid", gap: 8 }}>
                      {Array.from({ length: slots }, (_, i) => (
                        <Input
                          key={i}
                          aria-label={`Guest ${i + 2} full name`}
                          placeholder={`Guest ${i + 2} — full name`}
                          value={(form.guestNames && form.guestNames[i]) || ""}
                          onChange={(e) => {
                            const v = e.target.value;
                            setForm((f) => {
                              const g = [...(f.guestNames || [])];
                              g[i] = v;
                              return { ...f, guestNames: g };
                            });
                          }}
                        />
                      ))}
                    </div>
                  </Field>
                )}
                {form.diet === "Other" && (
                  <Field label="Tell us about the dietary need" required error={errors.dietNotes} id="r-dietnote">
                    <Input id="r-dietnote" value={form.dietNotes} onChange={set("dietNotes")} />
                  </Field>
                )}
              </div>
            )}

            <Field label="A note for the couple" hint={`${form.notes.length}/1000`} error={errors.notes} id="r-notes">
              <Textarea id="r-notes" value={form.notes} onChange={set("notes")} maxLength={1100} placeholder="Anything you'd like us to know?" />
            </Field>

            <Button type="submit" variant="primary" size="lg" block disabled={submitting}>{submitting ? "Sending…" : <>Send RSVP {Icon.arrow({})}</>}</Button>
          </form>
        </div>
      </section>

      {/* Several invited guests match the typed name — ask which one, instead of
          the old "add your middle name" dead end. Shows names ONLY; the matcher
          deliberately withholds seat counts and contact details here. */}
      <Modal open={!!picker} onClose={() => closePicker(null)} label="Which one are you?">
        <div style={{ padding: 4 }}>
          <h3 style={{ margin: "0 0 6px", fontSize: 20 }}>Which one are you?</h3>
          <p style={{ margin: "0 0 16px", color: "var(--muted)", fontSize: 14, lineHeight: 1.5 }}>
            More than one guest on the list matches <strong>{form.name.trim()}</strong>. Choose your name so we file your reply correctly.
          </p>
          <div style={{ display: "grid", gap: 8 }}>
            {(picker ? picker.candidates : []).map((c) => (
              <Button key={c.id} variant="secondary" block onClick={() => closePicker(c)}>{c.name}</Button>
            ))}
          </div>
          <div style={{ marginTop: 14 }}>
            <Button variant="ghost" block onClick={() => closePicker(null)}>None of these</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

