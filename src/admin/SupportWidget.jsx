// Client support: a sticky "agent" launcher (opens the ticket form in the
// shared Modal) + a full "Support" admin tab (submit a ticket AND see your own
// tickets' status + our reply). Submits via submitTicket → support_tickets
// (RLS-scoped to the owner's client). Demo-gated at the mount sites in
// manage.jsx. Clicking the launcher's × hides it entirely for the session —
// the Support tab remains the way back in.
import React from "react";
import { submitTicket, listTickets, listTicketMessages, postTicketMessage } from "@/lib/api.js";
import { Button, Field, Icon, Input, Modal, Select, Textarea, toast } from "@/ui/components.jsx";
import { fmtDate } from "@/admin/core.jsx";
const { useState, useEffect, useRef } = React;

// Shared conversation view for a ticket: the original request, the message
// thread (owner ⇄ support), and a reply box. Used by both the owner's Support
// tab and the superadmin ticket modal. postTicketMessage pins sender_role to the
// caller's actual role; an owner reply reopens a resolved ticket (DB trigger).
export function TicketThread({ ticket, onChanged, leftAction, rightAction }) {
  const [msgs, setMsgs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef(null);
  const load = () => listTicketMessages(ticket.id)
    .then((rows) => setMsgs(rows || []))
    .catch(() => {})
    .finally(() => setLoading(false));
  useEffect(() => { setLoading(true); load(); }, [ticket.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (endRef.current && endRef.current.scrollIntoView) endRef.current.scrollIntoView({ block: "nearest" }); }, [msgs.length]);

  async function send() {
    if (busy || !reply.trim()) return;
    setBusy(true);
    try {
      await postTicketMessage(ticket.id, reply);
      setReply("");
      await load();
      onChanged && onChanged();
    } catch (e) {
      toast(e.message || "Couldn't send your reply — try again.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ticket-thread">
      <div className="tk-msgs">
        {/* Original request */}
        <div className="tk-msg tk-msg--client">
          <div className="tk-msg__who">{ticket.submitter_name || ticket.submitter_email || "Client"} · original request</div>
          <div className="tk-msg__body">{ticket.message}</div>
          <div className="tk-msg__at">{fmtDate(ticket.created_at)}</div>
        </div>
        {/* Replies */}
        {loading && <div style={{ color: "var(--muted)", fontSize: 13, padding: "6px 2px" }}>Loading replies…</div>}
        {!loading && msgs.map((m) => (
          <div key={m.id} className={"tk-msg " + (m.sender_role === "superadmin" ? "tk-msg--support" : "tk-msg--client")}>
            <div className="tk-msg__who">{m.sender_role === "superadmin" ? (m.sender_name || "Support") : (m.sender_name || "Client")}</div>
            <div className="tk-msg__body">{m.body}</div>
            <div className="tk-msg__at">{fmtDate(m.created_at)}</div>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <div className="tk-reply">
        <Textarea rows={3} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Write a reply…" />
        <div className="tk-reply__actions">
          <div className="tk-reply__left">{leftAction}</div>
          <div className="tk-reply__right">
            {rightAction}
            <Button variant="primary" onClick={send} disabled={busy || !reply.trim()}>{busy ? "Sending…" : "Send reply"}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

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
const BLANK = { subject: "", category: "Question", urgency: "Normal", message: "" };

// The ticket form — shared by the floating widget's modal and the Support tab.
function TicketForm({ tab, onDone, onCancel }) {
  const [form, setForm] = useState(BLANK);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));

  async function send() {
    if (busy) return;
    if (!form.subject.trim() || !form.message.trim()) { toast("Please add a subject and a message.", "error"); return; }
    setBusy(true);
    try {
      await submitTicket(form, tab);
      toast("Ticket sent — we'll get back to you soon.", "success");
      setForm(BLANK);
      onDone && onDone();
    } catch (e) {
      toast(e.message || "Couldn't send your ticket — try again.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Field label="Subject" id="sw-subj"><Input id="sw-subj" value={form.subject} onChange={set("subject")} placeholder="Short summary" maxLength={120} /></Field>
      <div className="field-row field-row--2">
        <Field label="Category" id="sw-cat"><Select id="sw-cat" value={form.category} onChange={set("category")}>{CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</Select></Field>
        <Field label="Urgency" id="sw-urg"><Select id="sw-urg" value={form.urgency} onChange={set("urgency")}>{URGENCIES.map((u) => <option key={u} value={u}>{u}</option>)}</Select></Field>
      </div>
      <Field label="Message" id="sw-msg"><Textarea id="sw-msg" rows={5} value={form.message} onChange={set("message")} placeholder="Tell us what you need…" /></Field>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8 }}>
        {onCancel && <Button variant="ghost" onClick={() => !busy && onCancel()} disabled={busy}>Cancel</Button>}
        <Button variant="primary" onClick={send} disabled={busy}>{busy ? "Sending…" : "Send ticket"}</Button>
      </div>
    </>
  );
}

// Sticky floating launcher. × hides it entirely for this session (the Support
// tab is the persistent entry point).
export function SupportWidget({ tab }) {
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(() => {
    try { return sessionStorage.getItem("evermore_support_dismissed") === "1"; } catch (_) { return false; }
  });

  if (hidden) return null;

  const dismiss = (e) => {
    e.stopPropagation();
    setHidden(true);
    try { sessionStorage.setItem("evermore_support_dismissed", "1"); } catch (_) {}
  };

  return (
    <>
      <div className="support-launcher">
        <button type="button" className="support-launcher__main" onClick={() => setOpen(true)} aria-label="Need help? Contact support">
          <AgentAvatar size={34} />
          <span className="support-launcher__label">Need help?</span>
        </button>
        <button type="button" className="support-launcher__x" onClick={dismiss} aria-label="Hide support">{Icon.close({})}</button>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} label="Contact support">
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
          <AgentAvatar size={40} />
          <div>
            <h3 style={{ margin: 0 }}>How can we help?</h3>
            <p style={{ margin: "2px 0 0", color: "var(--muted)", fontSize: 13 }}>Send us a ticket and we'll get back to you.</p>
          </div>
        </div>
        <TicketForm tab={tab} onDone={() => setOpen(false)} onCancel={() => setOpen(false)} />
      </Modal>
    </>
  );
}

// "Support" admin tab: the client's own tickets with status + our reply
// (RLS returns only their client's rows), and a "+ New ticket" action that
// opens the shared form in a modal.
export function SupportPanel({ tab }) {
  const [mine, setMine] = useState([]);
  const [loading, setLoading] = useState(true);
  const [compose, setCompose] = useState(false);
  const [viewing, setViewing] = useState(null); // ticket open in the thread modal
  const refresh = () => listTickets().then((rows) => setMine(rows || [])).catch(() => {}).finally(() => setLoading(false));
  useEffect(() => { refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const openCount = mine.filter((t) => t.status === "open").length;

  return (
    <div>
      <div className="panel">
        <div className="panel__head">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <AgentAvatar size={30} />
            <div className="panel__title">Your tickets {openCount > 0 && <span style={{ color: "var(--muted)", fontSize: 15 }}>({openCount} open)</span>}</div>
          </div>
        </div>
        <div className="admin-toolbar" style={{ padding: "14px 16px" }}>
          <div className="admin-toolbar__end">
            <Button variant="primary" className="admin-toolbar__action" onClick={() => setCompose(true)}>+ New ticket</Button>
          </div>
        </div>
        <div className="panel__body--flush table-wrap">
          <table className="tbl">
            <thead><tr><th>Subject</th><th>Category</th><th>Status</th><th>When</th><th></th></tr></thead>
            <tbody>
              {loading && <tr><td colSpan={5} style={{ color: "var(--muted)", padding: 18 }}>Loading…</td></tr>}
              {!loading && mine.length === 0 && <tr><td colSpan={5} style={{ color: "var(--muted)", padding: 18 }}>No tickets yet — send one above if you need a hand.</td></tr>}
              {mine.map((t) => (
                <tr key={t.id}>
                  <td><strong>{t.subject}</strong></td>
                  <td><span className="tag tag--hidden">{t.category}</span></td>
                  <td><span className="tag" style={{ background: t.status === "open" ? "#fdecc8" : "#d6f0e0", color: t.status === "open" ? "#7a5b12" : "#1e6b45" }}>{t.status}</span></td>
                  <td style={{ whiteSpace: "nowrap", color: "var(--muted)", fontSize: 13 }}>{fmtDate(t.created_at)}</td>
                  <td><Button variant="ghost" size="sm" onClick={() => setViewing(t)}>{Icon.mail ? Icon.mail({}) : null} View &amp; reply</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={!!viewing} onClose={() => setViewing(null)} label="Support ticket">
        {viewing && (
          <>
            <h3 style={{ margin: "0 0 2px" }}>{viewing.subject}</h3>
            <p style={{ margin: "0 0 12px", color: "var(--muted)", fontSize: 13 }}>{viewing.category} · {viewing.urgency} · <span className="tag" style={{ background: viewing.status === "open" ? "#fdecc8" : "#d6f0e0", color: viewing.status === "open" ? "#7a5b12" : "#1e6b45" }}>{viewing.status}</span></p>
            <TicketThread ticket={viewing} onChanged={refresh} />
          </>
        )}
      </Modal>

      <Modal open={compose} onClose={() => setCompose(false)} label="New support ticket">
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
          <AgentAvatar size={40} />
          <div>
            <h3 style={{ margin: 0 }}>How can we help?</h3>
            <p style={{ margin: "2px 0 0", color: "var(--muted)", fontSize: 13 }}>Send us a ticket and we'll get back to you.</p>
          </div>
        </div>
        <TicketForm tab={tab} onDone={() => { setCompose(false); refresh(); }} onCancel={() => setCompose(false)} />
      </Modal>
    </div>
  );
}
