import { describe, expect, test } from 'claude-code/testing'
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

describe('deck', () => {
  const opens = (on: any, stored: any[] = []) => {
    const seen: any[] = []
    const closed: any[] = []
    on('store.get', async () => ({ value: undefined }))
    on('store.set', async ($: any, e: any) => { stored.push(e); return { value: undefined } })
    on('ui.panes', async () => ({ value: [] }))
    on('ui.open', async ($: any, e: any) => { seen.push(e); return { value: { isPlaced: true } } })
    on('ui.close', async ($: any, e: any) => { closed.push(e); return { value: undefined } })
    on('prompt.submit', async ($: any, e: any) => ({ text: e.text }))
    on('turn.complete', async ($: any, e: any) => ({ text: e.answer }))
    on('agent.spawn', async ($: any, e: any) => ({ model: e.model ?? 'sonnet', agentId: 'x' + Math.random() }))
    return { seen, closed }
  }
  const spawn = ($: any, type = 'agentille:agentille-executor') =>
    $.agent.spawn({ prompt: '[agt run=d1 size=small mode=build]\nbuild', subagentType: type, model: 'sonnet' })
  const end = ($: any, answer = 'Done: one file changed.') =>
    $.turn.complete({ answer, durationMs: 10, isAborted: false, turnId: 't', reason: 'answer' })

  test('a typed /agt opens it at once, unfocused: asked, so it seats at any width', async ($, on) => {
    const { seen } = opens(on)
    await $.prompt.submit({ text: '/agt add a search filter', wait: false })
    expect(seen.length).toBe(1)
    expect(seen[0]).toMatchObject({ id: 'agt-deck' })
    expect(seen[0].focus).toBe(undefined)
  })

  test('the first agent fills the open deck: no second open, no close at turn end', async ($, on) => {
    const { seen, closed } = opens(on)
    await $.prompt.submit({ text: '/agt add a search filter', wait: false })
    await spawn($)
    await spawn($)
    await end($)
    expect(seen.length).toBe(1)
    expect(closed.length).toBe(0)
  })

  test('a solo run closes the waiting strip when its turn ends', async ($, on) => {
    const { closed } = opens(on)
    await $.prompt.submit({ text: '/agt fix the typo in README.md', wait: false })
    await end($)
    expect(closed).toContainEqual(expect.objectContaining({ id: 'agt-deck' }))
  })

  test('a run that asks first closes the strip, and the reply reopens it', async ($, on) => {
    const { seen, closed } = opens(on)
    await $.prompt.submit({ text: '/agt add billing', wait: false })
    await end($, 'Which provider should I use: Stripe or Paddle?')
    expect(closed.length).toBe(1)
    await $.prompt.submit({ text: 'Stripe', wait: false })
    expect(seen.length).toBe(2)
    await spawn($)
    await end($)
    expect(closed.length).toBe(1)
  })

  test('after a finished solo run, an unrelated prompt does not reopen it', async ($, on) => {
    const { seen } = opens(on)
    await $.prompt.submit({ text: '/agt fix the typo', wait: false })
    await end($)
    await $.prompt.submit({ text: 'thanks', wait: false })
    expect(seen.length).toBe(1)
  })

  test('other prompts, agt-* commands and non-agentille agents never open it', async ($, on) => {
    const { seen } = opens(on)
    await $.prompt.submit({ text: 'fix the header', wait: false })
    await $.prompt.submit({ text: '/agt-ledger', wait: false })
    await spawn($, 'Explore')
    expect(seen.length).toBe(0)
  })

  test('/agt-nodeck turns auto-open off and remembers it', async ($, on) => {
    const stored: any[] = []
    const { seen } = opens(on, stored)
    await $.command.run({ command: 'agt-nodeck' })
    await $.prompt.submit({ text: '/agt add a search filter', wait: false })
    await spawn($)
    expect(seen.length).toBe(0)
    expect(stored).toContainEqual(expect.objectContaining({ key: 'deck:auto', value: false }))
  })
})
