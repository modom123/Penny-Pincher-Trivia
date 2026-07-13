import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

// Engine is considered online if the newest heartbeat is within this window.
// The worker beats every ~15s (WATCH_POLL_MS), so 45s tolerates ~3 misses.
const STALE_MS = 45_000;
const REFRESH_MS = 10_000;

type Beat = { instance_id: string; last_heartbeat_at: string; games_in_flight: number };

export default function EngineStatus() {
  const [beats, setBeats] = useState<Beat[] | null>(null);
  const [now, setNow] = useState(() => Date.now());

  async function load() {
    const { data } = await supabase
      .from('engine_heartbeats')
      .select('instance_id, last_heartbeat_at, games_in_flight')
      .order('last_heartbeat_at', { ascending: false });
    setBeats(data ?? []);
    setNow(Date.now());
  }

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  if (beats === null) return null; // first load

  const newest = beats[0] ? new Date(beats[0].last_heartbeat_at).getTime() : 0;
  const ageMs = newest ? now - newest : Infinity;
  const online = ageMs < STALE_MS;
  const liveInstances = beats.filter((b) => now - new Date(b.last_heartbeat_at).getTime() < STALE_MS);
  const gamesRunning = liveInstances.reduce((s, b) => s + (b.games_in_flight || 0), 0);

  const color = beats.length === 0 ? '#9ca3af' : online ? '#22c55e' : '#ef4444';
  const label =
    beats.length === 0 ? 'Game engine: never checked in' : online ? 'Game engine online' : 'Game engine OFFLINE';

  return (
    <div
      title={
        beats.length === 0
          ? 'No heartbeat recorded yet — deploy/start the game-engine worker.'
          : `Newest heartbeat ${fmtAge(ageMs)} ago`
      }
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 12px',
        borderRadius: 999,
        border: `1px solid ${color}55`,
        background: `${color}14`,
        fontSize: 13,
        fontWeight: 600,
      }}
    >
      <span
        style={{
          width: 9,
          height: 9,
          borderRadius: '50%',
          background: color,
          boxShadow: online ? `0 0 0 3px ${color}33` : 'none',
        }}
      />
      <span>{label}</span>
      {beats.length > 0 && (
        <span style={{ color: '#9ca3af', fontWeight: 500 }}>
          · {online ? `last seen ${fmtAge(ageMs)} ago` : `down ${fmtAge(ageMs)}`}
          {online && ` · ${gamesRunning} game${gamesRunning === 1 ? '' : 's'} running`}
          {liveInstances.length > 1 && ` · ${liveInstances.length} instances`}
        </span>
      )}
    </div>
  );
}

function fmtAge(ms: number): string {
  if (!isFinite(ms)) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.round(m / 60)}h`;
}
