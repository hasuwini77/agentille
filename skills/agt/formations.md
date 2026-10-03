# Formations — run shapes beyond the plain roster

> **Authority:** the dispatch decision table in `skills/agt/SKILL.md` is the tie-breaker. This doc is the detail/rationale — if it ever conflicts with that table, the table wins.

A **formation** changes *how the workers relate*, not *where they run*. The mode (solo / subagent / panes / workflow) still carries the workers; a formation adds a shape on top: two builders racing, a builder against an attacker, or a contract that lets coupled slices build at once. One formation per run, at most.

| formation | shape | buys you | costs | auto-picked when |
|---|---|---|---|---|
| **duel** | 2 executors build the same slice two different ways; tests, then a judge, pick one | the better of two strategies when the right one is unclear | ~1.8–2× build tokens + one review | never — only when asked |
| **gauntlet** | executor builds → **adversary** writes tests to break it → executor fixes (≤2 rounds) | defects found by tests before review, kept as regression tests | ~1.3–1.6× build tokens | feature/bugfix with `risk` auth/money/data and a test runner in the repo |
| **relay** | a contract leg first (types, stubs, contract tests), then coupled slices build in parallel against it | parallel wall-clock on slices that share an interface | ~+10–20% tokens over sequential | the plan has ≥2 slices `coupled-by` one interface |

Force one with `--formation duel|gauntlet|relay`. `thinkingDepth=quick` never auto-picks a formation. A forced formation that does not fit (a duel with no checkable done-criteria, a relay with one slice) gets one honest line and runs without it — never fake the shape.

Every dispatch of the run carries `formation=<name>` in its header (`SKILL.md` → "Dispatch header"); the mod shows it on the band and deck. The Mission Brief adds one row: `formation: <name>  # <shape · cost>`.

## duel — best of two

**When.** The approach is genuinely uncertain and a wrong pick is expensive: a performance target, an algorithm with two credible strategies, a refactor with two plausible decompositions, a UI where the direction is a judgment call. The user says "try two approaches", "best of", "compare implementations", or types `--formation duel`. Not for routine work — two builders on a CRUD form is waste.

**Requires** a machine-checkable done-criteria (tests, a benchmark, a type contract). Without one there is nothing to judge but taste; run it as a normal build instead.

**Flow.**
1. **Planner** writes one spec, one done-criteria, and two **approach briefs** (A, B) that differ in *strategy* (data structure, algorithm, decomposition, library), never just style. If it cannot name two real strategies, there is no duel — say so and run one executor.
2. **Two executors in parallel**, each in its own worktree (`agt/<slug>-a`, `agt/<slug>-b`), each given only its own brief — neither sees the other. Both dispatch with `integration: local`: nothing is pushed until a winner exists, so no preview deploys fire for the loser.
3. **Tests judge first.** Run the same done-criteria (and benchmark, if any) on both. An entry that fails loses outright. Both fail → no winner: surface both failures to the user.
4. **Both pass → the judge.** One `code-reviewer` dispatch (`mode=review formation=duel`, routed as size=large) gets both diffs and the numbers, and answers:
   ```
   WINNER: A|B
   WHY: <correctness risk > simplicity (diff size, moving parts) > measured performance > fit with conventions>
   GRAFT: <one concrete idea from the loser worth porting, or none>
   ```
5. The winner integrates normally (PR / push / local). A `GRAFT` is a follow-up commit by the winner's executor, only if small. The loser's worktree and branch are deleted, never pushed.

**Debrief:** `duel: A won (vector index, 41 ms p95 vs 118 ms) · B discarded · graft: none`.

## gauntlet — build, attack, fix

**When.** The change guards something: `risk` auth/money/data, a parser or validator, an input boundary, a webhook, a bugfix for something that already broke once. Or the user says "harden it" / types `--formation gauntlet`. Needs a test runner in the repo; without one, fall back to the normal reviewer gate and say why.

**Flow.**
1. **Executor builds** the slice as usual, with `integration: local` — the branch is not pushed until the gauntlet clears.
2. **Adversary, round 1** (`agentille:agentille-adversary`, `formation=gauntlet`): gets the spec, the done-criteria and the diff; writes 3–8 tests meant to break it, triages its own false failures away, commits the test file on the branch, reports `BROKEN: n` / `HELD: m`.
3. `BROKEN: 0` → straight to the reviewer gate.
4. `BROKEN: n` → **executor fix** (`mode=fix`): the broken adversary tests are now part of the spec; the executor makes them pass without weakening them. Then **adversary, round 2** on the fixed code: new cases only, never a resubmitted round-1 case.
5. Still `BROKEN` after round 2 → **stop.** Surface the broken cases to the user (the mod flags them on the band). Never a third round: two failed fixes is the escalation ladder's signal (`model-routing.md` → "Escalation ladder"), not a reason to grind.
6. Cleared → push/PR, then the normal reviewers on the final diff. The adversary's tests stay in the branch as regression tests.

**Debrief:** `gauntlet: round 1 broke 3 · fixed · round 2 held 5/5 · 8 tests kept`.

## relay — contract first, then parallel

**When.** Two or more slices would build in parallel except that they share an interface: API ↔ UI, producer ↔ consumer, schema ↔ queries, a module and its callers. Without a relay the planner must mark them SEQUENTIAL. The planner flags such pairs `coupled-by: <interface>`; the lead runs a relay when ≥2 slices are coupled by the same interface.

**Flow.**
1. **Leg 1 — the contract** (one executor, small, sequential): the shared types / interfaces / schema / route signatures, **stubs** that make every slice build on its own (`SKILL.md` → every slice builds alone), and **contract tests** that pin the behavior both sides rely on. Committed on the run's integration branch. This leg is deliberately thin — no business logic.
2. **Leg 2 — the slices, in parallel** (panes / workflow / subagent waves, per the mode): each executor forks from the contract commit and implements its side against it. **The contract is frozen.** A slice that needs it changed stops and reports `CONTRACT: <what and why>` — the lead amends leg 1 and re-forks the affected slices; a slice never edits the contract on its own.
3. **Gate:** the contract tests plus each slice's own tests, on the integrated result; then the normal reviewers on the combined diff.

**Debrief:** `relay: contract 1 leg (4 files) · 3 slices in parallel · 0 contract changes`.

## Honest cost

Formations spend tokens to buy a specific thing. State the trade on the Mission Brief, in the `formation:` comment, every time: `# 2 executors, best of 2 · ~1.8× build tokens`, `# adversary ≤2 rounds · ~1.4× build tokens`, `# contract leg + 3 parallel slices · ~+15% tokens, ~2× faster`. Read actual numbers from the ledger at the Debrief; never claim a saving the ledger does not show.
