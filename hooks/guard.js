// agentille guard: what a run's Bash calls may do on their own, and which worktrees a run made.
//
//   integration — `auto` (merge, tag and push with no human step) holds only where the person's own
//                 ~/.agentille/profile.json says so for the repo the command targets; the repo may lower it
//                 (.agentille/config.json, a CLAUDE.md or AGENTS.md saying `local-only` or `no-mistakes`),
//                 never raise it. Below `auto`, a run's merge, tag, release and API merge are denied, and so is
//                 any push but one of its own branch; under `local` it pushes nothing and opens no PR.
//   ownership   — every worktree a run's `git worktree add` created is recorded, so the cleaner removes
//                 only those and never another session's fresh checkout.
//
// A session where /agt was never typed is untouched: its Bash runs as the engine runs it.
//
// The command is read, not run: quotes, `$( )`, backticks, heredocs, wrappers (env, command, nice, nohup,
// timeout, xargs, sudo, time, absolute paths) and `bash -c` / `eval` are seen through, and variables set in
// the same line are expanded. A ref that is still a variable after that is not guessed at: the push is denied
// and the message asks for the name written out.

import { S } from './state.js'
import { parseWorktrees } from './clean.js'
import { PROBE, SAFE_RUN, SPAWN_ROLE, splitName, paneKey } from './panes.js'
import { ROLES } from './routing.js'
import { moment, inFlight, runHeld } from './proofs.js'
import { leadPane } from './spawn.js'

export const DENY_INTEGRATION = 'integration auto is not set in your profile for this repo; the run stops at the PR.'
export const DENY_PUSH = 'integration auto is not set in your profile for this repo: a run pushes only its own branch (agt/*, feat/*, fix/* or the one checked out), never the base branch, a tag, a force push, a branch deletion or every branch. Write the branch name and the directory out (no variables) and push again.'
export const DENY_LOCAL = 'integration is local for this repo: the run pushes nothing and opens no PR.'
export const DENY_UNREAD = 'The guard could not read the repo this command targets; retry, or run the command yourself.'
export const OWNED_TTL_MS = 14 * 24 * 60 * 60_000
const MODES = ['local', 'push', 'pr', 'auto'] // least to most autonomy
const OWN_BRANCH = /^(agt|feat|fix|storm)\//

