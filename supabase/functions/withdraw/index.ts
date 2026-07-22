// Withdraws real money out of the app via whichever processor is active
// (platform_config.payment_processor - see reserve_withdrawal). Two-phase:
// reserve_withdrawal atomically debits the wallet first (so a user can never
// withdraw the same balance twice even under concurrent requests), then the
// processor is called; on failure the reservation is refunded.
//
// Trustly path: *** VERIFY BEFORE REAL USE *** - same caveat as every other
// Trustly call in this repo (see trustly-establish-bank-auth's header
// comment). Terminology reminder: Trustly's "Deposit" endpoint is THIS
// direction (funds TO the end user) - not to be confused with our own
// "deposit" (buying tokens), which is trustly-create-deposit's Capture call.
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

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: { cents?: number };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const cents = body.cents;
  if (!Number.isInteger(cents) || (cents as number) <= 0) {
    return new Response(JSON.stringify({ error: "cents must be a positive integer" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
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
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  if (reservation.processor === "trustly") {
    const accessId = Deno.env.get("TRUSTLY_ACCESS_ID");
    const accessKey = Deno.env.get("TRUSTLY_ACCESS_KEY");
    const apiBase = Deno.env.get("TRUSTLY_API_BASE_URL") ?? "https://sandbox.trustly.one/api/v1";
    if (!accessId || !accessKey) {
      await admin.rpc("refund_withdrawal", { p_ledger_id: reservation.ledgerId });
      return new Response(JSON.stringify({ error: "Trustly is not configured (missing TRUSTLY_ACCESS_ID/ACCESS_KEY)." }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    try {
      // VERIFY: path/fields per docs.trustly.com/api/withdraw's description
      // of the "Deposit" (funds-to-user) side - not confirmed against a real
      // sandbox response.
      const res = await fetch(
        `${apiBase}/transactions/${encodeURIComponent(reservation.trustlyTransactionId)}/deposit`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Basic ${btoa(`${accessId}:${accessKey}`)}`,
          },
          body: JSON.stringify({
            amount: (reservation.amountCents / 100).toFixed(2),
            currency: "USD",
            notificationUrl: `${Deno.env.get("SUPABASE_URL")}/functions/v1/trustly-webhook`,
            metadata: { ledgerId: reservation.ledgerId },
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(data));

      // Final confirmation comes from trustly-webhook's payoutconfirmation
      // handler, which calls settle_withdrawal with processor='trustly' -
      // this just records that the payout request was accepted.
      return new Response(JSON.stringify({ success: true, status: "pending", payoutId: data.id ?? data.payoutId }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (err) {
      await admin.rpc("refund_withdrawal", { p_ledger_id: reservation.ledgerId });
      return new Response(JSON.stringify({ error: `Trustly payout failed: ${(err as Error).message}` }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
  if (!stripeKey) {
    await admin.rpc("refund_withdrawal", { p_ledger_id: reservation.ledgerId });
    return new Response(JSON.stringify({ error: "Stripe is not configured (missing STRIPE_SECRET_KEY)." }), {
      status: 503,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const stripe = new Stripe(stripeKey, { apiVersion: "2024-06-20" });

  try {
    const transfer = await stripe.transfers.create({
      amount: reservation.amountCents,
      currency: "usd",
      destination: reservation.connectAccountId,
    });
    await admin.rpc("settle_withdrawal", { p_ledger_id: reservation.ledgerId, p_ref: transfer.id });
    return new Response(JSON.stringify({ success: true, transferId: transfer.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    await admin.rpc("refund_withdrawal", { p_ledger_id: reservation.ledgerId });
    return new Response(JSON.stringify({ error: `Stripe transfer failed: ${(err as Error).message}` }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
