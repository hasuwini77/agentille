import { describe, expect, mock, test } from 'claude-code/testing'
import { LIST_STATUS, boardRows } from '../../hooks/board.js'
import { finish, newAgent } from '../../hooks/live.js'
import { adopt, applyStatus, nest } from '../../hooks/tree.js'

const row = (id: string, parentId: string | null = null) => ({ id, parentId, kind: 'sub', role: id, state: 'working', start: 0, input: 0, output: 0 })
const agent = (id: string, extra: object = {}) => ({ ...newAgent({ id, role: 'executor', routed: true, model: 'sonnet', effort: 'high', reason: 'table', run: 'r1', now: 0 }), ...extra })
const item = (id: string, status: string, extra: object = {}) => ({ id, type: 'agentille:agentille-executor', status, description: 'build', ...extra })

describe('tree: nest', () => {
  test('orders depth-first and draws the connectors', async () => {
    const out = nest([row('a'), row('d'), row('b', 'a'), row('c', 'a'), row('e', 'c')])
    expect(out.map((r: any) => r.id)).toEqual(['a', 'b', 'c', 'e', 'd'])
    expect(out.map((r: any) => r.tree.trimEnd())).toEqual(['├─', '│  ├─', '│  └─', '│     └─', '└─'])
  })

  test('prefixes share one width so the columns after them line up', async () => {
    const out = nest([row('a'), row('b', 'a')])
    expect(new Set(out.map((r: any) => r.tree.length)).size).toBe(1)
  })

  test('a row whose parent is not shown is a root; a parent cycle loses no row', async () => {
    expect(nest([row('a', 'gone'), row('b')]).map((r: any) => r.tree.trimEnd())).toEqual(['├─', '└─'])
    const out = nest([row('a', 'b'), row('b', 'a')])
    expect(out.map((r: any) => r.id).sort()).toEqual(['a', 'b'])
  })

  test('a lone row keeps the plain last connector', async () => {
    expect(nest([row('a')])[0].tree).toBe('└─')
  })
})

describe('tree: adopt and applyStatus', () => {
  test('adopt makes a row for each unknown agent that has not ended, and never overwrites', async () => {
    const known = agent('k1')
    const live = new Map([['k1', known]]) as Map<string, any>
    const added = adopt(live, [item('k1', 'running'), item('x1', 'running'), item('x2', 'waiting', { type: 'Explore', parentId: 'x1' }), item('x3', 'completed'), item('x4', 'killed')], { run: 'adhoc', now: 5 })
    expect(added.map((a: any) => a.id)).toEqual(['x1', 'x2'])
    expect(live.get('k1')).toBe(known)
    expect(live.has('x3')).toBe(false)
    expect(live.has('x4')).toBe(false)
    expect(live.get('x1')).toMatchObject({ role: 'executor', model: null, effort: null, input: 0, output: 0, routed: false, adopted: true, parentId: null, listStatus: 'running', run: 'adhoc', state: 'working' })
    expect(live.get('x2')).toMatchObject({ role: 'Explore', parentId: 'x1', listStatus: 'waiting' })
  })


  test('applyStatus records the list status and finishes failed and killed agents', async () => {
    const a = agent('a'), b = agent('b'), c = agent('c')
    const live = new Map([['a', a], ['b', b], ['c', c]]) as Map<string, any>
    applyStatus(live, [item('a', 'waiting', { parentId: 'p' }), item('b', 'failed'), item('c', 'killed')], 100)
    expect(a).toMatchObject({ listStatus: 'waiting', state: 'working', parentId: 'p', listed: true })
    expect(b).toMatchObject({ listStatus: 'failed', state: 'done', leftAt: 100 })
    expect(c).toMatchObject({ listStatus: 'killed', state: 'done' })
  })

  test('applyStatus keeps a known parent, and leaves a finished agent finished', async () => {
    const a = agent('a', { parentId: 'mine' })
    finish(a, 50, 10)
    applyStatus(new Map([['a', a]]) as Map<string, any>, [item('a', 'running', { parentId: 'other' })], 100)
    expect(a).toMatchObject({ parentId: 'mine', state: 'done', leftAt: 50 })
  })

  test('an adopted agent finishes when it completes or leaves the list; a spawned one waits for its turn to end', async () => {
    const adopted = agent('ad', { adopted: true }), gone = agent('gone', { adopted: true }), spawned = agent('sp')
    const live = new Map([['ad', adopted], ['gone', gone], ['sp', spawned]]) as Map<string, any>
    applyStatus(live, [item('ad', 'completed'), item('sp', 'completed')], 100)
    expect(adopted.state).toBe('done')
    expect(gone.state).toBe('done')
    expect(spawned.state).toBe('working')
  })

  test('an adopted agent that goes idle finishes', async () => {
    const a = agent('a', { adopted: true })
    applyStatus(new Map([['a', a]]) as Map<string, any>, [item('a', 'idle')], 100)
    expect(a).toMatchObject({ state: 'done', leftAt: 100 })
    const live = new Map() as Map<string, any>
    adopt(live, [item('i1', 'idle')], { run: 'adhoc', now: 5 })
    applyStatus(live, [item('i1', 'idle')], 6)
    expect(live.get('i1')).toMatchObject({ adopted: true, state: 'done', listStatus: 'idle' })
  })

  test('a spawned agent the list once named and no longer does is finished; one never listed is not', async () => {
    const seen = agent('seen'), never = agent('never')
    const live = new Map([['seen', seen], ['never', never]]) as Map<string, any>
    expect(applyStatus(live, [item('seen', 'running')], 100)).toBe(true)
    expect(seen).toMatchObject({ listed: true, state: 'working' })
    expect(applyStatus(live, [], 200)).toBe(true)
    expect(seen).toMatchObject({ state: 'done', leftAt: 200 })
    expect(never.state).toBe('working')
  })

  test('applyStatus reports a change only when something changed', async () => {
    const a = agent('a')
    const live = new Map([['a', a]]) as Map<string, any>
    expect(applyStatus(live, [item('a', 'running')], 100)).toBe(true)
    expect(applyStatus(live, [item('a', 'running')], 200)).toBe(false)
    expect(applyStatus(live, [item('a', 'waiting')], 300)).toBe(true)
  })
})

