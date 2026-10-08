import { describe, expect, mock, test } from 'claude-code/testing'
import { agentRow, cachedRow } from '../../hooks/rows.js'
import { finish, newAgent } from '../../hooks/live.js'
import { BYE_MS } from '../../hooks/mascot.js'

const agent = (extra: object = {}) => ({ ...newAgent({ id: 'a1', role: 'executor', routed: true, model: 'claude-sonnet-5', effort: 'medium', reason: 'table', run: 'r1', now: 0 }), ...extra })

describe('rows: agentRow', () => {
  test('a working agent shows its tool, model·effort, time and tokens', async () => {
    const r = agentRow(agent({ tool: 'Read auth.ts', input: 9000, output: 5200 }), { now: 72_000 })
    expect(r).toMatchObject({ glyph: '◇', role: 'executor', model: 'sonnet·med', activity: 'Read auth.ts', time: '1:12', tok: '14.2k tok', dim: false })
    expect(r.spinner).not.toBe('')
  })

  test('a finished agent reads done, dim, with the check mark and no spinner', async () => {
    const a = agent({ input: 100, output: 50 })
    finish(a, 5000, 4000)
    expect(agentRow(a, { now: 9000 })).toMatchObject({ glyph: '✓', activity: 'done', time: '0:04', spinner: '', dim: true })
  })

  test('a failed agent from the engine list gets the ✗', async () => {
    const a = agent({ listStatus: 'failed' })
    finish(a, 5000)
    expect(agentRow(a, { now: 9000 })).toMatchObject({ glyph: '✗', activity: 'failed', dim: false })
  })

  test('a model the mod never saw reads ?', async () => {
    expect(agentRow(agent({ model: null, effort: null }), { now: 0 }).model).toBe('?')
  })
})

describe('rows: cachedRow', () => {
  // finish() stamps leftAt 5000: from 5000 + BYE_MS the goodbye wave is over and the row is settled.
  const settled = (extra: object = {}) => {
    const a = agent({ input: 100, output: 50, ...extra })
    finish(a, 5000, 4000)
    return a
  }
  const calm = 5000 + BYE_MS

  test('a settled agent builds its row once; every later redraw gets that same row', async () => {
    const cache = new Map()
    const a = settled()
    const first = cachedRow(cache, a, { now: calm })
    expect(first).toMatchObject({ glyph: '✓', activity: 'done', time: '0:04', tok: '150 tok', dim: true })
    expect(cachedRow(cache, a, { now: calm + 60_000, tick: 7 })).toBe(first)
  })

  test('it follows what the row is built from: tokens, then the list status the engine reports later', async () => {
    const cache = new Map()
    const a = settled()
    const first = cachedRow(cache, a, { now: calm })
    a.output += 25
    const more = cachedRow(cache, a, { now: calm })
    expect(more).not.toBe(first)
    expect(more.tok).toBe('175 tok')
    a.listStatus = 'failed'
    const failed = cachedRow(cache, a, { now: calm })
    expect(failed).toMatchObject({ glyph: '✗', activity: 'failed', dim: false })
    expect(cachedRow(cache, a, { now: calm })).toBe(failed)
  })

  test('a working agent, or one still waving goodbye, is built on every call and never stored', async () => {
    const cache = new Map()
    const working = agent({ tool: 'Read auth.ts' })
    expect(cachedRow(cache, working, { now: 1000 })).not.toBe(cachedRow(cache, working, { now: 1000 }))
    const waving = settled()
    expect(cachedRow(cache, waving, { now: calm - 1 })).not.toBe(cachedRow(cache, waving, { now: calm - 1 }))
    expect(cache.size).toBe(0)
  })

  test('the cache stays bounded, dropping the oldest agent first', async () => {
    const cache = new Map()
    for (let i = 0; i < 300; i++) cachedRow(cache, settled({ id: 'a' + i }), { now: calm })
    expect(cache.size).toBeLessThan(300)
    expect(cache.has('a299')).toBe(true)
    expect(cache.has('a0')).toBe(false)
  })
})

