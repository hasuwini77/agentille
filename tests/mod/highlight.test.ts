import { describe, expect, mock, test } from 'claude-code/testing'
import { CARD_MIN_WORDS, LIT_MEMO_MAX, essentials, highlight, highlightText, lightTokens, litFor, parseHighlightArgs, spans } from '../../hooks/highlight.js'

const T = '`'
const FENCE = T + T + T

describe('highlight: lightTokens', () => {
  test('wraps paths, versions, refs and numbers, punctuation stays outside', async () => {
    expect(lightTokens('Edit hooks/live.js:74 and ~/.agentille/profile.json.')).toBe('Edit `hooks/live.js:74` and `~/.agentille/profile.json`.')
    expect(lightTokens('released v2.6.0.')).toBe('released `v2.6.0`.')
    expect(lightTokens('Closes #74 (see #73).')).toBe('Closes `#74` (see `#73`).')
    expect(lightTokens('1.12×, ~55k, 2.5s, 100%, 300ms')).toBe('`1.12×`, ~`55k`, `2.5s`, `100%`, `300ms`')
    expect(lightTokens('**v2.6.0**')).toBe('**`v2.6.0`**')
    expect(lightTokens('/agt-ledger')).toBe('`/agt-ledger`')
  })

  test('leaves everything else alone', async () => {
    for (const s of [
      'and/or', 'Next.js', '10.0.0.1', '#3fb950', 'pass/fail', '122 pass', 'tests/mod', '0x1f', 'PR#5', '2026-10-04',
      T + 'x.js' + T, '[a/b.js](a/b.js)', '![a/b.png](a/b.png)', '<https://x.io/a>', 'https://example.com/a/b.js', 'www.a.io/b/c.js',
      'odd ' + T + ' hooks/live.js', '[id]: hooks/live.js',
    ]) expect(lightTokens(s)).toBe(s)
  })

  test('fences copy verbatim: any indent, same character, long enough, unclosed runs on', async () => {
    const list = '1. Run:\n   ' + FENCE + 'bash\n   node hooks/live.js\n   ' + FENCE
    expect(lightTokens(list)).toBe(list)
    const four = T + T + T + T + 'md\n' + FENCE + '\nhooks/live.js\n' + FENCE + '\n' + T + T + T + T
    expect(lightTokens(four)).toBe(four)
    const tilde = '~~~\nsee hooks/live.js\n' + FENCE + '\n~~~\nsee hooks/live.js'
    expect(lightTokens(tilde)).toBe('~~~\nsee hooks/live.js\n' + FENCE + '\n~~~\nsee `hooks/live.js`')
    const open = FENCE + '\nhooks/live.js'
    expect(lightTokens(open)).toBe(open)
  })

  test('idempotent, and removing the added backticks restores the input', async () => {
    const s = 'Edit hooks/live.js:74, v2.6.0 (#75) 1.12× and/or /agt-ledger.\n- **v2.6.0** ~55k'
    const once = lightTokens(s)
    expect(lightTokens(once)).toBe(once)
    expect(once.replaceAll(T, '')).toBe(s)
  })
})

describe('highlight: essentials', () => {
  test('next, flag, done — one each, in that order', async () => {
    const text = 'Shipped v2.6.0: PR #75 merged, tag pushed.\n\n- ✓ 131 pass / 0 fail\n- ⚑ tmux select-layout failed on tmux 3.0\nNext: run /agt-highlight off if the dim body bothers you.'
    expect(essentials(text)).toEqual([
      { kind: 'next', text: 'run /agt-highlight off if the dim body bothers you.' },
      { kind: 'flag', text: 'tmux select-layout failed on tmux 3.0' },
      { kind: 'done', text: 'Shipped v2.6.0: PR #75 merged, tag pushed.' },
    ])
  })

  test('what is not a flag, and what is', async () => {
    for (const s of ['122 pass / 0 fail', 'tsc --noEmit: no errors', '0 failed, 0 errors', 'Added error handling to the poll loop.', 'Approve, nothing warrants a revise'])
      expect(essentials(s).filter((i) => i.kind === 'flag')).toEqual([])
    for (const s of ['2 failed', 'Error: ENOENT', 'VERDICT: CONCERNS', 'This needs you: pick one', 'Blocked on the API key', '3 type errors'])
      expect(essentials(s).map((i) => i.kind)).toEqual(['flag'])
  })

  test('done, next step, fences, headings, empty', async () => {
    expect(essentials('Not merged yet')).toEqual([])
    expect(essentials('Not Merged yet')).toEqual([])
    expect(essentials('**Next step:** tag v2.6.0')).toEqual([{ kind: 'next', text: 'tag v2.6.0' }])
    expect(essentials(FENCE + '\nfailed\n' + FENCE)).toEqual([])
    expect(essentials('1. Steps:\n   ' + FENCE + '\n   2 failed\n   ' + FENCE)).toEqual([])
    expect(essentials('## Done')).toEqual([])
    expect(essentials('nothing to see here')).toEqual([])
    expect(essentials('✓ ' + 'y'.repeat(200))[0].text.length).toBe(96)
  })
})

