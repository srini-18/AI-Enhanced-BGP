'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ATTACK_SCENARIOS, RunResult, SimState } from '@/lib/bgp-sim/types';
import { Button } from '@/components/ui/button';
import {
  Zap,
  Play,
  Square,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RotateCcw,
  Eye,
  EyeOff,
  ShieldCheck,
  ShieldX,
  Dices,
  Activity,
} from 'lucide-react';

export type ChaosPhase = 'idle' | 'running' | 'done' | 'cancelled' | 'error';

export interface ChaosRound {
  index: number; // 1-based
  scenarioId: string;
  durationSec: number;
  run: RunResult | null;
  timedOut: boolean;
}

export interface ChaosExperiment {
  phase: ChaosPhase;
  rounds: ChaosRound[];
  current: number; // 1-based round currently executing (0 when idle)
  totalRounds: number;
  pool: ChaosPoolId;
  start: (totalRounds: number, pool: ChaosPoolId) => void;
  cancel: () => void;
}

export type ChaosPoolId = 'all' | 'hijack' | 'leak';

const POOLS: { id: ChaosPoolId; label: string; hint: string; ids: string[] }[] = [
  { id: 'all', label: 'mixed', hint: 'S1-S6 — full catalogue soak', ids: ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'] },
  { id: 'hijack', label: 'hijacks', hint: 'S1 · S2 · S4 — prefix hijack class', ids: ['S1', 'S2', 'S4'] },
  { id: 'leak', label: 'leaks', hint: 'S5 · S6 — route leak class', ids: ['S5', 'S6'] },
];

const ROUND_TIMEOUT_MS = 100_000;
const ROUND_GAP_MS = 1_800;
const STEP_MS = 700;

/**
 * Chaos drill state machine — page-level (above the Tabs boundary) so it
 * survives tab switches. Soak-tests the configured defense by firing a
 * randomized sequence of attack scenarios back-to-back, collecting the
 * outcome of every round. Uses YOUR live configuration — exactly the point:
 * measure how the system as currently tuned handles continuous adversarial
 * pressure. Re-arms automatically after engine resets (reviewer resets).
 */
export function useChaosDrill({
  state,
  onInject,
  onWithdraw,
  onStart,
}: {
  state: SimState | null;
  onInject: (scenarioId: string, durationSec?: number) => void;
  onWithdraw: () => void;
  onStart: () => void;
}): ChaosExperiment {
  const [phase, setPhase] = useState<ChaosPhase>('idle');
  const [rounds, setRounds] = useState<ChaosRound[]>([]);
  const [current, setCurrent] = useState(0);
  const [totalRounds, setTotalRounds] = useState(6);
  const [pool, setPool] = useState<ChaosPoolId>('all');

  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  const phaseRef = useRef<ChaosPhase>('idle');
  const currentRef = useRef(0);
  const totalRef = useRef(6);
  const poolRef = useRef<ChaosPoolId>('all');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const roundStartRef = useRef(0);
  const baselineKeysRef = useRef<Set<string>>(new Set());
  const historyLenRef = useRef(0);
  const lastScenarioRef = useRef('');
  const activeRoundSpecRef = useRef<{ scenarioId: string; durationSec: number } | null>(null);

  const runKey = (r: RunResult) => `${r.runId}:${r.injectedAt}`;

  const pickScenario = useCallback((ids: string[]): string => {
    const choices = ids.length > 1 ? ids.filter((id) => id !== lastScenarioRef.current) : ids;
    return choices[Math.floor(Math.random() * choices.length)];
  }, []);

  const beginRound = useCallback(
    (index: number) => {
      const poolDef = POOLS.find((p) => p.id === poolRef.current) ?? POOLS[0];
      const scenarioId = pickScenario(poolDef.ids);
      lastScenarioRef.current = scenarioId;
      // randomize duration 45-80s so each round exercises a different dwell
      const durationSec = 45 + Math.floor(Math.random() * 36);
      activeRoundSpecRef.current = { scenarioId, durationSec };
      baselineKeysRef.current = new Set((stateRef.current?.history ?? []).map(runKey));
      historyLenRef.current = stateRef.current?.history.length ?? 0;
      roundStartRef.current = Date.now();
      const s = stateRef.current;
      if (s && !s.running) onStart();
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        onInject(scenarioId, durationSec);
      }, 600);
      currentRef.current = index;
      setCurrent(index);
    },
    [onInject, onStart, pickScenario]
  );

  const finish = useCallback(
    (outcome: ChaosPhase) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      phaseRef.current = outcome;
      currentRef.current = 0;
      setPhase(outcome);
      setCurrent(0);
      activeRoundSpecRef.current = null;
    },
    []
  );

  const appendRound = useCallback((round: ChaosRound) => {
    setRounds((prev) => [...prev, round]);
  }, []);

  /** one state-machine step, invoked from the interval */
  const step = useCallback(() => {
    if (phaseRef.current !== 'running') return;
    const s = stateRef.current;
    if (!s) return;
    const spec = activeRoundSpecRef.current;
    if (!spec) return;
    const idx = currentRef.current;

    if (!s.running) onStart();

    // engine reset detection: history shrank → in-flight run lost → re-arm current round
    if (s.history.length < historyLenRef.current) {
      historyLenRef.current = s.history.length;
      beginRound(idx);
      return;
    }

    // has a NEW run for our scenario landed in history?
    const landed = s.history.find(
      (r) => r.scenarioId === spec.scenarioId && !baselineKeysRef.current.has(runKey(r))
    );
    if (landed) {
      appendRound({ index: idx, scenarioId: spec.scenarioId, durationSec: spec.durationSec, run: landed, timedOut: false });
      activeRoundSpecRef.current = null;
      if (idx >= totalRef.current) {
        finish('done');
      } else {
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => beginRound(idx + 1), ROUND_GAP_MS);
      }
      return;
    }

    // active run vanished without landing — re-inject after grace
    if (!s.activeRun && Date.now() - roundStartRef.current > 20_000 && s.history.length === historyLenRef.current) {
      beginRound(idx);
      return;
    }

    // round timeout watchdog → record timeout, move on
    if (Date.now() - roundStartRef.current > ROUND_TIMEOUT_MS) {
      onWithdraw();
      appendRound({ index: idx, scenarioId: spec.scenarioId, durationSec: spec.durationSec, run: null, timedOut: true });
      activeRoundSpecRef.current = null;
      if (idx >= totalRef.current) {
        finish('error');
      } else {
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => beginRound(idx + 1), ROUND_GAP_MS);
      }
    }
  }, [appendRound, beginRound, finish, onWithdraw, onStart]);

  // single driver interval — lives at page level, survives tab switches
  useEffect(() => {
    if (phase !== 'running') return;
    const id = setInterval(step, STEP_MS);
    return () => clearInterval(id);
  }, [phase, step]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    []
  );

  const start = useCallback(
    (total: number, poolId: ChaosPoolId) => {
      if (phaseRef.current === 'running') return;
      totalRef.current = Math.max(1, Math.min(24, total));
      poolRef.current = poolId;
      setTotalRounds(totalRef.current);
      setPool(poolId);
      setRounds([]);
      phaseRef.current = 'running';
      setPhase('running');
      beginRound(1);
    },
    [beginRound]
  );

  const cancel = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    onWithdraw();
    finish('cancelled');
  }, [onWithdraw, finish]);

  return { phase, rounds, current, totalRounds, pool, start, cancel };
}

