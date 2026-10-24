import { describe, expect, mock, test } from 'claude-code/testing'
import { cacheDirOf, compareVersions, hostMessage, hostTooOld, hostVersionOf, MIN_HOST, newerInstalled, parseVersion, skewMessage } from '../../hooks/skew.js'

describe('skew: versions', () => {
  test('only x.y.z parses, and compares numerically', () => {
    expect(parseVersion('3.6.1')).toEqual([3, 6, 1])
    expect(parseVersion('b78ac49cdc6b')).toBe(null)
    expect(parseVersion('3.6')).toBe(null)
    expect(compareVersions('3.10.0', '3.9.9')).toBeGreaterThan(0)
    expect(compareVersions('3.6.1', '3.6.1')).toBe(0)
    expect(compareVersions('x', '3.6.1')).toBe(null)
  })

  test('the newest installed version beats the running one, else null', () => {
    expect(newerInstalled('3.5.1', ['1.33.0', '3.5.1', '3.6.0', '3.5.9', 'tmp'])).toBe('3.6.0')
    expect(newerInstalled('3.6.0', ['3.5.1', '3.6.0'])).toBe(null)
    expect(newerInstalled('3.6.0', [])).toBe(null)
    expect(newerInstalled('3.6.0', undefined)).toBe(null)
  })

  test('the cache dir is the parent of the running version dir', () => {
    expect(cacheDirOf('/c/plugins/cache/mk/agentille/3.5.1')).toBe('/c/plugins/cache/mk/agentille')
    expect(cacheDirOf('/c/plugins/cache/mk/agentille/3.5.1/')).toBe('/c/plugins/cache/mk/agentille')
    expect(cacheDirOf('')).toBe(null)
  })

  test('the message names both versions', () => {
    expect(skewMessage('3.6.0', '3.5.1')).toBe('agentille v3.6.0 is installed but this session runs v3.5.1 — restart Claude Code before opening panes')
  })
})

