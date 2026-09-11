'use client';

import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { SimState, RouteSnapshot, RunResult } from '@/lib/bgp-sim/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Bot, Send, Trash2, Sparkles, Radio, Zap, ShieldAlert, FlaskConical, Loader2 } from 'lucide-react';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  ts: number;
}

/** Build a compact machine-readable summary of the live sim state for the LLM. */
function buildSimContext(state: SimState, variantLabel: string): string {
  const routes = Object.values(state.routes);
  const routeLines = routes
    .map((r: RouteSnapshot) => {
      const f = r.features;
      return `  ${r.route.prefix}: status=${r.status} lp=${r.route.locPref} origin=AS${r.route.originAs} (baseline AS${r.route.baselineOriginAs}) path="${r.route.asPath}" trust=${r.trust ? r.trust.score.toFixed(2) : 'n/a'} ml=${r.ml ? `${r.ml.className}(${r.ml.confidence.toFixed(2)})` : 'off'} action="${r.policyAction}" override=${r.underOverride}`;
    })
    .join('\n');

  const hist = state.history
    .slice(-8)
    .map(
      (r: RunResult) =>
        `  #${r.runId} ${r.scenarioId} phase=${r.phase} mttd=${r.mttd ?? '-'}s mttm=${r.mttm ?? '-'}s msr=${r.msr ? 'yes' : 'no'} rib=${r.ribVerified ? 'ok' : 'fail'} policy="${r.appliedPolicy}" gt=${r.groundTruth} det=${r.detectedClass ?? '-'}`
    )
    .join('\n');

  const active = state.activeRun
    ? `ACTIVE RUN: #${state.activeRun.runId} ${state.activeRun.scenarioId} (${state.activeRun.scenarioName}) phase=${state.activeRun.phase} injectedAt=${state.activeRun.injectedAt}s mttd=${state.activeRun.mttd ?? '-'}s mttm=${state.activeRun.mttm ?? '-'}s policy="${state.activeRun.appliedPolicy}"`
    : 'ACTIVE RUN: none (baseline steady-state)';

  const c = state.config;
  const events = state.events
    .slice(-12)
    .map((e) => `  t=${e.t}s [${e.source}/${e.level}] ${e.message}`)
    .join('\n');

  return `SIM TIME: t=${state.simTime}s tick=${state.tick} running=${state.running}
DEFENDER: AS${c.global.defenderAs} | VARIANT: ${variantLabel}
SUBSYSTEMS: telemetry=${c.telemetry.enabled} ml=${c.ml.enabled}(${c.ml.mode}/${c.ml.model}, sens ${c.ml.sensitivity}) trust=${c.trust.enabled} shadow=${c.shadow.enabled}(immediate=${c.shadow.immediateQuarantine}) policy=${c.policy.enabled} rib=${c.ribVerification.enabled} rollback=${c.rollback.enabled}
POLICY TIERS: LP ${c.policy.lpNormal}/${c.policy.lpSuspicious}/${c.policy.lpLeak}/${c.policy.lpHijack} @ ${c.policy.thresholds.normal}/${c.policy.thresholds.suspicious}/${c.policy.thresholds.leak}
METRICS: runs=${state.metrics.totalRuns} avgMTTD=${state.metrics.avgMttd ?? '-'}s avgMTTM=${state.metrics.avgMttm ?? '-'}s MSR=${state.metrics.msrPercent}% detection=${state.metrics.detectionRate}%
${active}
ROUTES (${routes.length}):
${routeLines || '  (empty)'}
RECENT RUN HISTORY:
${hist || '  (no completed runs)'}
RECENT EVENTS:
${events}`;
}

const SUGGESTED = [
  {
    icon: Radio,
    label: 'Posture check',
    prompt: 'Analyze the current network posture: summarize route health, trust distribution, and any risks you see right now.',
  },
  {
    icon: ShieldAlert,
    label: 'Why quarantined?',
    prompt: 'Explain why the anomalous route was detected and which policy tier was applied. Walk through the pipeline stages that fired.',
  },
  {
    icon: Zap,
    label: 'Tune MTTD/MSR',
    prompt: 'Given current metrics, which config changes would most improve MTTD and MSR? Suggest concrete slider values and trade-offs.',
  },
  {
    icon: FlaskConical,
    label: 'Ablation read-out',
    prompt: 'Interpret the current defense comparison matrix: what do Standard BGP vs RPKI vs Heuristics vs this AI control plane tell us about the active scenario?',
  },
];

