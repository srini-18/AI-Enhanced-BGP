'use client';

import React, { useState } from 'react';
import { FEATURE_NAMES, RouteSnapshot, SimState } from '@/lib/bgp-sim/types';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ChevronDown, ChevronRight, ShieldAlert, ShieldCheck } from 'lucide-react';

const STATUS_STYLE: Record<string, { badge: string; dot: string; label: string }> = {
  normal: { badge: 'border-emerald-800 bg-emerald-950/60 text-emerald-300', dot: 'bg-emerald-400', label: 'NORMAL' },
  suspicious: { badge: 'border-amber-800 bg-amber-950/60 text-amber-300', dot: 'bg-amber-400', label: 'SUSPICIOUS' },
  leak: { badge: 'border-orange-800 bg-orange-950/60 text-orange-300', dot: 'bg-orange-400', label: 'ROUTE LEAK' },
  hijack: { badge: 'border-red-800 bg-red-950/60 text-red-300', dot: 'bg-red-500', label: 'HIJACK' },
  recovering: { badge: 'border-cyan-800 bg-cyan-950/60 text-cyan-300', dot: 'bg-cyan-400', label: 'RECOVERING' },
  withdrawn: { badge: 'border-slate-700 bg-slate-900 text-slate-400', dot: 'bg-slate-600', label: 'WITHDRAWN' },
};

function trustColor(t: number): string {
  if (t >= 0.85) return 'bg-emerald-500';
  if (t >= 0.55) return 'bg-amber-500';
  if (t >= 0.25) return 'bg-orange-500';
  return 'bg-red-500';
}

function trustText(t: number): string {
  if (t >= 0.85) return 'text-emerald-300';
  if (t >= 0.55) return 'text-amber-300';
  if (t >= 0.25) return 'text-orange-300';
  return 'text-red-400';
}

function FeatureRow({ name, value }: { name: string; value: number }) {
  const norm = Math.min(1, Math.max(0, value / 25));
  return (
    <div className="flex items-center gap-2">
      <span className="w-40 shrink-0 text-[10px] font-mono text-slate-500 truncate">{name}</span>
      <div className="flex-1 h-1.5 rounded bg-slate-800 overflow-hidden">
        <div
          className={`h-full rounded transition-all ${norm > 0.6 ? 'bg-red-500/80' : norm > 0.35 ? 'bg-amber-500/80' : 'bg-emerald-500/70'}`}
          style={{ width: `${Math.max(3, norm * 100)}%` }}
        />
      </div>
      <span className="w-12 shrink-0 text-right text-[10px] font-mono text-slate-300">{value}</span>
    </div>
  );
}

export function RouteTable({ state }: { state: SimState }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const routes = Object.values(state.routes);

  return (
    <TooltipProvider delayDuration={100}>
      <div className="space-y-2">
        {routes.map((r: RouteSnapshot) => {
          const st = STATUS_STYLE[r.status] ?? STATUS_STYLE.normal;
          const trust = r.trust?.score;
          const isOpen = expanded === r.route.prefix;
          const quarantined = r.underOverride && r.route.locPref === 0;
          return (
            <RouteRow
              key={r.route.prefix}
              r={r}
              st={st}
              trust={trust}
              isOpen={isOpen}
              quarantined={quarantined}
              onToggle={() => setExpanded(isOpen ? null : r.route.prefix)}
              rollbackTicks={state.config.rollback.requiredNormalTicks}
              simTime={state.simTime}
            />
          );
        })}
      </div>
    </TooltipProvider>
  );
}

