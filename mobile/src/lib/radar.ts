// Radar Verify client hook.
//
// On device builds we obtain an anti-spoofed, signed location token from Radar's
// SDK and hand it to the geo-check edge function, which validates the JWT
// server-side and reads the *verified* state (never a raw client-declared one).
//
// The native SDK (`react-native-radar`) is an optional dependency: it requires a
// native build + your Radar publishable key, so it's loaded lazily and this
// helper returns null when it isn't installed (e.g. the web soft-launch, where
// the RegionGate self-declared flow is used instead). Wiring for production:
//   1) npm i react-native-radar && configure iOS/Android per Radar docs
//   2) Radar.initialize(RADAR_PUBLISHABLE_KEY) at app start
//   3) set RADAR_JWT_SECRET on the geo-check function (flips it to verify-required)

let warned = false;

export async function getVerifiedLocationToken(): Promise<string | null> {
  try {
    // Computed specifier so the bundler/typechecker treats the optional native
    // module as absent-until-installed rather than a hard dependency.
    const moduleName = 'react-native-radar';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod: any = await import(moduleName).catch(() => null);
    const Radar = mod?.default ?? mod;
    if (!Radar?.trackVerified) return null;
    const result = await Radar.trackVerified();
    // result: { token, passed, expiresAt, user, ... }
    return result?.passed ? (result.token ?? null) : null;
  } catch {
    if (!warned) {
      warned = true;
      console.warn('[radar] verified location unavailable; using declared region (soft launch only)');
    }
    return null;
  }
}
