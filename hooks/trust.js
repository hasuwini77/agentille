// agentille folder trust: whether an agt/* worktree brings any project config of its own, compared file by file
// with the lead checkout. spawn.js decides which folders are asked (trustable); this module answers whether the
// config they load, run or import is the lead checkout's, following the commands that run files without naming them
// (package-manager scripts, npx, python -m, CLAUDE.md @imports). Reads only through $.fs (read, stat, list).

// Absent in the worktree is fine for these (settings.local.json and CLAUDE.local.md are gitignored, so a fresh
// worktree has none); present, they must be the lead checkout's byte for byte.
const CONFIG_FILES = ['.mcp.json', '.claude/settings.json', '.claude/settings.local.json', 'CLAUDE.local.md']
// These must match both ways: absent on both sides, or the same bytes.
const MEMORY_FILES = ['CLAUDE.md', 'AGENTS.md', '.claude/CLAUDE.md']
const CONFIG_DIRS = ['.claude/agents', '.claude/commands', '.claude/skills', '.claude/hooks']
const TREE_MAX = 500
const REFS_MAX = 64
// How far a script, a quoted command or an @import chain is followed. Claude Code loads @imports 5 hops deep, so an
// import past that is never read; a script chain past it cannot be followed and refuses.
const DEPTH_MAX = 5

// A file's text, ABSENT when there is none, UNREADABLE when it is there but cannot be read. Existence is asked of
// stat, the call that answers for files and folders alike.
const ABSENT = Symbol('absent')
const UNREADABLE = Symbol('unreadable')
async function missing($, path) {
  return $.fs.stat(path).then(() => false, () => true)
}
async function configFile($, path) {
  const text = await $.fs.read(path).catch(() => null)
  if (typeof text === 'string') return text
  return (await missing($, path)) ? ABSENT : UNREADABLE
}

// Every file under `dir` as relative path → text (empty for no dir), or null when any part cannot be read or the
// tree is too big to compare.
async function configTree($, dir) {
  const out = new Map()
  const walk = async (rel) => {
    const entries = await $.fs.list(rel ? dir + '/' + rel : dir).catch(() => null)
    if (!Array.isArray(entries)) return false
    for (const e of entries) {
      const path = rel ? rel + '/' + e.name : e.name
      if (e.kind === 'dir') {
        if (!(await walk(path))) return false
        continue
      }
      const text = await $.fs.read(dir + '/' + path).catch(() => null)
      if (typeof text !== 'string' || out.size >= TREE_MAX) return false
      out.set(path, text)
    }
    return true
  }
  if (await walk('')) return out
  return (await missing($, dir)) && out.size === 0 ? out : null
}

