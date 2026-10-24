// agentille pane records: what the lead keeps about each pane it lists, from first sight to forgetting, in one
// place. By pane id: one PaneRecord. By name: the stage (live.js panesLeft), the resting sessions (sessionSweep)
// and the panes stranded this sweep. A leaf: it imports nothing, so any module can read it at load time.
// Other modules change a record only through the transitions below (harvest, markWoken, noteFirstSeen, …). The
// name-keyed maps are handed by reaper.js to the live.js and panes.js helpers that keep them (panesLeft,
// sessionSweep), and read everywhere else.

// PaneRecord:
//   seen             { seq, state, since } the reaper's clock for the pane's current state (live.js reapPlan)
//   firstSeen        when this session first listed it: a done-file or answer file older than that is a previous pane's
//   harvested        the lead has its answer in hand (a wire done message, a saved answer file, a close_pane)
//   wireDone         its wire done message reached this lead
//   woken            the lead already woke itself for it
//   strandedToasted  the person was told once that it is kept open, not harvested
const recs = new Map()

function blank() {
  return { seen: undefined, firstSeen: undefined, harvested: false, wireDone: false, woken: false, strandedToasted: false }
}

// The pane's record, made on first use. Read paths that must not make one use get().
export function rec(id) {
  let r = recs.get(id)
  if (!r) recs.set(id, (r = blank()))
  return r
}

export function get(id) {
  return recs.get(id)
}

export function has(id) {
  return recs.has(id)
}

// The transitions on a pane's record. Every other module calls these; none assigns a field.
// The lead has the pane's answer in hand; `wire` when it came as a wire done message.
export function harvest(id, { wire = false } = {}) {
  const r = rec(id)
  r.harvested = true
  if (wire) r.wireDone = true
}

export function markWoken(id) {
  rec(id).woken = true
}

export function markStrandedToasted(id) {
  rec(id).strandedToasted = true
}

// When this session first listed the pane, kept from the first sighting on.
export function noteFirstSeen(id, now) {
  const r = rec(id)
  if (r.firstSeen === undefined) r.firstSeen = now
}

// A pane just opened under an id the multiplexer may have handed out before: it starts with nothing, first seen now.
export function opened(id, now) {
  forget(id)
  rec(id).firstSeen = now
}

// Everything the id carries goes: a respawned pane that got the old id starts with nothing harvested.
export function forget(id) {
  recs.delete(id)
}

// A pane that left the list takes its bookkeeping with it, so a reused pane id never inherits a harvest. Its
// `seen` clock stays: the reaper prunes that against its own pool (live.js reapPlan).
export function forgetGone(listed) {
  for (const [id, r] of [...recs]) {
    if (listed.some((p) => p.id === id)) continue
    if (r.seen) recs.set(id, { ...blank(), seen: r.seen })
    else recs.delete(id)
  }
}

// The `seen` field as the Map live.js reapPlan and wire.js wakeDue take: pane id → { seq, state, since }.
export const seen = {
  get: (id) => recs.get(id)?.seen,
  set(id, v) {
    rec(id).seen = v
    return this
  },
  delete(id) {
    const r = recs.get(id)
    if (!r?.seen) return false
    r.seen = undefined
    return true
  },
  keys: () => [...recs].filter(([, r]) => r.seen).map(([id]) => id),
}

// A boolean field as the Set wire.js wakeDue takes.
const flag = (field) => ({ has: (id) => recs.get(id)?.[field] === true })
export const wireDone = flag('wireDone')
export const woken = flag('woken')

// By name, not id.
export const staged = new Map()  // pane name → last pane seen on stage (live.js panesLeft)
export const restingSince = new Map()  // session name → when it was first seen idle and unfocused (sessionSweep)
export const strandedNow = new Set()  // names of the done/idle panes kept open this sweep because nothing was harvested from them

// This sweep's stranded panes replace the last sweep's.
export function setStranded(names) {
  strandedNow.clear()
  for (const n of names) strandedNow.add(n)
}

// A session that closed is no longer resting.
export function forgetResting(name) {
  restingSince.delete(name)
}
