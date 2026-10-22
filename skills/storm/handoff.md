# Hand-off — cards, the storm doc, the agt task line

## Shortlist card (after pick, before the doc)

```
storm <id> · <project> · <n> candidates from <k> lenses · adversary dropped <d>
 1. <title> — <score> · <effort> · <value-axis> <0–3>
 2. …
runner-ups: <m> · doc: docs/storm/<date>.md (writing)
```

`--ask` stops here. "go" continues; "1 3 4" replaces the picks.

## Storm doc — `docs/storm/<YYYY-MM-DD>.md`

```
# Storm <date> — <project>

focus: <text|none> · lenses: <8|4> · run: storm-<id> · value axis: <revenue|retention|time-saved>

## Picks (build now)

### 1. <title> — score <s> (user <u> · value <v> · fit <f> · effort <S|M|L> · risk <r>)
<pitch>
Evidence: <link or file:line>, <link>
Scope:
- <≤5 bullets, each one thing the executor builds>
Acceptance:
1. <observable, testable>
2. …
Touches: <paths>

### 2. …

## Runner-ups (queue one with `/agt next "<title>"`)

| # | title | score | effort | why not now |
|---|---|---|---|---|

## Dropped (adversary)

- <title> — <reason>

## Excluded (shipped or dropped by past storms)

- <title> — <storm date>
```

Acceptance criteria are what `/agt`'s planner turns into its own ACCEPTANCE list: observable behaviour, not implementation. Three to five per pick.

## agt task line

```
/agt heavy "Build the <k> picks in docs/storm/<date>.md, one slice per pick, in this order: 1) <title> 2) <title> 3) <title>. Scope and acceptance criteria are in the doc under each pick; do not widen them. Merge each slice on green."
```

`quick` → `/agt medium "…"`. The line goes into `open_sessions` → `tasks[0]` verbatim, and is printed under the final card as the paste fallback.

`--next` → instead append per pick to `.agentille/backlog.md`:

```
- [ ] <title> (spec: docs/storm/<date>.md §<n>)
```

## Final card (≤8 lines, the only end-of-run output)

```
storm <id> · <project> · <agents> agents · <n> candidates → <k> picks
 1. <title> — <score> · <effort>
 2. …
doc: docs/storm/<date>.md (committed <sha>)
build: session opened → /agt heavy running beside you  |  paste the line below  |  queued <k> in .agentille/backlog.md → /agt next  |  skipped (--no-build)
⚑ <one line per real problem: a lens that returned nothing, a risk-2 runner-up that needs Edwin>
```

Then, when a build was requested, the paste fallback on its own line:

```
/agt heavy "…"
```
