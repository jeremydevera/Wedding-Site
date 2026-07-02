import React from "react";
import { go } from "@/lib/nav.js";
import { scrollToTop } from "@/lib/scroll.js";
import { Store, useStore } from "@/lib/store.jsx";
import { postRsvp, rsvpNameTaken, guestAllocation } from "@/lib/api.js";
import { isRsvpClosed, joinPlusOnes, isValidOptionalEmail, maxPartySize } from "@/lib/rsvp.js";
import { Button, Field, Icon, Input, Select, Textarea, confirmDialog } from "@/ui/components.jsx";
import { PageHero } from "@/pages/PublicPages.jsx";
const { useState, useEffect, useRef, useMemo, useCallback, useReducer } = React;

// ============================================================================
// rsvp.jsx — RSVP form with validation, duplicate detection, success state
// ============================================================================

export const DIET_OPTIONS = ["None", "Vegetarian", "Vegan", "Gluten-free", "Halal", "Kosher", "Seafood allergy", "Nut allergy", "Other"];

export function RSVPPage() {
  const { settings } = useStore();
  const [form, setForm] = useState({
    firstName: "", middleName: "", lastName: "", email: "", phone: "", status: "attending", count: 0,
    guestNames: [], diet: "None", dietNotes: "", song: "", notes: "",
  });
  const [errors, setErrors] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const set = (k) => (e) => {
    const v = e && e.target ? e.target.value : e;
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((er) => ({ ...er, [k]: undefined }));
  };

  const attending = form.status === "attending";
  const strict = settings.strictRsvp === true;

  // Strict RSVP: once a first+last name is typed, look up the guest on the list
  // (the RPC returns only a status + a number — never the list itself) and show
  // live feedback: "checking…" while the debounce is pending, then found /
  // not-found / add-your-middle-name. Debounced; a stale response is ignored.
  // A lookup failure clears the hint — the submit gate re-checks and is the
  // source of truth either way.
  const [lookup, setLookup] = useState(null); // null | "checking" | { status, allocation }
  useEffect(() => {
    if (!strict) return;
    if (!form.firstName.trim() || !form.lastName.trim()) { setLookup(null); return; }
    setLookup("checking");
    let live = true;
    const t = setTimeout(() => {
      guestAllocation(form.firstName, form.middleName, form.lastName)
        .then((res) => { if (live) setLookup(res); })
        .catch(() => { if (live) setLookup(null); });
    }, 450);
    return () => { live = false; clearTimeout(t); };
  }, [strict, form.firstName, form.middleName, form.lastName]);
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
      if (alloc != null && c < 1) return { ...f, count: 1 };
      return c > maxCount ? { ...f, count: maxCount } : f;
    });
  }, [strict, maxCount, alloc]);

  // Companion-name slots shown under the count field.
  const slots = attending
    ? (strict ? Math.max(0, (parseInt(form.count, 10) || 0) - 1) : Math.min(7, Math.max(0, parseInt(form.count, 10) || 0)))
    : 0;

  function validate() {
    const er = {};
    if (!form.firstName.trim()) er.firstName = "Please enter your first name.";
    if (!form.lastName.trim()) er.lastName = "Please enter your last name.";
    if (!isValidOptionalEmail(form.email)) er.email = "Please enter a valid email, or leave it blank.";
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
  const FIELD_IDS = { firstName: "r-first", lastName: "r-last", middleName: "r-middle", email: "r-email", count: "r-count", dietNotes: "r-dietnote", notes: "r-notes" };
  function showErrors(er) {
    setErrors(er);
    const first = ["firstName", "lastName", "middleName", "email", "count", "dietNotes", "notes"].find((k) => er[k]);
    const el = first && document.getElementById(FIELD_IDS[first]);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      try { el.focus({ preventScroll: true }); } catch (_) {}
    }
  }

  async function submit(e) {
    e.preventDefault();
    if (submitting) return;
    const er = validate();
    if (Object.keys(er).length) { showErrors(er); return; }
    const fullName = [form.firstName, form.middleName, form.lastName].map((s) => s.trim()).filter(Boolean).join(" ");
    const picked = attending ? (parseInt(form.count, 10) || 0) : 0;
    const companions = (form.guestNames || []).slice(0, slots).map((s) => (s || "").trim()).filter(Boolean);
    const plusOne = companions.join(", ");
    // Head count: strict = who they NAMED plus themselves (slots are advisory);
    // open = typed companions + themselves (names optional there).
    const count = attending ? (strict ? companions.length + 1 : picked + 1) : 0;
    const payload = { ...form, fullName, count, plusOne, companions };
    setSubmitting(true);
    try {
      // Strict RSVP: only invited guests may respond, capped at their seat
      // allocation. Checked server-side at submit (the live hint is advisory,
      // so editing the name after the lookup can't bypass the gate).
      if (strict) {
        const res = await guestAllocation(form.firstName, form.middleName, form.lastName);
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
      // Duplicate name: one response per guest — no self-service updates.
      // Changes go through the couple (the admin can edit the reply).
      if (await rsvpNameTaken(form.firstName, form.middleName, form.lastName)) {
        setSubmitting(false);
        await confirmDialog({
          title: "You've already RSVP'd",
          message: `${fullName} has already responded — we've got you down. If something changed, please contact the couple.`,
          confirmLabel: "OK",
          okOnly: true,
          noIcon: true,
        });
        go("home");
        return;
      }
      await postRsvp(payload);
      setForm((f) => ({ ...f, count })); // success card shows the real head count
      setSubmitted(true);
      scrollToTop({ top: 0, behavior: "smooth" });
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

  if (isRsvpClosed(settings.rsvpDeadlineDate, Date.now())) {
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
      <PageHero eyebrow="RSVP" title="Will you be there?" lead={`Kindly respond by ${settings.rsvpDeadline}.`} />
      <section className="block" style={{ paddingTop: 20 }}>
        <div className="container container--narrow">
          <form className="card card--pad-lg" onSubmit={submit} noValidate>
            <div className="field-row field-row--2">
              <Field label="First name" required error={errors.firstName} id="r-first">
                <Input id="r-first" value={form.firstName} onChange={set("firstName")} />
              </Field>
              <Field label="Last name" required error={errors.lastName} id="r-last">
                <Input id="r-last" value={form.lastName} onChange={set("lastName")} />
              </Field>
            </div>
            <Field label="Middle name" error={errors.middleName} id="r-middle">
              <Input id="r-middle" value={form.middleName} onChange={set("middleName")} />
            </Field>
            {strict && lookup && (
              <div style={{ marginTop: -8, marginBottom: 16, fontSize: 14 }} aria-live="polite">
                {lookup === "checking"
                  ? <span style={{ color: "var(--muted)" }}>Checking the guest list…</span>
                  : lookup.status === "ok"
                    ? <span style={{ color: "#2e7d32", fontWeight: 600 }}>✓ You're on the guest list — {lookup.allocation} {lookup.allocation === 1 ? "seat" : "seats"} reserved</span>
                    : lookup.status === "ambiguous"
                      ? <span style={{ color: "var(--danger, #a33)" }}>More than one guest has this name — please add your middle name.</span>
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
            <Field label="Email" hint="Optional — so the couple can reach you about the day" error={errors.email} id="r-email">
              <Input id="r-email" type="email" inputMode="email" value={form.email} onChange={set("email")} />
            </Field>
            <Field label="Phone" hint="Optional" id="r-phone">
              <Input id="r-phone" value={form.phone} onChange={set("phone")} />
            </Field>

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
                    <Field label="Number attending" required error={errors.count} id="r-count"
                      hint={`Your invitation reserves ${alloc} ${alloc === 1 ? "seat" : "seats"}`}>
                      <Select id="r-count" value={form.count} onChange={set("count")}>
                        {Array.from({ length: maxCount }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
                      </Select>
                    </Field>
                  ) : (
                    // Strict mode, name not verified yet: keep the picker locked so a
                    // guest can't choose a party size before their seats are known.
                    <Field label="Number attending" id="r-count" hint="Enter your name above first — your seats unlock once we find you">
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
                  <Field label="Names of your guests" hint="So we can set the table">
                    <div style={{ display: "grid", gap: 8 }}>
                      {Array.from({ length: slots }, (_, i) => (
                        <Input
                          key={i}
                          aria-label={`Guest ${i + 2} name`}
                          placeholder={`Guest ${i + 2}`}
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
                <Field label="Song request" hint="What will get you on the dance floor?" id="r-song">
                  <Input id="r-song" value={form.song} onChange={set("song")} />
                </Field>
              </div>
            )}

            <Field label="A note for the couple" hint={`${form.notes.length}/1000`} error={errors.notes} id="r-notes">
              <Textarea id="r-notes" value={form.notes} onChange={set("notes")} maxLength={1100} placeholder="Anything you'd like us to know?" />
            </Field>

            <Button type="submit" variant="primary" size="lg" block disabled={submitting}>{submitting ? "Sending…" : <>Send RSVP {Icon.arrow({})}</>}</Button>
          </form>
        </div>
      </section>
    </div>
  );
}

