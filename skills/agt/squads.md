# Squads — project-aware sub-teams

A **squad** is a bundle of extra specialist reviewers plus checklist overlays for existing roles, activated when the repo matches the squad's signals. Squads are defined in `.claude-plugin/squads.json` (`saas`, `ecommerce`, `content`, `immersive`). They are **orthogonal to the task category**: the category picks the base roster (`roster.md`), squads add specialists on top.

## Detection

- **With the agentille mod:** the mod scores the repo against `squads.json` and injects a `## Squads detected by the agentille mod` block into the skill text, listing each active squad, its `adds`, and its `checklists`. Use that block as-is; do not re-detect.
- **Without the mod (manual fallback):** read `.claude-plugin/squads.json`, then for each squad compute a score = the number of its `signals.deps` present in the repo's `package.json` `dependencies` + `devDependencies` (exact package names) + the number of its `signals.paths` that exist relative to the repo root. The squad is **active when score >= minScore**. Print active squads and their scores on the Mission Brief; a repo with no `package.json` simply scores paths only.

## How squads change the roster

- **`adds` reviewers** run in parallel with the normal reviewers, on the same diff, as background subagents (`run_in_background: true`; nothing downstream waits on them except the final merge gate). Dispatch one only when the change touches its domain, judged from the diff's file list and content:
  - `payments-reviewer` — the diff touches webhooks, checkout, pricing, subscriptions, billing, or provider SDK calls (set `risk=money` in its header).
  - `seo-reviewer` — the diff touches pages, routes, layouts, metadata, content, sitemap, or feeds.
  - `perf-reviewer` — the diff adds dependencies, touches images/fonts/media, hot render paths, or 3D/animation code.
  A diff that touches none of a squad's domains dispatches none of its adds; say so in one clause.
- **`checklists`** — for each role that is dispatched this run, append that role's lines from every active squad to its dispatch prompt under a `Squad checklist:` heading, one line per check. Roles not dispatched ignore their lines.
- **Multiple squads union.** Dedupe `adds` by role (one dispatch per role per run) and merge checklist lines per role, dropping duplicates.

## Dispatch

Every squad dispatch still carries the `[agt ...]` header from `SKILL.md` → "Dispatch header". Model and effort follow `model-routing.md` → "Default routing". Squad reviewers are read-only and report findings; they never edit.
