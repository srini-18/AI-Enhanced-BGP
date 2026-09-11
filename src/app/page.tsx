'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useBgpSim } from '@/lib/bgp-sim/client';
import { SimConfig, RunResult, SimEvent, SimState, ATTACK_SCENARIOS, RouteSnapshot } from '@/lib/bgp-sim/types';
import { playAlert, alertForEvent, primeAudioUnlock, isMuted, setMuted } from '@/lib/bgp-sim/sound';
import { TopologyGraph } from '@/components/bgp/topology-graph';
import { PrefixDrilldown } from '@/components/bgp/prefix-drilldown';
import { ControlCenter } from '@/components/bgp/control-center';
import { AttackPanel } from '@/components/bgp/attack-panel';
import { RouteTable } from '@/components/bgp/route-table';
import { EventLog } from '@/components/bgp/event-log';
import { AnalyticsPanel } from '@/components/bgp/analytics';
import { BenchmarkPanel } from '@/components/bgp/benchmark';
import { AiAssistantPanel } from '@/components/bgp/ai-assistant';
import { RibLogViewer } from '@/components/bgp/rib-log';
import { RouteMapPreview } from '@/components/bgp/route-map-preview';
import { ScenarioDeepDive } from '@/components/bgp/scenario-deepdive';
import { TimeTravelScrubber } from '@/components/bgp/time-travel';
import { ConfigDiff } from '@/components/bgp/config-diff';
import { useAblationExperiment } from '@/components/bgp/ablation-lab';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Toaster } from '@/components/ui/toaster';
import { useToast } from '@/hooks/use-toast';
import {
  Play, Pause, RotateCcw, Radio, CircleDot, Layers, SlidersHorizontal, BarChart3,
  Trophy, BookOpen, Sparkles, Keyboard, Volume2, VolumeX,
} from 'lucide-react';

/**
 * NOC threat-condition level (DEFCON-style): derives posture from routes +
 * active run phase. L5 all-clear → L1 active hijack quarantine.
 */
function ThreatCondition({ state }: { state: SimState }) {
  const routes = Object.values(state.routes);
  const quarantined = routes.filter((r) => r.underOverride && r.route.locPref === 0).length;
  const anomalous = routes.filter((r) => r.status !== 'normal' || r.underOverride).length;
  const phase = state.activeRun?.phase;

  let level = 5;
  let label = 'ALL CLEAR';
  let tone = 'border-emerald-800 text-emerald-300 bg-emerald-950/40';
  if (quarantined > 0 || phase === 'mitigated') {
    level = 1;
    label = 'QUARANTINE';
    tone = 'border-red-700 text-red-300 bg-red-950/50';
  } else if (phase === 'detected' || phase === 'injected') {
    level = 2;
    label = 'ENGAGED';
    tone = 'border-amber-700 text-amber-300 bg-amber-950/40';
  } else if (anomalous > 0) {
    level = 3;
    label = 'ELEVATED';
    tone = 'border-orange-800 text-orange-300 bg-orange-950/40';
  } else if (state.metrics.totalRuns > 0 && state.metrics.msrPercent < 100) {
    level = 4;
    label = 'GUARDED';
    tone = 'border-yellow-800 text-yellow-300 bg-yellow-950/30';
  }

  return (
    <span
      className={`hidden sm:inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded border font-semibold transition-colors ${tone}`}
      title={`threat condition L${level} — ${label}${quarantined ? ` · ${quarantined} route(s) quarantined` : anomalous ? ` · ${anomalous} anomalous` : ''}`}
    >
      <span className="flex gap-[2px]" aria-hidden>
        {[1, 2, 3, 4, 5].map((i) => (
          <span key={i} className={`w-[3px] h-2 rounded-[1px] ${i >= level ? 'bg-current' : 'bg-slate-700/60'}`} />
        ))}
      </span>
      <span className="text-[9.5px] tracking-wider">L{level} {label}</span>
    </span>
  );
}

