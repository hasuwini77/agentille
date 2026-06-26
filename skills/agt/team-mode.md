# Team mode — when to use it and how to dispatch

> **Authority:** the dispatch decision table in `skills/agt/SKILL.md` is the tie-breaker. This doc is the detail/rationale — if it ever conflicts with that table, the table wins.

The orchestrator picks one of four execution modes per task:

- **subagent** (default, always available) — dispatches roles via the `Agent` tool, results return to the orchestrator. The v1.0 path.
- **workflow** (experimental) — emits a Dynamic Workflow script the Claude Code runtime executes in the background; scripted fan-out with no inter-agent messaging. See `workflow-mode.md`.
- **team** (opt-in, experimental) — uses Claude Code's Agent Teams primitive: each role is an independent Claude session, peers can message each other via `SendMessage`, shared task list. Requires `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` and Claude Code 2.1.32+.
- **solo** — execute inline in this session, no spawn. For trivial tasks (one file mentioned, no architectural verbs).

> **Team vs workflow:** both use the same disjoint-parallelism bar. The split is peer-messaging need — team = peer sessions for adversarial debate or cross-layer coordination (e.g. incident-team hypotheses, competing reviewers exchanging `READY`/`REVIEW` pings); workflow = scripted subagent fan-out where results flow to script variables and no inter-agent messaging is required. If peers don't need to talk, prefer workflow.

## Auto-detection (Stage 1)

> The full Stage 1 fast-path table (rows 1–9, first match wins) is the authoritative source at `SKILL.md` → "Dispatch decision table" Step 1. Reproduce the decision logic inline when dispatching — do not re-read that table at runtime, it is embedded here for reference only.
>
> Short form: flags first (--team/--mode), then profile blocks (enabled=false, defaultMode), then solo heuristic, then verb shortcuts (review/debug), then Stage 2.

## Honesty on a forced team (`--team` / `--mode team`)

A `--team`/`--mode team` flag is a **force** — the user explicitly asked for a team, and that intent is respected. But forcing skips the judgment that would have told them whether a team is actually *warranted*. So before spawning a forced team, run the **disjoint-parallelism heuristic inline** (no LLM, no Stage 2 spawn): does the task decompose into **≥ 2 vertical slices with disjoint file sets that can build at once**? (Same criterion as `classifier.md` → "Team vs subagent honesty"; a competing-hypothesis debug or a multi-pillar review also count as warranted.)

- **Heuristic passes** (real parallelism, or an adversarial debug / multi-pillar review) → the force matched the work. Spawn the team, say nothing extra.
- **Heuristic fails** (sequential work, or a single slice — a team would be *overkill*) → don't obey blindly, but don't override silently either. What happens next is governed by `preTaskQuestioning`:

  - **`always` / `ambiguous-only`** → **ask once** (the question tool). Recommend the downgrade, give the reason, and make forcing the team a one-tap choice. The user decides:

    > *"`--team <template>` here looks like overkill — I don't see ≥2 disjoint slices to build in parallel, so subagent mode would do the same work for ~¼ the tokens. **Downgrade to subagent** (recommended), or **force the team anyway**?"*

    Downgrade → run subagent mode. Force → spawn the team as asked. One question, honor the answer, never loop.

  - **`never`** → the user opted out of questions; honor the force, spawn the team, and emit ONE `honestyLevel`-gated heads-up line instead of asking (never blocks):

    > `team (forced) · <template> — no ≥2 disjoint slices here; subagent mode would've matched this for ~¼ the tokens. Running the team as you asked.`

    `honestyLevel` gating: emit on candid / blunt / high honesty (the default); suppress only when the profile sets the most hands-off honesty level (the user has opted out of advisories too).

This is the deliberate counterpart to auto-mode honesty: in **auto** mode `/agt` *won't* pay the ~4× team tax for parallelism that isn't there; in **forced** mode it surfaces the trade — *asking* when questions are on, *flagging* when they're off — then does exactly what the user chooses. The downgrade prompt is the **one** sanctioned friction on a forced team because it carries real signal (detected overkill); never add per-spawn confirmation beyond it. Surface the resolved outcome on the recon ping (`display.md` → "Frame 2").

## Stage 2 — lightweight Haiku classify

When Stage 1 falls through (row 9), run an inline Haiku call with a tight classification prompt — do NOT spawn the full Opus planner just to get a mode decision. Reserve the planner for actual plan generation.

