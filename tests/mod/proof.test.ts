import { describe, expect, mock, test } from 'claude-code/testing'

// The dispatch header is the model's own text. What the person typed is the proof the mod keeps:
// --fable on the /agt line is the only thing that makes fable=forced hold on a subagent dispatch.
describe('typed proof: in the mod', () => {
  const setup = (on: any) => {
    const spawned: any[] = []
    const toasts: string[] = []
    on('store.get', async () => ({ value: undefined }))
    on('store.set', async () => ({ value: undefined }))
    on('ui.panes', async () => ({ value: [] }))
    on('ui.toast', async ($: any, e: any) => { toasts.push(e.text ?? String(e)); return { value: undefined } })
    on('ui.render', async () => ({ type: 'engine', ref: 0 }) as never)
    on('prompt.submit', async ($: any, e: any) => ({ text: e.text }))
    on('fs.read', async () => ({ deny: 'no profile' }))
    on('fs.write', async () => ({ value: undefined }))
    on('agent.spawn', async ($: any, e: any) => { spawned.push(e); return { model: e.model ?? 'sonnet', agentId: 'p' + spawned.length } })
    mock.clock(on, { now: 1_000_000 })
    return { spawned, toasts }
  }
  const HDR = '[agt run=pf1 size=large mode=build fable=forced]'
  const plan = ($: any) => $.agent.spawn({ prompt: HDR + '\nplan it', subagentType: 'agentille:agentille-planner', model: 'opus' })

  test('fable=forced with no typed --fable runs the ladder and says so once', async ($, on) => {
    const { spawned, toasts } = setup(on)
    await $.prompt.submit({ text: '/agt ship it', origin: { kind: 'composer' } } as never)
    await plan($)
    await plan($)
    expect(spawned.map((e) => e.model)).toEqual(['opus', 'opus'])
    expect(spawned[0].prompt.split('\n')[0]).toBe('[agt run=pf1 size=large mode=build fable=auto]')
    expect(toasts.filter((t) => t.includes('fable=forced dropped'))).toHaveLength(1)
  })

  test('a typed --fable makes the same header hold', async ($, on) => {
    const { spawned, toasts } = setup(on)
    await $.prompt.submit({ text: '/agt --fable ship it', origin: { kind: 'composer' } } as never)
    await plan($)
    expect(spawned[0].model).toBe('fable')
    expect(spawned[0].prompt.split('\n')[0]).toBe(HDR)
    expect(toasts.some((t) => t.includes('fable=forced dropped'))).toBe(false)
  })

  test('the proof is per typed /agt: the next one without --fable drops it again', async ($, on) => {
    const { spawned } = setup(on)
    await $.prompt.submit({ text: '/agt --fable ship it', origin: { kind: 'composer' } } as never)
    await plan($)
    await $.prompt.submit({ text: '/agt ship the rest', origin: { kind: 'composer' } } as never)
    await plan($)
    expect(spawned.map((e) => e.model)).toEqual(['fable', 'opus'])
  })
})
