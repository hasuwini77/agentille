import { describe, expect, test } from 'claude-code/testing'
import { ANSWER_HEAD, LOG_MAX, WIRE_TAG, doneMessage, freshStatus, logWire, parseTellArgs, parseWire, shortName, statusKey, validLead, wakeDue, wakeMessage, readCommand, WAKE_MS, WAKE_TAG, wireEnv, workerStatus } from '../../hooks/wire.js'

describe('wire', () => {
  test('a worker gets its name and the lead session as env; junk is dropped', async () => {
    expect(wireEnv({ name: 'agt-r1-exec-1', lead: 'abc-123' })).toEqual(['AGENTILLE_NAME=agt-r1-exec-1', 'AGENTILLE_LEAD=abc-123'])
    expect(wireEnv({ name: 'exec-1; rm', lead: 'a b' })).toEqual([])
    expect(validLead('x'.repeat(129))).toBe(null)
  })

  test('status is trusted only when recent and for the pane it was read for', async () => {
    const s = workerStatus({ name: 'agt-r1-exec-1', state: 'working', tool: 'Edit A', now: 1000 })
    expect(freshStatus(s, 'agt-r1-exec-1', 2000)).toBe(true)
    expect(freshStatus(s, 'agt-r1-exec-2', 2000)).toBe(false)
    expect(freshStatus(s, 'agt-r1-exec-1', 1000 + 7 * 3_600_000)).toBe(false)
    expect(freshStatus(null, 'x', 0)).toBe(false)
    expect(statusKey('agt-r1-exec-1')).toBe('wire:agt-r1-exec-1')
  })

  test('a done message carries the head of the answer and round-trips through parseWire', async () => {
    const text = doneMessage({ name: 'agt-r1-exec-1', ms: 102_000, model: 'sonnet', effort: 'high', tok: 31_200, answer: '## Slice 1 built\n4 files, tests green', reportPath: '/h/.agentille/state/run-r1/agents/pane-exec-1.md' })
    expect(text.startsWith(WIRE_TAG + ' agt-r1-exec-1 done · 1:42 · sonnet high · 31.2k tok')).toBe(true)
    expect(text).toContain('Full answer: /h/.agentille/state/run-r1/agents/pane-exec-1.md')
    expect(parseWire('peer says:\n' + text)).toEqual({ from: 'agt-r1-exec-1', kind: 'done', summary: 'Slice 1 built' })
    expect(doneMessage({ name: 'agt-r1-x', answer: 'y'.repeat(ANSWER_HEAD + 50) }).length).toBeLessThan(ANSWER_HEAD + 80)
  })

  test('notes parse; other peer text is not wire', async () => {
    expect(parseWire(WIRE_TAG + ' lead note · stop after this file')).toEqual({ from: 'lead', kind: 'note', summary: 'stop after this file' })
    expect(parseWire('hello there')).toBe(null)
    expect(parseWire(WIRE_TAG + ' garbage')).toBe(null)
  })

  test('short names, capped log', async () => {
    expect(shortName('agt-r1-exec-1')).toBe('exec-1')
    expect(shortName('lead')).toBe('lead')
    const log: any[] = []
    for (let i = 0; i < LOG_MAX + 5; i++) logWire(log, { at: i })
    expect(log.length).toBe(LOG_MAX)
    expect(log[0].at).toBe(5)
  })

  test('/agt-tell resolves a worker by role or full name, refusing unknown and ambiguous ones', async () => {
    const panes = [{ name: 'agt-r1-exec-1' }, { name: 'agt-r2-exec-1' }, { name: 'agt-r1-review' }]
    expect(parseTellArgs('review "check the webhook"', panes)).toEqual({ name: 'agt-r1-review', text: 'check the webhook' })
    expect(parseTellArgs('agt-r2-exec-1 stop', panes)).toEqual({ name: 'agt-r2-exec-1', text: 'stop' })
    expect(parseTellArgs('exec-1 stop', panes).error).toContain('matches 2')
    expect(parseTellArgs('nobody hi', panes).error).toContain('No worker named nobody')
    expect(parseTellArgs('', panes).usage).toBeTruthy()
  })
})

import { mock } from 'claude-code/testing'

