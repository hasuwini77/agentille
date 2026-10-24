import { describe, expect, test } from 'claude-code/testing'
import { cleanText, herdrOrphans, orphanPlan, parseWorktrees, staleTabs, tmuxOrphans, worktreePlan } from '../../hooks/clean.js'

const agent = (pane_id: string, tab_id: string, name: string | null, agent_status = 'idle') => ({ pane_id, tab_id, name, agent_status })

describe('clean: panes', () => {
  test('an agt pane in a live lead\'s tab or run tab is owned; one in a leaderless tab is an orphan', async () => {
    const list = [
      agent('w1:p1', 'w1:t1', null, 'working'),
      agent('w1:p2', 'w1:t1', 'agt-ab12cd-exec-1', 'done'),
      agent('w1:p5', 'w1:t3', 'agt-ab12cd-exec-2', 'idle'),
      agent('w1:p9', 'w1:t9', 'agt-dead00-exec-1', 'done'),
      agent('w1:p8', 'w1:t9', 'agt-dead00-exec-2', 'working'),
    ]
    const orphans = herdrOrphans(list, (id) => (id === 'w1:p1' ? ['w1:t3'] : []))
    expect(orphans.map((o) => o.id)).toEqual(['w1:p9', 'w1:p8'])
    const plan = orphanPlan(orphans)
    expect(plan.close.map((o) => o.name)).toEqual(['agt-dead00-exec-1'])
    expect(plan.keep).toEqual([{ what: 'agt-dead00-exec-2', why: 'working' }])
  })

  test('blocked and unknown panes are kept, dead ones close', async () => {
    const plan = orphanPlan([{ id: 'a', name: 'agt-x-a', state: 'blocked' }, { id: 'b', name: 'agt-x-b', state: 'dead' }, { id: 'c', name: 'agt-x-c', state: 'unknown' }])
    expect(plan.close.map((o) => o.id)).toEqual(['b'])
    expect(plan.keep.map((k) => k.why)).toEqual(['blocked', 'unknown'])
  })

  test('tmux: a window with a lead owns its workers; a leaderless one closes done or dead only', async () => {
    const rows = [
      { id: '%1', agt: '', window: '@1', dead: false },
      { id: '%2', agt: 'agt-r1-exec-1', window: '@1', dead: false },
      { id: '%3', agt: 'agt-r2-exec-1', window: '@2', dead: false },
      { id: '%4', agt: 'agt-r2-exec-2', window: '@2', dead: true },
      { id: '%5', agt: 'agt-r2-exec-3', window: '@2', dead: false },
    ]
    const o = tmuxOrphans(rows, (r: any) => r.id === '%3')
    expect(o.map((x) => [x.id, x.state])).toEqual([['%3', 'done'], ['%4', 'dead'], ['%5', 'working']])
  })

  test('stale tab files: only for leads not listed, never on an empty list', async () => {
    const key = (id: string) => id.replace(':', '-')
    expect(staleTabs(['w1-p1', 'w1-p7'], [agent('w1:p1', 't', null)], key)).toEqual(['w1-p7'])
    expect(staleTabs(['w1-p1'], [], key)).toEqual([])
    expect(staleTabs(['w1-p2'], [agent('w1:p2', 't', 'agt-r-x')], key)).toEqual(['w1-p2'])
  })
})

