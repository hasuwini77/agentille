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
// timeout, xargs, sudo, time, script, watch, flock, caffeinate, stdbuf, arch, ssh, parallel, coproc, find -exec,
// absolute paths) and `bash -c` / `fish -c` / `eval` are seen through, and variables set in the same line are
// expanded. A ref that is still a variable after that is not guessed at: the push is denied and the message asks
// for the name written out; so is a HEAD push after a branch switch earlier on the line. What the reader cannot
// follow is judged by what it holds, below `auto`: interpreter code (python -c, node -e …) that mentions git, gh
// or curl is refused, and a script file, a sourced file or a make target is read first and refused when it pushes,
// merges, tags or releases. Probing that fails denies the command: the guard never lets a line through unread.

import { S } from './state.js'
import { parseWorktrees } from './clean.js'
import { PROBE, SAFE_RUN, SPAWN_ROLE, splitName, paneKey } from './panes.js'
import { ROLES } from './routing.js'
import { moment, inFlight, runHeld } from './proofs.js'
import { leadPane } from './spawn.js'
import { reportRun } from './drawing.js'
import { completeReport } from './dispatch.js'

export const DENY_INTEGRATION = 'integration auto is not set in your profile for this repo; the run stops at the PR.'
export const DENY_PUSH = 'integration auto is not set in your profile for this repo: a run pushes only its own branch (agt/*, feat/*, fix/* or the one checked out), never the base branch, a tag, a force push, a branch deletion or every branch. Write the branch name and the directory out (no variables) and push again.'
export const DENY_LOCAL = 'integration is local for this repo: the run pushes nothing and opens no PR.'
export const denyHidden = (what) => 'integration auto is not set in your profile for this repo, and ' + what + ', where the guard cannot judge a push, merge, tag or release. Run those steps as plain commands, with the branch and directory written out.'
export const DENY_UNREAD = 'The guard could not read the repo this command targets; retry, or run the command yourself.'
export const denyProtected = (what) => 'integration auto is not set in your profile for this repo: below auto a run may not write ' + what + ' (the trust root ~/.agentille, the repo config, hooks, info, refs or a push-related git config), which a run could use to lift its own ceiling. Make that change yourself, or raise integration in your profile.'
export const OWNED_TTL_MS = 14 * 24 * 60 * 60_000
const MODES = ['local', 'push', 'pr', 'auto'] // least to most autonomy
const OWN_BRANCH = /^(agt|feat|fix|storm)\//

// The trust root and the repo's own git state: a write to any of these below auto is refused, because a run could
// use it to lift its own ceiling (rewrite ~/.agentille/profile.json), run code (a git hook) or publish (a ref).
// `raw` is the path as the line wrote it (so `~`, `$HOME`, a relative `.git/config` are seen); `abs` its resolved
// form. Returns a short label for the deny message, or null.
export function protectedPath(raw, abs) {
  const r = String(raw ?? '')
  const a = String(abs ?? '')
  if (/\$\{?GIT_DIR\}?/.test(r)) return '$GIT_DIR'
  if (/^~\/\.agentille(\/|$)/.test(r)) return '~/.agentille'
  if (/^(\$HOME|\$\{HOME\})\/\.agentille(\/|$)/.test(r)) return '~/.agentille'
  if (S.home && (a === S.home + '/.agentille' || a.startsWith(S.home + '/.agentille/'))) return '~/.agentille'
  const git = (s) =>
    /(^|\/)\.git\/config$/.test(s) ? '.git/config'
    : /(^|\/)\.git\/hooks(\/|$)/.test(s) ? '.git/hooks'
    : /(^|\/)\.git\/info(\/|$)/.test(s) ? '.git/info'
    : /(^|\/)\.git\/refs(\/|$)/.test(s) ? '.git/refs'
    : /(^|\/)\.git\/packed-refs$/.test(s) ? '.git/packed-refs'
    : /(^|\/)\.git$/.test(s) ? 'the worktree .git file'
    : null
  return git(a) ?? git(r)
}

// git config keys a run may not set below auto: aliases (rename a step past the reader), the hooks path (run code),
// a remote's push URL or refspec, URL rewriting, receive.* — anything that changes where or how a push lands.
const PROTECT_CFG = /^(alias\.|core\.hookspath$|remote\..*\.(push|pushurl)$|url\..*\.(push)?insteadof$|receive\.)/i

// Whether a `git config …` writes a value (as opposed to reading or unsetting one): a `set` verb, `--add`/
// `--replace-all`, or a bare `key value`.
function gitConfigSets(args) {
  const pos = args.filter((x) => !x.startsWith('-'))
  if (args.some((x) => /^(--get|--get-all|--get-regexp|--get-urlmatch|--list|-l|--get-color|--get-colorbool|--unset|--unset-all)$/.test(x))) return false
  if (['get', 'get-all', 'get-regexp', 'get-urlmatch', 'list', 'unset', 'unset-all'].includes(pos[0])) return false
  if (args.some((x) => x === '--add' || x === '--replace-all')) return true
  return pos[0] === 'set' ? pos.length >= 3 : pos.length >= 2
}

