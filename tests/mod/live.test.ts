import { describe, expect, mock, test } from 'claude-code/testing'
import { DONE_GRACE_MS, IDLE_GRACE_MS, isAgtPrompt, ledger, newAgent, addUsage, finish, paneAgents, reapable, panesLeft, withRoute, endRoute, stage, ledgerText } from '../../hooks/live.js'
import { activeSquads, depsOf, injection } from '../../hooks/squads.js'
import { BYE_MS } from '../../hooks/mascot.js'

describe('live', () => {
  const herdr = [
    { name: 'agt-r1-executor-ui', pane_id: 'w1:p2', agent: 'claude', agent_status: 'working', state_change_seq: 3 },
    { name: 'agt-r1-code-reviewer', pane_id: 'w1:p3', agent: 'codex', agent_status: 'done', state_change_seq: 5 },
    { name: 'someone-else', pane_id: 'w1:p4', agent: 'claude', agent_status: 'idle', state_change_seq: 1 },
    { name: 'agt-r1-lead', pane_id: 'w1:p1', agent: 'claude', agent_status: 'working', state_change_seq: 9 },
  ]

  test('only agt-* panes other than this one are tracked', async () => {
    const p = paneAgents(herdr, 'w1:p1')
    expect(p.map((x) => x.id)).toEqual(['w1:p2', 'w1:p3'])
    expect(p[0]).toMatchObject({ role: 'executor-ui', run: 'r1', vendor: 'claude' })
    expect(paneAgents([{ ...herdr[0], tab_id: 'w1:t1', workspace_id: 'w1' }], null)[0]).toMatchObject({ tab: 'w1:t1', workspace: 'w1' })
  })

  test('done reaps at 90 s, idle only between lead turns, a state change resets the clock', async () => {
    const seen = new Map()
    const p = paneAgents(herdr, 'w1:p1')
    expect(reapable(p, seen, 0)).toEqual([])
    expect(reapable(p, seen, DONE_GRACE_MS - 1)).toEqual([])
    expect(reapable(p, seen, DONE_GRACE_MS).map((x) => x.id)).toEqual(['w1:p3'])
    const bumped = p.map((x) => (x.id === 'w1:p3' ? { ...x, seq: 6 } : x))
    expect(reapable(bumped, seen, DONE_GRACE_MS + 1)).toEqual([])
    const idle = [{ ...p[0], state: 'idle', seq: 4 }]
    const s2 = new Map()
    reapable(idle, s2, 0, false)
    expect(reapable(idle, s2, IDLE_GRACE_MS - 1, false)).toEqual([])
    expect(reapable(idle, s2, IDLE_GRACE_MS, false).length).toBe(1)
    expect(reapable(idle, s2, IDLE_GRACE_MS * 10, true)).toEqual([])
    expect(reapable(idle, s2, IDLE_GRACE_MS * 10).length).toBe(0)
    const doneP = [{ ...p[1] }]
    const s3 = new Map()
    reapable(doneP, s3, 0, true)
    expect(reapable(doneP, s3, DONE_GRACE_MS, true).length).toBe(1)
  })

  test('ledger sums tokens per role for one run', async () => {
    const m = new Map()
    const a = newAgent({ id: 'a', role: 'executor', routed: true, model: 'sonnet', effort: 'medium', reason: 'table', run: 'r1', now: 0 })
    const b = newAgent({ id: 'b', role: 'executor', routed: true, model: 'sonnet', effort: 'high', reason: 'fix attempt 2', run: 'r1', now: 0 })
    const c = newAgent({ id: 'c', role: 'planner', routed: true, model: 'opus', effort: 'high', reason: 'table', run: 'r0', now: 0 })
    addUsage(a, { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 2 })
    addUsage(b, { input_tokens: 1, output_tokens: 1 })
    finish(a, 0, 4000)
    for (const x of [a, b, c]) m.set(x.id, x)
    const l = ledger(m, 'r1')
    expect(l.roles.executor).toEqual({ agents: 2, input: 13, output: 6, cacheRead: 100, ms: 4000 })
    expect(l.roles.planner).toBe(undefined)
    expect(stage({ agents: m, run: 'r1' }).rows.map((x: any) => x.id)).toEqual(['b'])
  })
})

