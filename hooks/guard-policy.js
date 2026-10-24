// agentille guard — the policy. Looks up the integration mode for the repo a command targets (profile,
// repo caps, the snapshot taken at the typed /agt), judges pushes, merges, tags, releases, ref writes and the
// GitHub REST/GraphQL API, and reads scripts and package/make recipes before they run. The lexer
// (guard-lex.js) turns a line into the candidates these functions judge.
import { Profile, Proofs } from './state.js'
import { PROBE } from './panes.js'
import { base, commands, commandSteps, joinPath, SCRIPT_RISK, MAKE_RISK } from './guard-lex.js'

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


// ── which commands integrate ─────────────────────────────────────────────────
// Each candidate: { kind: 'step' (merge, tag, release: auto only) | 'push' (judged) | 'pr' (refused under
// local), what, dir (where it runs; null when a variable names it), slug (a repo it names: owner/repo or a URL) }.
const API_WRITES = new Set(['merge', 'merges', 'merge-upstream', 'releases'])

const API_WRITE_PATH = /^repos\/[^/]+\/[^/]+\/(git\/refs|git\/tags|contents)(\/|$)/

const MUTATION = /\b(mergePullRequest|enablePullRequestAutoMerge|enqueuePullRequest|createRelease|updateRelease|deleteRelease|createRef|updateRef|updateRefs|deleteRef|mergeBranch|createCommitOnBranch)\b/

// A GraphQL body that writes a merge, a ref or a release; or one the guard cannot read (a file, a variable).
const GQL_WRITE = /\bmutation\b[\s\S]*(merge|ref|release|tag|commitonbranch)/i

const gqlWrites = (body) => MUTATION.test(body) || GQL_WRITE.test(body)

const gqlUnread = (field) => /^query=(@|\$)/.test(field)

const apiSlug = (path) => {
  const m = /^repos\/([^/]+)\/([^/]+)/.exec(path)
  return m && !m[1].startsWith('{') && !m[2].startsWith('{') ? m[1] + '/' + m[2] : null
}

const sensitive = (path) => path.split('/').some((s) => API_WRITES.has(s)) || API_WRITE_PATH.test(path)


// `env`: what the line set in front of gh; GH_REPO (or GITHUB_REPOSITORY) names its repo as -R does.
export function ghStep(w, dir, env = new Map()) {
  const args = w.slice(1)
  let slug = env.get('GH_REPO') || env.get('GITHUB_REPOSITORY') || null
  const pos = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '-R' || a === '--repo') slug = args[++i] ?? null
    else if (a.startsWith('--repo=')) slug = a.slice(7)
    else if (/^-R./.test(a)) slug = a.slice(2)
    else pos.push(a)
  }
  const [a0, a1] = pos.filter((x) => !x.startsWith('-'))
  if (a0 === 'pr' && a1 === 'merge') return { kind: 'step', what: 'gh pr merge', dir, slug }
  if (a0 === 'release' && a1 && !['list', 'ls', 'view', 'download', 'verify', 'verify-asset'].includes(a1)) return { kind: 'step', what: 'gh release ' + a1, dir, slug }
  if (a0 === 'pr' && a1 === 'create') return { kind: 'pr', what: 'gh pr create', dir, slug }
  // An alias can name any of the above under a new word: making one is a step of its own.
  if (a0 === 'alias' && !['list', 'ls'].includes(a1)) return { kind: 'step', what: 'gh alias ' + (a1 ?? ''), dir, slug }
  if (a0 !== 'api') return null
  let method = null
  let body = false
  let input = false
  let endpoint = null
  const fields = []
  for (let i = pos.indexOf('api') + 1; i < pos.length; i++) {
    const a = pos[i]
    if (a === '-X' || a === '--method') method = pos[++i] ?? null
    else if (/^-X./.test(a)) method = a.slice(2)
    else if (a.startsWith('--method=')) method = a.slice(9)
    else if (['-f', '-F', '--field', '--raw-field'].includes(a)) { body = true; fields.push(pos[++i] ?? '') }
    else if (/^-[fF]./.test(a) || a.startsWith('--field=') || a.startsWith('--raw-field=')) { body = true; fields.push(a.replace(/^(-[fF]|--(raw-)?field=)/, '')) }
    else if (a === '--input' || a.startsWith('--input=')) { body = true; input = true; if (a === '--input') i++ }
    else if (['-H', '--header', '-q', '--jq', '-t', '--template', '--hostname', '--cache', '-p', '--preview'].includes(a)) i++
    else if (a.startsWith('-')) continue
    else if (endpoint === null) endpoint = a
  }
  const m = String(method ?? (body ? 'POST' : 'GET')).toUpperCase()
  const path = String(endpoint ?? '').replace(/^\//, '').split('?')[0]
  if (m === 'GET') return null
  if (path === 'graphql') return fields.some((f) => gqlWrites(f) || gqlUnread(f)) || input ? { kind: 'step', what: 'gh api graphql mutation', dir, slug } : null
  return sensitive(path) ? { kind: 'step', what: 'gh api ' + m + ' ' + path, dir, slug: apiSlug(path) ?? slug } : null
}