/** outcome tone for a round chip */
function roundOutcome(r: ChaosRound) {
  if (r.timedOut) return { label: 'timeout', cls: 'border-yellow-800 text-yellow-300 bg-yellow-950/40', icon: AlertTriangle };
  if (!r.run) return { label: 'no data', cls: 'border-slate-700 text-slate-500', icon: XCircle };
  if (r.run.phase === 'rolledback') return { label: 'rolled back', cls: 'border-emerald-800 text-emerald-300 bg-emerald-950/40', icon: RotateCcw };
  if (r.run.phase === 'mitigated') return { label: 'mitigated', cls: 'border-emerald-800 text-emerald-300 bg-emerald-950/40', icon: CheckCircle2 };
  if (r.run.phase === 'failed') return { label: r.run.detectedAt === null ? 'undetected' : 'failed', cls: 'border-red-900 text-red-400 bg-red-950/40', icon: ShieldX };
  return { label: r.run.phase, cls: 'border-slate-700 text-slate-400', icon: XCircle };
}

/**
 * Chaos drill VIEW — pure presentation over the page-level state machine.
 * Local state holds only the uncommitted round-count / pool picks.
 */
export function ChaosDrill({
  state,
  experiment,
}: {
  state: SimState;
  experiment: ChaosExperiment;
}) {
  const { phase, rounds, current, totalRounds } = experiment;
  const [roundsSel, setRoundsSel] = useState(6);
  const [poolSel, setPoolSel] = useState<ChaosPoolId>('all');
  const running = phase === 'running';

  const completed = rounds.length;
  const detected = rounds.filter((r) => r.run?.detectedAt !== null && r.run?.detectedAt !== undefined).length;
  const mitigated = rounds.filter((r) => r.run?.msr).length;
  const mttds = rounds.filter((r) => r.run?.mttd != null).map((r) => r.run!.mttd as number);
  const mttms = rounds.filter((r) => r.run?.mttm != null).map((r) => r.run!.mttm as number);
  const avg = (xs: number[]) => (xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1) + 's' : '—');
  const detPct = completed ? Math.round((detected / completed) * 100) : 0;
  const msrPct = completed ? Math.round((mitigated / completed) * 100) : 0;

  const activeScenario = running && current > 0 ? state.activeRun?.scenarioId : null;
  const progressPct = running ? Math.min(100, Math.round(((completed + (current > 0 ? 0.5 : 0)) / totalRounds) * 100)) : phase === 'done' ? 100 : 0;

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
      {/* header */}
      <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Zap className={`h-4 w-4 text-amber-400 ${running ? 'animate-pulse' : ''}`} />
          <span className="text-xs font-semibold text-slate-200">Chaos Drill · Soak Test</span>
          <span className="text-[10px] font-mono text-slate-600 hidden sm:inline">
            randomized scenarios · your live config · round-by-round forensics
          </span>
        </div>
        {running ? (
          <Button
            size="sm"
            onClick={experiment.cancel}
            className="h-7 font-mono text-[10px] bg-red-900/70 hover:bg-red-800 text-red-100 border border-red-800"
          >
            <Square className="h-3 w-3 mr-1" /> STOP
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={() => experiment.start(roundsSel, poolSel)}
            title="fire a randomized soak-test sequence under your current configuration"
            className="h-7 font-mono text-[10px] bg-amber-600 hover:bg-amber-500 text-black"
          >
            <Play className="h-3 w-3 mr-1" /> FIRE DRILL
          </Button>
        )}
      </div>

      {/* setup row */}
      {!running && rounds.length === 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
          <div className="rounded border border-slate-800 bg-slate-900/40 p-2">
            <div className="text-[9px] font-mono uppercase tracking-wider text-slate-500 mb-1.5 flex items-center gap-1">
              <Dices className="h-2.5 w-2.5 text-amber-400" /> rounds
            </div>
            <div className="flex flex-wrap gap-1">
              {[4, 6, 10, 14].map((n) => (
                <button
                  key={n}
                  onClick={() => setRoundsSel(n)}
                  aria-pressed={roundsSel === n}
                  className={`px-2 py-0.5 rounded border text-[9.5px] font-mono tabular-nums transition-colors ${
                    roundsSel === n
                      ? 'border-amber-600 text-amber-200 bg-amber-950/50'
                      : 'border-slate-800 text-slate-500 hover:border-slate-600 hover:text-slate-300'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
            <div className="mt-1 text-[9px] font-mono text-slate-600">
              {roundsSel} rounds ≈ {Math.round(roundsSel * 0.6)}–{Math.round(roundsSel * 1.6)} min real time (sim clock runs ~5× real)
            </div>
          </div>
          <div className="rounded border border-slate-800 bg-slate-900/40 p-2">
            <div className="text-[9px] font-mono uppercase tracking-wider text-slate-500 mb-1.5 flex items-center gap-1">
              <Activity className="h-2.5 w-2.5 text-red-400" /> scenario pool
            </div>
            <div className="flex flex-wrap gap-1">
              {POOLS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setPoolSel(p.id)}
                  aria-pressed={poolSel === p.id}
                  title={p.hint}
                  className={`px-2 py-0.5 rounded border text-[9.5px] font-mono transition-colors ${
                    poolSel === p.id
                      ? 'border-red-700 text-red-300 bg-red-950/50'
                      : 'border-slate-800 text-slate-500 hover:border-slate-600 hover:text-slate-300'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="mt-1 text-[9px] font-mono text-slate-600 truncate">
              {POOLS.find((p) => p.id === poolSel)?.hint}
            </div>
          </div>
        </div>
      )}

      {/* progress + live status */}
      {(running || phase === 'done' || phase === 'cancelled' || phase === 'error') && (
        <div className="mb-2">
          <div className="h-1.5 rounded-full bg-slate-900 overflow-hidden border border-slate-800/60">
            <div
              className={`h-full transition-all duration-500 ${
                phase === 'done' ? 'bg-emerald-500' : phase === 'cancelled' || phase === 'error' ? 'bg-red-500' : 'bg-amber-500/80'
              }`}
              style={{ width: `${progressPct}%` }}
              role="progressbar"
              aria-valuenow={progressPct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="chaos drill progress"
            />
          </div>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap text-[10px] font-mono">
            {running && <Loader2 className="h-3 w-3 animate-spin text-amber-400" />}
            <span
              className={
                phase === 'done'
                  ? 'text-emerald-400'
                  : phase === 'cancelled' || phase === 'error'
                    ? 'text-red-400'
                    : 'text-amber-300'
              }
            >
              {phase === 'running'
                ? `round ${current}/${totalRounds} — ${activeScenario ? `${activeScenario} in flight` : 'arming next round'}`
                : phase === 'done'
                  ? `drill complete — ${completed} rounds`
                  : phase === 'cancelled'
                    ? `stopped at round ${current || completed} — ${completed} rounds recorded`
                    : `${completed} rounds recorded (timeouts hit)`}
            </span>
            {running && state.activeRun && state.activeRun.mttd !== null && (
              <span className="text-slate-500">· MTTD {state.activeRun.mttd}s</span>
            )}
            <span className="ml-auto text-slate-600 tabular-nums">{completed}/{totalRounds} landed</span>
          </div>
        </div>
      )}

      {/* round chips */}
      {rounds.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {rounds.map((r) => {
            const oc = roundOutcome(r);
            const OcIcon = oc.icon;
            return (
              <span
                key={r.index}
                title={`round ${r.index} · ${r.scenarioId} · ${r.durationSec}s injection · ${oc.label}${
                  r.run?.mttd != null ? ` · MTTD ${r.run.mttd}s` : ''
                }`}
                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[9px] font-mono ${oc.cls}`}
              >
                <OcIcon className="h-2.5 w-2.5" />
                <span className="text-slate-500">{r.index}</span> {r.scenarioId}
              </span>
            );
          })}
          {running && current > rounds.length && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-amber-700 bg-amber-950/40 text-[9px] font-mono text-amber-300">
              <Loader2 className="h-2.5 w-2.5 animate-spin" /> {current} …
            </span>
          )}
        </div>
      )}

      {/* summary */}
      {completed > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-1.5">
          {[
            { label: 'rounds', value: String(completed), tone: 'text-slate-200', icon: Zap },
            {
              label: 'detection',
              value: `${detPct}%`,
              tone: detPct >= 80 ? 'text-emerald-300' : detPct >= 40 ? 'text-amber-300' : 'text-red-400',
              icon: detected > 0 ? Eye : EyeOff,
            },
            {
              label: 'MSR',
              value: `${msrPct}%`,
              tone: msrPct >= 80 ? 'text-emerald-300' : msrPct >= 40 ? 'text-amber-300' : 'text-red-400',
              icon: mitigated > 0 ? ShieldCheck : ShieldX,
            },
            { label: 'avg MTTD', value: avg(mttds), tone: 'text-amber-300', icon: CheckCircle2 },
            { label: 'avg MTTM', value: avg(mttms), tone: 'text-orange-300', icon: CheckCircle2 },
            {
              label: 'worst MTTD',
              value: mttds.length ? `${Math.max(...mttds)}s` : '—',
              tone: 'text-red-400',
              icon: AlertTriangle,
            },
          ].map((k) => (
            <div key={k.label} className="rounded border border-slate-800 bg-slate-900/40 p-1.5">
              <div className="flex items-center gap-1 text-[8.5px] font-mono uppercase tracking-wider text-slate-500">
                <k.icon className="h-2.5 w-2.5" /> {k.label}
              </div>
              <div className={`mt-0.5 text-[11px] font-mono font-semibold tabular-nums ${k.tone}`}>{k.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* per-round detail table */}
      {rounds.length > 0 && (
        <div className="mt-2 max-h-40 overflow-y-auto scrollbar-thin rounded border border-slate-800/60">
          <table className="w-full text-[10px] font-mono">
            <thead className="sticky top-0 bg-slate-950/95 backdrop-blur">
              <tr className="text-slate-500 border-b border-slate-800">
                <th className="text-left py-1 px-2 font-medium">#</th>
                <th className="text-left py-1 px-2 font-medium">scenario</th>
                <th className="text-left py-1 px-2 font-medium">outcome</th>
                <th className="text-right py-1 px-2 font-medium">MTTD</th>
                <th className="text-right py-1 px-2 font-medium">MTTM</th>
                <th className="text-left py-1 px-2 font-medium">policy</th>
                <th className="text-right py-1 px-2 font-medium">run</th>
              </tr>
            </thead>
            <tbody>
              {rounds.map((r) => {
                const oc = roundOutcome(r);
                return (
                  <tr key={r.index} className="border-b border-slate-900 hover:bg-slate-900/40">
                    <td className="py-1 px-2 text-slate-500 tabular-nums">{r.index}</td>
                    <td className="py-1 px-2 text-slate-300">{r.scenarioId}</td>
                    <td className="py-1 px-2">
                      <span className={roundOutcome(r).cls.split(' ').find((c) => c.startsWith('text-')) ?? 'text-slate-400'}>
                        {oc.label}
                      </span>
                    </td>
                    <td className="py-1 px-2 text-right text-amber-300">{r.run?.mttd != null ? `${r.run.mttd}s` : '—'}</td>
                    <td className="py-1 px-2 text-right text-orange-300">{r.run?.mttm != null ? `${r.run.mttm}s` : '—'}</td>
                    <td className="py-1 px-2 text-slate-400 max-w-40 truncate">{r.run?.appliedPolicy || '—'}</td>
                    <td className="py-1 px-2 text-right text-slate-500 tabular-nums">{r.run ? `#${r.run.runId}` : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {phase === 'idle' && rounds.length === 0 && (
        <p className="text-[10.5px] font-mono text-slate-500 leading-relaxed">
          Continuous adversarial pressure test: fires a randomized scenario sequence (mixed hijacks/leaks/flapping) under your
          current configuration, records detection, mitigation and timing for every round, and summarizes resilience
          KPIs — the soak-test companion to the controlled A/B laboratory.
        </p>
      )}
    </div>
  );
}
