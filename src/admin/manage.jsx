import React from "react";
import { go } from "@/lib/nav.js";
import { Store, useStore, uid } from "@/lib/store.jsx";
import { EG_TINTS, ENV_COLORS, ENV_SEAL_MASK, ENV_SEAL_POS, THEMES, THEME_FONTS, egTintGradientFor, envColorFilterFor, isPremiumTheme } from "@/themes";
import { Button, CropModal, DecorPreview, FallingFx, Field, Icon, Input, Modal, Monogram, Pager, Placeholder, SectionHead, Select, Textarea, confirmDialog, mapEmbedUrl, mapSearchUrl, toast, usePaged } from "@/ui/components.jsx";
import { FX_LIST } from "@/lib/falling-fx.js";
import { Home } from "@/pages/PublicPages.jsx";
import { AdminDashboard, AdminLogin, Logo, QRCanvas, downloadCSV, downloadQR, fmtDate } from "@/admin/core.jsx";
import { signOut } from "@/lib/auth.js";
import { loadAdminData, subscribeAdminRealtime, saveClientData, setGuestbookStatusDb, deleteGuestbookDb, deleteRsvpDb, uploadAudio, uploadToR2, migrateClientMediaToR2, hasLegacyMedia, sendEmail, addGuestDb, updateGuestDb, deleteGuestDb, updateRsvpCompanionsDb, updateRsvpStatusDb, updateRsvpDietDb } from "@/lib/api.js";
import { DIET_OPTIONS } from "@/features/rsvp.jsx";
import { reconcileGuests, guestFromRsvp, normName } from "@/lib/guests.js";
import { headsOf } from "@/lib/rsvp.js";
import { mediaUrl } from "@/lib/media.js";
import { stateToClientRow } from "@/lib/mappers.js";
import { BRAND_NAME } from "@/config/site.js";
import { visibleAdminTabs, canEnterAdmin, tabsForClient, DISABLED_MODULES, moduleLabel, moduleEnabled } from "@/lib/roles.js";
import { ClientsAdmin, R2LibraryAdmin, SuperOverview } from "@/admin/superadmin.jsx";
import { LocationPicker } from "@/ui/location-picker.jsx";
import { DEFAULT_EVENT_TYPE, themesForEvent } from "@/config/eventTypes.js";
import { MediaPickerModal } from "@/admin/MediaPicker.jsx";
import { SetupWizard } from "@/admin/wizard.jsx";
const { useState, useEffect, useRef, useMemo, useCallback, useReducer } = React;

// Save state shared from the AdminApp shell down to each section's footer, so the
// Save button can live INSIDE the section card being edited (Supabase pattern).
const AdminSaveCtx = React.createContext({ saving: false, dirty: false, save: () => {}, run: (fn) => fn() });

// Up/down reorder arrows for admin list rows. `onMove(dir)` applies the move
// (dir -1 = up, +1 = down); disabled at the ends.
function MoveArrows({ i, count, onMove }) {
  return (
    <>
      <button type="button" className="icon-btn" title="Move up" aria-label="Move up" onClick={() => onMove(-1)} disabled={i === 0}>↑</button>
      <button type="button" className="icon-btn" title="Move down" aria-label="Move down" onClick={() => onMove(1)} disabled={i === count - 1}>↓</button>
    </>
  );
}

export function SaveFooter() {
  const { saving, dirty, save } = React.useContext(AdminSaveCtx);
  return (
    <div className="panel__foot">
      <span className="panel__foot-hint">{dirty ? "You have unsaved changes." : "Changes apply to your live site after you save."}</span>
      <Button variant="primary" size="sm" disabled={saving || !dirty} onClick={save}>{saving ? "Saving…" : "Save changes"}</Button>
    </div>
  );
}

// ============================================================================
// admin/manage.jsx — RSVP table, media/guestbook moderation, quiz, QR, settings
// + AdminApp shell (sidebar + routing between tabs)
// ============================================================================

// Reusable image uploader for admin (hero, story milestones)
export function ImageUploadField({ value, onChange, label, ratio = "4 / 3", framePreview, defaultPreview, tintStrength, tintGradient, purpose = "misc" }) {
  const { clientId } = useStore();
  const ref = useRef(null);
  const [cropSrc, setCropSrc] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const aspect = (() => { const m = String(ratio).split("/").map((n) => parseFloat(n)); return (m.length === 2 && m[1]) ? m[0] / m[1] : 1; })();
  function pick(file) {
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast("Please choose an image file.", "err"); return; }
    setCropSrc(URL.createObjectURL(file));
  }
  // Cropped image -> R2 (via /api/upload). Store the returned "/r2/<key>" URL,
  // not base64, so the client content row stays lean. Existing base64 values
  // still render fine (an <img src> takes either).
  async function applyCrop(dataUrl) {
    setPickerOpen(false);
    setCropSrc(null);
    setBusy(true);
    try {
      const blob = await (await fetch(dataUrl)).blob();
      const file = new File([blob], `image-${Date.now()}.jpg`, { type: blob.type || "image/jpeg" });
      const { key } = await uploadToR2(file, { scope: "owner", purpose }, clientId);
      onChange(key);
    } catch (e) {
      toast("Image upload failed: " + (e && e.message || "error"), "err");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="field">
      {label && <span className="field__label">{label}</span>}
      <div className="imgup">
        <div className="imgup__thumb" style={{ aspectRatio: ratio }}>
          {value
            ? <img src={mediaUrl(value)} alt="" />
            : defaultPreview
              ? <img src={defaultPreview} alt="" />
              : <Placeholder label="no photo" ratio={ratio} />}
          {!value && defaultPreview && <span className="imgup__badge">Default</span>}
          {tintStrength > 0 && (
            <span aria-hidden="true" style={{ position: "absolute", inset: 0, pointerEvents: "none",
              background: tintGradient || "linear-gradient(180deg, oklch(0.3 0.06 126 / 0.62), oklch(0.22 0.05 126 / 0.78))",
              opacity: Math.max(0, Math.min(100, tintStrength)) / 100 }} />
          )}
        </div>
        <div className="imgup__actions">
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => setPickerOpen(true)}>{Icon.upload({})} {busy ? "Uploading…" : (value ? "Replace" : "Add photo")}</Button>
          {value && !busy && <Button variant="ghost" size="sm" onClick={() => setCropSrc(value)}>{Icon.crop({})} Crop</Button>}
          {value && !busy && <Button variant="ghost" size="sm" onClick={() => onChange("")}>Remove</Button>}
        </div>
        <input ref={ref} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { setPickerOpen(false); pick(e.target.files[0]); }} />
      </div>
      <MediaPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        type="image"
        clientId={clientId}
        uploadLabel={value ? "Replace photo" : "Choose a photo"}
        onUploadNew={() => ref.current && ref.current.click()}
        onPick={(key) => onChange(key)}
      />
      <CropModal open={!!cropSrc} src={cropSrc} aspect={aspect} frameSrc={framePreview} onCancel={() => setCropSrc(null)} onApply={applyCrop} />
    </div>
  );
}

// Track cover uploader: accepts image (cropped to square), GIF, or MP4 (uploaded
// as-is so animation/video is preserved). Stores an R2 key. Separate from
// ImageUploadField so the image-only crop flow used elsewhere stays untouched.
const VIDEO_RE = /\.(mp4|webm|mov|m4v)$/i;
const IMG_EXT_RE = /\.(png|jpe?g|webp|gif|avif|bmp)$/i;
// Browsers sometimes report an empty/generic MIME (notably for .gif); the upload
// endpoint validates by content-type, so we stamp the right type from the file
// extension before sending — otherwise the server 415s and R2 can't serve it as
// an animatable gif/playable video.
const EXT_MIME = { gif: "image/gif", mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", m4v: "video/x-m4v", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", avif: "image/avif" };
export function TrackCoverField({ value, onChange }) {
  const { clientId } = useStore();
  const ref = useRef(null);
  const [cropSrc, setCropSrc] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false); // Upload new / Choose from library
  const isVid = VIDEO_RE.test(value || "");
  async function upload(file) {
    setBusy(true);
    try {
      const ext = (file.name || "").split(".").pop().toLowerCase();
      const mime = EXT_MIME[ext];
      const f = (mime && file.type !== mime) ? new File([file], file.name, { type: mime }) : file;
      const { key } = await uploadToR2(f, { scope: "owner", purpose: "trackart" }, clientId);
      onChange(key);
    } catch (e) { toast("Upload failed: " + (e && e.message || "error"), "err"); }
    finally { setBusy(false); }
  }
  function pick(file) {
    if (!file) return;
    const t = file.type || "";
    const name = file.name || "";
    const gif = t === "image/gif" || /\.gif$/i.test(name);
    const video = t.startsWith("video/") || VIDEO_RE.test(name);
    if (video || gif) return upload(file); // keep animation/video — no crop
    if (t.startsWith("image/") || IMG_EXT_RE.test(name)) { setCropSrc(URL.createObjectURL(file)); return; } // crop static images to square
    toast("Please choose an image, GIF, or MP4.", "err");
  }
  async function applyCrop(dataUrl) {
    setCropSrc(null); setBusy(true);
    try {
      const blob = await (await fetch(dataUrl)).blob();
      await upload(new File([blob], `cover-${Date.now()}.jpg`, { type: blob.type || "image/jpeg" }));
    } catch (e) { toast("Upload failed: " + (e && e.message || "error"), "err"); setBusy(false); }
  }
  return (
    <div className="imgup">
      <div className="imgup__thumb" style={{ aspectRatio: "1 / 1" }}>
        {value
          ? (isVid
            ? <video src={mediaUrl(value)} muted loop autoPlay playsInline style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            : <img src={mediaUrl(value)} alt="" />)
          : <Placeholder label="no cover" ratio="1 / 1" />}
      </div>
      <div className="imgup__actions">
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => setPickerOpen(true)}>{Icon.upload({})} {busy ? "Uploading…" : (value ? "Replace" : "Add cover")}</Button>
        {value && !busy && !isVid && <Button variant="ghost" size="sm" onClick={() => setCropSrc(mediaUrl(value))}>{Icon.crop({})} Crop</Button>}
        {value && !busy && <Button variant="ghost" size="sm" onClick={() => onChange("")}>Remove</Button>}
      </div>
      <input ref={ref} type="file" accept="image/*,image/gif,video/mp4,video/webm,.gif,.mp4,.webm,.mov" style={{ display: "none" }}
        onChange={(e) => { const file = e.target.files[0]; e.target.value = ""; setPickerOpen(false); pick(file); }} />
      {/* Same Upload-new | Choose-from-library picker the audio field uses, so a
          cover can reuse an existing R2 image (GIF/MP4 covers still go via Upload). */}
      <MediaPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        type="image"
        clientId={clientId}
        uploadLabel={value ? "Replace cover" : "Choose a file"}
        onUploadNew={() => ref.current && ref.current.click()}
        onPick={(key) => onChange(key)}
      />
      <CropModal open={!!cropSrc} src={cropSrc} aspect={1} onCancel={() => setCropSrc(null)} onApply={applyCrop} />
    </div>
  );
}

// Add / edit a quiz question
export function QuestionEditor({ open, question, onClose }) {
  const blank = { type: "multiple_choice", q: "", options: ["", "", "", ""], answer: 0 };
  const [f, setF] = useState(blank);
  const { save: persistChanges } = React.useContext(AdminSaveCtx);
  useEffect(() => {
    if (question) setF({ type: question.type, q: question.q, options: question.type === "true_false" ? ["True", "False"] : [...(question.options || []), "", "", "", ""].slice(0, 4), answer: question.answer || 0 });
    else setF(blank);
  }, [question, open]);

  const isTF = f.type === "true_false";
  const opts = isTF ? ["True", "False"] : f.options;

  function setType(t) {
    if (t === "true_false") setF((p) => ({ ...p, type: t, options: ["True", "False"], answer: p.answer > 1 ? 0 : p.answer }));
    else setF((p) => ({ ...p, type: t, options: [...(p.options || []), "", "", "", ""].slice(0, 4) }));
  }
  function setOpt(i, v) { setF((p) => { const o = [...p.options]; o[i] = v; return { ...p, options: o }; }); }

  async function save() {
    if (!f.q.trim()) { toast("Please enter the question.", "err"); return; }
    const cleanOpts = (isTF ? ["True", "False"] : f.options.map((o) => o.trim())).filter((o, i) => isTF || o);
    if (cleanOpts.length < 2) { toast("Please provide at least two answer options.", "err"); return; }
    let answer = f.answer;
    if (answer >= cleanOpts.length) answer = 0;
    const payload = { type: f.type, q: f.q.trim(), options: cleanOpts, answer };
    if (question) Store.updateQuizQuestion(question.id, payload);
    else Store.addQuizQuestion(payload);
    // Persist to the database right away (and clear the table's unsaved state) so
    // the edit survives a refresh without a second "Save changes" click.
    await persistChanges();
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} label="Quiz question">
      <SectionHead eyebrow="Couple Quiz" title={question ? "Edit question" : "New question"} />
      <Field label="Question type">
        <div className="pills">
          {[["multiple_choice", "Multiple choice"], ["true_false", "True / False"]].map(([v, l]) => (
            <label key={v} className={"pill" + (f.type === v ? " pill--on" : "")}>
              <input type="radio" name="qtype" checked={f.type === v} onChange={() => setType(v)} />{l}
            </label>
          ))}
        </div>
      </Field>
      <Field label="Question" required id="qe-q">
        <Textarea id="qe-q" value={f.q} onChange={(e) => setF((p) => ({ ...p, q: e.target.value }))} placeholder="e.g. Where did the couple first meet?" style={{ minHeight: 70 }} />
      </Field>
      <Field label="Answer options" hint="Select the radio next to the correct answer">
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {opts.map((opt, i) => (
            <label key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <input type="radio" name="correct" checked={f.answer === i} onChange={() => setF((p) => ({ ...p, answer: i }))} style={{ flex: "none" }} />
              {isTF
                ? <span style={{ fontWeight: 600 }}>{opt}</span>
                : <Input value={opt} onChange={(e) => setOpt(i, e.target.value)} placeholder={`Option ${String.fromCharCode(65 + i)}`} />}
            </label>
          ))}
        </div>
      </Field>
      <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
        <Button variant="primary" onClick={save}>{question ? "Save changes" : "Add question"}</Button>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
      </div>
    </Modal>
  );
}

