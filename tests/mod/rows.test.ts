import { describe, expect, test } from 'claude-code/testing'
import { agentRow } from '../../hooks/rows.js'
import { finish, newAgent } from '../../hooks/live.js'

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
})