describe('tree: board rows', () => {
  const draw = (rows: any[], extra: object = {}) => boardRows(rows, { now: 10_000, cols: 100, ...extra })

  test('the list status picks the glyph, word and colour', async () => {
    const [waiting, idle, failed] = draw([agent('w', { listStatus: 'waiting' }), agent('i', { listStatus: 'idle' }), finishAs(agent('f', { listStatus: 'failed' }))])
    expect(waiting).toMatchObject({ spinner: LIST_STATUS.waiting.glyph, activity: 'waiting', glyphColor: LIST_STATUS.waiting.color })
    expect(idle).toMatchObject({ activity: 'idle', glyphColor: LIST_STATUS.idle.color })
    expect(failed).toMatchObject({ glyph: '✗', activity: 'failed', glyphColor: 'error', dim: false })
  })

  test('a running agent keeps its spinner and its tool', async () => {
    const [r] = draw([agent('r', { listStatus: 'running', tool: 'Read a.ts' })])
    expect(r.activity).toBe('Read a.ts')
    expect(r.glyphColor).not.toBe('warning')
  })

  test('a sub with no model gets a ? chip, never pane; its elapsed time stays blank', async () => {
    const [r] = draw([agent('n', { model: null, adopted: true })])
    expect(r.chip.trim()).toBe('?')
    expect(r.time.trim()).toBe('')
  })

  test('an adopted row shows no tokens, even once partial usage arrives', async () => {
    const [r] = draw([agent('n', { model: null, adopted: true })])
    expect(r.tok.trim()).toBe('')
    const [s] = draw([agent('n', { model: null, adopted: true, input: 1200, output: 300 })])
    expect(s.tok.trim()).toBe('')
    const [t] = draw([agent('n', { input: 1200, output: 300 })])
    expect(t.tok.trim()).not.toBe('')
  })

  test('the connector comes from the tree when set; the agent in view is marked', async () => {
    const [a, b] = draw([{ ...agent('a'), tree: '│  └─' }, agent('b')], { view: 'b' })
    expect(a.tree).toBe('│  └─')
    expect(b.tree).toBe('└─')
    expect([a.inView, b.inView]).toEqual([false, true])
  })
})

function finishAs(a: any) {
  finish(a, 1000, 500)
  return a
}