Send Haiku a short prompt containing the user's task and ask it to return ONLY this JSON:

```json
{
  "mode": "subagent | team | solo",
  "team_template": "feature-team | review-team | incident-team | null",
  "roster": ["agentille:agentille-executor", "agentille:agentille-code-reviewer"],
  "reasoning": "one-sentence why"
}
```

Parse the JSON. If parsing fails, fall back to `mode: "subagent"` and log a one-line note. Never crash on a malformed classifier response. When Stage 2 returns a valid response, use its `roster` directly — do not re-run the heuristic classifier on top of it (authority: `SKILL.md` → "Dispatch decision table" Step 2).

**When the mode hinges on a question, ask it.** Team vs subagent turns on one thing: are there ≥2 independent slices that can build at once? If that's genuinely unknowable from the prompt and the profile's `preTaskQuestioning` permits, don't guess — the lead resolves it in the clarify round (see `SKILL.md` → "Clarify before planning"), and the answer re-resolves the mode. Default the provisional `mode` to `subagent` until clarified; promote to `team` only once the parallelism is confirmed. A borderline team guess that turns out sequential is the exact ~4× waste this orchestrator exists to avoid.

## Pre-flight check (team mode only)

Before dispatching team mode:

1. Verify `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` is set. If not, tell the user:
   > *"Team mode is gated by `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`. Add it to `~/.claude/settings.json` (in the `env` block) or pass `--mode subagent`."*
   …and degrade to subagent mode.

2. Check `claude --version >= 2.1.32`. If older, degrade with: *"Agent Teams requires Claude Code 2.1.32+. Degraded to subagent mode."*

3. Check daily soft cap (see below). If exceeded, prompt once per session.

4. **Display-readiness (non-blocking — hint only, never degrades team mode).** Split panes are driven by Claude Code's own `teammateMode` setting — NOT by anything agentille sets, and NOT by the agentille profile's `team.displayMode` (which is informational only; see below). Detect a mismatch, guide the user **once per session**, then continue regardless:

   - Read four signals: `$TMUX` (inside a tmux session?), `uname -s` (`Darwin` = macOS), whether `tmux` / `it2` are installed, and `teammateMode` from `~/.claude/settings.json`. Panes are *possible* when inside tmux, **or** on macOS with iTerm2's `it2` CLI.

   | Panes possible? | `teammateMode` | Action |
   |---|---|---|
   | yes | `tmux`, or `auto` while inside tmux | **Ready** — say nothing. |
   | yes | unset / `in-process` / `auto` outside tmux | **Hint:** *"Teammates will run in-process (no split panes). To get one pane per teammate, add `\"teammateMode\": \"tmux\"` to `~/.claude/settings.json` — or launch `claude --teammate-mode tmux`."* |
   | no (tmux session absent) | `tmux` | **Hint:** *"`teammateMode: tmux` is set but there's no tmux session — start `tmux` (or use iTerm2 on macOS) before launching Claude so panes can attach."* |
   | no (Windows Terminal / VS Code terminal / Ghostty) | any | **No nag** — panes are unsupported there; teammates run in the lead's terminal (Shift+Down to cycle). |

   Guidance only: never write to `settings.json` yourself, never block, and skip silently if the file can't be read. This is the one pre-flight check that does **not** degrade team mode on failure — pane display is cosmetic, the team still runs.

## Display mode (the split-pane "wow")

Whether teammates appear in separate panes is the **user's** setting, not agentille's — never try to set it from the skill:

- `teammateMode: "in-process"` (and the `"auto"` default outside tmux) → all teammates live in the lead's terminal; cycle with Shift+Down. Works in any terminal.
- `teammateMode: "tmux"` (or `"auto"` while already inside a tmux session) → each teammate gets its own pane. Requires tmux **or** iTerm2 (`it2` CLI) installed.

> **Two settings, don't confuse them.** Claude Code's top-level **`teammateMode`** (in `~/.claude/settings.json`) is the *only* thing that drives panes. The agentille profile's **`team.displayMode`** is informational metadata — it does **not** control Claude Code's display. A user who sets `team.displayMode: "tmux"` and expects panes will be disappointed; always point them at `teammateMode`.

