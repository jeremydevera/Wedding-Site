// self-signup — RETIRED / DISABLED.
//
// Public self-serve registration used to create an auth user + client site +
// owner profile in one unauthenticated call. That flow is retired: /register now
// redirects to /apply (see src/app/App.jsx), and every new site goes through the
// superadmin-approved /apply intake (site-request Edge Function). Leaving this
// endpoint live is an abuse vector — a public, unauthenticated, service-role
// endpoint that mints confirmed accounts with no rate limit (#12), can pre-confirm
// an email you don't own (#18), and leaked raw auth errors (#33). Since nothing in
// the app calls it anymore, it is disabled here (fail closed) rather than left
// exploitable. Re-enable only behind CAPTCHA + email verification if self-serve
// signup is ever revived.
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  return new Response(
    JSON.stringify({ error: "Self-serve signup is disabled. Request a site at /apply." }),
    { status: 410, headers: { ...cors, "Content-Type": "application/json" } },
  );
});
