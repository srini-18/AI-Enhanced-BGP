'use client';

import React, { useEffect, useRef } from 'react';
import { SimEvent } from '@/lib/bgp-sim/types';
import { ScrollArea } from '@/components/ui/scroll-area';

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

export function EventLog({ events }: { events: SimEvent[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

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
    if (stickToBottom.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [events]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-2 mb-2 shrink-0">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
        <span className="text-xs font-semibold text-slate-200">Controller Event Stream</span>
      </div>
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/80 p-2.5 space-y-1.5 max-h-80 lg:max-h-none scrollbar-thin"
        role="log"
        aria-label="simulation event log"
      >
        {events.length === 0 && <div className="text-[11px] font-mono text-slate-600">awaiting telemetry…</div>}
        {events.map((e) => {
          const ls = LEVEL_STYLE[e.level];
          return (
            <div key={e.id} className="font-mono text-[10.5px] leading-relaxed flex gap-1.5">
              <span className="text-slate-600 shrink-0">{e.t.toFixed(0).padStart(4, ' ')}s</span>
              <span className={`shrink-0 ${ls.text}`}>{ls.prefix}</span>
              <span className={`shrink-0 uppercase ${SOURCE_STYLE[e.source] ?? 'text-slate-500'} w-14 truncate`}>{e.source}</span>
              <span className={e.level === 'danger' ? 'text-red-300/90' : e.level === 'success' ? 'text-emerald-300/90' : 'text-slate-300/85'}>{e.message}</span>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
