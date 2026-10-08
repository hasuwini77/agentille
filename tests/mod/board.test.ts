import { describe, expect, test } from 'claude-code/testing'
import { CHIP_WIDTH, SPIN, boardRows, cast, castColumns, chip, columns, header, leadLine, phaseOf, prettyModel, routingLines, spin, swarm, tokenBars, toolLabel, wireRow } from '../../hooks/board.js'
import { newAgent, finish, stage } from '../../hooks/live.js'
import { frame } from '../../hooks/mascot.js'

const sub = (id: string, role: string, model: string, start: number) => newAgent({ id, role, routed: true, model, effort: 'high', reason: 'table', run: 'r1', now: start })

describe('board', () => {
  test('prettyModel reads family and version from full ids', async () => {
    expect(prettyModel('claude-opus-5-5')).toBe('opus 5.5')
    expect(prettyModel('claude-haiku-4-5-20251001')).toBe('haiku 4.5')
    expect(prettyModel('sonnet')).toBe('sonnet')
    expect(prettyModel('claude-fable-5-1')).toBe('fable 5.1')
  })

  test('chips share one width so the columns line up', async () => {
    for (const m of ['haiku', 'sonnet', 'opus', 'claude-fable-5-1', 'gpt-x']) expect(chip(m).length).toBe(CHIP_WIDTH)
    expect(chip('claude-sonnet-5-5').trim()).toBe('sonnet')
  })

  test('toolLabel names the action and its target, never a whole path', async () => {
    expect(toolLabel('Edit', { file_path: '/a/b/Paywall.swift' })).toBe('Edit Paywall.swift')
    expect(toolLabel('Bash', { command: 'npm test -- --watch=false extra' })).toBe('Bash npm test --')
    expect(toolLabel('Grep', { pattern: 'Entitlement' })).toBe('Grep Entitlement')
    expect(toolLabel('WebFetch', { url: 'https://example.com/x' })).toBe('Fetch example.com')
    expect(toolLabel('mcp__agentille__spawn_pane', {})).toBe('spawn_pane')
  })

  test('spinners advance per tick and start offset per row', async () => {
    expect(spin(0)).toBe(SPIN[0])
    expect(spin(1)).toBe(SPIN[1])
    expect(spin(0, 1)).not.toBe(spin(0, 0))
  })

  test('narrow bands drop the transport, effort and token columns', async () => {
    expect(columns(120)).toMatchObject({ kind: true, effort: true, tok: true, role: 16 })
    expect(columns(70)).toMatchObject({ kind: false, effort: false, tok: true, role: 12 })
    expect(columns(60).tok).toBe(false)
  })

  test('cast keeps finished subagents as history while the run still works', async () => {
    const a = sub('a', 'planner', 'opus', 1)
    const b = sub('b', 'executor', 'sonnet', 2)
    finish(a, 5, 4)
    const agents = new Map([['a', a], ['b', b]])
    expect(cast(stage({ agents, run: 'r1', now: 100_000 }), agents, 'r1').map((r: any) => r.id)).toEqual(['a', 'b'])
    finish(b, 6, 4)
    expect(cast(stage({ agents, run: 'r1', now: 100_000 }), agents, 'r1')).toEqual([])
  })

  test('rows: tree, kind glyph, done check, blocked flag, pane tokens from the wire', async () => {
    const a = sub('a', 'code-reviewer', 'claude-sonnet-5-5', 0)
    a.tool = 'Grep Entitlement'
    a.input = 1000
    const p = { id: 'w:p2', kind: 'pane', name: 'agt-r1-exec-1', role: 'exec-1', vendor: 'claude', state: 'working', start: 0, model: 'sonnet', effort: 'high', reason: 'fix attempt 2' }
    const q = { ...p, id: 'w:p3', name: 'agt-r1-exec-2', role: 'exec-2', state: 'blocked', reason: null }
    const wire = new Map([['agt-r1-exec-1', { tool: 'Edit A.swift', tok: 31200 }]])
    const v = boardRows([a, p, q], { now: 102_000, tick: 0, cols: 120, wire, transport: 'herdr' })
    expect(v.map((r) => r.tree)).toEqual(['├─', '├─', '└─'])
    expect(v[0]).toMatchObject({ glyph: '◇', activity: 'Grep Entitlement', pane: false })
    expect(v[0].time.trim()).toBe('1:42')
    expect(v[1]).toMatchObject({ glyph: '▣', activity: 'Edit A.swift', escalated: true, pane: true })
    expect(v[1].kind.trim()).toBe('herdr')
    expect(v[1].tok.trim()).toBe('31.2k')
    expect(v[2].activity).toBe('⚑ waiting on you')
    finish(a, 1, 1)
    expect(boardRows([a], { now: 5 })[0]).toMatchObject({ glyph: '✓', dim: true, activity: 'done' })
  })

  test('header counts working subagents and live sessions; lead line says what the lead does', async () => {
    const rows = [{ kind: 'sub', state: 'working' }, { kind: 'sub', state: 'done' }, { kind: 'pane', state: 'working' }, { kind: 'pane', state: 'idle' }]
    expect(header({ run: 'r1', formation: 'gauntlet', rows, tally: { tok: 50_300 } })).toEqual({ left: 'run r1 · gauntlet', right: '◇1 ▣1 · 50.3k' })
    expect(leadLine({ model: 'claude-opus-5-5', busy: false, waiting: 2 })).toMatchObject({ text: 'lead · opus 5.5', state: 'waiting on 2' })
    expect(leadLine({ model: null, busy: true, waiting: 0 }).state).toBe('orchestrating')
  })

  test('the wire row shows the newest message for two minutes', async () => {
    const log = [{ from: 'exec-1', to: 'lead', kind: 'done', summary: 'slice built', at: 0 }]
    expect(wireRow(log, 12_000)).toEqual({ arrow: 'exec-1 → lead', text: '"slice built"', ago: '12s' })
    expect(wireRow(log, 121_000)).toBe(null)
    expect(wireRow([], 0)).toBe(null)
  })

  test('deck: cast fits the width, timeline marks escalations, bars scale to the top role', async () => {
    const rows = [sub('a', 'planner', 'opus', 0), sub('b', 'executor', 'sonnet', 1)]
    const c = castColumns(rows, { cols: 20, frameOf: frame, moodOf: () => 'working' })
    expect(c.cells.length).toBe(1)
    expect(c.more).toBe(1)
    expect(c.cells[0].lines.length).toBe(3)
    const t = routingLines([{ at: '2026-10-07T10:00:00Z', role: 'planner', model: 'fable', effort: 'high', reason: 'plan REVISE ×2' }])
    expect(t[0]).toMatchObject({ escalated: true, reason: '↑ plan REVISE ×2' })
    const bars = tokenBars({ roles: { executor: { input: 900, output: 100 }, planner: { input: 400, output: 100 } } }, 10)
    expect(bars.map((b) => b.name.trim())).toEqual(['executor', 'planner'])
    expect(bars[0].bar).toBe('██████████')
    expect(bars[1].bar).toBe('█████░░░░░')
  })
})

