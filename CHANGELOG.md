# Changelog

All notable changes to agentille are documented here.

## [1.21.1] — 2026-05-29

### Fixed

- **README said "Opus classify" where v1.21.0 shipped Haiku.** The public-surface and orchestrator-contract changes landed in parallel; the README's "Subagents vs teams" section still described Stage 2 as an Opus classify in two places (and contradicted its own "What you get" line, which already credited Haiku with task classification). Corrected both to the lightweight inline Haiku classify that actually runs.
- **README polish:** the "What a run looks like" example was stamped `v1.20.0` (now `v1.21.0`) with an `~8m` header estimate against a `2m 11s` result (aligned to `~3m`); the shipped-log note now says the line is *written to the working tree* (commit or gitignore) rather than "committed by default", which the orchestrator doesn't do on the user's behalf.

## [1.21.0] — 2026-05-29

### Added

- **Lead-never-implements is now a hard rule (team mode).** The only guard against the lead writing code itself was a buried half-sentence in `team-mode.md` step 4. In practice the lead would do solo work before any teammate spawned. `SKILL.md` → "Hard rules" now states it outright: in team mode the lead does recon → classify → plan → spawn → coordinate → consolidate → teardown and writes **zero** implementation code — all of it is delegated to executor teammates. `team-mode.md` step 4 elevates the rule from an aside to a bolded leading sentence.
- **A pre-spawn planning signal on the Transit Rail** (`display.md`). The lead runs recon + classify + plan + plan-review *before* `TeamCreate`, so the user saw the lead "doing stuff for a while" with no panes. The rail now signals that window explicitly (🔵 planning → 🟢 team spawns once slices are defined) so it reads as planning, not the lead soloing the build.
- **README now shows a real run.** A "What a run looks like" section with a full terminal example (Mission Brief → LED pings → diff-fence review verdict → Debrief), a team-mode env/version Quickstart callout, and an honest cost/speed line. Previously the README only *described* a run.
- **Init quick-setup path.** `agentille-init` now offers **Quick** (≈5 essentials + sane defaults, expandable later via `--reconfigure`) vs **Full** (all 22) on a fresh install, with a length estimate and a per-question skip affordance — the 22-question wall was a first-run bail point.

### Changed

- **Stage 2 classification moved to inline Haiku** (was a full Opus `agentille-planner` spawn). Every task that fell through the Stage 1 fast-path paid an Opus cold-start just to return a `{mode, roster}` JSON — violating `model-routing.md`'s own "classifier: heuristic/Haiku, no Opus" rule. The Opus planner is now reserved for actual plan generation. Synced across `team-mode.md`, `model-routing.md`, `SKILL.md`.
- **Plan-review skip-tier.** A ≤3-step, all-sequential plan (no parallel slices to coordinate) now skips plan-review even in team mode — there is no parallel-safety risk for it to catch. Cuts a full review round-trip off the critical path on simple runs. Still runs for ≥4 steps or any parallel/cross-cutting plan; still skipped on `thinkingDepth=quick`.
- **Parallel teardown.** Teammate shutdowns are now sent to all teammates at once, then awaited together before `TeamDelete` — O(N) serial conversations → O(1) + wait-for-slowest. All existing guards (capture pane IDs first, never kill `$TMUX_PANE`/lead, skip silently in-process) preserved.
- **Documentation collapsed to single sources of truth.** The Stage 1 dispatch table lived in both `SKILL.md` and `team-mode.md` (already drifting); `team-mode.md` now cross-refs SKILL.md's authoritative table. The `classifier.md` "Team vs subagent honesty" section is trimmed to just the disjoint-parallelism criterion (policy lives in SKILL.md/team-mode.md). `roster.md` no longer re-states model names (owned solely by `model-routing.md`). The `SKILL.md` classifier-authority contradiction (Stage 2 roster vs `classifier.md`) is reconciled. Hard rules that were fully specced elsewhere collapse to one-sentence + cross-ref. Dead `model-routing.md` "minimize cost" section (a non-existent profile field) removed.

### Fixed

- **`/agentille-init` command string.** Two places in `SKILL.md` told users to run `agentille init` — wrong on two counts (no slash, no hyphen). A user copying the error got a shell error. Now `/agentille-init`.

### Rationale

Launch-hardening pass before open-sourcing. Three threads: (1) close the lead-implements gap the user hit directly — the lead is a coordinator in team mode, full stop; (2) cut the avoidable team-mode latency (Opus-classify, always-on plan-review, serial teardown) while being honest that session-startup + plan-before-build + ~4× tokens are inherent and only pay off when parallel slices are long; (3) make the public surface legible to a stranger — a README that *shows* a run, a marketplace listing that matches reality, a first-run that doesn't open with a 22-question wall, and a contract a cold reader can follow without hitting a self-contradiction.

## [1.20.0] — 2026-05-29

### Added

- **`agentille-claude-md` — a CLAUDE.md tune-up skill.** Reads a CLAUDE.md, applies a fixed "less is more" rubric, and proposes a leaner rewrite with a per-line cut-list (each cut tagged `vague` / `inferable` / `duplicate` / `default-restated`). Non-destructive by contract: it shows the rewrite + cut-list + before→after line counts, backs the original up to `<file>.bak`, and writes only on explicit approval. Defaults to the global `~/.claude/CLAUDE.md`; pass a path to tune a project `./CLAUDE.md`. Runs entirely locally — it never transmits the file. The rubric's point 7 preserves identity/personal context verbatim, so trimming targets bloat, never the person.
- **`agentille-init` now offers the tune-up.** After writing `profile.json`, init asks once (opt-in, only when a global CLAUDE.md exists) whether to tune it up, then hands off to `agentille-claude-md`. It's a plain prompt — no new wizard field, no `schemaVersion` bump.

### Rationale

The init wizard captures a rich voice profile, but that only ever benefits `/agt`. Meanwhile users accumulate bloated global CLAUDE.md files that every session reads. `agentille-claude-md` is the missing piece: a safe, opinionated way to get any CLAUDE.md to a lean, high-signal state. It deliberately "improves what's there" rather than generating from the profile, and it never overwrites without a diff + backup + approval.

## [1.19.0] — 2026-05-28

### Added

