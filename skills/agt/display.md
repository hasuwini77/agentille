# Display — the Transit Rail (how /agt shows its work)

> **Presentation only.** Nothing in this file changes classification, roster, model routing, or dispatch. It governs *how the orchestrator surfaces what it is already doing* so the user can track the run — especially the work the lead does **before** any agent is spawned. If rendering would ever block, error, or prompt, **skip it silently** — the display never gates the user's result.

The orchestrator speaks in one visual language: the **Transit Rail**. A run reads top-to-bottom like a transit line — each station is a phase; the build station **fans out** into a multi-worker card when work runs in parallel. Two pillars carry it:

1. **The TodoWrite spine** — the native, live "what's left" list. Seeded *before* the first spawn.
2. **The Transit Rail frames** — a drawn-once brief, thin per-phase pings, and a compact debrief.

Both pillars work identically in **subagent** and **team** mode.

---

## Token discipline (non-negotiable)

A rich board redrawn every phase bleeds output tokens. The cadence is fixed:

- **Draw the full rail ONCE** — the Mission Brief, right after classification, before any dispatch.
- **One thin ping per phase transition** — a single line, ≤ ~60 chars, carrying a colored LED + result.
- **One fanout block** when the build forks into parallel workers (drawn once at spawn), plus a one-line ping as each worker lands.
- **One compact Debrief** at the end.

Never re-render the full rail mid-run. The streaming color comes from the ping lines, not from redrawing the rail.

Three color channels, each used where it is strongest — all theme-independent, none need ANSI:

- **config-highlight `yaml` cards** → the static frames (Brief, fanout, Debrief): the highlighter paints keys, values, and `#` comments in distinct hues (richest palette).
- **`diff` fences** → pass/fail verdicts: green `+`, red `-`.
- **colored-emoji LEDs** → live progress pings.

---

## Cockpit event emission (opt-in, presentation-only)

When `AGENTILLE_COCKPIT=1` **or** the in-memory `profile.cockpit.enabled === true`, additionally
emit one structured line at each moment you already render a rail signal. **When the flag is off, do
nothing here** — do not call the emitter, do not create files. This is presentation-only and never
gates the run.

At each moment below, build the JSON object and pipe it to the emitter, incrementing a per-run `seq`
starting at 0 (the emitter is fail-silent — if it errors, ignore it and continue):

    echo '<json-line>' | "${CLAUDE_PLUGIN_ROOT}/scripts/cockpit-emit.sh" --run <run-id>

Use the run id from the existing `~/.agentille/state/run-<id>/` run dir name. Emit:

| Moment (already in the rail) | Event |
|---|---|
| Mission Brief drawn | `run_start` (include `version`, `schema:1`, `repo_root`, `task`, `mode`, `template`, `stations`) |
| Each phase transition ping | `phase` (`station`, `status`) |
| Fanout block drawn | `fanout` (`workers[]` with `id`, `slice`, `worktree`) |
| Each worker landing / context ping | `worker` (`id`, `status`, optional `context_pct`) |
| Each review verdict | `verdict` (`reviewer`, `result`, `findings`) |
| Debrief | `debrief` (`summary`, `tokens`) |
| Run completed | `run_end` (`outcome`) |

The schema and field semantics are fixed by the agentille-cockpit spec. Emit valid JSON, one object per
line. Drop-on-failure, exactly like the rail's own rule.

---

## Pillar 1 — the TodoWrite spine

The instant the mode + roster are resolved (and **before** the first `Agent` call), seed one todo per phase that will actually run. This is the user's live "steps left until we send the agents."

- One todo per resolved phase only — omit stations with no agent (a solo task has no `review`/`gate`; a review-team has no `build`).
- `activeForm` is the present-participle station name: `Classifying`, `Planning`, `Reviewing plan`, `Designing`, `Building`, `Reviewing`, `Shipping`.
- Mark each `completed` the moment its phase produces a result. Exactly one `in_progress` at a time.
- The spine is the source of truth for "what's left"; the rail is the source of truth for "how it's shaped." Keep them consistent.

---

## Pillar 2 — the rail frames

### The phases (build from the resolved roster — never a fixed six)

Canonical stations, in order: `recon → plan → review → design → build → gate → ship`. **Only render the stations that will run** — `design` only when the work has UI (the ui-prototyper ran). Examples:

