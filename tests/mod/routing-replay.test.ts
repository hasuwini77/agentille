import { describe, expect, test } from 'claude-code/testing'
import { DEFAULTS, FORMATIONS, MAX_EXECUTORS_AT_ONCE, decide, executorCapFlag, executorsWorking, formationOf, parseHeader } from '../../hooks/routing.js'
import { sliceOf } from '../../hooks/links.js'

// A deterministic replay of the eval suite (evals/<case>/case.yaml) against the code half of /agt's routing.
// Each case records what /agt should pick for a prompt; for the graders whose expectation lands on an exported
// function (the dispatch header's parse, decide()'s model and effort, the formation read, the executor cap), this
// file writes the header the lead would send for that case and asserts the mod routes it as the case expects.
// Test names are `<case>/<grader>`. The graders with no code half (the level and transport on the recon line, which
// roles the roster holds, a solo run's empty roster) are LLM decisions made from skill text: only the eval measures
// them. No LLM call here, and no host: every function below is pure.
//
// The cases say: treat ~/.agentille/profile.json as missing. So the settings are DEFAULTS (autoFable off) and
// thinkingDepth is unset (null), never `quick`.
const SETTINGS = DEFAULTS
const DEPTH = null
const fresh = () => ({ revise: 0, fixes: 0, fable: 0 })
const route = (role: string, line: string) => {
  const hdr = parseHeader(line)
  expect([line, hdr]).toEqual([line, expect.any(Object)])
  const d = decide({ role, hdr: hdr!, run: fresh(), depth: DEPTH, settings: SETTINGS })
  return [d.model, d.effort]
}

describe('replay: auth-gauntlet', () => {
  // '/agt "add password reset with emailed one-time tokens to the login flow; tests run with npm test (vitest)"'
  // The header's size is the lead's call (a small or a large plan); every assertion below holds for both.
  const headers = ['small', 'large'].map((size) => '[agt run=ag01 size=' + size + ' risk=auth mode=build fable=auto formation=gauntlet]')

  test('auth-gauntlet/header-risk-auth: the header parses to risk=auth, and risk=auth moves the routing', async () => {
    for (const line of headers) {
      expect(parseHeader(line)).toMatchObject({ run: 'ag01', risk: 'auth', mode: 'build', fable: 'auto', formation: 'gauntlet' })
      // The same header with risk=none routes the security-reviewer at opus · high: risk=auth is what reaches max.
      expect(route('security-reviewer', line.replace('risk=auth', 'risk=none'))).toEqual(['opus', 'high'])
    }
  })

  test('auth-gauntlet/security-reviewer-opus-max: the security-reviewer runs opus · max at either size', async () => {
    for (const line of headers) expect([line, route('security-reviewer', line)]).toEqual([line, ['opus', 'max']])
  })

  test('auth-gauntlet/formation-gauntlet: the header\'s formation=gauntlet is read as the run\'s formation', async () => {
    expect(FORMATIONS.has('gauntlet')).toBe(true)
    for (const line of headers) expect(formationOf(parseHeader(line))).toBe('gauntlet')
    // formation=none (or a missing or unknown one) is no formation, so the band never shows one the lead did not send.
    expect(formationOf(parseHeader('[agt run=ag01 size=small risk=auth mode=build fable=auto formation=none]'))).toBe(null)
    expect(formationOf(parseHeader('[agt run=ag01 size=small risk=auth mode=build fable=auto]'))).toBe(null)
    expect(formationOf(parseHeader('[agt run=ag01 formation=gauntlets]'))).toBe(null)
  })

  test('auth-gauntlet: the rest of the gauntlet roster routes as routing.md says under risk=auth', async () => {
    // Not a grader of its own: the roster line the case asks for lists each role with its model · effort, and these
    // are the cells the lead must write for the executor, the adversary and the code-reviewer of an auth run.
    for (const line of headers) {
      expect([line, route('executor', line)]).toEqual([line, ['sonnet', 'high']])
      expect([line, route('adversary', line)]).toEqual([line, ['opus', 'high']])
      expect([line, route('code-reviewer', line)]).toEqual([line, ['opus', 'high']])
    }
  })
})

describe('replay: parallel-slices', () => {
  // '/agt "add a CSV export endpoint in api/export.ts, and separately add a dark-mode toggle component in web/Toggle.tsx"'
  const api = '[agt run=ps01 size=small risk=none mode=build fable=auto formation=none slice=csv-export]'
  const ui = '[agt run=ps01 size=small risk=none mode=build fable=auto formation=none slice=dark-toggle]'

  test('parallel-slices/two-parallel-slices: two executor slices of one run, each routed on its own', async () => {
    // Two headers of the same run name two different slices: their executors, fix rounds and reviewers stay apart.
    expect(parseHeader(api)!.run).toBe(parseHeader(ui)!.run)
    expect(sliceOf(parseHeader(api))).toBe('csv-export')
    expect(sliceOf(parseHeader(ui))).toBe('dark-toggle')
    // Each slice's executor is sonnet, at any size (the executor never changes model); the code-reviewer of a small
    // slice is sonnet · medium.
    for (const line of [api, ui]) {
      expect([line, route('executor', line)]).toEqual([line, ['sonnet', 'medium']])
      expect([line, route('executor', line.replace('size=small', 'size=large'))]).toEqual([line, ['sonnet', 'high']])
      expect([line, route('code-reviewer', line)]).toEqual([line, ['sonnet', 'medium']])
    }
  })

  test('parallel-slices/two-parallel-slices: two executors at once are within the cap, and both count as working', async () => {
    expect(MAX_EXECUTORS_AT_ONCE).toBe(3)
    expect(executorCapFlag('ps01', 2)).toBe(null)
    expect(executorCapFlag('ps01', 3)).toBe(null)
    expect(executorCapFlag('ps01', 4)).toContain('4th executor at once')
    // The two slices as panes (heavy) and as subagents (medium) are both seen running at once.
    const now = 1_000_000
    const panes = [{ run: 'ps01', agent: 'executor', start: now - 1000 }, { run: 'ps01', agent: 'executor', start: now - 900 }]
    expect(executorsWorking(new Map(), panes, 'ps01', now)).toBe(2)
    const subs = new Map([
      ['a', { run: 'ps01', role: 'executor', state: 'working', start: now - 1000, heard: now - 10 }],
      ['b', { run: 'ps01', role: 'executor', state: 'working', start: now - 900, heard: now - 10 }],
    ])
    expect(executorsWorking(subs, [], 'ps01', now)).toBe(2)
  })
})

describe('replay: review-reviewers', () => {
  // '/agt "review the date formatting helpers in src/utils/date.ts"'
  // One helpers file, no logic diff of more than one file, no public API change: size=small (SKILL.md → "Dispatch
  // header"). The size matters here: a large review routes the code-reviewer at opus · high.
  const line = '[agt run=rr01 size=small risk=none mode=review fable=auto formation=none]'

  test('review-reviewers/code-reviewer-sonnet-medium: the code-reviewer of a small review runs sonnet · medium', async () => {
    expect(parseHeader(line)).toMatchObject({ size: 'small', risk: 'none', mode: 'review' })
    expect(route('code-reviewer', line)).toEqual(['sonnet', 'medium'])
    // The control: the same review at size=large is the other cell, so the case pins size=small.
    expect(route('code-reviewer', line.replace('size=small', 'size=large'))).toEqual(['opus', 'high'])
  })
})

// solo-one-liner (recon-solo, roster-none): a solo run dispatches no agent and writes no dispatch header, so there
// is nothing for the mod to route. Only the eval measures it.
