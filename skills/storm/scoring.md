# Scoring, auto-pick, adversary

## Score

```
score = 2·user + 2·value + fit − effort − risk        (effort S=1 M=2 L=3)
```

Range −5 to 13. Tie-break: lower effort, then higher value, then more evidence links.

Judge rules:
- Near-duplicates (same user outcome) merge into one card keeping the best title, every evidence link, and the lowest honest effort.
- Anything on the exclusion list (shipped before, dropped before, already built per the inventory scout) is removed before scoring.
- No evidence → removed.
- When a lens agent scored itself generously (every field 3), re-score it from its evidence; a lens is not a judge.
- Keep the top 10–15. Fewer than 10 after merging → note it on the card, never pad.

## Adversary verdicts

For each of the top 8 the adversary answers one of:

- `KEEP` — the case holds.
- `SHRINK <scope>` — the outcome is right, the scope is too big; the new scope must fit one executor slice. Re-score with the smaller effort.
- `DROP <reason>` — nobody asked (evidence is thin or one-off), the code already does it, it needs money or an approval Edwin lacks, or it conflicts with `neverDo`.

The judge applies verdicts literally and re-ranks. Dropped cards go to the doc's "Dropped" section so the next storm skips them.

## Auto-pick

Without `N`:

1. Take candidates with `score ≥ max(top − 2, 6)` in rank order.
2. Keep adding while total effort points ≤ 8 (S 1, M 2, L 3) and count ≤ 5.
3. Fewer than 2 → take the top 2 anyway.
4. `risk 2` never auto-picks: it goes to runner-ups with "needs Edwin".

So a strong field gives 3–5 small picks; a field of two big winners gives 2. `quick` caps at 3.

## Effort → hand-off level

Total effort of the picks ≤ 3 points → `/agt medium` is enough; say so on the card but still send `heavy` unless `quick`. Heavy is what `/storm` promises: one pane per slice.