function PipelineStrip({ config, running }: { config: SimConfig; running: boolean }) {
  const stages = [
    { name: 'Telemetry', on: config.telemetry.enabled, tone: 'text-sky-300 border-sky-800 bg-sky-950/40' },
    { name: '10-Features', on: true, tone: 'text-violet-300 border-violet-800 bg-violet-950/40' },
    { name: config.ml.mode === 'heuristic' ? 'Heuristic' : 'ML', on: config.ml.enabled, tone: 'text-cyan-300 border-cyan-800 bg-cyan-950/40' },
    { name: 'Trust τ', on: config.trust.enabled, tone: 'text-teal-300 border-teal-800 bg-teal-950/40' },
    { name: 'Shadow', on: config.shadow.enabled, tone: 'text-fuchsia-300 border-fuchsia-800 bg-fuchsia-950/40' },
    { name: 'Policy', on: config.policy.enabled, tone: 'text-orange-300 border-orange-800 bg-orange-950/40' },
    { name: 'RIB-Verify', on: config.ribVerification.enabled, tone: 'text-amber-300 border-amber-800 bg-amber-950/40' },
    { name: 'Rollback', on: config.rollback.enabled, tone: 'text-emerald-300 border-emerald-800 bg-emerald-950/40' },
  ];
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {stages.map((s, i) => (
        <React.Fragment key={s.name}>
          {i > 0 && (
            <span
              className={`text-[10px] transition-colors ${running && s.on ? 'text-slate-500 animate-pulse' : 'text-slate-700'}`}
            >
              →
            </span>
          )}
          <span
            className={`text-[9.5px] font-mono px-2 py-0.5 rounded border transition-all ${s.on ? `${s.tone} shadow-sm` : 'text-slate-600 border-slate-800 bg-slate-900/40 line-through'}`}
            title={s.on ? 'enabled' : 'disabled'}
          >
            {s.name}
          </span>
        </React.Fragment>
      ))}
    </div>
  );
}

