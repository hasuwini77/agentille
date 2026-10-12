import { describe, expect, mock, test } from 'claude-code/testing'

const PROFILE = '/u/.agentille/profile.json'
const MOVED_FOCUS = 'moved: display.focus in ~/.agentille/profile.json — this command goes away in v4'
const MOVED_HIGHLIGHT = 'moved: display.highlight in ~/.agentille/profile.json — this command goes away in v4'

describe('aliases: in the mod', () => {
  const squadConfig = { squads: [{ name: 'saas', label: 'Micro SaaS', minScore: 2, signals: { deps: ['stripe', 'next-auth'], paths: [] }, adds: ['payments-reviewer'], checklists: {} }] }

  // A fake home: files is the disk (path → text), mkdirs the `mkdir -p` calls, opened the panes ui.open was asked for.
  const boot = async ($: any, on: any, files: Record<string, string>, opts: { mkdirExit?: number; writeFails?: boolean } = {}) => {
    const mkdirs: string[][] = []
    const opened: string[] = []
    on('env.get', async ($: any, e: any) => ({ value: e.name === 'HOME' ? '/u' : undefined }))
    on('session.cwd', async () => ({ value: '/work/repo' }))
    on('session.start', async ($: any, e: any) => ({ cwd: e.cwd }))
    on('command.register', async () => ({ value: undefined }))
    on('tool.register', async ($: any, e: any) => ({ value: { tool: 'mcp__agentille__' + e.name } }))
    on('ui.toast', async () => ({ value: undefined }))
    on('fs.read', async ($: any, e: any) => {
      if (e.path in files) return { value: files[e.path] }
      if (e.path.endsWith('/.claude-plugin/squads.json')) return { value: JSON.stringify(squadConfig) }
      if (e.path === '/work/repo/package.json') return { value: JSON.stringify({ dependencies: { stripe: '1', 'next-auth': '1' } }) }
      return { deny: 'ENOENT' }
    })
    on('fs.write', async ($: any, e: any) => {
      if (opts.writeFails) return { deny: 'read-only' }
      files[e.path] = e.text
      return { value: undefined }
    })
    on('fs.list', async () => ({ value: [] }))
    on('fs.exists', async () => ({ value: false }))
    on('store.get', async () => ({ value: undefined }))
    on('store.set', async () => ({ value: undefined }))
    on('ui.panes', async () => ({ value: [] }))
    on('ui.open', async ($: any, e: any) => { opened.push(e.id); return { value: { isOpen: true } } as never })
    on('ui.render', async () => ({ type: 'engine', ref: 0 }) as never)
    on('process.run', async ($: any, e: any) => {
      if (e.argv?.[0] === 'mkdir') mkdirs.push(e.argv)
      return { value: { exitCode: e.argv?.[0] === 'mkdir' ? (opts.mkdirExit ?? 0) : 1, stdout: '', stderr: '' } }
    })
    on('agent.spawn', async ($: any, e: any) => ({ model: e.model ?? 'opus', agentId: 'a1' }))
    mock.clock(on, { now: 1_000_000 })
    await $.session.start({ cwd: '/work/repo', surface: null, isInteractive: false })
    return { mkdirs, opened }
  }
  const run = async ($: any, command: string, args = '') => (await $.command.run({ command, args, origin: { kind: 'composer' } } as never)).text as string
  const saved = (files: Record<string, string>) => JSON.parse(files[PROFILE])

  test('/agt-routing, /agt-ledger and /agt-squads print their /agt-info view plus one moved line', async ($, on) => {
    await boot($, on, {})
    await $.agent.spawn({ prompt: '[agt run=ab12cd size=large mode=build]\nplan it', subagentType: 'agentille:agentille-planner' })
    for (const view of ['routing', 'ledger', 'squads']) {
      const body = await run($, 'agt-info', view)
      expect(await run($, 'agt-' + view)).toBe(body + '\nmoved: /agt-info ' + view)
    }
  })

  test('the empty routing and ledger views carry the notice too', async ($, on) => {
    await boot($, on, {})
    expect(await run($, 'agt-routing')).toBe('No agentille dispatches this session.\nmoved: /agt-info routing')
    expect(await run($, 'agt-ledger')).toBe('No agents in this run yet.\nmoved: /agt-info ledger')
  })

  test('/agt-focus off writes display.focus, keeps every other key, and says where it moved', async ($, on) => {
    const original = { name: 'x', projects: [{ path: 'p' }], routing: { autoFable: false }, thinkingDepth: 'quick', display: { deck: 'auto' } }
    const files = { [PROFILE]: JSON.stringify(original) }
    await boot($, on, files)
    const text = await run($, 'agt-focus', 'off')
    expect(text.split('\n')[0]).toContain('focus: off')
    expect(text.split('\n').at(-1)).toBe(MOVED_FOCUS)
    expect(saved(files)).toEqual({ ...original, display: { deck: 'auto', focus: false } })
    expect(files[PROFILE]).toBe(JSON.stringify({ ...original, display: { deck: 'auto', focus: false } }, null, 2) + '\n')
    expect(await run($, 'agt-focus', 'on')).toContain('focus: on')
    expect(saved(files).display).toEqual({ deck: 'auto', focus: true })
  })

  test('/agt-highlight on, all and off write display.highlight; with no argument it only reports', async ($, on) => {
    const files = { [PROFILE]: '{"name":"x"}' }
    await boot($, on, files)
    for (const [arg, want] of [['all', 'all'], ['off', 'off'], ['on', 'on']]) {
      const text = await run($, 'agt-highlight', arg)
      expect(text.split('\n').at(-1)).toBe(MOVED_HIGHLIGHT)
      expect(saved(files)).toEqual({ name: 'x', display: { highlight: want } })
    }
    files[PROFILE] = '{"name":"x"}'
    const shown = await run($, 'agt-highlight')
    expect(shown).toContain('Highlight: on')
    expect(shown.split('\n').at(-1)).toBe(MOVED_HIGHLIGHT)
    expect(files[PROFILE]).toBe('{"name":"x"}') // nothing written
  })

  test('with no profile yet the folder and the file are created', async ($, on) => {
    const files: Record<string, string> = {}
    const { mkdirs } = await boot($, on, files)
    await run($, 'agt-focus', 'off')
    expect(mkdirs).toEqual([['mkdir', '-p', '/u/.agentille']])
    expect(files[PROFILE]).toBe('{\n  "display": {\n    "focus": false\n  }\n}\n')
  })

  test('a profile that is not valid JSON is never overwritten', async ($, on) => {
    const files = { [PROFILE]: '{ "name": "x", ' }
    await boot($, on, files)
    expect(await run($, 'agt-focus', 'off')).toBe('focus: ~/.agentille/profile.json is not valid JSON; left untouched')
    expect(files[PROFILE]).toBe('{ "name": "x", ')
    expect(await run($, 'agt-focus')).toContain('focus: on') // the switch did not move
  })

  test('a failed write says so and leaves the switch where it was', async ($, on) => {
    await boot($, on, { [PROFILE]: '{}' }, { writeFails: true })
    expect(await run($, 'agt-highlight', 'off')).toBe('highlight: could not write ~/.agentille/profile.json')
    expect(await run($, 'agt-highlight')).toContain('Highlight: on')
  })

  test('a folder that cannot be created says so and writes nothing', async ($, on) => {
    const files: Record<string, string> = {}
    await boot($, on, files, { mkdirExit: 1 })
    expect(await run($, 'agt-focus', 'off')).toBe('focus: could not create ~/.agentille')
    expect(files).toEqual({})
  })

  test('a bad argument changes nothing and writes nothing', async ($, on) => {
    const files = { [PROFILE]: '{}' }
    await boot($, on, files)
    expect(await run($, 'agt-focus', 'maybe')).toBe('Usage: /agt-focus [on|off]')
    expect(await run($, 'agt-highlight', 'maybe')).toBe('Usage: /agt-highlight [on|all|off]')
    expect(files[PROFILE]).toBe('{}')
  })

  test('/agt-deck auto and off write display.deck; no argument just opens the deck', async ($, on) => {
    const files = { [PROFILE]: '{"name":"x"}' }
    const { opened } = await boot($, on, files)
    expect(await run($, 'agt-deck')).toBe('deck open')
    expect(files[PROFILE]).toBe('{"name":"x"}')
    expect(await run($, 'agt-deck', 'auto')).toBe('deck open · opens on every /agt (/agt-deck off to stop)')
    expect(saved(files)).toEqual({ name: 'x', display: { deck: 'auto' } })
    expect(await run($, 'agt-deck', 'off')).toBe('deck: opens only when you type /agt-deck (display.deck: off)')
    expect(saved(files)).toEqual({ name: 'x', display: { deck: 'off' } })
    expect(opened).toEqual(['agt-deck', 'agt-deck'])
  })

  test('what a toggle wrote shows in /agt-info as coming from the profile', async ($, on) => {
    await boot($, on, {})
    await run($, 'agt-focus', 'off')
    expect(await run($, 'agt-info')).toMatch(/focus\s+false\s+profile/)
  })
})
