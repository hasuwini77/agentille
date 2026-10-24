// agentille guard — the policy. Looks up the integration mode for the repo a command targets (profile,
// repo caps, the snapshot taken at the typed /agt), judges pushes, merges, tags, releases, ref writes and the
// GitHub REST/GraphQL API, and reads scripts and package/make recipes before they run. The lexer
// (guard-lex.js) turns a line into the candidates these functions judge.
import { Profile } from './profile.js'
import { Proofs } from './proofs.js'
import { PROBE } from './panes.js'
import { base, commands, commandSteps, joinPath, lineMovesHead, protectedPath, SCRIPT_RISK, MAKE_RISK } from './guard-lex.js'
import { PLAIN_MODULE, jsCandidates, jsImports, moduleFiles, scriptChain } from './script-refs.js'

// The gh and curl/wget step readers live in a leaf the lexer shares; the policy keeps carrying their names.
export { ghStep, httpStep } from './guard-steps.js'

export const DENY_INTEGRATION = 'integration auto is not set in your profile for this repo; the run stops at the PR.'

export const DENY_PUSH = 'integration auto is not set in your profile for this repo: a run pushes only its own branch (agt/*, feat/*, fix/* or the one checked out), never the base branch, a tag, a force push, a branch deletion or every branch. Write the branch name and the directory out (no variables) and push again.'

export const DENY_LOCAL = 'integration is local for this repo: the run pushes nothing and opens no PR.'

export const denyHidden = (what) => 'integration auto is not set in your profile for this repo, and ' + what + ', where the guard cannot judge a push, merge, tag or release. Run those steps as plain commands, with the branch and directory written out.'

export const DENY_UNREAD = 'The guard could not read the repo this command targets; retry, or run the command yourself.'

export const denyProtected = (what) => 'integration auto is not set in your profile for this repo: below auto a run may not write ' + what + ' (the trust root ~/.agentille, the repo config, hooks, info, refs or a push-related git config), which a run could use to lift its own ceiling. Make that change yourself, or raise integration in your profile.'

const MODES = ['local', 'push', 'pr', 'auto'] // least to most autonomy

const OWN_BRANCH = /^(agt|feat|fix|storm)\//


