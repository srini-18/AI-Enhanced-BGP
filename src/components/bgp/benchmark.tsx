'use client';

import React from 'react';
import { RunResult, SimState } from '@/lib/bgp-sim/types';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { CheckCircle2, XCircle, MinusCircle, Trophy } from 'lucide-react';

function phaseBadge(phase: RunResult['phase']) {
  const map: Record<string, string> = {
    injected: 'border-slate-700 text-slate-400',
    detected: 'border-amber-800 text-amber-300 bg-amber-950/40',
    mitigated: 'border-orange-800 text-orange-300 bg-orange-950/40',
    rolledback: 'border-emerald-800 text-emerald-300 bg-emerald-950/40',
    failed: 'border-red-900 text-red-400 bg-red-950/40',
  };
  return map[phase] ?? 'border-slate-700 text-slate-400';
}

function ComparisonCell({ d }: { d: { detected: boolean; mttd: number | null; mitigated: boolean } | undefined }) {
  if (!d) return <span className="text-slate-700">—</span>;
  if (!d.detected) {
    return (
      <span className="inline-flex items-center gap-1 text-red-400 font-mono text-[10px]">
        <XCircle className="h-3 w-3" /> blind
      </span>
    );
  }
  return (
    <span className={`inline-flex items-center gap-1 font-mono text-[10px] ${d.mitigated ? 'text-emerald-400' : 'text-amber-400'}`}>
      <CheckCircle2 className="h-3 w-3" /> {d.mttd !== null ? `${d.mttd}s` : 'n/a'}
    </span>
  );
}