function renderMarkdown(text: string): React.ReactNode {
  // minimal markdown: **bold**, `code`, bullets, headers
  const lines = text.split('\n');
  return lines.map((line, i) => {
    const boldParts = line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
    return (
      <p key={i} className={line.trim() === '' ? 'h-2' : 'leading-relaxed'}>
        {boldParts.map((part, j) => {
          if (part.startsWith('**') && part.endsWith('**')) {
            return (
              <strong key={j} className="text-slate-100 font-semibold">
                {part.slice(2, -2)}
              </strong>
            );
          }
          if (part.startsWith('`') && part.endsWith('`')) {
            return (
              <code key={j} className="px-1 py-0.5 rounded bg-slate-800/80 text-emerald-300 font-mono text-[10.5px]">
                {part.slice(1, -1)}
              </code>
            );
          }
          return <span key={j}>{part}</span>;
        })}
      </p>
    );
  });
}

export function AiAssistantPanel({ state, variantLabel }: { state: SimState; variantLabel: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const simContext = useMemo(() => buildSimContext(state, variantLabel), [state, variantLabel]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, busy]);

  const send = useCallback(
    async (text: string) => {
      const question = text.trim();
      if (!question || busy) return;
      setError(null);
      setInput('');
      const userMsg: ChatMessage = { role: 'user', content: question, ts: Date.now() };
      const history = [...messages, userMsg];
      setMessages(history);
      setBusy(true);
      try {
        const res = await fetch('/api/ai-assistant', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: history.map(({ role, content }) => ({ role, content })),
            simContext,
          }),
        });
        const data = await res.json();
        if (!res.ok || !data.reply) throw new Error(data.error || 'assistant unavailable');
        setMessages((m) => [...m, { role: 'assistant', content: String(data.reply), ts: Date.now() }]);
      } catch (e) {
        setError(String((e as Error).message ?? e));
        setMessages((m) => [...m, { role: 'assistant', content: '⚠️ copilot error — the analysis service did not respond. Try again.', ts: Date.now() }]);
      } finally {
        setBusy(false);
        inputRef.current?.focus();
      }
    },
    [messages, busy, simContext]
  );

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_300px] gap-4 items-start">
      {/* Chat column */}
      <div className="rounded-lg border border-slate-800 bg-slate-950/60 flex flex-col h-[calc(100vh-15rem)] min-h-[420px]">
        <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800 bg-slate-900/50 rounded-t-lg">
          <div className="flex items-center gap-2">
            <div className="relative">
              <Sparkles className="h-4 w-4 text-emerald-400" />
              <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
            </div>
            <span className="text-xs font-semibold text-slate-200">AI Copilot · BGP Analyst</span>
            <Badge variant="outline" className="text-[9px] h-4 px-1.5 border-violet-800 text-violet-300 bg-violet-950/40">
              state-aware
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-slate-600 hidden sm:inline">
              ctx: t={state.simTime.toFixed(0)}s · {Object.keys(state.routes).length} routes · {state.history.length} runs
            </span>
            {messages.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setMessages([]);
                  setError(null);
                }}
                className="h-6 px-2 text-[10px] font-mono border-slate-700 text-slate-400 hover:bg-slate-800"
              >
                <Trash2 className="h-3 w-3 mr-1" /> clear
              </Button>
            )}
          </div>
        </div>

        {/* message stream */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3 scrollbar-thin">
          {messages.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-center px-6">
              <div className="w-12 h-12 rounded-full border border-emerald-900/60 bg-emerald-950/30 flex items-center justify-center">
                <Bot className="h-6 w-6 text-emerald-400" />
              </div>
              <p className="text-sm font-mono text-slate-300">Ask the copilot about your network.</p>
              <p className="text-[11px] font-mono text-slate-500 max-w-md leading-relaxed">
                It sees the live engine state — routes, trust scores, policy actions, run metrics, recent events —
                and answers with operational BGP insight.
              </p>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] rounded-lg px-3 py-2 text-[11.5px] ${
                  m.role === 'user'
                    ? 'bg-emerald-900/40 border border-emerald-800/60 text-slate-100'
                    : 'bg-slate-900/70 border border-slate-800 text-slate-300'
                }`}
              >
                <div className="flex items-center gap-1.5 mb-1 text-[9px] font-mono uppercase tracking-wider opacity-60">
                  {m.role === 'user' ? <span className="text-emerald-400">operator</span> : <Bot className="h-3 w-3 text-violet-400" />}
                  {m.role === 'assistant' && <span className="text-violet-400">copilot</span>}
                </div>
                <div className="font-sans space-y-1">{renderMarkdown(m.content)}</div>
              </div>
            </div>
          ))}
          {busy && (
            <div className="flex justify-start">
              <div className="rounded-lg px-3 py-2 bg-slate-900/70 border border-slate-800 flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-400" />
                <span className="text-[11px] font-mono text-slate-500">analyzing live state…</span>
                <span className="flex gap-1">
                  <span className="w-1 h-1 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1 h-1 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: '120ms' }} />
                  <span className="w-1 h-1 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: '240ms' }} />
                </span>
              </div>
            </div>
          )}
        </div>

        {/* input */}
        <div className="p-2.5 border-t border-slate-800 bg-slate-900/40 rounded-b-lg">
          {error && <p className="text-[10px] font-mono text-red-400 mb-1.5">{error}</p>}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            className="flex gap-2"
          >
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="ask about routes, trust scores, mitigation strategy…"
              className="flex-1 h-9 rounded-md border border-slate-700 bg-slate-950/80 px-3 text-[11.5px] font-mono text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-emerald-700 focus:border-emerald-700"
            />
            <Button
              type="submit"
              size="sm"
              disabled={busy || !input.trim()}
              className="h-9 px-4 font-mono text-xs bg-emerald-600 hover:bg-emerald-500 text-black disabled:opacity-40"
            >
              <Send className="h-3.5 w-3.5" /> ASK
            </Button>
          </form>
        </div>
      </div>

      {/* suggested prompts + context column */}
      <div className="space-y-3">
        <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
          <div className="flex items-center gap-1.5 mb-2">
            <Zap className="h-3.5 w-3.5 text-amber-400" />
            <span className="text-xs font-semibold text-slate-200">Suggested Analyses</span>
          </div>
          <div className="space-y-1.5">
            {SUGGESTED.map((s) => (
              <button
                key={s.label}
                onClick={() => send(s.prompt)}
                disabled={busy}
                className="w-full text-left rounded-md border border-slate-800 bg-slate-900/50 hover:border-emerald-800 hover:bg-emerald-950/20 px-2.5 py-2 transition-colors group disabled:opacity-40"
              >
                <div className="flex items-center gap-1.5 text-[11px] font-mono text-slate-300 group-hover:text-emerald-300">
                  <s.icon className="h-3 w-3" /> {s.label}
                </div>
                <div className="text-[9.5px] text-slate-600 mt-0.5 line-clamp-2 leading-snug">{s.prompt}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
          <div className="flex items-center gap-1.5 mb-2">
            <Radio className="h-3.5 w-3.5 text-cyan-400" />
            <span className="text-xs font-semibold text-slate-200">Copilot Visibility</span>
          </div>
          <div className="text-[10px] font-mono text-slate-500 space-y-1">
            <div className="flex justify-between"><span>sim clock</span><span className="text-slate-300">t={state.simTime.toFixed(0)}s</span></div>
            <div className="flex justify-between"><span>variant</span><span className="text-slate-300">{variantLabel}</span></div>
            <div className="flex justify-between"><span>routes</span><span className="text-slate-300">{Object.keys(state.routes).length}</span></div>
            <div className="flex justify-between"><span>active run</span><span className="text-slate-300">{state.activeRun ? `${state.activeRun.scenarioId} (${state.activeRun.phase})` : 'none'}</span></div>
            <div className="flex justify-between"><span>MSR</span><span className="text-slate-300">{state.metrics.msrPercent}%</span></div>
            <div className="flex justify-between"><span>events shared</span><span className="text-slate-300">last 12</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}
