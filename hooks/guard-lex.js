// agentille guard — the shell lexer. Reads a Bash line the way the shell would: words, quotes, `$( )`,
// backticks, heredocs/here-strings, wrappers (env, timeout, xargs, sudo, …), `bash -c`/`eval`, and the
// variables set on the line; then turns a line into the simple commands it runs and each command into an
// integration candidate (commandSteps/codeStep). Policy (guard-policy.js) judges those candidates.
import { base, ghStep, httpStep, HTTPIE } from './guard-steps.js'
import { ELSEWHERE, NPM_SCRIPT_ALIASES, VALUE_FLAGS, pythonModule } from './script-refs.js'

export { base }


// The trust root and the repo's own git state: a write to any of these below auto is refused, because a run could
// use it to lift its own ceiling (rewrite ~/.agentille/profile.json), run code (a git hook) or publish (a ref).
// `raw` is the path as the line wrote it (so `~`, `$HOME`, a relative `.git/config` are seen); `abs` its resolved
// form (the guard also passes where a link lands, guard-policy.js resolvedProtected); `homes` the home folder's
// spellings, which the policy passes in (this module reads no session state). Matching ignores case: APFS and NTFS open `.GIT/CONFIG` as `.git/config`. A submodule's own git dir
// (`.git/modules/<name>/…`, nested at any depth) counts as the repo's. Returns a short label for the deny
// message, or null.
export function protectedPath(raw, abs, homes = []) {
  const r = String(raw ?? '')
  const a = String(abs ?? '')
  if (/\$\{?GIT_DIR\}?/.test(r)) return '$GIT_DIR'
  if (/^~\/\.agentille(\/|$)/i.test(r)) return '~/.agentille'
  if (/^(\$HOME|\$\{HOME\})\/\.agentille(\/|$)/i.test(r)) return '~/.agentille'
  // The profile and the run state, however the folder above them is spelled (`$H/.agentille/profile.json`).
  if (/(^|\/)\.agentille\/(profile\.json$|state(\/|$))/i.test(r) || /(^|\/)\.agentille\/(profile\.json$|state(\/|$))/i.test(a)) return '~/.agentille'
  const al = a.toLowerCase()
  for (const h of homes) {
    const t = String(h ?? '').toLowerCase().replace(/\/+$/, '')
    if (t && (al === t + '/.agentille' || al.startsWith(t + '/.agentille/'))) return '~/.agentille'
  }
  // Config in the home folder that runs code or holds a backstop: git's global config and attributes, gh's config
  // (its aliases) and hosts. Read from the spelling (`~/`, `$HOME/`, `$XDG_CONFIG_HOME/`) and the resolved path.
  const homeRel = [r.replace(/^(~|\$HOME|\$\{HOME\})\//i, '').replace(/^(\$XDG_CONFIG_HOME|\$\{XDG_CONFIG_HOME\})\//i, '.config/')]
  if (homeRel[0] === r) homeRel.length = 0
  for (const h of homes) {
    const t = String(h ?? '').toLowerCase().replace(/\/+$/, '')
    if (t && al.startsWith(t + '/')) homeRel.push(a.slice(t.length + 1))
  }
  for (const rel of homeRel) if (HOME_CONFIG.test(rel)) return '~/' + rel
  const git = (s) =>
    /(^|\/)\.git\/config$/i.test(s) ? '.git/config'
    : /(^|\/)\.git\/hooks(\/|$)/i.test(s) ? '.git/hooks'
    : /(^|\/)\.git\/info(\/|$)/i.test(s) ? '.git/info'
    : /(^|\/)\.git\/refs(\/|$)/i.test(s) ? '.git/refs'
    : /(^|\/)\.git\/packed-refs$/i.test(s) ? '.git/packed-refs'
    : MODULE_GIT.test(s) ? 'a submodule\'s .git/modules config, hooks or refs'
    : /(^|\/)\.git\/(config\.worktree|HEAD)$/i.test(s) ? '.git/' + /[^/]+$/.exec(s)[0]
    : /(^|\/)\.git\/worktrees\/[^/]+\/(config\.worktree|HEAD|commondir|gitdir)$/i.test(s) ? 'a linked worktree\'s git state (.git/worktrees)'
    : /(^|\/)\.claude\/settings(\.local)?\.json$/i.test(s) ? 'Claude Code settings (' + /\.claude\/[^/]+$/i.exec(s)[0] + ')'
    : /(^|\/)\.git$/i.test(s) ? 'the worktree .git file'
    : /(^|\/)\.gitattributes$/i.test(s) ? '.gitattributes (it names the filters and diff drivers git runs)'
    : /(^|\/)\.mcp\.json$/i.test(s) ? '.mcp.json (the MCP servers Claude Code starts)'
    : null
  return git(a) ?? git(r)
}

// Files under the home folder (relative to it) that a run may not write below auto: git's and gh's config, the shell
// startup files (every new shell runs them), ssh's config and authorized keys, npm's user config (it can name the
// shell scripts run in), and Claude Code's user config (it holds the person's MCP servers).
const HOME_CONFIG = /^(\.gitconfig|\.config\/git\/(config|attributes)|\.config\/gh\/(config|hosts)\.yml|\.(zshrc|zshenv|zprofile|zlogin|bashrc|bash_profile|bash_login|profile)|\.ssh\/(config|authorized_keys2?)|\.npmrc|\.claude\.json)$/i

// A submodule's git dir under the repo's: its config, hooks and refs (`.git/modules/a/modules/b/config` too).
const MODULE_GIT = /(^|\/)\.git\/modules\/(?:[^/]+\/)+?(config$|hooks(\/|$)|refs(\/|$)|packed-refs$)/i


// git config keys a run may not set below auto: aliases (rename a step past the reader), every key whose value is a
// command git runs on its own (the hooks path, fsmonitor, the ssh command, a clean/smudge filter or merge driver,
// an external diff or textconv, the pager, the editors, a gpg program, a credential helper, a diff or merge tool),
// an include (it pulls in any of these), a remote's push URL or refspec, push.default, URL rewriting, receive.* —
// anything that runs code or changes where or how a push lands.
const PROTECT_CFG = /^(alias\.|core\.(hookspath|fsmonitor|sshcommand|pager|editor|askpass|gitproxy|attributesfile)$|push\.default$|remote\..*\.(push|pushurl|mirror)$|url\..*\.(push)?insteadof$|receive\.|push\.followtags$|filter\.|diff\.external$|diff\..+\.(textconv|command)$|merge\..+\.driver$|pager\.|sequence\.editor$|gpg\.(.+\.)?program$|credential\.(.+\.)?helper$|include\.path$|includeif\..+\.path$|(diff|merge)tool\..+\.cmd$|uploadpack\.packobjectshook$|sendemail\.(.+\.)?(tocmd|cccmd|sendmailcmd)$)/i

// Keys that name a pager or an editor: setting one to a program that runs nothing else (`-c core.pager=cat`,
// `-c core.editor=true`, as a run does to keep git from waiting) is allowed.
const VIEWER_CFG = /^(core\.(pager|editor)|pager\..+|sequence\.editor)$/i
export const SAFE_PROGRAM = /^\s*((\/usr)?\/bin\/)?(true|false|cat|:|less|more)?\s*$/

// Variables that make git run a program, or read a config that can name one.
const GIT_CODE_ENV = /^(GIT_EXTERNAL_DIFF|GIT_SSH|GIT_SSH_COMMAND|GIT_ASKPASS|SSH_ASKPASS|GIT_EDITOR|GIT_SEQUENCE_EDITOR|GIT_PAGER|PAGER|EDITOR|VISUAL|GIT_PROXY_COMMAND|GIT_EXEC_PATH|GIT_TEMPLATE_DIR|GIT_CONFIG|GIT_CONFIG_GLOBAL|GIT_CONFIG_SYSTEM|HOME|XDG_CONFIG_HOME)$/
// …unless the value is harmless: a viewer that runs nothing else, no config at all, or plain ssh with options.
function safeCodeVar(k, v) {
  const s = String(v ?? '')
  if (/^(GIT_EDITOR|GIT_SEQUENCE_EDITOR|GIT_PAGER|PAGER|EDITOR|VISUAL)$/.test(k)) return SAFE_PROGRAM.test(s)
  if (/^(GIT_CONFIG|GIT_CONFIG_GLOBAL|GIT_CONFIG_SYSTEM)$/.test(k)) return s === '/dev/null'
  if (k === 'GIT_SSH_COMMAND') return /^\s*ssh(\s+[-\w.=\/@:,]+)*\s*$/.test(s) && !/command/i.test(s)
  return false
}

// A config key set to a value: refused below auto, unless it is a viewer set to a harmless program.
const protectedCfg = (k, v) => PROTECT_CFG.test(k) && !(VIEWER_CFG.test(k) && v !== undefined && SAFE_PROGRAM.test(v))

const CFG_WHAT = 'a git config key that runs code or moves a push (core.hooksPath, core.fsmonitor, core.sshCommand, a filter, diff or merge driver, the pager or editor, a credential helper, an include, push.default, push.followTags, remote push, remote mirror, URL rewriting or receive.*)'



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
  if (p === 'cp' || p === 'mv' || p === 'install' || p === 'ln' || p === 'link') {
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


// `ln`, `link`, `mv` and a `cp` that links (`-l`, `-s`, `--link`, `--symbolic-link`, in any cluster such as `-al`) → the
// paths they link to or move away (every positional but the destination, or all of them with -t). A hard link made
// by `cp -l` is a second name for the file: a later write to it rewrites the original.
const CP_LINKS = (w) => w === '--link' || w === '--symbolic-link' || (/^-[a-zA-Z]+$/.test(w) && /[ls]/.test(w))
function linkSources(words) {
  const p = base(words[0])
  if (p === 'cp' && !words.slice(1).some(CP_LINKS)) return []
  if (p !== 'ln' && p !== 'mv' && p !== 'cp' && p !== 'link') return []
  const pos = []
  let t = false
  for (let i = 1; i < words.length; i++) {
    const w = words[i]
    if (w === '-t' || w === '--target-directory') { t = true; i++; continue }
    if (/^--target-directory=/.test(w)) { t = true; continue }
    if (['-S', '--suffix'].includes(w)) { i++; continue }
    if (!w.startsWith('-')) pos.push(w)
  }
  return t ? pos : pos.slice(0, -1)
}


// ── the command line ─────────────────────────────────────────────────────────
// How deep `$( )`, backticks and `<( )` are read inside one another, and how deep a line run by `eval`, `bash -c`,
// a wrapper or `find -exec` is read inside another. Past either cap nothing is dropped: the part not read becomes
// an unreadable command, which the policy refuses below auto (docs/guards.md, "Known limits").
export const LEX_DEPTH = 4
export const LINE_DEPTH = 3
const SUB_TOO_DEEP = 'a $( ) or backtick substitution nests deeper than the guard reads'
const LINE_TOO_DEEP = 'a line run by eval, sh -c or a wrapper nests deeper than the guard reads'
const EXEC_TOO_DEEP = 'a find -exec command nests deeper than the guard reads'

// A command the lexer did not read: commands() passes it on and commandSteps turns it into a refusal.
const unreadable = (why) => ({ words: [], stdin: null, redirects: [], piped: false, unreadable: why })

// The index of the `)` that closes a `$(`/`<(` whose text starts at j, read without lexing it: quotes, backslashes,
// backticks and nested parens are skipped. s.length when nothing closes it (the shell refuses such a line).
function closeOf(s, j) {
  let d = 0
  for (let i = j; i < s.length; i++) {
    const c = s[i]
    if (c === '\\') i++
    else if (c === "'") {
      const k = s.indexOf("'", i + 1)
      i = k < 0 ? s.length : k
    } else if (c === '`') {
      let k = i + 1
      while (k < s.length && s[k] !== '`') k += s[k] === '\\' ? 2 : 1
      i = k
    } else if (c === '"') {
      let k = i + 1
      while (k < s.length && s[k] !== '"') {
        if (s[k] === '\\') k += 2
        else if (s[k] === '$' && s[k + 1] === '(') k = closeOf(s, k + 2) + 1
        else k++
      }
      i = k
    } else if (c === '(') d++
    else if (c === ')' && d-- === 0) return i
  }
  return s.length
}

// A shell line → its simple commands in the order they run: { words, stdin }. && || ; | & and newlines
// split; `$( )`, backticks and `<( )` are commands of their own and leave a `$(…)` word behind; a heredoc or
// here-string body becomes the command's stdin (so a PR body is text, never commands); redirections drop.
function lex(s, at = 0, closer = null, depth = 0) {
  const cmds = []
  let cmd = { words: [], bare: [], stdin: null, redirects: [], piped: false }
  let tok = null
  let bare = false // the token holds an unquoted `$name`: the shell splits its value into words
  let target = null // what the next word is: 'drop' (an input redirection's file), 'redir' (an output file), 'stdin', 'heredoc' or 'heredoc-'
  const pending = [] // heredocs whose body starts after the next newline
  let parens = 0 // subshells opened inside a $( ): their ) is not the closer
  const word = () => {
    if (tok === null) return
    if (target === 'stdin') cmd.stdin = tok
    else if (target === 'heredoc' || target === 'heredoc-') pending.push({ cmd, delim: tok, strip: target === 'heredoc-' })
    else if (target === 'redir') cmd.redirects.push(tok)
    else if (target !== 'drop') {
      cmd.words.push(tok)
      cmd.bare.push(bare)
    }
    target = null
    tok = null
    bare = false
  }
  const cut = () => {
    word()
    if (cmd.words.length || cmd.stdin !== null) cmds.push(cmd)
    cmd = { words: [], bare: [], stdin: null, redirects: [], piped: false }
  }
  const nested = (j, close) => {
    // Past LEX_DEPTH the inner text is not read: it becomes an unreadable command (the policy refuses it below
    // auto) and lexing resumes after its closer, so a command after it on the line is still read.
    const r = depth < LEX_DEPTH ? lex(s, j, close, depth + 1) : { cmds: [unreadable(SUB_TOO_DEEP)], end: closeOf(s, j) }
    cmds.push(...r.cmds)
    tok = (tok ?? '') + '$(' + r.cmds.map((c) => c.words.join(' ')).join('; ') + ')'
    return r.end
  }
  const backtick = (j) => {
    let k = j + 1
    while (k < s.length && s[k] !== '`') k += s[k] === '\\' ? 2 : 1
    const inner = s.slice(j + 1, k).replace(/\\`/g, '`')
    const r = depth < LEX_DEPTH ? lex(inner, 0, null, depth + 1) : { cmds: [unreadable(SUB_TOO_DEEP)] }
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
    } else {
      if (c === '$') bare = true
      tok = (tok ?? '') + c
    }
  }
  cut()
  return { cmds, end: i }
}


export const ASSIGN = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s

const expand = (w, vars) => w.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (m, a, b) => vars.get(a ?? b) ?? m)

// A word as the shell hands it on: an unquoted `$name` the line set is expanded and its value split into words
// (`c='git push origin x'; $c` runs git), a quoted one stays one word, and an assignment's value is never split.
function fields(w, vars, bare) {
  const x = expand(w, vars)
  if (!bare || x === w || ASSIGN.test(w) || /[$`]/.test(x)) return [x]
  return x.split(/[ \t\n]+/).filter(Boolean)
}


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
    if (c.unreadable) {
      out.push(unreadCmd(c.unreadable))
      continue
    }
    const words = c.words.flatMap((w, k) => fields(w, vars, !!c.bare?.[k]))
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
    const inner = u.inner ?? innerLine(u.words, stdin)
    if (inner !== null && inner !== undefined && depth >= LINE_DEPTH) out.push(unreadCmd(LINE_TOO_DEEP, u.dir, env))
    else if (inner !== null && inner !== undefined) out.push(...commands(inner, depth + 1, base(u.words[0]) === 'eval' ? vars : env))
    else if (u.words.length) out.push({ words: u.words, dir: u.dir, env, stdin, redirects, piped, viaXargs: u.viaXargs })
    if (base(u.words[0]) === 'find' && depth >= LINE_DEPTH && u.words.some((x) => ['-exec', '-execdir', '-ok', '-okdir'].includes(x))) out.push(unreadCmd(EXEC_TOO_DEEP, u.dir, env))
    else if (base(u.words[0]) === 'find') {
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


// A command commands() could not read (a cap above): no words, and why. commandSteps refuses it.
const unreadCmd = (why, dir = null, env = new Map()) => ({ words: [], dir, env, stdin: null, redirects: [], piped: false, viaXargs: false, unreadable: why })


export function splitCommands(line) {
  return commands(line).map((c) => c.words)
}


// git's own options before the subcommand: -C <dir> is where it runs. `unknown`: a dir it names through a
// variable, which cannot be read here. `cfg`: the config -c / --config-env sets for this one call, as { key, value }.
const GIT_VALUE_OPTS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--config-env', '--super-prefix'])

// git's own commands (its builtins and the commands it ships as scripts). git runs one of these whatever an
// alias of the same name says, so only another word is looked up as an alias.
const GIT_COMMANDS = new Set(('add am annotate apply archive backfill bisect blame branch bugreport bundle cat-file check-attr check-ignore ' +
  'check-mailmap check-ref-format checkout checkout--worker checkout-index cherry cherry-pick clean clone column commit commit-graph ' +
  'commit-tree config count-objects credential credential-cache credential-cache--daemon credential-store describe diagnose diff ' +
  'diff-files diff-index diff-pairs diff-tree difftool fast-export fast-import fetch fetch-pack fmt-merge-msg for-each-ref ' +
  'for-each-repo format-patch fsck fsck-objects fsmonitor--daemon gc get-tar-commit-id grep hash-object help hook index-pack init ' +
  'init-db interpret-trailers log ls-files ls-remote ls-tree mailinfo mailsplit maintenance merge merge-base merge-file merge-index ' +
  'merge-ours merge-recursive merge-recursive-ours merge-recursive-theirs merge-subtree merge-tree mktag mktree multi-pack-index mv ' +
  'name-rev notes pack-objects pack-redundant pack-refs patch-id pickaxe prune prune-packed pull push range-diff read-tree rebase ' +
  'receive-pack reflog refs remote remote-ext remote-fd repack replace replay rerere reset restore rev-list rev-parse revert rm ' +
  'send-pack shortlog show show-branch show-index show-ref sparse-checkout stage stash status stripspace submodule--helper switch ' +
  'symbolic-ref tag unpack-file unpack-objects update-index update-ref update-server-info upload-archive upload-archive--writer ' +
  'upload-pack var verify-commit verify-pack verify-tag version whatchanged worktree write-tree submodule subtree filter-branch ' +
  'mergetool difftool--helper request-pull send-email instaweb quiltimport web--browse http-push http-fetch imap-send daemon shell ' +
  'svn p4 cvsimport cvsexportcommit cvsserver archimport gui citool merge-octopus merge-one-file merge-resolve sh-setup sh-i18n ' +
  'mergetool--lib remote-http remote-https remote-ftp remote-ftps pull-request').split(' '))


export function gitCall(words) {
  if (!['git', 'hub'].includes(base(words[0]))) return null
  let dir = null
  let unknown = false
  const cfg = []
  const loc = [] // the options that place the repo (-C, --git-dir, --work-tree) as argv words: an alias lookup reuses them
  let i = 1
  while (i < words.length && words[i].startsWith('-')) {
    const w = words[i]
    const eq = w.indexOf('=')
    const k = w.startsWith('--') && eq > 0 ? w.slice(0, eq) : w
    if (GIT_VALUE_OPTS.has(k)) {
      const v = k === w ? words[i + 1] ?? '' : w.slice(eq + 1)
      if (k === '-C' || k === '--git-dir' || k === '--work-tree') loc.push(k, v)
      if (k === '-C') dir = dir ? joinPath(dir, v) : v
      if (k === '--work-tree' || k === '--git-dir') dir = k === '--git-dir' ? v.replace(/\/\.git\/?$/, '') || v : v
      if ((k === '-C' || k === '--work-tree' || k === '--git-dir') && /[$`~]/.test(v)) unknown = true
      if (k === '-c') cfg.push({ key: v.split('=')[0].toLowerCase(), value: v.includes('=') ? v.slice(v.indexOf('=') + 1) : 'true' })
      if (k === '--config-env') cfg.push({ key: v.split('=')[0].toLowerCase(), value: undefined }) // read from a variable
      i += k === w ? 2 : 1
    } else i++
  }
  return i < words.length ? { sub: words[i], args: words.slice(i + 1), dir, unknown, cfg, loc } : null
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
  const p = { remote: null, specs: [], force: false, lease: false, leaseRefs: [], del: false, bulk: null, dry: false, mergeOpt: false }
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
      // --force-with-lease (and --force-if-includes, which only sharpens it) checks the remote first: the run may
      // use it on its own agt/* branch. Plain --force may not.
      else if (k === '--force-with-lease') { p.lease = true; if (v) p.leaseRefs.push(v.split(':')[0]) }
      else if (k === '--force-if-includes') p.lease = true
      else if (k.startsWith('--force')) p.force = true
      else if (k === '--delete') p.del = true
      else if (['--all', '--branches', '--mirror', '--tags', '--follow-tags', '--prune'].includes(k)) p.bulk = k
      else if (k === '--dry-run') p.dry = true
      else if (k === '--no-follow-tags') p.noFollow = true
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


// The branches a `git merge` merges in: its positionals, an option's value left out.
function mergeSources(args) {
  const out = []
  for (let i = 0; i < args.length; i++) {
    if (['-m', '-F', '-s', '-X', '--file', '--strategy', '--strategy-option', '--into-name'].includes(args[i])) i++
    else if (!args[i].startsWith('-')) out.push(args[i])
  }
  return out
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

// The variables that decide which config an alias is read from: the repo, the home and XDG folders, the global and
// system config files, and config set for one call. CONFIG_HOME_ENV: those that name a file or folder.
const ALIAS_ENV = /^(GIT_DIR|GIT_WORK_TREE|HOME|XDG_CONFIG_HOME|GIT_CONFIG|GIT_CONFIG_GLOBAL|GIT_CONFIG_SYSTEM|GIT_CONFIG_NOSYSTEM|GIT_CONFIG_PARAMETERS|GIT_CONFIG_COUNT|GIT_CONFIG_(KEY|VALUE)_\d+)$/
const CONFIG_HOME_ENV = /^(HOME|XDG_CONFIG_HOME|GIT_CONFIG|GIT_CONFIG_GLOBAL|GIT_CONFIG_SYSTEM)$/

// GIT_CONFIG_KEY_<n> (with GIT_CONFIG_VALUE_<n>) and GIT_CONFIG_PARAMETERS set config for one call, as -c does:
// [{ key, value }], the value undefined where it cannot be read.
function envCfg(env) {
  const keys = []
  for (const [k, v] of env ?? []) {
    const n = /^GIT_CONFIG_KEY_(\d+)$/.exec(k)
    if (n) keys.push({ key: String(v).toLowerCase(), value: env.get('GIT_CONFIG_VALUE_' + n[1]) })
    if (k === 'GIT_CONFIG_PARAMETERS') for (const m of String(v).matchAll(/'([^'=]+)'?=/g)) keys.push({ key: m[1].toLowerCase(), value: undefined })
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
const PROTECT_IN_CODE = /\.agentille(?![\w-])|\.gitattributes|\.claude\/settings|\.claude\.json|\.mcp\.json|\.(zshrc|zshenv|zprofile|bashrc|bash_profile)\b|[~/]\.profile\b|\.ssh\/(config|authorized_keys)|\.npmrc|\.gitconfig|\.config\/(git|gh)\/|\.git\/HEAD|config\.worktree|\.git\/worktrees\/|\.git\/config|\.git\/hooks|\.git\/refs|\.git\/info|packed-refs|\.git\/modules\/\S*(config|hooks|refs)/i

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
// script-running form (install, a builtin): those are left alone. `npm test`/`npm start` (and pnpm's and yarn's)
// run that script; `pnpm|yarn|bun <name>` runs the script of that name when there is one (`optional`: no such
// script, or no package.json, means a bin or a command the manager refuses itself). `bun run <file>` runs a file.
// A script run pointed at another package folder (--prefix, --filter, -w, -r, …) is refused: the guard cannot
// tell which package.json it reads.
const PM_BUILTINS = new Set(('add remove rm uninstall un install i ci isntall in update up upgrade upgrade-interactive why outdated list ls ' +
  'link ln unlink init create publish pack audit config c get set store exec dlx x import rebuild rb prune info view licenses patch ' +
  'patch-commit patch-remove setup env deploy fetch server root bin cache global help version login logout whoami workspaces ' +
  'workspace dedupe plugin node policies constraints explain npm pm repl completions build test').split(' '))

// Package-folder flags that take a value (npm -w app, pnpm --filter app, --prefix dir).
const PM_FOLDER_VALUE = new Set(['--prefix', '-C', '--dir', '--cwd', '--filter', '-F', '--workspace', '-w', '--location'])
const isScriptWord = (w) => w === 'run' || w === 'run-script' || Object.hasOwn(NPM_SCRIPT_ALIASES, w)

// The package's own lifecycle scripts a manager command runs, in the order npm runs them. A dependency's scripts
// are installed code (not read); `--ignore-scripts` runs none.
const INSTALL_LIFE = ['preinstall', 'install', 'postinstall', 'prepublish', 'preprepare', 'prepare', 'postprepare']
const LIFECYCLE = {
  install: INSTALL_LIFE,
  rebuild: ['preinstall', 'install', 'postinstall', 'prepare'],
  pack: ['prepack', 'prepare', 'postpack'],
  publish: ['prepublishOnly', 'prepack', 'prepare', 'postpack', 'prepublish', 'publish', 'postpublish'],
  version: ['preversion', 'version', 'postversion'],
  'install-test': [...INSTALL_LIFE, 'pretest', 'test', 'posttest'],
}
const LIFE_WORDS = {
  install: 'install', i: 'install', in: 'install', isntall: 'install', add: 'install', ci: 'install', 'clean-install': 'install', ic: 'install', 'install-clean': 'install', 'isntall-clean': 'install',
  rebuild: 'rebuild', rb: 'rebuild', pack: 'pack', publish: 'publish', version: 'version',
  it: 'install-test', 'install-test': 'install-test', cit: 'install-test', 'install-ci-test': 'install-test', 'clean-install-test': 'install-test', sit: 'install-test',
}

// A manager command that runs the package's lifecycle scripts → { lifecycle, what, tags }, or null. `npm version`
// with no new version prints versions and runs nothing; with one it also makes a git tag unless told not to.
function lifecycleOf(p, pos, own) {
  // A global install runs no script of the package here.
  if (own.some((a) => a === '--ignore-scripts' || a === '--ignore-scripts=true' || a === '-g' || a === '--global' || a === '--location=global')) return null
  const sub = pos[0] === undefined && p === 'yarn' ? 'install' : pos[0] === 'pm' && p === 'bun' && pos[1] === 'pack' ? 'pack' : pos[0]
  const life = Object.hasOwn(LIFE_WORDS, sub ?? '') ? LIFE_WORDS[sub] : null
  if (!life || (life === 'version' && (p === 'npm' || p === 'pnpm') && !pos[1])) return null
  const tags = life === 'version' && p === 'npm' && !own.some((a) => a === '--no-git-tag-version' || a === '--git-tag-version=false')
  return { lifecycle: LIFECYCLE[life], what: p + ' ' + (pos[0] ?? 'install') + (life === 'version' && pos[1] ? ' ' + pos[1] : ''), tags }
}

function pkgScript(p, args) {
  // Words after `--` are the script's own arguments (`npm test -- -g adds`), never the manager's flags.
  const dd = args.indexOf('--')
  const own = dd < 0 ? args : args.slice(0, dd)
  // The positionals, a flag's value left out (`npm --loglevel silent run x`, `npm -w app run x`): a word after a
  // package-folder flag may be its value or the subcommand, so both readings are tried below.
  const pos = []
  for (let i = 0; i < own.length; i++) {
    if (VALUE_FLAGS.has(own[i]) || (PM_FOLDER_VALUE.has(own[i]) && /^[^-]/.test(own[i + 1] ?? '') && !isScriptWord(own[i + 1]))) i++
    else if (!own[i].startsWith('-')) pos.push(own[i])
  }
  const sub = pos[0]
  if (sub === 'exec' || sub === 'dlx' || sub === 'x') return { deny: true, what: p + ' ' + sub + ' runs a package the guard cannot read' }
  let r = lifecycleOf(p, pos, own)
  if (r) {
    // read below, like a run of each script
  } else if ((sub === 'run' || sub === 'run-script') && pos[1]) {
    if (p === 'bun' && (pos[1].includes('/') || /\.[cm]?[jt]sx?$/.test(pos[1]))) return { file: pos[1], what: 'bun run ' + pos[1] }
    r = { script: pos[1], what: p + ' run ' + pos[1] }
  } else if (sub !== undefined && p !== 'bun' && Object.hasOwn(NPM_SCRIPT_ALIASES, sub)) r = { script: NPM_SCRIPT_ALIASES[sub], what: p + ' ' + sub, optional: true }
  else if (sub !== undefined && p === 'bun' && (sub.includes('/') || /\.[cm]?[jt]sx?$/.test(sub))) return { file: sub, what: 'bun ' + sub }
  else if (sub !== undefined && p !== 'npm' && !PM_BUILTINS.has(sub)) r = { script: sub, what: p + ' ' + sub, optional: true }
  if (r && own.some((a) => ELSEWHERE.has(a.split('=')[0]))) return { deny: true, what: p + ' ' + own.join(' ') + ' runs a script in another package folder, which the guard cannot place' }
  return r
}


// Tools that publish a release or a package, tag and push on their own: as `npm publish` is, auto only. Bare names a
// package script runs from node_modules/.bin, or a line runs from PATH.
const RELEASE_TOOLS = new Set(['release-it', 'semantic-release', 'np', 'standard-version', 'commit-and-tag-version', 'release-please', 'bumpp', 'auto', 'gh-release', 'publish-please', 'lerna-changelog'])

// The positionals of a tool's argv, the values of the flags in `takes` left out.
const positionals = (args, takes = new Set()) => {
  const out = []
  for (let i = 0; i < args.length; i++) {
    if (takes.has(args[i])) i++
    else if (!args[i].startsWith('-')) out.push(args[i])
  }
  return out
}

// A command that publishes a package or a release, pushes an image or deploys to production: { kind: 'publish' },
// or null. Below auto these are the person's, whatever the repo's integration says about pushes.
export function publishStep(w, dir) {
  const p = base(w[0])
  const args = w.slice(1)
  const has = (...f) => args.some((x) => f.includes(x) || f.some((g) => g.startsWith('--') && x.startsWith(g + '=')))
  const pub = (what) => ({ kind: 'publish', what, dir, slug: null })
  if (Object.hasOwn(PKG_FILE, p)) {
    const pos = positionals(args.slice(0, args.indexOf('--') < 0 ? args.length : args.indexOf('--')), VALUE_FLAGS)
    if (pos[0] === 'publish' || (p === 'yarn' && pos[0] === 'npm' && pos[1] === 'publish')) return pub(p + ' publish')
    if (p === 'npm' && ['unpublish', 'deprecate', 'undeprecate'].includes(pos[0])) return pub('npm ' + pos[0])
    if (p === 'npm' && /^dist-tags?$/.test(pos[0] ?? '') && ['add', 'rm', 'set'].includes(pos[1])) return pub('npm dist-tag ' + pos[1])
    if (p === 'npm' && pos[0] === 'owner' && ['add', 'rm'].includes(pos[1])) return pub('npm owner ' + pos[1])
    return null
  }
  const pos = positionals(args)
  if (RELEASE_TOOLS.has(p)) return pub(p + ' (a release tool: it tags, pushes or publishes)')
  if (p === 'changeset' && ['publish', 'tag'].includes(pos[0])) return pub('changeset ' + pos[0])
  if (p === 'lerna' && ['publish', 'version'].includes(pos[0])) return pub('lerna ' + pos[0])
  if (p === 'cargo' && ['publish', 'yank', 'owner'].includes(pos[0])) return pub('cargo ' + pos[0])
  if (p === 'twine' && pos[0] === 'upload') return pub('twine upload')
  if (/^(python[0-9.]*|pypy3?)$/.test(p) && pythonModule(args) === 'twine' && args.slice(args.indexOf('twine') + 1).includes('upload')) return pub(p + ' -m twine upload')
  if ((p === 'gem' && ['push', 'yank', 'owner'].includes(pos[0])) || (p === 'poetry' && pos[0] === 'publish') || (p === 'flit' && pos[0] === 'publish') || (p === 'uv' && pos[0] === 'publish') || (p === 'hatch' && pos[0] === 'publish')) return pub(p + ' ' + pos[0])
  if (/^(docker|podman)$/.test(p) && (pos[0] === 'push' || (['image', 'manifest'].includes(pos[0]) && pos[1] === 'push') || (pos[0] === 'buildx' && has('--push')) || (pos[0] === 'compose' && pos[1] === 'push'))) return pub(p + ' push')
  if (p === 'vercel' && (has('--prod', '--production') || ['promote', 'rollback'].includes(pos[0]))) return pub('vercel ' + (pos[0] && pos[0] !== 'deploy' ? pos[0] : '--prod'))
  if (p === 'railway' && ['up', 'deploy', 'redeploy'].includes(pos[0])) return pub('railway ' + pos[0])
  if ((p === 'fly' || p === 'flyctl') && ['deploy', 'launch'].includes(pos[0])) return pub(p + ' ' + pos[0])
  if (p === 'netlify' && pos[0] === 'deploy' && has('--prod', '-p', '--prodIfUnlocked')) return pub('netlify deploy --prod')
  if (p === 'wrangler' && ['deploy', 'publish'].includes(pos[0])) return pub('wrangler ' + pos[0])
  if (p === 'firebase' && pos[0] === 'deploy') return pub('firebase deploy')
  return null
}


// A run of code the reader cannot follow: an interpreter's code string → { kind: 'hidden' } when it reaches a
// tool or spawns a process; a script file, a sourced file, a package script or a make target → { kind: 'file' }
// for guardLine to read; an opener it cannot introspect → { kind: 'hidden' }.
function codeStep(w, here, stdin = null, piped = false, env = null) {
  const p = base(w[0])
  const at = (f) => (/[$`]/.test(f) ? null : f.startsWith('~/') ? null : f.startsWith('/') ? joinPath('/', f) : here ? joinPath(here, f) : null)
  // `lang`: how the file is read past its own text (node: its imports; sh: the scripts it runs); null reads the
  // shebang.
  // `rest`: the words passed to the script, which an `exec "$@"` wrapper runs as a command of their own.
  const file = (f, what, lang = null, rest = []) => ({ kind: 'file', how: 'script', what, path: at(f), dir: here, slug: null, lang, rest })
  const hidden = (what) => ({ kind: 'hidden', what, dir: here, slug: null })
  const protect = (what) => ({ kind: 'protected', what, dir: here, slug: null })
  // Interpreter code → a protected-write deny (it names the trust root or git state), a hidden deny (it reaches
  // a tool or spawns), or null.
  const judgeCode = (code, label) => (PROTECT_IN_CODE.test(String(code ?? '')) ? protect('the trust root or repo git state (named in ' + p + ' ' + label + ')') : riskyCode(code) ? hidden(p + ' ' + label + ' runs code that reaches git, gh or curl') : null)
  const ik = interpKey(p)
  // python -m pkg.mod runs a module found on python's path, not a file named on the line.
  const mod = ik && /^(python|pypy)/.test(ik) ? pythonModule(w.slice(1)) : null
  if (mod !== null) return { kind: 'file', how: 'module', what: p + ' -m ' + mod, module: mod, interp: w[0], pyPath: env?.get('PYTHONPATH') ?? null, dir: here, slug: null }
  // bun is a package manager as well as a runtime: `bun run x`, `bun test`, `bun <script>` are its package side.
  const bunFirst = p === 'bun' ? w.slice(1).find((x) => !x.startsWith('-')) : undefined
  const bunPkg = bunFirst !== undefined && !w.slice(1).some((x) => INTERP.bun.includes(x)) && !bunFirst.includes('/') && !/\.[cm]?[jt]sx?$/.test(bunFirst)
  if (ik && !bunPkg) {
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
    // node --test runs the files it is given (files, folders, globs) or, with none, the files node's own patterns
    // find under the folder: guardLine lists and reads each one.
    if ((ik === 'node' || ik === 'nodejs') && w.slice(1).some((x) => x === '--test' || x.startsWith('--test='))) {
      const takes = new Set(['--test-reporter', '--test-reporter-destination', '--test-name-pattern', '--test-skip-pattern', '--test-concurrency', '--test-shard', '--test-timeout', '--import', '--require', '-r', '--loader', '--experimental-loader', '--env-file', '--conditions', '-C'])
      const targets = []
      for (let i = 1; i < w.length; i++) {
        if (takes.has(w[i])) i++
        else if (!w[i].startsWith('-')) targets.push(w[i])
      }
      return { kind: 'file', how: 'tests', what: p + ' --test' + (targets.length ? ' ' + targets.join(' ') : ''), targets, dir: here, slug: null }
    }
    // No code flag: the first positional is a script file (a pipe into it is data), else it reads code from stdin.
    const pos = w.slice(1).filter((x) => !x.startsWith('-') || x === '-')
    const f = pos.find((x) => x !== '-')
    const lang = ['node', 'nodejs', 'bun'].includes(ik) ? 'node' : /^(python|pypy)/.test(ik) ? 'python' : 'other'
    if (f && !pos.includes('-')) return /(^|\/)node_modules\//.test(f) ? null : file(f, p + ' ' + f, lang, w.slice(w.indexOf(f) + 1))
    if (stdin != null && !piped) return judgeCode(stdin, 'stdin')
    return hidden(p + ' runs code from stdin that the guard cannot read')
  }
  if (SHELLS.includes(p)) {
    const hasS = w.some((x, n) => n > 0 && !x.startsWith('--') && /^-[a-z]*s/.test(x))
    for (let i = 1; i < w.length; i++) {
      if (SHELL_VALUE_OPTS.has(w[i])) i++
      else if (!w[i].startsWith('-') && !w[i].startsWith('+')) return file(w[i], p + ' ' + w[i], 'sh', w.slice(i + 1))
    }
    return piped || hasS ? hidden(p + ' runs code from stdin that the guard cannot read') : null
  }
  if ((p === 'source' || w[0] === '.') && w[1]) return file(w[1], w[0] + ' ' + w[1], 'sh', w.slice(2))
  if (Object.hasOwn(PKG_FILE, p)) {
    const r = pkgScript(p, w.slice(1))
    if (!r) return null // not a script-running form (install, a builtin): left alone
    if (r.deny) return hidden(r.what)
    if (r.file) return file(r.file, r.what, 'node')
    if (r.lifecycle) return { kind: 'file', how: 'pkg', what: r.what, lifecycle: r.lifecycle, tags: r.tags, optional: true, path: here ? joinPath(here, PKG_FILE[p]) : null, dir: here, slug: null }
    return { kind: 'file', how: 'pkg', what: r.what, script: r.script, optional: !!r.optional, path: here ? joinPath(here, PKG_FILE[p]) : null, dir: here, slug: null }
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
  if (w[0].includes('/') && !SYSTEM_BIN.test(w[0])) return file(w[0], w[0], null, w.slice(1))
  return null
}


const shQuote = (w) => "'" + String(w).replace(/'/g, "'\\''") + "'"

// The words after an unreadable program that say it may integrate: git's and gh's own.
const INTEGRATION_WORD = /^(push|merge|tag|release|send-pack|http-push|update-ref|symbolic-ref|subtree|api|pr|alias|workflow)$/

// A program word the line itself names through a variable or a substitution, once $HOME (the session's home) is
// read: null when it is no such word, else the word as far as it can be read.
function unreadProgram(w0, homes) {
  const w = String(w0 ?? '')
  if (!/[$`]/.test(w)) return null
  const h = String(homes[0] ?? '').replace(/\/+$/, '')
  const read = h ? w.replace(/^\$\{?HOME\}?(?=\/|$)/, h) : w
  return /[$`]/.test(read) ? read : null
}

// A line → its integration candidates, each with the dir it runs in (cd, pushd, git -C, env -C followed).
// `strict`: an unresolved program word refuses whatever follows it. The Bash line (depth 0) is read strictly; a
// script's text (depth 1 and on) refuses one only with a git or gh word after it, as `exec "$@"` and `"$NODE" x.js`
// are how scripts name their neighbours.
export function commandSteps(line, cwd = null, depth = 0, homes = [], { strict = depth === 0 } = {}) {
  const out = []
  let here = cwd
  let moved = false // a step before this one switched branches, in any dir
  let edited = false // a step before this one changed a remote or its config: a later push's target is unknown
  let ghEdited = false // … or gh's default repo: a later gh call's target is unknown
  let curBranch = null // the branch a checkout/switch on the line left behind: what a later merge/reset writes
  const aliases = new Map() // shell aliases defined earlier on the line (alias g=git): the program word is expanded
  for (const c of commands(line)) {
    // `unread`: a part of the line the guard could not read at all, which a script reader refuses too (guard-policy.js
    // textRisk), unlike an opener it merely does not follow.
    if (c.unreadable) {
      out.push({ kind: 'hidden', what: c.unreadable, dir: here, slug: null, unread: true })
      continue
    }
    let w = c.words
    let p = base(w[0])
    if (p === 'alias') {
      for (const a of w.slice(1)) { const m = /^([^=]+)=(.*)$/s.exec(a); if (m && m[2]) aliases.set(m[1], m[2]) }
      continue
    }
    if (aliases.has(p)) { w = [...aliases.get(p).split(/\s+/).filter(Boolean), ...w.slice(1)]; p = base(w[0]) }
    // A program word built by a substitution or a variable the line does not set (`$c push`, c=$(printf gi)t): which
    // program runs cannot be read. On the Bash line it refuses (`"$EDITOR" f` too); in a script's text, only with an
    // integration word after it, where it may be git or gh. A variable the line sets was expanded already.
    // `$(npm bin)/x` is the package's own local bin folder: read as node_modules/.bin/x.
    if (/^\$\((npm|pnpm|yarn) bin\)\//.test(w[0] ?? '')) {
      w = [String(w[0]).replace(/^\$\((npm|pnpm|yarn) bin\)\//, 'node_modules/.bin/'), ...w.slice(1)]
      p = base(w[0])
    }
    if (/[$`]/.test(w[0] ?? '')) {
      const hidden = unreadProgram(w[0], homes)
      const after = w.slice(1).find((x) => INTEGRATION_WORD.test(x))
      if (hidden !== null && (strict || after)) {
        out.push({ kind: 'hidden', what: 'a program the guard cannot read (' + w[0] + ')' + (after ? ' runs ' + after : ''), dir: here, slug: null, unread: true })
        continue
      }
      if (hidden === null) {
        w = [String(w[0]).replace(/^\$\{?HOME\}?(?=\/|$)/, String(homes[0] ?? '').replace(/\/+$/, '')), ...w.slice(1)]
        p = base(w[0])
      }
    }
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
    // A target that reads clean is still a `write` candidate: guardLine resolves where it lands (a link made on an
    // earlier line, `cfg` → .git/config) and judges that path too.
    for (const t of [...(c.redirects ?? []), ...writeTargets(w)]) {
      const abs = t.startsWith('/') ? joinPath('/', t) : !/[$`~]/.test(t) && at ? joinPath(at, t) : null
      const lbl = protectedPath(t, abs, homes)
      if (lbl) out.push({ kind: 'protected', what: lbl, dir: at, slug: null })
      else if (abs && !/^\/dev(\/|$)/.test(abs) && !/^\d+$/.test(t)) out.push({ kind: 'write', raw: t, path: abs, dir: at, slug: null })
    }
    // A link to (or a move of) the trust root or git state: the link is a second name a later write would land
    // through, the move rewrites it.
    for (const t of linkSources(w)) {
      const abs = t.startsWith('/') ? joinPath('/', t) : !/[$`~]/.test(t) && at ? joinPath(at, t) : null
      const lbl = protectedPath(t, abs, homes)
      if (lbl) out.push({ kind: 'protected', what: lbl + ' (through ' + p + ')', dir: at, slug: null })
    }
    // A tool whose subcommand and arguments xargs appends from stdin cannot be read: fail closed below auto.
    if (c.viaXargs && ['git', 'gh', 'hub', 'curl', 'wget', ...HTTPIE].includes(p)) {
      out.push({ kind: 'hidden', what: p + ' takes its subcommand or arguments from xargs, which the guard cannot read', dir: at, slug: null })
      continue
    }
    if (p === 'gh' || p === 'hub') {
      // A subcommand word built by a substitution or an unresolved expansion cannot be read.
      const sub = w.slice(1).filter((x) => !x.startsWith('-')).slice(0, 2)
      if (sub.some((x) => /[$`]/.test(x))) { out.push({ kind: 'hidden', what: p + ' runs a subcommand the guard cannot read', dir: at, slug: null, unread: true }); continue }
      // hub is gh's elder: the same release and api steps, `pull-request` for a PR, and git's own commands.
      const k0 = p === 'hub' && w[1] === 'pull-request' ? { kind: 'pr', what: 'hub pull-request', dir: at, slug: null } : ghStep(w, at, c.env)
      // hub passes git's own words through to git (judged below); only gh reads aliases from its config.
      const k = k0?.kind === 'ghalias' && p !== 'gh' ? null : k0
      if (k) out.push({ ...k, gh: true, slugUnknown: ghEdited, ...(k.kind === 'ghalias' ? { env: c.env } : {}) })
      if (w.includes('set-default') && w.includes('repo')) ghEdited = true
      if (w.includes('checkout') && w.includes('pr')) moved = true
    }
    if (p === 'curl' || p === 'wget' || HTTPIE.has(p)) {
      const k = httpStep(w, at)
      if (k) out.push(k)
    } else if (p !== 'gh' && p !== 'git' && p !== 'hub') {
      const pub = publishStep(w, at)
      if (pub) out.push(pub)
      const k = codeStep(w, at, c.stdin, c.piped, c.env)
      if (k) out.push(k)
      // `npm version <x>` commits and tags: a tag, as `git tag` is.
      if (k?.tags) out.push({ kind: 'step', what: k.what + ' (it makes a git tag)', dir: at, slug: null })
      // The words passed to a script are read as a command too: a wrapper that runs `exec "$@"` runs them.
      if (k?.rest?.length) {
        if (depth >= LINE_DEPTH) out.push({ kind: 'hidden', what: LINE_TOO_DEEP, dir: at, slug: null, unread: true })
        else for (const x of commandSteps(k.rest.map(shQuote).join(' '), at, depth + 1, homes)) out.push({ ...x, what: x.what + ' (passed to ' + k.what + ')' })
      }
    } else if (p !== 'gh') {
      const g = gitCall(w)
      if (!g) continue
      // A subcommand word built by a substitution or an unresolved expansion cannot be read.
      if (/[$`\s]/.test(String(g.sub ?? ''))) { out.push({ kind: 'hidden', what: 'git runs a subcommand the guard cannot read (' + g.sub + ')', dir: at, slug: null, unread: true }); continue }
      // GIT_DIR / GIT_WORK_TREE set on the line name the repo as --git-dir does.
      const envDir = c.env?.get('GIT_WORK_TREE') || (c.env?.get('GIT_DIR') ?? '').replace(/\/\.git\/?$/, '') || c.env?.get('GIT_DIR') || null
      const named = g.dir ?? envDir
      const dir = g.unknown || (named && /[$`~]/.test(named)) ? null : named ? (named.startsWith('/') ? joinPath('/', named) : at && joinPath(at, named)) : at
      const pairs = [...g.cfg, ...envCfg(c.env)]
      const keys = pairs.map((x) => x.key)
      const retarget = keys.some((k) => REMOTE_CFG.test(k))
      if (g.sub === 'tag' && !tagListing(g.args)) out.push({ kind: 'step', what: 'git tag', dir, slug: null })
      // An alias or a hooks-path/push-config key set for one call changes a step past this reader.
      if (keys.some((k) => k.startsWith('alias.'))) out.push({ kind: 'step', what: 'git -c alias.*', dir, slug: null })
      // A variable on the line that names a program git runs on its own (an external diff, ssh, askpass, the pager or
      // editor, its exec path) or a config file it reads (which can hold any of those): as the config keys are.
      const codeVar = [...(c.env ?? [])].find(([k, v]) => GIT_CODE_ENV.test(k) && !safeCodeVar(k, v))
      if (codeVar) out.push({ kind: 'hidden', what: codeVar[0] + ' on the line names a program or config git runs', dir, slug: null })
      if (pairs.some((x) => protectedCfg(x.key, x.value) && !x.key.startsWith('alias.'))) out.push({ kind: 'protected', what: CFG_WHAT, dir, slug: null })
      // A word that is no git command may be an alias from git config (alias.pom = push origin HEAD:main): guardLine
      // looks it up in the repo the call targets and judges what it expands to.
      if (!GIT_COMMANDS.has(g.sub) && !g.sub.startsWith('-')) {
        // The variables on the line that change which config git reads: the lookup sees them too. One that names a
        // config file or home the lookup cannot place (relative, or through a variable) makes the alias unreadable.
        const genv = {}
        for (const [k, v] of c.env ?? []) if (ALIAS_ENV.test(k)) genv[k] = v
        const unplaced = Object.entries(genv).some(([k, v]) => /[$`~]/.test(v) || (CONFIG_HOME_ENV.test(k) && v !== '' && !v.startsWith('/')))
        out.push({ kind: 'alias', what: 'git ' + g.sub, sub: g.sub, args: g.args, loc: g.loc, at, unknown: g.unknown || unplaced, genv, dir, slug: null, headMoved: moved, remoteEdited: edited || retarget })
        continue
      }
      // git submodule foreach '<line>': the line runs in each submodule, a repo of its own the guard cannot place.
      if (g.sub === 'submodule') {
        const k = g.args.indexOf('foreach')
        if (k >= 0 && g.args.slice(0, k).every((x) => x.startsWith('-'))) {
          const rest = g.args.slice(k + 1)
          while (rest.length && /^(--recursive|-q|--quiet)$/.test(rest[0])) rest.shift()
          if (rest.length && depth < LINE_DEPTH) for (const x of commandSteps(rest.join(' '), null, depth + 1, homes, { strict })) out.push({ ...x, what: x.what + ' (in git submodule foreach)' })
          else if (rest.length) out.push({ kind: 'hidden', what: 'git submodule foreach nests deeper than the guard reads', dir, slug: null })
        }
      }
      // `git config <key> <value>` setting a protected key (the hooks path, a remote's push, URL rewriting, …).
      const set = g.sub === 'config' && gitConfigSets(g.args) ? g.args.findIndex((x, n) => protectedCfg(x, g.args[n + 1])) : -1
      if (set >= 0) out.push(/^alias\./i.test(g.args[set]) ? { kind: 'step', what: 'git config alias.*', dir, slug: null } : { kind: 'protected', what: CFG_WHAT, dir, slug: null })
      // `git remote add --mirror[=push]` sets remote.<name>.mirror: every later bare push of that remote is a mirror push.
      if (g.sub === 'remote' && g.args[0] === 'add' && g.args.some((x) => /^--mirror(=push)?$/.test(x))) out.push({ kind: 'protected', what: CFG_WHAT, dir, slug: null })
      // Plumbing that writes a remote with no `push` in sight.
      if (['send-pack', 'http-push'].includes(g.sub) || (g.sub === 'subtree' && g.args[0] === 'push')) out.push({ kind: 'step', what: 'git ' + g.sub, dir, slug: null })
      const ref = refWrite(g)
      if (ref) out.push({ kind: 'ref', what: 'git ' + g.sub + ' ' + ref, dir, slug: null, ref })
      if (g.sub === 'push') {
        // The variables that decide which config git reads (push.followTags among it), as for an alias.
        const genv = {}
        for (const [k, v] of c.env ?? []) if (ALIAS_ENV.test(k)) genv[k] = v
        out.push({ kind: 'push', what: 'git push', dir, slug: null, genv, push: { ...parsePush(g.args), headMoved: moved, remoteEdited: edited || retarget } })
      }
      // A merge, reset --hard, rebase or branch -f/-M onto the base branch, judged where it runs.
      const lw = localWrite(g, curBranch)
      if (lw !== undefined) out.push({ kind: 'local', what: 'git ' + g.sub, dir, slug: null, branch: lw, ...(g.sub === 'merge' ? { merge: true, from: mergeSources(g.args) } : {}) })
      // `git pull <remote> <branch>` merges that branch into the one checked out: a merge, unless it is its own.
      if (g.sub === 'pull') {
        const pos = g.args.filter((x) => !x.startsWith('-'))
        if (pos.length > 1) out.push({ kind: 'local', what: 'git pull', dir, slug: null, branch: curBranch, merge: true, from: pos.slice(1).map((r) => (pos[0] === 'origin' ? 'origin/' : pos[0] + '/') + r.replace(/^refs\/heads\//, '').replace(/:.*$/, '')) })
      }
      if (movesHead(g)) moved = true
      const co = checkoutTarget(g)
      if (co !== undefined) curBranch = co
      if ((g.sub === 'remote' && ['add', 'set-url', 'rename', 'remove', 'rm'].includes(g.args[0])) || (g.sub === 'config' && g.args.some((x) => REMOTE_CFG.test(x)))) edited = true
    }
  }
  return out
}


// Whether a line moves HEAD in any repo (a checkout, switch, reset, branch -f, gh pr checkout): a push judged after
// it cannot read the branch from before the line ran. guardLine asks it of an alias's expansion.
export function lineMovesHead(line) {
  for (const c of commands(line)) {
    const g = gitCall(c.words)
    if (g && movesHead(g)) return true
    if (base(c.words[0]) === 'gh' && c.words.includes('checkout') && c.words.includes('pr')) return true
  }
  return false
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
