import { describe, expect, mock, test } from 'claude-code/testing'
import { doneFile, herdrCloseArgv, herdrPaneIdOf, herdrPromptArgv, herdrSplitArgv, herdrStartArgv, isFreshDone, isLead, newRunId, paneName, parseSpawnArgs, parseTmuxList, pickTransport, quietSpawn, reapPool, scopeRows, splitName, tmuxKillArgv, tmuxPaneAgents, tmuxPaneIdOf, tmuxSplitArgv, tmuxTagArgvs, transportBlock, TMUX_LIST_FORMAT } from '../../hooks/panes.js'
import { reapable } from '../../hooks/live.js'

const TAB = '\t'
describe('transport', () => {
  test('herdr beats tmux, tmux beats none', async () => {
    expect(pickTransport({ herdrOk: true, tmuxOk: true })).toBe('herdr')
    expect(pickTransport({ herdrOk: false, tmuxOk: true })).toBe('tmux')
    expect(pickTransport({ herdrOk: false, tmuxOk: false })).toBe('none')
  })

  test('block names the transport and the matching playbook section', async () => {
    expect(transportBlock('herdr')).toContain('transport: herdr')
    expect(transportBlock('herdr')).toContain('"Spawning a worker"')
    expect(transportBlock('tmux')).toContain('"tmux transport"')
    expect(transportBlock('none')).toContain('No pane transport here: parallel slices run as a workflow, else subagent waves.')
    expect(transportBlock('none').startsWith('\n## Pane transport (agentille mod)\n\ntransport: none\n')).toBe(true)
  })
})

describe('names', () => {
  test('pane names follow agt-<run>-<role>', async () => {
    expect(paneName('pn2w01', 'b1')).toBe('agt-pn2w01-b1')
    expect(paneName('abc123', 'spawn')).toBe('agt-abc123-spawn')
    expect(paneName('r1', 'Bad Role')).toBe(null)
    expect(paneName('../x', 'spawn')).toBe(null)
    expect(paneName('r1', 'x'.repeat(40))).toBe(null)
  })

  test('generated run ids are 6 chars of [a-z0-9]', async () => {
    for (let i = 0; i < 50; i++) expect(newRunId()).toMatch(/^[a-z0-9]{6}$/)
  })

  test('a name splits into run and role, unsafe parts refused', async () => {
    expect(splitName('agt-r1-executor-ui')).toEqual({ run: 'r1', role: 'executor-ui' })
    expect(splitName('agt-r1')).toBe(null)
    expect(splitName('other-r1-x')).toBe(null)
    expect(splitName('agt-r1-Up_per')).toBe(null)
  })

  test('done-file path is built only from safe parts', async () => {
    expect(doneFile('/h', 'r1', 'b1')).toBe('/h/.agentille/state/run-r1/done-b1')
    expect(doneFile('/h', '../etc', 'b1')).toBe(null)
    expect(doneFile('/h', 'r1', '../b1')).toBe(null)
    expect(doneFile(null, 'r1', 'b1')).toBe(null)
  })
})

