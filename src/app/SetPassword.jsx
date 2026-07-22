import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase.js";
import { Button, Icon, Input } from "@/ui/components.jsx";
import { Logo } from "@/admin/core.jsx";

// Landing page for the auto-approval "set your password" email. The recovery
// action link (generated server-side in the site-request Edge Function) lands
// here with the token in the URL hash; supabase-js (detectSessionInUrl, on by
// default) exchanges it for a session, then the owner picks their own password.
// Works on the new client's own subdomain — no client data needs to load first.
export function SetPassword() {
  // checking → (ready | error) ; ready → saving → done
  const [phase, setPhase] = useState("checking");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!supabase) { setPhase("error"); return; }
    let mounted = true;
    // The recovery link fires PASSWORD_RECOVERY / SIGNED_IN once the hash token
    // is exchanged. Also poll getSession in case the event already fired before
    // this listener attached.
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      if (mounted && session) setPhase("ready");
    });
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      if (data.session) { setPhase("ready"); return; }
      // give detectSessionInUrl a beat to run, then decide
      setTimeout(() => {
        supabase.auth.getSession().then(({ data: d2 }) => {
          if (mounted) setPhase(d2.session ? "ready" : "error");
        });
      }, 1800);
    });
    return () => { mounted = false; sub.subscription.unsubscribe(); };
  }, []);

  async function save() {
    setErr("");
    if (pw.length < 8) { setErr("Use at least 8 characters."); return; }
    if (pw !== pw2) { setErr("The two passwords don't match."); return; }
    setPhase("saving");
    const { error } = await supabase.auth.updateUser({ password: pw });
    if (error) { setErr(error.message || "Couldn't set your password."); setPhase("ready"); return; }
    setPhase("done");
    setTimeout(() => { window.location.assign("/admin"); }, 1400);
  }

  return (
    <div className="signin admin--sa apply-page">
      <div className="signin__pane">
        <header className="signin__top"><div className="signin__brand"><Logo size={30} /><span className="signin__word">Celebrately</span></div></header>
        <div className="signin__center">
          <div className="signin__form" style={{ textAlign: phase === "ready" || phase === "saving" ? "left" : "center" }}>
            {phase === "checking" && (
              <p className="signin__sub">Verifying your link…</p>
            )}
            {phase === "error" && (<>
              <h1 className="signin__title">Link expired</h1>
              <p className="signin__sub">This set-password link is invalid or has already been used. Ask your site owner to resend it, or reset your password from the sign-in page.</p>
              <Button variant="primary" block onClick={() => window.location.assign("/admin")}>Go to sign in</Button>
            </>)}
            {phase === "done" && (<>
              <div className="apply-done__badge">{Icon.check({ style: { width: 30, height: 30 } })}</div>
              <h1 className="signin__title">Password set! 🎉</h1>
              <p className="signin__sub">Taking you to your admin…</p>
            </>)}
            {(phase === "ready" || phase === "saving") && (<>
              <h1 className="signin__title">Set your password</h1>
              <p className="signin__sub">Choose a password for your Celebrately admin. You'll use your email and this password to sign in.</p>
              <label className="field"><span className="field__label">New password</span>
                <Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="At least 8 characters" onKeyDown={(e) => e.key === "Enter" && save()} />
              </label>
              <label className="field"><span className="field__label">Confirm password</span>
                <Input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} placeholder="Re-type it" onKeyDown={(e) => e.key === "Enter" && save()} />
              </label>
              {err && <p className="signin__err" role="alert">{err}</p>}
              <Button variant="primary" block disabled={phase === "saving"} onClick={save}>{phase === "saving" ? "Saving…" : "Set password & continue"}</Button>
            </>)}
          </div>
        </div>
      </div>
    </div>
  );
}
