import { describe, expect, mock, test } from 'claude-code/testing'
import { answerLine, linkPieces, loopText, party, pieceOf, taskLine, verdictChip } from '../../hooks/links.js'
import { boardRows, runPhases, wireLines, wireRow } from '../../hooks/board.js'
import { nest } from '../../hooks/tree.js'

const row = (id: string, role: string, piece: string | null, over: object = {}) => ({ id, kind: 'sub', role, piece, parentId: null, state: 'working', start: 0, input: 0, output: 0, ...over })

describe('links: pure', () => {
  test('a piece is a short lowercase slug; anything else is no piece', async () => {
    expect(pieceOf({ piece: 'api' })).toBe('api')
    expect(pieceOf({ piece: 'checkout-ui' })).toBe('checkout-ui')
    expect(pieceOf({ piece: 'Api' })).toBe(null)
    expect(pieceOf({ piece: '../x' })).toBe(null)
    expect(pieceOf({})).toBe(null)
    expect(pieceOf(null)).toBe(null)
  })

  test('verdict chips per role, with only the P0/P1 counts that are not zero', async () => {
    expect(verdictChip('code-reviewer', 'VERDICT: PASS · P0:0 P1:0 P2:3')).toEqual({ text: 'PASS', tone: 'success' })
    expect(verdictChip('security-reviewer', 'VERDICT: FAIL · P0:1 P1:0\nFIX: a.ts:3 x')).toEqual({ text: 'FAIL P0:1', tone: 'error' })
    expect(verdictChip('design-reviewer', 'VERDICT: CONCERNS · P0:0 P1:2')).toEqual({ text: 'CONCERNS P1:2', tone: 'warning' })
    expect(verdictChip('plan-reviewer', 'APPROVE — nothing warrants a REVISE')).toEqual({ text: 'APPROVE', tone: 'success' })
    expect(verdictChip('plan-reviewer', 'VERDICT: REVISE')).toEqual({ text: 'REVISE', tone: 'warning' })
    expect(verdictChip('adversary', 'BROKEN: 2 · HELD: 4')).toEqual({ text: 'BROKEN 2', tone: 'error' })
    expect(verdictChip('adversary', 'BROKEN: 0 · HELD: 6')).toEqual({ text: 'HELD', tone: 'success' })
    expect(verdictChip('code-reviewer', 'looks fine')).toBe(null)
    expect(verdictChip('executor', 'VERDICT: PASS')).toBe(null)
  })

  test("a piece's reviewers hang under its newest builder; a shown parent wins", async () => {
    const rows = [
      row('e1', 'executor', 'api', { start: 1 }),
      row('e2', 'executor', 'api', { start: 2 }),
      row('cr', 'code-reviewer', 'api', { start: 3 }),
      row('sr', 'security-reviewer', 'ui', { start: 4 }),
      row('own', 'design-reviewer', 'api', { start: 5, parentId: 'e1' }),
      row('p1', 'executor', 'ui', { kind: 'pane', role: 'exec-ui', agent: 'executor', start: 0 }),
    ]
    const linked = linkPieces(rows)
    expect(linked.find((r) => r.id === 'cr')?.parentId).toBe('e2')
    expect(linked.find((r) => r.id === 'sr')?.parentId).toBe('p1')
    expect(linked.find((r) => r.id === 'own')?.parentId).toBe('e1')
    expect(linked.find((r) => r.id === 'e1')?.parentId).toBe(null)
    const tree = nest(linked).map((r) => r.id)
    expect(tree.indexOf('cr')).toBe(tree.indexOf('e2') + 1)
  })

  test('with one builder, a checker that names no piece is its; planning roles and two builders stay put', async () => {
    const one = linkPieces([row('e', 'executor', null), row('c', 'code-reviewer', null), row('a', 'adversary', null), row('p', 'plan-reviewer', null), row('u', 'ui-prototyper', null)])
    expect(one.map((r) => r.parentId)).toEqual([null, 'e', 'e', null, null])
    const two = [row('e1', 'executor', null), row('e2', 'executor', null), row('c', 'code-reviewer', null)]
    expect(linkPieces(two)).toEqual(two)
    const mixed = linkPieces([row('e1', 'executor', 'api'), row('e2', 'executor', 'web'), row('c', 'code-reviewer', null)])
    expect(mixed.find((r) => r.id === 'c')?.parentId).toBe(null)
  })

  test('task and answer lines skip the header and the profile prefix', async () => {
    expect(taskLine('[agt run=r1 piece=api]\nUser: Kim (dev). Avoid: x\nCommunicate: direct\n\nReview the api diff on feat/x')).toBe('Review the api diff on feat/x')
    expect(taskLine('[agt run=r1]')).toBe('')
    expect(answerLine('code-reviewer', 'VERDICT: FAIL · P0:1')).toBe('FAIL P0:1')
    expect(answerLine('executor', '## Built the api\nVERIFICATION: ok')).toBe('Built the api')
    expect(answerLine('executor', '')).toBe('done')
    expect(party('code-reviewer', 'api')).toBe('code-reviewer:api')
    expect(party('lead')).toBe('lead')
  })

  test('loops read plan ↺n · fix ×n, and nothing without loops', async () => {
    expect(loopText({ revise: 1, fixes: 3 })).toBe('plan ↺1 · fix ×3')
    expect(loopText({ revise: 0, fixes: 2 })).toBe('fix ×2')
    expect(loopText({ revise: 0, fixes: 0 })).toBe('')
    expect(loopText(undefined)).toBe('')
  })
})

