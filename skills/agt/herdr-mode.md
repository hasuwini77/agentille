# Herdr mode — workers are panes, not nested agents

> **Authority:** the dispatch decision table in `skills/agt/SKILL.md` is the tie-breaker. This doc is the detail/rationale — if it ever conflicts with that table, the table wins.

Herdr mode is the parallel execution shape done right. Same brain — classify, roster, model routing, review gates, git consolidation — but each worker is a **sibling Herdr pane running a real vendor session** instead of an agent nested inside the lead's own session.

## Why panes beat nested teammates

A multiplexer tracks **one agent per pane**. Anything the lead spawns *inside* its own pane — Claude Code teammates, background subagents — is invisible to it. That invisibility is the whole bug class:

- The multiplexer's lifecycle states (`idle` / `working` / `blocked` / `done`) never see the nested worker, so "is it finished?" degrades from a machine fact to a promise the worker has to remember to make.
- Teardown becomes a polite request instead of an operation. A worker that finished an hour ago is indistinguishable from one still thinking.
- Every worker is the same vendor as the lead. Cross-model review is impossible by construction.

Hoisting workers to sibling panes fixes all three at once: they show up in `herdr agent list`, their completion is a readable state, closing them is `herdr pane close`, and each pane can be a **different vendor**.

| | team mode | herdr mode |
|---|---|---|
| Worker visibility | nested, invisible to the multiplexer | `herdr agent list` |
| "Is it done?" | the worker must self-report | `herdr agent get <name>` → state |
| Teardown | send a message, hope it lands | close the pane you opened |
| Vendors | Claude only | `claude` · `codex` · `opencode` (local) |
| Isolation | manual worktrees | `herdr worktree create` |

## When herdr mode is selected

Herdr mode is the parallel transport whenever it is available; availability decides:

| Condition | Mode |
|---|---|
| `HERDR_ENV=1`, `herdr` on PATH, and the task has ≥2 genuinely disjoint slices | **herdr** |
| Same parallelism bar, but not inside Herdr | **workflow** if the `Workflow` tool exists, else subagent waves |
| No real parallelism | **subagent** / **solo**, exactly as today |

The parallelism bar is unchanged and non-negotiable: **≥2 slices with disjoint file sets that can build at once.** Panes are cheaper to open than teammates, which is exactly why the bar must not drift — a pane per sequential step is theatre, not parallelism.

`--mode herdr` forces it; teams (`--team` / `--mode team`) are legacy, opt-in only and never auto-selected. A forced herdr mode with no disjoint slices gets the same honesty treatment as a forced team (see `team-mode.md` → "Honesty on a forced team").

## Pre-flight

1. `test "${HERDR_ENV:-}" = 1` — if it fails, you are not inside Herdr. Fall through to workflow/subagent mode silently. Never drive a Herdr session from outside one.
2. `command -v herdr` — absent → fall through.
3. Read your own location so every spawn is relative to it:
   ```bash
   printf '%s\n' "$HERDR_WORKSPACE_ID" "$HERDR_TAB_ID" "$HERDR_PANE_ID"
   ```
4. Compute the pool size (next section). If it resolves to 1, there is no parallelism to buy — run subagent mode instead.

## The elastic pool — sized by the work and the machine, never by a constant

A fixed worker cap is a guess that is wrong in both directions: it throttles a genuinely 8-way task and it green-lights 3 panes on work that only has 2 slices. The pool is **computed at dispatch time**:

```
slices      = genuinely disjoint work units          (uncapped — the work decides)
poolSize    = min(slices, resourceCap)
resourceCap = clamp( min( floor(freeRAM_MB / 700), max(2, cores - 2) ), 2, 12 )
```

Each vendor session costs roughly 500–700 MB resident, so `resourceCap` is a physical bound, not a preference. Read it live:

```bash
cores=$(sysctl -n hw.ncpu 2>/dev/null || nproc)
free_mb=$(vm_stat 2>/dev/null | awk '/free|inactive/ {gsub(/\./,"",$NF); s+=$NF} END {print int(s*4096/1048576)}')
[ -z "$free_mb" ] && free_mb=$(free -m | awk '/^Mem:/ {print $7}')
```

