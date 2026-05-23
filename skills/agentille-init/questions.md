# agentille-init — Question Script

> The wizard asks only for fields whose keys are absent from the existing profile (idempotent by default). Pass `--reconfigure` to re-ask all 22 questions. Total: **22 questions across 4 sections** (9 + 5 + 5 + 3).

## Section 1 of 4 — Identity (9 questions)

1. **name** — *What's your name (or how should Claude refer to you)?*
   - free text, required

2. **role** — *What's your role / title?*
   - free text, required (e.g. "Frontend Engineer")

3. **responsibilities** — *What are you responsible for day-to-day?*
   - free text, optional

4. **goals** — *What are your bigger goals?*
   - free text, optional

5. **techStack** — *Pick your tech stack:*
   - multi-select: see `profile-schema.md` → `TECH_STACK_OPTIONS`

6. **expertIn** — *What are you an expert at?*
   - free text, optional

7. **learning** — *What are you actively learning?*
   - free text, optional

8. **newTo** — *What are you new to / a beginner at?*
   - free text, optional

9. **useCases** — *Which use-cases matter most to you?*
   - multi-select: see `profile-schema.md` → `USE_CASE_OPTIONS`

## Section 2 of 4 — Communication (5 questions)

10. **deliveryStyle** — *How should Claude deliver answers?*
    - enum: `direct` / `detailed` / `step-by-step` / `short-paragraphs`

11. **neverDo** — *Behaviors Claude should NEVER do:*
    - multi-select: see `profile-schema.md` → `NEVER_DO_PRESETS`

12. **customNeverDo** — *Anything else Claude should never do? (free text, optional)*

13. **tone** — *What tone should Claude use with you?*
    - enum: `peer` / `mentor` / `formal` / `blunt` / `casual`

14. **writingSamples** — *Paste a writing sample of yours (optional — Claude learns your voice).*
    - free text, optional

## Section 3 of 4 — Thinking (5 questions)

15. **preTaskQuestioning** — *When should Claude ask clarifying questions before starting?*
    - enum: `always` / `ambiguous-only` / `never`

16. **challengeLevel** — *How hard should Claude challenge your ideas?*
    - enum: `soft` / `balanced` / `hard`

17. **disagreementStyle** — *When Claude disagrees with you, how should it handle it?*
    - enum: `defer` / `discuss` / `push-back`

18. **thinkingDepth** — *How deep should Claude think before responding?*
    - enum: `quick` / `balanced` / `deep`

19. **honestyLevel** — *How honest should Claude be?*
    - enum: `diplomatic` / `direct` / `brutal`

## Section 4 of 4 — Team mode (3 questions)

Team mode lets agentille spawn multiple parallel Claude Code sessions (Agent Teams) for complex tasks. It's experimental, uses ~4× tokens of subagent mode, and requires `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` in `~/.claude/settings.json`. Most users should leave this off until they need it.

> **Idempotent note:** v1.0/v1.1 profiles already have all Section 1–3 keys. On re-run the wizard skips straight to this section and asks only Q20–Q22.

### Q20 — Enable team mode?
**Field:** `team.enabled` (boolean)
**Options:** `yes` / `no`
**Default:** `no`

### Q21 — Default mode when not specified
**Field:** `team.defaultMode` (enum)
**Options:**
- `auto` — let agentille decide per task (Stage 1 → Stage 2 classifier)
- `subagent` — always use subagent dispatch (the v1.0 path; no team mode auto-pick)
- `team` — always use team mode (requires `team.enabled = yes`)
- `solo` — always execute inline in the orchestrator (no spawn)
**Default:** `auto` if Q20 = yes, else `subagent`

### Q22 — Maximum teammates per team
**Field:** `team.maxTeammates` (integer, 1-10)
**Default:** `4`
**Hint:** Recommended 3-5. More teammates = more parallelism but more token cost.
