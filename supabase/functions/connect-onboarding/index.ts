// Creates (or reuses) a Stripe Connect Express account for the calling player
// and returns a fresh Account Link so they can complete onboarding. Payouts
// aren't enabled the moment the account is created - stripe-webhook's
// account.updated handler flips profiles.stripe_connect_payouts_enabled once
// Stripe finishes verifying it, and reserve_withdrawal gates on that flag.
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
    .select("stripe_connect_account_id, client_number")
    .eq("user_id", user.id)
    .single();
  const clientNumber = profile?.client_number != null ? String(profile.client_number) : "";

  const stripe = new Stripe(stripeKey, { apiVersion: "2024-06-20" });

  try {
    let accountId = profile?.stripe_connect_account_id ?? undefined;
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: "express",
        email: user.email,
        capabilities: { transfers: { requested: true } },
        metadata: { userId: user.id, clientNumber },
      });
      accountId = account.id;
      await admin.from("profiles").update({ stripe_connect_account_id: accountId }).eq("user_id", user.id);
    }

    const appUrl = Deno.env.get("APP_PUBLIC_URL") ?? "https://example.com";
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${appUrl}/wallet/connect-refresh`,
      return_url: `${appUrl}/wallet/connect-return`,
      type: "account_onboarding",
    });

    return new Response(JSON.stringify({ url: accountLink.url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    // An uncaught throw here would return Deno's default error response,
    // which has no CORS headers - the browser would report a misleading
    // "failed to fetch"/network error instead of Stripe's actual message.
    return new Response(JSON.stringify({ error: `Stripe Connect error: ${(err as Error).message}` }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
