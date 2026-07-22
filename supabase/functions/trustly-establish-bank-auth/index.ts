// Starts Trustly's "Pay by Bank" deferred-payment flow: creates an
// unauthorized transaction and returns a hosted URL for the player to
// authorize their bank account (same "go complete this on a processor-hosted
// page, then come back" shape as create-checkout-session/connect-onboarding).
// Once the player authorizes with their bank, Trustly redirects them back to
// returnUrl with ?transactionId=... appended - see trustly-confirm-bank-auth,
// which verifies that id with Trustly server-side before trusting it (the
// same "never trust the client-side redirect alone" rule stripe-webhook
// follows for payments).
//
// *** VERIFY BEFORE REAL USE ***
// Built from cross-referenced public documentation (docs.trustly.com,
// amer.developers.trustly.com), not a live sandbox - those reference pages
// blocked automated fetches in this environment. Specifically unconfirmed:
//   - Exact endpoint path (used here: POST {base}/establish, per the
//     reference page slug "post-establish" and its description "creates a
//     new unauthorized transaction and returns a URL for the user to
//     authorize").
//   - Exact request/response field names below.
//   - Whether production's base URL is https://api.trustly.one/api/v1 (the
//     sandbox is confirmed as https://sandbox.trustly.one/api/v1 - dropping
//     "sandbox." is a guess, not a confirmed value).
// Confirm all of the above against Trustly's actual reference docs (or their
// integration team) before this ever touches a real transaction.
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
  const merchantId = Deno.env.get("TRUSTLY_MERCHANT_ID");
  // VERIFY: sandbox confirmed; production is a guess - see header comment.
  const apiBase = Deno.env.get("TRUSTLY_API_BASE_URL") ?? "https://sandbox.trustly.one/api/v1";
  if (!accessId || !accessKey || !merchantId) {
    return new Response(
      JSON.stringify({ error: "Trustly is not configured (missing TRUSTLY_ACCESS_ID/ACCESS_KEY/MERCHANT_ID)." }),
      { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
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

  const appUrl = Deno.env.get("APP_PUBLIC_URL") ?? "https://example.com";
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;

  try {
    const res = await fetch(`${apiBase}/establish`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // VERIFY: AMER docs describe Basic Auth with accessId:accessKey for
        // this API family - confirm this endpoint uses the same scheme.
        authorization: `Basic ${btoa(`${accessId}:${accessKey}`)}`,
      },
      body: JSON.stringify({
        merchantId,
        endUserId: user.id,
        // Notified async once the player finishes authorizing with their bank.
        notificationUrl: `${supabaseUrl}/functions/v1/trustly-webhook`,
        // Player lands back here with ?transactionId=... appended.
        returnUrl: `${appUrl}/wallet/trustly-return`,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      return new Response(JSON.stringify({ error: `Trustly establish error: ${JSON.stringify(data)}` }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // VERIFY: field names (`url`, `transactionId`) are the best-guess reading
    // of the public docs, not confirmed against a real response body.
    return new Response(JSON.stringify({ url: data.url, transactionId: data.transactionId }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: `Trustly establish error: ${(err as Error).message}` }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