- solo: `recon → build → ship`
- subagent feature w/ planner: `recon → plan → review → build → gate → ship`
- subagent UI feature: `recon → plan → review → design → build → gate → ship` (`design` = the ui-prototyper's blueprint)
- review-team: `recon → review → ship`
- incident-team: `recon → build → ship` (build = the adversarial hypothesis race)

Map roster → stations: planner ⇒ `plan`, plan-reviewer ⇒ `review`, ui-prototyper ⇒ `design`, executor(s) ⇒ `build`, code/design/security-reviewer ⇒ `gate`, PR + shipped-log ⇒ `ship`. `recon` is always present (your classification step).

### Frame 1 — Mission Brief (drawn ONCE, after classification, before dispatch)

The brief is a **config-highlight card** — a ` ```yaml ` fence. The terminal's syntax highlighter colors keys, values, and `#` comments in distinct hues, so the card carries real multi-color with no ANSI. One row per station that will run:

```yaml
# agentille v<version> ▸ <mode> · <template-or-category> ▸ ~<est>m
task:    <task, first line, ≤ 60 chars>
mode:    <mode>      # <one-clause reason / spine shape>
recon:   ◉ done      # classified: <category>
plan:    ◐ active    # <model> · drafting
review:  ○ pending   # plan-reviewer · <model>
build:   ○ pending   # <N> executor(s) · <model>
gate:    ○ pending   # <reviewers, space-sep>
ship:    ○ pending   # PR + debrief
```

- **Key = station, value = `<glyph> <status>`, comment = the detail.** Three token classes → three colors, theme-independent. Omit any station that won't run (a solo card has only `recon` / `build` / `ship`).
- **The `mode:` row is the decision, in color.** Value = the resolved mode (`subagent` / `team` / `solo`); comment = the one-clause reason or spine shape (e.g. `# sequential spine → parallel fan-out (4 views)`, `# 2 disjoint slices`, `# single file, no architectural verb`). This is where the subagent-vs-team pick becomes visible at full color — it is **not** a black box and is **never** explained in a separate prose paragraph. The recon *ping* (Frame 2) echoes the same pick as the run starts.
- **Glyphs `◉ ◐ ○` are single-width geometric chars — safe inside the fence.** They are *not* emoji; never put a double-width colored-emoji LED (`🟢`) inside a fence — those live in ping lines (Frame 2).
- **No box border** (`╔══╗`). The highlighter colors by *token*, not column, so a drawn border renders as an unstyled string and fights alignment — the fence's own background is the card. **Never hand-draw a box-rail brief and never replace the card with a prose sentence** ("I'll render the brief inline…"): the brief is *always* this ` ```yaml ` fence. The card is the only sanctioned form, in either mode.
- **TodoWrite unavailable ≠ render in prose.** The spine (Pillar 1) and the rail frames (Pillar 2) are independent. If `TodoWrite` can't be seeded, skip the spine **silently** and still draw this yaml card — losing the spine never downgrades the brief to a hand-drawn box or a prose paragraph.
- `~<est>m` is your honest rough estimate, omit if you have none.
- **`v<version>` is the loaded plugin version** — derive it from your skill base directory path (`.../agentille/<version>/skills/agt`) and print it verbatim in the header. It doubles as the **stale-session tell**: a Claude Code session resolves the plugin version once at startup and holds it for its lifetime, so a user on an old session sees the old version here and knows to `/plugin update` (or restart) before trusting the run. If the path is unparseable, omit the `v<version>` token entirely — never guess or hard-code a version.
- In team mode, append the cost to the header comment: `# agentille v<version> ▸ team · feature-team ▸ ~12m · ~4× tokens`. (This replaces the standalone cost-transparency line.)

### Frame 2 — thin ping (one per phase transition)

A single markdown line — this is where the **live color** lives (colored-emoji LEDs render reliably in any theme; aligned columns do not matter here):

```
🟢 recon    subagent · sequential, 1 slice          0:03
🔵 plan     5 steps · 3 parallel · opus              0:14
🔵 review   plan APPROVED · opus                     0:31
🟠 design   ui-prototyper ✓ blueprint · tokens·states  0:52
🟢 build    exec-1 ▸  exec-2 ▸  spawned              0/2
🟢 build    exec-1 ✓  exec-2 ▸                       1/2
🟡 gate     code-review · 1 should-fix → patched     2:47
🟣 gate     design-review · 3 viewports · a11y clean 3:20
```

Each ping carries the **acting agent's color** (see the legend) — so a clean run is naturally multi-colored, one hue per agent, matching its team-pane tint. Emit one per phase transition; for a long station (build) emit a line when it begins (`▸` / `spawned`) and one when it lands (`✓`). Status rides in the glyph + trailing text, not the LED. Keep each ≤ ~60 chars before the trailing metric.

**Pre-spawn planning window — the "lead doing stuff" before panes open.** In team mode, recon → classify → plan → plan-review all run before the first `Agent` spawn. That pre-spawn window is invisible without a signal. Emit one 🔵 ping when the lead enters it and one 🟢 ping when it exits (first teammate spawns):

```
🔵 planning   classifying · plan drafting · plan-review                   0:04
🔵 planning   done · team spawning now — <N> teammates                     1:32
```

This is the **only** pre-spawn signal — never narrate the planning work in prose or emit per-step pings while planning. Both lines are 🔵 (the planner's color); the second's `done · team spawning now` text closes the window. If no plan-review ran (skip-tier or `quick`), say so in the 🟢 line: `plan-review skipped · team spawning now`.

**The waiting ping — for dead air while the lead is blocked on a long worker.** Emit **one** line on entering the wait (never on a timer), carrying the color of the agent you're waiting on, with `waiting` in the text:

```
🟣 gate     design-review running 3:12 · code-review ✓     waiting
```

Never narrate the wait in prose; the harness spinner already says *still alive*, so this line only needs to add *still alive **on what***.

**The recon ping always carries the mode pick + a one-clause reason** — this is where the subagent-vs-team decision becomes visible (the Stage 2 `reasoning`, or the Stage 1 rule that fired). It echoes the brief's `mode:` row as the run starts. **Never narrate the decision as a prose paragraph** ("Decisions locked. This is a complex feature+refactor — subagent mode with a sequential spine…"): that content belongs in the `mode:` row comment and this colored ping, not an uncolored block above them. The pick is never a black box — and never a wall of prose:

```
🟢 recon    subagent · sequential, no disjoint slices    0:03
🟢 recon    team · feature-team — 2 disjoint slices       0:04
🟢 recon    subagent · downgraded from forced team        0:06
🟡 recon    team (forced) · overkill, ran as asked        0:03
```

The last two lines are the **forced-team overkill outcomes** (see `team-mode.md` → "Honesty on a forced team"): the user passed `--team` with no real parallel work. When `preTaskQuestioning` permits, `/agt` *asks* first (downgrade to subagent, or force the team) and the recon ping shows whichever the user chose — `subagent · downgraded from forced team` or `team (forced)`. When questioning is off, it flags the trade (🟡) and runs the team. `honestyLevel`-gated; on the most hands-off honesty level, fall back to the plain 🟢 recon line. The ask never loops, and nothing here blocks.

### Frame 3 — the parallel fanout (drawn ONCE when build forks)

When ≥2 workers run in parallel (team executors, or subagent chunks dispatched together, ≤3), draw the fork as its own **config-highlight card** so every worker line is colored — this is the most-watched moment of a run, so it earns the richest frame:

```yaml
# build ▸ <N> executors · <model> · parallel
exec-1:  ◐ running   # <slice-name> · <files or dir>
exec-2:  ◐ running   # <slice-name> · <files or dir>
exec-3:  ◐ running   # <slice-name> · <files or dir>
```

- Team mode: key = callsign (`exec-1`…), comment = its file-slice.
- Subagent mode: key = chunk name. The card visualizes the dispatch fan-out — the moment parallel work begins, which is otherwise hard to track.
- Flip each worker's glyph (`◐ running` → `◉ done`) via thin LED pings (Frame 2), not by redrawing this card.

### Frame 4 — review verdicts (diff fence = free green/red)

Review gates render in a ` ```diff ` fence — the renderer colors `+` lines green, `-` lines red, with no ANSI:

```diff
+ plan-reviewer   APPROVE
+ code-review     clean
- security        1 should-fix → patched ✓
```

Keep a `-` line for any BLOCKER/should-fix even after it's patched (append `→ patched ✓`) — the red line is the honest audit trail. A finding that is *not* resolved stays `-` with its open status; per SKILL.md it is a gate, not a memo.

### Frame 5 — Debrief (drawn ONCE, at the end)

A **config-highlight card** mirroring the brief — one row per station that produced a result, so the run closes on the same colored visual language it opened with:

```yaml
# DEBRIEF ▸ /agt · <task, one line>
build:    ✓ <what landed — e.g. ProfileWizard · 3 files>
gate:     ✓ <review outcome — e.g. code-review clean · design a11y 0>
cost:     ✓ <dispatch shape — e.g. subagent · 2 exec + 1 review · or · team ~4× · 4 teammates + 2 reviews>
result:   ✓ <N> files · PR #<n> · <runtime>m
```

- One row per station that ran (drop `gate` if nothing was reviewed). The `✓` reads green-ish under most themes; detail goes in the value or its comment.
- **`cost:` states the dispatch shape — NEVER a fabricated token count.** You cannot read your own consumed tokens mid-run, so a precise integer here would be invented; don't print one. State what actually drove the cost: the mode + how many agents ran (`subagent · 2 exec + 1 review`, or `team ~4× · 4 teammates + 2 reviews`). The `~4×` band is the honest team-mode multiplier from `team-mode.md`. Omit the row only if even the shape is unknown.
- If no PR was opened, state what landed instead on `result:` (`branch agt/<slug>`, `local`, etc.).
- **Team mode adds a `team:` row** confirming teardown — e.g. `team:     ✓ 3 teammates shut down · panes collapsed to lead`. This is the user's positive signal that the team is gone and the lingering panes are closed (see `team-mode.md` → "Teardown"); without it, a quiet screen full of idle panes reads as "did it actually finish?". If a pane couldn't be closed, say so here (`team: ⚠ exec-2 pane left open — close manually`) rather than omitting the row.
- Unresolved blockers are **not** hidden here — they belong in the Frame 4 diff verdict as a red `-` line. The debrief card is the success ledger; the diff fence is the honest audit trail.

This is the only end-of-run frame — the final prose summary follows the user's `deliveryStyle` and is separate.

---

## The LED + glyph legend

**Card glyphs (single-width Unicode — alignment-safe inside fences; the highlighter colors the surrounding value):**

| Glyph | Meaning |
|---|---|
| `◉` | station complete |
| `◐` | station active |
| `○` | station pending |
| `✓` | result landed (Debrief) |

**LEDs (colored emoji, in ping lines only — reliable color, never inside an aligned block).** Each per-phase ping carries the **acting agent's pinned color** — the same hue Claude Code tints that agent's team pane (set in its `agents/agentille-*.md` `color:` frontmatter) — so the rail and the panes speak one color language, and a clean run is naturally multi-colored:

| LED | Agent / phase |
|---|---|
| 🟢 | executor (build) · recon / ship — orchestrator lifecycle |
| 🔵 | planner · plan-reviewer (plan + plan-review) |
| 🟠 | ui-prototyper (the UI design blueprint) |
| 🟡 | code-reviewer (gate) — doubles as caution / soft-wait |
| 🟣 | design-reviewer (visual gate) |
| 🔴 | security-reviewer — doubles as a hard blocker / stop |
| ⚪ | pending / not started |

Status (done / active / waiting) rides in the **glyph + trailing text** — `✓` landed, `▸` / `spawned` / `running` active, `waiting` soft-blocked — not the LED. The two warm hues double up on purpose: 🟡 = the code gate *or* a caution, 🔴 = the security gate *or* a stop — both read as *attention*.

---

## Color rules (what the terminal actually honors)

- **Config-highlight fences** (` ```yaml `) are the richest color the orchestrator controls — the highlighter paints keys, values, and `#` comments in distinct hues, theme-independent, no ANSI. Use them for the static cards (Brief, fanout, Debrief). Color is per *token*, not per column, so write `key: value # comment` rows — never a box border, which renders unstyled and fights alignment.
- **` ```diff ` fences** give green (`+`) / red (`-`) for verdicts, free. Use them for pass/fail audit lines.
- **Colored-emoji LEDs** (`🟢🔵🟠🟡🟣🔴⚪`) are theme-independent too — use them in the live ping lines (Frame 2), the one place a double-width glyph belongs. The per-phase LED = the acting agent's color (see the legend), matching its team-pane tint.
- **Theme accents** (`code spans`, **bold**, headings, `>` bars) get colored by the *user's* theme — consistent, but not a color you pick. Fine to lean on, don't depend on a specific hue.
- **NEVER emit raw ANSI escape codes** (`\033[…m`). They are stripped or printed literally in assistant markdown and look broken.
- **Mind glyph width.** Geometric glyphs `◉ ◐ ○ ✓` are single-width — safe to align inside any fence. Colored-emoji LEDs are double-width — they break monospace alignment, so they stay in ping lines, never inside an aligned card.

---

## Mode notes

- **Subagent mode:** the lead prints every frame inline (results return to the lead). The fanout block visualizes parallel `Agent` dispatches; pings update as each returns.
- **Team mode:** the lead still prints the rail in its own pane. Teammate panes (the user's `teammateMode`) are *not* ours to style — the rail is the lead's connective narration above them, not a replacement. At run end the lead runs teardown (`team-mode.md` → "Teardown") and closes those panes, then prints the Debrief `team:` row confirming the collapse — so the screen the user is left with is the lead alone, not a wall of idle teammates.
- **Degrade:** if a frame can't render (e.g. a station's metadata is unknown), drop that field, never the run. Logging and display both follow the same law: they never block the user's result.