**The recipe that actually opens panes** (macOS or Linux/WSL2):
1. Be **inside a tmux session** (`tmux`, then launch `claude` within it) — or on macOS, use iTerm2 with the `it2` CLI.
2. Set `"teammateMode": "tmux"` in `~/.claude/settings.json`, or launch `claude --teammate-mode tmux`.
3. Spawn the team normally — each teammate opens in its own split pane.

The pre-flight display-readiness check (step 4 above) detects when steps 1–2 are missing and hints automatically, so the user is told at dispatch time rather than left wondering. If they still ask "why no panes?", walk them through the recipe. Split panes are unsupported in VS Code's integrated terminal, standalone Windows Terminal, and Ghostty — there teammates run in-process, which is fully functional, just single-pane.

## Terminal ergonomics (tmux)

For readability when the lead is talking to you, make the lead the dominant pane: `tmux select-layout main-vertical` (lead = large left pane, teammates = small stacked right), or zoom the focused pane with prefix + `z`. In Warp the tmux prefix (Ctrl+b) is frequently intercepted — add `set -g mouse on` to `~/.tmux.conf` to click-focus and drag-resize panes, or use iTerm2 + `tmux -CC` for native panes. Teammate panes do not auto-minimize — `main-vertical` keeps them small during the run. Cleanup is **automatic on session exit** (shared team directories at `~/.claude/teams/{team-name}/` are removed by the runtime). Orphaned tmux panes after an abrupt exit are a troubleshooting edge case only: `tmux kill-session -t <name>` recovers them.

## Team dispatch

The `.claude-plugin/teams/<name>.yaml` files are **agentille's own role manifests** — they tell the orchestrator which roles/counts make up a template. They are NOT Claude Code team config; Claude Code manages shared team state in session-scoped directories and never requires a hand-authored config file.

> **`--plan` halts here.** If `--plan` is set, preview the resolved template's roster + the `~4×` cost in the Mission Brief and **STOP** — do not spawn anyone. The user approves the shape first. See `SKILL.md` → "Run modifier: `--plan`".

You (the orchestrator) are the **team lead**. A team forms the moment you spawn the first teammate — no prior setup step is needed. Given a resolved template:

1. **Record the run start** (mode, team name, teammate count, verb, start timestamp) so you can write the shipped-log line at the end. Keep it in your own context — there is no log hook.

2. **Spawn each teammate** directly with the `Agent` tool:
   - `subagent_type` = the **namespaced** agent def, e.g. `agentille:agentille-executor` (NOT bare `agentille-executor` — that resolves to nothing).
   - `run_in_background: true` so teammates run concurrently.
   - Give each a distinct `name` you can reference (e.g. `exec-1`, `exec-2`).
   - **`team_name` is deprecated** — the field is accepted but ignored by the runtime; the team name is session-derived (`session-` + first 8 chars of session ID). Do not set or rely on it.
   - Spawn `count` instances per role. Prompt = the user's task + the profile context block + which slice of the work this teammate owns. **Assign disjoint file sets** — two teammates editing the same file overwrite each other. Implementation teammates should each take their own git worktree (the executor does this when `isolated: true`, branching off the current branch) so they can't collide even by accident.
   - Give every executor teammate a `checkpoint:` path (`~/.agentille/state/run-<id>/checkpoint-<name>.md`) — it checkpoints at committable boundaries and self-reports context pressure so you can rotate it (see "Context rotation" below).
   - If the template marks `require-plan-approval: true`, tell the teammate to plan first in read-only mode and wait for your approval before implementing; you approve/reject as lead.
   - **Agent-def loading note:** teammate agents honor the def's `tools` and `model` frontmatter; the body is appended to the system prompt. `skills` and `mcpServers` frontmatter are NOT applied to a teammate — but the teammate still loads skills from user/project settings, so agentille's skill-budget approach (below) remains valid.

3. **Coordinate.** **The lead writes zero implementation code in team mode — see `SKILL.md` → "Hard rules".** Teammates message you automatically when they go idle. Use the shared task list (`TaskCreate` / `TaskList`) for dependencies. Wait for teammates; if one is genuinely stuck, steer or respawn it — never implement the work yourself. For build→review overlap, wire the scoped peer channel below (**Pipelined review**) rather than routing every finished piece through yourself.

4. **Synthesize.** When all teammates finish, synthesize the final response and append the shipped-log line (see SKILL.md "Shipped log"). **Do not declare done yet** — teardown is mandatory (see "Teardown" below) and must complete before the run is closed.

