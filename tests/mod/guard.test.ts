import { describe, expect, mock, test } from 'claude-code/testing'
import { DENY_INTEGRATION, DENY_LOCAL, DENY_PUBLISH, DENY_PUSH, DENY_UNREAD, capsOf, claimedTrees, integrationIn, integrationOf, joinPath, judgePush, newTrees, normSlug, normUrl, parseOwned, recordTrees, sameRemote, scriptSlugs, scriptTrees, splitCommands, worktreeAdds } from '../../hooks/guard.js'
import { parseWorktrees } from '../../hooks/clean.js'
import { DEFAULT_PROFILE, guardLine as judge, loadRunProfile } from '../../hooks/guard.js'
import { setRunProfile } from '../../hooks/proofs.js'
import { Profile } from '../../hooks/profile.js'
import { seed } from '../../hooks/store.js'
import { commandSteps } from '../../hooks/guard-lex.js'
import { ghAliases } from '../../hooks/guard-policy.js'

// What the repo looks like to a line read alone: the slice branch is checked out, the base is main.
const onSlice = { current: 'agt/x', cwd: '/w/app' }

describe('guard: which commands integrate', () => {
  test('merge, tag, release and API merges are caught, wherever they sit and whatever wraps them', async () => {
    for (const line of [
      'gh pr merge 12 --merge --delete-branch',
      'npm test && gh pr merge 12',
      'git tag v1.2.0',
      'git tag rc1',
      'git tag -d v1.0.0',
      'git -C ../app tag -a v1.2.0 -m release',
      'cd ../app; git tag v1.0.0 && git push origin v1.0.0',
      "bash -c 'gh pr merge 4'",
      'eval gh pr merge 4',
      'bash <<EOF\ngh pr merge 4\nEOF',
      'GH_TOKEN=x gh pr merge 4',
      '/usr/bin/env gh pr merge 4',
      'env GH_TOKEN=x gh pr merge 4',
      'timeout 60 gh pr merge 4',
      'timeout -s KILL 60 gh pr merge 4',
      'echo 4 | xargs gh pr merge',
      'xargs -n1 gh pr merge < prs.txt',
      'command gh pr merge 4',
      'nice gh pr merge 4',
      'nice -n 5 gh pr merge 4',
      'sudo -u bob gh pr merge 4',
      'time gh pr merge 4',
      '/opt/homebrew/bin/gh pr merge 4',
      'echo "$(gh pr merge 4)"',
      'x=`gh pr merge 4`',
      'gh release create v1.0.0',
      'gh release upload v1.0.0 app.zip',
      'gh api -X PUT repos/o/r/pulls/12/merge',
      'gh api repos/o/r/pulls/12/merge -XPUT',
      'gh api --method=PUT repos/o/r/pulls/12/merge',
      'gh api repos/o/r/pulls/12/merge -f merge_method=merge',
      'gh api repos/{owner}/{repo}/merges -f base=main -f head=agt/x',
      'gh api -X POST repos/o/r/releases -f tag_name=v1',
      'gh api -X PATCH repos/o/r/git/refs/heads/main -f sha=abc',
      'gh api graphql -f query="mutation { mergePullRequest(input: {}) { clientMutationId } }"',
      'curl -X PUT -H "Authorization: token t" https://api.github.com/repos/o/r/pulls/12/merge',
      'curl -sS -d \'{"tag_name":"v1"}\' https://api.github.com/repos/o/r/releases',
      'wget --method=PUT https://api.github.com/repos/o/r/pulls/12/merge',
      'wget --post-data=x https://api.github.com/repos/o/r/releases',
    ]) expect([line, integrationIn(line, onSlice)]).toEqual([line, expect.any(String)])
  })

  test('branch protection, rulesets, the default branch and workflow runs are steps; reads are not', async () => {
    for (const line of [
      'gh api -X DELETE repos/o/r/branches/main/protection',
      'gh api -X PUT repos/o/r/branches/main/protection --input p.json',
      'gh api repos/o/r/branches/main/protection/required_status_checks -X PATCH -f strict=false',
      'gh api -X DELETE repos/o/r/branches/release/1.x/protection',
      'gh api -X POST repos/o/r/rulesets --input r.json',
      'gh api -X DELETE repos/o/r/rulesets/7',
      'gh api -X PATCH repos/o/r -f default_branch=agt/x',
      'gh api --method PATCH repos/o/r --input repo.json',
      'gh api repos/o/r/actions/workflows/release.yml/dispatches -f ref=main',
      'gh api -X PUT repos/o/r/actions/workflows/ci.yml/disable',
      'gh workflow run release.yml',
      'gh workflow enable ci.yml',
      'gh workflow disable ci.yml -R o/r',
      'gh repo edit --default-branch agt/x',
      'gh repo edit o/r --default-branch=agt/x',
      'curl -X DELETE -H "Authorization: token t" https://api.github.com/repos/o/r/branches/main/protection',
      'curl -X PATCH -d \'{"default_branch":"agt/x"}\' https://api.github.com/repos/o/r',
      'curl -X PATCH --data-binary @repo.json https://api.github.com/repos/o/r',
    ]) expect([line, integrationIn(line, onSlice)]).toEqual([line, expect.any(String)])
    for (const line of [
      'gh api repos/o/r/branches/main/protection',
      'gh api repos/o/r',
      'gh api -X PATCH repos/o/r -f description=docs',
      'gh workflow list',
      'gh workflow view ci.yml',
      'gh run list',
      'gh repo edit --description docs',
      'curl https://api.github.com/repos/o/r/branches/main/protection',
    ]) expect([line, integrationIn(line, onSlice)]).toEqual([line, null])
  })

  test('pushes of the base branch, tags, every branch, a force or a variable are caught', async () => {
    for (const line of [
      'git push origin HEAD:main',
      'git push origin feat/x:main',
      'git push origin agt/x:refs/heads/main',
      'git push origin main',
      'git push origin master',
      'git push -f origin agt/x',
      'git push --force origin agt/x',
      'git push --force-with-lease origin feat/x',
      'git push --force-with-lease=main origin agt/x',
      'git push --force-with-lease origin agt/x:main',
      'git push --force-with-lease origin +agt/x',
      'git push -uf origin agt/x',
      'git push origin +agt/x',
      'git merge --no-ff agt/x && git push origin main',
      'git push origin agt/x 2>&1 && git push origin main',
      'git push --tags',
      'git push origin --follow-tags',
      'git push --all origin',
      'git push --mirror',
      'git push origin v3.21.0',
      'git push origin rc1',
      'git push origin refs/tags/rc1',
      'git push origin :main',
      'git push origin --delete main',
      'git push origin "$BRANCH"',
      'B=main; git push origin "$B"',
      "bash -c 'git push origin main'",
      'if true; then git push origin main; fi',
      '(cd ../app && git push origin main)',
      'git -C ../app push origin HEAD:main',
      'git push origin release/1.0',
      'git push origin --delete agt/x',
      'git push origin :feat/other',
      'git push -d origin fix/y',
    ]) expect([line, integrationIn(line, onSlice)]).toEqual([line, expect.any(String)])
  })

  test('a bare push or HEAD is the branch checked out: refused on the base, or when it cannot be read', async () => {
    expect(integrationIn('git push', { current: 'main' })).toBe('git push to main')
    expect(integrationIn('git push origin HEAD', { current: 'main' })).toBe('git push to main')
    expect(integrationIn('git push -u origin HEAD', { current: 'develop', base: 'develop' })).toBe('git push to develop')
    expect(integrationIn('git push origin HEAD', {})).toContain('cannot be read')
    expect(integrationIn('git push', { current: 'agt/x', pushDst: 'main' })).toBe('git push to main')
    expect(integrationIn('git push', { current: 'agt/x' })).toBeNull()
    expect(integrationIn('git push origin HEAD', { current: 'storm/2026-10-24-x' })).toBeNull()
  })

  test('a branch switch earlier on the line makes HEAD unreadable for a later push; a written-out name still goes', async () => {
    for (const line of [
      'git checkout -q main; git push',
      'git reset --hard main && git push origin HEAD',
      'git symbolic-ref HEAD refs/heads/main && git push origin HEAD',
      'git -C ../app checkout main && cd ../app && git push origin "$(git branch --show-current)"',
      'gh pr checkout 12 && git push origin HEAD',
      'git rebase main agt/y && git push origin HEAD',
    ]) expect([line, integrationIn(line, onSlice)]).toEqual([line, expect.stringContaining('switches branches')])
    for (const line of [
      'git checkout -b agt/y && git push -u origin agt/y',
      'git checkout -- README.md && git push origin HEAD',
      'git push origin HEAD && git checkout main',
      'git rebase main && git push origin HEAD',
    ]) expect([line, integrationIn(line, onSlice)]).toEqual([line, null])
  })

  test('a local merge, reset --hard, rebase or branch -f/-M onto the base branch is caught below auto', async () => {
    for (const line of [
      'git checkout main && git merge --ff-only agt/x && git push origin HEAD',
      'git switch main && git merge --ff-only agt/x && git push -u origin HEAD',
      'git checkout main && git reset --hard agt/x',
      'git checkout main && git rebase agt/x',
      'git branch -m main',
      'git branch -M agt/x main',
      'git branch -f master agt/x',
      'git rebase upstream master',
    ]) expect([line, integrationIn(line, onSlice)]).toEqual([line, expect.stringContaining('base branch')])
    // Merging or rewriting the slice branch itself is fine; so is a merge with no branch switch on agt/x.
    for (const line of [
      'git merge --no-ff agt/feature',
      'git rebase main',
      'git checkout -b agt/y && git merge agt/x',
      'git branch -f agt/y main',
    ]) expect([line, integrationIn(line, onSlice)]).toEqual([line, null])
  })

  test('the slice\'s own pushes, PRs, tag listing, API reads and quoted text are left alone', async () => {
    for (const line of [
      'git push -u origin agt/filter',
      'git push origin feat/v1-ui',
      'git push origin fix/login',
      'git push -u origin HEAD',
      'git push',
      'git push -u origin "$(git branch --show-current)"',
      'SLUG=filter; git push -u origin "agt/$SLUG"',
      'git push -n origin main',
      'git push -u origin agt/x 2>&1 | tail -3',
      'git push origin agt/x > /dev/null 2>&1',
      'gh pr create --base main --title x --body "then gh pr merge it"',
      'gh pr view 12 --json state -q .state',
      'gh api repos/o/r/pulls/12',
      'gh api repos/o/r/pulls/12/merge',
      'gh api repos/o/r/releases/latest',
      'curl -s https://api.github.com/repos/o/r/releases',
      'git commit -m "do not git push --tags here"',
      'git tag',
      'git tag -l "v*"',
      'git tag --list --sort=-v:refname',
      'git tag --contains HEAD',
      'git log --oneline v1.2.0..HEAD',
      'echo gh pr merge',
      'command -v gh',
      'cat <<EOF > notes.md\ngit push origin main\ngh pr merge 3\nEOF',
    ]) expect([line, integrationIn(line, onSlice)]).toEqual([line, null])
  })

  test('a PR or commit body in a heredoc is text, even with a ) and commands in it', async () => {
    const pr = `gh pr create --title t --body "$(cat <<'EOF'\nCloses #12 (see the note)\n\ngit push origin main\ngh pr merge 3\n)\nEOF\n)" && git push -u origin agt/x`
    const commit = `git commit -m "$(cat <<'EOF'\nfix: a thing (scope)\n\nthen git push --tags and gh pr merge 3\nEOF\n)"`
    expect(integrationIn(pr, onSlice)).toBeNull()
    expect(integrationIn(commit, onSlice)).toBeNull()
    expect(integrationIn(pr + ' && git push origin main', onSlice)).toBe('git push to main')
  })

  test('auto lets every step through; local refuses pushes and PRs too', async () => {
    expect(integrationIn('gh pr merge 3 && git tag v1.0.0 && git push origin main v1.0.0', { mode: 'auto' })).toBeNull()
    expect(integrationIn('git push -u origin agt/x', { ...onSlice, mode: 'local' })).toBe('git push')
    expect(integrationIn('gh pr create --title x', { mode: 'local' })).toBe('gh pr create')
    expect(integrationIn('gh pr create --title x', { mode: 'push' })).toBeNull()
  })

  test('aliases, plumbing, file-fed GraphQL, curl flag clusters and hub are caught', async () => {
    for (const line of [
      'git -c alias.p=push p origin agt/x:main',
      'git -c alias.t=tag t v9',
      'git --config-env=alias.p=P p origin agt/x:main',
      'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=alias.p GIT_CONFIG_VALUE_0=push git p origin agt/x:main',
      'git config alias.sh push && git sh origin HEAD:main',
      'git config --global alias.p push',
      'git config set alias.p push',
      'git send-pack ../origin.git agt/x:main',
      'git subtree push --prefix=x origin agt/x',
      'git update-ref refs/tags/v1 HEAD',
      'git update-ref -d refs/tags/v1',
      'git update-ref refs/heads/main agt/x',
      'git update-ref --stdin < refs.txt',
      'git symbolic-ref refs/heads/main refs/heads/agt/x',
      'gh alias set mm "pr merge" && gh mm 12',
      'gh alias import aliases.yml',
      'gh api graphql -F query=@m.graphql',
      'gh api graphql -f query=@m.graphql',
      'gh api graphql --input body.json',
      "gh api graphql -f query='mutation { deleteRef(input: {refId: \"x\"}) { clientMutationId } }'",
      "gh api graphql -f query='mutation($id: ID!) { mergePullRequest(input: {pullRequestId: $id}) { clientMutationId } }' -F id=1",
      'curl -sXPUT https://api.github.com/repos/o/r/pulls/1/merge',
      'curl -sfX PUT https://api.github.com/repos/o/r/pulls/1/merge',
      'curl -sSd @body.json https://api.github.com/graphql',
      'curl -sd \'{"tag_name":"v1"}\' https://api.github.com/repos/o/r/releases',
      'hub release create v1',
      'hub api -X PUT repos/o/r/pulls/1/merge',
      'hub push origin main',
    ]) expect([line, integrationIn(line, onSlice)]).toEqual([line, expect.any(String)])
    for (const line of [
      'git config --get alias.p',
      'git -c core.pager=cat log --oneline',
      'gh alias list',
      "gh api graphql -f query='{ repository(owner: \"o\", name: \"r\") { pullRequest(number: 1) { mergeable } } }'",
      'curl -sS https://api.github.com/repos/o/r/pulls/1',
      'curl -sI https://api.github.com/repos/o/r/pulls/1/merge',
      'git update-ref refs/heads/agt/y HEAD',
      'git symbolic-ref --short HEAD',
      'hub pull-request -m "agt: filter"',
    ]) expect([line, integrationIn(line, onSlice)]).toEqual([line, null])
  })

  test('interpreter code, more shells and more wrappers are seen through', async () => {
    for (const line of [
      'python3 -c "import subprocess;subprocess.run([\'git\',\'push\',\'origin\',\'main\'])"',
      'node -e "require(\'child_process\').execSync(\'gh pr merge 12\')"',
      "perl -e 'system(\"git push origin main\")'",
      "ruby -e 'system(\"git tag v1\")'",
      "osascript -e 'do shell script \"gh pr merge 3\"'",
      'fish -c "git push origin main"',
      'zsh -fc "git push origin main"',
      'bash --norc -c "git push origin main"',
      'script -q /dev/null git push origin main',
      "script -qc 'git push origin main' /dev/null",
      'watch -n1 git push origin main',
      'flock /tmp/l git push origin main',
      'flock /tmp/l -c "git push origin main"',
      'caffeinate -i git push origin main',
      'stdbuf -oL git push origin main',
      'arch -arm64 git push origin main',
      'find . -maxdepth 0 -exec git push origin main \\;',
      'parallel git push origin ::: main',
      'parallel ::: "git push origin main"',
      'coproc git push origin main',
      'coproc P { git push origin main; }',
      'ssh host git push origin main',
      "ssh -p 22 host 'cd app && git push origin main'",
      'xcrun git push origin main',
      'env -iC /w git push origin main',
      'sudo -nu bob gh pr merge 4',
    ]) expect([line, integrationIn(line, onSlice)]).toEqual([line, expect.any(String)])
    for (const line of [
      'python3 -c "print(1)"',
      'node -e "console.log(require(\'./package.json\').version)"',
      'watch -n5 git status',
      'find . -name "*.ts" -exec grep -l TODO {} +',
      'ssh host uptime',
      'parallel echo ::: a b',
      'caffeinate -i npm test',
    ]) expect([line, integrationIn(line, onSlice)]).toEqual([line, null])
  })

  test('judgePush on its own: a dry run passes, refs outside heads do not', async () => {
    const p = { remote: 'origin', specs: ['HEAD:refs/for/main'], force: false, del: false, bulk: null, dry: false, mergeOpt: false }
    expect(judgePush(p, { current: 'agt/x' })).toContain('refs/for/main')
    expect(judgePush({ ...p, dry: true }, { current: 'agt/x' })).toBeNull()
  })
})