// Commands that write a file given as an argument → the paths they write (for the protected-path check). Each
// resolves against the command's dir in commandSteps.
function writeTargets(words) {
  const p = base(words[0])
  const pos = []
  const out = []
  if (p === 'tee') {
    for (let i = 1; i < words.length; i++) {
      const w = words[i]
      if (w.startsWith('-')) { if (w === '--output-error') i++; continue }
      out.push(w)
    }
    return out
  }
  if (p === 'dd') {
    for (const w of words) { const m = /^of=(.+)/.exec(w); if (m) out.push(m[1]) }
    return out
  }
  if (p === 'truncate') {
    for (let i = 1; i < words.length; i++) {
      const w = words[i]
      if (w === '-s' || w === '--size' || w === '-r' || w === '--reference') { i++; continue }
      if (!w.startsWith('-')) out.push(w)
    }
    return out
  }
  if (p === 'cp' || p === 'mv' || p === 'install' || p === 'ln') {
    let t = null
    for (let i = 1; i < words.length; i++) {
      const w = words[i]
      if (w === '-t' || w === '--target-directory') { t = words[++i]; continue }
      if (/^--target-directory=/.test(w)) { t = w.split('=').slice(1).join('='); continue }
      if (['-m', '--mode', '-S', '--suffix', '-o', '-g', '-Z', '--context'].includes(w)) { i++; continue }
      if (!w.startsWith('-')) pos.push(w)
    }
    if (t) out.push(t)
    else if (pos.length >= 2) out.push(pos[pos.length - 1]) // the destination / link name
    return out
  }
  if (p === 'sed' || p === 'perl') {
    const inPlace = words.some((w, n) => n > 0 && (w === '--in-place' || /^--in-place=/.test(w) || (/^-[a-zA-Z]*i/.test(w) && !w.startsWith('--'))))
    if (!inPlace) return out
    const scriptGiven = words.some((w) => ['-e', '-E', '--expression', '-f', '--file'].includes(w) || /^-[a-zA-Z]*[eEf]/.test(w))
    for (let i = 1; i < words.length; i++) {
      const w = words[i]
      if (['-e', '-E', '--expression', '-f', '--file'].includes(w)) { i++; continue }
      if (!w.startsWith('-')) pos.push(w)
    }
    // Without -e/-f the first positional is the script; the rest are the files edited in place.
    return scriptGiven ? pos : pos.slice(1)
  }
  return out
}

// ── the command line ─────────────────────────────────────────────────────────
// A shell line → its simple commands in the order they run: { words, stdin }. && || ; | & and newlines
// split; `$( )`, backticks and `<( )` are commands of their own and leave a `$(…)` word behind; a heredoc or
// here-string body becomes the command's stdin (so a PR body is text, never commands); redirections drop.
function lex(s, at = 0, closer = null, depth = 0) {
  const cmds = []
  let cmd = { words: [], stdin: null, redirects: [], piped: false }
  let tok = null
  let target = null // what the next word is: 'drop' (an input redirection's file), 'redir' (an output file), 'stdin', 'heredoc' or 'heredoc-'
  const pending = [] // heredocs whose body starts after the next newline
  let parens = 0 // subshells opened inside a $( ): their ) is not the closer
  const word = () => {
    if (tok === null) return
    if (target === 'stdin') cmd.stdin = tok
    else if (target === 'heredoc' || target === 'heredoc-') pending.push({ cmd, delim: tok, strip: target === 'heredoc-' })
    else if (target === 'redir') cmd.redirects.push(tok)
    else if (target !== 'drop') cmd.words.push(tok)
    target = null
    tok = null
  }
  const cut = () => {
    word()
    if (cmd.words.length || cmd.stdin !== null) cmds.push(cmd)
    cmd = { words: [], stdin: null, redirects: [], piped: false }
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
        const out = c === '>' || c === '&' // '>' / '>>' / '&>' write a file; '<' is a read
        while ('<>&|'.includes(s[i + 1] ?? '') && s[i + 1] !== undefined) i++
        target = out ? 'redir' : 'drop'
      }
    } else if ('\n;&|()'.includes(c)) {
      if (c === '(' && closer) parens++
      else if (c === ')' && parens) parens--
      const pipe = c === '|' && s[i + 1] !== '|' // `|` / `|&` feed the next command; `||` does not
      if (c === '|' && (s[i + 1] === '|' || s[i + 1] === '&')) i++
      cut()
      if (pipe) cmd.piped = true
    } else tok = (tok ?? '') + c
  }
  cut()
  return { cmds, end: i }
}

const base = (w) => String(w ?? '').split('/').pop()
const ASSIGN = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s
const expand = (w, vars) => w.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (m, a, b) => vars.get(a ?? b) ?? m)

// Wrappers in front of the real program, and their options that take a value. `timeout` also takes a duration.
// An object entry says more: `c`, its options whose value is a shell line it runs (flock -c, script -c); `skip`,
// the positionals before the program (flock's lock file, script's log file, ssh's host); `line`, that it runs the
// rest as one shell line (watch, ssh). `par`: GNU parallel, whose `:::` arguments complete the command.
const WRAP = {
  command: [], builtin: [], exec: ['-a'], nohup: [], time: ['-f', '--format', '-o', '--output'],
  sudo: ['-u', '-g', '-h', '-p', '-C', '-D', '-r', '-t', '-U', '-T', '-R', '--user', '--group', '--host', '--prompt', '--chdir', '--role', '--type', '--other-user', '--command-timeout', '--close-from'],
  env: ['-u', '--unset', '-C', '--chdir', '-S', '--split-string'],
  nice: ['-n', '--adjustment'],
  timeout: ['-s', '--signal', '-k', '--kill-after'],
  xargs: ['-I', '-L', '-l', '-n', '-P', '-s', '-d', '-E', '-e', '-a', '--arg-file', '--delimiter', '--max-args', '--max-procs', '--max-lines', '--max-chars', '--eof', '--replace', '--process-slot-var'],
  caffeinate: ['-t', '-w'], stdbuf: ['-i', '-o', '-e', '--input', '--output', '--error'], arch: ['-arch', '-d', '-e'],
  coproc: [], doas: ['-u', '-C'], setsid: [], unbuffer: [], chronic: [], nocorrect: [], noglob: [], xcrun: ['--sdk', '--toolchain'],
  ionice: ['-c', '-n', '-p', '--class', '--classdata'],
  script: { opts: ['-t', '-T', '-O', '-I', '-B', '-E', '-o', '--timing', '--log-out', '--log-in', '--log-io', '--log-timing', '--echo', '--output-limit'], c: ['-c', '--command'], skip: 1 },
  flock: { opts: ['-w', '--wait', '--timeout', '-E', '--conflict-exit-code'], c: ['-c', '--command'], skip: 1 },
  watch: { opts: ['-n', '--interval', '-q', '--equexit'], line: true },
  ssh: { opts: ['-b', '-c', '-D', '-E', '-e', '-F', '-I', '-i', '-J', '-L', '-l', '-m', '-O', '-o', '-p', '-Q', '-R', '-S', '-W', '-w', '-B'], skip: 1, line: true },
  parallel: { opts: ['-j', '--jobs', '-S', '--sshlogin', '--sshloginfile', '-a', '--arg-file', '-d', '--delimiter', '-I', '--replace', '-n', '--max-args', '-N', '--colsep', '-C', '--tmpdir', '--results', '--timeout', '--delay', '--retries', '--joblog', '-E', '--eof'], par: true },
}
const KEYWORDS = new Set(['then', 'do', 'else', 'elif', 'if', 'while', 'until', '!', '{', '}'])

