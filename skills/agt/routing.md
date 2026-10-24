# Routing — category, roster, model + effort

How `/agt` turns a task into roles and models, after `SKILL.md` → "Levels" picked the level.

## Category

First match wins; no model call.


1. **planning** — "plan ", "brainstorm", "architect", "design the", "approach for", "how should we", "should I build", and no "implement"/"build me"/"add"/"fix"
2. **bugfix** — "fix", "broken", "doesn't work", "regression", "error when", "throwing", "crash"
3. **debug** — "why is", "why does", "what's wrong", "investigate", "diagnose", "trace"
4. **research** — "compare", "options for", "which library", "X or Y", "look into"
5. **design** — UI, UX, design, looks, feels, polish, styling, responsive, animation, hover, spacing, typography, color, layout, Tailwind, CSS
6. **review** — "review", "audit", "check the", "feedback on"
7. **refactor** — "refactor", "rename", "move", "extract", "split", "consolidate", "deduplicate" (whole words: "move" never matches "remove")
8. **feature** — default

Multipliers: **hasUI** (UI/UX/styling/component/page/screen, or a `.tsx/.css/.scss` file named) adds the design-reviewer, and the ui-prototyper on `design`/`feature`, past the UI threshold below. **hasMulti** ("and", "also", "plus" joining verbs, or ≥3 deliverables) adds the planner.

**UI threshold** (the cheap tier for small UI work). A `feature` or `bugfix` slice that is `size=small` and `risk=none` and changes one screen gets one executor plus the Sonnet code-reviewer: hasUI adds neither the ui-prototyper nor the design-reviewer.
They join when the UI work spans more than one screen (a new page, a flow, a shared component used across screens), when the slice is `size=large`, or when the person asks for a design review or a prototype. The test is per slice, so a `medium` run of small one-screen slices stays on this tier. The `design` category is that ask, so it keeps both at any size, as does a `review` of UI code.

## Risk words

`risk=` in the header and the "no auth/money/data words" test in `SKILL.md` → "Levels" match what the change does, not what the screen is called. First match wins:

- **auth** — session, token, JWT, cookie, OAuth, password hashing or reset, 2FA, CSRF, permission, role check, middleware guard, API key, secret
- **money** — payment, checkout, price, subscription, invoice, refund, webhook, billing, Stripe
- **data** — migration, schema, drop, truncate, backfill, production data, PII export
- **none** — a screen named after one of those with no logic behind it: a login, sign-in or checkout form, page, button, copy or styling change that calls an existing endpoint and stores nothing. It runs solo or low like any other UI change, with the code-reviewer; the security-reviewer joins only when the diff turns out to touch a guard, a token or a secret, and the gauntlet never runs for it.

## Stage 2 classify

Only when the level table falls through. One inline Haiku call, never the planner. Send the task, ask for ONLY `{"level": "low|medium|heavy", "roster": ["agentille:agentille-…"], "reasoning": "<one sentence>"}`. `heavy` = panes in Herdr/tmux, else workflow, else subagent waves; `medium` = parallel executor subagents; `low` = one executor (or solo when the roster is empty). Use its roster as is.
Malformed JSON → `low` plus a one-line note; never crash. If the level hinges on a question, ask it in the clarify round; the provisional level is `low`.

## Roster

| Category | planner | plan-reviewer | ui-prototyper | executor | code-reviewer | design-reviewer | security-reviewer |
|---|---|---|---|---|---|---|---|
| planning | ✓ | ✓ | — | — | — | — | — |
| research | ✓ (research prefix: comparison table, no code) | — | — | — | — | — | — |
| feature | if hasMulti | if planner ran | if hasUI, past the UI threshold | ✓ (≤3 parallel) | ✓ | if hasUI, past the UI threshold | if auth/money/data |
| bugfix | if ≥2 files | if planner ran | — | ✓ (debug discipline) | ✓ | if hasUI, past the UI threshold | — |
| refactor | if hasMulti | if planner ran | — | ✓ | ✓ (skip iff pure rename/move) | — | — |
| design | — | — | ✓ | ✓ | if logic changed | ✓ | — |
| debug | — | — | — | ✓ (debug loop) | after a fix lands | — | — |
| review | — | — | — | — | ✓ | if UI code | if auth/money/data |

- The ui-prototyper runs **before** the executor; pass its Blueprint into the executor prompt as the design contract.
- Skip the plan-reviewer on `thinkingDepth=quick` and for a ≤3-step fully sequential plan. Its `quick` cell in "Default routing" is the route a plan-reviewer still dispatched under `quick` gets.
- Design-reviewer viewports: the ones the user names, else `profile.viewports`, else desktop + mobile.
- Design-reviewer URL: before its dispatch, start the project's dev server in the slice's worktree (it lives until the gate; re-attach it if it is gone: `factory.md` → "Worktree lifecycle") on a free port (`PORT=<free> <dev command> > ~/.agentille/state/run-<id>/dev-<slice>.log 2>&1 &`), wait for a 2xx, pass `url: http://localhost:<port>`, and stop that server once its verdict is harvested.
  The reviewer never starts one itself.
- Debug: attempts, the limit and the `mode=diagnose` planner after 2 failed attempts are `factory.md` → "Fix rounds".
- Squads add payments / SEO / perf reviewers to the review step when the diff touches their domain (`squads.md`). Formations reshape the workers (`formations.md`).
- Every reviewer column ticked for a slice runs **at once**: one message, parallel background calls (`SKILL.md` → "The contract" step 8).
- Never more than 3 executors at once; batch the rest in waves. The mod counts a run's working executor subagents and open executor panes when an executor subagent is dispatched, and flags a 4th (`⚑ run <id>: 4th executor at once; the roster says 3` on the band, one toast, a `cap` field on that line of `routing.jsonl`); it never refuses the dispatch.