describe('skew: in the mod', () => {
  const TMUX = { TMUX: '/tmp/tmux-1/default,1,0', TMUX_PANE: '%1', SHELL: '/bin/zsh', HOME: '/h' }
  // `orphaned` names the sibling folders that hold a .orphaned_at marker; `lookups` is every marker path asked about.
  // `display` is the profile's display block; `host` the Claude Code version $.session.version() reports.
  const boot = async ($: any, on: any, o: { version?: string | null; siblings: string[]; orphaned?: string[]; display?: object; host?: string }) => {
    const toasts: string[] = []
    const seen: string[][] = []
    const lookups: string[] = []
    const tools: string[] = []
    const siblings = o.siblings
    on('env.get', async ($: any, e: any) => ({ value: (TMUX as any)[e.name] }))
    on('session.cwd', async () => ({ value: '/work/repo' }))
    on('session.start', async ($: any, e: any) => ({ cwd: e.cwd }))
    on('command.register', async () => ({ value: undefined }))
    on('tool.register', async ($: any, e: any) => { tools.push(e.name); return { value: { tool: 'mcp__agentille__' + e.name } } })
    if (o.host) on('session.version', async () => ({ value: { version: o.host, base: o.host } }))
    on('ui.toast', async ($: any, e: any) => { toasts.push(e.text); return { value: undefined } })
    on('fs.read', async ($: any, e: any) => {
      if (e.path.endsWith('/.claude-plugin/plugin.json') && o.version !== null) return { value: JSON.stringify({ version: o.version ?? '3.5.1' }) }
      if (o.display && e.path === '/h/.agentille/profile.json') return { value: JSON.stringify({ display: o.display }) }
      return { deny: 'ENOENT' }
    })
    on('fs.list', async () => ({ value: siblings.map((name) => ({ name, kind: 'dir', size: 0, mtimeMs: 0, isLink: false })) }))
    on('fs.exists', async ($: any, e: any) => {
      if (!e.path.endsWith('/.orphaned_at')) return { value: false }
      lookups.push(e.path)
      return { value: (o.orphaned ?? []).some((name) => e.path.endsWith('/' + name + '/.orphaned_at')) }
    })
    on('fs.stat', async ($: any, e: any) => (e.path.startsWith('/work/') ? { value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false } } : { deny: 'ENOENT' }))
    on('store.get', async () => ({ value: undefined }))
    on('ui.panes', async () => ({ value: [] }))
    on('prompt.submit', async ($: any, e: any) => ({ text: e.text }))
    on('process.run', async ($: any, e: any) => {
      seen.push(e.argv)
      return { value: { exitCode: 0, stdout: e.argv[1] === 'split-window' ? '%9\n' : e.argv[1] === 'list-panes' ? ['%1', '', 'claude', '0', '@1'].join('\t') + '\n' : '', stderr: '' } }
    })
    mock.clock(on, { now: 1_000_000 })
    await $.session.start({ cwd: '/work/repo', surface: null, isInteractive: false })
    return { toasts, seen, siblings, lookups, tools }
  }
  const spawn = async ($: any) => {
    await $.prompt.submit({ text: '/agt ship it', origin: { kind: 'composer' } } as never)
    return $.tool.call({ tool: 'mcp__agentille__spawn_pane', run: 'k7f2ab', role: 'exec-1', task: 'build one', agent: 'executor', header: '[agt run=k7f2ab size=small work=build]' })
  }
  const MSG = 'agentille v3.6.0 is installed but this session runs v3.5.1 — restart Claude Code before opening panes'

  test('a newer installed version: one toast at start, and spawn_pane refuses and opens nothing', { timeoutMs: 20_000 }, async ($, on) => {
    const { toasts, seen } = await boot($, on, { siblings: ['3.5.0', '3.5.1', '3.6.0'] })
    expect(toasts.filter((t) => t.includes('v3.6.0 is installed'))).toHaveLength(1)
    expect((await spawn($)).deny).toBe(MSG)
    expect((await spawn($)).deny).toBe(MSG)
    expect(seen.some((a) => a[1] === 'split-window')).toBe(false)
    expect(toasts.filter((t) => t.includes('v3.6.0 is installed'))).toHaveLength(1)
  })

  test('band off: no toast at start, and spawn_pane still refuses with the message', { timeoutMs: 20_000 }, async ($, on) => {
    const { toasts, seen } = await boot($, on, { siblings: ['3.5.1', '3.6.0'], display: { band: 'off' } })
    expect(toasts).toEqual([])
    expect((await spawn($)).deny).toBe(MSG)
    expect(seen.some((a) => a[1] === 'split-window')).toBe(false)
  })

  test('band on (the default spelled out): the start toast is there', async ($, on) => {
    const { toasts } = await boot($, on, { siblings: ['3.5.1', '3.6.0'], display: { band: 'on' } })
    expect(toasts.filter((t) => t.includes('v3.6.0 is installed'))).toHaveLength(1)
  })

  test('band off with an older Claude Code: no toast at start, and still no pane tools', async ($, on) => {
    const { toasts, tools } = await boot($, on, { siblings: ['3.5.1'], display: { band: 'off' }, host: '2.1.200' })
    expect(toasts).toEqual([])
    await $.prompt.submit({ text: '/agt ship it', origin: { kind: 'composer' } } as never)
    expect(tools).toEqual([])
  })

  test('band on with an older Claude Code: one toast at start, and no pane tools', async ($, on) => {
    const { toasts, tools } = await boot($, on, { siblings: ['3.5.1'], host: '2.1.200' })
    expect(toasts.filter((t) => t.includes('Claude Code v2.1.200 is older'))).toHaveLength(1)
    await $.prompt.submit({ text: '/agt ship it', origin: { kind: 'composer' } } as never)
    expect(tools).toEqual([])
  })

  test('an update that lands mid-session is caught at the next spawn_pane', async ($, on) => {
    const { toasts, siblings, seen } = await boot($, on, { siblings: ['3.5.1'] })
    expect((await spawn($)).result).toMatch(/^Opened agt-k7f2ab-exec-1/)
    siblings.push('3.6.0')
    expect((await spawn($)).deny).toBe(MSG)
    expect(toasts.filter((t) => t.includes('v3.6.0 is installed'))).toHaveLength(1)
    expect(seen.filter((a) => a[1] === 'split-window')).toHaveLength(1)
  })

  test('the same version, older ones and non-version dirs: panes open as usual', async ($, on) => {
    const { toasts } = await boot($, on, { siblings: ['3.5.1', '3.4.0', 'tmp', 'b78ac49cdc6b'] })
    expect((await spawn($)).result).toMatch(/^Opened agt-k7f2ab-exec-1/)
    expect(toasts.filter((t) => t.includes('is installed'))).toEqual([])
  })

  test('a newer folder marked .orphaned_at is a replaced version, not an install: panes open', async ($, on) => {
    const { toasts } = await boot($, on, { siblings: ['3.5.1', '3.6.0'], orphaned: ['3.6.0'] })
    expect((await spawn($)).result).toMatch(/^Opened agt-k7f2ab-exec-1/)
    expect(toasts.filter((t) => t.includes('is installed'))).toEqual([])
  })

  test('the newest folder that is not orphaned is the one reported', async ($, on) => {
    const { toasts } = await boot($, on, { siblings: ['3.5.1', '3.6.0', '3.7.0'], orphaned: ['3.7.0'] })
    expect((await spawn($)).deny).toBe(MSG)
    expect(toasts.filter((t) => t.includes('v3.6.0 is installed'))).toHaveLength(1)
  })

  test('the marker is looked up only for newer versions', async ($, on) => {
    const { lookups } = await boot($, on, { siblings: ['3.4.0', '3.5.1', 'tmp', 'b78ac49cdc6b', '3.6.0'] })
    expect(lookups).toHaveLength(1)
    expect(lookups[0].endsWith('/3.6.0/.orphaned_at')).toBe(true)
  })

  test('with nothing newer beside it, no marker is looked up at all', async ($, on) => {
    const { lookups } = await boot($, on, { siblings: ['3.4.0', '3.5.1', 'tmp'] })
    expect(lookups).toEqual([])
  })

  test('no readable plugin.json degrades silently: panes open, no toast', async ($, on) => {
    const { toasts } = await boot($, on, { version: null, siblings: ['9.9.9'] })
    expect((await spawn($)).result).toMatch(/^Opened agt-k7f2ab-exec-1/)
    expect(toasts.filter((t) => t.includes('is installed'))).toEqual([])
  })
})

describe('skew: the host version', () => {
  test('a string or a { version } object parses; anything else is unknown', () => {
    expect(hostVersionOf('2.1.309')).toBe('2.1.309')
    expect(hostVersionOf({ version: '2.1.294', base: '2.1.294' })).toBe('2.1.294')
    expect(hostVersionOf({ base: '2.1.294' })).toBe(null)
    expect(hostVersionOf(null)).toBe(null)
    expect(hostVersionOf('dev')).toBe(null)
  })

  test('older than MIN_HOST is too old; equal, newer and unknown are not', () => {
    expect(MIN_HOST).toMatch(/^\d+\.\d+\.\d+$/)
    expect(hostTooOld('2.1.200')).toBe(true)
    expect(hostTooOld(MIN_HOST)).toBe(false)
    expect(hostTooOld('2.1.309')).toBe(false)
    expect(hostTooOld(null)).toBe(false)
    expect(hostMessage('2.1.200')).toContain('v2.1.200')
    expect(hostMessage('2.1.200')).toContain('v' + MIN_HOST)
    expect(hostMessage('2.1.200')).toContain('pane tools stay off')
  })
})
