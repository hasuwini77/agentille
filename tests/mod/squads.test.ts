import { describe, expect, mock, test } from 'claude-code/testing'
import { activeSquads, depsOf, explain, squadsText } from '../../hooks/squads.js'

const config = { squads: [
  { name: 'saas', label: 'Micro SaaS', minScore: 2, signals: { deps: ['stripe', 'next-auth'], paths: ['app/api/webhooks'] }, adds: ['payments-reviewer'], checklists: { 'security-reviewer': ['verify webhook signatures'] } },
  { name: 'content', label: 'Content', minScore: 2, signals: { deps: ['@next/mdx', 'contentlayer'], paths: ['content'] }, adds: ['seo-reviewer'], checklists: {} },
] }

describe('squads: explain', () => {
  test('an active squad lists what matched and what is missing', () => {
    const rows = explain(config, new Set(['stripe', 'next-auth']), new Set())
    expect(rows[0]).toEqual({ name: 'saas', label: 'Micro SaaS', score: 2, minScore: 2, matched: ['stripe', 'next-auth'], missing: ['app/api/webhooks'], adds: ['payments-reviewer'], active: true })
  })

  test('one signal short is a near-miss: inactive, score above zero', () => {
    const rows = explain(config, new Set(['stripe']), new Set(['content']))
    expect(rows.map((r) => [r.name, r.score, r.active])).toEqual([['saas', 1, false], ['content', 1, false]])
    expect(rows[1].missing).toEqual(['@next/mdx', 'contentlayer'])
  })

  test('nothing matches: every row scores 0 and is inactive', () => {
    const rows = explain(config, depsOf('{}'), new Set())
    expect(rows.every((r) => r.score === 0 && !r.active)).toBe(true)
    expect(explain(undefined, new Set(), new Set())).toEqual([])
  })

  test('explain and activeSquads agree on who is active', () => {
    for (const [deps, paths] of [[['stripe'], []], [['stripe', 'next-auth'], ['content']], [[], ['content', 'app/api/webhooks']]] as const) {
      const d = new Set(deps)
      const p = new Set(paths)
      expect(explain(config, d, p).filter((r) => r.active).map((r) => r.name)).toEqual(activeSquads(config, d, p).map((s) => s.name))
    }
  })
})

describe('squads: text', () => {
  test('active squads come first, then near-misses, each with found, missing and adds', () => {
    const text = squadsText(explain(config, new Set(['stripe', 'next-auth']), new Set(['content'])))
    expect(text.indexOf('Active squads')).toBeLessThan(text.indexOf('Near misses'))
    expect(text).toContain('- saas (Micro SaaS) 2/2')
    expect(text).toContain('  found: stripe, next-auth')
    expect(text).toContain('  missing: app/api/webhooks')
    expect(text).toContain('  adds: payments-reviewer')
    expect(text).toContain('- content (Content) 1/2')
    expect(text).toContain('  missing: @next/mdx, contentlayer')
    expect(text.indexOf('- saas')).toBeLessThan(text.indexOf('- content'))
  })

  test('no active squad: only near-misses, and no empty Active section', () => {
    const text = squadsText(explain(config, new Set(['stripe']), new Set()))
    expect(text).not.toContain('Active squads')
    expect(text).toContain('Near misses')
  })

  test('a long missing list is cut with a count', () => {
    const big = { squads: [{ name: 'x', label: 'X', minScore: 2, signals: { deps: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], paths: [] }, adds: [] }] }
    const text = squadsText(explain(big, new Set(['a']), new Set()))
    expect(text).toContain('missing: b, c, d, e, f, +2 more')
    expect(text).toContain('adds: none')
  })

  test('no signal at all says so', () => {
    expect(squadsText(explain(config, new Set(), new Set()))).toMatch(/^No squads detected/)
    expect(squadsText([])).toMatch(/^No squads detected/)
  })

  test('an unreadable squads.json blames the config, not the repo', () => {
    expect(squadsText(null)).toMatch(/^squads\.json is unreadable/)
  })
})

describe('squads: in the mod', () => {
  const boot = async ($: any, on: any, repo: { pkg: string; paths: string[] }) => {
    on('env.get', async () => ({ value: undefined }))
    on('session.cwd', async () => ({ value: '/work/repo' }))
    on('session.start', async ($: any, e: any) => ({ cwd: e.cwd }))
    on('command.register', async () => ({ value: undefined }))
    on('tool.register', async ($: any, e: any) => ({ value: { tool: 'mcp__agentille__' + e.name } }))
    on('ui.toast', async () => ({ value: undefined }))
    on('fs.read', async ($: any, e: any) => {
      if (e.path.endsWith('/.claude-plugin/squads.json')) return { value: JSON.stringify(config) }
      if (e.path === '/work/repo/package.json') return { value: repo.pkg }
      return { deny: 'ENOENT' }
    })
    on('fs.list', async () => ({ value: [] }))
    on('fs.exists', async ($: any, e: any) => ({ value: repo.paths.some((p) => e.path === '/work/repo/' + p) }))
    on('fs.stat', async (_$: any, e: any) => (e.path.startsWith('/work/') ? { value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false } } : { deny: 'ENOENT' }))
    on('store.get', async () => ({ value: undefined }))
    on('ui.panes', async () => ({ value: [] }))
    on('process.run', async () => ({ value: { exitCode: 1, stdout: '', stderr: '' } }))
    on('skill.prompt', async ($: any, e: any) => ({ text: e.text }))
    mock.clock(on, { now: 1_000_000 })
    await $.session.start({ cwd: '/work/repo', surface: null, isInteractive: false })
  }

  test('an active squad reaches the /agt skill text', async ($, on) => {
    await boot($, on, { pkg: JSON.stringify({ dependencies: { stripe: '1', 'next-auth': '1' } }), paths: [] })
    const r = await $.skill.prompt({ skill: 'agt', text: 'base' })
    expect(r.text).toContain('## Squads detected by the agentille mod')
    expect(r.text).toContain('- **saas** (Micro SaaS) — signals: stripe, next-auth')
    expect(r.text).toContain('agentille:agentille-payments-reviewer')
    expect(r.text).toContain('verify webhook signatures')
  })

  test('no squad: /agt gets no squads block', async ($, on) => {
    await boot($, on, { pkg: '{}', paths: [] })
    expect((await $.skill.prompt({ skill: 'agt', text: 'base' })).text).not.toContain('Squads detected')
  })

  test('/agt-squads rescans, so a dep added after start shows up', async ($, on) => {
    const repo = { pkg: JSON.stringify({ dependencies: { stripe: '1' } }), paths: [] as string[] }
    await boot($, on, repo)
    const before = (await $.command.run({ command: 'agt-squads' })).text
    expect(before).not.toContain('Active squads')
    expect(before).toContain('- saas (Micro SaaS) 1/2')
    repo.pkg = JSON.stringify({ dependencies: { stripe: '1', 'next-auth': '1' } })
    const after = (await $.command.run({ command: 'agt-squads' })).text
    expect(after).toContain('Active squads')
    expect(after).toContain('- saas (Micro SaaS) 2/2')
    expect((await $.skill.prompt({ skill: 'agt', text: 'base' })).text).toContain('Squads detected')
  })
})
