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
- `--fable` composes: forces fable as the model ceiling for Opus-resolving roles (planner, ui-prototyper, design-reviewer, security-reviewer). Executors remain Sonnet. See `model-routing.md` → "Hard rules" and the `--fable` run modifier in `SKILL.md`.
- `--fable` is a **deprecated alias**: new work should rely on the size/risk auto-escalation in `model-routing.md`. `--fable` continues to function as documented above until removed.

---

## 3 · Graceful degradation (REQUIRED)

If the `Workflow` tool is unavailable — older Claude Code build, `disableWorkflows: true` in settings, `CLAUDE_CODE_DISABLE_WORKFLOWS=1` env var, or a launch-time error — the workflow tier **degrades silently** to the existing in-session subagent wave dispatch already described in `SKILL.md` (planner → context-pack → ≤3 parallel executors per wave → pipelined review).

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

**Concurrency caps:**
- The Workflow runtime caps at ~16 concurrent agents globally.
- Agentille's own **house rule: ≤3 parallel executor (build) agents at a time**. This mirrors the subagent-mode cap in `roster.md` → "Hard cap" and applies identically here. Batch waves beyond 3 executors: spawn 3, wait, then the next batch.

---

## 5 · Role → workflow stage mapping

| agentille role | Workflow stage | Notes |
|---|---|---|
| **planner** | Produces the bucket-graph; seeds the script variables. Not itself a `agent()` call in the script. | The orchestrator writes the script from the planner's output. |
| **executor** (`agentille:agentille-executor`) | **Build stage** — one `agent()` call per bucket, model: Sonnet. Runs inside the pipeline per bucket. | Never upgrade executor to Opus/fable — broken code costs more than tokens. |
| **code-reviewer** (`agentille:agentille-code-reviewer`) | **Verify stage** — dispatched via `pipeline()` as each build completes, NOT gated behind all-builds-done. Model: tiered (see `model-routing.md`). | Receives the finished branch diff; returns PASS or ISSUES. |
| **design-reviewer** (`agentille:agentille-design-reviewer`) | **Verify stage** (UI buckets only) — same pipeline position as code-reviewer. Model: Opus, never downgrade. | Only for buckets with a UI surface. |
| **security-reviewer** (`agentille:agentille-security-reviewer`) | **Verify stage** (security-tagged buckets only) — same pipeline position. Model: Opus (fable for large diffs). | Only when the bucket is security-tagged or touches auth/data-flow. |

Reviewer stages run as each build completes — the same pipelined-review principle as `team-mode.md` → "Pipelined review". A bucket's build and verify stages form one `pipeline()` chain; multiple such chains run concurrently (up to the 3-executor cap).

---

## 6 · Adversarial-verify stage pattern

After a build stage, fan out independent verifier agents prompted to **REFUTE** the work. Keep the finding only if a majority agree it is a genuine issue.

Pattern:
1. Build stage completes → executor output and diff are in script variables.
2. Fan out N reviewer agents (`parallel()`) each with an adversarial framing prompt: "Find a reason this is wrong. If you cannot, return PASS."
3. Collect results. Majority-vote: if ≥ ⌈N/2⌉ reviewers return a finding as BLOCKER/should-fix, it is a confirmed gate. If < ⌈N/2⌉ agree, discard as noise.
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
  workflow-script.js   — the emitted script (written by orchestrator; read-only at runtime)
```

These are **never committed to the repo**. The run dir is scratch state, cleaned up after the Debrief (the orchestrator deletes it as the final step — `rm -rf ~/.agentille/state/run-<id>/`).

**Failed build stage:** if an executor `agent()` call throws or returns null, that bucket's result is null. The orchestrator surfaces it: *"Bucket B2 failed — skipping its verify stage; manual resolution required."* Other buckets continue unaffected. `parallel()` thunks that throw resolve to null — filter with `.filter(Boolean)` before proceeding to the merge.

**Merge integration:** the orchestrator (conductor) is the **single writer** that merges finished branches back onto `$BASE`. This matches the subagent/team-mode rule — never let two executors merge concurrently. Serialize merges; disjoint file sets mean these are clean.

**Resumability:** workflow runs are resumable in-session via the `runId` the `Workflow` tool returns. If the run is interrupted, re-launch with the same `runId` to resume from the last completed stage. The orchestrator logs the `runId` to the run dir at launch.

---

## 8 · Worked example script

Three-bucket build: "add a REST endpoint + its UI panel + integration tests" — genuinely disjoint (disjoint file sets, different dependencies). Wave 1: B1 (endpoint) and B2 (UI panel) in parallel. Wave 2: B3 (integration tests) depends on both.

```javascript
export const meta = {
  name: "agt-feature-endpoint-ui-tests",
  description: "Add REST endpoint (B1), UI panel (B2) in parallel; integration tests (B3) after both land.",
  phases: ["build-wave-1", "verify-wave-1", "build-wave-2", "verify-wave-2"],
};

