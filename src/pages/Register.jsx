import React from "react";
import { neonAuth, authedRpc, neonRpc, neonAuthedSelect, NEON_FLAG_KEY, NEON_SHARDS_KEY, FB_AUTH_FLAG_KEY, setFbAuthMode, fbAuthMode, setNeonRegistry, resolveShardId, setActiveShard } from "@/lib/neon.js";
import { getAppConfig, checkRequestSubdomainFree } from "@/lib/api.js";
import { ApplyWizard } from "@/admin/apply.jsx";
import { Logo, SigninAside } from "@/admin/core.jsx";
import { toast, Icon } from "@/ui/components.jsx";
import { signInWithGoogle } from "@/lib/firebase.js";
const { useState, useEffect } = React;

// Google button is always visible (owner request). Until the Neon Data-API
// cutover lands, a successful Google sign-in verifies identity via Firebase but
// cannot yet mint the site session — the toast says so and points to email
// signup, which works fully today.
const googleEnabled = () => true;

// Self-registration (Neon backend) — apex (celebrately.us/www) + sandbox hosts,
// behind USE NEON DATABASE.
// States: loading → off | auth | wizard | pending | done.
// The wizard is what creates the site; until it finishes there is no site, so
// nothing but the wizard (or the auth card / pending notice) ever renders here.
// All phases render in the neutral "signin" shell (owner rule: NO wedding theme
// on the registration flow — same clean design as the login page and /apply).
function Shell({ children }) {
  // Same split shell as the main login (promo-video aside) — the sign-up card
  // and the login page share one look; mobile collapses to the light single
  // page via the same .signin--split media block.
  return (
    <div className="signin signin--split admin--sa apply-page">
      <SigninAside />
      <div className="signin__pane">
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
    // Flag + shard registry together — new registrations land on the registry's
    // DEFAULT shard (bySubdomain can't match a not-yet-registered name), so
    // adding shard s2 later is a config write, no redeploy (was s1-hardcoded).
    const [flag, shardCfg, fbFlag] = await Promise.all([
      getAppConfig(NEON_FLAG_KEY).catch(() => null),
      getAppConfig(NEON_SHARDS_KEY).catch(() => null),
      getAppConfig(FB_AUTH_FLAG_KEY).catch(() => null),
    ]);
    if (flag?.enabled !== true) { setPhase("off"); return; }
    setFbAuthMode(fbFlag?.enabled === true);
    setNeonRegistry(shardCfg);
    setActiveShard(resolveShardId(""));
    const s = await neonAuth.session();
    if (!s) { setPhase("auth"); return; }
    setEmail(s.user?.email || "");
    // Platform-admin guard: the superadmin's shared Neon session (from helping a
    // client's admin) must NEVER reach the wizard — register_site would overwrite
    // the superadmin profile to 'owner' (also guarded server-side in SQL).
    const prof = await neonAuthedSelect("profiles", `select=role&id=eq.${encodeURIComponent(s.user?.id || "")}`).catch(() => null);
    if (prof && prof[0] && prof[0].role === "superadmin") {
      // The platform admin never registers — take them straight to the console
      // (no interstitial). Testing registration as a client = private window.
      setPhase("sa");
      window.location.replace("/admin");
      return;
    }
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

  // Sign-out LEAVES the registration flow — landing back on this page's auth
  // card read as "why am I still on register?". Go to the main login instead.
  const signOut = async () => { await neonAuth.signOut(); window.location.assign("/"); };

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
  if (phase === "sa") return (
    // Auto-redirecting to /admin (resolvePhase issued the replace). This renders
    // only for the brief moment before navigation lands.
    <Shell>
      <div className="signin__form" style={{ textAlign: "center", color: "var(--sg-sub)" }}>
        You're the platform admin — taking you to your console…
        <p style={{ fontSize: 13, marginTop: 12 }}><a href="/admin">Open the console →</a></p>
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
  if (phase === "done") {
    const siteUrl = `${sub}.celebrately.us`;
    const copyLink = async () => {
      try { await navigator.clipboard.writeText(`https://${siteUrl}`); toast("Link copied — share it with your guests!", "success"); }
      catch { toast("Couldn't copy — long-press the link to copy it.", "err"); }
    };
    return (
      <Shell>
        <div className="rdone">
          <div className="rdone__badge">{Icon.check({ style: { width: 30, height: 30 } })}</div>
          <h1 className="rdone__title">You're all set! 🎉</h1>
          <p className="rdone__sub">Your website is live and ready to share.</p>

          {/* the one thing they want: their link */}
          <div className="rdone__linkcard">
            <span className="rdone__linklabel">Your website</span>
            <div className="rdone__linkrow">
              <span className="rdone__url" title={siteUrl}>{siteUrl}</span>
              <button type="button" className="rdone__copy" onClick={copyLink}>Copy link</button>
            </div>
            <a className="rdone__open" href={`https://${siteUrl}`} target="_blank" rel="noreferrer">Open my website →</a>
          </div>

          {/* clear next steps */}
          <div className="rdone__next">
            <span className="rdone__nexthead">What now?</span>
            <ol className="rdone__steps">
              <li className="rdone__step">
                <span className="rdone__num">1</span>
                <div className="rdone__stepbody">
                  <b>Share it with your guests</b>
                  <p>Tap <strong>Copy link</strong>, then share it with your guests.</p>
                </div>
              </li>
              <li className="rdone__step">
                <span className="rdone__num">2</span>
                <div className="rdone__stepbody">
                  <b>Manage your site anytime</b>
                  <p>Tap <strong>Open my dashboard</strong> to manage RSVPs, edit details, and more.</p>
                  <a className="rdone__adminbtn" href={`https://${siteUrl}/admin`} target="_blank" rel="noreferrer">Open my dashboard →</a>
                </div>
              </li>
            </ol>
          </div>

          <p className="rdone__foot">Bookmark this page — sign in anytime to find these links again.</p>
          <button type="button" className="rdone__signout" onClick={signOut}>Sign out</button>
        </div>
      </Shell>
    );
  }
  // wizard — fullscreen (the wizard creates the site; it renders its own
  // signin-style shell). draftKey: fields + step survive refresh, session
  // expiry, and coming back later — resumes where she left off. The floating
  // sign-out lets a signed-in-but-unfinished user switch accounts (her draft
  // stays in this browser's localStorage for when she returns).
  return (
    <>
      <ApplyWizard presetEmail={email} subCheck={subCheck} submitOverride={submitOverride} draftKey="neonRegDraft" />
      {/* label stays short (no email) — the address is already in the wizard's
          email field; title shows it on hover for the curious */}
      <button type="button" className="reg-signout" onClick={signOut} title={email || undefined}>Sign out</button>
    </>
  );
}

// Cloudflare Turnstile "always passes" TEST sitekey — mirrors the proxy's test
// secret. Override with the real key via app_config('turnstile').siteKey (no
// redeploy) once the TURNSTILE_SECRET Pages secret holds the real secret.
const TURNSTILE_TEST_SITEKEY = "1x00000000000000000000AA";

function AuthCard({ onDone }) {
  const [mode, setMode] = useState("signup"); // signup | signin | verify
  const [f, setF] = useState({ email: "", pw: "", pw2: "", otp: "" });
  const [busy, setBusy] = useState(false);
  const [tsToken, setTsToken] = useState("");
  const [gBusy, setGBusy] = useState(false);     // Google sign-in in flight
  const [tsError, setTsError] = useState("");   // widget failed to load / verify
  const [tsNonce, setTsNonce] = useState(0);     // bump to force a re-render (Retry)
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  // Turnstile widget (signup only). The token is verified SERVER-side by the
  // /api/auth proxy — this widget just produces it. Script is loaded once;
  // widget re-renders when switching back to signup mode (or on Retry via tsNonce).
  useEffect(() => {
    // Firebase mode: no Turnstile. Signup goes straight to Firebase (its own
    // rate limits + email verification); the proxy that server-verified the
    // token isn't in the path, so the widget would be theater — and a widget
    // domain misconfig must never brick signups.
    if (mode !== "signup" || fbAuthMode()) return;
    let widgetId = null, dead = false, guard = null;
    setTsError("");
    const fail = (why) => { if (!dead) setTsError(why || "Security check couldn't load. Tap Retry, or refresh the page."); };
    const render = async () => {
      const cfg = await getAppConfig("turnstile").catch(() => null);
      if (dead) return;
      const el = document.getElementById("rg-turnstile");
      if (!el || !window.turnstile) { fail(); return; }
      el.innerHTML = "";
      try {
        widgetId = window.turnstile.render(el, {
          sitekey: cfg?.siteKey || TURNSTILE_TEST_SITEKEY,
          callback: (t) => { setTsToken(t); setTsError(""); },
          "expired-callback": () => setTsToken(""),
          // A sitekey not allow-listed for this domain fails HERE (or, worse,
          // silently — see the guard below). Surface it instead of a dead submit.
          "error-callback": () => { setTsToken(""); fail("Security check failed to load — the site key isn't valid for this domain. Tap Retry, or contact support."); return true; },
        });
      } catch (e) { fail(); return; }
      // Silent no-render guard. ⚠️ Do NOT probe for the iframe — Turnstile puts
      // it inside a CLOSED shadow root, so el.querySelector("iframe") is null
      // even when the widget is rendered and interactive (verified live: widget
      // visible, iframe query false → this guard false-fired the error on every
      // healthy load). The reliable light-DOM signal is the hidden
      // cf-turnstile-response input Turnstile injects into the container on a
      // successful render; only its absence means the widget truly didn't mount.
      // Poll (don't one-shot): Turnstile populates the container LAZILY — on a
      // cold load with a real challenge it can take >6s, so a single timeout
      // false-fires on slow connections. Keep checking; clear the error the
      // moment the widget arrives; only fail after a sustained 20s of nothing.
      let waited = 0;
      guard = setInterval(() => {
        if (dead) { clearInterval(guard); return; }
        const mounted = el.querySelector('input[name="cf-turnstile-response"]') || el.childElementCount > 0;
        if (mounted) { setTsError(""); clearInterval(guard); return; }
        waited += 1000;
        if (waited >= 20000) { clearInterval(guard); fail("Security check couldn't load. Tap Retry, or refresh the page."); }
      }, 1000);
    };
    if (window.turnstile) render();
    else {
      const s = document.createElement("script");
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      s.async = true; s.onload = render; s.onerror = () => fail();
      document.head.appendChild(s);
    }
    return () => { dead = true; if (guard) clearInterval(guard); try { if (widgetId !== null && window.turnstile) window.turnstile.remove(widgetId); } catch (e) { /* ignore */ } };
  }, [mode, tsNonce]);
  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    const email = f.email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return toast("Enter a valid email address.", "err");
    if (f.pw.length < 8) return toast("Password must be at least 8 characters.", "err");
    if (mode === "signup" && f.pw !== f.pw2) return toast("The two passwords don't match.", "err");
    if (mode === "signup" && !tsToken && !fbAuthMode()) return toast("Please complete the security check first.", "err");
    setBusy(true);
    try {
      if (mode === "signup") {
        const res = await neonAuth.signUp(email, f.pw, tsToken);
        // Email verification required: signup returns NO session (token null) —
        // the 6-digit code was emailed; collect it before continuing.
        if (!res?.token) { setMode("verify"); toast("We emailed you a 6-digit code — enter it below.", "ok"); return; }
      } else {
        await neonAuth.signIn(email, f.pw);
      }
      await onDone();
    } catch (e2) {
      const msg = e2?.message || "error";
      // Unverified account signing in → jump to the code screen (fresh code sent).
      if (/not verified/i.test(msg)) {
        neonAuth.sendVerifyOtp(email).catch(() => {});
        setMode("verify");
        toast("Your email isn't verified yet — we sent you a new 6-digit code.", "ok");
        return;
      }
      if (mode === "signup") { setTsToken(""); try { window.turnstile && window.turnstile.reset(); } catch (e3) { /* ignore */ } } // tokens are single-use
      toast(mode === "signup" && /exist/i.test(msg) ? "That email already has an account — sign in instead." : "Couldn't " + (mode === "signup" ? "create the account" : "sign in") + ": " + msg, "err");
    } finally { setBusy(false); }
  }
  async function verifyOtp(e) {
    e.preventDefault();
    if (busy) return;
    const email = f.email.trim().toLowerCase();
    const otp = (f.otp || "").trim();
    if (!/^\d{6}$/.test(otp)) return toast("Enter the 6-digit code from the email.", "err");
    setBusy(true);
    try {
      await neonAuth.verifyEmailOtp(email, otp);
      // auto_sign_in_after_verification: the verify response carries the session
      // JWT through the proxy — resolvePhase lands the user in the wizard.
      await onDone();
    } catch (e2) {
      toast("That code didn't work: " + (e2?.message || "error") + " — check the digits or resend.", "err");
    } finally { setBusy(false); }
  }
  if (mode === "verify") return (
    <form className="signin__form" onSubmit={verifyOtp} noValidate>
      <h1 className="signin__title">Check your email</h1>
      <p className="signin__sub">We sent a 6-digit code to <strong>{f.email}</strong>. Enter it to verify your email.</p>
      <div className="signin__field">
        <label htmlFor="rg-otp">Verification code</label>
        <input id="rg-otp" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={f.otp} onChange={set("otp")} placeholder="123456" />
      </div>
      <button type="submit" className="signin__btn" disabled={busy}>{busy ? "Verifying…" : "Verify & continue"}</button>
      <p style={{ textAlign: "center", fontSize: 13, color: "var(--sg-sub)", marginTop: 14 }}>
        Didn't get it?{" "}
        <a href="#" style={{ color: "#1E5BD6", fontWeight: 600, textDecoration: "none" }}
          onClick={(e) => { e.preventDefault(); neonAuth.sendVerifyOtp(f.email.trim().toLowerCase()).then(() => toast("New code sent.", "ok")).catch((e2) => toast("Couldn't resend: " + (e2?.message || "error"), "err")); }}>
          Resend code
        </a>
        {"  ·  "}
        <a href="#" style={{ color: "var(--sg-sub)" }} onClick={(e) => { e.preventDefault(); setMode("signin"); setF((p) => ({ ...p, otp: "" })); }}>Back to sign in</a>
      </p>
    </form>
  );
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
      {mode === "signup" && !fbAuthMode() && <div id="rg-turnstile" style={{ margin: "6px 0 2px", minHeight: 66 }} />}
      {mode === "signup" && !fbAuthMode() && tsError && (
        <p style={{ fontSize: 13, color: "#B42318", margin: "0 0 6px", textAlign: "center", lineHeight: 1.4 }}>
          {tsError}{" "}
          <a href="#" style={{ color: "#1E5BD6", fontWeight: 600, textDecoration: "none" }}
            onClick={(e) => { e.preventDefault(); setTsToken(""); setTsError(""); setTsNonce((n) => n + 1); }}>Retry</a>
        </p>
      )}
      <button type="submit" className="signin__btn" disabled={busy}>{busy ? "Working…" : (mode === "signup" ? "Create account" : "Sign in")}</button>
      {googleEnabled() && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "16px 0 12px", color: "var(--sg-sub)", fontSize: 12 }}>
            <span style={{ flex: 1, height: 1, background: "var(--sg-line, #e5e7eb)" }} /> or <span style={{ flex: 1, height: 1, background: "var(--sg-line, #e5e7eb)" }} />
          </div>
          <button type="button" disabled={gBusy}
            onClick={async () => {
              setGBusy(true);
              try {
                if (fbAuthMode()) {
                  // Real flow: Google → Firebase session → registration state →
                  // wizard/done, exactly like an email sign-in.
                  await neonAuth.signInGoogle();
                  await onDone();
                  return;
                }
                const { user } = await signInWithGoogle();
                toast(`Signed in with Google as ${user.email} ✓ — Google account creation is finishing rollout. For today, create your site with email & password below.`, "success");
              } catch (e2) {
                const m = e2?.message || "";
                toast(/operation-not-allowed/.test(m) ? "Enable Google in the Firebase console first (Authentication → Sign-in method)." : /popup-closed|cancelled/.test(m) ? "Google sign-in cancelled." : "Google sign-in failed: " + m, "err");
              } finally { setGBusy(false); }
            }}
            style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: "11px 14px", border: "1px solid var(--sg-line, #dadce0)", borderRadius: 10, background: "#fff", cursor: "pointer", fontSize: 15, fontWeight: 600, color: "#3c4043" }}>
            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.7 1.22 9.2 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
            {gBusy ? "Opening Google…" : "Continue with Google"}
          </button>

        </>
      )}
      <p style={{ textAlign: "center", fontSize: 13, color: "var(--sg-sub)", marginTop: 14 }}>
        {mode === "signup" ? "Already have an account? " : "New here? "}
        <a href="#" style={{ color: "#1E5BD6", fontWeight: 600, textDecoration: "none" }}
          onClick={(e) => { e.preventDefault(); if (mode === "signup") { window.location.assign("/admin"); return; } setMode("signup"); setF((p) => ({ ...p, pw: "", pw2: "" })); setTsToken(""); }}>
          {mode === "signup" ? "Sign in →" : "Create one →"}
        </a>
      </p>
    </form>
  );
}
