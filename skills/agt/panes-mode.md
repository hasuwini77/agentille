# Panes mode — workers are panes, not nested agents

The heavy level. Same brain as every level (roster and routing in `routing.md`, gates in `SKILL.md`), but each worker is a **sibling pane running a real Claude session**. The transport is **Herdr** or **tmux**, picked by the agentille mod and injected into `/agt` as a `## Pane transport` block.
A multiplexer tracks one agent per pane, so pane workers have a readable lifecycle and can be closed deterministically. `--mode panes` and `--mode herdr` are legacy aliases for `/agt heavy`.

## When panes open

Panes only on the heavy level (detected, or typed `/agt heavy`) and for `/agt-spawn`. Only the executor (one per slice) and the adversary may be panes. Planners, plan-reviewers, the ui-prototyper and ALL reviewers are always subagents; a single executor is a subagent. `low` and `medium` never open panes.
No pane transport: workflow if the `Workflow` tool exists, else subagent waves (`workflow-mode.md`).

Pre-flight (the mod probes this once; manual equivalent): inside Herdr (`HERDR_ENV=1`, `herdr` on PATH) or tmux (`$TMUX`, `tmux` on PATH), Herdr first. Otherwise fall through silently. Never drive a session from outside one.

## Pool size

`poolSize = min(slices, resourceCap, 3)`, `resourceCap = min(floor(freeRAM_MB / 700), max(2, cores - 2))`. A vendor session is ~500–700 MB resident. The 3 is the executor cap every level shares (`SKILL.md` → "Hard rules"); queue the rest as waves. A pool under 2 means subagent mode.
Heavy is not wider than medium: it buys panes (a real session per slice in its own worktree, the live wire, resume and steering), not more executors at once.

## Through the mod's tools

When the `## Pane transport` block says the tools are live, open every claude worker with `mcp__agentille__spawn_pane` and close it with `mcp__agentille__close_pane`, on Herdr and tmux alike:

```
spawn_pane { run: "<run-id>", role: "exec-1", agent: "executor", header: "[agt run=<run-id> size=small mode=build slice=<slug>]", cwd: "<worktree>", task: "isolated: false\nbranch: feat/<slug>\nbase: <base>\n<full slice prompt>" }
→ Opened agt-<run-id>-exec-1 · sonnet · medium · herdr pane.
close_pane { name: "agt-<run-id>-exec-1" }
→ Closed agt-<run-id>-exec-1.
```

The mod routes model and effort from `agent` + `header` through the same table as a subagent (`routing.md` → "Default routing") and ignores any `model` you pass. Roles that must stay subagents are denied with the reason; run them as subagents. A failed pane falls back to a subagent.

The mod places each pane. On Herdr, a run that will open ≥3 pane workers (slices plus adversaries) passes `layout: "tab"` on every `spawn_pane`, so its workers get their own `agt-<run>` tab. tmux ignores it.
The mod draws each pane's band and the lead's worker rows; you do nothing for them. Where panes go and when the mod closes them: `docs/display.md` at the plugin root.

The mod enforces the `agt-<run>-<role>` name (32 chars max), no duplicate name, an absolute existing `cwd`, no focus change. `close_pane` reaches only `agt-` panes in your own tab or window, never a `/agt-spawn` pane. Worker panes get no tools, so they cannot fan out.

Pane answers never reach the mod's result hook, so a pane worker raises no `⚑`: read the harvest yourself. Still yours: the tmux done-file instruction and isolation, one worktree per slice.

**Who makes the worktree.** In panes mode the lead does, before each `spawn_pane`, with `scripts/agt-worktree.sh` as `factory.md` → "Worktree lifecycle" says. Run it from the main checkout; it re-attaches on a fix round or resume. Pass the printed path as `cwd`. In subagent mode the executor makes its own.
Every executor dispatch states `isolated:` in its task text, never left to the default. Write `isolated: false` on every `spawn_pane`: the lead already made the tree, and `isolated` is an executor input, not a `spawn_pane` field, so it goes in `task`. Write `isolated: true` on an `Agent` executor: it has no `cwd`, and its recipe finds a tree the lead already made.
Pass `branch:` (the slice branch `factory.md` → "Integrate" names, written out) and `base:` with it, so a re-run worker computes the same branch and target.

## Codex workers