### Skill budget — capability without token blowup

A teammate loads skills from the user's/project's settings exactly like a normal session — its agent-def `skills` frontmatter is ignored when it runs as a teammate (see "Agent-def loading note" above). So a teammate executor **can** invoke installed UI-build skills (`impeccable`, `ui-ux-pro-max`, `frontend-design`) on its slice — but if every teammate auto-reaches for heavy skills, the `~4×` team tax balloons further. So the lead **scopes each teammate's skill use in its spawn prompt**:

- **UI-slice executor** → *"You may use `ui-ux-pro-max` and `impeccable` for this frontend slice; do not load other skills."*
- **Backend / non-UI executor** → *"Do not load UI-build skills."*
- **Reviewers** → no build skills; they review.

This is the team-mode counterpart to the executor's "Graceful UI enhancement" rule (`agents/agentille-executor.md`): capability lands on the slice that needs it, silence everywhere else. The budget is guidance in the prompt, never a hard gate — a teammate with no UI work simply never reaches for a UI skill, and a teammate whose context carries no skills list builds with its own design judgment.

### Context rotation — replace a filling teammate, don't let it limp

Teammates self-monitor their context window (`agents/agentille-executor.md` → "Context discipline"): they checkpoint at every committable boundary to the run-scoped file the lead passed at spawn (`~/.agentille/state/run-<id>/checkpoint-<name>.md`), and when context pressure shows they send ONE structured ping instead of pushing through:

```
CONTEXT <name> | high | checkpoint <path> | done <n>/<m> | remaining: <one line>
```

On receiving it, the lead rotates:

1. **Confirm the handoff state.** The protocol's precondition for pinging is that the teammate already finished its in-flight atomic step, committed, and updated its checkpoint — so there is nothing to wait for.
2. **Shut the teammate down** by sending `"finish up and shut down"` and wait for acknowledgment. Reclaim its pane if applicable (see below).
3. **Spawn a successor** — same role, suffixed name (`exec-1` → `exec-1b`) — with: the SAME context-pack slice, the SAME checkpoint path, and the instruction *"Resume from the checkpoint + `git log` on branch `agt/<slug>`; trust them — do NOT re-read or redo completed work."* The successor reuses the existing worktree and branch and occupies the same slot against the 3-parallel cap.
4. The rotation is invisible to the rest of the run — `READY` handoffs, review, and consolidation proceed as if it were one executor.

Why rotation, not `/compact`: a teammate cannot invoke CLI commands on itself, and compaction is lossy summarization at an uncontrolled moment. Rotation through a checkpoint is deterministic — the durable state lives in git + the checkpoint file, not the conversation — and a successor starts with a near-empty window instead of a summarized one. The same protocol doubles as crash recovery: a teammate that dies mid-run gets a successor seeded the same way.

**Lead-side hygiene.** The lead's own window fills too — it receives every report. Keep teammate traffic to the structured handoffs (`READY` / `REVIEW` / `CONTEXT`), persist consolidated run state to the run directory instead of holding it in-window, and never pull a teammate's diff into your own context — you read verdicts, not patches.

**Reclaiming a pane mid-run (optional, not the default).** This guidance applies **mid-run only** — at run end every pane is closed unconditionally (see "Teardown" below). Mid-run: when running in tmux (`$TMUX` is set) and a teammate's slice is **fully merged, has a `PASS`, and has no remaining dependent work**, ask the teammate to shut down and collapse its pane via `tmux kill-pane -t <id>` to reclaim space. Do **not** blanket-close teammates the moment they go idle mid-run — an idle teammate mid-run is usually still needed for a later step. When in doubt, leave it until run end and let teardown handle it. Never kill `$TMUX_PANE` (the lead's own pane). Only applicable in tmux; skip silently in in-process mode.

### Pipelined review (overlap phases)

Don't gate review behind "all executors done" — review each finished piece while the rest are still being built. It's the biggest wall-clock win in team mode and costs nothing extra in tokens: each piece is reviewed exactly once either way.

Wire it with a **scoped peer channel** — the sanctioned peer channel for build→review overlap (the incident-team adversarial debate is the other permitted case). Open chatter is banned: every message is context paid by both sender and receiver, so peers exchange exactly one structured handoff, nothing more.

