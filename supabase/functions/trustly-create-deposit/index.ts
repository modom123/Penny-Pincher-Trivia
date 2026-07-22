// Buys a token bundle via Trustly, pulling funds from the player's already-
// authorized bank account (profiles.trustly_transaction_id, set by
// trustly-confirm-bank-auth). Mirrors create-checkout-session's bundle table
// exactly so both processors sell identical bundles.
//
// Terminology note: Trustly's API calls this direction "Capture" (pulling
// funds FROM the end user) - the opposite of what "Capture" usually means in
// card processing. Their "Deposit" endpoint is the other direction (funds TO
// the end user), used by the withdraw function instead. Easy to swap by
// mistake - see the header comment in trustly-establish-bank-auth for the
// same verification caveat that applies to every Trustly call in this file.
//
// The wallet is only credited once Trustly confirms the capture via
// trustly-webhook - never trust the response from this call alone (same rule
// create-checkout-session follows for Stripe).
import { createClient } from "jsr:@supabase/supabase-js@2";

const BUNDLES: Record<string, { price_cents: number; tokens: number; label: string }> = {
  starter: { price_cents: 100, tokens: 100, label: "$1.00 = 100 Tokens" },
  small: { price_cents: 500, tokens: 600, label: "$5.00 = 600 Tokens" },
  medium: { price_cents: 1000, tokens: 1400, label: "$10.00 = 1400 Tokens" },
  large: { price_cents: 2000, tokens: 3000, label: "$20.00 = 3000 Tokens" },
  huge: { price_cents: 5000, tokens: 7000, label: "$50.00 = 7000 Tokens" },
};

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

  let body: { bundleId?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const bundle = body.bundleId ? BUNDLES[body.bundleId] : undefined;
  if (!bundle) {
    return new Response(
      JSON.stringify({ error: `Unknown bundleId. Valid options: ${Object.keys(BUNDLES).join(", ")}` }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: profile } = await admin
    .from("profiles")
    .select("trustly_transaction_id")
    .eq("user_id", user.id)
    .single();
  if (!profile?.trustly_transaction_id) {
    return new Response(JSON.stringify({ error: "BANK_LINK_REQUIRED: Link a bank account before buying tokens." }), {
      status: 409,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;

  try {
    // VERIFY: path/fields per docs.trustly.com/api/deposit's description of
    // the Capture side of the deferred-payment flow - not confirmed against
    // a real sandbox response. bundleId/tokens/priceCents are carried through
    // so trustly-webhook can credit the right amounts without re-deriving them.
    const res = await fetch(`${apiBase}/transactions/${encodeURIComponent(profile.trustly_transaction_id)}/capture`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Basic ${btoa(`${accessId}:${accessKey}`)}`,
      },
      body: JSON.stringify({
        amount: (bundle.price_cents / 100).toFixed(2),
        currency: "USD",
        notificationUrl: `${supabaseUrl}/functions/v1/trustly-webhook`,
        metadata: { userId: user.id, bundleId: body.bundleId, tokens: bundle.tokens, priceCents: bundle.price_cents },
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      return new Response(JSON.stringify({ error: `Trustly capture error: ${JSON.stringify(data)}` }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Immediate response is typically "Pending" - the wallet credit happens
    // from trustly-webhook once Trustly confirms the capture actually cleared.
    return new Response(JSON.stringify({ status: "pending", captureId: data.id ?? data.captureId }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: `Trustly capture error: ${(err as Error).message}` }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
