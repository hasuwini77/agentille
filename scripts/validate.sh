#!/usr/bin/env bash
# agentille structural validator — a linter for the failure classes a
# markdown-prompt plugin actually ships: version drift, a versioned
# marketplace.json, broken agent-namespace references, dangling doc
# cross-refs, a missing hook script, agent/routing role drift, a mod that
# fails to import under node, and PII leaks into a public repo.
#
# This is NOT a behavioral test framework. Dispatch decisions are scored by
# the local eval suite in evals/ (`claude plugin eval`, see .claude/CLAUDE.md).
# This script only checks what is deterministic.
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
# A check that cannot run because its tool is missing: a FAIL in CI (a skipped hard check must
# never read as green on the runner), a WARN on a developer machine.
skip_or_fail() { if [ "${CI:-}" = "true" ]; then fail "$1 (CI=true: the runner must provide it)"; else warn "$1"; fi; }

# ── 1. JSON validity ─────────────────────────────────────────────────────────
hdr "JSON validity"
for j in .claude-plugin/plugin.json .claude-plugin/marketplace.json .claude-plugin/squads.json hooks/hooks.json; do
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

# Every role a squad adds must have an agent file (a typo here silently adds nothing)
sqbad=0; sqn=0
while IFS= read -r role; do
  [ -n "$role" ] || continue
  sqn=$((sqn+1))
  [ -f "agents/agentille-${role}.md" ] || { fail "squads.json adds '$role': no agents/agentille-${role}.md"; sqbad=1; }
