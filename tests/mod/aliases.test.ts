import { describe, expect, mock, test } from 'claude-code/testing'

const PROFILE = '/u/.agentille/profile.json'
const MOVED_FOCUS = 'moved: display.focus in ~/.agentille/profile.json — this command is deprecated; removed in 4.0.0'
const MOVED_HIGHLIGHT = 'moved: display.highlight in ~/.agentille/profile.json — this command is deprecated; removed in 4.0.0'

describe('aliases: in the mod', () => {
  const squadConfig = { squads: [{ name: 'saas', label: 'Micro SaaS', minScore: 2, signals: { deps: ['stripe', 'next-auth'], paths: [] }, adds: ['payments-reviewer'], checklists: {} }] }

  // A fake home: files is the disk (path → text), mkdirs the `mkdir -p` calls, opened the panes ui.open was asked for.
  // opts: mkdirExit = mkdir's exit code · writeFails = every write is refused · noProcess = $.process is absent ·
  // dirExists = ~/.agentille is already there (a write needs it, and only mkdir -p can make it) · unreadable = reads of the profile are refused ·
  // noHome = the host has no HOME · mvFails = mv exits non-zero (a write then goes straight to the file)
  const boot = async ($: any, on: any, files: Record<string, string>, opts: { mkdirExit?: number; writeFails?: boolean; noProcess?: boolean; dirExists?: boolean; unreadable?: boolean; noHome?: boolean; mvFails?: boolean } = {}) => {
    const stored: Record<string, unknown> = {}
    let dirMade = opts.dirExists === true || PROFILE in files
    const mkdirs: string[][] = []
    const opened: string[] = []
    on('env.get', async ($: any, e: any) => ({ value: e.name === 'HOME' && !opts.noHome ? '/u' : undefined }))
    on('session.cwd', async () => ({ value: '/work/repo' }))
    on('session.start', async ($: any, e: any) => ({ cwd: e.cwd }))
    on('command.register', async () => ({ value: undefined }))
    on('tool.register', async ($: any, e: any) => ({ value: { tool: 'mcp__agentille__' + e.name } }))
    on('ui.toast', async () => ({ value: undefined }))
    on('fs.read', async ($: any, e: any) => {
      if (e.path === PROFILE && opts.unreadable) return { deny: 'EACCES' }
      if (e.path in files) return { value: files[e.path] }
      if (e.path.endsWith('/.claude-plugin/squads.json')) return { value: JSON.stringify(squadConfig) }
      if (e.path === '/work/repo/package.json') return { value: JSON.stringify({ dependencies: { stripe: '1', 'next-auth': '1' } }) }
      return { deny: 'ENOENT' }
    })
    on('fs.write', async ($: any, e: any) => {
      if (opts.writeFails || !dirMade) return { deny: 'read-only' }
      files[e.path] = e.text
      return { value: undefined }
    })
    on('fs.list', async () => ({ value: [] }))
    on('fs.exists', async ($: any, e: any) => ({ value: e.path in files || (e.path === PROFILE && opts.unreadable === true) }))
    on('store.get', async ($: any, e: any) => ({ value: stored[e.key] }))
    on('store.set', async ($: any, e: any) => { stored[e.key] = e.value; return { value: undefined } })
    on('ui.panes', async () => ({ value: [] }))
    on('ui.open', async ($: any, e: any) => { opened.push(e.id); return { value: { isOpen: true } } as never })
    on('ui.render', async () => ({ type: 'engine', ref: 0 }) as never)
    on('process.run', async ($: any, e: any) => {
      if (opts.noProcess) return { deny: 'no process here' }
      if (e.argv?.[0] === 'mkdir') {
        mkdirs.push(e.argv)
        if ((opts.mkdirExit ?? 0) === 0) dirMade = true
      }
      if (e.argv?.[0] === 'mv') {
        if (opts.mvFails || !(e.argv[2] in files)) return { value: { exitCode: 1, stdout: '', stderr: '' } }
        files[e.argv[3]] = files[e.argv[2]]
        delete files[e.argv[2]]
        return { value: { exitCode: 0, stdout: '', stderr: '' } }
      }
      return { value: { exitCode: e.argv?.[0] === 'mkdir' ? (opts.mkdirExit ?? 0) : 1, stdout: '', stderr: '' } }
    })
    on('agent.spawn', async ($: any, e: any) => ({ model: e.model ?? 'opus', agentId: 'a1' }))
    mock.clock(on, { now: 1_000_000 })
    await $.session.start({ cwd: '/work/repo', surface: null, isInteractive: false })
    return { mkdirs, opened, stored }
  }
  const run = async ($: any, command: string, args = '') => (await $.command.run({ command, args, origin: { kind: 'composer' } } as never)).text as string
  const saved = (files: Record<string, string>) => JSON.parse(files[PROFILE])

  test('the redirect-only /agt-routing, /agt-ledger and /agt-squads are gone', async ($, on) => {
    await boot($, on, {})
    for (const view of ['routing', 'ledger', 'squads']) {
      await expect(run($, 'agt-' + view)).rejects.toThrow()
      expect(await run($, 'agt-info', view)).toBeTruthy()
    }
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
    expect(mkdirs).toEqual([['mkdir', '-p', '/u/.agentille']]) // made before the write
    expect(files[PROFILE]).toBe('{\n  "display": {\n    "focus": false\n  }\n}\n')
  })

  const NOTE = "saved in this machine's mod store, not in profile.json: "

  test('no HOME: the switch still applies, goes to the mod store as before, and one line says so', async ($, on) => {
    const files: Record<string, string> = {}
    const { stored } = await boot($, on, files, { noHome: true })
    const text = await run($, 'agt-focus', 'off')
    expect(text).toContain('focus: off')
    expect(text.split('\n')).toContain(NOTE + 'no home folder')
    expect(stored['focus:mode']).toBe('off')
    expect(files).toEqual({})
    expect(await run($, 'agt-focus')).toContain('focus: off') // still in effect
    await run($, 'agt-highlight', 'all')
    expect(stored['highlight:on']).toBe(true)
    expect(stored['highlight:all']).toBe(true)
    expect(await run($, 'agt-deck', 'off')).toContain(NOTE + 'no home folder')
    expect(stored['deck:auto']).toBe(false)
  })

  test('a profile that is not valid JSON is never overwritten; the switch goes to the mod store', async ($, on) => {
    const files = { [PROFILE]: '{ "name": "x", ' }
    const { stored } = await boot($, on, files)
    const text = await run($, 'agt-focus', 'off')
    expect(text).toContain(NOTE + '~/.agentille/profile.json is not valid JSON')
    expect(files[PROFILE]).toBe('{ "name": "x", ')
    expect(Object.keys(files)).toEqual([PROFILE]) // no .bak, no .tmp
    expect(stored['focus:mode']).toBe('off')
    expect(text).toContain('focus: off')
  })

  test('a failed write falls back to the mod store and applies the value', async ($, on) => {
    const { stored } = await boot($, on, { [PROFILE]: '{}' }, { writeFails: true })
    const text = await run($, 'agt-highlight', 'off')
    expect(text).toContain(NOTE + 'could not back up ~/.agentille/profile.json')
    expect(text).toContain('Highlight: off')
    expect(stored['highlight:on']).toBe(false)
  })

  test('a read-only profile that already sets the key: the switch is for this session only, and says so', async ($, on) => {
    const { stored } = await boot($, on, { [PROFILE]: JSON.stringify({ display: { highlight: 'all' } }) }, { writeFails: true })
    const text = await run($, 'agt-highlight', 'off')
    expect(text).toContain('applied for this session only')
    expect(text).toContain('display.highlight in profile.json wins next session')
    expect(text).toContain('Highlight: off')
    expect(stored['highlight:on']).toBe(false)
  })

  test('a folder that cannot be created falls back to the mod store and writes no file', async ($, on) => {
    const files: Record<string, string> = {}
    const { stored } = await boot($, on, files, { mkdirExit: 1 })
    const text = await run($, 'agt-focus', 'off')
    expect(text).toContain(NOTE + 'could not create ~/.agentille')
    expect(files).toEqual({})
    expect(stored['focus:mode']).toBe('off')
  })

  test('a host without $.process saves directly once ~/.agentille exists, and never runs mkdir', async ($, on) => {
    const files: Record<string, string> = {}
    const { mkdirs } = await boot($, on, files, { noProcess: true, dirExists: true })
    expect(await run($, 'agt-focus', 'off')).toContain('focus: off')
    expect(saved(files)).toEqual({ display: { focus: false } })
    expect(mkdirs).toEqual([])
    expect(Object.keys(files)).toEqual([PROFILE]) // the direct write left no .tmp
  })

  test('a host without $.process and without the folder falls back to the mod store', async ($, on) => {
    const files: Record<string, string> = {}
    const { stored } = await boot($, on, files, { noProcess: true })
    expect(await run($, 'agt-focus', 'off')).toContain(NOTE + 'could not write ~/.agentille/profile.json')
    expect(files).toEqual({})
    expect(stored['focus:mode']).toBe('off')
  })

  test('a profile that exists but cannot be read is never replaced', async ($, on) => {
    const files = { [PROFILE]: '{"name":"x"}' }
    const { stored } = await boot($, on, files, { unreadable: true })
    expect(await run($, 'agt-highlight', 'off')).toContain(NOTE + '~/.agentille/profile.json is unreadable')
    expect(files[PROFILE]).toBe('{"name":"x"}')
    expect(stored['highlight:on']).toBe(false)
  })

  test('the old profile is copied to profile.json.bak before it is rewritten, and no .tmp is left', async ($, on) => {
    const original = '{\n  "name": "x",\n  "neverDo": ["a"]\n}\n'
    const files = { [PROFILE]: original }
    await boot($, on, files)
    await run($, 'agt-focus', 'off')
    expect(files[PROFILE + '.bak']).toBe(original)
    expect(saved(files)).toEqual({ name: 'x', neverDo: ['a'], display: { focus: false } })
    expect(Object.keys(files).sort()).toEqual([PROFILE, PROFILE + '.bak'])
    await run($, 'agt-focus', 'on') // the backup always holds the file as it was before the latest write
    expect(JSON.parse(files[PROFILE + '.bak']).display).toEqual({ focus: false })
  })

  test('when mv fails the profile is still written directly, backup kept', async ($, on) => {
    const files = { [PROFILE]: '{"name":"x"}' }
    await boot($, on, files, { mvFails: true })
    await run($, 'agt-focus', 'off')
    expect(saved(files)).toEqual({ name: 'x', display: { focus: false } })
    expect(files[PROFILE + '.bak']).toBe('{"name":"x"}')
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