describe('guard: the repo a profile entry names', () => {
  test('remotes compare without scheme, user, port or .git', async () => {
    expect(normUrl('git@github.com:Me/App.git')).toBe('github.com/me/app')
    expect(normUrl('https://github.com/me/app.git/')).toBe('github.com/me/app')
    expect(normUrl('ssh://git@github.com:22/me/app')).toBe('github.com/me/app')
    expect(normSlug('me/app')).toBe('github.com/me/app')
    expect(sameRemote('github.com/me/app', 'me/app')).toBe(true)
    expect(sameRemote('github.com/me/app', 'github.com/other/app')).toBe(false)
  })

  test('the profile decides; a repo config lowers it and never raises it', async () => {
    expect(integrationOf(null, ['app'])).toBe('pr')
    expect(integrationOf({ integration: 'auto' }, ['app'])).toBe('auto')
    expect(integrationOf({ integration: 'auto', projects: [{ id: 'app', integration: 'pr' }] }, ['app'])).toBe('pr')
    expect(integrationOf({ projects: [{ name: 'My App', integration: 'auto' }] }, ['my-app'])).toBe('pr')
    expect(integrationOf({ projects: [{ id: 'my-app', integration: 'auto' }] }, ['My App'])).toBe('pr')
    expect(integrationOf({ integration: 'auto' }, ['app'], ['push'])).toBe('push')
    expect(integrationOf({ integration: 'pr' }, ['app'], ['auto'])).toBe('pr')
    expect(integrationOf({ integration: 'yes' }, ['app'])).toBe('pr')
  })

  test('projects[] match by remote or path; a bare name only for a repo with no remote', async () => {
    const repo = { url: 'git@github.com:me/app.git', paths: ['/w/app', '/w/app-x'], name: 'app' }
    expect(integrationOf({ projects: [{ url: 'https://github.com/me/app', integration: 'auto' }] }, repo)).toBe('auto')
    expect(integrationOf({ projects: [{ url: 'https://github.com/someone/app', integration: 'auto' }] }, repo)).toBe('pr')
    expect(integrationOf({ projects: [{ path: '/w/app/', integration: 'auto' }] }, repo)).toBe('auto')
    expect(integrationOf({ projects: [{ path: '~/app', integration: 'auto' }] }, { ...repo, paths: ['/h/app'], home: '/h' })).toBe('auto')
    // Same folder name, someone else's clone: the name alone does not carry auto over.
    expect(integrationOf({ projects: [{ id: 'app', integration: 'auto' }] }, repo)).toBe('pr')
    expect(integrationOf({ projects: [{ id: 'app', integration: 'auto' }] }, { ...repo, url: null })).toBe('auto')
    expect(integrationOf({ projects: [{ id: 'app', url: 'github.com/me/other', integration: 'auto' }] }, { ...repo, url: null })).toBe('pr')
    // ...yet a name-only entry still lowers: auto at the top, pr for this repo by name, stays pr.
    expect(integrationOf({ integration: 'auto', projects: [{ id: 'app', integration: 'pr' }] }, repo)).toBe('pr')
    expect(integrationOf({ integration: 'auto', projects: [{ name: 'app', integration: 'local' }] }, repo)).toBe('local')
    expect(integrationOf({ integration: 'auto', projects: [{ id: 'other', integration: 'pr' }] }, repo)).toBe('auto')
    expect(integrationOf({ integration: 'auto', projects: [{ id: 'app', integration: 'pr' }, { url: 'github.com/me/app', integration: 'auto' }] }, repo)).toBe('auto')
    // A repo with no checkout here (gh -R, GH_REPO, a push URL) has only its URL: a name entry grants it nothing.
    expect(integrationOf({ projects: [{ name: 'api', integration: 'auto' }] }, { url: 'github.com/stranger/api', paths: [], name: 'api' })).toBe('pr')
    expect(integrationOf({ projects: [{ name: 'api', integration: 'auto' }] }, { url: null, paths: [], name: 'api' })).toBe('pr')
  })

  test('CLAUDE.md and AGENTS.md caps: local-only, no-mistakes, as words', async () => {
    expect(capsOf('Repo rules: `local-only`, no remote.')).toEqual(['local'])
    expect(capsOf('no-mistakes mode')).toEqual(['pr'])
    expect(capsOf('a non-local-only-ish note')).toEqual([])
    expect(integrationOf({ integration: 'auto' }, ['app'], capsOf('no-mistakes'))).toBe('pr')
    expect(integrationOf({ integration: 'push' }, ['app'], capsOf('no-mistakes'))).toBe('push')
    expect(integrationOf({ integration: 'auto' }, ['app'], capsOf('local-only'))).toBe('local')
  })
})

describe('guard: worktree adds', () => {
  test('both orderings, -C and cd are resolved; shell variables are not guessed', async () => {
    expect(worktreeAdds('git worktree add ../app-x -b agt/x main', '/w/app')).toEqual([{ path: '/w/app-x', branch: 'agt/x', base: 'main' }])
    expect(worktreeAdds('cd /w/app && git worktree add -b agt/y ../app-y feat/z', '/elsewhere')).toEqual([{ path: '/w/app-y', branch: 'agt/y', base: 'feat/z' }])
    expect(worktreeAdds('git -C /w/app worktree add ../app-z -B agt/z', '/tmp')).toEqual([{ path: '/w/app-z', branch: 'agt/z', base: null }])
    expect(worktreeAdds('git worktree add "../$PROJECT-$SLUG" -b "$BRANCH" "$BASE"', '/w/app')).toEqual([{ path: null, branch: null, base: '$BASE' }])
    expect(joinPath('/w/app', '../b/./c')).toBe('/w/b/c')
  })

  test('a new tree counts only when the command names it', async () => {
    const before = parseWorktrees('worktree /w/app\nHEAD a\nbranch refs/heads/main\n')
    const after = parseWorktrees('worktree /w/app\nHEAD a\nbranch refs/heads/main\n\nworktree /w/app-filter\nHEAD a\nbranch refs/heads/agt/filter\n\nworktree /w/app-other\nHEAD a\nbranch refs/heads/agt/other\n')
    const line = 'SLUG="filter"; BRANCH="agt/$SLUG"; git worktree add "../app-$SLUG" -b "$BRANCH" main'
    expect(newTrees(before, after, line).map((t) => t.path)).toEqual(['/w/app-filter'])
  })

  test('a name inside another word claims nothing: the person\'s feat/ui tree is not the run\'s', async () => {
    const before = parseWorktrees('worktree /w/app\nHEAD a\nbranch refs/heads/main\n')
    const after = parseWorktrees('worktree /w/app\nHEAD a\nbranch refs/heads/main\n\nworktree /w/app-x\nHEAD a\nbranch refs/heads/agt/x\n\nworktree /w/ui\nHEAD a\nbranch refs/heads/feat/ui\n')
    expect(newTrees(before, after, 'npm run build && git worktree add ../app-x -b agt/x main').map((t) => t.path)).toEqual(['/w/app-x'])
    expect(newTrees(before, after, 'git worktree add ../ui -b feat/ui').map((t) => t.path)).toEqual(['/w/ui'])
    expect(newTrees(before, after, 'git worktree add /w/ui feat/ui').map((t) => t.path)).toEqual(['/w/ui'])
    expect(newTrees(before, after, 'git worktree add ../app-x2 -b agt/x2 && echo built-ui').map((t) => t.path)).toEqual([])
  })

  test('the script\'s two lines are read from a Bash result or plain text, a path only with the branch after it', async () => {
    expect(scriptTrees({ stdout: 'Preparing worktree\npath=/w/app-ui\nbranch=feat/ui\n', stderr: '' })).toEqual([{ path: '/w/app-ui', branch: 'feat/ui' }])
    expect(scriptTrees('path=/w/app-a\r\nbranch=agt/a\r\npath=/w/app-b\nbranch=agt/b\n').map((t: any) => t.path)).toEqual(['/w/app-a', '/w/app-b'])
    expect(scriptTrees('path=/w/app-a\nnoise\nbranch=agt/a\n')).toEqual([])
    expect(scriptTrees('path=rel\nbranch=agt/a\n')).toEqual([])
    expect(scriptTrees(undefined)).toEqual([])
    expect([...scriptSlugs('cd /w/app && bash /opt/plugin/scripts/agt-worktree.sh --base main ui --branch feat/ui')]).toEqual(['ui'])
    expect([...scriptSlugs("bash -c 'bash /opt/plugin/scripts/agt-worktree.sh api'")]).toEqual(['api'])
    expect([...scriptSlugs('git worktree add ../app-x -b agt/x')]).toEqual([])
  })

  test('a printed tree counts only where git lists it, on that branch, under the name the script gives it', async () => {
    const after = parseWorktrees('worktree /w/app\nHEAD a\nbranch refs/heads/main\n\nworktree /w/app-ui\nHEAD b\nbranch refs/heads/feat/ui\n\nworktree /w/other\nHEAD c\nbranch refs/heads/agt/other\n\nworktree /w/app-old\nHEAD c\nbranch refs/heads/agt/old\nprunable gone\n')
    const ui = new Set(['ui'])
    expect(claimedTrees([{ path: '/w/app-ui', branch: 'feat/ui' }], after, ui).map((t: any) => t.path)).toEqual(['/w/app-ui'])
    // the wrong branch, the main checkout, another session's tree, a path git does not list: nothing
    expect(claimedTrees([{ path: '/w/app-ui', branch: 'agt/ui' }], after, ui)).toEqual([])
    expect(claimedTrees([{ path: '/w/app', branch: 'main' }], after, new Set(['']))).toEqual([])
    expect(claimedTrees([{ path: '/w/other', branch: 'agt/other' }], after, ui)).toEqual([])
    expect(claimedTrees([{ path: '/w/app-x', branch: 'agt/x' }], after, new Set(['x']))).toEqual([])
    expect(claimedTrees([{ path: '/w/app-old', branch: 'agt/old' }], after, new Set(['old']))).toEqual([])
    // the slug the line passed must be the tree's
    expect(claimedTrees([{ path: '/w/app-ui', branch: 'feat/ui' }], after, new Set(['api']))).toEqual([])
  })

  test('a re-attached tree keeps the fork point it was first recorded with', async () => {
    const list = [{ path: '/w/app-x', branch: 'agt/x', head: 'm1', run: 'r1', at: 1, src: 'script' }]
    recordTrees(list, [{ path: '/w/app-x', branch: 'agt/x', head: null, run: 'r2', at: 2, src: 'script' }])
    expect(list).toEqual([{ path: '/w/app-x', branch: 'agt/x', head: 'm1', run: 'r2', at: 2, src: 'script' }])
    recordTrees(list, [{ path: '/w/app-y', branch: 'agt/y', head: 'm2', run: 'r2', at: 3, src: 'add' }])
    expect(list.map((r: any) => [r.path, r.head])).toEqual([['/w/app-x', 'm1'], ['/w/app-y', 'm2']])
  })

  test('splitting keeps quoted operators inside their word', async () => {
    expect(splitCommands('a "b && c" | d; e')).toEqual([['a', 'b && c'], ['d'], ['e']])
  })

  test('saved records older than the TTL or malformed are dropped', async () => {
    const now = 100 * 24 * 60 * 60_000
    const text = JSON.stringify([{ path: '/w/a', branch: 'agt/a', at: now - 1000 }, { path: '/w/b', branch: 'agt/b', at: 0 }, { path: 'rel', branch: 'agt/c', at: now }])
    expect(parseOwned(text, now).map((r: any) => r.path)).toEqual(['/w/a'])
    expect(parseOwned('not json', now)).toEqual([])
  })
})