Only when the person's task asks for Codex ("codex builds the API slice"); never picked on your own: the mod refuses `vendor: "codex"` unless the typed /agt prompt or the newest typed prompt names Codex. Herdr only, executor only: `spawn_pane { …, agent: "executor", vendor: "codex" }`.
Codex runs on the person's own Codex config (model, sandbox, approvals) and cannot load the agentille executor or the mod.
Its `task` carries the whole contract: the slice, its file set, `isolated: false` with `branch:`/`base:`/`issue:`, the ACCEPTANCE criteria, the executor's Output format with `VERIFICATION:`, and its stop lines `BLOCKED:` and `STUCK:` (`agents/agentille-executor.md`), so a stuck Codex worker never ends on a question.
The mod adds one line telling it to write its report to its answer file. No wire message comes, so the `spawn_pane` result tells you to start `herdr agent wait <name> --until done --until blocked` as a background command: its exit wakes you. Then read the answer file and `close_pane` if the pane is still open.
Review, gate and merge are the same as for a Claude slice. On tmux, or without Codex installed, the spawn is refused: say so in one line and run the slice on Claude.

**Startup prompts.** The mod answers the folder-trust prompt only at the root of your own checkout or of an `agt/*` worktree this lead recorded whose config matches the checkout's (`docs/guards.md`, "Shells and trust"), and skips Codex's update notice. Any other folder, a subfolder included, is trusted by hand once. Any other startup prompt fails the spawn, and the slice runs as a subagent.

## The wire — workers report back on their own