**Slices above `poolSize` are not dropped — they queue.** The pool is a worker pool with wave scheduling: when a pane is harvested and reaped, the next queued slice starts in a fresh pane. Ten slices on a pool of four is a normal, fully supported run; you get ten slices of work with four panes of pressure.

### Scale tiers — what a larger fan-out has to earn

Elastic does not mean unconditional. The bar rises with N because the failure modes change:

| Concurrent panes | What is required |
|---|---|
| **1–3** | Nothing extra. Dispatch. |
| **4–6** | Print the slice map first — one line per slice naming its worktree or its non-overlapping file glob. Overlap at this width is how two workers silently clobber each other. |
| **7+** | All three: every slice has a **machine-checkable** exit criterion (tests / typecheck / lint / pattern match), **at least half the panes run a non-Claude vendor**, and remaining slices run as waves rather than all at once. |

The vendor-mix rule at 7+ exists because ten simultaneous Claude sessions is the single most expensive shape agentille can produce, and it is almost never the *best* one — wide fan-outs are dominated by mechanical work, which is precisely what the cheaper tiers are for.

## Vendor routing — which kind gets which slice

| Slice shape | `--kind` | Why this vendor |
|---|---|---|
| Implementation: multi-file, judgment, repo navigation | `claude` (sonnet) | strongest tool use and codebase navigation; the workhorse |
| Adversarial review, plan critique, second opinion | `codex` | **decorrelated errors** — a model reviewing its own family's output misses the same things it would have written |
| Mechanical, high-volume, slow-is-fine, verifiable | `opencode` on a local endpoint | free and parallel; latency is irrelevant when nothing waits on it |
| Planning, architecture, design judgment | **stays in the lead pane** | needs the conversation's context; a pane adds latency, not quality |

**The local-tier guardrail is load-bearing.** A local pane may only receive a slice whose success is decidable by a machine — `npx vitest run` passes, `tsc --noEmit` is clean, the linter is quiet, the diff matches an expected shape. Never judgment, never "does this read well", never anything where *looks plausible* is the only available check. Honor that line and the local tier is free capacity; cross it and it is a generator of confident nonsense.

Vendor availability is discovered, never assumed: `herdr agent` prints the supported kinds, and a kind that is not installed fails at `agent start`. On any spawn failure, re-dispatch that slice once as `claude` and note the substitution in the Debrief.

## Spawning a worker

Per slice, in order:

1. **Isolate.** One worktree per slice, so disjointness is enforced by the filesystem rather than by good intentions:
   ```bash
   herdr worktree create --branch "agt/<slug>" --base "$BASE" --label "<slice>" --no-focus
   ```
   Slices that only read (reviewers, researchers) skip this and use the current cwd.

2. **Open the pane.** Split wide panes right, tall/narrow panes down (check `herdr pane layout --pane "$HERDR_PANE_ID"` first); repeated same-direction splits produce unusable slivers. Tag it with the run id so provenance survives a rename:
   ```bash
   herdr pane split --current --direction right --cwd "<worktree-or-$PWD>" \
     --env "AGENTILLE_RUN=<run-id>" --no-focus
   ```
   Read the new id from `.result.pane.pane_id`. **Never focus** — the user's cursor stays where they put it.

3. **Start the agent under an owned name.** Every agentille-spawned agent is named `agt-<run-id>-<role>` — the `agt-` prefix is the **reap authority**: it is what tells the lead and the safety-net reaper which panes are theirs to close, and it is why neither will ever touch a pane the user opened by hand.
   ```bash
   herdr agent start "agt-<run-id>-exec-1" --kind claude --pane <pane-id>
   ```
   Names must match `[a-z][a-z0-9_-]{0,31}` and be unique among live agents — keep the run id short (6 chars).

4. **Send the slice.** One prompt carrying: the task, the profile context block, this slice's file set, its verification command, and its exit criterion. Do not wait synchronously here if other slices are still unspawned — spawn the whole wave first, then wait.

