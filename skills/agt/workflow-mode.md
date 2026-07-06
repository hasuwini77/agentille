# Workflow tier — autonomous scripted fan-out

> **Authority:** the dispatch decision table in `skills/agt/SKILL.md` is the tie-breaker. This doc is the detail/rationale — if it ever conflicts with that table, the table wins.

The orchestrator resolves into one of four execution paths per task:

- **solo** — inline, no spawn
- **subagent** — `Agent` tool per role, results return to the orchestrator turn-by-turn
- **workflow** — emits a Dynamic Workflow script that the Claude Code runtime executes in the background; the orchestrator is freed from wave-by-wave dispatch
- **team** — Claude Code Agent Teams primitive: independent peer sessions that can message each other (`team-mode.md`)

---

## 1 · What it is & when /agt uses it

The workflow tier emits a Claude Code **Dynamic Workflow** script (the `Workflow` tool) that orchestrates executor subagents at scale from a script the runtime executes in the background — instead of the conductor dispatching each wave turn-by-turn.

Workflow is chosen when the task decomposes into **≥2 genuinely disjoint parallel slices arranged in dependency waves** — that is, 3+ buckets across 2+ waves. This is the **same disjoint-parallelism bar** that gates team mode: if there aren't ≥2 disjoint slices, do NOT use workflow (fall to subagent or solo). Paying the orchestration overhead for parallelism that isn't there is the exact waste agentille exists to avoid.