// A configured push refspec (`[+]<src>:<dst>`, or `<ref>` for same-name) whose destination reaches the base
// branch or a tag: why it is refused, or null. A wildcard into refs/heads reaches the base too.
function refspecHitsBase(rs, bases) {
  const r = String(rs).replace(/^\+/, '').trim()
  const d = (r.includes(':') ? r.slice(r.indexOf(':') + 1) : r).trim()
  if (/^refs\/tags\//.test(d) || (/tags/.test(d) && d.includes('*'))) return 'of a tag (a configured push refspec)'
  if (d === '*' || d === 'refs/heads/*' || (d.endsWith('/*') && /heads/.test(d))) return 'to every branch including the base (a configured push refspec)'
  const name = d.replace(/^refs\/heads\//, '')
  return bases.has(name) ? 'to the base branch ' + name + ' (a configured push refspec)' : null
}


// `$(git branch --show-current)` and its kin name the branch checked out: the same as HEAD.
const CURRENT_SUB = /^\$\(git (branch --show-current|rev-parse --abbrev-ref HEAD|symbolic-ref (--short -q|-q --short|--short) HEAD|name-rev --name-only HEAD)\)$/


// One push, judged against the repo it runs in: current (the branch checked out, or null), pushDst (where a
// bare `git push` goes, or null) and bases (the default branch, main and master). Returns why it is refused.
// A push after a step that moves HEAD on the same line (p.headMoved) reads HEAD as unknown: the branch read
// before the line ran is not the one the push sees.
export function judgePush(p, { current = null, pushDst = null, bases = new Set(['main', 'master']), refspecs = [], pushDefault = null } = {}) {
  if (p.dry) return null
  if (p.bulk) return 'git push ' + p.bulk
  if (p.force) return 'git push --force'
  if (p.mergeOpt) return 'git push -o merge'
  const cur = p.headMoved ? null : current || null
  if (p.headMoved) pushDst = null
  const dst = (d) => {
    if (!d) return p.headMoved ? 'git push of HEAD after the same line switches branches' : 'git push of a branch that cannot be read here'
    if (/[$`]/.test(d)) return 'git push ' + d + ' (a variable)'
    const name = d.replace(/^refs\/heads\//, '')
    if (name.startsWith('refs/')) return 'git push ' + d
    if (bases.has(name)) return 'git push to ' + name
    if (OWN_BRANCH.test(name) || name === cur) return null
    return 'git push ' + name + ' (not a branch of this run)'
  }
  if (!p.specs.length) {
    // A bare push follows the remote's configured push refspecs, or push.default when none is set.
    if (pushDefault === 'matching') return 'git push (push.default = matching reaches the base branch)'
    for (const rs of refspecs) {
      const why = refspecHitsBase(rs, bases)
      if (why) return 'git push ' + why
    }
    return dst(pushDst || cur)
  }
  for (const raw of p.specs) {
    const spec = CURRENT_SUB.test(raw) ? 'HEAD' : raw
    if (spec.startsWith('+')) return 'git push --force'
    const k = spec.indexOf(':')
    let src = k < 0 ? spec : spec.slice(0, k)
    let to = k < 0 ? spec : spec.slice(k + 1)
    if (CURRENT_SUB.test(src)) src = 'HEAD'
    if (CURRENT_SUB.test(to)) to = cur
    if (/(^|\/)refs\/tags\//.test(src) || /^refs\/tags\//.test(to ?? '')) return 'git push <tag>'
    // A deletion is never a run's own push: a branch it did not make (feat/* is the person's prefix too) goes with it.
    if (p.del || (k === 0 && to)) return 'git push --delete ' + (to || src || 'a branch')
    if (k < 0 && (src === 'HEAD' || src === '@')) to = cur
    else if (k < 0 && /[$`]/.test(src)) to = src
    const why = dst(to)
    if (why) return why
  }
  return null
}




// A local ref write below auto: a tag (as `git tag` is), the base branch, HEAD while the base is checked out (or
// unread), or a ref the guard cannot read. Returns why it is refused, or null.
export function judgeRef(ref, { current = null, bases = new Set(['main', 'master']) } = {}) {
  if (ref === '--stdin' || /[$`]/.test(ref)) return 'git update-ref of a ref that cannot be read here'
  if (ref.startsWith('refs/tags/')) return 'a tag written with ' + ref
  const name = ref === 'HEAD' ? current : ref.replace(/^refs\/heads\//, '')
  if (!name) return 'a write to HEAD while the branch checked out cannot be read'
  return bases.has(name) ? 'a write to the base branch ' + name : null
}


// A local history rewrite below auto (git merge/reset --hard/rebase/branch -f): refused when the branch it writes
// is the base. `branch` is that branch, or null to read the branch checked out. Returns why it is refused, or null.
export function judgeLocal(branch, { current = null, bases = new Set(['main', 'master']) } = {}) {
  const raw = branch ?? current
  if (!raw || /[$`]/.test(raw)) return null // an unreadable or absent branch: the push, if any, is judged on its own
  const name = raw.replace(/^refs\/heads\//, '')
  return bases.has(name) ? 'a history rewrite on the base branch ' + name : null
}


// The first refusal a line earns, with what is known of its repo given (tests, and a line read alone):
// current branch, base, mode. Merges and tags need `auto`; pushes are judged; `local` refuses pushes and PRs.
export function integrationIn(line, { cwd = null, current = null, pushDst = null, base: b = null, mode = 'pr' } = {}) {
  if (mode === 'auto') return null
  for (const c of commandSteps(line, cwd, 0, Profile.home ? [Profile.home] : [])) {
    if (c.kind === 'protected') return c.what
    if (c.kind === 'step') return c.what
    if (c.kind === 'ref') {
      const why = judgeRef(c.ref, { current, bases: new Set(['main', 'master', b].filter(Boolean)) })
      if (why) return why
      continue
    }
    if (c.kind === 'local') {
      const why = judgeLocal(c.branch, { current, bases: new Set(['main', 'master', b].filter(Boolean)) })
      if (why) return why
      continue
    }
    if (c.kind === 'hidden') return c.what
    if (c.kind === 'file' || c.kind === 'write' || c.kind === 'alias') continue // read in guardLine: a line alone has no files or config
    if (mode === 'local') return c.what
    if (c.kind === 'push') {
      const why = judgePush(c.push, { current, pushDst, bases: new Set(['main', 'master', b].filter(Boolean)) })
      if (why) return why
    }
  }
  return null
}


// A make target's recipe and its prerequisites' recipes, read from the makefile's text; the whole text when the
// target is not a plain rule here (a pattern rule, an include): what the guard reads before it lets make run.
export function makeRecipe(text, targets) {
  const rules = new Map()
  let cur = null
  let first = null
  for (const line of String(text ?? '').split('\n')) {
    if (line.startsWith('\t')) {
      if (cur) for (const t of cur) rules.get(t).recipe.push(line)
      continue
    }
    const m = /^([^\s:#=][^:=]*?)\s*::?(?!=)\s*([^;#]*)(?:;(.*))?/.exec(line)
    if (!m || /^\s*(export|override|define|include|-include|ifeq|ifneq|ifdef|ifndef|else|endif)\b/.test(line)) {
      if (line.trim()) cur = null
      continue
    }
    cur = m[1].trim().split(/\s+/)
    for (const t of cur) {
      if (!rules.has(t)) rules.set(t, { deps: [], recipe: [] })
      rules.get(t).deps.push(...m[2].trim().split(/\s+/).filter(Boolean))
      if (m[3]) rules.get(t).recipe.push(m[3])
      if (!first && !t.startsWith('.') && !t.includes('%')) first = t
    }
  }
  const want = targets.length ? targets : first ? [first] : []
  if (!want.length || want.some((t) => !rules.has(t))) return String(text ?? '')
  const seen = new Set()
  const out = []
  const walk = (t, depth) => {
    if (seen.has(t) || depth > 6 || !rules.has(t)) return
    seen.add(t)
    out.push(...rules.get(t).recipe)
    for (const d of rules.get(t).deps) walk(d, depth + 1)
  }
  for (const t of want) walk(t, 0)
  return out.join('\n')
}


// How many hops the reader follows from the line: a script that runs a script that runs a script, and so on. A
// chain past it is refused, not passed.
const READ_DEPTH = 5

const RISK_TAIL = ' that calls git push, merge or tag, gh or curl to GitHub'

// Installed dependencies are programs, not the run's scripts: never read (a limit docs/guards.md names).
const INSTALLED = /(^|\/)node_modules\//

// The package.json a package manager reads from `dir`: the nearest one up the tree, as npm, pnpm, yarn and bun
// find it. { path, text, dir } or null.
async function nearestPkg($, dir) {
  let d = dir
  for (let i = 0; i < 64 && d; i++) {
    const path = (d === '/' ? '' : d) + '/package.json'
    const text = await $.fs.read(path).catch(() => null)
    if (text !== null) return { path, text, dir: d }
    if (d === '/') break
    d = d.slice(0, d.lastIndexOf('/')) || '/'
  }
  return null
}

// Where a file candidate came from decides what an unread file means:
//   'line'  — the Bash line itself: a script that is not there is no script (the shell fails on its own); a
//             package script, recipe or path the guard cannot place refuses.
//   'pkg'   — a package script's own text: fail closed, anything the guard cannot place, read or reach refuses.
//   'shell' — a shell script's text: what the guard can place and read is followed and judged; a step named
//             through a variable, after a `cd` it cannot follow, or whose file is not there is skipped, as test
//             and build scripts name their neighbours that way (`bash "$(dirname "$0")/x.sh"`).
const lenient = (from) => from === 'shell'

// The text a script runs, judged: a push, merge, tag or GitHub call named in it (as written, and with the
// variables it sets expanded) refuses; so does a protected write. A shell text is then followed one hop at a
// time: the scripts, package scripts, modules and recipes it runs are read in turn (fileRisk), READ_DEPTH deep.
// `label` says which text this is: a package script's steps are judged strictly, a shell file's leniently.
async function textRisk($, text, dir, what, label, depth, seen, lang = 'sh') {
  let expanded = ''
  try {
    expanded = commands(text).map((x) => x.words.join(' ')).join('\n')
  } catch {
    expanded = ''
  }
  if (SCRIPT_RISK.test(text) || SCRIPT_RISK.test(expanded)) return what + ' runs a ' + label + RISK_TAIL
  if (lang !== 'sh') return null
  const from = label === 'package script' ? 'pkg' : 'shell'
  let steps
  try {
    steps = commandSteps(text, dir, 1, await homes($))
  } catch {
    return what + ' runs a ' + label + ' the guard cannot read'
  }
  for (const s of steps) {
    if (s.kind === 'protected') return what + ' runs a ' + label + ' that writes ' + s.what
    // A step the reader could not read at all (an unresolved program or subcommand, nesting past the caps): the
    // script may push through it, so it refuses whatever the label.
    if (s.kind === 'hidden' && s.unread) return what + ' runs a ' + label + ' where ' + s.what
    if (s.kind === 'alias') {
      // A git alias the script runs (`git pom`): its expansion is read as the script's own text, one hop on.
      if (depth + 1 > READ_DEPTH) {
        if (lenient(from)) continue
        return what + ' runs scripts nested deeper than the guard reads (' + s.what + ')'
      }
      const a = await aliasLine($, s)
      if (a.why) {
        if (lenient(from)) continue
        return what + ', then ' + a.why
      }
      if (a.none) continue
      const why = await textRisk($, a.line, s.at ?? dir, what + ', then git ' + s.sub, label, depth + 1, seen)
      if (why) return why
      continue
    }
    if (s.kind !== 'file') continue
    if (depth + 1 > READ_DEPTH) {
      if (lenient(from)) continue
      return what + ' runs scripts nested deeper than the guard reads (' + s.what + ')'
    }
    const why = await fileRisk($, s, depth + 1, seen, from)
    if (why) return what + ', then ' + why
  }
  return null
}

// What a script file is, past its own text: node (its imports are read), python, or a shell script (the scripts
// it runs are read). The line said so (node x.js, sh x.sh), else the shebang does; no shebang is a shell script.
const langOf = (c, text) => c.lang && c.lang !== 'other' ? c.lang : c.lang === 'other' ? 'other' : /^#!.*\b(node|nodejs|bun|deno|tsx|ts-node)\b/.test(text) ? 'node' : /^#!.*\bpython/.test(text) ? 'python' : /^#!/.test(text) && !/^#!.*\b(ba|z|da|k)?sh\b/.test(text) ? 'other' : 'sh'

// A node file's relative imports, one level deep: each must be found and read (unless the file was reached from a
// shell script, `from` 'shell'), and none may call a tool that can push, merge, tag or release.
async function importRisk($, c, text, from) {
  const dir = c.path.slice(0, c.path.lastIndexOf('/')) || '/'
  for (const spec of jsImports(text)) {
    let found = null
    for (const cand of jsCandidates(spec)) {
      const p = joinPath(dir, cand)
      const t = await $.fs.read(p).catch(() => null)
      if (t !== null) {
        found = { p, t }
        break
      }
    }
    if (!found) {
      if (lenient(from)) continue
      return c.what + ' imports ' + spec + ', which the guard cannot read'
    }
    if (INSTALLED.test(found.p)) continue
    if (SCRIPT_RISK.test(found.t)) return c.what + ' imports ' + spec + RISK_TAIL.replace(' that', ', which')
  }
  return null
}

// python -m pkg.mod: the module is looked for where python looks first, the command's folder, then each PYTHONPATH
// entry; its parent packages' __init__.py and its own file are read. Not there, the interpreter the line names (a
// virtualenv's python in the repo included) is asked where the module lives, by its top-level name, with -I so the
// folder and PYTHONPATH are not on its path (site stays on, or pytest would be found nowhere): a module inside
// the folder (an editable install) is read from there, one installed elsewhere (the standard library, a
// site-packages tool such as pytest) is a program, not read. A module found nowhere, or a PYTHONPATH entry the guard
// cannot read before it is found, refuses (from a shell script: skipped).
async function moduleRisk($, c, from) {
  const miss = (why) => (lenient(from) ? null : c.what + why)
  if (!PLAIN_MODULE.test(c.module)) return miss(' names a module the guard cannot read')
  if (!c.dir) return miss(' runs a module the guard cannot locate (write the directory out)')
  const pp = c.pyPath ?? (await $.env.get('PYTHONPATH').catch(() => null)) ?? ''
  const roots = [c.dir, ...String(pp).split(':').filter(Boolean).map((x) => (/[$`~]/.test(x) ? null : x.startsWith('/') ? joinPath('/', x) : joinPath(c.dir, x)))]
  const { parents, own } = moduleFiles(c.module)
  const top = c.module.split('.')[0]
  const readAt = async (root) => {
    const got = []
    for (const f of [...parents, ...own]) {
      const t = await $.fs.read(root + '/' + f).catch(() => null)
      if (t !== null) got.push({ f, t })
    }
    return got.some((x) => own.includes(x.f)) ? got : null
  }
  let got = null
  for (const root of roots) {
    if (root === null) return miss(' runs a module from a PYTHONPATH entry the guard cannot read')
    got = await readAt(root)
    if (got) break
  }
  if (!got) {
    const py = /[$`]/.test(String(c.interp)) ? null : c.interp
    const code = 'import importlib.util,sys\ns=importlib.util.find_spec(sys.argv[1])\nprint(s.origin if s and s.origin else "")'
    const r = py ? await $.process.run([py, '-I', '-c', code, top], { ...PROBE, cwd: c.dir }).catch(() => null) : null
    const origin = r && r.exitCode === 0 ? String(r.stdout ?? '').trim() : ''
    if (!origin.startsWith('/')) return origin ? null : miss(' runs a module the guard cannot find')
    if (!(origin === c.dir || origin.startsWith(c.dir.replace(/\/+$/, '') + '/'))) return null
    const root = origin.replace(new RegExp('/' + top + '(/__init__)?\\.py$'), '')
    got = root !== origin ? await readAt(root) : null
    if (!got) return miss(' runs a module the guard cannot find')
  }
  for (const { t } of got) if (SCRIPT_RISK.test(t)) return c.what + ' runs a module' + RISK_TAIL
  return null
}

// A file candidate → why it is refused below auto (its code calls a tool that can push, merge, tag or release,
// or it runs something the guard cannot read), or null. `from` says where the candidate came from (see lenient):
// the Bash line, a package script's text or a shell script's text.
async function fileRisk($, c, depth = 0, seen = new Set(), from = 'line') {
  const strict = from === 'pkg'
  const skip = lenient(from)
  if (c.how === 'make') {
    if (c.paths.some((x) => x === null)) return skip ? null : c.what + ' runs a makefile the guard cannot locate'
    for (const f of c.paths) {
      const text = await $.fs.read(f).catch(() => null)
      if (text === null) continue
      return MAKE_RISK.test(makeRecipe(text, c.targets)) ? c.what + ' runs a recipe that mentions push, merge, tag or release' : null
    }
    return strict ? c.what + ' runs a makefile the guard cannot read' : null
  }
  if (c.how === 'pkg') {
    // The named script and its pre/post scripts, from the nearest package.json; each is read, then followed.
    if (!c.path) return skip ? null : c.what + ' runs a package script the guard cannot locate (write the command out)'
    const found = await nearestPkg($, c.dir)
    if (!found) return c.optional || skip ? null : c.what + ' runs a package script the guard cannot read'
    const key = found.path + '#' + c.script
    if (seen.has(key)) return null
    seen.add(key)
    let scripts
    try {
      const pkg = JSON.parse(found.text)
      scripts = pkg?.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {}
    } catch {
      return c.what + ' runs a package script the guard cannot read'
    }
    if (typeof scripts[c.script] !== 'string') return c.optional || skip ? null : c.what + ' names a package script that is not in ' + found.path
    for (const k of scriptChain(c.script)) {
      if (typeof scripts[k] !== 'string') continue
      const why = await textRisk($, scripts[k], found.dir, c.what + (k === c.script ? '' : ' (its ' + k + ' script)'), 'package script', depth, seen)
      if (why) return why
    }
    return null
  }
  if (c.how === 'runner') {
    if (!c.path) return skip ? null : c.what + ' runs a recipe the guard cannot locate (write the command out)'
    const text = await $.fs.read(c.path).catch(() => null)
    if (text === null) return skip ? null : c.what + ' runs a recipe the guard cannot read'
    return SCRIPT_RISK.test(text) ? c.what + ' runs a recipe' + RISK_TAIL : null
  }
  if (c.how === 'module') return moduleRisk($, c, from)
  if (!c.path) return skip ? null : c.what + ' runs a script the guard cannot locate (write its path out)'
  if (INSTALLED.test(c.path) || seen.has(c.path)) return null
  seen.add(c.path)
  const text = await $.fs.read(c.path).catch(() => null)
  if (text === null || text.includes('\u0000')) return strict ? c.what + ' runs a file the guard cannot read' : null
  // Read the script as the shell would: variables it sets itself are expanded, so a command assembled from
  // pieces (`G=git; $G ${P}sh`) is seen too.
  const lang = langOf(c, text)
  const why = await textRisk($, text, c.dir, c.what, 'script', depth, seen, lang)
  if (why || lang !== 'node') return why
  return importRisk($, c, text, from)
}


// Where a path lands once every link is followed: the file's own real path, else (a file not there yet) its
// folder's plus the name. null when neither stats; DANGLING when the path is a link that leads nowhere, since a
// write through it creates whatever it names.
const DANGLING = Symbol('dangling')

async function landing($, abs) {
  const own = await $.fs.stat(abs, { resolve: true }).catch(() => null)
  if (own) return own.realPath ?? (own.isLink ? DANGLING : null)
  const cut = abs.lastIndexOf('/')
  const dir = await $.fs.stat(abs.slice(0, cut) || '/', { resolve: true }).catch(() => null)
  return dir?.realPath ? dir.realPath.replace(/\/+$/, '') + '/' + abs.slice(cut + 1) : null
}

// The home folder as the guard compares it: as spelled and where it lands (a linked home, /var → /private/var).
let homeReal = { home: null, real: null }
async function homes($) {
  if (!Profile.home) return []
  if (homeReal.home !== Profile.home) homeReal = { home: Profile.home, real: (await $.fs.stat(Profile.home, { resolve: true }).catch(() => null))?.realPath ?? null }
  return [Profile.home, homeReal.real].filter(Boolean)
}

// A write target → the protected label of where it lands, or null. The spelling is judged first (protectedPath),
// then the real path, so `cfg` linked to .git/config on an earlier line, or `.GIT/CONFIG`, is refused. A link that
// leads nowhere is refused: the guard cannot see what the write would create.
export async function resolvedProtected($, raw, abs) {
  const hs = await homes($)
  const spelled = protectedPath(raw, abs, hs)
  if (spelled || !abs) return spelled
  const real = await landing($, abs)
  if (real === DANGLING) return 'a link that leads nowhere (' + raw + ')'
  return real && real !== abs ? protectedPath('', real, hs) : null
}


// ── the repo a command targets, and its mode ─────────────────────────────────
// A git remote as one comparable string: no scheme, no user@, scp-style host:path as host/path, no port, no .git.
export function normUrl(u) {
  let s = String(u ?? '').trim().toLowerCase()
  if (!s) return null
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/^[^@/]+@/, '')
  s = s.replace(/^([^/:]+):\d+\//, '$1/').replace(/^([^/:]+):/, '$1/')
  s = s.replace(/\/+$/, '').replace(/\.git$/, '').replace(/\/+$/, '')
  return s || null
}

// gh's -R / repos/<owner>/<repo>: OWNER/REPO is github.com's, HOST/OWNER/REPO and URLs are taken as given.
export function normSlug(slug) {
  const s = String(slug ?? '').trim()
  if (!s) return null
  if (/:\/\/|@/.test(s)) return normUrl(s)
  return normUrl(s.split('/').length === 2 ? 'github.com/' + s : s)
}

export function sameRemote(a, b) {
  if (!a || !b) return false
  if (a === b) return true
  const short = a.length < b.length ? a : b
  const long = short === a ? b : a
  return short.split('/').length >= 2 && long.endsWith('/' + short)
}

const trimSlash = (p) => (p.length > 1 ? p.replace(/\/+$/, '') : p)


// The profile's integration for this repo, lowered by the repo's own caps. `repo` is { url, paths, name, home }
// (a bare list of names is read as names only). projects[] entries match by `url` (the git remote) or `path`
// (the checkout, or any worktree of it). An entry with neither counts by its exact `name` or `id`, and only for a
// checkout here with no remote: two folders can share a name, a clone of someone else's repo must not inherit
// `auto` from it, and a repo the command names with no checkout here (-R, GH_REPO, a push URL) has only its URL
// to go by. Repo caps never raise the mode.
export function integrationOf(profile, repo, repoModes = []) {
  const p = profile && typeof profile === 'object' ? profile : {}
  const r = Array.isArray(repo) ? { names: repo } : repo && typeof repo === 'object' ? repo : {}
  const url = r.url ? normUrl(r.url) : null
  const paths = (r.paths ?? []).filter(Boolean).map(trimSlash)
  const names = (r.names ?? [r.name]).filter(Boolean)
  const nameOk = !url && paths.length > 0
  const home = (x) => (r.home && x.startsWith('~/') ? r.home + x.slice(1) : x)
  const located = (x) => (typeof x.url === 'string' && x.url) || (typeof x.path === 'string' && x.path)
  const byName = (x) => !located(x) && names.some((n) => n === x.name || n === x.id)
  const hit = (x) => {
    if (!x || typeof x !== 'object') return false
    if (located(x)) {
      const xu = typeof x.url === 'string' && x.url ? normUrl(x.url) : null
      const xp = typeof x.path === 'string' && x.path ? trimSlash(home(x.path)) : null
      return (!!xu && sameRemote(xu, url)) || (!!xp && paths.includes(xp))
    }
    return nameOk && byName(x)
  }
  const list = Array.isArray(p.projects) ? p.projects.filter((x) => x && typeof x === 'object') : []
  const proj = list.find(hit)
  let mode = valid(proj?.integration) ?? valid(p.integration) ?? 'pr'
  // A name-only entry this repo cannot be held to still lowers it: a name never grants `auto`, but a person who
  // set `auto` at the top and `pr` for a repo by name keeps that `pr`.
  const caps = proj ? [] : list.filter(byName).map((x) => x.integration)
  for (const m of [...caps, ...repoModes].map(valid).filter(Boolean)) if (MODES.indexOf(m) < MODES.indexOf(mode)) mode = m
  return mode
}

const valid = (m) => (MODES.includes(m) ? m : null)


// What a repo's own files say: `.agentille/config.json` {"integration": …}; CLAUDE.md / AGENTS.md saying
// `local-only` (at most local) or `no-mistakes` (at most pr).
export function capsOf(text) {
  const t = String(text ?? '')
  const out = []
  if (/(^|[^\w-])local-only([^\w-]|$)/i.test(t)) out.push('local')
  if (/(^|[^\w-])no-mistakes([^\w-]|$)/i.test(t)) out.push('pr')
  return out
}


// git said no (a nonzero exit): ''. git could not be run at all: the call throws, and the guard fails closed.
export async function gitOutOrThrow($, dir, ...a) {
  const r = await $.process.run(['git', '-C', dir, ...a], PROBE)
  if (!r || typeof r.exitCode !== 'number') throw new Error('git did not run')
  return r.exitCode === 0 ? String(r.stdout ?? '').trim() : ''
}

// `git config --get-regexp` lines → [{ name, url, pushurl, resolved }] per remote (pushurl and gh's default repo, if set).
const remotesOf = (text) => {
  const by = new Map()
  for (const l of String(text).split('\n')) {
    const m = /^remote\.(.+)\.(url|pushurl|gh-resolved)\s+(\S+)/.exec(l.trim())
    if (!m) continue
    const r = by.get(m[1]) ?? { name: m[1], url: null, pushurl: null, resolved: null }
    if (m[2] === 'url') r.url ??= m[3]
    else if (m[2] === 'pushurl') r.pushurl ??= m[3]
    else r.resolved = m[3]
    by.set(m[1], r)
  }
  return [...by.values()].filter((r) => r.url)
}


// A local dir → its repo: { root (the main checkout), dirs, url (origin's, else the first remote's), remotes, name }.
async function localRepo($, dir, cache) {
  if (cache.has(dir)) return cache.get(dir)
  const common = await gitOutOrThrow($, dir, 'rev-parse', '--path-format=absolute', '--git-common-dir')
  const root = common ? trimSlash(common.replace(/\/\.git\/?$/, '')) : null
  const remotes = remotesOf(await gitOutOrThrow($, dir, 'config', '--get-regexp', '^remote\\..*\\.(url|pushurl|gh-resolved)$'))
  const url = (remotes.find((x) => x.name === 'origin') ?? remotes[0])?.url ?? null
  const dirs = [...new Set([dir, root].filter(Boolean))]
  const rec = { root, dirs, url, remotes, name: base(root ?? dir) }
  cache.set(dir, rec)
  return rec
}


export async function readProfile($) {
  try {
    return Profile.home ? JSON.parse(await $.fs.read(Profile.home + '/.agentille/profile.json')) : null
  } catch {
    return null // no profile: the default holds
  }
}


async function repoCaps($, dirs) {
  const caps = []
  for (const d of dirs) {
    try {
      caps.push(JSON.parse(await $.fs.read(d + '/.agentille/config.json'))?.integration)
    } catch {
      // no repo config here
    }
    for (const f of ['CLAUDE.md', 'AGENTS.md', '.claude/CLAUDE.md']) caps.push(...capsOf(await $.fs.read(d + '/' + f).catch(() => '')))
  }
  return caps
}


// The integration mode for a repo, never above the snapshot taken at the typed /agt: a run can lower its own
// ceiling (a repo config, a profile the person edits down) but never raise it, so a later profile read that reads
// higher than the run started with is ignored. The snapshot (Proofs.agtProfile) is set by the typed /agt's turn.
function capMode(profile, repo, caps) {
  const live = integrationOf(profile, repo, caps)
  if (!Proofs.agtProfile) return live
  const snap = integrationOf(Proofs.agtProfile, repo, caps)
  return MODES.indexOf(snap) < MODES.indexOf(live) ? snap : live
}


// The mode for a repo the guard cannot place (a dir or remote a variable names, a target edited earlier on the
// line): the profile's top-level integration, never a name or path match.
const topMode = (profile) => capMode(profile, { url: null, paths: [], names: [], home: Profile.home }, [])


// The mode for the repo a candidate targets: its dir's repo, or the repo it names (-R, GH_REPO, repos/o/r) when
// that is not the dir's own. A dir a variable names cannot be placed: the top-level mode.
async function modeFor($, profile, c, cwd, cache) {
  if (c.slugUnknown) return topMode(profile)
  const dir = c.dir
  const local = dir ? await localRepo($, dir, cache) : null
  if (!local && !c.slug) return topMode(profile)
  const named = c.slug ? normSlug(c.slug) : null
  // The dir's own repo is its main remote's (origin, else the first): a fork's upstream is another repo.
  const mine = local && (!named || (!!local.url && sameRemote(normUrl(local.url), named)))
  if (mine) return capMode(profile, { url: local.url, paths: local.dirs, name: local.name, home: Profile.home }, await repoCaps($, local.dirs))
  return capMode(profile, { url: named, paths: [], name: named ? base(named) : null, home: Profile.home }, [])
}


// gh with no -R or GH_REPO goes to the remote `gh repo set-default` picked (remote.<name>.gh-resolved), if any.
async function ghDefault($, dir, cache) {
  if (!dir) return null
  const r = (await localRepo($, dir, cache)).remotes.find((x) => x.resolved)
  return r ? (r.resolved === 'base' ? r.url : r.resolved) : null
}


// A path or file:// remote → its absolute path; null for a URL or scp-style host:path.
function remotePath(u, dir) {
  const s = String(u)
  if (/^file:\/\//i.test(s)) return joinPath('/', s.replace(/^file:\/\/[^/]*/i, ''))
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s) || /^[^/]+:/.test(s)) return null
  if (s.startsWith('~/')) return Profile.home ? joinPath('/', Profile.home + s.slice(1)) : null
  return s.startsWith('/') ? joinPath('/', s) : dir ? joinPath(dir, s) : null
}


// The mode for the repo a push writes to: the URL git itself would push to (a remote's pushurl, insteadOf
// rewriting), compared with the dir's own repo. Another repo is judged by its URL (or path) alone.
async function pushMode($, profile, c, cwd, cache) {
  const r = c.push.remote
  if (!c.dir || c.push.remoteEdited || (r && /[$`]/.test(r))) return topMode(profile)
  const local = await localRepo($, c.dir, cache)
  let url
  if (r && !/^[\w.-]+$/.test(r)) url = (await gitOutOrThrow($, c.dir, 'ls-remote', '--get-url', r)) || r
  else {
    let name = r
    if (!name) {
      const to = await gitOutOrThrow($, c.dir, 'rev-parse', '--abbrev-ref', '@{push}')
      name = local.remotes.map((x) => x.name).sort((x, y) => y.length - x.length).find((n) => to.startsWith(n + '/')) ?? 'origin'
    }
    url = await gitOutOrThrow($, c.dir, 'remote', 'get-url', '--push', name)
    // Not a remote: git tries the name as a path (a repo, a symlink to one, a checkout) before it gives up.
    if (!url) url = (await gitOutOrThrow($, c.dir, 'rev-parse', '--resolve-git-dir', name)) || (await gitOutOrThrow($, c.dir, 'rev-parse', '--resolve-git-dir', name + '/.git'))
  }
  // Neither a remote nor a repo by that name: git refuses the push itself, so the dir's own mode stands.
  if (!url || (local.url && sameRemote(normUrl(url), normUrl(local.url)))) return modeFor($, profile, { ...c, slug: null }, cwd, cache)
  const path = remotePath(url, c.dir)
  const paths = path ? [path.replace(/\/\.git$/, '')] : []
  if (path && !local.url && local.dirs.includes(paths[0])) return modeFor($, profile, { ...c, slug: null }, cwd, cache)
  return capMode(profile, { url: path ? null : url, paths, names: [], home: Profile.home }, [])
}


export async function integrationAllowed($, cwd) {
  return modeFor($, await readProfile($), { dir: cwd, slug: null }, cwd, new Map())
}


// The bases of the repo at `at`: main, master and the remote's default branch.
async function basesOf($, at, remote = 'origin') {
  const bases = new Set(['main', 'master'])
  const head = at ? await gitOutOrThrow($, at, 'symbolic-ref', '--short', 'refs/remotes/' + remote + '/HEAD') : ''
  if (head) bases.add(head.startsWith(remote + '/') ? head.slice(remote.length + 1) : head.slice(head.indexOf('/') + 1))
  return bases
}


// What a push is judged against: the branch checked out in its dir, where a bare `git push` goes, the bases.
async function pushInfo($, c, cwd, cache) {
  const dir = c.dir
  const at = dir ?? cwd
  const remote = c.push.remote && /^[\w.-]+$/.test(c.push.remote) ? c.push.remote : 'origin'
  const bases = await basesOf($, at, remote)
  const current = dir ? (await gitOutOrThrow($, dir, 'symbolic-ref', '--short', '-q', 'HEAD')) || null : null
  let pushDst = null
  let refspecs = []
  let pushDefault = null
  if (at && !c.push.specs.length && !c.push.bulk) {
    // A bare push follows the remote's configured push refspecs, or push.default when none is set.
    refspecs = (await gitOutOrThrow($, at, 'config', '--get-all', 'remote.' + remote + '.push')).split('\n').filter(Boolean)
    pushDefault = (await gitOutOrThrow($, at, 'config', 'push.default')) || null
  }
  if (current && !c.push.specs.length) {
    const to = await gitOutOrThrow($, dir, 'rev-parse', '--abbrev-ref', '@{push}')
    const names = (await localRepo($, dir, cache)).remotes.map((x) => x.name).sort((x, y) => y.length - x.length)
    const r = names.find((n) => to.startsWith(n + '/'))
    if (to && r) pushDst = to.slice(r.length + 1)
  }
  return { current, pushDst, bases, refspecs, pushDefault }
}


// How deep an alias may expand into another alias (git itself stops a loop; the guard stops sooner).
const ALIAS_DEPTH = 5

const shq = (w) => "'" + String(w).replace(/'/g, "'\\''") + "'"

// `git <word>` where the word is no git command → the line it runs, read from git config in the repo the call
// targets: { line } for an alias (a `!` alias is a shell line, git appends the arguments), { none } when git config
// has no such alias (git runs an external git-<word> or refuses the word itself), or { why } when it cannot be read.
async function aliasLine($, c) {
  if (c.unknown || (!c.at && !c.loc.some((x, i) => i % 2 === 1 && x.startsWith('/')))) return { why: 'git ' + c.sub + ' may be an alias, in a repo the guard cannot place' }
  const argv = ['git', ...(c.at ? ['-C', c.at] : []), ...c.loc, 'config', '--get', 'alias.' + c.sub]
  const r = await $.process.run(argv, Object.keys(c.genv ?? {}).length ? { ...PROBE, env: c.genv } : PROBE).catch(() => null)
  if (!r || typeof r.exitCode !== 'number') return { why: 'git ' + c.sub + ' may be an alias the guard could not look up' }
  const value = String(r.stdout ?? '').trim()
  if (r.exitCode === 1 || (r.exitCode === 0 && !value)) return { none: true }
  if (r.exitCode !== 0) return { why: 'git ' + c.sub + ' may be an alias the guard could not look up' }
  const args = c.args.map(shq).join(' ')
  if (value.startsWith('!')) return { line: value.slice(1) + (args ? ' ' + args : '') }
  return { line: ['git', ...c.loc.map(shq), value, args].filter(Boolean).join(' ') }
}

// A line → the deny text, or null. A line the reader cannot parse is refused below auto, whatever its words: only
// a blank or comment-only line, which runs nothing, gets through. A line that was read and named nothing to judge
// (`echo hi`, `npm test`) has no candidates and runs; a part the lexer did not read (past its depth caps) is a
// candidate of its own, so it never leaves the list empty.
export async function guardLine($, line, cwd) {
  let cands
  try {
    cands = commandSteps(line, cwd, 0, await homes($))
  } catch {
    cands = runsSomething(line) ? [{ kind: 'hidden', what: 'the guard could not parse this line', dir: cwd, slug: null }] : []
  }
  if (!cands.length) return null
  const profile = await readProfile($)
  return judgeCands($, cands, { profile, cwd, cache: new Map(), envRepo: undefined }, 0)
}

// Whether a line holds anything but blanks and comments.
const runsSomething = (line) => /\S/.test(String(line ?? '').replace(/^\s*#.*$/gm, ''))

// The candidates of one line (or of an alias's expansion), judged in order: the first refusal, or null.
async function judgeCands($, cands, ctx, depth) {
  const { profile, cwd, cache } = ctx
  // GH_REPO in the session's own environment names gh's repo as one set on the line does.
  if (ctx.envRepo === undefined && cands.some((c) => c.gh && !c.slug)) ctx.envRepo = (await $.env.get('GH_REPO').catch(() => null)) || null
  let aliasMoved = false // an alias earlier on the line moved HEAD: a later push cannot read it
  for (const c0 of cands) {
    const c = aliasMoved && c0.kind === 'push' ? { ...c0, push: { ...c0.push, headMoved: true } } : c0
    if (c.kind === 'write') {
      // An ordinary write target: judged by where it lands, and only a protected landing costs a mode lookup.
      const lbl = await resolvedProtected($, c.raw, c.path)
      if (!lbl) continue
      if ((await modeFor($, profile, { ...c, slug: null }, cwd, cache)) === 'auto') continue
      return denyProtected(lbl)
    }
    const slug = c.gh && !c.slug ? ctx.envRepo ?? (await ghDefault($, c.dir, cache)) : c.slug
    const mode = c.kind === 'push' ? await pushMode($, profile, c, cwd, cache) : await modeFor($, profile, { ...c, slug }, cwd, cache)
    if (mode === 'auto') continue
    if (c.kind === 'alias') {
      // Below auto a git alias is read and its expansion judged like the line itself; one that cannot be read refuses.
      if (depth >= ALIAS_DEPTH) return denyHidden('git ' + c.sub + ' expands through more aliases than the guard follows')
      const a = await aliasLine($, c)
      if (a.why) return denyHidden(a.why)
      if (a.none) continue
      const inner = commandSteps(a.line, c.at, 0, await homes($)).map((x) => (x.kind === 'push' ? { ...x, push: { ...x.push, headMoved: x.push.headMoved || c.headMoved || aliasMoved, remoteEdited: x.push.remoteEdited || c.remoteEdited } } : x))
      const why = await judgeCands($, inner, ctx, depth + 1)
      if (why) return why
      if (lineMovesHead(a.line)) aliasMoved = true
      continue
    }
    if (c.kind === 'protected') return denyProtected(c.what)
    if (c.kind === 'step') return DENY_INTEGRATION
    if (c.kind === 'hidden') return denyHidden(c.what)
    if (c.kind === 'file') {
      const why = await fileRisk($, c)
      if (why) return denyHidden(why)
      continue
    }
    if (c.kind === 'ref') {
      const current = c.dir ? (await gitOutOrThrow($, c.dir, 'symbolic-ref', '--short', '-q', 'HEAD')) || null : null
      const why = judgeRef(c.ref, { current, bases: await basesOf($, c.dir) })
      if (why) return DENY_INTEGRATION + ' Refused: ' + why + '.'
      continue
    }
    if (c.kind === 'local') {
      const current = c.branch ? null : c.dir ? (await gitOutOrThrow($, c.dir, 'symbolic-ref', '--short', '-q', 'HEAD')) || null : null
      const why = judgeLocal(c.branch, { current, bases: await basesOf($, c.dir) })
      if (why) return DENY_INTEGRATION + ' Refused: ' + why + '.'
      continue
    }
    if (mode === 'local') return DENY_LOCAL
    if (c.kind === 'push') {
      const why = judgePush(c.push, await pushInfo($, c, cwd, cache))
      if (why) return DENY_PUSH + ' Refused: ' + why + '.'
    }
  }
  return null
}
