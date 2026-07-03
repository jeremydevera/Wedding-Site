import React from "react";
import { supabase } from "@/lib/supabase.js";
import { createOwner, updateOwnerEmail, deleteOwner } from "@/lib/auth.js";
import { THEMES } from "@/themes";
import { themesForEvent } from "@/config/eventTypes.js";
import { moduleLabel } from "@/lib/roles.js";
import { PLATFORM_DOMAIN, clientUrl, isValidSubdomain } from "@/config/site.js"; // platform config → src/config/site.js
import { Button, confirmDialog, Field, Icon, Input, Pager, Select, Textarea, toast, usePaged } from "@/ui/components.jsx";
import { listMedia, deleteFromR2, listSiteRequests, approveSiteRequest, setSiteRequestStatus } from "@/lib/api.js";
import { fileNameFromKey } from "@/lib/mediaLibrary.js";
import { mediaUrl } from "@/lib/media.js";
const { useState, useEffect, useRef } = React;

const MODULES = ["story", "details", "schedule", "venue", "gallery", "guestbook", "quiz", "rsvp"];

export function SuperOverview() {
  const [m, setM] = useState(null);
  const [byType, setByType] = useState({});
  const [recent, setRecent] = useState([]);
  useEffect(() => {
    (async () => {
      const cnt = async (t) => { const { count } = await supabase.from(t).select("*", { count: "exact", head: true }); return count || 0; };
      const { data } = await supabase.from("clients").select("id,subdomain,event_type,is_active,owner_email,created_at").order("created_at", { ascending: false });
      const list = data || [];
      const bt = {}; list.forEach((c) => { bt[c.event_type] = (bt[c.event_type] || 0) + 1; });
      const [rsvps, guestbook, quiz] = await Promise.all([cnt("rsvps"), cnt("guestbook"), cnt("quiz_answers")]);
      setByType(bt); setRecent(list.slice(0, 6));
      setM({ clients: list.length, active: list.filter((c) => c.is_active).length, logins: list.filter((c) => c.owner_email).length, rsvps, guestbook, quiz });
    })();
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
              <thead><tr><th>Client</th><th>Type</th><th>Owner login</th><th></th></tr></thead>
              <tbody>
                {recent.map((c) => (
                  <tr key={c.id}>
                    <td><strong>{c.subdomain}</strong></td>
                    <td><span className="tag tag--hidden">{c.event_type}</span></td>
                    <td>{c.owner_email ? <span className="client-domain">{c.owner_email}</span> : <span style={{ color: "var(--muted)", fontSize: 13 }}>—</span>}</td>
                    <td><a className="icon-btn" href={`/admin?client=${c.subdomain}`} title="Open admin">{Icon.grid({})}</a></td>
                  </tr>
                ))}
                {recent.length === 0 && <tr><td colSpan={4} style={{ textAlign: "center", padding: 32, color: "var(--muted)" }}>No clients yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ClientsAdmin() {
  const [view, setView] = useState("list"); // list | add | owner | edit
  const [clients, setClients] = useState([]);
  const [notes, setNotes] = useState({}); // client_id -> note text (superadmin-only, from client_notes)
  const [form, setForm] = useState({ subdomain: "", event_type: "wedding", template_key: "classic", ownerEmail: "", ownerPassword: "", note: "" });
  const [cred, setCred] = useState({ client_id: "", email: "", password: "" });
  const [editing, setEditing] = useState(null);
  const [editForm, setEditForm] = useState({ subdomain: "", ownerEmail: "", ownerPassword: "", modules: {}, note: "" });
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [requests, setRequests] = useState([]);     // prospect intake (/apply) awaiting approval
  const [reqOpen, setReqOpen] = useState(null);      // expanded request id

  async function load() {
    const { data } = await supabase.from("clients").select("*").order("created_at", { ascending: false });
    setClients(data || []);
    try { setRequests(await listSiteRequests()); } catch (_) { /* non-superadmin or table missing */ }
    // Notes live in a superadmin-only table (never exposed to anon/owners).
    const { data: nd } = await supabase.from("client_notes").select("client_id,note");
    setNotes(Object.fromEntries((nd || []).map((r) => [r.client_id, r.note || ""])));
  }
  useEffect(() => { load(); }, []);

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
    }
    const { error } = await supabase.from("clients").update({ is_active: next }).eq("id", c.id);
    if (error) return toast("Update failed: " + error.message);
    toast(next ? "Access enabled — site is live" : "Access disabled — site is offline");
    load();
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
    setBusy(true);
    const { data: created, error } = await supabase.from("clients")
      .insert({ subdomain: sub, event_type: form.event_type, template_key: form.template_key }).select().single();
    if (error) { setBusy(false); return toast("Create failed: " + error.message); }
    if (form.note.trim()) { try { await saveNote(created.id, form.note); } catch (_) { /* note is best-effort */ } }
    if (form.ownerEmail.trim() && form.ownerPassword) {
      try {
        await createOwner({ email: form.ownerEmail.trim(), password: form.ownerPassword, client_id: created.id });
        await supabase.from("clients").update({ owner_email: form.ownerEmail.trim() }).eq("id", created.id);
        toast("Client + owner login created");
      } catch (e2) { toast("Client created — owner login pending:"); edgeOrToast(e2); }
    } else { toast("Client created"); }
    setBusy(false);
    setForm({ subdomain: "", event_type: "wedding", template_key: "classic", ownerEmail: "", ownerPassword: "", note: "" });
    await load(); setView("list");
  }

  async function assignTheme(id, template_key) {
    const { error } = await supabase.from("clients").update({ template_key }).eq("id", id);
    if (error) return toast("Update failed");
    toast("Theme assigned"); load();
  }
  async function changeType(c, event_type) {
    const { error } = await supabase.from("clients").update({ event_type, template_key: themesForEvent(event_type)[0] }).eq("id", c.id);
    if (error) return toast("Update failed");
    toast("Type updated"); load();
  }
  async function toggleModule(c, key, on) {
    const modules = { ...(c.content?.modules || {}), [key]: on };
    const { error } = await supabase.from("clients").update({ content: { ...(c.content || {}), modules } }).eq("id", c.id);
    if (error) return toast("Update failed");
    load();
  }

  async function setOwner(e) {
    e.preventDefault();
    if (busy || !cred.client_id || !cred.email || !cred.password) return;
    setBusy(true);
    try {
      await createOwner(cred);
      await supabase.from("clients").update({ owner_email: cred.email.trim() }).eq("id", cred.client_id);
      toast("Owner login set"); setCred({ client_id: "", email: "", password: "" }); load();
    } catch (e2) { edgeOrToast(e2); }
    finally { setBusy(false); }
  }

  function openEdit(c) {
    setEditing(c);
    setEditForm({ subdomain: c.subdomain, ownerEmail: c.owner_email || "", ownerPassword: "", modules: Object.fromEntries(MODULES.map((m) => [m, c.content?.modules?.[m] !== false])), note: notes[c.id] || "" });
    setView("edit");
  }
  async function saveEdit(e) {
    e.preventDefault();
    if (busy || !editing) return;
    setBusy(true);
    const id = editing.id;
    const sub = editForm.subdomain.trim().toLowerCase();
    if (sub && sub !== editing.subdomain) {
      const { error } = await supabase.from("clients").update({ subdomain: sub }).eq("id", id);
      if (error) { setBusy(false); return toast("Save failed: " + error.message); }
    }
    {
      const { error } = await supabase.from("clients").update({ content: { ...(editing.content || {}), modules: editForm.modules } }).eq("id", id);
      if (error) { setBusy(false); return toast("Save failed: " + error.message); }
    }
    try { await saveNote(id, editForm.note); } catch (_) { /* note is best-effort */ }
    const email = editForm.ownerEmail.trim();
    const pw = editForm.ownerPassword;
    try {
      if (pw) { // set owner / reset password (also sets email)
        const useEmail = email || editing.owner_email;
        if (!useEmail) throw new Error("Enter an owner email");
        await createOwner({ email: useEmail, password: pw, client_id: id });
        await supabase.from("clients").update({ owner_email: useEmail }).eq("id", id);
      } else if (email && email !== (editing.owner_email || "")) { // change email only
        if (editing.owner_email) await updateOwnerEmail({ old_email: editing.owner_email, new_email: email });
        await supabase.from("clients").update({ owner_email: email }).eq("id", id);
      }
      toast("Client updated");
    } catch (e2) { toast("Saved client info."); edgeOrToast(e2); }
    setBusy(false); setEditing(null); await load(); setView("list");
  }

  async function deleteClient(c) {
    const ok = await confirmDialog({
      title: "Delete client?",
      message: `Delete "${c.subdomain}" and all its data (RSVPs, guestbook, quiz) and its owner login? This can't be undone.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    // Remove the owner's auth account FIRST, while profiles.client_id still links
    // to this client (so the lookup works even when owner_email is null). Deleting
    // the auth user cascades its profile. Then delete the client (cascades its
    // RSVPs/guestbook/quiz). A noop is fine for clients that never had an owner.
    let ownerWarn = false;
    try {
      await deleteOwner({ email: c.owner_email || undefined, client_id: c.id });
    } catch (e2) {
      ownerWarn = true;
    }
    const { error } = await supabase.from("clients").delete().eq("id", c.id);
    if (error) return toast("Delete failed: " + error.message);
    toast(ownerWarn ? "Client deleted — owner login may remain; remove it in Supabase Auth." : "Client and owner login deleted");
    load();
  }

  const filtered = clients.filter((c) => c.subdomain.toLowerCase().includes(q.trim().toLowerCase()));
  const pg = usePaged(filtered, 20);

  return (
    <div className="sa">
      <div className="sa-tabs">
        {/* "Add client" is the toolbar button on the list — no duplicate tab */}
        <button className={view === "list" || view === "edit" || view === "add" ? "on" : ""} onClick={() => { setEditing(null); setView("list"); }}>Clients</button>
        <button className={view === "owner" ? "on" : ""} onClick={() => setView("owner")}>Owner login</button>
        <button className={view === "requests" ? "on" : ""} onClick={() => setView("requests")}>
          Requests{requests.filter((r) => r.status === "pending").length > 0 ? ` (${requests.filter((r) => r.status === "pending").length})` : ""}
        </button>
      </div>

      {view === "requests" && (
        <div className="panel">
          <div className="panel__head"><div className="panel__title">Site requests</div><span style={{ color: "var(--muted)", fontSize: 13 }}>Submitted from the /apply wizard — approve to create the site</span></div>
          <div className="panel__body--flush table-wrap">
            <table className="tbl">
              <thead><tr><th>Couple</th><th>Site address</th><th>Email</th><th>Theme</th><th>RSVP</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {requests.map((r) => (
                  <React.Fragment key={r.id}>
                    <tr>
                      <td><strong>{r.partner_a} & {r.partner_b}</strong></td>
                      <td className="client-domain">{r.subdomain}.celebrately.us</td>
                      <td>{r.email}</td>
                      <td>{r.template_key}</td>
                      <td>{r.content && r.content.strictRsvp ? "Strict" : "Open"}</td>
                      <td><span className={"tag " + (r.status === "pending" ? "tag--maybe" : r.status === "approved" ? "tag--attending" : "tag--not_attending")}>{r.status}</span></td>
                      <td>
                        <div className="row-actions">
                          <button className="icon-btn" title="Details" onClick={() => setReqOpen(reqOpen === r.id ? null : r.id)}>{Icon.eye({})}</button>
                          {r.status === "pending" && (
                            <>
                              <Button variant="primary" size="sm" disabled={busy} onClick={async () => {
                                const ok = await confirmDialog({ title: "Approve this site?", message: `Create ${r.subdomain}.celebrately.us for ${r.partner_a} & ${r.partner_b}? You'll still need to set the owner's login in Owner login.`, confirmLabel: "Approve & create" });
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
                        </div>
                      </td>
                    </tr>
                    {reqOpen === r.id && (
                      <tr><td colSpan={7} style={{ background: "var(--surface-2)" }}>
                        <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "8px 18px", padding: "12px 6px", fontSize: 13 }}>
                          <span style={{ color: "var(--muted)" }}>Date</span><span>{(r.content && r.content.weddingDateLabel) || "Not set"}</span>
                          <span style={{ color: "var(--muted)" }}>Venue</span><span>{[r.content && r.content.venueName, r.content && r.content.venueAddress].filter(Boolean).join(" — ") || "Not set"}</span>
                          <span style={{ color: "var(--muted)" }}>Map pin</span><span>{r.content && r.content.mapQuery ? `${r.content.mapQuery} (${r.content.mapLat}, ${r.content.mapLng})` : "Not pinned"}</span>
                          <span style={{ color: "var(--muted)" }}>Schedule</span><span>{Array.isArray(r.content && r.content.schedule) && r.content.schedule.length ? r.content.schedule.map((x) => `${x.time} ${x.title}`).join(" · ") : "None"}</span>
                          <span style={{ color: "var(--muted)" }}>Entourage</span><span>{Array.isArray(r.content && r.content.entourage) && r.content.entourage.length ? r.content.entourage.map((g) => `${g.title} (${g.people.length})`).join(" · ") : "Skipped"}</span>
                          <span style={{ color: "var(--muted)" }}>Submitted</span><span>{new Date(r.created_at).toLocaleString()}</span>
                        </div>
                      </td></tr>
                    )}
                  </React.Fragment>
                ))}
                {requests.length === 0 && <tr><td colSpan={7} style={{ color: "var(--muted)", textAlign: "center", padding: 32 }}>No requests yet — share celebrately.us/apply with a prospect.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {view === "list" && (
        <div>
          <div className="sa-toolbar">
            <div className="sa-search">{Icon.search({})}<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search clients by subdomain…" /></div>
            <Button variant="primary" size="sm" onClick={() => setView("add")}>{Icon.check({})} Add client</Button>
          </div>
          <div className="panel" style={{ marginBottom: 10 }}>
            <div className="panel__body--flush table-wrap">
              <table className="tbl tbl--clients">
                <thead><tr><th>Client</th><th>Theme</th><th>Owner login</th><th>Notes</th><th>Actions</th></tr></thead>
                <tbody>
                  {pg.pageItems.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                          <span className={"sa-dot" + (c.is_active ? "" : " sa-dot--off")} title={c.is_active ? "Active" : "Disabled"} />
                          <div>
                            <strong>{c.subdomain}</strong>{!c.is_active && <span className="tag tag--hidden" style={{ marginLeft: 8 }}>Disabled</span>}
                            <div className="client-domain">{c.custom_domain || `${c.subdomain}.${PLATFORM_DOMAIN}`}</div>
                          </div>
                        </div>
                      </td>
                      <td className="theme-cell"><Select value={c.template_key} onChange={(e) => assignTheme(c.id, e.target.value)}>{themesForEvent(c.event_type).filter((k) => THEMES[k]).map((k) => <option key={k} value={k}>{THEMES[k].label}</option>)}</Select></td>
                      <td>{c.owner_email ? <span className="client-domain">{c.owner_email}</span> : <span style={{ color: "var(--muted)" }}>—</span>}</td>
                      <td style={{ maxWidth: 180 }}>{notes[c.id]
                        ? <span title={notes[c.id]} style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13 }}>{notes[c.id]}</span>
                        : <span style={{ color: "var(--muted)" }}>—</span>}</td>
                      <td>
                        <div className="row-actions">
                          <button className={"icon-btn" + (c.is_active ? "" : " icon-btn--danger")} onClick={() => toggleActive(c)} title={c.is_active ? "Disable access (take site offline)" : "Enable access (put site live)"} aria-pressed={c.is_active}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M12 3.5v8" /><path d="M6.6 6.8a8 8 0 1 0 10.8 0" /></svg>
                          </button>
                          <a className="icon-btn" href={`/admin?client=${c.subdomain}`} title="Open admin">{Icon.grid({})}</a>
                          <a className="icon-btn" href={clientUrl(c.subdomain)} target="_blank" rel="noreferrer" title="Open live site">{Icon.eye({})}</a>
                          <button className="icon-btn" onClick={() => openEdit(c)} title="Edit">{Icon.edit({})}</button>
                          <button className="icon-btn icon-btn--danger" onClick={() => deleteClient(c)} title="Delete">{Icon.trash({})}</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && <tr><td colSpan={5} style={{ textAlign: "center", padding: 40, color: "var(--muted)" }}>{clients.length ? "No matches." : "No clients yet — use “Add client”."}</td></tr>}
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
              <Button type="submit" variant="primary" disabled={busy}>Create client</Button>
            </div>
          </form>
        </div>
      )}

      {view === "edit" && editing && (
        <div className="panel sa-form">
          <div className="panel__head"><div><div className="panel__title">Edit {editing.subdomain}</div><div className="panel__sub">Update the subdomain, modules, and owner login for this client.</div></div></div>
          <form onSubmit={saveEdit} className="panel__body form-rows" style={{ paddingTop: 6, paddingBottom: 22 }}>
            <div className="form-row">
              <div className="form-row__head">
                <div className="form-row__label">Project</div>
                <div className="form-row__desc">The client's subdomain.</div>
              </div>
              <div className="form-row__fields">
                <Field label="Subdomain" id="e-sub"><Input id="e-sub" value={editForm.subdomain} onChange={(e) => setEditForm((f) => ({ ...f, subdomain: e.target.value }))} /></Field>
              </div>
            </div>
            <div className="form-row">
              <div className="form-row__head">
                <div className="form-row__label">Modules</div>
                <div className="form-row__desc">Sections shown on this client's site. Toggle to enable or hide.</div>
              </div>
              <div className="form-row__fields">
                <div className="mod-toggles mod-toggles--edit">
                  {MODULES.map((m) => {
                    const on = editForm.modules?.[m] !== false;
                    return (
                      <label key={m} className={"mod-pill" + (on ? " mod-pill--on" : "")}>
                        <input type="checkbox" checked={on} onChange={(e) => setEditForm((f) => ({ ...f, modules: { ...f.modules, [m]: e.target.checked } }))} /> {moduleLabel(m)}
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="form-row">
              <div className="form-row__head">
                <div className="form-row__label">Owner login</div>
                <div className="form-row__desc">Change the owner email or reset the password. Passwords can't be viewed.</div>
              </div>
              <div className="form-row__fields">
                <div className="form-grid2">
                  <Field label="Owner email" id="e-oemail"><Input id="e-oemail" type="email" value={editForm.ownerEmail} onChange={(e) => setEditForm((f) => ({ ...f, ownerEmail: e.target.value }))} placeholder="owner@theirdomain" /></Field>
                  <Field label="New password" id="e-opw" hint="Leave blank to keep current"><Input id="e-opw" value={editForm.ownerPassword} onChange={(e) => setEditForm((f) => ({ ...f, ownerPassword: e.target.value }))} placeholder="••••••••" /></Field>
                </div>
              </div>
            </div>
            <div className="form-row">
              <div className="form-row__head">
                <div className="form-row__label">Note</div>
                <div className="form-row__desc">Private to superadmin — never shown on the client's site or to the owner.</div>
              </div>
              <div className="form-row__fields">
                <Field label="Note (optional)" id="e-note"><Textarea id="e-note" value={editForm.note} onChange={(e) => setEditForm((f) => ({ ...f, note: e.target.value }))} placeholder="Add a private note about this client…" /></Field>
              </div>
            </div>
            <div className="form-foot">
              <Button type="button" variant="ghost" onClick={() => { setEditing(null); setView("list"); }}>Cancel</Button>
              <Button type="submit" variant="primary" disabled={busy}>Save changes</Button>
            </div>
          </form>
        </div>
      )}

      {view === "owner" && (
        <div className="panel sa-form">
          <div className="panel__head"><div><div className="panel__title">Set a client's owner login</div><div className="panel__sub">Assign or reset the sign-in credentials for an existing client.</div></div></div>
          <form onSubmit={setOwner} className="panel__body form-rows" style={{ paddingTop: 6, paddingBottom: 22 }}>
            <div className="form-row">
              <div className="form-row__head">
                <div className="form-row__label">Client</div>
                <div className="form-row__desc">Which client this login belongs to.</div>
              </div>
              <div className="form-row__fields">
                <Field label="Client" id="o-client">
                  <Select id="o-client" value={cred.client_id} onChange={(e) => setCred((c) => ({ ...c, client_id: e.target.value }))}>
                    <option value="">Select…</option>
                    {clients.map((c) => <option key={c.id} value={c.id}>{c.subdomain}</option>)}
                  </Select>
                </Field>
              </div>
            </div>
            <div className="form-row">
              <div className="form-row__head">
                <div className="form-row__label">Owner login</div>
                <div className="form-row__desc">The email and password the client uses to sign in.</div>
              </div>
              <div className="form-row__fields">
                <div className="form-grid2">
                  <Field label="Owner email" id="o-email"><Input id="o-email" type="email" value={cred.email} onChange={(e) => setCred((c) => ({ ...c, email: e.target.value }))} placeholder="owner@theirdomain" /></Field>
                  <Field label="Password" id="o-pw"><Input id="o-pw" value={cred.password} onChange={(e) => setCred((c) => ({ ...c, password: e.target.value }))} placeholder="••••••••" /></Field>
                </div>
              </div>
            </div>
            <div className="form-foot">
              <Button type="submit" variant="primary" disabled={busy}>Set owner login</Button>
            </div>
          </form>
        </div>
      )}
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
