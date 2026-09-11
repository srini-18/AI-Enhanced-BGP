# Worklog - AI-Enhanced BGP Simulation Web App

Project: Web simulation of https://github.com/Sudalai-kumar/AI-Enhanced-BGP
Goal: Full-featured simulation web app where every subsystem can be enabled/disabled and edited.

---
Task ID: 1
Agent: main
Task: Analyze repo, initialize project

Work Log:
- Cloned and analyzed AI-Enhanced-BGP repo (10-AS BGP topology, ML anomaly detection, trust engine, shadow validation, policy engine, rollback, S1-S6 attack scenarios, A0-A4 ablation variants)
- Key repo concepts to simulate:
  - 10-AS topology: as65001 (Core Defender/Tier1), as65002 (Tier1), as65003 (Edge Defender/Regional), as65004-65006 (Regional), as65007-65009 (Stubs), as65010 (Rogue)
  - 10 features: as_path_len, as_path_edit_distance, origin_as_change, prefix_mask_len, announcements_per_minute, flap_count_5min, loc_pref_current, route_age_seconds, valley_free_violation, neighbor_diversity
  - 4 classes: Normal(0), Suspicious(1), Route Leak(2), Prefix Hijack(3)
  - Trust engine weights: origin 0.20, path 0.20, flap 0.15, prefix 0.15, peer 0.10, ml 0.20
  - Policy tiers: >=0.85 LP100, 0.55-0.80 LP80, 0.25-0.55 LP50, <0.25 LP0 + no-export
  - Shadow validation: streak-based, immediate quarantine for hijacks, dwell time
  - Rollback: 3 consecutive normal ticks -> LP 100
  - Scenarios S1-S6 (direct hijack, subprefix /25, flapping, YouTube 2008, Google 2017 leak, Cloudflare 2019 leak)
  - Ablation variants A0-A4 (Standard BGP, +Heuristic, +ML, +ML+Trust, Full system)
  - Metrics: MTTD, MTTM, MSR (mitigation success rate), RIB verification
- Architecture plan:
  - mini-services/bgp-sim (port 3010): Bun + socket.io simulation engine
  - Next.js frontend (port 3000): dark NOC-style UI, topology SVG graph, control center with toggles/sliders, attack panel, dashboard, event log, recharts analytics, benchmark table
  - Prisma: SimConfig presets + RunRecord persistence, API routes

Stage Summary:
- Repo analysis complete; architecture defined; starting backend build

---
Task ID: 2
Agent: main
Task: Build bgp-sim backend mini-service (port 3010)

Work Log:
- Created mini-services/bgp-sim with Bun + socket.io (path '/', port 3010)
- src/types.ts: full contract (SimConfig with every subsystem toggle+params, SimState, RunResult, 6 scenarios S1-S6, DEFAULT_CONFIG)
- src/topology.ts: 10-AS node layout, Gao-Rexford relationships, prefix baselines, valley-free check, levenshtein
- src/classifier.ts: simulated Random Forest (decisive tree votes) + Logistic Regression (linear), sensitivity param, heuristic + RPKI comparison detectors
- src/engine.ts: tick engine — telemetry, 10-feature extraction, ML classify, trust scoring, shadow validation (streak+duration+dwell+immediate quarantine), policy tiers w/ hysteresis, RIB verification (latency+failure+retry), rollback (multi-criteria streak), attack lifecycle (auto-withdraw, flapping, best-path competition), comparison defenses, metrics, event log
- index.ts: socket API (sim:start/pause/reset/tick, config:update/preset/reset, attack:inject/custom/withdraw, scenarios:list)
- Fixed bugs during testing: valley-free split() bug, classifier softmax calibration, rollback-after-withdrawal run lifecycle, mid-flap pipeline continuation
- Verified via smoke tests: S1 quarantine+rollback, S2/S4 quarantine, S3 LP80 dampening, S5/S6 LP50, RPKI blind to sub-prefix, RIB verify flow

Stage Summary:
- Backend engine fully working on port 3010; all scenario tiers match repo's design

---
Task ID: 3-7
Agent: main
Task: Frontend, persistence, QA, and cron setup

Work Log:
- src/lib/bgp-sim/types.ts: shared contract (synced with engine)
- src/lib/bgp-sim/client.ts: shared socket.io client (io('/?XTransformPort=3010')), React hook useBgpSim with actions
- src/components/bgp/topology-graph.tsx: SVG 10-AS map, role colors, anomalous/quarantined edge animation, defender ring, tooltips
- src/components/bgp/control-center.tsx: ALL subsystem toggles + editable params (global clock/defender/telemetry noise, ML detector mode+model+sensitivity, 6 trust weight sliders, shadow duration/ticks/dwell/immediate-quarantine, policy LP values+thresholds+community+hysteresis, rollback ticks, RIB failure rate/latency, comparison defenses), A0-A4 ablation presets, operator preset save/load/delete (Prisma)
- src/components/bgp/attack-panel.tsx: S1-S6 scenario cards + custom anomaly builder (prefix/origin/path/duration/flapping)
- src/components/bgp/route-table.tsx: live RIB with trust bars, status badges, expandable diagnostics (reasons, ML probabilities, trust indicators, 10-feature vector)
- src/components/bgp/event-log.tsx: auto-scrolling live event stream
- src/components/bgp/analytics.tsx: metric cards (MTTD/MTTM/MSR/detection), per-prefix trust line chart, per-run MTTD/MTTM bar chart (recharts)
- src/components/bgp/benchmark.tsx: 4-way defense matrix + run history table
- src/app/page.tsx: dark NOC-style layout — header (pipeline strip, clock, run/pause/reset, active-run strip), 4 tabs (Control Room 3-column, Analytics, Benchmark, Architecture docs), sticky footer
- prisma/schema.prisma: SimConfigPreset + SimRunRecord (db pushed)
- API: /api/sim-presets (GET/POST/DELETE), /api/sim-runs (GET/POST)
- Fixed: react-hooks lint errors, mobile tab overflow (390px), dormant prefix pipeline leak
- QA via agent-browser (through gateway :81): page renders, socket LINK, S2 inject→detect(MTTD 5s)→quarantine(LP0+no-export)→RIB verify→MTTM 10s→auto-withdraw; S5 leak→LP50 override shown in route table; shadow toggle + ML toggle + A0/A4 presets verified in pipeline strip; preset save/load persisted via API; mobile no-overflow; VLM visual checks passed; no console errors
- Cron job created: 'BGP Sim Web Dev Review' every 15 min (fixed_rate 900s, webDevReview kind, job_id 376285)

Stage Summary:
- Full app working E2E; lint clean; both services running (3000 + 3010)
- Verified golden paths: attack lifecycle, config toggling, presets, analytics, benchmark, responsive layout

Unresolved issues / risks:
- sim-runs API exists but frontend doesn't yet sync run history to DB automatically (next phase candidate)
- Possible next-phase features: AI assistant chat (z-ai-web-dev-sdk LLM) analyzing sim state, auto-benchmark runner (S1-S6 sequential), RIB verification log viewer, route-map config preview, export run history CSV, keyboard shortcuts
- Watch for: engine hot-reload restarts state when engine.ts is edited (expected dev behavior)