With the mod in both sessions, a worker that finishes a turn saves its full answer to `~/.agentille/state/run-<run>/agents/pane-<role>.<pane>.md` (`<pane>` is the worker's own pane id made filename-safe, e.g. `w1-p3`) and sends you one peer message:

```
[agt wire] agt-<run>-exec-1 done · 1:42 · sonnet medium · 31.2k tok
<the head of its answer>
Full answer: ~/.agentille/state/run-<run>/agents/pane-exec-1.w1-p3.md
```

That message starts your next turn, so after spawning a wave, **end your turn**: no background `herdr agent wait` loop, no polling. Harvest from the message (read the file only when the head is not enough), then `close_pane`. A `blocked` worker needs the person, not you: the band flags it and Herdr notifies. The person can steer a worker with `/agt-tell <worker> <message>`.

Still end your turn after the wave; the mod backs you up:

- A pane flagged `⚑ <name> done, not harvested` (or `idle, not harvested`) is yours to read, then `close_pane`. An `[agt wake]` message names a pane that finished with no wire message, and the command to read it.
- A wave that stays quiet past its expected time needs the read loop below. A blocked pane gets no wake: it waits on the person.
- `spawn_pane` refuses when a newer agentille is installed than this session runs (restart Claude Code first), in a session where nobody typed `/agt`, for another run id, and past the run's in-flight limit (at most 60 minutes after the typed `/agt`). The slice then falls back to a subagent.

The wake timing and the in-flight limit: `docs/display.md` and `docs/guards.md` at the plugin root.

No wire message within the slice's expected time (a worker without the mod, a crash): fall back to the read loop below.

## Spawning a worker

Manual recipe, only when the mod is off (Herdr):

```bash
herdr worktree create --branch "feat/<slug>" --base "$BASE" --label "<slice>" --no-focus
herdr pane split --current --direction right --cwd "<worktree>" --env "AGENTILLE_RUN=<run-id>" --no-focus
herdr agent start "agt-<run-id>-exec-1" --kind claude --pane <pane-id>   # id: .result.pane.pane_id
```

`feat/<slug>` stands for the slice branch `factory.md` → "Integrate" names (`fix/<slug>`, or `agt/<slug>` off a feature branch), written out. Then send one prompt: `isolated: false`, `branch:` and `base:`, the task, the profile block, the slice's file set, its verification command, its exit criterion. Spawn the whole wave first, then wait. Never focus.
Names match `[a-z][a-z0-9_-]{0,31}`; keep the run id 6 chars. The `agt-` prefix is the reap authority.

## Harvest, then close

Completion is a read, not a promise:

| State | Meaning | Lead's action |
|---|---|---|
| `working` | actively running | leave alone |
| `blocked` | an approval or question is on screen | surface it to the user at once; never reap |
| `done` | finished, unseen | harvest → close |
| `idle` | ready for input, already seen | harvest → close once its slice is consumed |
| `unknown` | unclassified | never reap; re-read before deciding |

Fallback only, when the wire is silent:

```bash
herdr agent wait "agt-<run>-exec-1" --until done --until blocked --timeout 600000
herdr agent read "agt-<run>-exec-1" --source recent-unwrapped --lines 200
herdr pane close <pane-id>        # only a pane you opened; with the tools live: close_pane
```

If `agent read` cannot recover a full response (alternate screen), ask that worker to write its report to a file and reply with the path.

**Close on harvest.** The moment a worker's output is in hand and nothing depends on it, close the pane: not at a run-end sweep. A finished pane left open looks like a working one.

**Teardown.** Before declaring the run done, every `agt-<run>-*` pane is harvested, then closed (explicit harvest → `close_pane`). Verify the run id lists zero panes (`herdr agent list`, or the tmux list below). Say so on the card's `⚑`/`verify:` only if one survived.

**Backstop.** The mod closes a harvested `agt-` pane that is `idle` or `done`, and flags an unharvested one once: read it, then `close_pane`. It is a net: close after harvest yourself. When it acts and what counts as harvested: `docs/display.md`.

**Never close a pane you did not open.** `agt-` prefix = ownership; panes the user opened are theirs. A `/agt-spawn` pane is never yours to close: the mod closes it once its answer is saved.

## tmux transport

Inside tmux but outside Herdr, same rules (disjoint slices, `agt-` ownership, harvest then reap) with a smaller toolbox: tmux has no per-agent lifecycle, so the worker reports completion itself.

```bash
tmux split-window -d -h -P -F '#{pane_id}' -t "$TMUX_PANE" -c <cwd> \
  -e AGENTILLE_RUN=<run> "$SHELL" -ic 'claude "$@"' agt \
  --model <model> -n <name> -- "<task>"
tmux set-option -p -t <id> @agt <name>
tmux set-option -p -t <id> @agt_vendor claude
tmux set-option -p -t <id> allow-set-title off
tmux select-pane -t <id> -T <name>
```

Keep the `--`, and escape `#` as `##` in `<cwd>`. The lead only sees panes in its own window: `tmux list-panes -a -F '#{pane_id}\t#{@agt}\t#{pane_dead}\t#{window_id}'`. Your pane is `$TMUX_PANE`; a pane with no `@agt` is the user's.

**Done signal.** Each worker's last act is writing `~/.agentille/state/run-<run>/done-<role>`: put that instruction in the slice prompt. The mod polls the file; without it tmux workers never read as done. A pane is `done` when that file exists (written after the mod first saw the pane) or the pane is dead. Delete `done-<role>` before (re)spawning a role.
There is no `blocked` or `idle` state, so reap only on the done file or a dead pane, never on silence. Read an overdue worker with `tmux capture-pane -p -t <id> -S -200` first: an approval prompt looks like "still working". Two leads in one window can reap each other's workers; run one lead per window.

## /agt-spawn — one pane, one routed session

`/agt-spawn "task" [--model sonnet|opus|haiku|fable]` opens one sibling pane on the model you pick (default `sonnet`). Typed only; a one-word lowercase task is refused. It never focuses and shows as `open` in the band. It is not part of any run, so the lead never closes it; the mod closes it once its answer is saved. Reply:
`Opened <name> · <model> · <transport> pane.`, or `No pane transport here: /agt-spawn needs Claude Code running inside Herdr or tmux.`

## Consolidation

Branches, PRs, the ownership check, merge order and tags: `factory.md` → "Integrate". Each slice's worktree stays until the gate decides its outcome, then the lead removes it (`factory.md` → "Worktree lifecycle").

Peers never message each other; everything routes through the lead.

## Cleanup — nothing idle survives

- The lead closes each pane right after harvesting it (`close_pane`), not at a run-end sweep.
- The mod closes finished panes it finds harvested, and sweeps this lead's own at session end. Its timings and rules: `docs/display.md` at the plugin root.

## Failure → degrade

Any failure (no transport, `pane split` refused, `agent start` timing out, a pool of 1) degrades to workflow or subagent waves and prints one line: *"panes unavailable — ran N subagents instead"*. Close panes already opened for this run first; never leave a half-spawned fan-out.

## Cost

Measured on one small task: panes used ~1.12× the fresh tokens of the same workers as subagents (a pane opens at ~55k tokens, a subagent at ~32k). Panes are not a saving; the savings come from routing and handing each worker only its slice. Never print a token count.
