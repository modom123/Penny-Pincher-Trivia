// Geo-check: the mobile app sends a device location ping (from Radar.io /
// GeoComply) when the player opens a game card. This verifies/records the
// player's state via set_verified_region, so buy_round's geo-fence has a fresh,
// server-recorded location to enforce against.
//
// The client-supplied coordinates are only trusted as much as the geo-vendor's
// SDK is - for real anti-spoofing you'd verify the vendor's signed location
// token here rather than trusting a raw lat/lng. The ENFORCEMENT (blocking the
// buy) still lives in Postgres regardless.
import { createClient } from "jsr:@supabase/supabase-js@2";

Deno.serve(async (req: Request) => {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
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
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: { state?: string; country?: string; radarToken?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // In production: resolve body.radarToken via the Radar.io/GeoComply API to get
  // a verified, anti-spoofed region rather than trusting body.state directly.
  const radarKey = Deno.env.get("RADAR_SECRET_KEY");
  let state = body.state;
  const country = body.country ?? "US";
  if (radarKey && body.radarToken) {
    // Placeholder for the real verification call:
    // const verified = await fetch("https://api.radar.io/v1/verify", ...);
    // state = verified.state; country = verified.country;
  }

  if (!state || !/^[A-Z]{2}$/.test(state)) {
    return new Response(JSON.stringify({ error: "A valid 2-letter state code is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  await admin.rpc("set_verified_region", { p_user_id: user.id, p_state: state, p_country: country });

  // Tell the client whether this region is currently allowed, so it can show the
  // "unavailable in your region" message and hide the Buy button proactively.
  const { data: config } = await admin.from("platform_config").select("value").eq("key", "blocked_states").single();
  const blocked = ((config?.value as string[]) ?? []).includes(state);

  return new Response(JSON.stringify({ state, country, regionBlocked: blocked }), {
    headers: { "Content-Type": "application/json" },
  });
});
