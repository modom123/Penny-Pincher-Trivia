// Geo-check: records the player's verified state so buy_round's geo-fence has a
// fresh, server-recorded location to enforce against.
//
// Anti-spoof verification (Radar Verify):
//   Client calls Radar.trackVerified() (react-native-radar / radar-sdk-js fraud
//   plugin), which returns a tamper-proof signed JWT ("token") plus `passed`
//   (fraud + country + state jurisdiction checks) and `expiresAt`. The client
//   sends that token here as `radarToken`. We validate the JWT signature with the
//   Fraud "JWT Secret Key" (RADAR_JWT_SECRET, HS256) and read the *verified* state
//   from the token - we never trust a raw client-supplied state in production.
//
// Rollout posture:
//   - RADAR_JWT_SECRET unset (soft launch): fall back to the self-declared
//     `body.state` (a controlled-tester stopgap).
//   - RADAR_JWT_SECRET set (public launch): a valid, passing, unexpired Radar
//     token is REQUIRED - requests without one are rejected. buy_round remains the
//     hard block regardless.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { jwtVerify } from "npm:jose@5";

type RadarResult =
  | { ok: true; state: string; country: string; verified: boolean }
  | { ok: false; reason: string };

async function verifyRadarToken(token: string, secret: string): Promise<RadarResult> {
  let payload: Record<string, unknown>;
  try {
    const res = await jwtVerify(token, new TextEncoder().encode(secret), { algorithms: ["HS256"] });
    payload = res.payload as Record<string, unknown>;
  } catch (err) {
    return { ok: false, reason: `invalid_token: ${(err as Error).message}` };
  }

  // `passed` = user.fraud.passed && user.country.passed && user.state.passed.
  if (payload.passed !== true) {
    return { ok: false, reason: "fraud_or_jurisdiction_check_failed" };
  }

  // Radar's token expires in ~20 min (sooner near a border). jose validates a
  // standard `exp` claim automatically; also honour Radar's `expiresAt` field.
  const expiresAt = payload.expiresAt ? new Date(payload.expiresAt as string).getTime() : null;
  if (expiresAt && expiresAt < Date.now()) {
    return { ok: false, reason: "token_expired" };
  }

  const user = (payload.user ?? {}) as Record<string, any>;
  const rawState = user.state?.code ?? user.state?.stateCode ?? payload.stateCode ?? payload.state;
  const rawCountry = user.country?.code ?? user.country?.countryCode ?? payload.countryCode ?? payload.country ?? "US";
  const state = typeof rawState === "string" ? rawState.toUpperCase() : "";
  const country = typeof rawCountry === "string" ? rawCountry.toUpperCase() : "US";
  if (!/^[A-Z]{2}$/.test(state)) {
    return { ok: false, reason: "no_verified_state_in_token" };
  }
  return { ok: true, state, country, verified: true };
}

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

  const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
    error: userError,
  } = await userClient.auth.getUser();
  if (userError || !user) {
    return new Response(JSON.stringify({ error: "Invalid or expired session" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: { state?: string; country?: string; radarToken?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const radarSecret = Deno.env.get("RADAR_JWT_SECRET");
  const radarEnforced = Boolean(radarSecret);

  let state = body.state;
  let country = body.country ?? "US";
  let verified = false;

  if (radarSecret && body.radarToken) {
    const result = await verifyRadarToken(body.radarToken, radarSecret);
    if (!result.ok) {
      return new Response(JSON.stringify({ error: "LOCATION_VERIFICATION_FAILED", reason: result.reason, regionBlocked: true }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    state = result.state;
    country = result.country;
    verified = true;
  }

  // Public-launch posture: with Radar configured, a verified token is mandatory.
  if (radarEnforced && !verified) {
    return new Response(
      JSON.stringify({ error: "LOCATION_VERIFICATION_REQUIRED", regionBlocked: true, verificationRequired: true }),
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  if (!state || !/^[A-Z]{2}$/.test(state)) {
    return new Response(JSON.stringify({ error: "A valid 2-letter state code is required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  await admin.rpc("set_verified_region", { p_user_id: user.id, p_state: state, p_country: country });

  // Tell the client whether this region is currently allowed (matches buy_round:
  // whitelist-primary with blocked_states as a denylist override).
  const { data: rows } = await admin
    .from("platform_config")
    .select("key,value")
    .in("key", ["allowed_states", "blocked_states"]);
  const allowed = (rows?.find((r) => r.key === "allowed_states")?.value as string[]) ?? [];
  const blockedList = (rows?.find((r) => r.key === "blocked_states")?.value as string[]) ?? [];
  const regionBlocked = (allowed.length > 0 && !allowed.includes(state)) || blockedList.includes(state);

  return new Response(
    JSON.stringify({ state, country, regionBlocked, verified, verificationRequired: radarEnforced, allowedStates: allowed }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