describe('highlight: spans', () => {
  test('code, paths, versions, refs, numbers, commands', async () => {
    expect(spans('run ' + T + 'npm test' + T + ' then edit hooks/live.js:74 for v2.6.0 (#75), 1.12×')).toEqual([
      { text: 'run ', kind: 'plain' },
      { text: 'npm test', kind: 'cmd' },
      { text: ' then edit ', kind: 'plain' },
      { text: 'hooks/live.js:74', kind: 'path' },
      { text: ' for ', kind: 'plain' },
      { text: 'v2.6.0', kind: 'version' },
      { text: ' (', kind: 'plain' },
      { text: '#75', kind: 'ref' },
      { text: '), ', kind: 'plain' },
      { text: '1.12×', kind: 'number' },
    ])
    expect(spans('/agt-ledger')).toEqual([{ text: '/agt-ledger', kind: 'cmd' }])
    expect(spans('')).toEqual([])
  })

  test('texts rejoin to the line minus its backtick delimiters', async () => {
    const s = 'a ' + T + 'b c' + T + ' d/e.js, v1.2.3.'
    expect(spans(s).map((x) => x.text).join('')).toBe(s.replaceAll(T, ''))
  })
})

describe('highlight: deciding', () => {
  const words40 = Array.from({ length: CARD_MIN_WORDS }, (_, i) => 'w' + i).join(' ')

  test('word floor and the size cap', async () => {
    expect(highlight(words40.split(' ').slice(1).join(' '))).toBeNull()
    expect(highlight(words40)).toEqual({ card: [], body: words40 })
    const big = 'Next: go ' + 'x'.repeat(12_000)
    expect(highlight(big + ' ' + words40).body).toBeNull()
    expect(highlight(big + ' ' + words40).card.length).toBe(1)
    expect(highlight('y'.repeat(12_000) + ' ' + words40)).toBeNull()
  })

  test('litFor: the first decision sticks, off still records, oldest id evicted', async () => {
    expect(litFor(new Map(), '', { on: true, agtTurn: true })).toBe(true)
    expect(litFor(new Map(), undefined, { on: true, agtTurn: false })).toBe(false)
    const memo = new Map()
    expect(litFor(memo, 'a', { on: true, agtTurn: true })).toBe(true)
    expect(litFor(memo, 'a', { on: true, agtTurn: false })).toBe(true)
    expect(litFor(memo, 'b', { on: true, agtTurn: false })).toBe(false)
    expect(litFor(memo, 'b', { on: true, agtTurn: true })).toBe(false)
    expect(litFor(memo, 'c', { on: false, agtTurn: true })).toBe(false)
    expect(litFor(memo, 'c', { on: true, agtTurn: false })).toBe(true)
    const m2 = new Map()
    for (let i = 0; i <= LIT_MEMO_MAX; i++) litFor(m2, 'id' + i, { on: true, agtTurn: true })
    expect(m2.size).toBe(LIT_MEMO_MAX)
    expect(m2.has('id0')).toBe(false)
  })

  test('args and text', async () => {
    expect(parseHighlightArgs('  ')).toEqual({ show: true })
    expect(parseHighlightArgs('ON')).toEqual({ on: true })
    expect(parseHighlightArgs('off')).toEqual({ on: false })
    expect(parseHighlightArgs('maybe')).toEqual({ error: 'Usage: /agt-highlight [on|off]' })
    expect(highlightText(true)).toContain('Highlight: on')
    expect(highlightText(false)).toContain('/agt-highlight on')
  })
})
