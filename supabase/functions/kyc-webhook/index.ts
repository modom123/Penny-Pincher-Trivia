// KYC webhook receiver. Shaped for Persona / Stripe Identity - both POST a
// verification result with the user's reference and (on success) verified DOB.
// verify_jwt is disabled (the vendor doesn't send a Supabase JWT); authenticity
// is instead a shared-secret header check. Never skip that check in production.
//
// The actual gate lives in Postgres (reserve_withdrawal checks kyc_status +
// age); this function just records the vendor's result via apply_kyc_result.
import { createClient } from "jsr:@supabase/supabase-js@2";

Deno.serve(async (req: Request) => {
  const webhookSecret = Deno.env.get("KYC_WEBHOOK_SECRET");
  if (!webhookSecret) {
    return new Response("KYC webhook not configured (missing KYC_WEBHOOK_SECRET)", { status: 503 });
  }

  // Shared-secret check. Persona/Stripe Identity both support a signing secret;
  // swap this for their HMAC signature verification when wiring the real vendor.
  const provided = req.headers.get("x-webhook-secret");
  if (provided !== webhookSecret) {
    return new Response("Invalid webhook signature", { status: 401 });
  }

  let body: {
    userId?: string;
    status?: "verified" | "rejected" | "pending";
    providerRef?: string;
    dateOfBirth?: string; // ISO yyyy-mm-dd
  };
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  const { userId, status, providerRef, dateOfBirth } = body;
  if (!userId || !status) {
    return new Response("userId and status are required", { status: 400 });
  }

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { error } = await admin.rpc("apply_kyc_result", {
    p_user_id: userId,
    p_status: status,
    p_provider_ref: providerRef ?? null,
    p_date_of_birth: dateOfBirth ?? null,
  });
  if (error) {
    console.error("apply_kyc_result failed:", error);
    return new Response("Internal error applying KYC result", { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), { headers: { "Content-Type": "application/json" } });
});
