// agentille display: the three display settings (deck, focus, highlight) read from profile.json or the mod
// store and written back, the agent flags above the prompt, and the memo of which message closed an answer.

import { S, Profile } from './state.js'
import { makeStore } from './store.js'
import { mergeFlags, paneFlags, parseFocusArgs, focusText } from './focus.js'
import { isAnswerBlock, panel, parseHighlightArgs, highlightText } from './highlight.js'
import { PROBE } from './panes.js'
import { cleanDisplay, storedDisplay, resolveDisplay, highlightFlags, withDisplay, profileJson } from './settings.js'
import { strandedNow } from './panerec.js'
import { HELLO_MS, BYE_MS } from './mascot.js'

// The display's store: the settings in effect and where each came from, the live switches they set, the agent flags
// above the prompt, the newest answer and the memo of which message closed one, and the worker band's mascot. Read
// through the Display view; written only by the transitions below.
const { s: my, view } = makeStore('display.js', {
  display: resolveDisplay({}, {}),  // the display settings in effect, and where each came from
  profileDisplay: {},  // the valid keys of ~/.agentille/profile.json → display
  storedRaw: {},  // the old $.store toggles, read once at session start (back-compat)
  deckAuto: false,  // display.deck = auto: the deck opens on every typed /agt
  focusOn: true,  // agent flags show above the prompt
  highlightOn: false,  // /agt replies get an essentials card and lit tokens (display.highlight: on | all)
  highlightAll: false,  // …and so does every other long reply (/agt-highlight all)
  flags: [],  // [{ text, key, at }] from agent results this run
  lastAnswer: null,  // { text, ms, id, shaped, raw } of the newest main-turn answer; its closing block draws as the panel
  panelMemo: new Map(),  // message id → { text, panel() result }: the blocks that closed a main turn's answer
  rawIds: new Set(),  // message ids that closed a raw answer: they draw as the engine does
  mascot: { greeted: false, hiUntil: 0, byeUntil: 0, working: false, start: 0, ms: null },  // worker band, in $.clock.now() ms
})
export const Display = view

// profile.json → display, as loadProfile read it.
export function setProfileDisplay(d) {
  my.profileDisplay = d
}

// The old $.store toggles, read once at session start.
export function setStoredRaw(raw) {
  my.storedRaw = raw
}

// The newest main-turn answer (null when a main turn starts).
export function setLastAnswer(a) {
  my.lastAnswer = a
}

// A run's flags come down: a new /agt run, or its ✓/✗ card.
export function clearFlags() {
  my.flags = []
}

// The worker band's mascot: hello on the first main turn (true only then), working while a turn runs, and a wave
// when it ends on an answer.
export function mascotHello(now) {
  if (my.mascot.greeted) return false
  my.mascot.greeted = true
  my.mascot.hiUntil = now + HELLO_MS
  return true
}
export function mascotWorking(now) {
  my.mascot.working = true
  my.mascot.start = now
}
export function mascotRest(now, waved) {
  my.mascot.working = false
  my.mascot.ms = now - my.mascot.start
  if (waved) my.mascot.byeUntil = now + BYE_MS
}

export const DECK = 'agt-deck'

export const FLAG_TTL_MS = 30 * 60_000

// profile.display → old store value → default, applied to the three live switches.
export function applyDisplay() {
  my.display = resolveDisplay(my.profileDisplay, storedDisplay(my.storedRaw))
  my.deckAuto = my.display.values.deck === 'auto'
  my.focusOn = my.display.values.focus
  const h = highlightFlags(my.display.values.highlight)
  my.highlightOn = h.on
  my.highlightAll = h.all
}

export const PROFILE_FILE = '/.agentille/profile.json'

// Read-merge-write one display key into ~/.agentille/profile.json: every other key stays, 2-space
// indent, trailing newline. The old file is copied to profile.json.bak first; a host without $.process
// still works once ~/.agentille exists.
// → null on success, else why not.
export async function saveDisplay($, key, value) {
  if (!Profile.home) return 'no home folder'
  const path = Profile.home + PROFILE_FILE
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
  try { made = (await $.process.run(['mkdir', '-p', Profile.home + '/.agentille'], PROBE)).exitCode } catch { /* no $.process on this host */ }
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
  my.profileDisplay = cleanDisplay(next.display)
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
  const profileWins = Object.hasOwn(my.profileDisplay, key) // a profile value comes back next session
  my.storedRaw = { ...my.storedRaw, ...sets }
  delete my.profileDisplay[key]
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
  my.flags = mergeFlags(my.flags, key, text, Date.now(), FLAG_TTL_MS)
  if (text) $.ui.toast('agt ⚑ ' + text)
}

export function focusLines(now) {
  if (!my.focusOn) return []
  const fresh = [...new Set(my.flags.filter((f) => now - f.at < FLAG_TTL_MS).map((f) => f.text))]
  return [...fresh, ...paneFlags(S.panes, strandedNow)].slice(0, 5)
}

// The panel for a message id, once it is known to close the newest answer; kept per id after that.
export function answerPanel(id, text) {
  if (!id || typeof text !== 'string') return null
  const hit = my.panelMemo.get(id)
  if (hit && hit.text === text) return hit.p
  if (!hit && !(my.lastAnswer && (my.lastAnswer.id === id || (!my.lastAnswer.id && isAnswerBlock(my.lastAnswer.text, text))))) return null
  if (my.lastAnswer && !my.lastAnswer.id && !hit) my.lastAnswer.id = id
  const own = my.lastAnswer?.id === id
  if (own && my.lastAnswer.raw) {
    my.rawIds.add(id)
    if (my.rawIds.size > 200) my.rawIds.delete(my.rawIds.values().next().value)
    return null
  }
  const p = panel(text, { ms: own ? my.lastAnswer.ms : undefined, shaped: own ? my.lastAnswer.shaped : false })
  my.panelMemo.delete(id)
  my.panelMemo.set(id, { text, p })
  if (my.panelMemo.size > 200) my.panelMemo.delete(my.panelMemo.keys().next().value)
  return p
}

export async function deckCommand($, e) {
  const a = String(e.args ?? '').trim().toLowerCase()
  if (a && a !== 'auto' && a !== 'off') return { text: 'Usage: /agt-deck [auto|off]' }
  let note = ''
  if (a) {
    note = await setDisplay($, 'deck', a)
    if (!my.deckAuto) return { text: 'deck: opens only when you type /agt-deck (display.deck: off)' + (note && '\n' + note) }
  }
  const o = await $.ui.open({ id: DECK, title: 'agentille' })
  const auto = my.deckAuto ? ' · opens on every /agt (/agt-deck off to stop)' : ''
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
  return { text: focusText(my.focusOn, focusLines(Date.now())) + (note && '\n' + note) + MOVED('focus') }
}

export async function highlightCommand($, e) {
  const a = parseHighlightArgs(e.args)
  if (a.error) return { text: a.error }
  let note = ''
  if (a.on !== undefined) {
    note = await setDisplay($, 'highlight', !a.on ? 'off' : a.all ? 'all' : 'on')
    $.ui.invalidate('ui.render')
  }
  return { text: highlightText(my.highlightOn, my.highlightAll) + (note && '\n' + note) + MOVED('highlight') }
}
