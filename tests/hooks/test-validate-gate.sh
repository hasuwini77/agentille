#!/usr/bin/env bash
# scripts/validate.sh is the gate the pre-push hook and CI run. This checks the gate itself: a
# non-zero exit from `claude plugin validate` or `claude plugin test` must FAIL the run, and a
# passing pair must PASS it. A fake `claude` on PATH stands in for the CLI; the inner run skips
# the hook tests (this file among them) through AGENTILLE_VALIDATE_SKIP_HOOK_TESTS so it does not
# recurse. That skip is a FAIL under CI=true, so every inner run clears CI unless a check sets it.
# Exit 0 = all checks pass.
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
if [ "$1" = plugin ] && [ "$2" = test ]; then printf "%b\n" "${FAKE_TEST_OUT:- 674 pass\n 0 fail}"; exit "${FAKE_TEST_RC:-0}"; fi
exit 0
C
chmod +x "$T/bin/claude"
run() { ( export PATH="$T/bin:$PATH" AGENTILLE_VALIDATE_SKIP_HOOK_TESTS=1 CI=; for kv in "$@"; do export "$kv"; done; bash scripts/validate.sh 2>&1 ); }

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
out=$(run "FAKE_TEST_OUT= 599 pass\n 0 fail"); rc=$?
check "599 pass: run fails" '[ "$rc" != 0 ]'
check "599 pass: says the floor is 600" 'printf "%s" "$out" | grep -q "only 599 pass (expected at least 600)"'
out=$(run "FAKE_TEST_OUT= 600 pass\n 0 fail"); rc=$?
check "600 pass: exit 0" '[ "$rc" = 0 ]'
check "600 pass: reports the count" 'printf "%s" "$out" | grep -q "claude plugin test: 600 pass"'
out=$(run "FAKE_TEST_OUT= 674 pass\n 0 fail"); rc=$?
check "674 pass 0 fail: exit 0" '[ "$rc" = 0 ]'
check "674 pass 0 fail: reports the count" 'printf "%s" "$out" | grep -q "claude plugin test: 674 pass"'
out=$(run "FAKE_TEST_OUT= 674 pass\n 1 fail"); rc=$?
check "674 pass 1 fail: run fails" '[ "$rc" != 0 ]'
check "674 pass 1 fail: says 1 fail" 'printf "%s" "$out" | grep -q "claude plugin test: 1 fail"'

# skipping the hook tests: a WARN on a developer machine, a FAIL under CI=true
out=$(run); rc=$?
check "hook tests skipped, dev machine: exit 0" '[ "$rc" = 0 ]'
check "hook tests skipped, dev machine: WARN not FAIL" 'printf "%s" "$out" | grep -q "WARN.*hook tests skipped" && ! printf "%s" "$out" | grep -q "FAIL.*hook tests skipped"'
out=$(run CI=true); rc=$?
check "hook tests skipped, CI=true: run fails" '[ "$rc" != 0 ]'
check "hook tests skipped, CI=true: FAIL names the variable and the fix" 'printf "%s" "$out" | grep -q "FAIL.*hook tests skipped (AGENTILLE_VALIDATE_SKIP_HOOK_TESTS set.*unset it on the runner"'
check "hook tests skipped, CI=true: the only FAIL" '[ "$(printf "%s\n" "$out" | grep -c "FAIL")" = 1 ]'

