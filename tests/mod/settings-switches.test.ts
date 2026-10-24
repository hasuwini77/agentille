import { describe, expect, mock, test } from 'claude-code/testing'
import { HELLO_MS } from '../../hooks/mascot.js'

// Each display switch read from a real profile.json, and what it stops drawing. /agt keeps working
// with every switch off: the dispatch is still routed and counted, it only draws nothing.

const PROFILE = '/h/.agentille/profile.json'

const boot = async ($: any, on: any, display: object | null, env: Record<string, string> = {}) => {
  const lines: (string | undefined)[] = []
  let n = 0
  on('env.get', async ($: any, e: any) => ({ value: ({ HOME: '/h', ...env } as any)[e.name] }))
  on('session.start', async ($: any, e: any) => ({ cwd: e.cwd }))
  on('command.register', async () => ({ value: undefined }))
  on('fs.read', async ($: any, e: any) => (display && e.path === PROFILE ? { value: JSON.stringify({ display }) } : { deny: 'ENOENT' }))
  on('fs.write', async () => ({ value: undefined }))
  on('store.get', async () => ({ value: undefined }))
  on('agent.list', async () => ({ value: [] }) as never)
  on('agent.spawn', async () => ({ model: 'claude-opus-5-5', agentId: 'sw' + ++n }))
  on('turn.start', async ($: any, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', async ($: any, e: any) => ({ text: e.answer }) as never)
  on('ui.render', async () => ({ type: 'engine', ref: 0 }) as never)
  on('ui.toast', async () => ({ value: undefined }))
  on('session.measure', async ($: any, e: any) => ({ changed: e.changed }) as never)
  on('ui.status', async ($: any, e: any) => { lines.push(e.text); return { value: undefined } })
  const clock = mock.clock(on, { now: 1_000_000 })
  await $.session.start({ cwd: '/w', surface: null, isInteractive: false })
  return { lines, clock }
}
const review = ($: any, run: string, role = 'code-reviewer') => $.agent.spawn({ prompt: '[agt run=' + run + ' size=large mode=review]\nreview', subagentType: 'agentille:agentille-' + role })
const fail = ($: any, agentId: string) => $.turn.complete({ agentId, answer: 'VERDICT: FAIL\nP0: token logged', durationMs: 10, isAborted: false, turnId: 't' + agentId, reason: 'answer' } as never)
const band = ($: any) => $.ui.mount({ plugin: 'agentille', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 100 } as never })
const deck = ($: any) => $.ui.mount({ plugin: 'agentille', surface: 'terminal', component: 'Pane', requestId: 'agt-deck', props: { title: 'agentille', isFocused: false, bodyColumns: 100, placement: 'dock' } as never })
const has = async (ui: any, re: RegExp) => (await ui.find({ type: 'Text', text: re })) !== undefined
const info = async ($: any) => (await $.command.run({ command: 'agt-info' } as never)).text as string

describe('display.band', () => {
  test('on by default: the run and its flags draw above the prompt', { timeoutMs: 20_000 }, async ($, on) => {
    await boot($, on, null)
    await review($, 'bandon')
    await fail($, 'sw1')
    await review($, 'bandon', 'security-reviewer')
    const ui = await band($)
    expect(await has(ui, /run bandon/)).toBe(true)
    expect(await has(ui, /⚑ code-reviewer: FAIL/)).toBe(true)
    await ui.unmount()
  })

  test('off: nothing above the prompt, flags included, while the run is still routed', { timeoutMs: 20_000 }, async ($, on) => {
    await boot($, on, { band: 'off' })
    await review($, 'bandoff')
    await fail($, 'sw1')
    await review($, 'bandoff', 'security-reviewer')
    const ui = await band($)
    expect(await has(ui, /run bandoff/)).toBe(false)
    expect(await has(ui, /security-reviewer/)).toBe(false)
    expect(await has(ui, /⚑/)).toBe(false)
    await ui.unmount()
    expect(await info($)).toMatch(/band\s+off\s+profile/)
    expect(await info($)).toContain('routing: 2 dispatches')
  })
})

describe('display.statusLine', () => {
  const measure = ($: any) => $.session.measure({ context: { window: 200_000, percent: 42 }, rateLimits: [], changed: ['context'], cost: { usd: 1 } } as never)

  test('on by default: an /agt run pins its line', { timeoutMs: 20_000 }, async ($, on) => {
    const { lines } = await boot($, on, null)
    await review($, 'stat1')
    await measure($)
    expect(lines.at(-1)).toContain('agt stat1')
  })

  test('off: no line is ever pinned, and a leftover one is cleared', { timeoutMs: 20_000 }, async ($, on) => {
    const { lines, clock } = await boot($, on, { statusLine: 'off' })
    await review($, 'stat2')
    await measure($)
    await fail($, 'sw1')
    await measure($)
    await clock.advance(5_000)
    expect(lines.filter((l) => l !== undefined)).toEqual([])
    expect(await info($)).toMatch(/statusLine\s+off\s+profile/)
  })
})

describe('display.mascot', () => {
  const begin = ($: any) => $.turn.start({ text: 'go', turnId: 't1' })

  test('on by default: a worker band draws the figure and its hello', { timeoutMs: 20_000 }, async ($, on) => {
    await boot($, on, null, { AGENTILLE_WORKER: 'executor:sonnet:high' })
    const ui = await band($)
    await begin($)
    expect(await has(ui, /▝▜█████▛▘/)).toBe(true)
    expect(await has(ui, /hi! executor/)).toBe(true)
    await ui.unmount()
  })

  test('off: a worker band keeps its one-line caption and draws no figure, no hello', { timeoutMs: 20_000 }, async ($, on) => {
    const { clock } = await boot($, on, { mascot: 'off' }, { AGENTILLE_WORKER: 'executor:sonnet:high' })
    const ui = await band($)
    await begin($)
    expect(await has(ui, /▝▜█████▛▘/)).toBe(false)
    expect(await has(ui, /▟▛███▜▙/)).toBe(false)
    expect(await has(ui, /hi!/)).toBe(false)
    expect(await has(ui, /executor · working/)).toBe(true)
    await clock.advance(HELLO_MS + 1)
    expect(await has(ui, /▝▜█████▛▘/)).toBe(false)
    await ui.unmount()
  })

  test('off: the deck lists the cast by role and model, without the figures', { timeoutMs: 20_000 }, async ($, on) => {
    await boot($, on, { mascot: 'off' })
    await review($, 'deckm', 'planner')
    const ui = await deck($)
    expect(await has(ui, /planner/)).toBe(true)
    expect(await has(ui, /▝▜█████▛▘/)).toBe(false)
    await ui.unmount()
  })
})
