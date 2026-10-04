import { describe, expect, mock, test } from 'claude-code/testing'
import { words } from '../../hooks/focus.js'
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

describe('highlight: review fixes', () => {
  test('a fence inside a blockquote stays verbatim', async () => {
    const q = '> ```\n> v1.2.3\n> ```'
    expect(lightTokens(q)).toBe(q)
  })

  test('a line opening with ```inline``` is inline code, not an unclosed fence', async () => {
    const t = '```npm test``` is the command\nNext: tag v2.6.0 after hooks/live.js'
    expect(lightTokens(t)).toBe('```npm test``` is the command\nNext: tag `v2.6.0` after `hooks/live.js`')
    expect(essentials(t)).toEqual([{ kind: 'next', text: 'tag v2.6.0 after hooks/live.js' }])
  })

  test('a second flag line never becomes the done line', async () => {
    expect(essentials('2 failed in api.test.js\n3 failed, 10 passed')).toEqual([{ kind: 'flag', text: '2 failed in api.test.js' }])
  })
})

describe('highlight: the final card', () => {
  const DONE = [
    '✓ added a search filter  ·  3 files  ·  PR #12  ·  4m',
    'verify: npm test → 31 passed, 0 failed',
    'review: PASS — code-reviewer',
    '⚑ migration needs a backup first',
    'Open: ~/.agentille/state/run-ab12cd/report.md',
    'Next: merge PR #12',
  ].join('\n')
  const FAILED = [
    '✗ npm test fails in src/search.ts:42',
    'verify: npm test → 2 failed',
    'review: CONCERNS: 1 P1 — code-reviewer',
    'Open: ~/.agentille/state/run-ab12cd/report.md',
    'Next: fix src/search.ts:42, then re-run npm test',
  ].join('\n')

  test('both forms are under the word floor and still qualify, with no essentials card', async () => {
    for (const card of [DONE, FAILED]) {
      expect(words(card)).toBeLessThan(CARD_MIN_WORDS)
      const h = highlight(card)!
      expect(h.card).toEqual([])
      expect(h.body).not.toBeNull()
    }
  })

  test('the tokens are lit: the report path, the PR ref, the file:line', async () => {
    expect(highlight(DONE)!.body).toContain('`~/.agentille/state/run-ab12cd/report.md`')
    expect(highlight(DONE)!.body).toContain('PR `#12`')
    expect(highlight(FAILED)!.body).toContain('`src/search.ts:42`')
  })

  test('a leading blank line does not hide it; text that only mentions ✓ is not a card', async () => {
    expect(highlight('\n  ' + DONE)!.card).toEqual([])
    expect(highlight('All good ✓ and merged')).toBeNull()
    expect(highlight('✓')).toEqual({ card: [], body: '✓' })
  })

  test('a long answer that starts with ✓ gets no card either', async () => {
    const long = '✓ shipped\nNext: tag v1.2.3\n' + Array.from({ length: 60 }, (_, i) => 'w' + i).join(' ')
    expect(highlight(long)!.card).toEqual([])
  })

  test('✗ is a flag; 0 failed and 0 fail(s) are not', async () => {
    expect(essentials('✗ build broke').map((i) => i.kind)).toEqual(['flag'])
    for (const s of ['0 failed', '0 fail(s)', 'validate: 0 fail(s)', 'no failures']) expect(essentials(s).filter((i) => i.kind === 'flag')).toEqual([])
    expect(essentials('2 fail(s)').map((i) => i.kind)).not.toContain('done')
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
    expect(parseHighlightArgs('ON')).toEqual({ on: true, all: false })
    expect(parseHighlightArgs('all')).toEqual({ on: true, all: true })
    expect(parseHighlightArgs('off')).toEqual({ on: false, all: false })
    expect(parseHighlightArgs('maybe')).toEqual({ error: 'Usage: /agt-highlight [on|all|off]' })
    expect(highlightText(true)).toContain('Highlight: on')
    expect(highlightText(true)).toContain('/agt-highlight all')
    expect(highlightText(true, true)).toContain('Highlight: all — every long reply')
    expect(highlightText(false)).toContain('/agt-highlight on')
  })
})

