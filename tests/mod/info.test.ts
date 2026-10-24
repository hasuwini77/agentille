import { describe, expect, mock, test } from 'claude-code/testing'
import { DEFAULTS, ROLES } from '../../hooks/routing.js'
import { INFO_USAGE, ledgerSummary, overviewText, parseInfoArgs, routeText, routingSummary, squadsSummary } from '../../hooks/info.js'
import { resolveDisplay } from '../../hooks/settings.js'

describe('info: arguments', () => {
  test('no argument is the overview; the three old views are subcommands', () => {
    expect(parseInfoArgs('')).toEqual({ view: 'overview' })
    expect(parseInfoArgs(undefined)).toEqual({ view: 'overview' })
    for (const v of ['routing', 'ledger', 'squads']) expect(parseInfoArgs(' ' + v.toUpperCase() + ' ')).toEqual({ view: v })
  })

  test('anything else shows the usage, which lists every depth value', () => {
    for (const d of ['quick', 'complex-only', 'always']) expect(INFO_USAGE).toContain(d)
    expect(parseInfoArgs('weather')).toEqual({ error: INFO_USAGE })
    expect(parseInfoArgs('routing now')).toEqual({ error: INFO_USAGE })
  })

  test('route takes a role, with the plugin prefix optional, and header-style options', () => {
    expect(parseInfoArgs('route planner')).toEqual({ view: 'route', role: 'planner', hdr: {}, depth: null })
    expect(parseInfoArgs('route agentille:agentille-executor size=large risk=auth depth=quick')).toEqual({ view: 'route', role: 'executor', hdr: { size: 'large', risk: 'auth' }, depth: 'quick' })
    expect(parseInfoArgs('route agentille-planner size=small').hdr).toEqual({ size: 'small' })
  })

  test('an unknown role lists the valid ones; a bad option names itself', () => {
    const bad = parseInfoArgs('route wizard') as { error: string }
    expect(bad.error).toContain('Unknown role "wizard"')
    for (const r of ROLES) expect(bad.error).toContain(r)
    expect((parseInfoArgs('route') as { error: string }).error).toContain(ROLES[0])
    expect((parseInfoArgs('route planner size=huge') as { error: string }).error).toContain('Cannot read "size=huge"')
    expect((parseInfoArgs('route planner flavour=hot') as { error: string }).error).toContain('Cannot read "flavour=hot"')
  })
})

describe('info: route dry-run', () => {
  const route = (role: string, hdr = {}, depth: string | null = null, settings = DEFAULTS) => routeText({ role, hdr, depth }, settings)

  test('the table pick comes first, then the rungs', () => {
    const t = route('planner')
    expect(t.split('\n')[0]).toBe('planner → opus · high · table')
    expect(t).toContain('1st REVISE')
    expect(t).toContain('2nd REVISE')
  })

  test('depth=quick: the planner\'s 1st REVISE climbs to opus · max, whatever the quick pick was', () => {
    const t = route('planner', {}, 'quick')
    expect(t.split('\n')[0]).toBe('planner depth=quick → sonnet · medium · table')
    expect(t).toMatch(/1st REVISE\s+opus · max · plan REVISE ×1/)
  })

  test('size, risk and depth change the pick the way the dispatch header does', () => {
    expect(route('planner', { size: 'large' }).split('\n')[0]).toBe('planner size=large → opus · xhigh · table')
    expect(route('security-reviewer', { risk: 'money' }).split('\n')[0]).toBe('security-reviewer risk=money → opus · max · table')
    expect(route('security-reviewer', {}, 'quick').split('\n')[0]).toBe('security-reviewer depth=quick → sonnet · high · table')
    expect(route('design-reviewer', {}, 'quick').split('\n')[0]).toBe('design-reviewer depth=quick → sonnet · high · table')
    expect(route('design-reviewer', {}, 'always').split('\n')[0]).toBe('design-reviewer depth=always → opus · high · table')
  })

  test('the executor climbs on fix attempts and has no REVISE rung', () => {
    const t = route('executor')
    expect(t).toContain('fix attempt 2')
    expect(t).toMatch(/fix attempt 2\s+sonnet · high · fix attempt 2/)
    expect(t).toMatch(/fix attempt 3\s+sonnet · max · fix attempt 3/)
    expect(t).not.toContain('REVISE')
  })

  // routing.md and the TABLE logic move the diagnose planner to Fable from the second failed fix, not the third.
  test('the diagnose rung is reached after two failed fixes, as decide() climbs', () => {
    const on = route('planner', {}, null, { ...DEFAULTS, autoFable: true })
    expect(on).toMatch(/diagnose, 2 failed fixes\s+fable · high · 2 failed fixes/)
    expect(on).not.toContain('3 failed fixes')
    expect(route('planner')).toMatch(/diagnose, 2 failed fixes {2,}opus · max · 2 failed fixes · Fable blocked: autoFable off/)
  })

  test('with maxRunUsd set, the dry-run shows the pick past the ceiling', () => {
    const t = route('code-reviewer', { size: 'large' }, null, { ...DEFAULTS, maxRunUsd: 5 } as never)
    expect(t.split('\n')[0]).toBe('code-reviewer size=large → opus · high · table')
    expect(t).toMatch(/past maxRunUsd \$5\.00\s+sonnet · high · run ~\$5\.00 ≥ maxRunUsd \$5\.00/)
    expect(route('executor', {}, null, { ...DEFAULTS, maxRunUsd: 5 } as never)).not.toContain('maxRunUsd')
    expect(route('code-reviewer', { size: 'large' }, null, { ...DEFAULTS, maxRunUsd: null } as never)).not.toContain('maxRunUsd')
    expect(route('code-reviewer', { size: 'large' })).toContain('past maxRunUsd $15.00') // the default ceiling
  })

  test('a role with no ladder says so', () => {
    expect(route('seo-reviewer')).toContain('no escalation rungs for this role')
  })

  test('the person\'s routing settings apply to the rungs', () => {
    expect(route('planner')).toContain('Fable blocked: autoFable off') // the shipped default: Fable is opt-in
    const on = route('planner', {}, null, { ...DEFAULTS, autoFable: true })
    expect(on).not.toContain('Fable blocked')
  })
})

