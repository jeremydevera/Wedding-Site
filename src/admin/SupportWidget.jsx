// Sticky "support agent" widget for the owner admin console. A fixed launcher
// (agent avatar + "Need help?") opens a ticket form in the shared Modal (which
// handles the admin iOS scroll-lock correctly — CLAUDE.md). Submits via
// submitTicket → support_tickets (RLS-scoped to the owner's client). Rendered
// only for the demo client for now (gated at the mount site in manage.jsx).
import React from "react";
import { submitTicket } from "@/lib/api.js";
import { Button, Field, Icon, Input, Modal, Select, Textarea, toast } from "@/ui/components.jsx";
const { useState } = React;

// Friendly headset "agent" avatar — self-contained SVG, console-neutral colors.
function AgentAvatar({ size = 40 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <defs>
        <linearGradient id="sw-ag" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4f7fd6" />
          <stop offset="1" stopColor="#3a5fb0" />
        </linearGradient>
      </defs>
      <circle cx="24" cy="24" r="24" fill="url(#sw-ag)" />
      <circle cx="24" cy="20" r="7" fill="#fff" />
      <path d="M12 36c0-6 5.4-9 12-9s12 3 12 9" fill="#fff" opacity="0.92" />
      {/* headset band + earcups + mic */}
      <path d="M15 20a9 9 0 0 1 18 0" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
      <rect x="12.5" y="19" width="3.5" height="6" rx="1.75" fill="#fff" />
      <rect x="32" y="19" width="3.5" height="6" rx="1.75" fill="#fff" />
      <path d="M33.5 24v3.5a3 3 0 0 1-3 3H26" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="24.5" cy="30.5" r="1.6" fill="#fff" />
    </svg>
  );
}

const CATEGORIES = ["Question", "Bug", "Design change", "Billing", "Other"];
const URGENCIES = ["Low", "Normal", "High"];

export function SupportWidget({ tab }) {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try { return sessionStorage.getItem("evermore_support_dismissed") === "1"; } catch (_) { return false; }
  });
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ subject: "", category: "Question", urgency: "Normal", message: "" });
  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));

  const dismiss = (e) => {
    e.stopPropagation();
    setCollapsed(true);
    try { sessionStorage.setItem("evermore_support_dismissed", "1"); } catch (_) {}
  };
  const expand = () => {
    setCollapsed(false);
    try { sessionStorage.removeItem("evermore_support_dismissed"); } catch (_) {}
  };

  async function send() {
    if (busy) return;
    if (!form.subject.trim() || !form.message.trim()) { toast("Please add a subject and a message.", "error"); return; }
    setBusy(true);
    try {
      await submitTicket(form, tab);
      toast("Ticket sent — we'll get back to you soon.", "success");
      setForm({ subject: "", category: "Question", urgency: "Normal", message: "" });
      setOpen(false);
    } catch (e) {
      toast(e.message || "Couldn't send your ticket — try again.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {collapsed ? (
        <button type="button" className="support-bubble" onClick={expand} aria-label="Need help? Open support">
          <AgentAvatar size={30} />
        </button>
      ) : (
        <div className="support-launcher">
          <button type="button" className="support-launcher__main" onClick={() => setOpen(true)} aria-label="Need help? Contact support">
            <AgentAvatar size={34} />
            <span className="support-launcher__label">Need help?</span>
          </button>
          <button type="button" className="support-launcher__x" onClick={dismiss} aria-label="Hide support">{Icon.close({})}</button>
        </div>
      )}

      <Modal open={open} onClose={() => !busy && setOpen(false)} label="Contact support">
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
          <AgentAvatar size={40} />
          <div>
            <h3 style={{ margin: 0 }}>How can we help?</h3>
            <p style={{ margin: "2px 0 0", color: "var(--muted)", fontSize: 13 }}>Send us a ticket and we'll get back to you.</p>
          </div>
        </div>
        <Field label="Subject" id="sw-subj"><Input id="sw-subj" value={form.subject} onChange={set("subject")} placeholder="Short summary" maxLength={120} /></Field>
        <div className="field-row field-row--2">
          <Field label="Category" id="sw-cat"><Select id="sw-cat" value={form.category} onChange={set("category")}>{CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</Select></Field>
          <Field label="Urgency" id="sw-urg"><Select id="sw-urg" value={form.urgency} onChange={set("urgency")}>{URGENCIES.map((u) => <option key={u} value={u}>{u}</option>)}</Select></Field>
        </div>
        <Field label="Message" id="sw-msg"><Textarea id="sw-msg" rows={5} value={form.message} onChange={set("message")} placeholder="Tell us what you need…" /></Field>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8 }}>
          <Button variant="ghost" onClick={() => !busy && setOpen(false)} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={send} disabled={busy}>{busy ? "Sending…" : "Send ticket"}</Button>
        </div>
      </Modal>
    </>
  );
}
