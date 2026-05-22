# agentille-init — Question Script

## Section 1 of 3 — Identity (9 questions)

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

## Section 2 of 3 — Communication (5 questions)

10. **deliveryStyle** — *How should Claude deliver answers?*
    - enum: `direct` / `detailed` / `step-by-step` / `short-paragraphs`

11. **neverDo** — *Behaviors Claude should NEVER do:*
    - multi-select: see `profile-schema.md` → `NEVER_DO_PRESETS`

12. **customNeverDo** — *Anything else Claude should never do? (free text, optional)*

13. **tone** — *What tone should Claude use with you?*
    - enum: `peer` / `mentor` / `formal` / `blunt` / `casual`

14. **writingSamples** — *Paste a writing sample of yours (optional — Claude learns your voice).*
    - free text, optional

## Section 3 of 3 — Thinking (5 questions)

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

(Yes, that's actually 19 — section 3 has 5 questions. "18" in section headers is a rough estimate; the canonical count is in `profile-schema.md`.)
