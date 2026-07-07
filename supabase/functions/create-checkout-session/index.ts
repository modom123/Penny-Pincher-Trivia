// Creates a Stripe Checkout Session for a token bundle purchase.
// The wallet is only credited once Stripe confirms payment via the
// stripe-webhook function - never trust the client-side redirect alone.
import { createClient } from "jsr:@supabase/supabase-js@2";
import Stripe from "npm:stripe@16";

// Token bundles. Larger bundles grant bonus tokens (you get more tokens than
// cents paid). NOTE: 1 token still equals 1 cent of in-game / prize-pool value,
// so the bonus tokens above the amount paid are a promotional subsidy - see the
// arbitrage/solvency note in docs/LAUNCH-CHECKLIST.md before enabling real
// payments (bonus tokens should very likely be play-only, not withdrawable).
const BUNDLES: Record<string, { price_cents: number; tokens: number; label: string }> = {
  starter: { price_cents: 100, tokens: 100, label: "$1.00 = 100 Tokens" },
  small: { price_cents: 500, tokens: 600, label: "$5.00 = 600 Tokens" },
  medium: { price_cents: 1000, tokens: 1300, label: "$10.00 = 1300 Tokens" },
  large: { price_cents: 2000, tokens: 2800, label: "$20.00 = 2800 Tokens" },
};

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

  let body: { bundleId?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  const bundle = body.bundleId ? BUNDLES[body.bundleId] : undefined;
  if (!bundle) {
    return new Response(
      JSON.stringify({ error: `Unknown bundleId. Valid options: ${Object.keys(BUNDLES).join(", ")}` }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: profile } = await admin
    .from("profiles")
    .select("stripe_customer_id")
    .eq("user_id", user.id)
    .single();

  const stripe = new Stripe(stripeKey, { apiVersion: "2024-06-20" });

  let customerId = profile?.stripe_customer_id ?? undefined;
  if (!customerId) {
    const customer = await stripe.customers.create({ email: user.email });
    customerId = customer.id;
    await admin.from("profiles").update({ stripe_customer_id: customerId }).eq("user_id", user.id);
  }

  const appUrl = Deno.env.get("APP_PUBLIC_URL") ?? "https://example.com";
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer: customerId,
    line_items: [
      {
        price_data: {
          currency: "usd",
          unit_amount: bundle.price_cents,
          product_data: { name: `Penny Pincher Tokens - ${bundle.label}` },
        },
        quantity: 1,
      },
    ],
    metadata: { userId: user.id, bundleId: body.bundleId!, tokens: String(bundle.tokens) },
    success_url: `${appUrl}/wallet/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl}/wallet/cancel`,
  });

  return new Response(JSON.stringify({ checkoutUrl: session.url, sessionId: session.id }), {
    headers: { "Content-Type": "application/json" },
  });
});