describe('/agt-spawn args', () => {
  test('defaults to sonnet and strips surrounding quotes', async () => {
    expect(parseSpawnArgs('"reply with ok"')).toEqual({ task: 'reply with ok', model: 'sonnet' })
    expect(parseSpawnArgs('fix the header')).toEqual({ task: 'fix the header', model: 'sonnet' })
  })

  test('--model is taken from anywhere', async () => {
    expect(parseSpawnArgs('"reply with ok" --model haiku')).toEqual({ task: 'reply with ok', model: 'haiku' })
    expect(parseSpawnArgs('--model opus do the thing')).toEqual({ task: 'do the thing', model: 'opus' })
    expect(parseSpawnArgs('do --model claude-opus-5-5 the thing')).toEqual({ task: 'do the thing', model: 'claude-opus-5-5' })
  })

  test('empty task is usage, bad model is refused', async () => {
    expect(parseSpawnArgs('')).toMatchObject({ usage: expect.stringContaining('/agt-spawn') })
    expect(parseSpawnArgs('--model haiku')).toMatchObject({ usage: expect.any(String) })
    expect(parseSpawnArgs('"" ')).toMatchObject({ usage: expect.any(String) })
    expect(parseSpawnArgs('task --model gpt-4')).toMatchObject({ error: expect.stringContaining('gpt-4') })
    expect(parseSpawnArgs('task --model Opus')).toMatchObject({ error: expect.stringContaining('Opus') })
  })

  test('--model is a flag only before a model token, so prose about it survives', async () => {
    expect(parseSpawnArgs('explain the --model flag')).toEqual({ task: 'explain the --model flag', model: 'sonnet' })
    expect(parseSpawnArgs('"explain the --model flag"')).toEqual({ task: 'explain the --model flag', model: 'sonnet' })
    expect(parseSpawnArgs('explain --model flag --model haiku')).toEqual({ task: 'explain --model flag', model: 'haiku' })
    expect(parseSpawnArgs('do --model=opus now')).toEqual({ task: 'do now', model: 'opus' })
  })

  test('only one matching pair of surrounding quotes is stripped', async () => {
    expect(parseSpawnArgs('"a" and "b"')).toEqual({ task: '"a" and "b"', model: 'sonnet' })
    expect(parseSpawnArgs("'it is' --model haiku")).toEqual({ task: 'it is', model: 'haiku' })
    expect(parseSpawnArgs('"say "hi""')).toEqual({ task: '"say "hi""', model: 'sonnet' })
  })

  test('a single bare word is refused: claude would run it as a subcommand', async () => {
    for (const w of ['plugin', 'purge', '"doctor"', 'mcp --model haiku', '--help']) {
      expect(parseSpawnArgs(w)).toMatchObject({ error: expect.stringContaining('one-word task') })
    }
    expect(parseSpawnArgs('plugin list')).toEqual({ task: 'plugin list', model: 'sonnet' })
    expect(parseSpawnArgs('fix bug42')).toEqual({ task: 'fix bug42', model: 'sonnet' })
    expect(parseSpawnArgs('v2')).toEqual({ task: 'v2', model: 'sonnet' })
  })
})

