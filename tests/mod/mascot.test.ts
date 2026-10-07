import { describe, expect, mock, test } from 'claude-code/testing'
import { ACCESSORY, BYE_MS, HELLO_MS, MASCOT_COLOR, MODEL_COLOR, agentMood, caption, frame, modelKey, moodAt, parseWorker } from '../../hooks/mascot.js'
import { herdrSplitArgv, tmuxSplitArgv, workerEnv } from '../../hooks/panes.js'

describe('mascot frames', () => {
  test('three rows, the same head and body in every mood', async () => {
    for (const mood of ['hi', 'working', 'bye']) {
      const f = frame(mood, 0)
      expect(f.length).toBe(3)
      expect(f[0].startsWith('  ▐▛███▜▌')).toBe(true)
      expect(f[1]).toBe(' ▝▜█████▛▘')
    }
  })

  test('hello raises one arm, bye the other, working neither', async () => {
    expect(frame('hi')[0]).toBe('  ▐▛███▜▌ ╱')
    expect(frame('bye')[0]).toBe('  ▐▛███▜▌ ╲')
    expect(frame('working')[0]).toBe('  ▐▛███▜▌')
  })

  test('the legs alternate on every tick while working, and rest in hi and bye', async () => {
    expect(frame('working', 0)[2]).toBe('   ▘▘ ▝▝')
    expect(frame('working', 1)[2]).toBe('   ▝▝ ▘▘')
    expect(frame('working', 2)[2]).toBe(frame('working', 0)[2])
    expect(frame('hi', 1)[2]).toBe('   ▘▘ ▝▝')
    expect(frame('bye', 1)[2]).toBe('   ▘▘ ▝▝')
  })

  test('captions per mood', async () => {
    const w = { agent: 'executor', model: 'sonnet', effort: 'high' }
    expect(caption({ mood: 'hi', ...w })).toBe('hi! executor · sonnet · high')
    expect(caption({ mood: 'working', ...w, ms: 102_000 })).toBe('executor · working 1:42')
    expect(caption({ mood: 'bye', ...w, ms: 187_000 })).toBe('bye! ✓ done 3:07')
    expect(caption({ mood: 'idle', ...w, ms: 187_000 })).toBe('executor · sonnet · high · done 3:07')
    expect(caption({ mood: 'idle', agent: 'spawn', model: 'haiku', effort: '' })).toBe('spawn · haiku')
  })

  test('colors: the mascot is orange, models keep their own', async () => {
    expect(MASCOT_COLOR).toBe(0xd97757)
    expect(modelKey('claude-opus-5-5')).toBe('opus')
    expect(modelKey(undefined)).toBe('other')
    expect(MODEL_COLOR[modelKey('sonnet')]).toBe(0x4f8ef7)
  })
})

describe('mood', () => {
  test('hi outranks working until it is over, then bye, then working or idle', async () => {
    const o = { hiUntil: 100, byeUntil: 300, working: true }
    expect(moodAt({ ...o, now: 50 })).toBe('hi')
    expect(moodAt({ ...o, now: 100 })).toBe('bye')
    expect(moodAt({ ...o, now: 300 })).toBe('working')
    expect(moodAt({ ...o, working: false, now: 300 })).toBe('idle')
    expect(moodAt({ now: 0 })).toBe('idle')
    expect(HELLO_MS).toBe(2400)
    expect(BYE_MS).toBe(2400)
  })

  test('the worker env: agent:model:effort, strict about its shape', async () => {
    expect(parseWorker('executor:sonnet:high')).toEqual({ agent: 'executor', model: 'sonnet', effort: 'high' })
    expect(parseWorker('spawn:haiku:')).toEqual({ agent: 'spawn', model: 'haiku', effort: '' })
    for (const bad of [undefined, '', 'executor', 'Exec:sonnet:high', ':sonnet:', 'executor::high', 'a b:c:d']) expect(parseWorker(bad)).toBe(null)
  })
})

