#!/usr/bin/env bash
# scripts/validate.sh is the gate the pre-push hook and CI run. This checks the gate itself: a
# non-zero exit from `claude plugin validate` or `claude plugin test` must FAIL the run, and a
# passing pair must PASS it. A fake `claude` on PATH stands in for the CLI; the inner run skips
# the hook tests (this file among them) through AGENTILLE_VALIDATE_SKIP_HOOK_TESTS so it does not
# recurse. Exit 0 = all checks pass.
set -u
cd "$(dirname "$0")/../.." || exit 2
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
mkdir -p "$T/bin"
n=0; bad=0
check() { n=$((n+1)); if eval "$2"; then :; else echo "FAIL $1"; bad=$((bad+1)); fi; }

# fake claude: `plugin validate` exits $FAKE_VALIDATE_RC, `plugin test` exits $FAKE_TEST_RC and prints $FAKE_TEST_OUT
cat > "$T/bin/claude" <<'C'
#!/usr/bin/env bash
if [ "$1" = plugin ] && [ "$2" = validate ]; then echo "fake validate"; exit "${FAKE_VALIDATE_RC:-0}"; fi
if [ "$1" = plugin ] && [ "$2" = test ]; then printf "%b\n" "${FAKE_TEST_OUT:- 527 pass\n 0 fail}"; exit "${FAKE_TEST_RC:-0}"; fi
exit 0
C
chmod +x "$T/bin/claude"
run() { ( export PATH="$T/bin:$PATH" AGENTILLE_VALIDATE_SKIP_HOOK_TESTS=1; for kv in "$@"; do export "$kv"; done; bash scripts/validate.sh 2>&1 ); }

out=$(run FAKE_VALIDATE_RC=0 FAKE_TEST_RC=0); rc=$?
check "both pass: exit 0" '[ "$rc" = 0 ]'
check "both pass: says validate passes" 'printf "%s" "$out" | grep -q "claude plugin validate passes"'

out=$(run FAKE_VALIDATE_RC=3 FAKE_TEST_RC=0); rc=$?
check "validate exits 3: run fails" '[ "$rc" != 0 ]'
check "validate exits 3: names the exit code" 'printf "%s" "$out" | grep -q "claude plugin validate failed (exit 3)"'

out=$(run FAKE_VALIDATE_RC=0 FAKE_TEST_RC=1); rc=$?
check "mod tests exit 1: run fails" '[ "$rc" != 0 ]'
check "mod tests exit 1: says so" 'printf "%s" "$out" | grep -q "claude plugin test failed"'

# the mod test count is parsed, not trusted: no count, a count under the floor, or a failure fails
out=$(run FAKE_TEST_OUT=" all good"); rc=$?
check "test output without a count: run fails" '[ "$rc" != 0 ]'
check "test output without a count: says so" 'printf "%s" "$out" | grep -q "printed no .N pass. count"'
out=$(run FAKE_TEST_OUT=" 12 pass"); rc=$?
check "12 pass: run fails" '[ "$rc" != 0 ]'
check "12 pass: names the floor" 'printf "%s" "$out" | grep -q "only 12 pass"'
out=$(run "FAKE_TEST_OUT= 527 pass\n 0 fail"); rc=$?
check "527 pass 0 fail: exit 0" '[ "$rc" = 0 ]'
check "527 pass 0 fail: reports the count" 'printf "%s" "$out" | grep -q "claude plugin test: 527 pass"'
out=$(run "FAKE_TEST_OUT= 527 pass\n 1 fail"); rc=$?
check "527 pass 1 fail: run fails" '[ "$rc" != 0 ]'
check "527 pass 1 fail: says 1 fail" 'printf "%s" "$out" | grep -q "claude plugin test: 1 fail"'

# a failing mod import is a FAIL (the entry point is overridable for this test only)
printf 'throw new Error("boom");\n' > "$T/bad-entry.mjs"
out=$(run AGENTILLE_VALIDATE_MOD_ENTRY="$T/bad-entry.mjs"); rc=$?
check "mod import throws: run fails" '[ "$rc" != 0 ]'
check "mod import throws: says so" 'printf "%s" "$out" | grep -q "hooks/register.js failed to import"'

# missing python3 / node: WARN on a developer machine, FAIL under CI=true. A PATH of symlinks to
# just the tools validate.sh needs, minus python3 and node, stands in for a bare runner.
mkdir -p "$T/bare"
for tool in bash env jq grep sed awk git cat dirname sort tail head tr mktemp rm printf wc cut basename uniq xargs find ls mkdir date; do
  p=$(command -v "$tool" 2>/dev/null) && [ -x "$p" ] && ln -sf "$p" "$T/bare/$tool"
done
cp "$T/bin/claude" "$T/bare/claude"
runbare() { ( export PATH="$T/bare" AGENTILLE_VALIDATE_SKIP_HOOK_TESTS=1; for kv in "$@"; do export "$kv"; done; "$T/bare/bash" scripts/validate.sh 2>&1 ); }
out=$(runbare CI=); rc=$?
check "no python3/node, dev machine: WARN not FAIL" 'printf "%s" "$out" | grep -q "WARN.*python3 not found" && ! printf "%s" "$out" | grep -q "FAIL.*python3 not found"'
out=$(runbare CI=true); rc=$?
check "no python3/node, CI=true: run fails" '[ "$rc" != 0 ]'
check "no python3, CI=true: FAIL names python3" 'printf "%s" "$out" | grep -q "FAIL.*python3 not found"'
check "no node, CI=true: FAIL names node" 'printf "%s" "$out" | grep -q "FAIL.*node not found"'

# the README routing table must mirror routing.md (the README path is overridable for this test only)
awk '/^## Default routing/{f=1;next} f&&/^\|/{print;n=1;next} f&&n{exit}' skills/agt/routing.md > "$T/table.md"
check "routing table extracted for the README test" '[ "$(wc -l < "$T/table.md")" -ge 13 ]'
printf '# R\n\n## Other\n\ntext\n' > "$T/readme-none.md"
out=$(run AGENTILLE_VALIDATE_README="$T/readme-none.md"); rc=$?
check "README without ## Routing: run fails" '[ "$rc" != 0 ]'
check "README without ## Routing: says so" 'printf "%s" "$out" | grep -q "no \"## Routing\" heading"'
{ printf '# R\n\n## Routing\n\nintro\n\n'; cat "$T/table.md"; printf '\n## Next\n'; } > "$T/readme-ok.md"
out=$(run AGENTILLE_VALIDATE_README="$T/readme-ok.md"); rc=$?
check "README with the same table: matches" 'printf "%s" "$out" | grep -q "readme-routing: README routing table matches"'
sed 's/| executor | sonnet · medium/| executor | sonnet · low/' "$T/readme-ok.md" > "$T/readme-bad.md"
out=$(run AGENTILLE_VALIDATE_README="$T/readme-bad.md"); rc=$?
check "README with a drifted row: run fails" '[ "$rc" != 0 ]'
check "README with a drifted row: shows the diff" 'printf "%s" "$out" | grep -q "sonnet · low"'

[ "$bad" = 0 ] && echo "validate-gate: $n checks pass" || { echo "validate-gate: $bad of $n checks fail"; exit 1; }