// curl's one-letter options that take a value.
const CURL_SHORT_VALUE = 'AbcCdDeEFHKmoPQrtTuUwxXyYz'


// curl / wget straight at the GitHub API (api.github.com, uploads.github.com, a GHE …/api/v3/).
export function httpStep(w, dir) {
  const p = base(w[0])
  let method = null
  let body = false
  let get = false
  const data = []
  const urls = []
  const VAL = p === 'curl'
    ? ['-H', '--header', '-o', '--output', '-u', '--user', '-A', '--user-agent', '-e', '--referer', '-b', '--cookie', '-c', '--cookie-jar', '-w', '--write-out', '-m', '--max-time', '--connect-timeout', '-x', '--proxy', '--retry', '-K', '--config', '--cacert', '--cert', '--key', '-E']
    : ['-O', '--output-document', '-o', '--output-file', '--header', '-U', '--user-agent', '--user', '--password', '-t', '--tries', '-T', '--timeout', '-P', '--directory-prefix']
  for (let i = 1; i < w.length; i++) {
    const a = w[i]
    const eq = a.startsWith('--') ? a.indexOf('=') : -1
    const k = eq > 0 ? a.slice(0, eq) : a
    const v = () => (eq > 0 ? a.slice(eq + 1) : w[++i] ?? '')
    if (p === 'curl' && /^-[^-]/.test(a)) {
      // A cluster of short flags (-sSfX PUT, -sXPUT, -sd@body): a letter that takes a value ends it.
      for (let j = 1; j < a.length; j++) {
        const ch = a[j]
        if (ch === 'G' || ch === 'I') get = true
        if (!CURL_SHORT_VALUE.includes(ch)) continue
        const val = j + 1 < a.length ? a.slice(j + 1) : w[++i] ?? ''
        if (ch === 'X') method = val
        else if ('dFT'.includes(ch)) { body = true; data.push(val) }
        break
      }
    } else if (p === 'curl' && k === '--request') method = v()
    else if (p === 'curl' && k === '--get') get = true
    else if (p === 'curl' && (/^--data/.test(k) || ['--json', '--form', '--form-string', '--upload-file'].includes(k))) { body = true; data.push(v()) }
    else if (p !== 'curl' && k === '--method') method = v()
    else if (p !== 'curl' && ['--post-data', '--post-file', '--body-data', '--body-file'].includes(k)) { body = true; data.push(v()) }
    else if (VAL.includes(k)) { if (eq < 0) i++ }
    else if (!a.startsWith('-')) urls.push(a)
  }
  const m = get ? 'GET' : String(method ?? (body ? 'POST' : 'GET')).toUpperCase()
  if (m === 'GET') return null
  for (const u of urls) {
    const s = u.replace(/^[a-z]+:\/\//i, '').split(/[?#]/)[0]
    const host = s.split('/')[0].toLowerCase()
    const rest = s.slice(host.length + 1)
    const path = host === 'api.github.com' || host === 'uploads.github.com' ? rest : rest.includes('api/v3/') ? rest.slice(rest.indexOf('api/v3/') + 7) : rest.startsWith('api/graphql') ? 'graphql' : null
    if (path === null) continue
    if (path.replace(/\/$/, '') === 'graphql') {
      if (data.some((d) => gqlWrites(d) || d.startsWith('@') || /^\$/.test(d))) return { kind: 'step', what: p + ' graphql mutation', dir, slug: null }
    } else if (sensitive(path) || host === 'uploads.github.com') return { kind: 'step', what: p + ' ' + m + ' ' + path, dir, slug: apiSlug(path) }
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
  for (const c of commandSteps(line, cwd)) {
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
    if (c.kind === 'file') continue // read in guardLine: a line alone has no files
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


// A file candidate → why it is refused below auto (its code calls a tool that can push, merge, tag or release),
// or null. A path the line names through a variable cannot be read: refused. A file that is not there, or not
// text, is no script to judge: the command runs (and fails on its own).
async function fileRisk($, c) {
  if (c.how === 'make') {
    if (c.paths.some((x) => x === null)) return c.what + ' runs a makefile the guard cannot locate'
    for (const f of c.paths) {
      const text = await $.fs.read(f).catch(() => null)
      if (text === null) continue
      return MAKE_RISK.test(makeRecipe(text, c.targets)) ? c.what + ' runs a recipe that mentions push, merge, tag or release' : null
    }
    return null
  }
  if (c.how === 'pkg') {
    // Read the named script from package.json and judge its text; a missing file or script is refused.
    if (!c.path) return c.what + ' runs a package script the guard cannot locate (write the command out)'
    let script = null
    try {
      script = JSON.parse(await $.fs.read(c.path))?.scripts?.[c.script] ?? null
    } catch {
      return c.what + ' runs a package script the guard cannot read'
    }
    if (typeof script !== 'string') return c.what + ' names a package script that is not in ' + c.path
    return SCRIPT_RISK.test(script) ? c.what + ' runs a package script that calls git push, merge or tag, gh or curl to GitHub' : null
  }
  if (c.how === 'runner') {
    if (!c.path) return c.what + ' runs a recipe the guard cannot locate (write the command out)'
    const text = await $.fs.read(c.path).catch(() => null)
    if (text === null) return c.what + ' runs a recipe the guard cannot read'
    return SCRIPT_RISK.test(text) ? c.what + ' runs a recipe that calls git push, merge or tag, gh or curl to GitHub' : null
  }
  if (!c.path) return c.what + ' runs a script the guard cannot locate (write its path out)'
  const text = await $.fs.read(c.path).catch(() => null)
  if (text === null || text.includes('\u0000')) return null
  // Read the script as the shell would: variables it sets itself are expanded, so a command assembled from
  // pieces (`G=git; $G ${P}sh`) is seen too.
  let expanded = ''
  try {
    expanded = commands(text).map((x) => x.words.join(' ')).join('\n')
  } catch {
    expanded = ''
  }
  return SCRIPT_RISK.test(text) || SCRIPT_RISK.test(expanded) ? c.what + ' runs a script that calls git push, merge or tag, gh or curl to GitHub' : null
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


// A line → the deny text, or null. A line the reader cannot parse falls back to the plain words.
export async function guardLine($, line, cwd) {
  let cands
  try {
    cands = commandSteps(line, cwd)
  } catch {
    cands = /\b(pr\s+merge|release\s+create|git\s+tag\s+\S|push\b.*(\b(main|master)\b|--tags|--force|\s-f\b))/.test(line) ? [{ kind: 'step', what: 'unreadable', dir: cwd, slug: null }] : []
  }
  if (!cands.length) return null
  const profile = await readProfile($)
  const cache = new Map()
  // GH_REPO in the session's own environment names gh's repo as one set on the line does.
  const envRepo = cands.some((c) => c.gh && !c.slug) ? (await $.env.get('GH_REPO').catch(() => null)) || null : null
  for (const c of cands) {
    const slug = c.gh && !c.slug ? envRepo ?? (await ghDefault($, c.dir, cache)) : c.slug
    const mode = c.kind === 'push' ? await pushMode($, profile, c, cwd, cache) : await modeFor($, profile, { ...c, slug }, cwd, cache)
    if (mode === 'auto') continue
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
