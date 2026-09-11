'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { SimEvent } from '@/lib/bgp-sim/types';

const LEVEL_STYLE: Record<SimEvent['level'], { text: string; prefix: string }> = {
  info: { text: 'text-slate-400', prefix: '·' },
  success: { text: 'text-emerald-300', prefix: '✓' },
  warn: { text: 'text-amber-300', prefix: '!' },
  danger: { text: 'text-red-400', prefix: '✗' },
};

const SOURCE_STYLE: Record<string, string> = {
  system: 'text-slate-500',
  config: 'text-violet-300',
  attack: 'text-red-400',
  detection: 'text-amber-300',
  shadow: 'text-cyan-300',
  policy: 'text-orange-300',
  rollback: 'text-emerald-300',
  metrics: 'text-teal-300',
  rpki: 'text-sky-300',
  heuristic: 'text-lime-300',
};

/** Sources worth their own quick-filter chip (pipeline-critical feeds). */
const FILTER_SOURCES = ['attack', 'detection', 'policy', 'shadow', 'rollback'] as const;

export function EventLog({ events, simTime = 0 }: { events: SimEvent[]; simTime?: number }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const [active, setActive] = useState<Set<string>>(new Set());

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    };
    el.addEventListener('scroll', onScroll);
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    // IMPORTANT: assign scrollTop directly instead of scrollIntoView() —
    // scrollIntoView({ block: 'end' }) scrolls EVERY ancestor (including the
    // window), hijacking the page scroll position on every event update.
    const el = scrollRef.current;
    if (el && stickToBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [events]);

  const visible = useMemo(
    () => (active.size === 0 ? events : events.filter((e) => active.has(e.source))),
    [events, active]
  );

  const toggle = (src: string) => {
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(src)) next.delete(src);
      else next.add(src);
      return next;
    });
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-2 mb-2 shrink-0 flex-wrap">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
        <span className="text-xs font-semibold text-slate-200">Controller Event Stream</span>
        <span className="text-[9px] font-mono text-slate-600">
          {visible.length}/{events.length}
        </span>
        {simTime > 0 && events.length > 0 && (
          <span className="text-[9px] font-mono text-slate-600 tabular-nums" title="sim seconds since the newest event">
            · last {Math.max(0, Math.round(simTime - events[events.length - 1].t))}s ago
          </span>
        )}
        <span className="ml-auto flex items-center gap-1" role="group" aria-label="event source filter">
          {FILTER_SOURCES.map((src) => {
            const on = active.has(src);
            return (
              <button
                key={src}
                onClick={() => toggle(src)}
                aria-pressed={on}
                className={`px-1.5 py-px rounded-full border text-[8.5px] font-mono uppercase leading-relaxed transition-colors ${
                  on
                    ? 'border-slate-600 bg-slate-800 text-slate-200'
                    : 'border-slate-800 bg-transparent text-slate-600 hover:text-slate-400 hover:border-slate-700'
                }`}
                title={on ? `hide ${src} events` : `show only ${src} events (multi-select)`}
              >
                {src}
              </button>
            );
          })}
          {active.size > 0 && (
            <button
              onClick={() => setActive(new Set())}
              className="px-1.5 py-px rounded-full border border-slate-800 text-[8.5px] font-mono text-slate-500 hover:text-slate-300 leading-relaxed"
              title="clear filters"
            >
              clear
            </button>
          )}
        </span>
      </div>
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/80 p-2.5 space-y-1.5 max-h-80 lg:max-h-none scrollbar-thin"
        role="log"
        aria-label="simulation event log"
      >
        {events.length === 0 && <div className="text-[11px] font-mono text-slate-600">awaiting telemetry…</div>}
        {visible.length === 0 && events.length > 0 && (
          <div className="text-[11px] font-mono text-slate-600">
            no events match the selected filters — <button onClick={() => setActive(new Set())} className="text-slate-400 underline underline-offset-2">clear them</button> to see all
          </div>
        )}
        {visible.map((e) => {
          const ls = LEVEL_STYLE[e.level];
          return (
            <div key={e.id} className="font-mono text-[10.5px] leading-relaxed flex gap-1.5 msg-appear">
              <span className="text-slate-600 shrink-0">{e.t.toFixed(0).padStart(4, ' ')}s</span>
              <span className={`shrink-0 ${ls.text}`}>{ls.prefix}</span>
              <span className={`shrink-0 uppercase ${SOURCE_STYLE[e.source] ?? 'text-slate-500'} w-14 truncate`}>{e.source}</span>
              <span className={e.level === 'danger' ? 'text-red-300/90' : e.level === 'success' ? 'text-emerald-300/90' : 'text-slate-300/85'}>{e.message}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