describe('tmux panes', () => {
  const row = (id: string, agt: string, dead = '0', win = '@1', vendor = 'claude') => [id, agt, vendor, dead, win].join(TAB)

  test('list format and parse round-trip', async () => {
    expect(TMUX_LIST_FORMAT).toBe(['#{pane_id}', '#{@agt}', '#{@agt_vendor}', '#{pane_dead}', '#{window_id}'].join(TAB))
    const rows = parseTmuxList([row('%1', ''), row('%2', 'agt-r1-executor', '0', '@1'), row('%3', 'agt-r1-spawn', '1', '@2')].join('\n') + '\n')
    expect(rows.length).toBe(3)
    expect(rows[1]).toEqual({ id: '%2', agt: 'agt-r1-executor', vendor: 'claude', dead: false, window: '@1' })
    expect(rows[2].dead).toBe(true)
  })

  test('only agt- panes of the lead\'s own window, never self', async () => {
    const rows = parseTmuxList([row('%1', ''), row('%2', 'agt-r1-executor'), row('%3', 'agt-r1-reviewer', '0', '@2'), row('%4', 'other'), row('%5', 'agt-r1-planner', '1')].join('\n'))
    const p = tmuxPaneAgents(rows, '%1', new Map())
    expect(p.map((x) => x.id)).toEqual(['%2', '%5'])
    expect(p[0]).toMatchObject({ kind: 'pane', role: 'executor', run: 'r1', vendor: 'claude', state: 'working', seq: 0, tab: '@1' })
    expect(p[1]).toMatchObject({ state: 'done', seq: 1 })
  })

  test('a done-file marks the pane done', async () => {
    const rows = parseTmuxList(row('%2', 'agt-r1-executor') + '\n' + row('%1', ''))
    const p = tmuxPaneAgents(rows, '%1', new Map([['agt-r1-executor', true]]))
    expect(p[0]).toMatchObject({ state: 'done', seq: 1 })
  })

  test('only an unnamed pane is a lead', async () => {
    const rows = parseTmuxList([row('%1', ''), row('%2', 'agt-r1-executor')].join('\n'))
    expect(isLead(rows, '%1')).toBe(true)
    expect(isLead(rows, '%2')).toBe(false)
    expect(isLead(rows, '%9')).toBe(false)
  })

  test('a spawn pane is open, not working, and a leftover done-file cannot turn it done', async () => {
    const rows = parseTmuxList([row('%1', ''), row('%2', 'agt-ab12cd-spawn'), row('%3', 'agt-ab12cd-spawn', '1')].join('\n'))
    const p = tmuxPaneAgents(rows, '%1', new Map([['agt-ab12cd-spawn', true]]))
    expect(p.map((x) => x.state)).toEqual(['open', 'open'])
    expect(quietSpawn([{ id: 'w:p1', role: 'spawn', state: 'working', seq: 4 }, { id: 'w:p2', role: 'b1', state: 'working', seq: 4 }]).map((x) => x.state)).toEqual(['open', 'working'])
  })

  test('scopeRows keeps this window\'s other agt- panes and trusts nothing when self is unknown', async () => {
    const rows = parseTmuxList([row('%1', ''), row('%2', 'agt-r1-a'), row('%3', 'agt-r1-b', '0', '@2'), row('%4', 'user')].join('\n'))
    expect(scopeRows(rows, '%1').map((r) => r.id)).toEqual(['%2'])
    expect(scopeRows(rows, '%9').map((r) => r.id)).toEqual(['%2', '%3'])
  })

  test('a done-file counts only if written at or after the pane was first seen', async () => {
    expect(isFreshDone({ kind: 'file', mtimeMs: 1000 }, 1000)).toBe(true)
    expect(isFreshDone({ kind: 'file', mtimeMs: 999 }, 1000)).toBe(false)
    expect(isFreshDone({ kind: 'dir', mtimeMs: 5000 }, 1000)).toBe(false)
    expect(isFreshDone(undefined, 1000)).toBe(false)
    expect(isFreshDone({ kind: 'file', mtimeMs: 5000 }, undefined)).toBe(false)
  })

  test('tmux done waits 90s through the shared reaper, working never reaps', async () => {
    const rows = parseTmuxList([row('%1', ''), row('%2', 'agt-r1-executor'), row('%3', 'agt-r1-reviewer', '1')].join('\n'))
    const p = tmuxPaneAgents(rows, '%1', new Map())
    const seen = new Map()
    expect(reapable(p, seen, 0)).toEqual([])
    expect(reapable(p, seen, 89_999)).toEqual([])
    expect(reapable(p, seen, 90_000).map((x) => x.id)).toEqual(['%3'])
    expect(reapable(p, seen, 10_000_000).map((x) => x.id)).toEqual(['%3'])
  })

  test('spawn panes are never offered to the reaper, in either transport', async () => {
    const herdr = [
      { id: 'w1:p2', role: 'spawn', state: 'done', seq: 1 },
      { id: 'w1:p3', role: 'executor', state: 'done', seq: 1 },
      { id: 'w1:p4', role: 'spawn', state: 'idle', seq: 2 },
    ]
    expect(reapPool(herdr).map((x) => x.id)).toEqual(['w1:p3'])
    const rows = parseTmuxList([row('%1', ''), row('%2', 'agt-ab12cd-spawn', '1'), row('%3', 'agt-ab12cd-spawn-two', '1')].join('\n'))
    const p = reapPool(tmuxPaneAgents(rows, '%1', new Map()))
    expect(p.map((x) => x.id)).toEqual(['%3'])
  })
})