// A run in a session with no pane transport: the ownership list lives in memory.
// git: per dir, the branch checked out (`current`), its remote URL and its main checkout (default /work/repo).
type Repo = { current?: string; remote?: string; common?: string; pushurl?: string; upstream?: string; tracking?: string }
const setup = (on: any, o: { profile?: unknown; repoConfig?: unknown; env?: Record<string, string>; files?: Record<string, string>; repos?: Record<string, Repo>; feat?: boolean; broken?: boolean; aliases?: Record<string, string>; aliasBroken?: boolean; pyFind?: Record<string, string>; hooksPath?: string; remoteHeads?: string[]; originHead?: string; followTags?: boolean; tags?: string[]; remoteTags?: string[]; localTags?: string[] } = {}) => {
  const seen: string[][] = []
  const ran: string[] = []
  const git = { made: false, committed: false, feat: false }
  const now = Date.now()
  const files: Record<string, string> = { ...(o.files ?? {}) }
  const repos: Record<string, Repo> = { '/work/repo': { current: 'main' }, '/work/repo-x': { current: 'agt/x' }, ...(o.repos ?? {}) }
  if (o.profile) files['/h/.agentille/profile.json'] = JSON.stringify(o.profile)
  if (o.repoConfig) files['/work/repo/.agentille/config.json'] = JSON.stringify(o.repoConfig)
  on('env.get', async ($: any, e: any) => ({ value: ({ HOME: '/h', ...(o.env ?? {}) } as any)[e.name] }))
  on('session.cwd', async () => ({ value: '/work/repo' }))
  on('session.start', async ($: any, e: any) => ({ cwd: e.cwd }))
  on('command.register', async () => ({ value: undefined }))
  on('tool.register', async ($: any, e: any) => ({ value: { tool: 'mcp__agentille__' + e.name } }))
  on('fs.read', async ($: any, e: any) => (e.path in files ? { value: files[e.path] } : { deny: 'ENOENT' }))
  on('fs.write', async ($: any, e: any) => { files[e.path] = e.content ?? e.text; return { value: undefined } })
  on('fs.exists', async () => ({ value: false }))
  on('fs.list', async () => ({ value: [] }))
  // The other session's worktree was made a minute ago; ours an hour ago.
  // A .env sweep in a tree touches its directory: from then on it reads as just modified.
  on('fs.stat', async ($: any, e: any) => ({ value: { kind: 'dir', size: 0, mtimeMs: e.path === '/work/repo-other' || seen.some((a) => a.includes(e.path) && a.includes('clean')) ? Date.now() : now - 3_600_000, isLink: false } }))
  on('store.get', async () => ({ value: undefined }))
  on('store.set', async () => ({ value: undefined }))
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.render', async () => ({ type: 'engine', ref: 0 }) as never)
  on('prompt.submit', async ($: any, e: any) => ({ text: e.text }))
  on('turn.start', async ($: any, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', async ($: any, e: any) => ({ text: e.answer }))
  on('agent.spawn', async ($: any, e: any) => ({ model: e.model ?? 'sonnet', agentId: 'sub1' }))
  // The engine runs the command: a worktree add makes the tree.
  on('tool.call', async ($: any, e: any) => {
    ran.push(e.command)
    const cmd = String(e.command ?? '')
    if (/worktree add.*agt\//.test(cmd)) git.made = true
    if (/worktree add.*feat\/f/.test(cmd)) git.feat = true
    // scripts/agt-worktree.sh: `f --branch feat/f` makes /work/repo-f, `x` makes /work/repo-x; what it prints
    // is what the Bash tool returns, plus anything else the line echoes.
    if (/agt-worktree\.sh/.test(cmd)) {
      const lines: string[] = []
      if (/agt-worktree\.sh f --branch feat\/f/.test(cmd)) git.feat = true, lines.push('path=/work/repo-f', 'branch=feat/f')
      if (/agt-worktree\.sh x\b/.test(cmd)) git.made = true, lines.push('path=/work/repo-x', 'branch=agt/x')
      for (const m of cmd.matchAll(/echo '([^']*)'/g)) lines.push(m[1])
      return { result: { stdout: lines.join('\n') + '\n', stderr: '' } }
    }
    return { result: 'ok' }
  })
  on('process.run', async ($: any, e: any) => {
    seen.push(e.argv)
    const a = e.argv.join(' ')
    if (o.broken && e.argv[0] === 'git' && !a.includes('worktree list')) return { deny: 'git could not be run' }
    const out = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '' } })
    // python -I -c <find_spec> <name>: where the module lives outside the folder, '' when nowhere.
    if (/^python/.test(e.argv[0]) && e.argv.includes('-I')) return out((o.pyFind?.[e.argv[e.argv.length - 1]] ?? '') + '\n')
    // git config --get alias.<word>: the value, exit 1 when there is none, a deny when git cannot be run.
    const am = /config --get alias\.(\S+)$/.exec(a)
    if (am) return o.aliasBroken ? { deny: 'git could not be run' } : o.aliases?.[am[1]] ? out(o.aliases[am[1]] + '\n') : out('', 1)
    if (a === 'git -C /work/repo worktree list --porcelain') {
      return out([
        'worktree /work/repo', 'HEAD ' + (git.committed ? 'm2' : 'm1'), 'branch refs/heads/main', '',
        'worktree /work/repo-other', 'HEAD m1', 'branch refs/heads/agt/other', '',
        ...(git.made ? ['worktree /work/repo-x', 'HEAD ' + (git.committed ? 'x1' : 'm1'), 'branch refs/heads/agt/x', ''] : []),
        ...(git.feat ? ['worktree /work/repo-f', 'HEAD ' + (git.committed ? 'f1' : 'm1'), 'branch refs/heads/feat/f', ''] : []),
      ].join('\n'))
    }
    const dir = e.argv[1] === '-C' ? e.argv[2] : ''
    if (a.endsWith('symbolic-ref --short -q HEAD')) return repos[dir]?.current ? out(repos[dir].current + '\n') : out('', 1)
    if (a.includes('config --get-regexp')) {
      const r = repos[dir] ?? {}
      const lines = [r.remote && 'remote.origin.url ' + r.remote, r.pushurl && 'remote.origin.pushurl ' + r.pushurl, r.upstream && 'remote.upstream.url ' + r.upstream, r.upstream && 'remote.upstream.gh-resolved base'].filter(Boolean)
      return out(lines.join('\n') + '\n', lines.length ? 0 : 1)
    }
    if (a.includes('remote get-url --push')) return repos[dir]?.pushurl || repos[dir]?.remote ? out((repos[dir].pushurl || repos[dir].remote) + '\n') : out('', 2)
    if (a.includes('@{push}')) return out('', 128)
    // The branches the remote has: ls-remote prints the one asked for when it is there.
    const lr = /ls-remote --heads \S+ refs\/heads\/(\S+)$/.exec(a)
    if (lr) return out((o.remoteHeads ?? []).includes(lr[1]) ? 'abc\trefs/heads/' + lr[1] + '\n' : '')
    // Every branch the remote has, and the remote's default as origin/HEAD records it (none unless the test sets one).
    if (/ls-remote --heads \S+$/.test(a)) return out((o.remoteHeads ?? []).map((h) => 'abc\trefs/heads/' + h + '\n').join(''))
    if (a.endsWith('symbolic-ref --short refs/remotes/origin/HEAD')) return o.originHead ? out('origin/' + o.originHead + '\n') : out('', 1)
    // A tag of that name, asked of git as refs/tags/<name>.
    const tg = /rev-parse -q --verify refs\/tags\/(\S+)$/.exec(a)
    if (tg) return (o.localTags ?? []).includes(tg[1]) ? out('abc\n') : out('', 1)
    // push.followTags, the annotated tags merged into a pushed source, and the tags the remote has.
    if (a.includes('config --type=bool --get push.followTags')) return o.followTags ? out('true\n') : out('', 1)
    if (a.includes('for-each-ref --format=%(objecttype) %(refname:short)')) return out((o.tags ?? []).map((t) => 'tag ' + t + '\n').join(''))
    if (/ls-remote --tags \S+$/.test(a)) return out((o.remoteTags ?? []).map((t) => 'abc\trefs/tags/' + t + '\n').join(''))
    // The upstream of the branch checked out: what the test sets as `tracking`.
    if (a.includes('@{upstream}')) return repos[dir]?.tracking ? out(repos[dir].tracking + '\n') : out('', 128)
    // The hooks folder git runs: core.hooksPath when the test sets one, else the repo's .git/hooks.
    if (a.includes('--git-path hooks')) return out((o.hooksPath ?? '/work/repo/.git/hooks') + '\n')
    if (a.includes('rev-parse --path-format=absolute --git-common-dir') && repos[dir]?.common) return out(repos[dir].common + '\n')
    if (a.includes('symbolic-ref')) return out('', 1)
    if (a.includes('branch --merged')) return out('agt/other\n' + (git.made ? 'agt/x\n' : ''))
    if (a === 'git -C /work/repo rev-parse HEAD') return out(git.committed ? 'm2\n' : 'm1\n')
    if (a.includes('branch --format')) return out('agt/other\n' + (git.made ? 'agt/x\n' : ''))
    if (a.includes('rev-parse --path-format=absolute --git-common-dir')) return out('/work/repo/.git\n')
    return out('')
  })
  const clock = mock.clock(on, { now: 1_000_000 })
  return { seen, ran, git, clock }
}
const boot = ($: any) => $.session.start({ cwd: '/work/repo', surface: null, isInteractive: false })
const typed = ($: any, text = '/agt ship it') => $.prompt.submit({ text, origin: { kind: 'composer' } } as never)
const bash = ($: any, command: string, agentId?: string) => $.tool.call({ tool: 'Bash', command, ...(agentId ? { agentId } : {}) } as never)
const card = async ($: any) => {
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.turn.complete({ answer: '✓ shipped', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  await new Promise((r) => setTimeout(r, 30))
}

describe('guard: integration in the mod', () => {
  test('a session where /agt was never typed keeps full Bash', { timeoutMs: 20_000 }, async ($, on) => {
    const { ran } = setup(on)
    await boot($)
    expect((await bash($, 'gh pr merge 3 --merge')).result).toBe('ok')
    expect((await bash($, 'git push origin v1.0.0')).result).toBe('ok')
    expect(ran).toHaveLength(2)
  })

  test('on an /agt run without auto in the profile, merge and tag are denied in one sentence; a PR is not', async ($, on) => {
    const { ran } = setup(on, { profile: { integration: 'pr' } })
    await boot($)
    await typed($)
    expect((await bash($, 'gh pr merge 3 --merge')).deny).toBe(DENY_INTEGRATION)
    expect((await bash($, 'git tag v1.1.0 && git push origin v1.1.0')).deny).toBe(DENY_INTEGRATION)
    expect((await bash($, 'gh pr create --base main --title x --body y')).result).toBe('ok')
    expect(ran).toEqual(['gh pr create --base main --title x --body y'])
  })

  test('a question typed mid-run keeps the lead and its subagent guarded', { timeoutMs: 20_000 }, async ($, on) => {
    setup(on)
    await boot($)
    await typed($)
    await $.agent.spawn({ prompt: '[agt run=gd1 size=small mode=build]\nbuild', subagentType: 'agentille:agentille-executor', model: 'sonnet' })
    await typed($, 'how is it going?')
    expect((await bash($, 'gh pr merge 3')).deny).toBe(DENY_INTEGRATION)
  })

  test('once the run\'s card is out, the lead is a plain session again', async ($, on) => {
    setup(on)
    await boot($)
    await typed($)
    expect((await bash($, 'gh pr merge 3')).deny).toBe(DENY_INTEGRATION)
    await card($)
    await typed($, 'something else')
    expect((await bash($, 'gh pr merge 3')).result).toBe('ok')
  })

  test('pushes: the slice branch goes, the base branch, a force and a variable ref do not, with a retry hint', async ($, on) => {
    const { ran } = setup(on)
    await boot($)
    await typed($)
    expect((await bash($, 'cd /work/repo-x && git push -u origin HEAD')).result).toBe('ok')
    expect((await bash($, 'git -C /work/repo-x push')).result).toBe('ok')
    expect((await bash($, 'git push -u origin agt/x')).result).toBe('ok')
    const main = await bash($, 'git push origin agt/x:main')
    expect(main.deny).toContain(DENY_PUSH)
    expect(main.deny).toContain('git push to main')
    expect((await bash($, 'git push')).deny).toContain('git push to main')
    // agt/x is the run's now (its push above created it): a lease push of it goes; one of agt/y, which it did not make, does not.
    expect((await bash($, 'git push --force-with-lease origin agt/y')).deny).toContain('--force')
    expect((await bash($, 'cd "$WT" && git push -u origin "$BRANCH"')).deny).toContain('(a variable)')
    expect((await bash($, 'cd "$WT" && git push -u origin HEAD')).deny).toContain('cannot be read')
    expect(ran).toEqual(['cd /work/repo-x && git push -u origin HEAD', 'git -C /work/repo-x push', 'git push -u origin agt/x'])
  })

  test('the repo the command targets decides, not the session\'s', async ($, on) => {
    setup(on, {
      profile: { projects: [{ url: 'https://github.com/me/repo', integration: 'auto' }] },
      repos: { '/work/repo': { current: 'main', remote: 'git@github.com:me/repo.git' }, '/work/lib': { current: 'main', remote: 'git@github.com:me/lib.git', common: '/work/lib/.git' } },
    })
    await boot($)
    await typed($)
    expect((await bash($, 'gh pr merge 3 --merge')).result).toBe('ok')
    expect((await bash($, 'cd /work/lib && gh pr merge 3')).deny).toBe(DENY_INTEGRATION)
    expect((await bash($, 'git -C /work/lib tag v1.0.0')).deny).toBe(DENY_INTEGRATION)
    expect((await bash($, 'gh pr merge 3 -R me/lib')).deny).toBe(DENY_INTEGRATION)
    expect((await bash($, 'gh api -X PUT repos/me/lib/pulls/3/merge')).deny).toBe(DENY_INTEGRATION)
    expect((await bash($, 'gh api -X PUT repos/me/repo/pulls/3/merge')).result).toBe('ok')
    expect((await bash($, 'git -C /work/lib push origin main')).deny).toContain('git push to main')
  })

  test('the session\'s repo is auto, the other is: a command into it may merge', async ($, on) => {
    setup(on, {
      profile: { projects: [{ path: '/work/lib', integration: 'auto' }] },
      repos: { '/work/lib': { current: 'main', common: '/work/lib/.git' } },
    })
    await boot($)
    await typed($)
    expect((await bash($, 'gh pr merge 3')).deny).toBe(DENY_INTEGRATION)
    expect((await bash($, 'cd /work/lib && gh pr merge 3 && git push origin main')).result).toBe('ok')
  })

  test('a profile entry with only a name does not match a repo with a remote', async ($, on) => {
    setup(on, { profile: { projects: [{ id: 'repo', integration: 'auto' }] }, repos: { '/work/repo': { current: 'main', remote: 'git@github.com:someone/repo.git' } } })
    await boot($)
    await typed($)
    expect((await bash($, 'gh pr merge 3')).deny).toBe(DENY_INTEGRATION)
  })

  test('auto at the top, pr for this repo by name: a repo with a remote keeps its pr', async ($, on) => {
    setup(on, { profile: { integration: 'auto', projects: [{ id: 'repo', integration: 'pr' }] }, repos: { '/work/repo': { current: 'main', remote: 'git@github.com:me/repo.git' } } })
    await boot($)
    await typed($)
    expect((await bash($, 'gh pr merge 3')).deny).toBe(DENY_INTEGRATION)
  })

  test('CLAUDE.md no-mistakes caps a profile auto at pr; AGENTS.md local-only refuses pushes and PRs', async ($, on) => {
    setup(on, { profile: { integration: 'auto' }, files: { '/work/repo/CLAUDE.md': '# Rules\n\nThis repo is no-mistakes.\n' } })
    await boot($)
    await typed($)
    expect((await bash($, 'gh pr merge 3')).deny).toBe(DENY_INTEGRATION)
    expect((await bash($, 'git push -u origin agt/x')).result).toBe('ok')
  })

  test('local-only in AGENTS.md: no push, no PR', async ($, on) => {
    setup(on, { profile: { integration: 'pr' }, files: { '/work/repo/AGENTS.md': 'Mode: local-only.\n' } })
    await boot($)
    await typed($)
    expect((await bash($, 'git push -u origin agt/x')).deny).toBe(DENY_LOCAL)
    expect((await bash($, 'gh pr create --title x --body y')).deny).toBe(DENY_LOCAL)
    expect((await bash($, 'git commit -m x')).result).toBe('ok')
  })

  test('auto in the profile for this repo lets the run merge and tag', async ($, on) => {
    setup(on, { profile: { projects: [{ id: 'repo', integration: 'auto' }] } })
    await boot($)
    await typed($)
    expect((await bash($, 'gh pr merge 3 --merge --delete-branch')).result).toBe('ok')
    expect((await bash($, 'git tag v2.0.0 && git push origin v2.0.0')).result).toBe('ok')
  })

  test('a repo config cannot raise a run to auto', async ($, on) => {
    setup(on, { repoConfig: { integration: 'auto' } })
    await boot($)
    await typed($)
    expect((await bash($, 'gh pr merge 3')).deny).toBe(DENY_INTEGRATION)
  })

  test('a repo config lowers the profile\'s auto', async ($, on) => {
    setup(on, { profile: { integration: 'auto' }, repoConfig: { integration: 'pr' } })
    await boot($)
    await typed($)
    expect((await bash($, 'gh pr merge 3')).deny).toBe(DENY_INTEGRATION)
  })

  test('a worker pane is guarded with no typed /agt', async ($, on) => {
    setup(on, { env: { AGENTILLE_WORKER: 'executor:sonnet:medium' } })
    await boot($)
    expect((await bash($, 'gh pr merge 3')).deny).toBe(DENY_INTEGRATION)
  })

  test('a /agt-spawn pane keeps full Bash', async ($, on) => {
    setup(on, { env: { AGENTILLE_WORKER: 'spawn:sonnet:' } })
    await boot($)
    expect((await bash($, 'gh pr merge 3')).result).toBe('ok')
  })
})

describe('guard: worktree ownership and the run-end tidy', () => {
  test('another session\'s fresh worktree is kept; the run\'s own merged one is removed, its .env copies swept first', async ($, on) => {
    const { seen, git } = setup(on)
    await boot($)
    await typed($)
    await bash($, 'SLUG="x"; git worktree add "../repo-$SLUG" -b "agt/$SLUG" main && cd ../repo-x && cp ../repo/.env* .')
    // No commits yet: /agt-clean keeps it, and never reads the other session's tree.
    const early = await $.command.run({ command: 'agt-clean', args: '', origin: { kind: 'composer' } } as never)
    expect(early.text).toContain('agt/x (no commits of its own)')
    expect(early.text).toContain('agt/other (not opened by this session)')
    expect(seen.some((a) => a.join(' ') === 'git -C /work/repo-other status --porcelain')).toBe(false)
    // A typed /agt-clean sweeps the run's .env copies even while it keeps the tree (an aborted run's go too).
    expect(seen.filter((a) => a.includes('clean')).map((a) => a.join(' '))).toEqual(['git -C /work/repo-x clean -fqX -- .env*'])
    // The slice commits and merges; the run ends on its card.
    git.committed = true
    seen.length = 0
    await card($)
    const sweep = seen.findIndex((a) => a.join(' ') === 'git -C /work/repo-x clean -fqX -- .env*')
    const removed = seen.findIndex((a) => a.join(' ') === 'git -C /work/repo worktree remove /work/repo-x')
    expect(sweep).toBeGreaterThan(-1)
    expect(removed).toBeGreaterThan(sweep)
    expect(seen).toContainEqual(['git', '-C', '/work/repo', 'branch', '-d', 'agt/x'])
    expect(seen.some((a) => a.includes('/work/repo-other') && (a.includes('remove') || a.includes('clean')))).toBe(false)
    expect(seen).not.toContainEqual(['git', '-C', '/work/repo', 'branch', '-d', 'agt/other'])
    // The main checkout's own .env is never swept.
    expect(seen.some((a) => a.includes('/work/repo') && a.includes('clean'))).toBe(false)
  })

  test('the run-end sweep deletes the ignored .env copies in every owned tree, a feat/* one included', async ($, on) => {
    const { seen, git } = setup(on)
    await boot($)
    await typed($)
    await bash($, 'git worktree add ../repo-x -b agt/x main && git worktree add ../repo-f -b feat/f main')
    git.committed = true
    await card($)
    // -X: only untracked files git ignores, so a tracked or un-ignored .env.example stays
    expect(seen).toContainEqual(['git', '-C', '/work/repo-x', 'clean', '-fqX', '--', '.env*'])
    expect(seen).toContainEqual(['git', '-C', '/work/repo-f', 'clean', '-fqX', '--', '.env*'])
    // the feat/* tree is swept, never removed: that is the lead's
    expect(seen.some((a) => a.includes('remove') && a.includes('/work/repo-f'))).toBe(false)
    expect(seen.some((a) => a.includes('clean') && (a.includes('/work/repo') || a.includes('/work/repo-other')))).toBe(false)
  })

  test('a tree agt-worktree.sh printed is recorded and swept, whatever its branch', async ($, on) => {
    const { seen, ran, git } = setup(on)
    await boot($)
    await typed($)
    // the guard lets the script through, written out with the plugin's absolute path
    const r = await bash($, 'bash /opt/agentille/scripts/agt-worktree.sh f --branch feat/f --base main')
    expect(r.deny).toBeUndefined()
    expect(ran).toEqual(['bash /opt/agentille/scripts/agt-worktree.sh f --branch feat/f --base main'])
    git.committed = true
    await card($)
    expect(seen).toContainEqual(['git', '-C', '/work/repo-f', 'clean', '-fqX', '--', '.env*'])
  })

  test('a re-attach by the script is recorded too; echoed lines naming another tree claim nothing', async ($, on) => {
    const { seen, git } = setup(on)
    git.made = true // the tree is already there: a fix round re-attaches it
    await boot($)
    await typed($)
    await bash($, "bash /opt/agentille/scripts/agt-worktree.sh x; echo 'path=/work/repo-other'; echo 'branch=agt/other'")
    const r = await $.command.run({ command: 'agt-clean', args: '', origin: { kind: 'composer' } } as never)
    expect(seen).toContainEqual(['git', '-C', '/work/repo-x', 'clean', '-fqX', '--', '.env*'])
    expect(r.text).toContain('agt/other (not opened by this session)')
    expect(seen.some((a) => a.includes('/work/repo-other'))).toBe(false)
  })

  test('a hand-made tree with its path written out is still recorded without the script', async ($, on) => {
    const { seen, git } = setup(on)
    await boot($)
    await typed($)
    await bash($, 'git worktree add /work/repo-f -b feat/f main && cd /work/repo-f && cp /work/repo/.env.local .')
    git.committed = true
    await card($)
    expect(seen).toContainEqual(['git', '-C', '/work/repo-f', 'clean', '-fqX', '--', '.env*'])
  })

  test('a session that recorded no worktree removes nothing', async ($, on) => {
    const { seen } = setup(on)
    await boot($)
    await typed($)
    await card($)
    expect(seen.some((a) => a.includes('worktree') && a.includes('list'))).toBe(true)
    expect(seen.some((a) => a.includes('remove') || a.includes('-d') || a.includes('clean'))).toBe(false)
  })

  test('a worktree made outside an /agt run is not recorded', async ($, on) => {
    const { seen, git } = setup(on)
    await boot($)
    await bash($, 'git worktree add ../repo-x -b agt/x main')
    git.committed = true
    const r = await $.command.run({ command: 'agt-clean', args: '', origin: { kind: 'composer' } } as never)
    expect(r.text).toContain('agt/x (not opened by this session)')
    expect(seen.some((a) => a.includes('remove'))).toBe(false)
  })
})

describe('guard: it fails closed', () => {
  test('a repo probe that throws denies the command in one sentence', async ($, on) => {
    const { ran } = setup(on, { broken: true, profile: { projects: [{ id: 'repo', integration: 'auto' }] } })
    await boot($)
    await typed($)
    expect((await bash($, 'git push -u origin agt/x')).deny).toBe(DENY_UNREAD)
    expect((await bash($, 'gh pr merge 3')).deny).toBe(DENY_UNREAD)
    // npm test runs a package script the guard reads in the repo's mode: unreadable here, so refused too.
    expect((await bash($, 'npm test')).deny).toBe(DENY_UNREAD)
    expect((await bash($, 'echo done')).result).toBe('ok')
    expect(ran).toEqual(['echo done'])
  })

  test('past the depth caps a line is refused as unreadable, and a command after the deep part is still read', async ($, on) => {
    const { ran } = setup(on, { profile: { integration: 'pr' } })
    await boot($)
    await typed($)
    const deep = 'echo $($($($($(x)))))'
    for (const line of ['eval eval eval eval gh pr merge 4', deep + '; gh pr merge 4', deep + '; git push origin HEAD:main --force', 'eval eval eval eval git push origin HEAD:main --force']) {
      expect([line, (await bash($, line)).deny]).toEqual([line, expect.stringContaining('nests deeper than the guard reads')])
    }
    // Nothing to judge but the deep part: still refused, never let through unread.
    expect((await bash($, deep + '; echo hi')).deny).toContain('substitution nests deeper than the guard reads')
    expect((await bash($, 'echo $(echo $(echo $(echo x)))')).result).toBe('ok')
    // Within the caps a substitution's output run as a program is still unreadable.
    expect((await bash($, 'echo $($($($(x))))')).deny).toContain('a program the guard cannot read')
    // Within the caps the normal path still judges the line.
    expect((await bash($, 'echo $(echo $(x)); gh pr merge 4')).deny).toBe(DENY_INTEGRATION)
    expect((await bash($, 'eval eval eval gh pr merge 4')).deny).toBe(DENY_INTEGRATION)
    // The lexer resumes after the deep part's closer: what follows it is read as its own command.
    expect(splitCommands(deep + '; gh pr merge 4').at(-1)).toEqual(['gh', 'pr', 'merge', '4'])
    expect((await bash($, '')).result).toBe('ok')
    expect((await bash($, '# a note')).result).toBe('ok')
    expect(ran).toEqual(['echo $(echo $(echo $(echo x)))', '', '# a note'])
  })

  test('under auto the depth caps refuse nothing', async ($, on) => {
    const { ran } = setup(on, { profile: { projects: [{ id: 'repo', integration: 'auto' }] } })
    await boot($)
    await typed($)
    expect((await bash($, 'eval eval eval eval gh pr merge 4')).result).toBe('ok')
    expect(ran).toEqual(['eval eval eval eval gh pr merge 4'])
  })

  test('below auto no branch is deleted on the remote, an own-prefix one included', async ($, on) => {
    setup(on)
    await boot($)
    await typed($)
    for (const line of ['git push origin :feat/someone-else', 'git push origin --delete agt/x', 'git push -d origin fix/y']) expect((await bash($, line)).deny).toContain('git push --delete')
    expect((await bash($, 'git push -u origin agt/x')).result).toBe('ok')
  })
})

// The lead's guard lasts for its run, not for a clock window: a run that named its id is guarded until its card.
describe('guard: the lead stays guarded for the whole run', () => {
  const sub = (run: string) => ({ prompt: '[agt run=' + run + ' size=small mode=build]\nbuild', subagentType: 'agentille:agentille-executor', model: 'sonnet' })
  // In steps: the redraw ticker keeps a short interval while the band shows the run.
  const later = async (clock: any, ms: number) => { for (let t = 0; t < ms; t += 60_000) await clock.advance(60_000) }
  const subDone = async ($: any) => {
    await $.turn.start({ text: 'go', turnId: 's1', agentId: 'sub1' })
    await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 's1', reason: 'answer', agentId: 'sub1' })
  }

  test('61 minutes into a run with its id named, after a typed question, a merge is still denied', { timeoutMs: 20_000 }, async ($, on) => {
    const { clock } = setup(on)
    await boot($)
    await typed($)
    await $.agent.spawn(sub('gl1'))
    await subDone($)
    await later(clock, 61 * 60_000)
    await typed($, 'still there?')
    expect((await bash($, 'gh pr merge 9 --merge --delete-branch')).deny).toBe(DENY_INTEGRATION)
  })

  test('three typed replies with nothing working do not switch it off', async ($, on) => {
    setup(on)
    await boot($)
    await typed($)
    await $.agent.spawn(sub('gl2'))
    await subDone($)
    for (const t of ['a', 'b', 'c', 'd']) await typed($, t)
    expect((await bash($, 'gh pr merge 9 --merge')).deny).toBe(DENY_INTEGRATION)
  })

  test('a typed /agt-info or /agt-focus starts no run and no hold', async ($, on) => {
    const { ran } = setup(on, { profile: { integration: 'pr' } })
    await boot($)
    for (const t of ['/agt-info', '/agt-focus off']) await typed($, t)
    expect((await bash($, 'git push origin HEAD:main')).result).toBe('ok')
    expect(ran).toEqual(['git push origin HEAD:main'])
  })

  test('a run that never names an id stays guarded past three typed replies, until its card', async ($, on) => {
    const { ran } = setup(on, { profile: { integration: 'pr' } })
    await boot($)
    await typed($)
    for (const t of ['a', 'b', 'c']) await typed($, t)
    expect((await bash($, 'git push origin HEAD:main')).deny).toContain('git push to main')
    await card($)
    expect((await bash($, 'git push origin HEAD:main')).result).toBe('ok')
    expect(ran).toEqual(['git push origin HEAD:main'])
  })

  test('a dispatch on a later turn names the run when the /agt turn did not', { timeoutMs: 20_000 }, async ($, on) => {
    const { clock } = setup(on)
    await boot($)
    await typed($)
    await typed($, 'yes, go ahead')
    await $.agent.spawn(sub('gl3'))
    await subDone($)
    await later(clock, 61 * 60_000)
    for (const t of ['a', 'b', 'c']) await typed($, t)
    expect((await bash($, 'gh pr merge 9')).deny).toBe(DENY_INTEGRATION)
  })

  test('the card ends it, even on a turn the person typed after the run lapsed', { timeoutMs: 20_000 }, async ($, on) => {
    const { clock } = setup(on)
    await boot($)
    await typed($)
    await $.agent.spawn(sub('gl4'))
    await subDone($)
    await later(clock, 61 * 60_000)
    await typed($, 'merge it once green')
    expect((await bash($, 'gh pr merge 9')).deny).toBe(DENY_INTEGRATION)
    await card($)
    await typed($, 'something else')
    expect((await bash($, 'gh pr merge 9')).result).toBe('ok')
  })
})

