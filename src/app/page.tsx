'use client';

import React from 'react';
import { useBgpSim } from '@/lib/bgp-sim/client';
import { TopologyGraph } from '@/components/bgp/topology-graph';
import { ControlCenter } from '@/components/bgp/control-center';
import { AttackPanel } from '@/components/bgp/attack-panel';
import { RouteTable } from '@/components/bgp/route-table';
import { EventLog } from '@/components/bgp/event-log';
import { AnalyticsPanel } from '@/components/bgp/analytics';
import { BenchmarkPanel } from '@/components/bgp/benchmark';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Toaster } from '@/components/ui/toaster';
import { useToast } from '@/hooks/use-toast';
import { Play, Pause, RotateCcw, Radio, CircleDot, Layers } from 'lucide-react';

function PipelineStrip({ config }: { config: import('@/lib/bgp-sim/types').SimConfig }) {
  const stages = [
    { name: 'Telemetry', on: config.telemetry.enabled, tone: 'text-sky-300 border-sky-800 bg-sky-950/40' },
    { name: '10-Features', on: true, tone: 'text-violet-300 border-violet-800 bg-violet-950/40' },
    { name: config.ml.mode === 'heuristic' ? 'Heuristic' : 'ML', on: config.ml.enabled, tone: 'text-cyan-300 border-cyan-800 bg-cyan-950/40' },
    { name: 'Trust τ', on: config.trust.enabled, tone: 'text-teal-300 border-teal-800 bg-teal-950/40' },
    { name: 'Shadow', on: config.shadow.enabled, tone: 'text-indigo-300 border-indigo-800 bg-indigo-950/40' },
    { name: 'Policy', on: config.policy.enabled, tone: 'text-orange-300 border-orange-800 bg-orange-950/40' },
    { name: 'RIB-Verify', on: config.ribVerification.enabled, tone: 'text-amber-300 border-amber-800 bg-amber-950/40' },
    { name: 'Rollback', on: config.rollback.enabled, tone: 'text-emerald-300 border-emerald-800 bg-emerald-950/40' },
  ];
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {stages.map((s, i) => (
        <React.Fragment key={s.name}>
          {i > 0 && <span className="text-slate-700 text-[10px]">→</span>}
          <span
            className={`text-[9.5px] font-mono px-1.5 py-0.5 rounded border ${s.on ? s.tone : 'text-slate-600 border-slate-800 bg-slate-900/40 line-through'}`}
            title={s.on ? 'enabled' : 'disabled'}
          >
            {s.name}
          </span>
        </React.Fragment>
      ))}
    </div>
  );
}

