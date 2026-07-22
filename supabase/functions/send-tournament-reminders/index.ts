// Sends "your tournament starts soon" push notifications at two thresholds:
// 4 hours and 30 minutes before scheduled_start_at. Runs on a schedule (see
// migration 20260721140000_schedule_tournament_reminders.sql) every 5
// minutes; each threshold is tracked per-game (games.reminder_4h_sent_at /
// reminder_30m_sent_at) so a game is only ever notified once per threshold
// even though the cron sweeps far more often than the windows are wide.
//
// Also sweeps for "your game's pool rolled over" notifications (see
// 20260722060000_prize_pool_rollover.sql) on the same 5-minute cadence -
// cheap to piggyback on rather than standing up a second schedule.
import { createClient } from "jsr:@supabase/supabase-js@2";

const MODE_LABELS: Record<string, string> = {
  original_escalator: "Flat-Rate Escalator",
  streak_saver: "Streak Saver",
  milestone_booster: "Milestone Booster",
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type ExpoMessage = {
  to: string;
  title: string;
  body: string;
  sound: "default";
  data: Record<string, unknown>;
};

async function sendExpoPushBatch(messages: ExpoMessage[]): Promise<{ sent: number; errors: string[] }> {
  const errors: string[] = [];
  let sent = 0;
  // Expo's push API accepts up to 100 messages per request.
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    try {
      const res = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(chunk),
      });
      if (!res.ok) {
        errors.push(`Expo push API ${res.status}: ${(await res.text()).slice(0, 300)}`);
        continue;
      }
      const json = await res.json();
      const tickets = Array.isArray(json.data) ? json.data : [];
      for (const t of tickets) {
        if (t.status === "ok") sent++;
        else errors.push(`${t.message ?? "unknown push error"}`);
      }
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  return { sent, errors };
}

async function processWindow(
  admin: ReturnType<typeof createClient>,
  windowMinutes: 240 | 30,
  label: string
): Promise<{ gamesNotified: number; pushesSent: number; errors: string[] }> {
  const { data: games, error } = await admin.rpc("games_due_for_start_reminder", { p_window_minutes: windowMinutes });
  if (error) return { gamesNotified: 0, pushesSent: 0, errors: [error.message] };

  let gamesNotified = 0;
  let pushesSent = 0;
  const errors: string[] = [];

  for (const game of (games ?? []) as { game_id: string; mode: string; scheduled_start_at: string }[]) {
    const { data: tokenRows, error: tokErr } = await admin.rpc("list_push_tokens_for_game", { p_game_id: game.game_id });
    if (tokErr) {
      errors.push(`${game.game_id}: ${tokErr.message}`);
      continue;
    }
    const modeLabel = MODE_LABELS[game.mode] ?? game.mode;
    const messages: ExpoMessage[] = ((tokenRows ?? []) as { user_id: string; expo_push_token: string }[]).map((r) => ({
      to: r.expo_push_token,
      title: label === "4h" ? `⏰ Starting in 4 hours` : `🚨 Starting in 30 minutes!`,
      body:
        label === "4h"
          ? `Your ${modeLabel} tournament kicks off in 4 hours. Make sure you're topped up and ready.`
          : `Your ${modeLabel} tournament starts in 30 minutes - jump in!`,
      sound: "default",
      data: { gameId: game.game_id, kind: "tournament_start_reminder", window: label },
    }));

    if (messages.length > 0) {
      const result = await sendExpoPushBatch(messages);
      pushesSent += result.sent;
      errors.push(...result.errors);
    }

    // Mark the threshold sent even if there were zero registered devices with
    // a push token yet - the window has passed for this game either way, and
    // the cron will hit it again every 5 minutes otherwise.
    await admin.rpc("mark_start_reminder_sent", { p_game_id: game.game_id, p_window_minutes: windowMinutes });
    gamesNotified++;
  }

  return { gamesNotified, pushesSent, errors };
}

// Notifies a void (no-winner) game's players that its pool rolled over into a
// new tournament. Event-triggered (payout_game sets rolled_over_to_game_id the
// moment it happens), not time-windowed like the reminders above, but reuses
// the same idempotent *_notified_at + due-list-RPC + mark-sent-RPC shape so it
// rides the same 5-minute cron instead of needing its own schedule.
async function processRollovers(
  admin: ReturnType<typeof createClient>
): Promise<{ gamesNotified: number; pushesSent: number; errors: string[] }> {
  const { data: games, error } = await admin.rpc("games_due_for_rollover_notification");
  if (error) return { gamesNotified: 0, pushesSent: 0, errors: [error.message] };

  let gamesNotified = 0;
  let pushesSent = 0;
  const errors: string[] = [];

  for (const game of (games ?? []) as {
    void_game_id: string;
    mode: string;
    pool_rollover_amount_cents: number;
    rolled_over_to_game_id: string;
  }[]) {
    const { data: tokenRows, error: tokErr } = await admin.rpc("list_push_tokens_for_game", {
      p_game_id: game.void_game_id,
    });
    if (tokErr) {
      errors.push(`${game.void_game_id}: ${tokErr.message}`);
      continue;
    }
    const modeLabel = MODE_LABELS[game.mode] ?? game.mode;
    const amount = (game.pool_rollover_amount_cents / 100).toFixed(2);
    const messages: ExpoMessage[] = ((tokenRows ?? []) as { user_id: string; expo_push_token: string }[]).map((r) => ({
      to: r.expo_push_token,
      title: `🔄 Pool rolled over!`,
      body: `That ${modeLabel} tournament didn't have an eligible winner, so the $${amount} pool carried into a new one - come sign up.`,
      sound: "default",
      data: { voidGameId: game.void_game_id, rolledOverToGameId: game.rolled_over_to_game_id, kind: "pool_rollover" },
    }));

    if (messages.length > 0) {
      const result = await sendExpoPushBatch(messages);
      pushesSent += result.sent;
      errors.push(...result.errors);
    }

    await admin.rpc("mark_rollover_notified", { p_game_id: game.void_game_id });
    gamesNotified++;
  }

  return { gamesNotified, pushesSent, errors };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const cronSecret = Deno.env.get("NOTIFICATIONS_CRON_SECRET");
  const providedSecret = req.headers.get("x-cron-secret");
  const isCron = !!cronSecret && providedSecret === cronSecret;

  if (!isCron) {
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
    const { data: isStaff, error: staffError } = await userClient.rpc("is_staff", {
      required_roles: ["admin", "support"],
    });
    if (staffError || !isStaff) {
      return new Response(JSON.stringify({ error: "Forbidden: staff access required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const fourHour = await processWindow(admin, 240, "4h");
    const thirtyMin = await processWindow(admin, 30, "30m");
    const rollovers = await processRollovers(admin);

    return new Response(
      JSON.stringify({
        fourHourReminders: fourHour,
        thirtyMinReminders: thirtyMin,
        poolRollovers: rollovers,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: `Reminder sweep failed: ${(err as Error).message}` }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
