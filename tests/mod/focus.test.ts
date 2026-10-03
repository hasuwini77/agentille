import { describe, expect, mock, test } from 'claude-code/testing'
import { BRIEF_MIN_WORDS, briefPrompt, flagOf, focusText, paneFlags, parseBrief, parseFocusArgs, shouldBrief, words } from '../../hooks/focus.js'

const LONG = Array.from({ length: BRIEF_MIN_WORDS + 5 }, (_, i) => 'word' + i).join(' ')

describe('focus: deciding', () => {
  test('only long answers, and only in /agt turns unless mode is all', async () => {
    expect(words('a b  c\nd')).toBe(4)
    expect(shouldBrief({ answer: LONG, mode: 'agt', agtTurn: true })).toBe(true)
    expect(shouldBrief({ answer: LONG, mode: 'agt', agtTurn: false })).toBe(false)
    expect(shouldBrief({ answer: LONG, mode: 'all', agtTurn: false })).toBe(true)
    expect(shouldBrief({ answer: LONG, mode: 'off', agtTurn: true })).toBe(false)
    expect(shouldBrief({ answer: 'short answer', mode: 'all', agtTurn: true })).toBe(false)
  })

  test('a very long answer keeps its head and its tail', async () => {
    const p = briefPrompt('HEAD ' + 'x'.repeat(30_000) + ' TAIL')
    expect(p.length).toBeLessThan(13_000)
    expect(p).toContain('HEAD')
    expect(p).toContain('TAIL')
    expect(p).toContain('[…]')
  })
})

describe('focus: parsing the brief', () => {
  test('keeps marked lines, next first, at most three, clipped', async () => {
    const out = parseBrief('Sure! Here it is:\n✓ v2.4.0 shipped\n⚑ PR #22 is stale\n- → Restart Claude to load it\n→ second next\n' + '✓ ' + 'y'.repeat(200))
    expect(out.map((l) => l.kind)).toEqual(['next', 'next', 'flag'])
    expect(out[0]).toEqual({ kind: 'next', text: 'Restart Claude to load it' })
    expect(parseBrief('✓ ' + 'y'.repeat(200))[0].text.length).toBe(96)
    expect(parseBrief('nothing useful here')).toEqual([])
  })
})

describe('focus: flags from agent results', () => {
  test('reviewers, plan-reviewer, adversary, executor', async () => {
    expect(flagOf('plan-reviewer', 'REVISE: step 3 misses tests')).toBe('plan-reviewer asked for a revised plan')
    expect(flagOf('plan-reviewer', 'APPROVE')).toBe(null)
    expect(flagOf('code-reviewer', 'VERDICT: FAIL\nP0 …')).toBe('code-reviewer: FAIL — blocks ship')
    expect(flagOf('security-reviewer', 'VERDICT: CONCERNS')).toBe('security-reviewer: CONCERNS — fix before ship')
    expect(flagOf('design-reviewer', 'VERDICT: PASS')).toBe(null)
    expect(flagOf('adversary', 'BROKEN: 3\n…')).toBe('adversary broke 3 cases')
    expect(flagOf('adversary', 'BROKEN: 1')).toBe('adversary broke 1 case')
    expect(flagOf('adversary', 'BROKEN: 0\nHELD')).toBe(null)
  })

  test('executor: a failing or missing check, or a context hand-off', async () => {
    expect(flagOf('executor', 'VERIFICATION:\n- npm test: exit=1, 2 failed\n\nINTEGRATION: x')).toBe('executor: verification failed')
    expect(flagOf('executor', 'VERIFICATION:\n- vitest: 41 pass, 0 fail, exit=0\n\nINTEGRATION: x')).toBe(null)
    expect(flagOf('executor', 'VERIFICATION:\n- build: did not run (no script)\n')).toBe('executor: verification not run')
    expect(flagOf('executor', 'VERIFICATION:\n- tsc: exit 0\nNOTES:\nCONTEXT exec-1 | high | checkpoint x')).toBe('executor handed off at its context limit')
  })

  test('a blocked pane waits on the person', async () => {
    expect(paneFlags([{ name: 'agt-r1-exec-1', state: 'blocked' }, { name: 'agt-r1-exec-2', state: 'working' }])).toEqual(['agt-r1-exec-1 is waiting on you'])
  })

  test('/agt-focus arguments and its readout', async () => {
    expect(parseFocusArgs('')).toEqual({ show: true })
    expect(parseFocusArgs(' ALL ')).toEqual({ mode: 'all' })
    expect(parseFocusArgs('loud').error).toContain('Usage')
    expect(focusText('agt', [], [])).toContain('Nothing to flag')
    expect(focusText('all', [{ kind: 'next', text: 'run it' }], ['code-reviewer: FAIL'])).toBe('focus: all (every long answer)\n⚑ code-reviewer: FAIL\n→ run it')
  })
})

