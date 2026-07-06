// Withdraws real money out of the app via Stripe Connect. Two-phase:
// reserve_withdrawal atomically debits the wallet first (so a user can never
// withdraw the same balance twice even under concurrent requests), then
// Stripe is called; on failure the reservation is refunded.
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

  let body: { cents?: number };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  const cents = body.cents;
  if (!Number.isInteger(cents) || (cents as number) <= 0) {
    return new Response(JSON.stringify({ error: "cents must be a positive integer" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Acts as the calling user (RLS/auth.uid() scoped) for the reservation step.
  const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: reservation, error: reserveError } = await userClient.rpc("reserve_withdrawal", {
    p_amount_cents: cents,
  });
  if (reserveError) {
    return new Response(JSON.stringify({ error: reserveError.message }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const stripe = new Stripe(stripeKey, { apiVersion: "2024-06-20" });

  try {
    const transfer = await stripe.transfers.create({
      amount: reservation.amountCents,
      currency: "usd",
      destination: reservation.connectAccountId,
    });
    await admin.rpc("settle_withdrawal", { p_ledger_id: reservation.ledgerId, p_stripe_transfer_id: transfer.id });
    return new Response(JSON.stringify({ success: true, transferId: transfer.id }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    await admin.rpc("refund_withdrawal", { p_ledger_id: reservation.ledgerId });
    return new Response(JSON.stringify({ error: `Stripe transfer failed: ${(err as Error).message}` }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
});
