# Changelog

All notable changes to agentille are documented here.

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
