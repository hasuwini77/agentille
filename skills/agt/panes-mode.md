# Panes mode — workers are panes, not nested agents

> **Authority:** the dispatch decision table in `skills/agt/SKILL.md` is the tie-breaker. This doc is the detail/rationale — if it ever conflicts with that table, the table wins.

Panes mode is the parallel execution shape done right. Same brain — classify, roster, model routing, review gates, git consolidation — but each worker is a **sibling pane running a real vendor session** instead of an agent nested inside the lead's own session. The mode is `panes`; the transport underneath is **Herdr** or **tmux**, picked by the agentille mod and injected into `/agt` as a `## Pane transport` block. Everything under "Spawning a worker" is the Herdr recipe; "tmux transport" is the tmux one. `--mode herdr` stays as an alias for `--mode panes`.

## Why panes beat nested teammates

A multiplexer tracks **one agent per pane**. Anything the lead spawns *inside* its own pane — Claude Code teammates, background subagents — is invisible to it. That invisibility is the whole bug class:

- The multiplexer's lifecycle states (`idle` / `working` / `blocked` / `done`) never see the nested worker, so "is it finished?" degrades from a machine fact to a promise the worker has to remember to make.
- Teardown becomes a polite request instead of an operation. A worker that finished an hour ago is indistinguishable from one still thinking.
- Every worker is the same vendor as the lead. Cross-model review is impossible by construction.

Hoisting workers to sibling panes fixes all three at once: they show up in `herdr agent list`, their completion is a readable state, closing them is `herdr pane close`, and each pane can be a **different vendor**.

| | team mode | panes mode (Herdr) |
|---|---|---|
| Worker visibility | nested, invisible to the multiplexer | `herdr agent list` |
| "Is it done?" | the worker must self-report | `herdr agent get <name>` → state |
| Teardown | send a message, hope it lands | close the pane you opened |
| Vendors | Claude only | `claude` · `codex` · `opencode` (local) |
| Isolation | manual worktrees | `herdr worktree create` |

## When panes mode is selected

Panes mode is the parallel transport whenever a pane transport is available; availability decides:

| Condition | Mode |
|---|---|
| Inside Herdr (`HERDR_ENV=1`, `herdr` on PATH) or tmux (`$TMUX` set, `tmux` on PATH), and the task has ≥2 genuinely disjoint slices | **panes** (Herdr wins when both are present) |
| Same parallelism bar, but no pane transport | **workflow** if the `Workflow` tool exists, else subagent waves |
| No real parallelism | **subagent** / **solo**, exactly as today |

The parallelism bar is unchanged and non-negotiable for **parallel fan-out**: **≥2 slices with disjoint file sets that can build at once.** Panes are cheaper to open than teammates, which is exactly why the bar must not drift — a pane per sequential step is theatre, not parallelism. The bar does not decide whether an executor gets a pane: with the pane tools live, a single-slice executor, an adversary and the `opus`/`fable` reviewers are pane workers anyway (see "Through the mod's tools"), and `--mode panes` with one slice is legitimate. `--mode subagent` keeps every worker a subagent.

`--mode panes` (or the alias `--mode herdr`) forces it; teams (`--team` / `--mode team`) are legacy, opt-in only and never auto-selected. A forced panes mode with no disjoint slices gets the same honesty treatment as a forced team (see `team-mode.md` → "Honesty on a forced team").

## Pre-flight

The mod probes the transport once per session and injects the result; these checks are the manual equivalent for Herdr. On tmux, skip to "tmux transport".

1. `test "${HERDR_ENV:-}" = 1` — if it fails, you are not inside Herdr. Fall through to the tmux check, then workflow/subagent mode, silently. Never drive a Herdr session from outside one.
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

## Through the mod's tools

When the `## Pane transport` block says the tools are live, open every **claude** worker with `mcp__agentille__spawn_pane` and close it with `mcp__agentille__close_pane`. They are the same code path a typed `/agt-spawn` runs, on Herdr and tmux alike, so steps 2–4 below (and the tmux "Spawn" block) collapse into one call:

```
spawn_pane { run: "<run-id>", role: "exec-1", model: "sonnet", cwd: "<worktree>", task: "<full slice prompt>" }
→ Opened agt-<run-id>-exec-1 · sonnet · herdr pane.
close_pane { name: "agt-<run-id>-exec-1" }
→ Closed agt-<run-id>-exec-1.
```

A routed worker names its role instead of a model. `agent` is the routing role, `header` the `[agt run=… size=… mode=…]` line; the mod runs `decide()` on them (the same table, effort and Fable guard as a subagent) and ignores any `model` you pass:

```
spawn_pane { run: "<run-id>", role: "exec-1", agent: "executor", header: "[agt run=<run-id> size=medium mode=build]", cwd: "<worktree>", task: "<full slice prompt>" }
→ Opened agt-<run-id>-exec-1 · sonnet · medium · herdr pane.
```

