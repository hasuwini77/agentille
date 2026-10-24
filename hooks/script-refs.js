// agentille: what a command runs without naming it as a path, shared by folder trust (trust.js) and the guard
// (guard-lex.js, guard-policy.js). The names a package manager runs for a script, the files a `python -m` import
// runs, and the relative files a JavaScript file imports. A leaf: it imports nothing and reads no file, so each
// caller reads through its own `$.fs` and decides what an unread file means.

// npm's script shorthands: `npm test` runs the `test` script, `npm start` the `start` one.
export const NPM_SCRIPT_ALIASES = { test: 'test', t: 'test', tst: 'test', start: 'start', stop: 'stop', restart: 'restart' }

// Flags that make a package manager read another package.json than the one in its folder: the reader cannot tell
// which, so a command with one is not followed.
export const ELSEWHERE = new Set(['--prefix', '-C', '--dir', '--cwd', '--filter', '-F', '--workspace', '-w', '--workspaces', '-ws', '-r', '--recursive', '--workspace-root', '--global', '-g', '--location'])

// Flags that take a value before the subcommand (`npm --loglevel silent run x`): the value is not the subcommand.
export const VALUE_FLAGS = new Set(['--loglevel', '--registry', '--userconfig', '--globalconfig', '--cache', '--scope', '--tag', '--otp', '--reporter', '--color', '--network-concurrency', '--mutex', '--cache-folder', '--modules-folder', '--config'])

// `run x` runs the scripts `prex`, `x` and `postx`, in that order (npm always; pnpm and yarn when set to).
export const scriptChain = (name) => ['pre' + name, name, 'post' + name]

// The module a `python [flags] -m pkg.mod` runs, or null: inline code (-c) or a script path comes first.
export function pythonModule(args) {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '-m') return args[i + 1] ?? null
    if (/^-m\S/.test(a)) return a.slice(2)
    if (a === '-c' || !a.startsWith('-')) return null
    if (a === '-X' || a === '-W') i++
  }
  return null
}

// A module name python can import: dotted identifiers, nothing else.
export const PLAIN_MODULE = /^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/

// The files `python -m pkg.mod` runs from a folder on its path, relative to it: each parent package's
// __init__.py (`parents`), then the module itself as a file or a package (`own`: pkg/mod.py, pkg/mod/__init__.py,
// pkg/mod/__main__.py).
export function moduleFiles(mod) {
  const parts = String(mod).split('.')
  const parents = []
  for (let k = 1; k < parts.length; k++) parents.push(parts.slice(0, k).join('/') + '/__init__.py')
  const p = parts.join('/')
  return { parents, own: [p + '.py', p + '/__init__.py', p + '/__main__.py'] }
}

// The relative files a JavaScript or TypeScript file loads: `import … from './x'`, `import './x'`,
// `export … from './x'`, `require('./x')` and `import('./x')` with a plain string. Bare package names are not
// files of the repo's and are left out.
export function jsImports(text) {
  const out = new Set()
  const s = String(text ?? '')
  const forms = [
    /\bimport\s+(?:[\w*{}\s,$]+\s+from\s+)?(['"])([^'"\n]+)\1/g,
    /\bexport\s+(?:[\w*{}\s,$]+\s+)?from\s+(['"])([^'"\n]+)\1/g,
    /\b(?:require|import)\s*\(\s*(['"])([^'"\n]+)\1\s*\)/g,
  ]
  for (const re of forms) for (const m of s.matchAll(re)) if (/^\.{1,2}\//.test(m[2])) out.add(m[2])
  return [...out]
}

// The files a relative import specifier may name, in the order node and the bundlers try them.
export function jsCandidates(spec) {
  const s = String(spec).replace(/[?#].*$/, '')
  const exts = ['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts', '.jsx', '.tsx', '.json']
  return [s, ...exts.map((e) => s + e), ...exts.map((e) => s + '/index' + e)]
}

// The modules a Python file imports: [{ level, mod, names }]. `level` counts the leading dots of a relative import
// (0 for an absolute one), `mod` is the dotted name after them ('' for `from . import x`), `names` what a
// `from … import` names (a submodule or an attribute). Parenthesised and backslash-continued lists are read.
export function pyImports(text) {
  const out = []
  const s = String(text ?? '').replace(/\\\r?\n/g, ' ').replace(/\(([^()]*)\)/g, (m, inner) => inner.replace(/\s*\n\s*/g, ' '))
  for (const line of s.split(/\r?\n/)) {
    const code = line.replace(/#.*$/, '')
    const from = /^\s*from\s+(\.*)([\w.]*)\s+import\s+(.+)$/.exec(code)
    if (from) {
      const names = from[3].split(',').map((x) => x.trim().split(/\s+as\s+/)[0].trim()).filter((x) => /^\w+$/.test(x))
      out.push({ level: from[1].length, mod: from[2], names })
      continue
    }
    const imp = /^\s*import\s+(.+)$/.exec(code)
    if (imp) for (const part of imp[1].split(',')) {
      const mod = part.trim().split(/\s+as\s+/)[0].trim()
      if (/^[A-Za-z_][\w.]*$/.test(mod)) out.push({ level: 0, mod, names: [] })
    }
  }
  return out
}
