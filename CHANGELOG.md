# Changelog

All notable changes to agentille are documented here.

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

## Planned for v1.1

- **Iterative grading loop** — the master `agentille` skill will run `agentille-design-reviewer` in a loop: review → dispatch executor to apply P0/P1 fixes → re-review, until all pillar scores ≥ 7 or 3 iterations reached. Cap on token spend, exits early on plateau.
- **Refactoring UI ruleset baked in** — a new reference file `design-rules-canon.md` distilling Adam Wathan + Steve Schoger's Refactoring UI principles (spacing scales, type-scale contrast, color saturation/lightness curve, hierarchy beyond size, whitespace, etc.) — the practitioner standard for web design rules.
- **Expanded AI-design-tells catalog** — community-contributed patterns to flag, growing as new AI defaults emerge.
- **Further reading section** — link to SixArm/ui-ux-design-guide and Untitled UI's books list as supplementary resources.
