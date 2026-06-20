import React from "react";
import { go } from "@/lib/nav.js";
import { Store, useStore } from "@/lib/store.jsx";
import { Button, Field, Icon, Input, Select, Textarea } from "@/ui/components.jsx";
import { PageHero } from "@/pages/PublicPages.jsx";
const { useState, useEffect, useRef, useMemo, useCallback, useReducer } = React;

// ============================================================================
// rsvp.jsx — RSVP form with validation, duplicate detection, success state
// ============================================================================

export const DIET_OPTIONS = ["None", "Vegetarian", "Vegan", "Gluten-free", "Halal", "Kosher", "Seafood allergy", "Nut allergy", "Other"];

export function RSVPPage() {
  const { settings, rsvps } = useStore();
  const [form, setForm] = useState({
    fullName: "", email: "", phone: "", status: "attending", count: 1,
    plusOne: "", diet: "None", dietNotes: "", song: "", notes: "",
  });
  const [errors, setErrors] = useState({});
  const [submitted, setSubmitted] = useState(false);

  const set = (k) => (e) => {
    const v = e && e.target ? e.target.value : e;
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((er) => ({ ...er, [k]: undefined }));
  };

  const attending = form.status === "attending";

  function validate() {
    const er = {};
    if (!form.fullName.trim()) er.fullName = "Please enter your name.";
    if (!form.email.trim()) er.email = "Please enter your email.";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) er.email = "Please enter a valid email address.";
    if (attending) {
      const n = parseInt(form.count, 10);
      if (!n || n < 1) er.count = "Please enter how many will attend.";
      if (n > 8) er.count = "For parties larger than 8, please contact the couple directly.";
    }
    if (form.diet === "Other" && !form.dietNotes.trim()) er.dietNotes = "Please describe the dietary need.";
    if (form.notes.length > 1000) er.notes = "Please keep notes under 1000 characters.";
    return er;
  }

  function submit(e) {
    e.preventDefault();
    const er = validate();
    if (Object.keys(er).length) { setErrors(er); return; }
    const dupe = rsvps.find((r) => r.email.toLowerCase() === form.email.trim().toLowerCase());
    if (dupe) {
      setErrors({ email: "An RSVP using this email already exists. Contact the couple to make changes." });
      return;
    }
    Store.addRSVP({
      ...form,
      count: attending ? parseInt(form.count, 10) : 0,
    });
    setSubmitted(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
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
                  ? `Your RSVP is in, ${form.fullName.split(" ")[0]}. We've noted ${form.count} ${form.count > 1 ? "guests" : "guest"}. See you on the dance floor.`
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

  return (
    <div className="fade-up">
      <PageHero eyebrow="RSVP" title="Will you be there?" lead={`Kindly respond by ${settings.rsvpDeadline}.`} />
      <section className="block" style={{ paddingTop: 20 }}>
        <div className="container container--narrow">
          <form className="card card--pad-lg" onSubmit={submit} noValidate>
            <Field label="Full name" required error={errors.fullName} id="r-name">
              <Input id="r-name" value={form.fullName} onChange={set("fullName")} placeholder="Jane Doe" />
            </Field>
            <div className="field-row field-row--2">
              <Field label="Email" required error={errors.email} id="r-email">
                <Input id="r-email" type="email" value={form.email} onChange={set("email")} placeholder="jane@email.com" />
              </Field>
              <Field label="Phone" hint="Optional" id="r-phone">
                <Input id="r-phone" value={form.phone} onChange={set("phone")} placeholder="(555) 012-3456" />
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
                  <Field label="Number attending" required error={errors.count} id="r-count" hint="Including yourself">
                    <Select id="r-count" value={form.count} onChange={set("count")}>
                      {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>{n}</option>)}
                    </Select>
                  </Field>
                  <Field label="Dietary preference" id="r-diet">
                    <Select id="r-diet" value={form.diet} onChange={set("diet")}>
                      {DIET_OPTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
                    </Select>
                  </Field>
                </div>
                {form.count > 1 && (
                  <Field label="Names of your guests" hint="So we can set the table" id="r-plus">
                    <Input id="r-plus" value={form.plusOne} onChange={set("plusOne")} placeholder="e.g. John Doe, Sam Lee" />
                  </Field>
                )}
                {form.diet === "Other" && (
                  <Field label="Tell us about the dietary need" required error={errors.dietNotes} id="r-dietnote">
                    <Input id="r-dietnote" value={form.dietNotes} onChange={set("dietNotes")} placeholder="e.g. lactose intolerant" />
                  </Field>
                )}
                <Field label="Song request" hint="What will get you on the dance floor?" id="r-song">
                  <Input id="r-song" value={form.song} onChange={set("song")} placeholder="Artist — Song title" />
                </Field>
              </div>
            )}

            <Field label="A note for the couple" hint={`${form.notes.length}/1000`} error={errors.notes} id="r-notes">
              <Textarea id="r-notes" value={form.notes} onChange={set("notes")} maxLength={1100} placeholder="Anything you'd like us to know?" />
            </Field>

            <Button type="submit" variant="primary" size="lg" block>Send RSVP {Icon.arrow({})}</Button>
          </form>
        </div>
      </section>
    </div>
  );
}

Object.assign(window, { RSVPPage });
