# Changelog

All notable changes to agentille are documented here.

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
