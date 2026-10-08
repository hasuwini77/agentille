import { describe, expect, mock, test } from 'claude-code/testing'
import { decide, formationOf, parseHeader, roleOf, verdictOf } from '../../hooks/routing.js'

const fresh = () => ({ revise: 0, fixes: 0, fable: 0 })
const S = { autoFable: true, maxFablePerRun: 1, fableWeeklyCeiling: 60 }

describe('policy', () => {
  test('parses the dispatch header', async () => {
    expect(parseHeader('[agt run=a1 size=large risk=auth mode=fix fable=auto]\nBuild it')).toEqual({ run: 'a1', size: 'large', risk: 'auth', mode: 'fix', fable: 'auto' })
    expect(parseHeader('Build it')).toBe(null)
  })

  test('only agentille roles are routed', async () => {
    expect(roleOf('agentille:agentille-planner')).toBe('planner')
    expect(roleOf('Explore')).toBe(null)
    expect(roleOf('other:planner')).toBe(null)
  })

  test('reads the first verdict word', async () => {
    expect(verdictOf('REVISE\n- [BLOCKER] x → y')).toBe('REVISE')
    expect(verdictOf('APPROVE — sound plan')).toBe('APPROVE')
    expect(verdictOf('no verdict')).toBe(null)
  })

  test('table: size, risk and quick depth', async () => {
    expect(decide({ role: 'code-reviewer', hdr: {}, run: fresh(), settings: S })).toMatchObject({ model: 'sonnet', effort: 'medium' })
    expect(decide({ role: 'code-reviewer', hdr: { size: 'large' }, run: fresh(), settings: S })).toMatchObject({ model: 'opus', effort: 'high' })
    expect(decide({ role: 'security-reviewer', hdr: { risk: 'money' }, run: fresh(), settings: S })).toMatchObject({ model: 'opus', effort: 'max' })
    expect(decide({ role: 'planner', hdr: {}, run: fresh(), depth: 'quick', settings: S })).toMatchObject({ model: 'sonnet', effort: 'medium' })
    expect(decide({ role: 'design-reviewer', hdr: {}, run: fresh(), depth: 'quick', settings: S })).toMatchObject({ model: 'opus', effort: 'high' })
  })

  test('executor never changes model, only effort', async () => {
    for (const fixes of [1, 2, 3, 5]) {
      const d = decide({ role: 'executor', hdr: { mode: 'fix', fable: 'forced' }, run: { ...fresh(), fixes }, settings: S })
      expect(d.model).toBe('sonnet')
    }
    expect(decide({ role: 'executor', hdr: { mode: 'fix' }, run: { ...fresh(), fixes: 2 }, settings: S }).effort).toBe('high')
    expect(decide({ role: 'executor', hdr: { mode: 'fix' }, run: { ...fresh(), fixes: 3 }, settings: S }).effort).toBe('max')
  })
})

describe('Fable is rare', () => {
  test('one REVISE only raises effort', async () => {
    expect(decide({ role: 'planner', hdr: {}, run: { ...fresh(), revise: 1 }, settings: S })).toMatchObject({ model: 'opus', effort: 'max', fable: false })
  })

  test('two REVISEs make the planner a Fable candidate', async () => {
    expect(decide({ role: 'planner', hdr: {}, run: { ...fresh(), revise: 2 }, settings: S })).toMatchObject({ model: 'fable', fable: true })
  })

  test('diagnosis goes to Fable only after 3 failed fixes', async () => {
    expect(decide({ role: 'planner', hdr: { mode: 'diagnose' }, run: { ...fresh(), fixes: 2 }, settings: S }).fable).toBe(false)
    expect(decide({ role: 'planner', hdr: { mode: 'diagnose' }, run: { ...fresh(), fixes: 3 }, settings: S }).model).toBe('fable')
  })

  test('the gate blocks: cap, weekly ceiling, opt-out', async () => {
    const hard = { ...fresh(), revise: 2 }
    expect(decide({ role: 'planner', run: { ...hard, fable: 1 }, settings: S })).toMatchObject({ model: 'opus', effort: 'max' })
    expect(decide({ role: 'planner', run: hard, settings: S, weeklyPct: 60 })).toMatchObject({ model: 'opus', effort: 'max' })
    expect(decide({ role: 'planner', run: hard, settings: { ...S, autoFable: false } }).model).toBe('opus')
    expect(decide({ role: 'planner', run: hard, settings: S, weeklyPct: 59.9 }).model).toBe('fable')
  })

  test('risk alone never reaches Fable', async () => {
    expect(decide({ role: 'security-reviewer', hdr: { risk: 'auth', size: 'large' }, run: fresh(), settings: S }).model).toBe('opus')
  })

  test('--fable forces judgment roles, small reviews stay put', async () => {
    expect(decide({ role: 'planner', hdr: { fable: 'forced' }, run: fresh(), settings: S }).model).toBe('fable')
    expect(decide({ role: 'code-reviewer', hdr: { fable: 'forced' }, run: fresh(), settings: S }).model).toBe('sonnet')
    expect(decide({ role: 'code-reviewer', hdr: { fable: 'forced', size: 'large' }, run: fresh(), settings: S }).model).toBe('fable')
  })
})

