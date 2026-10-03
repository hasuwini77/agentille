import { describe, expect, test } from 'claude-code/testing'
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

