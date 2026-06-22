import React from "react";
import { supabase } from "@/lib/supabase.js";
import { createOwner } from "@/lib/auth.js";
import { THEMES } from "@/themes";
import { themesForEvent } from "@/config/eventTypes.js";
import { Button, Field, Icon, Input, Select, SectionHead, toast } from "@/ui/components.jsx";
const { useState, useEffect } = React;

const MODULES = ["story", "details", "schedule", "venue", "gallery", "guestbook", "quiz", "rsvp"];
// Base domain client subdomains live under (rename when you register your platform domain).
const PLATFORM_DOMAIN = "celebrate.app";

export function ClientsAdmin() {
  const [clients, setClients] = useState([]);
  const [form, setForm] = useState({ subdomain: "", event_type: "wedding", template_key: "classic" });
  const [cred, setCred] = useState({ client_id: "", email: "", password: "" });
  const [busy, setBusy] = useState(false);

  async function load() {
    const { data } = await supabase.from("clients").select("*").order("created_at", { ascending: false });
    setClients(data || []);
  }
  useEffect(() => { load(); }, []);

  async function createClient(e) {
    e.preventDefault();
    if (busy || !form.subdomain.trim()) return;
    setBusy(true);
    const { error } = await supabase.from("clients").insert({ ...form, subdomain: form.subdomain.trim().toLowerCase() });
    setBusy(false);
    if (error) return toast("Create failed: " + error.message);
    setForm({ subdomain: "", event_type: "wedding", template_key: "classic" });
    toast("Client created"); load();
  }
  async function assignTheme(id, template_key) {
    const { error } = await supabase.from("clients").update({ template_key }).eq("id", id);
    if (error) return toast("Update failed");
    toast("Theme assigned"); load();
  }
  async function toggleModule(c, key, on) {
    const modules = { ...(c.content?.modules || {}), [key]: on };
    const content = { ...(c.content || {}), modules };
    const { error } = await supabase.from("clients").update({ content }).eq("id", c.id);
    if (error) return toast("Update failed");
    load();
  }
  async function setOwner(e) {
    e.preventDefault();
    if (busy || !cred.client_id || !cred.email || !cred.password) return;
    setBusy(true);
    try { await createOwner(cred); toast("Owner login set"); setCred({ client_id: "", email: "", password: "" }); }
    catch (e2) {
      const msg = e2?.message || "error";
      if (/failed to send|function not found|non-2xx|not found|fetch|edge/i.test(msg))
        toast("Edge function not deployed yet. Deploy admin-create-owner — or add the owner in Supabase Auth manually.");
      else toast("Failed: " + msg);
    }
    finally { setBusy(false); }
  }

  return (
    <div>
      {/* Add a client */}
      <div className="panel">
        <div className="panel__head"><div className="panel__title">Add a client</div></div>
        <form onSubmit={createClient} className="clients-form clients-form--create">
          <Field label="Subdomain" id="c-sub" hint={`→ ${form.subdomain.trim() ? form.subdomain.trim().toLowerCase() : "name"}.${PLATFORM_DOMAIN}`}>
            <Input id="c-sub" value={form.subdomain} onChange={(e) => setForm((f) => ({ ...f, subdomain: e.target.value }))} placeholder="johnandjane" />
          </Field>
          <Field label="Event type" id="c-evt">
            <Select id="c-evt" value={form.event_type} onChange={(e) => setForm((f) => ({ ...f, event_type: e.target.value, template_key: themesForEvent(e.target.value)[0] }))}>
              {["wedding", "birthday", "corporate"].map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
          </Field>
          <Button type="submit" variant="primary" disabled={busy}>Create client</Button>
        </form>
      </div>

      {/* Client list */}
      <div className="panel">
        <div className="panel__head">
          <div className="panel__title">Clients <span style={{ color: "var(--muted)", fontSize: 15 }}>({clients.length})</span></div>
        </div>
        <div className="panel__body--flush table-wrap">
          <table className="tbl">
            <thead><tr><th>Client</th><th>Type</th><th>Theme</th><th>Modules</th><th>Open</th></tr></thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.id}>
                  <td>
                    <strong>{c.subdomain}</strong>
                    <div className="client-domain">{c.custom_domain || `${c.subdomain}.${PLATFORM_DOMAIN}`}</div>
                  </td>
                  <td><span className="tag tag--hidden">{c.event_type}</span></td>
                  <td className="theme-cell">
                    <Select value={c.template_key} onChange={(e) => assignTheme(c.id, e.target.value)}>
                      {themesForEvent(c.event_type).filter((k) => THEMES[k]).map((k) => <option key={k} value={k}>{THEMES[k].label}</option>)}
                    </Select>
                  </td>
                  <td>
                    <div className="mod-toggles">
                      {MODULES.map((m) => {
                        const on = (c.content?.modules?.[m]) !== false;
                        return (
                          <label key={m} className={"mod-pill" + (on ? " mod-pill--on" : "")}>
                            <input type="checkbox" checked={on} onChange={(e) => toggleModule(c, m, e.target.checked)} /> {m}
                          </label>
                        );
                      })}
                    </div>
                  </td>
                  <td>
                    <div className="row-actions">
                      <a className="icon-btn" href={`/?client=${c.subdomain}#/admin`} title="Open this client's admin">{Icon.grid({})}</a>
                      <a className="icon-btn" href={`/?client=${c.subdomain}`} target="_blank" rel="noreferrer" title="Open this client's site">{Icon.eye({})}</a>
                    </div>
                  </td>
                </tr>
              ))}
              {clients.length === 0 && (
                <tr><td colSpan={5} style={{ textAlign: "center", padding: 40, color: "var(--muted)" }}>No clients yet — add one above.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Owner login */}
      <div className="panel">
        <div className="panel__head"><div className="panel__title">Set a client's owner login</div></div>
        <form onSubmit={setOwner} className="clients-form clients-form--owner">
          <Field label="Client" id="o-client">
            <Select id="o-client" value={cred.client_id} onChange={(e) => setCred((c) => ({ ...c, client_id: e.target.value }))}>
              <option value="">Select…</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.subdomain}</option>)}
            </Select>
          </Field>
          <Field label="Owner email" id="o-email"><Input id="o-email" type="email" value={cred.email} onChange={(e) => setCred((c) => ({ ...c, email: e.target.value }))} placeholder="owner@theirdomain" /></Field>
          <Field label="Password" id="o-pw"><Input id="o-pw" value={cred.password} onChange={(e) => setCred((c) => ({ ...c, password: e.target.value }))} placeholder="••••••••" /></Field>
          <Button type="submit" variant="primary" disabled={busy}>Set owner login</Button>
        </form>
      </div>
    </div>
  );
}
