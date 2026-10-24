// agentille worker side of the wire: what this pane publishes about itself, the answer it saves under the run,
// the done message it sends its lead, and (lead side) the status each visible worker last published.

import { S, Profile } from './state.js'
import { makeStore } from './store.js'
import { writeRunFile } from './dispatch.js'
import { short, elapsed } from './live.js'
import { PROBE, splitName, paneKey, answerFile, herdrMetaArgv } from './panes.js'
import { PUBLISH_MS, statusKey, workerStatus, freshStatus, doneMessage, parseWire, shortName, logWire } from './wire.js'

// The wire's store: the messages between sessions (the band and the deck draw them), the status each visible worker
// last published (lead side) and what this worker publishes about itself. Read through the Wire view; written here.
const { s, view } = makeStore('worker.js', {
  wireLog: [],  // [{ from, to, kind, summary, at }] messages between sessions, newest last
  wireStatus: new Map(),  // pane name → what its worker last published (wire.js workerStatus)
  pub: { state: 'starting', tool: null, tok: 0, model: null, effort: null, start: null, at: 0 },  // worker's published status
})
export const Wire = view
let lastMeta = ''  // worker: the last Herdr sidebar title it reported

// A message between sessions, for the band and the deck.
export function noteWire(entry) {
  logWire(s.wireLog, entry)
}

// Worker: what it publishes about itself, one transition per event of its main loop.
export function pubRoute(model, effort) {
  s.pub.model = model
  s.pub.effort = effort || null
}
export function pubTool(label) {
  s.pub.tool = label
}
export function pubStep(usage, model) {
  s.pub.tok += (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.output_tokens ?? 0)
  s.pub.model = model
}
export function pubWorking() {
  Object.assign(s.pub, { state: 'working', tool: null, start: Date.now(), ms: null })
}
export function pubDone() {
  Object.assign(s.pub, { state: 'done', tool: null, ms: Date.now() - (s.pub.start ?? Date.now()) })
}

// Worker: what it is doing, into the shared store, at most once per PUBLISH_MS unless forced.
// Publishes run one after another, so a late tool-call publish never lands over a forced 'done'.
let pubChain = Promise.resolve()

export function publish($, force = false) {
  const p = pubChain.then(() => publishNow($, force))
  pubChain = p.catch(() => {})
  return p
}

export async function publishNow($, force) {
  if (!S.wireName) return
  const now = Date.now()
  if (!force && now - s.pub.at < PUBLISH_MS) return
  s.pub.at = now
  await $.store.set(statusKey(S.wireName), workerStatus({ name: S.wireName, session: S.sessionId, ...s.pub, now })).catch(() => {})
  if (S.transport !== 'herdr') return
  // Herdr's sidebar follows the worker: its route, then what it is doing. Changes only.
  const title = s.pub.state === 'done' ? '✓ done ' + elapsed(s.pub.ms ?? 0) : s.pub.tool ?? s.pub.state
  if (title === lastMeta) return
  lastMeta = title
  const pane = await $.env.get('HERDR_PANE_ID')
  const argv = pane && herdrMetaArgv(pane, { display: '▣ ' + shortName(S.wireName) + ' · ' + (S.worker?.model ?? short(s.pub.model)), title })
  if (argv) await $.process.run(argv, PROBE).catch(() => {})
}

// Worker: the full answer of a finished turn, saved under the run where the lead reads it. Returns the path, or null.
export async function saveAnswer($, name, answer) {
  const n = splitName(name)
  if (!n || !answer || !Profile.home) return null
  // One file per pane instance, named by this pane's id, so a respawned role cannot overwrite or be read as its predecessor.
  const pane = (await $.env.get('HERDR_PANE_ID')) ?? (await $.env.get('TMUX_PANE'))
  const file = answerFile(Profile.home, n.run, n.role, paneKey(pane))
  if (!file) return null
  await writeRunFile($, n.run, 'agents/' + file.split('/').pop(), answer)
  return file
}

// Worker: a finished turn saves the full answer under the run and messages the lead its head,
// so the lead wakes on its own and never scrapes the pane.
export async function reportDone($, answer) {
  const reportPath = await saveAnswer($, S.wireName, answer)
  if (!S.leadSession) return
  const text = doneMessage({ name: S.wireName, ms: s.pub.ms ?? 0, model: S.worker?.model ?? short(s.pub.model), effort: S.worker?.effort || s.pub.effort, tok: s.pub.tok, answer, reportPath })
  const r = await $.session.send({ to: { sessionId: S.leadSession }, text }).catch((err) => ({ isDelivered: false, reason: String(err?.message ?? err) }))
  if (r.isDelivered) noteWire({ from: shortName(S.wireName), to: 'lead', kind: 'done', summary: parseWire(text)?.summary || 'done', at: Date.now() })
  else $.ui.toast('agt wire: the lead did not get the result (' + String(r.reason).slice(0, 80) + ')')
}

// Lead: what each visible worker last published.
export async function readWire($) {
  const now = Date.now()
  for (const p of S.panes) {
    const rec = await $.store.get(statusKey(p.name)).catch(() => null)
    if (freshStatus(rec, p.name, now)) s.wireStatus.set(p.name, rec)
  }
  for (const k of [...s.wireStatus.keys()]) if (!S.panes.some((p) => p.name === k)) s.wireStatus.delete(k)
}

// ── drawing (takes resolved elements, never $) ────────────────────────────────
