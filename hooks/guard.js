// agentille guard: what a run's Bash calls may do on their own, and which worktrees a run made.
//
//   integration — `auto` (merge, tag and push with no human step) holds only where the person's own
//                 ~/.agentille/profile.json says so for this repo; a repo's .agentille/config.json may
//                 lower it, never raise it. Without it, a run's merge, tag or tag push is denied.
//   ownership   — every worktree a run's `git worktree add` created is recorded, so the cleaner removes
//                 only those and never another session's fresh checkout.
//
// A session where /agt was never typed is untouched: its Bash runs as the engine runs it.

import { S } from './state.js'
import { parseWorktrees } from './clean.js'
import { PROBE, SAFE_RUN, SPAWN_ROLE, splitName, paneKey } from './panes.js'
import { ROLES } from './routing.js'
import { leadPane } from './spawn.js'

export const DENY_INTEGRATION = 'integration auto is not set in your profile for this repo; the run stops at the PR.'
export const OWNED_TTL_MS = 14 * 24 * 60 * 60_000
const MODES = ['local', 'push', 'pr', 'auto'] // least to most autonomy

// ── the command line ─────────────────────────────────────────────────────────
// A shell line → its simple commands, each a token list. Quotes are honoured, operators (&& || ; | &),
// newlines, subshell parens and backticks split; `bash -c '…'` and `eval …` are read as the line they run.
export function splitCommands(line, depth = 0) {
  const out = []
  let cur = []
  let tok = null
  const s = String(line ?? '')
  const end = () => { if (tok !== null) { cur.push(tok); tok = null } }
  const cut = () => { end(); if (cur.length) out.push(cur); cur = [] }
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === "'") {
      const j = s.indexOf("'", i + 1)
      tok = (tok ?? '') + s.slice(i + 1, j < 0 ? s.length : j)
      i = j < 0 ? s.length : j
    } else if (c === '"') {
      let v = ''
      let j = i + 1
      for (; j < s.length && s[j] !== '"'; j++) v += s[j] === '\\' && j + 1 < s.length ? s[++j] : s[j]
      tok = (tok ?? '') + v
      i = j
    } else if (c === '\\' && i + 1 < s.length) {
      if (s[i + 1] !== '\n') tok = (tok ?? '') + s[i + 1]
      i++
    } else if (c === ' ' || c === '\t') end()
    else if ('\n;&|()`'.includes(c) || (c === '$' && s[i + 1] === '(')) cut()
    else if (c === '#' && tok === null) {
      while (i + 1 < s.length && s[i + 1] !== '\n') i++
    } else tok = (tok ?? '') + c
  }
  cut()
  const flat = []
  for (const t of out) {
    const words = stripPrefix(t)
    const inner = depth < 3 && innerLine(words)
    if (inner !== null && inner !== false) flat.push(...splitCommands(inner, depth + 1))
    else if (words.length) flat.push(words)
  }
  return flat
}

const base = (w) => String(w ?? '').split('/').pop()

// VAR=x, command, env, sudo, nohup, time … in front of the real program.
function stripPrefix(words) {
  let i = 0
  while (i < words.length) {
    const w = words[i]
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) i++
    else if (['command', 'builtin', 'exec', 'nohup', 'time', 'sudo', 'env', 'then', 'do', 'else', '!', '{'].includes(w)) {
      i++
      while (words[i]?.startsWith('-')) i++
    } else break
  }
  return words.slice(i)
}

function innerLine(words) {
  const p = base(words[0])
  if (['bash', 'sh', 'zsh', 'dash'].includes(p)) {
    const k = words.findIndex((w, n) => n > 0 && /^-[a-z]*c[a-z]*$/.test(w))
    return k > 0 && words[k + 1] !== undefined ? words[k + 1] : null
  }
  if (p === 'eval') return words.slice(1).join(' ')
  return null
}

// git's own options before the subcommand: -C <dir> is where it runs.
const GIT_VALUE_OPTS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--config-env', '--super-prefix'])
export function gitCall(words) {
  if (base(words[0]) !== 'git') return null
  let dir = null
  let i = 1
  while (i < words.length && words[i].startsWith('-')) {
    const w = words[i]
    if (GIT_VALUE_OPTS.has(w)) {
      if (w === '-C') dir = dir ? joinPath(dir, words[i + 1] ?? '') : words[i + 1] ?? null
      i += 2
    } else i++
  }
  return i < words.length ? { sub: words[i], args: words.slice(i + 1), dir } : null
}