The result line carries the routed model and effort. Roles that stay subagents (planner, plan-reviewer, ui-prototyper, `sonnet`/`haiku` reviewers) are denied with the reason; run them as subagents. A failed pane still falls back to a subagent, that path is never denied.

Layout is the mod's call, not yours. tmux: the lead's width is probed; at 160 columns or more the first worker splits right, otherwise down, and each later worker splits the newest live worker on the other axis, then the layout is evened out. Herdr cannot report width, so it goes right, then down. Workers stack beside the lead instead of squeezing it.

Pane answers never reach the mod's result hook, so a pane worker raises no `⚑` flag (a failed executor check, a reviewer FAIL): read the harvest yourself. Pane tokens are unknown and never shown. Cost: a pane opens at about 55k tokens against 32k for a subagent, 1.12× on the measured task, so it is not a saving; see "Cost".

What the mod enforces, so you do not have to: the `agt-<run>-<role>` name and its 32-char limit, a duplicate name already on screen, an absolute `cwd` that exists, no focus change, and the model (`sonnet`, `opus` or `haiku` — Fable never goes through a tool, only through the routing guard). `close_pane` reaches only `agt-` panes in your own tab (Herdr) or window (tmux) and never a typed `/agt-spawn` pane. Worker panes get no tools, so a worker cannot fan out on its own.

Still yours: isolation (step 1), the wait/read loop and the tmux done-file instruction in the slice prompt. Non-claude vendors and a session where the tools are absent use the manual recipe below.

## Spawning a worker

Per slice, in order (manual recipe — use the tools above when they are live):

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

With the tools live, `close_pane { name }` replaces the last line.

If `agent read` cannot recover a complete response, the pane is rendering on the terminal's alternate screen and scrollback will not help. Ask that worker to write its full report to a file and reply with only the path, then read the file. Use this as a fallback — never in the initial prompt, where it just adds a step.

**Reap immediately on harvest.** The moment a worker's output is in the lead's hands and nothing downstream depends on that pane, close it. Not at a run-end sweep, not "once everything finishes" — then. A finished pane left open is indistinguishable from a working one, and that ambiguity is the entire complaint this mode exists to answer.

## Teardown — deterministic, plus a safety net

**Primary (the lead, in-loop):** before declaring the run done, every `agt-<run-id>-*` agent must be harvested and its pane closed. Verify with a final `herdr agent list` filtered to your run id — the correct result is zero rows. Report the outcome in the Debrief `team:` row (see `display.md` → "Frame 5"), e.g. `team: ✓ 5 panes harvested and closed · 0 orphans`.

