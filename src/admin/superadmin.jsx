import React from "react";
import { supabase } from "@/lib/supabase.js";
import { createOwner, updateOwnerEmail, deleteOwner } from "@/lib/auth.js";
import { THEMES } from "@/themes";
import { themesForEvent } from "@/config/eventTypes.js";
import { moduleLabel } from "@/lib/roles.js";
import { PLATFORM_DOMAIN, clientUrl, isValidSubdomain } from "@/config/site.js"; // platform config → src/config/site.js
import { Button, confirmDialog, Field, Icon, Input, Pager, Select, toast, usePaged } from "@/ui/components.jsx";
import { listMedia, deleteFromR2 } from "@/lib/api.js";
import { fileNameFromKey } from "@/lib/mediaLibrary.js";
import { mediaUrl } from "@/lib/media.js";
const { useState, useEffect } = React;

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
    { label: "Clients", value: m.clients, sub: `${m.active} active` },
    { label: "Owner logins", value: m.logins, sub: `${m.clients - m.logins} without login` },
    { label: "RSVPs", value: m.rsvps, sub: "across all events" },
    { label: "Guestbook", value: m.guestbook, sub: "messages" },
    { label: "Quiz plays", value: m.quiz, sub: "submissions" },
  ] : Array.from({ length: 5 }).map(() => ({ label: "—", value: "·", sub: "" }));
  const typeTotal = Object.values(byType).reduce((a, b) => a + b, 0) || 1;

  return (
    <div>
      <div className="sa-stats">
        {stats.map((s, i) => (
          <div key={i} className="sa-stat" style={{ animationDelay: `${i * 50}ms` }}>
            <div className="sa-stat__label">{s.label}</div>
            <div className="sa-stat__value">{s.value}</div>
            <div className="sa-stat__sub">{s.sub}</div>
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
  const [form, setForm] = useState({ subdomain: "", event_type: "wedding", template_key: "classic", ownerEmail: "", ownerPassword: "" });
  const [cred, setCred] = useState({ client_id: "", email: "", password: "" });
  const [editing, setEditing] = useState(null);
  const [editForm, setEditForm] = useState({ subdomain: "", ownerEmail: "", ownerPassword: "", modules: {} });
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");

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
    const sub = form.subdomain.trim().toLowerCase();
    if (!isValidSubdomain(sub)) return toast("Invalid subdomain. Use lowercase letters, numbers, and hyphens — and not a reserved name (www, app, admin, demo…).");
    setBusy(true);
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
    setEditForm({ subdomain: c.subdomain, ownerEmail: c.owner_email || "", ownerPassword: "", modules: Object.fromEntries(MODULES.map((m) => [m, c.content?.modules?.[m] !== false])) });
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
        <button className={view === "list" || view === "edit" ? "on" : ""} onClick={() => { setEditing(null); setView("list"); }}>Clients</button>
        <button className={view === "add" ? "on" : ""} onClick={() => setView("add")}>Add client</button>
        <button className={view === "owner" ? "on" : ""} onClick={() => setView("owner")}>Owner login</button>
      </div>

      {view === "list" && (
        <div>
          <div className="sa-toolbar">
            <div className="sa-search">{Icon.search({})}<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search clients by subdomain…" /></div>
            <Button variant="primary" size="sm" onClick={() => setView("add")}>{Icon.check({})} Add client</Button>
          </div>
          <div className="panel" style={{ marginBottom: 10 }}>
            <div className="panel__body--flush table-wrap">
              <table className="tbl tbl--clients">
                <thead><tr><th>Client</th><th>Theme</th><th>Owner login</th><th>Actions</th></tr></thead>
                <tbody>
                  {pg.pageItems.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                          <span className={"sa-dot" + (c.is_active ? "" : " sa-dot--off")} />
                          <div><strong>{c.subdomain}</strong><div className="client-domain">{c.custom_domain || `${c.subdomain}.${PLATFORM_DOMAIN}`}</div></div>
                        </div>
                      </td>
                      <td className="theme-cell"><Select value={c.template_key} onChange={(e) => assignTheme(c.id, e.target.value)}>{themesForEvent(c.event_type).filter((k) => THEMES[k]).map((k) => <option key={k} value={k}>{THEMES[k].label}</option>)}</Select></td>
                      <td>{c.owner_email ? <span className="client-domain">{c.owner_email}</span> : <span style={{ color: "var(--muted)" }}>—</span>}</td>
                      <td>
                        <div className="row-actions">
                          <a className="icon-btn" href={`/admin?client=${c.subdomain}`} title="Open admin">{Icon.grid({})}</a>
                          <a className="icon-btn" href={clientUrl(c.subdomain)} target="_blank" rel="noreferrer" title="Open live site">{Icon.eye({})}</a>
                          <button className="icon-btn" onClick={() => openEdit(c)} title="Edit">{Icon.edit({})}</button>
                          <button className="icon-btn icon-btn--danger" onClick={() => deleteClient(c)} title="Delete">{Icon.trash({})}</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && <tr><td colSpan={4} style={{ textAlign: "center", padding: 40, color: "var(--muted)" }}>{clients.length ? "No matches." : "No clients yet — use “Add client”."}</td></tr>}
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

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    listMedia(null, type)
      .then((data) => { if (live) { setItems(data); setLoading(false); } })
      .catch((e) => { if (live) { setError((e && e.message) || "load failed"); setLoading(false); } });
    return () => { live = false; };
  }, [type]);

  const visible = clientFilter.trim()
    ? items.filter((it) => it.key.split("/")[0].toLowerCase().includes(clientFilter.trim().toLowerCase()))
    : items;

  async function doDelete(key) {
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
      toast("Delete failed: " + ((e && e.message) || "error"));
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
            <ul className="medialib medialib--audio">
              {visible.map((it) => (
                <li key={it.key} className="medialib__row" style={{ gap: 8 }}>
                  <span className="medialib__pick" style={{ flex: 1 }}>
                    {it.name}
                    <span style={{ color: "var(--muted)", fontSize: 12, marginLeft: 8 }}>{it.key.split("/")[0]}</span>
                  </span>
                  <audio src={mediaUrl(it.key)} controls preload="none" />
                  <button
                    type="button"
                    className="icon-btn icon-btn--danger"
                    aria-label="Delete"
                    disabled={deleting === it.key}
                    onClick={() => doDelete(it.key)}
                  >{Icon.trash({})}</button>
                </li>
              ))}
            </ul>
          )}

          {!loading && !error && type === "image" && visible.length > 0 && (
            <div className="medialib medialib--grid">
              {visible.map((it) => (
                <div key={it.key} className="medialib__cell" title={it.name} style={{ position: "relative" }}>
                  <img src={mediaUrl(it.key)} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = "none"; }} />
                  <span className="medialib__name">{it.name}</span>
                  <span style={{ fontSize: 11, color: "var(--muted)", display: "block" }}>{it.key.split("/")[0]}</span>
                  <button
                    type="button"
                    className="icon-btn icon-btn--danger"
                    aria-label="Delete"
                    style={{ position: "absolute", top: 4, right: 4, background: "rgba(255,255,255,.85)" }}
                    disabled={deleting === it.key}
                    onClick={() => doDelete(it.key)}
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