const SEMVER_REF = /^\+?(refs\/tags\/)?v\d+\.\d+\.\d+([-+][\w.-]+)?(:\S*)?$/
const TAG_LIST = new Set(['-l', '--list', '-n', '--contains', '--no-contains', '--merged', '--no-merged', '--points-at', '--column', '--no-column', '--format', '--sort', '-i', '--ignore-case', '--omit-empty', '--color'])

// One simple command → which integration step it takes (merge, tag, tag push), or null.
export function integrationStep(words) {
  const p = base(words[0])
  if (p === 'gh') {
    const a = words.slice(1).filter((w, n, all) => !w.startsWith('-') && !['-R', '--repo'].includes(all[n - 1]))
    if (a[0] === 'pr' && a[1] === 'merge') return 'gh pr merge'
    if (a[0] === 'release' && a[1] === 'create') return 'gh release create'
    return null
  }
  const g = gitCall(words)
  if (!g) return null
  if (g.sub === 'tag') {
    // Listing tags reads only; making, moving or deleting one is the integration's step.
    if (!g.args.length) return null
    const listing = g.args.every((w) => TAG_LIST.has(w.split('=')[0]) || (!w.startsWith('-') && g.args.some((x) => x === '-l' || x === '--list')))
    return listing ? null : 'git tag'
  }
  if (g.sub === 'push') {
    if (g.args.some((w) => w === '--tags' || w === '--follow-tags' || w === '--mirror')) return 'git push --tags'
    if (g.args.some((w) => !w.startsWith('-') && (SEMVER_REF.test(w) || w.includes('refs/tags/')))) return 'git push <tag>'
    return null
  }
  return null
}

export function integrationIn(line) {
  for (const w of splitCommands(line)) {
    const step = integrationStep(w)
    if (step) return step
  }
  return null
}

// ── the profile ──────────────────────────────────────────────────────────────
const slug = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
const valid = (m) => (MODES.includes(m) ? m : null)

// The profile's integration for this repo (projects[] by name or id, then the top level) or 'pr', lowered
// by the repo's own config. Repo config never raises it: `auto` there counts for nothing.
export function integrationOf(profile, names, repoModes = []) {
  const p = profile && typeof profile === 'object' ? profile : {}
  const keys = new Set(names.filter(Boolean).flatMap((n) => [n, slug(n)]))
  const proj = Array.isArray(p.projects) ? p.projects.find((x) => x && (keys.has(x.name) || keys.has(x.id))) : null
  let mode = valid(proj?.integration) ?? valid(p.integration) ?? 'pr'
  for (const r of repoModes.map(valid).filter(Boolean)) if (MODES.indexOf(r) < MODES.indexOf(mode)) mode = r
  return mode
}

