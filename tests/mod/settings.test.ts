import { describe, expect, test } from 'claude-code/testing'
import { DISPLAY_DEFAULTS, cleanDisplay, displayText, hasVoice, highlightFlags, profileJson, resolveDisplay, storedDisplay, withDisplay } from '../../hooks/settings.js'

describe('settings: display parsing', () => {
  test('nothing set: every key is its default', () => {
    const r = resolveDisplay(undefined, {})
    expect(r.values).toEqual(DISPLAY_DEFAULTS)
    expect(r.from).toEqual({ deck: 'default', focus: 'default', highlight: 'default', band: 'default', statusLine: 'default', mascot: 'default' })
    expect(DISPLAY_DEFAULTS).toEqual({ deck: 'off', focus: true, highlight: 'off', band: 'on', statusLine: 'on', mascot: 'on' })
  })

  test('profile beats store, store beats default, per key', () => {
    const r = resolveDisplay({ deck: 'auto' }, { deck: 'off', focus: false })
    expect(r.values).toEqual({ ...DISPLAY_DEFAULTS, deck: 'auto', focus: false, highlight: 'off' })
    expect(r.from).toMatchObject({ deck: 'profile', focus: 'store', highlight: 'default' })
  })

  test('junk values and junk shapes read as not set', () => {
    expect(cleanDisplay({ deck: 'sometimes', focus: 'yes', highlight: 3 })).toEqual({})
    for (const junk of [null, undefined, 'auto', 7, ['auto'], true]) expect(cleanDisplay(junk)).toEqual({})
    const r = resolveDisplay({ deck: 'nope', focus: false, highlight: ['all'] }, { highlight: 'all' })
    expect(r.values).toEqual({ ...DISPLAY_DEFAULTS, deck: 'off', focus: false, highlight: 'all' })
    expect(r.from).toMatchObject({ deck: 'default', focus: 'profile', highlight: 'store' })
  })

  test('band, statusLine and mascot take on or off and nothing else', () => {
    for (const k of ['band', 'statusLine', 'mascot']) {
      expect(cleanDisplay({ [k]: 'off' })).toEqual({ [k]: 'off' })
      expect(cleanDisplay({ [k]: 'on' })).toEqual({ [k]: 'on' })
      for (const junk of [false, true, 'OFF', 'auto', 0, null, ['off']]) expect(cleanDisplay({ [k]: junk })).toEqual({})
      expect(resolveDisplay({ [k]: 'off' }, {}).values[k]).toBe('off')
      expect(resolveDisplay({ [k]: 'off' }, {}).from[k]).toBe('profile')
      expect(resolveDisplay({ [k]: 'hidden' }, {}).values[k]).toBe('on')
    }
  })

  test('the old store toggles never set the three newer keys', () => {
    const r = resolveDisplay({}, storedDisplay({ deckAuto: true, focusMode: 'off', highlightOn: false }))
    expect(r.from).toMatchObject({ band: 'default', statusLine: 'default', mascot: 'default' })
  })

  test('unknown keys are dropped, valid siblings survive', () => {
    expect(cleanDisplay({ deck: 'auto', theme: 'dark' })).toEqual({ deck: 'auto' })
  })
})

describe('settings: old store values', () => {
  test('a never-set store reads as nothing', () => {
    expect(storedDisplay({})).toEqual({})
    expect(storedDisplay(undefined)).toEqual({})
    expect(storedDisplay({ deckAuto: null, focusMode: 'maybe', highlightOn: 'x' })).toEqual({})
  })

  test('each old toggle maps to its display key', () => {
    expect(storedDisplay({ deckAuto: true })).toEqual({ deck: 'auto' })
    expect(storedDisplay({ deckAuto: false })).toEqual({ deck: 'off' })
    expect(storedDisplay({ focusMode: 'off' })).toEqual({ focus: false })
    expect(storedDisplay({ focusMode: 'on' })).toEqual({ focus: true })
    expect(storedDisplay({ highlightOn: false, highlightAll: false })).toEqual({ highlight: 'off' })
    expect(storedDisplay({ highlightOn: true, highlightAll: true })).toEqual({ highlight: 'all' })
    expect(storedDisplay({ highlightOn: true, highlightAll: false })).toEqual({ highlight: 'on' })
    expect(storedDisplay({ highlightAll: true })).toEqual({ highlight: 'all' })
  })

  test('highlight modes map to the two flags the highlighter takes', () => {
    expect(highlightFlags('on')).toEqual({ on: true, all: false })
    expect(highlightFlags('all')).toEqual({ on: true, all: true })
    expect(highlightFlags('off')).toEqual({ on: false, all: false })
  })
})