describe('accessories', () => {
  test('a role swaps one row and keeps the arm, the legs and the width', async () => {
    expect(frame('hi', 0, 'executor')).toEqual(['  ▟▛███▜▙ ╱', ' ▝▜█████▛▘', '   ▘▘ ▝▝'])
    expect(frame('bye', 0, 'code-reviewer')[0]).toBe('  ▐▛○─○▜▌ ╲')
    expect(frame('working', 1, 'security-reviewer')).toEqual(['  ▐▛███▜▌', ' ▝▜█▚▄▞█▛▘', '   ▝▝ ▘▘'])
    expect(frame('hi', 0, 'adversary')[0]).toBe(' ◥▐▛███▜▌◤ ╱')
    expect(frame('working', 0, 'seo-reviewer')).toEqual(frame('working', 0))
    expect(frame('working', 0, 'toString')).toEqual(frame('working', 0))
    const plain = frame('working', 0)
    for (const [role, wear] of Object.entries(ACCESSORY)) {
      const f = frame('working', 0, role)
      expect([...f[1]].length).toBe([...plain[1]].length)
      expect([...f[0]].length).toBeLessThanOrEqual([...plain[0]].length + 1)
      expect(Object.keys(wear).every((k) => k === 'head' || k === 'body')).toBe(true)
    }
  })
})

describe('lead band mascots', () => {
  test('a subagent says hi, then works, then waves bye', async () => {
    const a = { state: 'working', start: 1000 }
    expect(agentMood(a, 1000)).toBe('hi')
    expect(agentMood(a, 1000 + HELLO_MS - 1)).toBe('hi')
    expect(agentMood(a, 1000 + HELLO_MS)).toBe('working')
    expect(agentMood({ state: 'done', start: 1000 }, 99_999)).toBe('bye')
  })
})

describe('worker env at split time', () => {
  test('both transports carry AGENTILLE_WORKER', async () => {
    const w = { agent: 'executor', model: 'sonnet', effort: 'high' }
    expect(workerEnv(w)).toBe('AGENTILLE_WORKER=executor:sonnet:high')
    expect(workerEnv({ model: 'haiku' })).toBe('AGENTILLE_WORKER=spawn:haiku:')
    expect(workerEnv({ ...w, effort: 'turbo' })).toBe('AGENTILLE_WORKER=executor:sonnet:')
    const h = herdrSplitArgv({ pane: 'w1:p1', cwd: '/w', run: 'ab12cd', ...w })
    expect(h[h.indexOf('AGENTILLE_WORKER=executor:sonnet:high') - 1]).toBe('--env')
    const t = tmuxSplitArgv({ target: '%1', cwd: '/w', run: 'ab12cd', shell: '/bin/zsh', name: 'agt-ab12cd-exec-1', task: 't', ...w })
    expect(t[t.indexOf('AGENTILLE_WORKER=executor:sonnet:high') - 1]).toBe('-e')
  })
})