export async function integrationAllowed($, cwd) {
  let profile = null
  try {
    profile = S.home ? JSON.parse(await $.fs.read(S.home + '/.agentille/profile.json')) : null
  } catch {
    profile = null // no profile: the default holds
  }
  const dirs = [cwd]
  const common = cwd ? await $.process.run(['git', '-C', cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir'], PROBE).catch(() => null) : null
  const root = common?.exitCode === 0 ? String(common.stdout).trim().replace(/\/\.git\/?$/, '') : null
  if (root && root !== cwd) dirs.push(root)
  const repoModes = []
  for (const d of dirs.filter(Boolean)) {
    try {
      repoModes.push(JSON.parse(await $.fs.read(d + '/.agentille/config.json'))?.integration)
    } catch {
      // no repo config here
    }
  }
  return integrationOf(profile, dirs.filter(Boolean).map(base), repoModes)
}

// ── who is a run ─────────────────────────────────────────────────────────────
// An agentille subagent, a worker pane (not a /agt-spawn pane: that is the person's own task), or the lead
// on an /agt turn. A plain session has none of these.
export function fromRun(e) {
  if (e.agentId) {
    const a = S.live.get(e.agentId)
    if (a && ROLES.includes(a.role)) return true
  }
  if (S.worker) return S.worker.agent !== SPAWN_ROLE
  const self = splitName(S.wireName ?? S.selfName)
  if (self) return self.role !== SPAWN_ROLE
  return !!S.agtTurn
}

// ── worktree ownership ───────────────────────────────────────────────────────
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

export function joinPath(dir, p) {
  const s = String(p ?? '')
  const parts = (s.startsWith('/') ? s : String(dir ?? '') + '/' + s).split('/')
  const out = []
  for (const x of parts) {
    if (!x || x === '.') continue
    if (x === '..') out.pop()
    else out.push(x)
  }
  return '/' + out.join('/')
}

// The worktrees that appeared during the call and that the call names: its branch's last segment or the
// path's basename is in the command. Another session's worktree made in the same seconds is not.
export function newTrees(before, after, line) {
  const had = new Set(before.map((t) => t.path))
  const text = String(line ?? '')
  return after.slice(1).filter((t) => !had.has(t.path) && ((t.branch && text.includes(t.branch.split('/').pop())) || text.includes(t.path.split('/').pop())))
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

export function worktreesFile(home, pane) {
  const key = paneKey(pane)
  return home && key ? home + '/.agentille/state/lead-' + key + '.worktrees' : null
}

// A worker pane records under its run, where the lead that opened it reads: the pane's own key is no lead's.
async function ownFile($) {
  if (!S.home) return null
  const self = splitName(S.wireName ?? S.selfName)
  const key = paneKey(await leadPane($).catch(() => null))
  if (self) return SAFE_RUN.test(self.run) && key ? S.home + '/.agentille/state/run-' + self.run + '/worktrees/' + self.role + '.' + key + '.json' : null
  return worktreesFile(S.home, await leadPane($).catch(() => null))
}

export async function saveOwned($) {
  const file = await ownFile($)
  if (file) await $.fs.write(file, JSON.stringify(S.worktrees, null, 2) + '\n').catch(() => {})
}

// Everything this lead owns: what it recorded this session, its file (a restart), and what the worker panes
// it opened recorded under their runs.
export async function ownedWorktrees($) {
  const all = [...S.worktrees]
  const file = S.home ? worktreesFile(S.home, await leadPane($).catch(() => null)) : null
  if (file) all.push(...parseOwned(await $.fs.read(file).catch(() => '')))
  const runs = new Set([...S.openedNames].map((n) => splitName(n)?.run).filter((r) => r && SAFE_RUN.test(r)))
  for (const run of runs) {
    const dir = S.home + '/.agentille/state/run-' + run + '/worktrees'
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
  const file = S.home ? worktreesFile(S.home, await leadPane($).catch(() => null)) : null
  const saved = file ? parseOwned(await $.fs.read(file).catch(() => '')) : []
  const mine = [...S.worktrees, ...saved.filter((r) => !S.worktrees.some((m) => m.path === r.path))]
  S.worktrees.splice(0, S.worktrees.length, ...mine.filter(keep))
  if (file && (saved.length || S.worktrees.length)) await $.fs.write(file, JSON.stringify(S.worktrees, null, 2) + '\n').catch(() => {})
}

async function listTrees($, cwd) {
  const r = await $.process.run(['git', '-C', cwd, 'worktree', 'list', '--porcelain'], PROBE).catch(() => null)
  return r?.exitCode === 0 ? parseWorktrees(r.stdout) : null
}

const runOf = (e) => {
  const a = e.agentId ? S.live.get(e.agentId) : null
  return a?.run ?? splitName(S.wireName ?? S.selfName)?.run ?? S.lastRun
}

// ── the hook ─────────────────────────────────────────────────────────────────
export async function bashCall($, e, next) {
  const line = String(e.command ?? '')
  if (!fromRun(e)) return next(e)
  if (integrationIn(line)) {
    const cwd = await $.session.cwd().catch(() => null)
    if ((await integrationAllowed($, cwd)) !== 'auto') return { deny: DENY_INTEGRATION }
  }
  if (!/\bworktree\s+add\b/.test(line)) return next(e)
  const cwd = await $.session.cwd().catch(() => null)
  const before = cwd ? await listTrees($, cwd) : null
  const res = await next(e)
  const after = before ? await listTrees($, cwd) : null
  const at = Date.now()
  const run = runOf(e)
  let made = after ? newTrees(before, after, line).map((t) => ({ path: t.path, branch: t.branch, head: t.head ?? null, run, at })) : []
  // git could not be read around the call: the literal command is all there is.
  if (!after && cwd) made = worktreeAdds(line, cwd).filter((w) => w.path && w.branch).map((w) => ({ path: w.path, branch: w.branch, head: null, run, at }))
  if (made.length) {
    for (const m of made) {
      const i = S.worktrees.findIndex((r) => r.path === m.path)
      if (i >= 0) S.worktrees.splice(i, 1)
      S.worktrees.push(m)
    }
    await saveOwned($)
  }
  return res
}
