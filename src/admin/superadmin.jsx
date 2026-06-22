import React from "react";
import { supabase } from "@/lib/supabase.js";
import { createOwner } from "@/lib/auth.js";
import { THEMES } from "@/themes";
import { themesForEvent } from "@/config/eventTypes.js";
import { Button, Field, Input, Select, SectionHead, toast } from "@/ui/components.jsx";
const { useState, useEffect } = React;

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
    if (error) return toast("Update failed"); toast("Theme assigned"); load();
  }
  async function setOwner(e) {
    e.preventDefault();
    if (busy || !cred.client_id || !cred.email || !cred.password) return;
    setBusy(true);
    try { await createOwner(cred); toast("Owner login set"); setCred({ client_id: "", email: "", password: "" }); }
    catch (e2) { toast("Failed: " + (e2.message || "error")); }
    finally { setBusy(false); }
  }

  return (
    <div className="panel">
      <SectionHead eyebrow="Superadmin" title="Clients" />

      <form onSubmit={createClient} className="field-row field-row--2" style={{ alignItems: "end" }}>
        <Field label="Subdomain" id="c-sub"><Input id="c-sub" value={form.subdomain} onChange={(e) => setForm((f) => ({ ...f, subdomain: e.target.value }))} placeholder="johnandjane" /></Field>
        <Field label="Event type" id="c-evt">
          <Select id="c-evt" value={form.event_type} onChange={(e) => setForm((f) => ({ ...f, event_type: e.target.value, template_key: themesForEvent(e.target.value)[0] }))}>
            {["wedding", "birthday", "corporate"].map((t) => <option key={t} value={t}>{t}</option>)}
          </Select>
        </Field>
        <Button type="submit" variant="primary" disabled={busy}>Create client</Button>
      </form>

      <table className="admin-table" style={{ marginTop: 20, width: "100%" }}>
        <thead><tr><th>Subdomain</th><th>Type</th><th>Theme</th></tr></thead>
        <tbody>
          {clients.map((c) => (
            <tr key={c.id}>
              <td>{c.subdomain}</td>
              <td>{c.event_type}</td>
              <td>
                <Select value={c.template_key} onChange={(e) => assignTheme(c.id, e.target.value)}>
                  {themesForEvent(c.event_type).filter((k) => THEMES[k]).map((k) => <option key={k} value={k}>{THEMES[k].label}</option>)}
                </Select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <SectionHead eyebrow="Access" title="Set a client's owner login" />
      <form onSubmit={setOwner} className="field-row field-row--2" style={{ alignItems: "end" }}>
        <Field label="Client" id="o-client">
          <Select id="o-client" value={cred.client_id} onChange={(e) => setCred((c) => ({ ...c, client_id: e.target.value }))}>
            <option value="">Select…</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.subdomain}</option>)}
          </Select>
        </Field>
        <Field label="Owner email" id="o-email"><Input id="o-email" type="email" value={cred.email} onChange={(e) => setCred((c) => ({ ...c, email: e.target.value }))} placeholder="owner@theirdomain" /></Field>
        <Field label="Password" id="o-pw"><Input id="o-pw" value={cred.password} onChange={(e) => setCred((c) => ({ ...c, password: e.target.value }))} /></Field>
        <Button type="submit" variant="primary" disabled={busy}>Set owner login</Button>
      </form>
    </div>
  );
}