describe('squads', () => {
  const config = { squads: [
    { name: 'saas', label: 'Micro SaaS', minScore: 2, signals: { deps: ['stripe', 'next-auth'], paths: ['app/api/webhooks'] }, adds: ['payments-reviewer'], checklists: { 'security-reviewer': ['verify webhook signatures'] } },
    { name: 'content', label: 'Content', minScore: 2, signals: { deps: ['@next/mdx'], paths: ['content'] }, adds: ['seo-reviewer'], checklists: {} },
  ] }

  test('scores deps + paths against minScore', async () => {
    const deps = depsOf(JSON.stringify({ dependencies: { stripe: '1' }, devDependencies: { vitest: '1' } }))
    expect(activeSquads(config, deps, new Set()).length).toBe(0)
    const on = activeSquads(config, deps, new Set(['app/api/webhooks']))
    expect(on.map((s) => s.name)).toEqual(['saas'])
    expect(on[0].matched).toEqual(['stripe', 'app/api/webhooks'])
  })

  test('injection names specialists and checklists', async () => {
    const block = injection(activeSquads(config, new Set(['stripe', 'next-auth']), new Set()))
    expect(block).toContain('agentille:agentille-payments-reviewer')
    expect(block).toContain('verify webhook signatures')
    expect(injection([])).toBe('')
  })
})