describe('rows: in the transcript', () => {
  const toolUse = (id: string, over: object = {}) => ({ tool: 'Agent', tool_use_id: id, input: { description: 'build slice' }, isRunning: false, isErrored: false, isInterrupted: false, ...over }) as never

  for (const surface of ['terminal', 'desktop'] as const) {
    test(`${surface}: a call maps to its agent through output.agentId, or through the spawn's tool_use_id while it runs`, async ($, on) => {
      on('store.get', async () => ({ value: null }))
      const carried: unknown[] = []
      const ids = ['r1', 'r2']
      on('agent.spawn', async ($, e) => { carried.push((e as any).tool_use_id); return { model: 'claude-sonnet-5', agentId: ids[carried.length - 1] } })
      on('ui.render', async () => ({ type: 'engine', ref: 0 }) as never)
      await $.agent.spawn({ prompt: '[agt run=rowrun size=large mode=build]\nbuild', subagentType: 'agentille:agentille-executor' })
      await $.agent.spawn({ prompt: '[agt run=rowrun size=large mode=build]\nbuild', subagentType: 'agentille:agentille-executor', tool_use_id: 'tu2' } as never)
      expect(carried[1]).toBe('tu2')

      // finished call: the result names the agent
      let ui = await $.ui.mount({ plugin: 'agentille', surface, component: 'ToolUse', requestId: 'tu1', props: toolUse('tu1', { output: { agentId: 'r1' } }) })
      expect(await ui.find({ type: 'Text', text: /executor/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /sonnet/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /tok/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /build slice/ })).toBeDefined()
      await ui.unmount()

      // running call: no output yet, only the spawn's tool_use_id
      ui = await $.ui.mount({ plugin: 'agentille', surface, component: 'ToolUse', requestId: 'tu2', props: toolUse('tu2', { isRunning: true }) })
      expect(await ui.find({ type: 'Text', text: /executor/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /sonnet·med|sonnet/ })).toBeDefined()
      await ui.unmount()
    })
  }

  test('an unknown agent, an errored call and a Bash row all draw the engine row', async ($, on) => {
    on('store.get', async () => ({ value: null }))
    on('agent.spawn', async () => ({ model: 'claude-sonnet-5', agentId: 'r3' }))
    on('ui.render', async () => ({ type: 'engine', ref: 0 }) as never)
    await $.agent.spawn({ prompt: '[agt run=rowrun size=large mode=build]\nbuild', subagentType: 'agentille:agentille-executor' })
    const draw = async (props: object) => {
      const ui = await $.ui.mount({ plugin: 'agentille', surface: 'terminal', component: 'ToolUse', requestId: 'x', props: props as never })
      const mine = await ui.find({ type: 'Text', text: /executor/ })
      await ui.unmount()
      return mine
    }
    expect(await draw(toolUse('x', { output: { agentId: 'nope' } }))).toBeUndefined()
    expect(await draw(toolUse('x', { output: { agentId: 'r3' }, isErrored: true }))).toBeUndefined()
    expect(await draw(toolUse('x', { output: { agentId: 'r3' }, isInterrupted: true }))).toBeUndefined()
    expect(await draw({ ...(toolUse('x', { output: { agentId: 'r3' } }) as object), tool: 'Bash' })).toBeUndefined()
    expect(await draw(toolUse('x', { output: { agentId: 'r3' } }))).toBeDefined()
  })

  // The fallback is the engine's own row. A call stopped by the person can leave its agent running
  // or finished; neither may keep drawing as a live agent row on a call that is over.
  test('an interrupted call keeps the engine row, whether its agent finished or still runs', async ($, on) => {
    on('store.get', async () => ({ value: null }))
    const ids = ['i1', 'i2']
    let n = 0
    on('agent.spawn', async () => ({ model: 'claude-sonnet-5', agentId: ids[n++] }))
    on('turn.complete', async ($, e) => ({ text: (e as any).answer }) as never)
    on('ui.render', async () => ({ type: 'engine', ref: 0 }) as never)
    mock.clock(on, { now: Date.now() }) // the spawns start the redraw ticker: hold it still
    const spawn = (tool_use_id: string) => $.agent.spawn({ prompt: '[agt run=rowrun size=large mode=build]\nbuild', subagentType: 'agentille:agentille-executor', tool_use_id } as never)
    await spawn('tuI1')
    await spawn('tuI2')
    await $.turn.complete({ agentId: 'i1', answer: 'stopped', durationMs: 10, isAborted: true, turnId: 'ti1', reason: 'aborted', usage: { input_tokens: 10, output_tokens: 5 } } as never)
    const drawn = async (id: string, over: object) => {
      const ui = await $.ui.mount({ plugin: 'agentille', surface: 'terminal', component: 'ToolUse', requestId: id, props: toolUse(id, over) })
      const tree = await ui.drawn()
      await ui.unmount()
      return tree
    }
    const engine = { type: 'engine', ref: 0 }
    expect(await drawn('tuI1', { output: { agentId: 'i1' }, isInterrupted: true })).toEqual(engine) // finished
    expect(await drawn('tuI2', { isRunning: true, isInterrupted: true })).toEqual(engine)           // still running, found by its spawn
    // the same two calls, not interrupted, are the agents' rows
    expect(await drawn('tuI1', { output: { agentId: 'i1' } })).not.toEqual(engine)
    expect(await drawn('tuI2', { isRunning: true })).not.toEqual(engine)
  })

  test('a workflow agent is not found by its call id, which every agent of the run shares', async ($, on) => {
    on('store.get', async () => ({ value: null }))
    const seen: unknown[] = []
    const ids = ['w1', 'w2']
    on('agent.spawn', async ($, e) => { seen.push((e as any).workflow); return { model: 'claude-sonnet-5', agentId: ids[seen.length - 1] } })
    on('ui.render', async () => ({ type: 'engine', ref: 0 }) as never)
    mock.clock(on, { now: Date.now() })
    const prompt = '[agt run=rowrun size=large mode=build]\nbuild'
    await $.agent.spawn({ prompt, subagentType: 'agentille:agentille-executor', tool_use_id: 'tuWf', workflow: { runId: 'wf_1', agentIndex: 1 } } as never)
    await $.agent.spawn({ prompt, subagentType: 'agentille:agentille-executor', tool_use_id: 'tuAgent' } as never)
    expect(seen).toEqual([{ runId: 'wf_1', agentIndex: 1 }, undefined]) // the mod is handed the workflow field
    const draws = async (id: string) => {
      const ui = await $.ui.mount({ plugin: 'agentille', surface: 'terminal', component: 'ToolUse', requestId: id, props: toolUse(id, { isRunning: true }) })
      const mine = await ui.find({ type: 'Text', text: /executor/ })
      await ui.unmount()
      return mine !== undefined
    }
    expect(await draws('tuAgent')).toBe(true) // an Agent call is found by the id its spawn carried
    expect(await draws('tuWf')).toBe(false)    // a Workflow call id names no single agent
  })
})