1. When you spawn the executors, tell each the **name of the code-reviewer** and the handoff format. On integrating its piece, an executor sends the reviewer ONE message:
   ```
   READY <piece> | branch agt/<slug> | base <BASE> | files <list> | verified <cmd>:<result>
   ```
2. Tell the reviewer to expect incoming `READY` pings and review each diff (`git diff <base>..agt/<slug>`) the moment it arrives — NOT to wait for all pieces. It replies to BOTH the executor (so fixes start immediately) and you (the lead):
   ```
   REVIEW <piece> | PASS        — or —        REVIEW <piece> | ISSUES: <numbered>
   ```
3. You (lead) synthesize only once every piece has a `PASS`. A late piece never stalls review of an early one.

Scope guard: ONE `READY` per piece, ONE `REVIEW` back (plus one rev if `ISSUES`). Anything beyond the handoff routes through you — peers do not free-form chat.

### Consolidation — merge back to the current branch, never `main`

Worktrees fork from `$BASE = $(git symbolic-ref --short HEAD)` — the user's *current* branch, which may be `main` or a feature branch. The lead consolidates finished work back onto `$BASE`; it NEVER assumes `main`.

1. Once a teammate's piece has a `PASS`, merge its branch into `$BASE` **locally and sequentially** (one at a time — disjoint file sets make these clean, and serializing avoids index races):
   ```bash
   git checkout "$BASE" && git merge --no-ff "agt/<slug>" -m "merge: <piece>"
   git branch -D "agt/<slug>"        # delete scaffolding; never push agt/* branches
   ```
2. Resolve the **integration target** for `$BASE` (precedence: `--integration` flag → repo `.agentille/config.json` `{"integration": …}` → profile `projects[].integration` → `auto`):
   - `pr` — open a PR from `$BASE` (only when `$BASE` is meant for `main`). Never `--base main` unless explicitly chosen.
   - `push` — push `$BASE` to its own remote tracking branch and stop. **Default when `$BASE` ≠ `main`.**
   - `local` — leave consolidated work on `$BASE`; no remote.
   - `auto` — `$BASE` is `main`/`master` → today's behavior (PR if `gh`+GitHub, else push). `$BASE` is any other branch → **push `$BASE` only**, never scaffolding, never `main`.

This keeps the parallel split-pane build on any branch while respecting "work on my own branch, don't merge to main yet."

### Incident-team special case

For `incident-team`, override the executor prompts with adversarial framing. Generate 3 distinct hypotheses by reading the failing symptom, then assign one per executor:
- Teammate 1: "Investigate hypothesis A: [hypothesis]. Adversarially challenge teammates B and C."
- Teammate 2: "Investigate hypothesis B: [hypothesis]. Adversarially challenge teammates A and C."
- Teammate 3: "Investigate hypothesis C: [hypothesis]. Adversarially challenge teammates A and B."

The lead picks the surviving hypothesis after the debate.

Once the surviving hypothesis lands a fix, gate it like any other change: dispatch a one-shot **code-reviewer subagent** on the fix diff (tiered model per `model-routing.md`). The incident template carries no reviewer teammate, but a fix never ships unreviewed — this mirrors the subagent-mode rule (`roster.md` → debug: promote to bugfix flow once a fix is applied).

## Teardown

> **Cross-ref target for `display.md` and `SKILL.md`.** Teardown is **mandatory and verified** — it is not advisory and it is not optional. The lead MUST complete this checklist before declaring the run done.

**Mid-run vs run end — the critical distinction.**
- **Mid-run:** an idle teammate may still be needed for a later step — the "leave it until run end" guidance in "Reclaiming a pane mid-run" above applies *here only*. Do not shut teammates down preemptively unless their slice is fully done and they have no remaining dependent work.
- **At run end:** this changes completely. An idle or spinning teammate at run end is an **orphan**, not "still needed". Every spawned teammate — active, idle, or spinning — shuts down. No exceptions.

**Mandatory teardown checklist (run end only):**

1. **Shut down EVERY teammate spawned this run, by name** — not only the ones that happened to report finished. Send `"finish up and shut down"` via `SendMessage` to all of them (dispatch in parallel; wait for acknowledgments). The roster you recorded at spawn start (step 1 of "Team dispatch") is your authority — shut down every name on it.