## The lifecycle state machine — harvest, then reap

This is the part team mode never had. Worker completion is a **read**, not a promise:

| State | Meaning | Lead's action |
|---|---|---|
| `working` | actively running | leave alone |
| `blocked` | an approval or question is on screen | **surface it to the user immediately** — never reap; killing it destroys in-flight work |
| `done` | finished background work, unseen | harvest → reap |
| `idle` | ready for input, already seen | harvest → reap once its slice is consumed |
| `unknown` | present but unclassified | **never reap** — it does not prove completion; re-read before deciding |

The loop per worker:

```bash
herdr agent wait "agt-<run>-exec-1" --until done --until blocked --timeout 600000
herdr agent get  "agt-<run>-exec-1"                     # confirm the state you got
herdr agent read "agt-<run>-exec-1" --source recent-unwrapped --lines 200
herdr pane close <pane-id>                              # only a pane you opened
```

If `agent read` cannot recover a complete response, the pane is rendering on the terminal's alternate screen and scrollback will not help. Ask that worker to write its full report to a file and reply with only the path, then read the file. Use this as a fallback — never in the initial prompt, where it just adds a step.

**Reap immediately on harvest.** The moment a worker's output is in the lead's hands and nothing downstream depends on that pane, close it. Not at a run-end sweep, not "once everything finishes" — then. A finished pane left open is indistinguishable from a working one, and that ambiguity is the entire complaint this mode exists to answer.

## Teardown — deterministic, plus a safety net

**Primary (the lead, in-loop):** before declaring the run done, every `agt-<run-id>-*` agent must be harvested and its pane closed. Verify with a final `herdr agent list` filtered to your run id — the correct result is zero rows. Report the outcome in the Debrief `team:` row (see `display.md` → "Frame 5"), e.g. `team: ✓ 5 panes harvested and closed · 0 orphans`.

**Safety net (`hooks/agentille-reap.sh`, on the `Stop` hook):** the lead is not always around to finish the job — a turn ends, a session is interrupted, a worker finishes long after the lead stopped. The reaper closes `agt-*` panes that have sat continuously in `done` (90s grace) or `idle` (300s grace), measured against `state_change_seq` so an intermittently-active agent resets its own timer. It never touches `working`, `blocked`, or `unknown`, and it never touches an agent whose name lacks the `agt-` prefix. It is a net, not the plan: a lead that relies on it is leaving the user's screen full of panes for up to five minutes.

**Never close what you did not open.** Panes the user created by hand are off-limits to both the lead and the reaper, unconditionally, even when idle. Ownership is the `agt-` prefix — no prefix, no authority.

## Consolidation

Identical to team mode (`team-mode.md` → "Consolidation — merge back to the current branch, never `main`"): worktrees fork from `$BASE = $(git symbolic-ref --short HEAD)`, finished slices merge back into `$BASE` locally and sequentially, `agt/*` scaffolding branches are deleted and never pushed, and the integration target resolves by the same precedence. Remove each slice's worktree as it merges:

```bash
herdr worktree remove --workspace <id> --force
```

## Failure → degrade

Any failure — `HERDR_ENV` unset, `herdr` missing, `pane split` refused, `agent start` timing out, the pool resolving to 1 — degrades to the next mode down (workflow if available, otherwise subagent waves) and logs one line: *"herdr unavailable — ran N subagents instead"*. Panes already opened for this run are closed before degrading; a half-spawned fan-out is never left on screen.

## Cost

A pane is a full vendor session, so a Claude-only fan-out costs about the same as team mode (~4×). The difference is that herdr mode can **route the cost**: mechanical slices to a local endpoint cost nothing, and review slices to `codex` spend a different budget entirely. A well-routed 6-pane herdr run is routinely cheaper than a 3-teammate team run. Surface the shape, never a fabricated token count — `cost: ✓ herdr · 4 claude + 2 codex + 1 local` (see `display.md` → "Frame 5").