- **Mandatory team teardown — the run now collapses back to a single pane.** Previously the lead's final step was hand-waved as "shut teammates down and ask the lead to clean up the team," and `team-mode.md` even documented the symptom as accepted behavior ("teammate panes do not auto-minimize when idle"). The result: the lead finished and wrote the shipped-log, but N teammate Claude sessions sat alive idling in their tmux panes — some mid-`forging`, some parked at a permissions prompt — leaving the user staring at a wall of open panes wondering whether the run actually finished. The new **Teardown sequence** (`team-mode.md` → "Teardown") makes it concrete and mandatory before the lead declares done: capture each teammate's `tmuxPaneId` from `~/.claude/teams/<team>/config.json` **first** (TeamDelete removes that file), shut each teammate down (shutdown is conversational — no tool unilaterally kills a teammate), `TeamDelete`, then `tmux kill-pane -t <id>` each captured pane so the screen collapses to the lead alone.
- **A `team:` row in the Debrief** confirming the collapse (`team: ✓ 3 teammates shut down · panes collapsed to lead`, or `⚠ exec-2 pane left open — close manually`) — positive confirmation the team is gone, since a quiet screen of idle panes otherwise reads as "did it finish?".
- **Structural validator + CI** (`scripts/validate.sh`, `.github/workflows/validate.yml`, installable `pre-push` hook). A linter — *not* a behavioral test of dispatch — for the failure classes a markdown-prompt plugin actually ships: version drift (plugin.json ↔ CHANGELOG), an accidentally-versioned `marketplace.json`, broken `agentille:agentille-*` references, dangling doc `→ "Section"` cross-refs, a missing/non-executable hook script, and PII leaks (absolute paths, emails) into a public repo. The PII scan is pattern-based by design — it never hardcodes the private names it guards against, since the script itself is world-readable. CLAUDE.md's verification rule is split accordingly: behavioral checks stay "run a task through `/agt`"; structural checks are now enforced.

### Changed

- **Pane teardown targets panes by ID, never `tmux kill-session`.** In split-pane mode teammates are panes in the lead's *own* tmux session, so the documented generic remedy (`tmux kill-session`) would kill the lead. Teardown kills panes surgically by ID, guards on `$TMUX` (no-op in in-process mode), and never touches `$TMUX_PANE` or the empty-paneId lead entry.
- **Idle ≠ close.** Codified that an idle teammate mid-run is *not* a teardown trigger — it's usually still needed (a later message from the lead, pipelined review, a respawn). The lead may opportunistically reclaim a pane only once a teammate's slice is fully merged + `PASS` with no dependent work left; otherwise panes close at end-of-run teardown. The `TeammateIdle` hook is explicitly rejected as the auto-close mechanism because it fires on every idle, including teammates parked waiting for the lead.

### Rationale

Confirmed against Claude Code's agent-teams docs: teammates never self-terminate, no tool kills a single teammate (shutdown is conversational), and `TeamDelete` does not close tmux panes (orphaned panes are a documented gotcha). So the only correct fix is a lead-driven teardown that the orchestrator actually runs — turning the half-specified "clean up the team" into the explicit, guarded sequence it always needed, with a Debrief line so the user *sees* the team is gone rather than guessing from a screen full of idle panes.

## [1.18.0] — 2026-05-27

### Added

- **The loaded plugin version is now stamped in the Mission Brief header** — `# agentille v<version> ▸ <mode> · …`. The orchestrator derives it from its own skill base-directory path (`.../agentille/<version>/skills/agt`) and prints it verbatim; if the path is unparseable it omits the token rather than guessing. This doubles as a **stale-session tell**: Claude Code resolves a plugin's version once at session start and holds it for the session's lifetime, so a user on an old session now *sees* the old version on the first line of every run and knows to `/plugin update` (or restart) before trusting it. Synced into the team-mode header and cost line.
- **`--plan` dry-run modifier** (`/agt --plan "<task>"`). Orthogonal to mode — it sets a stop point, not a roster. The run goes recon → plan → plan-review and then **halts before any executor or teammate spawns**, emitting the Brief (build/gate/ship shown pending), the plan, the plan-review verdict, and the resolved mode/roster/cost. A plain "go" resumes with that exact plan; anything else revises it first. Pairs with any mode — `/agt --plan --team feature-team "<task>"` previews the team roster + `~4×` cost without spawning. The cheapest guard against "it built the wrong thing."
- **Skill budget for team-mode teammates.** A teammate loads skills from the user's/project's settings exactly like a normal session (its agent-def `skills` frontmatter is ignored when running as a teammate). So a teammate executor *can* invoke installed UI-build skills (`impeccable` / `ui-ux-pro-max`) on its slice — and the lead now scopes that explicitly in the spawn prompt (UI-slice → may use the UI skills; non-UI → none) so capability lands where it helps without every teammate auto-loading heavy skills and inflating the `~4×` tax. New `team-mode.md` → "Skill budget"; executor's "Graceful UI enhancement" section extended to team mode.
- **A `cost:` row in the Debrief card** capturing the honest dispatch shape (`subagent · 2 exec + 1 review`, or `team ~4× · 4 teammates + 2 reviews`). Explicitly **not** a token integer — a model cannot read its own consumed tokens mid-run, so `display.md` forbids printing a fabricated count and pins the row to the real cost driver (mode + agent count) plus the `~4×` band.
- **Stack-aware skill ladder for UI work.** Building on the skill budget, the executor's "Graceful UI enhancement" now works in two complementary layers: the **design layer** (`impeccable` / `ui-ux-pro-max` / `frontend-design`, unchanged) and a new **framework layer** gated on the *detected stack* — `vercel-react-best-practices` + `next-best-practices` for React/Next, `vercel-react-native-skills` for RN. The two layers don't overlap (correctness/perf vs aesthetics), and a framework skill is never loaded for a stack it doesn't match. Separately, the design-reviewer gains a static **Web Interface Guidelines** pass (`web-design-guidelines`, findings tagged `[WIG]`) alongside its runtime axe-core scan — code-level a11y/interaction patterns axe can't see, kept at the review gate rather than duplicated at build time. All opportunistic: any skill that isn't installed is skipped silently, never a hard dependency.

### Changed

- **The context pack is now a required handoff on planned runs, not an optional optimization.** Previously `SKILL.md` called it "never a hard dependency," which let the lead skip persisting it — so executors re-grepped the repo and paid the N× rediscovery tax decomposition is supposed to avoid. The contract (step 8) now requires the lead to persist the planner's `CONTEXT-PACK` to `~/.agentille/state/run-<id>/context-pack.md` and dispatch each executor with **only its slice**; the read/grep fallback is scoped to standalone, no-planner runs. The planner's rules now mark the `CONTEXT-PACK` mandatory whenever the plan has executor steps.
- **Graceful UI enhancement is corrected for team mode.** The executor's UI-skill section was labeled "(subagent mode)" and assumed "team contexts have no skills list" — wrong per Anthropic's agent-teams doc (teammates load skills from settings). Retitled "(subagent and team mode)" and the fallback now triggers only when there genuinely is no skills list or the lead's budget sanctioned none.

