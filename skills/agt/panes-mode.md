# Panes mode — workers are panes, not nested agents

Same brain as every mode (roster and routing in `routing.md`, gates in `SKILL.md`), but each worker is a **sibling pane running a real Claude session**. The transport is **Herdr** or **tmux**, picked by the agentille mod and injected into `/agt` as a `## Pane transport` block. A multiplexer tracks one agent per pane, so pane workers have a readable lifecycle and can be closed deterministically. `--mode herdr` is an alias for `--mode panes`.

## When panes open

Panes only for ≥2 disjoint slices that build at once, `--mode panes`, or `/agt-spawn`. Only the executor (one per slice) and the adversary may be panes. Planners, plan-reviewers, the ui-prototyper and ALL reviewers are always subagents; a single executor is a subagent. `--mode subagent` means no panes. No pane transport: workflow if the `Workflow` tool exists, else subagent waves (`workflow-mode.md`).

Pre-flight (the mod probes this once; manual equivalent): inside Herdr (`HERDR_ENV=1`, `herdr` on PATH) or tmux (`$TMUX`, `tmux` on PATH), Herdr first. Otherwise fall through silently. Never drive a session from outside one.

## Pool size

`poolSize = min(slices, resourceCap)`, `resourceCap = clamp(min(floor(freeRAM_MB / 700), max(2, cores - 2)), 2, 12)`. A vendor session is ~500–700 MB resident. At most 3 executors run at once (`SKILL.md` → "Hard rules"); queue the rest as waves. A pool of 1 means subagent mode.

## Through the mod's tools

When the `## Pane transport` block says the tools are live, open every claude worker with `mcp__agentille__spawn_pane` and close it with `mcp__agentille__close_pane`, on Herdr and tmux alike:

```
spawn_pane { run: "<run-id>", role: "exec-1", agent: "executor", header: "[agt run=<run-id> size=small mode=build]", cwd: "<worktree>", task: "<full slice prompt>" }
→ Opened agt-<run-id>-exec-1 · sonnet · medium · herdr pane.
close_pane { name: "agt-<run-id>-exec-1" }
→ Closed agt-<run-id>-exec-1.
```

The mod routes model and effort from `agent` + `header` through the same table as a subagent (`routing.md` → "Default routing") and ignores any `model` you pass. Roles that must stay subagents are denied with the reason; run them as subagents. A failed pane falls back to a subagent.

Layout is the mod's call: the first worker splits right of the lead; later workers stack below the previous worker. Each worker pane's own band shows a small mascot (hello, working, bye) drawn by the mod at zero model tokens. The lead's band lists every worker as a `▣` row beside its `◇` subagents, with the tool the worker is running and its tokens, and Herdr's sidebar labels each worker by role and model.

The mod enforces the `agt-<run>-<role>` name (32 chars max), no duplicate name, an absolute existing `cwd`, no focus change. `close_pane` reaches only `agt-` panes in your own tab or window, never a `/agt-spawn` pane. Worker panes get no tools, so they cannot fan out.

Pane answers never reach the mod's result hook, so a pane worker raises no `⚑`: read the harvest yourself. Still yours: isolation (one worktree per slice) and the tmux done-file instruction.

## The wire — workers report back on their own

With the mod in both sessions, a worker that finishes a turn saves its full answer to `~/.agentille/state/run-<run>/agents/pane-<role>.md` and sends you one peer message:

```
[agt wire] agt-<run>-exec-1 done · 1:42 · sonnet medium · 31.2k tok
<the head of its answer>
Full answer: ~/.agentille/state/run-<run>/agents/pane-exec-1.md
```

That message starts your next turn, so after spawning a wave, **end your turn**: no background `herdr agent wait` loop, no polling. Harvest from the message (read the file only when the head is not enough), then `close_pane`. A `blocked` worker needs the person, not you: the band flags it and Herdr notifies. The person can steer a worker with `/agt-tell <worker> <message>`.

Still end your turn after the wave; the mod backs you up. It never closes a pane whose answer is unharvested (it flags it `⚑ <name> done, not harvested`), and if a pane finishes or blocks and no wire message arrives within ~20 s it sends you one `[agt wake]` message naming the pane and the read command (`herdr pane read <pane-id> --lines 200`, or `tmux capture-pane -p -t <id> -S -200`). Harvest from that, then `close_pane`.

