# Lenses — the eight research angles

Each lens is one Sonnet `general-purpose` agent. It gets the dispatch header, `brief.md` (with `SCOUTS:`), its block below, the focus, the exclusion list, and the schema at the bottom. `quick` runs lenses 1–4 only.

Order matters: the first four are the ones that pay.

## 1. `pain` — what users complain about

Find the complaints of people who use this product or its nearest competitors: app-store reviews, Reddit threads, GitHub issues, forum posts, support FAQs. Turn the top recurring complaints into features. Quote the complaint and link it. Prefer complaints repeated by ≥3 people over one loud one.

## 2. `rival` — competitor teardown

Name the 3 closest competitors (search; the brief may name some). List the features they ship that this project lacks, and the features they charge for. A candidate here is either parity that users expect, or a gap none of them fill. Link the pricing or feature page.

## 3. `money` — what people pay for

Bias: `valueAxis`. For `revenue`: paywall-able features, upsell tiers, usage-based add-ons, team/seat features, exports and integrations people pay for in this category. For `retention`: what keeps players returning (progression, daily hooks, social proof, sharing). For `time-saved`: the manual step the tool still leaves to the human. Evidence: a competitor pricing page, a review that says "I'd pay for", or a `file:line` showing the half-built hook.

## 4. `native` — what the code already half-supports

Code only, no web. From `SCOUTS:` and your own reads: unused data the UI never shows, TODOs that describe a feature, flags off, routes without a screen, models without an editor, exports without an import. Cheap wins first: effort S or M, fit 3. Evidence is `file:line`.

## 5. `loop` — activation and retention

The first five minutes and the return visit. Onboarding gaps, empty states, the first-success moment, reminders and notifications, streaks, saved state, resume-where-you-left. Evidence: a review or a `file:line` showing the gap (an empty state with no CTA, a flow with no save).

## 6. `reach` — distribution baked into the product

Features that bring the next user: shareable output (links, images, embeds, exports with a watermark), public pages that rank, integrations with tools the users already run, referral or invite flows, templates and galleries. Evidence: a competitor doing it, or a channel where the audience already is.

## 7. `lever` — new platform and AI capability

What became possible in the last 12 months on this stack: OS APIs, browser APIs, on-device models, LLM features, new SDKs. One candidate per capability, each tied to a concrete user outcome, not "add AI". Evidence: the API docs page plus the user outcome it unlocks.

## 8. `trust` — quality people notice

Reliability, speed, accessibility, offline, data safety, polish that reviewers mention. Only candidates a user would name in a review ("it never loses my work", "it loads instantly"). Evidence: a review, a measured number from the code (bundle size, cold start, missing labels), or a `file:line`.

## Schema

Return exactly this per candidate, 3–5 candidates, nothing else before or after:

```
### <title, ≤8 words>
pitch: <one sentence, ≤20 words, the user outcome>
who: <who wants it> — evidence: <URL or file:line>
user: <0–3>   value: <0–3>   fit: <0–3>   effort: <S|M|L>   risk: <0–2>
touches: <paths or areas, ≤5>
why-not: <the strongest reason to skip it, one line>
```

Scale: `user` = how many current users feel it (0 none, 3 most). `value` on the brief's `valueAxis` (0 none, 3 directly). `fit` = how much the codebase already supports it (0 new subsystem, 3 wiring only). `effort`: S ≤ one executor slice under 2 h, M a half-day slice, L a full-day slice or two slices. `risk`: 0 none, 1 needs a key, a migration or a platform review, 2 needs money or an approval Edwin does not have.

Budget: ≤12 tool calls, ≤40 lines of output. Research only: never edit a file. Skip anything on the exclusion list and anything the inventory scout already found built.
