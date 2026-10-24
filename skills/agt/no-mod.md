# Without the mod

What the lead does itself when the mod is not loaded (mods off) or loaded but not drawing (the VS Code chat panel, `claude -p`). Each main file keeps a one-line pointer where its fork was; everything else in the skill reads the same either way.
Tell them apart by the blocks the mod appends to the skill text: a loaded mod always appends `## Pane transport (agentille mod)`, adds `## Drawing (agentille mod)` when it draws, and `## Squads detected by the agentille mod` only when a squad matched.

## Squad detection

Only with the mod not loaded (with it, a missing squads block means no squad matched). Read `.claude-plugin/squads.json`. Score each squad = its `signals.deps` found in `package.json` + its `signals.paths` that exist. Active when score ≥ `minScore`. Then add reviewers as `squads.md` → "How squads change the roster" says.

## Drawing

With no `## Drawing (agentille mod)` block (mods off, the VS Code chat panel, `claude -p`), do all of the items `display.md` → "When the mod draws" lists, as written there and below:

- the `[agentille v<version>]` suffix on the recon line (`display.md` → "Mid-run lines")
- the TodoWrite progress spine ("Progress spine" below)
- the profile tip (`SKILL.md` → "The contract" step 1)
- report.md's `## Agents` and `## Raw reports` sections (`display.md` → "report.md")

### Progress spine

Before the first dispatch, seed TodoWrite with one todo per phase the roster actually has (e.g. plan · build · review · ship). Mark each in progress, then done, as it moves. That is the whole live view you write.

## Pane transport

Probe it yourself, once: inside Herdr (`HERDR_ENV=1`, `herdr` on PATH) or tmux (`$TMUX`, `tmux` on PATH), Herdr first. Otherwise fall through silently to a workflow or subagent waves (`panes-mode.md` → "When panes open").

## Spawning a pane worker

Manual recipe, only when the mod is off (Herdr):

```bash
herdr worktree create --branch "feat/<slug>" --base "$BASE" --label "<slice>" --no-focus
herdr pane split --current --direction right --cwd "<worktree>" --env "AGENTILLE_RUN=<run-id>" --no-focus
herdr agent start "agt-<run-id>-exec-1" --kind claude --pane <pane-id>   # id: .result.pane.pane_id
```

`feat/<slug>` stands for the slice branch `factory.md` → "Integrate" names (`fix/<slug>`, or `agt/<slug>` off a feature branch), written out. Then send one prompt: `isolated: false`, `branch:` and `base:`, the task, the profile block, the slice's file set, its verification command, its exit criterion. Spawn the whole wave first, then wait. Never focus.

On tmux (outside Herdr):

```bash
tmux split-window -d -h -P -F '#{pane_id}' -t "$TMUX_PANE" -c <cwd> \
  -e AGENTILLE_RUN=<run> "$SHELL" -ic 'claude "$@"' agt \
  --model <model> -n <name> -- "<task>"
tmux set-option -p -t <id> @agt <name>
tmux set-option -p -t <id> @agt_vendor claude
tmux set-option -p -t <id> allow-set-title off
tmux select-pane -t <id> -T <name>
```

Keep the `--`, and escape `#` as `##` in `<cwd>`. Harvest, close and the done file are the same as with the mod (`panes-mode.md` → "Harvest, then close" and "tmux transport"); with no wire, read each worker with the read loop there.