### Rationale

Five threads from one review of where the orchestrator leaks tokens, hides staleness, or under-uses what the platform already gives it. The version stamp closes a recurring failure mode — multiple debugging sessions died on "which version is actually loaded?" — for the cost of one header token. The context-pack enforcement turns a described-but-skippable optimization into the contract it was always meant to be, which is the single biggest token lever in multi-executor runs. Skills-in-teams was a genuine capability left on the table: Anthropic's doc states teammates load skills from settings, so a teammate executor can already use the UI-build skills — the budget just keeps that from inflating the team tax. `--plan` and the honest `cost:` row close the feedback loop on the user's own token spend without ever fabricating a number the model can't measure.

## [1.17.0] — 2026-05-26

### Changed

- **Review roles now tier their model by the size of the work instead of defaulting to Opus.** Two of the three Opus reviewers were paying the premium on work Sonnet clears cleanly:
  - **plan-reviewer → Sonnet by default** (was Opus). A plan critique is a structured checklist — goal correct? coverage? parallel-safe? real verification? Sonnet handles it. It **upgrades to Opus** only for a *large/cross-cutting* plan (≥6 steps, or any step touching shared contracts/architecture). Still skipped entirely on `thinkingDepth=quick`.
  - **code-reviewer → tiered** (was flat Opus). **Sonnet** for a small diff (single file *or* ≤~150 LoC, no cross-cutting/security surface); **Opus** for a large/cross-cutting diff (multi-file logic, public/exported API, or auth/sessions/data-flow/money). Most diffs are small — Sonnet clears them; Opus is reserved for where subtle regressions actually hide.
  - **Unchanged:** `planner` (Opus — direction), `executor` (Sonnet — never downgrade), `security-reviewer` (Opus — costliest miss, and rare), `design-reviewer` (Opus — see below).
  - Synced across `model-routing.md` (new "Tiering the review roles by size" section with exact thresholds), `SKILL.md` Step 3 + token-budget hints, `roster.md`, and `README.md`.

### Added

- **The design-reviewer now reviews only the viewports that matter.** When a task touches frontend and `preTaskQuestioning` permits, `/agt` asks one question up front — desktop only / desktop + mobile / all three — and passes the chosen set to the design-reviewer as `viewports: [...]`. The agent captures a full-page screenshot (and scores the Responsive pillar) **only** for the viewports in scope; a desktop-only review skips two full-page screenshot + vision passes, the single heaviest cost in a UI run. The Responsive pillar is marked `n/a (desktop-only scope)` and excluded from the average when only desktop is in scope.
  - **Safe fallback:** when `/agt` *cannot* ask (`preTaskQuestioning: never`, or no UI surface visible yet) it defaults to **all three** — it never silently *reduces* coverage, because a dropped viewport can hide a regression the user cared about. Narrowing is always the user's explicit call; expanding to full coverage is the safe default.
  - Touches `SKILL.md` (new "Clarify the viewport scope for UI work"), `agentille-design-reviewer.md` (new `viewports` input, scoped capture, conditional Responsive pillar), and the six-pillars rubric.
  - **design-reviewer stays Opus.** Native vision + design judgment is agentille's differentiator; the savings come from *scope*, not from trading down the model.

### Rationale

Anthropic's own cost guidance — reserve Opus for genuine architecture/multi-step reasoning, use Sonnet for the rest — exposed that a typical UI feature run was carrying **four Opus contexts** (planner, plan-reviewer, code-reviewer, design-reviewer) where two were doing checklist-grade work Sonnet does well. Tiering those two by size halves the Opus spend on the priciest runs without touching execution quality or the design differentiator. Separately, always screenshotting three viewports — even for desktop-only apps — was burning the heaviest token line item (full-page vision passes) on output nobody asked for; one clarifying question removes that waste while the all-three fallback keeps coverage safe whenever the user isn't asked.

## [1.16.2] — 2026-05-26

### Fixed

- **The Mission Brief rendered as an uncolored hand-drawn box, and the mode pick as a prose paragraph.** v1.16.0 colorized the rail, but in practice the orchestrator would fall back to improvising a `╔══ MISSION BRIEF ══╗` box-rail and a *"Decisions locked. This is a complex feature+refactor — subagent mode…"* prose paragraph — abandoning the colored channels entirely. Neither form was ever in the spec; the agent invented them (often after seeing `TodoWrite` was unavailable and deciding to "render the brief inline"). `display.md` Frame 1 and the recon-ping section now **forbid** both fallbacks explicitly: the brief is *always* the ` ```yaml ` card, and the decision is *never* narrated in prose. `SKILL.md` is synced to match.

### Added

- **A colored `mode:` row in the Mission Brief card.** The resolved mode (`subagent` / `team` / `solo`) plus its one-clause reason or spine shape now render as a dedicated `mode: <mode>  # <reason>` row inside the yaml card — so the subagent-vs-team decision lands in the richest color channel (key / value / `#` comment = three hues), not buried in the header comment or spilled into prose.

### Rationale

The v1.16.0 spec *described* the colored frames but never *prohibited* the prose-and-box improvisation, and the "skip silently if rendering would block" escape hatch plus an unavailable `TodoWrite` gave the orchestrator room to abandon them. The fix separates the two pillars cleanly — losing the `TodoWrite` spine (Pillar 1) never downgrades the rail frames (Pillar 2) to prose — and promotes the mode decision from a header comment to its own colored row, satisfying both "the brief should actually be colored" and "highlight the mode choice better" in one change.

## [1.16.1] — 2026-05-26

### Fixed

- **The "is it waiting or stalled?" dead air.** While the lead is blocked on a long foreground worker (a slow design review, a still-running executor), no tokens stream and only the harness spinner moves — the run *looks* idle, and the lead used to fill the silence with improvised prose ("waiting on the round-3 design review… I'll be re-invoked when it finishes"). `display.md` Frame 2 now defines a **single 🟡 waiting ping** for that window: one line stating what is still outstanding, what already landed, and the elapsed time — printed once on entering the wait, never on a timer, and never narrated in prose.

### Rationale

The ping cadence covered a station *beginning* (🔵) and *completing* (🟢) but not the multi-minute gap in between, which is the most anxious part of a run. The `🟡 = waiting / soft-blocked` LED already existed in the legend but was only wired to the forced-team case. This closes the gap with the vocabulary already in the contract: the harness spinner says *still alive*; the 🟡 line adds *still alive on what* — replacing an expensive, terminal-looking paragraph with one cheap, legible line.