export default function Home() {
  const { state, connected, start, pause, reset, updateConfig, applyPreset, resetConfig, injectAttack, injectCustom, withdrawAttack } = useBgpSim();
  const { toast } = useToast();

  const running = state?.running ?? false;
  const activeRun = state?.activeRun ?? null;

  return (
    <div className="dark min-h-screen flex flex-col bg-slate-950 text-slate-200">
      <Toaster />

      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-slate-800 bg-slate-950/95 backdrop-blur supports-[backdrop-filter]:bg-slate-950/75">
        <div className="max-w-[1600px] mx-auto px-4 py-2.5 flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2.5">
            <div className="relative">
              <Radio className="h-5 w-5 text-emerald-400" />
              <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
            </div>
            <div>
              <h1 className="text-sm font-bold tracking-tight text-slate-50 leading-none">
                AI-Enhanced BGP <span className="text-emerald-400">Autonomous Control Plane</span>
              </h1>
              <p className="text-[10px] font-mono text-slate-500 mt-0.5">10-AS multi-tier simulation · dual defender · shadow validation · autonomous rollback</p>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2 flex-wrap">
            {state && <PipelineStrip config={state.config} />}
            <div className="flex items-center gap-1.5 font-mono text-[11px]">
              <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border ${connected ? 'border-emerald-800 text-emerald-300 bg-emerald-950/40' : 'border-red-800 text-red-400 bg-red-950/40'}`}>
                <CircleDot className="h-2.5 w-2.5" /> {connected ? 'LINK' : 'OFFLINE'}
              </span>
              <span className="text-slate-500">t=</span>
              <span className="text-emerald-300 w-16">{(state?.simTime ?? 0).toFixed(0)}s</span>
              <span className="text-slate-600">tick {state?.tick ?? 0}</span>
            </div>
            <Button
              size="sm"
              onClick={() => (running ? pause() : start())}
              className={`h-8 font-mono text-xs ${running ? 'bg-amber-600 hover:bg-amber-500 text-black' : 'bg-emerald-600 hover:bg-emerald-500 text-black'}`}
            >
              {running ? <Pause className="h-3.5 w-3.5 mr-1" /> : <Play className="h-3.5 w-3.5 mr-1" />}
              {running ? 'PAUSE' : 'RUN'}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                reset();
                toast({ title: 'Simulation reset', description: '10-AS baseline state restored, metrics cleared.' });
              }}
              className="h-8 font-mono text-xs border-slate-700 text-slate-300 hover:bg-slate-800"
            >
              <RotateCcw className="h-3.5 w-3.5 mr-1" /> RESET
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
              <span className="text-slate-400">{activeRun.scenarioName}</span>
              <span className="text-slate-600">phase:</span>
              <span className="text-amber-300">{activeRun.phase}</span>
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

      {/* Main */}
      <main className="flex-1 w-full max-w-[1600px] mx-auto px-4 py-4 min-w-0">
        {!state ? (
          <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
            <Layers className="h-10 w-10 text-slate-700 animate-pulse" />
            <p className="text-sm font-mono text-slate-500">connecting to BGP simulation engine…</p>
            <p className="text-[11px] font-mono text-slate-600">{connected ? 'handshaking telemetry stream' : 'engine offline — retrying'}</p>
          </div>
        ) : (
          <Tabs defaultValue="control" className="w-full">
            <TabsList className="bg-slate-900 border border-slate-800 h-9 w-full justify-start overflow-x-auto scrollbar-none">
              <TabsTrigger value="control" className="font-mono text-[9.5px] sm:text-xs px-2 sm:px-3 data-[state=active]:bg-slate-800 text-slate-300">CONTROL ROOM</TabsTrigger>
              <TabsTrigger value="analytics" className="font-mono text-[9.5px] sm:text-xs px-2 sm:px-3 data-[state=active]:bg-slate-800 text-slate-300">ANALYTICS</TabsTrigger>
              <TabsTrigger value="benchmark" className="font-mono text-[9.5px] sm:text-xs px-2 sm:px-3 data-[state=active]:bg-slate-800 text-slate-300">BENCHMARK</TabsTrigger>
              <TabsTrigger value="docs" className="font-mono text-[9.5px] sm:text-xs px-2 sm:px-3 data-[state=active]:bg-slate-800 text-slate-300">ARCHITECTURE</TabsTrigger>
            </TabsList>

            {/* CONTROL ROOM */}
            <TabsContent value="control" className="mt-3">
              <div className="grid grid-cols-1 xl:grid-cols-[300px_1fr_340px] gap-4 items-start">
                <div className="xl:sticky xl:top-28 max-h-[calc(100vh-8rem)] overflow-y-auto pr-1 scrollbar-thin">
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

                <div className="space-y-4 min-w-0">
                  <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-semibold text-slate-200">10-AS Multi-Tier Topology</span>
                      <span className="text-[10px] font-mono text-slate-500">
                        defender: AS{state.config.global.defenderAs} · 18 eBGP sessions
                      </span>
                    </div>
                    <TopologyGraph nodes={state.nodes} edges={state.edges} defenderAs={state.config.global.defenderAs} />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold text-slate-200">Live RIB / Route Telemetry</span>
                      <span className="text-[10px] font-mono text-slate-500">{Object.keys(state.routes).length} prefixes · click a route for diagnostics</span>
                    </div>
                    <RouteTable state={state} />
                  </div>
                </div>

                <div className="space-y-4 xl:sticky xl:top-28">
                  <AttackPanel
                    activeScenarioId={activeRun?.scenarioId ?? null}
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
                    <EventLog events={state.events} />
                  </div>
                </div>

                <div className="xl:hidden col-span-full">
                  <EventLog events={state.events} />
                </div>
              </div>
            </TabsContent>

            {/* ANALYTICS */}
            <TabsContent value="analytics" className="mt-3">
              <AnalyticsPanel state={state} />
            </TabsContent>

            {/* BENCHMARK */}
            <TabsContent value="benchmark" className="mt-3">
              <BenchmarkPanel state={state} />
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
                      <div key={id} className="rounded border border-slate-800 bg-slate-900/50 p-2.5">
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
              </div>
            </TabsContent>
          </Tabs>
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