describe('info: overview lines', () => {
  test('routing summary counts dispatches per model and skips bad lines', () => {
    expect(routingSummary([])).toContain('no dispatches yet')
    const log = [{ model: 'claude-opus-5-5' }, { model: 'sonnet' }, { model: 'claude-sonnet-5-5' }].map((r) => JSON.stringify(r))
    expect(routingSummary([...log, 'not json'])).toBe('routing: 3 dispatches · opus 1 · sonnet 2 (/agt-info routing)')
    expect(routingSummary([log[0]])).toContain('1 dispatch ·')
  })

  test('ledger summary is one line, or says the run is empty', () => {
    expect(ledgerSummary({ run: 'a1', roles: {}, total: { agents: 0, input: 0, output: 0, cacheRead: 0, ms: 0 }, panes: {} })).toContain('no agents')
    expect(ledgerSummary({ run: 'a1', roles: {}, total: { agents: 2, input: 1500, output: 800, cacheRead: 0, ms: 62_000 }, panes: {} })).toBe('ledger: run a1 · 2 agents · in 1.5k · out 800 · 1:02 (/agt-info ledger)')
  })

  test('squads summary lists the active squads, or none, or blames an unreadable config', () => {
    expect(squadsSummary([{ name: 'saas', active: true }, { name: 'content', active: false }])).toBe('squads: saas (/agt-info squads)')
    expect(squadsSummary([{ name: 'content', active: false }])).toContain('none active')
    expect(squadsSummary(null)).toContain('unreadable')
  })

  test('the overview names every display key with its source', () => {
    const t = overviewText({ display: resolveDisplay({ deck: 'auto' }, {}), squads: 'S', routing: 'R', ledger: 'L' })
    expect(t).toMatch(/deck\s+auto\s+profile/)
    expect(t).toMatch(/focus\s+true\s+default/)
    expect(t.split('\n').slice(-4, -1)).toEqual(['S', 'R', 'L'])
  })
})

