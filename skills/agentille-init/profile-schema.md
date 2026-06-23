# WizardProfile JSON Schema

The profile written to `~/.agentille/profile.json` matches this shape:

```json
{
  "schemaVersion": 2,
  "name": "string",
  "role": "string",
  "responsibilities": "string",
  "goals": "string",
  "techStack": ["string", "..."],
  "expertIn": "string",
  "learning": "string",
  "newTo": "string",
  "useCases": ["string", "..."],

  "deliveryStyle": "direct | detailed | step-by-step | short-paragraphs",
  "neverDo": ["string", "..."],
  "customNeverDo": "string",
  "tone": "peer-to-peer | mentor | formal | blunt | casual",
  "writingSamples": "string",

  "preTaskQuestioning": "always | ambiguous-only | never",
  "challengeLevel": "supportive | balanced | sparring | ruthless",
  "disagreementStyle": "push-back | both-sides | defer",
  "thinkingDepth": "always | complex-only | quick",
  "honestyLevel": "diplomatic | brutal | default",

  "projects": [],
  "selectedPrompts": []
}
```

## schemaVersion

Integer. Current value: **2**.

| Value | Meaning |
|---|---|
| absent or `1` | Pre-team profile (v1.0/v1.1). Has all Section 1–3 keys; `team` object is absent. |
| `2` | Team section present (v1.2+). All 4 sections complete. |

**How it works with key-presence detection:**
- Key-presence is the robust, field-level signal: a field is "already answered" if its key exists in the profile JSON, even if the value is empty.
- `schemaVersion` is the explicit migration marker for batch upgrades and tooling.
- On re-run with an absent or `1` profile: the wizard detects `team` keys are absent, asks only the 3 Section 4 questions, then re-stamps `schemaVersion: 2`.
- When future schema versions add new fields, those fields will also be detected as absent via key-presence — `schemaVersion` alone is not the gating check.

