// agentille clean — what to tidy so no run leaves a workspace behind. Pure on purpose:
// register.js lists panes and worktrees, asks these helpers what goes, and runs the commands.
//
//   orphans   — agt-* panes no live lead owns (a lead that died never ran its SessionEnd sweep)
//   staleTabs — run-tab files of leads that are gone
//   worktrees — agt/* worktrees this session's runs opened, whose branch is merged with commits of its
//               own and whose checkout is clean and not just made
//
// Nothing that may hold the only copy of work goes: a working or blocked pane, an unmerged
// branch, a checkout with changes, another session's worktree. Those are listed as kept, with the reason.

export const AGT_BRANCH = 'agt/'

const FINISHED = new Set(['idle', 'done', 'dead'])
const isAgt = (name) => typeof name === 'string' && name.startsWith('agt-')

// Herdr's agent list → the agt-* panes in no live lead's tab. A lead is any agent pane that is not
// agt-*; it owns its own tab and the run tabs it recorded (tabsOf(pane id) → tab ids).
export function herdrOrphans(list, tabsOf = () => []) {
  const agents = Array.isArray(list) ? list : []
  const owned = new Set()
  for (const a of agents) {
    if (isAgt(a.name) || !a.pane_id) continue
    if (a.tab_id) owned.add(a.tab_id)
    for (const t of tabsOf(a.pane_id) ?? []) owned.add(t)
  }
  return agents
    .filter((a) => isAgt(a.name) && a.pane_id && !owned.has(a.tab_id))
    .map((a) => ({ id: a.pane_id, name: a.name, state: a.agent_status ?? 'unknown' }))
}

// tmux rows (parseTmuxList) → the agt-* panes in a window with no lead pane. tmux has no idle
// state: finished(row) says whether the worker is done (its done-file); a dead pane always is.
export function tmuxOrphans(rows, finished = () => false) {
  const all = Array.isArray(rows) ? rows : []
  const led = new Set(all.filter((r) => !isAgt(r.agt)).map((r) => r.window))
  return all
    .filter((r) => isAgt(r.agt) && !led.has(r.window))
    .map((r) => ({ id: r.id, name: r.agt, state: r.dead ? 'dead' : finished(r) ? 'done' : 'working' }))
}

// Orphans split into the ones to close and the ones kept: a working or blocked pane may still
// write its answer, so it stays and is named.
export function orphanPlan(orphans) {
  const close = []
  const keep = []
  for (const o of orphans ?? []) (FINISHED.has(o.state) ? close : keep).push(o)
  return { close, keep: keep.map((o) => ({ what: o.name, why: o.state })) }
}

// The lead keys (lead-<key>.tabs) whose lead pane is no longer listed. An empty list proves
// nothing (herdr may be down), so it never makes a file stale.
export function staleTabs(keys, list, keyOf) {
  const agents = Array.isArray(list) ? list : []
  if (!agents.length) return []
  const alive = new Set(agents.filter((a) => !isAgt(a.name) && a.pane_id).map((a) => keyOf(a.pane_id)))
  return (keys ?? []).filter((k) => k && !alive.has(k))
}

// `git worktree list --porcelain` → [{ path, head, branch, prunable }]; the first entry is the main checkout.
export function parseWorktrees(stdout) {
  const out = []
  let cur = null
  for (const line of String(stdout ?? '').split('\n')) {
    if (line.startsWith('worktree ')) out.push((cur = { path: line.slice(9), head: null, branch: null, prunable: false }))
    else if (!cur) continue
    else if (line.startsWith('HEAD ')) cur.head = line.slice(5)
    else if (line.startsWith('branch refs/heads/')) cur.branch = line.slice(18)
    else if (line.startsWith('prunable')) cur.prunable = true
  }
  return out
}

// Which agt/* worktrees and branches go. merged: branch names merged into the base or HEAD.
// dirty: worktree paths with uncommitted or untracked files. owned(t): this session's runs opened the
// tree or branch (t is { path, branch }); with no owned, nothing goes. empty: tree paths whose branch has
// no commits of its own (its tip is still where it forked, or the base's). fresh: tree paths made under
// FRESH_MS ago. A branch still checked out in a worktree that stays is never deleted.
export const FRESH_MS = 10 * 60_000

export function worktreePlan(trees, merged, dirty, branches = [], { owned = () => false, empty = new Set(), fresh = new Set() } = {}) {
  const remove = []
  const keep = []
  const held = new Set()
  for (const t of (trees ?? []).slice(1)) {
    if (!t.branch?.startsWith(AGT_BRANCH) || t.prunable) {
      if (t.branch) held.add(t.branch)
      continue
    }
    if (!owned(t)) keep.push({ what: t.branch, why: 'not opened by this session' })
    else if (!merged.has(t.branch)) keep.push({ what: t.branch, why: 'not merged' })
    else if (dirty.has(t.path)) keep.push({ what: t.branch, why: 'uncommitted changes' })
    else if (empty.has(t.path)) keep.push({ what: t.branch, why: 'no commits of its own' })
    else if (fresh.has(t.path)) keep.push({ what: t.branch, why: 'opened under 10 min ago' })
    else {
      remove.push(t)
      continue
    }
    held.add(t.branch)
  }
  const main = trees?.[0]?.branch
  const deleteBranches = branches.filter((b) => b.startsWith(AGT_BRANCH) && merged.has(b) && !held.has(b) && b !== main && owned({ path: null, branch: b }))
  return { remove, deleteBranches, keep, prune: (trees ?? []).some((t) => t.prunable) }
}

const plural = (n, one, many = one + 's') => n + ' ' + (n === 1 ? one : many)

// The cleaner's report: one line of what went, one of what stayed.
export function cleanText({ closed = [], tabs = 0, removed = [], branches = [], runs = 0, keep = [] }) {
  const did = [
    closed.length && plural(closed.length, 'pane') + ' closed',
    removed.length && plural(removed.length, 'worktree') + ' removed',
    branches.length && plural(branches.length, 'branch', 'branches') + ' deleted',
    tabs && plural(tabs, 'stale tab file') + ' dropped',
    runs && plural(runs, 'old run folder') + ' dropped',
  ].filter(Boolean)
  const head = did.length ? 'agt clean · ' + did.join(' · ') : 'agt clean · workspace already clean'
  if (!keep.length) return head
  return head + '\nkept: ' + keep.slice(0, 6).map((k) => k.what + ' (' + k.why + ')').join(' · ') + (keep.length > 6 ? ' · +' + (keep.length - 6) + ' more' : '')
}
