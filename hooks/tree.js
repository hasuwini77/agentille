// The nested agent tree, as plain data. The engine's agent list ($.agent.list) is the truth for
// who exists, who spawned whom and where each loop stands; this file merges it into the live
// map and orders rows depth-first. register.js reads the list and paints.

import { finish, newAgent } from './live.js'
import { roleOf } from './routing.js'

const ENDED = new Set(['completed', 'failed', 'killed'])
const BROKEN = new Set(['failed', 'killed'])

const typeName = (t) => String(t ?? 'agent').split(':').pop()

// Rebuild a row for every listed agent the mod has no record of (a module reload loses the live
// map). Never overwrites a known agent; ended agents are not worth a row. Model, effort and
// tokens stay empty: the list does not carry them, and nothing is guessed.
export function adopt(live, list, { run, now }) {
  const added = []
  for (const item of list ?? []) {
    if (!item?.id || live.has(item.id) || ENDED.has(item.status)) continue
    const a = newAgent({ id: item.id, role: roleOf(item.type) ?? typeName(item.type), routed: false, model: null, effort: null, reason: null, run, now })
    a.parentId = item.parentId ?? null
    a.listStatus = item.status
    a.adopted = true
    live.set(item.id, a)
    added.push(a)
  }
  return added
}

// Fold the list's view of each known agent into the live map. A failed or killed agent raises no
// turn.complete, so it is finished here; so is an adopted agent that completed or left the list.
export function applyStatus(live, list, now) {
  const byId = new Map((list ?? []).map((item) => [item.id, item]))
  for (const a of live.values()) {
    const item = byId.get(a.id)
    if (!item) {
      if (a.adopted && a.state === 'working') finish(a, now)
      continue
    }
    a.listStatus = item.status
    a.parentId ??= item.parentId ?? null
    if (a.state !== 'working') continue
    if (BROKEN.has(item.status) || (a.adopted && item.status === 'completed')) finish(a, now)
  }
}

// Depth-first order with a tree prefix per row: "├─", "│  └─". A row whose parent is not among the
// rows (the lead, a pane, a parent already gone) is a root. Prefixes are padded to one width so
// the columns after them stay in line.
export function nest(rows) {
  const ids = new Set(rows.map((r) => r.id))
  const kids = new Map()
  const roots = []
  for (const r of rows) {
    if (r.parentId && r.parentId !== r.id && ids.has(r.parentId)) kids.set(r.parentId, [...(kids.get(r.parentId) ?? []), r])
    else roots.push(r)
  }
  const out = []
  const seen = new Set()
  const walk = (list, lead) => {
    list.forEach((r, i) => {
      if (seen.has(r.id)) return
      seen.add(r.id)
      const last = i === list.length - 1
      out.push({ ...r, tree: lead + (last ? '└─' : '├─') })
      walk(kids.get(r.id) ?? [], lead + (last ? '   ' : '│  '))
    })
  }
  walk(roots, '')
  // A parent cycle never reaches a root: show those rows flat rather than lose them.
  const loose = rows.filter((r) => !seen.has(r.id))
  loose.forEach((r, i) => out.push({ ...r, tree: i === loose.length - 1 ? '└─' : '├─' }))
  const width = Math.max(0, ...out.map((r) => r.tree.length))
  return out.map((r) => ({ ...r, tree: r.tree.padEnd(width) }))
}