// The repo-relative files a command line may run: each word that is a path (holds a `/`) or names a script, with
// $CLAUDE_PROJECT_DIR (bare or braced) read as the checkout's root and an absolute path under `top` made relative.
// Other variables, `~` and absolute paths outside the checkout are the same file for both sides, so they are skipped.
// Over-reading is safe: a word that is no file is absent on both sides, and absent on both sides is equal.
const SCRIPT = /\.(?:sh|bash|zsh|fish|js|mjs|cjs|ts|mts|py|rb|pl|php|lua)$/i
export function commandPaths(command, top) {
  const out = []
  for (let w of String(command ?? '').split(/[\s;|&()<>=,]+/)) {
    w = w.replace(/^["'`]+|["'`]+$/g, '')
    const rooted = /^\$\{?CLAUDE_PROJECT_DIR\}?["']?(?=\/|$)/
    if (rooted.test(w)) w = w.replace(rooted, '').replace(/^\/+/, '')
    else if (w.startsWith(top + '/')) w = w.slice(top.length + 1)
    else if (w.startsWith('/')) continue
    if (!w || w.startsWith('-') || w.startsWith('~') || w.includes('$')) continue
    w = w.replace(/^(?:\.\/)+/, '')
    if (w && (w.includes('/') || SCRIPT.test(w))) out.push(w)
  }
  return out
}

// Every command string a settings or hooks.json file runs: hook commands and statusLine.command (any `command` key),
// and the helpers that run a command (apiKeyHelper, awsAuthRefresh, awsCredentialExport, otelHeadersHelper).
const HELPER_KEYS = new Set(['command', 'apiKeyHelper', 'awsAuthRefresh', 'awsCredentialExport', 'otelHeadersHelper'])
function settingsCommands(value, out = []) {
  if (Array.isArray(value)) for (const v of value) settingsCommands(v, out)
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (HELPER_KEYS.has(k) && typeof v === 'string') out.push(v)
      else settingsCommands(v, out)
    }
  }
  return out
}

// Each .mcp.json server as its argv (command, then args) and the folder it starts in (`cwd`, else the root).
function mcpServers(json) {
  const servers = json && typeof json === 'object' ? json.mcpServers : null
  if (!servers || typeof servers !== 'object') return []
  return Object.values(servers)
    .filter((v) => v && typeof v === 'object' && typeof v.command === 'string')
    .map((v) => ({ argv: [v.command, ...(Array.isArray(v.args) ? v.args.filter((x) => typeof x === 'string') : [])], cwd: typeof v.cwd === 'string' ? v.cwd : null }))
}

// The commands a file under .claude/agents, commands, skills or hooks runs: the `command:` lines of its frontmatter
// (a skill's or agent's own hooks), each !`command` a skill or command runs when it loads, and every command of a
// hooks.json. A hooks.json that does not parse is null.
function treeCommands(rel, text) {
  if (rel.split('/').pop() === 'hooks.json') {
    try {
      return settingsCommands(JSON.parse(text))
    } catch {
      return null
    }
  }
  const out = []
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (front) for (const m of front[1].matchAll(/^\s*-?\s*command:\s*(.+?)\s*$/gm)) out.push(m[1].replace(/^(["'])(.*)\1$/, '$2'))
  for (const m of text.matchAll(/!`([^`\n]+)`/g)) out.push(m[1])
  return out
}

async function sameText($, a, b) {
  const [x, y] = await Promise.all([configFile($, a), configFile($, b)])
  return x !== UNREADABLE && y !== UNREADABLE && x === y
}
// A file a command names, or a folder (`--directory tools/mcp`, `cd apps/web`): a folder is compared file by file,
// and one too big to compare refuses.
async function sameEntry($, a, b) {
  const [x, y] = await Promise.all([configFile($, a), configFile($, b)])
  if (x !== UNREADABLE && y !== UNREADABLE) return x === y
  const [sa, sb] = await Promise.all([$.fs.stat(a).catch(() => null), $.fs.stat(b).catch(() => null)])
  if (sa?.kind !== 'dir' || sb?.kind !== 'dir') return false
  const [ta, tb] = await Promise.all([configTree($, a), configTree($, b)])
  if (!ta || !tb || ta.size !== tb.size) return false
  for (const [k, v] of ta) if (tb.get(k) !== v) return false
  return true
}

// ── indirection: what a command runs without naming it as a path ──────────────────────────────────────────────

// A command line as its simple commands, each a list of words with the shell's quotes removed. A separator
// (; & | newline, a subshell's parentheses, a backtick) ends a command; `$(` leaves a stray `$` word behind, which
// names nothing. Not a shell: enough to find the program and its arguments.
export function simpleCommands(line) {
  const out = []
  let cmd = []
  let w = null
  let q = null
  const endWord = () => {
    if (w !== null) cmd.push(w)
    w = null
  }
  const endCmd = () => {
    endWord()
    if (cmd.length) out.push(cmd)
    cmd = []
  }
  const s = String(line ?? '')
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (q) {
      if (c === q) q = null
      else if (c === '\\' && q === '"' && i + 1 < s.length) w += s[++i]
      else w += c
      continue
    }
    if (c === "'" || c === '"') {
      q = c
      w ??= ''
    } else if (c === '\\' && i + 1 < s.length) w = (w ?? '') + s[++i]
    else if (c === ' ' || c === '\t' || c === '\r') endWord()
    else if (';&|\n()`'.includes(c)) endCmd()
    else w = (w ?? '') + c
  }
  endCmd()
  return out
}

// The words from the program on: leading VAR=value assignments, shell keywords and the wrappers that run the rest
// as a command (env, exec, command, nohup, time, nice, xargs) are dropped, with the wrapper's own flags.
const WRAPPERS = new Set(['env', 'exec', 'command', 'builtin', 'nohup', 'time', 'nice', 'xargs', 'if', 'then', 'else', 'elif', 'do', 'while', 'until', '{', '}', '!'])
function fromProgram(words) {
  let i = 0
  while (i < words.length) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i])) i++
    else if (WRAPPERS.has(words[i])) {
      i++
      while (i < words.length && words[i].startsWith('-')) i++
    } else break
  }
  return words.slice(i)
}

// `rel` joined onto the repo-relative folder `base` ('' is the root), normalised; null when it climbs out of the
// checkout or `base` is unknown (null).
function joinRel(base, rel) {
  if (base == null) return null
  const parts = []
  for (const p of (base ? base + '/' + rel : rel).split('/')) {
    if (p === '' || p === '.') continue
    if (p === '..') {
      if (!parts.length) return null
      parts.pop()
    } else parts.push(p)
  }
  return parts.join('/')
}
// The repo-relative folder a `cd` or `--directory` word names, or null when it is not in the checkout or cannot be
// read without running the shell ($HOME, ~, a bare cd).
function dirOf(word, base, top) {
  if (typeof word !== 'string' || !word) return null
  const rooted = /^\$\{?CLAUDE_PROJECT_DIR\}?(?=\/|$)/
  if (rooted.test(word)) return joinRel('', word.replace(rooted, ''))
  if (word === top || word.startsWith(top + '/')) return joinRel('', word.slice(top.length))
  if (word.startsWith('/') || word.startsWith('~') || word.includes('$') || word === '-') return null
  return joinRel(base, word)
}

// Why the folder is not trusted for the person: a command whose files the mod could not find. Kept on `why` for the
// one-time note and counted as a difference.
function unresolved(ctx, what, reason) {
  if (!ctx.why.unresolved) ctx.why.unresolved = []
  ctx.why.unresolved.push(what + ' (' + reason + ')')
  return false
}

function sameAt($, ctx, rel) {
  return sameText($, ctx.top + '/' + rel, ctx.leadTop + '/' + rel)
}
function entryAt($, ctx, rel) {
  return sameEntry($, ctx.top + '/' + rel, ctx.leadTop + '/' + rel)
}

// Both sides' JSON at `rel`: { a, b } (undefined for an absent file), or null when either side is there but does
// not read or parse.
async function bothJson($, ctx, rel) {
  const [x, y] = await Promise.all([configFile($, ctx.top + '/' + rel), configFile($, ctx.leadTop + '/' + rel)])
  const parse = (t) => {
    if (t === ABSENT) return undefined
    if (t === UNREADABLE) throw new Error('unreadable')
    return JSON.parse(t)
  }
  try {
    return { a: parse(x), b: parse(y) }
  } catch {
    return null
  }
}

// Every command of one line, starting in `base`. A `cd` moves the base for the commands after it; a word with a
// space in it (bash -c "npm run x", a quoted argument) is read as a command line of its own.
async function followLine($, ctx, line, base, depth) {
  return followCommands($, ctx, simpleCommands(line), base, depth)
}
async function followCommands($, ctx, cmds, base, depth) {
  if (depth > DEPTH_MAX) return unresolved(ctx, cmds.map((c) => c.join(' ')).join('; ').slice(0, 60), 'runs commands nested deeper than ' + DEPTH_MAX)
  for (const raw of cmds) {
    const words = fromProgram(raw)
    if (!words.length) continue
    for (const w of words.slice(1)) if (/\s/.test(w.trim()) && !(await followLine($, ctx, w, base, depth + 1))) return false
    const name = words[0].split('/').pop()
    if (name === 'cd' || name === 'pushd') {
      base = dirOf(words[1], base, ctx.top)
      continue
    }
    if (!(await followProgram($, ctx, name, words.slice(1), base, depth))) return false
  }
  return true
}

const NPM_SCRIPT_ALIASES = { test: 'test', t: 'test', tst: 'test', start: 'start', stop: 'stop', restart: 'restart' }
const INSTALLS = new Set(['install', 'i', 'ci', 'add', 'isntall', 'in'])
// Flags that read another package.json: the mod cannot tell which, so the command refuses.
const ELSEWHERE = new Set(['--prefix', '-C', '--dir', '--cwd', '--filter', '-F', '--workspace', '-w', '--workspaces', '-ws', '-r', '--recursive', '--workspace-root', '--global', '-g', '--location'])
// Flags that take a value before the subcommand (`npm --loglevel silent run x`): the value is not the subcommand.
const VALUE_FLAGS = new Set(['--loglevel', '--registry', '--userconfig', '--globalconfig', '--cache', '--scope', '--tag', '--otp', '--reporter', '--color', '--network-concurrency', '--mutex', '--cache-folder', '--modules-folder', '--config'])

// One program and its arguments. Package managers, npx-style runners, python -m and uv are followed to the files
// they run; anything else runs only what commandPaths already compared.
async function followProgram($, ctx, name, args, base, depth) {
  if (args.some((a) => ELSEWHERE.has(a.split('=')[0])) && ['npm', 'pnpm', 'yarn', 'bun', 'npx', 'pnpx', 'bunx'].includes(name)) {
    return unresolved(ctx, name + ' ' + args.join(' '), 'it reads another package folder')
  }
  let sub = -1
  for (let i = 0; i < args.length; i++) {
    if (VALUE_FLAGS.has(args[i])) i++
    else if (!args[i].startsWith('-')) {
      sub = i
      break
    }
  }
  const word = sub < 0 ? null : args[sub]
  const rest = sub < 0 ? [] : args.slice(sub + 1)
  const firstArg = (list) => list.find((a) => !a.startsWith('-'))
  if (name === 'npm') {
    if (word === 'run' || word === 'run-script' || word === 'rum' || word === 'urn') return followScript($, ctx, firstArg(rest), base, depth)
    if (word != null && Object.hasOwn(NPM_SCRIPT_ALIASES, word)) return followScript($, ctx, NPM_SCRIPT_ALIASES[word], base, depth)
    if (word === 'exec' || word === 'x') return followPackage($, ctx, runnerPackage(rest), base, depth)
    if (word != null && INSTALLS.has(word)) return followInstall($, ctx, base)
    return true
  }
  if (name === 'pnpm' || name === 'yarn' || name === 'bun') {
    if (word == null) return name === 'yarn' ? followInstall($, ctx, base) : true
    if (word === 'run' || word === 'run-script') {
      const target = firstArg(rest)
      // `bun run file.ts` runs a file, which commandPaths compared.
      if (name === 'bun' && target && (target.includes('/') || SCRIPT.test(target))) return true
      return followScript($, ctx, target, base, depth)
    }
    if (word === 'dlx' || (name === 'bun' && word === 'x')) return followPackage($, ctx, runnerPackage(rest), base, depth)
    if (word === 'exec') return followBin($, ctx, firstArg(rest), base)
    if (INSTALLS.has(word)) return followInstall($, ctx, base)
    if (word === 'workspace' || word === 'workspaces') return unresolved(ctx, name + ' ' + args.join(' '), 'it reads another package folder')
    // `bun file.ts` runs a file, which commandPaths compared.
    if (name === 'bun' && (word.includes('/') || SCRIPT.test(word))) return true
    // pnpm <name>, yarn <name> and bun <name> run that script (else that package's bin, or a builtin). Which words are
    // builtins changes between versions, so the script of that name is compared whatever the word: comparing a script
    // the builtin never runs costs nothing, missing one that runs lets it through.
    if (NPM_SCRIPT_ALIASES[word]) return followScript($, ctx, NPM_SCRIPT_ALIASES[word], base, depth)
    return (await followScript($, ctx, word, base, depth)) && followBin($, ctx, word, base)
  }
  if (name === 'npx' || name === 'pnpx' || name === 'bunx') return followPackage($, ctx, runnerPackage(args), base, depth)
  if (/^python[0-9.]*$/.test(name)) return followPython($, ctx, args, base)
  if (name === 'uv') return followUv($, ctx, args, base, depth)
  return true
}

// The package an npx-style runner fetches: `--package=x` / `-p x` when given, else its first word. `-c "cmd"` runs
// a command line, which is followed by the caller (it has a space) or names a bin.
function runnerPackage(args) {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a.startsWith('--package=')) return a.slice(10)
    if (a === '--package' || a === '-p') return args[i + 1] ?? null
    if (a === '-c' || a === '--call') return args[i + 1] ?? null
    if (!a.startsWith('-')) return a
  }
  return null
}
// `@scope/pkg@1.2` → `@scope/pkg`, `pkg@latest` → `pkg`.
export function packageName(spec) {
  const s = String(spec ?? '')
  const at = s.indexOf('@', s.startsWith('@') ? 1 : 0)
  return at < 0 ? s : s.slice(0, at)
}

