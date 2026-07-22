// Called by the mobile client's return leg after the player finishes
// authorizing their bank with Trustly (see trustly-establish-bank-auth's
// returnUrl, which gets ?transactionId=... appended). Deliberately does NOT
// trust that query param at face value - it re-checks the transaction's
// status directly with Trustly before storing it (never trust a
// client-supplied redirect param alone - the wallet/KYC state should only
// ever change from a value this function itself fetched from Trustly).
//
// Also completes KYC in the same step: since trustly-establish-bank-auth
// requested kycType: 1, an authorized transaction has bank-verified identity
// data available via a GET call - fetched here and applied through
// apply_kyc_result (the same provider-agnostic function any KYC vendor uses),
// gated on Trustly's `eligible` flag (their OFAC/SDN/PEP screening result).
//
// *** VERIFY BEFORE REAL USE *** - see trustly-establish-bank-auth's header
// comment for the general caveat. Specifically here: the exact path/shape of
// a transaction-status lookup (used here: GET {base}/transactions/{id}), what
// field/value indicates a successfully authorized mandate (used here:
// status === "AUTHORIZED", tried case-insensitively), and the Trustly ID user-data
// endpoint/response shape (used here: GET {base}/transactions/{id}/user,
// expecting firstName/lastName or name, dateOfBirth, eligible) are not
// confirmed against Trustly's real reference docs.
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

    // Trustly ID: this authorization was requested with kycType: 1, so
    // bank-verified identity data should be available now. Best-effort - a
    // failure here shouldn't undo the bank link that already succeeded above;
    // the player just stays kyc_status='unverified' and can be retried.
    let kycApplied = false;
    try {
      const idRes = await fetch(`${apiBase}/transactions/${encodeURIComponent(body.transactionId)}/user`, {
        headers: { authorization: `Basic ${btoa(`${accessId}:${accessKey}`)}` },
      });
      if (idRes.ok) {
        const idData = await idRes.json();
        const eligible = idData.eligible !== false; // treat missing field as pass-through, explicit false as a hit
        const dob = idData.dateOfBirth ?? idData.date_of_birth ?? null;
        const { error: kycError } = await admin.rpc("apply_kyc_result", {
          p_user_id: user.id,
          p_status: eligible ? "verified" : "rejected",
          p_provider_ref: body.transactionId,
          p_date_of_birth: dob,
        });
        kycApplied = !kycError;
        if (kycError) console.error("apply_kyc_result (trustly id) failed:", kycError);
      } else {
        console.error("Trustly ID user-data fetch failed:", await idRes.text());
      }
    } catch (idErr) {
      console.error("Trustly ID user-data fetch error:", (idErr as Error).message);
    }

    return new Response(JSON.stringify({ linked: true, kycApplied }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: `Trustly status check error: ${(err as Error).message}` }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
