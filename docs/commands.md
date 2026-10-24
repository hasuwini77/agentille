# Commands

Every command agentille adds, with its arguments. The README's Commands section names the four you need first; this page holds the full list.

## Every command

| You type | You get |
|---|---|
| `/agt "task"` | The level is detected: low (solo or one builder), medium (2–3 builders in parallel as subagents) or heavy (one Herdr/tmux pane per part) |
| `/agt low\|medium\|heavy "task"` | Force the level for one run |
| `/agt next ["task"]` | Build the next item in `.agentille/backlog.md` and integrate it (PR by default) or escalate; after a merged item it takes the next one, and stops on the first escalation · with a task: queue it |
| `/agt --fable "task"` | The top model tier on judgment roles for one run |
| `/agt-info [routing\|ledger\|squads\|route <role>]` | Display settings in effect, last run's routing and ledger, active squads · or one view: routing decisions, tokens per role, the squad rescan · or a dry-run of what a role would route to, escalation rungs included |
| `/agt-spawn "task" [--model …]` | One extra routed Claude pane (Herdr or tmux); it closes itself once its answer is saved |
| `/agt-clean` | Tidy up now: close finished agt panes, remove merged and clean `agt/*` worktrees and branches, drop run folders untouched for 14 days. Anything still working, unmerged or with changes stays. When a run ends the pane and worktree part runs on its own; at session start only finished panes a dead lead left behind are closed |
| `/agt-tell <worker> <message>` | Message a worker pane over the wire |
| `/storm [quick] [N] ["focus"] [--ask\|--no-build\|--next]` | Decide what to build next: 11 research agents on your repo and its market, 10–15 scored candidates, the best 2–5 picked and specced in `docs/storm/<date>.md`, then a fresh session beside you that types `/agt heavy` |
| `/agt-deck [auto\|off]` | A side pane with the run's cast, routing timeline, wire log and token bars · open it on every `/agt` · stop |
| `/agentille-project` · `/agentille-claude-md [path]` | Seed a repo's CLAUDE.md · tune a CLAUDE.md: your global `~/.claude/CLAUDE.md`, or the file at `path` (a repo's own `./CLAUDE.md`, say) |

`/agentille-init` (optional, about a minute) sets your voice: [settings.md](./settings.md#voice-keys).

## Deprecated

Still honored when typed, never suggested. Each one is deprecated; removed in 4.0.0.

| You type | Instead |
|---|---|
| `/agt-focus [on\|off]` | set `display.focus` in your profile ([settings.md](./settings.md#older-commands)) |
| `/agt-highlight [on\|all\|off]` | set `display.highlight` in your profile ([settings.md](./settings.md#older-commands)) |
| `/agt --mode solo\|subagent\|panes\|herdr` | `/agt low\|medium\|heavy` |
| `/agt --plan` · `/agt --formation <f>` | no replacement: the run picks its own formation |