describe('clean: worktrees', () => {
  const porcelain = [
    'worktree /r/app', 'HEAD 1', 'branch refs/heads/main', '',
    'worktree /r/app-a', 'HEAD 2', 'branch refs/heads/agt/a', '',
    'worktree /r/app-b', 'HEAD 3', 'branch refs/heads/agt/b', '',
    'worktree /r/app-c', 'HEAD 4', 'branch refs/heads/agt/c', '',
    'worktree /r/app-f', 'HEAD 5', 'branch refs/heads/feat/x', '',
    'worktree /r/gone', 'HEAD 6', 'branch refs/heads/agt/g', 'prunable gitdir file points to non-existent location', '',
  ].join('\n')

  test('parses the porcelain list', async () => {
    const t = parseWorktrees(porcelain)
    expect(t.map((x) => x.branch)).toEqual(['main', 'agt/a', 'agt/b', 'agt/c', 'feat/x', 'agt/g'])
    expect(t[5].prunable).toBe(true)
    expect(t[1].head).toBe('2')
  })

  test('with no ownership nothing goes: every agt tree is kept as not opened by this session', async () => {
    const trees = parseWorktrees(porcelain)
    const plan = worktreePlan(trees, new Set(['agt/a', 'agt/z']), new Set(), ['agt/a', 'agt/z'])
    expect(plan.remove).toEqual([])
    expect(plan.deleteBranches).toEqual([])
    expect(plan.keep.map((k) => k.why)).toEqual(['not opened by this session', 'not opened by this session', 'not opened by this session'])
  })

  test('only owned trees and branches go; another session\'s merged tree stays and holds its branch', async () => {
    const trees = parseWorktrees(porcelain)
    const merged = new Set(['agt/a', 'agt/b', 'agt/z', 'agt/w'])
    const owned = (t: any) => t.path === '/r/app-a' || t.branch === 'agt/z'
    const plan = worktreePlan(trees, merged, new Set(), ['agt/a', 'agt/b', 'agt/z', 'agt/w'], { owned })
    expect(plan.remove.map((t) => t.path)).toEqual(['/r/app-a'])
    expect(plan.keep).toContainEqual({ what: 'agt/b', why: 'not opened by this session' })
    // agt/w is merged and loose, but nobody here opened it
    expect(plan.deleteBranches).toEqual(['agt/z'])
  })

  test('an owned merged tree with no commits of its own or made minutes ago stays, and so does its branch', async () => {
    const trees = parseWorktrees(porcelain)
    const merged = new Set(['agt/a', 'agt/b', 'agt/c'])
    const plan = worktreePlan(trees, merged, new Set(), ['agt/a', 'agt/b', 'agt/c'], { owned: () => true, empty: new Set(['/r/app-a']), fresh: new Set(['/r/app-a', '/r/app-b']) })
    expect(plan.remove.map((t) => t.path)).toEqual(['/r/app-c'])
    expect(plan.keep).toEqual([{ what: 'agt/a', why: 'no commits of its own' }, { what: 'agt/b', why: 'opened under 10 min ago' }])
    expect(plan.deleteBranches).toEqual(['agt/c'])
  })

  test('removes merged clean agt worktrees only, keeps unmerged and dirty, deletes merged loose branches', async () => {
    const trees = parseWorktrees(porcelain)
    const merged = new Set(['agt/a', 'agt/b', 'agt/z', 'agt/g'])
    const plan = worktreePlan(trees, merged, new Set(['/r/app-b']), ['agt/a', 'agt/b', 'agt/c', 'agt/z', 'agt/g', 'agt/y'], { owned: () => true })
    expect(plan.remove.map((t) => t.path)).toEqual(['/r/app-a'])
    expect(plan.keep).toEqual([{ what: 'agt/b', why: 'uncommitted changes' }, { what: 'agt/c', why: 'not merged' }])
    expect(plan.deleteBranches).toEqual(['agt/a', 'agt/z'])
    expect(plan.prune).toBe(true)
  })

  test('the main checkout is never touched', async () => {
    const trees = parseWorktrees('worktree /r/app\nbranch refs/heads/agt/main-ish\n')
    const plan = worktreePlan(trees, new Set(['agt/main-ish']), new Set(), ['agt/main-ish'], { owned: () => true })
    expect(plan.remove).toEqual([])
    expect(plan.deleteBranches).toEqual([])
  })
})

describe('clean: text', () => {
  test('one line of what went, one of what stayed', async () => {
    expect(cleanText({})).toBe('agt clean · workspace already clean')
    expect(cleanText({ closed: ['a', 'b'], branches: ['agt/a'], removed: ['agt/a'], tabs: 1 })).toBe('agt clean · 2 panes closed · 1 worktree removed · 1 branch deleted · 1 stale tab file dropped')
    expect(cleanText({ closed: ['a'], keep: [{ what: 'agt/c', why: 'not merged' }] })).toBe('agt clean · 1 pane closed\nkept: agt/c (not merged)')
    expect(cleanText({ runs: 3 })).toBe('agt clean · 3 old run folders dropped')
  })
})
