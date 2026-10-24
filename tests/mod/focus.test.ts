import { describe, expect, mock, test } from 'claude-code/testing'
import { flagKey, flagOf, focusText, mergeFlags, paneFlags, parseFocusArgs, words } from '../../hooks/focus.js'

const LONG = Array.from({ length: 200 }, (_, i) => 'word' + i).join(' ')

describe('focus: reading', () => {
  test('words counts whitespace-separated tokens', async () => {
    expect(words('a b  c\nd')).toBe(4)
    expect(words('')).toBe(0)
    expect(words(undefined)).toBe(0)
  })

  test('/agt-focus takes on or off, nothing else', async () => {
    expect(parseFocusArgs('')).toEqual({ show: true })
    expect(parseFocusArgs('on')).toEqual({ on: true })
    expect(parseFocusArgs(' OFF ')).toEqual({ on: false })
    for (const bad of ['all', 'agt', 'maybe']) expect(parseFocusArgs(bad)).toEqual({ error: 'Usage: /agt-focus [on|off]' })
  })

  test('focusText lists the flags, or says there are none', async () => {
    expect(focusText(true, ['a is blocked'])).toBe('focus: on (agent flags show above the prompt)\n⚑ a is blocked')
    expect(focusText(false, [])).toBe('focus: off (no flags above the prompt)\nNothing to flag right now.')
  })
})

describe('focus: flags from agent results', () => {
  test('reviewers, plan-reviewer, adversary, executor', async () => {
    expect(flagOf('plan-reviewer', 'REVISE: step 3 misses tests')).toBe('plan-reviewer asked for a revised plan')
    expect(flagOf('plan-reviewer', 'APPROVE')).toBe(null)
    expect(flagOf('plan-reviewer', 'APPROVE — nothing here warrants a REVISE')).toBe(null)
    expect(flagOf('plan-reviewer', 'Verdict format: APPROVE / REVISE\nAPPROVE')).toBe(null)
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
    expect(flagOf('executor', 'VERIFICATION:\n- tsc --noEmit: exit code 2\n')).toBe('executor: verification failed')
    expect(flagOf('executor', 'VERIFICATION:\n- build: exit code: 1\n')).toBe('executor: verification failed')
    expect(flagOf('executor', 'VERIFICATION:\n- build: exit code: 0\n')).toBe(null)
    expect(flagOf('executor', 'VERIFICATION:\n- grep -l "<text" out/*.svg found nothing (exit 1)\n- render: exit 0\n')).toBe(null)
    expect(flagOf('executor', 'VERIFICATION:\n- grep TODO src: no matches, exit 1 as expected\n')).toBe(null)
    expect(flagOf('executor', 'VERIFICATION:\n- grep: found nothing (exit 1)\n- npm test: exit=1\n')).toBe('executor: verification failed')
    expect(flagOf('executor', 'VERIFICATION:\n- curl: expected 200, got 401, exit 1\n')).toBe('executor: verification failed')
    expect(flagOf('executor', 'VERIFICATION:\n- tsc: exit 0\nNOTES:\nCONTEXT exec-1 | high | checkpoint x')).toBe('executor handed off at its context limit')
  })

  test('a PASS from the same reviewer clears its CONCERNS; other slices keep theirs', async () => {
    const TTL = 30 * 60_000
    let f = mergeFlags([], 'code-reviewer|', 'code-reviewer: CONCERNS — fix before ship', 0, TTL)
    f = mergeFlags(f, 'code-reviewer|b', 'code-reviewer: FAIL — blocks ship', 1, TTL)
    expect(f.map((x) => x.text)).toEqual(['code-reviewer: CONCERNS — fix before ship', 'code-reviewer: FAIL — blocks ship'])
    f = mergeFlags(f, 'code-reviewer|', null, 2, TTL)
    expect(f.map((x) => x.text)).toEqual(['code-reviewer: FAIL — blocks ship'])
    expect(mergeFlags(f, 'executor|', null, TTL + 1, TTL)).toEqual([])
  })

  test('a re-plan clears the plan-reviewer\'s REVISE flag; other roles keep their own key', async () => {
    const TTL = 30 * 60_000
    expect(flagKey('planner', undefined)).toBe('plan|')
    expect(flagKey('plan-reviewer', '')).toBe('plan|')
    expect(flagKey('code-reviewer', 'api')).toBe('code-reviewer|api')
    let f = mergeFlags([], flagKey('plan-reviewer'), 'plan-reviewer asked for a revised plan', 0, TTL)
    f = mergeFlags(f, flagKey('executor', 'api'), 'executor: verification failed', 1, TTL)
    f = mergeFlags(f, flagKey('planner'), null, 2, TTL) // the planner answered again: the ask is met
    expect(f.map((x) => x.text)).toEqual(['executor: verification failed'])
  })

  test('two slices with the same flag text each keep their own until their own PASS', async () => {
    const TTL = 30 * 60_000, T = 'code-reviewer: CONCERNS — fix before ship'
    let f = mergeFlags([], 'code-reviewer|a', T, 0, TTL)
    f = mergeFlags(f, 'code-reviewer|b', T, 1, TTL)
    expect(f.map((x) => x.key)).toEqual(['code-reviewer|a', 'code-reviewer|b'])
    f = mergeFlags(f, 'code-reviewer|b', null, 2, TTL)
    expect(f.map((x) => x.key)).toEqual(['code-reviewer|a'])
  })

  test('a blocked pane waits on the person', async () => {
    expect(paneFlags([{ name: 'agt-r1-exec-1', state: 'blocked' }, { name: 'agt-r1-exec-2', state: 'working' }])).toEqual(['agt-r1-exec-1 is waiting on you'])
    expect(paneFlags([{ name: 'agt-r1-exec-1', state: 'done' }, { name: 'agt-r1-exec-2', state: 'done' }], new Set(['agt-r1-exec-2']))).toEqual(['agt-r1-exec-2 done, not harvested'])
  })

  test('a stranded idle pane says idle, not done', async () => {
    expect(paneFlags([{ name: 'agt-r1-exec-1', state: 'idle' }, { name: 'agt-r1-exec-2', state: 'done' }], new Set(['agt-r1-exec-1', 'agt-r1-exec-2']))).toEqual(['agt-r1-exec-1 idle, not harvested', 'agt-r1-exec-2 done, not harvested'])
  })
})

