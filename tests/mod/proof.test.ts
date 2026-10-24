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
  const HDR = '[agt run=pf1 size=large work=build fable=forced]'
  const plan = ($: any) => $.agent.spawn({ prompt: HDR + '\nplan it', subagentType: 'agentille:agentille-planner', model: 'opus' })

  test('fable=forced with no typed --fable runs the ladder and says so once', async ($, on) => {
    const { spawned, toasts } = setup(on)
    await $.prompt.submit({ text: '/agt ship it', origin: { kind: 'composer' } } as never)
    await plan($)
    await plan($)
    expect(spawned.map((e) => e.model)).toEqual(['opus', 'opus'])
    expect(spawned[0].prompt.split('\n')[0]).toBe('[agt run=pf1 size=large work=build fable=auto]')
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

  test('the run-end tidy-up (worktrees, orphan panes) runs only after a typed /agt, never for an agent some other prompt dispatched', async ($, on) => {
    const { spawned } = setup(on)
    const git: string[] = []
    on('session.cwd', async () => ({ value: '/work/repo' }))
    on('turn.start', async ($: any, e: any) => ({ turnId: e.turnId }))
    on('turn.complete', async ($: any, e: any) => ({ text: e.answer }))
    on('process.run', async ($: any, e: any) => { git.push(e.argv.join(' ')); return { value: { exitCode: 1, stdout: '', stderr: '' } } })
    const card = async () => { await $.turn.start({ text: 'go', turnId: 't1' }); await $.turn.complete({ answer: '✓ shipped', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' }); await new Promise((r) => setTimeout(r, 20)) }
    await $.prompt.submit({ text: '/agt ship it' } as never) // unstamped: not the person's
    await plan($)
    await card()
    expect(spawned).toHaveLength(1)
    expect(git.some((c) => c.includes('worktree list'))).toBe(false)
    await $.prompt.submit({ text: '/agt ship it', origin: { kind: 'composer' } } as never)
    await plan($)
    await card()
    expect(git.some((c) => c.includes('worktree list'))).toBe(true)
  })

  test('a prompt the host did not stamp as the person\'s is not typed: fable=forced is dropped', async ($, on) => {
    const { spawned } = setup(on)
    await $.prompt.submit({ text: '/agt --fable ship it' } as never)
    await plan($)
    expect(spawned[0].model).toBe('opus')
    expect(spawned[0].prompt.split('\n')[0]).toBe('[agt run=pf1 size=large work=build fable=auto]')
  })

  test('the proof is per typed /agt: the next one without --fable drops it again', async ($, on) => {
    const { spawned } = setup(on)
    await $.prompt.submit({ text: '/agt --fable ship it', origin: { kind: 'composer' } } as never)
    await plan($)
    await $.prompt.submit({ text: '/agt ship the rest', origin: { kind: 'composer' } } as never)
    await plan($)
    expect(spawned.map((e) => e.model)).toEqual(['fable', 'opus'])
  })

  // A run that ends in a question, an error or an interrupt prints no ✓/✗ card: its proof lapses once the run is
  // over (no agent of it working, no worker pane) and the person has typed AGT_GRACE_TYPED plain prompts since.
  test('fable=forced after a plain prompt holds only while the --fable run is in flight', async ($, on) => {
    const { spawned } = setup(on)
    on('turn.complete', async ($: any, e: any) => ({ text: e.answer }))
    const done = (agentId: string) => $.turn.complete({ agentId, answer: 'done', durationMs: 1, isAborted: false, turnId: 't-' + agentId, reason: 'answer' } as never)
    const plain = (text: string) => $.prompt.submit({ text, origin: { kind: 'composer' } } as never)
    await $.prompt.submit({ text: '/agt --fable ship it', origin: { kind: 'composer' } } as never)
    await plan($)
    await done('p1')
    await plain('yes, the second option') // the person answers the run's question: still its run
    await plan($)
    await done('p2')
    await plain('thanks')
    await plain('now fix the typo in the README')
    await plan($) // the run is over: a model-written fable=forced proves nothing
    await $.prompt.submit({ text: 'task finished', origin: { kind: 'notification' } } as never)
    await plan($)
    expect(spawned.map((e) => e.model)).toEqual(['fable', 'fable', 'opus', 'opus'])
  })

  test('a working subagent of the run keeps its proof across plain prompts', async ($, on) => {
    const { spawned } = setup(on)
    const plain = (text: string) => $.prompt.submit({ text, origin: { kind: 'composer' } } as never)
    await $.prompt.submit({ text: '/agt --fable ship it', origin: { kind: 'composer' } } as never)
    await plan($) // p1 is still working
    for (const t of ['one', 'two', 'three', 'four']) await plain(t)
    await plan($)
    expect(spawned.map((e) => e.model)).toEqual(['fable', 'fable'])
  })
})

// A worker pane's proof is the first prompt it is typed: the lead already rewrote fable=forced there when
// nobody typed --fable, so a header that still says it is the lead's proof carried over.
describe('typed proof: in a worker pane', () => {
  const setup = (on: any) => {
    const spawned: any[] = []
    on('env.get', async ($: any, e: any) => ({ value: ({ AGENTILLE_WORKER: 'executor:sonnet:medium', HOME: '/h' } as any)[e.name] }))
    on('session.start', async ($: any, e: any) => ({ cwd: e.cwd }))
    on('command.register', async () => ({ value: undefined }))
    on('store.get', async () => ({ value: undefined }))
    on('store.set', async () => ({ value: undefined }))
    on('ui.panes', async () => ({ value: [] }))
    on('ui.toast', async () => ({ value: undefined }))
    on('ui.render', async () => ({ type: 'engine', ref: 0 }) as never)
    on('prompt.submit', async ($: any, e: any) => ({ text: e.text }))
    on('fs.read', async () => ({ deny: 'no profile' }))
    on('fs.write', async () => ({ value: undefined }))
    on('agent.spawn', async ($: any, e: any) => { spawned.push(e); return { model: e.model ?? 'sonnet', agentId: 'w' + spawned.length } })
    mock.clock(on, { now: 1_000_000 })
    return spawned
  }
  const HDR = '[agt run=pf2 size=large work=build fable=forced]'
  const review = ($: any) => $.agent.spawn({ prompt: HDR + '\nreview it', subagentType: 'agentille:agentille-security-reviewer', model: 'opus' })

  test('a first prompt whose header says fable=forced is the lead\'s proof: the header holds', async ($, on) => {
    const spawned = setup(on)
    await $.session.start({ cwd: '/work/repo', surface: null, isInteractive: false })
    await $.prompt.submit({ text: HDR + '\nbuild the filter', origin: { kind: 'composer' } } as never)
    await review($)
    expect(spawned[0].model).toBe('fable')
    expect(spawned[0].prompt.split('\n')[0]).toBe(HDR)
  })

  test('a first prompt without it: a later fable=forced is dropped, and the first prompt decides once', async ($, on) => {
    const spawned = setup(on)
    await $.session.start({ cwd: '/work/repo', surface: null, isInteractive: false })
    await $.prompt.submit({ text: '[agt run=pf2 size=large work=build fable=auto]\nbuild the filter', origin: { kind: 'composer' } } as never)
    await review($)
    await $.prompt.submit({ text: HDR + '\nfix it', origin: { kind: 'composer' } } as never)
    await review($)
    expect(spawned.map((e) => e.model)).toEqual(['opus', 'opus'])
    expect(spawned[1].prompt.split('\n')[0]).toBe('[agt run=pf2 size=large work=build fable=auto]')
  })
})