describe('swarm', () => {
  const agents = () => {
    const m = new Map()
    const add = (id: string, role: string, model: string, start: number) => m.set(id, sub(id, role, model, start))
    add('p', 'planner', 'opus', 1)
    add('e1', 'executor', 'sonnet', 2)
    add('c', 'code-reviewer', 'sonnet', 3)
    add('d', 'design-reviewer', 'opus', 4)
    add('x', 'Explore', 'haiku', 5)
    return m
  }

  test('below three agents there is no swarm line', async () => {
    const m = agents()
    m.delete('x'); m.delete('d'); m.delete('c')
    expect(swarm({ agents: m, run: 'r1' })).toBe(undefined)
  })

  test('groups the run by phase, in phase order, done ones included', async () => {
    const m = agents()
    finish(m.get('p'), 10, 5)
    const s = swarm({ agents: m, run: 'r1', tick: 0 })!
    expect(s.lanes.map((l) => l.phase)).toEqual(['plan', 'build', 'review', 'other'])
    expect(s.lanes[0].cells[0]).toMatchObject({ glyph: '✓', dim: true })
    expect(s.lanes[2].cells.map((c) => c.glyph)).toEqual(['◆', '◆'])
    expect(s).toMatchObject({ done: 1, total: 5 })
  })

  test('working cells pulse on the ticker; failed ones show ✗', async () => {
    const m = agents()
    m.get('c').listStatus = 'failed'
    const a = swarm({ agents: m, run: 'r1', tick: 0 })!
    const b = swarm({ agents: m, run: 'r1', tick: 2 })!
    expect(a.lanes[1].cells[0].glyph).toBe('◆')
    expect(b.lanes[1].cells[0].glyph).toBe('◇')
    expect(a.lanes[2].cells[0]).toMatchObject({ glyph: '✗', color: 'error' })
  })

  test('pane workers count from their routes, other runs are left out, long lanes cap', async () => {
    const m = new Map()
    for (let i = 0; i < 10; i++) m.set('r' + i, sub('r' + i, 'code-reviewer', 'sonnet', i))
    m.set('o', { ...sub('o', 'planner', 'opus', 0), run: 'other' })
    const routes = [{ name: 'agt-r1-exec-1', run: 'r1', role: 'exec-1', agent: 'executor', model: 'sonnet', start: 0, end: null }]
    const s = swarm({ agents: m, routes, run: 'r1', tick: 0 })!
    expect(s.lanes.map((l) => l.phase)).toEqual(['build', 'review'])
    expect(s.lanes[0].cells[0].glyph).toBe('▣')
    expect(s.lanes[1]).toMatchObject({ more: 2 })
    expect(s.lanes[1].cells.length).toBe(8)
    expect(s.total).toBe(11)
  })

  test('phaseOf sorts every routed role', async () => {
    expect(['planner', 'plan-reviewer', 'ui-prototyper'].map(phaseOf)).toEqual(['plan', 'plan', 'plan'])
    expect(['executor', 'adversary'].map(phaseOf)).toEqual(['build', 'build'])
    expect(['code-reviewer', 'seo-reviewer', 'payments-reviewer'].map(phaseOf)).toEqual(['review', 'review', 'review'])
    expect(phaseOf('Explore')).toBe('other')
  })
})