describe('worker band', () => {
  const setup = (on: any, worker: string | undefined) => {
    on('env.get', async ($: any, e: any) => ({ value: ({ AGENTILLE_WORKER: worker } as any)[e.name] }))
    on('session.start', async ($: any, e: any) => ({ cwd: e.cwd }))
    on('command.register', async () => ({ value: undefined }))
    on('fs.read', async () => ({ deny: 'no profile' }))
    on('store.get', async () => ({ value: undefined }))
    on('turn.start', async ($: any, e: any) => ({ turnId: e.turnId }))
    on('turn.complete', async ($: any, e: any) => ({ text: e.answer }))
    on('ui.render', async () => ({ type: 'engine', ref: 0 }) as never)
    let invalidations = 0
    on('ui.invalidate', async ($: any, e: any, next: any) => { invalidations++; return next(e) })
    const clock = mock.clock(on, { now: 1_000_000 })
    return { clock, invalidations: () => invalidations }
  }
  const mount = ($: any, over: object = {}, surface = 'terminal') => $.ui.mount({ plugin: 'agentille', surface, component: 'AbovePrompt', props: { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 100, ...over } as never })
  const start = ($: any) => $.session.start({ cwd: '/w', surface: null, isInteractive: false })
  const begin = ($: any) => $.turn.start({ text: 'go', turnId: 't1' })
  const finish = ($: any, reason = 'answer') => $.turn.complete({ answer: 'done', durationMs: 10, isAborted: false, turnId: 't1', reason })
  const has = async (ui: any, re: RegExp) => (await ui.find({ type: 'Text', text: re })) !== undefined
  const shows = async (ui: any, re: RegExp) => { if (!(await has(ui, re))) throw new Error(String(re) + ' not drawn: ' + JSON.stringify(await ui.drawn())) }

  test('hi on the first turn, legs step while it works, bye on the answer, then a plain caption, then silence', async ($, on) => {
    const { clock, invalidations } = setup(on, 'executor:sonnet:high')
    await start($)
    const ui = await mount($)
    await shows(ui, /^executor · sonnet · high$/)
    expect(await has(ui, /hi!/)).toBe(false)

    await begin($)
    await shows(ui, /hi! executor · sonnet · high/)
    await shows(ui, /▟▛███▜▙ ╱/)
    await shows(ui, /▝▜█████▛▘/)

    await clock.advance(HELLO_MS + 1)
    expect(await has(ui, /hi!/)).toBe(false)
    await shows(ui, /executor · working 0:0\d/)
    const legs = async () => ((await has(ui, /▘▘ ▝▝/)) ? 'a' : (await has(ui, /▝▝ ▘▘/)) ? 'b' : '?')
    const seen = new Set<string>()
    for (let i = 0; i < 4; i++) {
      seen.add(await legs())
      await clock.advance(600)
    }
    expect([...seen].sort()).toEqual(['a', 'b'])

    await clock.advance(60_000)
    await shows(ui, /executor · working 1:\d\d/)
    await finish($)
    await shows(ui, /bye! ✓ done 1:/)
    await shows(ui, /▟▛███▜▙ ╲/)

    await clock.advance(BYE_MS + 600)
    expect(await has(ui, /bye!/)).toBe(false)
    expect(await has(ui, /▝▜█████▛▘/)).toBe(false)
    await shows(ui, /^executor · sonnet · high · done 1:/)

    await clock.advance(1200)
    const settled = invalidations()
    await clock.advance(30_000)
    expect(invalidations()).toBe(settled)
    await ui.unmount()
  })

  test('hello plays once: a second turn goes straight to working', async ($, on) => {
    const { clock } = setup(on, 'executor:sonnet:high')
    await start($)
    const ui = await mount($)
    await begin($)
    await clock.advance(HELLO_MS + BYE_MS)
    await finish($)
    await clock.advance(BYE_MS + 600)
    await begin($)
    expect(await has(ui, /hi!/)).toBe(false)
    await shows(ui, /executor · working/)
    await ui.unmount()
  })

  test('an interrupted turn does not say bye', async ($, on) => {
    const { clock } = setup(on, 'executor:sonnet:high')
    await start($)
    const ui = await mount($)
    await begin($)
    await clock.advance(HELLO_MS + 1)
    await finish($, 'aborted')
    expect(await has(ui, /bye!/)).toBe(false)
    await shows(ui, /^executor · sonnet · high · done/)
    await ui.unmount()
  })

  test('a short band or a non-terminal surface shows the caption alone', async ($, on) => {
    const { clock } = setup(on, 'executor:opus:xhigh')
    await start($)
    await begin($)
    await clock.advance(HELLO_MS + 1)
    const short = await mount($, { maxRows: 4 })
    await shows(short, /executor · working/)
    expect(await has(short, /▝▜█████▛▘/)).toBe(false)
    await short.unmount()
    const desktop = await mount($, {}, 'desktop')
    await shows(desktop, /executor · working/)
    expect(await has(desktop, /▝▜█████▛▘/)).toBe(false)
    await desktop.unmount()
  })

  test('a session with no AGENTILLE_WORKER draws no mascot and runs no timer', async ($, on) => {
    const { clock, invalidations } = setup(on, undefined)
    await start($)
    const ui = await mount($)
    await begin($)
    await clock.advance(10_000)
    await finish($)
    expect(await has(ui, /▝▜█████▛▘/)).toBe(false)
    expect(invalidations()).toBe(0)
    await ui.unmount()
  })
})