// ── the command line ─────────────────────────────────────────────────────────
// A shell line → its simple commands in the order they run: { words, stdin }. && || ; | & and newlines
// split; `$( )`, backticks and `<( )` are commands of their own and leave a `$(…)` word behind; a heredoc or
// here-string body becomes the command's stdin (so a PR body is text, never commands); redirections drop.
function lex(s, at = 0, closer = null, depth = 0) {
  const cmds = []
  let cmd = { words: [], stdin: null }
  let tok = null
  let target = null // what the next word is: 'drop' (a redirection's file), 'stdin', 'heredoc' or 'heredoc-'
  const pending = [] // heredocs whose body starts after the next newline
  let parens = 0 // subshells opened inside a $( ): their ) is not the closer
  const word = () => {
    if (tok === null) return
    if (target === 'stdin') cmd.stdin = tok
    else if (target === 'heredoc' || target === 'heredoc-') pending.push({ cmd, delim: tok, strip: target === 'heredoc-' })
    else if (target !== 'drop') cmd.words.push(tok)
    target = null
    tok = null
  }
  const cut = () => {
    word()
    if (cmd.words.length || cmd.stdin !== null) cmds.push(cmd)
    cmd = { words: [], stdin: null }
  }
  const nested = (j, close) => {
    const r = depth < 4 ? lex(s, j, close, depth + 1) : { cmds: [], end: s.length }
    cmds.push(...r.cmds)
    tok = (tok ?? '') + '$(' + r.cmds.map((c) => c.words.join(' ')).join('; ') + ')'
    return r.end
  }
  const backtick = (j) => {
    let k = j + 1
    while (k < s.length && s[k] !== '`') k += s[k] === '\\' ? 2 : 1
    const inner = s.slice(j + 1, k).replace(/\\`/g, '`')
    const r = depth < 4 ? lex(inner, 0, null, depth + 1) : { cmds: [] }
    cmds.push(...r.cmds)
    tok = (tok ?? '') + '$(' + r.cmds.map((c) => c.words.join(' ')).join('; ') + ')'
    return Math.min(k, s.length)
  }
  const bodies = (i) => {
    // i is the newline that ends the line the heredocs were opened on; returns the last index consumed.
    let pos = i + 1
    for (const h of pending) {
      const lines = []
      for (;;) {
        if (pos >= s.length) break
        const nl = s.indexOf('\n', pos)
        const line = s.slice(pos, nl < 0 ? s.length : nl)
        pos = nl < 0 ? s.length : nl + 1
        if ((h.strip ? line.replace(/^\t+/, '') : line) === h.delim) break
        lines.push(line)
      }
      h.cmd.stdin = lines.join('\n')
    }
    pending.length = 0
    return pos - 1
  }
  let i = at
  for (; i < s.length; i++) {
    const c = s[i]
    if (c === "'" || (c === '$' && s[i + 1] === "'")) {
      if (c === '$') i++
      const j = s.indexOf("'", i + 1)
      tok = (tok ?? '') + s.slice(i + 1, j < 0 ? s.length : j)
      i = j < 0 ? s.length : j
    } else if (c === '"') {
      tok = tok ?? ''
      let j = i + 1
      for (; j < s.length && s[j] !== '"'; j++) {
        if (s[j] === '\\' && j + 1 < s.length) {
          const n = s[++j]
          if (n === '\n') continue
          tok += '$`"\\'.includes(n) ? n : '\\' + n
        } else if (s[j] === '$' && s[j + 1] === '(' && s[j + 2] !== '(') j = nested(j + 2, ')')
        else if (s[j] === '`') j = backtick(j)
        else tok += s[j]
      }
      i = j
    } else if (c === '\\' && i + 1 < s.length) {
      if (s[i + 1] !== '\n') tok = (tok ?? '') + s[i + 1]
      i++
    } else if (c === ' ' || c === '\t' || c === '\r') word()
    else if (c === '\n') {
      cut()
      if (pending.length) i = bodies(i)
    } else if (c === '#' && tok === null) {
      while (i + 1 < s.length && s[i + 1] !== '\n') i++
    } else if (c === ')' && closer === ')' && parens === 0) {
      cut()
      return { cmds, end: i }
    } else if (c === '$' && s[i + 1] === '(' && s[i + 2] === '(') {
      // arithmetic: text, never a command
      let d = 0
      let j = i + 1
      for (; j < s.length; j++) {
        if (s[j] === '(') d++
        else if (s[j] === ')' && --d === 0) break
      }
      tok = (tok ?? '') + s.slice(i, j + 1)
      i = j
    } else if (c === '$' && s[i + 1] === '(') i = nested(i + 2, ')')
    else if (c === '`') i = backtick(i)
    else if ((c === '<' || c === '>') && s[i + 1] === '(') {
      word()
      i = nested(i + 2, ')')
    } else if (c === '<' || c === '>' || (c === '&' && s[i + 1] === '>')) {
      if (tok !== null && /^\d+$/.test(tok)) tok = null // the fd in 2>
      else word()
      if (c === '<' && s.startsWith('<<<', i)) {
        target = 'stdin'
        i += 2
      } else if (c === '<' && s[i + 1] === '<') {
        target = s[i + 2] === '-' ? 'heredoc-' : 'heredoc'
        i += s[i + 2] === '-' ? 2 : 1
      } else {
        while ('<>&|'.includes(s[i + 1] ?? '') && s[i + 1] !== undefined) i++
        target = 'drop'
      }
    } else if ('\n;&|()'.includes(c)) {
      if (c === '(' && closer) parens++
      else if (c === ')' && parens) parens--
      cut()
    } else tok = (tok ?? '') + c
  }
  cut()
  return { cmds, end: i }
}

const base = (w) => String(w ?? '').split('/').pop()
const ASSIGN = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s
const expand = (w, vars) => w.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (m, a, b) => vars.get(a ?? b) ?? m)

