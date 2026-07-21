// Starts a Stripe Identity hosted verification session (document + selfie
// match). The result comes back asynchronously via stripe-webhook's
// identity.verification_session.* handlers, which call apply_kyc_result -
// this function only ever returns the hosted URL to redirect the player to.
import { createClient } from "jsr:@supabase/supabase-js@2";
import Stripe from "npm:stripe@16";

Deno.serve(async (req: Request) => {
  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
  if (!stripeKey) {
    return new Response(JSON.stringify({ error: "Stripe is not configured (missing STRIPE_SECRET_KEY)." }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
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
      headers: { "Content-Type": "application/json" },
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

  const session = await stripe.identity.verificationSessions.create({
    type: "document",
    metadata: { userId: user.id, clientNumber },
    options: { document: { require_matching_selfie: true } },
    return_url: `${appUrl}/wallet/identity-return`,
  });

  return new Response(JSON.stringify({ url: session.url }), {
    headers: { "Content-Type": "application/json" },
  });
});