2. **Verify each shutdown — that the session actually ended, not just that it replied.** Wait for an acknowledgment from each teammate. Do not assume a teammate that went quiet has shut down — silence is not confirmation. A teammate that does not acknowledge within a reasonable window is treated as still running. Confirmation means the teammate's session is *gone* (its pane closes on its own / its underlying process exits) — not merely an "ok": a background agent runs as its own process, and that process can acknowledge and still linger, or (if it was already orphaned by an earlier pane/server kill) never receive the request at all.

3. **Force-close a persistent pane ONLY after its graceful shutdown — never first, never the server (tmux only).** Order is non-negotiable: the `SendMessage` shutdowns (steps 1–2) MUST complete *before* any tmux manipulation. Killing a teammate's pane — or the tmux server — *before* it acknowledges **orphans** it: the underlying agent process keeps running headless (each holds hundreds of MB of RAM, and it may even respawn the team's socket), and it can no longer read its mailbox, so a later shutdown request is silently swallowed. So: only after acknowledgments are collected, if `$TMUX` is set, list the team's panes and `tmux kill-pane -t <id>` any non-lead pane that still persists — then **confirm the underlying process actually exited** (a pane vanishing is not proof; an orphan can outlive its pane). **Never kill `$TMUX_PANE`** (the lead's own pane). **Never `tmux kill-session`, and never `tmux kill-server`** — both orphan live agent processes wholesale instead of terminating them, and `kill-server` additionally destroys unrelated teams and sessions sharing the server. They are the opposite of teardown. Skip this step silently in in-process mode (no `$TMUX`).

4. **Record the teardown outcome in the Debrief `team:` row** (see `display.md` → "Frame 5"). This row is **required** in team mode — it is the proof teardown happened. Report the actual outcome:
   - Clean: `team: ✓ 3 teammates shut down · panes collapsed to lead`
   - Orphan force-closed: `team: ⚠ exec-2 was still spinning — force-closed its pane`
   - Pane couldn't be closed: `team: ⚠ exec-2 pane left open — close manually`
   Surface orphans; never hide them by omitting the row or reporting clean when it wasn't.

5. **Declare done** and return the final summary only after the above steps complete.

**Guard rails:** if a teammate is wedged and won't respond, force-close its pane if in tmux; report the orphan in the `team:` row and declare done — never hang indefinitely. A teammate must never run cleanup itself — its team context may not resolve. Shared team state (`~/.claude/teams/{session-name}/`) cleans up automatically when the session exits; no manual file deletion is needed. **If you find agent processes already orphaned by an earlier abrupt teardown** (live agent processes with no pane — e.g. after a `kill-server`), do **not** blind-kill them by PID: unrelated live sessions run the same binary, so killing the wrong PID closes a session in use. A graceful shutdown can't reach a teammate whose mailbox is already detached, so such orphans clear only when the session that spawned them exits — surface them in the `team:` row rather than guessing at PIDs.

## Failure → degrade

If team spawn fails for any reason (env var unset mid-flight, agent-type not found, max teammates exceeded, etc.), fall through to subagent dispatch and log one line after: *"team unavailable — ran N subagents instead"*.

## Daily soft cap

Track team-mode invocations per 24h in `~/.agentille/state/runs.jsonl` (append one JSON line per run). Before executing team mode, count runs in the last 24h. If count >= `profile.team.dailySoftCap` (default 10) AND the user has not been warned this session, show:

> *"You've run N team-mode tasks today (cap: M, set in profile). Continue? [Y/n]"*

Suppressible with `--yes` or by setting `dailySoftCap: 0`. After execution, append the run record.

**Hardening note:** the orchestrator must write the shipped-log line and the `runs.jsonl` record using the **Write tool**, NEVER a shell command containing arithmetic expansion (e.g. `$(( ... ))`) or other constructs that can trigger a Bash safety prompt — that would stall the lead and violate the "logging never blocks the user" contract. If a log write would prompt or fail, skip it silently.

## Cost transparency

Team mode uses ~4× the tokens of subagent mode (each teammate is a separate Claude session with its own context). Surface this in the **Mission Brief header** (see `display.md`) rather than as a standalone line — the header carries the squad and the cost together:

> `agentille ▸ team · <template> ▸ ~<est>m · ~4× tokens`

Do NOT prompt the user for confirmation per spawn — friction with no signal. Only two frictions are sanctioned, both because they carry real signal: the **daily soft cap**, and the **forced-overkill downgrade prompt** (see "Honesty on a forced team"). Nothing else.