describe('settings: writing the profile', () => {
  test('merging keeps every other key and only touches the one display key', () => {
    const profile = { name: 'x', projects: [{ a: 1 }], routing: { autoFable: false }, display: { deck: 'auto', focus: false } }
    expect(withDisplay(profile, 'highlight', 'all')).toEqual({ ...profile, display: { deck: 'auto', focus: false, highlight: 'all' } })
    expect(profile.display).toEqual({ deck: 'auto', focus: false }) // the input is not mutated
  })

  test('no profile, or a display that is not an object, starts a fresh block', () => {
    expect(withDisplay(null, 'focus', false)).toEqual({ display: { focus: false } })
    expect(withDisplay({ a: 1, display: 'loud' }, 'deck', 'auto')).toEqual({ a: 1, display: { deck: 'auto' } })
  })

  test('the file is 2-space JSON with a trailing newline', () => {
    expect(profileJson({ a: { b: 1 } })).toBe('{\n  "a": {\n    "b": 1\n  }\n}\n')
  })

  test('displayText names each key, its value and where it came from', () => {
    const t = displayText(resolveDisplay({ deck: 'auto' }, { focus: false }))
    expect(t).toMatch(/deck\s+auto\s+profile/)
    expect(t).toMatch(/focus\s+false\s+store/)
    expect(t).toMatch(/highlight\s+off\s+default/)
    expect(displayText(resolveDisplay({ statusLine: 'off' }, {}))).toMatch(/statusLine\s+off\s+profile/)
    expect(t).toMatch(/band\s+on\s+default/)
    expect(t).toMatch(/mascot\s+on\s+default/)
  })
})

describe('settings: voice keys', () => {
  test('a profile counts as one only with a voice key; display and routing alone do not', () => {
    expect(hasVoice({ tone: 'blunt' })).toBe(true)
    expect(hasVoice({ neverDo: [] })).toBe(true)
    expect(hasVoice({ display: { focus: false }, routing: {}, thinkingDepth: 'quick', projects: [] })).toBe(false)
    for (const junk of [null, undefined, [], 'x', 3]) expect(hasVoice(junk)).toBe(false)
  })
})

describe('settings: in the mod', () => {
  const boot = async ($: any, on: any, profile: string | null, store: Record<string, unknown> = {}) => {
    on('env.get', async ($: any, e: any) => ({ value: e.name === 'HOME' ? '/u' : undefined }))
    on('session.start', async ($: any, e: any) => ({ cwd: e.cwd }))
    on('command.register', async () => ({ value: undefined }))
    on('fs.read', async ($: any, e: any) => (profile !== null && e.path === '/u/.agentille/profile.json' ? { value: profile } : { deny: 'ENOENT' }))
    on('store.get', async ($: any, e: any) => ({ value: store[e.key] }))
    on('store.set', async () => ({ value: undefined }))
    on('ui.render', async () => ({ type: 'engine', ref: 0 }) as never)
    await $.session.start({ cwd: '/w', surface: null, isInteractive: false })
  }
  const focus = async ($: any) => (await $.command.run({ command: 'agt-focus' })).text.split('\n')[0]
  const highlight = async ($: any) => (await $.command.run({ command: 'agt-highlight' })).text.split(' ')[1]

  test('no profile and an empty store: the defaults, highlight off', { timeoutMs: 20_000 }, async ($, on) => {
    await boot($, on, null)
    expect(await focus($)).toContain('focus: on')
    expect(await highlight($)).toBe('off')
  })

  test('the old store values still apply when the profile has no display block', { timeoutMs: 20_000 }, async ($, on) => {
    await boot($, on, '{"name":"x"}', { 'focus:mode': 'off', 'highlight:on': true, 'highlight:all': true })
    expect(await focus($)).toContain('focus: off')
    expect(await highlight($)).toBe('all')
  })

  test('profile.display beats the store, key by key', { timeoutMs: 20_000 }, async ($, on) => {
    await boot($, on, '{"display":{"focus":true,"highlight":"off"}}', { 'focus:mode': 'off', 'highlight:on': true, 'highlight:all': true })
    expect(await focus($)).toContain('focus: on')
    expect(await highlight($)).toBe('off')
  })

  test('junk in the profile falls through to the store and the defaults', { timeoutMs: 20_000 }, async ($, on) => {
    await boot($, on, '{"display":{"focus":"never","highlight":9}}', { 'focus:mode': 'off' })
    expect(await focus($)).toContain('focus: off')
    expect(await highlight($)).toBe('off')
  })

  test('a profile that is not JSON, or has display as a string, changes nothing', { timeoutMs: 20_000 }, async ($, on) => {
    await boot($, on, '{"display":"loud"}')
    expect(await focus($)).toContain('focus: on')
  })
})