done < <(jq -r '.squads[]?.adds[]?' .claude-plugin/squads.json 2>/dev/null | sort -u)
[ "$sqbad" = 0 ] && [ "$sqn" -gt 0 ] && pass "all $sqn squads.json 'adds' roles resolve to an agent file"
[ "$sqn" = 0 ] && warn "squads.json adds no roles (or did not parse)"

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
  for cand in "skills/agt/$file" skills/*/"$file" "skills/$file" "agents/$file" "$file"; do
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
  skip_or_fail "mirror: python3 not found — routing table comparison skipped"
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

# ── 6b-readme. README routing table mirrors routing.md ───────────────────────
# README.md "## Routing" carries a verbatim copy of the routing.md "## Default routing" table.
hdr "README routing table"
if ! command -v python3 >/dev/null 2>&1; then
  skip_or_fail "readme-routing: python3 not found — README routing table comparison skipped"
else
  rr_out=$(python3 - <<'PY'
import difflib, os
def table(path, heading):
    try:
        text = open(path).read()
    except OSError:
        return None
    lines = text.splitlines()
    for i, l in enumerate(lines):
        if l.strip() == heading:
            rows = []
            for l2 in lines[i + 1:]:
                if l2.startswith('#'):
                    break
                if l2.lstrip().startswith('|'):
                    rows.append(l2.rstrip())
                elif rows:
                    break
            return rows or None
    return None
doc = table('skills/agt/routing.md', '## Default routing')
rd = table(os.environ.get('AGENTILLE_VALIDATE_README', 'README.md'), '## Routing')
if doc is None:
    print('FAIL skills/agt/routing.md has no "## Default routing" table')
elif rd is None:
    print('FAIL README.md has no "## Routing" heading followed by a table')
elif doc != rd:
    print('FAIL README.md routing table differs from routing.md "Default routing":')
    for d in difflib.unified_diff(doc, rd, 'routing.md', 'README.md', lineterm='', n=0):
        print('FAIL   ' + d)
else:
    print('PASS README routing table matches routing.md (%d rows)' % len(doc))
PY
)
  while IFS= read -r line; do
    case "$line" in PASS*) pass "readme-routing: ${line#PASS }";; FAIL*) fail "readme-routing: ${line#FAIL }";; esac
  done <<< "$rr_out"
  printf '%s\n' "$rr_out" | grep -qE '^(PASS|FAIL)' || fail "readme-routing: comparison produced no result"
fi

# ── 6b-fable. Failed-fix count before Fable agrees across the docs ──────────
# hooks/routing.js makes a mode=diagnose planner a Fable candidate after N failed fixes. README.md
# (every "<N> failed fixes"), skills/agt/routing.md ("diagnose planner after <N> failed attempts")
# and the /agt-info rung label in hooks/info.js ("diagnose, <N> failed fixes") must name the same N.
# Number words one..five and digits compare equal. A phrase that vanished from README.md,
# routing.md, routing.js or info.js is a FAIL (reword the check with it).
hdr "Fable failed-fix count"
ff_num() { tr 'A-Z' 'a-z' | sed -E 's/(^|[^a-z])one([^a-z]|$)/\11\2/; s/(^|[^a-z])two([^a-z]|$)/\12\2/; s/(^|[^a-z])three([^a-z]|$)/\13\2/; s/(^|[^a-z])four([^a-z]|$)/\14\2/; s/(^|[^a-z])five([^a-z]|$)/\15\2/' | grep -oE '[0-9]+' | head -1; }
ff_n='([0-9]+|[Oo]ne|[Tt]wo|[Tt]hree|[Ff]our|[Ff]ive)'
ff_readme="${AGENTILLE_VALIDATE_README:-README.md}"
ff_js=$(grep -oE "hdr\.mode === 'diagnose' && run\.fixes >= [0-9]+" hooks/routing.js 2>/dev/null | head -1 | grep -oE '[0-9]+$')
ff_md_all=$(grep -oE "mode=diagnose\`? planner after $ff_n failed (attempts?|fix(es)?)" skills/agt/routing.md 2>/dev/null)
ff_md=$(printf '%s\n' "$ff_md_all" | grep -oE "after $ff_n failed" | sed 's/^after //; s/ failed$//' | sort -u | while IFS= read -r w; do [ -n "$w" ] && printf '%s\n' "$w" | ff_num; done | sort -u)
ff_rd=$(grep -oE "(^|[^A-Za-z0-9])$ff_n failed fix(es)?" "$ff_readme" 2>/dev/null | sed -E 's/ failed fix(es)?$//' | while IFS= read -r w; do printf '%s\n' "$w" | ff_num; done | sort -u)
ff_info=$(grep -oE "diagnose, $ff_n failed fix(es)?" hooks/info.js 2>/dev/null | sed -E 's/^diagnose, //; s/ failed fix(es)?$//' | while IFS= read -r w; do printf '%s\n' "$w" | ff_num; done | sort -u)
ff_bad=0
if [ -z "$ff_js" ]; then fail "fable-fixes: hooks/routing.js has no \"hdr.mode === 'diagnose' && run.fixes >= N\" rule (reword this check with it)"; ff_bad=1; fi
if [ -z "$ff_md" ]; then fail "fable-fixes: skills/agt/routing.md has no \"mode=diagnose planner after N failed attempts\" rule"; ff_bad=1
elif [ "$(printf '%s\n' "$ff_md" | wc -l | tr -d ' ')" != 1 ]; then fail "fable-fixes: skills/agt/routing.md names more than one count: $(printf '%s' "$ff_md" | tr '\n' ' ')"; ff_bad=1; fi
if [ -z "$ff_rd" ]; then fail "fable-fixes: $ff_readme names no \"N failed fixes\" count"; ff_bad=1
elif [ "$(printf '%s\n' "$ff_rd" | wc -l | tr -d ' ')" != 1 ]; then fail "fable-fixes: $ff_readme names different counts: $(printf '%s' "$ff_rd" | tr '\n' ' ')"; ff_bad=1; fi
if [ "$ff_bad" = 0 ]; then
  if [ "$ff_md" != "$ff_js" ]; then fail "fable-fixes: skills/agt/routing.md says $ff_md failed attempts, hooks/routing.js moves the diagnose planner to Fable at $ff_js"; ff_bad=1; fi
  if [ "$ff_rd" != "$ff_js" ]; then fail "fable-fixes: $ff_readme says $ff_rd failed fixes, hooks/routing.js moves the diagnose planner to Fable at $ff_js"; ff_bad=1; fi
  [ "$ff_bad" = 0 ] && pass "fable-fixes: README.md, routing.md and routing.js agree: Fable after $ff_js failed fixes"
fi
if [ -z "$ff_info" ]; then fail "fable-fixes: hooks/info.js has no \"diagnose, N failed fixes\" rung label"
elif [ -n "$ff_js" ] && [ "$ff_info" != "$ff_js" ]; then fail "fable-fixes: hooks/info.js labels the rung \"$ff_info failed fixes\", hooks/routing.js says $ff_js"
elif [ -n "$ff_js" ]; then pass "fable-fixes: hooks/info.js rung label agrees ($ff_info failed fixes)"; fi

# ── 6b'. Role parity (agents/ ↔ routing.js TABLE ↔ routing.md ↔ hooks.json) ───
# A role added in one place and forgotten in another fails at runtime (an
# unrouted agent, a doc row the mod ignores). The mirror check above compares
# cells; this compares the role sets, plus the modules hooks.json loads.
hdr "Role parity"
if ! command -v python3 >/dev/null 2>&1; then
  skip_or_fail "parity: python3 not found — role parity skipped"
else
  parity_out=$(python3 - <<'PY'
import glob, json, os, re
roles = {os.path.basename(f)[len('agentille-'):-3] for f in glob.glob('agents/agentille-*.md')}
code = open('hooks/routing.js').read()
block = code.split('const TABLE = {', 1)[1].split('\n}', 1)[0]
table = set(re.findall(r"^\s*'?([a-z-]+)'?:\s*\{\s*base:", block, re.M))
doc = open('skills/agt/routing.md').read()
sec = doc.split('## Default routing', 1)[1].split('\n## ', 1)[0]
rows = set()
for line in sec.splitlines():
    c = [x.strip() for x in line.strip().strip('|').split('|')]
    if len(c) == 5 and c[0] != 'role' and not set(c[0]) <= set('-'):
        rows.add(c[0])
bad = 0
for name, other in (('routing.js TABLE', table), ('routing.md "Default routing"', rows)):
    for r in sorted(roles - other):
        print('FAIL agents/agentille-%s.md has no row in %s' % (r, name)); bad = 1
    for r in sorted(other - roles):
        print('FAIL %s lists role %s but agents/agentille-%s.md does not exist' % (name, r, r)); bad = 1
mods = json.load(open('hooks/hooks.json')).get('modules', [])
if not mods:
    print('FAIL hooks.json lists no modules (key missing or renamed?)'); bad = 1
for m in mods:
    if not os.path.isfile(os.path.join('hooks', m)):
        print('FAIL hooks.json module %s does not exist under hooks/' % m); bad = 1
if not bad: print('PASS %d agent roles match routing.js and routing.md; %d hooks.json module(s) exist' % (len(roles), len(mods)))
PY
)
  while IFS= read -r line; do
    case "$line" in PASS*) pass "parity: ${line#PASS }";; FAIL*) fail "parity: ${line#FAIL }";; esac
  done <<< "$parity_out"
  printf '%s\n' "$parity_out" | grep -qE '^(PASS|FAIL)' || fail "parity: comparison produced no result (is routing.js TABLE or routing.md → \"Default routing\" intact?)"
fi

# ── 6b''. Mod loads under node (hooks/register.js static import graph) ───────
# The mod is plain ESM; a syntax error or a bad import anywhere in the graph
# only shows up when Claude Code loads it. A clean import is the CI bar.
hdr "Mod import (node)"
if ! command -v node >/dev/null 2>&1; then
  skip_or_fail "node not found — mod import check skipped"
else
  # No package.json marks hooks/ as ESM, so the import leans on module-type detection: on by default from 22.7.
  nmajor=$(node -p 'process.versions.node' 2>/dev/null)
  if [ "$(node -p 'const [a,b]=process.versions.node.split(".").map(Number); a>22||(a===22&&b>=7)?1:0' 2>/dev/null)" != 1 ]; then
    skip_or_fail "node ${nmajor:-?} < 22.7 — mod import check skipped"
  else
    imp=$(node -e "import(process.argv[1]).then(()=>{},e=>{console.error(e&&e.message||e);process.exit(1)})" "${AGENTILLE_VALIDATE_MOD_ENTRY:-./hooks/register.js}" 2>&1); irc=$?
    if [ "$irc" = 0 ]; then
      pass "hooks/register.js imports cleanly (node $nmajor)"
    else
      fail "hooks/register.js failed to import:"; printf '%s\n' "$imp" | head -8 | sed 's/^/    /'
    fi
  fi
fi

# ── 6c. The mod: Claude Code's own validator + its tests ────────────────────
# WARN where the claude CLI is absent on a developer machine; in CI (CI=true) its absence is a
# FAIL, so the 500 mod tests can never be skipped silently on the runner.
hdr "Mod (hooks/register.js)"
if ! command -v claude >/dev/null 2>&1; then
  if [ "${CI:-}" = "true" ]; then
    fail "claude CLI not found in CI — the workflow must install @anthropic-ai/claude-code before this step"
  else
    warn "claude CLI not found — run 'claude plugin validate' and 'claude plugin test .' locally"
  fi
else
  vout=$(claude plugin validate .claude-plugin/plugin.json 2>&1); vrc=$?
  if [ "$vrc" != 0 ] || printf '%s\n' "$vout" | grep -q '✘'; then
    fail "claude plugin validate failed (exit $vrc):"; printf '%s\n' "$vout" | grep -E '✘|rror' | head -5 | sed 's/^/    /'
  else
    pass "claude plugin validate passes"
  fi
  tout=$(claude plugin test . 2>&1); trc=$?
  # Exit 0 is not enough: an empty or truncated run must not read as green. Need a pass count
  # at or above the floor (there are ~534 tests) and no failures.
  tpass=$(printf '%s\n' "$tout" | grep -oE '[0-9]+ pass' | tail -1 | grep -oE '[0-9]+')
  tfail=$(printf '%s\n' "$tout" | grep -oE '[0-9]+ fail' | tail -1 | grep -oE '[0-9]+')
  if [ "$trc" != 0 ]; then
    fail "claude plugin test failed (exit $trc)"
  elif [ -z "$tpass" ]; then
    fail "claude plugin test printed no 'N pass' count — cannot tell it ran"
  elif [ "$tpass" -lt 500 ]; then
    fail "claude plugin test: only $tpass pass (expected at least 500)"
  elif [ -n "$tfail" ] && [ "$tfail" != 0 ]; then
    fail "claude plugin test: $tfail fail"
  else
    pass "claude plugin test: $tpass pass"
  fi
fi

# ── 6d. Hook scripts: deterministic shell tests (fake HOME, file:// fixtures) ─
hdr "Hook scripts"
# tests/hooks/test-validate-gate.sh runs this script with a fake claude; it sets this so the inner
# run does not run the hook tests again. Nothing else should set it, and under CI=true it is a FAIL:
# the runner must never go green with the hook tests skipped.
for t in tests/hooks/test-*.sh; do
  if [ -n "${AGENTILLE_VALIDATE_SKIP_HOOK_TESTS:-}" ]; then
    m="hook tests skipped (AGENTILLE_VALIDATE_SKIP_HOOK_TESTS set: inner run of test-validate-gate.sh)"
    if [ "${CI:-}" = "true" ]; then fail "$m: CI=true, unset it on the runner"; else warn "$m"; fi
    break
  fi
  [ -e "$t" ] || { warn "no tests/hooks/test-*.sh found"; break; }
  tout=$(bash "$t" 2>&1); trc=$?
  if [ "$trc" = 0 ]; then pass "$t: $(printf '%s\n' "$tout" | tail -1)"; else fail "$t failed:"; printf '%s\n' "$tout" | tail -12 | sed 's/^/    /'; fi
done

# ── 7. PII / privacy scan (public repo — hard fail) ──────────────────────────
# Pattern-based only: this script is public, so it must NOT hardcode the
# private names it guards against. Categorical leaks (paths, emails) are
# caught here; human review covers names (see CLAUDE.md "Privacy & OSS hygiene").
hdr "Privacy scan (tracked files)"
# git grep: the same on GNU and BSD userlands (an earlier xargs -d form failed silently on macOS and
# reported PASS over a planted leak). A grep error is a FAIL, never a silent pass.
leakhit=0
scan() { # $1 = regex, $2 = label
  local hits rc
  hits=$(git grep -nE -- "$1" -- . ':!scripts/validate.sh' ':!.github/' ':!tests/' 2>&1); rc=$?
  if [ "$rc" = 0 ]; then fail "possible $2 leak:"; printf '%s\n' "$hits" | sed 's/^/    /'; leakhit=1
  elif [ "$rc" != 1 ]; then fail "privacy scan could not run ($2): $hits"; leakhit=1; fi
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