## [1.16.0] — 2026-05-26

### Changed

- **Colorized the Transit Rail — config-highlight cards.** The Mission Brief, parallel fanout, and Debrief now render as ` ```yaml ` config-highlight fences instead of plain monospace blocks (`skills/agt/display.md`). The terminal's syntax highlighter paints keys, values, and `#` comments in distinct hues, so the static frames carry real multi-color with no ANSI and no theme dependency. The parallel-build fanout — the most-watched moment of a run — gets the richest frame: one colored row per worker.
  - Three complementary color channels, each used where it is strongest: **config-highlight yaml cards** for the static frames (Brief / fanout / Debrief), **`diff` fences** for pass/fail verdicts (green/red audit trail, unchanged), **colored-emoji LEDs** for live progress pings (unchanged).
  - Station glyphs `◉ ◐ ○ ✓` are single-width geometric chars — alignment-safe inside a fence; colored-emoji LEDs stay in ping lines (double-width). Box borders (`╔══╗`) are explicitly dropped: the highlighter colors by token, not column, so a drawn border renders unstyled and fights alignment — the fence's own background is the card.

### Rationale

Purely aesthetic. The rail already used colored-emoji LEDs and `diff`-fence verdicts, but the Brief/fanout/Debrief were uncolored monospace. Claude Code's renderer honors exactly three color mechanisms in assistant output — emoji, code-fence syntax highlighting, and theme accents — never arbitrary ANSI. Config-highlight yaml fences exploit the second to give the static cards a multi-hue palette for free, theme-independent, without breaking the token-discipline cadence (each frame is still drawn once).

## [1.15.0] — 2026-05-26

### Added

