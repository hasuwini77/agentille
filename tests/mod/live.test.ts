import { describe, expect, test } from 'claude-code/testing'
import { cells, pixels } from '../../hooks/sprites.js'
import { DONE_GRACE_MS, IDLE_GRACE_MS, isAgtPrompt, shouldAutoOpen, ledger, newAgent, addUsage, finish, paneAgents, reapable, visible, endsOnQuestion, reopenOnReply, WAIT_TTL_MS } from '../../hooks/live.js'
import { activeSquads, depsOf, injection } from '../../hooks/squads.js'

const ROLES = ['planner', 'plan-reviewer', 'ui-prototyper', 'executor', 'code-reviewer', 'design-reviewer', 'security-reviewer', 'payments-reviewer', 'seo-reviewer', 'perf-reviewer', 'Explore']

describe('sprites', () => {
  test('every role is a 16×16 sprite in both frames', async () => {
    for (const role of ROLES) for (const f of [0, 1]) {
      const px = pixels(role, f)
      expect(px.length).toBe(16)
      for (const line of px) expect(line.length).toBe(16)
    }
  })

  test('hat color follows the model, frames differ', async () => {
    const len = cells('executor', 'claude-opus-5-5').length
    expect(len).toBe(2048) // 16×8 cells × 3 u32 → 1536 bytes → base64
    expect(cells('executor', 'claude-opus-5-5')).not.toBe(cells('executor', 'claude-sonnet-5-5'))
    expect(cells('planner', 'opus', 0)).not.toBe(cells('planner', 'opus', 1))
  })
})

describe('live', () => {
  const herdr = [
    { name: 'agt-r1-executor-ui', pane_id: 'w1:p2', agent: 'claude', agent_status: 'working', state_change_seq: 3 },
    { name: 'agt-r1-code-reviewer', pane_id: 'w1:p3', agent: 'codex', agent_status: 'done', state_change_seq: 5 },
    { name: 'someone-else', pane_id: 'w1:p4', agent: 'claude', agent_status: 'idle', state_change_seq: 1 },
    { name: 'agt-r1-lead', pane_id: 'w1:p1', agent: 'claude', agent_status: 'working', state_change_seq: 9 },
  ]

  test('only agt-* panes other than this one are tracked', async () => {
    const p = paneAgents(herdr, 'w1:p1')
    expect(p.map((x) => x.id)).toEqual(['w1:p2', 'w1:p3'])
    expect(p[0]).toMatchObject({ role: 'executor-ui', run: 'r1', vendor: 'claude' })
    expect(paneAgents([{ ...herdr[0], tab_id: 'w1:t1', workspace_id: 'w1' }], null)[0]).toMatchObject({ tab: 'w1:t1', workspace: 'w1' })
  })

  test('reaper waits out the grace and resets on a state change', async () => {
    const seen = new Map()
    const p = paneAgents(herdr, 'w1:p1')
    expect(reapable(p, seen, 0)).toEqual([])
    expect(reapable(p, seen, DONE_GRACE_MS - 1)).toEqual([])
    expect(reapable(p, seen, DONE_GRACE_MS).map((x) => x.id)).toEqual(['w1:p3'])
    const bumped = p.map((x) => (x.id === 'w1:p3' ? { ...x, seq: 6 } : x))
    expect(reapable(bumped, seen, DONE_GRACE_MS + 1)).toEqual([])
    const idle = [{ ...p[0], state: 'idle', seq: 4 }]
    const s2 = new Map()
    reapable(idle, s2, 0)
    expect(reapable(idle, s2, IDLE_GRACE_MS - 1)).toEqual([])
    expect(reapable(idle, s2, IDLE_GRACE_MS).length).toBe(1)
  })

  test('ledger sums tokens per role for one run', async () => {
    const m = new Map()
    const a = newAgent({ id: 'a', role: 'executor', routed: true, model: 'sonnet', effort: 'medium', reason: 'table', run: 'r1', now: 0 })
    const b = newAgent({ id: 'b', role: 'executor', routed: true, model: 'sonnet', effort: 'high', reason: 'fix attempt 2', run: 'r1', now: 0 })
    const c = newAgent({ id: 'c', role: 'planner', routed: true, model: 'opus', effort: 'high', reason: 'table', run: 'r0', now: 0 })
    addUsage(a, { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 2 })
    addUsage(b, { input_tokens: 1, output_tokens: 1 })
    finish(a, 0, 4000)
    for (const x of [a, b, c]) m.set(x.id, x)
    const l = ledger(m, 'r1')
    expect(l.roles.executor).toEqual({ agents: 2, input: 13, output: 6, cacheRead: 100, ms: 4000 })
    expect(l.roles.planner).toBe(undefined)
    expect(visible(m, [], 5000).map((x) => x.id)).toEqual(['b', 'a'])
  })
})