describe('spawn', () => {
  test('tmux argv runs claude through an interactive zsh/bash, task as a plain argument', async () => {
    const argv = tmuxSplitArgv({ target: '%1', cwd: '/work/repo', run: 'ab12cd', shell: '/bin/zsh', model: 'haiku', name: 'agt-ab12cd-spawn', task: 'a "quoted"; $(thing)' })
    expect(argv).toEqual(['tmux', 'split-window', '-d', '-h', '-P', '-F', '#{pane_id}', '-t', '%1', '-c', '/work/repo', '-e', 'AGENTILLE_RUN=ab12cd', '/bin/zsh', '-ic', 'claude "$@"', 'agt', '--model', 'haiku', '-n', 'agt-ab12cd-spawn', '--', 'a "quoted"; $(thing)'])
  })

  test('a task that starts with a dash sits right behind --, never in claude\'s option list', async () => {
    for (const task of ['--bogus-flag say hi', '--settings={"hooks":{}}', '-p x']) {
      const z = tmuxSplitArgv({ target: '%1', cwd: '/w', run: 'ab12cd', shell: '/bin/bash', model: 'haiku', name: 'agt-ab12cd-spawn', task })
      expect(z.slice(-2)).toEqual(['--', task])
      expect(z.indexOf('--')).toBe(z.length - 2)
      const f = tmuxSplitArgv({ target: '%1', cwd: '/w', run: 'ab12cd', shell: '/usr/bin/fish', model: 'haiku', name: 'agt-ab12cd-spawn', task })
      expect(f.slice(-2)).toEqual(['--', task])
    }
  })

  test('# in the working directory is escaped so tmux does not read it as a format', async () => {
    const argv = tmuxSplitArgv({ target: '%1', cwd: '/w/a#{session_name}b#c', run: 'ab12cd', shell: '/bin/zsh', model: 'haiku', name: 'agt-ab12cd-spawn', task: 't' })
    expect(argv[argv.indexOf('-c') + 1]).toBe('/w/a##{session_name}b##c')
  })

  test('other shells exec claude directly', async () => {
    const argv = tmuxSplitArgv({ target: '%1', cwd: '/w', run: 'ab12cd', shell: '/usr/bin/fish', model: 'haiku', name: 'agt-ab12cd-spawn', task: 't' })
    expect(argv.slice(13)).toEqual(['claude', '--model', 'haiku', '-n', 'agt-ab12cd-spawn', '--', 't'])
  })

  test('tmux tags the pane and pins its title', async () => {
    expect(tmuxTagArgvs('%7', 'agt-ab12cd-spawn')).toEqual([
      ['tmux', 'set-option', '-p', '-t', '%7', '@agt', 'agt-ab12cd-spawn'],
      ['tmux', 'set-option', '-p', '-t', '%7', '@agt_vendor', 'claude'],
      ['tmux', 'set-option', '-p', '-t', '%7', 'allow-set-title', 'off'],
      ['tmux', 'select-pane', '-t', '%7', '-T', 'agt-ab12cd-spawn'],
    ])
  })

  test('pane ids are read strictly from the command output', async () => {
    expect(tmuxPaneIdOf('%9\n')).toBe('%9')
    expect(tmuxPaneIdOf('oops')).toBe(null)
    expect(tmuxKillArgv('%9')).toEqual(['tmux', 'kill-pane', '-t', '%9'])
    expect(herdrPaneIdOf(JSON.stringify({ result: { pane: { pane_id: 'w1:p5' } } }))).toBe('w1:p5')
    expect(herdrPaneIdOf('not json')).toBe(null)
    expect(herdrPaneIdOf('{}')).toBe(null)
  })

  test('herdr: split beside the lead without focus, start claude, prompt it', async () => {
    expect(herdrSplitArgv({ pane: 'w1:p1', cwd: '/work/repo', run: 'ab12cd' })).toEqual(['herdr', 'pane', 'split', '--pane', 'w1:p1', '--direction', 'right', '--cwd', '/work/repo', '--env', 'AGENTILLE_RUN=ab12cd', '--no-focus'])
    expect(herdrStartArgv({ name: 'agt-ab12cd-spawn', pane: 'w1:p5', model: 'haiku' })).toEqual(['herdr', 'agent', 'start', 'agt-ab12cd-spawn', '--kind', 'claude', '--pane', 'w1:p5', '--timeout', '45000', '--', '--model', 'haiku'])
    expect(herdrPromptArgv('agt-ab12cd-spawn', 'reply with ok')).toEqual(['herdr', 'agent', 'prompt', 'agt-ab12cd-spawn', 'reply with ok'])
    expect(herdrCloseArgv('w1:p5')).toEqual(['herdr', 'pane', 'close', 'w1:p5'])
  })
})