No wire message within the slice's expected time (a worker without the mod, a crash): fall back to the read loop below.

## Spawning a worker

Manual recipe, only when the mod is off (Herdr):

```bash
herdr worktree create --branch "agt/<slug>" --base "$BASE" --label "<slice>" --no-focus
herdr pane split --current --direction right --cwd "<worktree>" --env "AGENTILLE_RUN=<run-id>" --no-focus
herdr agent start "agt-<run-id>-exec-1" --kind claude --pane <pane-id>   # id: .result.pane.pane_id
```

Then send one prompt: the task, the profile block, the slice's file set, its verification command, its exit criterion. Spawn the whole wave first, then wait. Never focus. Names match `[a-z][a-z0-9_-]{0,31}`; keep the run id 6 chars. The `agt-` prefix is the reap authority.

## The lifecycle state machine — harvest, then reap

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

**Backstop (the mod).** It closes an idle `agt-` pane only while the lead has no turn running, and a `done` pane after ≥90 s, and only once that pane is harvested: its answer file `agents/pane-<role>.md` exists, its wire done message reached you, or you closed it. An unharvested pane stays open and is flagged once (`⚑ <name> done, not harvested`): read it, then `close_pane`. It never touches `working`, `blocked` or `unknown`, nor a pane without the `agt-` prefix. It is a net, not the plan; explicit close after harvest stays mandatory.

**Never close a pane you did not open.** `agt-` prefix = ownership; panes the user opened and `/agt-spawn` panes are theirs.

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

**Done signal.** Each worker's last act is writing `~/.agentille/state/run-<run>/done-<role>`: put that instruction in the slice prompt. The mod polls the file; without it tmux workers never read as done. A pane is `done` when that file exists (written after the mod first saw the pane) or the pane is dead. Delete `done-<role>` before (re)spawning a role. There is no `blocked` or `idle` state, so reap only on the done file or a dead pane, never on silence, and `tmux capture-pane -p -t <id> -S -200` an overdue worker first: an approval prompt looks like "still working". The backstop closes after `done` holds 90 s. Two leads in one window can reap each other's workers; run one lead per window.

## /agt-spawn — one pane, one routed session

`/agt-spawn "task" [--model sonnet|opus|haiku|fable]` opens one sibling pane on the model you pick (default `sonnet`). Typed only; a one-word lowercase task is refused. It never focuses, shows as `open` in the band, and is never reaped (role `spawn` is exempt from teardown and the backstop): the user closes it. Reply: `Opened <name> · <model> · <transport> pane.`, or `No pane transport here: /agt-spawn needs Claude Code running inside Herdr or tmux.`

## Consolidation

Worktrees fork from `$BASE = $(git symbolic-ref --short HEAD)`, the user's current branch; the lead never assumes `main`. Once a slice has a `PASS`, merge it into `$BASE` locally and one at a time:

```bash
git checkout "$BASE" && git merge --no-ff "agt/<slug>" -m "merge: <piece>"
git branch -D "agt/<slug>"        # scaffolding; never push agt/* branches
herdr worktree remove --workspace <id> --force   # Herdr only
```

Integration target, by precedence: `--integration` flag → repo `.agentille/config.json` `{"integration": …}` → profile `projects[].integration` → `auto`. `pr` opens a PR from `$BASE` (never `--base main` unless chosen); `push` pushes `$BASE` only (default when `$BASE` ≠ `main`); `local` stays local; `auto` = PR on `main` with `gh`+GitHub, else push `$BASE`.

**Subagent runs** pipeline review the same way: review each finished piece while the others still build. Peers never message each other; everything routes through the lead.

## Failure → degrade

Any failure (no transport, `pane split` refused, `agent start` timing out, a pool of 1) degrades to workflow or subagent waves and prints one line: *"panes unavailable — ran N subagents instead"*. Close panes already opened for this run first; never leave a half-spawned fan-out.

## Cost

Measured on one small task: panes used ~1.12× the fresh tokens of the same workers as subagents (a pane opens at ~55k tokens, a subagent at ~32k). Panes are not a saving; the savings come from routing and handing each worker only its slice. Never print a token count.