describe('formations', () => {
  test('the adversary is routed: sonnet high, opus high on risk, never Fable', async () => {
    expect(roleOf('agentille:agentille-adversary')).toBe('adversary')
    expect(decide({ role: 'adversary', hdr: {} })).toMatchObject({ model: 'sonnet', effort: 'high' })
    expect(decide({ role: 'adversary', hdr: { risk: 'money' } })).toMatchObject({ model: 'opus', effort: 'high' })
    expect(decide({ role: 'adversary', hdr: { fable: 'forced' } }).model).not.toBe('fable')
  })

  test('only known formations are read off the header', async () => {
    expect(formationOf(parseHeader('[agt run=a1 formation=duel]'))).toBe('duel')
    expect(formationOf(parseHeader('[agt run=a1 formation=swarm]'))).toBe(null)
    expect(formationOf(null)).toBe(null)
  })
})

describe('mod', () => {
  test('rewrites the model of an agentille dispatch', async ($, on) => {
    let seen: string | undefined
    on('store.get', async () => ({ value: null }))
    on('agent.spawn', async ($, e) => { seen = e.model; return { model: e.model ?? 'inherit', agentId: 'a1' } })
    await $.agent.spawn({ prompt: '[agt run=t1 size=large mode=review]\nreview', subagentType: 'agentille:agentille-code-reviewer', model: 'sonnet' })
    expect(seen).toBe('opus')
  })

  test('leaves other agents alone', async ($, on) => {
    let seen: string | undefined
    on('agent.spawn', async ($, e) => { seen = e.model; return { model: e.model ?? 'inherit', agentId: 'a2' } })
    await $.agent.spawn({ prompt: '[agt run=t2 size=large]\nsearch', subagentType: 'Explore', model: 'haiku' })
    expect(seen).toBe('haiku')
  })
})