// The repo a write lands in decides, not the folder the session sits in.
describe('guard: the target repo is read from the write', () => {
  const sandbox = { profile: { integration: 'pr', projects: [{ path: '/work/repo', integration: 'auto' }] }, repos: { '/work/repo': { current: 'agt/x', remote: 'git@github.com:me/sandbox.git' } } }

  test('GH_REPO on the line, exported earlier, or in the session names gh\'s repo', async ($, on) => {
    const { ran } = setup(on, sandbox)
    await boot($)
    await typed($)
    expect((await bash($, 'gh pr merge 7 --merge')).result).toBe('ok')
    expect((await bash($, 'GH_REPO=victim/prod gh pr merge 7 --merge')).deny).toBe(DENY_INTEGRATION)
    expect((await bash($, 'export GH_REPO=victim/prod; gh pr merge 7 --merge')).deny).toBe(DENY_INTEGRATION)
    expect((await bash($, 'GITHUB_REPOSITORY=victim/prod gh release create v1')).deny).toBe(DENY_INTEGRATION)
    expect((await bash($, 'GH_REPO=me/sandbox gh pr merge 8')).result).toBe('ok')
    expect(ran).toEqual(['gh pr merge 7 --merge', 'GH_REPO=me/sandbox gh pr merge 8'])
  })

  test('GH_REPO in the session\'s environment counts too', async ($, on) => {
    setup(on, { ...sandbox, env: { GH_REPO: 'victim/prod' } })
    await boot($)
    await typed($)
    expect((await bash($, 'gh pr merge 7')).deny).toBe(DENY_INTEGRATION)
  })

  test('gh repo set-default: the remote it resolved is the target', async ($, on) => {
    setup(on, { ...sandbox, repos: { '/work/repo': { current: 'agt/x', remote: 'git@github.com:me/sandbox.git', upstream: 'https://github.com/victim/prod.git' } } })
    await boot($)
    await typed($)
    expect((await bash($, 'gh pr merge 7')).deny).toBe(DENY_INTEGRATION)
    expect((await bash($, 'gh pr merge 7 -R me/sandbox')).result).toBe('ok')
  })

  test('a push to a URL, a path, an edited remote or a pushurl is judged by where it lands', async ($, on) => {
    setup(on, sandbox)
    await boot($)
    await typed($)
    expect((await bash($, 'git push origin agt/x:main')).result).toBe('ok')
    for (const line of [
      'git push https://github.com/victim/prod.git agt/x:main',
      'git push /work/prod.git agt/x:main',
      'git push ../prod.git agt/x:main',
      'git remote set-url origin https://github.com/victim/prod && git push origin agt/x:main',
      'git remote add prod https://github.com/victim/prod && git push prod agt/x:main',
      'git -c remote.origin.pushurl=https://github.com/victim/prod push origin agt/x:main',
      'git -c url.https://github.com/victim/prod.pushInsteadOf=git@github.com:me/sandbox.git push origin agt/x:main',
      'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=remote.origin.pushurl GIT_CONFIG_VALUE_0=x git push origin agt/x:main',
      'cd "$OTHER" && git push origin agt/x:main',
    ]) expect([line, (await bash($, line)).deny]).toEqual([line, expect.stringContaining('git push to main')])
    expect((await bash($, 'git push git@github.com:me/sandbox.git agt/x:main')).result).toBe('ok')
  })

  test('a pushurl set before the line sends the push elsewhere', async ($, on) => {
    setup(on, { ...sandbox, repos: { '/work/repo': { current: 'agt/x', remote: 'git@github.com:me/sandbox.git', pushurl: 'https://github.com/victim/prod.git' } } })
    await boot($)
    await typed($)
    expect((await bash($, 'git push origin agt/x:main')).deny).toContain('git push to main')
    expect((await bash($, 'gh pr merge 7')).result).toBe('ok')
  })

  test('a name-only profile entry grants a stranger\'s repo of that name nothing', async ($, on) => {
    setup(on, { profile: { projects: [{ name: 'api', integration: 'auto' }] } })
    await boot($)
    await typed($)
    expect((await bash($, 'gh pr merge 3 -R stranger/api --merge')).deny).toBe(DENY_INTEGRATION)
  })
})

describe('guard: aliases and plumbing in the mod', () => {
  test('a ref write is judged against the repo\'s own base, a tag as git tag is', async ($, on) => {
    setup(on)
    await boot($)
    await typed($)
    expect((await bash($, 'git update-ref refs/tags/v1 HEAD')).deny).toContain(DENY_INTEGRATION)
    expect((await bash($, 'git update-ref HEAD agt/x')).deny).toContain('base branch main')
    expect((await bash($, 'git -C /work/repo-x update-ref HEAD agt/x~1')).result).toBe('ok')
    expect((await bash($, 'git -c alias.p=push p origin agt/x:main')).deny).toBe(DENY_INTEGRATION)
    expect((await bash($, 'git send-pack origin agt/x:main')).deny).toBe(DENY_INTEGRATION)
  })
})