describe('info: in the mod', () => {
  const squadConfig = { squads: [{ name: 'saas', label: 'Micro SaaS', minScore: 2, signals: { deps: ['stripe', 'next-auth'], paths: [] }, adds: ['payments-reviewer'], checklists: {} }] }
  const boot = async ($: any, on: any, profile: object | null, store: Record<string, unknown> = {}) => {
    on('env.get', async ($: any, e: any) => ({ value: e.name === 'HOME' ? '/u' : undefined }))
    on('session.cwd', async () => ({ value: '/work/repo' }))
    on('session.start', async ($: any, e: any) => ({ cwd: e.cwd }))
    on('command.register', async () => ({ value: undefined }))
    on('tool.register', async ($: any, e: any) => ({ value: { tool: 'mcp__agentille__' + e.name } }))
    on('ui.toast', async () => ({ value: undefined }))
    on('fs.read', async ($: any, e: any) => {
      if (e.path === '/u/.agentille/profile.json' && profile) return { value: JSON.stringify(profile) }
      if (e.path.endsWith('/.claude-plugin/squads.json')) return { value: JSON.stringify(squadConfig) }
      if (e.path === '/work/repo/package.json') return { value: JSON.stringify({ dependencies: { stripe: '1', 'next-auth': '1' } }) }
      return { deny: 'ENOENT' }
    })
    on('fs.write', async () => ({ value: undefined }))
    on('fs.list', async () => ({ value: [] }))
    on('fs.exists', async () => ({ value: false }))
    on('store.get', async ($: any, e: any) => ({ value: store[e.key] }))
    on('store.set', async () => ({ value: undefined }))
    on('ui.panes', async () => ({ value: [] }))
    on('ui.render', async () => ({ type: 'engine', ref: 0 }) as never)
    on('process.run', async () => ({ value: { exitCode: 1, stdout: '', stderr: '' } }))
    on('agent.spawn', async ($: any, e: any) => ({ model: e.model ?? 'opus', agentId: 'i1' }))
    mock.clock(on, { now: 1_000_000 })
    await $.session.start({ cwd: '/work/repo', surface: null, isInteractive: false })
  }
  const info = async ($: any, args = '') => (await $.command.run({ command: 'agt-info', args })).text as string

  test('the overview shows settings with their source, squads, and an empty run', { timeoutMs: 20_000 }, async ($, on) => {
    await boot($, on, { display: { deck: 'auto' } }, { 'focus:mode': 'off' })
    const t = await info($)
    expect(t).toMatch(/deck\s+auto\s+profile/)
    expect(t).toMatch(/focus\s+false\s+store/)
    expect(t).toMatch(/highlight\s+off\s+default/)
    expect(t).toContain('squads: saas')
    expect(t).toContain('routing: no dispatches yet')
    expect(t).toContain('ledger: no agents in this run yet')
  })

  test('after a dispatch the overview carries one routing line and one ledger line', async ($, on) => {
    await boot($, on, null)
    await $.agent.spawn({ prompt: '[agt run=ab12cd size=large mode=build]\nplan it', subagentType: 'agentille:agentille-planner' })
    const t = await info($)
    expect(t).toMatch(/routing: 1 dispatch · opus 1/)
    expect(t).toMatch(/ledger: run ab12cd · 1 agent /)
  })

  test('routing, ledger and squads print exactly what the old commands print', async ($, on) => {
    await boot($, on, null)
    await $.agent.spawn({ prompt: '[agt run=ab12cd size=large mode=build]\nplan it', subagentType: 'agentille:agentille-planner' })
    expect(await info($, 'routing')).toBe('planner → opus · xhigh')
    expect(await info($, 'ledger')).toContain('run ab12cd')
    const squads = await info($, 'squads')
    expect(squads).toContain('Active squads')
    expect(squads).toContain('- saas (Micro SaaS) 2/2')
  })

  test('route dry-runs under the profile: its routing settings and its thinking depth', async ($, on) => {
    await boot($, on, { routing: { autoFable: false }, thinkingDepth: 'quick' })
    expect(await info($, 'route security-reviewer')).toContain('security-reviewer depth=quick → sonnet · high')
    const t = await info($, 'route planner depth=always')
    expect(t).toContain('planner depth=always → opus · high · table')
    expect(t).toContain('Fable blocked: autoFable off')
  })

  test('route with an unknown role lists the valid roles, and nothing is dispatched', async ($, on) => {
    await boot($, on, null)
    const t = await info($, 'route wizard')
    expect(t).toContain('Unknown role "wizard"')
    expect(t).toContain('planner')
    expect(await info($, 'routing')).toBe('No agentille dispatches this session.')
  })

  test('a bad subcommand shows the usage', async ($, on) => {
    await boot($, on, null)
    expect(await info($, 'weather')).toBe(INFO_USAGE)
  })
})