// Wrappers in front of the real program, and their options that take a value. `timeout` also takes a duration.
const WRAP = {
  command: [], builtin: [], exec: ['-a'], nohup: [], time: ['-f', '--format', '-o', '--output'],
  sudo: ['-u', '-g', '-h', '-p', '-C', '-D', '-r', '-t', '-U', '-T', '-R', '--user', '--group', '--host', '--prompt', '--chdir', '--role', '--type', '--other-user', '--command-timeout', '--close-from'],
  env: ['-u', '--unset', '-C', '--chdir', '-S', '--split-string'],
  nice: ['-n', '--adjustment'],
  timeout: ['-s', '--signal', '-k', '--kill-after'],
  xargs: ['-I', '-L', '-l', '-n', '-P', '-s', '-d', '-E', '-e', '-a', '--arg-file', '--delimiter', '--max-args', '--max-procs', '--max-lines', '--max-chars', '--eof', '--replace', '--process-slot-var'],
}
const KEYWORDS = new Set(['then', 'do', 'else', 'elif', 'if', 'while', 'until', '!', '{', '}'])

// words → { words, dir, inner, env }: the program's own words, a directory a wrapper moved to (env -C, sudo -D),
// a line a wrapper runs as a shell line (env -S), and the variables set in front of it (GH_REPO=… gh, env K=V).
function unwrap(words) {
  let i = 0
  let dir = null
  let inner = null
  const env = new Map()
  while (i < words.length) {
    const w = words[i]
    const p = base(w)
    if (ASSIGN.test(w) || KEYWORDS.has(w)) {
      const m = ASSIGN.exec(w)
      if (m) env.set(m[1], m[2])
      i++
      continue
    }
    const opts = Object.hasOwn(WRAP, p) ? WRAP[p] : null
    if (!opts) break
    i++
    if (p === 'command' && /^-[a-zA-Z]*[vV]/.test(words[i] ?? '')) return { words: [], dir, inner, env } // a lookup, not a run
    while (i < words.length && words[i].startsWith('-') && words[i] !== '-') {
      const o = words[i]
      if (o === '--') {
        i++
        break
      }
      const [k, v] = o.startsWith('--') && o.includes('=') ? [o.slice(0, o.indexOf('=')), o.slice(o.indexOf('=') + 1)] : [o, undefined]
      const takes = opts.includes(k)
      const val = takes ? (v ?? words[i + 1]) : o.length > 2 && opts.includes(o.slice(0, 2)) ? o.slice(2) : undefined
      const flag = takes ? k : o.slice(0, 2)
      if ((flag === '-C' || flag === '--chdir') && (p === 'env' || p === 'sudo')) dir = val ?? null
      if (flag === '-D' && p === 'sudo') dir = val ?? null
      if ((flag === '-S' || flag === '--split-string') && p === 'env') inner = val ?? null
      i += takes && v === undefined ? 2 : 1
    }
    if (p === 'timeout' && i < words.length) i++ // the duration
  }
  return { words: words.slice(i), dir, inner, env }
}

// A shell that runs a line it is handed: `bash -c '…'`, `eval …`, or a heredoc/here-string fed to a shell.
function innerLine(words, stdin) {
  const p = base(words[0])
  if (['bash', 'sh', 'zsh', 'dash', 'ksh'].includes(p)) {
    const k = words.findIndex((w, n) => n > 0 && /^-[a-z]*c[a-z]*$/.test(w))
    if (k > 0) return words[k + 1] ?? null
    if (stdin !== null && !words.slice(1).some((w) => !w.startsWith('-'))) return stdin
    return null
  }
  if (p === 'eval') return words.slice(1).join(' ')
  return null
}