describe('guard: scripts are read before they run', () => {
  const files = {
    '/work/repo/ship.sh': '#!/bin/sh\nset -e\ngit push origin main\n',
    '/work/repo/ship.py': 'import subprocess\nsubprocess.run(["git", "push", "origin", "main"])\n',
    '/work/repo/test.sh': '#!/bin/sh\nnpm test\n',
    '/work/repo/Makefile': 'test:\n\tnpm test\n\nrelease: test tag-it\n\nlint:\n\tnpm run lint\n\ntag-it:\n\tgit tag v1 && git push --tags\n\n%.o: %.c\n\tcc $<\n',
    '/work/repo/package.json': JSON.stringify({ name: 'p', scripts: { test: 'echo t', lint: 'eslint .' } }),
  }

  test('a script that pushes, merges or tags is refused, and the text says why; a plain one runs', async ($, on) => {
    const { ran } = setup(on, { files })
    await boot($)
    await typed($)
    for (const line of ['./ship.sh', 'sh ship.sh', 'bash ./ship.sh', 'source ship.sh', '. ./ship.sh', 'python3 ship.py', 'cd /work/repo && ./ship.sh --fast']) {
      const r = await bash($, line)
      expect([line, r.deny]).toEqual([line, expect.stringContaining('runs a script that calls git push')])
    }
    expect((await bash($, 'cd "$X" && ./ship.sh')).deny).toContain('cannot locate')
    expect((await bash($, './test.sh')).result).toBe('ok')
    expect((await bash($, './missing.sh')).result).toBe('ok')
    expect(ran).toEqual(['./test.sh', './missing.sh'])
  })

  test('make: the target\'s recipe and prerequisites are read, the whole file when the target is not a rule', async ($, on) => {
    const { ran } = setup(on, { files })
    await boot($)
    await typed($)
    expect((await bash($, 'make release')).deny).toContain('make release runs a recipe that mentions push')
    expect((await bash($, 'make -C /work/repo release')).deny).toContain('make release')
    expect((await bash($, 'make deploy')).deny).toContain('make deploy')
    expect((await bash($, 'make test lint')).result).toBe('ok')
    expect((await bash($, 'make')).result).toBe('ok')
    expect((await bash($, 'make -C /work/elsewhere release')).result).toBe('ok')
    expect(ran).toEqual(['make test lint', 'make', 'make -C /work/elsewhere release'])
  })

  test('under auto, or outside a run, a script runs unread', async ($, on) => {
    const { ran } = setup(on, { files, profile: { projects: [{ id: 'repo', integration: 'auto' }] } })
    await boot($)
    expect((await bash($, './ship.sh')).result).toBe('ok')
    await typed($)
    expect((await bash($, './ship.sh')).result).toBe('ok')
    expect((await bash($, 'python3 -c "import os; os.system(\'git push origin main\')"')).result).toBe('ok')
    expect(ran).toHaveLength(3)
  })
})

describe('guard: package scripts, modules and imports are followed', () => {
  const pkg = (scripts: Record<string, string>) => JSON.stringify({ scripts })
  const files = {
    '/work/repo/package.json': pkg({
      preship: 'git push origin main', ship: 'echo shipping',
      build: 'tsc', postbuild: 'npm run tag-it', 'tag-it': 'git tag v1',
      a: 'npm run b', b: 'echo b && sh ./tools/push.sh',
      rel: 'node tools/rel.mjs', gone: 'node tools/gone.mjs', mod: 'python3 -m tools.rel',
      loop: 'npm run loop', d1: 'npm run d2', d2: 'npm run d3', d3: 'npm run d4', d4: 'npm run d5', d5: 'npm run d6', d6: 'npm run d7', d7: 'echo deep',
      test: 'git push origin HEAD:main', lint: 'eslint .', fine: 'node tools/fine.mjs',
      vary: 'bash "$D/x.sh"', check: 'sh ./tools/check.sh', wrap: 'sh ./tools/wrap.sh',
    }),
    '/work/repo/tools/check.sh': '#!/bin/sh\nD=$(dirname "$0")\nbash "$D/x.sh"\nsh ./tools/absent.sh\nnode ./tools/fine.mjs\n',
    '/work/repo/tools/wrap.sh': '#!/bin/sh\nset -e\nsh ./tools/push.sh\n',
    '/work/repo/tools/push.sh': '#!/bin/sh\ngit push origin main\n',
    '/work/repo/tools/rel.mjs': "import { run } from './lib.js'\nrun()\n",
    '/work/repo/tools/lib.js': "import { execSync } from 'node:child_process'\nexport const run = () => execSync('git push origin HEAD:main')\n",
    '/work/repo/tools/fine.mjs': "import { x } from './util'\nimport fs from 'node:fs'\nconsole.log(x)\n",
    '/work/repo/tools/util.ts': 'export const x = 1\n',
    '/work/repo/tools/broken.mjs': "import './nowhere.js'\n",
    '/work/repo/tools/__init__.py': '',
    '/work/repo/tools/rel.py': 'import subprocess\nsubprocess.run(["git", "push", "origin", "main"])\n',
    '/work/repo/src/app/__init__.py': '',
    '/work/repo/src/app/__main__.py': 'import os\nos.system("gh pr merge 1")\n',
    '/work/repo/pkg/__init__.py': '',
    '/work/repo/pkg/ok.py': 'print(1)\n',
  }

  test('pre and post scripts, nested runs, scripts, imports and modules are read', { timeoutMs: 20_000 }, async ($, on) => {
    const { ran } = setup(on, { files, pyFind: { pytest: '/usr/lib/python3/site-packages/pytest/__init__.py', http: '/usr/lib/python3.12/http/__init__.py' } })
    await boot($)
    await typed($)
    const deny = async (line: string, text: string) => expect([line, (await bash($, line)).deny]).toEqual([line, expect.stringContaining(text)])
    await deny('npm run ship', 'npm run ship (its preship script) runs a package script that calls git push')
    await deny('npm run build', 'npm run build (its postbuild script), then npm run tag-it runs a package script')
    await deny('npm run a', 'tools/push.sh runs a script that calls git push')
    await deny('pnpm run rel', 'imports ./lib.js, which calls git push')
    await deny('yarn run gone', 'node tools/gone.mjs runs a file the guard cannot read')
    await deny('bun run mod', 'python3 -m tools.rel runs a module that calls git push')
    await deny('npm run d1', 'nested deeper than the guard reads')
    await deny('npm test', 'npm test runs a package script that calls git push')
    await deny('pnpm test', 'pnpm test runs a package script')
    await deny('pnpm ship', 'its preship script')
    await deny('pnpm -r run build', 'another package folder')
    await deny('npm run lint --workspaces', 'another package folder')
    await deny('npm -w app run lint -- -x', 'another package folder')
    await deny('pnpm --filter app test', 'another package folder')
    await deny('npm --loglevel silent run ship', 'its preship script')
    await deny('node tools/rel.mjs', 'imports ./lib.js, which calls git push')
    await deny('node tools/broken.mjs', 'imports ./nowhere.js, which the guard cannot read')
    await deny('python3 -m tools.rel', 'runs a module that calls git push')
    await deny('PYTHONPATH=src python3 -m app', 'python3 -m app runs a module that calls git push')
    await deny('python3 -m nowhere.mod', 'runs a module the guard cannot find')
    await deny('PYTHONPATH=$X python3 -m nowhere', 'PYTHONPATH entry the guard cannot read')
    // A package script's own steps are judged strictly: a script named through a variable refuses.
    await deny('npm run vary', 'cannot locate')
    // A shell file's steps are followed where the guard can place and read them; the rest are skipped.
    await deny('npm run wrap', 'tools/push.sh runs a script that calls git push')
    await deny('sh tools/wrap.sh', 'tools/push.sh runs a script that calls git push')
    const ok = ['npm run loop', 'npm run lint', 'npm run fine', 'node tools/fine.mjs', 'python3 -m pkg.ok', 'python3 -m pytest -q', 'python3 -m http.server', 'pnpm install', 'yarn', 'bun test',
      'npm run check', 'sh tools/check.sh', 'npm i -g typescript', 'yarn add left-pad',
      'npm run lint -- -g adds', 'npm run lint -- -w', 'pnpm run lint -- --filter x']
    for (const line of ok) expect([line, (await bash($, line)).result]).toEqual([line, 'ok'])
    expect(ran).toEqual(ok)
    // An install runs lifecycle scripts: pointed at another package folder, the guard cannot tell whose, as for run.
    for (const line of ['pnpm add -w lodash', 'pnpm -r install', 'npm install --prefix x']) await deny(line, 'another package folder')
  })

  test('a run script that is not there, or a package.json that does not parse, is refused', async ($, on) => {
    setup(on, { files: { '/work/repo/package.json': '{ not json' } })
    await boot($)
    await typed($)
    expect((await bash($, 'npm run build')).deny).toContain('package script the guard cannot read')
    expect((await bash($, 'npm test')).deny).toContain('package script the guard cannot read')
  })
})

describe('guard: git aliases from config', () => {
  test('a word that is no git command is looked up as an alias and its expansion judged', async ($, on) => {
    const { ran, seen } = setup(on, { repos: { '/work/repo': { current: 'agt/x' } }, aliases: { pom: 'push origin HEAD:main', ship: '!git push origin HEAD:main', st: 'status', mine: 'push -u origin agt/x' } })
    await boot($)
    await typed($)
    expect((await bash($, 'git pom')).deny).toContain('git push to main')
    expect((await bash($, 'git ship')).deny).toContain('git push to main')
    expect((await bash($, 'git -C /work/repo pom')).deny).toContain('git push to main')
    expect((await bash($, 'git st')).result).toBe('ok')
    expect((await bash($, 'git mine')).result).toBe('ok')
    expect((await bash($, 'git lfs ls-files')).result).toBe('ok')
    expect((await bash($, 'git status')).result).toBe('ok')
    expect(ran).toEqual(['git st', 'git mine', 'git lfs ls-files', 'git status'])
    // git's own commands are never looked up: git ignores an alias that shadows one.
    expect(seen.some((a) => a.join(' ').includes('alias.status'))).toBe(false)
    expect(seen.some((a) => a.join(' ') === 'git -C /work/repo config --get alias.pom')).toBe(true)
  })

  test('an alias a package script or a shell script runs is looked up too', async ($, on) => {
    const files = {
      '/work/repo/package.json': JSON.stringify({ scripts: { ship: 'git pom', status: 'git st', sh: 'sh ./ship.sh' } }),
      '/work/repo/ship.sh': '#!/bin/sh\nset -e\ngit pom\n',
    }
    const { ran } = setup(on, { files, repos: { '/work/repo': { current: 'agt/x' } }, aliases: { pom: 'push origin HEAD:main', st: 'status' } })
    await boot($)
    await typed($)
    expect((await bash($, 'npm run ship')).deny).toContain('npm run ship, then git pom runs a package script that calls git push')
    expect((await bash($, 'sh ship.sh')).deny).toContain('sh ship.sh, then git pom runs a script that calls git push')
    expect((await bash($, 'npm run sh')).deny).toContain('then git pom')
    expect((await bash($, 'npm run status')).result).toBe('ok')
    expect(ran).toEqual(['npm run status'])
  })

  test('an alias the guard cannot look up is refused in a run; outside a run nothing is looked up', async ($, on) => {
    const { ran, seen } = setup(on, { aliasBroken: true })
    await boot($)
    expect((await bash($, 'git pom')).result).toBe('ok')
    expect(seen.some((a) => a.join(' ').includes('alias.'))).toBe(false)
    await typed($)
    expect((await bash($, 'git pom')).deny).toContain('could not look up')
    expect((await bash($, 'cd "$X" && git pom')).deny).toContain('cannot place')
    expect(ran).toEqual(['git pom'])
  })

  test('git submodule foreach: its line is judged, in a repo the guard cannot place', async () => {
    expect(integrationIn("git submodule foreach 'git push origin HEAD:main'", onSlice)).toBe('git push to main')
    expect(integrationIn("git submodule --quiet foreach --recursive 'git tag v1'", onSlice)).toBe('git tag (in git submodule foreach)')
    expect(integrationIn("git submodule foreach 'echo x >> .git/config'", onSlice)).toBe('.git/config (in git submodule foreach)')
    expect(integrationIn("git submodule foreach 'git status'", onSlice)).toBeNull()
  })

  test('an alias set for one call or written to config stays a step of its own', async () => {
    expect(integrationIn('git -c alias.p=push p origin agt/x:main', onSlice)).toBe('git -c alias.*')
    expect(integrationIn('git config alias.p push && git p origin HEAD:main', onSlice)).toBe('git config alias.*')
  })
})

describe('guard: unreadable words and sources fail closed', () => {
  test('a substitution, a pipe into a shell, xargs, an interpreter spawn, awk, an opaque runner or an inline alias is refused', async () => {
    for (const line of [
      'git $(echo push) origin HEAD:main',
      'git ${X:-push} origin HEAD:main',
      'gh $(echo pr) merge 1',
      "echo 'git push origin main' | bash",
      "printf '%s\\n' push origin main | xargs git",
      'python3 - <<EOF\nimport subprocess\nsubprocess.run(["git", "push"])\nEOF',
      'python3 -c "import subprocess as s; s.run([\'g\'+\'it\', \'push\'])"',
      "awk 'BEGIN{system(\"git push origin main\")}'",
      'npx release-it',
      'docker run --rm alpine/git push origin main',
      'shopt -s expand_aliases\nalias g=git\ng push origin main',
    ]) expect([line, integrationIn(line, onSlice)]).toEqual([line, expect.any(String)])
  })

  test('ordinary interpreter, package and container commands are left alone', async () => {
    for (const line of [
      'npm test',
      'node -e "console.log(require(\'./package.json\').version)"',
      'python3 -c "print(1)"',
      'docker ps',
      'git log | grep fix',
    ]) expect([line, integrationIn(line, onSlice)]).toEqual([line, null])
  })
})

describe('guard: the trust root and the repo git state are off-limits below auto', () => {
  test('a redirect, copy, tee, sed -i or git config that writes them is refused; an ordinary write is not', async () => {
    for (const line of [
      'printf x > ~/.agentille/profile.json',
      'echo x >> "$HOME/.agentille/profile.json"',
      'echo x >> .git/config',
      'cp hook .git/hooks/post-commit',
      'tee .git/hooks/pre-push < h',
      'git config core.hooksPath .h',
      'git config remote.origin.push +refs/heads/*:refs/heads/*',
      'sed -i s/x/y/ .git/config',
    ]) expect([line, integrationIn(line, onSlice)]).toEqual([line, expect.any(String)])
    // Config that runs code or moves where a push lands, set for one call or written: refused as a config write.
    for (const line of [
      'git -c push.default=upstream push',
      'git -c push.default=matching push origin',
      'git config push.default matching',
      'git config --global push.default current',
      'git -c core.fsmonitor=./watch.sh status',
      'git config core.fsmonitor ./watch.sh',
      'git -c core.sshCommand="sh ./x.sh" fetch',
      'git --config-env=core.sshCommand=CMD fetch',
      'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=push.default GIT_CONFIG_VALUE_0=matching git push',
    ]) expect([line, integrationIn(line, onSlice)]).toEqual([line, expect.stringContaining('git config key')])
    // Any case (APFS and NTFS open .GIT/CONFIG as .git/config), a submodule's git dir, and a link to or a move of
    // a protected path.
    for (const line of [
      'echo x >> .GIT/CONFIG',
      'echo x >> .Git/Hooks/pre-push',
      'printf x > ~/.Agentille/profile.json',
      'echo x >> /work/repo/.git/modules/sub/config',
      'cp hook .git/modules/sub/hooks/pre-push',
      'echo x >> .git/modules/a/modules/b/config',
      'echo abc > .git/modules/sub/refs/heads/main',
      'ln -s .git g',
      'ln -s .git/config cfg',
      'ln -sf ../.git/hooks h',
      'mv .git/config /tmp/c',
    ]) expect([line, integrationIn(line, onSlice)]).toEqual([line, expect.any(String)])
    for (const line of [
      'echo x > notes.md',
      'cp a b',
      'git config user.name me',
      'git config --get remote.origin.url',
      'git config --get push.default',
      'ln -s ../shared/config.json config.json',
      'mv notes.md docs/notes.md',
      'cat .git/modules/sub/config',
      'ls 2>&1 > /dev/null',
    ]) expect([line, integrationIn(line, onSlice)]).toEqual([line, null])
  })
})