describe('squads', () => {
  const config = { squads: [
    { name: 'saas', label: 'Micro SaaS', minScore: 2, signals: { deps: ['stripe', 'next-auth'], paths: ['app/api/webhooks'] }, adds: ['payments-reviewer'], checklists: { 'security-reviewer': ['verify webhook signatures'] } },
    { name: 'content', label: 'Content', minScore: 2, signals: { deps: ['@next/mdx'], paths: ['content'] }, adds: ['seo-reviewer'], checklists: {} },
  ] }

  test('scores deps + paths against minScore', async () => {
    const deps = depsOf(JSON.stringify({ dependencies: { stripe: '1' }, devDependencies: { vitest: '1' } }))
    expect(activeSquads(config, deps, new Set()).length).toBe(0)
    const on = activeSquads(config, deps, new Set(['app/api/webhooks']))
    expect(on.map((s) => s.name)).toEqual(['saas'])
    expect(on[0].matched).toEqual(['stripe', 'app/api/webhooks'])
  })

  test('injection names specialists and checklists', async () => {
    const block = injection(activeSquads(config, new Set(['stripe', 'next-auth']), new Set()))
    expect(block).toContain('agentille:agentille-payments-reviewer')
    expect(block).toContain('verify webhook signatures')
    expect(injection([])).toBe('')
  })
})

describe('band', () => {
  test('a routed spawn shows up above the prompt with model and effort', async ($, on) => {
    on('store.get', async () => ({ value: null }))
    on('agent.spawn', async ($, e) => ({ model: 'claude-opus-5-5', agentId: 'band1' }))
    on('ui.render', async () => ({ type: 'engine', ref: 0 }) as never)
    await $.agent.spawn({ prompt: '[agt run=bandrun size=large mode=review]\nreview', subagentType: 'agentille:agentille-code-reviewer' })
    const ui = await $.ui.mount({ plugin: 'agentille', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 100 } as never })
    expect(await ui.find({ type: 'Text', text: /code-reviewer/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /opus ▆ high/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /run bandrun/ })).toBeDefined()
    await ui.unmount()
  })
})

describe('deck auto-open', () => {
  test('only a typed /agt run counts', async () => {
    expect(isAgtPrompt('/agt add a search filter')).toBe(true)
    expect(isAgtPrompt('/agt')).toBe(true)
    expect(isAgtPrompt('/agentille:agt "review the diff"')).toBe(true)
    expect(isAgtPrompt('/agt-deck')).toBe(false)
    expect(isAgtPrompt('/agt-nodeck')).toBe(false)
    expect(isAgtPrompt('/agentille-init')).toBe(false)
    expect(isAgtPrompt('run /agt later')).toBe(false)
    expect(isAgtPrompt(undefined)).toBe(false)
  })

  test('opens unless off, already open, or closed by hand this run', async () => {
    expect(shouldAutoOpen({ auto: undefined, open: false, dismissedRun: null, run: 'r1' })).toBe(true)
    expect(shouldAutoOpen({ auto: true, open: false, dismissedRun: 'r0', run: 'r1' })).toBe(true)
    expect(shouldAutoOpen({ auto: false, open: false, dismissedRun: null, run: 'r1' })).toBe(false)
    expect(shouldAutoOpen({ auto: true, open: true, dismissedRun: null, run: 'r1' })).toBe(false)
    expect(shouldAutoOpen({ auto: true, open: false, dismissedRun: 'r1', run: 'r1' })).toBe(false)
  })
})

describe('waiting deck', () => {
  test('a question at the end keeps the deck waiting for the reply', async () => {
    expect(endsOnQuestion('Stripe or Paddle?')).toBe(true)
    expect(endsOnQuestion('Which one do you want? **')).toBe(true)
    expect(endsOnQuestion('Is it fine? Done, merged.')).toBe(false)
    expect(endsOnQuestion('')).toBe(false)
  })

  test('a reply reopens only while the wait is fresh', async () => {
    expect(reopenOnReply({ waiting: { at: 0 }, now: 60_000 })).toBe(true)
    expect(reopenOnReply({ waiting: { at: 0 }, now: WAIT_TTL_MS + 1 })).toBe(false)
    expect(reopenOnReply({ waiting: null, now: 0 })).toBe(false)
  })
})
