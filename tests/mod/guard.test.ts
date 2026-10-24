import { describe, expect, mock, test } from 'claude-code/testing'
import { DENY_INTEGRATION, integrationIn, integrationOf, joinPath, newTrees, parseOwned, splitCommands, worktreeAdds } from '../../hooks/guard.js'
import { parseWorktrees } from '../../hooks/clean.js'

describe('guard: which commands integrate', () => {
  test('merge, tag and tag pushes are caught, wherever they sit in the line', async () => {
    for (const line of [
      'gh pr merge 12 --merge --delete-branch',
      'npm test && gh pr merge 12',
      'git tag v1.2.0',
      'git -C ../app tag -a v1.2.0 -m release',
      'git push --tags',
      'git push origin --follow-tags',
      'git push origin v3.21.0',
      'git push origin refs/tags/v3.21.0',
      'cd ../app; git tag v1.0.0 && git push origin v1.0.0',
      "bash -c 'gh pr merge 4'",
      'GH_TOKEN=x gh pr merge 4',
      'gh release create v1.0.0',
    ]) expect([line, integrationIn(line)]).toEqual([line, expect.any(String)])
  })

  test('branch pushes, PRs, tag listing and quoted text are left alone', async () => {
    for (const line of [
      'git push -u origin agt/filter',
      'git push origin feat/v1-ui',
      'gh pr create --base main --title x --body "then gh pr merge it"',
      'git commit -m "do not git push --tags here"',
      'git tag',
      'git tag -l "v*"',
      'git tag --list --sort=-v:refname',
      'git log --oneline v1.2.0..HEAD',
      'echo gh pr merge',
    ]) expect([line, integrationIn(line)]).toEqual([line, null])
  })

  test('the profile decides; a repo config lowers it and never raises it', async () => {
    expect(integrationOf(null, ['app'])).toBe('pr')
    expect(integrationOf({ integration: 'auto' }, ['app'])).toBe('auto')
    expect(integrationOf({ integration: 'auto', projects: [{ id: 'app', integration: 'pr' }] }, ['app'])).toBe('pr')
    expect(integrationOf({ projects: [{ name: 'My App', integration: 'auto' }] }, ['my-app'])).toBe('pr')
    expect(integrationOf({ projects: [{ id: 'my-app', integration: 'auto' }] }, ['My App'])).toBe('auto')
    expect(integrationOf({ integration: 'auto' }, ['app'], ['push'])).toBe('push')
    expect(integrationOf({ integration: 'pr' }, ['app'], ['auto'])).toBe('pr')
    expect(integrationOf({ integration: 'yes' }, ['app'])).toBe('pr')
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
const setup = (on: any, o: { profile?: unknown; repoConfig?: unknown; env?: Record<string, string> } = {}) => {
  const seen: string[][] = []
  const ran: string[] = []
  const git = { made: false, committed: false }
  const now = Date.now()
  const files: Record<string, string> = {}
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
  on('tool.call', async ($: any, e: any) => { ran.push(e.command); if (/worktree add/.test(e.command ?? '')) git.made = true; return { result: 'ok' } })
  on('process.run', async ($: any, e: any) => {
    seen.push(e.argv)
    const a = e.argv.join(' ')
    const out = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '' } })
    if (a === 'git -C /work/repo worktree list --porcelain') {
      return out([
        'worktree /work/repo', 'HEAD ' + (git.committed ? 'm2' : 'm1'), 'branch refs/heads/main', '',
        'worktree /work/repo-other', 'HEAD m1', 'branch refs/heads/agt/other', '',
        ...(git.made ? ['worktree /work/repo-x', 'HEAD ' + (git.committed ? 'x1' : 'm1'), 'branch refs/heads/agt/x', ''] : []),
      ].join('\n'))
    }
    if (a.includes('symbolic-ref')) return out('', 1)
    if (a.includes('branch --merged')) return out('agt/other\n' + (git.made ? 'agt/x\n' : ''))
    if (a === 'git -C /work/repo rev-parse HEAD') return out(git.committed ? 'm2\n' : 'm1\n')
    if (a.includes('branch --format')) return out('agt/other\n' + (git.made ? 'agt/x\n' : ''))
    if (a.includes('rev-parse --path-format=absolute --git-common-dir')) return out('/work/repo/.git\n')
    return out('')
  })
  mock.clock(on, { now: 1_000_000 })
  return { seen, ran, git }
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

  test('an agentille subagent stays guarded after the person moves on; the lead does not', async ($, on) => {
    setup(on)
    await boot($)
    await typed($)
    await $.agent.spawn({ prompt: '[agt run=gd1 size=small mode=build]\nbuild', subagentType: 'agentille:agentille-executor', model: 'sonnet' })
    await typed($, 'something else')
    expect((await bash($, 'gh pr merge 3', 'sub1')).deny).toBe(DENY_INTEGRATION)
    expect((await bash($, 'gh pr merge 3')).result).toBe('ok')
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
    expect(seen.some((a) => a.includes('clean'))).toBe(false)
    // The slice commits and merges; the run ends on its card.
    git.committed = true
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