describe('guard: protected writes and package scripts in the mod', () => {
  test('a run below auto cannot rewrite the profile or .git/config by Bash or by the Write/Edit tool', async ($, on) => {
    setup(on)
    await boot($)
    await typed($)
    expect((await bash($, 'printf \'{"integration":"auto"}\' > "$HOME/.agentille/profile.json"')).deny).toContain('may not write')
    expect((await bash($, 'printf "[alias]\\n\\tp = push\\n" >> .git/config')).deny).toContain('may not write')
    expect((await $.tool.call({ tool: 'Write', file_path: '/h/.agentille/profile.json', content: 'x' } as never)).deny).toContain('may not write')
    expect((await $.tool.call({ tool: 'Edit', file_path: '/work/repo/.git/config', old_string: 'a', new_string: 'b' } as never)).deny).toContain('may not write')
    expect((await $.tool.call({ tool: 'Write', file_path: '/work/repo/notes.md', content: 'x' } as never))?.deny).toBeUndefined()
    expect((await $.tool.call({ tool: 'Edit', file_path: '/work/repo/.GIT/Config', old_string: 'a', new_string: 'b' } as never)).deny).toContain('may not write')
    expect((await $.tool.call({ tool: 'Write', file_path: '/H/.AGENTILLE/profile.json', content: 'x' } as never)).deny).toContain('may not write')
    expect((await $.tool.call({ tool: 'Write', file_path: '/work/repo/.git/modules/sub/hooks/pre-push', content: 'x' } as never)).deny).toContain('may not write')
  })

  test('inside a run a Write/Edit the guard cannot judge is refused; outside a run it goes through', async ($, on) => {
    const { ran } = setup(on)
    await boot($)
    // A path that is no string makes the judgement throw.
    expect((await $.tool.call({ tool: 'Write', file_path: 42, content: 'x' } as never))?.deny).toBeUndefined()
    expect((await $.tool.call({ tool: 'Edit', file_path: 42, old_string: 'a', new_string: 'b' } as never))?.deny).toBeUndefined()
    await typed($)
    expect((await $.tool.call({ tool: 'Write', file_path: 42, content: 'x' } as never)).deny).toBe('The guard could not judge this write to 42, so it refused it. Retry, or make the change yourself.')
    expect((await $.tool.call({ tool: 'Edit', file_path: 42, old_string: 'a', new_string: 'b' } as never)).deny).toContain('could not judge this write to 42')
    expect((await $.tool.call({ tool: 'NotebookEdit', notebook_path: 42, new_source: 'x' } as never)).deny).toContain('could not judge')
    expect(ran).toHaveLength(2)
  })

  test('under auto the profile and config are writable again', async ($, on) => {
    setup(on, { profile: { integration: 'auto' } })
    await boot($)
    await typed($)
    expect((await bash($, 'echo x > ~/.agentille/profile.json'))?.deny).toBeUndefined()
    expect((await $.tool.call({ tool: 'Write', file_path: '/h/.agentille/profile.json', content: 'x' } as never))?.deny).toBeUndefined()
  })

  test('an npm/pnpm run script is read from package.json; a plain script and npm test run, an opaque runner is refused', async ($, on) => {
    setup(on, { files: { '/work/repo/package.json': JSON.stringify({ scripts: { ship: 'git push origin main', build: 'tsc' } }) } })
    await boot($)
    await typed($)
    expect((await bash($, 'npm run ship')).deny).toContain('package script that calls git push')
    expect((await bash($, 'pnpm run -s ship')).deny).toContain('package script')
    expect((await bash($, 'npm run build')).result).toBe('ok')
    expect((await bash($, 'npm test')).result).toBe('ok')
    expect((await bash($, 'npx release-it')).deny).toContain('cannot read')
  })
})

describe('guard: config that runs code, and .gitattributes', () => {
  test('a filter, diff driver, pager, editor, helper or include is a config write; a harmless viewer is not', async () => {
    for (const line of [
      "git config filter.f.clean 'git push origin agt/x:main; cat'",
      'git config --global filter.f.smudge ./s.sh',
      'git config --system filter.f.process ./p',
      'git -c filter.f.clean=./x add c',
      'git config diff.external ./d.sh',
      'git config diff.x.textconv ./t.sh',
      'git -c diff.x.command=./c diff',
      'git config merge.m.driver ./m.sh',
      "git -c core.pager='sh -c x' log",
      'git config core.editor ./e.sh',
      'git config sequence.editor ./e.sh',
      'git config gpg.program ./g',
      'git config gpg.ssh.program ./g',
      'git config credential.helper ./h',
      'git config credential.https://example.test.helper ./h',
      'git config include.path ../evil.cfg',
      'git config includeIf.gitdir:~/.path ../evil.cfg',
      'git config core.attributesFile ./attrs',
      'git config -f x.cfg diff.x.textconv y',
      'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=filter.f.smudge GIT_CONFIG_VALUE_0=x git status',
      "GIT_CONFIG_PARAMETERS=\"'diff.external'='./d'\" git diff",
    ]) expect([line, integrationIn(line, onSlice)]).toEqual([line, expect.stringContaining('git config key')])
    for (const line of [
      'git -c core.pager=cat log',
      'git -c core.editor=true rebase --continue',
      'git config core.pager less',
      'git -c pager.log=false log',
      'git config --get filter.f.clean',
      'git config --unset diff.external',
    ]) expect([line, integrationIn(line, onSlice)]).toEqual([line, null])
  })

  test('a .gitattributes anywhere is a protected write: a redirect, tee, cp, sed -i or interpreter code', async () => {
    for (const line of [
      "echo '* filter=f' > .gitattributes",
      "printf '* diff=x' >> src/.gitattributes",
      'tee .gitattributes < a',
      'cp attrs .gitattributes',
      'mv attrs sub/.GitAttributes',
      'sed -i s/a/b/ .gitattributes',
      "echo '* filter=f' > .git/info/attributes",
      "python3 -c \"open('.gitattributes','w').write('* filter=f')\"",
    ]) expect([line, integrationIn(line, onSlice)]).toEqual([line, expect.any(String)])
    expect(integrationIn('cat .gitattributes', onSlice)).toBe(null)
  })

  test('in the mod: the filter chain is refused at both steps, and the Write tool cannot add .gitattributes', async ($, on) => {
    const { ran } = setup(on, { profile: { integration: 'pr' } })
    await boot($)
    await typed($)
    expect((await bash($, "git config filter.f.clean 'git push origin agt/x:main; cat'")).deny).toContain('git config key')
    expect((await bash($, "echo '* filter=f' > .gitattributes")).deny).toContain('may not write')
    expect((await $.tool.call({ tool: 'Write', file_path: '/work/repo/.gitattributes', content: '* filter=f' } as never)).deny).toContain('may not write')
    expect((await $.tool.call({ tool: 'Edit', file_path: '/work/repo/web/.gitattributes', old_string: 'a', new_string: 'b' } as never)).deny).toContain('may not write')
    expect((await bash($, 'git -c core.pager=cat log')).result).toBe('ok')
    expect(ran).toEqual(['git -c core.pager=cat log'])
  })
})

describe('guard: an alias is looked up in the config the line points git at', () => {
  test('a home or config file the lookup cannot place makes the alias unreadable', async ($, on) => {
    const { ran, seen } = setup(on, { repos: { '/work/repo': { current: 'agt/x' } }, aliases: { st: 'status' } })
    await boot($)
    await typed($)
    // A config home or file set on a git line is refused on its own (it can name code git runs), and the alias it
    // would be read from is never looked up.
    for (const line of ['GIT_CONFIG_GLOBAL=../evil/g.cfg git st', 'HOME=../evil git st', 'XDG_CONFIG_HOME=cfg git st', 'GIT_CONFIG_SYSTEM="$X" git st', 'export HOME=evil; git st', 'GIT_CONFIG_GLOBAL=/etc/g.cfg git st']) {
      expect([line, (await bash($, line)).deny]).toEqual([line, expect.stringContaining('on the line names a program or config git runs')])
    }
    expect(seen.some((a) => a.join(' ').includes('alias.st'))).toBe(false)
    expect(ran).toEqual([])
  })

  test('the alias candidate carries the config the line sets; one it cannot place is unreadable', async () => {
    const [a] = commandSteps('GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=user.name GIT_CONFIG_VALUE_0=x git st', '/w').filter((x: any) => x.kind === 'alias')
    expect(a.genv).toEqual({ GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'user.name', GIT_CONFIG_VALUE_0: 'x' })
    expect(a.unknown).toBe(false)
    const [b] = commandSteps('HOME=../evil git st', '/w').filter((x: any) => x.kind === 'alias')
    expect(b.unknown).toBe(true)
    const [c] = commandSteps('GIT_CONFIG_GLOBAL=/etc/g.cfg git st', '/w').filter((x: any) => x.kind === 'alias')
    expect([c.unknown, c.genv]).toEqual([false, { GIT_CONFIG_GLOBAL: '/etc/g.cfg' }])
  })
})

describe('guard: a script step it cannot read refuses', () => {
  const files = {
    '/work/repo/package.json': JSON.stringify({ scripts: { ship: 'git pu${X:-sh} origin agt/x:main', gh: 'gh ${CMD} 4', build: 'tsc && "$NODE" tools/x.js', deep: 'echo $($($($($(x)))))' } }),
    '/work/repo/s.sh': 'c=$(printf gi)t; $c push origin agt/x:main\n',
    '/work/repo/run.sh': '#!/bin/sh\nexec "$@"\n',
  }

  test('an unresolved subcommand, program or nesting in a package script or a script file is refused', async ($, on) => {
    const { ran } = setup(on, { files })
    await boot($)
    await typed($)
    expect((await bash($, 'npm run ship')).deny).toContain('git runs a subcommand the guard cannot read')
    expect((await bash($, 'npm run gh')).deny).toContain('gh runs a subcommand the guard cannot read')
    expect((await bash($, 'npm run deep')).deny).toContain('nests deeper than the guard reads')
    expect((await bash($, 'sh s.sh')).deny).toContain('a program the guard cannot read')
    expect((await bash($, '$(printf gi)t push origin agt/x:main')).deny).toContain('a program the guard cannot read')
    // In a script's text a variable program with no integration word after it is not judged: `"$@"`, `"$NODE" x.js`.
    expect((await bash($, 'npm run build')).result).toBe('ok')
    expect((await bash($, 'sh run.sh npm test')).result).toBe('ok')
    // On the Bash line itself an unresolved program word is refused: `"$EDITOR" f` is rare in a run.
    expect((await bash($, '"$EDITOR" notes.md')).deny).toContain('a program the guard cannot read ($EDITOR)')
    expect(ran).toEqual(['npm run build', 'sh run.sh npm test'])
  })
})

describe('guard: a program word built from a variable', () => {
  test('a variable the line sets is expanded and split as the shell does, then judged', async ($, on) => {
    const { ran } = setup(on, { repos: { '/work/repo': { current: 'agt/x' } } })
    await boot($)
    await typed($)
    expect((await bash($, "c='git push -q origin agt/x:main'; $c")).deny).toContain('git push to main')
    expect((await bash($, "c='git push -q origin agt/x:main' && ${c}")).deny).toContain('git push to main')
    expect((await bash($, "a='push -q origin agt/x:main'; git $a")).deny).toContain('git push to main')
    expect((await bash($, "g=gh; $g pr merge 4")).deny).toBe(DENY_INTEGRATION)
    // Quoted, the value stays one word: git is asked for no such subcommand, and the guard refuses what it cannot read.
    expect((await bash($, "a='push origin agt/x:main'; git \"$a\"")).deny).toContain('git runs a subcommand the guard cannot read')
    // Unset, a substitution, or a variable from the session: refused below auto.
    for (const line of ['$c', '$GIT push origin agt/x', '"$NODE" tools/x.js', '$(which git) push origin agt/x', '`printf git` status']) {
      expect([line, (await bash($, line)).deny]).toEqual([line, expect.stringContaining('a program the guard cannot read')])
    }
    // Resolved to something harmless, it runs; $HOME is the session's home.
    expect((await bash($, "c='git status --short'; $c")).result).toBe('ok')
    expect((await bash($, "t=echo; $t hi")).result).toBe('ok')
    expect((await bash($, '$HOME/bin/tool --help')).result).toBe('ok')
    expect(ran).toEqual(["c='git status --short'; $c", 't=echo; $t hi', '$HOME/bin/tool --help'])
  })

  test('commandSteps splits only unquoted expansions, and never an assignment', () => {
    const steps = commandSteps("D='a b'; cd \"$D\" && x=\"$D\" git push origin \"$D\"", '/w', 0, ['/h'])
    expect(steps.find((s: any) => s.kind === 'push')?.push.specs).toEqual(['a b'])
    expect(splitCommands("c='git push origin x'; $c")).toEqual([['git', 'push', 'origin', 'x']])
    expect(splitCommands("c='git push origin x'; \"$c\"")).toEqual([['git push origin x']])
  })
})

describe('guard: with no profile the run is held to the default', () => {
  test('a profile written mid-run cannot lift a run that started with none', async () => {
    seed(Profile, { home: '/h' })
    let profile: string | null = null
    const host: any = {
      fs: { read: async (p: string) => { if (p === '/h/.agentille/profile.json' && profile) return profile; throw new Error('ENOENT') }, stat: async () => { throw new Error('ENOENT') }, list: async () => [] },
      process: { run: async () => ({ exitCode: 1, stdout: '', stderr: '' }) },
      env: { get: async () => null },
    }
    try {
      await loadRunProfile(host)
      profile = JSON.stringify({ integration: 'auto' })
      expect(await judge(host, 'gh pr merge 3', '/w/app')).toBe(DENY_INTEGRATION)
      expect(DEFAULT_PROFILE.integration).toBe('pr')
      // A run that started with auto keeps it.
      await loadRunProfile(host)
      expect(await judge(host, 'gh pr merge 3', '/w/app')).toBe(null)
    } finally {
      setRunProfile(null)
    }
  })

  test('the profile and run state are refused however the folder above them is spelled', async () => {
    for (const line of ['echo x > $H/.agentille/profile.json', 'cp p.json /tmp/x/.agentille/state/lead-1.panes', 'tee ../../.agentille/profile.json < p']) {
      expect([line, integrationIn(line, onSlice)]).toEqual([line, expect.any(String)])
    }
    expect(integrationIn('echo x > notes/agentille.md', onSlice)).toBe(null)
  })
})

describe('guard: a cp link, or interpreter code that links, is judged by its source', () => {
  test('cp -l, -s, -al and --link of the trust root or git state are refused; a plain copy of them is not', async () => {
    for (const line of [
      'cp -l ~/.agentille/profile.json p.json',
      'cp --link "$HOME/.agentille/profile.json" p.json',
      'cp -al ~/.agentille snap',
      'cp -s ~/.agentille/profile.json p.json',
      'cp --symbolic-link .git/config cfg',
      'cp -l .git/hooks/pre-push h',
      'link ~/.agentille/profile.json p.json',
      'link .git/config cfg',
      "python3 -c \"import os; os.link(os.path.expanduser('~/.agentille'), 'x')\"",
      "node -e \"require('fs').symlinkSync(require('os').homedir() + '/.agentille', 'x')\"",
      "perl -e 'link(\"$ENV{HOME}/.agentille/profile.json\", \"p\")'",
    ]) expect([line, integrationIn(line, onSlice)]).toEqual([line, expect.any(String)])
    for (const line of ['cp ~/.agentille/profile.json backup.json', 'cp -a src dst', 'cp -c -R node_modules wt/', 'cp -L a b']) expect([line, integrationIn(line, onSlice)]).toEqual([line, null])
  })

  test('in the mod: the hard link is refused, so the later write lands on a plain file', async ($, on) => {
    const { ran } = setup(on, { profile: { integration: 'pr' } })
    await boot($)
    await typed($)
    expect((await bash($, 'cp -l ~/.agentille/profile.json p.json')).deny).toContain('may not write ~/.agentille (through cp)')
    expect(ran).toEqual([])
  })
})

