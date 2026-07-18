// Stripe webhook receiver. verify_jwt is disabled for this function (Stripe
// does not send a Supabase JWT) - authenticity is instead established via
// Stripe's own signature verification below. Never skip that check.
import { createClient } from "jsr:@supabase/supabase-js@2";
import Stripe from "npm:stripe@16";

Deno.serve(async (req: Request) => {
  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!stripeKey || !webhookSecret) {
    return new Response("Stripe is not configured", { status: 503 });
  }

  const stripe = new Stripe(stripeKey, { apiVersion: "2024-06-20" });
  const signature = req.headers.get("stripe-signature");
  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(rawBody, signature!, webhookSecret);
  } catch (err) {
    return new Response(`Webhook signature verification failed: ${(err as Error).message}`, { status: 400 });
  }

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const userId = session.metadata?.userId;
    const tokens = parseInt(session.metadata?.tokens ?? "0", 10);
    // Cash actually paid (withdrawable); anything above it is a promo/bonus grant.
    // Fall back to amount_total from Stripe if the metadata is missing.
    const cashCents = parseInt(session.metadata?.priceCents ?? "", 10) || (session.amount_total ?? 0);
    const bonusCents = Math.max(tokens - cashCents, 0);

    if (userId && tokens > 0) {
      const { error } = await admin.rpc("credit_wallet_from_stripe", {
        p_user_id: userId,
        p_cash_cents: cashCents,
        p_bonus_cents: bonusCents,
        p_stripe_event_id: event.id,
      });
      if (error) {
        console.error("credit_wallet_from_stripe failed:", error);
        return new Response("Internal error processing webhook", { status: 500 });
      }
    }
  }

  // Connect Express onboarding: an account isn't payout-ready the moment it's
  // created - Stripe flips payouts_enabled (and can flip it back off, e.g. a
  // flagged account) as it verifies the account, and notifies via this event.
  if (event.type === "account.updated") {
    const account = event.data.object as Stripe.Account;
    const { error } = await admin.rpc("set_connect_payouts_enabled", {
      p_account_id: account.id,
      p_enabled: Boolean(account.payouts_enabled),
    });
    if (error) {
      console.error("set_connect_payouts_enabled failed:", error);
      return new Response("Internal error processing webhook", { status: 500 });
    }
  }

  // Stripe Identity: the verified event's payload omits verified_outputs for
  // privacy, so re-fetch the session with it expanded to get the confirmed DOB.
  if (event.type === "identity.verification_session.verified") {
    const sessionStub = event.data.object as Stripe.Identity.VerificationSession;
    const userId = sessionStub.metadata?.userId;
    if (userId) {
      const stripe = new Stripe(stripeKey, { apiVersion: "2024-06-20" });
      const session = await stripe.identity.verificationSessions.retrieve(sessionStub.id, {
        expand: ["verified_outputs"],
      });
      const dob = session.verified_outputs?.dob;
      const dateOfBirth = dob ? `${dob.year}-${String(dob.month).padStart(2, "0")}-${String(dob.day).padStart(2, "0")}` : null;

      const { error } = await admin.rpc("apply_kyc_result", {
        p_user_id: userId,
        p_status: "verified",
        p_provider_ref: session.id,
        p_date_of_birth: dateOfBirth,
      });
      if (error) {
        console.error("apply_kyc_result (verified) failed:", error);
        return new Response("Internal error processing webhook", { status: 500 });
      }
    }
  }

  // requires_input: Stripe couldn't verify the submitted document/selfie (bad
  // image, mismatch, etc). Mark it rejected so Command Center's KYC queue
  // surfaces it - the player can start a fresh verification to retry.
  if (event.type === "identity.verification_session.requires_input") {
    const session = event.data.object as Stripe.Identity.VerificationSession;
    const userId = session.metadata?.userId;
    if (userId) {
      const { error } = await admin.rpc("apply_kyc_result", {
        p_user_id: userId,
        p_status: "rejected",
        p_provider_ref: session.id,
        p_date_of_birth: null,
      });
      if (error) {
        console.error("apply_kyc_result (rejected) failed:", error);
        return new Response("Internal error processing webhook", { status: 500 });
      }
    }
  }

  return new Response(JSON.stringify({ received: true }), { headers: { "Content-Type": "application/json" } });
});
