import React from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/lib/supabase.js";
import { createOwner, updateOwnerEmail, deleteOwner } from "@/lib/auth.js";
import { THEMES } from "@/themes";
import { themesForEvent } from "@/config/eventTypes.js";
import { moduleLabel, DISABLED_MODULES, OWNER_EDIT_HOME, OWNER_EDIT_TABS } from "@/lib/roles.js";
import { PLATFORM_DOMAIN, clientUrl, isValidSubdomain } from "@/config/site.js"; // platform config → src/config/site.js
import { Button, confirmDialog, Field, Icon, Input, Modal, Pager, SectionHead, Select, Textarea, toast, usePaged } from "@/ui/components.jsx";
import { listMedia, deleteFromR2, listSiteRequests, approveSiteRequest, setSiteRequestStatus, updateSiteRequest, deleteSiteRequest, listTickets, setTicketStatus, updateTicket, subscribeTicketsRealtime } from "@/lib/api.js";
import { ApplyWizard } from "@/admin/apply.jsx";
import { TicketThread } from "@/admin/SupportWidget.jsx";
// fmtDate: DEFECT-2026-07-09-A — the Support view/TicketModal used fmtDate
// without this import; the render-time ReferenceError unmounted the whole
// console (white screen). Guarded by superadminSupport.test.jsx.
import { fmtDate } from "@/admin/core.jsx";
// AdminToggle is a hoisted export; manage.jsx already imports from here, so this
// completes a function-only import cycle that ESM resolves safely (used at render).
import { AdminToggle } from "@/admin/manage.jsx";
import { fileNameFromKey } from "@/lib/mediaLibrary.js";
import { mediaUrl } from "@/lib/media.js";
const { useState, useEffect, useRef } = React;

const MODULES = ["story", "details", "schedule", "venue", "gallery", "guestbook", "quiz", "rsvp"];

// Owner-edit grant lists come from the ONE source in roles.js
// (OWNER_EDIT_HOME / OWNER_EDIT_TABS), so adding a grant there shows here AND in
// the client's own Settings → Access, and gates the tab, with no duplication.

// Shared "Access" tab body — features + moderation + owner-edit grants + toggles.
// Used by BOTH the Edit-client modal and the Edit-request (wizard) modal so the
// tabbed editor is identical everywhere. `v` is a settings-shaped object; `set`
// merges a patch; `omit` skips fields the surrounding editor already owns
// (e.g. the request wizard already has its own Strict RSVP step).
function AccessFields({ v, set, omit = [], passwordEnabled = true }) {
  const galleryOff = DISABLED_MODULES.has("gallery");
  const skip = new Set(omit);
  const setGrant = (k, val) => set({ ownerEdit: { ...(v.ownerEdit || {}), [k]: val } });
  return (
    <>
      <div className="form-row">
        <div className="form-row__head">
          <div className="form-row__label">Features</div>
          <div className="form-row__desc">Sections shown on this site. Toggle to enable or hide.</div>
        </div>
        <div className="form-row__fields">
          <div className="mod-toggles mod-toggles--edit">
            {MODULES.map((m) => {
              const locked = DISABLED_MODULES.has(m);
              const on = !locked && v.modules?.[m] !== false;
              return (
                <label key={m} className={"mod-pill" + (on ? " mod-pill--on" : "") + (locked ? " mod-pill--locked" : "")} title={locked ? "Pending — feature not available yet" : undefined}>
                  <input type="checkbox" checked={on} disabled={locked} onChange={(e) => set({ modules: { ...(v.modules || {}), [m]: e.target.checked } })} /> {moduleLabel(m)}
                  {locked && <span className="mod-pill__pending">Pending</span>}
                </label>
              );
            })}
          </div>
        </div>
      </div>
      <div className="form-row">
        <div className="form-row__head">
          <div className="form-row__label">Moderation</div>
          <div className="form-row__desc">How guest submissions are approved.</div>
        </div>
        <div className="form-row__fields">
          {!galleryOff && (
            <AdminToggle label="Auto-approve photos &amp; videos" desc="When on, guest uploads appear in the gallery instantly. When off, they wait in the Media queue." checked={v.autoApproveMedia} onChange={(x) => set({ autoApproveMedia: x })} />
          )}
          <AdminToggle label="Auto-approve guestbook messages" desc="When on, messages post immediately. When off, they stay hidden until approved." checked={v.autoApproveGuestbook} onChange={(x) => set({ autoApproveGuestbook: x })} noRule />
        </div>
      </div>
      <div className="form-row">
        <div className="form-row__head">
          <div className="form-row__label">Owner editing</div>
          <div className="form-row__desc">Which sections the couple's own login may edit. Everything else stays superadmin-only.</div>
        </div>
        <div className="form-row__fields">
          <div style={{ fontSize: 12, letterSpacing: ".1em", textTransform: "uppercase", fontWeight: 600, color: "var(--ink-soft)", margin: "2px 0 4px" }}>Home tab folders</div>
          {OWNER_EDIT_HOME.map((g) => (
            <AdminToggle key={g.k} label={g.label} desc={g.desc} checked={v.ownerEdit?.[g.k] === true} onChange={(x) => setGrant(g.k, x)} />
          ))}
          <div style={{ fontSize: 12, letterSpacing: ".1em", textTransform: "uppercase", fontWeight: 600, color: "var(--ink-soft)", margin: "14px 0 4px" }}>Other tabs</div>
          {OWNER_EDIT_TABS.map((g, i) => (
            <AdminToggle key={g.k} label={g.label} desc={g.desc} checked={v.ownerEdit?.[g.k] === true} onChange={(x) => setGrant(g.k, x)} noRule={i === OWNER_EDIT_TABS.length - 1} />
          ))}
        </div>
      </div>
      <div className="form-row">
        <div className="form-row__head">
          <div className="form-row__label">Site-wide switches</div>
          <div className="form-row__desc">Toggles that apply to the whole site.</div>
        </div>
        <div className="form-row__fields">
          {!galleryOff && (<>
            <AdminToggle label="Allow guest uploads" desc="Master switch for the photo/video upload pages." checked={v.uploadsEnabled} onChange={(x) => set({ uploadsEnabled: x })} />
            <AdminToggle label="Show public gallery" desc="Hide the gallery from guests entirely if you prefer." checked={v.galleryEnabled} onChange={(x) => set({ galleryEnabled: x })} />
          </>)}
          {!skip.has("strictRsvp") && (
            <AdminToggle label="Enable Strict RSVP" desc="Track an invited-guest list with seat allocations and see who hasn't replied. Adds a Guests tab; only listed guests can RSVP, capped at their allocation." checked={v.strictRsvp} onChange={(x) => set({ strictRsvp: x })} noRule />
          )}
        </div>
      </div>
      <div className="form-row">
        <div className="form-row__head">
          <div className="form-row__label">Owner login &amp; note</div>
          <div className="form-row__desc">Reset the owner's password and keep a private note. The owner email is on the Design tab.</div>
        </div>
        <div className="form-row__fields">
          <Field label="New password" id="af-opw" hint={passwordEnabled ? "Leave blank to keep current" : "The owner login is created when you approve this request"}>
            <Input id="af-opw" value={v.ownerPassword || ""} disabled={!passwordEnabled} onChange={(e) => set({ ownerPassword: e.target.value })} placeholder="••••••••" />
          </Field>
          <Field label="Private note (superadmin only)" id="af-note"><Textarea id="af-note" value={v.note || ""} onChange={(e) => set({ note: e.target.value })} placeholder="Add a private note…" /></Field>
        </div>
      </div>
    </>
  );
}