describe('band', () => {
  test('a routed spawn shows up above the prompt with model and effort', async ($, on) => {
    on('store.get', async () => ({ value: null }))
    on('agent.spawn', async ($, e) => ({ model: 'claude-opus-5-5', agentId: 'band1' }))
    on('ui.render', async () => ({ type: 'engine', ref: 0 }) as never)
    await $.agent.spawn({ prompt: '[agt run=bandrun size=large mode=review]\nreview', subagentType: 'agentille:agentille-code-reviewer' })
    const ui = await $.ui.mount({ plugin: 'agentille', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 100 } as never })
    expect(await ui.find({ type: 'Text', text: /code-reviewer/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^\s*opus\s*$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /▆ high/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /run bandrun/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^◇$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /◇1 ▣0/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /lead · / })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /▝▜█████▛▘/ })).toBeUndefined()
    await ui.unmount()
  })

  test('a short band still shows the agent row', async ($, on) => {
    on('store.get', async () => ({ value: null }))
    on('agent.spawn', async ($, e) => ({ model: 'claude-opus-5-5', agentId: 'band3' }))
    on('ui.render', async () => ({ type: 'engine', ref: 0 }) as never)
    await $.agent.spawn({ prompt: '[agt run=shortrun size=large mode=review]\nreview', subagentType: 'agentille:agentille-code-reviewer' })
    const ui = await $.ui.mount({ plugin: 'agentille', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: true, maxRows: 5, bodyColumns: 100 } as never })
    expect(await ui.find({ type: 'Text', text: /code-reviewer/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /▝▜█████▛▘/ })).toBeUndefined()
    await ui.unmount()
  })

  test('the band steps aside while a survey is up', async ($, on) => {
    on('store.get', async () => ({ value: null }))
    on('agent.spawn', async ($, e) => ({ model: 'claude-opus-5-5', agentId: 'band4' }))
    on('ui.render', async () => ({ type: 'engine', ref: 0 }) as never)
    await $.agent.spawn({ prompt: '[agt run=surveyrun size=large mode=review]\nreview', subagentType: 'agentille:agentille-code-reviewer' })
    const props = { isWorking: true, maxRows: 10, bodyColumns: 100 }
    let ui = await $.ui.mount({ plugin: 'agentille', surface: 'terminal', component: 'AbovePrompt', props: { ...props, hasSurvey: true } as never })
    expect(await ui.find({ type: 'Text', text: /code-reviewer/ })).toBeUndefined()
    await ui.unmount()
    ui = await $.ui.mount({ plugin: 'agentille', surface: 'terminal', component: 'AbovePrompt', props: { ...props, hasSurvey: false } as never })
    expect(await ui.find({ type: 'Text', text: /code-reviewer/ })).toBeDefined()
    await ui.unmount()
  })

  test('the main spinner keeps its own suffix; a subagent spinner is left alone', async ($, on) => {
    const seen: any[] = []
    on('store.get', async () => ({ value: null }))
    on('agent.spawn', async ($, e) => ({ model: 'claude-opus-5-5', agentId: 'spin1' }))
    on('ui.render', async ($: any, e: any) => { seen.push(e); return { type: 'engine', ref: 0 } as never })
    await $.agent.spawn({ prompt: '[agt run=spinrun size=large mode=review]\nreview', subagentType: 'agentille:agentille-code-reviewer' })
    const props = { word: 'Working', message: null, suffix: '…', mode: 'responding' } as never
    let ui = await $.ui.mount({ plugin: 'agentille', surface: 'terminal', component: 'Spinner', requestId: 'main', props })
    expect(seen.at(-1).props.suffix).toBe('… · ◇1 working')
    await ui.unmount()
    ui = await $.ui.mount({ plugin: 'agentille', surface: 'terminal', component: 'Spinner', requestId: 'spin1', props })
    expect(seen.at(-1).props.suffix).toBe('…')
    await ui.unmount()
  })

  test('a finished subagent shows a ✓ before it leaves the band', async ($, on) => {
    on('store.get', async () => ({ value: null }))
    on('agent.spawn', async ($, e) => ({ model: 'claude-opus-5-5', agentId: 'band2' }))
    on('turn.complete', async ($, e) => ({ text: e.answer }) as never)
    on('ui.render', async () => ({ type: 'engine', ref: 0 }) as never)
    mock.clock(on, { now: 1_000_000 })
    await $.agent.spawn({ prompt: '[agt run=byerun size=large mode=review]\nreview', subagentType: 'agentille:agentille-code-reviewer' })
    await $.turn.complete({ agentId: 'band2', answer: 'APPROVE', durationMs: 10, isAborted: false, turnId: 't', reason: 'answer' } as never)
    const ui = await $.ui.mount({ plugin: 'agentille', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 100 } as never })
    expect(await ui.find({ type: 'Text', text: /^✓$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /code-reviewer/ })).toBeDefined()
    await ui.unmount()
  })
})