describe('skill prompt', () => {
  const answer = (on: any, vars: Record<string, string>, table: Record<string, number> = {}) => {
    on('env.get', async ($: any, e: any) => ({ value: vars[e.name] }))
    on('process.run', async ($: any, e: any) => {
      const key = Object.keys(table).find((k) => e.argv.join(' ').startsWith(k))
      return { value: { exitCode: key === undefined ? 0 : table[key], stdout: '', stderr: '' } }
    })
  }

  test('/agt is told which transport is live', async ($, on) => {
    answer(on, { HERDR_ENV: '1' })
    on('skill.prompt', async ($: any, e: any) => ({ text: e.text }))
    const r = await $.skill.prompt({ skill: 'agt', text: 'base' })
    expect(r.text).toContain('\n## Pane transport (agentille mod)\n\ntransport: herdr\n')
    expect(r.text).toContain('"Spawning a worker"')
  })

  test('inside tmux it points at the tmux section', async ($, on) => {
    answer(on, { TMUX: '/tmp/tmux-1/default,1,0' })
    on('skill.prompt', async ($: any, e: any) => ({ text: e.text }))
    const r = await $.skill.prompt({ skill: 'agentille:agt', text: 'base' })
    expect(r.text).toContain('transport: tmux')
    expect(r.text).toContain('"tmux transport"')
  })

  test('HERDR_ENV=1 but herdr does not answer, no tmux: none', async ($, on) => {
    answer(on, { HERDR_ENV: '1' }, { 'herdr --version': 127 })
    on('skill.prompt', async ($: any, e: any) => ({ text: e.text }))
    expect((await $.skill.prompt({ skill: 'agt', text: 'base' })).text).toContain('transport: none')
  })

  test('with no multiplexer it says so, and other skills are untouched', async ($, on) => {
    answer(on, {})
    on('skill.prompt', async ($: any, e: any) => ({ text: e.text }))
    const r = await $.skill.prompt({ skill: 'agt', text: 'base' })
    expect(r.text).toContain('transport: none')
    expect(r.text).toContain('workflow, else subagent waves')
    expect((await $.skill.prompt({ skill: 'commit', text: 'base' })).text).toBe('base')
  })
})

