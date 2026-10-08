# Routing — category, roster, model + effort

How `/agt` turns a task into roles and models, after `SKILL.md` → "Modes" picked the mode.

## Category

First match wins; no model call.


1. **planning** — "plan ", "brainstorm", "architect", "design the", "approach for", "how should we", "should I build", and no "implement"/"build me"/"add"/"fix"
2. **bugfix** — "fix", "broken", "doesn't work", "regression", "error when", "throwing", "crash"
3. **debug** — "why is", "why does", "what's wrong", "investigate", "diagnose", "trace"
4. **research** — "compare", "options for", "which library", "X or Y", "look into"
5. **design** — UI, UX, design, looks, feels, polish, styling, responsive, animation, hover, spacing, typography, color, layout, Tailwind, CSS
6. **review** — "review", "audit", "check the", "feedback on"
7. **refactor** — "refactor", "rename", "move", "extract", "split", "consolidate", "deduplicate"
8. **feature** — default

Multipliers: **hasUI** (UI/UX/styling/component/page/screen, or a `.tsx/.css/.scss` file named) adds the design-reviewer, and the ui-prototyper on `design`/`feature`. **hasMulti** ("and", "also", "plus" joining verbs, or ≥3 deliverables) adds the planner.

## Stage 2 classify

Only when the mode table falls through. One inline Haiku call, never the planner. Send the task, ask for ONLY `{"mode": "subagent|parallel|solo", "roster": ["agentille:agentille-…"], "reasoning": "<one sentence>"}`. `parallel` = panes in Herdr/tmux, else workflow, else subagent waves. Use its roster as is. Malformed JSON → `subagent` plus a one-line note; never crash. If parallel vs sequential hinges on a question, ask it in the clarify round; the provisional mode is `subagent`.

## Roster

| Category | planner | plan-reviewer | ui-prototyper | executor | code-reviewer | design-reviewer | security-reviewer |
|---|---|---|---|---|---|---|---|
| planning | ✓ | ✓ | — | — | — | — | — |
| research | ✓ (research prefix: comparison table, no code) | — | — | — | — | — | — |
| feature | if hasMulti | if planner ran | if hasUI | ✓ (≤3 parallel) | ✓ | if hasUI | if auth/money/data |
| bugfix | if ≥2 files | if planner ran | — | ✓ (debug discipline) | ✓ | if hasUI | — |
| refactor | if hasMulti | if planner ran | — | ✓ | ✓ (skip iff pure rename/move) | — | — |
| design | — | — | ✓ | ✓ | if logic changed | ✓ | — |
| debug | — | — | — | ✓ (debug loop) | after a fix lands | — | — |
| review | — | — | — | — | ✓ | if UI code | if auth/money/data |

- The ui-prototyper runs **before** the executor; pass its Blueprint into the executor prompt as the design contract.
- Skip the plan-reviewer on `thinkingDepth=quick` and for a ≤3-step fully sequential plan.
- Design-reviewer viewports: the ones the user names, else `profile.viewports`, else desktop + mobile.
- Debug: each fix attempt is a `mode=fix` executor dispatch. After 3 failed fixes, dispatch the planner with `mode=diagnose` (read-only root cause), then a fresh executor implements it.
- Squads add payments / SEO / perf reviewers to the review step when the diff touches their domain (`squads.md`). Formations reshape the workers (`formations.md`).
- Every reviewer column ticked for a piece runs **at once**: one message, parallel background calls (`SKILL.md` → "The contract" step 8).
- Never more than 3 executors at once; batch the rest in waves.

## Default routing

Model · effort per role. Size, risk and mode come from the dispatch header; the mod enforces this table (`hooks/routing.js`), and the lead passes the model as a fallback.

| role | default | size=large | risk auth/money | thinkingDepth=quick |
|---|---|---|---|---|
| planner | opus · high | opus · xhigh | — | sonnet · medium |
| plan-reviewer | sonnet · medium | opus · high | — | skipped |
| ui-prototyper | opus · high | opus · high | — | sonnet · medium |
| executor | sonnet · medium | sonnet · high | sonnet · high | sonnet · medium |
| code-reviewer | sonnet · medium | opus · high | opus · high | sonnet · medium |
| design-reviewer | opus · high | opus · high | opus · high | opus · high (never downgraded) |
| security-reviewer | opus · high | opus · high | opus · max | sonnet · high |
| payments-reviewer | opus · high | opus · high | opus · max | sonnet · high |
| seo-reviewer | sonnet · medium | sonnet · high | — | sonnet · low |
| perf-reviewer | sonnet · high | opus · high | — | sonnet · medium |
| adversary | sonnet · high | sonnet · high | opus · high | sonnet · medium |

Dispatch with aliases (`fable`/`opus`/`sonnet`/`haiku`), never pinned IDs. A pane worker opened by `spawn_pane` is routed exactly like the subagent of its role (same table, ladder and Fable guard).

**Workflow agents.** A workflow script's `agent()` spawns reach the mod, but their model cannot be rewritten (a hook can only refuse them). The lead passes `agentType: 'agentille:agentille-<role>'`, `model` and `effort` from this table in each `agent()` call. The mod logs the table's pick beside the model that ran, flags a drift (`/agt-routing`), and shows the agents on the band and under the Workflow call.

## Review tiering

- **code-reviewer → Opus** if more than one file has logic changes, >~150 changed LoC, a public API/schema changed, or the diff touches auth/sessions/money. Else Sonnet.
- **plan-reviewer → Opus** if the plan has ≥6 steps or changes a shared contract. Else Sonnet.
- In genuine doubt, pay Opus for the review; never for a clearly small single-file diff.

## Hard rules

- **Never use Haiku for the executor**, and never change its model (effort only). Haiku is for Stage 2 classify only.
- **Never downgrade the design-reviewer.**
- **Declare `model:` on every dispatch** (fallback when the mod is off).

## Escalation ladder

Evidence is observed by the mod, not claimed by the lead.

- **Plan:** 1st REVISE → next planner runs opus · max. 2nd REVISE → next planner is a Fable candidate.
- **Fix:** attempt 2 → executor effort high; attempt ≥3 → max. A `mode=diagnose` planner after ≥3 fixes → Fable candidate.
- **Fable gate** (all must pass, else opus · max with the reason logged): candidate · `profile.routing.autoFable` not false · fewer than `maxFablePerRun` (default 1) Fable spawns this run · weekly plan usage below `fableWeeklyCeiling` (default 60%).

### Advisor

Claude Code's advisor tool (`/advisor`, `advisorModel`) is the user's setting: every /agt session inherits it, and agentille never adds one. Subagent mode cannot scope it; it follows the session. With `profile.routing.advisorOnOpus: false`, Opus and Fable pane workers start with `CLAUDE_CODE_DISABLE_ADVISOR_TOOL=1` so a stronger worker is not advised by a same-tier model; Sonnet workers keep theirs. Default `true`.

### `--fable`

`fable=forced` in the header: planner, ui-prototyper, design-, security- and payments-reviewer, and a large code-/plan-reviewer run Fable; the executor never does. It bypasses the gate (the user chose it). If the `fable` alias does not resolve, re-dispatch that role once on `opus`; never retry-loop. `fable` appears only in dispatch-time model parameters, never in agent frontmatter.
