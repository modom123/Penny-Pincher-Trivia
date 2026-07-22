import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { LAUNCH_TARGET_MS, LAUNCH_START_MS, LAUNCH_WINDOW_MS } from '../lib/launch';

const GOLD = '#ffc22e';
const PINK = '#ff3d74';
const CYAN = '#8ee7f3';
const GREEN = '#2be0a6';
const MUTED = '#9db6ea';

type TaskState = 'done' | 'wip' | 'todo';

export default function LaunchPage() {
  const [now, setNow] = useState(() => Date.now());
  const [engineOnline, setEngineOnline] = useState<boolean | null>(null);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Live engine status feeds the "Game engine on Render" checklist item.
  useEffect(() => {
    async function check() {
      const { data } = await supabase
        .from('engine_heartbeats')
        .select('last_heartbeat_at')
        .order('last_heartbeat_at', { ascending: false })
        .limit(1);
      const newest = data?.[0] ? new Date(data[0].last_heartbeat_at).getTime() : 0;
      setEngineOnline(newest > 0 && Date.now() - newest < 45_000);
    }
    check();
    const id = setInterval(check, 10_000);
    return () => clearInterval(id);
  }, []);

  const rem = Math.max(0, LAUNCH_TARGET_MS - now);
  const live = rem <= 0;
  const urgent = rem > 0 && rem < 24 * 3600 * 1000;
  const accent = urgent ? PINK : GOLD;
  const s = Math.floor(rem / 1000);
  const dd = Math.floor(s / 86400);
  const hh = Math.floor((s % 86400) / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pct = Math.min(100, Math.max(0, ((now - LAUNCH_START_MS) / LAUNCH_WINDOW_MS) * 100));

  const target = useMemo(() => new Date(LAUNCH_TARGET_MS), []);
  const targetUtc = target.toLocaleString('en-US', {
    timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  });

  const tasks: [string, TaskState][] = [
    ['Marketing site deployed', 'done'],
    ['Command Center deployed', 'done'],
    ['Player app live at /app', 'done'],
    ['Database migrations applied', 'done'],
    ['App rethemed to brand', 'done'],
    ['Game engine on Render', engineOnline ? 'done' : 'wip'],
    ['Domain — pennypinchingtrivia.com', 'todo'],
    ['Trustly production keys + verified integration', 'todo'],
    ['Geo (Radar) key', 'todo'],
    ['Real question bank', 'todo'],
    ['Legal review + entity', 'todo'],
  ];
  const done = tasks.filter((t) => t[1] === 'done').length;

  const pad = (n: number) => String(n).padStart(2, '0');
  const units: [number | string, string][] = [
    [pad(dd), 'Days'], [pad(hh), 'Hours'], [pad(mm), 'Minutes'], [pad(ss), 'Seconds'],
  ];

  return (
    <div>
      <h2 style={{ marginBottom: 4 }}>Go-Live Countdown</h2>
      <p style={{ color: MUTED, marginTop: 0, letterSpacing: '.04em' }}>
        Fixed target — <b style={{ color: accent }}>{targetUtc} UTC</b>
      </p>

      <div
        style={{
          borderRadius: 20, padding: '28px 24px', marginBottom: 20,
          background: 'radial-gradient(900px 400px at 60% -30%, #1b64e6 0%, transparent 60%), linear-gradient(160deg,#0c2f77,#061a49)',
          border: '1px solid rgba(255,255,255,.12)', boxShadow: '0 18px 50px rgba(0,0,0,.35)',
        }}
      >
        {live ? (
          <div style={{ textAlign: 'center', fontSize: 44, fontWeight: 800, color: GOLD }}>🚀 WE&apos;RE LIVE</div>
        ) : (
          <div style={{ display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
            {units.map(([val, label]) => (
              <div key={label} style={{ minWidth: 92, textAlign: 'center' }}>
                <div style={{
                  fontSize: 'clamp(2.6rem,7vw,4.6rem)', fontWeight: 800, lineHeight: 0.95, color: accent,
                  fontVariantNumeric: 'tabular-nums', textShadow: `0 0 22px ${accent}88`,
                }}>{val}</div>
                <div style={{ textTransform: 'uppercase', letterSpacing: '.2em', fontSize: 12, color: MUTED, marginTop: 6 }}>{label}</div>
              </div>
            ))}
          </div>
        )}

        <div style={{ maxWidth: 620, margin: '22px auto 0' }}>
          <div style={{ height: 10, borderRadius: 999, background: 'rgba(255,255,255,.1)', overflow: 'hidden', border: '1px solid rgba(255,255,255,.12)' }}>
            <div style={{ height: '100%', width: `${pct}%`, background: `linear-gradient(90deg,${GOLD},${PINK})`, transition: 'width 1s linear' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, color: MUTED, fontSize: 12 }}>
            <span>{pct.toFixed(1)}% of the 73-hour window elapsed</span>
            <span>{live ? 'Window complete' : `${(rem / 3600000).toFixed(1)} hours left`}</span>
          </div>
        </div>
      </div>

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <h3 style={{ margin: 0, letterSpacing: '.18em', textTransform: 'uppercase', fontSize: 13, color: CYAN }}>Launch Checklist</h3>
          <span style={{ color: MUTED, fontSize: 13 }}>{done} of {tasks.length} complete · {tasks.length - done} to go</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(230px,1fr))', gap: 10, marginTop: 14 }}>
          {tasks.map(([name, st]) => {
            const c = st === 'done' ? GREEN : st === 'wip' ? GOLD : 'transparent';
            return (
              <div key={name} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '11px 13px', borderRadius: 12,
                background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.12)',
                fontSize: 14, color: st === 'todo' ? MUTED : '#e8f0ff',
              }}>
                <span style={{
                  width: 11, height: 11, borderRadius: '50%', flex: 'none', background: c,
                  border: st === 'todo' ? `2px solid ${MUTED}` : 'none',
                  boxShadow: st !== 'todo' ? `0 0 10px ${c}99` : 'none',
                }} />
                <span>{name}{st === 'wip' ? ' — starting…' : ''}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
