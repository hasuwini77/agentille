# WizardProfile JSON Schema

The profile written to `~/.agentille/profile.json` matches this shape:

```json
{
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
  "tone": "peer | mentor | formal | blunt | casual",
  "writingSamples": "string",

  "preTaskQuestioning": "always | ambiguous-only | never",
  "challengeLevel": "soft | balanced | hard",
  "disagreementStyle": "defer | discuss | push-back",
  "thinkingDepth": "quick | balanced | deep",
  "honestyLevel": "diplomatic | direct | brutal",

  "projects": [],
  "selectedPrompts": []
}
```

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
