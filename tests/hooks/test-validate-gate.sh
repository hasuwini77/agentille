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

# fake claude: `plugin validate` exits $FAKE_VALIDATE_RC, `plugin test` exits $FAKE_TEST_RC
cat > "$T/bin/claude" <<'C'
#!/usr/bin/env bash
if [ "$1" = plugin ] && [ "$2" = validate ]; then echo "fake validate"; exit "${FAKE_VALIDATE_RC:-0}"; fi
if [ "$1" = plugin ] && [ "$2" = test ]; then echo " 1 pass"; exit "${FAKE_TEST_RC:-0}"; fi
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

[ "$bad" = 0 ] && echo "validate-gate: $n checks pass" || { echo "validate-gate: $bad of $n checks fail"; exit 1; }