**Extending the schema (for maintainers):** when you add wizard fields, (1) add them to `WIZARD_KEYS` below, (2) add their questions to `questions.md`, and (3) bump `schemaVersion` (and this section's "current value") so existing profiles get a clean migration marker. Key-presence does the actual asking; the bump is for tooling and the "already complete" check.

## WIZARD_KEYS

The canonical set of wizard-owned keys. The init wizard checks presence against THIS list to decide what to ask — not against whatever happens to be in an existing profile. Keys not in this list (`schemaVersion`, `projects`, `selectedPrompts`) are system-owned and never asked.

```json
{
  "flat": [
    "name", "role", "responsibilities", "goals", "techStack",
    "expertIn", "learning", "newTo", "useCases",
    "deliveryStyle", "neverDo", "customNeverDo", "tone", "writingSamples",
    "preTaskQuestioning", "challengeLevel", "disagreementStyle", "thinkingDepth", "honestyLevel"
  ],
  "team": ["enabled", "defaultMode", "maxTeammates"]
}
```

19 flat keys + 3 `team.*` sub-keys = the 22 questions. `team.displayMode` and `team.dailySoftCap` are NOT in this list — they are written as defaults (`"auto"`, `10`) when the team section is created, never asked.

## Option arrays

Notes on `projects` and `selectedPrompts`:
- `projects` is populated by `agentille-project` skill, one entry per repo
- `selectedPrompts` is reserved for future per-prompt config; leave as empty array

---

### TECH_STACK_OPTIONS

```json
[
  "React",
  "Next.js",
  "Vue",
  "Nuxt",
  "Svelte",
  "SvelteKit",
  "Angular",
  "Remix",
  "Astro",
  "TypeScript",
  "JavaScript",
  "Python",
  "Go",
  "Rust",
  "Java",
  "Kotlin",
  "Swift",
  "C#",
  "C++",
  "Ruby",
  "PHP",
  "Elixir",
  "Node.js",
  "Bun",
  "Deno",
  "PostgreSQL",
  "MySQL",
  "SQLite",
  "MongoDB",
  "Redis",
  "Prisma",
  "Drizzle",
  "Supabase",
  "Firebase",
  "PlanetScale",
  "AWS",
  "GCP",
  "Azure",
  "Vercel",
  "Docker",
  "Kubernetes",
  "GraphQL",
  "tRPC"
]
```

---

### USE_CASE_OPTIONS

```json
[
  { "id": "coding", "label": "Coding" },
  { "id": "debugging", "label": "Debugging" },
  { "id": "architecture", "label": "Architecture" },
  { "id": "code-review", "label": "Code Review" },
  { "id": "writing", "label": "Writing" },
  { "id": "research", "label": "Research" },
  { "id": "learning", "label": "Learning" },
  { "id": "refactoring", "label": "Refactoring" },
  { "id": "testing", "label": "Testing" },
  { "id": "devops", "label": "DevOps" }
]
```

---

### DELIVERY_OPTIONS

```json
[
  { "value": "direct", "label": "Direct", "description": "Get straight to the point with no fluff" },
  { "value": "detailed", "label": "Detailed", "description": "Thorough explanations with full context" },
  { "value": "step-by-step", "label": "Step-by-step", "description": "Break everything into clear sequential steps" },
  { "value": "short-paragraphs", "label": "Short paragraphs", "description": "Concise paragraphs, easy to scan" }
]
```

---

### NEVER_DO_PRESETS

```json
[
  { "id": "no-disclaimers", "label": "No disclaimers" },
  { "id": "no-corporate-language", "label": "No corporate language" },
  { "id": "no-repeating-questions", "label": "No repeating questions" },
  { "id": "no-sycophancy", "label": "No sycophancy" },
  { "id": "no-summaries", "label": "No summaries" },
  { "id": "no-over-explaining", "label": "No over-explaining" }
]
```

---

### TONE_OPTIONS

```json
[
  { "value": "peer-to-peer", "label": "Peer-to-peer", "description": "Collaborative and equal, like a fellow engineer" },
  { "value": "mentor", "label": "Mentor", "description": "Guiding and supportive with explanations" },
  { "value": "formal", "label": "Formal", "description": "Professional and structured communication" },
  { "value": "blunt", "label": "Blunt", "description": "No-nonsense, straight shooter" },
  { "value": "casual", "label": "Casual", "description": "Relaxed and conversational" }
]
```

---

### QUESTIONING_OPTIONS

```json
[
  { "value": "always", "label": "Always", "description": "Ask clarifying questions before every task" },
  { "value": "ambiguous-only", "label": "Ambiguous only", "description": "Only ask when the request is unclear" },
  { "value": "never", "label": "Never", "description": "Make best assumptions and proceed immediately" }
]
```

---

### CHALLENGE_OPTIONS

```json
[
  { "value": "supportive", "label": "Supportive", "description": "Encouraging and affirming with gentle nudges" },
  { "value": "balanced", "label": "Balanced", "description": "Mix of support and honest critique" },
  { "value": "sparring", "label": "Sparring", "description": "Actively challenges assumptions and pushes back" },
  { "value": "ruthless", "label": "Ruthless", "description": "No mercy — exposes every flaw and weakness" }
]
```

---

### DISAGREEMENT_OPTIONS

```json
[
  { "value": "push-back", "label": "Push back", "description": "Argue the stronger position directly" },
  { "value": "both-sides", "label": "Both sides", "description": "Present pros and cons of each view" },
  { "value": "defer", "label": "Defer", "description": "Follow user's lead after flagging concerns" }
]
```

---

### THINKING_OPTIONS

```json
[
  { "value": "always", "label": "Always", "description": "Use extended thinking for every response" },
  { "value": "complex-only", "label": "Complex only", "description": "Deep thinking for hard problems only" },
  { "value": "quick", "label": "Quick", "description": "Fast responses, minimal deliberation" }
]
```

---

### HONESTY_OPTIONS

```json
[
  { "value": "diplomatic", "label": "Diplomatic", "description": "Honest but tactful and considerate" },
  { "value": "brutal", "label": "Brutal", "description": "Completely unfiltered honesty, no softening" },
  { "value": "default", "label": "Default", "description": "Balanced honesty appropriate to context" }
]
```

---

## team (added in v1.2)

| Field | Type | Default | Notes |
|---|---|---|---|
| `enabled` | bool | `false` | Master switch for team mode |
| `defaultMode` | enum | `subagent` | One of: `auto`, `subagent`, `team`, `solo` |
| `maxTeammates` | int | `4` | Cap on teammates per team |
| `displayMode` | enum | `auto` | One of: `auto`, `tmux`, `in-process`. **Informational only — does NOT control split panes.** Pane display is driven solely by Claude Code's own top-level `teammateMode` in `~/.claude/settings.json` (see `skills/agt/team-mode.md`). |
| `dailySoftCap` | int | `10` | Soft cap on team-mode runs per 24h; 0 disables warning |

Example:
```json
{
  "team": {
    "enabled": false,
    "defaultMode": "subagent",
    "maxTeammates": 4,
    "displayMode": "auto",
    "dailySoftCap": 10
  }
}
```

**Migration from v1.0/v1.1 profiles:** If `team` is absent, the orchestrator treats it as `{ enabled: false, defaultMode: "subagent", maxTeammates: 4, displayMode: "auto", dailySoftCap: 10 }`. Users without a `team` section see no behavior change — agentille keeps using subagent dispatch as in v1.0/v1.1.

---

## cockpit (optional)

### `cockpit` (optional)
- `cockpit.enabled` (boolean, default `false`) — when true, `/agt` emits a read-only event log to
  `~/.agentille/cockpit/runs/<run-id>.jsonl` for the agentille-cockpit dashboard. The first time it is
  enabled, agentille prints a one-time notice that runs are logged unredacted (0600, local only). Set
  `cockpit.redact: true` to elide `task`/`summary` in the log.
