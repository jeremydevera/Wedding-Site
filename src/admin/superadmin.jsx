import React from "react";
import { supabase } from "@/lib/supabase.js";
import { createOwner, updateOwnerEmail } from "@/lib/auth.js";
import { THEMES } from "@/themes";
import { themesForEvent } from "@/config/eventTypes.js";
import { Button, Field, Icon, Input, Select, toast } from "@/ui/components.jsx";
const { useState, useEffect } = React;

const MODULES = ["story", "details", "schedule", "venue", "gallery", "guestbook", "quiz", "rsvp"];
// Base domain client subdomains live under (rename when you register your platform domain).
const PLATFORM_DOMAIN = "celebrate.app";

export function ClientsAdmin() {
  const [view, setView] = useState("list"); // list | add | owner | edit
  const [clients, setClients] = useState([]);
  const [form, setForm] = useState({ subdomain: "", event_type: "wedding", template_key: "classic", ownerEmail: "", ownerPassword: "" });
  const [cred, setCred] = useState({ client_id: "", email: "", password: "" });
  const [editing, setEditing] = useState(null);
  const [editForm, setEditForm] = useState({ subdomain: "", ownerEmail: "", ownerPassword: "" });
  const [busy, setBusy] = useState(false);

  async function load() {
    const { data } = await supabase.from("clients").select("*").order("created_at", { ascending: false });
    setClients(data || []);
  }
  useEffect(() => { load(); }, []);

  function edgeOrToast(e2) {
    const msg = e2?.message || "error";
    if (/failed to send|function not found|non-2xx|not found|fetch|edge/i.test(msg))
      toast("Owner login needs the edge function deployed (admin-create-owner) — or do it in Supabase Auth.");
    else toast("Failed: " + msg);
  }

  async function createClient(e) {
    e.preventDefault();
    if (busy || !form.subdomain.trim()) return;
    setBusy(true);
    const sub = form.subdomain.trim().toLowerCase();
    const { data: created, error } = await supabase.from("clients")
      .insert({ subdomain: sub, event_type: form.event_type, template_key: form.template_key }).select().single();
    if (error) { setBusy(false); return toast("Create failed: " + error.message); }
    if (form.ownerEmail.trim() && form.ownerPassword) {
      try {
        await createOwner({ email: form.ownerEmail.trim(), password: form.ownerPassword, client_id: created.id });
        await supabase.from("clients").update({ owner_email: form.ownerEmail.trim() }).eq("id", created.id);
        toast("Client + owner login created");
      } catch (e2) { toast("Client created — owner login pending:"); edgeOrToast(e2); }
    } else { toast("Client created"); }
    setBusy(false);
    setForm({ subdomain: "", event_type: "wedding", template_key: "classic", ownerEmail: "", ownerPassword: "" });
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
    setEditForm({ subdomain: c.subdomain, ownerEmail: c.owner_email || "", ownerPassword: "" });
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
    // native confirm — neutral, not the event theme
    if (!window.confirm(`Delete "${c.subdomain}" and all its data (RSVPs, guestbook, quiz)? This cannot be undone.`)) return;
    const { error } = await supabase.from("clients").delete().eq("id", c.id);
    if (error) return toast("Delete failed: " + error.message);
    toast("Client deleted"); load();
  }

  return (
    <div className="sa">
      <div className="sa-tabs">
        <button className={view === "list" || view === "edit" ? "on" : ""} onClick={() => { setEditing(null); setView("list"); }}>Clients</button>
        <button className={view === "add" ? "on" : ""} onClick={() => setView("add")}>Add client</button>
        <button className={view === "owner" ? "on" : ""} onClick={() => setView("owner")}>Owner login</button>
      </div>

      {view === "list" && (
        <div className="panel">
          <div className="panel__head">
            <div className="panel__title">Clients <span style={{ color: "var(--muted)", fontSize: 15 }}>({clients.length})</span></div>
            <Button variant="primary" size="sm" onClick={() => setView("add")}>{Icon.check({})} New client</Button>
          </div>
          <div className="panel__body--flush table-wrap">
            <table className="tbl">
              <thead><tr><th>Client</th><th>Type</th><th>Theme</th><th>Modules</th><th>Owner login</th><th>Actions</th></tr></thead>
              <tbody>
                {clients.map((c) => (
                  <tr key={c.id}>
                    <td><strong>{c.subdomain}</strong><div className="client-domain">{c.custom_domain || `${c.subdomain}.${PLATFORM_DOMAIN}`}</div></td>
                    <td className="theme-cell">
                      <Select value={c.event_type} onChange={(e) => changeType(c, e.target.value)}>
                        {["wedding", "birthday", "corporate"].map((t) => <option key={t} value={t}>{t}</option>)}
                      </Select>
                    </td>
                    <td className="theme-cell">
                      <Select value={c.template_key} onChange={(e) => assignTheme(c.id, e.target.value)}>
                        {themesForEvent(c.event_type).filter((k) => THEMES[k]).map((k) => <option key={k} value={k}>{THEMES[k].label}</option>)}
                      </Select>
                    </td>
                    <td>
                      <div className="mod-toggles">
                        {MODULES.map((m) => {
                          const on = (c.content?.modules?.[m]) !== false;
                          return <label key={m} className={"mod-pill" + (on ? " mod-pill--on" : "")}><input type="checkbox" checked={on} onChange={(e) => toggleModule(c, m, e.target.checked)} /> {m}</label>;
                        })}
                      </div>
                    </td>
                    <td>{c.owner_email ? <span className="client-domain">{c.owner_email}</span> : <span style={{ color: "var(--muted)", fontSize: 13 }}>no login</span>}</td>
                    <td>
                      <div className="row-actions">
                        <a className="icon-btn" href={`/?client=${c.subdomain}&manage=1#/admin`} title="Open this client's admin">{Icon.grid({})}</a>
                        <a className="icon-btn" href={`/?client=${c.subdomain}`} target="_blank" rel="noreferrer" title="Open this client's site">{Icon.eye({})}</a>
                        <button className="icon-btn" onClick={() => openEdit(c)} title="Edit client + owner login">{Icon.edit({})}</button>
                        <button className="icon-btn icon-btn--danger" onClick={() => deleteClient(c)} title="Delete client">{Icon.trash({})}</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {clients.length === 0 && <tr><td colSpan={6} style={{ textAlign: "center", padding: 48, color: "var(--muted)" }}>No clients yet — use “Add client”.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {view === "add" && (
        <div className="panel" style={{ maxWidth: 560 }}>
          <div className="panel__head"><div className="panel__title">Add a client</div></div>
          <form onSubmit={createClient} className="panel__body" style={{ display: "grid", gap: 16 }}>
            <Field label="Subdomain" id="c-sub" hint={`→ ${form.subdomain.trim() ? form.subdomain.trim().toLowerCase() : "name"}.${PLATFORM_DOMAIN}`}>
              <Input id="c-sub" value={form.subdomain} onChange={(e) => setForm((f) => ({ ...f, subdomain: e.target.value }))} placeholder="johnandjane" />
            </Field>
            <Field label="Event type" id="c-evt">
              <Select id="c-evt" value={form.event_type} onChange={(e) => setForm((f) => ({ ...f, event_type: e.target.value, template_key: themesForEvent(e.target.value)[0] }))}>
                {["wedding", "birthday", "corporate"].map((t) => <option key={t} value={t}>{t}</option>)}
              </Select>
            </Field>
            <div style={{ borderTop: "1px solid var(--line)", paddingTop: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-soft)", marginBottom: 12 }}>Owner login</div>
              <div style={{ display: "grid", gap: 16 }}>
                <Field label="Owner email" id="c-oemail"><Input id="c-oemail" type="email" value={form.ownerEmail} onChange={(e) => setForm((f) => ({ ...f, ownerEmail: e.target.value }))} placeholder="owner@theirdomain" /></Field>
                <Field label="Owner password" id="c-opw"><Input id="c-opw" value={form.ownerPassword} onChange={(e) => setForm((f) => ({ ...f, ownerPassword: e.target.value }))} placeholder="••••••••" /></Field>
              </div>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <Button type="submit" variant="primary" disabled={busy}>Create client</Button>
              <Button type="button" variant="ghost" onClick={() => setView("list")}>Cancel</Button>
            </div>
          </form>
        </div>
      )}

      {view === "edit" && editing && (
        <div className="panel" style={{ maxWidth: 560 }}>
          <div className="panel__head"><div className="panel__title">Edit {editing.subdomain}</div></div>
          <form onSubmit={saveEdit} className="panel__body" style={{ display: "grid", gap: 16 }}>
            <Field label="Subdomain" id="e-sub"><Input id="e-sub" value={editForm.subdomain} onChange={(e) => setEditForm((f) => ({ ...f, subdomain: e.target.value }))} /></Field>
            <div style={{ borderTop: "1px solid var(--line)", paddingTop: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-soft)", marginBottom: 12 }}>Owner login</div>
              <div style={{ display: "grid", gap: 16 }}>
                <Field label="Owner email" id="e-oemail"><Input id="e-oemail" type="email" value={editForm.ownerEmail} onChange={(e) => setEditForm((f) => ({ ...f, ownerEmail: e.target.value }))} placeholder="owner@theirdomain" /></Field>
                <Field label="New password" id="e-opw" hint="Leave blank to keep the current password"><Input id="e-opw" value={editForm.ownerPassword} onChange={(e) => setEditForm((f) => ({ ...f, ownerPassword: e.target.value }))} placeholder="••••••••" /></Field>
              </div>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <Button type="submit" variant="primary" disabled={busy}>Save changes</Button>
              <Button type="button" variant="ghost" onClick={() => { setEditing(null); setView("list"); }}>Cancel</Button>
            </div>
          </form>
        </div>
      )}

      {view === "owner" && (
        <div className="panel" style={{ maxWidth: 560 }}>
          <div className="panel__head"><div className="panel__title">Set a client's owner login</div></div>
          <form onSubmit={setOwner} className="panel__body" style={{ display: "grid", gap: 16 }}>
            <Field label="Client" id="o-client">
              <Select id="o-client" value={cred.client_id} onChange={(e) => setCred((c) => ({ ...c, client_id: e.target.value }))}>
                <option value="">Select…</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.subdomain}</option>)}
              </Select>
            </Field>
            <Field label="Owner email" id="o-email"><Input id="o-email" type="email" value={cred.email} onChange={(e) => setCred((c) => ({ ...c, email: e.target.value }))} placeholder="owner@theirdomain" /></Field>
            <Field label="Password" id="o-pw"><Input id="o-pw" value={cred.password} onChange={(e) => setCred((c) => ({ ...c, password: e.target.value }))} placeholder="••••••••" /></Field>
            <div><Button type="submit" variant="primary" disabled={busy}>Set owner login</Button></div>
          </form>
        </div>
      )}
    </div>
  );
}
