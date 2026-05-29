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

- **hasUIComponent**: true if prompt mentions UI/UX/styling/component/page/screen/responsive/animation OR explicitly lists a `.tsx/.css/.scss` file → triggers design-reviewer in roster
- **hasMultipleSubtasks**: true if prompt contains "and ", "also", "plus", "as well as" connecting verbs, OR ≥3 distinct actionable nouns → triggers planner

## Team vs subagent honesty

The disjoint-parallelism criterion: a task warrants team mode when it decomposes into **≥2 vertical slices with disjoint file sets that can build at once**. Sequential work, a single slice, or an adversarial debug / multi-pillar review where the team structure itself is the value — these are the only cases. Dispatch policy and cost transparency live in `SKILL.md` and `team-mode.md` → "Honesty on a forced team".

## Examples

| Prompt | Category | hasUI | hasMulti |
|---|---|---|---|
| "Add a settings page with a dark mode toggle" | feature | ✓ | ✓ |
| "Why is the wizard not advancing on step 3?" | debug | ✗ | ✗ |
| "Refactor the API route to use Zod for validation" | refactor | ✗ | ✗ |
| "Make the hero feel more playful" | design | ✓ | ✗ |
| "Review the PR on auth" | review | ? | ? |
| "Compare Supabase vs Neon for our use case" | research | ✗ | ✗ |
