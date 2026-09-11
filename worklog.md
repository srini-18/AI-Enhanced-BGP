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

---
Task ID: 8
Agent: main
Task: QA round + new features (AI Copilot, auto-benchmark sweep, engine-side run persistence, CSV export, keyboard shortcuts) + styling polish

Work Log:
- QA pass via agent-browser (through gateway :81):
  - Verified full attack lifecycle E2E: S2 inject → detect (MTTD 5s) → quarantine LP0+no-export → RIB verify → MTTM 10s → withdraw → rollback
  - All 5 tabs render, no console errors, mobile 390px no horizontal overflow, VLM visual checks passed
  - Discovered the concurrent cron review job (job 376285) actively tests the app every 15 min — it pauses/injects/resets mid-test (environmental interference, not a bug; sweep runner made robust against it)
- NEW: AI Copilot tab (/api/ai-assistant, z-ai-web-dev-sdk LLM backend-only)
  - POST /api/ai-assistant/route.ts with BGP domain system prompt + machine-generated live state context (routes, trust, ML, policy actions, metrics, last 12 events)
  - src/components/bgp/ai-assistant.tsx: chat UI with markdown rendering, 4 suggested analysis prompts, copilot visibility panel, loading state
  - Verified: copilot correctly cited live state (quarantined 192.0.2.0/24 LP0, healthy routes LP100/trust 0.98, metrics, active S2)
- NEW: Auto-Benchmark Sweep (src/components/bgp/auto-benchmark.tsx)
  - Sequencer: injects S1→S6, waits for terminal phase (rolledback/failed) per scenario, 1.5s settle gap, abort button, progress bar + per-scenario chips
  - Robust against interference: auto-resumes paused sim, re-injects lost attacks (grace period), detects engine resets (history shrink), archived-run detection, 150s timeout watchdog
  - Verified: full sweep completed 6/6 mitigated (~2.5 min), all runs recorded
- NEW: Engine-side run persistence (single-writer dedup fix)
  - Problem found: client-side sync in page.tsx duplicated runs when multiple browsers attached (reviewer + operator both POSTed same runs)
  - Fix: engine (mini-services/bgp-sim) now POSTs each finalized run to localhost:3000/api/sim-runs itself (fire-and-forget with retry-on-failure via dedupe set); bootId disambiguates across engine restarts
  - Engine now tracks variantLabel server-side ('A{n} preset' | 'custom' | 'A4 · Full System') exposed in SimState; config:reset uses new engine.resetConfig()
  - Removed client-side persistence effect from page.tsx; header badge + copilot context read state.variantLabel
- NEW: Run Archive (SQLite) section in Benchmark tab: persisted records table (timestamp/scenario/variant/phase/MTTD/MTTM/MSR), refresh button, CSV export download
- NEW: Keyboard shortcuts: Space (run/pause), R (reset), 1-5 (tabs), ? (help overlay modal)
- Styling polish:
  - PhaseSteps component in active-run header strip (injected→detected→mitigated→rolledback progress pills with animation)
  - Metric cards: gradient accent bar + card-lift hover + tabular-nums
  - Pipeline strip: pulsing arrows when running
  - Tab icons + violet AI COPILOT tab styling with live dot
  - Custom global scrollbars (thin dark theme), NOC grid background texture, gradient header, shortcut kbd styling
  - globals.css: scrollbar-none/scrollbar-thin utilities, glow-dot, card-lift, noc-grid-bg
- Fixed: lint errors (setState-in-effect → interval-callback pattern with latest-value refs; ref-during-render → effect sync)
- Final verification: lint clean, both services healthy (3000 + 3010), engine persistence writing single records with correct variant labels, no console errors, mobile OK

Stage Summary:
- App now has 5 tabs: CONTROL ROOM / ANALYTICS / BENCHMARK (+sweep+archive+CSV) / AI COPILOT (LLM) / ARCHITECTURE
- Run persistence: engine is the single writer → SQLite archive with variant labels, no duplicates
- All 3 top next-phase candidates from previous round implemented (AI assistant, auto-benchmark, CSV export + run sync)

Unresolved issues / risks:
- The cron review job's concurrent interactions can reset/inject mid-operator-test (by design; sweep is robust, manual tests can be interrupted — consider pausing the cron job if clean manual QA is needed)
- Engine hot-reload (bun --hot) resets sim state on engine file edits — expected dev behavior
- variantLabel shows 'custom' whenever any slider is touched (even if re-touched to default) — cosmetic, could compare against DEFAULT_CONFIG to detect "equivalent to A4"
- Next-phase candidates: RIB verification log viewer, route-map config preview/export (FRR-style route-map text), per-scenario deep-dive analytics, light/dark theme toggle, copilot streaming responses
