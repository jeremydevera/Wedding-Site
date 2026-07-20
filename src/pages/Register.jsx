import React from "react";
import { neonAuth, authedRpc, neonRpc, NEON_FLAG_KEY } from "@/lib/neon.js";
import { getAppConfig, checkRequestSubdomainFree } from "@/lib/api.js";
import { ApplyWizard } from "@/admin/apply.jsx";
import { Button, Field, Input, toast } from "@/ui/components.jsx";
const { useState, useEffect } = React;

// Self-registration (Neon backend) — sandbox host only, behind USE NEON DATABASE.
// States: loading → off | auth | wizard | pending | redirect.
// The wizard is what creates the site; until it finishes there is no site, so
// nothing but the wizard (or the auth card / pending notice) ever renders here.
export function RegisterPage() {
  const [phase, setPhase] = useState("loading");
  const [email, setEmail] = useState("");
  const [pendingSub, setPendingSub] = useState("");

  async function resolvePhase() {
    const flag = await getAppConfig(NEON_FLAG_KEY).catch(() => null);
    if (flag?.enabled !== true) { setPhase("off"); return; }
    const s = await neonAuth.session();
    if (!s) { setPhase("auth"); return; }
    setEmail(s.user?.email || "");
    // First authed RPC after sign-in can flake to {state:'anon'} while the JWT
    // session warms up (observed live) — retry once before trusting it.
    let st = await authedRpc("my_registration_state").catch(() => ({ state: "none" }));
    if (st?.state === "anon") {
      await new Promise((r) => setTimeout(r, 600));
      st = await authedRpc("my_registration_state").catch(() => ({ state: "none" }));
    }
    if (st?.state === "active") { window.location.href = `https://${st.subdomain}.celebrately.us`; setPhase("redirect"); return; }
    if (st?.state === "pending") { setPendingSub(st.subdomain || ""); setPhase("pending"); return; }
    setPhase("wizard");
  }
  useEffect(() => { resolvePhase(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // both databases must agree the address is free
  const subCheck = async (sub) => {
    const [supaFree, neonFree] = await Promise.all([
      checkRequestSubdomainFree(sub).catch(() => false),
      neonRpc("subdomain_free", { p_sub: sub }).then((v) => v === true).catch(() => false),
    ]);
    return supaFree && neonFree;
  };
  const submitOverride = async (p) => {
    const res = await authedRpc("register_site", {
      p_subdomain: p.subdomain, p_event_type: p.eventType || "wedding",
      p_template_key: p.templateKey || "classic", p_email: p.email || email,
      p_partner_a: p.partnerA || "", p_partner_b: p.partnerB || "", p_content: p.content || {},
    });
    try { localStorage.removeItem("neonRegDraft"); } catch { /* ignore */ }
    if (res?.result === "created") { window.location.href = `https://${res.subdomain}.celebrately.us`; return { approved: true }; }
    setPendingSub(res?.subdomain || p.subdomain); setPhase("pending");
    return { approved: false };
  };

  if (phase === "loading" || phase === "redirect") return <div style={{ padding: 60, textAlign: "center", color: "var(--muted)" }}>Loading…</div>;
  if (phase === "off") return <div style={{ padding: 60, textAlign: "center" }}><h2>Registration isn't open yet</h2><p style={{ color: "var(--muted)" }}>Please check back soon.</p></div>;
  if (phase === "auth") return <AuthCard onDone={resolvePhase} />;
  if (phase === "pending") return (
    <div style={{ maxWidth: 520, margin: "60px auto", padding: 24 }} className="card card--pad-lg">
      <h2>Request received 🎉</h2>
      <p>Your site <strong>{pendingSub}.celebrately.us</strong> is waiting for approval. You'll be able to open it right here once it's approved — check back soon.</p>
      <Button variant="ghost" onClick={async () => { await neonAuth.signOut(); setPhase("auth"); }}>Sign out</Button>
    </div>
  );
  // wizard — fullscreen, nothing else (the wizard creates the site).
  // draftKey: survives refresh/session expiry (spec edge case).
  return <ApplyWizard presetEmail={email} subCheck={subCheck} submitOverride={submitOverride} draftKey="neonRegDraft" />;
}

function AuthCard({ onDone }) {
  const [mode, setMode] = useState("signup"); // signup | signin
  const [f, setF] = useState({ email: "", pw: "", pw2: "" });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    const email = f.email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return toast("Enter a valid email address.", "err");
    if (f.pw.length < 8) return toast("Password must be at least 8 characters.", "err");
    if (mode === "signup" && f.pw !== f.pw2) return toast("The two passwords don't match.", "err");
    setBusy(true);
    try {
      if (mode === "signup") await neonAuth.signUp(email, f.pw);
      else await neonAuth.signIn(email, f.pw);
      await onDone();
    } catch (e2) {
      const msg = e2?.message || "error";
      toast(mode === "signup" && /exist/i.test(msg) ? "That email already has an account — sign in instead." : "Couldn't " + (mode === "signup" ? "create the account" : "sign in") + ": " + msg, "err");
    } finally { setBusy(false); }
  }
  return (
    <form onSubmit={submit} style={{ maxWidth: 420, margin: "60px auto", padding: 24 }} className="card card--pad-lg">
      <h2 style={{ marginTop: 0 }}>{mode === "signup" ? "Create your account" : "Welcome back"}</h2>
      <p style={{ color: "var(--muted)", marginTop: 4 }}>{mode === "signup" ? "Register, then set up your celebration site." : "Sign in to continue your setup."}</p>
      <Field label="Email" id="rg-email"><Input id="rg-email" type="email" value={f.email} onChange={set("email")} autoComplete="email" /></Field>
      <Field label="Password" id="rg-pw" hint="At least 8 characters"><Input id="rg-pw" type="password" value={f.pw} onChange={set("pw")} autoComplete={mode === "signup" ? "new-password" : "current-password"} /></Field>
      {mode === "signup" && <Field label="Confirm password" id="rg-pw2"><Input id="rg-pw2" type="password" value={f.pw2} onChange={set("pw2")} autoComplete="new-password" /></Field>}
      <Button type="submit" variant="primary" block disabled={busy}>{busy ? "Working…" : (mode === "signup" ? "Create account" : "Sign in")}</Button>
      <p style={{ textAlign: "center", marginTop: 14, fontSize: 14 }}>
        {mode === "signup" ? "Already have an account? " : "New here? "}
        <a href="#" onClick={(e) => { e.preventDefault(); setMode(mode === "signup" ? "signin" : "signup"); setF((p) => ({ ...p, pw: "", pw2: "" })); }}>{mode === "signup" ? "Sign in" : "Create one"}</a>
      </p>
    </form>
  );
}
