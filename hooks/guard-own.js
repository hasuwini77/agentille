// agentille guard — worktree ownership. Records every worktree a run made (the one scripts/agt-worktree.sh
// prints, or a literal `git worktree add`), so the cleaner and the .env sweep touch only those and never
// another session's fresh checkout.
import { Profile, Runs, Spawn, Session } from './state.js'
import { makeStore } from './store.js'
import { PROBE, SAFE_RUN, splitName, paneKey } from './panes.js'
import { parseWorktrees } from './clean.js'
import { leadPane } from './spawn.js'
import { gitCall, joinPath, commands, splitCommands, ASSIGN, base } from './guard-lex.js'

export const OWNED_TTL_MS = 14 * 24 * 60 * 60_000


// ── worktree ownership ───────────────────────────────────────────────────────
// Every worktree a run made is recorded: the one scripts/agt-worktree.sh prints (the documented way), or one a
// literal `git worktree add` names. The cleaner and the .env sweep touch only those.
// Literal `git worktree add <path> [-b <branch>] [<base>]` (either order), resolved against the dir it
// runs in. Shell variables cannot be read here: such a path or branch comes back null. A fallback only;
// the recorder diffs `git worktree list` around the call.
const WT_VALUE_OPTS = new Set(['-b', '-B', '--reason'])

export function worktreeAdds(line, cwd) {
  const out = []
  let here = cwd
  for (const w of splitCommands(line)) {
    if (w[0] === 'cd' && w[1] && !w[1].includes('$')) {
      here = joinPath(here, w[1])
      continue
    }
    const g = gitCall(w)
    if (!g || g.sub !== 'worktree' || g.args[0] !== 'add') continue
    let branch = null
    const pos = []
    for (let i = 1; i < g.args.length; i++) {
      const a = g.args[i]
      if (WT_VALUE_OPTS.has(a)) {
        if (a !== '--reason') branch = g.args[i + 1] ?? null
        i++
      } else if (!a.startsWith('-')) pos.push(a)
    }
    const dir = g.dir ? joinPath(here, g.dir) : here
    const path = pos[0] && !pos[0].includes('$') ? joinPath(dir, pos[0]) : null
    out.push({ path, branch: branch && !branch.includes('$') ? branch : null, base: pos[1] ?? null })
  }
  return out
}


// The worktrees that appeared during the call and that the call names as a whole word, once the line's own
// variables are expanded: the full branch (feat/ui, agt/x), the full path, or a word whose last segment is the
// path's basename (../proj-ui). A word that only contains a name ("build" holds "ui") names nothing, so the
// person's worktree made in the same seconds is never claimed.
export function newTrees(before, after, line) {
  const had = new Set(before.map((t) => t.path))
  const words = new Set()
  let list = []
  try {
    list = commands(line)
  } catch {
    list = []
  }
  for (const c of list) {
    for (const w of c.words) {
      const m = ASSIGN.exec(w)
      for (const x of m ? [w, m[2]] : [w]) words.add(x.length > 1 ? x.replace(/\/+$/, '') : x)
    }
  }
  const named = (t) => {
    const bn = base(t.path)
    if (t.branch && (words.has(t.branch) || words.has('refs/heads/' + t.branch))) return true
    if (words.has(t.path) || (bn && words.has(bn))) return true
    return !!bn && [...words].some((w) => w.includes('/') && base(w) === bn)
  }
  return after.slice(1).filter((t) => !had.has(t.path) && named(t))
}


// scripts/agt-worktree.sh, the one documented way a run makes a slice tree, prints `path=<abs>` then
// `branch=<name>` on stdout. Bash's result is { stdout, stderr }; a hook's own answer may be plain text.
export const WT_SCRIPT = /\bagt-worktree\.sh\b/

export function scriptTrees(result) {
  const text = typeof result === 'string' ? result : typeof result?.stdout === 'string' ? result.stdout : ''
  const out = []
  let path = null
  for (const raw of text.split('\n')) {
    const l = raw.replace(/\r$/, '')
    const p = /^path=(\/.+)$/.exec(l)
    if (p) {
      path = p[1]
      continue
    }
    const b = /^branch=(\S+)$/.exec(l)
    if (b && path) out.push({ path, branch: b[1] })
    path = null
  }
  return out
}


// The slugs the line hands the script: the first word after it that is not an option or an option's value.
const SCRIPT_VALUE_OPTS = new Set(['--base', '--branch'])

export function scriptSlugs(line) {
  const out = new Set()
  let list = []
  try {
    list = commands(line)
  } catch {
    return out
  }
  for (const c of list) {
    const i = c.words.findIndex((w) => base(w) === 'agt-worktree.sh')
    if (i < 0) continue
    for (let j = i + 1; j < c.words.length; j++) {
      const w = c.words[j]
      if (SCRIPT_VALUE_OPTS.has(w)) j++
      else if (!w.startsWith('-')) {
        out.add(w)
        break
      }
    }
  }
  return out
}


