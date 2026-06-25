import React from "react";
import { go } from "@/lib/nav.js";
import { Store, useStore } from "@/lib/store.jsx";
import { EG_TINTS, THEMES, THEME_FONTS, egTintGradient, isPremiumTheme } from "@/themes";
import { Button, CropModal, DecorPreview, Field, Icon, Input, Modal, Monogram, Placeholder, SectionHead, Select, Textarea, confirmDialog, mapEmbedUrl, mapSearchUrl, toast } from "@/ui/components.jsx";
import { Home } from "@/pages/PublicPages.jsx";
import { AdminDashboard, AdminLogin, Logo, QRCanvas, downloadCSV, downloadQR, fmtDate } from "@/admin/core.jsx";
import { signOut } from "@/lib/auth.js";
import { loadAdminData, saveClientData, setGuestbookStatusDb, deleteGuestbookDb, deleteRsvpDb } from "@/lib/api.js";
import { stateToClientRow } from "@/lib/mappers.js";
import { BRAND_NAME } from "@/config/site.js";
import { visibleAdminTabs, canEnterAdmin, tabsForClient, DISABLED_MODULES, moduleLabel } from "@/lib/roles.js";
import { ClientsAdmin, SuperOverview } from "@/admin/superadmin.jsx";
import { LocationPicker } from "@/ui/location-picker.jsx";
import { DEFAULT_EVENT_TYPE, themesForEvent } from "@/config/eventTypes.js";
const { useState, useEffect, useRef, useMemo, useCallback, useReducer } = React;

// Save state shared from the AdminApp shell down to each section's footer, so the
// Save button can live INSIDE the section card being edited (Supabase pattern).
const AdminSaveCtx = React.createContext({ saving: false, dirty: false, save: () => {} });
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
export function ImageUploadField({ value, onChange, label, ratio = "4 / 3", framePreview, defaultPreview, tintStrength, tintGradient }) {
  const ref = useRef(null);
  const [cropSrc, setCropSrc] = useState(null);
  const aspect = (() => { const m = String(ratio).split("/").map((n) => parseFloat(n)); return (m.length === 2 && m[1]) ? m[0] / m[1] : 1; })();
  function pick(file) {
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast("Please choose an image file.", "err"); return; }
    setCropSrc(URL.createObjectURL(file));
  }
  return (
    <div className="field">
      {label && <span className="field__label">{label}</span>}
      <div className="imgup">
        <div className="imgup__thumb" style={{ aspectRatio: ratio }}>
          {value
            ? <img src={value} alt="" />
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
          <Button variant="ghost" size="sm" onClick={() => ref.current && ref.current.click()}>{Icon.upload({})} {value ? "Replace" : "Upload"}</Button>
          {value && <Button variant="ghost" size="sm" onClick={() => setCropSrc(value)}>{Icon.crop({})} Crop</Button>}
          {value && <Button variant="ghost" size="sm" onClick={() => onChange("")}>Remove</Button>}
        </div>
        <input ref={ref} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => pick(e.target.files[0])} />
      </div>
      <CropModal open={!!cropSrc} src={cropSrc} aspect={aspect} frameSrc={framePreview} onCancel={() => setCropSrc(null)} onApply={(d) => { onChange(d); setCropSrc(null); }} />
    </div>
  );
}

