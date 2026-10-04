// The worker pane's mascot: three rows of block glyphs and a caption, pure strings.
// register.js owns the clock and the drawing; this file only says what to show.

export const MASCOT_COLOR = 0xd97757
export const HELLO_MS = 2400
export const BYE_MS = 2400

export const MODEL_COLOR = {
  haiku: 0x9aa0a6,
  sonnet: 0x4f8ef7,
  opus: 0xf2a33a,
  fable: 0xa77bff,
  other: 0xc8c8c8,
}

export function modelKey(model) {
  const m = String(model ?? '').toLowerCase()
  for (const k of ['fable', 'opus', 'sonnet', 'haiku']) if (m.includes(k)) return k
  return 'other'
}

const HEAD = '  ▐▛███▜▌'
const BODY = ' ▝▜█████▛▘'
const LEGS = ['   ▘▘ ▝▝', '   ▝▝ ▘▘']
const ARM = { hi: ' ╱', bye: ' ╲' }

// mood: 'hi' | 'working' | 'bye'. Three rows; the legs step on every other tick while working.
export function frame(mood, tick = 0) {
  return [HEAD + (ARM[mood] ?? ''), BODY, LEGS[mood === 'working' ? tick & 1 : 0]]
}

const mmss = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0')
}

export function caption({ mood, agent, model, effort, ms }) {
  const who = [agent, model, effort].filter(Boolean).join(' · ')
  if (mood === 'hi') return 'hi! ' + who
  if (mood === 'working') return agent + ' · working ' + mmss(ms ?? 0)
  if (mood === 'bye') return 'bye! ✓ done ' + mmss(ms ?? 0)
  return who + (ms != null ? ' · done ' + mmss(ms) : '')
}

// hi outranks the rest until it is over; 'idle' means nothing is animating.
export function moodAt({ hiUntil = 0, byeUntil = 0, working = false, now }) {
  if (now < hiUntil) return 'hi'
  if (now < byeUntil) return 'bye'
  return working ? 'working' : 'idle'
}

// The lead's band: a subagent says hi for its first HELLO_MS, steps while it works, and waves
// bye for BYE_MS after it finishes (live.js keeps it on stage that long).
export function agentMood(a, now) {
  if (a.state !== 'working') return 'bye'
  return now - a.start < HELLO_MS ? 'hi' : 'working'
}

// Mascots are all or nothing: at most MAX_BAND_MASCOTS subagents, and only when the header,
// three rows per subagent and one row per pane fit in `room`. Otherwise the band is text rows.
export const MAX_BAND_MASCOTS = 3
export function bandMascots(rows, room) {
  const subs = rows.filter((r) => r.kind === 'sub').length
  return subs > 0 && subs <= MAX_BAND_MASCOTS && 1 + subs * 3 + (rows.length - subs) <= room
}

// AGENTILLE_WORKER=<agent>:<model>:<effort>, set when the lead opens the pane; effort may be empty.
export function parseWorker(text) {
  const [agent, model, effort = ''] = String(text ?? '').split(':')
  return /^[a-z][a-z-]*$/.test(agent) && /^[\w.-]+$/.test(model ?? '') ? { agent, model, effort } : null
}