export function BenchmarkPanel({ state }: { state: SimState }) {
  const history = state.history;
  const active = state.activeRun;

  // aggregate per scenario across runs
  const agg = new Map<string, { runs: number; detected: number; msr: number; mttds: number[]; mttms: number[] }>();
  const collect = (r: RunResult) => {
    if (!agg.has(r.scenarioId)) agg.set(r.scenarioId, { runs: 0, detected: 0, msr: 0, mttds: [], mttms: [] });
    const a = agg.get(r.scenarioId)!;
    a.runs += 1;
    if (r.detectedAt !== null) a.detected += 1;
    if (r.msr) a.msr += 1;
    if (r.mttd !== null) a.mttds.push(r.mttd);
    if (r.mttm !== null) a.mttms.push(r.mttm);
  };
  history.forEach(collect);
  if (active) collect(active);

  const scenarioIds = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'CX'];

  return (
    <div className="space-y-4">
      {/* 4-way comparison matrix (live + aggregated) */}
      <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Trophy className="h-4 w-4 text-amber-400" />
            <span className="text-xs font-semibold text-slate-200">4-Way Comparative Defense Matrix</span>
          </div>
          <span className="text-[10px] font-mono text-slate-600">aggregated across {history.length + (active ? 1 : 0)} runs</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[10.5px] font-mono">
            <thead>
              <tr className="text-slate-500 border-b border-slate-800">
                <th className="text-left py-1.5 pr-2 font-medium">Scenario</th>
                <th className="text-center py-1.5 px-2 font-medium">Standard BGP</th>
                <th className="text-center py-1.5 px-2 font-medium">RPKI ROV</th>
                <th className="text-center py-1.5 px-2 font-medium">Heuristics</th>
                <th className="text-center py-1.5 px-2 font-medium text-emerald-400">AI Control Plane</th>
                <th className="text-center py-1.5 px-2 font-medium">MSR</th>
              </tr>
            </thead>
            <tbody>
              {scenarioIds.map((sid) => {
                const a = agg.get(sid);
                if (!a) return null;
                const runs = history.filter((r) => r.scenarioId === sid);
                const active4 = active?.scenarioId === sid ? active : null;
                const sample = active4 ?? runs[runs.length - 1];
                if (!sample) return null;
                const msrPct = a.runs ? Math.round((a.msr / a.runs) * 100) : 0;
                const avgMttd = a.mttds.length ? (a.mttds.reduce((x, y) => x + y, 0) / a.mttds.length).toFixed(1) : '—';
                return (
                  <tr key={sid} className="border-b border-slate-900 hover:bg-slate-900/40">
                    <td className="py-1.5 pr-2 text-slate-300">
                      <span className="text-slate-100">{sid}</span>
                      <span className="text-slate-600 ml-1.5">{sample.scenarioName.replace(sid + ': ', '')}</span>
                    </td>
                    <td className="text-center py-1.5 px-2"><ComparisonCell d={sample.comparison.standardBgp} /></td>
                    <td className="text-center py-1.5 px-2"><ComparisonCell d={sample.comparison.rpki} /></td>
                    <td className="text-center py-1.5 px-2"><ComparisonCell d={sample.comparison.heuristic} /></td>
                    <td className="text-center py-1.5 px-2"><ComparisonCell d={sample.comparison.aiControl} /></td>
                    <td className="text-center py-1.5 px-2">
                      <span className={msrPct >= 80 ? 'text-emerald-400' : msrPct >= 40 ? 'text-amber-400' : 'text-red-400'}>
                        {msrPct}% ({a.runs})
                      </span>
                    </td>
                  </tr>
                );
              })}
              {agg.size === 0 && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-slate-600">
                    <MinusCircle className="h-4 w-4 mx-auto mb-1.5" />
                    no runs recorded yet — inject attack scenarios from the Control Room
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {agg.size > 0 && (
          <div className="mt-2 flex items-center gap-2 text-[10px] font-mono text-slate-500">
            <span>avg MTTD (AI):</span>
            {Array.from(agg.entries())
              .filter(([sid]) => sid !== 'CX')
              .map(([sid, a]) => (
                <span key={sid}>
                  {sid}={a.mttds.length ? (a.mttds.reduce((x, y) => x + y, 0) / a.mttds.length).toFixed(1) : '—'}s
                </span>
              ))}
          </div>
        )}
      </div>

      {/* run history */}
      <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
        <span className="text-xs font-semibold text-slate-200">Run History (latest 14)</span>
        <ScrollArea className="mt-2 max-h-72 overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-slate-800 hover:bg-transparent">
                <TableHead className="text-[10px] font-mono text-slate-500 h-8">#</TableHead>
                <TableHead className="text-[10px] font-mono text-slate-500">Scenario</TableHead>
                <TableHead className="text-[10px] font-mono text-slate-500">Phase</TableHead>
                <TableHead className="text-[10px] font-mono text-slate-500 text-right">MTTD</TableHead>
                <TableHead className="text-[10px] font-mono text-slate-500 text-right">MTTM</TableHead>
                <TableHead className="text-[10px] font-mono text-slate-500">Policy</TableHead>
                <TableHead className="text-[10px] font-mono text-slate-500 text-center">RIB</TableHead>
                <TableHead className="text-[10px] font-mono text-slate-500 text-center">MSR</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.map((r) => (
                <TableRow key={r.runId} className="border-slate-900">
                  <TableCell className="text-[10px] font-mono text-slate-500 py-1.5">{r.runId}</TableCell>
                  <TableCell className="text-[10px] font-mono text-slate-300 py-1.5">{r.scenarioId}</TableCell>
                  <TableCell className="py-1.5">
                    <Badge variant="outline" className={`text-[9px] h-4 px-1.5 ${phaseBadge(r.phase)}`}>{r.phase}</Badge>
                  </TableCell>
                  <TableCell className="text-[10px] font-mono text-amber-300 text-right py-1.5">{r.mttd !== null ? `${r.mttd}s` : '—'}</TableCell>
                  <TableCell className="text-[10px] font-mono text-orange-300 text-right py-1.5">{r.mttm !== null ? `${r.mttm}s` : '—'}</TableCell>
                  <TableCell className="text-[9.5px] font-mono text-slate-400 py-1.5 max-w-44 truncate">{r.appliedPolicy || '—'}</TableCell>
                  <TableCell className="text-center py-1.5">
                    {r.ribVerified ? <CheckCircle2 className="h-3 w-3 text-emerald-400 mx-auto" /> : <XCircle className="h-3 w-3 text-slate-600 mx-auto" />}
                  </TableCell>
                  <TableCell className="text-center py-1.5">
                    {r.msr ? <CheckCircle2 className="h-3 w-3 text-emerald-400 mx-auto" /> : <XCircle className="h-3 w-3 text-red-500 mx-auto" />}
                  </TableCell>
                </TableRow>
              ))}
              {history.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-[11px] font-mono text-slate-600 py-6">
                    no completed runs
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </ScrollArea>
      </div>
    </div>
  );
}