export function SuperOverview() {
  const [m, setM] = useState(null);
  const [byType, setByType] = useState({});
  const [recent, setRecent] = useState([]);
  useEffect(() => {
    (async () => {
      const cnt = async (t) => { const { count } = await supabase.from(t).select("*", { count: "exact", head: true }); return count || 0; };
      const { data } = await supabase.from("clients").select("id,subdomain,event_type,is_active,owner_email,content,created_at").order("created_at", { ascending: false });
      const list = data || [];
      const bt = {}; list.forEach((c) => { bt[c.event_type] = (bt[c.event_type] || 0) + 1; });
      const [rsvps, guestbook, quiz] = await Promise.all([cnt("rsvps"), cnt("guestbook"), cnt("quiz_answers")]);
      setByType(bt); setRecent(list.slice(0, 6));
      setM({ clients: list.length, active: list.filter((c) => c.is_active).length, logins: list.filter((c) => c.owner_email).length, rsvps, guestbook, quiz });
    })().catch((e) => console.warn("[superadmin] overview load failed:", e?.message));
  }, []);

  const stats = m ? [
    { label: "Clients", value: m.clients, sub: `${m.active} active`, icon: "user", accent: "info" },
    { label: "Owner logins", value: m.logins, sub: `${m.clients - m.logins} without login`, icon: "mail", accent: "success" },
    { label: "RSVPs", value: m.rsvps, sub: "across all events", icon: "check", accent: "purple" },
    { label: "Guestbook", value: m.guestbook, sub: "messages", icon: "book", accent: "amber" },
    { label: "Quiz plays", value: m.quiz, sub: "submissions", icon: "quiz", accent: "info" },
  ] : Array.from({ length: 5 }).map(() => ({ label: "—", value: "·", sub: "", icon: "grid", accent: "info" }));
  const typeTotal = Object.values(byType).reduce((a, b) => a + b, 0) || 1;

  return (
    <div>
      {/* Same KPI card design as the client dashboard tiles (chip icon, bold
          sans value, dashed footer) — counts here are plain totals, so the
          footer shows the sub text instead of a week-over-week trend. */}
      <div className="sa-stats">
        {stats.map((s, i) => (
          <div key={i} className={"kpi kpi--" + s.accent}>
            <div className="kpi__top">
              <span className="kpi__chip" aria-hidden="true">{Icon[s.icon] ? Icon[s.icon]({}) : null}</span>
              <span className="kpi__label">{s.label}</span>
            </div>
            <div className="kpi__value">{s.value}</div>
            <div className="kpi__foot"><span className="kpi__tick" aria-hidden="true" />{s.sub}</div>
          </div>
        ))}
      </div>

      <div className="sa-grid2">
        <div className="panel">
          <div className="panel__head"><div className="panel__title">By event type</div></div>
          <div className="panel__body">
            {Object.keys(byType).length === 0 && <div style={{ color: "var(--muted)" }}>No clients yet.</div>}
            {Object.entries(byType).map(([t, n]) => (
              <div key={t} className="sa-bar">
                <div className="sa-bar__top"><span style={{ textTransform: "capitalize" }}>{t}</span><span style={{ color: "var(--muted)" }}>{n}</span></div>
                <div className="sa-bar__track"><div className="sa-bar__fill" style={{ width: `${(n / typeTotal) * 100}%` }} /></div>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="panel__head"><div className="panel__title">Recent clients</div></div>
          <div className="panel__body--flush table-wrap">
            <table className="tbl">
              <thead><tr><th>Client</th><th>Type</th><th>Owner login</th><th>Contact</th><th></th></tr></thead>
              <tbody>
                {recent.map((c) => (
                  <tr key={c.id}>
                    <td><strong>{c.subdomain}</strong></td>
                    <td><span className="tag tag--hidden">{c.event_type}</span></td>
                    <td>{c.owner_email ? <span className="client-domain">{c.owner_email}</span> : <span style={{ color: "var(--muted)", fontSize: 13 }}>—</span>}</td>
                    <td>{c.content && c.content.phone ? <span className="client-domain">{c.content.phone}</span> : <span style={{ color: "var(--muted)", fontSize: 13 }}>—</span>}</td>
                    <td><a className="icon-btn" href={`/admin?client=${c.subdomain}`} title="Open admin">{Icon.grid({})}</a></td>
                  </tr>
                ))}
                {recent.length === 0 && <tr><td colSpan={5} style={{ textAlign: "center", padding: 32, color: "var(--muted)" }}>No clients yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

// Superadmin ticket detail: request meta + Open/Resolved status + the reply
// thread (owner ⇄ support). Replies post through TicketThread; the status
// select saves immediately. onRefresh re-pulls the list so the badge/table
// stay in sync without closing the modal.
function TicketModal({ ticket, onClose, onRefresh }) {
  const [status, setStatus] = useState(ticket.status || "open");
  const [busy, setBusy] = useState(false);
  const saveStatus = async (next) => {
    if (next === status) return;
    setStatus(next);
    if (next === ticket.status) return;
    setBusy(true);
    try {
      await setTicketStatus(ticket.id, next);
      toast(next === "resolved" ? "Marked resolved" : "Reopened", "success");
      onRefresh && onRefresh();
    } catch (e) {
      toast(e.message || "Couldn't update status", "error");
      setStatus(ticket.status || "open");
    } finally { setBusy(false); }
  };
  const meta = (label, val) => val ? <div style={{ fontSize: 13, color: "var(--muted)" }}><strong style={{ color: "var(--ink)" }}>{label}:</strong> {val}</div> : null;
  return (
    <Modal open onClose={() => !busy && onClose()} label="Support ticket">
      <SectionHead eyebrow="Support ticket" title={ticket.subject} />
      <div style={{ display: "grid", gap: 4, margin: "0 0 12px" }}>
        {meta("From", ticket.submitter_name || ticket.submitter_email)}
        {meta("Email", ticket.submitter_email)}
        {meta("Where", ticket.context_url)}
        {meta("Category", ticket.category)}
        {meta("Urgency", ticket.urgency)}
        {meta("Submitted", fmtDate(ticket.created_at))}
      </div>
      <div style={{ maxWidth: 240, margin: "0 0 14px" }}>
        <Field label="Status" id="tk-status"><Select id="tk-status" value={status} disabled={busy} onChange={(e) => saveStatus(e.target.value)}><option value="open">Open</option><option value="resolved">Resolved</option></Select></Field>
      </div>
      <TicketThread ticket={ticket} onChanged={onRefresh} />
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 14 }}>
        <Button variant="ghost" onClick={() => !busy && onClose()} disabled={busy}>Close</Button>
      </div>
    </Modal>
  );
}

// Superadmin top-level "Support" tab: every client's tickets, split Open /
// Resolved, each opening the reply thread (TicketModal). Live-refreshes on new
// owner submissions.
export function SupportAdmin() {
  const [tickets, setTickets] = useState([]);
  const [ticket, setTicket] = useState(null);        // ticket open in the detail modal
  const [ticketFilter, setTicketFilter] = useState("open"); // open | resolved
  const [loading, setLoading] = useState(true);
  const load = () => listTickets().then((rows) => setTickets(rows || [])).catch(() => {}).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);
  useEffect(() => {
    const off = subscribeTicketsRealtime(() => { listTickets().then((r) => setTickets(r || [])).catch(() => {}); });
    return off;
  }, []);
  const openN = tickets.filter((t) => t.status === "open").length;
  const resolvedN = tickets.filter((t) => t.status === "resolved").length;
  const shown = tickets.filter((t) => (ticketFilter === "resolved" ? t.status === "resolved" : t.status === "open"));
  return (
    <div>
      <div className="panel">
        <div className="panel__head"><div className="panel__title">Support tickets</div><span style={{ color: "var(--muted)", fontSize: 13 }}>Help requests from client admins</span></div>
        <div className="admin-toolbar" style={{ padding: "12px 16px" }}>
          <div className="seg">
            <button type="button" className={ticketFilter === "open" ? "on" : ""} onClick={() => setTicketFilter("open")}>Open ({openN})</button>
            <button type="button" className={ticketFilter === "resolved" ? "on" : ""} onClick={() => setTicketFilter("resolved")}>Resolved ({resolvedN})</button>
          </div>
        </div>
        <div className="panel__body--flush table-wrap">
          <table className="tbl">
            <thead><tr><th>Client</th><th>Subject</th><th>Category</th><th>Urgency</th><th>Status</th><th>When</th><th></th></tr></thead>
            <tbody>
              {loading && <tr><td colSpan={7} style={{ color: "var(--muted)", padding: 18 }}>Loading…</td></tr>}
              {!loading && shown.length === 0 && <tr><td colSpan={7} style={{ color: "var(--muted)", padding: 18 }}>No {ticketFilter} tickets.</td></tr>}
              {shown.map((t) => (
                <tr key={t.id}>
                  <td><strong>{t.submitter_name || t.submitter_email || "—"}</strong><div style={{ color: "var(--muted)", fontSize: 12 }}>{t.context_url || ""}</div></td>
                  <td>{t.subject}</td>
                  <td><span className="tag tag--hidden">{t.category}</span></td>
                  <td>{t.urgency}</td>
                  <td><span className="tag" style={{ background: t.status === "open" ? "#fdecc8" : "#d6f0e0", color: t.status === "open" ? "#7a5b12" : "#1e6b45" }}>{t.status}</span></td>
                  <td style={{ whiteSpace: "nowrap", color: "var(--muted)", fontSize: 13 }}>{fmtDate(t.created_at)}</td>
                  <td><Button variant="ghost" size="sm" onClick={() => setTicket(t)}>{Icon.eye({})} Open</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {ticket && <TicketModal ticket={ticket} onClose={() => setTicket(null)} onRefresh={load} />}
    </div>
  );
}

export function ClientsAdmin() {
  // list | add | edit | requests | approved | rejected | offline. The console
  // bell deep-links to Requests via a one-shot sessionStorage flag.
  const [view, setView] = useState(() => {
    try {
      if (sessionStorage.getItem("evermore_sa_view") === "requests") {
        sessionStorage.removeItem("evermore_sa_view");
        return "requests";
      }
    } catch (_) {}
    return "list";
  });
  const [clients, setClients] = useState([]);
  const [notes, setNotes] = useState({}); // client_id -> note text (superadmin-only, from client_notes)
  const [form, setForm] = useState({ subdomain: "", event_type: "wedding", template_key: "classic", ownerEmail: "", ownerPassword: "", note: "" });
  const [editing, setEditing] = useState(null);
  const [editForm, setEditForm] = useState({ subdomain: "", ownerEmail: "", ownerPassword: "", modules: {}, note: "" });
  const [editTab, setEditTab] = useState("design"); // Edit-client modal: design | access
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState(""); // label shown in the blocking overlay
  // Run an async mutation behind the blocking "working" overlay so slow data
  // always shows progress (critical: every add/edit/delete must show loading).
  async function runBusy(label, fn) {
    setBusyLabel(label); setBusy(true);
    try { return await fn(); }
    finally { setBusy(false); setBusyLabel(""); }
  }
  const [q, setQ] = useState("");
  const [requests, setRequests] = useState([]);     // prospect intake (/apply) awaiting approval
  const [reqInfo, setReqInfo] = useState(null);      // request shown in the details modal (eye)
  const [info, setInfo] = useState(null);            // client shown in the info modal (eye icon)
  const [reqEdit, setReqEdit] = useState(null);      // request being edited in a modal (pencil)
  const [reqEditTab, setReqEditTab] = useState("design"); // Edit-request modal: design (wizard) | access
  const [reqAccess, setReqAccess] = useState(null);  // request's access/feature settings for the Access tab
  const [delReq, setDelReq] = useState(null);        // { r, typed } — type-the-address delete confirm
  const [sel, setSel] = useState(() => new Set());   // client ids checked for bulk delete

  async function load() {
    const { data } = await supabase.from("clients").select("*").order("created_at", { ascending: false });
    setClients(data || []);
    setSel(new Set()); // rows changed — stale checks would be dangerous on delete
    try { setRequests(await listSiteRequests()); } catch (_) { /* non-superadmin or table missing */ }
    // Notes live in a superadmin-only table (never exposed to anon/owners).
    const { data: nd } = await supabase.from("client_notes").select("client_id,note");
    setNotes(Object.fromEntries((nd || []).map((r) => [r.client_id, r.note || ""])));
  }
  useEffect(() => { load(); }, []);
  // Selection is per-tab: clear checks when switching views so a bulk delete can
  // never target off-screen rows selected in another tab (e.g. list → offline).
  useEffect(() => { setSel(new Set()); }, [view]);

  // Open the request editor: seed the Access-tab settings from the request's
  // content (same defaults as the client admin) and reset to the Design tab.
  function openReqEdit(r) {
    const c = r.content || {};
    setReqAccess({
      modules: Object.fromEntries(MODULES.map((m) => [m, c.modules?.[m] !== false])),
      autoApproveMedia: c.autoApproveMedia !== false,
      autoApproveGuestbook: c.autoApproveGuestbook !== false,
      uploadsEnabled: c.uploadsEnabled !== false,
      galleryEnabled: c.galleryEnabled !== false,
      ownerEdit: { ...(c.ownerEdit || {}) },
      note: c.note || "",
    });
    setReqEditTab("design");
    setReqEdit(r);
  }

  // Save (or clear) the private note for a client. Empty note removes the row.
  async function saveNote(clientId, note) {
    const text = (note || "").trim();
    if (text) await supabase.from("client_notes").upsert({ client_id: clientId, note: text, updated_at: new Date().toISOString() });
    else await supabase.from("client_notes").delete().eq("client_id", clientId);
  }

  // Enable/disable a client's site. is_active=false makes the public "read active
  // clients" policy hide it, so guests see the site as unavailable until re-enabled.
  async function toggleActive(c) {
    const next = !c.is_active;
    if (!next) {
      const ok = await confirmDialog({
        title: "Disable this client?",
        message: `Take "${c.subdomain}" offline? Guests visiting the site won't be able to load it until you re-enable access. Nothing is deleted.`,
        confirmLabel: "Disable access",
        danger: true,
      });
      if (!ok) return;
    } else {
      const ok = await confirmDialog({
        title: "Enable this client?",
        message: `Put "${c.subdomain}" live? Guests will be able to load the site again right away.`,
        confirmLabel: "Enable access",
      });
      if (!ok) return;
    }
    await runBusy(next ? "Enabling…" : "Disabling…", async () => {
      const { error } = await supabase.from("clients").update({ is_active: next }).eq("id", c.id);
      if (error) return toast("Update failed: " + error.message);
      toast(next ? "Access enabled — site is live" : "Access disabled — site is offline");
      await load();
    });
  }

  function edgeOrToast(e2) {
    const msg = e2?.message || "error";
    if (/failed to send|function not found|non-2xx|not found|fetch|edge/i.test(msg))
      toast("Owner login needs the edge function deployed (admin-create-owner) — or do it in Supabase Auth.");
    else toast("Failed: " + msg);
  }

  async function createClient(e) {
    e.preventDefault();
    if (busy || !form.subdomain.trim()) return;
    const sub = form.subdomain.trim().toLowerCase();
    if (!isValidSubdomain(sub)) return toast("Invalid subdomain. Use lowercase letters, numbers, and hyphens — and not a reserved name (www, app, admin, demo…).");
    setBusyLabel("Creating client…"); setBusy(true);
    const { data: created, error } = await supabase.from("clients")
      .insert({ subdomain: sub, event_type: form.event_type, template_key: form.template_key }).select().single();
    if (error) { setBusy(false); setBusyLabel(""); return toast("Create failed: " + error.message); }
    if (form.note.trim()) { try { await saveNote(created.id, form.note); } catch (_) { /* note is best-effort */ } }
    if (form.ownerEmail.trim() && form.ownerPassword) {
      try {
        await createOwner({ email: form.ownerEmail.trim(), password: form.ownerPassword, client_id: created.id });
        await supabase.from("clients").update({ owner_email: form.ownerEmail.trim() }).eq("id", created.id);
        toast("Client + owner login created");
      } catch (e2) { toast("Client created — owner login pending:"); edgeOrToast(e2); }
    } else { toast("Client created"); }
    setForm({ subdomain: "", event_type: "wedding", template_key: "classic", ownerEmail: "", ownerPassword: "", note: "" });
    await load(); setView("list");
    setBusy(false); setBusyLabel("");
  }

  async function assignTheme(id, template_key) {
    await runBusy("Saving…", async () => {
      const { error } = await supabase.from("clients").update({ template_key }).eq("id", id);
      if (error) return toast("Update failed");
      toast("Theme assigned"); await load();
    });
  }
  async function changeType(c, event_type) {
    await runBusy("Saving…", async () => {
      const { error } = await supabase.from("clients").update({ event_type, template_key: themesForEvent(event_type)[0] }).eq("id", c.id);
      if (error) return toast("Update failed");
      toast("Type updated"); await load();
    });
  }
  async function toggleModule(c, key, on) {
    await runBusy("Saving…", async () => {
      const modules = { ...(c.content?.modules || {}), [key]: on };
      const { error } = await supabase.from("clients").update({ content: { ...(c.content || {}), modules } }).eq("id", c.id);
      if (error) return toast("Update failed");
      await load();
    });
  }

  function openEdit(c) {
    const ct = c.content || {};
    setEditing(c);
    setEditTab("design");
    // Load the identity fields PLUS the client's access/feature settings (stored in
    // content JSON) so the Access tab mirrors the client's own Admin → Settings.
    // Absent keys fall back to the same defaults the client admin uses.
    setEditForm({
      subdomain: c.subdomain, ownerEmail: c.owner_email || "", ownerPassword: "",
      modules: Object.fromEntries(MODULES.map((m) => [m, ct.modules?.[m] !== false])),
      note: notes[c.id] || "",
      autoApproveMedia: ct.autoApproveMedia !== false,
      autoApproveGuestbook: ct.autoApproveGuestbook !== false,
      uploadsEnabled: ct.uploadsEnabled !== false,
      galleryEnabled: ct.galleryEnabled !== false,
      strictRsvp: ct.strictRsvp === true,
      ownerEdit: { ...(ct.ownerEdit || {}) },
    });
    // renders as a Modal over the list — no page swap
  }
  // DESIGN tab (client): the same intake wizard as the request editor. Saves the
  // site fields (couple → content.partnerA/B, subdomain, theme, date, venue,
  // schedule, entourage) back to the client, and applies an owner-email change.
  // Merges content so the Access-tab keys survive. Throws on bad subdomain so the
  // wizard surfaces the error inline.
  async function saveClientDesign(p) {
    if (!editing) return;
    if (!isValidSubdomain(p.subdomain)) throw new Error("Invalid subdomain — lowercase letters, numbers, hyphens; not a reserved name.");
    const id = editing.id;
    await runBusy("Saving…", async () => {
      const content = { ...(editing.content || {}), partnerA: p.partnerA, partnerB: p.partnerB, ...p.content };
      const { error } = await supabase.from("clients").update({ subdomain: p.subdomain, template_key: p.templateKey, content }).eq("id", id);
      if (error) { toast("Save failed: " + error.message, "err"); return; }
      const email = (p.email || "").trim();
      try {
        if (email && email !== (editing.owner_email || "")) {
          if (editing.owner_email) await updateOwnerEmail({ old_email: editing.owner_email, new_email: email });
          await supabase.from("clients").update({ owner_email: email }).eq("id", id);
        }
      } catch (e2) { edgeOrToast(e2); }
      toast("Client updated", "success");
      await load();
      setEditing(null);
    });
  }
  // ACCESS tab (client): shared feature/access settings + the client-only owner
  // password reset and private note. Strict RSVP lives on the Design wizard, so
  // it's omitted here and not written (can't clobber the wizard's value).
  async function saveClientAccess() {
    if (busy || !editing) return;
    const id = editing.id;
    await runBusy("Saving…", async () => {
      const content = {
        ...(editing.content || {}),
        modules: editForm.modules,
        autoApproveMedia: editForm.autoApproveMedia,
        autoApproveGuestbook: editForm.autoApproveGuestbook,
        uploadsEnabled: editForm.uploadsEnabled,
        galleryEnabled: editForm.galleryEnabled,
        ownerEdit: editForm.ownerEdit || {},
      };
      const { error } = await supabase.from("clients").update({ content }).eq("id", id);
      if (error) { toast("Save failed: " + error.message, "err"); return; }
      try { await saveNote(id, editForm.note); } catch (_) { /* note is best-effort */ }
      // Password reset is authoritative: NEVER report success if it failed, or
      // the owner is silently locked to their old password (the exact bug hit).
      const pw = editForm.ownerPassword;
      let pwErr = "";
      if (pw) {
        if (!editing.owner_email) pwErr = "this client has no owner email yet — set it on the Design tab and save first";
        else {
          try { await createOwner({ email: editing.owner_email, password: pw, client_id: id }); }
          catch (e2) { pwErr = e2?.message || "password change failed"; }
        }
      }
      setEditing((c) => (c ? { ...c, content } : c)); // keep local row fresh for a later Design save
      await load();
      if (pwErr) {
        // keep the typed password so they can retry after fixing the cause
        toast("Settings saved, but the password was NOT changed: " + pwErr, "err");
      } else {
        setEditForm((f) => ({ ...f, ownerPassword: "" }));
        toast(pw ? "Settings saved and owner password reset" : "Access settings saved", "success");
      }
    });
  }

  // Remove the owner's auth account FIRST, while profiles.client_id still links
  // to this client (so the lookup works even when owner_email is null). Deleting
  // the auth user cascades its profile. Then delete the client (cascades its
  // RSVPs/guestbook/quiz). A noop is fine for clients that never had an owner.
  async function deleteClientCore(c) {
    let ownerWarn = false;
    try { await deleteOwner({ email: c.owner_email || undefined, client_id: c.id }); }
    catch (e2) { ownerWarn = true; }
    const { error } = await supabase.from("clients").delete().eq("id", c.id);
    if (error) throw error;
    return { ownerWarn };
  }
  async function deleteClient(c) {
    const ok = await confirmDialog({
      title: "Delete client?",
      message: `Delete "${c.subdomain}" and all its data (RSVPs, guestbook, quiz) and its owner login? This can't be undone.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    await runBusy("Deleting client…", async () => {
      try {
        const { ownerWarn } = await deleteClientCore(c);
        toast(ownerWarn ? "Client deleted — owner login may remain; remove it in Supabase Auth." : "Client and owner login deleted");
      } catch (e) { return toast("Delete failed: " + e.message); }
      await load();
    });
  }
  // Bulk: checked rows -> one confirm listing the sites -> delete them all.
  const toggleSel = (id) => setSel((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  async function deleteSelected() {
    const targets = clients.filter((c) => sel.has(c.id));
    if (!targets.length) return;
    const ok = await confirmDialog({
      title: `Delete ${targets.length} client${targets.length === 1 ? "" : "s"}?`,
      message: `Delete ${targets.map((c) => c.subdomain).join(", ")} — including all their data (RSVPs, guestbook, quiz) and owner logins? This can't be undone.`,
      confirmLabel: `Delete ${targets.length}`,
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    let fail = 0, warn = 0;
    for (let i = 0; i < targets.length; i++) {
      setBusyLabel(`Deleting ${i + 1}/${targets.length}…`);
      try { const { ownerWarn } = await deleteClientCore(targets[i]); if (ownerWarn) warn++; }
      catch (_) { fail++; }
    }
    setSel(new Set()); // clear selection so the stale "Delete selected (N)" button goes away
    await load();
    setBusy(false); setBusyLabel("");
    toast(
      fail ? `Deleted ${targets.length - fail} — ${fail} failed` :
      warn ? `Deleted ${targets.length} — ${warn} owner login(s) may remain (Supabase Auth)` :
      `Deleted ${targets.length} client${targets.length === 1 ? "" : "s"}`,
      fail ? "err" : "success",
    );
  }

  const filtered = clients.filter((c) => c.subdomain.toLowerCase().includes(q.trim().toLowerCase()));
  const pg = usePaged(filtered, 20);

  return (
    <div className="sa">
      {/* Blocking overlay for every superadmin mutation (add/edit/delete/bulk) —
          slow data must always show progress. Portaled to <body> so it paints
          ABOVE the Edit-client Modal (also portaled, z80) — otherwise it was
          trapped behind the modal on save and looked like nothing happened. */}
      {busy && createPortal(
        <div className="admin--sa">
          <div className="admin-saving" role="status" aria-live="polite" aria-label={busyLabel || "Working"}>
            <div className="admin-saving__box"><span className="admin-saving__spin" aria-hidden="true" />{busyLabel || "Working…"}</div>
          </div>
        </div>,
        document.body,
      )}
      {/* Folder-style sub-tabs — same design as the client admin's sub-folders.
          "Add client" is the toolbar button on the list, not a tab. */}
      <div className="folders">
        <button className={"folder" + (view === "list" || view === "add" ? " folder--active" : "")} onClick={() => { setEditing(null); setView("list"); }}>Clients</button>
        <button className={"folder" + (view === "requests" ? " folder--active" : "")} onClick={() => setView("requests")}>
          Requests{requests.filter((r) => r.status === "pending").length > 0 ? ` (${requests.filter((r) => r.status === "pending").length})` : ""}
        </button>
        <button className={"folder" + (view === "approved" ? " folder--active" : "")} onClick={() => setView("approved")}>
          Approved{requests.filter((r) => r.status === "approved").length > 0 ? ` (${requests.filter((r) => r.status === "approved").length})` : ""}
        </button>
        <button className={"folder" + (view === "rejected" ? " folder--active" : "")} onClick={() => setView("rejected")}>
          Rejected{requests.filter((r) => r.status === "rejected").length > 0 ? ` (${requests.filter((r) => r.status === "rejected").length})` : ""}
        </button>
        <button className={"folder" + (view === "offline" ? " folder--active" : "")} onClick={() => setView("offline")}>
          Offline{clients.filter((c) => !c.is_active).length > 0 ? ` (${clients.filter((c) => !c.is_active).length})` : ""}
        </button>
      </div>

      {view === "requests" && (
        <div className="panel">
          <div className="panel__head"><div className="panel__title">Site requests</div><span style={{ color: "var(--muted)", fontSize: 13 }}>Submitted from the /apply wizard — approve to create the site</span></div>
          <div className="panel__body--flush table-wrap">
            <table className="tbl">
              <thead><tr><th>Couple</th><th>Site address</th><th>Email</th><th>Theme</th><th>RSVP</th><th></th></tr></thead>
              <tbody>
                {requests.filter((r) => r.status === "pending").map((r) => (
                  <React.Fragment key={r.id}>
                    <tr>
                      <td><strong>{r.partner_a}{r.partner_b ? ` & ${r.partner_b}` : ""}</strong></td>
                      <td className="client-domain">{r.subdomain}.celebrately.us</td>
                      <td>{r.email}</td>
                      <td>{r.template_key}</td>
                      <td>{r.content && r.content.strictRsvp ? "Strict" : "Open"}</td>
                      <td>
                        <div className="row-actions">
                          <button className="icon-btn" title="Details" onClick={() => setReqInfo(r)}>{Icon.eye({})}</button>
                          {r.status === "pending" && (
                            <>
                              <button className="icon-btn" title="Edit request" onClick={() => openReqEdit(r)}>{Icon.edit({})}</button>
                              <Button variant="primary" size="sm" disabled={busy} onClick={async () => {
                                const ok = await confirmDialog({ title: "Approve this site?", message: `Create ${r.subdomain}.celebrately.us for ${r.partner_a}${r.partner_b ? ` & ${r.partner_b}` : ""}? You can set the owner's login afterwards via the pencil (Edit) on the client.`, confirmLabel: "Approve & create" });
                                if (!ok) return;
                                setBusy(true);
                                try { await approveSiteRequest(r); toast("Site created — set the owner's login next", "success"); await load(); }
                                catch (e) { toast("Approve failed: " + (e.message || "error"), "err"); }
                                finally { setBusy(false); }
                              }}>Approve</Button>
                              <Button variant="ghost" size="sm" disabled={busy} onClick={async () => {
                                const ok = await confirmDialog({ title: "Reject this request?", message: `Reject the request for ${r.subdomain}.celebrately.us?`, confirmLabel: "Reject", danger: true });
                                if (!ok) return;
                                try { await setSiteRequestStatus(r.id, "rejected"); await load(); } catch (e) { toast("Failed: " + (e.message || "error"), "err"); }
                              }}>Reject</Button>
                            </>
                          )}
                          <button className="icon-btn icon-btn--danger" title="Delete request" onClick={() => setDelReq({ r, typed: "" })}>{Icon.trash({})}</button>
                        </div>
                      </td>
                    </tr>
                  </React.Fragment>
                ))}
                {requests.filter((r) => r.status === "pending").length === 0 && <tr><td colSpan={6} style={{ color: "var(--muted)", textAlign: "center", padding: 32 }}>No pending requests — share celebrately.us/apply with a prospect.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Approved requests — history of what's been turned into a live site. */}
      {view === "approved" && (
        <div className="panel">
          <div className="panel__head"><div className="panel__title">Approved requests</div><span style={{ color: "var(--muted)", fontSize: 13 }}>These sites were created — manage them in the Clients tab</span></div>
          <div className="panel__body--flush table-wrap">
            <table className="tbl">
              <thead><tr><th>Couple</th><th>Site address</th><th>Email</th><th>Theme</th><th>Submitted</th><th></th></tr></thead>
              <tbody>
                {requests.filter((r) => r.status === "approved").map((r) => (
                  <tr key={r.id}>
                    <td><strong>{r.partner_a}{r.partner_b ? ` & ${r.partner_b}` : ""}</strong></td>
                    <td className="client-domain">{r.subdomain}.celebrately.us</td>
                    <td>{r.email}</td>
                    <td>{r.template_key}</td>
                    <td style={{ color: "var(--muted)", fontSize: 13 }}>{new Date(r.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</td>
                    <td>
                      <div className="row-actions">
                        <button className="icon-btn" title="Details" onClick={() => setReqInfo(r)}>{Icon.eye({})}</button>
                        <button className="icon-btn" title="Edit request" onClick={() => openReqEdit(r)}>{Icon.edit({})}</button>
                        <a className="icon-btn" href={clientUrl(r.subdomain)} target="_blank" rel="noreferrer" title="Open live site">{Icon.arrow({})}</a>
                        <button className="icon-btn icon-btn--danger" title="Delete request" onClick={() => setDelReq({ r, typed: "" })}>{Icon.trash({})}</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {requests.filter((r) => r.status === "approved").length === 0 && <tr><td colSpan={6} style={{ color: "var(--muted)", textAlign: "center", padding: 32 }}>No approved requests yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Rejected requests — parked, but the decision is reversible: Reopen
          sends one back to the Requests tab as pending for editing/approval. */}
      {view === "rejected" && (
        <div className="panel">
          <div className="panel__head"><div className="panel__title">Rejected requests</div><span style={{ color: "var(--muted)", fontSize: 13 }}>Reopen to move a request back to pending — nothing is deleted</span></div>
          <div className="panel__body--flush table-wrap">
            <table className="tbl">
              <thead><tr><th>Couple</th><th>Site address</th><th>Email</th><th>Theme</th><th>Submitted</th><th></th></tr></thead>
              <tbody>
                {requests.filter((r) => r.status === "rejected").map((r) => (
                  <tr key={r.id}>
                    <td><strong>{r.partner_a}{r.partner_b ? ` & ${r.partner_b}` : ""}</strong></td>
                    <td className="client-domain">{r.subdomain}.celebrately.us</td>
                    <td>{r.email}</td>
                    <td>{r.template_key}</td>
                    <td style={{ color: "var(--muted)", fontSize: 13 }}>{new Date(r.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</td>
                    <td>
                      <div className="row-actions">
                        <button className="icon-btn" title="Details" onClick={() => setReqInfo(r)}>{Icon.eye({})}</button>
                        <button className="icon-btn" title="Edit request" onClick={() => openReqEdit(r)}>{Icon.edit({})}</button>
                        <button className="icon-btn icon-btn--danger" title="Delete request" onClick={() => setDelReq({ r, typed: "" })}>{Icon.trash({})}</button>
                        <Button variant="primary" size="sm" disabled={busy} onClick={async () => {
                          const ok = await confirmDialog({ title: "Reopen this request?", message: `Move the request for ${r.subdomain}.celebrately.us back to pending? You can then edit or approve it in Requests.`, confirmLabel: "Reopen" });
                          if (!ok) return;
                          try { await setSiteRequestStatus(r.id, "pending"); toast("Request reopened — it's back in Requests", "success"); await load(); setView("requests"); }
                          catch (e) { toast("Failed: " + (e.message || "error"), "err"); }
                        }}>Reopen</Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {requests.filter((r) => r.status === "rejected").length === 0 && <tr><td colSpan={6} style={{ color: "var(--muted)", textAlign: "center", padding: 32 }}>No rejected requests.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Offline — clients whose site access is disabled (is_active=false). */}
      {view === "offline" && (
        <div className="panel">
          <div className="panel__head"><div className="panel__title">Offline clients</div><span style={{ color: "var(--muted)", fontSize: 13 }}>Sites currently disabled — guests can't load them until re-enabled</span>
            {sel.size > 0 && <Button variant="ghost" size="sm" disabled={busy} onClick={deleteSelected} style={{ color: "#e5484d", borderColor: "#e5484d" }}>{Icon.trash({})} Delete selected ({sel.size})</Button>}</div>
          <div className="panel__body--flush table-wrap">
            <table className="tbl">
              <thead><tr>
                <th style={{ width: 34 }}><input type="checkbox" aria-label="Select all offline"
                  checked={clients.filter((c) => !c.is_active).length > 0 && clients.filter((c) => !c.is_active).every((c) => sel.has(c.id))}
                  onChange={(e) => setSel((p) => { const n = new Set(p); clients.filter((c) => !c.is_active).forEach((c) => e.target.checked ? n.add(c.id) : n.delete(c.id)); return n; })} /></th>
                <th>Client</th><th>Notes</th><th></th></tr></thead>
              <tbody>
                {clients.filter((c) => !c.is_active).map((c) => (
                  <tr key={c.id}>
                    <td><input type="checkbox" aria-label={`Select ${c.subdomain}`} checked={sel.has(c.id)} onChange={() => toggleSel(c.id)} /></td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                        <span className="sa-dot sa-dot--off" title="Disabled" />
                        <div>
                          <strong>{c.subdomain}</strong>
                          <div className="client-domain">{c.custom_domain || `${c.subdomain}.${PLATFORM_DOMAIN}`}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ maxWidth: 220 }}>{notes[c.id]
                      ? <span title={notes[c.id]} style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13 }}>{notes[c.id]}</span>
                      : <span style={{ color: "var(--muted)" }}>—</span>}</td>
                    <td>
                      <div className="row-actions">
                        <Button variant="primary" size="sm" disabled={busy} onClick={() => toggleActive(c)}>Enable</Button>
                        <button className="icon-btn" onClick={() => setInfo(c)} title="Client info">{Icon.eye({})}</button>
                        <button className="icon-btn" onClick={() => openEdit(c)} title="Edit">{Icon.edit({})}</button>
                        <button className="icon-btn icon-btn--danger" onClick={() => deleteClient(c)} title="Delete">{Icon.trash({})}</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {clients.filter((c) => !c.is_active).length === 0 && <tr><td colSpan={4} style={{ color: "var(--muted)", textAlign: "center", padding: 32 }}>All clients are online. 🎉</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {view === "list" && (
        <div>
          <div className="sa-toolbar">
            <div className="sa-search">{Icon.search({})}<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search clients by subdomain…" /></div>
            {sel.size > 0 && <Button variant="ghost" size="sm" disabled={busy} onClick={deleteSelected} style={{ color: "#e5484d", borderColor: "#e5484d" }}>{Icon.trash({})} Delete selected ({sel.size})</Button>}
            <Button variant="primary" size="sm" onClick={() => setView("add")}>{Icon.check({})} Add client</Button>
          </div>
          <div className="panel" style={{ marginBottom: 10 }}>
            <div className="panel__body--flush table-wrap">
              <table className="tbl tbl--clients">
                <thead><tr>
                  <th style={{ width: 34 }}><input type="checkbox" aria-label="Select all on this page"
                    checked={pg.pageItems.length > 0 && pg.pageItems.every((c) => sel.has(c.id))}
                    onChange={(e) => setSel((p) => { const n = new Set(p); pg.pageItems.forEach((c) => e.target.checked ? n.add(c.id) : n.delete(c.id)); return n; })} /></th>
                  <th>Client</th><th>Email</th><th>Password</th><th>Notes</th><th></th></tr></thead>
                <tbody>
                  {pg.pageItems.map((c) => (
                    <tr key={c.id}>
                      <td><input type="checkbox" aria-label={`Select ${c.subdomain}`} checked={sel.has(c.id)} onChange={() => toggleSel(c.id)} /></td>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                          <span className={"sa-dot" + (c.is_active ? "" : " sa-dot--off")} title={c.is_active ? "Active" : "Disabled"} />
                          <div>
                            <strong>{c.subdomain}</strong>{!c.is_active && <span className="tag tag--hidden" style={{ marginLeft: 8 }}>Disabled</span>}
                            <div className="client-domain">{c.custom_domain || `${c.subdomain}.${PLATFORM_DOMAIN}`}</div>
                          </div>
                        </div>
                      </td>
                      <td style={{ maxWidth: 200 }}>{c.owner_email
                        ? <span className="client-domain" title={c.owner_email} style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13 }}>{c.owner_email}</span>
                        : <span style={{ color: "var(--muted)", fontSize: 13 }}>no login</span>}</td>
                      {/* Auth passwords are hashed and can't be shown — offer a
                          set/reset that opens the edit modal's Access tab. */}
                      <td>
                        <Button variant="ghost" size="sm" onClick={() => { openEdit(c); setEditTab("access"); }}>
                          {c.owner_email ? "Reset" : "Set login"}
                        </Button>
                      </td>
                      <td style={{ maxWidth: 180 }}>{notes[c.id]
                        ? <span title={notes[c.id]} style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13 }}>{notes[c.id]}</span>
                        : <span style={{ color: "var(--muted)" }}>—</span>}</td>
                      <td>
                        <div className="row-actions">
                          <button className={"icon-btn" + (c.is_active ? "" : " icon-btn--danger")} onClick={() => toggleActive(c)} title={c.is_active ? "Disable access (take site offline)" : "Enable access (put site live)"} aria-pressed={c.is_active}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M12 3.5v8" /><path d="M6.6 6.8a8 8 0 1 0 10.8 0" /></svg>
                          </button>
                          <a className="icon-btn" href={`/admin?client=${c.subdomain}`} title="Open admin">{Icon.grid({})}</a>
                          <button className="icon-btn" onClick={() => setInfo(c)} title="Client info">{Icon.eye({})}</button>
                          <button className="icon-btn" onClick={() => openEdit(c)} title="Edit">{Icon.edit({})}</button>
                          <button className="icon-btn icon-btn--danger" onClick={() => deleteClient(c)} title="Delete">{Icon.trash({})}</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && <tr><td colSpan={6} style={{ textAlign: "center", padding: 40, color: "var(--muted)" }}>{clients.length ? "No matches." : "No clients yet — use “Add client”."}</td></tr>}
                </tbody>
              </table>
            </div>
            <Pager page={pg.page} totalPages={pg.totalPages} total={pg.total} perPage={pg.perPage} start={pg.start} onPage={pg.setPage} noun="clients" />
          </div>
          <div className="sa-tablefoot">Total: {clients.length} client{clients.length === 1 ? "" : "s"}</div>
        </div>
      )}

      {view === "add" && (
        <div className="panel sa-form">
          <div className="panel__head"><div><div className="panel__title">Add a client</div><div className="panel__sub">Provision a new client site and, optionally, its owner login.</div></div></div>
          <form onSubmit={createClient} className="panel__body form-rows" style={{ paddingTop: 6, paddingBottom: 22 }}>
            <div className="form-row">
              <div className="form-row__head">
                <div className="form-row__label">Project</div>
                <div className="form-row__desc">The subdomain and event type for this client's site.</div>
              </div>
              <div className="form-row__fields">
                <div className="form-grid2">
                  <Field label="Subdomain" id="c-sub" hint={`→ ${form.subdomain.trim() ? form.subdomain.trim().toLowerCase() : "name"}.${PLATFORM_DOMAIN}`}>
                    <Input id="c-sub" value={form.subdomain} onChange={(e) => setForm((f) => ({ ...f, subdomain: e.target.value }))} placeholder="johnandjane" />
                  </Field>
                  <Field label="Event type" id="c-evt">
                    <Select id="c-evt" value={form.event_type} onChange={(e) => setForm((f) => ({ ...f, event_type: e.target.value, template_key: themesForEvent(e.target.value)[0] }))}>
                      {["wedding", "birthday", "corporate"].map((t) => <option key={t} value={t}>{t}</option>)}
                    </Select>
                  </Field>
                </div>
              </div>
            </div>
            <div className="form-row">
              <div className="form-row__head">
                <div className="form-row__label">Owner login</div>
                <div className="form-row__desc">Credentials the client signs in with. Optional now — you can set them later.</div>
              </div>
              <div className="form-row__fields">
                <div className="form-grid2">
                  <Field label="Owner email" id="c-oemail"><Input id="c-oemail" type="email" value={form.ownerEmail} onChange={(e) => setForm((f) => ({ ...f, ownerEmail: e.target.value }))} placeholder="owner@theirdomain" /></Field>
                  <Field label="Owner password" id="c-opw"><Input id="c-opw" value={form.ownerPassword} onChange={(e) => setForm((f) => ({ ...f, ownerPassword: e.target.value }))} placeholder="••••••••" /></Field>
                </div>
              </div>
            </div>
            <div className="form-row">
              <div className="form-row__head">
                <div className="form-row__label">Note</div>
                <div className="form-row__desc">Private to superadmin — never shown on the client's site or to the owner.</div>
              </div>
              <div className="form-row__fields">
                <Field label="Note (optional)" id="c-note"><Textarea id="c-note" value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} placeholder="e.g. Paid via GCash · event Sept 19 · contact on Messenger" /></Field>
              </div>
            </div>
            <div className="form-foot">
              <Button type="button" variant="ghost" onClick={() => setView("list")}>Cancel</Button>
              <Button type="submit" variant="primary" disabled={busy}>{busy ? "Creating…" : "Create client"}</Button>
            </div>
          </form>
        </div>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} label="Edit client" wide>
        {editing && (() => {
          // Feed the client through the SAME wizard as the request editor by
          // shaping it like a site_requests row (couple names live in content).
          const clientReq = {
            partner_a: editing.content?.partnerA || "", partner_b: editing.content?.partnerB || "",
            email: editing.owner_email || "", subdomain: editing.subdomain,
            template_key: editing.template_key, content: editing.content || {},
          };
          return (
          <div>
            <div className="folders" style={{ marginBottom: 18 }}>
              <button type="button" className={"folder" + (editTab === "design" ? " folder--active" : "")} onClick={() => setEditTab("design")}>{Icon.grid({})} Design</button>
              <button type="button" className={"folder" + (editTab === "access" ? " folder--active" : "")} onClick={() => setEditTab("access")}>{Icon.check({})} Access</button>
            </div>
            {/* Design = the same intake wizard as the request editor. Kept mounted
                (hidden) so switching to Access doesn't reset its steps. */}
            <div style={{ display: editTab === "design" ? "block" : "none" }}>
              <ApplyWizard initial={clientReq} onCancel={() => setEditing(null)} onSave={saveClientDesign} />
            </div>
            {/* Access = shared AccessFields (identical to the request editor) plus
                the client-only owner password reset + private note. */}
            <div style={{ display: editTab === "access" ? "block" : "none" }}>
              <div className="form-rows">
                <AccessFields v={editForm} set={(patch) => setEditForm((f) => ({ ...f, ...patch }))} omit={["strictRsvp"]} />
                <div className="form-foot">
                  <Button type="button" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                  <Button type="button" variant="primary" disabled={busy} onClick={saveClientAccess}>{busy ? "Saving…" : "Save changes"}</Button>
                </div>
              </div>
            </div>
          </div>
          );
        })()}
      </Modal>

      {/* Eye icon → read-only snapshot of the client (links + quick Edit). */}
      <Modal open={!!info} onClose={() => setInfo(null)} label="Client info">
        {info && (() => {
          const c = info;
          const modsOn = MODULES.filter((m) => c.content?.modules?.[m] !== false).map(moduleLabel);
          const row = { display: "flex", gap: 12, padding: "9px 0", borderBottom: "1px solid var(--line)", fontSize: 14 };
          const lab = { flex: "none", width: 110, color: "var(--muted)", fontSize: 12, letterSpacing: ".06em", textTransform: "uppercase", paddingTop: 2 };
          return (
            <div>
              <SectionHead eyebrow="Client" title={c.subdomain} />
              <div style={{ marginTop: -6 }}>
                <div style={row}><span style={lab}>Live site</span><a href={clientUrl(c.subdomain)} target="_blank" rel="noreferrer">{c.custom_domain || `${c.subdomain}.${PLATFORM_DOMAIN}`}</a></div>
                <div style={row}><span style={lab}>Status</span><span className={"tag " + (c.is_active ? "tag--attending" : "tag--hidden")}>{c.is_active ? "Active" : "Disabled"}</span></div>
                <div style={row}><span style={lab}>Event type</span><span style={{ textTransform: "capitalize" }}>{c.event_type}</span></div>
                <div style={row}><span style={lab}>Theme</span><span>{THEMES[c.template_key]?.label || c.template_key}</span></div>
                <div style={row}><span style={lab}>Couple</span><span>{[c.content?.partnerA, c.content?.partnerB].filter(Boolean).join(" & ") || <span style={{ color: "var(--muted)" }}>—</span>}</span></div>
                <div style={row}><span style={lab}>Owner login</span><span>{c.owner_email || <span style={{ color: "var(--muted)" }}>none yet</span>}</span></div>
                <div style={row}><span style={lab}>Contact</span><span>{c.content?.phone || <span style={{ color: "var(--muted)" }}>—</span>}</span></div>
                <div style={row}><span style={lab}>Wedding date</span><span>{c.content?.weddingDateLabel || c.content?.weddingDate || <span style={{ color: "var(--muted)" }}>—</span>}</span></div>
                <div style={row}><span style={lab}>Venue</span><span>{[c.content?.venueName, c.content?.venueAddress].filter(Boolean).join(", ") || <span style={{ color: "var(--muted)" }}>—</span>}</span></div>
                <div style={row}><span style={lab}>Created</span><span>{c.created_at ? new Date(c.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—"}</span></div>
                <div style={row}><span style={lab}>Modules</span><span>{modsOn.length ? modsOn.join(", ") : "none"}</span></div>
                {notes[c.id] && <div style={row}><span style={lab}>Note</span><span>{notes[c.id]}</span></div>}
              </div>
              <div style={{ display: "flex", gap: 10, marginTop: 18, flexWrap: "wrap" }}>
                <Button variant="primary" onClick={() => { setInfo(null); openEdit(c); }}>{Icon.edit({})} Edit client</Button>
                <a className="btn btn--ghost" href={clientUrl(c.subdomain)} target="_blank" rel="noreferrer">{Icon.eye({})} Open live site</a>
                <a className="btn btn--ghost" href={`/admin?client=${c.subdomain}`}>{Icon.grid({})} Open admin</a>
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* Eye on a request row → everything the prospect filled in the wizard. */}
      <Modal open={!!reqInfo} onClose={() => setReqInfo(null)} label="Request details">
        {reqInfo && (() => {
          const r = reqInfo;
          const c = r.content || {};
          const row = { display: "flex", gap: 12, padding: "9px 0", borderBottom: "1px solid var(--line)", fontSize: 14 };
          const lab = { flex: "none", width: 110, color: "var(--muted)", fontSize: 12, letterSpacing: ".06em", textTransform: "uppercase", paddingTop: 2 };
          const sched = Array.isArray(c.schedule) ? c.schedule.filter((x) => x && x.title) : [];
          const ent = Array.isArray(c.entourage) ? c.entourage : [];
          return (
            <div>
              <SectionHead eyebrow="Site request" title={`${r.partner_a}${r.partner_b ? ` & ${r.partner_b}` : ""}`} />
              <div style={{ marginTop: -6 }}>
                <div style={row}><span style={lab}>Status</span><span className={"tag " + (r.status === "pending" ? "tag--maybe" : r.status === "approved" ? "tag--attending" : "tag--not_attending")}>{r.status}</span></div>
                <div style={row}><span style={lab}>Site address</span><span className="client-domain">{r.subdomain}.{PLATFORM_DOMAIN}</span></div>
                <div style={row}><span style={lab}>Email</span><span>{r.email || "—"}</span></div>
                <div style={row}><span style={lab}>Contact</span><span>{c.phone || "—"}</span></div>
                <div style={row}><span style={lab}>Date</span><span>{c.weddingDateLabel || c.weddingDate || "Not set"}</span></div>
                <div style={row}><span style={lab}>Theme</span><span>{THEMES[r.template_key]?.label || r.template_key}</span></div>
                <div style={row}><span style={lab}>Venue</span><span>{[c.venueName, c.venueAddress].filter(Boolean).join(" — ") || "Not set"}</span></div>
                <div style={row}><span style={lab}>Map pin</span><span>{c.mapQuery ? `${c.mapQuery} (${c.mapLat}, ${c.mapLng})` : "Not pinned"}</span></div>
                <div style={row}><span style={lab}>RSVP</span><span>{c.strictRsvp ? "Strict (invited guests only)" : "Open"}</span></div>
                <div style={row}>
                  <span style={lab}>Schedule</span>
                  <span>{sched.length ? sched.map((x, i) => <span key={i} style={{ display: "block" }}>{[x.time, x.title].filter(Boolean).join(" — ")}{x.loc ? ` · ${x.loc}` : ""}</span>) : "None"}</span>
                </div>
                <div style={row}>
                  <span style={lab}>Entourage</span>
                  <span>{ent.length ? ent.map((g) => (
                    <span key={g.id || g.title} style={{ display: "block", marginBottom: 6 }}>
                      <strong>{g.title}</strong>
                      {(g.people || []).map((x, i) => <span key={x.id || i} style={{ display: "block", color: "var(--ink-soft)" }}>{x.name}{x.role ? ` — ${x.role}` : ""}</span>)}
                    </span>
                  )) : "Skipped"}</span>
                </div>
                <div style={row}><span style={lab}>Submitted</span><span>{new Date(r.created_at).toLocaleString()}</span></div>
              </div>
              <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
                <Button variant="primary" onClick={() => { setReqInfo(null); openReqEdit(r); }}>{Icon.edit({})} Edit request</Button>
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* Pencil on a pending request → the FULL /apply wizard, prefilled, as the
          editor. One component, one payload serializer (requestPayload), so any
          field added to the wizard is automatically editable here too. */}
      <Modal open={!!reqEdit} onClose={() => setReqEdit(null)} label="Edit request" wide>
        {reqEdit && reqAccess && (
          <div>
            <div className="folders" style={{ marginBottom: 18 }}>
              <button type="button" className={"folder" + (reqEditTab === "design" ? " folder--active" : "")} onClick={() => setReqEditTab("design")}>{Icon.grid({})} Design</button>
              <button type="button" className={"folder" + (reqEditTab === "access" ? " folder--active" : "")} onClick={() => setReqEditTab("access")}>{Icon.check({})} Access</button>
            </div>
            {/* Design = the full intake wizard (all request fields). Kept mounted and
                hidden (not unmounted) so switching to Access doesn't reset its steps. */}
            <div style={{ display: reqEditTab === "design" ? "block" : "none" }}>
              <ApplyWizard
                initial={reqEdit}
                onCancel={() => setReqEdit(null)}
                onSave={async (p) => {
                  if (!isValidSubdomain(p.subdomain)) throw new Error("Invalid subdomain — lowercase letters, numbers, hyphens; not a reserved name.");
                  await updateSiteRequest(reqEdit.id, {
                    partner_a: p.partnerA, partner_b: p.partnerB, subdomain: p.subdomain,
                    email: p.email, template_key: p.templateKey,
                    // merge so the Access-tab keys (modules/ownerEdit/…) the wizard
                    // doesn't manage survive a Design save.
                    content: { ...(reqEdit.content || {}), ...p.content },
                  });
                  toast("Request updated", "success");
                  setReqEdit(null);
                  await load();
                }}
              />
            </div>
            {/* Access = the same shared settings as the client editor; its own Save
                merges into the request's content (Strict RSVP lives in the wizard). */}
            <div style={{ display: reqEditTab === "access" ? "block" : "none" }}>
              <div className="form-rows">
                <AccessFields v={reqAccess} set={(patch) => setReqAccess((a) => ({ ...a, ...patch }))} omit={["strictRsvp"]} passwordEnabled={false} />
                <div className="form-foot">
                  <Button type="button" variant="ghost" onClick={() => setReqEdit(null)}>Cancel</Button>
                  <Button type="button" variant="primary" disabled={busy} onClick={() => runBusy("Saving…", async () => {
                    const content = {
                      ...(reqEdit.content || {}),
                      modules: reqAccess.modules,
                      autoApproveMedia: reqAccess.autoApproveMedia,
                      autoApproveGuestbook: reqAccess.autoApproveGuestbook,
                      uploadsEnabled: reqAccess.uploadsEnabled,
                      galleryEnabled: reqAccess.galleryEnabled,
                      ownerEdit: reqAccess.ownerEdit || {},
                      note: reqAccess.note || "",
                    };
                    await updateSiteRequest(reqEdit.id, { content });
                    setReqEdit((r) => (r ? { ...r, content } : r)); // keep local row in sync for a later Design save
                    toast("Access settings saved", "success");
                    await load();
                  })}>{busy ? "Saving…" : "Save changes"}</Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Trash on a request row → type the site address to confirm the delete. */}
      <Modal open={!!delReq} onClose={() => setDelReq(null)} label="Delete request">
        {delReq && (() => {
          const r = delReq.r;
          const match = delReq.typed.trim().toLowerCase() === (r.subdomain || "").toLowerCase();
          return (
            <div>
              <SectionHead eyebrow="Danger zone" title="Delete this request?" />
              <p style={{ color: "var(--ink-soft)", fontSize: 14, marginTop: -6 }}>
                This permanently removes the request from <strong>{r.partner_a}{r.partner_b ? ` & ${r.partner_b}` : ""}</strong>
                {" "}({r.subdomain}.{PLATFORM_DOMAIN}). It can't be undone.
                {r.status === "approved" ? " The live site created from it is NOT affected — manage that in Clients." : ""}
              </p>
              <Field label={`Type ${r.subdomain} to confirm`} id="del-req-confirm">
                <Input id="del-req-confirm" value={delReq.typed} spellCheck={false} autoComplete="off"
                  placeholder={r.subdomain}
                  onChange={(e) => setDelReq((d) => ({ ...d, typed: e.target.value }))} />
              </Field>
              <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
                <Button variant="primary" block disabled={!match || busy} onClick={async () => {
                  setBusy(true);
                  try { await deleteSiteRequest(r.id); toast("Request deleted", "success"); setDelReq(null); await load(); }
                  catch (e) { toast("Delete failed: " + (e.message || "error"), "err"); }
                  finally { setBusy(false); }
                }}>{busy ? "Deleting…" : "Delete request"}</Button>
                <Button variant="ghost" onClick={() => setDelReq(null)}>Cancel</Button>
              </div>
            </div>
          );
        })()}
      </Modal>

    </div>
  );
}

export function R2LibraryAdmin() {
  const [type, setType] = useState("image");
  const [clientFilter, setClientFilter] = useState("");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [playingKey, setPlayingKey] = useState(null);   // audio tile currently playing
  const audioRef = useRef(null);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    setPlayingKey(null);   // switching type unmounts the <audio>, so drop stale play state
    listMedia(null, type, { usage: true })
      .then((data) => { if (live) { setItems(data); setLoading(false); } })
      .catch((e) => { if (live) { setError((e && e.message) || "load failed"); setLoading(false); } });
    return () => { live = false; };
  }, [type]);

  function togglePlay(it) {
    const a = audioRef.current;
    if (!a) return;
    if (playingKey === it.key) { a.pause(); setPlayingKey(null); return; }
    a.src = mediaUrl(it.key);
    a.play().then(() => setPlayingKey(it.key)).catch(() => setPlayingKey(null));
  }

  const visible = clientFilter.trim()
    ? items.filter((it) => it.key.split("/")[0].toLowerCase().includes(clientFilter.trim().toLowerCase()))
    : items;

  // Blocking popup for a file that's still referenced by a client's site. Also
  // marks the item inUse locally (covers the 409 race where usage changed after
  // the list loaded), so the button stays a hard block afterwards.
  function blockInUse(item, usedBy) {
    if (usedBy) setItems((prev) => prev.map((it) => (it.key === item.key ? { ...it, inUse: true, usedBy } : it)));
    return confirmDialog({
      title: "In use — can't delete",
      message: `"${fileNameFromKey(item.key)}" is being used on a client's site, so it can't be deleted.`,
      confirmLabel: "OK",
      okOnly: true,
      error: true,   // red X seal, not the green check
    });
  }

  function onDeleteClick(item) {
    if (item.inUse) { blockInUse(item); return; }   // pre-marked: no server call
    doDelete(item);
  }

  async function doDelete(item) {
    const key = item.key;
    const ok = await confirmDialog({
      title: "Delete file?",
      message: `Delete "${fileNameFromKey(key)}"? Removes from R2 — cannot be undone.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    setDeleting(key);
    try {
      await deleteFromR2(key);
      setItems((prev) => prev.filter((it) => it.key !== key));
      toast("File deleted");
    } catch (e) {
      if (e && e.code === "in_use") { await blockInUse(item, e.usedBy); }   // server hard-block backstop
      else { toast("Delete failed: " + ((e && e.message) || "error")); }
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div>
      <div className="panel">
        <div className="panel__head">
          <div className="panel__title">
            R2 Media Library
            <span style={{ color: "var(--muted)", fontSize: 15, marginLeft: 8 }}>({visible.length})</span>
          </div>
        </div>
        <div className="panel__body" style={{ paddingBottom: 8 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
            <div role="tablist" style={{ display: "flex", gap: 4 }}>
              {[{ key: "image", label: "Images" }, { key: "audio", label: "Audio" }].map((t) => (
                <button
                  key={t.key}
                  role="tab"
                  aria-selected={type === t.key}
                  className={"medialib__tab" + (type === t.key ? " is-on" : "")}
                  onClick={() => setType(t.key)}
                >{t.label}</button>
              ))}
            </div>
            <input
              className="input"
              style={{ maxWidth: 220, flex: "1 1 140px" }}
              value={clientFilter}
              onChange={(e) => setClientFilter(e.target.value)}
              placeholder="Filter by client…"
            />
          </div>

          {loading && <p className="medialib__msg">Loading…</p>}
          {!loading && error && <p className="medialib__msg medialib__msg--err">{error}</p>}
          {!loading && !error && visible.length === 0 && <p className="medialib__msg">No files.</p>}

          {!loading && !error && type === "audio" && visible.length > 0 && (
            <div className="medialib medialib--grid">
              {visible.map((it) => {
                const playing = playingKey === it.key;
                return (
                  <div
                    key={it.key}
                    className={"medialib__cell medialib__cell--audio" + (playing ? " is-playing" : "")}
                    title={it.inUse ? `${it.name} — in use by ${it.usedBy || "a client"}` : it.name}
                  >
                    <div className="medialib__art">
                      {it.inUse && <span className="tag tag--hidden medialib__badge">In use</span>}
                      <button
                        type="button"
                        className={"icon-btn medialib__del" + (it.inUse ? "" : " icon-btn--danger")}
                        aria-label="Delete"
                        title={it.inUse ? `In use by ${it.usedBy || "a client"} — can't delete` : "Delete"}
                        disabled={deleting === it.key}
                        onClick={() => onDeleteClick(it)}
                      >{Icon.trash({})}</button>
                      <span className="medialib__wave" aria-hidden="true">
                        {Array.from({ length: 7 }).map((_, i) => <i key={i} />)}
                      </span>
                      <button
                        type="button"
                        className="medialib__play"
                        aria-label={playing ? "Pause" : "Play"}
                        onClick={() => togglePlay(it)}
                      >{(playing ? Icon.pause : Icon.play)({})}</button>
                    </div>
                    <span className="medialib__name" title={it.name}>{it.name}</span>
                    <span className="medialib__sub">{it.key.split("/")[0]}</span>
                  </div>
                );
              })}
              <audio ref={audioRef} onEnded={() => setPlayingKey(null)} preload="none" />
            </div>
          )}

          {!loading && !error && type === "image" && visible.length > 0 && (
            <div className="medialib medialib--grid">
              {visible.map((it) => (
                <div key={it.key} className="medialib__cell" title={it.inUse ? `${it.name} — in use by ${it.usedBy || "a client"}` : it.name} style={{ position: "relative" }}>
                  <img src={mediaUrl(it.key)} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = "none"; }} />
                  <span className="medialib__name">{it.name}</span>
                  <span style={{ fontSize: 11, color: "var(--muted)", display: "block" }}>{it.key.split("/")[0]}</span>
                  {it.inUse && <span className="tag tag--hidden" style={{ position: "absolute", top: 4, left: 4 }}>In use</span>}
                  <button
                    type="button"
                    className={"icon-btn" + (it.inUse ? "" : " icon-btn--danger")}
                    aria-label="Delete"
                    title={it.inUse ? `In use by ${it.usedBy || "a client"} — can't delete` : "Delete"}
                    style={{ position: "absolute", top: 4, right: 4, background: "rgba(255,255,255,.85)" }}
                    disabled={deleting === it.key}
                    onClick={() => onDeleteClick(it)}
                  >{Icon.trash({})}</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