describe('focus: in the mod', () => {
  const setup = (on: any) => {
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
    on('model.complete', async ($: any, e: any) => { asked.push(e); return { value: { isAnswered: true, text: '', usage: {} } } })
    on('agent.spawn', async ($: any, e: any) => ({ model: e.model ?? 'sonnet', agentId: 'r1' }))
    on('turn.complete', async ($: any, e: any) => ({ text: e.answer }))
    const clock = mock.clock(on, { now: 1_000_000 })
    return { asked, toasts, stored, clock }
  }
  const band = ($: any) => $.ui.mount({ plugin: 'agentille', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100 } as never })
  const complete = ($: any, answer: string, agentId?: string) => $.turn.complete({ answer, durationMs: 1000, isAborted: false, turnId: 't', reason: 'answer', ...(agentId ? { agentId } : {}) })

  test('a failing review flags the band and toasts', { timeoutMs: 20_000 }, async ($, on) => {
    const { toasts } = setup(on)
    await $.agent.spawn({ prompt: '[agt run=f1 size=small mode=review]\nreview', subagentType: 'agentille:agentille-code-reviewer', model: 'sonnet' })
    await complete($, 'VERDICT: FAIL\nP0: token logged', 'r1')
    expect(toasts).toContain('agt ⚑ code-reviewer: FAIL — blocks ship')
    const ui = await band($)
    expect(await ui.find({ type: 'Text', text: /⚑ code-reviewer: FAIL/ })).toBeDefined()
    await ui.unmount()
  })

  test('the run\'s final card takes every flag down', async ($, on) => {
    setup(on)
    await $.prompt.submit({ text: '/agt "ship it"', origin: { kind: 'composer' } } as never)
    await $.agent.spawn({ prompt: '[agt run=f2 size=small mode=review]\nreview', subagentType: 'agentille:agentille-code-reviewer', model: 'sonnet' })
    await complete($, 'VERDICT: CONCERNS\nP1: unused import', 'r1')
    let ui = await band($)
    expect(await ui.find({ type: 'Text', text: /⚑ code-reviewer: CONCERNS/ })).toBeDefined()
    await ui.unmount()
    await complete($, '✓ shipped · low · 2 files · PR #3 ready · 4m\nverify: npm test → 12 passed\nNext: merge PR #3')
    ui = await band($)
    expect(await ui.find({ type: 'Text', text: /⚑ code-reviewer/ })).toBeUndefined()
    await ui.unmount()
  })

  test('a long /agt answer costs no model call', async ($, on) => {
    const { asked, clock } = setup(on)
    await $.prompt.submit({ text: '/agt ship it', wait: false, origin: { kind: 'composer' } } as never)
    await complete($, LONG)
    await clock.advance(10_000)
    expect(asked.length).toBe(0)
  })

  test('/agt-focus off hides the flags, is written to profile.json, and on brings them back', async ($, on) => {
    const files: Record<string, string> = {}
    on('env.get', async ($: any, e: any) => ({ value: e.name === 'HOME' ? '/u' : undefined }))
    on('fs.read', async ($: any, e: any) => (e.path in files ? { value: files[e.path] } : { deny: 'ENOENT' }))
    on('fs.write', async ($: any, e: any) => { files[e.path] = e.text; return { value: undefined } })
    on('fs.exists', async ($: any, e: any) => ({ value: e.path in files }))
    on('process.run', async ($: any, e: any) => ({ value: { exitCode: e.argv?.[0] === 'mkdir' ? 0 : 1, stdout: '', stderr: '' } }))
    on('session.start', async ($: any, e: any) => ({ cwd: e.cwd }))
    on('command.register', async () => ({ value: undefined }))
    setup(on)
    await $.session.start({ cwd: '/w', surface: null, isInteractive: false })
    await $.agent.spawn({ prompt: '[agt run=f2 size=small mode=review]\nreview', subagentType: 'agentille:agentille-code-reviewer', model: 'sonnet' })
    await complete($, 'VERDICT: CONCERNS\nP1: unchecked input', 'r1')
    await $.command.run({ command: 'agt-focus', args: 'off' })
    expect(JSON.parse(files['/u/.agentille/profile.json']).display).toEqual({ focus: false })
    const hidden = await band($)
    expect(await hidden.find({ type: 'Text', text: /⚑ code-reviewer/ })).toBeUndefined()
    await hidden.unmount()
    expect((await $.command.run({ command: 'agt-focus', args: 'on' })).text).toContain('⚑ code-reviewer: CONCERNS')
    const shown = await band($)
    expect(await shown.find({ type: 'Text', text: /⚑ code-reviewer: CONCERNS/ })).toBeDefined()
    await shown.unmount()
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
    // The agt- panes listed at start are this lead's own: a previous session of it recorded them.
    on('fs.read', async ($: any, e: any) => (e.path === '/h/.agentille/state/lead-1.panes' ? { value: rows.map((r) => r[1]).filter((n) => n.startsWith('agt-')).join('\n') + '\n' } : { deny: 'no profile' }))
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

describe('focus: a typed /agt starts with no flags', () => {
  const boot = async ($: any, on: any) => {
    let n = 0
    on('env.get', async ($: any, e: any) => ({ value: e.name === 'HOME' ? '/h' : undefined }))
    on('session.cwd', async () => ({ value: '/work/repo' }))
    on('session.start', async ($: any, e: any) => ({ cwd: e.cwd }))
    on('command.register', async () => ({ value: undefined }))
    on('fs.read', async () => ({ deny: 'ENOENT' }))
    on('fs.write', async () => ({ value: undefined }))
    on('store.get', async () => ({ value: null }))
    on('ui.open', async () => ({ value: undefined }))
    on('ui.toast', async () => ({ value: undefined }))
    on('ui.render', async () => ({ type: 'engine', ref: 0 }) as never)
    on('prompt.submit', async ($: any, e: any) => ({ text: e.text }))
    on('turn.complete', async ($: any, e: any) => ({ text: e.answer }))
    on('agent.spawn', async ($: any, e: any) => ({ model: e.model ?? 'inherit', agentId: 'w' + n++ }))
    mock.clock(on, { now: Date.now() })
    await $.session.start({ cwd: '/work/repo', surface: null, isInteractive: false })
  }
  const typed = ($: any, text: string) => $.prompt.submit({ text, origin: { kind: 'composer' } } as never)
  const focus = async ($: any) => (await $.command.run({ command: 'agt-focus', args: '' })).text as string

  test('a flag one run raised is gone when the next /agt is typed', { timeoutMs: 20_000 }, async ($, on) => {
    await boot($, on)
    await typed($, '/agt build the importer')
    await $.agent.spawn({ prompt: '[agt run=fl1run size=small mode=build]\nbreak the importer', subagentType: 'agentille:agentille-adversary' } as never)
    // No ✓/✗ card: the run is still open, so only the next typed /agt can clear what it raised.
    await $.turn.complete({ agentId: 'w0', answer: 'BROKEN: 2\nempty file, BOM header', durationMs: 10, isAborted: false, turnId: 'tw0', reason: 'answer' } as never)
    expect(await focus($)).toContain('⚑ adversary broke 2 cases')
    await typed($, '/agt build the exporter')
    const after = await focus($)
    expect(after).not.toContain('adversary broke')
    expect(after).toContain('Nothing to flag right now.')
  })

  test('a prompt that is not /agt keeps the flag', { timeoutMs: 20_000 }, async ($, on) => {
    await boot($, on)
    await typed($, '/agt build the importer')
    await $.agent.spawn({ prompt: '[agt run=fl2run size=small mode=build]\nbreak the importer', subagentType: 'agentille:agentille-adversary' } as never)
    await $.turn.complete({ agentId: 'w0', answer: 'BROKEN: 1', durationMs: 10, isAborted: false, turnId: 'tw0', reason: 'answer' } as never)
    await typed($, 'what broke?')
    expect(await focus($)).toContain('⚑ adversary broke 1 case')
  })
})