// npm/pnpm/yarn/bun `run x`: the scripts `prex`, `x` and `postx` in the package.json at `base` (npm runs all three),
// and what each of them runs, followed in turn: the files it names, the scripts and packages it calls, and the bin
// its program resolves to when that is a local file.
async function followScript($, ctx, script, base, depth) {
  if (!script) return true
  if (script.includes('$')) return unresolved(ctx, 'run ' + script, 'the script name is a variable')
  const rel = joinRel(base, 'package.json')
  if (rel == null) return unresolved(ctx, 'run ' + script, 'its package folder is not known')
  const pkg = await bothJson($, ctx, rel)
  if (!pkg) return unresolved(ctx, 'run ' + script, rel + ' does not parse')
  for (const k of ['pre' + script, script, 'post' + script]) {
    const x = pkg.a?.scripts?.[k]
    const y = pkg.b?.scripts?.[k]
    if (x !== y) return false
    if (typeof x !== 'string') continue
    for (const p of commandPaths(x, ctx.top)) {
      const at = joinRel(base, p)
      if (at == null || !(await entryAt($, ctx, at))) return at == null ? unresolved(ctx, 'run ' + script, p + ' is outside the checkout') : false
    }
    const cmds = simpleCommands(x)
    if (!(await followCommands($, ctx, cmds, base, depth + 1))) return false
    for (const c of cmds) {
      const prog = fromProgram(c)[0]
      if (prog && !prog.includes('/') && !(await followBin($, ctx, prog, base))) return false
    }
  }
  return true
}

