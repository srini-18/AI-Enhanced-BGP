'use client';

import React from 'react';
import { SimState } from '@/lib/bgp-sim/types';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RTooltip,
  Legend,
  BarChart,
  Bar,
  Cell,
} from 'recharts';
import { Activity, Gauge, Timer, Percent } from 'lucide-react';

const PREFIX_COLORS: Record<string, string> = {
  '192.0.2.0/24': '#34d399',
  '192.0.2.0/25': '#f87171',
  '198.51.100.0/24': '#38bdf8',
  '203.0.113.0/24': '#a78bfa',
  '208.65.153.0/24': '#fb923c',
  '8.8.8.0/24': '#facc15',
  '104.16.0.0/16': '#f472b6',
};

export function AnalyticsPanel({ state }: { state: SimState }) {
  const history = [...state.history].reverse(); // chronological

  // trust time series grouped by prefix
  const series = new Map<string, { t: number; trust: number; label: string }[]>();
  const seenPrefixes = new Set<string>();
  for (const p of state.trustHistory) {
    if (!series.has(p.prefix)) series.set(p.prefix, []);
    series.get(p.prefix)!.push({ t: p.t, trust: p.trust, label: p.prefix });
    seenPrefixes.add(p.prefix);
  }

  const allData: Record<number, Record<string, number | string>> = {};
  for (const [prefix, points] of series) {
    for (const pt of points) {
      if (!allData[pt.t]) allData[pt.t] = { t: pt.t };
      allData[pt.t][prefix] = pt.trust;
    }
  }
  const chartData = Object.values(allData).sort((a, b) => (a.t as number) - (b.t as number)).slice(-120);

  const mttdData = history.slice(-12).map((r) => ({
    name: `${r.scenarioId}#${r.runId}`,
    MTTD: r.mttd ?? 0,
    MTTM: r.mttm ?? 0,
    result: r.msr ? 'MSR ✓' : r.detectedAt !== null ? 'detected' : 'missed',
  }));

  const { metrics } = state;

  return (
    <div className="space-y-4">
      {/* metric cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { icon: Timer, label: 'Avg MTTD', value: metrics.avgMttd !== null ? `${metrics.avgMttd}s` : '—', tone: 'text-amber-300', sub: 'mean time-to-detect' },
          { icon: Activity, label: 'Avg MTTM', value: metrics.avgMttm !== null ? `${metrics.avgMttm}s` : '—', tone: 'text-orange-300', sub: 'mean time-to-mitigate' },
          { icon: Percent, label: 'MSR', value: `${metrics.msrPercent}%`, tone: 'text-emerald-300', sub: 'mitigation success rate' },
          { icon: Gauge, label: 'Detection', value: `${metrics.detectionRate}%`, tone: 'text-cyan-300', sub: `${metrics.totalRuns} runs recorded` },
        ].map((m) => (
          <div key={m.label} className="relative rounded-lg border border-slate-800 bg-slate-950/60 p-3 card-lift overflow-hidden">
            <div className={`absolute left-0 top-0 bottom-0 w-0.5 bg-gradient-to-b ${m.tone.replace('text-', 'from-')}-600/60 to-transparent`} />
            <div className="flex items-center gap-1.5 text-slate-500">
              <m.icon className="h-3.5 w-3.5" />
              <span className="text-[10px] font-mono uppercase tracking-wider">{m.label}</span>
            </div>
            <div className={`mt-1.5 font-mono text-xl font-bold tabular-nums ${m.tone}`}>{m.value}</div>
            <div className="text-[10px] font-mono text-slate-600 mt-0.5">{m.sub}</div>
          </div>
        ))}
      </div>

      {/* trust over time */}
      <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-slate-200">Behavioral Trust Score over Time</span>
          <span className="text-[10px] font-mono text-slate-600">per-prefix · last 120 samples</span>
        </div>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 4, right: 12, bottom: 0, left: -14 }}>
              <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
              <XAxis dataKey="t" tick={{ fill: '#64748b', fontSize: 10, fontFamily: 'monospace' }} stroke="#334155" minTickGap={48} tickFormatter={(v: number) => `${v}s`} />
              <YAxis domain={[0, 1]} tick={{ fill: '#64748b', fontSize: 10, fontFamily: 'monospace' }} stroke="#334155" />
              <RTooltip
                contentStyle={{ background: '#020617', border: '1px solid #334155', borderRadius: 8, fontSize: 11, fontFamily: 'monospace' }}
                labelFormatter={(v) => `t = ${v}s`}
              />
              <Legend wrapperStyle={{ fontSize: 10, fontFamily: 'monospace', color: '#94a3b8' }} />
              {Array.from(seenPrefixes).map((p) => (
                <Line
                  key={p}
                  type="monotone"
                  dataKey={p}
                  stroke={PREFIX_COLORS[p] ?? '#94a3b8'}
                  strokeWidth={1.6}
                  dot={false}
                  isAnimationActive={false}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
        {/* threshold lines legend */}
        <div className="flex gap-3 mt-1 text-[9.5px] font-mono text-slate-500">
          <span>tier thresholds: ≥{state.config.policy.thresholds.normal} normal · {state.config.policy.thresholds.suspicious} susp · {state.config.policy.thresholds.leak} leak</span>
        </div>
      </div>

      {/* MTTD/MTTM history */}
      <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-slate-200">Per-Run MTTD / MTTM (latest 12)</span>
          <span className="text-[10px] font-mono text-slate-600">sim seconds</span>
        </div>
        {mttdData.length === 0 ? (
          <div className="h-24 flex items-center justify-center text-[11px] font-mono text-slate-600">no completed runs yet — inject an attack scenario</div>
        ) : (
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={mttdData} margin={{ top: 4, right: 12, bottom: 0, left: -14 }}>
                <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
                <XAxis dataKey="name" tick={{ fill: '#64748b', fontSize: 9.5, fontFamily: 'monospace' }} stroke="#334155" interval={0} angle={-25} textAnchor="end" height={44} />
                <YAxis tick={{ fill: '#64748b', fontSize: 10, fontFamily: 'monospace' }} stroke="#334155" />
                <RTooltip
                  cursor={{ fill: '#1e293b55' }}
                  contentStyle={{ background: '#020617', border: '1px solid #334155', borderRadius: 8, fontSize: 11, fontFamily: 'monospace' }}
                />
                <Legend wrapperStyle={{ fontSize: 10, fontFamily: 'monospace', color: '#94a3b8' }} />
                <Bar dataKey="MTTD" fill="#fbbf24" radius={[3, 3, 0, 0]} isAnimationActive={false} />
                <Bar dataKey="MTTM" fill="#fb923c" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                  {mttdData.map((d, i) => (
                    <Cell key={i} fill={d.result === 'MSR ✓' ? '#fb923c' : d.result === 'missed' ? '#475569' : '#f59e0b'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}
