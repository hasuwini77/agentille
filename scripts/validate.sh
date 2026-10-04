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
  elif [[ "$model" =~ ^(claude-(fable|opus|sonnet|haiku)-[0-9]|fable|opus|sonnet|haiku) ]]; then
    pass "$f: model '$model'"
  else
    warn "$f: model '$model' is not a recognized Claude model id/alias"
  fi
done

# ── 4. Agent reference integrity (namespaced refs resolve to a file) ─────────
hdr "Agent reference integrity"
resolves() { local stem="${1#agentille:}"; [ -f "agents/${stem}.md" ]; }

# Any agentille:agentille-<x> token in skills/ or agents/ must resolve (typo guard)
bad=0
while IFS= read -r ref; do
  resolves "$ref" || { fail "'$ref' resolves to no agent file"; bad=1; }
done < <(grep -rhoE 'agentille:agentille-[a-z-]+' skills agents 2>/dev/null | sort -u)
[ "$bad" = 0 ] && pass "all agentille:agentille-* refs in skills/ and agents/ resolve"

# ── 5. EVERY hook script declared by hooks.json exists and is executable ─────
# All of them, not just the first: a hook whose script is missing or lost its
# +x bit fails silently at runtime, which is the worst way for a hook to break.
hdr "Hooks"
hookcount=0
while IFS= read -r hookcmd; do
  [ -n "$hookcmd" ] || continue
  hookcmd=${hookcmd#\"}; hookcmd=${hookcmd%\"}
  hookrel=${hookcmd#\$\{CLAUDE_PLUGIN_ROOT\}/}
  hookcount=$((hookcount + 1))
  if [ ! -f "$hookrel" ]; then
    fail "hook script '$hookrel' (from hooks.json) does not exist"
  elif [ ! -x "$hookrel" ]; then
    fail "hook script '$hookrel' is not executable (chmod +x)"
  else
    pass "hook script '$hookrel' exists and is executable"
  fi
done < <(jq -r '.. | .command? // empty' hooks/hooks.json 2>/dev/null | sort -u)
[ "$hookcount" = 0 ] && warn "hooks.json declares no command path"

# ── 5b. Contract fields shipped in v1.31.0 (regression locks) ────────────────
# These fields ARE the contract changes of that release; losing one silently
# would revert a flagged behavior change without anyone noticing.
hdr "Contract fields (v1.31.0)"
if grep -qE '^disable-model-invocation:[[:space:]]*true' skills/agt/SKILL.md; then
  pass "skills/agt/SKILL.md: disable-model-invocation: true present (explicit /agt trigger enforced)"
else
  fail "skills/agt/SKILL.md: disable-model-invocation: true missing from frontmatter"
fi
SM=$(jq -r '.hooks.SessionStart[0].matcher // empty' hooks/hooks.json 2>/dev/null)
if [ "$SM" = "startup|resume" ]; then
  pass "hooks.json: SessionStart matcher is 'startup|resume'"
else
  fail "hooks.json: SessionStart matcher is '${SM:-<none>}' (expected 'startup|resume')"
fi
for a in agentille-planner agentille-security-reviewer agentille-design-reviewer; do
  if awk 'NR==1&&$0=="---"{f=1;next} f&&$0=="---"{exit} f{print}' "agents/$a.md" | grep -qE '^effort:[[:space:]]*high'; then
    pass "agents/$a.md: effort: high present"
  else
    fail "agents/$a.md: effort: high missing from frontmatter"
  fi
done

# The orchestrator skill loads on every /agt run; keep it lean.
SL=$(wc -l < skills/agt/SKILL.md | tr -d ' ')
if [ "$SL" -le 120 ]; then pass "skills/agt/SKILL.md is $SL lines (budget 120)"; else fail "skills/agt/SKILL.md is $SL lines (budget 120)"; fi

# ── 6. Doc cross-references (file exists = FAIL; section match = WARN) ────────
hdr "Doc cross-references"
# Pattern: `something.md` ... → "Section Title" in skills, agents and the
# text the mod injects (hooks/*.js), which the model reads just the same.
missing_sec=0; checked=0
while IFS=$'\t' read -r file section; do
  [ -n "$file" ] || continue
  target=""
  section=${section//\\/}
  for cand in "skills/agt/$file" "skills/$file" "agents/$file" "$file"; do
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
done < <(grep -rhoE '`[A-Za-z0-9._-]+\.md`[^"]*→[[:space:]]*"[^"]+"' skills agents hooks/*.js 2>/dev/null \
          | sed -E 's/`([A-Za-z0-9._-]+\.md)`[^"]*→[[:space:]]*"([^"]+)"/\1\t\2/')
[ "$checked" -gt 0 ] && [ "$missing_sec" = 0 ] && pass "all $checked '→ \"Section\"' cross-refs resolve to a heading"

# ── 6b. Routing mirror invariant (routing.md ↔ hooks/routing.js) ──────────
# The mod enforces hooks/routing.js; routing.md "Default routing" is its
# human-readable spec. Every role and every model · effort cell must agree.
# A doc cell of "—" means no override (null in code); "skipped" is not compared.
hdr "Routing mirror invariant"
if ! command -v python3 >/dev/null 2>&1; then
  warn "mirror: python3 not found — routing table comparison skipped"
else
  mirror_out=$(python3 - <<'PY'
import re, sys
doc = open('skills/agt/routing.md').read()
code = open('hooks/routing.js').read()
sec = doc.split('## Default routing', 1)[1].split('\n## ', 1)[0]
rows = {}
for line in sec.splitlines():
    c = [x.strip() for x in line.strip().strip('|').split('|')]
    if len(c) == 5 and c[0] not in ('role',) and not set(c[0]) <= set('-'):
        rows[c[0]] = c[1:]
def cell(v):
    if v.startswith('—'): return None
    if v.startswith('skipped'): return 'skip'
    m = re.match(r'(\w+) · (\w+)', v)
    return (m.group(1), m.group(2)) if m else '?'
pat = re.compile(r"^\s*'?([a-z-]+)'?:\s*\{\s*base: \['(\w+)', '(\w+)'\],\s*large: \['(\w+)', '(\w+)'\],\s*risk: (null|\['(\w+)', '(\w+)'\]),\s*quick: \['(\w+)', '(\w+)'\]", re.M)
table = {}
for m in pat.finditer(code):
    g = m.groups()
    table[g[0]] = [(g[1], g[2]), (g[3], g[4]), None if g[5] == 'null' else (g[6], g[7]), (g[8], g[9])]
bad = 0
if set(rows) != set(table):
    print('FAIL roles differ: doc-only %s, code-only %s' % (sorted(set(rows) - set(table)), sorted(set(table) - set(rows)))); bad = 1
cols = ['default', 'size=large', 'risk', 'quick']
for role in sorted(set(rows) & set(table)):
    for i, col in enumerate(cols):
        d = cell(rows[role][i])
        if d == 'skip': continue
        if d != table[role][i]:
            print('FAIL %s %s: doc %s, code %s' % (role, col, d, table[role][i])); bad = 1
if not bad: print('PASS %d roles × 4 columns agree' % len(table))
PY
)
  while IFS= read -r line; do
    case "$line" in PASS*) pass "mirror: ${line#PASS }";; FAIL*) fail "mirror: ${line#FAIL }";; esac
  done <<< "$mirror_out"
  # A python error prints nothing; silence must not pass as agreement.
  printf '%s\n' "$mirror_out" | grep -qE '^(PASS|FAIL)' || fail "mirror: comparison produced no result (is skills/agt/routing.md → \"Default routing\" intact?)"
fi

# ── 6c. The mod: Claude Code's own validator + its tests ────────────────────
# Skipped (WARN) where the claude CLI is absent, e.g. CI runners without it.
hdr "Mod (hooks/register.js)"
if ! command -v claude >/dev/null 2>&1; then
  warn "claude CLI not found — run 'claude plugin validate' and 'claude plugin test .' locally"
else
  if claude plugin validate .claude-plugin/plugin.json 2>&1 | grep -q '✘'; then
    fail "claude plugin validate reports errors"
  else
    pass "claude plugin validate passes"
  fi
  tout=$(claude plugin test . 2>&1); trc=$?
  if [ "$trc" = 0 ]; then pass "claude plugin test: $(printf '%s\n' "$tout" | grep -oE '[0-9]+ pass' | tail -1)"; else fail "claude plugin test failed"; fi
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