/** route card wrapper that flashes when its status changes (keyed overlay, no effect-state) */
function RouteRow({
  r,
  st,
  trust,
  isOpen,
  quarantined,
  onToggle,
  rollbackTicks,
  simTime,
}: {
  r: RouteSnapshot;
  st: { badge: string; dot: string; label: string };
  trust: number | undefined;
  isOpen: boolean;
  quarantined: boolean;
  onToggle: () => void;
  rollbackTicks: number;
  simTime: number;
}) {
  const flashKey = `${r.status}:${r.route.locPref}`;
  return (
            <div
              className={`relative rounded-lg border transition-colors ${
                quarantined
                  ? 'border-red-800/70 bg-red-950/20'
                  : r.underOverride
                    ? 'border-amber-800/60 bg-amber-950/10'
                    : 'border-slate-800 bg-slate-950/50'
              }`}
            >
              <div key={flashKey} className="pointer-events-none absolute inset-0 rounded-lg status-flash" aria-hidden />
              <button
                className="w-full text-left p-3"
                onClick={onToggle}
                aria-expanded={isOpen}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  {isOpen ? <ChevronDown className="h-3.5 w-3.5 text-slate-500" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-500" />}
                  <span className="font-mono text-sm font-semibold text-slate-100">{r.route.prefix}</span>
                  <Badge variant="outline" className={`text-[9px] h-4.5 px-1.5 ${st.badge}`}>
                    <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1 ${st.dot} ${r.status !== 'normal' ? 'animate-pulse' : ''}`} />
                    {st.label}
                  </Badge>
                  {r.route.active ? (
                    <span className="text-[10px] font-mono text-slate-500">via {r.route.asPath}</span>
                  ) : (
                    <span className="text-[10px] font-mono text-slate-600">withdrawn</span>
                  )}
                  <span className="ml-auto flex items-center gap-2">
                    {quarantined && (
                      <Badge variant="outline" className="text-[9px] h-4 px-1.5 border-red-800 text-red-300 bg-red-950/50">
                        QUARANTINED · LP {r.route.locPref} · {r.route.community ?? 'no-export'}
                      </Badge>
                    )}
                    {r.underOverride && !quarantined && (
                      <Badge variant="outline" className="text-[9px] h-4 px-1.5 border-amber-800 text-amber-300 bg-amber-950/50">
                        LP {r.route.locPref} · OVERRIDE
                      </Badge>
                    )}
                    {trust !== undefined && (
                      <span className={`font-mono text-xs font-semibold ${trustText(trust)}`}>τ {trust.toFixed(2)}</span>
                    )}
                    {r.ml && (
                      <span className="text-[10px] font-mono text-slate-500">{r.ml.className}</span>
                    )}
                  </span>
                </div>

                {/* trust bar */}
                {trust !== undefined && (
                  <div className="mt-2 h-1.5 rounded bg-slate-800 overflow-hidden">
                    <div className={`h-full transition-all duration-500 ${trustColor(trust)}`} style={{ width: `${trust * 100}%` }} />
                  </div>
                )}

                {!isOpen && (
                  <div className="mt-1.5 flex items-center gap-2 text-[10px] font-mono text-slate-500 truncate">
                    {r.underOverride && r.recoveryStreak > 0 && (
                      <span className="text-cyan-400">recovery {r.recoveryStreak}/{rollbackTicks}</span>
                    )}
                    <span className="truncate">{r.policyAction}</span>
                  </div>
                )}
              </button>

              {isOpen && (
                <div className="px-3 pb-3 space-y-3 border-t border-slate-800 pt-2">
                  {/* explainability */}
                  <div>
                    <div className="flex items-center gap-1.5 mb-1">
                      {r.status === 'normal' ? <ShieldCheck className="h-3 w-3 text-emerald-400" /> : <ShieldAlert className="h-3 w-3 text-amber-400" />}
                      <span className="text-[10px] font-semibold tracking-wider text-slate-400">EXPLAINABLE DIAGNOSTICS</span>
                    </div>
                    <ul className="space-y-0.5">
                      {r.reasons.map((reason, i) => (
                        <li key={i} className="text-[11px] font-mono text-slate-400 flex gap-1.5">
                          <span className="text-slate-600">›</span> {reason}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* ML probabilities */}
                  {r.ml && (
                    <div>
                      <span className="text-[10px] font-semibold tracking-wider text-slate-400">
                        ML · {r.ml.model} ({Math.round(r.ml.confidence * 100)}% conf)
                      </span>
                      <div className="mt-1 grid grid-cols-4 gap-1.5">
                        {['Normal', 'Suspicious', 'Leak', 'Hijack'].map((label, i) => {
                          const p = r.ml?.probabilities[i] ?? 0;
                          const tone = ['bg-emerald-500', 'bg-amber-500', 'bg-orange-500', 'bg-red-500'][i];
                          return (
                            <Tooltip key={label}>
                              <TooltipTrigger asChild>
                                <div className="h-8 rounded bg-slate-900 border border-slate-800 overflow-hidden relative flex items-end">
                                  <div className={`absolute bottom-0 left-0 right-0 ${tone} opacity-60`} style={{ height: `${p * 100}%` }} />
                                  <span className="relative z-10 w-full text-center text-[9px] font-mono text-slate-200">
                                    {label.slice(0, 4)} {(p * 100).toFixed(0)}%
                                  </span>
                                </div>
                              </TooltipTrigger>
                              <TooltipContent className="bg-slate-900 border-slate-700 text-[10px] font-mono">
                                P({label}) = {p.toFixed(3)}
                              </TooltipContent>
                            </Tooltip>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* trust indicators */}
                  {r.trust && (
                    <div>
                      <span className="text-[10px] font-semibold tracking-wider text-slate-400">TRUST INDICATORS</span>
                      <div className="mt-1 grid grid-cols-6 gap-1">
                        {Object.entries(r.trust.indicators).map(([k, v]) => (
                          <div key={k} className="rounded bg-slate-900 border border-slate-800 p-1 text-center">
                            <div className="text-[9px] font-mono text-slate-500 uppercase">{k}</div>
                            <div className={`text-[11px] font-mono font-semibold ${trustText(v)}`}>{v.toFixed(2)}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 10-feature vector */}
                  <div>
                    <span className="text-[10px] font-semibold tracking-wider text-slate-400">10-FEATURE BEHAVIORAL VECTOR</span>
                    <div className="mt-1 space-y-1">
                      {r.features.map((v, i) => (
                        <FeatureRow key={FEATURE_NAMES[i]} name={FEATURE_NAMES[i]} value={v} />
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] font-mono text-slate-500">
                    <span>origin AS<span className="text-slate-300 ml-1">{r.route.originAs}</span></span>
                    <span>age<span className="text-slate-300 ml-1">{r.features[7]}s</span></span>
                    <span>route age raw<span className="text-slate-300 ml-1">{Math.round(simTime - r.route.lastUpdateEpoch)}s</span></span>
                  </div>
                </div>
              )}
            </div>
  );
}
