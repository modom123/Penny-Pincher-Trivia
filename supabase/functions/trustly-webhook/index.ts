// Trustly notification receiver. Deployed with verify_jwt disabled (Trustly
// does not send a Supabase JWT), same as stripe-webhook.
//
// *** VERIFY BEFORE REAL USE ***
// stripe-webhook establishes authenticity via Stripe's own cryptographic
// signature verification (stripe.webhooks.constructEventAsync) - that is the
// standard this function should be held to, but Trustly's AMER REST API's
// exact notification-signing scheme could not be confirmed (their reference
// docs blocked automated fetches in this environment; the legacy EMEA
// JSON-RPC API signs with RSA-SHA1, but this REST API may use something
// else entirely - a header-based signature, mTLS, or IP allowlisting).
// verifyNotification() below is a STOPGAP (shared-secret header, matching
// this repo's cron-secret pattern) - replace it with Trustly's actual
// verification method before this handles a single real dollar. Until then,
// treat every notification here as unauthenticated.
import { createClient } from "jsr:@supabase/supabase-js@2";

function verifyNotification(req: Request): boolean {
  const expected = Deno.env.get("TRUSTLY_WEBHOOK_SECRET");
  if (!expected) return false;
  // VERIFY: placeholder header name/scheme - swap for Trustly's real
  // notification-authenticity mechanism once confirmed.
  return req.headers.get("x-trustly-secret") === expected;
}

Deno.serve(async (req: Request) => {
  if (!verifyNotification(req)) {
    return new Response("Notification verification failed", { status: 400 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  // VERIFY: event-type field/values below (event, method, notificationId,
  // metadata shape) are the best-guess reading of cross-referenced public
  // docs, not confirmed against a real notification payload.
  const notificationId = String(payload.notificationId ?? payload.id ?? crypto.randomUUID());
  const eventType = String(payload.event ?? payload.method ?? "").toLowerCase();
  const metadata = (payload.metadata ?? {}) as Record<string, unknown>;

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Capture confirmed: the player's bank pull for a token bundle cleared.
  if (eventType.includes("capture")) {
    const userId = metadata.userId as string | undefined;
    const tokens = parseInt(String(metadata.tokens ?? "0"), 10);
    const cashCents = parseInt(String(metadata.priceCents ?? "0"), 10);
    const bonusCents = Math.max(tokens - cashCents, 0);

    if (userId && tokens > 0) {
      const { error } = await admin.rpc("credit_wallet_from_trustly", {
        p_user_id: userId,
        p_cash_cents: cashCents,
        p_bonus_cents: bonusCents,
        p_notification_id: notificationId,
      });
      if (error) {
        console.error("credit_wallet_from_trustly failed:", error);
        return new Response("Internal error processing webhook", { status: 500 });
      }
    }
  }

  // A previously-credited capture bounced (e.g. ACH insufficient-funds
  // return) - see 20260722080000_trustly_deposit_reversal.sql.
  if (eventType.includes("debit") || eventType.includes("reversal")) {
    const userId = metadata.userId as string | undefined;
    const cashCents = parseInt(String(metadata.priceCents ?? payload.amount ?? "0"), 10);
    if (userId && cashCents > 0) {
      const { error } = await admin.rpc("reverse_trustly_credit", {
        p_user_id: userId,
        p_cents: cashCents,
        p_notification_id: notificationId,
      });
      if (error) {
        console.error("reverse_trustly_credit failed:", error);
        return new Response("Internal error processing webhook", { status: 500 });
      }
    }
  }

  // Named "payoutconfirmation" per Trustly's docs: bank confirmation that a
  // withdrawal (our Deposit-direction call - see withdraw/index.ts) landed.
  if (eventType.includes("payoutconfirmation") || eventType.includes("payout")) {
    const ledgerId = metadata.ledgerId as string | undefined;
    if (ledgerId) {
      const { error } = await admin.rpc("settle_withdrawal", {
        p_ledger_id: ledgerId,
        p_ref: notificationId,
        p_processor: "trustly",
      });
      if (error) {
        console.error("settle_withdrawal (trustly) failed:", error);
        return new Response("Internal error processing webhook", { status: 500 });
      }
    }
  }

  // Bank-authorization confirmed asynchronously (belt-and-suspenders - the
  // primary path is trustly-confirm-bank-auth on the client's return leg).
  if (eventType.includes("establish") || eventType.includes("account")) {
    const userId = metadata.userId as string | undefined;
    const transactionId = payload.transactionId as string | undefined;
    if (userId && transactionId) {
      const { error } = await admin.rpc("set_trustly_transaction_id", {
        p_user_id: userId,
        p_transaction_id: transactionId,
      });
      if (error) {
        console.error("set_trustly_transaction_id failed:", error);
        return new Response("Internal error processing webhook", { status: 500 });
      }
    }
  }

  return new Response(JSON.stringify({ received: true }), { headers: { "Content-Type": "application/json" } });
});