describe('wire: in the mod', () => {
  const boot = async ($: any, on: any, env: Record<string, string>) => {
    const sent: any[] = []
    const stored: Record<string, any> = {}
    const writes: Record<string, string> = {}
    on('env.get', async ($: any, e: any) => ({ value: ({ HOME: '/h', ...env } as any)[e.name] }))
    on('session.start', async ($: any, e: any) => ({ cwd: e.cwd }))
    on('session.id', async () => ({ value: 'worker-sid' }))
    on('command.register', async () => ({ value: undefined }))
    on('fs.read', async () => ({ deny: 'no profile' }))
    on('fs.write', async ($: any, e: any) => { writes[e.path] = e.text; return { value: undefined } })
    on('store.get', async ($: any, e: any) => ({ value: stored[e.key] }))
    on('store.set', async ($: any, e: any) => { stored[e.key] = e.value; return { value: undefined } })
    on('session.send', async ($: any, e: any) => { sent.push(e); return { isDelivered: true } })
    on('turn.start', async ($: any, e: any) => ({ turnId: e.turnId }))
    on('session.receive', async ($: any, e: any) => ({ text: e.text }) as never)
    on('turn.complete', async ($: any, e: any) => ({ text: e.answer }) as never)
    on('ui.render', async () => ({ type: 'engine', ref: 0 }) as never)
    mock.clock(on, { now: 1_000_000 })
    await $.session.start({ cwd: '/w', surface: null, isInteractive: false })
    return { sent, stored, writes }
  }

  test('a worker publishes its status and reports its answer to the lead', async ($, on) => {
    const { sent, stored, writes } = await boot($, on, { AGENTILLE_WORKER: 'executor:sonnet:high', AGENTILLE_NAME: 'agt-r1-exec-1', AGENTILLE_LEAD: 'lead-sid' })
    expect(stored['wire:agt-r1-exec-1']).toMatchObject({ name: 'agt-r1-exec-1', session: 'worker-sid' })
    await $.turn.start({ text: 'go', turnId: 't1' } as never)
    expect(stored['wire:agt-r1-exec-1'].state).toBe('working')
    await $.turn.complete({ answer: 'Slice built\nall green', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' } as never)
    expect(stored['wire:agt-r1-exec-1'].state).toBe('done')
    expect(writes['/h/.agentille/state/run-r1/agents/pane-exec-1.md']).toBe('Slice built\nall green')
    expect(sent.length).toBe(1)
    expect(sent[0].to).toBe('lead-sid')
    expect(parseWire(sent[0].text)).toEqual({ from: 'agt-r1-exec-1', kind: 'done', summary: 'Slice built' })
  })

  test('a worker tool call does not wait on the status publish', async ($, on) => {
    let release: () => void = () => {}
    let gate = false
    const stored: Record<string, any> = {}
    on('env.get', async ($: any, e: any) => ({ value: ({ HOME: '/h', AGENTILLE_WORKER: 'executor:sonnet:high', AGENTILLE_NAME: 'agt-r1-exec-1', AGENTILLE_LEAD: 'lead-sid' } as any)[e.name] }))
    on('session.start', async ($: any, e: any) => ({ cwd: e.cwd }))
    on('session.id', async () => ({ value: 'worker-sid' }))
    on('command.register', async () => ({ value: undefined }))
    on('fs.read', async () => ({ deny: 'no profile' }))
    on('store.get', async () => ({ value: undefined }))
    on('store.set', async ($: any, e: any) => {
      if (gate) await new Promise<void>((r) => { release = r })
      stored[e.key] = e.value
      return { value: undefined }
    })
    on('tool.call', async () => ({ result: {}, text: 'ok' }) as never)
    on('ui.render', async () => ({ type: 'engine', ref: 0 }) as never)
    const clock = mock.clock(on, { now: 1_000_000 })
    await $.session.start({ cwd: '/w', surface: null, isInteractive: false })
    await clock.advance(5000)
    await new Promise((r) => setTimeout(r, 1100)) // the publish throttle reads Date.now()
    gate = true
    await $.tool.call({ tool: 'Read', input: { file_path: 'a.ts' } } as never)
    expect(stored['wire:agt-r1-exec-1'].tool).toBeNull()
    gate = false
    release()
    await clock.advance(0)
    expect(stored['wire:agt-r1-exec-1'].tool).toMatch(/Read/)
  })

  test('a session that is not a worker never publishes or reports', async ($, on) => {
    const { sent, stored } = await boot($, on, {})
    await $.turn.start({ text: 'go', turnId: 't1' } as never)
    await $.turn.complete({ answer: 'hi', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' } as never)
    expect(sent).toEqual([])
    expect(Object.keys(stored).filter((k) => k.startsWith('wire:'))).toEqual([])
  })

  test('the lead logs a worker result on the band and still lets the model read it', async ($, on) => {
    await boot($, on, {})
    const text = doneMessage({ name: 'agt-r1-exec-1', ms: 1000, answer: 'Slice built' })
    const r = await $.session.receive({ text, origin: { kind: 'peer' } } as never)
    expect(r.consumed).toBeUndefined()
    const ui = await $.ui.mount({ plugin: 'agentille', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100 } as never })
    expect(await ui.find({ type: 'Text', text: /⇄ exec-1 → lead/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Slice built/ })).toBeDefined()
    await ui.unmount()
  })
})

describe('deck: unplaced', () => {
  test('/agt-deck says the deck waits when the surface does not place it', async ($, on) => {
    on('env.get', async () => ({ value: undefined }))
    on('session.start', async ($: any, e: any) => ({ cwd: e.cwd }))
    on('command.register', async () => ({ value: undefined }))
    on('fs.read', async () => ({ deny: 'no profile' }))
    on('store.get', async () => ({ value: undefined }))
    on('store.set', async () => ({ value: undefined }))
    on('ui.open', async () => ({ value: { isPlaced: false, reason: 'terminal too narrow' } }) as never)
    on('ui.render', async () => ({ type: 'engine', ref: 0 }) as never)
    await $.session.start({ cwd: '/w', surface: null, isInteractive: false })
    const r = await $.command.run({ command: 'agt-deck', args: 'auto', origin: { kind: 'composer' } } as never)
    expect(r.text).toBe('deck waits: terminal too narrow · opens on every /agt (/agt-deck off to stop)')
  })
})

describe('deck', () => {
  test('/agt-deck opens the pane, auto is remembered, and the pane draws routing', async ($, on) => {
    const stored: Record<string, any> = {}
    const opened: string[] = []
    on('env.get', async () => ({ value: undefined }))
    on('session.start', async ($: any, e: any) => ({ cwd: e.cwd }))
    on('command.register', async () => ({ value: undefined }))
    on('fs.read', async () => ({ deny: 'no profile' }))
    on('store.get', async ($: any, e: any) => ({ value: stored[e.key] }))
    on('store.set', async ($: any, e: any) => { stored[e.key] = e.value; return { value: undefined } })
    on('ui.open', async ($: any, e: any) => { opened.push(e.id); return { value: { isOpen: true } } as never })
    on('agent.spawn', async () => ({ model: 'claude-opus-5-5', agentId: 'd1' }))
    on('ui.render', async () => ({ type: 'engine', ref: 0 }) as never)
    await $.session.start({ cwd: '/w', surface: null, isInteractive: false })
    const r = await $.command.run({ command: 'agt-deck', args: 'auto', origin: { kind: 'composer' } } as never)
    expect(r.text).toContain('opens on every /agt')
    expect(stored['deck:auto']).toBe(true)
    expect(opened).toEqual(['agt-deck'])
    await $.agent.spawn({ prompt: '[agt run=deckrun size=large mode=review]\nreview', subagentType: 'agentille:agentille-planner' })
    const ui = await $.ui.mount({ plugin: 'agentille', surface: 'terminal', component: 'Pane', requestId: 'agt-deck', props: { title: 'agentille', isFocused: false, bodyColumns: 100, placement: 'dock' } as never })
    expect(await ui.find({ type: 'Text', text: /── routing/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /planner/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /▝▜█████▛▘/ })).toBeDefined()
    await ui.unmount()
    expect((await $.command.run({ command: 'agt-deck', args: 'off', origin: { kind: 'composer' } } as never)).text).toContain('only when you type')
    expect(stored['deck:auto']).toBe(false)
  })
})

describe('wire: lead self-wake', () => {
  const pane = (name: string, state: string, id = 'w1:p2') => ({ id, name, state })
  const seen = new Map([['w1:p2', { since: 1000 }], ['w1:p3', { since: 1000 }]])

  test('a done or blocked pane with no wire message is due after 20 s, once', () => {
    const pool = [pane('agt-r1-a', 'done'), pane('agt-r1-b', 'blocked', 'w1:p3'), pane('agt-r1-c', 'working', 'w1:p4')]
    expect(wakeDue(pool, seen, new Set(), new Set(), 1000 + WAKE_MS - 1)).toEqual([])
    expect(wakeDue(pool, seen, new Set(), new Set(), 1000 + WAKE_MS).map((p) => p.name)).toEqual(['agt-r1-a', 'agt-r1-b'])
    expect(wakeDue(pool, seen, new Set(['agt-r1-a']), new Set(['agt-r1-b']), 1000 + WAKE_MS)).toEqual([])
  })

  test('the message names the pane and how to read it, per transport', () => {
    expect(readCommand('herdr', 'w1:p5')).toBe('herdr pane read w1:p5 --lines 200')
    expect(readCommand('tmux', '%5')).toBe('tmux capture-pane -p -t %5 -S -200')
    expect(readCommand('herdr', 'w1:p5; rm -rf')).toBe(null)
    const m = wakeMessage({ name: 'agt-r1-a', state: 'done', transport: 'herdr', id: 'w1:p5' })
    expect(m.startsWith(WAKE_TAG + ' agt-r1-a finished and has not reported.')).toBe(true)
    expect(m).toContain('herdr pane read w1:p5 --lines 200')
    expect(parseWire(m)).toBe(null)
    expect(wakeMessage({ name: 'agt-r1-a', state: 'blocked', transport: 'tmux', id: '%5' })).toContain('needs the person')
    expect(wakeMessage({ name: 'agt-r1-a', state: 'done', transport: 'tmux', id: '%5', answerPath: '/h/a.md' })).toContain('saved at /h/a.md')
  })
})
