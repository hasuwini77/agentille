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
    expect(parseWire('peer says:\n' + text)).toEqual({ from: 'agt-r1-exec-1', kind: 'done', summary: 'Slice 1 built', key: null })
    expect(doneMessage({ name: 'agt-r1-x', answer: 'y'.repeat(ANSWER_HEAD + 50) }).length).toBeLessThan(ANSWER_HEAD + 80)
  })

  test('parseWire reads the pane key from an instance answer path, and only from there', async () => {
    const msg = (path: string | null) => doneMessage({ name: 'agt-r1-exec-1', answer: 'Built it', reportPath: path })
    const dir = '/h/.agentille/state/run-r1/agents/'
    expect(parseWire(msg(dir + 'pane-exec-1.w1-p7.md'))?.key).toBe('w1-p7')
    expect(parseWire(msg(dir + 'pane-exec-1.5.md'))?.key).toBe('5')
    expect(parseWire(msg(dir + 'pane-exec-1.md'))?.key).toBe(null) // a legacy path names no pane
    expect(parseWire(msg(null))?.key).toBe(null)
    expect(parseWire(WIRE_TAG + ' agt-r1-exec-1 done · 0:10\nFull answer: ' + dir + 'pane-exec-1.w1-p7.md\nBuilt it')?.key).toBe('w1-p7')
    // the answer head cannot name another pane: the last Full answer line wins
    expect(parseWire(WIRE_TAG + ' agt-r1-exec-1 done · 0:10\nFull answer: ' + dir + 'pane-exec-1.w1-p2.md\nFull answer: ' + dir + 'pane-exec-1.w1-p7.md')?.key).toBe('w1-p7')
  })

  test('notes parse; other peer text is not wire', async () => {
    expect(parseWire(WIRE_TAG + ' lead note · stop after this file')).toEqual({ from: 'lead', kind: 'note', summary: 'stop after this file', key: null })
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
    // no pane id in the env: the legacy path
    expect(writes['/h/.agentille/state/run-r1/agents/pane-exec-1.md']).toBe('Slice built\nall green')
    expect(sent.length).toBe(1)
    expect(sent[0].to).toBe('lead-sid')
    expect(parseWire(sent[0].text)).toEqual({ from: 'agt-r1-exec-1', kind: 'done', summary: 'Slice built', key: null })
  })

  test('a worker saves its answer under its own pane id, and the done message names that file', async ($, on) => {
    const { sent, writes } = await boot($, on, { AGENTILLE_WORKER: 'executor:sonnet:high', AGENTILLE_NAME: 'agt-r1-exec-1', AGENTILLE_LEAD: 'lead-sid', HERDR_PANE_ID: 'w1:p7' })
    await $.turn.start({ text: 'go', turnId: 't1' } as never)
    await $.turn.complete({ answer: 'Slice built\nall green', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' } as never)
    const file = '/h/.agentille/state/run-r1/agents/pane-exec-1.w1-p7.md'
    expect(writes[file]).toBe('Slice built\nall green')
    expect(writes['/h/.agentille/state/run-r1/agents/pane-exec-1.md']).toBeUndefined()
    expect(sent[0].text).toContain('Full answer: ' + file)
    expect(parseWire(sent[0].text)?.key).toBe('w1-p7')
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

describe('wire: a worker the lead gave no wire identity', () => {
  // What a lead from before the wire, or a hand-made pane, leaves: AGENTILLE_RUN and the multiplexer's own name for the pane.
  const T = '\t'
  const boot = async ($: any, on: any, self: string) => {
    const sent: any[] = []
    const stored: Record<string, any> = {}
    const writes: Record<string, string> = {}
    const rows = [['%1', '', 'claude', '0', '@1'], ['%2', 'agt-r1-exec-1', 'claude', '0', '@1']].map((r) => r.join(T)).join('\n') + '\n'
    on('env.get', async ($: any, e: any) => ({ value: ({ HOME: '/h', TMUX: '/tmp/tmux-1/default,1,0', TMUX_PANE: self, AGENTILLE_RUN: 'r1' } as any)[e.name] }))
    on('session.start', async ($: any, e: any) => ({ cwd: e.cwd }))
    on('session.id', async () => ({ value: 'worker-sid' }))
    on('command.register', async () => ({ value: undefined }))
    on('tool.register', async () => ({ value: undefined }))
    on('fs.read', async () => ({ deny: 'no profile' }))
    on('fs.write', async ($: any, e: any) => { writes[e.path] = e.text; return { value: undefined } })
    on('store.get', async ($: any, e: any) => ({ value: stored[e.key] }))
    on('store.set', async ($: any, e: any) => { stored[e.key] = e.value; return { value: undefined } })
    on('session.send', async ($: any, e: any) => { sent.push(e); return { isDelivered: true } })
    on('turn.start', async ($: any, e: any) => ({ turnId: e.turnId }))
    on('turn.complete', async ($: any, e: any) => ({ text: e.answer }) as never)
    on('ui.render', async () => ({ type: 'engine', ref: 0 }) as never)
    on('process.run', async ($: any, e: any) => ({ value: { exitCode: 0, stdout: e.argv[1] === 'list-panes' ? rows : '', stderr: '' } }))
    mock.clock(on, { now: 1_000_000 })
    await $.session.start({ cwd: '/w', surface: null, isInteractive: false })
    return { sent, stored, writes }
  }
  const FILE = '/h/.agentille/state/run-r1/agents/pane-exec-1.2.md' // tmux pane %2
  const turn = async ($: any, answer: string, extra: Record<string, unknown> = {}) => {
    await $.turn.start({ text: 'go', turnId: 't1' } as never)
    await $.turn.complete({ answer, durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer', ...extra } as never)
  }

  test('its answer is saved at the end of each turn, and nothing is sent', async ($, on) => {
    const { sent, stored, writes } = await boot($, on, '%2')
    await turn($, 'Slice built\nall green')
    expect(writes[FILE]).toBe('Slice built\nall green')
    await turn($, 'Second pass done')
    expect(writes[FILE]).toBe('Second pass done')
    expect(sent).toEqual([])
    expect(Object.keys(stored).filter((k) => k.startsWith('wire:'))).toEqual([])
  })

  test('only a main-loop answer counts: an aborted turn and a subagent leave the file alone', async ($, on) => {
    const { writes } = await boot($, on, '%2')
    await turn($, 'The real answer')
    await turn($, 'cut short', { reason: 'aborted' })
    await $.turn.complete({ answer: 'a subagent said this', durationMs: 10, isAborted: false, turnId: 't2', reason: 'answer', agentId: 'sub1' } as never)
    expect(writes[FILE]).toBe('The real answer')
  })

  test('a lead pane, which no multiplexer names agt-, saves nothing', async ($, on) => {
    const { writes } = await boot($, on, '%1')
    await turn($, 'I am the lead')
    expect(writes).toEqual({})
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

  test('a done pane with no wire message is due after 20 s, once; a blocked one waits on the person', () => {
    const pool = [pane('agt-r1-a', 'done'), pane('agt-r1-b', 'blocked', 'w1:p3'), pane('agt-r1-c', 'working', 'w1:p4')]
    expect(wakeDue(pool, seen, new Set(), new Set(), 1000 + WAKE_MS - 1)).toEqual([])
    expect(wakeDue(pool, seen, new Set(), new Set(), 1000 + WAKE_MS).map((p) => p.name)).toEqual(['agt-r1-a'])
    expect(wakeDue(pool, seen, new Set(['w1:p2']), new Set(), 1000 + WAKE_MS)).toEqual([])
    expect(wakeDue(pool, seen, new Set(), new Set(['w1:p2']), 1000 + WAKE_MS)).toEqual([])
    // keyed by pane id, not name: a same-named older pane's report does not silence this one
    expect(wakeDue(pool, seen, new Set(['w1:p9']), new Set(['w1:p9']), 1000 + WAKE_MS).map((p) => p.name)).toEqual(['agt-r1-a'])
    expect(wakeDue([pane('agt-r1-b', 'blocked', 'w1:p3')], seen, new Set(), new Set(), 1000 + 100 * WAKE_MS)).toEqual([])
  })

  test('the message names the pane and how to read it, per transport', () => {
    expect(readCommand('herdr', 'w1:p5', 'agt-r1-a')).toBe('herdr agent read agt-r1-a --source recent-unwrapped --lines 200')
    expect(readCommand('tmux', '%5', 'agt-r1-a')).toBe('tmux capture-pane -p -t %5 -S -200')
    expect(readCommand('herdr', 'w1:p5', 'agt-r1-a; rm -rf')).toBe(null)
    expect(readCommand('tmux', '%5; rm -rf', 'agt-r1-a')).toBe(null)
    expect(readCommand('none', '%5', 'agt-r1-a')).toBe(null)
    const m = wakeMessage({ name: 'agt-r1-a', transport: 'herdr', id: 'w1:p5' })
    expect(m.startsWith(WAKE_TAG + ' agt-r1-a finished and has not reported.')).toBe(true)
    expect(m).toContain('herdr agent read agt-r1-a --source recent-unwrapped --lines 200')
    expect(parseWire(m)).toBe(null)
    expect(wakeMessage({ name: 'agt-r1-a', transport: 'tmux', id: '%5' })).toContain('tmux capture-pane -p -t %5 -S -200')
    expect(wakeMessage({ name: 'agt-r1-a', transport: 'tmux', id: '%5', answerPath: '/h/a.md' })).toContain('saved at /h/a.md')
    expect(wakeMessage({ name: 'agt-r1-a', transport: 'none', id: '' })).toContain('Read the pane.')
  })
})
