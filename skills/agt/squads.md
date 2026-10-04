# Squads — project-aware specialists

A squad adds specialist reviewers and checklist lines when the repo matches its signals. Squads live in `.claude-plugin/squads.json` and are orthogonal to the task category: the category picks the roster (`routing.md` → "Roster"), squads add to its review step only.

## Detection

- **With the mod:** it scores the repo and injects a `## Squads detected by the agentille mod` block. Use it as-is; do not re-detect.
- **Without the mod:** read `.claude-plugin/squads.json`. Score each squad = its `signals.deps` found in `package.json` + its `signals.paths` that exist. Active when score ≥ `minScore`.

## How squads change the roster

Dispatch an `adds` reviewer in parallel with the normal reviewers, in the background, only when the diff touches its domain:

- `payments-reviewer`: webhooks, checkout, pricing, subscriptions, billing, provider SDK calls (`risk=money`).
- `seo-reviewer`: pages, routes, layouts, metadata, content, sitemap, feeds.
- `perf-reviewer`: new dependencies, images/fonts/media, hot render paths, 3D/animation code.

For each dispatched role, append the active squads' checklist lines under `Squad checklist:`. Several squads union; one dispatch per role.

## Dispatch

Squad dispatches carry the `[agt …]` header (`SKILL.md` → "Dispatch header") and route per `routing.md` → "Default routing". They are read-only.