// Add / edit a quiz question
export function QuestionEditor({ open, question, onClose }) {
  const blank = { type: "multiple_choice", q: "", options: ["", "", "", ""], answer: 0 };
  const [f, setF] = useState(blank);
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

  function save() {
    if (!f.q.trim()) { toast("Please enter the question.", "err"); return; }
    const cleanOpts = (isTF ? ["True", "False"] : f.options.map((o) => o.trim())).filter((o, i) => isTF || o);
    if (cleanOpts.length < 2) { toast("Please provide at least two answer options.", "err"); return; }
    let answer = f.answer;
    if (answer >= cleanOpts.length) answer = 0;
    const payload = { type: f.type, q: f.q.trim(), options: cleanOpts, answer };
    if (question) Store.updateQuizQuestion(question.id, payload);
    else Store.addQuizQuestion(payload);
    toast(question ? "Question updated" : "Question added");
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

export function RsvpsAdmin() {
  const { rsvps } = useStore();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const [detail, setDetail] = useState(null);

  const filtered = rsvps.filter((r) => {
    if (filter !== "all" && r.status !== filter) return false;
    if (q) {
      const hay = `${r.fullName} ${r.email} ${r.phone}`.toLowerCase();
      if (!hay.includes(q.toLowerCase())) return false;
    }
    return true;
  });

  function exportCsv() {
    const header = ["Full Name", "Email", "Phone", "Status", "Guests", "Plus-One Names", "Dietary", "Dietary Notes", "Song Request", "Notes", "Submitted"];
    const rows = [header, ...rsvps.map((r) => [r.fullName, r.email, r.phone, r.status, r.count, r.plusOne, r.diet, r.dietNotes, r.song, r.notes, fmtDate(r.createdAt)])];
    downloadCSV("evermore-rsvps.csv", rows);
  }

  return (
    <div>
      <div className="panel">
        <div className="panel__head">
          <div className="panel__title">RSVPs <span style={{ color: "var(--muted)", fontSize: 15 }}>({filtered.length})</span></div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <div className="search-box">{Icon.search({})}<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email, phone" /></div>
            <div className="seg">
              {[["all", "All"], ["attending", "Yes"], ["maybe", "Maybe"], ["not_attending", "No"]].map(([v, l]) => (
                <button key={v} className={filter === v ? "on" : ""} onClick={() => setFilter(v)}>{l}</button>
              ))}
            </div>
            <Button variant="primary" size="sm" onClick={exportCsv}>{Icon.download({})} Export CSV</Button>
          </div>
        </div>
        <div className="panel__body--flush table-wrap">
          <table className="tbl">
            <thead><tr><th>Name</th><th>Contact</th><th>Status</th><th>Guests</th><th>Dietary</th><th>Submitted</th><th></th></tr></thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td><strong>{r.fullName}</strong>{r.plusOne && <div style={{ fontSize: 13, color: "var(--muted)" }}>+ {r.plusOne}</div>}</td>
                  <td><div>{r.email}</div>{r.phone && <div style={{ fontSize: 13, color: "var(--muted)" }}>{r.phone}</div>}</td>
                  <td><span className={"tag tag--" + r.status}>{r.status.replace("_", " ")}</span></td>
                  <td>{r.count}</td>
                  <td>{r.diet === "None" ? <span style={{ color: "var(--muted)" }}>—</span> : r.diet}</td>
                  <td style={{ color: "var(--muted)", whiteSpace: "nowrap" }}>{fmtDate(r.createdAt)}</td>
                  <td>
                    <div className="row-actions">
                      <button className="icon-btn" onClick={() => setDetail(r)} aria-label="View">{Icon.eye({})}</button>
                      <button className="icon-btn icon-btn--danger" onClick={() => confirmDialog({ title: "Delete RSVP?", message: `Remove the RSVP from ${r.fullName}? This can't be undone.`, confirmLabel: "Delete", danger: true }).then((ok) => { if (ok) { Store.deleteRSVP(r.id); deleteRsvpDb(r.id).catch(() => toast("Couldn't delete on the server")); } })} aria-label="Delete">{Icon.trash({})}</button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && <tr><td colSpan={7} style={{ color: "var(--muted)", textAlign: "center", padding: 40 }}>No matching RSVPs.</td></tr>}
            </tbody>
          </table>
        </div>
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
  const [q, setQ] = useState("");
  const [view, setView] = useState("published");
  // Moderation on = guest messages wait for approval (auto-approve turned off).
  const moderation = settings?.autoApproveGuestbook === false;

  const bySearch = guestbook.filter((g) => !q || g.name.toLowerCase().includes(q.toLowerCase()));
  const pendingCount = bySearch.filter((g) => g.status === "pending").length;
  const publishedCount = bySearch.length - pendingCount;
  // With moderation: split into Published (visible/hidden) vs Pending approval.
  const filtered = !moderation ? bySearch
    : bySearch.filter((g) => view === "pending" ? g.status === "pending" : g.status !== "pending");

  function exportCsv() {
    const rows = [["Guest Name", "Message", "Relationship", "Status", "Submitted"],
      ...guestbook.map((g) => [g.name, g.message, g.relationship, g.status, fmtDate(g.createdAt)])];
    downloadCSV("evermore-guestbook.csv", rows);
  }

  return (
    <div className="panel">
      <div className="panel__head">
        <div className="panel__title">Guestbook <span style={{ color: "var(--muted)", fontSize: 15 }}>({filtered.length})</span></div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {moderation && (
            <div className="seg">
              <button className={view === "published" ? "on" : ""} onClick={() => setView("published")}>Published ({publishedCount})</button>
              <button className={view === "pending" ? "on" : ""} onClick={() => setView("pending")}>Pending approval ({pendingCount})</button>
            </div>
          )}
          <div className="search-box">{Icon.search({})}<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name" /></div>
          <Button variant="primary" size="sm" onClick={exportCsv}>{Icon.download({})} Export</Button>
        </div>
      </div>
      <div className="panel__body--flush table-wrap">
        <table className="tbl">
          <thead><tr><th>Guest</th><th>Message</th><th>Status</th><th>Date</th><th></th></tr></thead>
          <tbody>
            {filtered.map((g) => (
              <tr key={g.id} style={{ opacity: g.status === "hidden" ? 0.5 : 1 }}>
                <td><strong>{g.name}</strong>{g.relationship && <div style={{ fontSize: 13, color: "var(--muted)" }}>{g.relationship}</div>}</td>
                <td style={{ maxWidth: 420 }}>{g.message}</td>
                <td><span className={"tag tag--" + g.status}>{g.status}</span></td>
                <td style={{ color: "var(--muted)", whiteSpace: "nowrap" }}>{fmtDate(g.createdAt)}</td>
                <td>
                  <div className="row-actions">
                    {g.status === "visible"
                      ? <button className="icon-btn" title="Hide" onClick={() => { Store.setGuestbookStatus(g.id, "hidden"); setGuestbookStatusDb(g.id, "hidden").catch(() => toast("Couldn't update on the server")); }}>{Icon.eyeOff({})}</button>
                      : <button className="icon-btn" title={g.status === "pending" ? "Approve" : "Show"} onClick={() => { Store.setGuestbookStatus(g.id, "visible"); setGuestbookStatusDb(g.id, "visible").catch(() => toast("Couldn't update on the server")); }}>{g.status === "pending" ? Icon.check({}) : Icon.eye({})}</button>}
                    <button className="icon-btn icon-btn--danger" title="Delete" onClick={() => confirmDialog({ title: "Delete message?", message: "This permanently removes the guestbook entry.", confirmLabel: "Delete", danger: true }).then((ok) => { if (ok) { Store.deleteGuestbook(g.id); deleteGuestbookDb(g.id).catch(() => toast("Couldn't delete on the server")); } })}>{Icon.trash({})}</button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={5} style={{ color: "var(--muted)", textAlign: "center", padding: 40 }}>{moderation && view === "pending" ? "Nothing awaiting approval." : "No messages."}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function QuizAdmin() {
  const { quizSubs, quiz } = useStore();
  const [open, setOpen] = useState(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const sorted = [...quizSubs].sort((a, b) => b.score - a.score);
  const openNew = () => { setEditing(null); setEditorOpen(true); };
  const openEdit = (q) => { setEditing(q); setEditorOpen(true); };
  const [tab, setTab] = useState("leaderboard");
  const [moved, setMoved] = useState(null);
  const doMove = (id, dir) => { setMoved({ id, dir }); Store.moveQuizQuestion(id, dir); setTimeout(() => setMoved(null), 480); };
  return (
    <div>
      <div className="folders">
        <button className={"folder" + (tab === "leaderboard" ? " folder--active" : "")} onClick={() => setTab("leaderboard")}>{Icon.grid({})} Leaderboard</button>
        <button className={"folder" + (tab === "questions" ? " folder--active" : "")} onClick={() => setTab("questions")}>{Icon.quiz({})} Questions</button>
      </div>

      {tab === "questions" && (
      <div className="panel">
        <div className="panel__head">
          <div className="panel__title">Quiz Questions <span style={{ color: "var(--muted)", fontSize: 15 }}>({quiz.length})</span></div>
          <Button variant="primary" size="sm" onClick={openNew}>+ Add question</Button>
        </div>
        <div className="panel__body--flush table-wrap">
          <table className="tbl">
            <thead><tr><th>#</th><th>Question</th><th>Type</th><th>Correct answer</th><th></th></tr></thead>
            <tbody>
              {quiz.map((q, i) => (
                <tr key={q.id} className={moved && moved.id === q.id ? "q-row--moved q-row--moved-" + (moved.dir < 0 ? "up" : "down") : ""}>
                  <td style={{ fontFamily: "var(--font-display)", fontSize: 18, color: "var(--muted)" }}>{i + 1}</td>
                  <td style={{ maxWidth: 360 }}><strong>{q.q}</strong></td>
                  <td><span style={{ color: "var(--muted)" }}>{q.type === "true_false" ? "True / False" : "Multiple choice"}</span></td>
                  <td>{q.options ? q.options[q.answer] : ""}</td>
                  <td>
                    <div className="row-actions">
                      <button className="icon-btn" title="Move up" onClick={() => doMove(q.id, -1)} disabled={i === 0}>↑</button>
                      <button className="icon-btn" title="Move down" onClick={() => doMove(q.id, 1)} disabled={i === quiz.length - 1}>↓</button>
                      <button className="icon-btn" title="Edit question" onClick={() => openEdit(q)}>{Icon.edit({})}</button>
                      <button className="icon-btn icon-btn--danger" title="Delete" onClick={() => confirmDialog({ title: "Delete question?", message: "This removes the question from the quiz.", confirmLabel: "Delete", danger: true }).then((ok) => { if (ok) Store.deleteQuizQuestion(q.id); })}>{Icon.trash({})}</button>
                    </div>
                  </td>
                </tr>
              ))}
              {quiz.length === 0 && <tr><td colSpan={5} style={{ color: "var(--muted)", textAlign: "center", padding: 40 }}>No questions yet. Add one to get started.</td></tr>}
            </tbody>
          </table>
        </div>
        <SaveFooter />
      </div>
      )}

      {tab === "leaderboard" && (
      <div className="panel">
        <div className="panel__head"><div className="panel__title">Quiz Leaderboard <span style={{ color: "var(--muted)", fontSize: 15 }}>({quizSubs.length} plays)</span></div></div>
        <div className="panel__body--flush table-wrap">
          <table className="tbl">
            <thead><tr><th>#</th><th>Guest</th><th>Score</th><th>Played</th><th></th></tr></thead>
            <tbody>
              {sorted.map((s, i) => (
                <tr key={s.id}>
                  <td style={{ fontFamily: "var(--font-display)", fontSize: 20, color: i < 3 ? "var(--accent)" : "var(--muted)" }}>{i + 1}</td>
                  <td><strong>{s.name}</strong></td>
                  <td><strong>{s.score}</strong> / {s.total}</td>
                  <td style={{ color: "var(--muted)" }}>{fmtDate(s.createdAt)}</td>
                  <td><button className="icon-btn" onClick={() => setOpen(s)}>{Icon.eye({})}</button></td>
                </tr>
              ))}
              {quizSubs.length === 0 && <tr><td colSpan={5} style={{ color: "var(--muted)", textAlign: "center", padding: 40 }}>No one has played yet.</td></tr>}
            </tbody>
          </table>
        </div>
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
                  <span style={{ color: a.isCorrect ? "oklch(0.55 0.13 150)" : "oklch(0.55 0.16 25)" }}>{a.isCorrect ? Icon.check({ style: { width: 18 } }) : Icon.close({ style: { width: 18 } })}</span>
                  <div><div style={{ fontWeight: 600 }}>{qq.q}</div><div style={{ fontSize: 14, color: "var(--ink-soft)" }}>{qq.options ? qq.options[a.selected] : ""}</div></div>
                </div>
              );
            })}
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

export function AdminToggle({ checked, onChange, label, desc }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "13px 0", borderBottom: "1px solid var(--line)" }}>
      <div><div style={{ fontWeight: 600 }}>{label}</div>{desc && <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 2 }}>{desc}</div>}</div>
      <button type="button" onClick={() => onChange(!checked)} aria-pressed={checked} style={{ position: "relative", width: 46, height: 26, borderRadius: 100, border: "none", cursor: "pointer", background: checked ? "var(--accent)" : "var(--line)", transition: "background .2s", flex: "none" }}>
        <span style={{ position: "absolute", top: 3, left: checked ? 23 : 3, width: 20, height: 20, borderRadius: "50%", background: "#fff", transition: "left .2s", boxShadow: "0 1px 3px rgba(0,0,0,.3)" }} />
      </button>
    </div>
  );
}

export function ScheduleAdmin() {
  const { schedule } = useStore();
  const addItem = () => {
    Store.updateSchedule([...schedule, { time: "", title: "New moment", desc: "", loc: "" }]);
    setTimeout(() => {
      const rows = document.querySelectorAll(".sched-edit__row");
      const last = rows[rows.length - 1];
      if (last) { const r = last.getBoundingClientRect(); window.scrollBy({ top: r.top - 150, behavior: "smooth" }); }
    }, 90);
  };
  return (
      <div className="panel">
      <div className="panel__head">
        <div className="panel__title">Wedding Day Schedule <span style={{ color: "var(--muted)", fontSize: 15 }}>({schedule.length})</span></div>
        <Button variant="primary" size="sm" onClick={addItem}>+ Add item</Button>
      </div>
      <div className="panel__body">
        <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 0, marginBottom: 22 }}>Build your day as a timeline — edit times and details inline, reorder with the arrows. Click <strong>Save changes</strong> to publish to your live site.</p>
        {schedule.length === 0 && <p style={{ color: "var(--muted)", textAlign: "center", padding: "30px 0" }}>No schedule items yet — add your first moment below.</p>}
        <div className="sched-edit">
          {schedule.map((item, i) => (
            <div key={i} className="sched-edit__row">
              <div className="sched-edit__rail"><span className="sched-edit__dot">{i + 1}</span></div>
              <div className="sched-edit__card">
                <div className="sched-edit__top">
                  <input className="sched-edit__time" value={item.time} onChange={(e) => Store.updateScheduleItem(i, { time: e.target.value })} placeholder="3:00 PM" aria-label="Time" />
                  <div className="row-actions">
                    <button className="icon-btn" title="Move up" onClick={() => Store.moveSchedule(i, -1)} disabled={i === 0}>↑</button>
                    <button className="icon-btn" title="Move down" onClick={() => Store.moveSchedule(i, 1)} disabled={i === schedule.length - 1}>↓</button>
                    <button className="icon-btn icon-btn--danger" title="Delete" onClick={() => confirmDialog({ title: "Delete schedule item?", message: "This removes it from the wedding-day timeline.", confirmLabel: "Delete", danger: true }).then((ok) => { if (ok) Store.updateSchedule(schedule.filter((_, j) => j !== i)); })}>{Icon.trash({})}</button>
                  </div>
                </div>
                <input className="sched-edit__title" value={item.title} onChange={(e) => Store.updateScheduleItem(i, { title: e.target.value })} placeholder="Title — e.g. Ceremony" aria-label="Title" />
                <Textarea value={item.desc} onChange={(e) => Store.updateScheduleItem(i, { desc: e.target.value })} style={{ minHeight: 52 }} placeholder="A short description guests will see" />
                <div style={{ marginTop: 10 }}>
                  <Input value={item.loc || ""} onChange={(e) => Store.updateScheduleItem(i, { loc: e.target.value })} placeholder="Location (optional)" />
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="sched-add"><Button variant="ghost" block onClick={addItem}>+ Add another moment</Button></div>
      </div>
      <SaveFooter />
    </div>
  );
}

export function SettingsAdmin() {
  const { settings, story } = useStore();
  const f = settings;
  const set = (k) => (e) => Store.updateSettings({ [k]: e.target && e.target.type === "checkbox" ? e.target.checked : e.target.value });
  const setKey = (k, v) => Store.updateSettings({ [k]: v });
  const [tab, setTab] = useState("general");
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
  const STABS = [["general", "General", "user"], ["features", "Features", "check"], ["appearance", "Theme", "grid"], ["venue", "Venue & Map", "pin"], ["photos", "Photos", "camera"], ["access", "Access", "check"]];

  return (
    <div>
      <div className="folders folders--sticky">
        {STABS.map(([k, l, ic]) => (
          <button key={k} className={"folder" + (tab === k ? " folder--active" : "")} onClick={() => setTab(k)}>{Icon[ic]({})} {l}</button>
        ))}
      </div>

      {tab === "general" && (<div className="panel">
        <div className="panel__head"><div className="panel__title">Couple & Event</div></div>
        <div className="panel__body">
          <div className="field-row field-row--2">
            <Field label="Partner A" id="s-a"><Input id="s-a" value={f.partnerA} onChange={set("partnerA")} /></Field>
            <Field label="Partner B" id="s-b"><Input id="s-b" value={f.partnerB} onChange={set("partnerB")} /></Field>
          </div>
          <div className="field-row field-row--2">
            <Field label="Wedding date & time" hint="Drives the countdown" id="s-date"><Input id="s-date" type="datetime-local" value={f.weddingDate} onChange={set("weddingDate")} /></Field>
            <Field label="Display date label" id="s-datel"><Input id="s-datel" value={f.weddingDateLabel} onChange={set("weddingDateLabel")} /></Field>
          </div>
          <Field label="Welcome message" id="s-welcome"><Textarea id="s-welcome" value={f.welcome} onChange={set("welcome")} /></Field>
          <div className="field-row field-row--2">
            <Field label="RSVP deadline" id="s-rsvp"><Input id="s-rsvp" value={f.rsvpDeadline} onChange={set("rsvpDeadline")} /></Field>
            <Field label="Hashtag" id="s-hash"><Input id="s-hash" value={f.hashtag} onChange={set("hashtag")} /></Field>
          </div>
        </div>
        <SaveFooter />
      </div>)}

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

      {tab === "venue" && (<div className="panel">
        <div className="panel__head"><div className="panel__title">Venue</div></div>
        <div className="panel__body">
          <Field label="Venue name" id="s-vn"><Input id="s-vn" value={f.venueName} onChange={set("venueName")} /></Field>
          <Field label="Venue address" id="s-va"><Input id="s-va" value={f.venueAddress} onChange={set("venueAddress")} /></Field>
          <Field label="Map location" hint="Type to search a place or address, then click the map or drag the pin to the exact spot. Click Save changes to publish." id="s-map">
            <LocationPicker
              value={f.mapQuery}
              lat={f.mapLat}
              lng={f.mapLng}
              onChange={({ query, lat, lng }) => Store.updateSettings({ mapQuery: query, mapLat: lat, mapLng: lng })}
            />
          </Field>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 8, marginBottom: 12 }}>
            <Button variant="ghost" size="sm" onClick={() => window.open(mapSearchUrl(f.mapQuery || f.venueAddress), "_blank")}>{Icon.pin({})} Open in Google Maps</Button>
            {(f.mapQuery || f.mapLat != null) && <Button variant="ghost" size="sm" onClick={() => Store.updateSettings({ mapQuery: "", mapLat: undefined, mapLng: undefined })}>Clear pin</Button>}
          </div>
          <div className="field-row field-row--2">
            <Field label="Ceremony time" id="s-ct"><Input id="s-ct" value={f.ceremonyTime} onChange={set("ceremonyTime")} /></Field>
            <Field label="Reception time" id="s-rt"><Input id="s-rt" value={f.receptionTime} onChange={set("receptionTime")} /></Field>
          </div>
          <Field label="Dress code" id="s-dc"><Input id="s-dc" value={f.dressCode} onChange={set("dressCode")} /></Field>
        </div>
        <SaveFooter />
      </div>)}

      {tab === "appearance" && (<><div className="panel">
        <div className="panel__head"><div className="panel__title">Theme</div><span style={{ color: "var(--muted)", fontSize: 14 }}>Preview updates instantly — Save changes to publish</span></div>
        <div className="panel__body">
          <span className="field__label" style={{ display: "block", margin: "0 0 8px" }}>Home preview</span>
          <div className="theme-prev">
            <div className="theme-prev__hero">
              <div className="hero__media hero__media--themed" />
              <div className="hero__tint hero__tint--themed" />
              <div className="theme-prev__content">
                <span className="theme-prev__eyebrow">We're getting married</span>
                <span className="theme-prev__names">{f.partnerA} <span className="amp">&amp;</span> {f.partnerB}</span>
                <span className="theme-prev__date">{f.weddingDateLabel}</span>
                <span className="btn btn--primary btn--sm" style={{ marginTop: 4, pointerEvents: "none" }}>RSVP</span>
              </div>
            </div>
            <div className="theme-prev__body">
              <span style={{ fontFamily: "var(--font-display)", fontSize: 20, color: "var(--ink)" }}>Aa</span>
              <span style={{ fontSize: 13, color: "var(--ink-soft)", flex: 1 }}>Headings &amp; body update with the theme.</span>
              <span className="theme-prev__swatches"><i className="theme-prev__sw" style={{ background: "var(--accent)" }} /><i className="theme-prev__sw" style={{ background: "var(--gold)" }} /></span>
            </div>
          </div>
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

      {f.theme === "envelope" && (
      <div className="panel">
        <div className="panel__head"><div className="panel__title">Envelope Frame Photo</div><span style={{ color: "var(--muted)", fontSize: 14 }}>Shows inside the oval frame on the opened envelope</span></div>
        <div className="panel__body" style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
          <ImageUploadField label="Photo inside the oval frame" ratio="1 / 1" framePreview="/assets/invite/p2-frame.png" defaultPreview="/assets/invite/frame-video.gif"
            value={f.frameImage} onChange={(v) => setKey("frameImage", v)} />
          <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 10, maxWidth: 360 }}>A square photo of the two of you works best. Leave empty to keep the default animated frame.</p>
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
              <Field label={`Title size — ${sc} / 10`} id="s-envtitle" hint="Scales with the envelope — bigger on a wide/maximized screen, smaller on a phone, always in proportion. Save changes, then view the site.">
                <input id="s-envtitle" type="range" min="1" max="10" step="1" value={sc} onChange={(e) => setKey("envTitleSize", parseInt(e.target.value, 10))} style={{ width: "100%", accentColor: "var(--accent)" }} />
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
              <ImageUploadField label="Background image" ratio="16 / 9" defaultPreview="/assets/invite/bg-wedding.jpg" tintStrength={f.envTintOn !== false ? (f.envTint == null ? 55 : f.envTint) : 0} tintGradient={egTintGradient(f.envTintColor || "olive")}
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
                </div>
              </Field>
              <Field label={`Tint strength — ${f.envTint == null ? 55 : f.envTint}%`} id="s-envtint" hint="0% shows the bare photo, 100% is a deep wash">
                <input id="s-envtint" type="range" min="0" max="100" step="5" value={f.envTint == null ? 55 : f.envTint} disabled={f.envTintOn === false} onChange={(e) => setKey("envTint", parseInt(e.target.value, 10))} style={{ width: "100%", accentColor: "var(--accent)" }} />
              </Field>
            </div>
          </div>
        </div>
        <SaveFooter />
      </div>
      )}

      {f.theme !== "envelope" && (
      <div className="panel">
        <div className="panel__head"><div className="panel__title">Home Decorations</div><span style={{ color: "var(--muted)", fontSize: 14 }}>Floating animations on the home hero</span></div>
        <div className="panel__body">
          <AdminToggle label="Show floating decorations" desc="A gentle animated layer over the home hero." checked={f.decorOn} onChange={(v) => setKey("decorOn", v)} />
          <Field label="Decoration style" id="s-decor" hint="Pick the motif that floats across your hero">
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
            </Select>
          </Field>
          <div style={{ marginTop: 4 }}>
            <span className="field__label" style={{ display: "block", marginBottom: 7 }}>Preview</span>
            <DecorPreview style={f.decorStyle} />
          </div>
        </div>
        <SaveFooter />
      </div>
      )}</>)}

      {tab === "photos" && (<div className="panel">
        <div className="panel__head"><div className="panel__title">Home &amp; Story Photos</div><span style={{ color: "var(--muted)", fontSize: 14 }}>Upload your own — replaces the samples</span></div>
        <div className="panel__body">
          <ImageUploadField label="Home hero photo (full-bleed background)" ratio="16 / 9" value={f.heroImage} onChange={(v) => setKey("heroImage", v)} />
          <p style={{ fontSize: 12, color: "var(--muted)", marginTop: -2 }}>Leave empty to use a themed background that matches your chosen theme.</p>
          <div style={{ fontSize: 12, letterSpacing: ".12em", textTransform: "uppercase", fontWeight: 600, color: "var(--ink-soft)", margin: "22px 0 10px" }}>Our Story photos</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 20 }}>
            {story.map((row, i) => (
              <ImageUploadField key={i} ratio="4 / 3" label={(row.year ? row.year + " \u00b7 " : "") + row.title} value={row.img} onChange={(v) => Store.updateStoryItem(i, { img: v })} />
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
        <div className="panel__head"><div className="panel__title">Access &amp; Toggles</div></div>
        <div className="panel__body">
          <Field label="Admin password" id="s-pw"><Input id="s-pw" value={f.adminPassword} onChange={set("adminPassword")} /></Field>
          <AdminToggle label="Allow guest uploads" desc="Master switch for the photo/video upload pages." checked={f.uploadsEnabled} onChange={(v) => setKey("uploadsEnabled", v)} />
          <AdminToggle label="Show public gallery" desc="Hide the gallery from guests entirely if you prefer." checked={f.galleryEnabled} onChange={(v) => setKey("galleryEnabled", v)} />
        </div>
        <SaveFooter />
      </div></>)}
    </div>
  );
}

// --- Admin shell ------------------------------------------------------------
export const ADMIN_TABS = [
  { key: "dashboard", label: "Dashboard", icon: "grid" },
  { key: "rsvps", label: "RSVPs", icon: "check" },
  // Media/Gallery shelved for now — re-add when gallery ships (see DISABLED_MODULES).
  // { key: "media", label: "Media", icon: "camera" },
  { key: "guestbook", label: "Guestbook", icon: "book" },
  { key: "schedule", label: "Schedule", icon: "calendar" },
  { key: "quiz", label: "Quiz", icon: "quiz" },
  { key: "settings", label: "Settings", icon: "user" },
];

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
    try { await saveClientData(); savedRef.current = snapshot(); toast("Changes saved"); }
    catch (e) { toast("Save failed: " + (e.message || "error")); }
    finally { setSaving(false); }
  };

  // Owner (or superadmin managing a client) — load that client's submissions from
  // the DB so RSVPs / guestbook / quiz show up, not just this session's echoes.
  useEffect(() => {
    if (!auth.ready || !auth.session || !clientId) return;
    // owner manages their own client; superadmin manages whatever client site they're on
    if (auth.role === "owner" || auth.role === "superadmin") loadAdminData();
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
    tabs = tabsForClient(visibleAdminTabs(auth.role, ADMIN_TABS), auth.role, settings.modules);
  }
  const activeTab = tabs.some((t) => t.key === tab) ? tab : (tabs[0]?.key || "dashboard");
  const title = (tabs.find((t) => t.key === activeTab) || { label: "Admin" }).label;
  const onPlatformTab = activeTab === "overview" || activeTab === "clients";

  const canArrange = settings.arrangeEnabled && isPremiumTheme(settings.theme);
  const startArrange = () => { try { sessionStorage.setItem("arrangeStart", "1"); } catch (e) {} go("home"); };

  const isSuper = auth.role === "superadmin";
  return (
    <div className={"admin" + (isSuper ? " admin--sa" : "")}>
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
        <button className="admin__navlink" onClick={() => go("home")}>{Icon.arrow({ style: { transform: "rotate(180deg)" } })} View website</button>
        {canArrange && (
          <button className="admin__navlink" onClick={startArrange} style={{ color: "#7a5b12", fontWeight: 700 }}>
            {Icon.grid({ style: { width: 16, height: 16 } })} Arrange Now
          </button>
        )}
        <button className="admin__navlink" onClick={() => signOut().then(() => go("home"))}>{Icon.arrow({ style: { transform: "rotate(180deg)" } })} Sign out</button>
      </aside>

      <main className="admin__main">
        <div className="admin__head">
        <div className="admin__topbar">
          <div className="admin__topbar-left">
            <button type="button" className="admin__burger" onClick={() => setMenuOpen((o) => !o)} aria-label="Menu" aria-expanded={menuOpen}>{Icon.menu({})}</button>
            <div className="admin__title">{title}</div>
          </div>
        </div>
        </div>
        <div className="admin__body">
          <AdminSaveCtx.Provider value={{ saving, dirty, save: saveChanges }}>
          {activeTab === "dashboard" && <AdminDashboard goTab={setTab} />}
          {activeTab === "rsvps" && <RsvpsAdmin />}
          {activeTab === "media" && <MediaAdmin />}
          {activeTab === "guestbook" && <GuestbookAdmin />}
          {activeTab === "schedule" && <ScheduleAdmin />}
          {activeTab === "quiz" && <QuizAdmin />}
          {activeTab === "qr" && <QrAdmin />}
          {activeTab === "settings" && <SettingsAdmin />}
          {activeTab === "overview" && <SuperOverview />}
          {activeTab === "clients" && <ClientsAdmin />}
          </AdminSaveCtx.Provider>
        </div>
      </main>
    </div>
  );
}