**Safety net (the agentille mod's reaper, running in the lead session):** the lead is not always around to finish the job — a turn ends, a session is interrupted, a worker finishes long after the lead stopped. The reaper closes `agt-*` panes that have sat continuously in `done` (90s grace) or `idle` (300s grace), measured against `state_change_seq` so an intermittently-active agent resets its own timer. On tmux only the `done` grace applies (see "tmux transport"). It never touches `working`, `blocked`, or `unknown`, and it never touches an agent whose name lacks the `agt-` prefix. Worker panes (their own pane name starts `agt-`) never reap. It is a net, not the plan: a lead that relies on it is leaving the user's screen full of panes for up to five minutes.

**Never close what you did not open.** Panes the user created by hand are off-limits to both the lead and the reaper, unconditionally, even when idle. Ownership is the `agt-` prefix — no prefix, no authority.

## tmux transport

Outside Herdr but inside tmux (`$TMUX` non-empty, `tmux -V` exits 0), workers are tmux panes. Same rules as above — disjoint slices, `agt-` ownership, harvest then reap — with a smaller toolbox: tmux has no per-agent lifecycle, so the worker reports completion itself and the lead reads a file.

**Spawn.** All argv, no shell string except the constant `'claude "$@"'`. Pane name is `agt-<run>-<role>`; the run id is 6 chars and the role is `[a-z0-9-]+`, so the whole name fits `^[a-z][a-z0-9_-]{0,31}$`:

```bash
tmux split-window -d -h -P -F '#{pane_id}' -t "$TMUX_PANE" -c <cwd> \
  -e AGENTILLE_RUN=<run> "$SHELL" -ic 'claude "$@"' agt \
  --model <model> -n <name> -- "<task>"

tmux set-option -p -t <id> @agt <name>
tmux set-option -p -t <id> @agt_vendor claude
tmux set-option -p -t <id> allow-set-title off
tmux select-pane -t <id> -T <name>
```

`-d` keeps focus where the user left it. The `@agt` pane option is the ownership marker (the tmux equivalent of the `agt-` agent name) and `allow-set-title off` stops Claude from renaming the pane out from under you. If `$SHELL` is not zsh or bash, skip the shell wrapper and exec `claude --model <model> -n <name> -- "<task>"` directly. The `--` is not optional: it keeps a task that starts with `-` out of claude's option parser. Escape `#` as `##` in `<cwd>`, because tmux reads `-c` as a format string.

**Scope.** The lead only sees and reaps panes in **its own window**. List them with:

```bash
tmux list-panes -a -F '#{pane_id}\t#{@agt}\t#{@agt_vendor}\t#{pane_dead}\t#{window_id}'
```

Your own pane is `$TMUX_PANE`. A pane with no `@agt` value is the user's — never touch it.

**Done signal.** Each worker's last act is writing `~/.agentille/state/run-<run>/done-<role>`. Put that instruction in the slice prompt. The lead treats a worker as `done` when that file exists or the pane is dead (`pane_dead=1`), else `working`. There is no `blocked` or `idle` state to read, so:

- a done file counts only if it was **written after the mod first saw the pane** (file mtime ≥ first sighting), so a file left by an earlier worker of the same role never marks a re-dispatched one done. Delete `done-<role>` before you (re)spawn a role anyway, so a stale file cannot confuse your own check. If the lead session restarts mid-run, panes that finished earlier read as `working` until the lead closes them;
- reap **only** on the done file or a dead pane — never on silence;
- a worker that is overdue gets `tmux capture-pane -p -t <id> -S -200` before any decision, because an approval prompt on screen looks exactly like "still working";
- the mod's safety-net reaper closes a tmux pane only after `done` has held for 90s (no idle timer), with `tmux kill-pane -t <id>`.

**Ownership is the prefix, nothing more.** Two unrelated agentille leads in the same tmux window reap each other's `agt-` workers once those are done, because the `agt-` name is the only ownership line the mod can read. Run one lead per window.

Everything else — elastic pool, scale tiers, consolidation, degrade — is identical. Vendors other than `claude` are Herdr-only for now.

## /agt-spawn — one pane, one routed session

`/agt-spawn "task" [--model sonnet|opus|haiku|fable]` opens a single sibling pane running one Claude session on the model you pick (default `sonnet`), on whichever transport is live. It is the manual counterpart of a worker: you route one task to one model without running the orchestrator.

- **Typed only.** It runs only for the composer and the remote bridge; no skill, agent, tool or SDK caller invokes it.
- **No bare subcommand words.** A task that is one lowercase word (`plugin`, `purge`) is refused, because claude would run it as a subcommand even after `--`.
- **Never focuses** the new pane.
- **Quiet in the band.** The pane shows as `open`, never `working` or `done`, so it never drives the spinner or the working count.
- **Never reaped.** The pane is named `agt-<6-char-run>-spawn`; the reserved role `spawn` is exempt from both the lead's teardown and the mod's reaper, on both transports. The user closes it.
- Reply is one line: `Opened <name> · <model> · <transport> pane.` With no transport: `No pane transport here: /agt-spawn needs Claude Code running inside Herdr or tmux.`

## Consolidation

Identical to team mode (`team-mode.md` → "Consolidation — merge back to the current branch, never `main`"): worktrees fork from `$BASE = $(git symbolic-ref --short HEAD)`, finished slices merge back into `$BASE` locally and sequentially, `agt/*` scaffolding branches are deleted and never pushed, and the integration target resolves by the same precedence. Remove each slice's worktree as it merges:

```bash
herdr worktree remove --workspace <id> --force
```

## Failure → degrade

Any failure — no pane transport, `herdr` or `tmux` missing, `pane split` refused, `agent start` timing out, the pool resolving to 1 — degrades to the next mode down (workflow if available, otherwise subagent waves) and logs one line: *"panes unavailable — ran N subagents instead"*. Panes already opened for this run are closed before degrading; a half-spawned fan-out is never left on screen.

## Cost

Measured, not estimated: on a two-slice test task (two runs per arm, alternating order), two Claude workers in panes used 1.12× the fresh tokens of the same two workers as subagents (1.05× counting the lead), and 1.55× counting cache reads, which bill at a fraction. The gap is start-up context: a pane opens as a full Claude session at about 55k tokens, a subagent at about 32k. That fixed cost matters most on small slices. The sample is small — one task, two runs per arm — so read it as a shape, not a benchmark.

Panes are not a token saving; the savings come from model routing and handing each worker only its slice of the plan. Routing is also where panes can spend other budgets: mechanical slices to a local endpoint cost nothing, and review slices to `codex` spend a different budget entirely. Team mode's ~4× is an estimate, not a measurement. Surface the shape, never a fabricated token count — `cost: ✓ panes · 4 claude + 2 codex + 1 local` (see `display.md` → "Frame 5").