// words → { words, dir, inner, env }: the program's own words, a directory a wrapper moved to (env -C, sudo -D),
// a line a wrapper runs as a shell line (env -S), and the variables set in front of it (GH_REPO=… gh, env K=V).
function unwrap(words) {
  let i = 0
  let dir = null
  let inner = null
  let viaXargs = false
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
    const spec = Object.hasOwn(WRAP, p) ? WRAP[p] : null
    if (!spec) break
    if (p === 'xargs') viaXargs = true // the stripped program reads its own arguments from stdin
    const opts = Array.isArray(spec) ? spec : spec.opts
    i++
    if (p === 'command' && /^-[a-zA-Z]*[vV]/.test(words[i] ?? '')) return { words: [], dir, inner, env } // a lookup, not a run
    if (p === 'coproc' && /^[A-Za-z_]\w*$/.test(words[i] ?? '') && words[i + 1] === '{') i++ // coproc NAME { … }
    while (i < words.length && words[i].startsWith('-') && words[i] !== '-') {
      const o = words[i]
      if (o === '--') {
        i++
        break
      }
      const [k, v] = o.startsWith('--') && o.includes('=') ? [o.slice(0, o.indexOf('=')), o.slice(o.indexOf('=') + 1)] : [o, undefined]
      const takes = opts.includes(k)
      // A cluster of one-letter flags (env -iC /w, sudo -nu bob): the first letter that takes a value ends it,
      // its value the rest of the word or the next one.
      const at = !takes && /^-[a-zA-Z]/.test(o) && !o.startsWith('--') ? [...o.slice(1)].findIndex((ch) => opts.includes('-' + ch)) + 1 : 0
      const rest = at > 0 ? o.slice(at + 1) : ''
      const val = takes ? (v ?? words[i + 1]) : at > 0 ? rest || words[i + 1] : undefined
      const flag = takes ? k : at > 0 ? '-' + o[at] : o.slice(0, 2)
      if (at > 0 && !rest) i++
      if ((flag === '-C' || flag === '--chdir') && (p === 'env' || p === 'sudo')) dir = val ?? null
      if (flag === '-D' && p === 'sudo') dir = val ?? null
      if ((flag === '-S' || flag === '--split-string') && p === 'env') inner = val ?? null
      if (spec.c?.includes(k)) return { words: [], dir, inner: v ?? words[i + 1] ?? '', env }
      if (/^-[a-zA-Z]{2,}$/.test(o) && spec.c?.some((f) => f.length === 2 && o.endsWith(f[1]))) return { words: [], dir, inner: words[i + 1] ?? '', env } // -qc '…'
      i += takes && v === undefined ? 2 : 1
    }
    if (p === 'timeout' && i < words.length) i++ // the duration
    if (spec.skip) i += spec.skip
    if (spec.c?.includes(words[i])) return { words: [], dir, inner: words[i + 1] ?? '', env } // flock <file> -c '…'
    if (spec.line) return { words: [], dir, inner: words.slice(i).join(' '), env }
    if (spec.par) return { ...parallelRun(words.slice(i)), dir, env, viaXargs }
  }
  return { words: words.slice(i), dir, inner, env, viaXargs }
}

// GNU parallel's command and its `:::` arguments → the shell lines it runs (one per argument; with no command,
// each argument is a line of its own). With no `:::` the command reads its arguments from stdin, as xargs does.
function parallelRun(words) {
  const k = words.findIndex((w) => /^:::+\+?$/.test(w))
  if (k < 0) return { words, inner: null }
  const cmd = words.slice(0, k).join(' ')
  const args = words.slice(k + 1).filter((w) => !/^:::+\+?$/.test(w))
  const lines = args.map((a) => (!cmd ? a : cmd.includes('{}') ? cmd.split('{}').join(a) : cmd + ' ' + a))
  return { words: [], inner: lines.join('\n') }
}

// A shell that runs a line it is handed: `bash -c '…'`, `eval …`, or a heredoc/here-string fed to a shell.
export const SHELLS = ['bash', 'sh', 'zsh', 'dash', 'ksh', 'fish']
function innerLine(words, stdin) {
  const p = base(words[0])
  if (SHELLS.includes(p)) {
    const k = words.findIndex((w, n) => n > 0 && (/^-[a-z]*c[a-z]*$/.test(w) || w === '--command'))
    if (k > 0) return words[k + 1] ?? null
    const long = words.find((w) => w.startsWith('--command='))
    if (long) return long.slice(10)
    if (stdin !== null && !words.slice(1).some((w) => !w.startsWith('-'))) return stdin
    return null
  }
  if (p === 'eval') return words.slice(1).join(' ')
  return null
}

