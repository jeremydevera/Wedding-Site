import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Browser-invoked from the app's own domain → needs CORS + OPTIONS preflight.
// Auth is enforced inside the function (caller must be a superadmin), so this is
// deployed with verify_jwt disabled (otherwise the OPTIONS preflight is rejected).
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (o: unknown, status = 200) =>
    new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") || "";
  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // 1. verify the CALLER is a superadmin (using their JWT)
  const caller = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: u } = await caller.auth.getUser();
  if (!u?.user) return json({ error: "Unauthorized" }, 401);
  const { data: prof } = await caller.from("profiles").select("role").eq("id", u.user.id).single();
  if (prof?.role !== "superadmin") return json({ error: "Forbidden" }, 403);

  const admin = createClient(url, service);
  const body = await req.json();

  async function findByEmail(email: string) {
    // Paginate fully — do NOT assume the project has <=1000 auth users, or owners
    // past the first page become invisible (update/delete/reset silently misbehave).
    const perPage = 1000;
    for (let page = 1; ; page++) {
      const { data: list, error } = await admin.auth.admin.listUsers({ page, perPage });
      if (error) throw new Error(error.message);
      const hit = list.users.find((x) => x.email === email);
      if (hit) return hit;
      if (list.users.length < perPage) return undefined; // last page reached
    }
  }

  // 2a. change an existing owner's login email
  if (body.action === "update_email") {
    const { old_email, new_email } = body;
    if (!old_email || !new_email) return json({ error: "Bad request" }, 400);
    const existing = await findByEmail(old_email);
    if (!existing) return json({ error: "Owner not found" }, 400);
    const { error } = await admin.auth.admin.updateUserById(existing.id, { email: new_email, email_confirm: true });
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true, userId: existing.id });
  }

  // 2c. delete an owner's auth account (its profile cascades via profiles.id->users).
  // Find by email, or by user_id, or by the (still-linked) profile for a client_id.
  if (body.action === "delete_owner") {
    const { email, user_id, client_id } = body;
    let userId = user_id as string | undefined;
    if (!userId && email) userId = (await findByEmail(email))?.id;
    if (!userId && client_id) {
      const { data: prof } = await admin.from("profiles").select("id").eq("client_id", client_id).eq("role", "owner").maybeSingle();
      userId = prof?.id;
    }
    if (!userId) return json({ ok: true, noop: true }); // nothing to delete
    // Safety: never delete a superadmin via this path.
    const { data: p } = await admin.from("profiles").select("role").eq("id", userId).single();
    if (p?.role === "superadmin") return json({ error: "Refusing to delete a superadmin" }, 400);
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true, deleted: userId });
  }

  // 2d. email an owner a "set your password" (recovery) link + their site link —
  // the same message auto-approve sends, used on MANUAL approval. Needs the
  // project-wide RESEND_API_KEY secret (shared with the site-request function).
  if (body.action === "send_setup_email") {
    const { email, subdomain, name } = body;
    if (!email || !subdomain) return json({ error: "Bad request" }, 400);
    const siteUrl = `https://${subdomain}.celebrately.us`;
    const { data: link, error: lErr } = await admin.auth.admin.generateLink({
      type: "recovery",
      email,
      options: { redirectTo: `${siteUrl}/set-password` },
    });
    if (lErr) return json({ error: lErr.message }, 400);
    const actionLink = (link as { properties?: { action_link?: string } })?.properties?.action_link || `${siteUrl}/set-password`;
    try { await sendApprovalEmail(email, name || "", siteUrl, actionLink); }
    catch (e) { return json({ error: (e as Error)?.message || "email send failed" }, 502); }
    return json({ ok: true });
  }

  // 2b. create the owner, or reset the password of an existing owner
  const { email, password, client_id } = body;
  if (!email || !password || !client_id) return json({ error: "Bad request" }, 400);
  const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  let userId = created?.user?.id;
  const wasCreated = !error && !!userId; // did THIS call create the auth user?
  if (error) {
    const existing = await findByEmail(email);
    if (!existing) return json({ error: error.message }, 400);
    userId = existing.id;
    // Reset the existing owner's password — do NOT ignore the result; a failed
    // reset must not be reported as success (owner would be locked out).
    const { error: pwErr } = await admin.auth.admin.updateUserById(userId, { password });
    if (pwErr) return json({ error: pwErr.message }, 400);
  }
  const { error: profErr } = await admin.from("profiles").upsert({ id: userId, role: "owner", client_id });
  if (profErr) {
    // Fail closed: a created-but-profile-less auth user is a broken owner. Roll back
    // the auth user we just created (mirror self-signup) and surface the error.
    if (wasCreated) await admin.auth.admin.deleteUser(userId!);
    return json({ error: profErr.message }, 400);
  }
  return json({ ok: true, userId });
});

// Owner "set your password" + site-link email (Resend). Mirrors the template in
// the site-request function — keep the two copies in sync.
async function sendApprovalEmail(to: string, name: string, siteUrl: string, actionLink: string) {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) throw new Error("RESEND_API_KEY not set on the edge function");
  const from = Deno.env.get("RESEND_FROM") || "Celebrately <noreply@send.celebrately.us>";
  const first = (name || "there").split(/\s+/)[0];
  const html = `
  <div style="font-family:Segoe UI,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;color:#2a2a2a">
    <h1 style="font-size:22px;color:#4b5320;margin:0 0 8px">Your website is ready, ${escapeHtml(first)}! 🎉</h1>
    <p style="font-size:15px;line-height:1.6">Your Celebrately site has been approved and created. Two quick steps to get in:</p>
    <p style="font-size:15px;line-height:1.6;margin:0 0 6px"><strong>1. Set your password</strong></p>
    <p style="margin:0 0 20px"><a href="${actionLink}" style="display:inline-block;background:#4b5320;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:600;font-size:15px">Set your password</a></p>
    <p style="font-size:15px;line-height:1.6;margin:0 0 6px"><strong>2. Visit your site</strong></p>
    <p style="margin:0 0 20px"><a href="${siteUrl}" style="color:#4b5320;font-weight:600">${siteUrl}</a></p>
    <p style="font-size:13px;color:#777;line-height:1.6">Sign in anytime at <a href="${siteUrl}/admin" style="color:#777">${siteUrl}/admin</a> with your email and the password you set. If you didn't request this, you can ignore this email.</p>
    <p style="font-size:13px;color:#aaa;margin-top:22px">— The Celebrately team</p>
  </div>`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject: "Your Celebrately website is ready 🎉", html }),
  });
  if (!res.ok) {
    let msg = `resend ${res.status}`;
    try { const e = await res.json(); if (e?.message) msg = e.message; } catch (_) { /* ignore */ }
    throw new Error("email send failed: " + msg);
  }
}

function escapeHtml(s: string) {
  return String(s).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]!));
}