describe('highlight: in the mod', () => {
  const REPLY = 'Next: tag v2.6.0. The change is in hooks/live.js and it is green. ' + Array.from({ length: 40 }, (_, i) => 'w' + i).join(' ')
  const SHORT = Array.from({ length: 30 }, (_, i) => 'w' + i).join(' ')

  const setup = (on: any, stored: any[] = []) => {
    on('store.get', async () => ({ value: undefined }))
    on('store.set', async ($: any, e: any) => { stored.push(e); return { value: undefined } })
    on('ui.panes', async () => ({ value: [] }))
    on('ui.open', async () => ({ value: { isPlaced: true } }))
    on('ui.close', async () => ({ value: undefined }))
    on('prompt.submit', async ($: any, e: any) => ({ text: e.text }))
    on('ui.render', async () => ({ type: 'engine', ref: 0 }) as never)
    mock.clock(on, { now: 1_000_000 })
  }
  const say = ($: any, text: string, origin?: any) => $.prompt.submit({ text, wait: false, ...(origin ? { origin } : {}) })
  const mount = ($: any, requestId: string, text = REPLY) =>
    $.ui.mount({ plugin: 'agentille', surface: 'terminal', component: 'AssistantMessage', requestId, props: { text } as never })

  test('a typed /agt reply gets the card and a dim body with its tokens lit', async ($, on) => {
    setup(on)
    await say($, '/agt tag the release')
    const ui = await mount($, 'm1')
    expect(await ui.find({ type: 'Text', text: /→ / })).toBeDefined()
    const md: any = await ui.find({ type: 'Markdown' })
    expect(md.props.text).toContain('`hooks/live.js`')
    expect(md.props.dimColor).toBe(true)
    await ui.unmount()
  })

  test('a final card in a typed /agt reply is lit but gets no essentials card', async ($, on) => {
    setup(on)
    await say($, '/agt tag the release')
    const ui = await mount($, 'f1', '✓ tagged v2.6.0  ·  2 files  ·  PR #75  ·  3m\nOpen: ~/.agentille/state/run-ab12cd/report.md\nNext: restart Claude')
    expect(await ui.find({ type: 'Text', text: /→ / })).toBeUndefined()
    const md: any = await ui.find({ type: 'Markdown' })
    expect(md.props.text).toContain('`v2.6.0`')
    expect(md.props.dimColor).toBe(true)
    await ui.unmount()
  })

  test('a plain prompt, /agt-highlight off and a 30-word reply all draw as the engine does', async ($, on) => {
    const stored: any[] = []
    setup(on, stored)
    await say($, 'explain the diff')
    let ui = await mount($, 'p1')
    expect(await ui.find({ type: 'Text', text: /→ / })).toBeUndefined()
    expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
    await ui.unmount()

    await say($, '/agt tag the release')
    ui = await mount($, 'p2', SHORT)
    expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
    await ui.unmount()

    expect((await $.command.run({ command: 'agt-highlight', args: 'off' })).text).toContain('Highlight: off')
    expect(stored).toContainEqual(expect.objectContaining({ key: 'highlight:on', value: false }))
    await say($, '/agt tag the release')
    ui = await mount($, 'p3')
    expect(await ui.find({ type: 'Text', text: /→ / })).toBeUndefined()
    expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
    await ui.unmount()
  })

  test('/agt-highlight all covers a plain prompt, and on goes back to /agt only', async ($, on) => {
    const stored: any[] = []
    setup(on, stored)
    expect((await $.command.run({ command: 'agt-highlight', args: 'all' })).text).toContain('Highlight: all')
    expect(stored).toContainEqual(expect.objectContaining({ key: 'highlight:all', value: true }))
    await say($, 'explain the diff')
    let ui = await mount($, 'a1')
    expect(await ui.find({ type: 'Text', text: /→ / })).toBeDefined()
    const md: any = await ui.find({ type: 'Markdown' })
    expect(md.props.dimColor).toBe(true)
    await ui.unmount()

    ui = await mount($, 'a2', SHORT)
    expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
    await ui.unmount()

    expect((await $.command.run({ command: 'agt-highlight', args: 'on' })).text).toContain('Highlight: on')
    expect(stored).toContainEqual(expect.objectContaining({ key: 'highlight:all', value: false }))
    await say($, 'explain the diff again')
    ui = await mount($, 'a3')
    expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
    await ui.unmount()
  })

  test('a bad argument shows the usage and changes nothing', async ($, on) => {
    const stored: any[] = []
    setup(on, stored)
    expect((await $.command.run({ command: 'agt-highlight', args: 'maybe' })).text).toBe('Usage: /agt-highlight [on|all|off]')
    expect(stored.length).toBe(0)
  })

  test('a message first drawn in a plain turn stays plain when /agt starts', async ($, on) => {
    setup(on)
    await say($, 'explain the diff')
    let ui = await mount($, 'm2')
    await ui.unmount()
    await say($, '/agt tag the release')
    ui = await mount($, 'm2')
    expect(await ui.find({ type: 'Text', text: /→ / })).toBeUndefined()
    expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
    await ui.unmount()
  })

  test('a task notification does not end the /agt turn', async ($, on) => {
    setup(on)
    await say($, '/agt build it')
    await say($, 'task finished', { kind: 'task-notification' })
    const ui = await mount($, 'm9')
    expect(await ui.find({ type: 'Text', text: /→ / })).toBeDefined()
    await ui.unmount()
  })

  test('a typed prompt after /agt does', async ($, on) => {
    setup(on)
    await say($, '/agt build it')
    await say($, 'thanks', { kind: 'composer' })
    const ui = await mount($, 'm10')
    expect(await ui.find({ type: 'Text', text: /→ / })).toBeUndefined()
    expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
    await ui.unmount()
  })
})