describe('focus: in the mod', () => {
  const setup = (on: any, reply = '→ Restart Claude\n✓ v2.5.0 shipped') => {
    const asked: any[] = []
    const toasts: string[] = []
    const stored: any[] = []
    on('store.get', async () => ({ value: undefined }))
    on('store.set', async ($: any, e: any) => { stored.push(e); return { value: undefined } })
    on('ui.panes', async () => ({ value: [] }))
    on('ui.open', async () => ({ value: { isPlaced: true } }))
    on('ui.toast', async ($: any, e: any) => { toasts.push(e.text ?? String(e)); return { value: undefined } })
    on('ui.render', async () => ({ type: 'engine', ref: 0 }) as never)
    on('prompt.submit', async ($: any, e: any) => ({ text: e.text }))
    on('model.complete', async ($: any, e: any) => { asked.push(e); return { value: { isAnswered: true, text: reply, usage: {} } } })
    on('agent.spawn', async ($: any, e: any) => ({ model: e.model ?? 'sonnet', agentId: 'r1' }))
    on('turn.complete', async ($: any, e: any) => ({ text: e.answer }))
    const clock = mock.clock(on, { now: 1_000_000 })
    return { asked, toasts, stored, clock }
  }
  const band = ($: any) => $.ui.mount({ plugin: 'agentille', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100 } as never })
  const complete = ($: any, answer: string, agentId?: string) => $.turn.complete({ answer, durationMs: 1000, isAborted: false, turnId: 't', reason: 'answer', ...(agentId ? { agentId } : {}) })

  test('a failing review flags the band and toasts', async ($, on) => {
    const { toasts } = setup(on)
    await $.agent.spawn({ prompt: '[agt run=f1 size=small mode=review]\nreview', subagentType: 'agentille:agentille-code-reviewer', model: 'sonnet' })
    await complete($, 'VERDICT: FAIL\nP0: token logged', 'r1')
    expect(toasts).toContain('agt ⚑ code-reviewer: FAIL — blocks ship')
    const ui = await band($)
    expect(await ui.find({ type: 'Text', text: /⚑ code-reviewer: FAIL/ })).toBeDefined()
    await ui.unmount()
  })

  test('a long /agt answer gets a Haiku brief above the prompt', async ($, on) => {
    const { asked, clock } = setup(on)
    await $.prompt.submit({ text: '/agt ship it', wait: false })
    await complete($, LONG)
    await clock.advance(10)
    expect(asked.length).toBe(1)
    expect(asked[0]).toMatchObject({ model: 'haiku', effort: 'low' })
    const ui = await band($)
    expect(await ui.find({ type: 'Text', text: /→ Restart Claude/ })).toBeDefined()
    await ui.unmount()
  })

  test('outside /agt nothing is briefed until /agt-focus all, which is remembered', async ($, on) => {
    const { asked, stored, clock } = setup(on)
    await $.prompt.submit({ text: 'explain the reaper', wait: false })
    await complete($, LONG)
    await clock.advance(10)
    expect(asked.length).toBe(0)
    await $.command.run({ command: 'agt-focus', args: 'all' })
    expect(stored).toContainEqual(expect.objectContaining({ key: 'focus:mode', value: 'all' }))
    await complete($, LONG)
    await clock.advance(10)
    expect(asked.length).toBe(1)
  })

  test('the next prompt clears the brief', async ($, on) => {
    const { clock } = setup(on)
    await $.prompt.submit({ text: '/agt ship it', wait: false })
    await complete($, LONG)
    await clock.advance(10)
    await $.prompt.submit({ text: 'thanks', wait: false })
    const ui = await band($)
    expect(await ui.find({ type: 'Text', text: /Restart Claude/ })).toBeUndefined()
    await ui.unmount()
  })
})

describe('lazy start', () => {
  const T = '\t'
  const start = async ($: any, on: any, rows: string[][]) => {
    let lists = 0
    on('env.get', async ($: any, e: any) => ({ value: ({ TMUX: '/tmp/tmux-1/default,1,0', TMUX_PANE: '%1', HOME: '/h' } as any)[e.name] }))
    on('session.start', async ($: any, e: any) => ({ cwd: e.cwd }))
    on('command.register', async () => ({ value: undefined }))
    on('tool.register', async () => ({ value: { tool: 'x' } }))
    on('fs.read', async () => ({ deny: 'no profile' }))
    on('fs.exists', async () => ({ value: false }))
    on('fs.stat', async () => ({ deny: 'ENOENT' }))
    on('store.get', async () => ({ value: undefined }))
    on('ui.panes', async () => ({ value: [] }))
    on('skill.prompt', async ($: any, e: any) => ({ text: e.text }))
    on('process.run', async ($: any, e: any) => {
      if (e.argv[1] === 'list-panes') lists += 1
      return { value: { exitCode: 0, stdout: rows.map((r) => r.join(T)).join('\n') + '\n', stderr: '' } }
    })
    const clock = mock.clock(on, { now: 1_000_000 })
    await $.session.start({ cwd: '/w', surface: null, isInteractive: false })
    return { clock, lists: () => lists }
  }

  test('no agt- panes at start: one look, then no polling until /agt runs', async ($, on) => {
    const { clock, lists } = await start($, on, [['%1', '', 'claude', '0', '@1']])
    await clock.advance(60_000)
    expect(lists()).toBe(1)
    await $.skill.prompt({ skill: 'agt', text: 'base' })
    await clock.advance(20_000)
    expect(lists()).toBeGreaterThan(3)
  })

  test('polling stops after a quiet minute', async ($, on) => {
    const { clock, lists } = await start($, on, [['%1', '', 'claude', '0', '@1']])
    await $.skill.prompt({ skill: 'agt', text: 'base' })
    await clock.advance(70_000)
    const after = lists()
    await clock.advance(60_000)
    expect(lists()).toBe(after)
  })

  test('leftover agt- panes at start keep the reaper polling', async ($, on) => {
    const { clock, lists } = await start($, on, [['%1', '', 'claude', '0', '@1'], ['%2', 'agt-r9-executor', 'claude', '0', '@1']])
    await clock.advance(30_000)
    expect(lists()).toBeGreaterThan(4)
  })
})
