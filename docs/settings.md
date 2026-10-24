# Settings: highlight and older commands

The README's Settings section covers every `~/.agentille/profile.json` key. This page holds the detail of `display.highlight` and the commands that used to set these keys.

## `display.highlight`

Default `off`. `on` lights `/agt` replies, `all` every reply, `off` none. The mod adds text to a prompt only in the two cases below (under `all`, and text to paste).

- **The frame:** the answer that ends a lit turn draws between two rules (`╭─ ◆ agentille · time ─╮` above, `╰─╯` below) with nothing beside the text, so a selection copies no border or indent.
- **Inside it:** the first line is the headline, bullets become • rows with paths, versions and refs lit, and your steps are numbered under an amber **── your move ──** divider (or "✓ nothing needed from you").
- **Under `all`:** each question you type also gets the answer-shape note, which asks Claude for that shape: a one-line answer, at most 6 short bullets, and numbered steps only when you have something to do.
- **Text to paste:** ask for "no formatting", "plain text" or "copy-paste", or start with `raw:` (in a short prompt, or in the short first or last sentence of a long one), and under `on` or `all` the prompt gets a one-line "answer in plain text" note, the answer skips the frame, comes back as plain text and lands on your clipboard.
- **`off`** adds nothing to any prompt and copies nothing.

## Older commands

`/agt-routing`, `/agt-ledger` and `/agt-squads` were removed in v3.14.0: use `/agt-info routing|ledger|squads`. `/agt-focus` and `/agt-highlight` still work and write the `display` block, but both are deprecated and go away in v4: set `display.focus` and `display.highlight` in your profile instead.
