import { describe, expect, test } from 'claude-code/testing'
import { AGT_FLAGS, AGT_LEVELS, agtSuggestions, autocompleteHook, registerAutocomplete } from '../../hooks/autocomplete.js'

// The event for a draft with the caret at its end: the token is the last run of non-whitespace.
const ev = (text: string) => {
  const start = text.search(/\S*$/)
  return { text, cursor: text.length, token: text.slice(start), start }
}
const texts = (rows: { text: string }[]) => rows.map((r) => r.text)

describe('autocomplete: levels', () => {
  test('the first word after /agt offers every level', () => {
    expect(texts(agtSuggestions(ev('/agt ')))).toEqual(['low', 'medium', 'heavy', 'next'])
    expect(texts(agtSuggestions(ev('/agt ')))).toEqual(texts(AGT_LEVELS))
  })

  test('narrows by prefix, also for /agentille:agt and leading space', () => {
    expect(texts(agtSuggestions(ev('/agt he')))).toEqual(['heavy'])
    expect(texts(agtSuggestions(ev('/agt m')))).toEqual(['medium'])
    expect(texts(agtSuggestions(ev('/agentille:agt n')))).toEqual(['next'])
    expect(texts(agtSuggestions(ev('  /agt l')))).toEqual(['low'])
  })

  test('every row carries a description', () => {
    for (const r of [...AGT_LEVELS, ...AGT_FLAGS]) expect(r.description).toBeTruthy()
  })

  test('nothing for a finished level, later words, the command itself or old flags', () => {
    expect(agtSuggestions(ev('/agt heavy'))).toEqual([])
    expect(agtSuggestions(ev('/agt heavy h'))).toEqual([])
    expect(agtSuggestions(ev('/agt fix it l'))).toEqual([])
    expect(agtSuggestions(ev('/agt zzz'))).toEqual([])
    expect(agtSuggestions(ev('/agt'))).toEqual([])
    expect(agtSuggestions(ev('low'))).toEqual([])
    expect(agtSuggestions(ev('/agt --mode'))).toEqual([])
    expect(agtSuggestions(ev('/agt --plan'))).toEqual([])
  })
})

describe('autocomplete: --fable', () => {
  test('is the only flag', () => {
    expect(texts(agtSuggestions(ev('/agt -')))).toEqual(['--fable'])
    expect(texts(agtSuggestions(ev('/agt heavy --f')))).toEqual(['--fable'])
    expect(agtSuggestions(ev('/agt --fable'))).toEqual([])
    expect(agtSuggestions(ev('/agt --mo'))).toEqual([])
  })
})

describe('autocomplete: autocompleteHook', () => {
  test('appends its rows after next', async () => {
    const own = { text: '--mine' }
    const r = await autocompleteHook({}, ev('/agt --f'), async () => ({ suggestions: [own] }))
    expect(texts(r.suggestions)).toEqual(['--mine', '--fable'])
  })

  test('with no rows of its own, returns next at once', async () => {
    const out = { suggestions: [{ text: 'x' }] }
    let calls = 0
    const next = async () => (calls++, out)
    expect(await autocompleteHook({}, ev('/agt fix it'), next)).toBe(out)
    expect(calls).toBe(1)
  })

  test('registers on prompt.autocomplete with a matcher', async () => {
    const calls: any[][] = []
    registerAutocomplete((...a: any[]) => calls.push(a), {})
    expect(calls).toHaveLength(1)
    const [event, matcher, hook] = calls[0]
    expect(event).toBe('prompt.autocomplete')
    expect(matcher.token).toBeUndefined()
    expect(matcher.text.test('/agt he')).toBe(true)
    expect(matcher.text.test('/agentille:agt n')).toBe(true)
    expect(matcher.text.test('/agt-info he')).toBe(false)
    expect(matcher.text.test('hello he')).toBe(false)
    expect(hook).toBe(autocompleteHook)
  })
})

// The matcher is what keeps other drafts away from the hook, so the runtime has the last word.
describe('autocomplete: through the runtime', () => {
  const boot = async ($: any, on: any) => {
    on('env.get', async () => ({ value: undefined }))
    on('session.start', async ($: any, e: any) => ({ cwd: e.cwd }))
    on('command.register', async () => ({ value: undefined }))
    on('fs.read', async () => ({ deny: 'no profile' }))
    on('store.get', async () => ({ value: undefined }))
    on('prompt.autocomplete', async () => ({ suggestions: [] }))
    await $.session.start({ cwd: '/w', surface: null, isInteractive: false })
  }
  const ask = async ($: any, text: string) => texts(((await $.prompt.autocomplete(ev(text))) as { suggestions: { text: string }[] }).suggestions)

  test('a typed /agt draft gets level rows and the flag row', async ($, on) => {
    await boot($, on)
    expect(await ask($, '/agt he')).toEqual(['heavy'])
    expect(await ask($, '/agt --f')).toEqual(['--fable'])
    expect(await ask($, '  /agentille:agt n')).toEqual(['next'])
  })

  test('another command or plain text gets nothing', async ($, on) => {
    await boot($, on)
    expect(await ask($, '/agt-info he')).toEqual([])
    expect(await ask($, 'hello he')).toEqual([])
    expect(await ask($, 'hello --f')).toEqual([])
  })
})