- **The mode pick is now visible on every run.** `/agt` already smart-picked subagent vs team vs solo; now it *shows* the pick plus a one-clause reason (the classifier's `reasoning`, or the Stage 1 rule that fired) on the recon ping (`skills/agt/display.md`, `skills/agt/SKILL.md`). The subagent-vs-team decision is transparent instead of implicit.
- **Forced-team honesty + downgrade prompt** (`skills/agt/team-mode.md`, `skills/agt/SKILL.md`). Passing `--team`/`--mode team` is a force. Before spawning, an inline disjoint-parallelism heuristic checks for ≥2 independent slices. With real parallel work the team spawns. When a team would be **overkill** (sequential / single slice), `/agt` no longer obeys blindly: if `preTaskQuestioning` permits it **asks once** whether to downgrade to subagent (recommended, ~¼ the tokens) or force the team anyway, and honors the choice; if questioning is off it honors the force and emits one `honestyLevel`-gated heads-up. One question, no loop — the user always has the final say. The counterpart to auto-mode's 4× honesty rule: in auto mode `/agt` won't overspend on absent parallelism; in forced mode it surfaces the trade before spending.
- **Clarify can decide the mode** (`skills/agt/SKILL.md`, `skills/agt/team-mode.md`). When team-vs-subagent genuinely hinges on whether slices are independent and `preTaskQuestioning` permits, the parallelism question becomes the plan-changing question the clarify pass resolves — its answer re-resolves the mode rather than the orchestrator guessing.

### Changed

- **README and manifest now lead with the smart-pick.** New "Subagents vs teams — `/agt` smart-picks" section mirrors Claude Code's subagent-vs-team distinction (workers report back vs. message each other; ~4× cost), documents how `/agt` chooses, and explains forcing with `--team` plus the honest-override. Tagline, "How it works", and the `plugin.json` description updated (`README.md`, `.claude-plugin/plugin.json`).

### Rationale

Claude Code's agent-teams docs draw a sharp line — subagents report back to the lead; teammates message each other and share a task list — and team mode costs ~4×. agentille already routed by that line, but two things were off: the decision was invisible to the user, and a forced `--team` was obeyed silently even when no parallel work existed. The `--team` flag is intentionally **kept** (not renamed to `--force`): it is self-documenting and already *is* the override; the "you may not need this" intent belongs in the system's honest response, not the flag name. This release makes the pick transparent and keeps `/agt` honest even when the user overrides it — you can always force a team, and if it'd be overkill `/agt` asks before overspending rather than obeying blindly (or, with questioning off, flags the trade in one line).

## [1.14.0] — 2026-05-25

### Changed

- **Lean Teams — token-efficiency & speed overhaul.** A six-part pass to keep each executor's context small (target ≤ ~30%), lower total tokens, cut wall-clock, and preserve the parallel `--team` experience on any branch — without breaking existing behavior.
  - **Executor output discipline** (`agents/agentille-executor.md`): build/test/install output is redirected to a log; only the exit code, failure count, and last ~20 lines enter context, with the full log read only on failure. Closes the biggest context sink — a green build's full stdout was previously held for the rest of the run.
  - **Hardlink dependency clone** (`agents/agentille-executor.md`): adds a `cp -al` tier between the copy-on-write clone and the full-copy/install fallback. On ext4 (common on WSL2), where reflink is unsupported and v1.12.0 silently degraded to a full multi-GB `node_modules` copy per worktree, setup is now instant and near-zero-space. Safe because installed packages are immutable and build tools replace-on-write.
  - **Isolation decoupled from integration target** (`skills/agt/SKILL.md`, `skills/agt/team-mode.md`, `skills/agentille-project/SKILL.md`, `agents/agentille-executor.md`): worktrees stay the default on any branch (preserving the parallel split-pane build); the lead consolidates each worktree branch back into the *current* branch and never auto-targets `main`. A per-repo integration setting (`pr`/`push`/`local`, captured at registration into `.agentille/config.json`) drives where the consolidated branch lands.
  - **Context pack** (`agents/agentille-planner.md`, `skills/agt/SKILL.md`, `agents/agentille-executor.md`): the planner emits a per-step pack (files to touch, minimal files to read, binding conventions, shared contracts); executors read their slice instead of re-grepping the repo, eliminating the N× cold-start rediscovery tax.
  - **Vertical, context-budgeted decomposition** (`agents/agentille-planner.md`, `.claude-plugin/teams/feature-team.yaml`): work is sliced into thin end-to-end vertical capabilities sized to a ~30% context budget instead of horizontal layers; executor count is adaptive to the number of slices.
  - **No redundant per-executor approval; team only for real parallelism** (`.claude-plugin/teams/feature-team.yaml`, `skills/agt/classifier.md`): `feature-team` no longer forces each executor to plan-and-wait (the master plan is already plan-reviewed); the classifier documents that team mode's ~4× token cost is only justified by ≥2 disjoint parallel slices.

### Rationale

A field run showed executors at 60–70% context — caused by full build logs persisting in context, horizontal layer-splits, and cold-start rediscovery, not by reasoning. The fix targets *what enters each context* (output trimming + context pack) and *how work is sliced* (vertical, budgeted), with the confirmed ext4 full-copy regression fixed by hardlinking. Worktrees were also untangled from `main`-centric integration so the parallel experience works for "work on my own branch, don't merge to main yet" repos.

## [1.13.1] — 2026-05-25

### Fixed

- **Split panes silently fail when `teammateMode` is unset** (`skills/agt/team-mode.md`). The most common team-mode footgun: a user inside tmux (WSL2 or macOS) spawns a team and sees no panes, because Claude Code defaults `teammateMode` to in-process and nothing flags it. The team-mode pre-flight now adds a **non-blocking display-readiness check** — it reads `$TMUX`, the OS, installed `tmux`/`it2`, and `teammateMode` from `~/.claude/settings.json`, then hints (once) with the exact fix when panes are *possible* but not *configured*. Verified across both edge cases: WSL2-in-tmux and macOS-with-iTerm2. Guidance only — it never writes settings, never blocks, and never degrades the team (panes are cosmetic; the team still runs).

### Changed

- **Killed the `displayMode` vs `teammateMode` confusion.** The agentille profile's `team.displayMode` looked like it controlled split panes but never did. Documented loudly that it is **informational only** — Claude Code's top-level `teammateMode` is the sole driver (`skills/agentille-init/profile-schema.md`, `skills/agt/team-mode.md`, `README.md`). Added the canonical "recipe that actually opens panes" (tmux/iTerm2 → `teammateMode: tmux` → spawn) to `team-mode.md`.

## [1.13.0] — 2026-05-25

### Added

- **Transit Rail progress display** (`skills/agt/display.md`, new). `/agt` now surfaces its orchestration as a top-to-bottom "transit line" — each phase is a station, the line forks when work runs in parallel — so the user can track what the lead is doing *before* any agent is dispatched. Two pillars: the **TodoWrite spine** (seeded before the first spawn — the live "what's left until we send the agents") and the **rail frames** (a drawn-once Mission Brief, one thin colored-LED ping per phase, a fanout block when the build forks, diff-fence review verdicts, and a compact Debrief). Works identically in subagent and team mode. Presentation only — it changes no classification, roster, model-routing, or dispatch logic, and never blocks the result.

### Changed

- `skills/agt/SKILL.md`: contract step 9 ("stream progress") now points at `display.md` and requires seeding the TodoWrite spine *before* the first dispatch; `display.md` added to the file manifest.
- `skills/agt/team-mode.md`: the ~4× token cost line folds into the Mission Brief header instead of a standalone spawn line.

### Rationale

Token-disciplined by design: the full rail is drawn once, then only one-line pings stream per phase. Color comes from emoji LEDs and ` ```diff ` verdict fences (no raw ANSI — terminals strip it), and the aligned rail stays pure ASCII because emoji are double-width and would break the columns. The user gains visibility into the pre-dispatch work without a board redrawn on every phase.

## [1.12.1] — 2026-05-24

### Added

- **Review findings are a hard gate** (`skills/agt/SKILL.md` hard rules). A code-review / security-review **BLOCKER** or **should-fix** must be resolved before the orchestrator declares the task done — re-dispatch the executor (or fix inline), then confirm; if it genuinely can't be fixed, surface it explicitly for the user, never bury it in the summary. Nits stay advisory. Closes a gap exposed by the v1.12.0 run, where catching the symlink race + ext4 claim depended on lead discretion rather than contract.

## [1.12.0] — 2026-05-24

### Added

- **Copy-on-write dependency reuse in the executor** (`agents/agentille-executor.md`). Worktree setup now COW-clones the parent's `node_modules` (`cp -c` on APFS, `cp --reflink` on Btrfs/XFS) instead of a full per-worktree `pnpm/npm install` — instant, and each worktree gets its own *isolated* tree so parallel agents can't race on `.cache`/`.prisma`/native rebuilds. On non-COW filesystems (ext4) it degrades to a full copy — still isolated, just not instant — and falls back to a real install only when there's no parent to clone. The single biggest wall-clock win for `/agt` runs on JS/TS repos.
- **Scoped pipelined review (overlap phases)** (`skills/agt/team-mode.md`). In team mode, executors hand each finished piece straight to the code-reviewer via one structured `READY → REVIEW` message, so review overlaps the teammates still building instead of "all build, then all review." It is the one sanctioned peer channel — open agent-to-agent chatter stays banned because every message is context paid twice. Subagent mode gets the same overlap by dispatching the reviewer on finished pieces while later executors run (`skills/agt/SKILL.md`).
- **Token-aware task subdivision** (`agents/agentille-planner.md`). New "Right-size the chunks" rules: decompose only for parallelism (disjoint file sets) or tighter per-agent context, never below the break-even where context-reload tokens exceed the work saved; define shared contracts once instead of making each chunk re-derive them. Applies to both team and subagent mode.

### Rationale

Three asks — kill the repeated install, let review overlap building, subdivide tasks — all aimed at the same target: more speed and output per token. The subdivision guidance is deliberately an *anti*-explosion guardrail: naive splitting multiplies context-reload cost, so the planner sizes chunks to the token break-even, not to maximal granularity.

## [1.11.0] — 2026-05-24

### Added

- **Plan-reviewer agent** (`agents/agentille-plan-reviewer.md`, Opus, read-only). After the planner drafts a plan, the plan-reviewer critiques it *before any executor runs* — goal correctness, coverage (the unglamorous half: error states, migrations, tests, docs), parallelization safety (catches false-parallel steps that cause merge conflicts and lost work), real verification, and scope. Returns APPROVE or REVISE-with-specific-gaps; one revise round, then execution proceeds. Wired into the planning / feature / refactor flows; **skipped on `thinkingDepth=quick`**.
- **"Clarify before planning" step** in the orchestrator contract (`skills/agt/SKILL.md`). When `preTaskQuestioning=always` (or `ambiguous-only` + genuine ambiguity), the lead resolves plan-changing unknowns with the user *up front* — explore the codebase to answer what it can, ask only what forks the plan, each question with a recommended default, and **stop once more questions wouldn't change a step**. Deliberately bounded (typically 2–5 questions), not a relentless interview.

### Changed

- `agents/agentille-planner.md`: replaced the "one clarifying question max" rule with a `preTaskQuestioning`-governed clarify approach (explore-first, recommended defaults, surface-don't-block when standalone) plus a "revise on plan-review feedback" rule.
- `skills/agt/SKILL.md`, `roster.md`, `model-routing.md`: dispatch tables, rosters, and model routing updated for the plan-reviewer (Opus default, skipped on quick). Worker-agent count five → six.

### Rationale

The two cheapest places to prevent wasted executor runs are *before* the plan exists (ask the questions that actually fork it) and *before* it executes (review the plan). A wrong or under-scoped plan multiplies across every executor downstream — catching it at the plan stage is far cheaper than in review or in prod.

## [1.10.0] — 2026-05-24

### Added

- **Execution discipline internalized into the executor** (informed by [Jesse Vincent's superpowers](https://github.com/obra/superpowers), MIT — rewritten in agentille's voice, not bundled). Three native additions to `agents/agentille-executor.md`:
  - **Debugging discipline** (debug & bugfix steps): root cause before any fix, find the pattern, one hypothesis tested minimally, fix the root + regression test, and a hard "3 fixes failed → stop and question the architecture" rule. Replaces the previously hand-waved "systematic-debugging prefix" referenced by `roster.md` — the discipline is now real and lives in the agent def.
  - **Test-first discipline** (feature & bugfix logic): red→green→refactor, gated — TDD only when the repo already has a test suite or the profile opts in; never scaffolds a framework unasked, since agentille runs in arbitrary repos.
  - **Sharper verification gate**: step 7 and the hard rules now require *fresh* verification output from the current run before any completion claim — confidence is not evidence.
- `skills/agt/roster.md` debug/bugfix entries now point at the executor's built-in Debugging discipline. README gains an Acknowledgments section crediting superpowers and framing the dispatch-layer/session-layer split.

### Rationale

agentille stays self-contained: methodology is internalized, not depended on. Curated *assets* (design-system skills) are borrowed via graceful enhancement; core *discipline* is owned natively so the orchestrator's value prop doesn't live in another plugin.

## [1.9.0] — 2026-05-24

### Added

- **Graceful UI enhancement in the executor.** When `agentille-executor` runs a UI step in subagent mode, it now looks at its own injected available-skills list and opportunistically invokes installed UI-build skills — `impeccable` (craft), `ui-ux-pro-max` (design system), or `frontend-design` — to sharpen the work. If none are installed, it builds with its own design competence exactly as before. This is progressive enhancement, never a dependency: the gate is "is the skill in my list?", so an absent skill is simply never invoked (nothing to catch or handle). Non-UI work never touches these skills, and team mode is unaffected (teammate skill frontmatter is ignored by design; the list-presence gate handles that path too). Documented in `agents/agentille-executor.md` and `skills/agt/SKILL.md`.

## [1.8.0] — 2026-05-24

### Changed

- **Review agents now run on Opus by default.** `agentille-code-reviewer`, `agentille-design-reviewer`, and `agentille-security-reviewer` moved from `claude-sonnet-4-6` → `claude-opus-4-7`. Review is judgment-heavy and read-only/single-pass (no write-loop), so the token premium is small while the payoff — catching subtle regressions, AI-design-tells, and auth-bypass/injection logic before merge — is high. Aligns the roster with the project's own model-routing rule ("Opus for plan and review, Sonnet for execution"). The executor stays Sonnet.
- **`thinkingDepth = quick` now downgrades reviewers too.** `planner`, `code-reviewer`, and `security-reviewer` drop to Sonnet on a `quick` signal for speed/cost; `design-reviewer` stays pinned to Opus (vision + design judgment is the one role agentille never trades down). Replaces the now-redundant `thinkingDepth = always → upgrade to Opus` note. Updated in `SKILL.md`, `roster.md`, and `model-routing.md`.

### Documentation

- README macOS split-pane setup now tells Warp (and other non-iTerm2) users to actually start a `tmux` session before launching Claude — the panes need an existing session to attach to. Previously only the WSL block carried that instruction.

## [1.7.2] — 2026-05-24

### Changed

- Plugin `displayName` lowercased to `agentille` (was `Agentille`) to match Claude Code plugin-naming convention. Install identifier (`name`) was already lowercase — unaffected.

## [1.7.1] — 2026-05-24

### Documentation

- README Team-mode section reworked — team badges + roster table, and concise cross-platform split-pane setup for macOS (tmux / iTerm2 `tmux -CC`) and Windows WSL2 Ubuntu (tmux-in-WSL, keep repo on the WSL filesystem).

## [1.7.0] — 2026-05-23

### Added

- **Canonical Dispatch decision table** in `skills/agt/SKILL.md` — single authoritative source for mode/roster/model resolution, collapsing logic previously smeared across `team-mode.md`, `classifier.md`, `roster.md`, and `model-routing.md` into three sequential steps (resolve MODE → resolve ROSTER → resolve MODELS). Declares the table as the explicit tie-breaker; resolves the class of dispatch ambiguities found in the v1.6.1 review. Authority banners added to `team-mode.md`, `roster.md`, and `classifier.md` pointing back to the table.
- **`argument-hint` on `/agt` and `agentille-init`** — greyed static hint after the slash command shows valid `--team` templates and flags. Static only; Claude Code has no interactive arg value-autocomplete for skills.

## [1.6.1] — 2026-05-23

### Fixed

- **[CRITICAL] `profile.team.enabled: false` now blocks team-mode auto-promotion.** A default install ships with `enabled: false` but `defaultMode: "auto"`, so verb-matched rules (`review` → team, `debug` → team) silently escalated tasks despite the user opting out. New Stage 1 rule at position 3 makes `enabled === false` authoritative for subagent mode — explicit `--team`/`--mode` flags above it still win.
- **[HIGH] Security-reviewer diff base is now adaptive.** The hardcoded `git diff ... main` base produced a wrong delta on any non-main branch. Reviewer now prefers an orchestrator-provided base, falls back to `git merge-base HEAD <upstream>`, then finally `main`.
- **[HIGH] Stage 2 is explicitly authoritative for both mode and roster.** `SKILL.md` step 2 was ambiguous about whether `classifier.md` or Stage 2's returned `roster` array wins. Clarified: Stage 2 is the authority; `classifier.md` is last-resort fallback on parse error only.
- **[HIGH] `code-reviewer` required-on-refactor now has a carve-out** for pure renames/moves with zero logic delta, consistent with `SKILL.md`'s token-budget hint. Both docs now agree.
- **[MEDIUM] Slug guard added to executor worktree setup.** A bash `[[ "$SLUG" =~ ^[a-z0-9][a-z0-9-]{0,50}$ ]]` guard immediately after SLUG assignment prevents path traversal injected via a crafted task name or `CLAUDE.md`.
- **[LOW] `$PROJECT` variable quoted in `.env` copy.** `cp "../$PROJECT/".env*` correctly handles project names with spaces while preserving the glob.
- **[LOW] `chmod 600 ~/.agentille/profile.json`** added to `agentille-init` after the Write step. The profile can contain writing voice and personal context; it should not be world-readable.
- **[LOW] README executor table row** updated to "integrates adaptively (PR / push / local branch)" — the old "opens a PR" wording was stale since v1.6.0.
- **[LOW] `tone` comment in `SKILL.md`** corrected from `"peer"` to `"peer-to-peer"` (matches the canonical schema value).
- **[LOW] Intentional `tools:` omission documented** on `agentille-executor` and `agentille-design-reviewer` frontmatter so future readers don't add a restrictive allowlist.

## [1.6.0] — 2026-05-23

### Changed

- **Generic, adaptive worktree handling in the executor.** Isolation stays the core (each parallel/team executor gets its own worktree), but it no longer assumes a Next.js-on-`main`-with-PRs workflow:
  - Worktrees branch off the **current** branch (`$BASE`), never a hardcoded `main`.
  - Setup is stack-agnostic — installs only if a `package.json` exists (matching pnpm/bun/npm), skips otherwise (Python/Go/Rust/etc.).
  - **Integration adapts** via an `integration: auto | pr | push | local` flag: open a PR against `$BASE` where a remote + `gh` exist; else just push the branch; else leave commits on a local branch and report how to merge. Never forces PRs or pushes to a protected/shared branch.
  - Cleanup removes the worktree only when commits are safe elsewhere (PR'd or pushed) — local-only work keeps its worktree.
- Verify step is stack-agnostic (no longer assumes `npm`).
- Team dispatch doc: implementation teammates each take their own worktree to avoid file collisions.

This keeps the plugin's worktree support universal (solo-on-main, locked-down team branch, no-remote) while the user's personal, opinionated `/git-workflow` skill (dev server + ports + `/ui-test`, Next.js + main) stays separate and unchanged.

## [1.5.2] — 2026-05-23

### Fixed

- **Teammates now report to the lead** — added `SendMessage` and `TaskUpdate` to the read-only agent allowlists (`agentille-code-reviewer`, `agentille-security-reviewer`, `agentille-planner`) and added a "report to the lead when done" instruction to every worker agent body (`agentille-executor`, `agentille-design-reviewer` included). This is the real fix for team-mode "idle on spawn / never reported" stalls; without it `--team` needed a human to scrape the panes.
- **Prompt-injection hardening** — code-reviewer and security-reviewer now explicitly treat reviewed content (diffs, files, commit messages, comments) as untrusted data, never as instructions, and must never execute shell commands that originate from reviewed content.
- **Shipped-log / runs.jsonl writes must use the Write tool** — shell arithmetic expansion (e.g. `$(( ... ))`) in a log-write command can trigger a Bash safety prompt and stall the lead. The orchestrator and team-mode docs now mandate the Write tool for all log writes and specify skipping silently on failure. Fixes the earlier team-mode hang caused by this pattern.
- **tmux terminal-ergonomics note added** — documents `main-vertical` layout (lead = large left pane, teammates = small stacked right), zoom shortcut (prefix + `z`), `set -g mouse on` for Warp users, and iTerm2 + `tmux -CC` as a native-pane alternative.
- **Minor:** `agentille-init` doc "When to invoke" bullet now references `/agentille-init` (the actual slash command) instead of the plain-text phrase `"run agentille init"`.

## [1.5.1] — 2026-05-23

### Fixed

Follow-ups from an `agentille:agentille-code-reviewer` pass on 1.5.0 (the first review run through the now-working dispatch):

- **Team templates now namespace `lead`/`role`** as `agentille:agentille-*`, matching the dispatch contract — bare names would resolve to nothing.
- `roster.md` review row referenced a bare `design-reviewer`; corrected to `agentille-design-reviewer`.
- `agentille-init` docs called the orchestrator skill `agentille`; updated to the renamed `agt`.
- README setup line said "Eighteen questions"; corrected to the actual 22.

## [1.5.0] — 2026-05-23

### Changed

- **Workers are now real agent definitions, not skills.** The orchestrator dispatched `planner`/`executor`/reviewers via `Agent({subagent_type:"agentille-executor"})`, but those were skills — the Agent tool rejected them ("Agent type not found"), so dispatch silently fell back to a generic agent and the roster was never truly used. The five worker roles now live in `agents/` and dispatch as `agentille:agentille-*`. This is also the only form that works as agent-team teammate definitions (teammates ignore `skills`/`mcpServers` frontmatter).
- **Trigger renamed `/agentille` → `/agt`** — shorter, and no longer near-collides with `/agent`. Setup skills keep their names (`agentille-init`, `agentille-project`); the `~/.agentille/` profile path is unchanged.
- **Team mode rewritten for the real Claude Code primitives.** `team-mode.md` now uses `TeamCreate` + namespaced `Agent` dispatch instead of abstract "spawn" language; documents that the split-pane display is the user's `teammateMode` setting (tmux/iTerm2), not agentille's; clarifies that `.claude-plugin/teams/*.yaml` are agentille role manifests while Claude Code owns the real per-team config.

### Fixed

- **Executor git scope trimmed.** Removed the dev-server/port/`ui-test` overlap with `/git-workflow`; the executor is now explicitly headless (implement → commit → push → PR). Hard git rules preserved.
- Removed the dead `task-completed: agentille-log.sh` hook reference from all three team templates (the shipped-log has been orchestrator-written since v1.3.1).

## [1.4.2] — 2026-05-23

### Fixed

- **Update-check hook hardened** (review follow-ups): validates local/remote versions as dotted-numeric (a malformed remote `plugin.json` can no longer poison the cache or the printed line), suppresses `sort -V`/`mv` stderr so the hook stays silent on minimal systems (BusyBox/Alpine), and drops the moot curl `-S`.
- **Idempotent-init contract gaps closed** (review follow-ups): added a canonical `WIZARD_KEYS` list so absent-key detection is deterministic; a complete-but-unstamped profile now gets a migration-only write instead of limbo; key-presence recurses into `team.*` sub-fields; `useCases`/`neverDo` now specify storing the option `id`; `--reconfigure` keep-vs-clear, fresh-install, and flag-detection semantics defined; dropped the misleading "N of 4" header when only one section is asked.

## [1.4.1] — 2026-05-23

### Fixed

- **`agentille-init` enum values now match the canonical option arrays.** The JSON-shape union types and `questions.md` hints disagreed with the `*_OPTIONS` arrays in `profile-schema.md` (which match real profiles), so the wizard would offer wrong values. Aligned `tone` (`peer-to-peer`), `challengeLevel` (`supportive/balanced/sparring/ruthless`), `disagreementStyle` (`push-back/both-sides/defer`), `thinkingDepth` (`always/complex-only/quick`), and `honestyLevel` (`diplomatic/brutal/default`).

## [1.4.0] — 2026-05-23

### Added

- **`agentille-init` is now idempotent.** Re-running reads the existing `~/.agentille/profile.json` and asks only for fields whose keys are absent (key-presence detection — a present-but-empty field counts as answered). A v1.0/v1.1 profile lacking the `team` object is asked **only** the 3 Section 4 team questions, then stamped.
- **`--reconfigure` flag** re-asks every question across all 4 sections (current values shown as defaults), merging back onto the existing profile so `projects[]` and `selectedPrompts[]` are preserved.
- **`schemaVersion` stamp** (integer, current `2`) as an explicit migration marker; `absent`/`1` = pre-team profile.

### Fixed

- `agentille-init` stops on a malformed existing profile instead of clobbering it; adds an "already complete" early exit.
- Corrected the question count to **22** (9+5+5+3, was mislabeled "21"), fixed section headers ("of 4"), and renumbered Section 4 to Q20–Q22 (previously collided with Section 3).

## [1.3.1] — 2026-05-23

### Changed

- **Shipped log is now written by the orchestrator, not a hook.** The `agentille-log.sh` hook (registered on `TaskCompleted`) is removed. Hooks fire on turn boundaries and can't distinguish a mid-run clarifying question from true run completion, and a model can't export the run-metadata env vars the hook depended on into a hook process. The orchestrator now appends the one-line entry to `./docs/agentille-log.md` directly as its final step. Same log format, same location.

### Removed

- `hooks/agentille-log.sh` and its `TaskCompleted` registration in `hooks/hooks.json` (only the `SessionStart` update-check hook remains).

## [1.3.0] — 2026-05-23

### Added

- **SessionStart update-check hook** (`hooks/agentille-update-check.sh`): fires on every `startup` event, checks GitHub for a newer version once per day (TTL-cached in `~/.agentille/.update-check.json`), and prints `agentille <remote> available (you're on <local>) — run /plugin to update` when a newer semver is available. No-op on network failure or equal versions.

### Fixed

- **Hooks relocated to plugin root** (`hooks/`): Claude Code auto-loads plugin hooks only from `<plugin-root>/hooks/hooks.json`. The previous location (`.claude-plugin/hooks/`) was never loaded, making the shipped-log hook dormant since v1.0. Files moved with history preserved (`git mv`).
- **hooks.json rewritten to canonical format**: old file used a non-standard `args` key and bare event keys. New format uses the documented `{ "hooks": { "<Event>": [ { "matcher": "...", "hooks": [ { "type": "command", "command": "..." } ] } ] } }` shape. Both `SessionStart` (update-check) and `TaskCompleted` (log) hooks are now correctly registered.

## [1.2.0] — 2026-05-23

### Added — Team mode

- **Agent Teams support** via Claude Code 2.1.32+ experimental primitive. Auto-detected; opt-in via `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`.
- **Three team templates** under `.claude-plugin/teams/`:
  - `feature-team` — cross-layer feature with parallel code + design review
  - `review-team` — parallel code + design + security review
  - `incident-team` — competing-hypothesis debugging (3 adversarial executors)
- **agentille-security-reviewer** — new skill, read-only severity-classified review for security issues (secret leaks, injection vectors, auth bypass, deserialization, CSRF/XSS, dependency CVEs).
- **Two-stage classifier**:
  - Stage 1 (fast-path, no LLM): flags > profile defaultMode > verb match > trivial → solo. See `skills/agentille/team-mode.md`.
  - Stage 2 (planner-classify): for ambiguous prose, planner returns structured `{mode, team_template, roster}` JSON.
- **Shipped log hook** (`.claude-plugin/hooks/agentille-log.sh`): appends one line per completed run to `./docs/agentille-log.md`. Registered on `TaskCompleted` via exec-form args.
- **agentille-init Section 4** (3 new questions): enable team mode, default mode, max teammates. Existing profiles without a `team` section default to `enabled: false`, so existing users see no behavior change.

### Backward compatibility

- Profiles without a `team` section default to v1.0 subagent behavior. No migration needed.
- Setting `team.defaultMode = "subagent"` makes the orchestrator skip team-mode auto-pick entirely — Stage 1 short-circuits to subagent on every task.
- Team mode requires Claude Code 2.1.32+ and the experimental env var. If either is missing, the orchestrator degrades to subagent mode silently with a one-line log note.

## [1.0.0] — 2026-05-22

### Added
- Initial release as a Claude Code plugin.
- 7 skills under the `agentille:` namespace:
  - `agentille` — master orchestrator
  - `agentille-init` — global profile setup
  - `agentille-project` — per-repo CLAUDE.md
  - `agentille-planner` — goal-backward planner
  - `agentille-executor` — implementation subagent
  - `agentille-code-reviewer` — bugs/security/quality review
  - `agentille-design-reviewer` — 6-pillar visual + a11y + AI-tells review
- Install via `/plugin marketplace add hasuwini77/agentille`.

### Migrated from npm
- The legacy `agentille` npm package (v0.2.0 – v0.7.3) is deprecated.
  Install instructions moved to the Claude Code plugin marketplace.
- The `agentille init` and `agentille project` CLIs are now skills.
- The wizard now runs natively inside Claude Code — no Node.js install needed.

## Planned for v1.3+

- **Iterative grading loop** — the master `agentille` skill will run `agentille-design-reviewer` in a loop: review → dispatch executor to apply P0/P1 fixes → re-review, until all pillar scores ≥ 7 or 3 iterations reached. Cap on token spend, exits early on plateau.
- **Refactoring UI ruleset baked in** — a new reference file `design-rules-canon.md` distilling Adam Wathan + Steve Schoger's Refactoring UI principles (spacing scales, type-scale contrast, color saturation/lightness curve, hierarchy beyond size, whitespace, etc.) — the practitioner standard for web design rules.
- **Expanded AI-design-tells catalog** — community-contributed patterns to flag, growing as new AI defaults emerge.
- **Further reading section** — link to SixArm/ui-ux-design-guide and Untitled UI's books list as supplementary resources.
