// agentille display settings — pure helpers, no mods API. register.js reads the `display` block of
// ~/.agentille/profile.json and the older per-key store values, and writes the block back.
//
// Precedence per key: profile.display → the $.store value an old /agt-focus, /agt-highlight or
// /agt-deck left behind → the default. Junk in any of them reads as "not set". band, statusLine and
// mascot never had a command, so only the profile sets them.

export const DISPLAY_DEFAULTS = { deck: 'off', focus: true, highlight: 'off', band: 'on', statusLine: 'on', mascot: 'on' }
export const DISPLAY_KEYS = Object.keys(DISPLAY_DEFAULTS)

const VALID = {
  deck: (v) => v === 'auto' || v === 'off',
  focus: (v) => typeof v === 'boolean',
  highlight: (v) => v === 'on' || v === 'all' || v === 'off',
  band: (v) => v === 'on' || v === 'off',
  statusLine: (v) => v === 'on' || v === 'off',
  mascot: (v) => v === 'on' || v === 'off',
}

// profile.display with every invalid key dropped; anything but an object reads as empty.
export function cleanDisplay(raw) {
  const out = {}
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const k of DISPLAY_KEYS) if (VALID[k](raw[k])) out[k] = raw[k]
  return out
}

// The raw $.store values of the three old toggles → the keys that were really set (undefined = never set).
export function storedDisplay({ deckAuto, focusMode, highlightOn, highlightAll } = {}) {
  const out = {}
  if (typeof deckAuto === 'boolean') out.deck = deckAuto ? 'auto' : 'off'
  if (focusMode === 'on' || focusMode === 'off') out.focus = focusMode === 'on'
  if (highlightOn === false) out.highlight = 'off'
  else if (highlightOn === true || highlightAll === true) out.highlight = highlightAll === true ? 'all' : 'on'
  return out
}

// → { values: { deck, focus, …, mascot }, from: { deck, focus, …, mascot } } where from is 'profile' | 'store' | 'default'
export function resolveDisplay(profileDisplay, stored = {}) {
  const p = cleanDisplay(profileDisplay)
  const s = cleanDisplay(stored)
  const values = {}
  const from = {}
  for (const k of DISPLAY_KEYS) {
    if (k in p) { values[k] = p[k]; from[k] = 'profile' }
    else if (k in s) { values[k] = s[k]; from[k] = 'store' }
    else { values[k] = DISPLAY_DEFAULTS[k]; from[k] = 'default' }
  }
  return { values, from }
}

// highlight mode → the two flags the highlighter takes
export function highlightFlags(mode) {
  return { on: mode !== 'off', all: mode === 'all' }
}

// Read-merge-write: the parsed profile (or null) plus one display key → the object to write back.
// Every other key survives; a `display` that is not an object is replaced.
export function withDisplay(profile, key, value) {
  const base = profile !== null && typeof profile === 'object' && !Array.isArray(profile) ? profile : {}
  const display = base.display !== null && typeof base.display === 'object' && !Array.isArray(base.display) ? base.display : {}
  return { ...base, display: { ...display, [key]: value } }
}

export function profileJson(profile) {
  return JSON.stringify(profile, null, 2) + '\n'
}

export function displayText({ values, from }) {
  const word = (k) => from[k] === 'default' ? 'default' : from[k]
  return DISPLAY_KEYS.map((k) => '  ' + k.padEnd(12) + String(values[k]).padEnd(6) + word(k)).join('\n')
}

// Keys that make a profile a voice (what /agentille-init writes). A file holding only `display` or
// `routing` has none, so the init tip still shows.
export const VOICE_KEYS = ['name', 'role', 'deliveryStyle', 'tone', 'preTaskQuestioning', 'neverDo']

export function hasVoice(profile) {
  return profile !== null && typeof profile === 'object' && !Array.isArray(profile) && VOICE_KEYS.some((k) => k in profile)
}