describe('raw reports', () => {
  const setup = (on: any, home = '/h') => {
    const writes: Record<string, string> = {}
    let n = 0
    on('env.get', async ($: any, e: any) => ({ value: ({ HOME: home } as any)[e.name] }))
    on('session.start', async ($: any, e: any) => ({ cwd: e.cwd }))
    on('command.register', async () => ({ value: undefined }))
    on('fs.read', async () => ({ deny: 'no profile' }))
    on('fs.write', async ($: any, e: any) => { writes[e.path] = e.text; return { value: undefined } })
    on('store.get', async () => ({ value: undefined }))
    on('agent.spawn', async ($: any, e: any) => ({ model: e.model ?? 'sonnet', agentId: 'a' + n++ }))
    on('turn.complete', async ($: any, e: any) => ({ text: e.answer }))
    on('ui.render', async () => ({ type: 'engine', ref: 0 }) as never)
    mock.clock(on, { now: 1_000_000 })
    return writes
  }
  const spawn = ($: any, role: string, run = 'rr1') => $.agent.spawn({ prompt: '[agt run=' + run + ' size=small mode=build]\nwork', subagentType: 'agentille:agentille-' + role })
  const done = ($: any, agentId: string, answer: string) => $.turn.complete({ agentId, answer, durationMs: 10, isAborted: false, turnId: 't' + agentId, reason: 'answer' })
  const DIR = '/h/.agentille/state/run-rr1/agents/'

  test('a finished agent leaves its answer verbatim in the run dir, numbered per role', async ($, on) => {
    const writes = setup(on)
    await $.session.start({ cwd: '/w', surface: null, isInteractive: false })
    const a = await spawn($, 'code-reviewer')
    const b = await spawn($, 'code-reviewer')
    const c = await spawn($, 'executor')
    await done($, b.agentId, 'VERDICT: PASS · P0:0 P1:0 P2:0\n\nbody two')
    await done($, a.agentId, 'VERDICT: CONCERNS · P0:0 P1:1 P2:0\nFIX: a.ts:1 fix it\n\nbody one')
    await done($, c.agentId, 'VERIFICATION: npm test → ok')
    expect(writes[DIR + 'code-reviewer-1.md']).toBe('VERDICT: PASS · P0:0 P1:0 P2:0\n\nbody two')
    expect(writes[DIR + 'code-reviewer-2.md']).toBe('VERDICT: CONCERNS · P0:0 P1:1 P2:0\nFIX: a.ts:1 fix it\n\nbody one')
    expect(writes[DIR + 'executor-1.md']).toBe('VERIFICATION: npm test → ok')
  })

  test('the same agent finishing again rewrites its file, not a new one', async ($, on) => {
    const writes = setup(on)
    await $.session.start({ cwd: '/w', surface: null, isInteractive: false })
    const a = await spawn($, 'planner')
    await done($, a.agentId, 'first')
    await done($, a.agentId, 'second')
    expect(Object.keys(writes).filter((k) => k.includes('/agents/'))).toEqual([DIR + 'planner-1.md'])
    expect(writes[DIR + 'planner-1.md']).toBe('second')
  })

  test('numbers are per run', async ($, on) => {
    const writes = setup(on)
    await $.session.start({ cwd: '/w', surface: null, isInteractive: false })
    await done($, (await spawn($, 'planner', 'rr1')).agentId, 'x')
    await done($, (await spawn($, 'planner', 'rr2')).agentId, 'y')
    expect(writes['/h/.agentille/state/run-rr2/agents/planner-1.md']).toBe('y')
  })

  test('nothing is written for a non-agentille agent, an empty answer, an unknown run or no home', async ($, on) => {
    const writes = setup(on)
    await $.session.start({ cwd: '/w', surface: null, isInteractive: false })
    await done($, (await $.agent.spawn({ prompt: 'look around', subagentType: 'Explore' })).agentId, 'found it')
    await done($, (await spawn($, 'planner')).agentId, '')
    await done($, (await $.agent.spawn({ prompt: 'no header\nplan', subagentType: 'agentille:agentille-planner' })).agentId, 'plan')
    expect(Object.keys(writes).filter((k) => k.includes('/agents/'))).toEqual([])
  })

  test('with no HOME the mod writes nothing and does not fail', async ($, on) => {
    const writes = setup(on, '')
    await $.session.start({ cwd: '/w', surface: null, isInteractive: false })
    await done($, (await spawn($, 'planner')).agentId, 'plan')
    expect(Object.keys(writes)).toEqual([])
  })
})

describe('typed /agt', () => {
  test('only a typed /agt run counts', async () => {
    expect(isAgtPrompt('/agt add a search filter')).toBe(true)
    expect(isAgtPrompt('/agt')).toBe(true)
    expect(isAgtPrompt('/agentille:agt "review the diff"')).toBe(true)
    expect(isAgtPrompt('/agt-ledger')).toBe(false)
    expect(isAgtPrompt('/agentille-init')).toBe(false)
    expect(isAgtPrompt('run /agt later')).toBe(false)
    expect(isAgtPrompt(undefined)).toBe(false)
  })
})

