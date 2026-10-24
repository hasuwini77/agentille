# Settings: display switches, highlight and older commands

The README's Settings section covers every `~/.agentille/profile.json` key. This page holds the detail of the `display` block: one switch per surface, `display.highlight`, and the commands that used to set these keys.

## Display switches

Each surface the mod draws has its own key in the `display` block. An invalid value is ignored and the key takes its default. `/agt-info` prints the value in effect and where it came from. Turning a surface off changes nothing about `/agt` itself: runs are routed, counted and reported the same, and `/agt-info` still shows them.

| key | values | default | `off` (or the other value) does |
|---|---|---|---|
| `band` | `on`, `off` | `on` | Draws nothing above the prompt: the run's tree, the wire line, the `⚑` flags and a worker pane's own band all live there and go with it. |
| `statusLine` | `on`, `off` | `on` | Pins no status line under the prompt, and clears one an earlier reload left pinned. |
| `mascot` | `on`, `off` | `on` | Drops the figure from a worker pane's band and from the deck's cast. A worker keeps its one-line caption (role, model, effort, elapsed); the deck keeps each agent's role and model. |
| `rows` | `on`, `off` | `on` | Leaves every `Agent` call in the transcript as Claude Code's own row, and a `Workflow` call without the agents listed under it. This covers a plain subagent you never ran through `/agt` and an `/agt` run's own agents alike. |
| `spinner` | `on`, `off` | `on` | Adds nothing to the main spinner: no `◇2 working` count while plain subagents work, and no phase names during an `/agt` run. |
| `deck` | `auto`, `off` | `off` | `auto` opens the deck on every typed `/agt`; `off` opens it only when you type `/agt-deck`. |
| `focus` | `true`, `false` | `true` | `false` hides the `⚑` flags in the band. |
| `highlight` | `on`, `all`, `off` | `off` | See below. |

```json
{ "display": { "band": "off", "statusLine": "on", "mascot": "off" } }
```

The daily version check is not a display key: set `AGENTILLE_UPDATE_CHECK=0` in your environment to turn it off.

## `display.highlight`

Default `off`. `on` lights `/agt` replies, `all` every reply, `off` none. The mod adds text to a prompt only in the two cases below (under `all`, and text to paste).

- **The frame:** the answer that ends a lit turn draws between two rules (`╭─ ◆ agentille · time ─╮` above, `╰─╯` below) with nothing beside the text, so a selection copies no border or indent.
- **Inside it:** the first line is the headline, bullets become • rows with paths, versions and refs lit, and your steps are numbered under an amber **── your move ──** divider (or "✓ nothing needed from you").
- **Under `all`:** each question you type also gets the answer-shape note, which asks Claude for that shape: a one-line answer, at most 6 short bullets, and numbered steps only when you have something to do.
- **Text to paste:** ask for "no formatting", "plain text" or "copy-paste", or start with `raw:` (in a short prompt, or in the short first or last sentence of a long one), and under `on` or `all` the prompt gets a one-line "answer in plain text" note, the answer skips the frame, comes back as plain text and lands on your clipboard.
- **`off`** adds nothing to any prompt and copies nothing.

## Older commands

`/agt-routing`, `/agt-ledger` and `/agt-squads` were removed in v3.14.0: use `/agt-info routing|ledger|squads`.

Two commands still work and write the `display` block, but both are deprecated and go away in v4:

| You type | You get | Instead |
|---|---|---|
| `/agt-focus [on\|off]` | Agent flags in the band on or off, saved as `display.focus` | set `display.focus` in your profile |
| `/agt-highlight [on\|all\|off]` | Which replies get lit, saved as `display.highlight` | set `display.highlight` in your profile |

When the profile cannot be written, both fall back to the mod's own store on this machine and say so. A value in `profile.json` wins over the store from the next session on.