# a hook test that cannot run says `SKIP: <reason>` and exits 3: a WARN on a developer machine, a FAIL under
# CI=true. Exit 3 without the SKIP line is a failure, so a broken test cannot pass itself off as a skip.
mkdir -p "$T/hooks-skip" "$T/hooks-bad3" "$T/hooks-pass"
printf 'echo "SKIP: needs a tool this runner lacks"; exit 3\n' > "$T/hooks-skip/test-skip.sh"
printf 'echo "something broke"; exit 3\n' > "$T/hooks-bad3/test-bad3.sh"
printf 'echo "fixture: 1 check passes"\n' > "$T/hooks-pass/test-pass.sh"
out=$(run AGENTILLE_VALIDATE_SKIP_HOOK_TESTS= AGENTILLE_VALIDATE_HOOK_TESTS_DIR="$T/hooks-pass"); rc=$?
check "hook test passes: exit 0" '[ "$rc" = 0 ]'
check "hook test passes: PASS with its last line" 'printf "%s" "$out" | grep -q "PASS.*test-pass.sh: fixture: 1 check passes"'
out=$(run AGENTILLE_VALIDATE_SKIP_HOOK_TESTS= AGENTILLE_VALIDATE_HOOK_TESTS_DIR="$T/hooks-skip"); rc=$?
check "hook test skips, dev machine: exit 0" '[ "$rc" = 0 ]'
check "hook test skips, dev machine: WARN with the reason, not PASS" 'printf "%s" "$out" | grep -q "WARN.*test-skip.sh skipped: needs a tool this runner lacks" && ! printf "%s" "$out" | grep -q "PASS.*test-skip.sh"'
out=$(run CI=true AGENTILLE_VALIDATE_SKIP_HOOK_TESTS= AGENTILLE_VALIDATE_HOOK_TESTS_DIR="$T/hooks-skip"); rc=$?
check "hook test skips, CI=true: run fails" '[ "$rc" != 0 ]'
check "hook test skips, CI=true: FAIL names the test and the reason" 'printf "%s" "$out" | grep -q "FAIL.*test-skip.sh skipped: needs a tool this runner lacks (CI=true"'
check "hook test skips, CI=true: the only FAIL" '[ "$(printf "%s\n" "$out" | grep -c "FAIL")" = 1 ]'
out=$(run AGENTILLE_VALIDATE_SKIP_HOOK_TESTS= AGENTILLE_VALIDATE_HOOK_TESTS_DIR="$T/hooks-bad3"); rc=$?
check "exit 3 without a SKIP line: run fails" '[ "$rc" != 0 ]'
check "exit 3 without a SKIP line: FAIL with the exit code" 'printf "%s" "$out" | grep -q "FAIL.*test-bad3.sh failed (exit 3)"'

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

# the failed-fix count before Fable must agree across README.md, routing.md and routing.js
out=$(run); rc=$?
check "failed-fix count: the real README agrees" 'printf "%s" "$out" | grep -q "PASS.*fable-fixes: README.md, routing.md and routing.js agree"'
sed 's/two failed fixes/three failed fixes/g' README.md > "$T/readme-fix3.md"
out=$(run AGENTILLE_VALIDATE_README="$T/readme-fix3.md"); rc=$?
check "README says three failed fixes: run fails" '[ "$rc" != 0 ]'
check "README says three failed fixes: names both counts" 'printf "%s" "$out" | grep -q "FAIL.*fable-fixes: .*says 3 failed fixes, hooks/routing.js moves the diagnose planner to Fable at 2"'
sed 's/two failed fixes/2 failed fixes/g' README.md > "$T/readme-fix2.md"
out=$(run AGENTILLE_VALIDATE_README="$T/readme-fix2.md"); rc=$?
check "README says 2 failed fixes (digit): agrees" 'printf "%s" "$out" | grep -q "PASS.*fable-fixes: README.md, routing.md and routing.js agree: Fable after 2"'
awk '!d && /two failed fixes/{sub(/two failed fixes/, "three failed fixes"); d=1} {print}' README.md > "$T/readme-fixmix.md"
out=$(run AGENTILLE_VALIDATE_README="$T/readme-fixmix.md"); rc=$?
check "README names two different counts: run fails" '[ "$rc" != 0 ]'
check "README names two different counts: says so" 'printf "%s" "$out" | grep -q "FAIL.*fable-fixes: .*names different counts"'

[ "$bad" = 0 ] && echo "validate-gate: $n checks pass" || { echo "validate-gate: $bad of $n checks fail"; exit 1; }