const pane = (name: string, state: string) => ({ id: name, kind: 'pane', name, role: name.split('-').slice(2).join('-'), run: name.split('-')[1], vendor: 'claude', state, seq: 1, tab: null, workspace: null })
const sub = (id: string, run: string, state: string, extra = {}) => ({ ...newAgent({ id, role: 'executor', routed: true, model: 'sonnet', effort: 'medium', reason: 'table', run, now: 0 }), state, ...extra })

describe('leaves the band', () => {
  test('finish ends the row at once: no farewell state', async () => {
    const a = newAgent({ id: 'a', role: 'executor', routed: true, model: 'sonnet', effort: 'medium', reason: 'table', run: 'r1', now: 0 })
    expect('bye' in a).toBe(false)
    finish(a, 10)
    expect(a.state).toBe('done')
    finish(a, 20)
    expect(a.end).toBe(20)
    expect(stage({ agents: new Map([['a', a]]), run: 'r1' }).rows).toEqual([])
  })

  test('with a clock, a finished subagent stays on stage for the bye window only', async () => {
    const a = newAgent({ id: 'a', role: 'executor', routed: true, model: 'sonnet', effort: 'medium', reason: 'table', run: 'r1', now: 0 })
    finish(a, 5000, 10)
    expect(a.end).toBe(10)
    const at = (now: number) => stage({ agents: new Map([['a', a]]), run: 'r1', now }).rows.map((x: any) => x.id)
    expect(at(5000)).toEqual(['a'])
    expect(at(5000 + BYE_MS - 1)).toEqual(['a'])
    expect(at(5000 + BYE_MS)).toEqual([])
    expect(stage({ agents: new Map([['a', a]]), run: 'r1', now: 5000 }).tally).toEqual({ working: 0, done: 1, tok: 0 })
  })

  test('panesLeft: a pane that finishes, idles or vanishes leaves once', async () => {
    for (const next of [[pane('agt-r1-exec-1', 'done')], [pane('agt-r1-exec-1', 'idle')], []]) {
      const staged = new Map()
      panesLeft(staged, [pane('agt-r1-exec-1', 'working')])
      expect(staged.size).toBe(1)
      expect(panesLeft(staged, next)).toEqual(['agt-r1-exec-1'])
      expect(staged.size).toBe(0)
      expect(panesLeft(staged, next)).toEqual([])
    }
  })

  test('panesLeft: blocked and unknown stay on stage until done', async () => {
    const n = 'agt-r1-review'
    const staged = new Map()
    panesLeft(staged, [pane(n, 'working')])
    expect(panesLeft(staged, [pane(n, 'blocked')])).toEqual([])
    expect(panesLeft(staged, [pane(n, 'unknown')])).toEqual([])
    expect(panesLeft(staged, [pane(n, 'done')])).toEqual([n])
  })

  test('panesLeft: done at first sight and open never leave; a return stages it again', async () => {
    const staged = new Map()
    expect(panesLeft(staged, [pane('agt-r1-a', 'done'), pane('agt-r1-b', 'open')])).toEqual([])
    panesLeft(staged, [pane('agt-r1-c', 'working')])
    expect(panesLeft(staged, [pane('agt-r1-c', 'done')])).toEqual(['agt-r1-c'])
    panesLeft(staged, [pane('agt-r1-c', 'working')])
    expect(staged.has('agt-r1-c')).toBe(true)
  })

  test('withRoute copies the newest route and never mutates', async () => {
    const p = pane('agt-r1-exec-1', 'working')
    const routes = [
      { name: 'agt-r1-exec-1', run: 'r1', role: 'exec-1', agent: 'executor', model: 'haiku', effort: 'low', reason: 'old', start: 1, end: 2 },
      { name: 'agt-r1-exec-1', run: 'r1', role: 'exec-1', agent: 'executor', model: 'sonnet', effort: 'high', reason: 'new', start: 5, end: null },
    ]
    const before = JSON.stringify(p)
    expect(withRoute(p, routes)).toMatchObject({ agent: 'executor', model: 'sonnet', effort: 'high', reason: 'new', start: 5, name: p.name })
    expect(withRoute(p, [])).toMatchObject({ agent: null, model: null, effort: null, reason: null, start: null })
    expect(JSON.stringify(p)).toBe(before)
  })

  test('endRoute ends only the newest open route', async () => {
    const mk = (end: number | null) => ({ name: 'agt-r1-x', run: 'r1', role: 'x', agent: null, model: 'sonnet', effort: 'low', reason: '', start: 0, end })
    const routes = [mk(null), mk(null)]
    expect(endRoute(routes, 'agt-r1-x', 50)).toBe(routes[1])
    expect(routes.map((r) => r.end)).toEqual([null, 50])
    expect(endRoute(routes, 'agt-r1-x', 60)).toBe(routes[0])
    expect(endRoute(routes, 'agt-r1-x', 70)).toBe(null)
    expect(endRoute(routes, 'nope', 70)).toBe(null)
  })

  test('stage orders rows and tallies', async () => {
    const a = sub('a', 'r1', 'working', { start: 0, input: 1, output: 2 })
    const b = sub('b', 'r1', 'done', { input: 3, output: 4 })
    const d = sub('d', 'r0', 'working')
    const agents = new Map([['a', a], ['b', b], ['d', d]])
    const p1 = pane('agt-r1-exec-1', 'working')
    const p2 = pane('agt-r1-review', 'blocked')
    const p3 = pane('agt-r1-exec-2', 'done')
    const p4 = pane('agt-r1-spawn', 'open')
    const r = (role: string, extra: object) => ({ name: 'agt-r1-' + role, run: 'r1', role, agent: null, model: 'opus', effort: 'high', reason: '', start: 0, end: null, ...extra })
    const routes = [r('exec-1', { agent: 'executor', model: 'sonnet', effort: 'medium', start: 100 }), r('exec-0', { end: 900 }), r('exec-2', { end: 800 })]
    const { rows, tally } = stage({ agents, panes: [p1, p2, p3, p4], routes, run: 'r1' })
    expect(rows.map((x: any) => x.name ?? x.id)).toEqual(['a', 'agt-r1-exec-1', 'agt-r1-review'])
    expect(rows[0]).toBe(a)
    expect(rows[1]).toMatchObject({ agent: 'executor', model: 'sonnet', start: 100 })
    expect(tally).toEqual({ working: 2, done: 3, tok: 10 })
    expect(stage({ agents: new Map(), run: 'r1' })).toEqual({ rows: [], tally: { working: 0, done: 0, tok: 0 } })
  })

  test('ledger counts pane routes, tokens n/a', async () => {
    const r = (extra: object) => ({ name: 'agt-r1-exec-1', run: 'r1', role: 'exec-1', agent: 'executor', model: 'sonnet', effort: 'low', reason: '', start: 0, end: null, ...extra })
    const routes = [r({ end: 1000 }), r({ end: 500 }), r({}), r({ run: 'r2', end: 99 })]
    const l = ledger(new Map(), 'r1', routes)
    expect(l.panes).toEqual({ executor: { agents: 3, ms: 1500 } })
    expect(ledger(new Map(), 'r1', [r({ agent: null, end: 10 })]).panes).toEqual({ 'exec-1': { agents: 1, ms: 10 } })
    expect(ledger(new Map(), 'r1').panes).toEqual({})
    const m = new Map([['a', sub('a', 'r1', 'working')]])
    expect(ledger(m, 'r1', routes).roles).toEqual(ledger(m, 'r1').roles)
    expect(ledger(m, 'r1', routes).total).toEqual(ledger(m, 'r1').total)
    const text = ledgerText(l)
    expect(text).toContain('executor (pane)')
    expect(text).toContain('tokens n/a')
    expect(text).not.toBe('No agents in this run yet.')
    expect(ledgerText(ledger(new Map(), 'r1'))).toBe('No agents in this run yet.')
  })
})
