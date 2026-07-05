import React from "react";
import { Store, useStore } from "@/lib/store.jsx";
import { saveClientData } from "@/lib/api.js";
import { THEMES, THEME_FONTS } from "@/themes";
import { themesForEvent, DEFAULT_EVENT_TYPE } from "@/config/eventTypes.js";
import { isPremiumTheme } from "@/themes";
import { Button, Field, Input, Modal, toast } from "@/ui/components.jsx";
const { useState } = React;

// ============================================================================
// wizard.jsx — first-login setup wizard for self-registered owners.
// Shows when settings.onboarded === false (seeded by the self-signup Edge
// Function); finishing or skipping sets onboarded:true and saves.
// ============================================================================

const dateLabelOf = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
};

export function SetupWizard() {
  const { settings } = useStore();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState(() => ({
    partnerA: settings.partnerA || "",
    partnerB: settings.partnerB || "",
    weddingDate: settings.weddingDate || "",
    venueName: settings.venueName || "",
    venueAddress: settings.venueAddress || "",
    ceremonyTime: settings.ceremonyTime || "",
    theme: settings.theme || "classic",
  }));
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));

  const finish = async (skip) => {
    if (busy) return;
    setBusy(true);
    try {
      const patch = skip ? { onboarded: true } : {
        partnerA: f.partnerA.trim() || settings.partnerA,
        partnerB: f.partnerB.trim() || settings.partnerB,
        weddingDate: f.weddingDate,
        weddingDateLabel: dateLabelOf(f.weddingDate) || settings.weddingDateLabel,
        venueName: f.venueName.trim(),
        venueAddress: f.venueAddress.trim(),
        ceremonyTime: f.ceremonyTime.trim(),
        theme: f.theme,
        themeAccent: "",
        displayFont: (THEME_FONTS[f.theme] || {}).display,
        bodyFont: (THEME_FONTS[f.theme] || {}).body,
        onboarded: true,
      };
      const prevSettings = { ...Store.get().settings };
      Store.updateSettings(patch);
      try {
        await saveClientData();
        toast(skip ? "You can finish setup anytime in Home & Settings" : "You're all set — welcome!", "success");
      } catch (saveErr) {
        Store.updateSettings({ ...prevSettings, onboarded: false }); // full rollback
        throw saveErr;
      }
    } catch (e) {
      toast("Couldn't save — please try again", "err");
    } finally {
      setBusy(false);
    }
  };

  const themes = themesForEvent(settings.eventType || DEFAULT_EVENT_TYPE).filter((k) => THEMES[k] && !isPremiumTheme(k));

  const steps = [
    {
      title: "Welcome! Let's set up your site",
      body: (
        <>
          <div className="field-row field-row--2">
            <Field label="Your first name" id="w-pa"><Input id="w-pa" value={f.partnerA} onChange={set("partnerA")} /></Field>
            <Field label="Partner's first name" id="w-pb"><Input id="w-pb" value={f.partnerB} onChange={set("partnerB")} /></Field>
          </div>
          <Field label="Wedding date & time" id="w-date" hint="Drives the countdown on your home page — leave blank if you haven't picked one.">
            <Input id="w-date" type="datetime-local" value={f.weddingDate} onChange={set("weddingDate")} />
          </Field>
        </>
      ),
    },
    {
      title: "Where's the celebration?",
      body: (
        <>
          <Field label="Venue name" id="w-vn" hint="Leave blank if you're still deciding."><Input id="w-vn" value={f.venueName} onChange={set("venueName")} placeholder="The Old Orchard" /></Field>
          <Field label="Venue address" id="w-va"><Input id="w-va" value={f.venueAddress} onChange={set("venueAddress")} placeholder="City, Country" /></Field>
          <Field label="Ceremony time" id="w-ct"><Input id="w-ct" value={f.ceremonyTime} onChange={set("ceremonyTime")} placeholder="3:00 PM" /></Field>
        </>
      ),
    },
    {
      title: "Pick your look",
      body: (
        <>
          <p style={{ color: "var(--muted)", fontSize: 14, margin: "0 0 14px" }}>You can change this anytime in Settings → Theme.</p>
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
      ),
    },
  ];

  const last = step === steps.length - 1;
  const s = steps[step];

  return (
    <Modal open onClose={() => finish(true)} label="Set up your site" solid>
      <div className="wizard">
        <div className="wizard__progress">Step {step + 1} of {steps.length}</div>
        <h2 className="wizard__title">{s.title}</h2>
        <div className="wizard__body">{s.body}</div>
        <div className="wizard__nav">
          <button type="button" className="wizard__skip" onClick={() => finish(true)} disabled={busy}>Set up later</button>
          <div style={{ display: "flex", gap: 10 }}>
            {step > 0 && <Button variant="ghost" onClick={() => setStep(step - 1)} disabled={busy}>Back</Button>}
            {last
              ? <Button variant="primary" onClick={() => finish(false)} disabled={busy}>{busy ? "Saving…" : "Finish setup"}</Button>
              : <Button variant="primary" onClick={() => setStep(step + 1)} disabled={busy}>Next</Button>}
          </div>
        </div>
      </div>
    </Modal>
  );
}