// The simple commands of a line, wrappers stripped and variables set earlier in it expanded: [{ words, dir, env }],
// env being what the command sees set on this line (earlier assignments and exports, and its own prefix).
export function commands(line, depth = 0, vars = new Map()) {
  const out = []
  for (const c of lex(String(line ?? '')).cmds) {
    const words = c.words.map((w) => expand(w, vars))
    const lead = words[0] === 'export' || words[0] === 'local' || words[0] === 'declare' || words[0] === 'readonly' ? 1 : 0
    if (words.length > lead && words.slice(lead).every((w) => ASSIGN.test(w) || (lead && /^-/.test(w)))) {
      for (const w of words.slice(lead)) {
        const m = ASSIGN.exec(w)
        if (m) vars.set(m[1], m[2])
      }
      continue
    }
    const u = unwrap(words)
    const env = new Map([...vars, ...u.env])
    const inner = depth < 3 ? (u.inner ?? innerLine(u.words, c.stdin)) : null
    if (inner !== null && inner !== undefined) out.push(...commands(inner, depth + 1, base(u.words[0]) === 'eval' ? vars : env))
    else if (u.words.length) out.push({ words: u.words, dir: u.dir, env })
  }
  return out
}

export function splitCommands(line) {
  return commands(line).map((c) => c.words)
}

