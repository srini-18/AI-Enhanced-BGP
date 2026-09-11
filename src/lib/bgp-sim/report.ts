/**
 * Standalone HTML run-report generator (client-side, no dependencies).
 * Builds a self-contained dark NOC-styled document summarizing the run archive.
 */

export interface ReportRun {
  runId: number;
  scenarioId: string;
  scenarioName: string;
  variantLabel: string | null;
  mttd: number | null;
  mttm: number | null;
  msr: boolean;
  ribVerified: boolean;
  appliedPolicy: string;
  phase: string;
  createdAt: string;
  comparison?: Record<string, { detected: boolean; mttd: number | null; mitigated: boolean }> | null;
}

function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const PHASE_TONE: Record<string, string> = {
  rolledback: '#34d399',
  mitigated: '#22d3ee',
  detected: '#fbbf24',
  injected: '#94a3b8',
  failed: '#f87171',
};

const DEFENSE_LABELS: [string, string][] = [
  ['standardBgp', 'Standard BGP'],
  ['rpki', 'RPKI ROV'],
  ['heuristic', 'Heuristics'],
  ['aiControl', 'AI Control Plane'],
];

function defenseCell(d?: { detected: boolean; mttd: number | null; mitigated: boolean }): string {
  if (!d) return '<td class="c dim">—</td>';
  if (!d.detected) return '<td class="c bad">blind</td>';
  const tone = d.mitigated ? 'ok' : 'mid';
  return `<td class="c ${tone}">${d.mttd !== null ? `${d.mttd}s` : 'n/a'}</td>`;
}