/** Attack lifecycle progress steps: injected → detected → mitigated → rolledback */
function PhaseSteps({ phase }: { phase: RunResult['phase'] }) {
  const steps: { id: RunResult['phase']; label: string }[] = [
    { id: 'injected', label: 'injected' },
    { id: 'detected', label: 'detected' },
    { id: 'mitigated', label: 'mitigated' },
    { id: 'rolledback', label: 'rolled back' },
  ];
  const order: Record<string, number> = { idle: 0, injected: 1, detected: 2, mitigated: 3, rolledback: 4, failed: 4 };
  const current = order[phase] ?? 0;
  return (
    <div className="flex items-center gap-1">
      {steps.map((s, i) => {
        const reached = current > i + 1 || (current === i + 1);
        const isFailed = phase === 'failed' && i === steps.length - 1;
        const isCurrent = current === i + 1 && phase !== 'failed';
        return (
          <React.Fragment key={s.id}>
            {i > 0 && <span className={`text-[9px] ${reached ? 'text-slate-500' : 'text-slate-700'}`}>──</span>}
            <span
              className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${
                isFailed
                  ? 'border-red-900 text-red-400 bg-red-950/40'
                  : reached
                    ? isCurrent
                      ? 'border-amber-600 text-amber-300 bg-amber-950/50 animate-pulse'
                      : 'border-emerald-800 text-emerald-300 bg-emerald-950/40'
                    : 'border-slate-800 text-slate-600'
              }`}
            >
              {s.label}
            </span>
          </React.Fragment>
        );
      })}
    </div>
  );
}

export default function Home() {
  const { state, connected, start, pause, reset, updateConfig, applyPreset, resetConfig, injectAttack, injectCustom, withdrawAttack } = useBgpSim();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState('control');
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [soundOn, setSoundOn] = useState(!isMuted());
  // cross-tab deep link: jumping from Benchmark run history into the time-travel scrubber
  const [jumpTarget, setJumpTarget] = useState<{ t: number; nonce: number } | null>(null);
  // per-prefix drill-down modal (opened from route rows + RIB log)
  const [drillPrefix, setDrillPrefix] = useState<string | null>(null);

  // ablation A/B experiment state machine — page level, survives tab switches
  const ablation = useAblationExperiment({
    state,
    onApplyPreset: applyPreset,
    onUpdateConfig: updateConfig,
    onInject: injectAttack,
    onWithdraw: withdrawAttack,
    onStart: start,
  });

  const running = state?.running ?? false;
  const activeRun = state?.activeRun ?? null;
  // server-tracked config variant label (engine updates it on preset/edit/reset)
  const variantLabel = state?.variantLabel ?? 'A4 · Full System';

  /** unlock Web Audio on the first user gesture (browser autoplay policy) */
  useEffect(() => primeAudioUnlock(), []);

  /** NOC sound alerts — watch for NEW events and map them to tones */
  const events: SimEvent[] | undefined = state?.events;
  const lastEventIdRef = useRef<number>(-1);
  const prevEventsRef = useRef<SimEvent[] | undefined>(undefined);
  useEffect(() => {
    if (!events || events.length === 0) {
      lastEventIdRef.current = -1;
      prevEventsRef.current = events;
      return;
    }
    const maxId = events[events.length - 1].id;
    // first observation (or engine reset restarted ids) — baseline without sound
    if (lastEventIdRef.current === -1 || maxId < lastEventIdRef.current) {
      lastEventIdRef.current = maxId;
      prevEventsRef.current = events;
      return;
    }
    if (maxId > lastEventIdRef.current) {
      for (const e of events) {
        if (e.id > lastEventIdRef.current) {
          const tone = alertForEvent(e.source, e.level, e.message);
          if (tone) playAlert(tone);
        }
      }
      lastEventIdRef.current = maxId;
    }
    prevEventsRef.current = events;
  }, [events]);

  /** run-completion toasts — notify when a run lands in history (reset-aware) */
  const history: RunResult[] | undefined = state?.history;
  const runGenRef = useRef(0); // bumped on engine reset (history shrink) so runIds can repeat
  const histLenRef = useRef(0);
  const seenRunKeyRef = useRef('');
  useEffect(() => {
    if (!history) return;
    if (history.length < histLenRef.current) {
      // engine reset — history restarted; runIds will repeat
      runGenRef.current += 1;
      histLenRef.current = history.length;
      seenRunKeyRef.current = '';
      return;
    }
    histLenRef.current = history.length;
    if (history.length === 0) return;
    // engine emits history newest-first — the head entry is the latest landed run
    const last = history[0];
    const key = `${runGenRef.current}:${last.runId}`;
    if (seenRunKeyRef.current === '') {
      // first observation of this generation — baseline, swallow pre-existing tail
      seenRunKeyRef.current = key;
      return;
    }
    if (key === seenRunKeyRef.current) return;
    seenRunKeyRef.current = key;
    if (last.phase === 'rolledback') {
      toast({
        title: `Run #${last.runId} · ${last.scenarioId} rolled back`,
        description: `Autonomous rollback complete — LocalPref ${last.appliedLocPref ?? 0} → ${state?.config.policy.lpNormal ?? 100} restored after sustained healthy ticks.`,
      });
    } else if (last.phase === 'failed') {
      toast({
        title: `Run #${last.runId} · ${last.scenarioId} failed`,
        description: last.detectedAt === null ? 'Attack was never detected — mitigation missed.' : 'Mitigation did not complete successfully.',
        variant: 'destructive',
      });
    } else if (last.phase === 'mitigated' || last.phase === 'detected') {
      toast({
        title: `Run #${last.runId} · ${last.scenarioId} closed (${last.phase})`,
        description: `${last.appliedPolicy || 'no override'} · MTTD ${last.mttd ?? '—'}s · MTTM ${last.mttm ?? '—'}s${last.msr ? ' · mitigated' : ''}.`,
      });
    }
  }, [history, toast]);

  /** Keyboard shortcuts: Space run/pause · R reset · M mute · 1-5 tabs · ? help */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
      if (e.key === ' ') {
        e.preventDefault();
        if (running) {
          pause();
        } else {
          start();
        }
      } else if (e.key.toLowerCase() === 'r') {
        reset();
        toast({ title: 'Simulation reset', description: '10-AS baseline state restored, metrics cleared.' });
      } else if (['1', '2', '3', '4', '5'].includes(e.key)) {
        const tab = ['control', 'analytics', 'benchmark', 'copilot', 'docs'][Number(e.key) - 1];
        setActiveTab(tab);
      } else if (e.key.toLowerCase() === 'm') {
        const next = !soundOn;
        setSoundOn(next);
        setMuted(!next);
      } else if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        setShowShortcuts((s) => !s);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [running, start, pause, reset, toast, soundOn]);

  return (
    <div className="dark min-h-screen flex flex-col bg-slate-950 text-slate-200 noc-grid-bg">
      <Toaster />

      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-slate-800 bg-gradient-to-r from-slate-950 via-slate-900/80 to-slate-950 bg-slate-950/95 backdrop-blur supports-[backdrop-filter]:bg-slate-950/75">
        <div className="max-w-[1600px] mx-auto px-4 py-2.5 flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2.5">
            <div className="relative">
              <Radio className="h-5 w-5 text-emerald-400" />
              <span className={`absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full ${running ? 'bg-emerald-400 animate-ping' : connected ? 'bg-amber-500' : 'bg-red-500'}`} />
            </div>
            <div>
              <h1 className="text-sm font-bold tracking-tight text-slate-50 leading-none">
                AI-Enhanced BGP <span className="text-emerald-400">Autonomous Control Plane</span>
              </h1>
              <p className="text-[10px] font-mono text-slate-500 mt-0.5">10-AS multi-tier simulation · dual defender · shadow validation · autonomous rollback</p>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2 flex-wrap">
            {state && <PipelineStrip config={state.config} running={running} />}
            <div className="flex items-center gap-1.5 font-mono text-[11px]">
              <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border transition-colors ${connected ? 'border-emerald-800 text-emerald-300 bg-emerald-950/40' : 'border-red-800 text-red-400 bg-red-950/40'}`}>
                <CircleDot className="h-2.5 w-2.5" /> {connected ? 'LINK' : 'OFFLINE'}
              </span>
              {state && <ThreatCondition state={state} />}
              <span className="text-slate-500">t=</span>
              <span className="text-emerald-300 w-16 tabular-nums">{(state?.simTime ?? 0).toFixed(0)}s</span>
              <span className="text-slate-600">tick {state?.tick ?? 0}</span>
              <span className="hidden md:inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-violet-900/60 text-violet-300 bg-violet-950/40">
                {variantLabel}
              </span>
            </div>
            <Button
              size="sm"
              onClick={() => (running ? pause() : start())}
              title="Space"
              className={`h-8 font-mono text-xs transition-colors ${running ? 'bg-amber-600 hover:bg-amber-500 text-black' : 'bg-emerald-600 hover:bg-emerald-500 text-black'}`}
            >
              {running ? <Pause className="h-3.5 w-3.5 mr-1" /> : <Play className="h-3.5 w-3.5 mr-1" />}
              {running ? 'PAUSE' : 'RUN'}
            </Button>
            <Button
              size="sm"
              variant="outline"
              title="R"
              onClick={() => {
                reset();
                toast({ title: 'Simulation reset', description: '10-AS baseline state restored, metrics cleared.' });
              }}
              className="h-8 font-mono text-xs border-slate-700 text-slate-300 hover:bg-slate-800"
            >
              <RotateCcw className="h-3.5 w-3.5 mr-1" /> RESET
            </Button>
            <Button
              size="sm"
              variant="outline"
              title={soundOn ? 'sound alerts on — click to mute' : 'sound alerts muted — click to enable'}
              aria-pressed={soundOn}
              aria-label="toggle sound alerts"
              onClick={() => {
                const next = !soundOn;
                setSoundOn(next);
                setMuted(!next);
                if (next) {
                  // gesture context — safe to probe the audio pipeline
                  playAlert('success');
                }
              }}
              className={`h-8 w-8 p-0 ${soundOn ? 'border-emerald-700 text-emerald-300 hover:bg-emerald-950/40' : 'border-slate-700 text-slate-500 hover:bg-slate-800'}`}
            >
              {soundOn ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
            </Button>
            <Button
              size="sm"
              variant="outline"
              title="?"
              onClick={() => setShowShortcuts((s) => !s)}
              className="h-8 w-8 p-0 border-slate-700 text-slate-400 hover:bg-slate-800"
            >
              <Keyboard className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        {activeRun && (
          <div className="border-t border-slate-800/60 bg-slate-900/40">
            <div className="max-w-[1600px] mx-auto px-4 py-1.5 flex items-center gap-3 flex-wrap text-[11px] font-mono">
              <Badge variant="outline" className="border-red-800 text-red-300 bg-red-950/50 text-[10px]">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse mr-1" />
                {activeRun.scenarioId} ACTIVE
              </Badge>
              <span className="text-slate-400 hidden sm:inline">{activeRun.scenarioName}</span>
              <PhaseSteps phase={activeRun.phase} />
              {activeRun.mttd !== null && (
                <>
                  <span className="text-slate-600">mttd:</span>
                  <span className="text-amber-300">{activeRun.mttd}s</span>
                </>
              )}
              {activeRun.mttm !== null && (
                <>
                  <span className="text-slate-600">mttm:</span>
                  <span className="text-orange-300">{activeRun.mttm}s</span>
                </>
              )}
              {activeRun.appliedPolicy && (
                <>
                  <span className="text-slate-600">policy:</span>
                  <span className="text-orange-300">{activeRun.appliedPolicy}</span>
                </>
              )}
              <span className="text-slate-600 ml-auto">injected at t={activeRun.injectedAt}s</span>
            </div>
          </div>
        )}
      </header>

      {/* shortcut overlay */}
      {showShortcuts && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowShortcuts(false)}>
          <div className="rounded-lg border border-slate-700 bg-slate-900 p-5 shadow-2xl max-w-sm w-full mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-3">
              <Keyboard className="h-4 w-4 text-emerald-400" />
              <span className="text-sm font-semibold text-slate-100">Keyboard Shortcuts</span>
            </div>
            <div className="space-y-2 text-[11px] font-mono">
              {[
                ['Space', 'run / pause the simulation clock'],
                ['R', 'reset to 10-AS baseline'],
                ['M', 'mute / unmute NOC sound alerts'],
                ['1 – 5', 'switch tabs (control · analytics · benchmark · copilot · docs)'],
                ['?', 'toggle this help'],
              ].map(([k, d]) => (
                <div key={k} className="flex items-center gap-3">
                  <kbd className="px-2 py-1 rounded border border-slate-700 bg-slate-950 text-emerald-300 text-[10px] min-w-12 text-center">{k}</kbd>
                  <span className="text-slate-400">{d}</span>
                </div>
              ))}
            </div>
            <Button size="sm" onClick={() => setShowShortcuts(false)} className="mt-4 w-full h-7 text-[11px] font-mono bg-slate-800 hover:bg-slate-700 text-slate-200">close</Button>
          </div>
        </div>
      )}

      {/* Main */}
      <main className="flex-1 w-full max-w-[1600px] mx-auto px-4 py-4 min-w-0">
        {!state ? (
          <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
            <div className="relative">
              <Layers className="h-10 w-10 text-slate-700 animate-pulse" />
              <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
            </div>
            <p className="text-sm font-mono text-slate-500">connecting to BGP simulation engine…</p>
            <p className="text-[11px] font-mono text-slate-600">{connected ? 'handshaking telemetry stream' : 'engine offline — retrying'}</p>
            <div className="w-full max-w-md space-y-2 mt-2" aria-hidden="true">
              <div className="h-2.5 rounded bg-slate-900 overflow-hidden"><div className="h-full w-2/3 rounded bg-slate-800 animate-pulse" /></div>
              <div className="h-2.5 rounded bg-slate-900 overflow-hidden"><div className="h-full w-5/6 rounded bg-slate-800 animate-pulse" style={{ animationDelay: '120ms' }} /></div>
              <div className="h-2.5 rounded bg-slate-900 overflow-hidden"><div className="h-full w-1/2 rounded bg-slate-800 animate-pulse" style={{ animationDelay: '240ms' }} /></div>
            </div>
          </div>
        ) : (
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="bg-slate-900 border border-slate-800 h-9 w-full justify-start overflow-x-auto scrollbar-none rounded-md">
              <TabsTrigger value="control" className="font-mono text-[9.5px] sm:text-xs px-2 sm:px-3 data-[state=active]:bg-slate-800 text-slate-300 gap-1.5 focus-visible:ring-1 focus-visible:ring-emerald-600">
                <SlidersHorizontal className="h-3 w-3 hidden sm:inline-block" /> CONTROL ROOM
                {state.activeRun && (
                  <span
                    className="inline-flex items-center gap-1 px-1.5 py-px rounded-full border border-red-900 bg-red-950/60 text-[8.5px] text-red-300 leading-none"
                    aria-label="attack active"
                  >
                    <span className="w-1 h-1 rounded-full bg-red-500 animate-pulse" />
                    <span className="hidden sm:inline">{state.activeRun.scenarioId}</span>
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="analytics" className="font-mono text-[9.5px] sm:text-xs px-2 sm:px-3 data-[state=active]:bg-slate-800 text-slate-300 gap-1.5 focus-visible:ring-1 focus-visible:ring-emerald-600">
                <BarChart3 className="h-3 w-3 hidden sm:inline-block" /> ANALYTICS
              </TabsTrigger>
              <TabsTrigger value="benchmark" className="font-mono text-[9.5px] sm:text-xs px-2 sm:px-3 data-[state=active]:bg-slate-800 text-slate-300 gap-1.5 focus-visible:ring-1 focus-visible:ring-emerald-600">
                <Trophy className="h-3 w-3 hidden sm:inline-block" /> BENCHMARK
                {['arm-a', 'run-a', 'arm-b', 'run-b'].includes(ablation.phase) && (
                  <span
                    className="inline-flex items-center gap-1 px-1.5 py-px rounded-full border border-violet-800 bg-violet-950/60 text-[8.5px] text-violet-300 leading-none"
                    aria-label="ablation experiment running"
                    title={`A/B experiment running — ${ablation.phase}`}
                  >
                    <span className="w-1 h-1 rounded-full bg-violet-400 animate-pulse" />
                    <span className="hidden sm:inline">A/B</span>
                  </span>
                )}
                {state.metrics.totalRuns > 0 && !['arm-a', 'run-a', 'arm-b', 'run-b'].includes(ablation.phase) && (
                  <span className="px-1.5 py-px rounded-full border border-slate-700 bg-slate-950/60 text-[8.5px] text-slate-400 leading-none tabular-nums">
                    {state.metrics.totalRuns}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="copilot" className="font-mono text-[9.5px] sm:text-xs px-2 sm:px-3 data-[state=active]:bg-violet-900/60 text-violet-200 gap-1.5 data-[state=active]:text-violet-100 focus-visible:ring-1 focus-visible:ring-violet-500">
                <Sparkles className="h-3 w-3 hidden sm:inline-block" /> AI COPILOT
                <span className="hidden lg:inline-block w-1 h-1 rounded-full bg-violet-400 animate-pulse" />
              </TabsTrigger>
              <TabsTrigger value="docs" className="font-mono text-[9.5px] sm:text-xs px-2 sm:px-3 data-[state=active]:bg-slate-800 text-slate-300 gap-1.5 focus-visible:ring-1 focus-visible:ring-emerald-600">
                <BookOpen className="h-3 w-3 hidden sm:inline-block" /> ARCHITECTURE
              </TabsTrigger>
            </TabsList>

            {/* CONTROL ROOM */}
            <TabsContent value="control" className="mt-3">
              <div className="grid grid-cols-1 xl:grid-cols-[300px_1fr_340px] gap-4 items-start">
                <div className="xl:sticky xl:top-28 max-h-[calc(100vh-8rem)] overflow-y-auto pr-1 scrollbar-thin">
                  <ConfigDiff config={state.config} variantLabel={variantLabel} onResetConfig={resetConfig} />
                  <div className="mt-3">
                    <ControlCenter
                      config={state.config}
                      onUpdate={updateConfig}
                      onPreset={applyPreset}
                      onResetConfig={resetConfig}
                      onLoadPreset={(cfg) => {
                        updateConfig(cfg);
                        toast({ title: 'Preset loaded', description: 'Configuration applied to the live simulation engine.' });
                      }}
                    />
                  </div>
                </div>

                <div className="space-y-4 min-w-0">
                  <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-semibold text-slate-200">10-AS Multi-Tier Topology</span>
                      <span className="text-[10px] font-mono text-slate-500">
                        defender: AS{state.config.global.defenderAs} · 18 eBGP sessions
                      </span>
                    </div>
                    <TopologyGraph
                      nodes={state.nodes}
                      edges={state.edges}
                      defenderAs={state.config.global.defenderAs}
                      attackPath={(() => {
                        if (!activeRun || !['injected', 'detected', 'mitigated'].includes(activeRun.phase)) return null;
                        const scenario = ATTACK_SCENARIOS.find((s) => s.id === activeRun.scenarioId);
                        const route: RouteSnapshot | undefined = scenario
                          ? state.routes[scenario.prefix]
                          : Object.values(state.routes).find(
                              (r) => r.route.active && r.status !== 'normal' && !r.underOverride,
                            ) ?? Object.values(state.routes).find((r) => r.status === 'hijack' || r.status === 'leak');
                        if (!route || !route.route.active) return null;
                        const asns = route.route.asPath.split(/\s+/).map(Number).filter((n) => Number.isFinite(n) && n > 0);
                        if (asns.length < 2) return null;
                        return { asnPath: asns, prefix: route.route.prefix, scenarioId: activeRun.scenarioId, phase: activeRun.phase };
                      })()}
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-slate-200">Live RIB / Route Telemetry</span>
                        {(() => {
                          const routes = Object.values(state.routes);
                          const abnormal = routes.filter((r) => r.status !== 'normal' || r.underOverride).length;
                          if (abnormal === 0) {
                            return (
                              <span className="inline-flex items-center gap-1 px-1.5 py-px rounded-full border border-emerald-900 bg-emerald-950/50 text-[9px] font-mono text-emerald-400 leading-none">
                                <span className="w-1 h-1 rounded-full bg-emerald-400" /> all stable
                              </span>
                            );
                          }
                          return (
                            <span className="inline-flex items-center gap-1 px-1.5 py-px rounded-full border border-amber-900 bg-amber-950/50 text-[9px] font-mono text-amber-300 leading-none">
                              <span className="w-1 h-1 rounded-full bg-amber-400 animate-pulse" /> {abnormal} anomalous
                            </span>
                          );
                        })()}
                      </div>
                      <span className="text-[10px] font-mono text-slate-500">{Object.keys(state.routes).length} prefixes · click a route for diagnostics · ⌖ for full history</span>
                    </div>
                    <RouteTable state={state} onFocusPrefix={setDrillPrefix} />
                  </div>

                  <RibLogViewer state={state} onFocusPrefix={setDrillPrefix} />

                  <RouteMapPreview config={state.config} />
                </div>

                <div className="space-y-4 xl:sticky xl:top-28">
                  <AttackPanel
                    activeScenarioId={activeRun?.scenarioId ?? null}
                    activePhase={activeRun?.phase ?? null}
                    activeElapsedSec={
                      activeRun ? Math.max(0, Math.round((state?.simTime ?? 0) - activeRun.injectedAt)) : 0
                    }
                    activeRemainingSec={(() => {
                      if (!activeRun) return null;
                      const sc = ATTACK_SCENARIOS.find((s) => s.id === activeRun.scenarioId);
                      if (!sc) return null; // custom attack — duration not tracked in RunResult
                      const elapsed = Math.max(0, Math.round((state?.simTime ?? 0) - activeRun.injectedAt));
                      return Math.max(0, sc.defaultDurationSec - elapsed);
                    })()}
                    onInject={(id) => {
                      injectAttack(id);
                      toast({ title: `Scenario ${id} injected`, description: 'Rogue announcement propagating through the 10-AS testbed.' });
                    }}
                    onWithdraw={() => {
                      withdrawAttack();
                      toast({ title: 'Attack withdrawn', description: 'Rogue announcement removed — awaiting autonomous rollback.' });
                    }}
                    onCustom={injectCustom}
                  />
                  <div className="h-[420px] hidden xl:block">
                    <EventLog events={state.events} simTime={state.simTime} />
                  </div>
                </div>

                <div className="xl:hidden col-span-full">
                  <EventLog events={state.events} simTime={state.simTime} />
                </div>
              </div>
            </TabsContent>

            {/* ANALYTICS */}
            <TabsContent value="analytics" className="mt-3">
              <AnalyticsPanel state={state} />
              <div className="mt-4">
                <TimeTravelScrubber
                  key={jumpTarget ? `jump-${jumpTarget.nonce}` : 'base'}
                  state={state}
                  initialT={jumpTarget?.t ?? null}
                />
              </div>
              <div className="mt-4">
                <ScenarioDeepDive state={state} />
              </div>
            </TabsContent>

            {/* BENCHMARK */}
            <TabsContent value="benchmark" className="mt-3">
              <BenchmarkPanel
                state={state}
                ablation={ablation}
                onInject={(id) => {
                  injectAttack(id);
                  toast({ title: `Scenario ${id} injected`, description: 'Rogue announcement propagating through the 10-AS testbed.' });
                }}
                onWithdraw={withdrawAttack}
                onStart={start}
                onJumpToTime={(t, label) => {
                  setJumpTarget({ t, nonce: Date.now() });
                  setActiveTab('analytics');
                  toast({
                    title: 'Time-travel jump',
                    description: `Scrubber moved to t=${t}s (${label}) — replay this run in the Analytics tab.`,
                  });
                }}
              />
            </TabsContent>

            {/* AI COPILOT */}
            <TabsContent value="copilot" className="mt-3">
              <AiAssistantPanel state={state} variantLabel={variantLabel} />
            </TabsContent>

            {/* ARCHITECTURE */}
            <TabsContent value="docs" className="mt-3">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-4 space-y-3">
                  <span className="text-sm font-semibold text-slate-100">Autonomous Control-Plane Pipeline</span>
                  <pre className="text-[10.5px] font-mono text-slate-400 leading-relaxed whitespace-pre-wrap">{`[ Telemetry Coroutine ]  async vtysh collector
        │  show bgp summary + ipv4 unicast JSON
        ▼
[ 10-Feature Behavioral Extractor ]
  1. AS-Path Hop Count        6. Rolling 5-Min Flap Count
  2. AS-Path Edit Distance    7. Current Local Preference
  3. Origin AS Change Flag    8. True Route Maturity (Age)
  4. Prefix CIDR Mask Length  9. Gao-Rexford Valley-Free
  5. Announcements / Minute  10. Peer Neighbor Diversity
        │
        ▼
[ Calibrated ML + Hybrid Trust Engine ]
  RF 85.06% acc · τ = Σ wᵢ·tᵢ (origin 0.20, path 0.20,
  flap 0.15, prefix 0.15, peer 0.10, ML 0.20)
        │
        ▼
[ Shadow Validator & Anti-Thrashing Guard ]
  streak persistence + dwell time + Δ hysteresis
        │
        ▼
[ Dedicated Policy Actor — Atomic Route-Maps ]
  Normal      τ ≥ 0.85  →  LP 100
  Suspicious  0.55-0.80  →  LP 80   (soft)
  Leak        0.25-0.55  →  LP 50   (hard)
  Hijack      τ < 0.25   →  LP 0 + no-export (quarantine)
        │
        ▼
[ Two-Layer RIB Verification ]  config + best-path commit
        │
        ▼
[ Multi-Criteria Autonomous Rollback ]  → LP 100`}</pre>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-4 space-y-3">
                  <span className="text-sm font-semibold text-slate-100">Attack Scenario Catalogue</span>
                  <pre className="text-[10.5px] font-mono text-slate-400 leading-relaxed whitespace-pre-wrap">{`S1  Direct Prefix Hijack     exact /24 by rogue AS65010
    → best-path competition w/ incumbent route

S2  Sub-Prefix Hijack /25    more-specific deaggregation
    → longest-prefix match captures traffic instantly

S3  Burst Route Flapping     churn flood from origin AS65007
    → damped via soft deprioritization (LP 80)

S4  YouTube 2008 Replay      PT (AS17557) hijacks 208.65.153.0/24
    → sub-prefix of YouTube's /22 allocation

S5  Google 2017 Route Leak   Rostelecom (AS12389) transit leak
    → valley-free violation, origin cryptographically valid

S6  Cloudflare 2019 Leak     Allegheny (AS396531) → Verizon (AS701)
    → customer-to-peer leak, valid origin AS13335

Historical defenses compared in parallel:
  · Standard BGP (RFC 4271)   — no detection
  · RPKI ROV (RFC 6811)       — origin-validity only
  · Behavioural heuristics     — fixed rules, ~92% PDR
  · AI Control Plane (this)    — closed-loop autonomous`}</pre>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-4 lg:col-span-2">
                  <span className="text-sm font-semibold text-slate-100">Ablation Experiment Variants</span>
                  <div className="mt-2 grid grid-cols-1 sm:grid-cols-5 gap-2">
                    {[
                      ['A0', 'Standard BGP', 'no detector · no mitigation · RFC baseline'],
                      ['A1', '+ Heuristics', 'rule-based detection · immediate static policy'],
                      ['A2', '+ ML Only', 'RF class → policy · no trust weighting'],
                      ['A3', '+ Trust', 'ML + 6-factor continuous trust score'],
                      ['A4', 'Full System', '+ shadow staging + atomic commit + rollback'],
                    ].map(([id, name, desc]) => (
                      <div key={id} className="rounded border border-slate-800 bg-slate-900/50 p-2.5 hover:border-slate-700 transition-colors">
                        <div className="text-[11px] font-mono font-semibold text-emerald-300">{id}</div>
                        <div className="text-[11px] font-semibold text-slate-200 mt-0.5">{name}</div>
                        <div className="text-[10px] text-slate-500 mt-1">{desc}</div>
                      </div>
                    ))}
                  </div>
                  <p className="mt-3 text-[11px] font-mono text-slate-500">
                    Based on the AI-Enhanced BGP research project (v3.0) — 10-AS FRR testbed, empirical telemetry training, MTTD/MTTM/MSR benchmarking.
                  </p>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-4 lg:col-span-2">
                  <span className="text-sm font-semibold text-slate-100">Operator Tooling</span>
                  <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {[
                      ['NOC sound alerts', 'synthesized tones on injection, detection, quarantine and rollback — header mute toggle persists'],
                      ['Time-travel scrubber', 'replay any t in the Analytics tab — run bands, event markers, trust reconstruction at T'],
                      ['Run deep-links', 'hover a run row in Benchmark and jump its injection moment into the scrubber'],
                      ['Streaming AI copilot', 'token-by-token LLM analysis of live engine state (Enter to send) + markdown transcript export'],
                      ['Run archive exports', 'SQLite-persisted runs → styled standalone HTML report or CSV'],
                      ['Auto-benchmark sweep', 'sequential S1→S6 injection with per-scenario progress and abort'],
                      ['Keyboard control', 'Space run/pause · R reset · 1-5 tabs · ? help'],
                      ['Live route-map preview', 'FRR-style config generated from your sliders — copy or download .conf'],
                      ['RIB verification log', 'two-layer commit audit with pass-rate and retry tracking'],
                      ['Config diff monitor', 'live drift view of every knob vs the A4 baseline — grouped by subsystem with restore button'],
                      ['Trust trajectory sparklines', 'per-prefix trust history with policy-tier bands and minimum marker inside route diagnostics'],
                      ['Threat condition level', 'DEFCON-style L5→L1 posture indicator in the header, derived from routes and run phase'],
                      ['Prefix drill-down forensics', '⌖ on any route row (or RIB log prefix) opens a modal: trust decomposition τ = Σ wᵢ·tᵢ, full trajectory chart, run lifecycle timeline, per-prefix event stream and RIB audit'],
                      ['Attack path overlay', 'topology renders the live hijack propagation path as an animated red flow from origin toward the defender — switches to a blocked ✕ marker when quarantine commits'],
                      ['Ablation A/B laboratory', 'Benchmark tab: controlled experiment — same scenario under two ablation variants back-to-back with side-by-side detection/MTTD/MTTM/MSR comparison; your config is snapshotted and restored'],
                      ['Variant performance archive', 'Analytics tab: detection rate, MSR and mean MTTD/MTTM aggregated per variant across every run ever persisted to SQLite — the long-horizon ablation story'],
                    ].map(([name, desc]) => (
                      <div key={name} className="rounded border border-slate-800 bg-slate-900/50 p-2.5 hover:border-slate-700 transition-colors">
                        <div className="text-[11px] font-semibold text-slate-200">{name}</div>
                        <div className="text-[10px] text-slate-500 mt-1">{desc}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        )}

        {/* per-prefix drill-down modal — reachable from route rows + RIB log */}
        {state && (
          <PrefixDrilldown state={state} prefix={drillPrefix} onClose={() => setDrillPrefix(null)} />
        )}
      </main>

      {/* Footer */}
      <footer className="mt-auto border-t border-slate-800 bg-slate-950/95">
        <div className="max-w-[1600px] mx-auto px-4 py-2.5 flex items-center gap-3 flex-wrap text-[10px] font-mono text-slate-600">
          <span className="text-slate-400">AI-Enhanced BGP Simulation · v3.0 replica</span>
          <span className="hidden sm:inline">·</span>
          <span>telemetry→features→ML→trust→shadow→policy→RIB→rollback</span>
          <span className="ml-auto hidden md:inline">LocalPref 100/80/50/0 + no-export · Gao-Rexford · RFC 1997/6811/9234</span>
        </div>
      </footer>
    </div>
  );
}
