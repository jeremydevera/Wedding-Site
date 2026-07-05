import React from "react";
import { go } from "@/lib/nav.js";
import { selfSignup, checkSubdomainFree } from "@/lib/api.js";
import { Icon } from "@/ui/components.jsx";
import { Logo } from "@/admin/core.jsx";
const { useState, useEffect, useRef } = React;

// ============================================================================
// register.jsx — public self-serve signup on the apex hub (/register).
// Collects the minimum (names, email, password, site address, optional date),
// calls the self-signup Edge Function, then sends the new owner to their
// subdomain admin where the setup wizard runs on first login.
// ============================================================================

const slug = (a, b) =>
  (a + "-" + b).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30);

export function RegisterPage() {
  const [f, setF] = useState({ partnerA: "", partnerB: "", email: "", password: "", weddingDate: "", subdomain: "" });
  const [touchedSub, setTouchedSub] = useState(false); // stop auto-suggest once edited
  const [showPw, setShowPw] = useState(false);
  const [agree, setAgree] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null); // { subdomain } after success
  const [subState, setSubState] = useState("idle"); // idle | checking | free | taken | invalid

  const set = (k) => (e) => { setErr(""); setF((p) => ({ ...p, [k]: e.target.value })); };

  // auto-suggest the site address from the names until the user edits it
  useEffect(() => {
    if (touchedSub) return;
    if (f.partnerA.trim() && f.partnerB.trim()) {
      setF((p) => ({ ...p, subdomain: slug(p.partnerA, p.partnerB) }));
    }
  }, [f.partnerA, f.partnerB, touchedSub]);

  // debounced live availability check
  const checkTimer = useRef(null);
  useEffect(() => {
    const sub = f.subdomain.trim().toLowerCase();
    if (!sub) { setSubState("idle"); return; }
    if (!/^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/.test(sub)) { setSubState("invalid"); return; }
    setSubState("checking");
    clearTimeout(checkTimer.current);
    checkTimer.current = setTimeout(() => {
      checkSubdomainFree(sub)
        .then((free) => setSubState(free ? "free" : "taken"))
        .catch(() => setSubState("idle")); // check failure never blocks — server re-validates
    }, 450);
    return () => clearTimeout(checkTimer.current);
  }, [f.subdomain]);

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    setErr("");
    if (!f.partnerA.trim() || !f.partnerB.trim()) return setErr("Please enter both of your names.");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim())) return setErr("Please enter a valid email.");
    if (f.password.length < 8) return setErr("Password must be at least 8 characters.");
    if (subState === "taken") return setErr("That site address is already taken — try another.");
    if (subState === "invalid") return setErr("Site address: 3–30 characters, letters/numbers/hyphens.");
    if (!agree) return setErr("Please accept the terms to continue.");
    setBusy(true);
    try {
      const res = await selfSignup({
        email: f.email.trim(), password: f.password,
        partnerA: f.partnerA.trim(), partnerB: f.partnerB.trim(),
        weddingDate: f.weddingDate, subdomain: f.subdomain.trim().toLowerCase(),
      });
      setDone({ subdomain: res.subdomain });
    } catch (e2) {
      setErr(e2.message || "Could not create your site.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    const safeSub = /^[a-z0-9-]{1,63}$/.test(done.subdomain) ? done.subdomain : "";
    const site = safeSub ? `${safeSub}.celebrately.us` : "celebrately.us";
    return (
      <div className="signin">
        <div className="signin__pane">
          <header className="signin__top">
            <div className="signin__brand"><Logo size={30} /><span className="signin__word">Celebrately</span></div>
          </header>
          <div className="signin__center">
            <div className="signin__form" style={{ textAlign: "center" }}>
              <div style={{ color: "#16a34a", marginBottom: 14 }}>{Icon.check({ style: { width: 42, height: 42 } })}</div>
              <h1 className="signin__title">Your site is ready!</h1>
              <p className="signin__sub" style={{ marginBottom: 8 }}>
                <strong>{site}</strong>
              </p>
              <p className="signin__sub">Sign in with your new account to finish setting it up — a quick 3-step wizard is waiting for you.</p>
              <a className="signin__btn" style={{ display: "block", textAlign: "center", textDecoration: "none" }} href={`https://${site}/admin`}>
                Go to my admin →
              </a>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="signin">
      <div className="signin__pane">
        <header className="signin__top">
          <div className="signin__brand"><Logo size={30} /><span className="signin__word">Celebrately</span></div>
          <button className="signin__back" onClick={() => go("admin")}>Sign in instead</button>
        </header>
        <div className="signin__center">
          <form className="signin__form" onSubmit={submit} noValidate>
            <h1 className="signin__title">Create your wedding site</h1>
            <p className="signin__sub">Live in minutes. Free to start.</p>

            <div className="field-row field-row--2">
              <div className="signin__field">
                <label htmlFor="r-pa">Your first name</label>
                <input id="r-pa" value={f.partnerA} onChange={set("partnerA")} placeholder="Romeo" />
              </div>
              <div className="signin__field">
                <label htmlFor="r-pb">Partner's first name</label>
                <input id="r-pb" value={f.partnerB} onChange={set("partnerB")} placeholder="Juliet" />
              </div>
            </div>

            <div className="signin__field">
              <label htmlFor="r-email">Email</label>
              <input id="r-email" type="email" autoComplete="email" value={f.email} onChange={set("email")} placeholder="you@example.com" />
            </div>

            <div className="signin__field">
              <label htmlFor="r-pw">Password</label>
              <div className="signin__pwwrap">
                <input id="r-pw" type={showPw ? "text" : "password"} autoComplete="new-password" value={f.password} onChange={set("password")} placeholder="At least 8 characters" />
                <button type="button" className="signin__eye" onClick={() => setShowPw((v) => !v)} aria-label={showPw ? "Hide password" : "Show password"}>{(showPw ? Icon.eyeOff : Icon.eye)({})}</button>
              </div>
            </div>

            <div className="signin__field">
              <label htmlFor="r-date">Wedding date <span style={{ color: "var(--sg-sub)", fontWeight: 400 }}>(optional — you can set it later)</span></label>
              <input id="r-date" type="datetime-local" value={f.weddingDate} onChange={set("weddingDate")} />
            </div>

            <div className="signin__field">
              <label htmlFor="r-sub">Site address</label>
              <div className="reg-sub">
                <input id="r-sub" value={f.subdomain} onChange={(e) => { setTouchedSub(true); set("subdomain")(e); }} placeholder="romeo-juliet" spellCheck={false} />
                <span className="reg-sub__suffix">.celebrately.us</span>
              </div>
              <div className="reg-sub__state" data-state={subState}>
                {subState === "checking" && "Checking availability…"}
                {subState === "free" && "✓ Available"}
                {subState === "taken" && "✕ Already taken — try another"}
                {subState === "invalid" && "3–30 characters: letters, numbers, hyphens"}
              </div>
            </div>

            <label className="reg-terms">
              <input type="checkbox" checked={agree} onChange={(e) => { setErr(""); setAgree(e.target.checked); }} />
              <span>I agree to the Terms of Service and Privacy Policy</span>
            </label>

            {err && <div className="signin__err" style={{ marginBottom: 12 }}>{err}</div>}

            <button type="submit" className="signin__btn" disabled={busy}>{busy ? "Creating your site…" : "Create my site"}</button>
          </form>
        </div>
      </div>
    </div>
  );
}
