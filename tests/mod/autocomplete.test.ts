import { describe, expect, test } from 'claude-code/testing'
import { AGT_FLAGS, agtSuggestions, autocompleteHook, registerAutocomplete } from '../../hooks/autocomplete.js'

const ev = (text: string) => {
  const start = text.lastIndexOf(' ') + 1
  return { text, cursor: text.length, token: text.slice(start), start }
}

describe('autocomplete: agtSuggestions', () => {
  test('offers every flag for a bare dash after /agt', async () => {
    expect(agtSuggestions(ev('/agt -')).map((r) => r.text)).toEqual(AGT_FLAGS.map((f) => f.text))
  })

  test('narrows by prefix', async () => {
    expect(agtSuggestions(ev('/agt --mo')).map((r) => r.text)).toEqual(['--mode'])
    expect(agtSuggestions(ev('/agt "fix it" --f')).map((r) => r.text)).toEqual(['--fable', '--formation'])
    expect(agtSuggestions(ev('/agentille:agt --pl')).map((r) => r.text)).toEqual(['--plan'])
  })

  test('every row carries a description', async () => {
    for (const r of agtSuggestions(ev('/agt -'))) expect(r.description).toBeTruthy()
  })

  test('nothing for a finished flag, an unknown flag, plain words or other commands', async () => {
    expect(agtSuggestions(ev('/agt --mode'))).toEqual([])
    expect(agtSuggestions(ev('/agt --zzz'))).toEqual([])
    expect(agtSuggestions(ev('/agt fix'))).toEqual([])
    expect(agtSuggestions(ev('/agt-ledger --m'))).toEqual([])
    expect(agtSuggestions(ev('hello --mo'))).toEqual([])
    expect(agtSuggestions(ev('--mo'))).toEqual([])
  })
})

describe('autocomplete: autocompleteHook', () => {
  test('appends its rows after next', async () => {
    const own = { text: '--mine' }
    const next = async () => ({ suggestions: [own] })
    const r = await autocompleteHook({}, ev('/agt --mo'), next)
    expect(r.suggestions.map((s: { text: string }) => s.text)).toEqual(['--mine', '--mode'])
  })

  test('with no rows of its own, returns next at once', async () => {
    const out = { suggestions: [{ text: 'x' }] }
    let calls = 0
    const next = async () => (calls++, out)
    expect(await autocompleteHook({}, ev('/agt fix'), next)).toBe(out)
    expect(calls).toBe(1)
  })

  test('registers on prompt.autocomplete with a matcher', async () => {
    const calls: any[][] = []
    registerAutocomplete((...a: any[]) => calls.push(a), {})
    expect(calls).toHaveLength(1)
    const [event, matcher, hook] = calls[0]
    expect(event).toBe('prompt.autocomplete')
    expect(matcher.token.test('--mo')).toBe(true)
    expect(matcher.token.test('fix')).toBe(false)
    expect(hook).toBe(autocompleteHook)
  })
})
