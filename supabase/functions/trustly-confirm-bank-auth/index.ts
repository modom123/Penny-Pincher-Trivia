// Called by the mobile client's return leg after the player finishes
// authorizing their bank with Trustly (see trustly-establish-bank-auth's
// returnUrl, which gets ?transactionId=... appended). Deliberately does NOT
// trust that query param at face value - it re-checks the transaction's
// status directly with Trustly before storing it, the same "never trust the
// client-side redirect alone" rule the Stripe integration follows (the
// wallet is only ever credited from stripe-webhook, never a client redirect).
//
// *** VERIFY BEFORE REAL USE *** - see trustly-establish-bank-auth's header
// comment for the general caveat. Specifically here: the exact path/shape of
// a transaction-status lookup (used here: GET {base}/transactions/{id}) and
// what field/value indicates a successfully authorized mandate (used here:
// status === "AUTHORIZED", tried case-insensitively) are not confirmed
// against Trustly's real reference docs.
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const accessId = Deno.env.get("TRUSTLY_ACCESS_ID");
  const accessKey = Deno.env.get("TRUSTLY_ACCESS_KEY");
  const apiBase = Deno.env.get("TRUSTLY_API_BASE_URL") ?? "https://sandbox.trustly.one/api/v1";
  if (!accessId || !accessKey) {
    return new Response(JSON.stringify({ error: "Trustly is not configured (missing TRUSTLY_ACCESS_ID/ACCESS_KEY)." }), {
      status: 503,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) {
    return new Response(JSON.stringify({ error: "Invalid or expired session" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: { transactionId?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!body.transactionId) {
    return new Response(JSON.stringify({ error: "transactionId is required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const res = await fetch(`${apiBase}/transactions/${encodeURIComponent(body.transactionId)}`, {
      headers: { authorization: `Basic ${btoa(`${accessId}:${accessKey}`)}` },
    });
    const data = await res.json();
    if (!res.ok) {
      return new Response(JSON.stringify({ error: `Trustly status check error: ${JSON.stringify(data)}` }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const status = String(data.status ?? "").toUpperCase();
    if (status !== "AUTHORIZED" && status !== "ACTIVE") {
      return new Response(JSON.stringify({ error: `Bank authorization not complete (status: ${status || "unknown"})` }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { error } = await admin.rpc("set_trustly_transaction_id", {
      p_user_id: user.id,
      p_transaction_id: body.transactionId,
    });
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ linked: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: `Trustly status check error: ${(err as Error).message}` }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