## Default routing

Model · effort per role. Size, risk and mode come from the dispatch header; the mod enforces this table (`hooks/routing.js`), and the lead passes the model as a fallback.

| role | default | size=large | risk auth/money | thinkingDepth=quick |
|---|---|---|---|---|
| planner | opus · high | opus · xhigh | — | sonnet · medium |
| plan-reviewer | sonnet · medium | opus · high | — | sonnet · medium |
| ui-prototyper | opus · high | opus · high | — | sonnet · medium |
| executor | sonnet · medium | sonnet · high | sonnet · high | sonnet · medium |
| code-reviewer | sonnet · medium | opus · high | opus · high | sonnet · medium |
| design-reviewer | opus · high | opus · high | opus · high | sonnet · high |
| security-reviewer | opus · high | opus · high | opus · max | sonnet · high |
| payments-reviewer | opus · high | opus · high | opus · max | sonnet · high |
| seo-reviewer | sonnet · medium | sonnet · high | — | sonnet · low |
| perf-reviewer | sonnet · high | opus · high | — | sonnet · medium |
| adversary | sonnet · high | sonnet · high | opus · high | sonnet · medium |

Dispatch with aliases (`fable`/`opus`/`sonnet`/`haiku`), never pinned IDs. A pane worker opened by `spawn_pane` is routed exactly like the subagent of its role (same table, ladder and Fable guard).

**Workflow agents.** A workflow script's `agent()` spawns reach the mod, but their model cannot be rewritten (a hook can only refuse them). The lead passes `agentType: 'agentille:agentille-<role>'`, `model` and `effort` from this table in each `agent()` call.
The mod logs the table's pick beside the model that ran, flags a drift (`/agt-info routing`), and shows the agents on the band and under the Workflow call.

## Review tiering

- **code-reviewer → Opus** if more than one file has logic changes, >~150 changed LoC, a public API/schema changed, or the diff touches auth/sessions/money. Else Sonnet.
- **plan-reviewer → Opus** if the plan has ≥6 steps or changes a shared contract. Else Sonnet.
- In genuine doubt, pay Opus for the review; never for a clearly small single-file diff.

## Hard rules

- **Never use Haiku for the executor**, and never change its model (effort only). Haiku is for Stage 2 classify and read-only scouts (`SKILL.md` → "The contract") only.
- **Never downgrade the design-reviewer** below opus · high, except under `thinkingDepth=quick`, where it runs sonnet · high like the other reviewers.
- **Declare `model:` on every dispatch** (fallback when the mod is off).

## Escalation ladder

Evidence is observed by the mod, not claimed by the lead.

- **Plan:** 1st REVISE → next planner runs opus · max. 2nd REVISE → next planner is a Fable candidate.
- **Fix** (attempts per `slice=`, as `factory.md` → "Fix rounds" defines them): attempt 2 → executor effort high; attempt 3, only after a diagnose planner → max. One slice's rounds never raise another's effort. A `mode=diagnose` planner after 2 failed attempts → Fable candidate.
- **Fable gate** (all must pass, else opus · max with the reason logged): candidate · `profile.routing.autoFable` is `true` (default `false`: Fable costs about twice Opus, so the ladder is opt-in) · fewer than `maxFablePerRun` (default 1) Fable spawns this run · weekly plan usage below `fableWeeklyCeiling` (default 60%).

### Cost ceiling

`profile.routing.maxRunUsd` (default `15`; `null`, `0` or anything but a positive number turns it off) caps a run's estimated spend in US dollars. Subagents are priced from their tokens at API list prices; a pane worker reports no tokens, so `paneUsd` in `hooks/routing.js` estimates it from its role, routed model and minutes open (a Codex pane counts $0). The lead's own tokens on the run count too, priced at the lead's model.
The price table, the pane formula and what the estimate leaves out: `docs/routing-cost.md` at the plugin root.

- **Past the ceiling,** every later dispatch, subagent or pane, of a role the table or the ladder puts on Opus (or a ladder Fable) runs Sonnet at the same effort: the planner, the plan-reviewer, every reviewer (design-reviewer and a duel's judge included), the ui-prototyper and the adversary. Only the executor, which never changes model, and a typed `--fable` keep their route.
- **The card:** that dispatch's `routing.jsonl` line carries `"capped": true`, and the mod shows one toast and one band `⚑` per run that name the role it demoted first (`code-reviewer opus → sonnet`). When the run's log has a `capped` line, the card's `⚑` line says `maxRunUsd reached: later Opus roles ran Sonnet`.

### Advisor

Claude Code's advisor tool (`/advisor`, `advisorModel`) is the user's setting: every /agt session inherits it, and agentille never adds one. Subagent mode cannot scope it; it follows the session.
With `profile.routing.advisorOnOpus: false`, Opus and Fable pane workers start with `CLAUDE_CODE_DISABLE_ADVISOR_TOOL=1` so a stronger worker is not advised by a same-tier model; Sonnet workers keep theirs. Default `true`.

### `--fable`

`fable=forced` in the header: planner, ui-prototyper, design-, security- and payments-reviewer, and a large code-/plan-reviewer run Fable; the executor never does. It bypasses the gate (the user chose it), and the mod checks that choice:
`fable=forced` holds only in a session where the person's typed `/agt` line carried `--fable`; otherwise the mod rewrites the header to `fable=auto`, the ladder applies, and one `⚑` toast says so. If the `fable` alias does not resolve, re-dispatch that role once on `opus`; never retry-loop. `fable` appears only in dispatch-time model parameters, never in agent frontmatter.