// The local file a bare program name resolves to inside a package script: the package's own `bin` entry for it, and
// node_modules/.bin/<name> when the worktree has one (it must then be the lead checkout's).
async function followBin($, ctx, name, base) {
  if (!name || name.includes('/') || name.includes('$')) return true
  const rel = joinRel(base, 'package.json')
  if (rel == null) return unresolved(ctx, name, 'its package folder is not known')
  const pkg = await bothJson($, ctx, rel)
  if (!pkg) return unresolved(ctx, name, rel + ' does not parse')
  const binOf = (p) => (typeof p?.bin === 'string' ? (String(p.name ?? '').split('/').pop() === name ? p.bin : null) : p?.bin && typeof p.bin[name] === 'string' ? p.bin[name] : null)
  const [x, y] = [binOf(pkg.a), binOf(pkg.b)]
  if (x !== y) return false
  if (x) {
    const at = joinRel(base, x)
    if (at == null) return unresolved(ctx, name, 'its bin is outside the checkout')
    if (!(await entryAt($, ctx, at))) return false
  }
  const local = joinRel(base, 'node_modules/.bin/' + name)
  if (await missing($, ctx.top + '/' + local)) return true
  return entryAt($, ctx, local)
}

// An install runs the package's lifecycle scripts and writes what the lockfile says: package.json and the lockfiles
// at `base` must match whole.
async function followInstall($, ctx, base) {
  if (base == null) return unresolved(ctx, 'install', 'its package folder is not known')
  for (const f of ['package.json', ...LOCKFILES]) if (!(await sameAt($, ctx, joinRel(base, f)))) return false
  return true
}