describe('rows: workflow agents', () => {
  const PROMPT = '[agt run=wfrun size=large mode=build]\nbuild'
  const band = ($: any) => $.ui.mount({ plugin: 'agentille', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 100 } as never })
  const has = async (ui: any, re: RegExp) => (await ui.find({ type: 'Text', text: re })) !== undefined
  const shows = async (ui: any, re: RegExp) => { if (!(await has(ui, re))) throw new Error(String(re) + ' not drawn: ' + JSON.stringify(await ui.drawn())) }
  const setup = (on: any) => {
    let invalidations = 0
    on('store.get', async () => ({ value: null }))
    on('ui.render', async () => ({ type: 'engine', ref: 0 }) as never)
    on('ui.invalidate', async ($: any, e: any, next: any) => { invalidations++; return next(e) })
    on('turn.complete', async ($: any, e: any) => ({ text: e.answer }))
    on('tool.call', async () => ({ result: 'ok' }) as never)
    const ids = ['wa', 'wb']
    let n = 0
    on('agent.spawn', async () => ({ model: 'claude-sonnet-5', agentId: ids[n++] }))
    const clock = mock.clock(on, { now: Date.now() })
    return { clock, invalidations: () => invalidations }
  }
  const spawn = ($: any, role: string, index: number) => $.agent.spawn({ prompt: PROMPT, subagentType: 'agentille:agentille-' + role, tool_use_id: 'tuWf', workflow: { runId: 'wf_9', agentIndex: index } } as never)

  test('the band shows a workflow agent with the model that ran', async ($, on) => {
    setup(on)
    await spawn($, 'executor', 1)
    const ui = await band($)
    await shows(ui, /executor/)
    await shows(ui, /sonnet/)
    await ui.unmount()
  })

  test('turn.complete finishes a workflow agent', async ($, on) => {
    setup(on)
    await spawn($, 'executor', 1)
    await $.turn.complete({ agentId: 'wa', answer: 'built', durationMs: 10, isAborted: false, turnId: 'tw1', reason: 'answer', usage: { input_tokens: 10, output_tokens: 5 } } as never)
    const ui = await band($)
    await shows(ui, /executor/)
    await shows(ui, /done/)
    await ui.unmount()
  })

  // 31 minutes of 300 ms ticks on the mock clock
  test('30 minutes without an event reads no signal; a later tool call revives it; the ticker stops once settled', { timeoutMs: 60_000 }, async ($, on) => {
    const { clock, invalidations } = setup(on)
    await spawn($, 'executor', 1)
    const ui = await band($)
    await shows(ui, /thinking/)
    await clock.advance(31 * 60_000)
    await shows(ui, /no signal/)
    await clock.advance(2000)
    const settled = invalidations()
    await clock.advance(30_000)
    expect(invalidations()).toBe(settled) // nothing works, nothing waves: the ticker has stopped

    await $.tool.call({ agentId: 'wa', tool: 'Read', input: { file_path: 'a.ts' } } as never)
    expect(await has(ui, /no signal/)).toBe(false)
    await shows(ui, /Read/)
    await ui.unmount()
  })

  test('a Workflow call lists the run\'s agents under the engine row', async ($, on) => {
    setup(on)
    await spawn($, 'executor', 1)
    await spawn($, 'code-reviewer', 2)
    const ui = await $.ui.mount({ plugin: 'agentille', surface: 'terminal', component: 'ToolUse', requestId: 'tuWf', props: { tool: 'Workflow', tool_use_id: 'tuWf', input: {}, isRunning: true, isErrored: false, isInterrupted: false } as never })
    await shows(ui, /executor/)
    await shows(ui, /code-reviewer/)
    const tree = JSON.stringify(await ui.drawn())
    expect(tree.indexOf('"type":"engine"')).toBeGreaterThanOrEqual(0)
    expect(tree.indexOf('"type":"engine"')).toBeLessThan(tree.indexOf('executor'))
    expect(tree.indexOf('executor')).toBeLessThan(tree.indexOf('code-reviewer'))
    await ui.unmount()
    // an unknown call keeps the engine row alone
    const other = await $.ui.mount({ plugin: 'agentille', surface: 'terminal', component: 'ToolUse', requestId: 'tuNone', props: { tool: 'Workflow', tool_use_id: 'tuNone', input: {}, isRunning: true, isErrored: false, isInterrupted: false } as never })
    expect(await has(other, /executor/)).toBe(false)
    await other.unmount()
  })
})