// git's own options before the subcommand: -C <dir> is where it runs. `unknown`: a dir it names through a
// variable, which cannot be read here. `cfg`: the config keys -c / --config-env set for this one call.
const GIT_VALUE_OPTS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--config-env', '--super-prefix'])
export function gitCall(words) {
  if (!['git', 'hub'].includes(base(words[0]))) return null
  let dir = null
  let unknown = false
  const cfg = []
  let i = 1
  while (i < words.length && words[i].startsWith('-')) {
    const w = words[i]
    const eq = w.indexOf('=')
    const k = w.startsWith('--') && eq > 0 ? w.slice(0, eq) : w
    if (GIT_VALUE_OPTS.has(k)) {
      const v = k === w ? words[i + 1] ?? '' : w.slice(eq + 1)
      if (k === '-C') dir = dir ? joinPath(dir, v) : v
      if (k === '--work-tree' || k === '--git-dir') dir = k === '--git-dir' ? v.replace(/\/\.git\/?$/, '') || v : v
      if ((k === '-C' || k === '--work-tree' || k === '--git-dir') && /[$`~]/.test(v)) unknown = true
      if (k === '-c' || k === '--config-env') cfg.push(v.split('=')[0].toLowerCase())
      i += k === w ? 2 : 1
    } else i++
  }
  return i < words.length ? { sub: words[i], args: words.slice(i + 1), dir, unknown, cfg } : null
}

const TAG_LIST = new Set(['-l', '--list', '-n', '--contains', '--no-contains', '--merged', '--no-merged', '--points-at', '--column', '--no-column', '--format', '--sort', '-i', '--ignore-case', '--omit-empty', '--color'])
const TAG_LISTS = new Set(['-l', '--list', '--contains', '--no-contains', '--merged', '--no-merged', '--points-at'])
const TAG_MAKES = /^(-[a-zA-Z]*[asudfmFe]|--(annotate|sign|local-user|delete|force|message|file|edit|cleanup|create-reflog|trailer))/
function tagListing(args) {
  if (!args.length) return true
  const flag = (w) => w.split('=')[0]
  if (args.every((w) => TAG_LIST.has(flag(w)))) return true
  // -l, --contains and the like put git tag in list mode; its positionals are then patterns or commits.
  return args.some((w) => TAG_LISTS.has(flag(w)) || /^-n\d*$/.test(w)) && !args.some((w) => TAG_MAKES.test(w) && !TAG_LIST.has(flag(w)))
}

// `git push …` args → what it would push.
function parsePush(args) {
  const p = { remote: null, specs: [], force: false, del: false, bulk: null, dry: false, mergeOpt: false }
  let rest = false
  let positional = 0
  const opt = (v) => { if (/merge_when_pipeline_succeeds|auto_merge/i.test(v ?? '')) p.mergeOpt = true }
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (!rest && a === '--') rest = true
    else if (!rest && a.startsWith('--')) {
      const eq = a.indexOf('=')
      const k = eq > 0 ? a.slice(0, eq) : a
      const v = eq > 0 ? a.slice(eq + 1) : undefined
      if (k === '--repo') p.remote = v ?? args[++i] ?? null
      else if (k === '--push-option') opt(v ?? args[++i])
      else if (k === '--receive-pack' || k === '--exec') { if (v === undefined) i++ }
      else if (k.startsWith('--force')) p.force = true
      else if (k === '--delete') p.del = true
      else if (['--all', '--branches', '--mirror', '--tags', '--follow-tags', '--prune'].includes(k)) p.bulk = k
      else if (k === '--dry-run') p.dry = true
    } else if (!rest && /^-[^-]/.test(a)) {
      for (let j = 1; j < a.length; j++) {
        if (a[j] === 'f') p.force = true
        else if (a[j] === 'd') p.del = true
        else if (a[j] === 'n') p.dry = true
        else if (a[j] === 'o') {
          opt(a.slice(j + 1) || args[++i])
          break
        }
      }
    } else if (positional++ === 0) p.remote = a
    else p.specs.push(a)
  }
  return p
}

// `$(git branch --show-current)` and its kin name the branch checked out: the same as HEAD.
const CURRENT_SUB = /^\$\(git (branch --show-current|rev-parse --abbrev-ref HEAD|symbolic-ref (--short -q|-q --short|--short) HEAD|name-rev --name-only HEAD)\)$/

// One push, judged against the repo it runs in: current (the branch checked out, or null), pushDst (where a
// bare `git push` goes, or null) and bases (the default branch, main and master). Returns why it is refused.
// A push after a step that moves HEAD on the same line (p.headMoved) reads HEAD as unknown: the branch read
// before the line ran is not the one the push sees.
export function judgePush(p, { current = null, pushDst = null, bases = new Set(['main', 'master']) } = {}) {
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
  if (!p.specs.length) return dst(pushDst || cur)
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
const MUTATION = /\b(mergePullRequest|enablePullRequestAutoMerge|createRelease|updateRelease|createRef|updateRef|updateRefs|mergeBranch|createCommitOnBranch)\b/
const apiSlug = (path) => {
  const m = /^repos\/([^/]+)\/([^/]+)/.exec(path)
  return m && !m[1].startsWith('{') && !m[2].startsWith('{') ? m[1] + '/' + m[2] : null
}
const sensitive = (path) => path.split('/').some((s) => API_WRITES.has(s)) || API_WRITE_PATH.test(path)

// `env`: what the line set in front of gh; GH_REPO (or GITHUB_REPOSITORY) names its repo as -R does.
function ghStep(w, dir, env = new Map()) {
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
  if (path === 'graphql') return fields.some((f) => MUTATION.test(f)) || input ? { kind: 'step', what: 'gh api graphql mutation', dir, slug } : null
  return sensitive(path) ? { kind: 'step', what: 'gh api ' + m + ' ' + path, dir, slug: apiSlug(path) ?? slug } : null
}

// curl / wget straight at the GitHub API (api.github.com, uploads.github.com, a GHE …/api/v3/).
function httpStep(w, dir) {
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
    if (p === 'curl' && (k === '-X' || k === '--request')) method = v()
    else if (p === 'curl' && /^-X./.test(a)) method = a.slice(2)
    else if (p === 'curl' && (k === '-G' || k === '--get')) get = true
    else if (p === 'curl' && (/^--data/.test(k) || ['-d', '--json', '-F', '--form', '--form-string', '-T', '--upload-file'].includes(k))) { body = true; data.push(v()) }
    else if (p === 'curl' && /^-d./.test(a)) { body = true; data.push(a.slice(2)) }
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
      if (data.some((d) => MUTATION.test(d) || d.startsWith('@'))) return { kind: 'step', what: p + ' graphql mutation', dir, slug: null }
    } else if (sensitive(path) || host === 'uploads.github.com') return { kind: 'step', what: p + ' ' + m + ' ' + path, dir, slug: apiSlug(path) }
  }
  return null
}

function cdTo(here, args) {
  const a = args.find((x) => !/^-[LPe@]+$/.test(x))
  if (a === undefined || a === '-' || /[$`~]/.test(a)) return null
  if (a.startsWith('/')) return joinPath('/', a)
  return here ? joinPath(here, a) : null
}

// A git step that moves HEAD (or the branch it names): a later push on the same line cannot read HEAD from
// the repo as it was before the line ran. `git checkout <ref> -- <paths>` restores files and moves nothing.
const MOVES_BRANCH = /^-[a-zA-Z]*[fmM]|^--(force|move)$/
function movesHead(g) {
  const a = g.args
  const pos = a.filter((x) => !x.startsWith('-'))
  if (g.sub === 'checkout') return !a.includes('--')
  if (g.sub === 'switch' || g.sub === 'reset' || g.sub === 'bisect') return true
  if (g.sub === 'branch') return a.some((x) => MOVES_BRANCH.test(x))
  if (g.sub === 'symbolic-ref' || g.sub === 'update-ref') return pos[0] === 'HEAD' && (pos.length > 1 || a.includes('--stdin'))
  if (g.sub === 'rebase') return pos.length > 1
  return false
}

// A line → its integration candidates, each with the dir it runs in (cd, pushd, git -C, env -C followed).
// Config keys that change where a push goes: a remote's URL, its rewriting, a branch's push remote, an include.
const REMOTE_CFG = /^(remote|url|branch|include|includeif)\./i
// GIT_CONFIG_KEY_<n> and GIT_CONFIG_PARAMETERS set config for one call, as -c does.
function envCfg(env) {
  const keys = []
  for (const [k, v] of env ?? []) {
    if (/^GIT_CONFIG_KEY_\d+$/.test(k)) keys.push(String(v).toLowerCase())
    if (k === 'GIT_CONFIG_PARAMETERS') for (const m of String(v).matchAll(/'([^'=]+)'?=/g)) keys.push(m[1].toLowerCase())
  }
  return keys
}

export function commandSteps(line, cwd = null) {
  const out = []
  let here = cwd
  let moved = false // a step before this one switched branches, in any dir
  let edited = false // a step before this one changed a remote or its config: a later push's target is unknown
  let ghEdited = false // … or gh's default repo: a later gh call's target is unknown
  for (const c of commands(line)) {
    const w = c.words
    const p = base(w[0])
    if (p === 'cd' || p === 'pushd') {
      here = cdTo(here, w.slice(1))
      continue
    }
    if (p === 'popd') {
      here = null
      continue
    }
    const at = c.dir ? (/[$`~]/.test(c.dir) ? null : c.dir.startsWith('/') ? joinPath('/', c.dir) : here && joinPath(here, c.dir)) : here
    if (p === 'gh') {
      const k = ghStep(w, at, c.env)
      if (k) out.push({ ...k, gh: true, slugUnknown: ghEdited })
      if (w.includes('set-default') && w.includes('repo')) ghEdited = true
      if (w.includes('checkout') && w.includes('pr')) moved = true
    } else if (p === 'curl' || p === 'wget') {
      const k = httpStep(w, at)
      if (k) out.push(k)
    } else {
      const g = gitCall(w)
      if (!g) continue
      // GIT_DIR / GIT_WORK_TREE set on the line name the repo as --git-dir does.
      const envDir = c.env?.get('GIT_WORK_TREE') || (c.env?.get('GIT_DIR') ?? '').replace(/\/\.git\/?$/, '') || c.env?.get('GIT_DIR') || null
      const named = g.dir ?? envDir
      const dir = g.unknown || (named && /[$`~]/.test(named)) ? null : named ? (named.startsWith('/') ? joinPath('/', named) : at && joinPath(at, named)) : at
      const keys = [...g.cfg, ...envCfg(c.env)]
      const retarget = keys.some((k) => REMOTE_CFG.test(k))
      if (g.sub === 'tag' && !tagListing(g.args)) out.push({ kind: 'step', what: 'git tag', dir, slug: null })
      if (g.sub === 'push') out.push({ kind: 'push', what: 'git push', dir, slug: null, push: { ...parsePush(g.args), headMoved: moved, remoteEdited: edited || retarget } })
      if (movesHead(g)) moved = true
      if ((g.sub === 'remote' && ['add', 'set-url', 'rename', 'remove', 'rm'].includes(g.args[0])) || (g.sub === 'config' && g.args.some((x) => REMOTE_CFG.test(x)))) edited = true
    }
  }
  return out
}

// The first refusal a line earns, with what is known of its repo given (tests, and a line read alone):
// current branch, base, mode. Merges and tags need `auto`; pushes are judged; `local` refuses pushes and PRs.
export function integrationIn(line, { cwd = null, current = null, pushDst = null, base: b = null, mode = 'pr' } = {}) {
  if (mode === 'auto') return null
  for (const c of commandSteps(line, cwd)) {
    if (c.kind === 'step') return c.what
    if (mode === 'local' && c.kind !== 'step') return c.what
    if (c.kind === 'push') {
      const why = judgePush(c.push, { current, pushDst, bases: new Set(['main', 'master', b].filter(Boolean)) })
      if (why) return why
    }
  }
  return null
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
export function sameRepo(a, b) {
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
      return (!!xu && sameRepo(xu, url)) || (!!xp && paths.includes(xp))
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
const gitOut = async ($, dir, ...a) => {
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
  const common = await gitOut($, dir, 'rev-parse', '--path-format=absolute', '--git-common-dir')
  const root = common ? trimSlash(common.replace(/\/\.git\/?$/, '')) : null
  const remotes = remotesOf(await gitOut($, dir, 'config', '--get-regexp', '^remote\\..*\\.(url|pushurl|gh-resolved)$'))
  const url = (remotes.find((x) => x.name === 'origin') ?? remotes[0])?.url ?? null
  const dirs = [...new Set([dir, root].filter(Boolean))]
  const rec = { root, dirs, url, remotes, name: base(root ?? dir) }
  cache.set(dir, rec)
  return rec
}

async function readProfile($) {
  try {
    return S.home ? JSON.parse(await $.fs.read(S.home + '/.agentille/profile.json')) : null
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

// The mode for a repo the guard cannot place (a dir or remote a variable names, a target edited earlier on the
// line): the profile's top-level integration, never a name or path match.
const topMode = (profile) => integrationOf(profile, { url: null, paths: [], names: [], home: S.home }, [])

// The mode for the repo a candidate targets: its dir's repo, or the repo it names (-R, GH_REPO, repos/o/r) when
// that is not the dir's own. A dir a variable names cannot be placed: the top-level mode.
async function modeFor($, profile, c, cwd, cache) {
  if (c.slugUnknown) return topMode(profile)
  const dir = c.dir
  const local = dir ? await localRepo($, dir, cache) : null
  if (!local && !c.slug) return topMode(profile)
  const named = c.slug ? normSlug(c.slug) : null
  // The dir's own repo is its main remote's (origin, else the first): a fork's upstream is another repo.
  const mine = local && (!named || (!!local.url && sameRepo(normUrl(local.url), named)))
  if (mine) return integrationOf(profile, { url: local.url, paths: local.dirs, name: local.name, home: S.home }, await repoCaps($, local.dirs))
  return integrationOf(profile, { url: named, paths: [], name: named ? base(named) : null, home: S.home }, [])
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
  if (s.startsWith('~/')) return S.home ? joinPath('/', S.home + s.slice(1)) : null
  return s.startsWith('/') ? joinPath('/', s) : dir ? joinPath(dir, s) : null
}

// The mode for the repo a push writes to: the URL git itself would push to (a remote's pushurl, insteadOf
// rewriting), compared with the dir's own repo. Another repo is judged by its URL (or path) alone.
async function pushMode($, profile, c, cwd, cache) {
  const r = c.push.remote
  if (!c.dir || c.push.remoteEdited || (r && /[$`]/.test(r))) return topMode(profile)
  const local = await localRepo($, c.dir, cache)
  let url
  if (r && !/^[\w.-]+$/.test(r)) url = (await gitOut($, c.dir, 'ls-remote', '--get-url', r)) || r
  else {
    let name = r
    if (!name) {
      const to = await gitOut($, c.dir, 'rev-parse', '--abbrev-ref', '@{push}')
      name = local.remotes.map((x) => x.name).sort((x, y) => y.length - x.length).find((n) => to.startsWith(n + '/')) ?? 'origin'
    }
    url = await gitOut($, c.dir, 'remote', 'get-url', '--push', name)
  }
  // No such remote: git refuses the push itself, so the dir's own mode stands.
  if (!url || (local.url && sameRepo(normUrl(url), normUrl(local.url)))) return modeFor($, profile, { ...c, slug: null }, cwd, cache)
  const path = remotePath(url, c.dir)
  const paths = path ? [path.replace(/\/\.git$/, '')] : []
  if (path && !local.url && local.dirs.includes(paths[0])) return modeFor($, profile, { ...c, slug: null }, cwd, cache)
  return integrationOf(profile, { url: path ? null : url, paths, names: [], home: S.home }, [])
}

export async function integrationAllowed($, cwd) {
  return modeFor($, await readProfile($), { dir: cwd, slug: null }, cwd, new Map())
}

// What a push is judged against: the branch checked out in its dir, where a bare `git push` goes, the bases.
async function pushInfo($, c, cwd, cache) {
  const dir = c.dir
  const at = dir ?? cwd
  const remote = c.push.remote && /^[\w.-]+$/.test(c.push.remote) ? c.push.remote : 'origin'
  const bases = new Set(['main', 'master'])
  const head = at ? await gitOut($, at, 'symbolic-ref', '--short', 'refs/remotes/' + remote + '/HEAD') : ''
  if (head) bases.add(head.startsWith(remote + '/') ? head.slice(remote.length + 1) : head.slice(head.indexOf('/') + 1))
  const current = dir ? (await gitOut($, dir, 'symbolic-ref', '--short', '-q', 'HEAD')) || null : null
  let pushDst = null
  if (current && !c.push.specs.length) {
    const to = await gitOut($, dir, 'rev-parse', '--abbrev-ref', '@{push}')
    const names = (await localRepo($, dir, cache)).remotes.map((x) => x.name).sort((x, y) => y.length - x.length)
    const r = names.find((n) => to.startsWith(n + '/'))
    if (to && r) pushDst = to.slice(r.length + 1)
  }
  return { current, pushDst, bases }
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
    if (c.kind === 'step') return DENY_INTEGRATION
    if (mode === 'local') return DENY_LOCAL
    if (c.kind === 'push') {
      const why = judgePush(c.push, await pushInfo($, c, cwd, cache))
      if (why) return DENY_PUSH + ' Refused: ' + why + '.'
    }
  }
  return null
}

// ── who is a run ─────────────────────────────────────────────────────────────
// An agentille subagent, a worker pane (not a /agt-spawn pane: that is the person's own task), or the lead
// on an /agt turn, from the turn its run names an id until that run's ✓/✗ card (proofs.js runHeld; no clock
// or typed-reply count ends it), or while a run with no id is in flight (routing.js runInFlight, on the clocks
// proofs.js moment($) read): a question typed mid-run does not switch the guard off. A plain session has none.
export function fromRun(e, at) {
  if (e.agentId) {
    const a = S.live.get(e.agentId)
    if (a && ROLES.includes(a.role)) return true
  }
  if (S.worker) return S.worker.agent !== SPAWN_ROLE
  const self = splitName(S.wireName ?? S.selfName)
  if (self) return self.role !== SPAWN_ROLE
  return !!S.agtTurn || runHeld() || inFlight(S, at)
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
  if (!fromRun(e, await moment($))) return next(e)
  const cwd = await $.session.cwd().catch(() => null)
  // Probing that throws is no answer: the command does not run unread.
  const deny = await guardLine($, line, cwd).catch(() => DENY_UNREAD)
  if (deny) return { deny }
  if (!/\bworktree\s+add\b/.test(line)) return next(e)
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
