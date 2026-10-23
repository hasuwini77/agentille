// agentille display: the three display settings (deck, focus, highlight) read from profile.json or the mod
// store and written back, the agent flags above the prompt, and the memo of which message closed an answer.

import { S } from './state.js'
import { mergeFlags, paneFlags, parseFocusArgs, focusText } from './focus.js'
import { isAnswerBlock, panel, parseHighlightArgs, highlightText } from './highlight.js'
import { PROBE } from './panes.js'
import { cleanDisplay, storedDisplay, resolveDisplay, highlightFlags, withDisplay, profileJson } from './settings.js'
const { strandedNow, panelMemo, rawIds } = S

export const DECK = 'agt-deck'

export const FLAG_TTL_MS = 30 * 60_000

// profile.display → old store value → default, applied to the three live switches.
export function applyDisplay() {
  S.display = resolveDisplay(S.profileDisplay, storedDisplay(S.storedRaw))
  S.deckAuto = S.display.values.deck === 'auto'
  S.focusOn = S.display.values.focus
  const h = highlightFlags(S.display.values.highlight)
  S.highlightOn = h.on
  S.highlightAll = h.all
}

export const PROFILE_FILE = '/.agentille/profile.json'

// Read-merge-write one display key into ~/.agentille/profile.json: every other key stays, 2-space
// indent, trailing newline. The old file is copied to profile.json.bak first; a host without $.process
// still works once ~/.agentille exists.
// → null on success, else why not.
export async function saveDisplay($, key, value) {
  if (!S.home) return 'no home folder'
  const path = S.home + PROFILE_FILE
  const shown = '~' + PROFILE_FILE
  let profile = null
  let text = null
  try {
    text = await $.fs.read(path)
  } catch {
    // unreadable is not missing: a file we cannot read is the person's, and a write would replace it
    if (await $.fs.exists(path).catch(() => true)) return shown + ' is unreadable'
  }
  if (text !== null) {
    try { profile = JSON.parse(text) } catch { return shown + ' is not valid JSON' }
    if (profile === null || typeof profile !== 'object' || Array.isArray(profile)) return shown + ' is not a JSON object'
    try { await $.fs.write(path + '.bak', text) } catch { return 'could not back up ' + shown }
  }
  const next = withDisplay(profile, key, value)
  const body = profileJson(next)
  // With $.process: make the folder, write a .tmp beside the file and mv it over (no torn write).
  // Without it, or when mv fails: write the file directly; the .bak above is the way back.
  let made = null
  try { made = (await $.process.run(['mkdir', '-p', S.home + '/.agentille'], PROBE)).exitCode } catch { /* no $.process on this host */ }
  if (made === 0) {
    try {
      await $.fs.write(path + '.tmp', body)
      if ((await $.process.run(['mv', '-f', path + '.tmp', path], PROBE)).exitCode === 0) made = 'moved'
    } catch { /* the direct write below */ }
  }
  if (made !== 'moved') {
    try {
      await $.fs.write(path, body)
    } catch {
      return made !== null && made !== 0 ? 'could not create ~/.agentille' : 'could not write ' + shown
    }
  }
  S.profileDisplay = cleanDisplay(next.display)
  applyDisplay()
  return null
}

// A toggle: profile.json when it can be written, else the mod store as before. Always applied now.
// → '' when saved in profile.json, else the one line saying where it went.
export async function setDisplay($, key, value) {
  const why = await saveDisplay($, key, value)
  if (!why) return ''
  const sets =
    key === 'deck' ? { deckAuto: value === 'auto' } :
    key === 'focus' ? { focusMode: value ? 'on' : 'off' } :
    { highlightOn: value !== 'off', highlightAll: value === 'all' }
  const names = { deckAuto: 'deck:auto', focusMode: 'focus:mode', highlightOn: 'highlight:on', highlightAll: 'highlight:all' }
  const profileWins = Object.hasOwn(S.profileDisplay, key) // a profile value comes back next session
  S.storedRaw = { ...S.storedRaw, ...sets }
  delete S.profileDisplay[key]
  applyDisplay()
  try {
    for (const [k, v] of Object.entries(sets)) await $.store.set(names[k], v)
  } catch {
    return 'applied for this session only: ' + why + ' and the mod store refused it'
  }
  if (profileWins) return 'applied for this session only: ' + why + ', and display.' + key + ' in profile.json wins next session'
  return "saved in this machine's mod store, not in profile.json: " + why
}

