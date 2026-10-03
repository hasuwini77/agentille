# Task classifier — heuristic decision tree

> **Authority:** the dispatch decision table in `skills/agt/SKILL.md` is the tie-breaker. This doc is the detail/rationale — if it ever conflicts with that table, the table wins.

The agentille master skill uses this to classify the user's prompt into ONE of eight categories. Run heuristics in order; the first match wins. Don't call an LLM for classification unless ALL heuristics miss.

## Categories

- **planning** — pure ideation, architecture, no code expected yet
- **feature** — new functionality to ship
- **bugfix** — fix broken behavior
- **refactor** — restructure without behavior change
- **design** — UI/UX-focused (visual, copy, layout, motion)
- **review** — analyze existing code/diff/PR
- **debug** — diagnose why something is broken
- **research** — explore options/libraries/approaches before deciding

## Heuristic order (first match wins)

1. **planning** if prompt contains: "plan ", "brainstorm", "architect", "design the", "approach for", "how should we", "should I build" — and does NOT contain "implement"/"build me"/"add"/"fix"
2. **bugfix** if prompt contains: "fix", "broken", "doesn't work", "regression", "error when", "throwing", "crash"
3. **debug** if prompt contains: "why is", "why does", "what's wrong", "investigate", "diagnose", "trace"
4. **research** if prompt contains: "compare", "options for", "which library", "should we use X or Y", "find a way to", "look into"
5. **design** if prompt contains ANY of: "UI", "UX", "design", "looks", "feels", "polish", "styling", "responsive", "animation", "hover", "spacing", "typography", "color", "palette", "layout", "Tailwind", "CSS"
6. **review** if prompt contains: "review", "audit", "check the", "is this", "feedback on", "what do you think of"
7. **refactor** if prompt contains: "refactor", "rename", "move", "extract", "split", "consolidate", "DRY", "deduplicate"
8. **feature** — DEFAULT if no other category matches

## Multipliers

After picking the primary category, also note:

- **hasUIComponent**: true if prompt mentions UI/UX/styling/component/page/screen/responsive/animation OR explicitly lists a `.tsx/.css/.scss` file → triggers the **design-reviewer** after the build, and on **build categories** (`design`, `feature`) prepends the **ui-prototyper** before the executor to frame the component design it builds against. A UI *bugfix*/*review* gets the design-reviewer but no prototyper — there's no new design to frame. No new signal — every UI role keys off this one flag; see `SKILL.md` dispatch table for the authoritative per-category roster.
- **hasMultipleSubtasks**: true if prompt contains "and ", "also", "plus", "as well as" connecting verbs, OR ≥3 distinct actionable nouns → triggers planner

## Parallel tiers — panes, workflow, subagent (teams are opt-in only)

The disjoint-parallelism criterion governs every parallel tier. Classification never returns `team`: ≥2 disjoint slices → **parallel**, run as **panes** inside Herdr or tmux (`panes-mode.md`), else **workflow** when the `Workflow` tool exists, else subagent waves.

- **Team mode** — legacy, only when the user types `--team` / `--mode team` (~4× tokens). Cost transparency lives in `team-mode.md` → "Honesty on a forced team".

- **Workflow tier** — ≥2 genuinely disjoint parallel slices arranged in dependency waves (3+ buckets across 2+ waves) AND peers do NOT need to message each other. The workflow tier emits a Dynamic Workflow script (scripted autonomous fan-out); it degrades silently to in-session subagent waves when the `Workflow` tool is absent (Claude Code < 2.1.154, Pro plan without Dynamic workflows enabled in `/config`, or disabled by settings/env). A user-triggered `/agt` run satisfies the Workflow tool's explicit-opt-in requirement; never reach for it outside one. Same disjoint-parallelism bar everywhere: if it isn't met, do not use workflow (fall to subagent or solo). Dispatch-shape note: subagent dispatches whose result gates the next step run foreground (`run_in_background: false`) — see `SKILL.md` → "Worker agents". Full contract: `workflow-mode.md`.

- **Subagent / solo** — single slice, sequential work, or any task that doesn't clear the disjoint-parallelism bar.

## Examples

| Prompt | Category | hasUI | hasMulti |
|---|---|---|---|
| "Add a settings page with a dark mode toggle" | feature | ✓ | ✓ |
| "Why is the wizard not advancing on step 3?" | debug | ✗ | ✗ |
| "Refactor the API route to use Zod for validation" | refactor | ✗ | ✗ |
| "Make the hero feel more playful" | design | ✓ | ✗ |
| "Review the PR on auth" | review | ? | ? |
| "Compare Supabase vs Neon for our use case" | research | ✗ | ✗ |

**Squads are orthogonal to the category.** The category picks the base roster; active squads (`squads.md`) add specialist reviewers and checklist lines on top — never reclassify a task because a squad is active.
