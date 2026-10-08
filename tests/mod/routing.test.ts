import { describe, expect, mock, test } from 'claude-code/testing'
import { decide, formationOf, parseHeader, roleOf, verdictOf, workflowReason } from '../../hooks/routing.js'

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

describe('workflow agents', () => {
  test('the reason is plain when the script ran the table model, a drift when it did not', async () => {
    const d = decide({ role: 'code-reviewer', hdr: { size: 'large' } })
    expect(workflowReason('opus', d)).toBe('workflow')
    expect(workflowReason('sonnet', d)).toBe('workflow: script sonnet, table opus')
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

  test('a workflow agent keeps its model, raises no routing toast, and logs the table pick against what ran', async ($, on) => {
    const seen: any[] = []
    const toasts: string[] = []
    on('store.get', async () => ({ value: null }))
    on('ui.toast', async ($: any, e: any) => { toasts.push(e.text); return { value: undefined } })
    on('agent.spawn', async ($, e) => { seen.push(e); return { model: 'claude-sonnet-5', agentId: 'wf1' } })
    mock.clock(on, { now: Date.now() })
    await $.agent.spawn({ prompt: '[agt run=wfroute size=large mode=review]\nreview', subagentType: 'agentille:agentille-code-reviewer', model: 'sonnet', workflow: { runId: 'wf_1', agentIndex: 1 } } as never)
    expect(seen[0].model).toBe('sonnet') // the table says opus; a workflow agent is not rewritten
    expect(toasts.some((t) => t.includes('agt ↑'))).toBe(false)
    const line = (await $.command.run({ command: 'agt-routing' })).text
    expect(line).toContain('code-reviewer → claude-sonnet-5')
    expect(line).toContain('workflow: script sonnet, table opus')
    expect(line).toContain('· workflow')
  })

  test('a workflow agent that ran the table model is listed without a drift', async ($, on) => {
    on('store.get', async () => ({ value: null }))
    on('agent.spawn', async () => ({ model: 'claude-opus-5-5', agentId: 'wf2' }))
    mock.clock(on, { now: Date.now() })
    await $.agent.spawn({ prompt: '[agt run=wfok size=large mode=review]\nreview', subagentType: 'agentille:agentille-code-reviewer', workflow: { runId: 'wf_2', agentIndex: 1 } } as never)
    const line = (await $.command.run({ command: 'agt-routing' })).text
    expect(line).toBe('code-reviewer → claude-opus-5-5 · ? · workflow')
  })
})

describe('workflow agents: runs, toast, deny', () => {
  const hdr = (run: string) => '[agt run=' + run + ' size=large mode=review]\nreview'
  const wf = (run: string | null, role = 'code-reviewer', index = 1) => ({ prompt: run ? hdr(run) : 'review', subagentType: 'agentille:agentille-' + role, workflow: { runId: 'wf_1', agentIndex: index } }) as never
  const band = ($: any) => $.ui.mount({ plugin: 'agentille', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 100 } as never })
  const setup = (on: any, model = 'claude-sonnet-5') => {
    const toasts: string[] = []
    const writes: Record<string, string> = {}
    let n = 0
    on('env.get', async ($: any, e: any) => ({ value: ({ HOME: '/h' } as any)[e.name] }))
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
  const finish = ($: any, agentId: string) => $.turn.complete({ agentId, answer: 'ok', durationMs: 10, isAborted: false, turnId: 't' + agentId, reason: 'answer' } as never)
  const shownRun = async (ui: any, run: string) => (await ui.find({ type: 'Text', text: new RegExp('run ' + run) })) !== undefined

  test('a drift raises one agt ≠ toast per run and role', async ($, on) => {
    const { toasts } = setup(on)
    await $.session.start({ cwd: '/w', surface: null, isInteractive: false })
    await $.agent.spawn(wf('wfdrift'))
    expect(toasts).toEqual(['agt ≠ code-reviewer · workflow ran script sonnet, table opus'])
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

  test('a headerless workflow agent files its routing line and report under adhoc, not the band run', async ($, on) => {
    const { writes } = setup(on)
    await $.session.start({ cwd: '/w', surface: null, isInteractive: false })
    await $.agent.spawn({ prompt: hdr('runE'), subagentType: 'agentille:agentille-executor' } as never) // w0 working: runE owns the band
    await $.agent.spawn(wf(null)) // w1, no header
    await finish($, 'w1')
    expect(writes['/h/.agentille/state/run-runE/routing.jsonl']).not.toContain('"kind":"workflow"') // runE's log holds only its own
    expect(Object.keys(writes).some((p) => p.includes('agents/code-reviewer'))).toBe(false) // the report went to adhoc, which writes nothing
    const ui = await band($)
    expect(await shownRun(ui, 'runE')).toBe(true) // and the band still shows runE
    await ui.unmount()
  })
})
