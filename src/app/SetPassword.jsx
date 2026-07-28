import { Button } from "@/ui/components.jsx";
import { Logo } from "@/admin/core.jsx";

// The legacy Supabase "set your password" recovery flow is retired. Owners now
// set/reset their password via Firebase — the sign-in page's "Forgot your
// password?" link (or a Firebase reset email) — so this page just points there.
export function SetPassword() {
  return (
    <div className="signin admin--sa apply-page">
      <div className="signin__pane">
        <header className="signin__top"><div className="signin__brand"><Logo size={30} /><span className="signin__word">Celebrately</span></div></header>
        <div className="signin__center">
          <div className="signin__form" style={{ textAlign: "center" }}>
            <h1 className="signin__title">Set your password</h1>
            <p className="signin__sub">Head to the sign-in page and choose &ldquo;Forgot your password?&rdquo; to set a new password for your Celebrately admin.</p>
            <Button variant="primary" block onClick={() => window.location.assign("/admin")}>Go to sign in</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