const LOCKFILES = ['package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb']
// The lines a lockfile holds for package `name`, as one string, or null when the file cannot be read for it.
// package-lock.json / npm-shrinkwrap.json: its `packages` entries for node_modules/<name> (nested ones too) and the
// v1 `dependencies` entry. pnpm-lock.yaml and yarn.lock: every block whose key names the package (`name@…`,
// `/name@…`, `/name/…`, `name:`), with the indented lines under it. bun.lock: every line that names it. bun.lockb is
// binary: compared whole.
export function lockEntry(file, text, name) {
  if (file.endsWith('.json')) {
    try {
      const j = JSON.parse(text)
      const pk = j?.packages && typeof j.packages === 'object' ? Object.entries(j.packages).filter(([k]) => k === 'node_modules/' + name || k.endsWith('/node_modules/' + name)) : []
      return JSON.stringify({ packages: pk, dependency: j?.dependencies?.[name] ?? null })
    } catch {
      return null
    }
  }
  if (file === 'bun.lockb') return text
  const lines = String(text).split('\n')
  if (file === 'bun.lock') return lines.filter((l) => l.includes('"' + name + '"') || l.includes('"' + name + '@')).join('\n')
  const keyNames = (line) => line.trim().replace(/:\s*$/, '').split(/,\s*/).map((k) => k.replace(/^["']|["']$/g, '').replace(/^\//, ''))
  const names = (k) => k === name || k.startsWith(name + '@') || k.startsWith(name + '/') || k.startsWith(name + '(')
  const out = []
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (!/:\s*$/.test(l) || !keyNames(l).some(names)) continue
    const indent = l.length - l.trimStart().length
    out.push(l)
    while (i + 1 < lines.length && (lines[i + 1].trim() === '' || lines[i + 1].length - lines[i + 1].trimStart().length > indent)) out.push(lines[++i])
  }
  return out.join('\n')
}

// npx / pnpm dlx / bunx / npm exec <pkg>: a path or file: spec is a local folder, compared whole. A registry package
// is pinned by the lockfile: the lockfiles at `base` and at the root must be the same set on both sides, each holding
// the same entry for the package, and package.json must ask for the same version of it. No lockfile on either side
// means the version is whatever the registry serves on the day: not followed, so the folder is not trusted for you.
async function followPackage($, ctx, spec, base, depth) {
  if (!spec) return true
  if (/\s/.test(spec.trim())) return followLine($, ctx, spec, base, depth + 1)
  if (spec.includes('$')) return unresolved(ctx, 'npx ' + spec, 'the package is a variable')
  if (base == null) return unresolved(ctx, 'npx ' + spec, 'its package folder is not known')
  if (/^(?:\.{1,2}\/|file:|link:)/.test(spec)) {
    const at = joinRel(base, spec.replace(/^(?:file|link):/, ''))
    return at == null ? unresolved(ctx, 'npx ' + spec, 'the package is outside the checkout') : entryAt($, ctx, at)
  }
  const name = packageName(spec)
  if (!name) return true
  const dirs = [...new Set([base, ''])]
  let locks = 0
  for (const d of dirs) {
    for (const f of LOCKFILES) {
      const rel = joinRel(d, f)
      const [x, y] = await Promise.all([configFile($, ctx.top + '/' + rel), configFile($, ctx.leadTop + '/' + rel)])
      if (x === ABSENT && y === ABSENT) continue
      if (typeof x !== 'string' || typeof y !== 'string') return false
      const [ex, ey] = [lockEntry(f, x, name), lockEntry(f, y, name)]
      if (ex == null || ey == null) return unresolved(ctx, 'npx ' + name, rel + ' does not parse')
      if (ex !== ey) return false
      locks++
    }
    const pkg = await bothJson($, ctx, joinRel(d, 'package.json'))
    if (!pkg) return unresolved(ctx, 'npx ' + name, joinRel(d, 'package.json') + ' does not parse')
    const specOf = (p) => ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'].map((k) => p?.[k]?.[name] ?? null).join('\n')
    const [sx, sy] = [specOf(pkg.a), specOf(pkg.b)]
    if (sx !== sy) return false
    for (const s of sx.split('\n')) {
      const m = /^(?:file|link):(.+)$/.exec(s)
      if (!m) continue
      const at = joinRel(d, m[1])
      if (at == null) return unresolved(ctx, 'npx ' + name, 'its dependency is outside the checkout')
      if (!(await entryAt($, ctx, at))) return false
    }
  }
  if (!locks) return unresolved(ctx, 'npx ' + name, 'no lockfile pins it')
  return true
}

// python -m pkg.mod: the files that import runs from the folder it starts in: each parent package's __init__.py,
// then pkg/mod.py, pkg/mod/__init__.py and pkg/mod/__main__.py. Absent on both sides is a module from outside the
// checkout (the standard library, an installed package), the same for both.
async function followPython($, ctx, args, base) {
  let mod = null
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '-m') {
      mod = args[i + 1] ?? null
      break
    }
    if (/^-m\S/.test(a)) {
      mod = a.slice(2)
      break
    }
    if (a === '-c' || !a.startsWith('-')) return true // inline code or a script path, which commandPaths compared
    if (a === '-X' || a === '-W') i++
  }
  if (mod == null) return true
  return followModule($, ctx, mod, base)
}
async function followModule($, ctx, mod, base) {
  if (!/^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/.test(mod)) return unresolved(ctx, 'python -m ' + mod, 'the module name is not plain')
  if (base == null) return unresolved(ctx, 'python -m ' + mod, 'its folder is not known')
  const parts = mod.split('.')
  const files = []
  for (let k = 1; k < parts.length; k++) files.push(parts.slice(0, k).join('/') + '/__init__.py')
  const p = parts.join('/')
  files.push(p + '.py', p + '/__init__.py', p + '/__main__.py')
  for (const f of files) if (!(await sameAt($, ctx, joinRel(base, f)))) return false
  return true
}

