import { describe, expect, mock, test } from 'claude-code/testing'
import { DENY_INTEGRATION, DENY_LOCAL, DENY_PUSH, DENY_UNREAD, capsOf, integrationIn, integrationOf, joinPath, judgePush, newTrees, normSlug, normUrl, parseOwned, sameRepo, splitCommands, worktreeAdds } from '../../hooks/guard.js'
import { parseWorktrees } from '../../hooks/clean.js'

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

  test('pushes of the base branch, tags, every branch, a force or a variable are caught', async () => {
    for (const line of [
      'git push origin HEAD:main',
      'git push origin feat/x:main',
      'git push origin agt/x:refs/heads/main',
      'git push origin main',
      'git push origin master',
      'git push -f origin agt/x',
      'git push --force origin agt/x',
      'git push --force-with-lease origin agt/x',
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
      'git checkout main && git merge --ff-only agt/x && git push origin HEAD',
      'git switch main && git merge --ff-only agt/x && git push -u origin HEAD',
      'git checkout -q main; git push',
      'git branch -m main && git push origin HEAD',
      'git branch -M agt/x main; git push origin @',
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
    expect(sameRepo('github.com/me/app', 'me/app')).toBe(true)
    expect(sameRepo('github.com/me/app', 'github.com/other/app')).toBe(false)
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
type Repo = { current?: string; remote?: string; common?: string; pushurl?: string; upstream?: string }
const setup = (on: any, o: { profile?: unknown; repoConfig?: unknown; env?: Record<string, string>; files?: Record<string, string>; repos?: Record<string, Repo>; feat?: boolean; broken?: boolean } = {}) => {
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
    if (/worktree add.*agt\//.test(e.command ?? '')) git.made = true
    if (/worktree add.*feat\/f/.test(e.command ?? '')) git.feat = true
    return { result: 'ok' }
  })
  on('process.run', async ($: any, e: any) => {
    seen.push(e.argv)
    const a = e.argv.join(' ')
    if (o.broken && e.argv[0] === 'git' && !a.includes('worktree list')) return { deny: 'git could not be run' }
    const out = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '' } })
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
  test('a session where /agt was never typed keeps full Bash', async ($, on) => {
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

  test('a question typed mid-run keeps the lead and its subagent guarded', async ($, on) => {
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
    const main = await bash($, 'git merge --no-ff agt/x && git push origin main')
    expect(main.deny).toContain(DENY_PUSH)
    expect(main.deny).toContain('git push to main')
    expect((await bash($, 'git push')).deny).toContain('git push to main')
    expect((await bash($, 'git push --force-with-lease origin agt/x')).deny).toContain('--force')
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
    expect(seen.filter((a) => a.includes('clean')).map((a) => a.join(' '))).toEqual(['git -C /work/repo-x clean -fqx -- .env*'])
    // The slice commits and merges; the run ends on its card.
    git.committed = true
    seen.length = 0
    await card($)
    const sweep = seen.findIndex((a) => a.join(' ') === 'git -C /work/repo-x clean -fqx -- .env*')
    const removed = seen.findIndex((a) => a.join(' ') === 'git -C /work/repo worktree remove /work/repo-x')
    expect(sweep).toBeGreaterThan(-1)
    expect(removed).toBeGreaterThan(sweep)
    expect(seen).toContainEqual(['git', '-C', '/work/repo', 'branch', '-d', 'agt/x'])
    expect(seen.some((a) => a.includes('/work/repo-other') && (a.includes('remove') || a.includes('clean')))).toBe(false)
    expect(seen).not.toContainEqual(['git', '-C', '/work/repo', 'branch', '-d', 'agt/other'])
    // The main checkout's own .env is never swept.
    expect(seen.some((a) => a.join(' ') === 'git -C /work/repo clean -fqx -- .env*')).toBe(false)
  })

  test('the run-end sweep leaves an owned feat/* tree\'s .env alone; only agt/* trees are swept', async ($, on) => {
    const { seen, git } = setup(on)
    await boot($)
    await typed($)
    await bash($, 'git worktree add ../repo-x -b agt/x main && git worktree add ../repo-f -b feat/f main')
    git.committed = true
    await card($)
    expect(seen).toContainEqual(['git', '-C', '/work/repo-x', 'clean', '-fqx', '--', '.env*'])
    expect(seen.some((a) => a.includes('/work/repo-f') && a.includes('clean'))).toBe(false)
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
    expect((await bash($, 'npm test')).result).toBe('ok')
    expect(ran).toEqual(['npm test'])
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

  test('61 minutes into a run with its id named, after a typed question, a merge is still denied', async ($, on) => {
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

  test('a dispatch on a later turn names the run when the /agt turn did not', async ($, on) => {
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

  test('the card ends it, even on a turn the person typed after the run lapsed', async ($, on) => {
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