describe('guard: settings, git and gh config, HEAD and linked-worktree state are protected', () => {
  test('a redirect, append, tee, cp, install, dd or interpreter write to them is refused', async () => {
    seed(Profile, { home: '/h' })
    for (const line of [
      'echo x > ~/.claude/settings.json',
      'printf x > "$HOME/.claude/settings.local.json"',
      'echo x > .claude/settings.json',
      'cp s.json /work/repo/.claude/settings.local.json',
      'echo "[alias] p = push" >> ~/.gitconfig',
      'tee -a /h/.gitconfig < a',
      'echo x > $XDG_CONFIG_HOME/git/config',
      'echo x > ~/.config/git/attributes',
      'install -m 644 a ~/.config/gh/config.yml',
      'dd if=a of=/h/.config/gh/hosts.yml',
      'echo ref > .git/HEAD',
      'echo x >> .git/config.worktree',
      'echo x > .git/worktrees/wt/HEAD',
      'sed -i s/a/b/ .git/worktrees/wt/config.worktree',
      "python3 -c \"open('/h/.claude/settings.json','w').write('{}')\"",
      "node -e \"require('fs').appendFileSync(require('os').homedir() + '/.gitconfig', 'x')\"",
    ]) expect([line, integrationIn(line, onSlice)]).toEqual([line, expect.any(String)])
    for (const line of ['echo x > docs/settings.json', 'cat .git/HEAD', 'echo x > notes/gitconfig.md', 'cp a .claude/notes.md']) expect([line, integrationIn(line, onSlice)]).toEqual([line, null])
  })

  test('the Write and Edit tools are refused the same files', async ($, on) => {
    setup(on, { profile: { integration: 'pr' } })
    await boot($)
    await typed($)
    for (const p of ['/h/.claude/settings.json', '/h/.claude/settings.local.json', '/work/repo/.claude/settings.json', '/h/.gitconfig', '/h/.config/gh/config.yml', '/work/repo/.git/HEAD', '/work/repo/.git/worktrees/x/config.worktree']) {
      expect([p, (await $.tool.call({ tool: 'Write', file_path: p, content: 'x' } as never))?.deny]).toEqual([p, expect.stringContaining('may not write')])
    }
    expect((await $.tool.call({ tool: 'Write', file_path: '/work/repo/src/settings.json', content: 'x' } as never))?.deny).toBeUndefined()
  })
})

describe('guard: variables that make git run a program', () => {
  test('an external diff, ssh, askpass, pager, editor, exec path or config file on a git line is refused; a harmless one is not', async () => {
    for (const line of [
      "GIT_EXTERNAL_DIFF='git push origin agt/x:main;:' git diff",
      "GIT_SSH_COMMAND='sh -c x' git fetch",
      "GIT_SSH_COMMAND='ssh -o ProxyCommand=x' git fetch",
      'GIT_SSH=./s git fetch',
      'GIT_ASKPASS=./a git push origin agt/x',
      'GIT_EDITOR=./e.sh git commit',
      'GIT_SEQUENCE_EDITOR=./e git rebase -i HEAD~2',
      "GIT_PAGER='sh x' git log",
      'EDITOR=./e git commit',
      'GIT_EXEC_PATH=./bin git status',
      'GIT_TEMPLATE_DIR=./t git init x',
      'GIT_CONFIG_GLOBAL=./g.cfg git status',
      'export GIT_EXTERNAL_DIFF=./d; git diff',
    ]) expect([line, integrationIn(line, onSlice)]).toEqual([line, expect.stringContaining('on the line names a program or config git runs')])
    for (const line of [
      'GIT_EDITOR=true git rebase --continue',
      'GIT_PAGER=cat git log',
      'GIT_SEQUENCE_EDITOR=: git rebase -i HEAD~2',
      "GIT_SSH_COMMAND='ssh -i /k/id -o StrictHostKeyChecking=no' git push origin agt/x",
      'GIT_CONFIG_GLOBAL=/dev/null git status',
      'GIT_EXTERNAL_DIFF=./d echo not git',
    ]) expect([line, integrationIn(line, onSlice)]).toEqual([line, null])
  })
})

describe('guard: the hooks folder the repo sets is protected like .git/hooks', () => {
  test('with core.hooksPath set, a Write, Edit or Bash write into that folder is refused; the folder next to it is not', async ($, on) => {
    const { ran } = setup(on, { profile: { integration: 'pr' }, hooksPath: '/work/repo/.husky' })
    await boot($)
    await typed($)
    expect((await $.tool.call({ tool: 'Write', file_path: '/work/repo/.husky/post-commit', content: 'git push origin agt/x:main' } as never)).deny).toContain('core.hooksPath')
    expect((await $.tool.call({ tool: 'Edit', file_path: '/work/repo/.husky/pre-push', old_string: 'a', new_string: 'b' } as never)).deny).toContain('core.hooksPath')
    expect((await bash($, "printf 'git push origin agt/x:main' > .husky/prepare-commit-msg")).deny).toContain('core.hooksPath')
    expect((await bash($, 'cp hook /work/repo/.HUSKY/pre-commit')).deny).toContain('core.hooksPath')
    expect((await $.tool.call({ tool: 'Write', file_path: '/work/repo/.husky-notes.md', content: 'x' } as never))?.deny).toBeUndefined()
    expect((await bash($, 'echo x > tools/hook.md')).result).toBe('ok')
    expect(ran.filter(Boolean)).toEqual(['echo x > tools/hook.md'])
  })
})

describe('guard: the run pushes only branches it made or that are new', () => {
  test('an own-prefix branch the remote already has, not checked out and not the run\'s, is refused', async ($, on) => {
    const { ran } = setup(on, { profile: { integration: 'pr' }, originHead: 'main', repos: { '/work/repo': { current: 'agt/x' } }, remoteHeads: ['feat/other', 'fix/theirs', 'agt/x'] })
    await boot($)
    await typed($)
    expect((await bash($, 'git push origin agt/x:feat/other')).deny).toContain('a branch the remote already has that this run did not make')
    expect((await bash($, 'git push origin HEAD:fix/theirs')).deny).toContain('fix/theirs')
    // The branch checked out, a new branch, and the run's own: allowed.
    expect((await bash($, 'git push -u origin agt/x')).result).toBe('ok')
    expect((await bash($, 'git push origin agt/x:feat/brand-new')).result).toBe('ok')
    expect(ran).toEqual(['git push -u origin agt/x', 'git push origin agt/x:feat/brand-new'])
  })

  test('a branch one of the run\'s worktrees was made on stays its own after the first push', async ($, on) => {
    const { ran } = setup(on, { profile: { integration: 'pr' }, remoteHeads: ['agt/x'] })
    await boot($)
    await typed($)
    expect((await bash($, 'git worktree add ../repo-x -b agt/x')).result).toBe('ok')
    expect((await bash($, 'git push origin agt/x')).result).toBe('ok')
    expect(ran).toEqual(['git worktree add ../repo-x -b agt/x', 'git push origin agt/x'])
  })

  test('judgePush hands the branch checked out and an own-prefix branch to the caller, saying which is which', () => {
    const claims: unknown[] = []
    expect(judgePush({ remote: 'origin', specs: ['agt/x:feat/y'], force: false, del: false, bulk: null, dry: false, mergeOpt: false } as any, { current: 'agt/x', claim: (n: string, cur: boolean) => claims.push([n, cur]) } as any)).toBe(null)
    expect(judgePush({ remote: 'origin', specs: ['feat/z'], force: false, del: false, bulk: null, dry: false, mergeOpt: false } as any, { current: 'feat/z', claim: (n: string, cur: boolean) => claims.push([n, cur]) } as any)).toBe(null)
    // A base-like branch is refused checked out or not: develop, when the guard read it as the base.
    expect(judgePush({ remote: 'origin', specs: ['develop'], force: false, del: false, bulk: null, dry: false, mergeOpt: false } as any, { current: 'develop', bases: new Set(['main', 'master', 'develop']), claim: (n: string) => claims.push(n) } as any)).toBe('git push to develop')
    expect(claims).toEqual([['feat/y', false], ['feat/z', true]])
  })
})

describe('guard: the run\'s own branches and the base-like ones', () => {
  test('the branch checked out at /agt is pushed as itself, but nothing is merged into it below auto', async ($, on) => {
    const { ran } = setup(on, { profile: { integration: 'pr' }, originHead: 'main', repos: { '/work/repo': { current: 'feat/big' } }, remoteHeads: ['main', 'feat/big', 'feat/other'] })
    await boot($)
    await typed($)
    expect((await bash($, 'git push origin feat/big')).result).toBe('ok')
    expect((await bash($, 'git push')).result).toBe('ok')
    const m = await bash($, 'git merge --no-ff agt/slice && git push origin feat/big')
    expect(m.deny).toContain('a merge into feat/big, a branch this run did not make')
    expect((await bash($, 'git merge agt/slice')).deny).toContain('a merge into feat/big')
    expect((await bash($, 'git pull origin agt/slice')).deny).toContain('a merge into feat/big')
    // Catching up with its own upstream is no integration.
    expect((await bash($, 'git merge --ff-only origin/feat/big')).result).toBe('ok')
    expect((await bash($, 'git pull --ff-only')).result).toBe('ok')
    // Another branch the remote has, checked out later: not the run's.
    expect((await bash($, 'git checkout feat/other && git push origin feat/other')).deny).toContain('a branch the remote already has that this run did not make')
    expect(ran).toEqual(['git push origin feat/big', 'git push', 'git merge --ff-only origin/feat/big', 'git pull --ff-only'])
  })

  test('under local nothing leaves the machine: the merge into the checkout is the local flow', async ($, on) => {
    const { ran } = setup(on, { profile: { integration: 'local' }, originHead: 'main', repos: { '/work/repo': { current: 'feat/big' } }, remoteHeads: ['main', 'feat/big'] })
    await boot($)
    await typed($)
    expect((await bash($, 'git merge --no-ff agt/slice')).result).toBe('ok')
    expect((await bash($, 'git push origin feat/big')).deny).toBe(DENY_LOCAL)
    expect(ran).toEqual(['git merge --no-ff agt/slice'])
  })

  test('a branch the run created on the remote stays its own: pushed again, and merged into', async ($, on) => {
    const heads = ['main']
    const { ran } = setup(on, { profile: { integration: 'pr' }, originHead: 'main', repos: { '/work/repo': { current: 'feat/slug' } }, remoteHeads: heads })
    await boot($)
    await typed($)
    expect((await bash($, 'git push -u origin feat/slug')).result).toBe('ok')
    heads.push('feat/slug') // the remote has it now
    expect((await bash($, 'git push origin feat/slug')).result).toBe('ok')
    expect((await bash($, 'git merge --no-ff agt/two && git push')).result).toBe('ok')
    expect(ran).toEqual(['git push -u origin feat/slug', 'git push origin feat/slug', 'git merge --no-ff agt/two && git push'])
  })

  test('with no origin/HEAD every branch the remote has that the run did not make is base-like; agt/* never is', async ($, on) => {
    const { ran } = setup(on, { profile: { integration: 'pr' }, repos: { '/work/repo': { current: 'develop' }, '/work/repo-x': { current: 'agt/x' } }, remoteHeads: ['develop', 'agt/x'] })
    await boot($)
    await typed($)
    expect((await bash($, 'git push origin develop')).deny).toContain('git push to develop')
    expect((await bash($, 'git merge agt/x')).deny).toContain('the base branch develop')
    expect((await bash($, 'cd /work/repo-x && git push origin agt/x')).result).toBe('ok')
    expect(ran).toEqual(['cd /work/repo-x && git push origin agt/x'])
  })

  test('the upstream of the branch checked out is base-like when it names another branch', async ($, on) => {
    const { ran } = setup(on, { profile: { integration: 'pr' }, originHead: 'main', repos: { '/work/repo': { current: 'feat/slug', tracking: 'origin/develop' } }, remoteHeads: ['main', 'develop'] })
    await boot($)
    await typed($)
    expect((await bash($, 'git push origin HEAD:develop')).deny).toContain('git push to develop')
    expect((await bash($, 'git push -u origin feat/slug')).result).toBe('ok')
    expect(ran).toEqual(['git push -u origin feat/slug'])
  })
})

describe('guard: lifecycle scripts are read before install, pack and version run them', () => {
  const pkg = (scripts: Record<string, string>) => ({ '/work/repo/package.json': JSON.stringify({ name: 'p', version: '1.0.0', scripts }) })

  test('a lifecycle script that pushes refuses the command that runs it', async ($, on) => {
    setup(on, { files: pkg({ postversion: 'git push && git push --tags', postinstall: 'git push origin HEAD:main', prepack: 'gh release create v1', prepare: 'sh tools/ship.sh' }), repos: { '/work/repo': { current: 'agt/x' } } })
    await boot($)
    await typed($)
    expect((await bash($, 'npm version minor')).deny).toContain('npm version minor (its postversion script) runs a package script that calls git push')
    for (const line of ['npm install', 'npm i', 'npm ci', 'pnpm install', 'pnpm add left-pad', 'yarn', 'yarn add x', 'bun install', 'npm rebuild', 'npm it', 'npm pack', 'bun pm pack']) {
      expect([line, (await bash($, line)).deny]).toEqual([line, expect.stringContaining('script')])
    }
  })

  test('npm version tags as git tag does; --ignore-scripts and a package with no scripts run', async ($, on) => {
    const { ran } = setup(on, { files: pkg({ prepare: 'husky', test: 'vitest run' }), repos: { '/work/repo': { current: 'agt/x' } } })
    await boot($)
    await typed($)
    expect((await bash($, 'npm version patch')).deny).toBe(DENY_INTEGRATION)
    expect((await bash($, 'npm version patch --no-git-tag-version')).result).toBe('ok')
    expect((await bash($, 'npm ci')).result).toBe('ok')
    expect((await bash($, 'npm install --ignore-scripts')).result).toBe('ok')
    expect((await bash($, 'npm version')).result).toBe('ok')
    expect(ran).toEqual(['npm version patch --no-git-tag-version', 'npm ci', 'npm install --ignore-scripts', 'npm version'])
  })

  test('a lifecycle run in another package folder, or a package.json that does not parse, refuses', async ($, on) => {
    setup(on, { files: { '/work/repo/package.json': '{ not json' }, repos: { '/work/repo': { current: 'agt/x' } } })
    await boot($)
    await typed($)
    expect((await bash($, 'npm ci')).deny).toContain('cannot read')
    expect((await bash($, 'npm --prefix ../other ci')).deny).toContain('another package folder')
  })
})

describe('guard: push.followTags makes a branch push a tag push', () => {
  test('a push that carries an annotated tag the remote lacks is refused; one it has, or no followTags, is not', async ($, on) => {
    const { ran } = setup(on, { profile: { integration: 'pr' }, followTags: true, tags: ['v1.0.0', 'v1.1.0'], remoteTags: ['v1.0.0'], repos: { '/work/repo': { current: 'agt/x' } } })
    await boot($)
    await typed($)
    expect((await bash($, 'git push -u origin agt/x')).deny).toContain('push.followTags carries v1.1.0')
    expect((await bash($, 'git push')).deny).toContain('push.followTags carries v1.1.0')
    expect((await bash($, 'git push --no-follow-tags origin agt/x')).result).toBe('ok')
    expect(ran).toEqual(['git push --no-follow-tags origin agt/x'])
  })

  test('every tag already on the remote, or followTags unset: the branch push goes', async ($, on) => {
    const { ran } = setup(on, { profile: { integration: 'pr' }, followTags: true, tags: ['v1.0.0'], remoteTags: ['v1.0.0'], repos: { '/work/repo': { current: 'agt/x' } } })
    await boot($)
    await typed($)
    expect((await bash($, 'git push -u origin agt/x')).result).toBe('ok')
    expect(ran).toEqual(['git push -u origin agt/x'])
  })

  test('setting push.followTags is a protected config write, by git config, -c or the environment', () => {
    for (const line of ['git config push.followTags true', 'git config --global push.followtags true', 'git -c push.followTags=true push origin agt/x', "GIT_CONFIG_PARAMETERS=\"'push.followTags'='true'\" git push origin agt/x", 'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=push.followTags GIT_CONFIG_VALUE_0=true git push origin agt/x']) {
      expect([line, integrationIn(line, onSlice)]).toEqual([line, expect.stringContaining('git config key')])
    }
  })
})