describe('tmux band', () => {
  const T = '\t'
  const row = (id: string, agt: string, dead = '0', win = '@1') => [id, agt, 'claude', dead, win].join(T)
  const FRESH = Number.MAX_SAFE_INTEGER
  const LIST = [row('%1', ''), row('%2', 'agt-r9-executor'), row('%3', 'agt-r9-planner'), row('%4', 'agt-r9-spawn-x', '1'), row('%5', 'agt-r9-other', '0', '@2'), row('%6', 'agt-r9-spawn')]

  // session.start probes tmux, polls once and draws; `mtimes` maps done-file path → mtimeMs
  const start = async ($: any, on: any, o: { self?: string; rows?: string[]; mtimes?: Record<string, number> } = {}) => {
    const killed: string[] = []
    const statted: string[] = []
    const rows = o.rows ?? LIST
    const mtimes = o.mtimes ?? {}
    on('env.get', async ($: any, e: any) => ({ value: ({ TMUX: '/tmp/tmux-1/default,1,0', TMUX_PANE: o.self ?? '%1', HOME: '/h' } as any)[e.name] }))
    on('session.start', async ($: any, e: any) => ({ cwd: e.cwd }))
    on('command.register', async () => ({ value: undefined }))
    on('fs.read', async () => ({ deny: 'no profile' }))
    on('fs.exists', async ($: any, e: any) => { statted.push(e.path); return { value: false } })
    on('fs.stat', async ($: any, e: any) => {
      statted.push(e.path)
      return e.path in mtimes ? { value: { kind: 'file', size: 0, mtimeMs: mtimes[e.path], isLink: false } } : { deny: 'ENOENT' }
    })
    on('store.get', async () => ({ value: undefined }))
    on('ui.panes', async () => ({ value: [] }))
    on('process.run', async ($: any, e: any) => {
      const cmd = e.argv.join(' ')
      if (cmd.startsWith('tmux list-panes')) return { value: { exitCode: 0, stdout: rows.join('\n') + '\n', stderr: '' } }
      if (cmd.startsWith('tmux kill-pane')) {
        killed.push(e.argv[3])
        const i = rows.findIndex((r) => r.startsWith(e.argv[3] + T))
        if (i >= 0) rows.splice(i, 1)
      }
      return { value: { exitCode: 0, stdout: '', stderr: '' } }
    })
    const clock = mock.clock(on, { now: 1_000_000 })
    await $.session.start({ cwd: '/w', surface: null, isInteractive: false })
    return { killed, statted, clock }
  }

  test('shows this window\'s agt- panes in the band, a spawn pane stays quiet', async ($, on) => {
    on('ui.render', async () => ({ type: 'engine', ref: 0 }) as never)
    await start($, on, { mtimes: { '/h/.agentille/state/run-r9/done-planner': FRESH } })
    const ui = await $.ui.mount({ plugin: 'agentille', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 100 } as never })
    expect(await ui.find({ type: 'Text', text: /executor/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /planner/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /1 working · 2 done/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^open\s*$/ })).toBeDefined()
    await ui.unmount()
  })

  const DONE = (role: string) => '/h/.agentille/state/run-r9/done-' + role

  test('a lead kills a done pane only after 90s, never a working or a spawn pane', async ($, on) => {
    const rows = [row('%1', ''), row('%2', 'agt-r9-executor', '1'), row('%3', 'agt-r9-spawn', '1'), row('%4', 'agt-r9-planner')]
    const { killed, clock } = await start($, on, { rows })
    await clock.advance(85_000)
    expect(killed).toEqual([])
    await clock.advance(10_000)
    expect(killed).toEqual(['%2'])
    await clock.advance(300_000)
    expect(killed).toEqual(['%2'])
  })

  test('a worker pane (its own @agt) never kills anything', async ($, on) => {
    const rows = [row('%1', ''), row('%2', 'agt-r9-executor'), row('%3', 'agt-r9-planner', '1'), row('%4', 'agt-r9-reviewer', '1')]
    const { killed, clock } = await start($, on, { rows, self: '%2' })
    await clock.advance(400_000)
    expect(killed).toEqual([])
  })

  test('a pane that cannot find itself in the list kills nothing', async ($, on) => {
    const rows = [row('%2', 'agt-r9-planner', '1'), row('%3', 'agt-r9-reviewer', '1')]
    const { killed, clock } = await start($, on, { rows, self: '%9' })
    await clock.advance(400_000)
    expect(killed).toEqual([])
  })

  test('no done-file is read for an unsafe name or for a pane in another window', async ($, on) => {
    const rows = [row('%1', ''), row('%2', 'agt-a.b-planner'), row('%3', 'agt-r9-Bad_Role'), row('%4', 'agt-r9-ok'), row('%5', 'agt-r9-other', '0', '@2'), row('%6', 'agt-..-x')]
    const { statted, clock } = await start($, on, { rows })
    await clock.advance(20_000)
    expect(statted.length).toBeGreaterThan(0)
    expect([...new Set(statted)]).toEqual([DONE('ok')])
  })

  test('a done-file older than the pane\'s first sighting is ignored until a fresh one is written', async ($, on) => {
    const rows = [row('%1', ''), row('%3', 'agt-r9-planner')]
    const mtimes: Record<string, number> = { [DONE('planner')]: 5 }
    const { killed, clock } = await start($, on, { rows, mtimes })
    await clock.advance(300_000)
    expect(killed).toEqual([])
    mtimes[DONE('planner')] = clock.now() + 1
    await clock.advance(10_000)
    expect(killed).toEqual([])
    await clock.advance(85_000)
    expect(killed).toEqual(['%3'])
  })
})