export function buildRunReportHtml(runs: ReportRun[]): string {
  const now = new Date();
  const total = runs.length;
  const mitigated = runs.filter((r) => r.msr).length;
  const msrPct = total ? Math.round((mitigated / total) * 100) : 0;
  const mttds = runs.filter((r) => r.mttd !== null).map((r) => r.mttd as number);
  const mttms = runs.filter((r) => r.mttm !== null).map((r) => r.mttm as number);
  const avg = (xs: number[]) => (xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1) + 's' : '—');
  const ribOk = runs.filter((r) => r.ribVerified).length;
  const ribPct = total ? Math.round((ribOk / total) * 100) : 0;

  // per-scenario aggregation
  const byScenario = new Map<
    string,
    { name: string; runs: number; msr: number; mttds: number[]; mttms: number[]; sample: ReportRun }
  >();
  for (const r of runs) {
    let s = byScenario.get(r.scenarioId);
    if (!s) {
      s = { name: r.scenarioName, runs: 0, msr: 0, mttds: [], mttms: [], sample: r };
      byScenario.set(r.scenarioId, s);
    }
    s.runs += 1;
    if (r.msr) s.msr += 1;
    if (r.mttd !== null) s.mttds.push(r.mttd);
    if (r.mttm !== null) s.mttms.push(r.mttm);
  }

  const kpi = (label: string, value: string, tone: string) => `
    <div class="kpi"><div class="kpi-v" style="color:${tone}">${esc(value)}</div><div class="kpi-l">${esc(label)}</div></div>`;

  const scenarioRows = Array.from(byScenario.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([sid, s]) => {
      const msrP = Math.round((s.msr / s.runs) * 100);
      return `
      <tr>
        <td><b>${esc(sid)}</b> <span class="dim">${esc(s.name.replace(sid + ': ', ''))}</span></td>
        <td class="c">${s.runs}</td>
        <td class="c" style="color:${msrP >= 80 ? '#34d399' : msrP >= 40 ? '#fbbf24' : '#f87171'}">${msrP}%</td>
        <td class="c">${s.mttds.length ? avg(s.mttds) : '—'}</td>
        <td class="c">${s.mttms.length ? avg(s.mttms) : '—'}</td>
      </tr>`;
    })
    .join('');

  const latestByScenario = new Map<string, ReportRun>();
  for (const r of runs) latestByScenario.set(r.scenarioId, r);
  const defenseRows = Array.from(latestByScenario.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([sid, r]) => {
      const cmp = r.comparison ?? {};
      return `
      <tr>
        <td><b>${esc(sid)}</b></td>
        ${DEFENSE_LABELS.map(([key]) => defenseCell(cmp[key])).join('')}
      </tr>`;
    })
    .join('');

  const runRows = runs
    .slice()
    .reverse()
    .map((r) => {
      const tone = PHASE_TONE[r.phase] ?? '#94a3b8';
      return `
      <tr>
        <td>${new Date(r.createdAt).toISOString().replace('T', ' ').slice(0, 19)}</td>
        <td class="c">${r.runId}</td>
        <td><b>${esc(r.scenarioId)}</b></td>
        <td><span class="pill" style="color:${tone};border-color:${tone}55">${esc(r.phase)}</span></td>
        <td class="c">${esc(r.variantLabel ?? 'custom')}</td>
        <td class="c">${r.mttd !== null ? r.mttd + 's' : '—'}</td>
        <td class="c">${r.mttm !== null ? r.mttm + 's' : '—'}</td>
        <td class="c" style="color:${r.ribVerified ? '#34d399' : '#f87171'}">${r.ribVerified ? '✓' : '✗'}</td>
        <td class="c" style="color:${r.msr ? '#34d399' : '#f87171'}">${r.msr ? '✓' : '✗'}</td>
        <td>${esc(r.appliedPolicy || '—')}</td>
      </tr>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>BGP Simulation Run Report · ${now.toISOString().slice(0, 19)}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #020617; color: #e2e8f0; font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace; font-size: 12px; }
  .wrap { max-width: 1060px; margin: 0 auto; padding: 32px 20px 60px; }
  header { border: 1px solid #1e293b; border-radius: 10px; padding: 18px 20px; background: linear-gradient(135deg, #0f172a, #020617); margin-bottom: 20px; }
  h1 { margin: 0 0 4px; font-size: 17px; letter-spacing: 0.02em; }
  h1 .accent { color: #34d399; }
  .sub { color: #64748b; font-size: 10.5px; }
  .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin: 20px 0 26px; }
  .kpi { border: 1px solid #1e293b; border-radius: 8px; background: #0f172a; padding: 12px 14px; }
  .kpi-v { font-size: 20px; font-weight: 700; }
  .kpi-l { color: #64748b; font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.08em; margin-top: 3px; }
  h2 { font-size: 12.5px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.1em; margin: 26px 0 10px; border-bottom: 1px solid #1e293b; padding-bottom: 6px; }
  table { width: 100%; border-collapse: collapse; border: 1px solid #1e293b; border-radius: 8px; overflow: hidden; }
  th { background: #0f172a; color: #64748b; font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.06em; text-align: left; padding: 7px 10px; }
  td { padding: 6px 10px; border-top: 1px solid #0f172a; color: #cbd5e1; }
  tr:hover td { background: #0f172a80; }
  .c { text-align: center; }
  .dim { color: #475569; }
  .ok { color: #34d399; } .mid { color: #fbbf24; } .bad { color: #f87171; }
  .pill { display: inline-block; border: 1px solid; border-radius: 999px; padding: 1px 8px; font-size: 10px; }
  footer { margin-top: 30px; color: #475569; font-size: 9.5px; line-height: 1.7; }
  @media print { body { background: #fff; color: #111; } .kpi, table, header { border-color: #ccc; } }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>AI-Enhanced BGP Autonomous Control Plane · <span class="accent">Run Report</span></h1>
    <div class="sub">Generated ${esc(now.toISOString().replace('T', ' ').slice(0, 19))} UTC · ${total} archived runs · telemetry→features→ML→trust→shadow→policy→RIB→rollback pipeline · LocalPref 100/80/50/0 + no-export · Gao-Rexford · RFC 1997/6811/9234</div>
  </header>

  <div class="kpis">
    ${kpi('total runs', String(total), '#e2e8f0')}
    ${kpi('MSR', msrPct + '%', msrPct >= 80 ? '#34d399' : msrPct >= 40 ? '#fbbf24' : '#f87171')}
    ${kpi('avg MTTD', avg(mttds), '#fbbf24')}
    ${kpi('avg MTTM', avg(mttms), '#fb923c')}
    ${kpi('RIB verified', ribPct + '%', '#22d3ee')}
  </div>

  <h2>Per-Scenario Aggregates</h2>
  <table>
    <thead><tr><th>Scenario</th><th class="c">Runs</th><th class="c">MSR</th><th class="c">Avg MTTD</th><th class="c">Avg MTTM</th></tr></thead>
    <tbody>${scenarioRows || '<tr><td colspan="5" class="c dim">no runs</td></tr>'}</tbody>
  </table>

  <h2>Defense Comparison (latest run per scenario)</h2>
  <table>
    <thead><tr><th>Scenario</th>${DEFENSE_LABELS.map(([, l]) => `<th class="c">${esc(l)}</th>`).join('')}</tr></thead>
    <tbody>${defenseRows || '<tr><td colspan="5" class="c dim">no runs</td></tr>'}</tbody>
  </table>

  <h2>Full Run Log (${total} records, newest first)</h2>
  <table>
    <thead><tr><th>Timestamp</th><th class="c">#</th><th class="c">Scenario</th><th class="c">Phase</th><th class="c">Variant</th><th class="c">MTTD</th><th class="c">MTTM</th><th class="c">RIB</th><th class="c">MSR</th><th>Policy</th></tr></thead>
    <tbody>${runRows || '<tr><td colspan="10" class="c dim">archive empty</td></tr>'}</tbody>
  </table>

  <footer>
    Generated by the BGP simulation web app (AI-Enhanced-BGP replica) · Standard BGP is origin-blind ·
    RPKI ROV validates origin only (blind to sub-prefix hijacks of unregistered space) ·
    Heuristics use fixed rules · AI Control Plane = ML + 6-factor trust + shadow validation + tiered policy + RIB verification + autonomous rollback.
  </footer>
</div>
</body>
</html>`;
}

export function downloadHtmlReport(runs: ReportRun[]): string {
  const html = buildRunReportHtml(runs);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  a.download = `bgp-run-report-${stamp}.html`;
  a.click();
  URL.revokeObjectURL(url);
  return stamp;
}
