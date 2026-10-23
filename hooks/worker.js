// agentille worker side of the wire: what this pane publishes about itself, the answer it saves under the run,
// the done message it sends its lead, and (lead side) the status each visible worker last published.

import { S } from './state.js'
import { writeRunFile } from './dispatch.js'
import { short, elapsed } from './live.js'
import { PROBE, splitName, paneKey, answerFile, herdrMetaArgv } from './panes.js'
import { PUBLISH_MS, statusKey, workerStatus, freshStatus, doneMessage, parseWire, shortName, logWire } from './wire.js'
const { wireLog, wireStatus, pub } = S

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
  if (!force && now - pub.at < PUBLISH_MS) return
  pub.at = now
  await $.store.set(statusKey(S.wireName), workerStatus({ name: S.wireName, session: S.sessionId, ...pub, now })).catch(() => {})
  if (S.transport !== 'herdr') return
  // Herdr's sidebar follows the worker: its route, then what it is doing. Changes only.
  const title = pub.state === 'done' ? '✓ done ' + elapsed(pub.ms ?? 0) : pub.tool ?? pub.state
  if (title === S.lastMeta) return
  S.lastMeta = title
  const pane = await $.env.get('HERDR_PANE_ID')
  const argv = pane && herdrMetaArgv(pane, { display: '▣ ' + shortName(S.wireName) + ' · ' + (S.worker?.model ?? short(pub.model)), title })
  if (argv) await $.process.run(argv, PROBE).catch(() => {})
}

// Worker: the full answer of a finished turn, saved under the run where the lead reads it. Returns the path, or null.
export async function saveAnswer($, name, answer) {
  const n = splitName(name)
  if (!n || !answer || !S.home) return null
  // One file per pane instance, named by this pane's id, so a respawned role cannot overwrite or be read as its predecessor.
  const pane = (await $.env.get('HERDR_PANE_ID')) ?? (await $.env.get('TMUX_PANE'))
  const file = answerFile(S.home, n.run, n.role, paneKey(pane))
  if (!file) return null
  await writeRunFile($, n.run, 'agents/' + file.split('/').pop(), answer)
  return file
}

// Worker: a finished turn saves the full answer under the run and messages the lead its head,
// so the lead wakes on its own and never scrapes the pane.
export async function reportDone($, answer) {
  const reportPath = await saveAnswer($, S.wireName, answer)
  if (!S.leadSession) return
  const text = doneMessage({ name: S.wireName, ms: pub.ms ?? 0, model: S.worker?.model ?? short(pub.model), effort: S.worker?.effort || pub.effort, tok: pub.tok, answer, reportPath })
  const r = await $.session.send({ to: { sessionId: S.leadSession }, text }).catch((err) => ({ isDelivered: false, reason: String(err?.message ?? err) }))
  if (r.isDelivered) logWire(wireLog, { from: shortName(S.wireName), to: 'lead', kind: 'done', summary: parseWire(text)?.summary || 'done', at: Date.now() })
  else $.ui.toast('agt wire: the lead did not get the result (' + String(r.reason).slice(0, 80) + ')')
}

// Lead: what each visible worker last published.
export async function readWire($) {
  const now = Date.now()
  for (const p of S.panes) {
    const rec = await $.store.get(statusKey(p.name)).catch(() => null)
    if (freshStatus(rec, p.name, now)) wireStatus.set(p.name, rec)
  }
  for (const k of [...wireStatus.keys()]) if (!S.panes.some((p) => p.name === k)) wireStatus.delete(k)
}

// ── drawing (takes resolved elements, never $) ────────────────────────────────
