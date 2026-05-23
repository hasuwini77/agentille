# Team mode — when to use it and how to dispatch

The orchestrator picks one of three execution modes per task:

- **subagent** (default, always available) — dispatches roles via the `Agent` tool, results return to the orchestrator. The v1.0 path.
- **team** (opt-in, experimental) — uses Claude Code's Agent Teams primitive: each role is an independent Claude session, peers can message each other, shared task list. Requires `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` and Claude Code 2.1.32+.
- **solo** — execute inline in this session, no spawn. For trivial tasks (one file mentioned, no architectural verbs).

## Auto-detection (Stage 1)

Before dispatching, check in order. First match wins:

1. User passed `--team <name>` → team mode, named template, skip Stage 2.
2. User passed `--mode <mode>` → respect, skip Stage 2.
3. `profile.team.defaultMode === 'subagent'` → subagent (authoritative, even if verb matches).
4. `profile.team.defaultMode === 'solo'` → solo (authoritative).
5. Trivial: task mentions exactly one file (e.g. `utils.ts`) AND no architectural verb (`refactor`, `design`, `architect`, `migrate`, `redesign`, `restructure`) → solo.
6. Task verb = `review` → team, `review-team` template.
7. Task verb = `debug` → team, `incident-team` template.
8. Else → fall through to Stage 2 (planner-classify).

## Stage 2 — planner-classify (Opus)

When Stage 1 returns null, dispatch the planner in classify mode by prepending `CLASSIFY:` to the user's task:

```
Agent({
  subagent_type: "agentille-planner",
  prompt: "CLASSIFY: <user task>",
  description: "Classify task for orchestrator"
})
```

The planner returns a single JSON object:

```json
{
  "mode": "subagent | team | solo",
  "team_template": "feature-team | review-team | incident-team | null",
  "roster": ["agentille-executor", "agentille-code-reviewer"],
  "reasoning": "one-sentence why"
}
```

Parse the JSON. If parsing fails, fall back to `mode: "subagent"` and log a one-line note. Never crash on a malformed classifier response.

## Pre-flight check (team mode only)

Before dispatching team mode:

1. Verify `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` is set. If not, tell the user:
   > *"Team mode is gated by `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`. Add it to `~/.claude/settings.json` (in the `env` block) or pass `--mode subagent`."*
   …and degrade to subagent mode.

2. Check `claude --version >= 2.1.32`. If older, degrade with: *"Agent Teams requires Claude Code 2.1.32+. Degraded to subagent mode."*

3. Check daily soft cap (see below). If exceeded, prompt once per session.

## Team dispatch

Given a resolved team template (loaded from `.claude-plugin/teams/<name>.yaml`):

1. **Record the run start** (capture mode, team name, teammate count, verb, and a start timestamp) so you can write the shipped-log line at the end. Keep this in your own working context — there is no log hook to feed.

2. **Spawn the team.** For each teammate entry in the template:
   - Spawn `count` instances of `subagent_type = teammate.role`
   - If `require-plan-approval: true`, instruct the teammate to plan first and wait for the lead's approval before implementing
   - Pass the user's task as the prompt

3. **Wait for completion.** When all teammates finish, the orchestrator (lead) synthesizes the final response, then appends the shipped-log line itself (see SKILL.md "Shipped log").

### Incident-team special case

For `incident-team`, override the executor prompts with adversarial framing. Generate 3 distinct hypotheses by reading the failing symptom, then assign one per executor:
- Teammate 1: "Investigate hypothesis A: [hypothesis]. Adversarially challenge teammates B and C."
- Teammate 2: "Investigate hypothesis B: [hypothesis]. Adversarially challenge teammates A and C."
- Teammate 3: "Investigate hypothesis C: [hypothesis]. Adversarially challenge teammates A and B."

The lead picks the surviving hypothesis after the debate.

## Failure → degrade

If team spawn fails for any reason (env var unset mid-flight, agent-type not found, max teammates exceeded, etc.), fall through to subagent dispatch and log one line after: *"team unavailable — ran N subagents instead"*.

## Daily soft cap

Track team-mode invocations per 24h in `~/.agentille/state/runs.jsonl` (append one JSON line per run). Before executing team mode, count runs in the last 24h. If count >= `profile.team.dailySoftCap` (default 10) AND the user has not been warned this session, show:

> *"You've run N team-mode tasks today (cap: M, set in profile). Continue? [Y/n]"*

Suppressible with `--yes` or by setting `dailySoftCap: 0`. After execution, append the run record.

## Cost transparency

Team mode uses ~4× the tokens of subagent mode (each teammate is a separate Claude session with its own context). Print one informational line at spawn time:

> *"Spawning <template>: <list of teammates>. Team mode uses ~4× tokens vs subagent mode."*

Do NOT prompt the user for confirmation per spawn — friction with no signal. The daily soft cap is the only friction by design.
