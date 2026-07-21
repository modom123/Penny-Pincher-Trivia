// Starts a Stripe Identity hosted verification session (document + selfie
// match). The result comes back asynchronously via stripe-webhook's
// identity.verification_session.* handlers, which call apply_kyc_result -
// this function only ever returns the hosted URL to redirect the player to.
import { createClient } from "jsr:@supabase/supabase-js@2";
import Stripe from "npm:stripe@16";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
  if (!stripeKey) {
    return new Response(JSON.stringify({ error: "Stripe is not configured (missing STRIPE_SECRET_KEY)." }), {
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

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: profile } = await admin
    .from("profiles")
    .select("client_number")
    .eq("user_id", user.id)
    .single();
  const clientNumber = profile?.client_number != null ? String(profile.client_number) : "";

  const stripe = new Stripe(stripeKey, { apiVersion: "2024-06-20" });
  const appUrl = Deno.env.get("APP_PUBLIC_URL") ?? "https://example.com";

  try {
    const session = await stripe.identity.verificationSessions.create({
      type: "document",
      metadata: { userId: user.id, clientNumber },
      options: { document: { require_matching_selfie: true } },
      return_url: `${appUrl}/wallet/identity-return`,
    });

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    // An uncaught throw here would return Deno's default error response,
    // which has no CORS headers - the browser would report a misleading
    // "failed to fetch"/network error instead of Stripe's actual message.
    return new Response(JSON.stringify({ error: `Stripe Identity error: ${(err as Error).message}` }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