// Modal body: add or edit one invited guest. `companions` are the names from
// the guest's matched RSVP reply — edits/removals are STAGED locally and only
// persist when "Save guest" is pressed (Cancel discards everything).
function GuestForm({ initial, companions, rsvpDiet, onSave, onCancel }) {
  // `allocation` = the max attendees this guest may RSVP, including themselves.
  // The number the owner types IS the guest's cap — no conversion.
  const [f, setF] = useState(initial);
  const [comps, setComps] = useState(companions || []);
  // Dietary lives on the guest's REPLY (rsvps row) — editable only when one
  // exists; staged like companions, persisted on Save.
  const [diet, setDiet] = useState(rsvpDiet || null);
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => { const v = e && e.target ? e.target.value : e; setF((s) => ({ ...s, [k]: v })); };
  const valid = f.firstName.trim() && f.lastName.trim();
  async function submit() {
    if (!valid || saving) return;
    setSaving(true);
    try { await onSave(f, comps, diet); } finally { setSaving(false); }
  }
  return (
    <div>
      <SectionHead eyebrow="Guest" title={f.id ? "Edit guest" : "Add guest"} />
      <div className="field-row field-row--3">
        <Field label="First name" required id="g-first"><Input id="g-first" value={f.firstName} onChange={set("firstName")} /></Field>
        <Field label="Middle name" id="g-mid"><Input id="g-mid" value={f.middleName} onChange={set("middleName")} /></Field>
        <Field label="Last name" required id="g-last"><Input id="g-last" value={f.lastName} onChange={set("lastName")} /></Field>
      </div>
      {f.id ? (
        <>
          <div className="field-row field-row--2">
            <Field label="Allotted seats" id="g-alloc"><Input id="g-alloc" type="number" min={1} value={f.allocation} onChange={set("allocation")} /></Field>
            <Field label="Status" id="g-status">
              <Select id="g-status" value={f.status || "attending"} onChange={set("status")}>
                {[["attending", "Attending"], ["maybe", "Maybe"], ["not_attending", "Declined"], ["none", "No reply"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
            </Field>
          </div>
          <Field label="Email" hint="Optional" id="g-email"><Input id="g-email" type="email" value={f.email || ""} onChange={set("email")} /></Field>
        </>
      ) : (
        <>
          <div className="field-row field-row--2">
            <Field label="Allotted seats" id="g-alloc"><Input id="g-alloc" type="number" min={1} value={f.allocation} onChange={set("allocation")} /></Field>
            <Field label="Email" hint="Optional" id="g-email"><Input id="g-email" type="email" value={f.email || ""} onChange={set("email")} /></Field>
          </div>
          <AdminToggle label={`Wait for their RSVP? — ${f.status === "none" ? "Wait for Response" : "No need, they confirmed"}`}
            checked={f.status === "none"} onChange={(v) => setF((s) => ({ ...s, status: v ? "none" : "attending" }))} />
        </>
      )}
      <Field label="Notes" hint="Optional" id="g-notes"><Input id="g-notes" value={f.notes || ""} onChange={set("notes")} /></Field>
      {diet && (
        <div className="field-row field-row--2">
          <Field label="Dietary preference" hint="From their RSVP reply" id="g-diet">
            <Select id="g-diet" value={diet.diet} onChange={(e) => { const v = e.target.value; setDiet((d) => ({ ...d, diet: v })); }}>
              {DIET_OPTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
            </Select>
          </Field>
          <Field label="Dietary notes" hint="Optional" id="g-dietnotes">
            <Input id="g-dietnotes" value={diet.dietNotes} onChange={(e) => { const v = e.target.value; setDiet((d) => ({ ...d, dietNotes: v })); }} />
          </Field>
        </div>
      )}
      {comps.length > 0 && (
        <Field label="Companions" hint="From their RSVP reply — changes apply when you save">
          <div style={{ display: "grid", gap: 8 }}>
            {comps.map((c, i) => (
              <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <Input value={c} aria-label={`Companion ${i + 1}`}
                  onChange={(e) => { const v = e.target.value; setComps((p) => p.map((x, j) => (j === i ? v : x))); }} />
                <button type="button" className="icon-btn icon-btn--danger" onClick={() => setComps((p) => p.filter((_, j) => j !== i))} aria-label={`Remove ${c}`}>{Icon.trash({})}</button>
              </div>
            ))}
          </div>
        </Field>
      )}
      <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
        <Button variant="primary" block disabled={!valid || saving} onClick={submit}>{saving ? "Saving…" : "Save guest"}</Button>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

// Guests tab — invited-list CRUD + reconciliation against RSVPs (who replied,
// headcount). Shown only when settings.strictRsvp is on (gated in AdminApp).
export function GuestsAdmin() {
  const { guests, rsvps, settings } = useStore();
  const { run } = React.useContext(AdminSaveCtx);
  const [filter, setFilter] = useState("attending");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState(null);
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailTo, setEmailTo] = useState("");
  const [emailSending, setEmailSending] = useState(false);
  const blank = { firstName: "", lastName: "", middleName: "", allocation: 2, email: "", notes: "", status: "attending" };

  const recon = React.useMemo(() => reconcileGuests(guests, rsvps), [guests, rsvps]);
  const byId = React.useMemo(() => new Map(recon.rows.map((x) => [x.guest.id, x])), [recon]);
  const S = recon.summary;
  const STAT_LABEL = { attending: "Attending", maybe: "Maybe", not_attending: "Declined" };

  // Reply status per guest ("none" = invited but no reply yet).
  const statusOf = (g) => { const x = byId.get(g.id); return x ? x.status : "none"; };
  const bySearch = guests.filter((g) => !q || `${g.firstName} ${g.lastName}`.toLowerCase().includes(q.toLowerCase()));
  // Unmatched = RSVPs with no invited-guest match; they get their own tab so a
  // long list doesn't stack above the table as a giant notice card.
  const unmatched = recon.unmatchedRsvps.filter((r) => !q || (r.fullName || "").toLowerCase().includes(q.toLowerCase()));
  const counts = {
    all: bySearch.length,
    attending: bySearch.filter((g) => statusOf(g) === "attending").length,
    maybe: bySearch.filter((g) => statusOf(g) === "maybe").length,
    not_attending: bySearch.filter((g) => statusOf(g) === "not_attending").length,
    outstanding: bySearch.filter((g) => statusOf(g) === "none").length,
    unmatched: unmatched.length,
  };
  const onUnmatched = filter === "unmatched";
  const showComps = filter === "attending"; // Companions column on the Attending tab
  const filtered = bySearch.filter((g) => {
    if (filter === "all" || filter === "unmatched") return true;
    // "No reply" = effective status is none (auto-attending guests don't count).
    if (filter === "outstanding") return statusOf(g) === "none";
    return statusOf(g) === filter; // attending | maybe | not_attending
  });
  const pg = usePaged(onUnmatched ? unmatched : filtered, 10);

  async function saveGuest(form, stagedComps, stagedDiet) {
    const payload = { ...form, allocation: Math.max(1, parseInt(form.allocation, 10) || 1) };
    // Duplicate guard: exact same normalized first+middle+last already invited
    // (a different middle name is a legitimately different person, e.g. L vs R).
    const dup = guests.find((g) => g.id !== form.id
      && normName(g.firstName) === normName(form.firstName)
      && normName(g.lastName) === normName(form.lastName)
      && normName(g.middleName) === normName(form.middleName));
    if (dup) {
      await confirmDialog({
        title: "Already on the list",
        message: `${form.firstName} ${form.lastName} is already on the guest list. If this is a different person, add a middle name to tell them apart.`,
        confirmLabel: "OK",
        okOnly: true,
        noIcon: true,
      });
      return;
    }
    // Lowering the allotment below an already-confirmed party: keep their reply
    // as-is (never auto-cut names) — just warn that they'll show as OVER.
    if (form.id) {
      const x = byId.get(form.id);
      const r = x && x.rsvp;
      if (r && x.status === "attending" && headsOf(r) > payload.allocation) {
        const ok = await confirmDialog({
          title: "Below their confirmed party",
          message: `${form.firstName} ${form.lastName} already confirmed ${headsOf(r)} ${headsOf(r) === 1 ? "person" : "people"}. Saving ${payload.allocation} allotted ${payload.allocation === 1 ? "seat" : "seats"} keeps their reply but marks them as over — you may want to let them know.`,
          confirmLabel: "Save anyway",
          danger: true,
        });
        if (!ok) return;
      }
    }
    // Staged companion edits (renames/removals in the modal) persist here, in
    // the same save — not per keystroke/blur.
    const rsvpRow = form.id ? ((byId.get(form.id) || {}).rsvp || null) : null;
    const nextComps = (stagedComps || []).map((s) => (s || "").trim()).filter(Boolean);
    const origComps = rsvpRow
      ? (Array.isArray(rsvpRow.companions) && rsvpRow.companions.filter((s) => (s || "").trim()).length
        ? rsvpRow.companions.filter((s) => (s || "").trim())
        : (rsvpRow.plusOne ? String(rsvpRow.plusOne).split(", ") : []))
      : [];
    const compsChanged = rsvpRow && JSON.stringify(nextComps) !== JSON.stringify(origComps);
    // Effective status is the reply's when one exists — so an admin status
    // change on a replied guest writes through to the reply itself.
    const statusChanged = rsvpRow && payload.status && payload.status !== "none" && payload.status !== rsvpRow.status;
    // Dietary also lives on the reply — staged in the modal, persisted here.
    const dietChanged = rsvpRow && stagedDiet
      && (stagedDiet.diet !== (rsvpRow.diet || "None") || (stagedDiet.dietNotes || "") !== (rsvpRow.dietNotes || ""));
    try {
      await run(async () => {
        if (form.id) { await updateGuestDb(form.id, payload); Store.updateGuest(form.id, payload); }
        else { const row = await addGuestDb(payload); Store.addGuest(row); }
        if (compsChanged) {
          const patch = await updateRsvpCompanionsDb(rsvpRow.id, nextComps);
          Store.updateRSVP(rsvpRow.id, patch);
        }
        if (statusChanged) {
          await updateRsvpStatusDb(rsvpRow.id, payload.status);
          Store.updateRSVP(rsvpRow.id, { status: payload.status });
        }
        if (dietChanged) {
          await updateRsvpDietDb(rsvpRow.id, stagedDiet.diet, stagedDiet.dietNotes);
          Store.updateRSVP(rsvpRow.id, { diet: stagedDiet.diet || "None", dietNotes: stagedDiet.dietNotes || "" });
        }
      });
    } catch (e) {
      toast("Couldn't save guest: " + (e && e.message || "error"), "err");
      return;
    }
    setEditing(null);
    toast("Guest saved", "success");
  }
  function removeGuest(g) {
    confirmDialog({ title: "Remove guest?", message: `Remove ${g.firstName} ${g.lastName} from the invite list?`, confirmLabel: "Remove", danger: true })
      .then((ok) => { if (ok) run(async () => { await deleteGuestDb(g.id); Store.deleteGuest(g.id); }).then(() => toast("Guest removed", "success"), () => toast("Couldn't remove")); });
  }
  // CSV of what's on screen: guests for the guest tabs, replies on For Approval.
  // Companion names for a reply (array first, legacy string fallback).
  const compsOf = (r) => {
    if (!r) return "";
    const arr = Array.isArray(r.companions) ? r.companions.filter((s) => (s || "").trim()) : [];
    return arr.length ? arr.join(", ") : (r.plusOne || "");
  };
  const tabLabel = (st) => (st === "none" ? "No reply" : (STAT_LABEL[st] || st || ""));
  const headsOfRow = (x) => (x.status === "attending" ? (x.rsvp ? headsOf(x.rsvp) : (Number(x.guest.allocation) || 0)) : "");

  const byStatus = (st) => recon.rows.filter((x) => x.status === st).length;

  // "Plus 1s" = companions actually NAMED on attending replies — not derived
  // from head count (which counts a no-reply guest's full allotment, adding
  // assumed plus-ones nobody named).
  const totalPlusOnes = recon.rows.reduce((s, x) => {
    if (x.status !== "attending" || !x.rsvp) return s;
    const c = compsOf(x.rsvp);
    return s + (c ? c.split(", ").filter(Boolean).length : 0);
  }, 0);

  // Rows for the spreadsheet, GROUPED by tab with a labelled section header
  // before each block (a CSV can't hold real sheet-tabs, so this separates
  // Attending / Maybe / Declined / No reply / For Approval clearly).
  function guestListRows() {
    const header = ["Name", "Phone", "Email", "Allotted seats", "Head count", "Companions", "Notes"];
    const guestRow = (x) => {
      const g = x.guest;
      return [[g.firstName, g.middleName, g.lastName].filter(Boolean).join(" "),
        (x.rsvp && x.rsvp.phone) || "", (x.rsvp && x.rsvp.email) || g.email || "",
        g.allocation, headsOfRow(x), compsOf(x.rsvp), g.notes || ""];
    };
    const out = [header];
    for (const [st, lbl] of [["attending", "Attending"], ["maybe", "Maybe"], ["not_attending", "Declined"], ["none", "No reply"]]) {
      const block = recon.rows.filter((x) => x.status === st).map(guestRow);
      if (block.length) { out.push([], [`${lbl} (${block.length})`], ...block); }
    }
    const appr = recon.unmatchedRsvps.map((r) => [r.fullName, r.phone || "", r.email || "", "",
      r.status === "attending" ? headsOf(r) : "", compsOf(r), ""]);
    if (appr.length) { out.push([], [`For Approval (${appr.length})`], ...appr); }
    return out;
  }
  function exportGuestsCsv() {
    const who = [settings.partnerA, settings.partnerB].filter(Boolean).join(" & ") || "Guests";
    downloadCSV(`${who} - Guest list.csv`, guestListRows());
  }

  // Email: summary counts in the body + the full all-tabs list as a spreadsheet
  // attachment (CSV, opens in Excel). Counts match the tabs on screen.
  async function emailGuestList(to) {
    const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    const who = [settings.partnerA, settings.partnerB].filter(Boolean).join(" & ");
    const today = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    const line = (label, value, sub) => `<tr><td style="padding:7px 12px;border-bottom:1px solid #eee">${esc(label)}</td><td style="padding:7px 12px;border-bottom:1px solid #eee;text-align:right;font-weight:700">${esc(value)}${sub ? ` <span style="font-weight:400;color:#888">${esc(sub)}</span>` : ""}</td></tr>`;
    const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#222;max-width:520px;margin:0 auto">
      <h2 style="margin:0 0 4px">Guest list summary</h2>
      <p style="color:#666;margin:0 0 18px">${esc(who)} · ${esc(today)}</p>
      <table style="border-collapse:collapse;width:100%;font-size:15px">
        ${line("Invited", S.invited)}
        ${line("Attending", byStatus("attending"))}
        ${line("Plus 1s", totalPlusOnes)}
        ${line("Maybe", byStatus("maybe"))}
        ${line("Declined", byStatus("not_attending"))}
        ${line("No reply", byStatus("none"))}
        ${line("For approval", recon.unmatchedRsvps.length)}
      </table>
      <p style="color:#666;margin:18px 0 0;font-size:14px">The full guest list (every tab) is attached as a spreadsheet — open it in Excel or Google Sheets.</p>
    </div>`;
    // CSV attachment (BOM so Excel reads UTF-8), base64-encoded for Resend.
    const escCsv = (v) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const csv = "﻿" + guestListRows().map((r) => r.map(escCsv).join(",")).join("\r\n");
    const content = btoa(unescape(encodeURIComponent(csv)));
    const filename = `${who || "Guests"} - Guest list.csv`;
    setEmailSending(true);
    try {
      await sendEmail({ to: (to || "").trim(), subject: `${who ? who + " — " : ""}Guest list · ${today}`, html, attachments: [{ filename, content }] });
      toast("Email sent", "success");
      setEmailOpen(false);
    } catch (e) {
      toast("Couldn't send: " + (e && e.message || "error"), "err");
    } finally {
      setEmailSending(false);
    }
  }

  // "Add to list": create a guest entry straight from an unmatched RSVP. Once
  // inserted, reconcileGuests recomputes and the row leaves the Unmatched tab.
  async function adoptRsvp(r) {
    try {
      await run(async () => {
        const row = await addGuestDb(guestFromRsvp(r));
        Store.addGuest(row);
      });
      toast("Added to the guest list", "success");
    } catch (e) {
      toast("Couldn't add: " + (e && e.message || "error"), "err");
    }
  }

  return (
    <div>
      <div className="folders">
        {[["attending", "Attending"], ["maybe", "Maybe"], ["not_attending", "Declined"], ["outstanding", "No reply"], ["unmatched", "For Approval"]].map(([v, l]) => (
          <button key={v} className={"folder" + (filter === v ? " folder--active" : "")} onMouseDown={(e) => e.preventDefault()} onClick={() => setFilter(v)}>{l} ({counts[v]})</button>
        ))}
      </div>

      <div className="panel">
        <div className="panel__head">
          <div className="panel__title">{onUnmatched ? "RSVPs for approval" : "Guests"} <span style={{ color: "var(--muted)", fontSize: 15 }}>({onUnmatched ? unmatched.length : filtered.length})</span></div>
          <div className="admin-toolbar"><div className="admin-toolbar__end">
            <Button variant="ghost" className="admin-toolbar__action" onClick={() => { setEmailTo(""); setEmailOpen(true); }}>{Icon.mail({})} Email</Button>
            <Button variant="ghost" className="admin-toolbar__action" onClick={exportGuestsCsv}>{Icon.download({})} Export</Button>
            <Button variant="primary" className="admin-toolbar__action" onClick={() => setEditing({ ...blank })}>Add guest</Button>
            <div className="search-box">{Icon.search({})}<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" /></div>
          </div></div>
        </div>
        <div className="panel__body--flush table-wrap">
          {onUnmatched ? (
            <table className="tbl">
              <thead><tr><th>Name</th><th>Contact</th><th>Head count</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {pg.pageItems.map((r) => (
                  <tr key={r.id}>
                    <td><strong>{r.fullName}</strong>{r.plusOne && <div style={{ fontSize: 13, color: "var(--muted)" }}>+ {r.plusOne}</div>}</td>
                    <td>{r.phone || <span style={{ color: "var(--muted)" }}>—</span>}{r.email && <div style={{ fontSize: 13, color: "var(--muted)" }}>{r.email}</div>}</td>
                    <td>{r.status === "attending" ? r.count : "—"}</td>
                    <td><span className={"tag tag--" + r.status}>{(STAT_LABEL[r.status] || r.status || "").toString().replace("_", " ")}</span></td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <Button variant="primary" size="sm" onClick={() => adoptRsvp(r)}>Add to list</Button>
                    </td>
                  </tr>
                ))}
                {unmatched.length === 0 && <tr><td colSpan={5} style={{ color: "var(--muted)", textAlign: "center", padding: 40 }}>Every RSVP matches an invited guest. 🎉</td></tr>}
              </tbody>
            </table>
          ) : (
            <table className="tbl">
              <thead><tr><th>Name</th><th>Contact</th><th>Allotted seats</th><th>Status</th>{showComps && <th className="col-comp">Companions</th>}<th>Notes</th><th></th></tr></thead>
              <tbody>
                {pg.pageItems.map((g) => {
                  const x = byId.get(g.id) || { status: "none", rsvp: null };
                  const phone = (x.rsvp && x.rsvp.phone) || "";
                  const email = (x.rsvp && x.rsvp.email) || g.email || "";
                  return (
                    <tr key={g.id}>
                      <td><strong>{g.firstName} {g.lastName}</strong>{g.middleName ? <span style={{ color: "var(--muted)" }}> ({g.middleName})</span> : null}</td>
                      <td>{phone || <span style={{ color: "var(--muted)" }}>—</span>}{email && <div style={{ fontSize: 13, color: "var(--muted)" }}>{email}</div>}</td>
                      <td>{g.allocation}</td>
                      <td>{x.status === "none"
                        ? <span style={{ color: "var(--muted)" }}>No reply</span>
                        : <span className={"tag tag--" + x.status}>{STAT_LABEL[x.status]}</span>}</td>
                      {showComps && (
                        <td className="col-comp">
                          {(() => {
                            const comps = x.rsvp && Array.isArray(x.rsvp.companions) ? x.rsvp.companions.filter((s) => (s || "").trim()) : [];
                            if (comps.length) return comps.join(", ");
                            if (x.rsvp && x.rsvp.plusOne) return x.rsvp.plusOne; // legacy string rows
                            return x.rsvp && Number(x.rsvp.count) > 1
                              ? `${Number(x.rsvp.count) - 1} unnamed`
                              : <span style={{ color: "var(--muted)" }}>none</span>;
                          })()}
                          {x.rsvp && headsOf(x.rsvp) > Number(g.allocation) && (
                            <span style={{ color: "var(--danger, #a33)", fontWeight: 700, fontSize: 11, letterSpacing: ".06em", textTransform: "uppercase", marginLeft: 6 }} title="More than the allotted seats">over</span>
                          )}
                        </td>
                      )}
                      <td style={{ maxWidth: 200 }}>{(x.rsvp && x.rsvp.notes)
                        ? <span title={x.rsvp.notes} style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.rsvp.notes}</span>
                        : <span style={{ color: "var(--muted)" }}>—</span>}</td>
                      <td><div className="row-actions">
                        <button className="icon-btn" onClick={() => setEditing({ ...blank, ...g })} aria-label="Edit" title="Edit guest">{Icon.edit({})}</button>
                        <button className="icon-btn icon-btn--danger" onClick={() => removeGuest(g)} aria-label="Remove">{Icon.trash({})}</button>
                      </div></td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && <tr><td colSpan={showComps ? 7 : 6} style={{ color: "var(--muted)", textAlign: "center", padding: 40 }}>No guests yet. Add your invited guests to track replies.</td></tr>}
              </tbody>
            </table>
          )}
        </div>
        <Pager page={pg.page} totalPages={pg.totalPages} total={pg.total} perPage={pg.perPage} start={pg.start} onPage={pg.setPage} noun={onUnmatched ? "RSVPs" : "guests"} />
      </div>

      <Modal open={!!editing} onClose={() => setEditing(null)} label="Guest">
        {editing && (() => {
          const r = editing.id ? (byId.get(editing.id) || {}).rsvp : null;
          const arr = r && Array.isArray(r.companions) ? r.companions.filter((s) => (s || "").trim()) : [];
          const comps = arr.length ? arr : (r && r.plusOne ? String(r.plusOne).split(", ") : []);
          return (
            <GuestForm initial={editing} companions={comps}
              rsvpDiet={r ? { diet: r.diet || "None", dietNotes: r.dietNotes || "" } : null}
              onSave={saveGuest} onCancel={() => setEditing(null)} />
          );
        })()}
      </Modal>

      <Modal open={emailOpen} onClose={() => setEmailOpen(false)} label="Email guest list">
        <SectionHead eyebrow="Guests" title="Email the guest list" />
        <Field label="Send to" id="guests-email-to" hint="We'll email the guest list (summary + full table) to this address.">
          <Input id="guests-email-to" type="email" inputMode="email" value={emailTo} onChange={(e) => setEmailTo(e.target.value)} placeholder="name@example.com" />
        </Field>
        <Button variant="primary" block disabled={!emailTo.trim() || emailSending} onClick={() => emailGuestList(emailTo)}>{emailSending ? "Sending…" : "Send guest list"}</Button>
      </Modal>
    </div>
  );
}

export function RsvpsAdmin() {
  const { rsvps, settings } = useStore();
  const { run } = React.useContext(AdminSaveCtx);   // wrap server ops in the saving overlay
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const [detail, setDetail] = useState(null);
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailTo, setEmailTo] = useState("");
  const [emailSending, setEmailSending] = useState(false);

  const bySearch = rsvps.filter((r) => !q || `${r.fullName} ${r.email} ${r.phone}`.toLowerCase().includes(q.toLowerCase()));
  const counts = {
    all: bySearch.length,
    attending: bySearch.filter((r) => r.status === "attending").length,
    maybe: bySearch.filter((r) => r.status === "maybe").length,
    not_attending: bySearch.filter((r) => r.status === "not_attending").length,
  };
  const filtered = filter === "all" ? bySearch : bySearch.filter((r) => r.status === filter);
  const pg = usePaged(filtered, 10);

  function exportCsv() {
    const header = ["Full Name", "Email", "Phone", "Status", "Guests", "Plus-One Names", "Dietary", "Dietary Notes", "Song Request", "Notes", "Submitted"];
    const rows = [header, ...filtered.map((r) => [r.fullName, r.email, r.phone, r.status, r.count, r.plusOne, r.diet, r.dietNotes, r.song, r.notes, fmtDate(r.createdAt)])];
    const who = [settings.partnerA, settings.partnerB].filter(Boolean).join(" & ") || "Guests";
    const tab = { attending: "Attending", maybe: "Maybe", not_attending: "Not Attending" }[filter];
    downloadCSV(`${who} - RSVP${tab ? " - " + tab : ""}.csv`, rows);
  }

  // Build an HTML results email and send it server-side (Resend via the
  // /api/send-email Function) to the address the admin typed.
  async function emailResults(to) {
    const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    const label = { attending: "Attending", maybe: "Maybe", not_attending: "Not attending" };
    const tab = label[filter];                       // active tab → title; null on "All"
    const heading = `RSVP${tab ? " — " + tab : " results"}`;
    const yes = filtered.filter((r) => r.status === "attending");
    const guests = yes.reduce((s, r) => s + (Number(r.count) || 0), 0);
    const rows = filtered.map((r) => `<tr>
      <td style="padding:6px 10px;border-bottom:1px solid #eee">${esc(r.fullName)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee">${esc(label[r.status] || r.status)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:center">${esc(r.count || "")}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee">${esc(r.email)}</td>
    </tr>`).join("");
    const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#222;max-width:640px;margin:0 auto">
      <h2 style="margin:0 0 4px">${heading}</h2>
      <p style="color:#666;margin:0 0 16px">${esc(settings.partnerA)} &amp; ${esc(settings.partnerB)}</p>
      <p style="margin:0 0 16px">
        <strong>${filtered.length}</strong> responses &nbsp;·&nbsp;
        <strong>${yes.length}</strong> attending (${guests} guests) &nbsp;·&nbsp;
        ${filtered.filter((r) => r.status === "maybe").length} maybe &nbsp;·&nbsp;
        ${filtered.filter((r) => r.status === "not_attending").length} not attending
      </p>
      <table style="border-collapse:collapse;width:100%;font-size:14px">
        <thead><tr style="text-align:left;background:#f6f6f6">
          <th style="padding:8px 10px">Name</th><th style="padding:8px 10px">Status</th>
          <th style="padding:8px 10px;text-align:center">Guests</th><th style="padding:8px 10px">Email</th>
        </tr></thead>
        <tbody>${rows || '<tr><td colspan="4" style="padding:14px;color:#888">No RSVPs yet.</td></tr>'}</tbody>
      </table>
    </div>`;
    const who = [settings.partnerA, settings.partnerB].filter(Boolean).join(" & ");
    const today = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    const subject = `${who ? who + " — " : ""}${heading} · ${today}`;
    setEmailSending(true);
    try {
      await sendEmail({ to: (to || "").trim(), subject, html });
      toast("Email sent", "success");
      setEmailOpen(false);
    } catch (e) {
      toast("Couldn't send: " + (e && e.message || "error"), "err");
    } finally {
      setEmailSending(false);
    }
  }

  return (
    <div>
      {/* Status filter as folder tabs (like Guestbook), above the panel. */}
      <div className="folders">
        {[["all", "All"], ["attending", "Yes"], ["maybe", "Maybe"], ["not_attending", "No"]].map(([v, l]) => (
          // onMouseDown preventDefault: don't steal focus from the search input.
          // On iOS, tabbing a filter while search is focused blurs it mid-re-render
          // and the keyboard can't be brought back — keep focus on the input instead.
          <button key={v} className={"folder" + (filter === v ? " folder--active" : "")} onMouseDown={(e) => e.preventDefault()} onClick={() => setFilter(v)}>{l} ({counts[v]})</button>
        ))}
      </div>
      <div className="panel">
        <div className="panel__head">
          <div className="panel__title">RSVPs <span style={{ color: "var(--muted)", fontSize: 15 }}>({filtered.length})</span></div>
          {/* Actions exposed on the left; search on the right. */}
          <div className="admin-toolbar">
            {/* Email results + Export CSV grouped to the right, directly left of search. */}
            <div className="admin-toolbar__end">
              <Button variant="ghost" className="admin-toolbar__action" onClick={() => { setEmailTo(""); setEmailOpen(true); }}>{Icon.mail({})} Email</Button>
              <Button variant="primary" className="admin-toolbar__action" onClick={exportCsv}>{Icon.download({})} Export</Button>
              <div className="search-box">{Icon.search({})}<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" /></div>
            </div>
          </div>
        </div>
        <div className="panel__body--flush table-wrap">
          <table className="tbl">
            <thead><tr><th>Name</th><th>Contact</th><th>Status</th><th>Guests</th><th>Dietary</th><th>Notes</th><th>Submitted</th><th></th></tr></thead>
            <tbody>
              {pg.pageItems.map((r) => (
                <tr key={r.id}>
                  <td><strong>{r.fullName}</strong>{r.plusOne && <div style={{ fontSize: 13, color: "var(--muted)" }}>+ {r.plusOne}</div>}</td>
                  <td><div>{r.email}</div>{r.phone && <div style={{ fontSize: 13, color: "var(--muted)" }}>{r.phone}</div>}</td>
                  <td><span className={"tag tag--" + r.status}>{r.status.replace("_", " ")}</span></td>
                  <td>{r.count}</td>
                  <td>{r.diet === "None" ? <span style={{ color: "var(--muted)" }}>—</span> : r.diet}</td>
                  <td style={{ maxWidth: 240 }}>{r.notes ? <span title={r.notes} style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.notes}</span> : <span style={{ color: "var(--muted)" }}>—</span>}</td>
                  <td style={{ color: "var(--muted)", whiteSpace: "nowrap" }}>{fmtDate(r.createdAt)}</td>
                  <td>
                    <div className="row-actions">
                      <button className="icon-btn" onClick={() => setDetail(r)} aria-label="View">{Icon.eye({})}</button>
                      <button className="icon-btn icon-btn--danger" onClick={() => confirmDialog({ title: "Delete RSVP?", message: `Remove the RSVP from ${r.fullName}? This can't be undone.`, confirmLabel: "Delete", danger: true }).then((ok) => { if (ok) run(async () => { await deleteRsvpDb(r.id); Store.deleteRSVP(r.id); }).then(() => toast("RSVP deleted", "success"), () => toast("Couldn't delete on the server")); })} aria-label="Delete">{Icon.trash({})}</button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && <tr><td colSpan={8} style={{ color: "var(--muted)", textAlign: "center", padding: 40 }}>No matching RSVPs.</td></tr>}
            </tbody>
          </table>
        </div>
        <Pager page={pg.page} totalPages={pg.totalPages} total={pg.total} perPage={pg.perPage} start={pg.start} onPage={pg.setPage} noun="RSVPs" />
      </div>

      <Modal open={!!detail} onClose={() => setDetail(null)} label="RSVP detail">
        {detail && (
          <div>
            <SectionHead eyebrow="RSVP" title={detail.fullName} />
            <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "12px 20px", margin: 0 }}>
              {[
                ["Status", detail.status.replace("_", " ")],
                ["Email", detail.email],
                ["Phone", detail.phone || "\u2014"],
                ["Guests", detail.count],
                ["Plus-ones", detail.plusOne || "\u2014"],
                ["Dietary", detail.diet + (detail.dietNotes ? ` (${detail.dietNotes})` : "")],
                ["Song request", detail.song || "\u2014"],
                ["Note", detail.notes || "\u2014"],
                ["Submitted", fmtDate(detail.createdAt)],
              ].map(([k, v]) => (
                <React.Fragment key={k}>
                  <dt style={{ fontSize: 12, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--muted)", fontWeight: 600 }}>{k}</dt>
                  <dd style={{ margin: 0, color: "var(--ink)" }}>{v}</dd>
                </React.Fragment>
              ))}
            </dl>
          </div>
        )}
      </Modal>

      <Modal open={emailOpen} onClose={() => setEmailOpen(false)} label="Email results">
        <SectionHead eyebrow="RSVPs" title="Email the results" />
        <Field label="Send to" id="rsvp-email-to" hint="We'll email the RSVP results (a summary + full table) to this address.">
          <Input id="rsvp-email-to" type="email" inputMode="email" value={emailTo} onChange={(e) => setEmailTo(e.target.value)} placeholder="name@example.com" />
        </Field>
        <Button variant="primary" block disabled={!emailTo.trim() || emailSending} onClick={() => emailResults(emailTo)}>{emailSending ? "Sending…" : "Send results"}</Button>
      </Modal>
    </div>
  );
}

export function MediaAdmin() {
  const { media } = useStore();
  const [type, setType] = useState("all");
  const [status, setStatus] = useState("all");
  const [preview, setPreview] = useState(null);

  const filtered = media.filter((m) => {
    if (type === "photo" && m.type !== "photo") return false;
    if (type === "video" && m.type !== "video") return false;
    if (type === "private" && m.category !== "private_video_message") return false;
    if (type !== "private" && m.category === "private_video_message") return false;
    if (status !== "all" && m.status !== status) return false;
    return true;
  });

  return (
    <div>
      <div className="panel">
        <div className="panel__head">
          <div className="panel__title">Media <span style={{ color: "var(--muted)", fontSize: 15 }}>({filtered.length})</span></div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <div className="seg">
              {[["all", "Gallery"], ["photo", "Photos"], ["video", "Videos"], ["private", "Private"]].map(([v, l]) => (
                <button key={v} className={type === v ? "on" : ""} onClick={() => setType(v)}>{l}</button>
              ))}
            </div>
            <div className="seg">
              {[["all", "Any"], ["approved", "Approved"], ["pending", "Pending"], ["hidden", "Hidden"]].map(([v, l]) => (
                <button key={v} className={status === v ? "on" : ""} onClick={() => setStatus(v)}>{l}</button>
              ))}
            </div>
          </div>
        </div>
        <div className="panel__body">
          {filtered.length === 0 ? <p style={{ color: "var(--muted)", textAlign: "center", padding: 30 }}>No media here yet.</p> : (
            <div className="amedia-grid">
              {filtered.map((m) => (
                <div className="amedia" key={m.id}>
                  <div className="amedia__media" onClick={() => setPreview(m)} style={{ cursor: "pointer" }}>
                    {m.dataUrl ? <img src={m.dataUrl} alt="" /> : <Placeholder label={m.type} ratio="1" />}
                    {m.type === "video" && <span className="amedia__badge">{Icon.play({ style: { width: 12, height: 12, display: "inline" } })} Video</span>}
                    <span className="amedia__badge" style={{ left: "auto", right: 8 }}>
                      <span className={"tag tag--" + m.status} style={{ padding: "1px 7px", fontSize: 10 }}>{m.status}</span>
                    </span>
                  </div>
                  <div className="amedia__body">
                    <div className="amedia__name">{m.name}</div>
                    {m.message && <div className="amedia__msg">{m.message}</div>}
                    <div className="amedia__actions">
                      {m.status !== "approved" && <button className="icon-btn" title="Approve" onClick={() => Store.setMediaStatus(m.id, "approved")}>{Icon.check({})}</button>}
                      {m.status !== "hidden" && <button className="icon-btn" title="Hide" onClick={() => Store.setMediaStatus(m.id, "hidden")}>{Icon.eyeOff({})}</button>}
                      <button className="icon-btn icon-btn--danger" title="Delete" onClick={() => confirmDialog({ title: "Delete upload?", message: "This permanently removes the photo or video.", confirmLabel: "Delete", danger: true }).then((ok) => { if (ok) Store.deleteMedia(m.id); })}>{Icon.trash({})}</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <Modal open={!!preview} onClose={() => setPreview(null)} wide label="Media preview">
        {preview && (
          <div className="lightbox">
            {preview.type === "video" && preview.src
              ? <video src={preview.src} controls style={{ maxWidth: "100%", maxHeight: "70vh" }} />
              : preview.dataUrl ? <img src={preview.dataUrl} alt="" /> : <Placeholder label={preview.type} ratio={preview.ratio} />}
            <div className="lightbox__meta"><div className="lightbox__name">{preview.name}</div>{preview.message && <p>{preview.message}</p>}</div>
          </div>
        )}
      </Modal>
    </div>
  );
}

export function GuestbookAdmin() {
  const { guestbook, settings } = useStore();
  const { run } = React.useContext(AdminSaveCtx);   // wrap server ops in the saving overlay
  const [q, setQ] = useState("");
  const [view, setView] = useState("published");
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailTo, setEmailTo] = useState("");
  const [emailSending, setEmailSending] = useState(false);
  // Moderation on = guest messages wait for approval (auto-approve turned off).
  const moderation = settings?.autoApproveGuestbook === false;

  const bySearch = guestbook.filter((g) => !q || g.name.toLowerCase().includes(q.toLowerCase()));
  const pendingCount = bySearch.filter((g) => g.status === "pending").length;
  const publishedCount = bySearch.length - pendingCount;
  // With moderation: split into Published (visible/hidden) vs Pending approval.
  const filtered = !moderation ? bySearch
    : bySearch.filter((g) => view === "pending" ? g.status === "pending" : g.status !== "pending");
  const pg = usePaged(filtered, 10);

  function exportCsv() {
    const rows = [["Guest Name", "Message", "Relationship", "Status", "Submitted"],
      ...filtered.map((g) => [g.name, g.message, g.relationship, g.status, fmtDate(g.createdAt)])];
    const who = [settings.partnerA, settings.partnerB].filter(Boolean).join(" & ") || "Guests";
    const tab = moderation ? (view === "pending" ? "Pending" : "Published") : "";
    downloadCSV(`${who} - Guestbook${tab ? " - " + tab : ""}.csv`, rows);
  }

  // Build an HTML guestbook email and send it server-side (same /api/send-email
  // Function as RSVPs). Uses the current view (Published / Pending) like Export.
  async function emailResults(to) {
    const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    const tab = moderation ? (view === "pending" ? "Pending" : "Published") : "";
    const heading = `Guestbook${tab ? " — " + tab : ""}`;
    const rows = filtered.map((g) => `<tr>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;vertical-align:top">${esc(g.name)}${g.relationship ? `<div style="color:#888;font-size:12px">${esc(g.relationship)}</div>` : ""}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee">${esc(g.message)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;color:#888;white-space:nowrap">${esc(fmtDate(g.createdAt))}</td>
    </tr>`).join("");
    const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#222;max-width:640px;margin:0 auto">
      <h2 style="margin:0 0 4px">${heading}</h2>
      <p style="color:#666;margin:0 0 16px">${esc(settings.partnerA)} &amp; ${esc(settings.partnerB)}</p>
      <p style="margin:0 0 16px"><strong>${filtered.length}</strong> message${filtered.length === 1 ? "" : "s"}</p>
      <table style="border-collapse:collapse;width:100%;font-size:14px">
        <thead><tr style="text-align:left;background:#f6f6f6">
          <th style="padding:8px 10px">Guest</th><th style="padding:8px 10px">Message</th>
          <th style="padding:8px 10px;text-align:right">Date</th>
        </tr></thead>
        <tbody>${rows || '<tr><td colspan="3" style="padding:14px;color:#888">No messages yet.</td></tr>'}</tbody>
      </table>
    </div>`;
    const who = [settings.partnerA, settings.partnerB].filter(Boolean).join(" & ");
    const today = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    const subject = `${who ? who + " — " : ""}${heading} · ${today}`;
    setEmailSending(true);
    try {
      await sendEmail({ to: (to || "").trim(), subject, html });
      toast("Email sent", "success");
      setEmailOpen(false);
    } catch (e) {
      toast("Couldn't send: " + (e && e.message || "error"), "err");
    } finally {
      setEmailSending(false);
    }
  }

  return (
    <div>
      {/* With moderation on, split into folder tabs: Published vs Pending approval. */}
      {moderation && (
        <div className="folders">
          <button className={"folder" + (view === "published" ? " folder--active" : "")} onMouseDown={(e) => e.preventDefault()} onClick={() => setView("published")}>{Icon.check({})} Published ({publishedCount})</button>
          <button className={"folder" + (view === "pending" ? " folder--active" : "")} onMouseDown={(e) => e.preventDefault()} onClick={() => setView("pending")}>{Icon.book({})} Pending approval ({pendingCount})</button>
        </div>
      )}
      <div className="panel">
      <div className="panel__head">
        <div className="panel__title">Guestbook <span style={{ color: "var(--muted)", fontSize: 15 }}>({filtered.length})</span></div>
        {/* Export exposed on the left; search on the right. */}
        <div className="admin-toolbar">
          {/* Email + Export directly left of search (right group). */}
          <div className="admin-toolbar__end">
            <Button variant="ghost" className="admin-toolbar__action" onClick={() => { setEmailTo(""); setEmailOpen(true); }}>{Icon.mail({})} Email</Button>
            <Button variant="primary" className="admin-toolbar__action" onClick={exportCsv}>{Icon.download({})} Export</Button>
            <div className="search-box">{Icon.search({})}<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" /></div>
          </div>
        </div>
      </div>
      <div className="panel__body--flush table-wrap">
        <table className="tbl">
          <thead><tr><th>Guest</th><th>Message</th><th>Status</th><th>Date</th><th></th></tr></thead>
          <tbody>
            {pg.pageItems.map((g) => (
              <tr key={g.id} style={{ opacity: g.status === "hidden" ? 0.5 : 1 }}>
                <td><strong>{g.name}</strong>{g.relationship && <div style={{ fontSize: 13, color: "var(--muted)" }}>{g.relationship}</div>}</td>
                <td style={{ maxWidth: 420 }}>{g.message}</td>
                <td><span className={"tag tag--" + g.status}>{g.status}</span></td>
                <td style={{ color: "var(--muted)", whiteSpace: "nowrap" }}>{fmtDate(g.createdAt)}</td>
                <td>
                  <div className="row-actions">
                    {g.status === "visible"
                      ? <button className="icon-btn" title="Hide" onClick={() => run(async () => { await setGuestbookStatusDb(g.id, "hidden"); Store.setGuestbookStatus(g.id, "hidden"); }).then(() => toast("Message hidden", "success"), () => toast("Couldn't update on the server"))}>{Icon.eyeOff({})}</button>
                      : <button className="icon-btn" title={g.status === "pending" ? "Approve" : "Show"} onClick={() => run(async () => { await setGuestbookStatusDb(g.id, "visible"); Store.setGuestbookStatus(g.id, "visible"); }).then(() => toast(g.status === "pending" ? "Message approved" : "Message shown", "success"), () => toast("Couldn't update on the server"))}>{g.status === "pending" ? Icon.check({}) : Icon.eye({})}</button>}
                    <button className="icon-btn icon-btn--danger" title="Delete" onClick={() => confirmDialog({ title: "Delete message?", message: "This permanently removes the guestbook entry.", confirmLabel: "Delete", danger: true }).then((ok) => { if (ok) run(async () => { await deleteGuestbookDb(g.id); Store.deleteGuestbook(g.id); }).then(() => toast("Message deleted", "success"), () => toast("Couldn't delete on the server")); })}>{Icon.trash({})}</button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={5} style={{ color: "var(--muted)", textAlign: "center", padding: 40 }}>{moderation && view === "pending" ? "Nothing awaiting approval." : "No messages."}</td></tr>}
          </tbody>
        </table>
      </div>
      <Pager page={pg.page} totalPages={pg.totalPages} total={pg.total} perPage={pg.perPage} start={pg.start} onPage={pg.setPage} noun="messages" />
      </div>

      <Modal open={emailOpen} onClose={() => setEmailOpen(false)} label="Email results">
        <SectionHead eyebrow="Guestbook" title="Email the messages" />
        <Field label="Send to" id="gb-email-to" hint="We'll email the guestbook messages (a summary + full table) to this address.">
          <Input id="gb-email-to" type="email" inputMode="email" value={emailTo} onChange={(e) => setEmailTo(e.target.value)} placeholder="name@example.com" />
        </Field>
        <Button variant="primary" block disabled={!emailTo.trim() || emailSending} onClick={() => emailResults(emailTo)}>{emailSending ? "Sending…" : "Send messages"}</Button>
      </Modal>
    </div>
  );
}

export function QuizAdmin() {
  const { quizSubs, quiz } = useStore();
  const [open, setOpen] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const sorted = [...quizSubs].sort((a, b) => b.score - a.score);
  const lb = usePaged(sorted, 10);
  const openNew = () => { setEditing(null); setEditorOpen(true); };
  const openEdit = (q) => { setEditing(q); setEditorOpen(true); };
  const [tab, setTab] = useState("questions");
  const { save: persistChanges } = React.useContext(AdminSaveCtx);
  return (
    <div>
      <div className="folders">
        <button className={"folder" + (tab === "questions" ? " folder--active" : "")} onClick={() => setTab("questions")}>{Icon.quiz({})} Questions</button>
        <button className={"folder" + (tab === "leaderboard" ? " folder--active" : "")} onClick={() => setTab("leaderboard")}>{Icon.grid({})} Leaderboard</button>
      </div>

      {tab === "questions" && (
      <div className="panel">
        <div className="panel__head">
          <div className="panel__title">Quiz Questions <span style={{ color: "var(--muted)", fontSize: 15 }}>({quiz.length})</span></div>
          <Button variant="primary" size="sm" onClick={openNew}>+ Add question</Button>
        </div>
        <div className="panel__body--flush table-wrap">
          <table className="tbl tbl--qz">
            <thead><tr><th>#</th><th>Question</th><th>Type</th><th>Correct answer</th><th></th></tr></thead>
            <tbody>
              {quiz.map((q, i) => (
                <tr key={q.id}>
                  <td style={{ fontFamily: "var(--font-display)", fontSize: 18, color: "var(--muted)" }}>{i + 1}</td>
                  <td style={{ maxWidth: 360 }}><strong>{q.q}</strong></td>
                  <td><span style={{ color: "var(--muted)" }}>{q.type === "true_false" ? "True / False" : "Multiple choice"}</span></td>
                  <td>{q.options ? q.options[q.answer] : ""}</td>
                  <td>
                    <div className="row-actions">
                      <MoveArrows i={i} count={quiz.length} onMove={async (dir) => { Store.moveQuizQuestion(q.id, dir); await persistChanges(); }} />
                      <button className="icon-btn" title="View question" onClick={() => setViewing(q)}>{Icon.eye({})}</button>
                      <button className="icon-btn" title="Edit question" onClick={() => openEdit(q)}>{Icon.edit({})}</button>
                      <button className="icon-btn icon-btn--danger" title="Delete" onClick={() => confirmDialog({ title: "Delete question?", message: "This removes the question from the quiz.", confirmLabel: "Delete", danger: true }).then(async (ok) => { if (ok) { Store.deleteQuizQuestion(q.id); await persistChanges(); } })}>{Icon.trash({})}</button>
                    </div>
                  </td>
                </tr>
              ))}
              {quiz.length === 0 && <tr><td colSpan={5} style={{ color: "var(--muted)", textAlign: "center", padding: 40 }}>No questions yet. Add one to get started.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {tab === "leaderboard" && (
      <div className="panel">
        <div className="panel__head"><div className="panel__title">Quiz Leaderboard <span style={{ color: "var(--muted)", fontSize: 15 }}>({quizSubs.length} plays)</span></div></div>
        <div className="panel__body--flush table-wrap">
          <table className="tbl">
            <thead><tr><th>#</th><th>Guest</th><th>Score</th><th>Played</th><th></th></tr></thead>
            <tbody>
              {lb.pageItems.map((s, i) => {
                const rank = lb.start + i + 1;
                return (
                <tr key={s.id}>
                  <td style={{ fontFamily: "var(--font-display)", fontSize: 20, color: rank <= 3 ? "var(--accent)" : "var(--muted)" }}>{rank}</td>
                  <td><strong>{s.name}</strong></td>
                  <td><strong>{s.score}</strong> / {s.total}</td>
                  <td style={{ color: "var(--muted)" }}>{fmtDate(s.createdAt)}</td>
                  <td><button className="icon-btn" onClick={() => setOpen(s)}>{Icon.eye({})}</button></td>
                </tr>
                );
              })}
              {quizSubs.length === 0 && <tr><td colSpan={5} style={{ color: "var(--muted)", textAlign: "center", padding: 40 }}>No one has played yet.</td></tr>}
            </tbody>
          </table>
        </div>
        <Pager page={lb.page} totalPages={lb.totalPages} total={lb.total} perPage={lb.perPage} start={lb.start} onPage={lb.setPage} noun="plays" />
      </div>
      )}
      <Modal open={!!open} onClose={() => setOpen(null)} label="Quiz answers">
        {open && (
          <div>
            <SectionHead eyebrow={`Scored ${open.score}/${open.total}`} title={open.name} />
            {open.answers.map((a, i) => {
              const qq = quiz.find((x) => x.id === a.questionId) || {};
              return (
                <div key={i} style={{ padding: "12px 0", borderBottom: "1px solid var(--line)", display: "flex", gap: 10 }}>
                  <span style={{ flex: "none", marginTop: 2, color: a.isCorrect ? "oklch(0.55 0.13 150)" : "oklch(0.55 0.16 25)" }}>{a.isCorrect ? Icon.check({ style: { width: 18 } }) : Icon.close({ style: { width: 18 } })}</span>
                  <div>
                    <div style={{ fontWeight: 600 }}>{qq.q}</div>
                    <div style={{ fontSize: 14, color: "var(--ink-soft)" }}>
                      Their answer: <strong style={{ color: a.isCorrect ? "oklch(0.5 0.13 150)" : "oklch(0.55 0.16 25)" }}>{qq.options && a.selected != null ? qq.options[a.selected] : "—"}</strong>
                      {!a.isCorrect && qq.options && <> · Correct: <strong style={{ color: "oklch(0.5 0.13 150)" }}>{qq.options[qq.answer]}</strong></>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Modal>
      <Modal open={!!viewing} onClose={() => setViewing(null)} label="Quiz question">
        {viewing && (
          <div>
            <SectionHead eyebrow={viewing.type === "true_false" ? "True / False" : "Multiple choice"} title={viewing.q} />
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {(viewing.options || []).map((opt, i) => {
                const correct = i === viewing.answer;
                return (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 14px", borderRadius: "var(--radius)", border: "1px solid " + (correct ? "var(--accent)" : "var(--line)"), background: correct ? "var(--accent-soft)" : "transparent" }}>
                    <span style={{ flex: "none", width: 22, color: correct ? "var(--accent)" : "var(--muted)" }}>{correct ? Icon.check({ style: { width: 18 } }) : String.fromCharCode(65 + i)}</span>
                    <span style={{ fontWeight: correct ? 600 : 400, color: "var(--ink)" }}>{opt}</span>
                    {correct && <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 600, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--accent)" }}>Correct</span>}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Modal>
      <QuestionEditor open={editorOpen} question={editing} onClose={() => setEditorOpen(false)} />
    </div>
  );
}

export const QR_TARGETS = [
  { key: "home", label: "Main Website", path: "/home" },
  { key: "rsvp", label: "RSVP", path: "/rsvp" },
  { key: "upload", label: "Photo / Video Upload", path: "/upload" },
  { key: "gallery", label: "Gallery", path: "/gallery" },
  { key: "guestbook", label: "Guestbook", path: "/guestbook" },
  { key: "quiz", label: "Couple Quiz", path: "/quiz" },
  { key: "video-message", label: "Video Message", path: "/video-message" },
];

export function QrAdmin() {
  const base = window.location.origin;
  return (
    <div className="panel">
      <div className="panel__head"><div className="panel__title">QR Codes</div><span style={{ color: "var(--muted)", fontSize: 14 }}>Print on signage, table cards & invites</span></div>
      <div className="panel__body">
        <div className="qr-grid">
          {QR_TARGETS.map((t) => {
            const url = base + t.path;
            return (
              <div className="qr-card" key={t.key}>
                <div className="qr-card__canvas"><QRCanvas text={url} size={150} /></div>
                <div className="qr-card__title">{t.label}</div>
                <div className="qr-card__url">{t.path}</div>
                <Button variant="ghost" size="sm" block onClick={() => downloadQR(url, t.key)}>{Icon.download({})} PNG</Button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function AdminToggle({ checked, onChange, label, desc, noRule }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "13px 0", borderBottom: noRule ? "none" : "1px solid var(--line)" }}>
      <div><div style={{ fontWeight: 600 }}>{label}</div>{desc && <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 2 }}>{desc}</div>}</div>
      <button type="button" onClick={() => onChange(!checked)} aria-pressed={checked} style={{ position: "relative", width: 46, height: 26, borderRadius: 100, border: "none", cursor: "pointer", background: checked ? "var(--accent)" : "var(--line)", transition: "background .2s", flex: "none" }}>
        <span style={{ position: "absolute", top: 3, left: checked ? 23 : 3, width: 20, height: 20, borderRadius: "50%", background: "#fff", transition: "left .2s", boxShadow: "0 1px 3px rgba(0,0,0,.3)" }} />
      </button>
    </div>
  );
}

// Bare switch (no label row) for a panel header — the visible show/hide control
// for a home section. `label` is the accessible name / tooltip only.
export function HeadSwitch({ checked, onChange, label }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} aria-pressed={checked} title={label} aria-label={label}
      style={{ position: "relative", width: 46, height: 26, borderRadius: 100, border: "none", cursor: "pointer", background: checked ? "var(--accent)" : "var(--line)", transition: "background .2s", flex: "none" }}>
      <span style={{ position: "absolute", top: 3, left: checked ? 23 : 3, width: 20, height: 20, borderRadius: "50%", background: "#fff", transition: "left .2s", boxShadow: "0 1px 3px rgba(0,0,0,.3)" }} />
    </button>
  );
}
const HEAD_ROW = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 };

// Add / edit a single schedule moment (modal — mirrors QuestionEditor).
export function ScheduleEditor({ open, index, item, onClose }) {
  const { schedule } = useStore();
  const { save: persistChanges } = React.useContext(AdminSaveCtx);
  const blank = { time: "", title: "", desc: "", loc: "" };
  const [f, setF] = useState(blank);
  useEffect(() => {
    if (item) setF({ time: item.time || "", title: item.title || "", desc: item.desc || "", loc: item.loc || "" });
    else setF(blank);
  }, [item, open]);
  const isEdit = index != null && index >= 0;

  async function save() {
    if (!f.title.trim()) { toast("Please enter a title.", "err"); return; }
    const payload = { time: f.time.trim(), title: f.title.trim(), desc: f.desc.trim(), loc: f.loc.trim() };
    if (isEdit) Store.updateScheduleItem(index, payload);
    else Store.updateSchedule([...schedule, payload]);
    // Persist to the DB right away so the edit survives a refresh (mirrors the
    // quiz editor). persistChanges shows the single "Changes saved" toast — don't
    // add another here, or the user sees two popups.
    await persistChanges();
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} label="Schedule item">
      <SectionHead eyebrow="Wedding Day Schedule" title={isEdit ? "Edit moment" : "New moment"} />
      <div className="field-row field-row--2">
        <Field label="Time" id="se-time"><Input id="se-time" value={f.time} onChange={(e) => setF((p) => ({ ...p, time: e.target.value }))} placeholder="3:00 PM" /></Field>
        <Field label="Location" id="se-loc"><Input id="se-loc" value={f.loc} onChange={(e) => setF((p) => ({ ...p, loc: e.target.value }))} placeholder="e.g. Garden Terrace" /></Field>
      </div>
      <Field label="Title" required id="se-title"><Input id="se-title" value={f.title} onChange={(e) => setF((p) => ({ ...p, title: e.target.value }))} placeholder="e.g. Ceremony" /></Field>
      <Field label="Description" id="se-desc" hint="A short line guests will see under the title"><Textarea id="se-desc" value={f.desc} onChange={(e) => setF((p) => ({ ...p, desc: e.target.value }))} placeholder="Welcome drinks on the south lawn." style={{ minHeight: 80 }} /></Field>
      <div style={{ display: "flex", gap: 12, marginTop: 8, justifyContent: "flex-end" }}>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={save}>{isEdit ? "Save moment" : "Add moment"}</Button>
      </div>
    </Modal>
  );
}

export function ScheduleAdmin() {
  const { schedule } = useStore();
  const { save: persistChanges } = React.useContext(AdminSaveCtx);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState(null);
  const openNew = () => { setEditingIndex(null); setEditorOpen(true); };
  const openEdit = (i) => { setEditingIndex(i); setEditorOpen(true); };
  const doDelete = async (i) => { if (await confirmDialog({ title: "Delete schedule item?", message: "This removes it from the wedding-day timeline.", confirmLabel: "Delete", danger: true })) { Store.updateSchedule(schedule.filter((_, j) => j !== i)); await persistChanges(); } };
  const editingItem = editingIndex != null ? schedule[editingIndex] : null;
  return (
    <div className="panel">
      <div className="panel__head">
        <div className="panel__title">Wedding Day Schedule <span style={{ color: "var(--muted)", fontSize: 15 }}>({schedule.length})</span></div>
        <Button variant="primary" size="sm" onClick={openNew}>+ Add item</Button>
      </div>
      <div className="panel__body--flush table-wrap">
        <table className="tbl">
          <thead><tr><th>#</th><th>Time</th><th>Title</th><th>Description</th><th>Location</th><th></th></tr></thead>
          <tbody>
            {schedule.map((item, i) => (
              <tr key={i}>
                <td style={{ fontFamily: "var(--font-display)", fontSize: 18, color: "var(--muted)" }}>{i + 1}</td>
                <td style={{ whiteSpace: "nowrap" }}>{item.time || "—"}</td>
                <td><strong>{item.title}</strong></td>
                <td style={{ maxWidth: 360, color: "var(--ink-soft)" }}>{item.desc}</td>
                <td style={{ color: "var(--muted)" }}>{item.loc || "—"}</td>
                <td>
                  <div className="row-actions">
                    <MoveArrows i={i} count={schedule.length} onMove={async (dir) => { Store.moveSchedule(i, dir); await persistChanges(); }} />
                    <button className="icon-btn" title="Edit moment" onClick={() => openEdit(i)}>{Icon.edit({})}</button>
                    <button className="icon-btn icon-btn--danger" title="Delete" onClick={() => doDelete(i)}>{Icon.trash({})}</button>
                  </div>
                </td>
              </tr>
            ))}
            {schedule.length === 0 && <tr><td colSpan={6} style={{ color: "var(--muted)", textAlign: "center", padding: 40 }}>No schedule items yet. Add your first moment.</td></tr>}
          </tbody>
        </table>
      </div>
      <ScheduleEditor open={editorOpen} index={editingIndex} item={editingItem} onClose={() => setEditorOpen(false)} />
    </div>
  );
}

export function TileEditor({ open, index, item, onClose }) {
  const { detailCards } = useStore();
  const { save: persistChanges } = React.useContext(AdminSaveCtx);
  const blank = { icon: "rings", title: "", body: "" };
  const [f, setF] = useState(blank);
  useEffect(() => {
    if (item) setF({ icon: item.icon || "rings", title: item.title || "", body: item.body || "" });
    else setF(blank);
  }, [item, open]);
  const isEdit = index != null && index >= 0;
  async function save() {
    if (!f.title.trim()) { toast("Please enter a title.", "err"); return; }
    const payload = { icon: f.icon, title: f.title.trim(), body: f.body.trim() };
    if (isEdit) Store.updateDetailCard(index, payload);
    else Store.updateDetailCards([...(detailCards || []), payload]);
    await persistChanges();
    onClose();
  }
  return (
    <Modal open={open} onClose={onClose} label="Details tile">
      <SectionHead eyebrow="Details Page" title={isEdit ? "Edit tile" : "New tile"} />
      <Field label="Icon" id="te-icon">
        <Select id="te-icon" value={f.icon} onChange={(e) => setF((p) => ({ ...p, icon: e.target.value }))}>
          <option value="rings">Rings</option>
          <option value="heart">Heart</option>
          <option value="user">Person</option>
          <option value="pin">Location</option>
          <option value="calendar">Calendar</option>
          <option value="camera">Camera</option>
          <option value="book">Book</option>
          <option value="quiz">Question</option>
        </Select>
      </Field>
      <Field label="Title" required id="te-title"><Input id="te-title" value={f.title} onChange={(e) => setF((p) => ({ ...p, title: e.target.value }))} placeholder="e.g. The Ceremony" /></Field>
      <Field label="Text" id="te-body" hint="What guests will read on the tile"><Textarea id="te-body" value={f.body} onChange={(e) => setF((p) => ({ ...p, body: e.target.value }))} placeholder="Join us as we say 'I do.'…" style={{ minHeight: 90 }} /></Field>
      <div style={{ display: "flex", gap: 12, marginTop: 8, justifyContent: "flex-end" }}>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={save}>{isEdit ? "Save tile" : "Add tile"}</Button>
      </div>
    </Modal>
  );
}

export function FaqEditor({ open, index, item, onClose }) {
  const { faq } = useStore();
  const { save: persistChanges } = React.useContext(AdminSaveCtx);
  const blank = { q: "", a: "" };
  const [f, setF] = useState(blank);
  useEffect(() => {
    if (item) setF({ q: item.q || "", a: item.a || "" });
    else setF(blank);
  }, [item, open]);
  const isEdit = index != null && index >= 0;
  async function save() {
    if (!f.q.trim()) { toast("Please enter a question.", "err"); return; }
    const payload = { q: f.q.trim(), a: f.a.trim() };
    if (isEdit) Store.updateFaqItem(index, payload);
    else Store.updateFaq([...(faq || []), payload]);
    await persistChanges();
    onClose();
  }
  return (
    <Modal open={open} onClose={onClose} label="FAQ question">
      <SectionHead eyebrow="Details Page" title={isEdit ? "Edit question" : "New question"} />
      <Field label="Question" required id="fe-q"><Input id="fe-q" value={f.q} onChange={(e) => setF((p) => ({ ...p, q: e.target.value }))} placeholder="e.g. What time should I arrive?" /></Field>
      <Field label="Answer" id="fe-a"><Textarea id="fe-a" value={f.a} onChange={(e) => setF((p) => ({ ...p, a: e.target.value }))} placeholder="The answer guests will see." style={{ minHeight: 100 }} /></Field>
      <div style={{ display: "flex", gap: 12, marginTop: 8, justifyContent: "flex-end" }}>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={save}>{isEdit ? "Save question" : "Add question"}</Button>
      </div>
    </Modal>
  );
}

export function DetailsAdmin() {
  const { detailCards, faq } = useStore();
  const { save: persistChanges } = React.useContext(AdminSaveCtx);
  const [tab, setTab] = useState("tiles");
  const [tileOpen, setTileOpen] = useState(false);
  const [tileIndex, setTileIndex] = useState(null);
  const [faqOpen, setFaqOpen] = useState(false);
  const [faqIndex, setFaqIndex] = useState(null);
  const openTile = (i) => { setTileIndex(i); setTileOpen(true); };
  const openFaq = (i) => { setFaqIndex(i); setFaqOpen(true); };
  const tiles = detailCards || [];
  const faqs = faq || [];
  const delTile = async (i) => { if (await confirmDialog({ title: "Delete tile?", message: "This removes it from the Details page.", confirmLabel: "Delete", danger: true })) { Store.updateDetailCards(tiles.filter((_, j) => j !== i)); await persistChanges(); } };
  const delFaq = async (i) => { if (await confirmDialog({ title: "Delete question?", message: "This removes it from the Details page FAQ.", confirmLabel: "Delete", danger: true })) { Store.updateFaq(faqs.filter((_, j) => j !== i)); await persistChanges(); } };
  return (
    <div>
      <div className="folders">
        <button className={"folder" + (tab === "tiles" ? " folder--active" : "")} onClick={() => setTab("tiles")}>{Icon.rings({})} Details</button>
        <button className={"folder" + (tab === "faq" ? " folder--active" : "")} onClick={() => setTab("faq")}>{Icon.book({})} FAQ</button>
      </div>

      {tab === "tiles" && (
      <div className="panel">
        <div className="panel__head">
          <div className="panel__title">Details <span style={{ color: "var(--muted)", fontSize: 15 }}>({tiles.length})</span></div>
          <Button variant="primary" size="sm" onClick={() => openTile(null)}>+ Add tile</Button>
        </div>
        <div className="panel__body--flush table-wrap">
          <table className="tbl">
            <thead><tr><th>#</th><th>Title</th><th>Text</th><th></th></tr></thead>
            <tbody>
              {tiles.map((c, i) => (
                <tr key={i}>
                  <td style={{ fontFamily: "var(--font-display)", fontSize: 18, color: "var(--muted)" }}>{i + 1}</td>
                  <td><strong>{c.title || "—"}</strong></td>
                  <td style={{ maxWidth: 420, color: "var(--ink-soft)" }}>{c.body}</td>
                  <td>
                    <div className="row-actions">
                      <MoveArrows i={i} count={tiles.length} onMove={async (dir) => { Store.moveDetailCard(i, dir); await persistChanges(); }} />
                      <button className="icon-btn" title="Edit tile" onClick={() => openTile(i)}>{Icon.edit({})}</button>
                      <button className="icon-btn icon-btn--danger" title="Delete" onClick={() => delTile(i)}>{Icon.trash({})}</button>
                    </div>
                  </td>
                </tr>
              ))}
              {tiles.length === 0 && <tr><td colSpan={4} style={{ color: "var(--muted)", textAlign: "center", padding: 40 }}>No tiles yet. Add one to get started.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {tab === "faq" && (
      <div className="panel">
        <div className="panel__head">
          <div className="panel__title">FAQ <span style={{ color: "var(--muted)", fontSize: 15 }}>({faqs.length})</span></div>
          <Button variant="primary" size="sm" onClick={() => openFaq(null)}>+ Add question</Button>
        </div>
        <div className="panel__body--flush table-wrap">
          <table className="tbl">
            <thead><tr><th>#</th><th>Question</th><th>Answer</th><th></th></tr></thead>
            <tbody>
              {faqs.map((item, i) => (
                <tr key={i}>
                  <td style={{ fontFamily: "var(--font-display)", fontSize: 18, color: "var(--muted)" }}>{i + 1}</td>
                  <td style={{ maxWidth: 320 }}><strong>{item.q || "—"}</strong></td>
                  <td style={{ maxWidth: 380, color: "var(--ink-soft)" }}>{item.a}</td>
                  <td>
                    <div className="row-actions">
                      <MoveArrows i={i} count={faqs.length} onMove={async (dir) => { Store.moveFaq(i, dir); await persistChanges(); }} />
                      <button className="icon-btn" title="Edit question" onClick={() => openFaq(i)}>{Icon.edit({})}</button>
                      <button className="icon-btn icon-btn--danger" title="Delete" onClick={() => delFaq(i)}>{Icon.trash({})}</button>
                    </div>
                  </td>
                </tr>
              ))}
              {faqs.length === 0 && <tr><td colSpan={4} style={{ color: "var(--muted)", textAlign: "center", padding: 40 }}>No questions yet. Add one to get started.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      )}

      <TileEditor open={tileOpen} index={tileIndex} item={tileIndex != null ? tiles[tileIndex] : null} onClose={() => setTileOpen(false)} />
      <FaqEditor open={faqOpen} index={faqIndex} item={faqIndex != null ? faqs[faqIndex] : null} onClose={() => setFaqOpen(false)} />
    </div>
  );
}

// Venue & Map admin: manage a LIST of venues (each its own map + tiles), plus
// choose which venue's map + tiles show on the home page. Back-compat: existing
// single-map clients arrive as one venue (see mappers.venuesFrom).
export function VenueAdmin({ section = "editor", headRight = null }) {
  const { settings, venues } = useStore();
  const { save: persistChanges } = React.useContext(AdminSaveCtx);
  const list = venues || [];
  const [editVi, setEditVi] = useState(null);   // index of venue whose editor MODAL is open (null = closed)

  const commit = (next) => Store.updateVenues(next);
  const patchVenue = (i, patch) => commit(list.map((v, idx) => (idx === i ? { ...v, ...patch } : v)));
  const addVenue = () => { commit([...list, { id: uid(), name: "", address: "", mapQuery: "", mapLat: undefined, mapLng: undefined, cards: [] }]); setEditVi(list.length); };
  const moveVenue = (i, dir) => { const a = [...list]; const j = i + dir; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; commit(a); };
  async function removeVenue(i) {
    const ok = await confirmDialog({ title: "Delete this location?", message: `Remove "${list[i].name || list[i].address || "location " + (i + 1)}" and its tiles from the Venue page. This can't be undone.`, confirmLabel: "Delete", danger: true });
    if (!ok) return;
    commit(list.filter((_, idx) => idx !== i));
    await persistChanges();
  }

  // ---- Home-map selection only (rendered in the Home → Google Maps tab) ----
  if (section === "home") {
    const homeVenue = list.find((v) => v.id === settings.homeVenueId) || list[0] || null;
    return (
      <div className="panel">
        <div className="panel__head" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}><div className="panel__title">Home page map</div>{headRight}</div>
        <div className="panel__body">
          <Field label="Map to show on home" id="home-venue">
            <Select id="home-venue" value={homeVenue ? homeVenue.id : ""} onChange={(e) => Store.updateSettings({ homeVenueId: e.target.value })}>
              {list.map((v, i) => <option key={v.id || i} value={v.id}>{v.name || v.address || `Location ${i + 1}`}</option>)}
            </Select>
          </Field>
          <div style={{ marginTop: 4 }}>
            <AdminToggle
              label="Show this location's tiles under the home map"
              desc={homeVenue ? `Turns the ${(homeVenue.cards || []).length} tile${(homeVenue.cards || []).length === 1 ? "" : "s"} for “${homeVenue.name || homeVenue.address || "this location"}” on or off on the home page. Off = map only.` : "Off = map only."}
              checked={settings.homeShowTiles === true}
              onChange={(v) => Store.updateSettings({ homeShowTiles: v })}
            />
          </div>
        </div>
        <SaveFooter />
      </div>
    );
  }

  // ---- Editor only: the venues list (rendered in the Venue & Map tab) ----
  return (
    <div>
      <div className="panel">
        <div className="panel__head">
          <div className="panel__title">Locations &amp; maps <span style={{ color: "var(--muted)", fontSize: 15 }}>({list.length})</span></div>
          <Button variant="primary" size="sm" onClick={addVenue}>+ Add location</Button>
        </div>
        <div className="panel__body--flush table-wrap">
          <table className="tbl">
            <thead><tr><th>#</th><th>Name</th><th>Address</th><th>Tiles</th><th></th></tr></thead>
            <tbody>
              {list.map((v, i) => (
                <tr key={v.id || i}>
                  <td style={{ fontFamily: "var(--font-display)", fontSize: 18, color: "var(--muted)" }}>{i + 1}</td>
                  <td><strong>{v.name || "—"}</strong></td>
                  <td style={{ maxWidth: 320, color: "var(--ink-soft)" }}>{v.address || v.mapQuery || "—"}</td>
                  <td style={{ color: "var(--muted)" }}>{(v.cards || []).length}</td>
                  <td>
                    <div className="row-actions">
                      <MoveArrows i={i} count={list.length} onMove={(dir) => moveVenue(i, dir)} />
                      <button className="icon-btn" title="View map" disabled={!(v.mapQuery || v.address)} onClick={() => window.open(mapSearchUrl(v.mapQuery || v.address), "_blank")}>{Icon.eye({})}</button>
                      <button className="icon-btn" title="Edit location" onClick={() => setEditVi(i)}>{Icon.edit({})}</button>
                      <button className="icon-btn icon-btn--danger" title="Delete" onClick={() => removeVenue(i)}>{Icon.trash({})}</button>
                    </div>
                  </td>
                </tr>
              ))}
              {list.length === 0 && <tr><td colSpan={5} style={{ color: "var(--muted)", textAlign: "center", padding: 40 }}>No locations yet. Add one to get started.</td></tr>}
            </tbody>
          </table>
        </div>
        <SaveFooter />
      </div>

      <VenueEditorModal
        open={editVi != null && !!list[editVi]}
        venue={editVi != null ? list[editVi] : null}
        onPatch={(patch) => patchVenue(editVi, patch)}
        onClose={() => setEditVi(null)}
        onDiscard={() => { commit(list.filter((_, idx) => idx !== editVi)); setEditVi(null); }}
      />
    </div>
  );
}

// Add/edit one venue in a modal: name, address, map, and its tiles (edited
// inline). Edits apply live to the store; the list's Save changes persists.
function VenueEditorModal({ open, venue, onPatch, onClose, onDiscard }) {
  if (!open || !venue) return null;
  const cards = venue.cards || [];
  const setCards = (cs) => onPatch({ cards: cs });
  const addTile = () => setCards([...cards, { id: uid(), t: "", d: "" }]);
  const setTile = (i, patch) => setCards(cards.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  const removeTile = (i) => setCards(cards.filter((_, idx) => idx !== i));
  const moveTile = (i, dir) => { const a = [...cards]; const j = i + dir; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; setCards(a); };
  // On close: drop empty info rows; discard the location entirely if nothing was
  // entered; require a name/address/map before keeping one (no blank locations).
  const finish = () => {
    const clean = cards.filter((c) => (c.t || "").trim() || (c.d || "").trim());
    const hasIdentity = !!((venue.name || "").trim() || (venue.address || "").trim() || (venue.mapQuery || "").trim() || venue.mapLat != null);
    if (!hasIdentity && clean.length === 0) { onDiscard(); return; }
    if (!hasIdentity) { toast("Add a name, address, or map pin for this location.", "err"); return; }
    if (clean.length !== cards.length) onPatch({ cards: clean });
    onClose();
  };
  return (
    <Modal open={open} onClose={finish} label="Location">
      <SectionHead eyebrow="Venue & Map" title={venue.name || "Location"} />
      <Field label="Location name" id="v-name" hint="e.g. Ceremony — St. Mary's Church"><Input id="v-name" value={venue.name} onChange={(e) => onPatch({ name: e.target.value })} /></Field>
      <Field label="Address" id="v-addr"><Input id="v-addr" value={venue.address} onChange={(e) => onPatch({ address: e.target.value })} /></Field>
      <Field label="Map location" hint="Search a place, then click the map or drag the pin." id="v-map">
        <LocationPicker value={venue.mapQuery} lat={venue.mapLat} lng={venue.mapLng}
          onChange={({ query, lat, lng }) => onPatch({ mapQuery: query, mapLat: lat, mapLng: lng })} />
      </Field>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 8, marginBottom: 16 }}>
        <Button variant="ghost" size="sm" disabled={!(venue.mapQuery || venue.address)} onClick={() => window.open(mapSearchUrl(venue.mapQuery || venue.address), "_blank")}>{Icon.pin({})} Open in Google Maps</Button>
        {(venue.mapQuery || venue.mapLat != null) && <Button variant="ghost" size="sm" onClick={() => onPatch({ mapQuery: "", mapLat: undefined, mapLng: undefined })}>Clear pin</Button>}
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "6px 0 10px" }}>
        <div style={{ fontWeight: 600 }}>Info <span style={{ color: "var(--muted)", fontWeight: 400, fontSize: 14 }}>({cards.length})</span></div>
        <Button variant="ghost" size="sm" onClick={addTile}>+ Add info</Button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {cards.map((c, i) => (
          <div key={c.id || i} style={{ border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <Input value={c.t} onChange={(e) => setTile(i, { t: e.target.value })} placeholder="Info title (e.g. Parking)" />
              <MoveArrows i={i} count={cards.length} onMove={(dir) => moveTile(i, dir)} />
              <button className="icon-btn icon-btn--danger" title="Delete info" onClick={() => removeTile(i)}>{Icon.trash({})}</button>
            </div>
            <Textarea value={c.d} onChange={(e) => setTile(i, { d: e.target.value })} placeholder="What guests read under this map" style={{ minHeight: 70 }} />
          </div>
        ))}
        {cards.length === 0 && <div style={{ color: "var(--muted)", fontSize: 14, textAlign: "center", padding: "16px 0" }}>No info yet. Add one to show details under this map.</div>}
      </div>

      <div style={{ display: "flex", gap: 12, marginTop: 16, justifyContent: "flex-end" }}>
        <Button variant="primary" onClick={finish}>Done</Button>
      </div>
    </Modal>
  );
}

// Live theme preview — embeds the REAL home page (/?preview) and re-themes it
// instantly via postMessage as the operator clicks themes. Display-only; the
// iframe applies changes in-memory (previewSettings) and never saves.
function ThemePreviewFrame({ theme, decorStyle, decorOn }) {
  const ref = React.useRef(null);
  const wrapRef = React.useRef(null);
  const [device, setDevice] = React.useState("desktop"); // desktop | mobile
  const [scale, setScale] = React.useState(0.35);
  // The embedded page renders at the iframe's own width, so a 1280px frame shows
  // the desktop layout and a 390px frame shows the mobile layout. We then scale
  // the whole frame down to fit the panel — so the WHOLE screen is always visible.
  const baseW = device === "desktop" ? 1280 : 390;
  const baseH = device === "desktop" ? 800 : 780;
  const MAX_H = 460;
  React.useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth || baseW;
      setScale(Math.min(w / baseW, MAX_H / baseH, 1)); // fit width + cap height, never upscale
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [baseW, baseH]);
  const post = React.useCallback(() => {
    const w = ref.current && ref.current.contentWindow;
    if (w) w.postMessage({ type: "evermore:preview", theme, decorStyle, decorOn }, window.location.origin);
  }, [theme, decorStyle, decorOn]);
  React.useEffect(() => { post(); }, [post]);   // re-post whenever the selection changes
  React.useEffect(() => {                        // and once the embedded app signals ready
    const onReady = (e) => { if (e.origin === window.location.origin && e.data && e.data.type === "evermore:preview-ready") post(); };
    window.addEventListener("message", onReady);
    return () => window.removeEventListener("message", onReady);
  }, [post]);
  return (
    <div style={{ width: "100%", maxWidth: 520, margin: "0 auto" }}>
      <div className="seg" style={{ display: "flex", width: "fit-content", margin: "0 auto 12px" }}>
        <button type="button" className={device === "desktop" ? "on" : ""} onClick={() => setDevice("desktop")}>Desktop</button>
        <button type="button" className={device === "mobile" ? "on" : ""} onClick={() => setDevice("mobile")}>Mobile</button>
      </div>
      <div ref={wrapRef} style={{ width: "100%" }}>
        <div style={{ width: Math.round(baseW * scale), height: Math.round(baseH * scale), margin: "0 auto", overflow: "hidden", borderRadius: 12, border: "1px solid var(--line, #e5e7eb)", boxShadow: "0 8px 28px -14px rgba(0,0,0,.35)", background: "#fff" }}>
          <iframe ref={ref} title="Live theme preview" src="/?preview=1" loading="lazy" onLoad={post}
            style={{ width: baseW, height: baseH, border: 0, transform: `scale(${scale})`, transformOrigin: "top left", pointerEvents: "none" }} />
        </div>
      </div>
      <p style={{ textAlign: "center", color: "var(--muted)", fontSize: 12, margin: "8px 0 0" }}>Your real home page · click a theme to preview · Save to keep</p>
    </div>
  );
}

export function SettingsAdmin() {
  const { settings, story } = useStore();
  const f = settings;
  const set = (k) => (e) => Store.updateSettings({ [k]: e.target && e.target.type === "checkbox" ? e.target.checked : e.target.value });
  const setKey = (k, v) => Store.updateSettings({ [k]: v });
  const [tab, setTab] = useState("features");
  const themeRowRef = useRef(null);
  const renderSwatch = (key) => {
    const v = THEMES[key].vars;
    const on = f.theme === key;
    return (
      <button key={key} className={"theme-sw" + (on ? " theme-sw--on" : "")} onClick={() => Store.updateSettings({ theme: key, themeAccent: "", displayFont: THEME_FONTS[key].display, bodyFont: THEME_FONTS[key].body })}>
        <span className="theme-sw__prev" style={{ background: v["--bg"] }}>
          <i style={{ background: v["--accent"] }} />
          <i style={{ background: v["--gold"] }} />
          <i style={{ background: v["--ink"] }} />
        </span>
        <span className="theme-sw__name">{THEMES[key].label}{on ? " ✓" : ""}</span>
        <span className="theme-sw__blurb">{THEMES[key].blurb}</span>
      </button>
    );
  };
  // Theme options are scoped to the active event type via the registry.
  const allowed = themesForEvent(f.eventType || DEFAULT_EVENT_TYPE);
  const normalThemes = allowed.filter((k) => THEMES[k] && !isPremiumTheme(k));
  const premiumThemes = allowed.filter((k) => THEMES[k] && isPremiumTheme(k));
  // "General" (Couple & Event) moved to the top-level Home tab.
  const STABS = [["features", "Features", "check"], ["appearance", "Theme", "grid"], ["photos", "Photos", "camera"], ["access", "Access", "check"]];

  return (
    <div>
      <div className="folders folders--sticky">
        {STABS.map(([k, l, ic]) => {
          const soon = k === "photos"; // Photos is a future feature — greyed out for now
          return (
            <button key={k} type="button" disabled={soon} title={soon ? "Coming soon" : undefined}
              className={"folder" + (tab === k ? " folder--active" : "") + (soon ? " folder--soon" : "")}
              onClick={() => { if (!soon) setTab(k); }}>
              {Icon[ic]({})} {l}{soon && <span className="folder__soon">Soon</span>}
            </button>
          );
        })}
      </div>

      {tab === "features" && (<div className="panel">
        <div className="panel__head"><div className="panel__title">Features</div></div>
        <div className="panel__body">
          <p style={{ marginTop: 0, color: "var(--ink-soft)" }}>Turn sections of this site on or off — disabled ones are hidden from guests and the menu. Click <strong>Save changes</strong> to apply.</p>
          <div className="mod-toggles mod-toggles--edit">
            {["story", "details", "schedule", "venue", "gallery", "guestbook", "quiz", "rsvp"].map((m) => {
              const locked = DISABLED_MODULES.has(m);          // pending feature: show but can't enable
              const on = !locked && f.modules?.[m] !== false;
              return (
                <label key={m} className={"mod-pill" + (on ? " mod-pill--on" : "") + (locked ? " mod-pill--locked" : "")}
                  title={locked ? "Pending — feature not available yet" : undefined}>
                  <input type="checkbox" checked={on} disabled={locked}
                    onChange={(e) => Store.updateSettings({ modules: { ...(f.modules || {}), [m]: e.target.checked } })} /> {moduleLabel(m)}
                  {locked && <span className="mod-pill__pending">Pending</span>}
                </label>
              );
            })}
          </div>
        </div>
        <SaveFooter />
      </div>)}

      {tab === "appearance" && (<><div className="panel">
        <div className="panel__head"><div className="panel__title">Theme</div><span style={{ color: "var(--muted)", fontSize: 14 }}>Preview updates instantly — Save changes to publish</span></div>
        <div className="panel__body">
          <span className="field__label" style={{ display: "block", margin: "0 0 8px" }}>Live preview</span>
          <ThemePreviewFrame theme={f.theme} decorStyle={f.decorStyle} decorOn={f.decorOn} />
          <span className="field__label" style={{ display: "block", margin: "20px 0 10px" }}>Choose a theme</span>

          <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 0 8px", whiteSpace: "nowrap" }}>
            <span style={{ fontWeight: 600, color: "var(--ink)", fontSize: 14 }}>Normal Themes</span>
            <span style={{ fontSize: 12, color: "var(--muted)", textTransform: "none", letterSpacing: 0 }}>— scroll for more →</span>
          </div>
          <div className="theme-scroller">
            <button type="button" className="theme-nav theme-nav--l" aria-label="Previous themes" onClick={() => themeRowRef.current && themeRowRef.current.scrollBy({ left: -320, behavior: "smooth" })}>‹</button>
            <button type="button" className="theme-nav theme-nav--r" aria-label="Next themes" onClick={() => themeRowRef.current && themeRowRef.current.scrollBy({ left: 320, behavior: "smooth" })}>›</button>
            <div className="theme-grid" ref={themeRowRef}>
            {normalThemes.map(renderSwatch)}
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "26px 0 8px", whiteSpace: "nowrap" }}>
            <span style={{ fontWeight: 600, color: "var(--ink)", fontSize: 14 }}>Premium Themes</span>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", color: "#7a5b12", background: "linear-gradient(180deg,#f6e6b8,#e9cf86)", border: "1px solid #d8b65e", borderRadius: 999, padding: "2px 9px" }}>★ PREMIUM</span>
          </div>
          <div className="theme-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 12, overflow: "visible" }}>
            {premiumThemes.map(renderSwatch)}
          </div>

          {isPremiumTheme(f.theme) && (
            <div style={{ marginTop: 24, padding: 18, border: "1px solid #d8b65e", borderRadius: "var(--radius)", background: "linear-gradient(180deg, color-mix(in oklch, #f6e6b8 22%, var(--surface)), var(--surface))" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                {Icon.grid({ style: { width: 18, height: 18 } })}
                <span style={{ fontWeight: 700, color: "var(--ink)", fontSize: 15 }}>Tools</span>
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".06em", color: "#7a5b12", background: "linear-gradient(180deg,#f6e6b8,#e9cf86)", border: "1px solid #d8b65e", borderRadius: 999, padding: "2px 8px" }}>PREMIUM</span>
              </div>
              <AdminToggle
                label="Enable arrange"
                desc="Adds an “Arrange Now” button beside View site. Use it to drag and resize the invitation pieces directly on the live page."
                checked={!!f.arrangeEnabled}
                onChange={(v) => setKey("arrangeEnabled", v)}
              />
            </div>
          )}
        </div>
        <SaveFooter />
      </div>

      <div className="panel">
        <div className="panel__head"><div className="panel__title">Floating Decorations</div><span style={{ color: "var(--muted)", fontSize: 14 }}>Animated motif that drifts over your page</span></div>
        <div className="panel__body">
          <AdminToggle label="Show floating decorations" desc="A gentle animated layer over your page." checked={f.decorOn} onChange={(v) => setKey("decorOn", v)} />
          <Field label="Decoration style" id="s-decor" hint="Pick the motif that floats across your page">
            <Select id="s-decor" value={f.decorStyle} onChange={set("decorStyle")} disabled={!f.decorOn}>
              <option value="petals">Falling petals</option>
              <option value="hearts">Hearts</option>
              <option value="fireflies">Fireflies</option>
              <option value="leaves">Drifting leaves</option>
              <option value="confetti">Confetti</option>
              <option value="snow">Falling snow</option>
              <option value="bubbles">Rising bubbles</option>
              <option value="sparkles">Sparkles</option>
              <option value="orbs">Bokeh orbs</option>
              <option value="balloons">Floating balloons</option>
              {FX_LIST.map((e) => (<option key={e.id} value={"fx-" + e.id}>{e.title}</option>))}
            </Select>
          </Field>
          <div style={{ marginTop: 4 }}>
            <span className="field__label" style={{ display: "block", marginBottom: 7 }}>Preview</span>
            {String(f.decorStyle).startsWith("fx-")
              ? <FallingFx id={f.decorStyle.slice(3)} preview />
              : <DecorPreview style={f.decorStyle} />}
          </div>
        </div>
        <SaveFooter />
      </div>

      {f.theme === "envelope" && (
      <div className="panel">
        <div className="panel__head"><div className="panel__title">Envelope Frame Photo</div><span style={{ color: "var(--muted)", fontSize: 14 }}>Shows inside the oval frame on the opened envelope</span></div>
        <div className="panel__body" style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
          <ImageUploadField purpose="frame" label="Photo inside the oval frame" ratio="1 / 1" framePreview="/assets/invite/p2-frame.png" defaultPreview="/assets/invite/frame-video.gif"
            value={f.frameImage} onChange={(v) => setKey("frameImage", v)} />
          <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 10, maxWidth: 360 }}>A square photo of the two of you works best. Leave empty to keep the default animated frame.</p>
        </div>
        <SaveFooter />
      </div>
      )}

      {f.theme === "envelope" && (
      <div className="panel">
        <div className="panel__head"><div className="panel__title">Envelope Color</div><span style={{ color: "var(--muted)", fontSize: 14 }}>The paper color of the envelope itself</span></div>
        <div className="panel__body">
          <div style={{ display: "flex", gap: 28, alignItems: "flex-start", flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 280px", minWidth: 260 }}>
              <Field label="Paper color" id="s-envcolor" hint="Recolors the envelope paper and lace — the wax seal stays cream. The falling leaves and everything inside the envelope are unchanged.">
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {Object.keys(ENV_COLORS).map((key) => {
                    const on = (f.envColor || "olive") === key;
                    return (
                      <button key={key} type="button" onClick={() => setKey("envColor", key)}
                        style={{ display: "flex", alignItems: "center", gap: 7, padding: "6px 11px 6px 7px", borderRadius: 999, cursor: "pointer",
                          border: on ? "2px solid var(--accent)" : "1px solid var(--line)", background: on ? "color-mix(in oklch, var(--accent) 10%, var(--surface))" : "var(--surface)",
                          font: "inherit", fontSize: 13, fontWeight: on ? 700 : 500, color: "var(--ink)" }}>
                        <span style={{ width: 16, height: 16, borderRadius: "50%", background: ENV_COLORS[key].dot, boxShadow: "inset 0 0 0 1px rgba(0,0,0,.15)" }} />
                        {ENV_COLORS[key].label}
                      </button>
                    );
                  })}
                  {(() => {
                    const on = f.envColor === "custom";
                    const hex = f.envColorCustom || "#9e6243";
                    return (
                      <button type="button" onClick={() => { setKey("envColor", "custom"); if (!f.envColorCustom) setKey("envColorCustom", hex); }}
                        style={{ display: "flex", alignItems: "center", gap: 7, padding: "6px 11px 6px 7px", borderRadius: 999, cursor: "pointer",
                          border: on ? "2px solid var(--accent)" : "1px solid var(--line)", background: on ? "color-mix(in oklch, var(--accent) 10%, var(--surface))" : "var(--surface)",
                          font: "inherit", fontSize: 13, fontWeight: on ? 700 : 500, color: "var(--ink)" }}>
                        <span style={{ width: 16, height: 16, borderRadius: "50%", background: on ? hex : "conic-gradient(red, yellow, lime, cyan, blue, magenta, red)", boxShadow: "inset 0 0 0 1px rgba(0,0,0,.15)" }} />
                        Custom
                      </button>
                    );
                  })()}
                </div>
              </Field>
              {f.envColor === "custom" && (
                <Field label="Pick any color" id="s-envcustom" hint="The envelope paper is matched to this color as closely as the artwork allows">
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <input id="s-envcustom" type="color" value={f.envColorCustom || "#9e6243"} onChange={(e) => setKey("envColorCustom", e.target.value)}
                      style={{ width: 52, height: 36, padding: 2, border: "1px solid var(--line)", borderRadius: 8, background: "var(--surface)", cursor: "pointer" }} />
                    <code style={{ fontSize: 13, color: "var(--ink-soft)" }}>{f.envColorCustom || "#9e6243"}</code>
                  </div>
                </Field>
              )}
              <AdminToggle label="Match website colors" desc="Page backgrounds, headings and buttons take on the envelope color. Turn off to keep the classic olive-green site." checked={f.envMatchSite !== false} onChange={(v) => setKey("envMatchSite", v)} />
            </div>
            <div style={{ flex: "1 1 300px", minWidth: 260, display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
              {(() => {
                const flt = envColorFilterFor(f.envColor, f.envColorCustom);
                return (
                  <div style={{ position: "relative", width: "100%", maxWidth: 380 }}>
                    <img src="/assets/invite/env-closed.webp" alt="Envelope color preview" style={{ display: "block", width: "100%", height: "auto", borderRadius: 8 }} />
                    {flt ? <>
                      <img src="/assets/invite/env-closed.webp" alt="" aria-hidden="true"
                        style={{ position: "absolute", left: 0, top: 0, width: "100%", height: "auto", borderRadius: 8, pointerEvents: "none", filter: flt, WebkitMaskImage: ENV_SEAL_MASK, maskImage: ENV_SEAL_MASK }} />
                      <img src="/assets/invite/seal-closed.png" alt="" aria-hidden="true"
                        style={{ position: "absolute", left: ENV_SEAL_POS.left, top: ENV_SEAL_POS.top, width: ENV_SEAL_POS.width, transform: "translate(-50%, -50%)", pointerEvents: "none" }} />
                    </> : null}
                  </div>
                );
              })()}
              <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 10, maxWidth: 360 }}>Live preview — the wax seal always stays cream. Save changes, then view the site.</p>
            </div>
          </div>
        </div>
        <SaveFooter />
      </div>
      )}

      {f.theme === "envelope" && (
      <div className="panel">
        <div className="panel__head"><div className="panel__title">Title Size</div><span style={{ color: "var(--muted)", fontSize: 14 }}>Size of &ldquo;A Love Letter From&rdquo; + your names on the cover</span></div>
        <div className="panel__body">
          {(() => {
            const sc = (f.envTitleSize != null && f.envTitleSize >= 1 && f.envTitleSize <= 10) ? f.envTitleSize : 5;
            const px = Math.round(9 + (sc - 1) / 9 * 30); // indicative preview only — real size scales with the envelope
            return (<>
              <Field label={`Title size — ${sc.toFixed(1)} / 10`} id="s-envtitle" hint="Scales with the envelope — bigger on a wide/maximized screen, smaller on a phone, always in proportion. Save changes, then view the site.">
                <input id="s-envtitle" type="range" min="1" max="10" step="0.1" value={sc} onChange={(e) => setKey("envTitleSize", parseFloat(e.target.value))} style={{ width: "100%", accentColor: "var(--accent)" }} />
              </Field>
              <div style={{ marginTop: 14, background: "#3a4a2a", borderRadius: 8, padding: "26px 16px", textAlign: "center", color: "#f3ebdb", fontFamily: "'Cormorant Garamond', Georgia, serif", overflow: "hidden" }}>
                <div style={{ fontVariant: "small-caps", letterSpacing: ".08em", fontSize: px, lineHeight: 1.3 }}>A Love Letter From</div>
                <div style={{ fontVariant: "small-caps", letterSpacing: ".08em", fontSize: px, lineHeight: 1.3, marginTop: 4 }}>{f.partnerA || "Partner"} &amp; {f.partnerB || "Partner"}</div>
                <div style={{ fontFamily: "system-ui, sans-serif", fontSize: 11, opacity: .7, marginTop: 12, fontVariant: "normal", letterSpacing: 0 }}>Preview only — actual size scales with the screen</div>
              </div>
            </>);
          })()}
        </div>
        <SaveFooter />
      </div>
      )}

      {f.theme === "envelope" && (
      <div className="panel">
        <div className="panel__head"><div className="panel__title">Envelope Background</div><span style={{ color: "var(--muted)", fontSize: 14 }}>The photo behind the envelope on the opening screen</span></div>
        <div className="panel__body">
          <div style={{ display: "flex", gap: 28, alignItems: "flex-start", flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 300px", minWidth: 260, display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
              <ImageUploadField purpose="envbg" label="Background image" ratio="16 / 9" defaultPreview="/assets/invite/bg-wedding.jpg" tintStrength={f.envTintOn !== false ? (f.envTint == null ? 55 : f.envTint) : 0} tintGradient={egTintGradientFor(f.envTintColor || "olive", f.envTintCustom)}
                value={f.envBgImage} onChange={(v) => setKey("envBgImage", v)} />
              <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 10, maxWidth: 360 }}>A wide landscape photo works best — it sits behind the envelope and gently zooms when the invitation opens. Leave empty to keep the default.</p>
            </div>
            <div style={{ flex: "1 1 280px", minWidth: 260, textAlign: "left" }}>
              <AdminToggle label="Background tint" desc="A dark overlay over the photo so the envelope and text stay legible." checked={f.envTintOn !== false} onChange={(v) => setKey("envTintOn", v)} />
              <Field label="Tint color" id="s-envtintcolor" hint="The hue of the overlay wash">
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {Object.keys(EG_TINTS).map((key) => {
                    const on = (f.envTintColor || "olive") === key;
                    return (
                      <button key={key} type="button" onClick={() => setKey("envTintColor", key)} disabled={f.envTintOn === false}
                        style={{ display: "flex", alignItems: "center", gap: 7, padding: "6px 11px 6px 7px", borderRadius: 999, cursor: f.envTintOn === false ? "not-allowed" : "pointer",
                          border: on ? "2px solid var(--accent)" : "1px solid var(--line)", background: on ? "color-mix(in oklch, var(--accent) 10%, var(--surface))" : "var(--surface)",
                          opacity: f.envTintOn === false ? 0.5 : 1, font: "inherit", fontSize: 13, fontWeight: on ? 700 : 500, color: "var(--ink)" }}>
                        <span style={{ width: 16, height: 16, borderRadius: "50%", background: EG_TINTS[key].dot, boxShadow: "inset 0 0 0 1px rgba(0,0,0,.15)" }} />
                        {EG_TINTS[key].label}
                      </button>
                    );
                  })}
                  {(() => {
                    const on = f.envTintColor === "custom";
                    const hex = f.envTintCustom || "#41502a";
                    return (
                      <button type="button" disabled={f.envTintOn === false}
                        onClick={() => { setKey("envTintColor", "custom"); if (!f.envTintCustom) setKey("envTintCustom", hex); }}
                        style={{ display: "flex", alignItems: "center", gap: 7, padding: "6px 11px 6px 7px", borderRadius: 999, cursor: f.envTintOn === false ? "not-allowed" : "pointer",
                          border: on ? "2px solid var(--accent)" : "1px solid var(--line)", background: on ? "color-mix(in oklch, var(--accent) 10%, var(--surface))" : "var(--surface)",
                          opacity: f.envTintOn === false ? 0.5 : 1, font: "inherit", fontSize: 13, fontWeight: on ? 700 : 500, color: "var(--ink)" }}>
                        <span style={{ width: 16, height: 16, borderRadius: "50%", background: on ? hex : "conic-gradient(red, yellow, lime, cyan, blue, magenta, red)", boxShadow: "inset 0 0 0 1px rgba(0,0,0,.15)" }} />
                        Custom
                      </button>
                    );
                  })()}
                </div>
              </Field>
              {f.envTintColor === "custom" && (
                <Field label="Custom tint color" id="s-envtintcustom" hint="The wash is this color fading darker toward the bottom">
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <input id="s-envtintcustom" type="color" value={f.envTintCustom || "#41502a"} disabled={f.envTintOn === false} onChange={(e) => setKey("envTintCustom", e.target.value)}
                      style={{ width: 52, height: 36, padding: 2, border: "1px solid var(--line)", borderRadius: 8, background: "var(--surface)", cursor: "pointer" }} />
                    <code style={{ fontSize: 13, color: "var(--ink-soft)" }}>{f.envTintCustom || "#41502a"}</code>
                  </div>
                </Field>
              )}
              <Field label={`Tint strength — ${f.envTint == null ? 55 : f.envTint}%`} id="s-envtint" hint="0% shows the bare photo, 100% is a deep wash">
                <input id="s-envtint" type="range" min="0" max="100" step="5" value={f.envTint == null ? 55 : f.envTint} disabled={f.envTintOn === false} onChange={(e) => setKey("envTint", parseInt(e.target.value, 10))} style={{ width: "100%", accentColor: "var(--accent)" }} />
              </Field>
            </div>
          </div>
        </div>
        <SaveFooter />
      </div>
      )}

      </>)}

      {tab === "photos" && (<div className="panel">
        <div className="panel__head"><div className="panel__title">Home &amp; Story Photos</div><span style={{ color: "var(--muted)", fontSize: 14 }}>Upload your own — replaces the samples</span></div>
        <div className="panel__body">
          <ImageUploadField purpose="hero" label="Home hero photo (full-bleed background)" ratio="16 / 9" value={f.heroImage} onChange={(v) => setKey("heroImage", v)} />
          <p style={{ fontSize: 12, color: "var(--muted)", marginTop: -2 }}>Leave empty to use a themed background that matches your chosen theme.</p>
          <div style={{ fontSize: 12, letterSpacing: ".12em", textTransform: "uppercase", fontWeight: 600, color: "var(--ink-soft)", margin: "22px 0 10px" }}>Our Story photos</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 20 }}>
            {story.map((row, i) => (
              <ImageUploadField key={i} purpose="story" ratio="4 / 3" label={(row.year ? row.year + " \u00b7 " : "") + row.title} value={row.img} onChange={(v) => Store.updateStoryItem(i, { img: v })} />
            ))}
          </div>
          <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 16 }}>Photos save automatically.</p>
        </div>
        <SaveFooter />
      </div>)}

      {tab === "access" && (<><div className="panel">
        <div className="panel__head"><div className="panel__title">Moderation</div></div>
        <div className="panel__body">
          <AdminToggle label="Auto-approve photos &amp; videos" desc="When on, guest uploads appear in the gallery instantly. When off, they wait in the Media queue for your approval." checked={f.autoApproveMedia} onChange={(v) => setKey("autoApproveMedia", v)} />
          <AdminToggle label="Auto-approve guestbook messages" desc="When on, messages post immediately. When off, they stay hidden until you approve them in the Guestbook tab." checked={f.autoApproveGuestbook} onChange={(v) => setKey("autoApproveGuestbook", v)} />
        </div>
      </div>

      <div className="panel">
        <div className="panel__head"><div className="panel__title">Owner editing</div></div>
        <div className="panel__body">
          {/* Per-section grants: each one opens that content area to the couple's
              owner account (normally superadmin-only). Stored in settings.ownerEdit. */}
          <AdminToggle label="Edit Home" desc="Let the owner edit the Home tab — couple & event info and the invitation section." checked={(f.ownerEdit || {}).home === true} onChange={(v) => setKey("ownerEdit", { ...(f.ownerEdit || {}), home: v })} />
          <AdminToggle label="Edit Schedule" desc="Let the owner edit the Schedule tab (wedding-day timeline guests see)." checked={(f.ownerEdit || {}).schedule === true} onChange={(v) => setKey("ownerEdit", { ...(f.ownerEdit || {}), schedule: v })} />
          <AdminToggle label="Edit Venue &amp; Map" desc="Let the owner edit the Venue & Map tab (venue cards, map, directions)." checked={(f.ownerEdit || {}).venue === true} onChange={(v) => setKey("ownerEdit", { ...(f.ownerEdit || {}), venue: v })} />
          <AdminToggle label="Edit Entourage" desc="Let the owner edit the Entourage folder inside the Home tab (wedding party groups & names)." checked={(f.ownerEdit || {}).entourage === true} onChange={(v) => setKey("ownerEdit", { ...(f.ownerEdit || {}), entourage: v })} />
        </div>
      </div>

      <div className="panel">
        <div className="panel__head"><div className="panel__title">Access &amp; Toggles</div></div>
        <div className="panel__body">
          <Field label="Admin password" id="s-pw"><Input id="s-pw" value={f.adminPassword} onChange={set("adminPassword")} /></Field>
          <AdminToggle label="Allow guest uploads" desc="Master switch for the photo/video upload pages." checked={f.uploadsEnabled} onChange={(v) => setKey("uploadsEnabled", v)} />
          <AdminToggle label="Show public gallery" desc="Hide the gallery from guests entirely if you prefer." checked={f.galleryEnabled} onChange={(v) => setKey("galleryEnabled", v)} />
          <AdminToggle label="Enable Strict RSVP" desc="Track an invited-guest list with seat allocations, and see who hasn't replied. Adds a Guests tab. Only guests on the list can RSVP, and party size is capped at their seat allocation." checked={f.strictRsvp === true} onChange={(v) => setKey("strictRsvp", v)} />
        </div>
        <SaveFooter />
      </div></>)}
    </div>
  );
}

// Home — the home page's core info: couple/event details (moved here from
// Settings → General) plus the welcome/invitation section guests see.
// "RSVP closes at" picker. A native datetime-local always shows the confusing
// "mm/dd/yyyy, --:-- --" segments. So we never render the native field as text:
// the visible box is a read-only input that shows either a friendly formatted
// date or a plain placeholder, and the actual native picker (hidden) is opened
// via showPicker() on click. Users only ever see clean text.
function ClosesAtInput({ value, onChange }) {
  const ref = useRef(null);
  const fmt = (v) => {
    if (!v) return "";
    const d = new Date(v);
    return isNaN(d.getTime()) ? v : d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  };
  const openPicker = () => {
    const el = ref.current;
    if (!el) return;
    try { el.showPicker ? el.showPicker() : el.focus(); } catch (_) { el.focus(); }
  };
  return (
    <div style={{ position: "relative" }}>
      <Input id="s-rsvpd" readOnly value={fmt(value)} placeholder="Leave blank to keep the form open"
        onClick={openPicker} style={{ cursor: "pointer", paddingRight: value ? 66 : 42 }} />
      <button type="button" onClick={openPicker} aria-label="Pick a close date"
        style={{ position: "absolute", top: "50%", right: 8, transform: "translateY(-50%)", display: "grid", placeItems: "center", width: 30, height: 30, background: "none", border: "none", color: "var(--muted)", cursor: "pointer" }}>
        {Icon.calendar({ style: { width: 18, height: 18 } })}
      </button>
      {value && (
        <button type="button" onClick={() => onChange({ target: { value: "" } })} aria-label="Clear close date"
          style={{ position: "absolute", top: "50%", right: 38, transform: "translateY(-50%)", display: "grid", placeItems: "center", width: 26, height: 26, background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 20, lineHeight: 1 }}>&times;</button>
      )}
      {/* real native picker, visually hidden — opened via showPicker() above */}
      <input ref={ref} type="datetime-local" value={value || ""} onChange={onChange} tabIndex={-1} aria-hidden="true"
        style={{ position: "absolute", left: 12, bottom: 0, width: 1, height: 1, opacity: 0, pointerEvents: "none" }} />
    </div>
  );
}

export function HomeAdmin() {
  const { settings, auth } = useStore();
  const { save: persistChanges } = React.useContext(AdminSaveCtx);
  const f = settings;
  const set = (k) => (e) => Store.updateSettings({ [k]: e.target && e.target.type === "checkbox" ? e.target.checked : e.target.value });
  // flip a home-section visibility flag and save immediately (auto-save tabs)
  const toggleShow = async (k, v) => { Store.updateSettings({ [k]: v }); await persistChanges(); };
  const isSuper = auth.role === "superadmin";
  // Folder sub-tabs. Maps/Timeline/Attire/Music are superadmin-managed content.
  // Couple & Event + Invitation show for superadmin or an owner with the "home"
  // grant; Entourage for superadmin or the "entourage" grant (settings.ownerEdit,
  // flipped in Settings → Access). An owner reaches this tab at all only when
  // one of those grants is on (see visibleAdminTabs).
  const grants = settings.ownerEdit || {};
  const canHome = isSuper || grants.home === true;
  const canEntourage = isSuper || grants.entourage === true;
  const TABS = [
    ...(canHome ? [
      { k: "couple", label: "Couple & Event", icon: "rings" },
      { k: "invite", label: "Invitation", icon: "home" },
    ] : []),
    ...(isSuper ? [
      { k: "maps", label: "Google Maps", icon: "pin" },
      { k: "timeline", label: "Timeline", icon: "calendar" },
      { k: "attire", label: "Attire", icon: "book" },
      { k: "music", label: "Music playlist", icon: "play" },
    ] : []),
    ...(canEntourage ? [{ k: "entourage", label: "Entourage", icon: "user" }] : []),
  ];
  const [tab, setTab] = useState("couple");
  if (TABS.length === 0) return null; // owner without any grant — tab shouldn't even be visible
  const active = TABS.some((t) => t.k === tab) ? tab : TABS[0].k;
  return (
    <div>
      <div className="folders">
        {TABS.map((t) => (
          <button key={t.k} className={"folder" + (active === t.k ? " folder--active" : "")} onClick={() => setTab(t.k)}>
            {Icon[t.icon] ? Icon[t.icon]({}) : null} {t.label}
          </button>
        ))}
      </div>

      {active === "couple" && (
        <>
          <div className="panel">
            <div className="panel__head"><div className="panel__title">Couple & Event</div></div>
            <div className="panel__body" style={{ maxWidth: 900, margin: "0 auto" }}>
              <div className="field-row field-row--2">
                <Field label="Partner A" id="s-a"><Input id="s-a" value={f.partnerA} onChange={set("partnerA")} /></Field>
                <Field label="Partner B" id="s-b"><Input id="s-b" value={f.partnerB} onChange={set("partnerB")} /></Field>
              </div>
              <div className="field-row field-row--2">
                <Field label="Wedding date & time" hint="Drives the countdown" id="s-date"><Input id="s-date" type="datetime-local" value={f.weddingDate} onChange={set("weddingDate")} /></Field>
                <Field label="Display date label" id="s-datel"><Input id="s-datel" value={f.weddingDateLabel} onChange={set("weddingDateLabel")} /></Field>
              </div>
              {/* narrow wrapper so the switch sits next to its label, not far across the wide panel */}
              <div style={{ maxWidth: 460 }}>
                <AdminToggle noRule label="Show countdown timer" desc="The live days/hours/minutes counter on the home page. Turn off to hide it." checked={f.showCountdown !== false} onChange={(v) => toggleShow("showCountdown", v)} />
              </div>
              <Field label="Welcome message" id="s-welcome"><Textarea id="s-welcome" rows={3} value={f.welcome} onChange={set("welcome")} /></Field>
              <div className="field-row field-row--2">
                <Field label="RSVP deadline (display text)" id="s-rsvp" hint="Shown on the RSVP page — e.g. “August 15, 2027”"><Input id="s-rsvp" value={f.rsvpDeadline} onChange={set("rsvpDeadline")} /></Field>
                <Field label="RSVP closes at" id="s-rsvpd" hint="Optional. Set a date/time to auto-close the form."><ClosesAtInput value={f.rsvpDeadlineDate} onChange={set("rsvpDeadlineDate")} /></Field>
              </div>
              <Field label="Hashtag" id="s-hash"><Input id="s-hash" value={f.hashtag} onChange={set("hashtag")} /></Field>
            </div>
          </div>
          <SaveFooter />
        </>
      )}

      {active === "invite" && (
        <>
          <div className="panel">
            <div className="panel__head"><div className="panel__title">Home page — invitation</div></div>
            <div className="panel__body" style={{ maxWidth: 900, margin: "0 auto" }}>
              <p style={{ color: "var(--muted)", margin: "0 0 18px", fontSize: 14 }}>
                The welcome section guests see on your home page, under the hero.
              </p>
              <Field label="Heading" id="h-title" hint="The big invitation line">
                <Input id="h-title" value={f.inviteTitle} onChange={set("inviteTitle")} placeholder="You're invited to celebrate love" />
              </Field>
              <Field label="Message" id="h-body" hint="A warm welcome paragraph under the heading">
                <Textarea id="h-body" value={f.inviteBody} onChange={set("inviteBody")} style={{ minHeight: 130 }} placeholder="We can't wait to celebrate…" />
              </Field>
            </div>
          </div>
          <SaveFooter />
        </>
      )}

      {isSuper && active === "timeline" && (
        <div className="panel">
          <div className="panel__head" style={HEAD_ROW}><div className="panel__title">Home timeline</div><HeadSwitch label="Show timeline on the home page" checked={f.showTimeline !== false} onChange={(v) => toggleShow("showTimeline", v)} /></div>
          <div className="panel__body">
            <p style={{ color: "var(--muted)", margin: "0 0 18px", fontSize: 14 }}>
              How the “A glimpse of the schedule” timeline shows on the home page. Edit the events themselves in the Schedule tab. Saves instantly.
            </p>
            <div className="tl-pick">
              {[
                { v: "vertical", label: "Vertical", sub: "Events stacked down a centre rail",
                  art: <svg viewBox="0 0 64 48" width="64" height="48" fill="none"><line x1="16" y1="6" x2="16" y2="42" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" /><circle cx="16" cy="12" r="3.5" fill="currentColor" /><circle cx="16" cy="24" r="3.5" fill="currentColor" /><circle cx="16" cy="36" r="3.5" fill="currentColor" /><rect x="26" y="10" width="28" height="4" rx="2" fill="currentColor" opacity="0.5" /><rect x="26" y="22" width="28" height="4" rx="2" fill="currentColor" opacity="0.5" /><rect x="26" y="34" width="28" height="4" rx="2" fill="currentColor" opacity="0.5" /></svg> },
                { v: "horizontal", label: "Horizontal", sub: "Events along a left-to-right rail (scrolls)",
                  art: <svg viewBox="0 0 64 48" width="64" height="48" fill="none"><line x1="6" y1="20" x2="58" y2="20" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" /><circle cx="16" cy="20" r="3.5" fill="currentColor" /><circle cx="32" cy="20" r="3.5" fill="currentColor" /><circle cx="48" cy="20" r="3.5" fill="currentColor" /><rect x="9" y="30" width="14" height="4" rx="2" fill="currentColor" opacity="0.5" /><rect x="25" y="30" width="14" height="4" rx="2" fill="currentColor" opacity="0.5" /><rect x="41" y="30" width="14" height="4" rx="2" fill="currentColor" opacity="0.5" /></svg> },
              ].map((o) => (
                <button key={o.v} type="button"
                  className={"tl-pick__opt" + ((f.homeTimelineLayout || "vertical") === o.v ? " is-active" : "")}
                  onClick={() => toggleShow("homeTimelineLayout", o.v)}>
                  <span className="tl-pick__art">{o.art}</span>
                  <span className="tl-pick__label">{o.label}</span>
                  <span className="tl-pick__sub">{o.sub}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {isSuper && active === "music" && (
        <>
          <div className="panel">
            <div className="panel__head" style={HEAD_ROW}><div className="panel__title">Music player</div><HeadSwitch label="Show music player on the home page" checked={f.showMusic !== false} onChange={(v) => toggleShow("showMusic", v)} /></div>
            <div className="panel__body">
              <AdminToggle label="Autoplay music on load" desc="Start the playlist automatically (on the first tap or scroll). When off, guests press play themselves. Saves instantly."
                checked={f.musicAutoplay !== false} onChange={(v) => toggleShow("musicAutoplay", v)} />
              <div style={{ height: 20 }} />
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Player style</div>
              <p style={{ color: "var(--muted)", margin: "0 0 14px", fontSize: 14 }}>
                How the home music player looks. Saves instantly.
              </p>
              <div className="tl-pick">
                {[
                  { v: "vinyl", label: "Vinyl", sub: "Spinning record, matches your wedding theme",
                    art: <svg viewBox="0 0 64 48" width="64" height="48" fill="none"><circle cx="32" cy="24" r="17" stroke="currentColor" strokeWidth="2.5" /><circle cx="32" cy="24" r="6" fill="currentColor" opacity="0.5" /><circle cx="32" cy="24" r="1.8" fill="currentColor" /><circle cx="32" cy="24" r="11.5" stroke="currentColor" strokeWidth="1" opacity="0.4" /></svg> },
                  { v: "device", label: "Retro Device", sub: "Matte player with a click wheel",
                    art: <svg viewBox="0 0 64 48" width="64" height="48" fill="none"><rect x="8" y="8" width="48" height="32" rx="6" stroke="currentColor" strokeWidth="2.5" /><rect x="13" y="13" width="20" height="22" rx="3" fill="currentColor" opacity="0.35" /><circle cx="45" cy="24" r="8" stroke="currentColor" strokeWidth="2.5" /><circle cx="45" cy="24" r="2.5" fill="currentColor" /></svg> },
                ].map((o) => (
                  <button key={o.v} type="button"
                    className={"tl-pick__opt" + ((f.playerSkin || "vinyl") === o.v ? " is-active" : "")}
                    onClick={() => toggleShow("playerSkin", o.v)}>
                    <span className="tl-pick__art">{o.art}</span>
                    <span className="tl-pick__label">{o.label}</span>
                    <span className="tl-pick__sub">{o.sub}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
          <R2MigratePanel />
          <MusicAdmin />
        </>
      )}
      {canEntourage && active === "entourage" && (
        <>
          <EntourageAdmin headRight={<HeadSwitch label="Show entourage on the home page" checked={f.showEntourage !== false} onChange={(v) => toggleShow("showEntourage", v)} />} />
        </>
      )}
      {isSuper && active === "attire" && (
        <>
          <AttireAdmin headRight={<HeadSwitch label="Show attire guide on the home page" checked={f.showAttire !== false} onChange={(v) => toggleShow("showAttire", v)} />} />
        </>
      )}
      {isSuper && active === "maps" && (
        <>
          <VenueAdmin section="home" headRight={<HeadSwitch label="Show map on the home page" checked={f.showMap !== false} onChange={(v) => toggleShow("showMap", v)} />} />
        </>
      )}
    </div>
  );
}

// --- Entourage admin (groups of people; superadmin-only content tab) --------
export function EntouragePersonEditor({ open, gid, person, onClose }) {
  const { save: persistChanges } = React.useContext(AdminSaveCtx);
  const blank = { name: "", role: "" };
  const [f, setF] = useState(blank);
  useEffect(() => { if (person) setF({ name: person.name || "", role: person.role || "" }); else setF(blank); }, [person, open]);
  const isEdit = !!(person && person.id);
  async function save() {
    if (!f.name.trim()) { toast("Please enter a name.", "err"); return; }
    const payload = { name: f.name.trim(), role: f.role.trim() };
    if (isEdit) Store.updateEntouragePerson(gid, person.id, payload);
    else Store.addEntouragePerson(gid, payload);
    await persistChanges();
    onClose();
  }
  return (
    <Modal open={open} onClose={onClose} label="Entourage person">
      <SectionHead eyebrow="Entourage" title={isEdit ? "Edit person" : "Add person"} />
      <Field label="Name" required id="ep-name"><Input id="ep-name" value={f.name} onChange={(e) => setF((p) => ({ ...p, name: e.target.value }))} placeholder="e.g. Mark Reyes" /></Field>
      <Field label="Role" id="ep-role" hint="Optional — e.g. Best Man, Maid of Honor"><Input id="ep-role" value={f.role} onChange={(e) => setF((p) => ({ ...p, role: e.target.value }))} placeholder="e.g. Best Man" /></Field>
      <div style={{ display: "flex", gap: 12, marginTop: 8, justifyContent: "flex-end" }}>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={save}>{isEdit ? "Save person" : "Add person"}</Button>
      </div>
    </Modal>
  );
}

export function EntourageGroupEditor({ open, group, onClose }) {
  const { save: persistChanges } = React.useContext(AdminSaveCtx);
  const [title, setTitle] = useState("");
  useEffect(() => { setTitle(group ? (group.title || "") : ""); }, [group, open]);
  const isEdit = !!(group && group.id);
  async function save() {
    if (!title.trim()) { toast("Please enter a group name.", "err"); return; }
    if (isEdit) Store.updateEntourageGroup(group.id, { title: title.trim() });
    else Store.addEntourageGroup(title.trim());
    await persistChanges();
    onClose();
  }
  return (
    <Modal open={open} onClose={onClose} label="Entourage group">
      <SectionHead eyebrow="Entourage" title={isEdit ? "Rename group" : "Add group"} />
      <Field label="Group name" required id="eg-title" hint="e.g. Groomsmen, Bridesmaids, Principal Sponsors"><Input id="eg-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Groomsmen" /></Field>
      <div style={{ display: "flex", gap: 12, marginTop: 8, justifyContent: "flex-end" }}>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={save}>{isEdit ? "Save" : "Add group"}</Button>
      </div>
    </Modal>
  );
}

export function EntourageAdmin({ headRight }) {
  const { entourage } = useStore();
  const { save: persistChanges } = React.useContext(AdminSaveCtx);
  const groups = entourage || [];
  const [groupOpen, setGroupOpen] = useState(false);
  const [editGroup, setEditGroup] = useState(null);
  const [personOpen, setPersonOpen] = useState(false);
  const [personCtx, setPersonCtx] = useState({ gid: null, person: null });
  const moveGroup = async (gid, dir) => { Store.moveEntourageGroup(gid, dir); await persistChanges(); };
  const delGroup = async (g) => { if (await confirmDialog({ title: "Delete group?", message: `Remove "${g.title}" and everyone in it?`, confirmLabel: "Delete", danger: true })) { Store.deleteEntourageGroup(g.id); await persistChanges(); } };
  const movePerson = async (gid, pid, dir) => { Store.moveEntouragePerson(gid, pid, dir); await persistChanges(); };
  const delPerson = async (gid, p) => { if (await confirmDialog({ title: "Delete person?", message: `Remove ${p.name}?`, confirmLabel: "Delete", danger: true })) { Store.deleteEntouragePerson(gid, p.id); await persistChanges(); } };
  return (
    <div className="panel">
      <div className="panel__head">
        <div className="panel__title">Entourage <span style={{ color: "var(--muted)", fontSize: 15 }}>({groups.length})</span></div>
        {headRight}
      </div>
      <div className="panel__body">
        <div className="admin-toolbar" style={{ marginBottom: 16 }}><div className="admin-toolbar__end"><Button variant="primary" className="admin-toolbar__action" onClick={() => { setEditGroup(null); setGroupOpen(true); }}>+ Add group</Button></div></div>
        <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 0, marginBottom: 18 }}>Groups shown on the home page after the schedule. Add a group (e.g. Groomsmen), then add people under it. Everything saves automatically.</p>
        {groups.length === 0 && <p style={{ color: "var(--muted)", textAlign: "center", padding: "30px 0" }}>No groups yet — add your first one above.</p>}
        {groups.map((g, gi) => (
          <div className="ent-edit-group" key={g.id}>
            <div className="ent-edit-group__head">
              <div className="ent-edit-group__title">{g.title} <span style={{ color: "var(--muted)", fontWeight: 400, fontSize: 14 }}>({(g.people || []).length})</span></div>
              <div className="row-actions">
                <button className="icon-btn" title="Move up" onClick={() => moveGroup(g.id, -1)} disabled={gi === 0}>↑</button>
                <button className="icon-btn" title="Move down" onClick={() => moveGroup(g.id, 1)} disabled={gi === groups.length - 1}>↓</button>
                <button className="icon-btn" title="Rename group" onClick={() => { setEditGroup(g); setGroupOpen(true); }}>{Icon.edit({})}</button>
                <button className="icon-btn icon-btn--danger" title="Delete group" onClick={() => delGroup(g)}>{Icon.trash({})}</button>
              </div>
            </div>
            <div className="panel__body--flush table-wrap">
              <table className="tbl">
                <thead><tr><th>#</th><th>Name</th><th>Role</th><th></th></tr></thead>
                <tbody>
                  {(g.people || []).map((p, pi) => (
                    <tr key={p.id}>
                      <td style={{ color: "var(--muted)" }}>{pi + 1}</td>
                      <td><strong>{p.name}</strong></td>
                      <td style={{ color: "var(--ink-soft)" }}>{p.role || "—"}</td>
                      <td>
                        <div className="row-actions">
                          <button className="icon-btn" title="Move up" onClick={() => movePerson(g.id, p.id, -1)} disabled={pi === 0}>↑</button>
                          <button className="icon-btn" title="Move down" onClick={() => movePerson(g.id, p.id, 1)} disabled={pi === ((g.people || []).length - 1)}>↓</button>
                          <button className="icon-btn" title="Edit person" onClick={() => { setPersonCtx({ gid: g.id, person: p }); setPersonOpen(true); }}>{Icon.edit({})}</button>
                          <button className="icon-btn icon-btn--danger" title="Delete" onClick={() => delPerson(g.id, p)}>{Icon.trash({})}</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {(g.people || []).length === 0 && <tr><td colSpan={4} style={{ color: "var(--muted)", textAlign: "center", padding: 24 }}>No people yet.</td></tr>}
                </tbody>
              </table>
            </div>
            <div style={{ padding: "12px 16px 14px" }}>
              <Button variant="ghost" size="sm" onClick={() => { setPersonCtx({ gid: g.id, person: null }); setPersonOpen(true); }}>+ Add person</Button>
            </div>
          </div>
        ))}
      </div>
      <EntourageGroupEditor open={groupOpen} group={editGroup} onClose={() => setGroupOpen(false)} />
      <EntouragePersonEditor open={personOpen} gid={personCtx.gid} person={personCtx.person} onClose={() => setPersonOpen(false)} />
    </div>
  );
}

// --- Attire guide admin (groups with an example image + a colour palette) ---
export function AttireGroupEditor({ open, group, onClose }) {
  const { save: persistChanges } = React.useContext(AdminSaveCtx);
  const [f, setF] = useState({ name: "", desc: "", image: "", palette: [] });
  useEffect(() => {
    if (group) setF({ name: group.name || "", desc: group.desc || "", image: group.image || "", palette: [...(group.palette || [])] });
    else setF({ name: "", desc: "", image: "", palette: [] });
  }, [group, open]);
  const isEdit = !!(group && group.id);
  const setColor = (i, c) => setF((p) => ({ ...p, palette: p.palette.map((x, j) => (j === i ? c : x)) }));
  const addColor = () => setF((p) => ({ ...p, palette: [...p.palette, "#c9a96a"] }));
  const removeColor = (i) => setF((p) => ({ ...p, palette: p.palette.filter((_, j) => j !== i) }));
  async function save() {
    if (!f.name.trim()) { toast("Please enter a name.", "err"); return; }
    const payload = { name: f.name.trim(), desc: f.desc.trim(), image: f.image, palette: f.palette };
    if (isEdit) Store.updateAttireGroup(group.id, payload);
    else Store.addAttireGroup(payload);
    await persistChanges();
    onClose();
  }
  return (
    <Modal open={open} onClose={onClose} label="Attire group">
      <SectionHead eyebrow="Attire" title={isEdit ? "Edit group" : "Add group"} />
      <Field label="Name" required id="at-name"><Input id="at-name" value={f.name} onChange={(e) => setF((p) => ({ ...p, name: e.target.value }))} placeholder="e.g. Men, Women, Children" /></Field>
      <Field label="Description" id="at-desc" hint="Short guidance, e.g. “Black suit, earthy tones” (optional).">
        <Textarea id="at-desc" value={f.desc} onChange={(e) => setF((p) => ({ ...p, desc: e.target.value }))} placeholder="e.g. Black suit, earthy tones" style={{ minHeight: 70 }} />
      </Field>
      <Field label="Example picture" hint="A reference outfit or inspiration image (optional)." id="at-img">
        <ImageUploadField purpose="attire" value={f.image} ratio="3 / 4" onChange={(v) => setF((p) => ({ ...p, image: v }))} />
      </Field>
      <Field label="Colour palette" hint="Add the outfit colours — click a swatch to pick a colour.">
        <div className="pal-edit">
          {f.palette.map((c, i) => (
            <span className="pal-edit__item" key={i}>
              <input className="pal-edit__sw" type="color" value={/^#[0-9a-fA-F]{6}$/.test(c) ? c : "#c9a96a"} onChange={(e) => setColor(i, e.target.value)} />
              <button type="button" className="pal-edit__rm" title="Remove colour" onClick={() => removeColor(i)}>×</button>
            </span>
          ))}
          <button type="button" className="pal-edit__add" title="Add colour" onClick={addColor}>+</button>
        </div>
      </Field>
      <div style={{ display: "flex", gap: 12, marginTop: 18, justifyContent: "flex-end" }}>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={save}>{isEdit ? "Save group" : "Add group"}</Button>
      </div>
    </Modal>
  );
}

export function AttireAdmin({ headRight }) {
  const { attire } = useStore();
  const { save: persistChanges } = React.useContext(AdminSaveCtx);
  const groups = attire || [];
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const move = async (id, dir) => { Store.moveAttireGroup(id, dir); await persistChanges(); };
  const del = async (g) => { if (await confirmDialog({ title: "Delete group?", message: `Remove "${g.name}" from the attire guide?`, confirmLabel: "Delete", danger: true })) { Store.deleteAttireGroup(g.id); await persistChanges(); } };
  return (
    <div className="panel">
      <div className="panel__head">
        <div className="panel__title">Attire guide <span style={{ color: "var(--muted)", fontSize: 15 }}>({groups.length})</span></div>
        {headRight}
      </div>
      <div className="admin-toolbar" style={{ padding: "14px 16px" }}><div className="admin-toolbar__end"><Button variant="primary" className="admin-toolbar__action" onClick={() => { setEditing(null); setOpen(true); }}>+ Add group</Button></div></div>
      <div className="panel__body--flush table-wrap">
        <table className="tbl">
          <thead><tr><th>#</th><th>Preview</th><th>Name</th><th>Palette</th><th></th></tr></thead>
          <tbody>
            {groups.map((g, i) => (
              <tr key={g.id}>
                <td style={{ color: "var(--muted)" }}>{i + 1}</td>
                <td>{g.image ? <img src={mediaUrl(g.image)} alt="" style={{ width: 40, height: 52, objectFit: "cover", borderRadius: 6, display: "block" }} /> : <span style={{ color: "var(--muted)" }}>—</span>}</td>
                <td><strong>{g.name}</strong>{g.desc ? <div style={{ color: "var(--ink-soft)", fontSize: 12, marginTop: 2, maxWidth: 280 }}>{g.desc}</div> : null}</td>
                <td><div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>{(g.palette || []).map((c, j) => <span key={j} style={{ width: 18, height: 18, borderRadius: "50%", background: c, border: "1px solid var(--line)", display: "inline-block" }} title={c} />)}</div></td>
                <td>
                  <div className="row-actions">
                    <MoveArrows i={i} count={groups.length} onMove={(dir) => move(g.id, dir)} />
                    <button className="icon-btn" title="Edit group" onClick={() => { setEditing(g); setOpen(true); }}>{Icon.edit({})}</button>
                    <button className="icon-btn icon-btn--danger" title="Delete" onClick={() => del(g)}>{Icon.trash({})}</button>
                  </div>
                </td>
              </tr>
            ))}
            {groups.length === 0 && <tr><td colSpan={5} style={{ color: "var(--muted)", textAlign: "center", padding: 40 }}>No groups yet — add Men, Women, Children, etc.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="panel__foot"><span className="panel__foot-hint">Shown on the home page after the schedule. Saves automatically.</span></div>
      <AttireGroupEditor open={open} group={editing} onClose={() => setOpen(false)} />
    </div>
  );
}

// --- Music admin (upload audio to Storage; superadmin-only content tab) -----
// Some browsers report an empty MIME type for .mp3/.m4a etc., so accept by file
// extension too — not just `file.type.startsWith("audio/")`.
const AUDIO_EXT_RE = /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|weba|webm|aiff?|wma)$/i;
const isAudioFile = (f) => !!f && ((f.type && f.type.startsWith("audio/")) || AUDIO_EXT_RE.test(f.name || ""));
const AUDIO_ACCEPT = "audio/*,.mp3,.m4a,.aac,.wav,.ogg,.oga,.opus,.flac";

export function TrackEditor({ open, track, onClose }) {
  const { save: persistChanges } = React.useContext(AdminSaveCtx);
  const { clientId } = useStore();
  const [f, setF] = useState({ title: "", artist: "", url: "", art: "" });
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  useEffect(() => { if (track) setF({ title: track.title || "", artist: track.artist || "", url: track.url || "", art: track.art || "" }); }, [track, open]);
  async function onReplace(files) {
    const file = [...(files || [])].find(isAudioFile);
    if (!file) { toast("Please choose an audio file.", "err"); if (fileRef.current) fileRef.current.value = ""; return; }
    setUploading(true);
    try {
      const { url } = await uploadAudio(file, clientId);
      setF((p) => ({ ...p, url }));
      setPickerOpen(false);
      toast("Audio replaced — click Save track to keep it");
    } catch (e) { toast("Upload failed: " + (e.message || "error"), "err"); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ""; }
  }
  async function save() {
    if (!track) return;
    if (!f.title.trim()) { toast("Please enter a title.", "err"); return; }
    const patch = { title: f.title.trim(), artist: f.artist.trim(), url: f.url, art: f.art || "" };
    if (track.id) Store.updateTrack(track.id, patch); else Store.addTrack(patch);
    await persistChanges();
    onClose();
  }
  return (
    <Modal open={open} onClose={onClose} label="Track">
      <SectionHead eyebrow="Music" title={track && track.id ? "Edit track" : "Add track"} />
      <Field label="Title" required id="trk-t"><Input id="trk-t" value={f.title} onChange={(e) => setF((p) => ({ ...p, title: e.target.value }))} placeholder="e.g. Perfect" /></Field>
      <Field label="Artist" id="trk-a"><Input id="trk-a" value={f.artist} onChange={(e) => setF((p) => ({ ...p, artist: e.target.value }))} placeholder="e.g. Ed Sheeran" /></Field>
      <Field label="Audio file" id="trk-audio" hint="Upload a new file, or reuse one from your library">
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {f.url ? <audio src={mediaUrl(f.url)} controls preload="none" style={{ width: "100%", height: 38 }} /> : <span style={{ color: "var(--muted)", fontSize: 13 }}>No audio yet</span>}
          <input ref={fileRef} type="file" accept={AUDIO_ACCEPT} style={{ display: "none" }} onChange={(e) => onReplace(e.target.files)} />
          <div><Button variant="ghost" size="sm" disabled={uploading} onClick={() => setPickerOpen(true)}>{uploading ? "Uploading…" : (f.url ? "Replace audio" : "Add audio")}</Button></div>
        </div>
      </Field>
      <MediaPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        type="audio"
        clientId={clientId}
        uploadLabel={f.url ? "Replace audio" : "Choose audio"}
        uploading={uploading}
        onUploadNew={() => fileRef.current && fileRef.current.click()}
        onPick={(key) => setF((p) => ({ ...p, url: key }))}
      />
      <Field label="Cover image" id="trk-art" hint="Shown on the Retro Device player screen. Image, GIF, or MP4 — square works best. Optional; falls back to a themed gradient.">
        <TrackCoverField value={f.art} onChange={(v) => setF((p) => ({ ...p, art: v || "" }))} />
      </Field>
      <div style={{ display: "flex", gap: 12, marginTop: 8, justifyContent: "flex-end" }}>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={save} disabled={uploading}>Save track</Button>
      </div>
    </Modal>
  );
}

// One-time helper: moves this client's legacy media (base64 images / Supabase
// audio) into R2. Auto-hides once there's nothing left to move. Superadmin-only.
export function R2MigratePanel() {
  const state = useStore();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  if (!hasLegacyMedia(state)) return null;
  async function run() {
    setBusy(true); setDone(0);
    try {
      const { migrated, failed } = await migrateClientMediaToR2((n) => setDone(n));
      toast(failed ? `Moved ${migrated} file(s) to R2; ${failed} failed` : `Moved ${migrated} file(s) to R2`, failed ? "err" : undefined);
    } catch (e) {
      toast("Migration failed: " + (e && e.message || "error"), "err");
    } finally { setBusy(false); }
  }
  return (
    <div className="panel">
      <div className="panel__head"><div className="panel__title">Move existing media to R2</div></div>
      <div className="panel__body">
        <p style={{ color: "var(--muted)", fontSize: 14, margin: "0 0 14px" }}>
          This site still has media stored the old way (base64 images and/or Supabase audio). Move it into Cloudflare R2 — runs once and is safe to repeat.
        </p>
        <Button variant="primary" size="sm" disabled={busy} onClick={run}>{busy ? `Moving… (${done})` : "Move media to R2"}</Button>
      </div>
    </div>
  );
}

export function MusicAdmin() {
  const { playlist, clientId } = useStore();
  const { save: persistChanges } = React.useContext(AdminSaveCtx);
  const tracks = playlist || [];
  const fileRef = useRef(null);
  const queueRef = useRef([]);   // freshly-uploaded drafts waiting to be named
  const [uploading, setUploading] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false); // Upload new / Choose from library

  // Upload the file(s), then open the editor so the title/artist can be set
  // before the track is actually added — nothing is saved until "Save track".
  async function onFiles(files) {
    const list = [...(files || [])].filter(isAudioFile);
    if (!list.length) { toast("Please choose audio files.", "err"); if (fileRef.current) fileRef.current.value = ""; return; }
    setUploading(true);
    const drafts = [];
    try {
      for (const file of list) {
        const { url } = await uploadAudio(file, clientId);
        const title = (file.name || "").replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
        drafts.push({ url, title: title || "", artist: "" });   // draft (no id) — added on Save
      }
    } catch (e) {
      toast("Upload failed: " + (e.message || "error"), "err");
      setUploading(false); if (fileRef.current) fileRef.current.value = ""; return;
    }
    setUploading(false); if (fileRef.current) fileRef.current.value = "";
    queueRef.current = drafts.slice(1);   // name the rest one after another
    setEditing(drafts[0]);
    setEditOpen(true);
  }
  // After a draft is saved or cancelled, advance to the next uploaded draft.
  const closeEditor = () => {
    const q = queueRef.current;
    if (q.length) { queueRef.current = q.slice(1); setEditing(q[0]); }
    else { setEditOpen(false); setEditing(null); }
  };
  const editExisting = (t) => { queueRef.current = []; setEditing(t); setEditOpen(true); };
  const move = async (id, dir) => { Store.moveTrack(id, dir); await persistChanges(); };
  const del = async (t) => { if (await confirmDialog({ title: "Delete track?", message: `Remove "${t.title}" from the playlist?`, confirmLabel: "Delete", danger: true })) { Store.deleteTrack(t.id); await persistChanges(); } };

  return (
    <div className="panel">
      <div className="panel__head">
        <div className="panel__title">Music Playlist <span style={{ color: "var(--muted)", fontSize: 15 }}>({tracks.length})</span></div>
        <Button variant="primary" size="sm" disabled={uploading} onClick={() => setPickerOpen(true)}>{uploading ? "Uploading…" : "+ Add music"}</Button>
        <input ref={fileRef} type="file" accept={AUDIO_ACCEPT} multiple style={{ display: "none" }} onChange={(e) => onFiles(e.target.files)} />
      </div>
      <div className="panel__body--flush table-wrap">
        <table className="tbl">
          <thead><tr><th>#</th><th>Cover</th><th>Title</th><th>Artist</th><th>Preview</th><th></th></tr></thead>
          <tbody>
            {tracks.map((t, i) => (
              <tr key={t.id}>
                <td style={{ color: "var(--muted)" }}>{i + 1}</td>
                <td>
                  {t.art
                    ? (VIDEO_RE.test(t.art)
                        ? <video src={mediaUrl(t.art)} muted loop autoPlay playsInline className="music-cover" />
                        : <img src={mediaUrl(t.art)} alt="" className="music-cover" onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />)
                    : <span className="music-cover music-cover--empty" aria-hidden="true" />}
                </td>
                <td><strong>{t.title}</strong></td>
                <td style={{ color: "var(--ink-soft)" }}>{t.artist || "—"}</td>
                <td><audio src={mediaUrl(t.url)} controls preload="none" style={{ height: 34, maxWidth: 200 }} /></td>
                <td>
                  <div className="row-actions">
                    <button className="icon-btn" title="Move up" onClick={() => move(t.id, -1)} disabled={i === 0}>↑</button>
                    <button className="icon-btn" title="Move down" onClick={() => move(t.id, 1)} disabled={i === tracks.length - 1}>↓</button>
                    <button className="icon-btn" title="Edit title/artist" onClick={() => editExisting(t)}>{Icon.edit({})}</button>
                    <button className="icon-btn icon-btn--danger" title="Delete" onClick={() => del(t)}>{Icon.trash({})}</button>
                  </div>
                </td>
              </tr>
            ))}
            {tracks.length === 0 && <tr><td colSpan={6} style={{ color: "var(--muted)", textAlign: "center", padding: 40 }}>No tracks yet — upload audio files to build the playlist.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="panel__foot">
        <span className="panel__foot-hint">Upload a file, then set its title &amp; artist before saving. Plays as background music on the site (loops); browsers may require a tap before audio starts.</span>
      </div>
      <MediaPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        type="audio"
        clientId={clientId}
        uploading={uploading}
        uploadLabel="Choose audio file"
        onUploadNew={() => { setPickerOpen(false); fileRef.current && fileRef.current.click(); }}
        onPick={(key) => { setPickerOpen(false); queueRef.current = []; setEditing({ url: key, title: "", artist: "" }); setEditOpen(true); }}
      />
      <TrackEditor open={editOpen} track={editing} onClose={closeEditor} />
    </div>
  );
}

// --- Admin shell ------------------------------------------------------------
export const ADMIN_TABS = [
  { key: "dashboard", label: "Dashboard", icon: "grid" },
  { key: "home", label: "Home", icon: "home" },
  { key: "rsvps", label: "RSVPs", icon: "mail" },
  // Media/Gallery shelved for now — re-add when gallery ships (see DISABLED_MODULES).
  // { key: "media", label: "Media", icon: "camera" },
  { key: "guestbook", label: "Guestbook", icon: "book" },
  { key: "schedule", label: "Schedule", icon: "calendar" },
  { key: "quiz", label: "Quiz", icon: "quiz" },
  { key: "details", label: "Details", icon: "rings" },
  { key: "venue", label: "Venue & Map", icon: "pin" },
  { key: "settings", label: "Settings", icon: "gear" },
];

// Admin notification bell — flags new RSVPs, quiz plays, and guestbook messages
// since the operator last opened it. "Seen" is a timestamp kept in localStorage
// per client; opening the panel marks everything up to now as seen.
function timeAgo(ts) {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60); if (m < 60) return m + "m ago";
  const h = Math.floor(m / 60); if (h < 24) return h + "h ago";
  const d = Math.floor(h / 24); if (d < 7) return d + "d ago";
  return fmtDate(ts);
}
function initialsOf(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return ((parts[0][0] || "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}
function NotificationBell({ goTab }) {
  const { rsvps, guestbook, quizSubs, clientId, settings } = useStore();
  const [open, setOpen] = useState(false);
  const key = "evermore_notif_seen_" + (clientId || "x");
  const [seen, setSeen] = useState(() => { try { return Number(localStorage.getItem(key) || 0); } catch (_) { return 0; } });
  // "Clear" empties the box without touching any data: entries at/before the
  // cleared timestamp are hidden from the list (per client, persisted), and
  // anything that arrives afterwards shows up as usual.
  const clearKey = "evermore_notif_cleared_" + (clientId || "x");
  const [clearedAt, setClearedAt] = useState(() => { try { return Number(localStorage.getItem(clearKey) || 0); } catch (_) { return 0; } });

  const gbOn = moduleEnabled(settings.modules, "guestbook");
  const quizOn = moduleEnabled(settings.modules, "quiz");
  const items = useMemo(() => {
    const a = [];
    const stLabel = { attending: "is attending", maybe: "replied maybe", not_attending: "can't make it" };
    (rsvps || []).forEach((r) => a.push({ id: "r" + r.id, tab: "rsvps", icon: "mail", who: r.fullName || "Someone", text: stLabel[r.status] || "RSVP'd", at: r.createdAt || 0 }));
    if (gbOn) (guestbook || []).forEach((g) => a.push({ id: "g" + g.id, tab: "guestbook", icon: "book", who: g.name || "Someone", text: "signed the guestbook", at: g.createdAt || 0 }));
    if (quizOn) (quizSubs || []).forEach((q) => a.push({ id: "q" + q.id, tab: "quiz", icon: "quiz", who: q.name || "Someone", text: `took the quiz (${q.score}/${q.total})`, at: q.createdAt || 0 }));
    return a.filter((x) => x.at > clearedAt).sort((x, y) => y.at - x.at);
  }, [rsvps, guestbook, quizSubs, gbOn, quizOn, clearedAt]);

  const clearAll = () => {
    const now = Date.now();
    try { localStorage.setItem(clearKey, String(now)); localStorage.setItem(key, String(now)); } catch (_) {}
    setClearedAt(now);
    setSeen(now);
  };

  const unseen = items.filter((i) => i.at > seen).length;
  // opening the panel marks everything up to now as seen
  useEffect(() => {
    if (!open) return;
    const now = Date.now();
    try { localStorage.setItem(key, String(now)); } catch (_) {}
    setSeen(now);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="notif">
      <button type="button" className="notif__btn notif__btn--plain" aria-label={`Notifications${unseen ? ` (${unseen} new)` : ""}`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {Icon.bell({ style: { width: 18, height: 18 } })}
        {unseen > 0 && <span className="notif__badge">{unseen > 9 ? "9+" : unseen}</span>}
      </button>
      {open && (
        <>
          <div className="notif__backdrop" onClick={() => setOpen(false)} />
          <div className="notif__panel" role="dialog" aria-label="Notifications">
            <div className="notif__head">
              {Icon.bell({ style: { width: 15, height: 15 } })} Notifications{unseen > 0 ? ` · ${unseen} new` : ""}
              {items.length > 0 && (
                <button type="button" className="notif__clear" onClick={clearAll}>Clear</button>
              )}
            </div>
            <div className="notif__list">
              {items.length === 0 ? (
                <div className="notif__empty">{clearedAt > 0 ? "You're all caught up." : "No activity yet."}</div>
              ) : items.slice(0, 20).map((it, i) => (
                <button key={it.id} type="button" className={"notif__item" + (i < unseen ? " is-new" : "")}
                  onClick={() => { goTab(it.tab); setOpen(false); }}>
                  <span className={"notif__ava notif__ava--" + (["a", "b", "c", "d"][(it.who.charCodeAt(0) || 0) % 4])}>{initialsOf(it.who)}</span>
                  <span className="notif__body">
                    <span className="notif__line"><strong>{it.who}</strong> {it.text}</span>
                    <span className="notif__time">{timeAgo(it.at)}</span>
                  </span>
                </button>
              ))}
            </div>
            {items.length > 0 && (
              <button type="button" className="notif__footer" onClick={() => { goTab("rsvps"); setOpen(false); }}>View all RSVPs →</button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// Account menu in the admin topbar — click the avatar for the signed-in email
// and a Sign out action.
function ProfileMenu({ name, email, onViewSite, onSignOut }) {
  const [open, setOpen] = useState(false);
  // Adminator-style filled avatar: initials from the account email's local part
  // ("jane.doe@x" -> JD; "jeremydevera03@x" -> JE).
  const initials = (() => {
    const local = String(email || "").split("@")[0].replace(/[0-9]+/g, "");
    const parts = local.split(/[._-]+/).filter(Boolean);
    const s = parts.length > 1 ? parts[0][0] + parts[1][0] : local.slice(0, 2);
    return (s || "?").toUpperCase();
  })();
  // Adminator logout glyph (door + arrow), red row.
  const logoutIcon = (
    <svg viewBox="0 0 24 24" fill="none" style={{ width: 18, height: 18 }}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
  return (
    <div className="notif">
      <button type="button" className="notif__avatar" aria-label="Account" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {initials}
      </button>
      {open && (
        <>
          <div className="notif__backdrop" onClick={() => setOpen(false)} />
          <div className="notif__panel notif__panel--menu dd-profile" role="menu">
            <div className="dd-profile__head">
              {name && <div className="dd-profile__name">{name}</div>}
              {email && <div className="dd-profile__email">{email}</div>}
            </div>
            <button type="button" className="dd-profile__item" role="menuitem" onClick={() => { setOpen(false); onViewSite(); }}>
              {Icon.home({ style: { width: 18, height: 18 } })}
              View website
            </button>
            <div className="dd-profile__divider" />
            <button type="button" className="dd-profile__item dd-profile__item--danger" role="menuitem" onClick={() => { setOpen(false); onSignOut(); }}>
              {logoutIcon}
              Logout
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function AdminApp() {
  const { settings, auth, clientId } = useStore();
  const [tab, setTab] = useState("dashboard");
  const [menuOpen, setMenuOpen] = useState(false);   // mobile drawer
  const [saving, setSaving] = useState(false);
  // Dirty tracking: Save stays disabled until the editable state diverges from
  // what's saved — mirrors the Supabase settings Save button.
  const snapshot = () => { try { return JSON.stringify(stateToClientRow(Store.get())); } catch (e) { return ""; } };
  const savedRef = useRef(null);
  useEffect(() => { savedRef.current = snapshot(); }, []);   // baseline once client data is loaded
  const dirty = savedRef.current != null && snapshot() !== savedRef.current;
  const saveChanges = async () => {
    setSaving(true);
    try { await saveClientData(); savedRef.current = snapshot(); toast("Changes saved", "success"); }
    catch (e) { toast("Save failed: " + (e.message || "error")); }
    finally { setSaving(false); }
  };

  // Wrap any async server op (RSVP/guestbook delete, guestbook status change) so
  // the same blocking overlay shows while it's in flight — matters on slow links.
  const runSaving = async (fn) => {
    setSaving(true);
    try { return await fn(); }
    finally { setSaving(false); }
  };

  // While a save/add/reorder/delete is in flight (`saving`), lock page scroll so
  // the operator can't scroll or interact until it finishes — a blocking overlay
  // (rendered below) covers the screen, then the "Changes saved" toast appears.
  useEffect(() => {
    if (!saving) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [saving]);

  // Owner (or superadmin managing a client) — load that client's submissions from
  // the DB so RSVPs / guestbook / quiz show up, not just this session's echoes.
  // Then keep them live: a Realtime channel pushes new guest activity into the
  // store as it lands (bell badge/tiles update with no refresh). Cleanup drops
  // the channel on sign-out / client switch.
  useEffect(() => {
    if (!auth.ready || !auth.session || !clientId) return;
    // owner manages their own client; superadmin manages whatever client site they're on
    if (auth.role === "owner" || auth.role === "superadmin") {
      loadAdminData();
      return subscribeAdminRealtime();
    }
  }, [auth.ready, auth.session, auth.role, clientId]);

  if (!auth.ready) return <div style={{ position: "fixed", inset: 0, background: "#ffffff", color: "#6b7280", display: "grid", placeItems: "center" }}>…</div>;
  // AdminLogin renders its own full-screen dark sign-in (theme-independent).
  if (!auth.session) return <AdminLogin onAuthed={() => setTab("dashboard")} />;
  const profile = { role: auth.role, clientId: auth.clientId };
  if (!canEnterAdmin(profile, clientId)) {
    return (
      <div className="card card--pad-lg" style={{ maxWidth: 420, margin: "10vh auto", textAlign: "center" }}>
        <h2>No access</h2>
        <p style={{ color: "var(--ink-soft)" }}>This account can't manage this site.</p>
        <Button variant="ghost" onClick={() => signOut()}>Sign out</Button>
      </div>
    );
  }
  // Superadmin on a client site manages that client's full admin (Dashboard, Settings,
  // RSVPs, …) AND keeps the platform console (Overview / Clients) in the same sidebar.
  // Owners only ever see their own client's tabs.
  let tabs;
  if (auth.role === "superadmin") {
    // On a client subdomain (clientId set) → that client's full admin ONLY — it's their
    // website. On the apex hub (no client) → the platform console (Overview / Clients).
    tabs = clientId ? tabsForClient(ADMIN_TABS, "owner", settings.modules) : visibleAdminTabs("superadmin", ADMIN_TABS);
  } else {
    tabs = tabsForClient(visibleAdminTabs(auth.role, ADMIN_TABS, settings.ownerEdit), auth.role, settings.modules);
  }
  const activeTab = tabs.some((t) => t.key === tab) ? tab : (tabs[0]?.key || "dashboard");
  const title = (tabs.find((t) => t.key === activeTab) || { label: "Admin" }).label;
  const onPlatformTab = activeTab === "overview" || activeTab === "clients";

  const canArrange = settings.arrangeEnabled && isPremiumTheme(settings.theme);
  const startArrange = () => { try { sessionStorage.setItem("arrangeStart", "1"); } catch (e) {} go("home"); };

  const isSuper = auth.role === "superadmin";
  // Superadmin "Open admin" enters a client via the ?client= override (on the apex
  // hub). That override is sticky (go() preserves the query), so without an escape
  // the superadmin gets trapped in the client and loses the platform console — even
  // after signing out. exitToConsole drops the override with a clean reload.
  const clientOverride = new URLSearchParams(window.location.search).get("client");
  const exitToConsole = () => window.location.assign("/");
  return (
    // Always the neutral console skin — the admin never inherits the client's
    // wedding theme, whether a superadmin or the couple (owner) is signed in.
    <div className="admin admin--sa">
      {saving && (
        <div className="admin-saving" role="status" aria-live="polite" aria-label="Saving">
          <div className="admin-saving__box"><span className="admin-saving__spin" aria-hidden="true" />Saving…</div>
        </div>
      )}
      {menuOpen && <div className="admin__overlay" onClick={() => setMenuOpen(false)} />}
      <aside className={"admin__side" + (menuOpen ? " admin__side--open" : "")}>
        <button className="admin__drawer-close" onClick={() => setMenuOpen(false)} aria-label="Close menu">{Icon.close({})}</button>
        <div className="admin__brand">
          {isSuper ? (
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Logo size={26} />
              <div><div className="admin__brand-name">{BRAND_NAME}</div><div style={{ fontSize: 11, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--muted)" }}>Superadmin</div></div>
            </div>
          ) : (
            <>
              <Monogram a={settings.partnerA} b={settings.partnerB} size={38} />
              <div><div className="admin__brand-name">{settings.partnerA} & {settings.partnerB}</div><div style={{ fontSize: 11, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--muted)" }}>Admin</div></div>
            </>
          )}
        </div>
        <nav className="admin__nav">
          {tabs.map((t) => (
            <button key={t.key} className={"admin__navlink" + (activeTab === t.key ? " admin__navlink--active" : "")} onClick={() => { setTab(t.key); setMenuOpen(false); }}>
              {Icon[t.icon]({})} {t.label}
            </button>
          ))}
        </nav>
        {isSuper && clientOverride && (
          <button className="admin__navlink" onClick={exitToConsole}>{Icon.arrow({ style: { transform: "rotate(180deg)" } })} Back to clients</button>
        )}
        {canArrange && (
          <button className="admin__navlink" onClick={startArrange} style={{ color: "#7a5b12", fontWeight: 700 }}>
            {Icon.grid({ style: { width: 16, height: 16 } })} Arrange Now
          </button>
        )}
      </aside>

      <main className="admin__main">
        <div className="admin__head">
        <div className="admin__topbar">
          <div className="admin__topbar-left">
            <button type="button" className="admin__burger" onClick={() => setMenuOpen((o) => !o)} aria-label="Menu" aria-expanded={menuOpen}>{Icon.menu({})}</button>
            <div className="admin__title">{title}</div>
          </div>
          <div className="admin__topbar-right">
            {clientId && <NotificationBell goTab={setTab} />}
            <ProfileMenu name={auth.role === "superadmin" ? "Superadmin" : [settings.partnerA, settings.partnerB].filter(Boolean).join(" & ") || "Owner"} email={auth.email} onViewSite={() => go("home")} onSignOut={() => signOut().then(() => { if (clientOverride) exitToConsole(); else go("home"); })} />
          </div>
        </div>
        </div>
        <div className="admin__body">
          {/* First-login setup wizard for self-registered owners (self-signup
              seeds onboarded:false; finishing or skipping flips it true). */}
          {auth.role === "owner" && clientId && settings.onboarded === false && <SetupWizard />}
          <AdminSaveCtx.Provider value={{ saving, dirty, save: saveChanges, run: runSaving }}>
          {activeTab === "dashboard" && <AdminDashboard goTab={setTab} />}
          {activeTab === "home" && <HomeAdmin />}
          {/* One RSVPs tab that adapts: strict = the guest-list view, open = the
              classic replies table. */}
          {activeTab === "rsvps" && (settings.strictRsvp ? <GuestsAdmin /> : <RsvpsAdmin />)}
          {activeTab === "media" && <MediaAdmin />}
          {activeTab === "guestbook" && <GuestbookAdmin />}
          {activeTab === "schedule" && <ScheduleAdmin />}
          {activeTab === "quiz" && <QuizAdmin />}
          {activeTab === "details" && <DetailsAdmin />}
          {activeTab === "venue" && <VenueAdmin />}
          {activeTab === "qr" && <QrAdmin />}
          {activeTab === "settings" && <SettingsAdmin />}
          {activeTab === "overview" && <SuperOverview />}
          {activeTab === "clients" && <ClientsAdmin />}
          {activeTab === "r2media" && !clientId && <R2LibraryAdmin />}
          </AdminSaveCtx.Provider>
          {/* Footer: a clear end-of-content marker at the bottom of the scroll. */}
          <footer className="admin__footer">
            © {new Date().getFullYear()} {BRAND_NAME} · <a href="https://celebrately.us" target="_blank" rel="noreferrer">celebrately.us</a>
          </footer>
        </div>
      </main>
    </div>
  );
}

