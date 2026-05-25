# Display — the Transit Rail (how /agt shows its work)

> **Presentation only.** Nothing in this file changes classification, roster, model routing, or dispatch. It governs *how the orchestrator surfaces what it is already doing* so the user can track the run — especially the work the lead does **before** any agent is spawned. If rendering would ever block, error, or prompt, **skip it silently** — the display never gates the user's result.

The orchestrator speaks in one visual language: the **Transit Rail**. A run reads top-to-bottom like a transit line — each station is a phase, the line **forks** when work runs in parallel. Two pillars carry it:

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

---

## Pillar 1 — the TodoWrite spine

The instant the mode + roster are resolved (and **before** the first `Agent`/`TeamCreate` call), seed one todo per phase that will actually run. This is the user's live "steps left until we send the agents."

- One todo per resolved phase only — omit stations with no agent (a solo task has no `review`/`gate`; a review-team has no `build`).
- `activeForm` is the present-participle station name: `Classifying`, `Planning`, `Reviewing plan`, `Building`, `Reviewing`, `Shipping`.
- Mark each `completed` the moment its phase produces a result. Exactly one `in_progress` at a time.
- The spine is the source of truth for "what's left"; the rail is the source of truth for "how it's shaped." Keep them consistent.

---

## Pillar 2 — the rail frames

### The phases (build from the resolved roster — never a fixed six)

Canonical stations, in order: `recon → plan → review → build → gate → ship`. **Only render the stations that will run.** Examples:

- solo: `recon → build → ship`
- subagent feature w/ planner: `recon → plan → review → build → gate → ship`
- review-team: `recon → review → ship`
- incident-team: `recon → build → ship` (build = the adversarial hypothesis race)

Map roster → stations: planner ⇒ `plan`, plan-reviewer ⇒ `review`, executor(s) ⇒ `build`, code/design/security-reviewer ⇒ `gate`, PR + shipped-log ⇒ `ship`. `recon` is always present (your classification step).

### Frame 1 — Mission Brief (drawn ONCE, after classification, before dispatch)

Header in plain markdown, rail in a fenced code block (alignment only holds in monospace):

```
agentille ▸ <mode> · <template-or-category> ▸ ~<est>m
<task, first line, ≤ 60 chars>

 ◉ recon    classified: <category>
 │
 ◐ plan     <model>  · drafting
 │
 ○ review   plan-reviewer · <model>
 │
 ○ build    <N> executor(s) · <model>
 │
 ○ gate     <reviewers, space-sep>
 │
 ○ ship     PR + debrief
```

- The rail uses **ASCII fill glyphs only** (see legend) — no emoji inside the code block; emoji are double-width and shatter column alignment.
- `~<est>m` is your honest rough estimate, omit if you have none.
- In team mode, append the cost line to the header: `agentille ▸ team · feature-team ▸ ~12m · ~4× tokens`. (This replaces the standalone cost-transparency line.)

### Frame 2 — thin ping (one per phase transition)

A single markdown line — this is where the **live color** lives (colored-emoji LEDs render reliably in any theme; aligned columns do not matter here):

```
🟢 plan     5 steps · 3 parallel · opus           0:14
🟢 review   plan APPROVED · opus                  0:31
🔵 build    exec-1 ▸  exec-2 ▸  spawned           0/2
🟢 build    exec-1 ✓  exec-2 ▸                    1/2
🟢 gate     code-review · 1 should-fix → patched  2:47
```

Emit on **completion** of each station (carrying 🟢), plus one 🔵 line when a long station (build) begins so the user isn't left waiting in silence. Keep each ≤ ~60 chars before the trailing metric.

### Frame 3 — the parallel fanout (drawn ONCE when build forks)

When ≥2 workers run in parallel (team executors, or subagent chunks dispatched together, ≤3), redraw **only the build branch** so the fork is visible:

```
 ◐ build    ┌─ exec-1   ▸  sonnet   auth-api
 │          ├─ exec-2   ▸  sonnet   auth-ui
 │          └─ exec-3   ▸  sonnet   auth-tests
```

- Team mode: label each branch by callsign (`exec-1`…) + its file-slice.
- Subagent mode: label by chunk name. The fork visualizes the dispatch fan-out — the exact moment the user said is hard to track.
- Update worker glyphs via thin pings (Frame 2), not by redrawing this block.

### Frame 4 — review verdicts (diff fence = free green/red)

Review gates render in a ` ```diff ` fence — the renderer colors `+` lines green, `-` lines red, with no ANSI:

```diff
+ plan-reviewer   APPROVE
+ code-review     clean
- security        1 should-fix → patched ✓
```

Keep a `-` line for any BLOCKER/should-fix even after it's patched (append `→ patched ✓`) — the red line is the honest audit trail. A finding that is *not* resolved stays `-` with its open status; per SKILL.md it is a gate, not a memo.

### Frame 5 — Debrief (drawn ONCE, at the end)

```
✓ ship   <N> files · PR #<n> · <runtime>m
```

If no PR was opened, state what landed instead (`branch agt/<slug>`, `local`, etc.). This is the only end-of-run frame — the final prose summary follows the user's `deliveryStyle` and is separate.

---

## The LED + glyph legend

**Rail glyphs (ASCII, inside code blocks — monospace, no color):**

| Glyph | Meaning |
|---|---|
| `◉` | station complete |
| `◐` | station active |
| `○` | station pending |
| `│ ┌ ├ └ ─` | the line / a parallel fork |

**LEDs (colored emoji, in ping lines only — reliable color, never inside an aligned block):**

| LED | Meaning |
|---|---|
| 🟢 | done |
| 🔵 | active now |
| ⚪ | pending |
| 🟡 | waiting / soft-blocked (awaiting approval, retry) |
| 🔴 | hard blocker / issue found |

---

## Color rules (what the terminal actually honors)

- **Colored-emoji LEDs** are the only color the orchestrator fully controls — theme-independent. Use them in ping lines.
- **` ```diff ` fences** give green (`+`) / red (`-`) for verdicts, free.
- **Theme accents** (`code spans`, **bold**, headings, `>` bars) get colored by the *user's* theme — consistent, but not a color you pick. Fine to lean on, don't depend on a specific hue.
- **NEVER emit raw ANSI escape codes** (`\033[…m`). They are stripped or printed literally in assistant markdown and look broken.
- **Emoji are double-width** → they break monospace alignment. LEDs live in markdown ping lines; the code-block rail stays pure ASCII.

---

## Mode notes

- **Subagent mode:** the lead prints every frame inline (results return to the lead). The fanout block visualizes parallel `Agent` dispatches; pings update as each returns.
- **Team mode:** the lead still prints the rail in its own pane. Teammate panes (the user's `teammateMode`) are *not* ours to style — the rail is the lead's connective narration above them, not a replacement.
- **Degrade:** if a frame can't render (e.g. a station's metadata is unknown), drop that field, never the run. Logging and display both follow the same law: they never block the user's result.