// What the script printed counts only where git agrees: a linked tree (never the main checkout) listed at that
// exact path, on that branch, and named as the script names it, <main checkout>-<slug> for a slug the line
// passed. Echoed text that names any other directory, another session's tree included, claims nothing.
export function claimedTrees(printed, after, slugs) {
  const main = base(after?.[0]?.path)
  const linked = (after ?? []).slice(1).filter((t) => !t.prunable && main && [...slugs].some((s) => base(t.path) === main + '-' + s))
  return printed.map((p) => linked.find((t) => t.path === p.path && t.branch === p.branch)).filter(Boolean)
}


// One record per path. A tree made again or re-attached keeps the fork point it was first recorded with (a fix
// round re-attaching must not make the slice look like it has no commits of its own); `at` is refreshed.
export function recordTrees(list, made) {
  for (const m of made) {
    const i = list.findIndex((r) => r.path === m.path)
    if (i >= 0) {
      const old = list[i]
      list.splice(i, 1)
      if (old.head && (old.branch === m.branch || !m.branch)) m.head = old.head
    }
    list.push(m)
  }
  return list
}


const ownedRec = (r) => r && typeof r.path === 'string' && r.path.startsWith('/') && (r.branch === null || typeof r.branch === 'string')

export function parseOwned(text, now = Date.now()) {
  try {
    const list = JSON.parse(String(text ?? ''))
    return Array.isArray(list) ? list.filter((r) => ownedRec(r) && !(now - (r.at ?? 0) > OWNED_TTL_MS)) : []
  } catch {
    return []
  }
}

// The worktrees this session's runs made ({ path, branch, head, run, at, src }), saved to lead-<pane>.worktrees.
// Read through the Worktrees view (guard.js and state.js re-export it); written only here.
const { s: my, view } = makeStore('guard-own.js', { worktrees: [] })
export const Worktrees = view

export function worktreesFile(home, pane) {
  const key = paneKey(pane)
  return home && key ? home + '/.agentille/state/lead-' + key + '.worktrees' : null
}

// A worker pane records under its run, where the lead that opened it reads: the pane's own key is no lead's.
async function ownFile($) {
  if (!Profile.home) return null
  const self = splitName(Session.wireName ?? Session.selfName)
  const key = paneKey(await leadPane($).catch(() => null))
  if (self) return SAFE_RUN.test(self.run) && key ? Profile.home + '/.agentille/state/run-' + self.run + '/worktrees/' + self.role + '.' + key + '.json' : null
  return worktreesFile(Profile.home, await leadPane($).catch(() => null))
}


// Adds what a call made to the session's records and saves them. What an earlier session of the same lead (a
// restart, a resume) saved is read in first, so a save never drops it and a re-attach keeps its fork point.
export async function saveOwned($, made = []) {
  const file = await ownFile($)
  if (file) for (const r of parseOwned(await $.fs.read(file).catch(() => ''))) if (!my.worktrees.some((m) => m.path === r.path)) my.worktrees.push(r)
  recordTrees(my.worktrees, made)
  if (file) await $.fs.write(file, JSON.stringify(my.worktrees, null, 2) + '\n').catch(() => {})
}


// Everything this lead owns: what it recorded this session, its file (a restart), and what the worker panes
// it opened recorded under their runs.
export async function ownedWorktrees($) {
  const all = [...my.worktrees]
  const file = Profile.home ? worktreesFile(Profile.home, await leadPane($).catch(() => null)) : null
  if (file) all.push(...parseOwned(await $.fs.read(file).catch(() => '')))
  const runs = new Set([...Spawn.openedNames].map((n) => splitName(n)?.run).filter((r) => r && SAFE_RUN.test(r)))
  for (const run of runs) {
    const dir = Profile.home + '/.agentille/state/run-' + run + '/worktrees'
    for (const f of await $.fs.list(dir).catch(() => [])) {
      if (f.kind === 'dir' || !f.name.endsWith('.json')) continue
      all.push(...parseOwned(await $.fs.read(dir + '/' + f.name).catch(() => '')))
    }
  }
  const seen = new Set()
  return all.filter((r) => !seen.has(r.path) && seen.add(r.path))
}


// Records the lead keeps: drop those whose tree and branch are both gone, so the file does not grow.
export async function forgetOwned($, trees, branches) {
  const listed = new Set(trees.map((t) => t.path))
  const have = new Set(branches)
  const keep = (r) => listed.has(r.path) || (r.branch && have.has(r.branch))
  const file = Profile.home ? worktreesFile(Profile.home, await leadPane($).catch(() => null)) : null
  const saved = file ? parseOwned(await $.fs.read(file).catch(() => '')) : []
  const mine = [...my.worktrees, ...saved.filter((r) => !my.worktrees.some((m) => m.path === r.path))]
  my.worktrees.splice(0, my.worktrees.length, ...mine.filter(keep))
  if (file && (saved.length || my.worktrees.length)) await $.fs.write(file, JSON.stringify(my.worktrees, null, 2) + '\n').catch(() => {})
}


export async function listTrees($, cwd) {
  const r = await $.process.run(['git', '-C', cwd, 'worktree', 'list', '--porcelain'], PROBE).catch(() => null)
  return r?.exitCode === 0 ? parseWorktrees(r.stdout) : null
}


export const runOf = (e) => {
  const a = e.agentId ? Runs.live.get(e.agentId) : null
  return a?.run ?? splitName(Session.wireName ?? Session.selfName)?.run ?? Runs.lastRun
}
