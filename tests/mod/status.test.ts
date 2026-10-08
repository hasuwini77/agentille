import { describe, expect, mock, test } from 'claude-code/testing'
import { DONE_GRACE_MS } from '../../hooks/live.js'
import { statusText } from '../../hooks/status.js'

const base = { run: 'r1', subs: 2, panes: 1, done: 3, tok: 12_300, usd: null, ctxPct: null, lastLeftAt: 0, now: 1000 }

describe('status: the line', () => {
  test('counts, tokens, then the measured session cost and context when known', async () => {
    expect(statusText(base)).toBe('agt r1 · ◇2 ▣1 working · 3 done · 12.3k tok')
    expect(statusText({ ...base, usd: 1.5, ctxPct: 41.6 })).toBe('agt r1 · ◇2 ▣1 working · 3 done · 12.3k tok · $1.50 session · ctx 42%')
    expect(statusText({ ...base, ctxPct: 7 })).toBe('agt r1 · ◇2 ▣1 working · 3 done · 12.3k tok · ctx 7%')
  })

  test('cleared once nothing works and every finished agent is past the grace', async () => {
    const idle = { ...base, subs: 0, panes: 0, lastLeftAt: 10_000 }
    expect(statusText({ ...idle, now: 10_000 + DONE_GRACE_MS - 1 })).toContain('3 done')
    expect(statusText({ ...idle, now: 10_000 + DONE_GRACE_MS })).toBeUndefined()
    expect(statusText({ ...idle, done: 0, lastLeftAt: null, now: 10_000 })).toBeUndefined()
    expect(statusText({ ...idle, panes: 1, now: 10_000 + DONE_GRACE_MS * 5 })).toBeDefined()
  })
})

describe('status: in the mod', () => {
  const boot = async ($: any, on: any) => {
    const lines: (string | undefined)[] = []
    let n = 0
    on('env.get', async ($: any, e: any) => ({ value: ({ HOME: '/h' } as any)[e.name] }))
    on('session.start', async ($: any, e: any) => ({ cwd: e.cwd }))
    on('command.register', async () => ({ value: undefined }))
    on('fs.read', async () => ({ deny: 'no profile' }))
    on('fs.write', async () => ({ value: undefined }))
    on('store.get', async () => ({ value: undefined }))
    on('agent.list', async () => ({ value: [] }) as never)
    on('agent.spawn', async () => ({ model: 'claude-sonnet-5', agentId: 'st' + ++n }))
    on('turn.complete', async ($: any, e: any) => ({ text: e.answer }) as never)
    on('ui.render', async () => ({ type: 'engine', ref: 0 }) as never)
    on('session.measure', async ($: any, e: any) => ({ changed: e.changed }) as never)
    on('ui.status', async ($: any, e: any) => { lines.push(e.text); return { value: undefined } })
    const clock = mock.clock(on, { now: Date.now() })
    await $.session.start({ cwd: '/w', surface: null, isInteractive: false })
    return { lines, clock }
  }
  const measure = ($: any, over: object = {}) => $.session.measure({ context: { window: 200_000, percent: 42 }, rateLimits: [], changed: ['context'], ...over } as never)
  const mount = ($: any) => $.ui.mount({ plugin: 'agentille', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 100 } as never })
  const done = ($: any, agentId: string) => $.turn.complete({ agentId, answer: 'APPROVE', durationMs: 10, isAborted: false, turnId: 't' + agentId, reason: 'answer', usage: { input_tokens: 1200, output_tokens: 300 } } as never)
  const review = ($: any, run: string) => $.agent.spawn({ prompt: '[agt run=' + run + ' size=large mode=review]\nreview', subagentType: 'agentille:agentille-code-reviewer' })

  test('pins the run, with the measured session cost and no per-agent dollars', async ($, on) => {
    const { lines } = await boot($, on)
    await review($, 'statrun')
    const ui = await mount($)
    await measure($, { cost: { usd: 1.254 } })
    expect(lines.at(-1)).toBe('agt statrun · ◇1 ▣0 working · 0 done · 0 tok · $1.25 session · ctx 42%')
    await done($, 'st1')
    await measure($, { cost: { usd: 1.254 } })
    expect(lines.at(-1)).toBe('agt statrun · ◇0 ▣0 working · 1 done · 1.5k tok · $1.25 session · ctx 42%')
    for (const l of lines) if (l) expect(l.replace(/\$\d+\.\d\d session/, '')).not.toContain('$')
    await ui.unmount()
  })

  test('without a measured cost there is no dollar figure at all', async ($, on) => {
    const { lines } = await boot($, on)
    await review($, 'nocost')
    const ui = await mount($)
    await measure($)
    expect(lines.at(-1)).toBe('agt nocost · ◇1 ▣0 working · 0 done · 0 tok · ctx 42%')
    expect(lines.some((l) => l?.includes('$'))).toBe(false)
    await ui.unmount()
  })

  test('the line clears when the grace runs out: held mid-grace, gone after', async ($, on) => {
    const { lines, clock } = await boot($, on)
    await review($, 'gracerun')
    await done($, 'st1')
    const ui = await mount($)
    await clock.advance(0)
    expect(lines.at(-1)).toContain('1 done')
    await clock.advance(DONE_GRACE_MS - 5000)
    expect(lines.at(-1)).toContain('1 done')
    await clock.advance(7000) // past DONE_GRACE_MS + the timer's half-second margin
    expect(lines.at(-1)).toBeUndefined()
    await ui.unmount()
  })
})
