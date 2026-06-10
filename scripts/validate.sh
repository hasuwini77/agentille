#!/usr/bin/env bash
# agentille structural validator — a linter for the failure classes a
# markdown-prompt plugin actually ships: version drift, a versioned
# marketplace.json, broken agent-namespace references, dangling doc
# cross-refs, a missing hook script, and PII leaks into a public repo.
#
# This is NOT a behavioral test framework. Dispatch decisions live in the
# model and are verified by running a representative task through /agt
# (see CLAUDE.md). This script only checks what is deterministic.
#
# Usage:  bash scripts/validate.sh
# Exit:   0 = all hard checks pass · 1 = at least one FAIL.
#         WARNs never fail the build; they are advisory.

set -uo pipefail
cd "$(dirname "$0")/.." || exit 2

FAILS=0
WARNS=0
if [ -t 1 ]; then R=$'\e[31m'; G=$'\e[32m'; Y=$'\e[33m'; B=$'\e[1m'; X=$'\e[0m'; else R=; G=; Y=; B=; X=; fi
pass() { printf '%s[PASS]%s %s\n' "$G" "$X" "$1"; }
fail() { printf '%s[FAIL]%s %s\n' "$R" "$X" "$1"; FAILS=$((FAILS+1)); }
warn() { printf '%s[WARN]%s %s\n' "$Y" "$X" "$1"; WARNS=$((WARNS+1)); }
hdr()  { printf '\n%s== %s ==%s\n' "$B" "$1" "$X"; }

# ── 1. JSON validity ─────────────────────────────────────────────────────────
hdr "JSON validity"
for j in .claude-plugin/plugin.json .claude-plugin/marketplace.json hooks/hooks.json; do
  if [ ! -f "$j" ]; then fail "$j missing"; continue; fi
  if jq -e . "$j" >/dev/null 2>&1; then pass "$j parses"; else fail "$j is not valid JSON"; fi
done