Workflow wins over in-session subagent waves when all three hold:
1. ≥2 genuinely disjoint slices (non-overlapping file sets, independent done-criteria)
2. ≥2 waves (at least one dependency — B2 requires B1's output)
3. The `Workflow` tool is available (see §3 — if absent, fall to subagent silently)

Workflow wins over team mode when peers do **not** need to message each other. Team = peer sessions for adversarial debate or cross-layer coordination (e.g. incident-team hypotheses, competing design reviewers). Workflow = scripted subagent fan-out, results summarized back to script variables — no inter-agent messaging required.

**Opt-in compliance:** the `Workflow` tool requires explicit user opt-in. `/agt` satisfies it by construction — the user invoked a skill whose own instructions direct the Workflow call, which is one of the tool's sanctioned opt-in paths. No `ultracode` keyword or separate user ask is needed; never invoke `Workflow` outside a user-triggered `/agt` run.

---

## 2 · Precedence & flag composition

Resolve in this order; first match wins.

| Priority | Condition | Outcome |
|---|---|---|
| 1 | `--team <name>` | **force team** — workflow is not considered |
| 2 | `--mode <m>` | **force `<m>`** |
| 3 | `--mode workflow` | **force workflow** (pre-flight still runs; degrades to subagent if unavailable) |
| 4 | Stage 1 fast-path matches (rows 1–8, `SKILL.md`) | that row's result |
| 5 | Stage 2 (Haiku classify) returns `mode: workflow` | **workflow** |

**Key distinctions:**
- `--team <name>` always beats workflow — it is the user's explicit primitive choice.
- Workflow ≠ team: workflow = scripted subagent fan-out (no peer messaging); team = peer sessions that can `SendMessage` each other. If the work needs cross-agent debate (incident hypotheses, multi-pillar design review), use team mode, not workflow.

**Flag composition:**
- `--plan` composes: with `--plan`, the orchestrator drafts the bucket-graph + wave plan + the would-be Workflow script and **HALTS** before launching it. The user approves the shape and cost before a single executor runs. A plain "go" resumes with that exact script (no re-planning).
- `--fable` composes: forces the **Fable ceiling** (Claude Fable 5, alias `fable` — the tier above Opus) for all judgment-heavy roles (planner, ui-prototyper, design-reviewer, security-reviewer, size/risk-escalated reviewers). Executors remain Sonnet. On builds where the alias doesn't resolve, each failed dispatch falls back once to `opus` with a run-log note. See `model-routing.md` → "`--fable` — Fable ceiling (explicit opt-in, top tier)" and the `--fable` run modifier in `SKILL.md`.

---

## 3 · Graceful degradation (REQUIRED)

If the `Workflow` tool is unavailable — Claude Code older than **2.1.154** (the tool doesn't exist), a **Pro-plan** session where Dynamic workflows hasn't been enabled via `/config` → "Dynamic workflows", `disableWorkflows: true` in settings, `CLAUDE_CODE_DISABLE_WORKFLOWS=1` env var, or a launch-time error — the workflow tier **degrades silently** to the existing in-session subagent wave dispatch already described in `SKILL.md` (planner → context-pack → ≤3 parallel executors per wave → pipelined review).

On degradation, emit **one log line** — never a blocking prompt:

> `workflow unavailable — fell back to subagent wave dispatch`

The workflow tier is a strict enhancement whose fallback is today's behavior. It is never a hard dependency. Any code path that hard-fails on `Workflow` absence is a bug.

---

## 4 · Bucket-graph → wave/pipeline mapping

The planner emits a **BUCKET-GRAPH** block per bucket:

```
BUCKET-GRAPH
  id: B1 | name: <name> | files: <list> | depends-on: [] | done-criteria: <test/condition>
  id: B2 | name: <name> | files: <list> | depends-on: [B1] | done-criteria: <test/condition>
  id: B3 | name: <name> | files: <list> | depends-on: [] | done-criteria: <test/condition>
```

Compute topological **WAVES** from the dependency graph. Buckets with no unmet dependencies are in the same wave.

Map to the Workflow script:

| Bucket relationship | Workflow primitive |
|---|---|
| Independent buckets in same wave | `parallel([() => agent(...), () => agent(...)])` |
| One bucket depends on another | `pipeline([bucket], buildStage, verifyStage)` across waves |

**Default: `pipeline()`** — each bucket flows through its build and verify stages independently, with no barrier. Use a `parallel()` barrier only when a stage genuinely needs *all prior results* (e.g. a dedup/merge step that reads every bucket's output, or an early-exit condition that requires a full fan-in before proceeding).

**Concurrency caps** (runtime-observed on current builds):
- The Workflow runtime caps concurrency at up to **16 agents per workflow run** (fewer on machines with limited CPU cores) — excess `agent()` calls queue and run as slots free. A separate lifetime ceiling of **1,000 agents total per run** exists as a runaway backstop.
- Agentille's own **house rule: ≤3 parallel executor (build) agents at a time**. This mirrors the subagent-mode cap in `roster.md` → "Hard cap" and applies identically here. Batch waves beyond 3 executors: spawn 3, wait, then the next batch.

**Token budget:** the script has a `budget` API — `budget.total` (the user's token target, or null), `budget.spent()`, `budget.remaining()`. When the user set a token target, size the fan-out with it (e.g. stop spawning optional verify passes when `budget.remaining()` runs low) — this is the concrete lever behind "decomposition is a token trade" (`SKILL.md` → "Token budget hints"). With no target set, ignore it.

---

## 5 · Role → workflow stage mapping

| agentille role | Workflow stage | Notes |
|---|---|---|
| **planner** | Produces the bucket-graph; seeds the script variables. Not itself a `agent()` call in the script. | The orchestrator writes the script from the planner's output. |
| **executor** (`agentille:agentille-executor`) | **Build stage** — one `agent()` call per bucket, model: Sonnet. Runs inside the pipeline per bucket. | Never upgrade executor — broken code costs more than tokens. |
| **code-reviewer** (`agentille:agentille-code-reviewer`) | **Verify stage** — dispatched via `pipeline()` as each build completes, NOT gated behind all-builds-done. Model: tiered (see `model-routing.md`). | Receives the finished branch diff; returns PASS or ISSUES. |
| **design-reviewer** (`agentille:agentille-design-reviewer`) | **Verify stage** (UI buckets only) — same pipeline position as code-reviewer. Model: Opus, never downgrade. | Only for buckets with a UI surface. |
| **security-reviewer** (`agentille:agentille-security-reviewer`) | **Verify stage** (security-tagged buckets only) — same pipeline position. Model: Opus; → Sonnet if `thinkingDepth=quick`. | Only when the bucket is security-tagged or touches auth/data-flow. |

Reviewer stages run as each build completes — the same pipelined-review principle as `team-mode.md` → "Pipelined review". A bucket's build and verify stages form one `pipeline()` chain; multiple such chains run concurrently (up to the 3-executor cap).

**Dispatch the real agent defs via `agentType`.** Every role-bearing `agent()` call passes `agentType: "agentille:agentille-<role>"` so the stage runs the actual agent definition — its system prompt and `tools` allowlist — instead of a role-play prose prefix. The prompt still carries the slice context (context-pack slice, files, done-criteria). Naming note: `agentType` is the option on the Workflow script's `agent()` helper; `subagent_type` is the separate `Agent` tool's parameter — two surfaces, same registry, not a conflict.

---

## 6 · Adversarial-verify stage pattern

After a build stage, fan out independent verifier agents prompted to **REFUTE** the work. Keep the finding only if a majority agree it is a genuine issue.

Pattern:
1. Build stage completes → executor output and diff are in script variables.
2. Fan out N reviewer agents (`parallel()`) each with an adversarial framing prompt: "Find a reason this is wrong. If you cannot, return PASS."
3. Collect results. **Use `schema` for the verdicts** — `agent(prompt, { schema })` forces a validated structured return (e.g. `{ verdict: "PASS" | "BLOCKER" | "should-fix", reason: string }`), so the majority vote counts typed fields instead of string-matching free text. Majority-vote: if ≥ ⌈N/2⌉ reviewers return a finding as BLOCKER/should-fix, it is a confirmed gate. If < ⌈N/2⌉ agree, discard as noise.
4. A confirmed BLOCKER or should-fix **is a gate, not a memo** — re-dispatch a fix executor (`agent()`, Sonnet) on the specific finding, then re-run the verify stage on the fix.

Map to agentille's reviewers:
- **code-reviewer** — always present in the verify stage for build buckets.
- **design-reviewer** — added for UI buckets.
- **security-reviewer** — added for security-tagged buckets.

Running them in `parallel()` within the verify stage is the adversarial fan-out — each reviews the same diff independently. Two of three (or two of two) agreeing on a BLOCKER triggers the fix-executor re-dispatch. The fix loop does not repeat more than once per finding — if the fix does not clear the reviewers, surface it to the user and stop.

---

## 7 · Failure, cleanup & artifacts

**Intermediate results** live in the workflow's script variables and in the per-run scratch directory:

```
~/.agentille/state/run-<id>/
  context-pack.md      — planner output (written by the orchestrator before script launch)
  checkpoint-<name>.md — executor checkpoints (written by each executor at committable boundaries)
  workflow-script.js   — courtesy copy of the emitted script, kept for the Debrief/log
```

> The Workflow runtime **persists the executing script itself** under the session directory (`~/.claude/projects/…`) and returns that path in the tool result — that auto-persisted file is the execution source and the one to edit for a resume. agentille's `workflow-script.js` copy is a convenience artifact only.

These are **never committed to the repo**. The run dir is scratch state, cleaned up after the Debrief (the orchestrator deletes it as the final step — `rm -rf ~/.agentille/state/run-<id>/`).

**Failed build stage:** if an executor `agent()` call throws or returns null, that bucket's result is null. The orchestrator surfaces it: *"Bucket B2 failed — skipping its verify stage; manual resolution required."* Other buckets continue unaffected. `parallel()` thunks that throw resolve to null — filter with `.filter(Boolean)` before proceeding to the merge.

**Merge integration:** the orchestrator (conductor) is the **single writer** that merges finished branches back onto `$BASE`. This matches the subagent/team-mode rule — never let two executors merge concurrently. Serialize merges; disjoint file sets mean these are clean.

**Resumability:** workflow runs are resumable in-session. Stop the prior run first if it's still active, then re-launch with **both** the script path and the run id: `Workflow({scriptPath: <the auto-persisted script path from the original tool result>, resumeFromRunId: <runId>})`. Completed `agent()` calls with unchanged prompts return cached results instantly; only edited or new calls re-run. The orchestrator logs the `runId` and the auto-persisted script path to the run dir at launch.

---

## 8 · Worked example script

Three-bucket build: "add a REST endpoint + its UI panel + integration tests" — genuinely disjoint (disjoint file sets, different dependencies). Wave 1: B1 (endpoint) and B2 (UI panel) in parallel. Wave 2: B3 (integration tests) depends on both.

```javascript
export const meta = {
  name: "agt-feature-endpoint-ui-tests",
  description: "Add REST endpoint (B1), UI panel (B2) in parallel; integration tests (B3) after both land.",
  // phases entries are {title, detail} objects — titles must exactly match the phase() calls below.
  phases: [
    { title: "build-wave-1", detail: "B1 endpoint + B2 UI panel build in parallel" },
    { title: "verify-wave-1", detail: "pipelined review of each wave-1 build" },
    { title: "build-wave-2", detail: "B3 integration tests (depends on B1+B2)" },
    { title: "verify-wave-2", detail: "review of B3" },
  ],
};

// Seed from the context-pack the orchestrator wrote before launching this script.
const CONTEXT_PACK = "~/.agentille/state/run-abc123/context-pack.md";

// ── WAVE 1: B1 and B2 are disjoint — build in parallel (agentille cap: ≤3 executors) ──────

phase("build-wave-1");

const [endpointBuild, uiBuild] = await parallel([
  () => agent(
    `Build the REST endpoint slice.\n` +
    `Context-pack slice: ${CONTEXT_PACK} §B1.\n` +
    `Files to touch: src/api/endpoint.ts, src/api/endpoint.test.ts.\n` +
    `Done-criteria: endpoint returns 200 on happy path; unit test passes.\n` +
    `Checkpoint path: ~/.agentille/state/run-abc123/checkpoint-B1.md`,
    { label: "B1-executor", phase: "build-wave-1", agentType: "agentille:agentille-executor", model: "sonnet", isolation: "worktree" }
  ),
  () => agent(
    `Build the UI panel slice.\n` +
    `Context-pack slice: ${CONTEXT_PACK} §B2.\n` +
    `Files to touch: src/components/Panel.tsx, src/components/Panel.css.\n` +
    `Done-criteria: Panel renders with mock data; no console errors.\n` +
    `Checkpoint path: ~/.agentille/state/run-abc123/checkpoint-B2.md`,
    { label: "B2-executor", phase: "build-wave-1", agentType: "agentille:agentille-executor", model: "sonnet", isolation: "worktree" }
  ),
]);

// ── WAVE 1 VERIFY: pipeline each build → its reviewers independently (no barrier) ──────────

phase("verify-wave-1");

const [endpointVerdict, uiVerdict] = await parallel([
  () => pipeline(
    [endpointBuild].filter(Boolean),
    (build) => agent(
      `Review B1 endpoint diff adversarially — find a reason it is wrong. ` +
      `If none, verdict PASS.\nDiff context: ${build}`,
      { label: "B1-code-reviewer", phase: "verify-wave-1", agentType: "agentille:agentille-code-reviewer", model: "opus",
        schema: { type: "object", properties: { verdict: { enum: ["PASS", "BLOCKER", "should-fix"] }, reason: { type: "string" } }, required: ["verdict"] } }
    ),
  ),
  () => pipeline(
    [uiBuild].filter(Boolean),
    (build) => agent(
      `Review B2 UI diff adversarially — find a reason it is wrong. ` +
      `If none, verdict PASS.\nDiff context: ${build}`,
      { label: "B2-code-reviewer", phase: "verify-wave-1", agentType: "agentille:agentille-code-reviewer", model: "sonnet",
        schema: { type: "object", properties: { verdict: { enum: ["PASS", "BLOCKER", "should-fix"] }, reason: { type: "string" } }, required: ["verdict"] } }
    ),
    (codeVerdict) => agent(
      `Review B2 UI panel at desktop viewport only. ` +
      `Score the six pillars 1-10. Flag any AI-design-tells.\nCode verdict: ${JSON.stringify(codeVerdict)}`,
      { label: "B2-design-reviewer", phase: "verify-wave-1", agentType: "agentille:agentille-design-reviewer", model: "opus" }
    ),
  ),
]);

log(`Wave 1 verdicts — endpoint: ${endpointVerdict ?? "FAILED"} | ui: ${uiVerdict ?? "FAILED"}`);

// Abort wave 2 if a wave-1 build failed; surface to user.
if (!endpointBuild || !uiBuild) {
  log("ERROR: one or more wave-1 builds failed — skipping wave 2. Manual resolution required.");
  return;
}

// ── WAVE 2: B3 depends on both wave-1 builds ─────────────────────────────────────────────

phase("build-wave-2");

const testsBuild = await agent(
  `Build the integration test slice.\n` +
  `Context-pack slice: ${CONTEXT_PACK} §B3.\n` +
  `Depends on: B1 endpoint branch, B2 UI branch (both merged to $BASE before this runs).\n` +
  `Files to touch: tests/integration/endpoint-panel.test.ts.\n` +
  `Done-criteria: integration test suite passes end-to-end.\n` +
  `Checkpoint path: ~/.agentille/state/run-abc123/checkpoint-B3.md`,
  { label: "B3-executor", phase: "build-wave-2", agentType: "agentille:agentille-executor", model: "sonnet", isolation: "worktree" }
);

phase("verify-wave-2");

const testsVerdict = testsBuild
  ? await agent(
      `Review B3 integration test diff. ` +
      `Verify coverage is real (not vacuous assertions). If sound, verdict PASS.\nDiff: ${testsBuild}`,
      { label: "B3-code-reviewer", phase: "verify-wave-2", agentType: "agentille:agentille-code-reviewer", model: "sonnet",
        schema: { type: "object", properties: { verdict: { enum: ["PASS", "BLOCKER", "should-fix"] }, reason: { type: "string" } }, required: ["verdict"] } }
    )
  : null;

log(`Wave 2 verdict — tests: ${testsVerdict ?? "FAILED"}`);
```

**Key call signatures used:**
- `agent(prompt, opts)` — spawns a subagent; returns its final text, or the validated object when `opts.schema` is set. `opts.agentType: "agentille:agentille-<role>"` runs the real agent def (system prompt + tools allowlist). `opts.isolation: "worktree"` gives the executor its own git worktree so file sets never collide.
- `parallel(thunks)` — runs `() => Promise` thunks concurrently; BARRIER; a thrown thunk resolves to null.
- `pipeline(items, ...stages)` — each item flows through all stages independently; NO barrier between stages. Default for build→verify chains.
- `phase(title)`, `log(msg)` — progress markers in the runtime transcript.
- Model: Sonnet for all executors; Opus for code-reviewer on a large/cross-cutting diff; Opus for design-reviewer (never downgrade). See `model-routing.md`.
- Concurrency: two parallel executors in wave 1 (under the ≤3 cap). B3 runs alone in wave 2.