describe('guard: a tag named like a branch is a tag push', () => {
  test('git push origin <name> where refs/tags/<name> exists is refused; a branch of that name alone is not', async ($, on) => {
    const { ran } = setup(on, { profile: { integration: 'pr' }, localTags: ['feat/rel', 'v2'], repos: { '/work/repo': { current: 'agt/x' } } })
    await boot($)
    await typed($)
    expect((await bash($, 'git push origin feat/rel')).deny).toContain('git push <tag> (feat/rel names a tag)')
    expect((await bash($, 'git push origin v2:feat/new')).deny).toContain('v2 names a tag')
    expect((await bash($, 'git push origin feat/other')).result).toBe('ok')
    expect(ran).toEqual(['git push origin feat/other'])
  })
})

describe('guard: --force-with-lease on the run\'s own agt/* branch', () => {
  test('allowed on the slice branch checked out or one the run made; refused on any other, and plain --force stays refused', async ($, on) => {
    const { ran } = setup(on, { profile: { integration: 'pr' }, originHead: 'main', remoteHeads: ['agt/x', 'agt/other', 'agt/made'], repos: { '/work/repo-x': { current: 'agt/x' } } })
    await boot($)
    await typed($)
    expect((await bash($, 'cd /work/repo-x && git push --force-with-lease origin agt/x')).result).toBe('ok')
    expect((await bash($, 'cd /work/repo-x && git push --force-with-lease=agt/x --force-if-includes origin HEAD')).result).toBe('ok')
    // From the main checkout, agt/x is not checked out: it is the run's because one of its worktrees was made on it.
    expect((await bash($, 'git push --force-with-lease origin agt/x')).deny).toContain('an agt/* branch this run did not make')
    expect((await bash($, 'git worktree add ../repo-x -b agt/x')).result).toBe('ok')
    expect((await bash($, 'git push --force-with-lease origin agt/x')).result).toBe('ok')
    expect((await bash($, 'git push --force-with-lease origin agt/other')).deny).toContain('an agt/* branch this run did not make')
    expect((await bash($, 'cd /work/repo-x && git push --force origin agt/x')).deny).toContain('git push --force')
    expect((await bash($, 'cd /work/repo-x && git push --force-with-lease=main origin agt/x')).deny).toContain('not an agt/* branch of this run')
    expect(ran).toEqual(['cd /work/repo-x && git push --force-with-lease origin agt/x', 'cd /work/repo-x && git push --force-with-lease=agt/x --force-if-includes origin HEAD', 'git worktree add ../repo-x -b agt/x', 'git push --force-with-lease origin agt/x'])
  })
})

describe('guard: publish, deploy and destructive repo changes are auto only', () => {
  const PUB = ['npm publish', 'pnpm publish --access public', 'yarn npm publish', 'bun publish', 'npm dist-tag add p@1.2.0 latest', 'npm unpublish p@1.0.0',
    'cargo publish', 'twine upload dist/*', 'python3 -m twine upload dist/*', 'gem push p.gem', 'docker push img:1', 'docker image push img', 'podman push img',
    'docker buildx build --push -t img .', 'vercel --prod', 'vercel deploy --prod', 'railway up', 'fly deploy', 'flyctl deploy', 'release-it', 'semantic-release',
    'changeset publish', 'lerna publish', 'gh repo delete o/r --yes', 'gh repo archive o/r', 'gh repo rename x', 'gh secret set TOKEN', 'gh secret delete TOKEN',
    'gh variable set V --body 1', 'gh ruleset create', 'gh api -X PUT repos/o/r/collaborators/bot', 'gh api -X PATCH repos/o/r -F allow_auto_merge=true',
    'gh api -X PATCH repos/o/r -f delete_branch_on_merge=true', 'gh api -X DELETE repos/o/r', 'gh api -X PUT repos/o/r/actions/secrets/X -f encrypted_value=v',
    'curl -X DELETE https://api.github.com/repos/o/r', 'curl -X PUT https://api.github.com/repos/o/r/collaborators/bot']

  test('each is refused below auto; the reads beside them are not', () => {
    for (const line of PUB) expect([line, integrationIn(line, onSlice)]).toEqual([line, expect.any(String)])
    for (const line of ['npm dist-tag ls', 'npm pack --dry-run', 'docker build -t img .', 'vercel', 'vercel deploy', 'railway logs', 'fly status', 'gh repo view',
      'gh secret list', 'gh variable list', 'gh ruleset list', 'gh ruleset view 3', 'cargo build', 'gh api repos/o/r', 'changeset version', 'npm run publish-docs']) {
      expect([line, integrationIn(line, onSlice)]).toEqual([line, null])
    }
  })

  test('in the mod the deny says publish needs auto or the person; a package script or recipe that publishes refuses too', async ($, on) => {
    const { ran } = setup(on, { profile: { integration: 'pr' }, files: { '/work/repo/package.json': JSON.stringify({ name: 'p', scripts: { release: 'release-it', ship: 'npm run build && npm publish', wf: 'gh workflow run deploy.yml', build: 'tsc' } }) } })
    await boot($)
    await typed($)
    const d = await bash($, 'npm publish')
    expect(d.deny).toContain(DENY_PUBLISH)
    expect(d.deny).toContain('needs integration auto, or the person runs it')
    expect((await bash($, 'railway up --service web')).deny).toContain('railway up')
    expect((await bash($, 'npm run release')).deny).toContain('runs release-it (a release tool')
    expect((await bash($, 'npm run ship')).deny).toContain('runs npm publish')
    expect((await bash($, 'npm run wf')).deny).toContain('runs gh workflow run')
    expect((await bash($, 'npm run build')).result).toBe('ok')
    expect(ran).toEqual(['npm run build'])
  })

  test('under auto they run', async ($, on) => {
    const { ran } = setup(on, { profile: { projects: [{ id: 'repo', integration: 'auto' }] } })
    await boot($)
    await typed($)
    expect((await bash($, 'npm publish')).result).toBe('ok')
    expect((await bash($, 'gh secret set X --body y')).result).toBe('ok')
    expect(ran).toEqual(['npm publish', 'gh secret set X --body y'])
  })
})

describe('guard: recipes, local bins, test files and Python imports are followed', () => {
  const files = {
    '/work/repo/Makefile': 'SHIP = ./bin/ship\ngo:\n\t@$(SHIP) --now\nbuild:\n\t./bin/tool\nsub:\n\t$(MAKE) -C /work/repo go\nok:\n\t-echo fine && $(CC) -o x x.c\n',
    '/work/repo/bin/ship': '#!/bin/sh\ngit push origin HEAD:main\n',
    '/work/repo/bin/tool': '\u0000ELF binary',
    '/work/repo/package.json': JSON.stringify({ name: 'p', scripts: { thing: 'node_modules/.bin/thing --go', npmbin: '$(npm bin)/thing', test: 'vitest run', prepare: 'husky' } }),
    '/work/repo/node_modules/.bin/thing': "#!/usr/bin/env node\nimport '../thing/lib/cli.js'\n",
    '/work/repo/node_modules/thing/lib/cli.js': "require('child_process').execSync('git push origin HEAD:main')\n",
    '/work/repo/run.py': 'import os\nimport pusher\npusher.go()\n',
    '/work/repo/pusher.py': 'import subprocess\ndef go():\n    subprocess.run(["git", "push", "origin", "HEAD:main"])\n',
    '/work/repo/fine.py': 'import os, json\nfrom pathlib import Path\nprint(1)\n',
  }

  test('a make recipe is followed into the scripts and bins it runs; one that is no readable script refuses', async ($, on) => {
    const { ran } = setup(on, { files })
    await boot($)
    await typed($)
    expect((await bash($, 'make go')).deny).toContain('./bin/ship runs a script that calls git push')
    expect((await bash($, 'make sub')).deny).toContain('./bin/ship runs a script that calls git push')
    expect((await bash($, 'make build')).deny).toContain('the guard cannot read')
    expect((await bash($, 'make ok')).result).toBe('ok')
    expect(ran).toEqual(['make ok'])
  })

  test('a local bin a package script names is read where it lands, with its own package\'s imports', async ($, on) => {
    const { ran } = setup(on, { files })
    await boot($)
    await typed($)
    expect((await bash($, 'npm run thing')).deny).toContain('imports ../thing/lib/cli.js, which calls git push')
    expect((await bash($, 'npm run npmbin')).deny).toContain('imports ../thing/lib/cli.js')
    // A bare program word is an installed program: not read (vitest, husky).
    expect((await bash($, 'npm test')).result).toBe('ok')
    expect((await bash($, 'npm ci')).result).toBe('ok')
    expect(ran).toEqual(['npm test', 'npm ci'])
  })

  test('python3 <file> reads the modules beside it that the file imports, one level deep', async ($, on) => {
    const { ran } = setup(on, { files })
    await boot($)
    await typed($)
    expect((await bash($, 'python3 run.py')).deny).toContain('run.py imports pusher, which calls git push')
    expect((await bash($, 'python3 fine.py')).result).toBe('ok')
    expect(ran).toEqual(['python3 fine.py'])
  })

  test('node --test reads the files it runs: given, or found by node\'s own patterns', async () => {
    seed(Profile, { home: '/h' })
    const tree: Record<string, string> = {
      '/w/app/package.json': JSON.stringify({ scripts: { test: 'node --test', some: 'node --test "test/*.test.mjs"', one: 'node --test test/ok.test.mjs' } }),
      '/w/app/test/pusher.test.mjs': "import { ship } from './helpers/ship.mjs'\nship()\n",
      '/w/app/test/helpers/ship.mjs': "export const ship = () => require('child_process').execSync('git push origin HEAD:main')\n",
      '/w/app/test/ok.test.mjs': "import assert from 'node:assert'\nassert.ok(1)\n",
      '/w/app/src/index.js': 'export const x = 1\n',
    }
    const dirs = new Set<string>()
    for (const f of Object.keys(tree)) for (let d = f.slice(0, f.lastIndexOf('/')); d; d = d.slice(0, d.lastIndexOf('/'))) dirs.add(d)
    const host: any = {
      fs: {
        read: async (p: string) => { if (p in tree) return tree[p]; throw new Error('ENOENT') },
        stat: async (p: string) => { if (p in tree) return { kind: 'file' }; if (dirs.has(p)) return { kind: 'dir' }; throw new Error('ENOENT') },
        list: async (d: string) => { if (!dirs.has(d)) throw new Error('ENOENT'); const out = new Map<string, string>(); for (const f of Object.keys(tree)) if (f.startsWith(d + '/')) { const n = f.slice(d.length + 1).split('/'); out.set(n[0], n.length > 1 ? 'dir' : 'file') } return [...out].map(([name, kind]) => ({ name, kind })) },
      },
      process: { run: async () => ({ exitCode: 1, stdout: '', stderr: '' }) },
      env: { get: async () => null },
    }
    expect(await judge(host, 'npm test', '/w/app')).toContain('imports ./helpers/ship.mjs, which calls git push')
    expect(await judge(host, 'npm run some', '/w/app')).toContain('pusher.test.mjs')
    expect(await judge(host, 'node --test', '/w/app')).toContain('imports ./helpers/ship.mjs')
    expect(await judge(host, 'npm run one', '/w/app')).toBe(null)
    expect(await judge(host, 'node --test test/ok.test.mjs', '/w/app')).toBe(null)
  })
})

describe('guard: GitHub writes past merges, releases and refs', () => {
  test('an approval, an auto-merge label, repo sync, a repository dispatch and httpie writes are steps', async () => {
    for (const line of [
      'gh pr review --approve 4',
      'gh pr review -a 4',
      'gh pr review 4 --approve --body ok',
      'gh pr edit 4 --add-label automerge',
      'gh pr edit 4 --add-label bug,auto-merge',
      'gh pr edit 4 --add-label=Auto-Merge',
      'gh repo sync',
      'gh repo sync o/fork -b main',
      'gh api -X POST repos/o/r/dispatches -f event_type=ship',
      'curl -X POST -d \'{"event_type":"ship"}\' https://api.github.com/repos/o/r/dispatches',
      'http PUT api.github.com/repos/o/r/pulls/4/merge',
      'https PUT https://api.github.com/repos/o/r/pulls/4/merge merge_method=merge',
      'xh POST https://api.github.com/repos/o/r/releases tag_name=v1',
      'xhs api.github.com/repos/o/r/git/refs sha=abc ref=refs/heads/main',
      "http POST api.github.com/graphql query='mutation { mergePullRequest(input: {}) { clientMutationId } }'",
    ]) expect([line, integrationIn(line, onSlice)]).toEqual([line, expect.any(String)])
    for (const line of [
      'gh pr review --comment -b ok 4',
      'gh pr review --request-changes -b fix 4',
      'gh pr edit 4 --add-label bug',
      'http api.github.com/repos/o/r/pulls',
      'http GET api.github.com/repos/o/r/pulls/4/merge',
      'xh https://api.github.com/repos/o/r per_page==5',
      'http POST localhost:3000/api/items name=x',
    ]) expect([line, integrationIn(line, onSlice)]).toEqual([line, null])
  })

  test('a gh alias is read from gh\'s config and its expansion judged; an unreadable config refuses', async ($, on) => {
    const cfg = "version: '1'\naliases:\n    co: pr checkout\n    pm: pr merge\n    ship: '!gh pr merge \"$1\" --squash'\n    lsx: |\n        pr list\ngit_protocol: https\n"
    const { ran } = setup(on, { profile: { integration: 'pr' }, files: { '/h/.config/gh/config.yml': cfg } })
    await boot($)
    await typed($)
    expect((await bash($, 'gh pm 4')).deny).toBe(DENY_INTEGRATION)
    expect((await bash($, 'gh ship 4')).deny).toBe(DENY_INTEGRATION)
    expect((await bash($, 'GH_CONFIG_DIR=cfg gh pm 4')).deny).toContain('cannot place')
    expect((await bash($, 'gh co 4')).result).toBe('ok')
    expect((await bash($, 'gh lsx')).result).toBe('ok')
    expect((await bash($, 'gh dash')).result).toBe('ok')
    expect(ran).toEqual(['gh co 4', 'gh lsx', 'gh dash'])
  })

  test('ghAliases reads the aliases map, and refuses a shape it cannot read', () => {
    expect([...ghAliases("aliases:\n  co: pr checkout\n  'x': \"!gh pr merge\"\nother: 1\n")!]).toEqual([['co', 'pr checkout'], ['x', '!gh pr merge']])
    expect(ghAliases('git_protocol: https\n')!.size).toBe(0)
    expect(ghAliases('aliases: {}\n')!.size).toBe(0)
    expect(ghAliases('aliases: {co: pr checkout}\n')).toBe(null)
    expect(ghAliases('aliases:\n  - co\n')).toBe(null)
  })
})

describe('guard: the words passed to a script are read as a command', () => {
  test('an exec "$@" wrapper cannot carry a push, a merge or a protected write past the guard', async ($, on) => {
    const { ran } = setup(on, { files: { '/work/repo/run.sh': '#!/bin/sh\nexec "$@"\n' } })
    await boot($)
    await typed($)
    expect((await bash($, 'sh run.sh git push origin HEAD:main')).deny).toContain('git push to main')
    expect((await bash($, './run.sh gh pr merge 4')).deny).toBe(DENY_INTEGRATION)
    expect((await bash($, 'bash run.sh sh -c "gh pr merge 4"')).deny).toBe(DENY_INTEGRATION)
    expect((await bash($, 'sh run.sh npm test')).result).toBe('ok')
    expect((await bash($, './run.sh --fast')).result).toBe('ok')
    expect(ran).toEqual(['sh run.sh npm test', './run.sh --fast'])
  })
})