export const MOVED = (key) => '\nmoved: display.' + key + ' in ~/.agentille/profile.json — this command goes away in v4'

export function addFlag($, key, text) {
  S.flags = mergeFlags(S.flags, key, text, Date.now(), FLAG_TTL_MS)
  if (text) $.ui.toast('agt ⚑ ' + text)
}

export function focusLines(now) {
  if (!S.focusOn) return []
  const fresh = [...new Set(S.flags.filter((f) => now - f.at < FLAG_TTL_MS).map((f) => f.text))]
  return [...fresh, ...paneFlags(S.panes, strandedNow)].slice(0, 5)
}

// The panel for a message id, once it is known to close the newest answer; kept per id after that.
export function answerPanel(id, text) {
  if (!id || typeof text !== 'string') return null
  const hit = panelMemo.get(id)
  if (hit && hit.text === text) return hit.p
  if (!hit && !(S.lastAnswer && (S.lastAnswer.id === id || (!S.lastAnswer.id && isAnswerBlock(S.lastAnswer.text, text))))) return null
  if (S.lastAnswer && !S.lastAnswer.id && !hit) S.lastAnswer.id = id
  const own = S.lastAnswer?.id === id
  if (own && S.lastAnswer.raw) {
    rawIds.add(id)
    if (rawIds.size > 200) rawIds.delete(rawIds.values().next().value)
    return null
  }
  const p = panel(text, { ms: own ? S.lastAnswer.ms : undefined, shaped: own ? S.lastAnswer.shaped : false })
  panelMemo.delete(id)
  panelMemo.set(id, { text, p })
  if (panelMemo.size > 200) panelMemo.delete(panelMemo.keys().next().value)
  return p
}

export async function deckCommand($, e) {
  const a = String(e.args ?? '').trim().toLowerCase()
  if (a && a !== 'auto' && a !== 'off') return { text: 'Usage: /agt-deck [auto|off]' }
  let note = ''
  if (a) {
    note = await setDisplay($, 'deck', a)
    if (!S.deckAuto) return { text: 'deck: opens only when you type /agt-deck (display.deck: off)' + (note && '\n' + note) }
  }
  const o = await $.ui.open({ id: DECK, title: 'agentille' })
  const auto = S.deckAuto ? ' · opens on every /agt (/agt-deck off to stop)' : ''
  const tail = note && '\n' + note
  if (o?.isPlaced === false) return { text: 'deck waits: ' + (o.reason ?? 'no surface here places panes') + auto + tail }
  return { text: 'deck open' + auto + tail }
}

export async function focusCommand($, e) {
  const a = parseFocusArgs(e.args)
  if (a.error) return { text: a.error }
  let note = ''
  if (a.on !== undefined) {
    note = await setDisplay($, 'focus', a.on)
    $.ui.invalidate('ui.render')
  }
  return { text: focusText(S.focusOn, focusLines(Date.now())) + (note && '\n' + note) + MOVED('focus') }
}

export async function highlightCommand($, e) {
  const a = parseHighlightArgs(e.args)
  if (a.error) return { text: a.error }
  let note = ''
  if (a.on !== undefined) {
    note = await setDisplay($, 'highlight', !a.on ? 'off' : a.all ? 'all' : 'on')
    $.ui.invalidate('ui.render')
  }
  return { text: highlightText(S.highlightOn, S.highlightAll) + (note && '\n' + note) + MOVED('highlight') }
}