// Seed from the context-pack the orchestrator wrote before launching this script.
const CONTEXT_PACK = "~/.agentille/state/run-abc123/context-pack.md";

// ── WAVE 1: B1 and B2 are disjoint — build in parallel (agentille cap: ≤3 executors) ──────

phase("build-wave-1");

const [endpointBuild, uiBuild] = await parallel([
  () => agent(
    `You are agentille-executor. Build the REST endpoint slice.\n` +
    `Context-pack slice: ${CONTEXT_PACK} §B1.\n` +
    `Files to touch: src/api/endpoint.ts, src/api/endpoint.test.ts.\n` +
    `Done-criteria: endpoint returns 200 on happy path; unit test passes.\n` +
    `Checkpoint path: ~/.agentille/state/run-abc123/checkpoint-B1.md`,
    { label: "B1-executor", phase: "build-wave-1", model: "claude-sonnet-4-5", isolation: "worktree" }
  ),
  () => agent(
    `You are agentille-executor. Build the UI panel slice.\n` +
    `Context-pack slice: ${CONTEXT_PACK} §B2.\n` +
    `Files to touch: src/components/Panel.tsx, src/components/Panel.css.\n` +
    `Done-criteria: Panel renders with mock data; no console errors.\n` +
    `Checkpoint path: ~/.agentille/state/run-abc123/checkpoint-B2.md`,
    { label: "B2-executor", phase: "build-wave-1", model: "claude-sonnet-4-5", isolation: "worktree" }
  ),
]);

// ── WAVE 1 VERIFY: pipeline each build → its reviewers independently (no barrier) ──────────

phase("verify-wave-1");

const [endpointVerdict, uiVerdict] = await parallel([
  () => pipeline(
    [endpointBuild].filter(Boolean),
    (build) => agent(
      `You are agentille-code-reviewer. Review B1 endpoint diff adversarially — find a reason it is wrong. ` +
      `If none, return PASS.\nDiff context: ${build}`,
      { label: "B1-code-reviewer", phase: "verify-wave-1", model: "claude-opus-4-5" }
    ),
  ),
  () => pipeline(
    [uiBuild].filter(Boolean),
    (build) => agent(
      `You are agentille-code-reviewer. Review B2 UI diff adversarially — find a reason it is wrong. ` +
      `If none, return PASS.\nDiff context: ${build}`,
      { label: "B2-code-reviewer", phase: "verify-wave-1", model: "claude-sonnet-4-5" }
    ),
    (codeVerdict) => agent(
      `You are agentille-design-reviewer. Review B2 UI panel at desktop viewport only. ` +
      `Score the six pillars 1-10. Flag any AI-design-tells.\nCode verdict: ${codeVerdict}`,
      { label: "B2-design-reviewer", phase: "verify-wave-1", model: "claude-opus-4-5" }
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
  `You are agentille-executor. Build the integration test slice.\n` +
  `Context-pack slice: ${CONTEXT_PACK} §B3.\n` +
  `Depends on: B1 endpoint branch, B2 UI branch (both merged to $BASE before this runs).\n` +
  `Files to touch: tests/integration/endpoint-panel.test.ts.\n` +
  `Done-criteria: integration test suite passes end-to-end.\n` +
  `Checkpoint path: ~/.agentille/state/run-abc123/checkpoint-B3.md`,
  { label: "B3-executor", phase: "build-wave-2", model: "claude-sonnet-4-5", isolation: "worktree" }
);

phase("verify-wave-2");

const testsVerdict = testsBuild
  ? await agent(
      `You are agentille-code-reviewer. Review B3 integration test diff. ` +
      `Verify coverage is real (not vacuous assertions). If sound, return PASS.\nDiff: ${testsBuild}`,
      { label: "B3-code-reviewer", phase: "verify-wave-2", model: "claude-sonnet-4-5" }
    )
  : null;

log(`Wave 2 verdict — tests: ${testsVerdict ?? "FAILED"}`);
```

**Key call signatures used:**
- `agent(prompt, opts)` — spawns a subagent; returns its final text. `opts.isolation: "worktree"` gives the executor its own git worktree so file sets never collide.
- `parallel(thunks)` — runs `() => Promise` thunks concurrently; BARRIER; a thrown thunk resolves to null.
- `pipeline(items, ...stages)` — each item flows through all stages independently; NO barrier between stages. Default for build→verify chains.
- `phase(title)`, `log(msg)` — progress markers in the runtime transcript.
- Model: Sonnet for all executors; Opus for code-reviewer on a large/cross-cutting diff; Opus for design-reviewer (never downgrade). See `model-routing.md`.
- Concurrency: two parallel executors in wave 1 (under the ≤3 cap). B3 runs alone in wave 2.