# ── 2. Version: plugin semver, marketplace has none, changelog agrees ─────────
hdr "Versioning"
PV=$(jq -r '.version // empty' .claude-plugin/plugin.json 2>/dev/null)
if [[ "$PV" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  pass "plugin.json version is semver ($PV)"
else
  fail "plugin.json version is missing or not X.Y.Z (got: '${PV:-<none>}')"
fi

if [ "$(jq -r '.version // "null"' .claude-plugin/marketplace.json 2>/dev/null)" = "null" ]; then
  pass "marketplace.json has no top-level version (correct — never version-bump it)"
else
  fail "marketplace.json has a 'version' field — remove it (see CLAUDE.md release recipe)"
fi

CL=$(grep -m1 -oE '^## \[[0-9]+\.[0-9]+\.[0-9]+\]' CHANGELOG.md 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')
if [ -z "$CL" ]; then
  fail "CHANGELOG.md has no top-most '## [X.Y.Z]' entry"
elif [ "$CL" = "$PV" ]; then
  pass "CHANGELOG top entry ($CL) matches plugin.json ($PV)"
else
  fail "version drift: CHANGELOG top is $CL but plugin.json is $PV"
fi
# soft: top entry should carry a date
if ! grep -m1 -E '^## \[[0-9]+\.[0-9]+\.[0-9]+\] — [0-9]{4}-[0-9]{2}-[0-9]{2}' CHANGELOG.md >/dev/null 2>&1; then
  warn "CHANGELOG top entry has no '— YYYY-MM-DD' date"
fi

# ── 3. Agent frontmatter (name matches filename, model present) ──────────────
hdr "Agent definitions"
AGENT_STEMS=()
for f in agents/agentille-*.md; do
  [ -e "$f" ] || { fail "no agents/agentille-*.md files found"; break; }
  stem=$(basename "$f" .md)
  AGENT_STEMS+=("$stem")
  fm=$(awk 'NR==1&&$0=="---"{f=1;next} f&&$0=="---"{exit} f{print}' "$f")
  name=$(printf '%s\n' "$fm" | sed -nE 's/^name:[[:space:]]*//p' | head -1)
  model=$(printf '%s\n' "$fm" | sed -nE 's/^model:[[:space:]]*//p' | head -1)
  if [ "$name" = "$stem" ]; then pass "$f: name matches filename"; else fail "$f: name '$name' != filename stem '$stem'"; fi
  if [ -z "$model" ]; then
    fail "$f: no 'model:' in frontmatter"
  elif [[ "$model" =~ ^(claude-(opus|sonnet|haiku|fable)-[0-9]|opus|sonnet|haiku|fable) ]]; then
    pass "$f: model '$model'"
  else
    warn "$f: model '$model' is not a recognized Claude model id/alias"
  fi
done

# ── 4. Agent reference integrity (namespaced refs resolve to a file) ─────────
hdr "Agent reference integrity"
resolves() { local stem="${1#agentille:}"; [ -f "agents/${stem}.md" ]; }

# 4a. team YAML lead/role values must be agentille:agentille-* and resolve
for y in .claude-plugin/teams/*.yaml; do
  [ -e "$y" ] || continue
  while IFS= read -r ref; do
    if [[ "$ref" != agentille:agentille-* ]]; then
      fail "$y: '$ref' is not a namespaced agentille:agentille-* ref"
    elif resolves "$ref"; then
      pass "$y: $ref → agents/${ref#agentille:}.md"
    else
      fail "$y: '$ref' resolves to no agent file"
    fi
  done < <(grep -hoE '(lead|role):[[:space:]]*[A-Za-z:_-]+' "$y" | sed -E 's/^(lead|role):[[:space:]]*//')
done

# 4b. any agentille:agentille-<x> token in skills/ must resolve (typo guard)
bad=0
while IFS= read -r ref; do
  resolves "$ref" || { fail "skills/: '$ref' resolves to no agent file"; bad=1; }
done < <(grep -rhoE 'agentille:agentille-[a-z-]+' skills 2>/dev/null | sort -u)
[ "$bad" = 0 ] && pass "all agentille:agentille-* refs in skills/ resolve"

# ── 5. Hook script declared by hooks.json exists and is executable ───────────
hdr "Hooks"
hookcmd=$(jq -r '.. | .command? // empty' hooks/hooks.json 2>/dev/null | head -1)
hookrel=${hookcmd#\$\{CLAUDE_PLUGIN_ROOT\}/}
if [ -z "$hookrel" ]; then
  warn "hooks.json declares no command path"
elif [ ! -f "$hookrel" ]; then
  fail "hook script '$hookrel' (from hooks.json) does not exist"
elif [ ! -x "$hookrel" ]; then
  fail "hook script '$hookrel' is not executable (chmod +x)"
else
  pass "hook script '$hookrel' exists and is executable"
fi

# ── 6. Doc cross-references (file exists = FAIL; section match = WARN) ────────
hdr "Doc cross-references"
# Pattern: `something.md` ... → "Section Title"  (skill docs lean on these)
missing_sec=0; checked=0
while IFS=$'\t' read -r file section; do
  [ -n "$file" ] || continue
  target=""
  for cand in "skills/agt/$file" "skills/$file" "$file"; do
    [ -f "$cand" ] && { target="$cand"; break; }
  done
  if [ -z "$target" ]; then
    fail "cross-ref to '$file' → \"$section\": file not found"
    continue
  fi
  checked=$((checked+1))
  if grep -iE "^#{1,6} .*${section//\//\\/}" "$target" >/dev/null 2>&1; then
    :
  else
    warn "cross-ref \"$section\" not found as a heading in $target"
    missing_sec=$((missing_sec+1))
  fi
done < <(grep -rhoE '`[A-Za-z0-9._-]+\.md`[^"]*→[[:space:]]*"[^"]+"' skills 2>/dev/null \
          | sed -E 's/`([A-Za-z0-9._-]+\.md)`[^"]*→[[:space:]]*"([^"]+)"/\1\t\2/')
[ "$checked" -gt 0 ] && [ "$missing_sec" = 0 ] && pass "all $checked '→ \"Section\"' cross-refs resolve to a heading"

# ── 6b. Routing mirror invariant (SKILL.md Step 3 ↔ model-routing.md) ────────
# The dispatch contract lives in two tables that must agree row-for-row:
# SKILL.md "Step 3 — Resolve MODELS" and model-routing.md "Default routing".
# Role lists must match exactly; Default tiers are compared wherever both
# cells name exactly one alias token (a cell like "heuristic, no LLM" yields
# none and is skipped — prose drift there is for human review).
hdr "Routing mirror invariant"
extract_routing() { # $1 = file, $2 = heading regex → "role<TAB>tier-or-?" lines
  awk -v h="$2" '
    $0 ~ h {grab=1; next}
    grab && /^\|/ {
      intab=1
      split($0, c, "|")
      role=c[2]; def=tolower(c[3])
      gsub(/[* ]/, "", role); role=tolower(role)
      if (role=="role" || role ~ /^-+$/) next
      cnt=0; tokval="?"; delete seen
      rest=def
      while (match(rest, /opus|sonnet|haiku|fable|tiered/)) {
        tok=substr(rest, RSTART, RLENGTH)
        if (!(tok in seen)) { seen[tok]=1; cnt++; tokval=tok }
        rest=substr(rest, RSTART+RLENGTH)
      }
      print role "\t" (cnt==1 ? tokval : "?")
      next
    }
    grab && intab {exit}
  ' "$1"
}
MA=$(extract_routing skills/agt/SKILL.md '^### Step 3')
MB=$(extract_routing skills/agt/model-routing.md '^## Default routing')
if [ -z "$MA" ] || [ -z "$MB" ]; then
  fail "mirror: could not extract a routing table (heading moved? table not found)"
else
  RA=$(printf '%s\n' "$MA" | cut -f1); RB=$(printf '%s\n' "$MB" | cut -f1)
  if [ "$RA" = "$RB" ]; then
    pass "mirror: both tables list the same $(printf '%s\n' "$RA" | wc -l) roles in the same order"
  else
    fail "mirror: role lists differ between SKILL.md Step 3 and model-routing.md Default routing"
  fi
  drift=0
  while IFS=$'\t' read -r role tok; do
    tb=$(printf '%s\n' "$MB" | awk -F'\t' -v r="$role" '$1==r{print $2}')
    [ -z "$tb" ] && continue
    if [ "$tok" != "?" ] && [ "$tb" != "?" ] && [ "$tok" != "$tb" ]; then
      fail "mirror: '$role' default drifts — SKILL.md says '$tok', model-routing.md says '$tb'"
      drift=1
    fi
  done <<< "$MA"
  [ "$drift" = 0 ] && pass "mirror: default tiers agree for all comparable roles"
fi

# ── 7. PII / privacy scan (public repo — hard fail) ──────────────────────────
# Pattern-based only: this script is public, so it must NOT hardcode the
# private names it guards against. Categorical leaks (paths, emails) are
# caught here; human review covers names (see CLAUDE.md "Privacy & OSS hygiene").
hdr "Privacy scan (tracked files)"
SCAN_FILES=$(git ls-files 2>/dev/null | grep -vE '^(scripts/validate\.sh|\.github/)')
leakhit=0
scan() { # $1 = regex, $2 = label
  local hits
  hits=$(printf '%s\n' "$SCAN_FILES" | xargs -d '\n' grep -nE "$1" 2>/dev/null)
  if [ -n "$hits" ]; then fail "possible $2 leak:"; printf '%s\n' "$hits" | sed 's/^/    /'; leakhit=1; fi
}
scan '/home/[a-z]'                                            "absolute home path (/home/...)"
scan '/Users/[A-Za-z]'                                        "absolute home path (/Users/...)"
scan '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.(com|mil|gov|io|se|net|org)' "email address"
[ "$leakhit" = 0 ] && pass "no absolute home paths or email addresses in tracked files"

# ── Summary ──────────────────────────────────────────────────────────────────
hdr "Summary"
printf '%d fail(s), %d warning(s)\n' "$FAILS" "$WARNS"
[ "$FAILS" -eq 0 ] || exit 1
exit 0