describe('links: on the board', () => {
  test('a finished reviewer row reads its verdict in its tone', async () => {
    const [pass, fail, plain] = boardRows([
      row('a', 'code-reviewer', null, { state: 'done', end: 10, verdict: { text: 'PASS', tone: 'success' } }),
      row('b', 'security-reviewer', null, { state: 'done', end: 10, verdict: { text: 'FAIL P0:1', tone: 'error' } }),
      row('c', 'executor', null, { state: 'done', end: 10 }),
    ], { now: 20 })
    expect(pass).toMatchObject({ activity: 'PASS', verdict: '#3fb950' })
    expect(fail).toMatchObject({ activity: 'FAIL P0:1', verdict: 'error' })
    expect(plain).toMatchObject({ activity: 'done', verdict: null })
  })

  test('the band wire row skips subagent traffic; the deck keeps the whole conversation', async () => {
    const log = [
      { from: 'exec-1', to: 'lead', kind: 'done', summary: 'slice built', at: 0 },
      { from: 'lead', to: 'code-reviewer:api', kind: 'task', summary: 'review the api diff', at: 1000, via: 'sub' },
    ]
    expect(wireRow(log, 2000)?.arrow).toBe('exec-1 → lead')
    const lines = wireLines(log)
    expect(lines.map((l) => l.arrow.trim())).toEqual(['exec-1 → lead', 'lead → code-reviewer:api'])
    expect(lines.map((l) => l.sub)).toEqual([false, true])
  })

  test('the spinner phases follow what of the run still works', async () => {
    const agents = new Map([
      ['a', { run: 'r1', role: 'executor', state: 'working' }],
      ['b', { run: 'r1', role: 'code-reviewer', state: 'working' }],
      ['c', { run: 'r1', role: 'planner', state: 'done' }],
      ['d', { run: 'r2', role: 'planner', state: 'working' }],
    ])
    expect(runPhases(agents, [], 'r1')).toBe('build + review')
    expect(runPhases(new Map(), [{ run: 'r1', agent: 'executor', end: null }], 'r1')).toBe('build')
    expect(runPhases(new Map(), [], 'r1')).toBe('')
    expect(runPhases(new Map([['g', { run: 'r1', role: 'general-purpose', state: 'working' }]]), [], 'r1')).toBe('')
  })
})

describe('links: in the mod', () => {
  const spawnAs = (on: any) => {
    let n = 0
    on('store.get', async () => ({ value: null }))
    on('agent.spawn', async () => ({ model: 'claude-sonnet-5-5', agentId: 'lk' + ++n }))
    on('ui.render', async () => ({ type: 'engine', ref: 0 }) as never)
    on('turn.complete', async ($: any, e: any) => ({ text: e.answer }) as never)
    on('agent.list', async () => ({ value: [] }) as never)
    mock.clock(on, { now: 1_000_000 })
  }
  const mount = ($: any) => $.ui.mount({ plugin: 'agentille', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: true, maxRows: 12, bodyColumns: 120 } as never })

  test('a reviewer of a piece sits under its executor and turns into its verdict', async ($, on) => {
    spawnAs(on)
    await $.agent.spawn({ prompt: '[agt run=lkrun size=small mode=build piece=api]\nbuild the api', subagentType: 'agentille:agentille-executor' })
    await $.agent.spawn({ prompt: '[agt run=lkrun size=small mode=build piece=web]\nbuild the page', subagentType: 'agentille:agentille-executor' })
    await $.agent.spawn({ prompt: '[agt run=lkrun size=small mode=review piece=api]\nreview the api diff', subagentType: 'agentille:agentille-code-reviewer' })
    const ui = await mount($)
    const trees = (await ui.findAll({ type: 'Text', text: /^[│ ]*[├└]─/ })).map((t: any) => t.text)
    expect(trees.some((t: string) => /^[│ ]+└─/.test(t))).toBe(true) // one row is nested under another
    await ui.unmount()
    await $.turn.complete({ agentId: 'lk3', answer: 'VERDICT: FAIL · P0:1 P1:0\nFIX: api.ts:4 check auth', durationMs: 10, isAborted: false, turnId: 'tlk3', reason: 'answer', usage: { input_tokens: 10, output_tokens: 5 } } as never)
    const after = await mount($)
    expect(await after.find({ type: 'Text', text: /^FAIL P0:1$/ })).toBeDefined()
    await after.unmount()
  })

  test('a one-slice run nests its reviewer under the executor without any piece=', async ($, on) => {
    spawnAs(on)
    await $.agent.spawn({ prompt: '[agt run=onerun size=small mode=build]\nbuild it', subagentType: 'agentille:agentille-executor' })
    await $.agent.spawn({ prompt: '[agt run=onerun size=small mode=review]\nreview it', subagentType: 'agentille:agentille-code-reviewer' })
    const ui = await mount($)
    const trees = (await ui.findAll({ type: 'Text', text: /^[│ ]*[├└]─/ })).map((t: any) => t.text)
    expect(trees.some((t: string) => /^[│ ]+└─/.test(t))).toBe(true)
    await ui.unmount()
  })

  test('a REVISE and a fix attempt show as loops in the band header', async ($, on) => {
    spawnAs(on)
    await $.agent.spawn({ prompt: '[agt run=looprun size=small mode=build]\nplan', subagentType: 'agentille:agentille-plan-reviewer' })
    await $.turn.complete({ agentId: 'lk1', answer: 'VERDICT: REVISE', durationMs: 10, isAborted: false, turnId: 'tl1', reason: 'answer', usage: {} } as never)
    await $.agent.spawn({ prompt: '[agt run=looprun size=small mode=fix]\nfix it', subagentType: 'agentille:agentille-executor' })
    const ui = await mount($)
    expect(await ui.find({ type: 'Text', text: /plan ↺1 · fix ×1/ })).toBeDefined()
    await ui.unmount()
  })
})