describe('/agt-spawn', () => {
  const setup = (on: any, vars: Record<string, string>, table: Record<string, any> = {}, cwd = '/work/repo') => {
    const seen: string[][] = []
    on('env.get', async ($: any, e: any) => ({ value: vars[e.name] }))
    on('session.cwd', async () => ({ value: cwd }))
    on('process.run', async ($: any, e: any) => {
      seen.push(e.argv)
      const key = Object.keys(table).find((k) => e.argv.join(' ').startsWith(k))
      return { value: { exitCode: 0, stdout: '', stderr: '', ...(key === undefined ? {} : table[key]) } }
    })
    return seen
  }
  const typed = { kind: 'composer' } as never
  const run = ($: any, args: string, origin: any = typed) => $.command.run({ command: 'agt-spawn', args, origin })

  test('tmux: opens a tagged pane and says so', async ($, on) => {
    const seen = setup(on, { TMUX: '/tmp/tmux-1/default,1,0', TMUX_PANE: '%1', SHELL: '/bin/zsh' }, { 'tmux split-window': { stdout: '%9\n' } })
    const r = await run($, '"reply with ok" --model haiku')
    expect(r.text).toMatch(/^Opened agt-[a-z0-9]{6}-spawn · haiku · tmux pane\.$/)
    const split = seen.find((a) => a[1] === 'split-window')!
    expect(split).toContain('-d')
    expect(split.slice(-7)).toEqual(['agt', '--model', 'haiku', '-n', r.text.match(/agt-[a-z0-9]{6}-spawn/)![0], '--', 'reply with ok'])
    expect(split[split.indexOf('-c') + 1]).toBe('/work/repo')
    expect(seen.filter((a) => a[1] === 'set-option' && a[5] === '@agt').length).toBe(1)
    expect(seen.some((a) => a[1] === 'select-pane')).toBe(true)
  })

  test('herdr: splits without focus, starts and prompts', async ($, on) => {
    const seen = setup(on, { HERDR_ENV: '1', HERDR_PANE_ID: 'w1:p1' }, { 'herdr pane split': { stdout: JSON.stringify({ result: { pane: { pane_id: 'w1:p5' } } }) } })
    const r = await run($, 'do the thing')
    expect(r.text).toMatch(/^Opened agt-[a-z0-9]{6}-spawn · sonnet · herdr pane\.$/)
    expect(seen.map((a) => a.slice(0, 3).join(' '))).toEqual(['herdr --version', 'herdr pane split', 'herdr agent start', 'herdr agent prompt'])
    expect(seen[1]).toContain('--no-focus')
  })

  test('a failed start closes the half-made herdr pane', async ($, on) => {
    const seen = setup(on, { HERDR_ENV: '1', HERDR_PANE_ID: 'w1:p1' }, { 'herdr pane split': { stdout: JSON.stringify({ result: { pane: { pane_id: 'w1:p5' } } }) }, 'herdr agent start': { exitCode: 2 } })
    const r = await run($, 'do the thing')
    expect(r.text).toMatch(/^Could not open a herdr pane/)
    expect(seen[seen.length - 1]).toEqual(['herdr', 'pane', 'close', 'w1:p5'])
  })

  test('tmux: a failed tag kills the half-made pane and reports it', async ($, on) => {
    const seen = setup(on, { TMUX: '/tmp/tmux-1/default,1,0', TMUX_PANE: '%1', SHELL: '/bin/zsh' }, { 'tmux split-window': { stdout: '%9\n' }, 'tmux set-option -p -t %9 @agt_vendor': { exitCode: 1 } })
    const r = await run($, 'do the thing')
    expect(r.text).toMatch(/^Could not open a tmux pane/)
    expect(seen[seen.length - 1]).toEqual(['tmux', 'kill-pane', '-t', '%9'])
    expect(seen.some((a) => a[1] === 'select-pane')).toBe(false)
  })

  test('HERDR_ENV=1 with a herdr that will not answer falls back to tmux', async ($, on) => {
    const seen = setup(on, { HERDR_ENV: '1', HERDR_PANE_ID: 'w1:p1', TMUX: '/tmp/tmux-1/default,1,0', TMUX_PANE: '%1', SHELL: '/bin/zsh' }, { 'herdr --version': { exitCode: 127 }, 'tmux split-window': { stdout: '%9\n' } })
    const r = await run($, 'do the thing')
    expect(r.text).toMatch(/^Opened agt-[a-z0-9]{6}-spawn · sonnet · tmux pane\.$/)
    expect(seen.slice(0, 2).map((a) => a.slice(0, 2).join(' '))).toEqual(['herdr --version', 'tmux -V'])
    expect(seen.some((a) => a[0] === 'herdr' && a[1] !== '--version')).toBe(false)
  })

  test('no transport: refuses and opens nothing', async ($, on) => {
    const seen = setup(on, {})
    expect((await run($, 'do the thing')).text).toBe('No pane transport here: /agt-spawn needs Claude Code running inside Herdr or tmux.')
    expect(seen).toEqual([])
  })

  test('empty task is usage, bad model is refused, nothing spawns', async ($, on) => {
    const seen = setup(on, { TMUX: '/tmp/tmux-1/default,1,0', TMUX_PANE: '%1' })
    expect((await run($, '   ')).text).toContain('Usage: /agt-spawn')
    expect((await run($, 'x --model gpt-4')).text).toContain('Unknown model')
    expect(seen).toEqual([])
  })

  test('never spawns unless typed: composer and bridge only', async ($, on) => {
    const seen = setup(on, { TMUX: '/tmp/tmux-1/default,1,0', TMUX_PANE: '%1' })
    for (const kind of ['plugin', 'model', 'tool', 'skill', 'agent', 'sdk']) {
      expect((await run($, 'do the thing', { kind, name: 'other' })).text).toBe('/agt-spawn runs only when typed.')
    }
    expect(seen).toEqual([])
  })

  test('composer and bridge may spawn', async ($, on) => {
    setup(on, { TMUX: '/tmp/tmux-1/default,1,0', TMUX_PANE: '%1' }, { 'tmux split-window': { stdout: '%9\n' } })
    for (const kind of ['composer', 'bridge']) {
      expect((await run($, 'do the thing', { kind } as never)).text).toMatch(/^Opened agt-/)
    }
  })

  test('tmux: a task that looks like an option reaches claude as the prompt', async ($, on) => {
    const seen = setup(on, { TMUX: '/tmp/tmux-1/default,1,0', TMUX_PANE: '%1', SHELL: '/bin/zsh' }, { 'tmux split-window': { stdout: '%9\n' } })
    const task = '--settings={"hooks":{"SessionStart":[]}} now'
    await run($, task)
    const split = seen.find((a) => a[1] === 'split-window')!
    expect(split.slice(-2)).toEqual(['--', task])
  })

  test('a bare subcommand word is refused and spawns nothing', async ($, on) => {
    const seen = setup(on, { TMUX: '/tmp/tmux-1/default,1,0', TMUX_PANE: '%1' })
    expect((await run($, 'plugin')).text).toContain('one-word task')
    expect(seen).toEqual([])
  })

  test('a repo path with # opens the pane in that directory', async ($, on) => {
    const seen = setup(on, { TMUX: '/tmp/tmux-1/default,1,0', TMUX_PANE: '%1' }, { 'tmux split-window': { stdout: '%9\n' } }, '/work/c#sharp')
    await run($, 'do the thing')
    const split = seen.find((a) => a[1] === 'split-window')!
    expect(split[split.indexOf('-c') + 1]).toBe('/work/c##sharp')
  })
})