// The simple commands of a line, wrappers stripped and variables set earlier in it expanded:
// [{ words, dir, env, stdin, redirects, piped, viaXargs }] — env being what the command sees set on this line
// (earlier assignments and exports, and its own prefix); redirects the output files it writes (`>`/`>>`/`tee`-like
// are read from the words); piped whether a `|` feeds it; viaXargs whether xargs appends its arguments from stdin.
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
    take(words, c.stdin, (c.redirects ?? []).map((w) => expand(w, vars)), !!c.piped)
  }
  // One simple command's words: wrappers stripped, a line it runs read as commands, `find -exec … ;` segments too.
  function take(words, stdin, redirects = [], piped = false) {
    const u = unwrap(words)
    const env = new Map([...vars, ...u.env])
    const inner = depth < 3 ? (u.inner ?? innerLine(u.words, stdin)) : null
    if (inner !== null && inner !== undefined) out.push(...commands(inner, depth + 1, base(u.words[0]) === 'eval' ? vars : env))
    else if (u.words.length) out.push({ words: u.words, dir: u.dir, env, stdin, redirects, piped, viaXargs: u.viaXargs })
    if (base(u.words[0]) === 'find' && depth < 3) {
      for (let k = 1; k < u.words.length; k++) {
        if (!['-exec', '-execdir', '-ok', '-okdir'].includes(u.words[k])) continue
        const end = u.words.findIndex((x, n) => n > k && (x === ';' || x === '+'))
        const seg = u.words.slice(k + 1, end < 0 ? u.words.length : end)
        if (seg.length) take(seg, null)
        k = end < 0 ? u.words.length : end
      }
    }
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

// A git command that rewrites a branch's history in place: merge and reset --hard/--merge/--keep update the branch
// checked out (curBranch, tracked along the line, or null to read HEAD); rebase <upstream> <branch> rewrites the
// named branch; branch -f/-M writes the branch it names. Returns that branch (or null to read HEAD), or undefined
// when the subcommand is not one of these. guardLine judges a base-branch rewrite below auto.
function localWrite(g, curBranch) {
  const pos = g.args.filter((x) => !x.startsWith('-'))
  const settled = (x) => x && !/[$`]/.test(x)
  if (g.sub === 'merge') return g.args.some((x) => /^--(abort|continue|quit|skip)$/.test(x)) ? undefined : curBranch
  if (g.sub === 'rebase') {
    if (g.args.some((x) => /^--(abort|continue|quit|skip|edit-todo|show-current-patch)$/.test(x))) return undefined
    return pos.length > 1 ? (settled(pos[1]) ? pos[1] : null) : curBranch
  }
  if (g.sub === 'reset' && g.args.some((x) => x === '--hard' || x === '--merge' || x === '--keep')) return curBranch
  if (g.sub === 'branch') {
    // -f/-B force-write pos[0]; -m/-M rename, the new name being the last positional.
    if (g.args.some((x) => x === '--force' || /^-[a-zA-Z]*[fB]/.test(x))) return settled(pos[0]) ? pos[0] : null
    if (g.args.some((x) => x === '--move' || /^-[a-zA-Z]*[mM]/.test(x))) return pos.length ? (settled(pos[pos.length - 1]) ? pos[pos.length - 1] : null) : undefined
  }
  return undefined
}

// The branch a `git checkout`/`switch` on the line leaves checked out (so a later merge/reset here is judged
// against it): its first positional, null when a variable names it, undefined when it moves no branch.
function checkoutTarget(g) {
  if (g.sub !== 'checkout' && g.sub !== 'switch') return undefined
  if (g.args.includes('--')) return undefined // checkout -- <paths>: restores files, no branch change
  const name = g.args.filter((x) => !x.startsWith('-'))[0]
  if (name === undefined) return undefined
  return /[$`]/.test(name) ? null : name
}

// `git update-ref <ref> <value>` / `git symbolic-ref <ref> <target>`: the ref it writes (or deletes), when that is a
// tag, a branch, HEAD or unreadable (--stdin); null for a read or another ref. guardLine judges a branch against
// the repo's bases.
function refWrite(g) {
  if (g.sub !== 'update-ref' && g.sub !== 'symbolic-ref') return null
  if (g.sub === 'update-ref' && g.args.includes('--stdin')) return '--stdin'
  const pos = []
  for (let i = 0; i < g.args.length; i++) {
    if (g.args[i] === '-m') i++
    else if (!g.args[i].startsWith('-')) pos.push(g.args[i])
  }
  const del = g.args.some((x) => x === '-d' || x === '--delete')
  if (!pos.length || (pos.length < 2 && !del)) return null
  const refs = g.sub === 'symbolic-ref' ? pos.slice(0, 2) : [pos[0]]
  return refs.find((r) => /^refs\/(tags|heads)\//.test(r) || r === 'HEAD' || /[$`]/.test(r)) ?? null
}

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

// Interpreters and the flags whose value is code they run. python3.N, pypyN, rubyN and perlN map to their base.
const INTERP = {
  python: ['-c'], python3: ['-c'], python2: ['-c'], pypy: ['-c'], pypy3: ['-c'],
  node: ['-e', '--eval', '-p', '--print'], nodejs: ['-e', '--eval', '-p', '--print'], bun: ['-e', '--eval', '-p', '--print'], deno: ['eval'],
  perl: ['-e', '-E'], ruby: ['-e'], php: ['-r'], lua: ['-e'], Rscript: ['-e'], osascript: ['-e'], expect: ['-c'],
  awk: [], gawk: [], mawk: [], tclsh: [], swift: [],
}
const AWK = new Set(['awk', 'gawk', 'mawk'])
// The interpreter a program name resolves to (python3.12 → python3, pypy3 → python3, ruby3.2 → ruby), or null.
function interpKey(p) {
  if (Object.hasOwn(INTERP, p)) return p
  if (/^python\d+(\.\d+)?$/.test(p) || /^pypy\d*$/.test(p)) return 'python3'
  if (/^ruby\d/.test(p)) return 'ruby'
  if (/^perl\d/.test(p)) return 'perl'
  return null
}
// Code that mentions a tool which can push, merge, tag or release.
export const MENTIONS_TOOL = /(^|[^\w.-])(git|gh|hub|curl|wget)([^\w.-]|$)|api\.github\.com|\/api\/v3\//
// A call that spawns a process: interpreter code can reach git, gh or curl through one however it is spelled.
const SPAWN_CALL = /\bsystem\s*\(|\bsubprocess\b|\bos\.system\b|\bos\.exec|\bos\.popen\b|\bexecSync\b|\bexecFileSync\b|\bspawnSync\b|\bchild_process\b|\bpopen\s*\(|\bProcess\s*\(|Runtime\.getRuntime|\bposix_spawn\b|do shell script/i
// The tool name squeezed out of quotes and concatenation, so `'g'+'it'`, `"g" "it"` and `g\it` still read as git.
const squish = (code) => String(code ?? '').replace(/['"\\+]|\s+/g, '')
// Interpreter code the reader must refuse below auto: it names a tool (even split up) or spawns a process at all,
// since the run can reach git, gh or curl through that call.
function riskyCode(code) {
  const s = String(code ?? '')
  return MENTIONS_TOOL.test(s) || MENTIONS_TOOL.test(squish(s)) || SPAWN_CALL.test(s)
}
// Interpreter code that names the trust root or the repo's own git state: it may write them directly.
const PROTECT_IN_CODE = /\.agentille\/|\.git\/config|\.git\/hooks|\.git\/refs|\.git\/info|packed-refs/
// A script that pushes, merges, tags or releases: per line, git with push/merge/tag/send-pack/update-ref, gh or
// hub with a merge, release, api or alias, curl or wget at GitHub.
export const SCRIPT_RISK = /\bgit\b[^\n]*\b(push|merge|tag|send-pack|update-ref)\b|\b(gh|hub)\b[^\n]*\b(merge|release|api|alias)\b|\b(curl|wget)\b[^\n]*github|api\.github\.com/
// A make target's recipe that does: push, merge, tag or release named in it.
export const MAKE_RISK = /\b(push|merge|tag|release)\b/
// System binaries are programs, not scripts of the run's: never read.
const SYSTEM_BIN = /^\/(usr|bin|sbin|opt|System|Library|nix)\//
const SHELL_VALUE_OPTS = new Set(['-o', '-O', '--rcfile', '--init-file', '-C', '--init-command'])
// Package managers whose `run <script>` the reader reads from package.json; task runners read from their recipe
// file; openers it cannot introspect are refused below auto.
const PKG_FILE = { npm: 'package.json', pnpm: 'package.json', yarn: 'package.json', bun: 'package.json' }
const RUNNER_FILE = { just: 'justfile', task: 'Taskfile.yml', rake: 'Rakefile' }
const OPAQUE_RUNNER = /^(npx|bunx|mise|docker|docker-compose|podman|podman-compose)$/

// A package-manager invocation → { script, what } to read, { deny, what } to refuse, or null when it is not a
// script-running form (install, a builtin, a bare shorthand): those are left alone.
function pkgScript(p, args) {
  const pos = args.filter((x) => !x.startsWith('-'))
  const sub = pos[0]
  if (sub === 'exec' || sub === 'dlx' || sub === 'x') return { deny: true, what: p + ' ' + sub + ' runs a package the guard cannot read' }
  if ((sub === 'run' || sub === 'run-script') && pos[1]) return { script: pos[1], what: p + ' run ' + pos[1] }
  return null
}

// A run of code the reader cannot follow: an interpreter's code string → { kind: 'hidden' } when it reaches a
// tool or spawns a process; a script file, a sourced file, a package script or a make target → { kind: 'file' }
// for guardLine to read; an opener it cannot introspect → { kind: 'hidden' }.
function codeStep(w, here, stdin = null, piped = false) {
  const p = base(w[0])
  const at = (f) => (/[$`]/.test(f) ? null : f.startsWith('~/') ? null : f.startsWith('/') ? joinPath('/', f) : here ? joinPath(here, f) : null)
  const file = (f, what) => ({ kind: 'file', how: 'script', what, path: at(f), dir: here, slug: null })
  const hidden = (what) => ({ kind: 'hidden', what, dir: here, slug: null })
  const protect = (what) => ({ kind: 'protected', what, dir: here, slug: null })
  // Interpreter code → a protected-write deny (it names the trust root or git state), a hidden deny (it reaches
  // a tool or spawns), or null.
  const judgeCode = (code, label) => (PROTECT_IN_CODE.test(String(code ?? '')) ? protect('the trust root or repo git state (named in ' + p + ' ' + label + ')') : riskyCode(code) ? hidden(p + ' ' + label + ' runs code that reaches git, gh or curl') : null)
  const ik = interpKey(p)
  if (ik) {
    const flags = INTERP[ik]
    const k = w.findIndex((x, n) => n > 0 && (flags.includes(x) || flags.some((f) => f.startsWith('-') && f.length === 2 && x.startsWith(f) && x.length > 2 && !x.startsWith('--'))))
    if (k > 0) {
      const code = flags.includes(w[k]) ? w[k + 1] ?? '' : w[k].slice(2)
      return judgeCode(code, flags.includes(w[k]) ? w[k] : w[k].slice(0, 2))
    }
    // awk's program is its first positional (a `-f` file is read instead).
    if (AWK.has(ik)) {
      const fi = w.findIndex((x, n) => n > 0 && (x === '-f' || x.startsWith('--file')))
      if (fi > 0) {
        const f = w[fi].includes('=') ? w[fi].split('=')[1] : w[fi + 1]
        return f ? file(f, p + ' -f ' + f) : null
      }
      const prog = w.slice(1).find((x) => !x.startsWith('-'))
      return prog ? judgeCode(prog, 'program') : null
    }
    // No code flag: the first positional is a script file (a pipe into it is data), else it reads code from stdin.
    const pos = w.slice(1).filter((x) => !x.startsWith('-') || x === '-')
    const f = pos.find((x) => x !== '-')
    if (f && !pos.includes('-')) return /(^|\/)node_modules\//.test(f) ? null : file(f, p + ' ' + f)
    if (stdin != null && !piped) return judgeCode(stdin, 'stdin')
    return hidden(p + ' runs code from stdin that the guard cannot read')
  }
  if (SHELLS.includes(p)) {
    const hasS = w.some((x, n) => n > 0 && !x.startsWith('--') && /^-[a-z]*s/.test(x))
    for (let i = 1; i < w.length; i++) {
      if (SHELL_VALUE_OPTS.has(w[i])) i++
      else if (!w[i].startsWith('-') && !w[i].startsWith('+')) return file(w[i], p + ' ' + w[i])
    }
    return piped || hasS ? hidden(p + ' runs code from stdin that the guard cannot read') : null
  }
  if ((p === 'source' || w[0] === '.') && w[1]) return file(w[1], w[0] + ' ' + w[1])
  if (Object.hasOwn(PKG_FILE, p)) {
    const r = pkgScript(p, w.slice(1))
    if (!r) return null // not a script-running form (install, a builtin): left alone
    if (r.deny) return hidden(r.what)
    return { kind: 'file', how: 'pkg', what: r.what, script: r.script, path: here ? joinPath(here, PKG_FILE[p]) : null, dir: here, slug: null }
  }
  if (Object.hasOwn(RUNNER_FILE, p)) {
    const t = w.slice(1).filter((x) => !x.startsWith('-'))
    return { kind: 'file', how: 'runner', what: p + (t.length ? ' ' + t.join(' ') : ''), path: here ? joinPath(here, RUNNER_FILE[p]) : null, dir: here, slug: null }
  }
  if (p === 'cargo' && w[1] === 'make') return hidden('cargo make runs a task the guard cannot read')
  if (OPAQUE_RUNNER.test(p)) {
    const sub = w.find((x, n) => n > 0 && !x.startsWith('-'))
    if (/^(docker|podman)/.test(p) && !['run', 'exec', 'compose', 'start'].includes(sub ?? '')) return null
    return hidden(p + (sub ? ' ' + sub : '') + ' runs a container or package the guard cannot read')
  }
  if (p === 'make' || p === 'gmake') {
    let dir = here
    let mf = null
    const targets = []
    for (let i = 1; i < w.length; i++) {
      const a = w[i]
      const val = () => (a.length > 2 && !a.startsWith('--') ? a.slice(2) : a.includes('=') ? a.slice(a.indexOf('=') + 1) : w[++i] ?? '')
      if (a === '-C' || a.startsWith('--directory') || /^-C./.test(a)) {
        const d = val()
        dir = /[$`~]/.test(d) ? null : d.startsWith('/') ? joinPath('/', d) : dir && joinPath(dir, d)
      } else if (a === '-f' || a.startsWith('--file') || a.startsWith('--makefile') || /^-f./.test(a)) mf = val()
      else if (['-I', '-o', '-W', '--include-dir', '--old-file', '--what-if'].includes(a)) i++
      else if (!a.startsWith('-') && !ASSIGN.test(a)) targets.push(a)
    }
    const files = mf ? [mf] : ['GNUmakefile', 'makefile', 'Makefile']
    const paths = dir ? files.map((f) => (/[$`]/.test(f) ? null : f.startsWith('/') ? joinPath('/', f) : joinPath(dir, f))) : [null]
    return { kind: 'file', how: 'make', what: 'make' + (targets.length ? ' ' + targets.join(' ') : ''), paths, targets, dir, slug: null }
  }
  if (w[0].includes('/') && !SYSTEM_BIN.test(w[0])) return file(w[0], w[0])
  return null
}

// A line → its integration candidates, each with the dir it runs in (cd, pushd, git -C, env -C followed).
export function commandSteps(line, cwd = null) {
  const out = []
  let here = cwd
  let moved = false // a step before this one switched branches, in any dir
  let edited = false // a step before this one changed a remote or its config: a later push's target is unknown
  let ghEdited = false // … or gh's default repo: a later gh call's target is unknown
  let curBranch = null // the branch a checkout/switch on the line left behind: what a later merge/reset writes
  const aliases = new Map() // shell aliases defined earlier on the line (alias g=git): the program word is expanded
  for (const c of commands(line)) {
    let w = c.words
    let p = base(w[0])
    if (p === 'alias') {
      for (const a of w.slice(1)) { const m = /^([^=]+)=(.*)$/s.exec(a); if (m && m[2]) aliases.set(m[1], m[2]) }
      continue
    }
    if (aliases.has(p)) { w = [...aliases.get(p).split(/\s+/).filter(Boolean), ...w.slice(1)]; p = base(w[0]) }
    if (p === 'cd' || p === 'pushd') {
      here = cdTo(here, w.slice(1))
      continue
    }
    if (p === 'popd') {
      here = null
      continue
    }
    const at = c.dir ? (/[$`~]/.test(c.dir) ? null : c.dir.startsWith('/') ? joinPath('/', c.dir) : here && joinPath(here, c.dir)) : here
    // A write into the trust root or the repo's own git state: redirects (`>`/`>>`) and tee/cp/mv/ln/sed -i/… targets.
    for (const t of [...(c.redirects ?? []), ...writeTargets(w)]) {
      const abs = t.startsWith('/') ? joinPath('/', t) : !/[$`~]/.test(t) && at ? joinPath(at, t) : null
      const lbl = protectedPath(t, abs)
      if (lbl) out.push({ kind: 'protected', what: lbl, dir: at, slug: null })
    }
    // A tool whose subcommand and arguments xargs appends from stdin cannot be read: fail closed below auto.
    if (c.viaXargs && ['git', 'gh', 'hub', 'curl', 'wget'].includes(p)) {
      out.push({ kind: 'hidden', what: p + ' takes its subcommand or arguments from xargs, which the guard cannot read', dir: at, slug: null })
      continue
    }
    if (p === 'gh' || p === 'hub') {
      // A subcommand word built by a substitution or an unresolved expansion cannot be read.
      const sub = w.slice(1).filter((x) => !x.startsWith('-')).slice(0, 2)
      if (sub.some((x) => /[$`]/.test(x))) { out.push({ kind: 'hidden', what: p + ' runs a subcommand the guard cannot read', dir: at, slug: null }); continue }
      // hub is gh's elder: the same release and api steps, `pull-request` for a PR, and git's own commands.
      const k = p === 'hub' && w[1] === 'pull-request' ? { kind: 'pr', what: 'hub pull-request', dir: at, slug: null } : ghStep(w, at, c.env)
      if (k) out.push({ ...k, gh: true, slugUnknown: ghEdited })
      if (w.includes('set-default') && w.includes('repo')) ghEdited = true
      if (w.includes('checkout') && w.includes('pr')) moved = true
    }
    if (p === 'curl' || p === 'wget') {
      const k = httpStep(w, at)
      if (k) out.push(k)
    } else if (p !== 'gh' && p !== 'git' && p !== 'hub') {
      const k = codeStep(w, at, c.stdin, c.piped)
      if (k) out.push(k)
    } else if (p !== 'gh') {
      const g = gitCall(w)
      if (!g) continue
      // A subcommand word built by a substitution or an unresolved expansion cannot be read.
      if (/[$`]/.test(String(g.sub ?? ''))) { out.push({ kind: 'hidden', what: 'git runs a subcommand the guard cannot read', dir: at, slug: null }); continue }
      // GIT_DIR / GIT_WORK_TREE set on the line name the repo as --git-dir does.
      const envDir = c.env?.get('GIT_WORK_TREE') || (c.env?.get('GIT_DIR') ?? '').replace(/\/\.git\/?$/, '') || c.env?.get('GIT_DIR') || null
      const named = g.dir ?? envDir
      const dir = g.unknown || (named && /[$`~]/.test(named)) ? null : named ? (named.startsWith('/') ? joinPath('/', named) : at && joinPath(at, named)) : at
      const keys = [...g.cfg, ...envCfg(c.env)]
      const retarget = keys.some((k) => REMOTE_CFG.test(k))
      if (g.sub === 'tag' && !tagListing(g.args)) out.push({ kind: 'step', what: 'git tag', dir, slug: null })
      // An alias or a hooks-path/push-config key set for one call changes a step past this reader.
      if (keys.some((k) => k.startsWith('alias.'))) out.push({ kind: 'step', what: 'git -c alias.*', dir, slug: null })
      if (keys.some((k) => PROTECT_CFG.test(k) && !k.startsWith('alias.'))) out.push({ kind: 'protected', what: 'a git config key (core.hooksPath, remote push, URL rewriting or receive.*)', dir, slug: null })
      // `git config <key> <value>` setting a protected key (the hooks path, a remote's push, URL rewriting, …).
      if (g.sub === 'config' && gitConfigSets(g.args) && g.args.some((x) => PROTECT_CFG.test(x))) out.push(/^alias\./i.test(g.args.find((x) => PROTECT_CFG.test(x)) ?? '') ? { kind: 'step', what: 'git config alias.*', dir, slug: null } : { kind: 'protected', what: 'a git config key (core.hooksPath, remote push, URL rewriting or receive.*)', dir, slug: null })
      // Plumbing that writes a remote with no `push` in sight.
      if (['send-pack', 'http-push'].includes(g.sub) || (g.sub === 'subtree' && g.args[0] === 'push')) out.push({ kind: 'step', what: 'git ' + g.sub, dir, slug: null })
      const ref = refWrite(g)
      if (ref) out.push({ kind: 'ref', what: 'git ' + g.sub + ' ' + ref, dir, slug: null, ref })
      if (g.sub === 'push') out.push({ kind: 'push', what: 'git push', dir, slug: null, push: { ...parsePush(g.args), headMoved: moved, remoteEdited: edited || retarget } })
      // A merge, reset --hard, rebase or branch -f/-M onto the base branch, judged where it runs.
      const lw = localWrite(g, curBranch)
      if (lw !== undefined) out.push({ kind: 'local', what: 'git ' + g.sub, dir, slug: null, branch: lw })
      if (movesHead(g)) moved = true
      const co = checkoutTarget(g)
      if (co !== undefined) curBranch = co
      if ((g.sub === 'remote' && ['add', 'set-url', 'rename', 'remove', 'rm'].includes(g.args[0])) || (g.sub === 'config' && g.args.some((x) => REMOTE_CFG.test(x)))) edited = true
    }
  }
  return out
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

// The integration mode for a repo, never above the snapshot taken at the typed /agt: a run can lower its own
// ceiling (a repo config, a profile the person edits down) but never raise it, so a later profile read that reads
// higher than the run started with is ignored. The snapshot (S.agtProfile) is set by the typed /agt's turn.
function capMode(profile, repo, caps) {
  const live = integrationOf(profile, repo, caps)
  if (!S.agtProfile) return live
  const snap = integrationOf(S.agtProfile, repo, caps)
  return MODES.indexOf(snap) < MODES.indexOf(live) ? snap : live
}

// The mode for a repo the guard cannot place (a dir or remote a variable names, a target edited earlier on the
// line): the profile's top-level integration, never a name or path match.
const topMode = (profile) => capMode(profile, { url: null, paths: [], names: [], home: S.home }, [])

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
  if (mine) return capMode(profile, { url: local.url, paths: local.dirs, name: local.name, home: S.home }, await repoCaps($, local.dirs))
  return capMode(profile, { url: named, paths: [], name: named ? base(named) : null, home: S.home }, [])
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
    // Not a remote: git tries the name as a path (a repo, a symlink to one, a checkout) before it gives up.
    if (!url) url = (await gitOut($, c.dir, 'rev-parse', '--resolve-git-dir', name)) || (await gitOut($, c.dir, 'rev-parse', '--resolve-git-dir', name + '/.git'))
  }
  // Neither a remote nor a repo by that name: git refuses the push itself, so the dir's own mode stands.
  if (!url || (local.url && sameRepo(normUrl(url), normUrl(local.url)))) return modeFor($, profile, { ...c, slug: null }, cwd, cache)
  const path = remotePath(url, c.dir)
  const paths = path ? [path.replace(/\/\.git$/, '')] : []
  if (path && !local.url && local.dirs.includes(paths[0])) return modeFor($, profile, { ...c, slug: null }, cwd, cache)
  return capMode(profile, { url: path ? null : url, paths, names: [], home: S.home }, [])
}

export async function integrationAllowed($, cwd) {
  return modeFor($, await readProfile($), { dir: cwd, slug: null }, cwd, new Map())
}

// The bases of the repo at `at`: main, master and the remote's default branch.
async function basesOf($, at, remote = 'origin') {
  const bases = new Set(['main', 'master'])
  const head = at ? await gitOut($, at, 'symbolic-ref', '--short', 'refs/remotes/' + remote + '/HEAD') : ''
  if (head) bases.add(head.startsWith(remote + '/') ? head.slice(remote.length + 1) : head.slice(head.indexOf('/') + 1))
  return bases
}

// What a push is judged against: the branch checked out in its dir, where a bare `git push` goes, the bases.
async function pushInfo($, c, cwd, cache) {
  const dir = c.dir
  const at = dir ?? cwd
  const remote = c.push.remote && /^[\w.-]+$/.test(c.push.remote) ? c.push.remote : 'origin'
  const bases = await basesOf($, at, remote)
  const current = dir ? (await gitOut($, dir, 'symbolic-ref', '--short', '-q', 'HEAD')) || null : null
  let pushDst = null
  let refspecs = []
  let pushDefault = null
  if (at && !c.push.specs.length && !c.push.bulk) {
    // A bare push follows the remote's configured push refspecs, or push.default when none is set.
    refspecs = (await gitOut($, at, 'config', '--get-all', 'remote.' + remote + '.push')).split('\n').filter(Boolean)
    pushDefault = (await gitOut($, at, 'config', 'push.default')) || null
  }
  if (current && !c.push.specs.length) {
    const to = await gitOut($, dir, 'rev-parse', '--abbrev-ref', '@{push}')
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
      const current = c.dir ? (await gitOut($, c.dir, 'symbolic-ref', '--short', '-q', 'HEAD')) || null : null
      const why = judgeRef(c.ref, { current, bases: await basesOf($, c.dir) })
      if (why) return DENY_INTEGRATION + ' Refused: ' + why + '.'
      continue
    }
    if (c.kind === 'local') {
      const current = c.branch ? null : c.dir ? (await gitOut($, c.dir, 'symbolic-ref', '--short', '-q', 'HEAD')) || null : null
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

// Adds what a call made to the session's records and saves them. What an earlier session of the same lead (a
// restart, a resume) saved is read in first, so a save never drops it and a re-attach keeps its fork point.
export async function saveOwned($, made = []) {
  const file = await ownFile($)
  if (file) for (const r of parseOwned(await $.fs.read(file).catch(() => ''))) if (!S.worktrees.some((m) => m.path === r.path)) S.worktrees.push(r)
  recordTrees(S.worktrees, made)
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
  const script = WT_SCRIPT.test(line)
  if (!script && !/\bworktree\s+add\b/.test(line)) return next(e)
  const before = cwd ? await listTrees($, cwd) : null
  const res = await next(e)
  if (res?.deny) return res
  const after = before ? await listTrees($, cwd) : null
  const at = Date.now()
  const run = runOf(e)
  const had = new Set((before ?? []).map((t) => t.path))
  // A tree that was already there (a re-attach) has no fork point to read from the call: recordTrees keeps the
  // first record's, else none.
  const rec = (t, src) => ({ path: t.path, branch: t.branch, head: had.has(t.path) ? null : t.head ?? null, run, at, src })
  let made = after ? newTrees(before, after, line).map((t) => rec(t, 'add')) : []
  if (script && after) for (const t of claimedTrees(scriptTrees(res?.result), after, scriptSlugs(line))) made = [...made.filter((m) => m.path !== t.path), rec(t, 'script')]
  // git could not be read around the call: the literal command is all there is.
  if (!after && cwd) made = worktreeAdds(line, cwd).filter((w) => w.path && w.branch).map((w) => ({ path: w.path, branch: w.branch, head: null, run, at, src: 'add' }))
  if (made.length) await saveOwned($, made)
  return res
}

// The profile the run started with: read at the typed /agt so a later read cannot raise the mode mid-run (capMode).
export async function loadRunProfile($) {
  S.agtProfile = await readProfile($)
}

// A non-Bash write (Write, Edit, MultiEdit, NotebookEdit) to the trust root or the repo's own git state, refused
// below auto exactly as a Bash write is. Returns the deny reason, or null to let it through.
async function editDeny($, e) {
  const path = e.file_path ?? e.notebook_path ?? e.path ?? null
  if (!path || !fromRun(e, await moment($))) return null
  const cwd = await $.session.cwd().catch(() => null)
  const abs = path.startsWith('/') ? joinPath('/', path) : !/[$`~]/.test(path) && cwd ? joinPath(cwd, path) : null
  const lbl = protectedPath(path, abs)
  if (!lbl) return null
  const mode = await integrationAllowed($, cwd).catch(() => 'pr')
  return mode === 'auto' ? null : denyProtected(lbl)
}

// The Write hook: refuse a protected write; else let it through, then observe a run's report write for the band.
export async function writeCall($, e, next) {
  const deny = await editDeny($, e).catch(() => null)
  if (deny) return { deny }
  const r = await next(e)
  if (!e.agentId && reportRun(e.file_path)) await completeReport($, e.file_path).catch(() => {})
  return r
}

// The Edit / MultiEdit / NotebookEdit hook: refuse a protected write, else let it through.
export async function editCall($, e, next) {
  const deny = await editDeny($, e).catch(() => null)
  return deny ? { deny } : next(e)
}
