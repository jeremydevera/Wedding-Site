import React from "react";
import { neonAuth, authedRpc, neonRpc, NEON_FLAG_KEY } from "@/lib/neon.js";
import { getAppConfig, checkRequestSubdomainFree } from "@/lib/api.js";
import { ApplyWizard } from "@/admin/apply.jsx";
import { Logo } from "@/admin/core.jsx";
import { toast } from "@/ui/components.jsx";
const { useState, useEffect } = React;

// Self-registration (Neon backend) — apex (celebrately.us/www) + sandbox hosts,
// behind USE NEON DATABASE.
// States: loading → off | auth | wizard | pending | done.
// The wizard is what creates the site; until it finishes there is no site, so
// nothing but the wizard (or the auth card / pending notice) ever renders here.
// All phases render in the neutral "signin" shell (owner rule: NO wedding theme
// on the registration flow — same clean design as the login page and /apply).
function Shell({ children }) {
  return (
    <div className="signin admin--sa apply-page">
      <div className="signin__pane">
        <header className="signin__top"><div className="signin__brand"><Logo size={30} /><span className="signin__word">Celebrately</span></div></header>
        <div className="signin__center">{children}</div>
      </div>
    </div>
  );
}

export function RegisterPage() {
  const [phase, setPhase] = useState("loading");
  const [email, setEmail] = useState("");
  const [sub, setSub] = useState(""); // pending OR live subdomain, per phase

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
    // Owner rule: never auto-redirect — always SHOW the link so she can see and
    // click her site's address (works for just-created and returning users).
    if (st?.state === "active") { setSub(st.subdomain || ""); setPhase("done"); return; }
    if (st?.state === "pending") { setSub(st.subdomain || ""); setPhase("pending"); return; }
    setPhase("wizard");
  }
  useEffect(() => { resolvePhase(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // both databases must agree the address is free
  const subCheck = async (s) => {
    const [supaFree, neonFree] = await Promise.all([
      checkRequestSubdomainFree(s).catch(() => false),
      neonRpc("subdomain_free", { p_sub: s }).then((v) => v === true).catch(() => false),
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
    if (res?.result === "created") { setSub(res.subdomain); setPhase("done"); return { approved: true }; }
    setSub(res?.subdomain || p.subdomain); setPhase("pending");
    return { approved: false };
  };

  const signOut = async () => { await neonAuth.signOut(); setPhase("auth"); };

  if (phase === "loading") return (
    <Shell><div className="signin__form" style={{ textAlign: "center", color: "var(--sg-sub)" }}>Loading…</div></Shell>
  );
  if (phase === "off") return (
    <Shell>
      <div className="signin__form" style={{ textAlign: "center" }}>
        <h1 className="signin__title">Registration isn't open yet</h1>
        <p className="signin__sub">Please check back soon.</p>
      </div>
    </Shell>
  );
  if (phase === "auth") return <Shell><AuthCard onDone={resolvePhase} /></Shell>;
  if (phase === "pending") return (
    <Shell>
      <div className="signin__form" style={{ textAlign: "center" }}>
        <h1 className="signin__title">Request received 🎉</h1>
        <p className="signin__sub">Your site <strong>{sub}.celebrately.us</strong> is waiting for approval. Sign back in here anytime — the link to your site will appear as soon as it's approved.</p>
        <button type="button" className="signin__btn" style={{ marginTop: 18 }} onClick={signOut}>Sign out</button>
      </div>
    </Shell>
  );
  if (phase === "done") return (
    <Shell>
      <div className="signin__form" style={{ textAlign: "center" }}>
        <h1 className="signin__title">Your site is live! 🎉</h1>
        <p className="signin__sub">Here's your website — save this link and share it with your guests:</p>
        <a className="signin__btn" style={{ display: "block", marginTop: 18, textDecoration: "none", textAlign: "center" }} href={`https://${sub}.celebrately.us`}>
          Open {sub}.celebrately.us →
        </a>
        <div style={{ textAlign: "left", marginTop: 22, padding: "14px 16px", border: "1px solid var(--sg-line, #e5e7eb)", borderRadius: 12 }}>
          <p style={{ fontWeight: 700, margin: 0, fontSize: 14 }}>Manage your site</p>
          <p style={{ fontSize: 13, color: "var(--sg-sub)", margin: "6px 0 8px" }}>
            Open your site and tap <strong>Admin sign in</strong> at the very bottom, then sign in with the email and password you used here:
          </p>
          <img src="/assets/register-admin-hint.png" alt="The Admin sign in link at the bottom of your site" style={{ width: "100%", borderRadius: 8, border: "1px solid var(--sg-line, #e5e7eb)", display: "block" }} />
          <a href={`https://${sub}.celebrately.us/admin`} style={{ display: "inline-block", marginTop: 10, fontSize: 13, fontWeight: 600 }}>
            Or go straight to your admin: {sub}.celebrately.us/admin →
          </a>
        </div>
        <p style={{ textAlign: "center", fontSize: 13, color: "var(--sg-sub)", marginTop: 16 }}>
          You can come back to this page and sign in anytime to find these links again.
        </p>
        <p style={{ textAlign: "center", fontSize: 13, marginTop: 6 }}>
          <a href="#" style={{ color: "var(--sg-sub)" }} onClick={(e) => { e.preventDefault(); signOut(); }}>Sign out</a>
        </p>
      </div>
    </Shell>
  );
  // wizard — fullscreen, nothing else (the wizard creates the site; it renders
  // its own signin-style shell). draftKey: fields + step survive refresh,
  // session expiry, and coming back later — resumes where she left off.
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
    <form className="signin__form" onSubmit={submit} noValidate>
      <h1 className="signin__title">{mode === "signup" ? "Create your account" : "Welcome back"}</h1>
      <p className="signin__sub">{mode === "signup" ? "Register, then set up your celebration site." : "Sign in to continue your setup."}</p>
      <div className="signin__field">
        <label htmlFor="rg-email">Email</label>
        <input id="rg-email" type="email" autoComplete="email" value={f.email} onChange={set("email")} placeholder="you@example.com" />
      </div>
      <div className="signin__field">
        <label htmlFor="rg-pw">Password</label>
        <input id="rg-pw" type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} value={f.pw} onChange={set("pw")} placeholder="At least 8 characters" />
      </div>
      {mode === "signup" && (
        <div className="signin__field">
          <label htmlFor="rg-pw2">Confirm password</label>
          <input id="rg-pw2" type="password" autoComplete="new-password" value={f.pw2} onChange={set("pw2")} placeholder="••••••••" />
        </div>
      )}
      <button type="submit" className="signin__btn" disabled={busy}>{busy ? "Working…" : (mode === "signup" ? "Create account" : "Sign in")}</button>
      <p style={{ textAlign: "center", fontSize: 13, color: "var(--sg-sub)", marginTop: 14 }}>
        {mode === "signup" ? "Already have an account? " : "New here? "}
        <a href="#" style={{ color: "#1E5BD6", fontWeight: 600, textDecoration: "none" }}
          onClick={(e) => { e.preventDefault(); setMode(mode === "signup" ? "signin" : "signup"); setF((p) => ({ ...p, pw: "", pw2: "" })); }}>
          {mode === "signup" ? "Sign in →" : "Create one →"}
        </a>
      </p>
    </form>
  );
}