describe('tree: in the mod', () => {
  const boot = async ($: any, on: any, list: object[] | (() => object[])) => {
    const calls = { list: 0 }
    on('env.get', async ($: any, e: any) => ({ value: ({ HOME: '/h' } as any)[e.name] }))
    on('session.start', async ($: any, e: any) => ({ cwd: e.cwd }))
    on('command.register', async () => ({ value: undefined }))
    on('fs.read', async () => ({ deny: 'no profile' }))
    on('store.get', async () => ({ value: undefined }))
    on('agent.list', async () => { calls.list += 1; return { value: typeof list === 'function' ? list() : list } as never })
    on('ui.render', async () => ({ type: 'engine', ref: 0 }) as never)
    const clock = mock.clock(on, { now: 1_000_000 })
    await $.session.start({ cwd: '/w', surface: null, isInteractive: false })
    return { clock, calls }
  }
  const mount = ($: any, over: object = {}) => $.ui.mount({ plugin: 'agentille', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 100, ...over } as never })
  const LIST = [item('x1', 'running'), item('x2', 'waiting', { type: 'Explore', parentId: 'x1', description: 'scan' })]

  test('after a reload the band is rebuilt from the engine list, nested, with no invented model', async ($, on) => {
    await boot($, on, LIST)
    const ui = await mount($)
    expect(await ui.find({ type: 'Text', text: /executor/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Explore/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /waiting/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^\s+└─$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^\s*(opus|sonnet|haiku|fable)\s*$/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^\s*\?\s*$/ })).toBeDefined()
    await ui.unmount()
  })

  test('the agent whose transcript is on screen is drawn inverse', async ($, on) => {
    await boot($, on, LIST)
    let ui = await mount($, { view: { agentId: 'x1' } })
    expect((await ui.find({ type: 'Text', text: /executor/ }))?.props.inverse).toBe(true)
    expect((await ui.find({ type: 'Text', text: /Explore/ }))?.props.inverse).toBeUndefined()
    await ui.unmount()
    ui = await mount($, { view: {} })
    expect((await ui.find({ type: 'Text', text: /executor/ }))?.props.inverse).toBeUndefined()
    await ui.unmount()
  })

  test('a spawn made inside another agent nests under it', async ($, on) => {
    let n = 0
    on('agent.spawn', async () => ({ model: 'claude-sonnet-5', agentId: 'sp' + ++n }))
    await boot($, on, [])
    await $.agent.spawn({ prompt: '[agt run=nestrun size=large mode=build]\nlead', subagentType: 'agentille:agentille-executor' })
    await $.agent.spawn({ prompt: 'scan', subagentType: 'Explore', parentAgentId: 'sp1' } as never)
    const ui = await mount($)
    expect(await ui.find({ type: 'Text', text: /Explore/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^\s+└─$/ })).toBeDefined()
    await ui.unmount()
  })

  test('only an idle adopted agent: the list poll never turns into a running ticker', async ($, on) => {
    const { clock, calls } = await boot($, on, [item('i1', 'idle')])
    expect(calls.list).toBe(1)
    await clock.advance(6000)
    expect(calls.list).toBe(1)
  })

  test('the ticker stops once the adopted agents end', async ($, on) => {
    let status = 'running'
    const { clock, calls } = await boot($, on, () => [item('x1', status)])
    await clock.advance(3000)
    const during = calls.list
    expect(during).toBeGreaterThan(1)
    status = 'completed'
    await clock.advance(3000)
    const after = calls.list
    await clock.advance(6000)
    expect(calls.list).toBe(after)
  })

  test('the list is read at most once a second', async ($, on) => {
    const { clock, calls } = await boot($, on, [item('x1', 'running')])
    expect(calls.list).toBe(1)
    await $.session.start({ cwd: '/w', surface: null, isInteractive: false })
    expect(calls.list).toBe(1)
    await clock.advance(1100)
    await $.session.start({ cwd: '/w', surface: null, isInteractive: false })
    expect(calls.list).toBeGreaterThan(1)
  })

  test('a throwing list leaves the band drawing from events', async ($, on) => {
    on('agent.spawn', async () => ({ model: 'claude-sonnet-5', agentId: 'sp1' }))
    const { calls } = await boot($, on, () => { throw new Error('no agent list') })
    expect(calls.list).toBe(1)
    await $.agent.spawn({ prompt: '[agt run=boom size=large mode=build]\nlead', subagentType: 'agentille:agentille-executor' })
    const ui = await mount($)
    expect(await ui.find({ type: 'Text', text: /executor/ })).toBeDefined()
    await ui.unmount()
  })
})