describe('workflow agents: runs, toast, deny', () => {
  const hdr = (run: string) => '[agt run=' + run + ' size=large mode=review]\nreview'
  const wf = (run: string | null, role = 'code-reviewer', index = 1) => ({ prompt: run ? hdr(run) : 'review', subagentType: 'agentille:agentille-' + role, workflow: { runId: 'wf_1', agentIndex: index } }) as never
  const band = ($: any) => $.ui.mount({ plugin: 'agentille', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 100 } as never })
  // `herdr`: the rows `herdr agent list` shows to a lead inside herdr; left out, there is no pane transport.
  const setup = (on: any, model = 'claude-sonnet-5', herdr: any[] | null = null) => {
    const toasts: string[] = []
    const writes: Record<string, string> = {}
    let n = 0
    on('env.get', async ($: any, e: any) => ({ value: ({ HOME: '/h', ...(herdr && { HERDR_ENV: '1' }) } as any)[e.name] }))
    if (herdr) {
      on('tool.register', async () => ({ value: undefined }))
      on('process.run', async ($: any, e: any) => ({ value: { exitCode: 0, stdout: e.argv[1] === 'agent' ? JSON.stringify({ result: { agents: herdr } }) : '', stderr: '' } }))
    }
    on('session.start', async ($: any, e: any) => ({ cwd: e.cwd }))
    on('command.register', async () => ({ value: undefined }))
    on('fs.read', async () => ({ deny: 'no profile' }))
    on('fs.write', async ($: any, e: any) => { writes[e.path] = e.text; return { value: undefined } })
    on('store.get', async () => ({ value: null }))
    on('ui.render', async () => ({ type: 'engine', ref: 0 }) as never)
    on('ui.toast', async ($: any, e: any) => { toasts.push(e.text); return { value: undefined } })
    on('turn.complete', async ($: any, e: any) => ({ text: e.answer }))
    on('agent.spawn', async () => ({ model, agentId: 'w' + n++ }))
    mock.clock(on, { now: Date.now() })
    return { toasts, writes }
  }
  const finish = ($: any, agentId: string, answer = 'ok', usage?: object) => $.turn.complete({ agentId, answer, durationMs: 10, isAborted: false, turnId: 't' + agentId, reason: 'answer', usage } as never)
  const shownRun = async (ui: any, run: string) => (await ui.find({ type: 'Text', text: new RegExp('run ' + run) })) !== undefined

  test('a drift raises one toast per run and role', async ($, on) => {
    const { toasts } = setup(on)
    await $.session.start({ cwd: '/w', surface: null, isInteractive: false })
    await $.agent.spawn(wf('wfdrift'))
    expect(toasts).toEqual(['agt workflow code-reviewer runs sonnet — table says opus · high'])
    await $.agent.spawn(wf('wfdrift', 'code-reviewer', 2)) // same run, same role: told once
    expect(toasts.length).toBe(1)
    await $.agent.spawn(wf('wfdrift', 'design-reviewer', 3)) // another role is a new drift
    expect(toasts.length).toBe(2)
  })

  test('a deny from a lower hook passes through: no agent, no log, no toast', async ($, on) => {
    const toasts: string[] = []
    on('ui.toast', async ($: any, e: any) => { toasts.push(e.text); return { value: undefined } })
    on('agent.spawn', async () => ({ deny: 'workflow agents are off' }))
    mock.clock(on, { now: Date.now() })
    const res = await $.agent.spawn(wf('wfdeny'))
    expect(res).toEqual({ deny: 'workflow agents are off' })
    expect(toasts).toEqual([])
    expect((await $.command.run({ command: 'agt-routing' })).text).not.toContain('code-reviewer')
  })

  test('a workflow takes the band over only from a run with nothing working', async ($, on) => {
    setup(on)
    await $.session.start({ cwd: '/w', surface: null, isInteractive: false })
    await $.agent.spawn({ prompt: hdr('runA'), subagentType: 'agentille:agentille-executor' } as never) // w0, working
    const ui = await band($)
    expect(await shownRun(ui, 'runA')).toBe(true)
    await $.agent.spawn(wf('runB')) // w1: runA still works, the band stays
    expect(await shownRun(ui, 'runA')).toBe(true)
    expect(await shownRun(ui, 'runB')).toBe(false)
    await finish($, 'w0')
    await finish($, 'w1')
    await $.agent.spawn(wf('runC', 'code-reviewer', 2)) // nothing works any more: the band follows
    expect(await shownRun(ui, 'runC')).toBe(true)
    await ui.unmount()
  })

  test('a workflow takes the band over from adhoc', async ($, on) => {
    setup(on)
    await $.session.start({ cwd: '/w', surface: null, isInteractive: false })
    await $.agent.spawn({ prompt: 'no header', subagentType: 'Explore' } as never) // w0 adhoc, working
    await $.agent.spawn(wf('runD'))
    const ui = await band($)
    expect(await shownRun(ui, 'runD')).toBe(true)
    await ui.unmount()
  })

  test('a workflow naming another run leaves the band on a run whose pane still works', async ($, on) => {
    setup(on, 'claude-sonnet-5', [{ name: 'agt-runG-executor', pane_id: 'w1:p2', agent: 'claude', agent_status: 'working', state_change_seq: 1 }])
    await $.session.start({ cwd: '/w', surface: null, isInteractive: false })
    await $.agent.spawn({ prompt: hdr('runG'), subagentType: 'agentille:agentille-executor' } as never) // w0: runG owns the band
    await finish($, 'w0') // no subagent of runG works any more, its pane does
    await $.agent.spawn(wf('runH')) // w1
    const ui = await band($)
    expect(await shownRun(ui, 'runG')).toBe(true)
    expect(await shownRun(ui, 'runH')).toBe(false)
    await ui.unmount()
  })

  test('a headerless workflow agent files its routing line and tokens under adhoc, not the band run', async ($, on) => {
    const { writes } = setup(on)
    await $.session.start({ cwd: '/w', surface: null, isInteractive: false })
    await $.agent.spawn({ prompt: hdr('runE'), subagentType: 'agentille:agentille-executor' } as never) // w0 working: runE owns the band
    await $.agent.spawn(wf(null)) // w1, no header
    await finish($, 'w1', 'ok', { input_tokens: 500, output_tokens: 100 })
    expect(writes['/h/.agentille/state/run-runE/routing.jsonl']).not.toContain('"kind":"workflow"') // runE's log holds only its own
    const ui = await band($)
    expect(await shownRun(ui, 'runE')).toBe(true) // and the band still shows runE
    await ui.unmount()
    expect((await $.command.run({ command: 'agt-ledger' })).text).not.toContain('code-reviewer') // nor does /agt-ledger
    await finish($, 'w0') // runE's ledger.json is written when one of its own agents finishes
    const file = writes['/h/.agentille/state/run-runE/ledger.json']
    expect(file).toBeDefined()
    const ledger = JSON.parse(file)
    expect(Object.keys(ledger.roles)).toEqual(['executor']) // w1's tokens stay out of runE's ledger
    expect(ledger.total).toMatchObject({ agents: 1, input: 0, output: 0 })
  })

  test('a headerless workflow agent is judged against the band run\'s table pick, not ad hoc', async ($, on) => {
    const { toasts } = setup(on, 'claude-fable-5')
    await $.session.start({ cwd: '/w', surface: null, isInteractive: false })
    for (const id of ['w0', 'w1']) { // two REVISEs: runF's planner is a Fable pick
      await $.agent.spawn({ prompt: hdr('runF'), subagentType: 'agentille:agentille-plan-reviewer' } as never)
      await finish($, id, 'REVISE')
    }
    await $.agent.spawn(wf(null, 'planner')) // w2, no header, runs fable: what runF's table says
    expect(toasts.filter((t) => t.includes('table says'))).toEqual([])
    const routing = (await $.command.run({ command: 'agt-routing' })).text
    expect(routing).toContain('planner → claude-fable-5')
    expect(routing).not.toContain('table says')
  })
})