// uv run [--directory d] (-m mod | python -m mod | program …): the folder moves with --directory or --project, and
// the program after the flags is followed like any other.
const UV_VALUE_FLAGS = new Set(['--with', '--with-requirements', '--python', '-p', '--env-file', '--extra', '--group', '--package', '--index', '--index-url', '--extra-index-url', '--find-links', '-f', '--script'])
async function followUv($, ctx, args, base, depth) {
  const run = args.indexOf('run')
  if (run < 0) return true
  const rest = args.slice(run + 1)
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]
    if (a === '--directory' || a === '--project') {
      base = dirOf(rest[++i], base, ctx.top)
      continue
    }
    if (/^--(?:directory|project)=/.test(a)) {
      base = dirOf(a.slice(a.indexOf('=') + 1), base, ctx.top)
      continue
    }
    if (a === '-m' || a === '--module') return followModule($, ctx, rest[i + 1] ?? '', base)
    if (UV_VALUE_FLAGS.has(a)) {
      i++
      continue
    }
    if (a.startsWith('-')) continue
    return followCommands($, ctx, [rest.slice(i)], base, depth + 1)
  }
  return true
}

// The @imports of a CLAUDE.md-style file: each `@path` that starts the text or follows a space, outside code blocks
// and code spans, with trailing punctuation dropped.
export function memoryImports(text) {
  const plain = String(text ?? '').replace(/^(```|~~~)[\s\S]*?^\1/gm, '').replace(/`[^`\n]*`/g, '')
  const out = []
  for (const m of plain.matchAll(/(?:^|\s)@([^\s`]+)/g)) {
    const p = m[1].replace(/[.,;:!?)\]}"']+$/, '')
    if (p) out.push(p)
  }
  return out
}

// What a memory file imports, recursively: each imported file, relative to the file that imports it, must be absent
// on both sides or the same. `~/…` and absolute paths outside the checkout are the same file for both sides; a path
// that climbs out of the checkout is not followed and refuses. Past DEPTH_MAX hops Claude Code imports nothing more.
async function followImports($, ctx, rel, depth, seen) {
  if (depth > DEPTH_MAX) return true
  const text = await configFile($, ctx.top + '/' + rel)
  if (typeof text !== 'string') return true
  const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : ''
  for (const ref of memoryImports(text)) {
    if (ref.startsWith('~')) continue
    let target
    if (ref.startsWith('/')) {
      if (!ref.startsWith(ctx.top + '/')) continue
      target = joinRel('', ref.slice(ctx.top.length))
    } else target = joinRel(dir, ref)
    if (target == null) return unresolved(ctx, '@' + ref + ' in ' + rel, 'it is outside the checkout')
    if (seen.has(target)) continue
    seen.add(target)
    if (!(await sameAt($, ctx, target))) return false
    if (!(await followImports($, ctx, target, depth + 1, seen))) return false
  }
  return true
}

// The worktree brings no project config of its own: what it has is the lead checkout's, byte for byte. That is the
// .mcp.json, settings and local files (CONFIG_FILES, absent in the worktree is fine), CLAUDE.md, AGENTS.md and
// .claude/CLAUDE.md (MEMORY_FILES, absent on both sides or the same), .claude/agents, commands, skills and hooks
// (CONFIG_DIRS, every file, nested ones too), every repo file a settings, hooks.json, skill or agent command or an
// .mcp.json server names (commandPaths), and what those commands run without naming it: a package-manager script
// and the bin it calls, an npx/dlx/bunx package's lockfile entry, a python -m module, and the files CLAUDE.md-style
// memory imports with @path. settings.json can stay byte for byte the same while the hook script, npm script or
// module it runs changes. A settings, hooks.json or .mcp.json file that does not parse refuses. A command the mod
// cannot follow to files (an npx package no lockfile pins, a script that reads another package folder) refuses and
// is listed on `why.unresolved`, so the caller can say the folder needs trusting by hand.
export async function sameConfig($, top, leadTop, why = {}) {
  const mine = new Map()
  for (const f of CONFIG_FILES) {
    const text = await configFile($, top + '/' + f)
    if (text === ABSENT) continue
    if (text === UNREADABLE || text !== (await configFile($, leadTop + '/' + f))) return false
    mine.set(f, text)
  }
  for (const f of MEMORY_FILES) if (!(await sameText($, top + '/' + f, leadTop + '/' + f))) return false
  const commands = []
  for (const d of CONFIG_DIRS) {
    const [here, lead] = await Promise.all([configTree($, top + '/' + d), configTree($, leadTop + '/' + d)])
    if (!here || !lead || here.size !== lead.size) return false
    for (const [k, v] of here) {
      if (lead.get(k) !== v) return false
      const run = treeCommands(k, v)
      if (!run) return false
      commands.push(...run)
    }
  }
  let servers = []
  try {
    for (const f of ['.claude/settings.json', '.claude/settings.local.json']) if (mine.has(f)) commands.push(...settingsCommands(JSON.parse(mine.get(f))))
    if (mine.has('.mcp.json')) servers = mcpServers(JSON.parse(mine.get('.mcp.json')))
  } catch {
    return false
  }
  const words = [...commands, ...servers.flatMap((s) => s.argv)]
  const refs = [...new Set(words.flatMap((c) => commandPaths(c, top)))]
  if (refs.length > REFS_MAX) return false
  for (const r of refs) if (!(await sameEntry($, top + '/' + r, leadTop + '/' + r))) return false
  const ctx = { top, leadTop, why }
  for (const c of commands) if (!(await followLine($, ctx, c, '', 0))) return false
  for (const s of servers) if (!(await followCommands($, ctx, [s.argv], s.cwd == null ? '' : dirOf(s.cwd, '', top), 0))) return false
  for (const f of [...MEMORY_FILES, 'CLAUDE.local.md']) if (!(await followImports($, ctx, f, 1, new Set([f])))) return false
  return true
}
