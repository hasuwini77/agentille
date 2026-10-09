import { describe, expect, mock, test } from 'claude-code/testing'
import { advisorEnv, EFFORTS, PANE_RULE, splitPlan, tmuxEvenArgv, SPAWN_TOOL, closeTarget, paneRole, doneFile, spawnToolInput, TOOL_MODELS, herdrCloseArgv, herdrPaneIdOf, herdrPromptArgv, herdrSplitArgv, herdrStartArgv, isFreshDone, isLead, newRunId, paneName, parseSpawnArgs, parseTmuxList, pickTransport, quietSpawn, reapPool, scopeRows, splitName, tmuxKillArgv, tmuxPaneAgents, tmuxPaneIdOf, tmuxSplitArgv, tmuxTagArgvs, transportBlock, TMUX_LIST_FORMAT } from '../../hooks/panes.js'
import { reapPlan } from '../../hooks/live.js'
import { ROLES, roleOf } from '../../hooks/routing.js'

const TAB = '\t'
describe('transport', () => {
  test('herdr beats tmux, tmux beats none', async () => {
    expect(pickTransport({ herdrOk: true, tmuxOk: true })).toBe('herdr')
    expect(pickTransport({ herdrOk: false, tmuxOk: true })).toBe('tmux')
    expect(pickTransport({ herdrOk: false, tmuxOk: false })).toBe('none')
  })

  test('the block names the transport and cites no playbook section', async () => {
    for (const t of ['herdr', 'tmux', 'none']) {
      expect(transportBlock(t, true).startsWith('\n## Pane transport (agentille mod)\n\ntransport: ' + t + '\n')).toBe(true)
      expect(transportBlock(t, true)).not.toContain('panes-mode.md')
    }
    expect(transportBlock('none')).toContain('No pane transport here: parallel slices run as a workflow, else subagent waves.')
    expect(transportBlock('herdr')).toBe('\n## Pane transport (agentille mod)\n\ntransport: herdr\n')
  })

  test('the pane rule rides with the tools, on tmux and herdr only', async () => {
    expect(transportBlock('tmux', true)).toContain(PANE_RULE)
    expect(transportBlock('herdr', true)).toContain(PANE_RULE)
    expect(transportBlock('tmux')).not.toContain('Pane rule')
    expect(transportBlock('none', true)).not.toContain('Pane rule')
    expect(transportBlock('none', true)).not.toContain('spawn_pane')
  })

  test('the pane rule: parallel slices or --mode panes, executor and adversary only, close after harvest', async () => {
    expect(PANE_RULE).toContain('≥2 slices')
    expect(PANE_RULE).toContain('--mode panes')
    expect(PANE_RULE).toContain('executor (and the adversary)')
    expect(PANE_RULE).toContain('everyone else is a subagent')
    expect(PANE_RULE).toContain('close_pane after harvest')
    expect(PANE_RULE.length).toBeLessThan(260)
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
    const ok = () => true
    expect(reapPlan(p, seen, 0, true, ok).reap).toEqual([])
    expect(reapPlan(p, seen, 89_999, true, ok).reap).toEqual([])
    expect(reapPlan(p, seen, 90_000, true, ok).reap.map((x) => x.id)).toEqual(['%3'])
    expect(reapPlan(p, seen, 10_000_000, true, ok).reap.map((x) => x.id)).toEqual(['%3'])
    expect(reapPlan(p, seen, 10_000_000).reap).toEqual([])
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
    expect(argv).toEqual(['tmux', 'split-window', '-d', '-h', '-P', '-F', '#{pane_id}', '-t', '%1', '-c', '/work/repo', '-e', 'AGENTILLE_RUN=ab12cd', '-e', 'AGENTILLE_WORKER=spawn:haiku:', '/bin/zsh', '-ic', 'claude "$@"', 'agt', '--model', 'haiku', '-n', 'agt-ab12cd-spawn', '--', 'a "quoted"; $(thing)'])
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
    expect(argv.slice(15)).toEqual(['claude', '--model', 'haiku', '-n', 'agt-ab12cd-spawn', '--', 't'])
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
    expect(herdrSplitArgv({ pane: 'w1:p1', cwd: '/work/repo', run: 'ab12cd' })).toEqual(['herdr', 'pane', 'split', '--pane', 'w1:p1', '--direction', 'right', '--cwd', '/work/repo', '--env', 'AGENTILLE_RUN=ab12cd', '--env', 'AGENTILLE_WORKER=spawn::', '--no-focus'])
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
    expect(r.text).not.toContain('panes-mode.md')
  })

  test('inside tmux it names tmux', async ($, on) => {
    answer(on, { TMUX: '/tmp/tmux-1/default,1,0' })
    on('skill.prompt', async ($: any, e: any) => ({ text: e.text }))
    const r = await $.skill.prompt({ skill: 'agentille:agt', text: 'base' })
    expect(r.text).toContain('transport: tmux')
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

  // session.start probes tmux, polls once and draws; `mtimes` maps a done-file or saved-answer path → mtimeMs
  const start = async ($: any, on: any, o: { self?: string; rows?: string[]; mtimes?: Record<string, number> } = {}) => {
    const killed: string[] = []
    const statted: string[] = []
    const rows = o.rows ?? LIST
    const mtimes = o.mtimes ?? {}
    on('env.get', async ($: any, e: any) => ({ value: ({ TMUX: '/tmp/tmux-1/default,1,0', TMUX_PANE: o.self ?? '%1', HOME: '/h' } as any)[e.name] }))
    on('session.start', async ($: any, e: any) => ({ cwd: e.cwd }))
    on('command.register', async () => ({ value: undefined }))
    on('fs.read', async () => ({ deny: 'no profile' }))
    on('fs.exists', async () => ({ value: false }))
    on('fs.stat', async ($: any, e: any) => {
      statted.push(e.path)
      return e.path in mtimes ? { value: { kind: 'file', size: 0, mtimeMs: mtimes[e.path], isLink: false } } : { deny: 'ENOENT' }
    })
    on('store.get', async () => ({ value: undefined }))
    on('session.receive', async ($: any, e: any) => ({ text: e.text }) as never)
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
    expect(await ui.find({ type: 'Text', text: /planner/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^open\s*$/ })).toBeUndefined()
    await ui.unmount()
  })

  test('a pane that vanishes leaves the band', async ($, on) => {
    on('ui.render', async () => ({ type: 'engine', ref: 0 }) as never)
    const rows = [row('%1', ''), row('%2', 'agt-r9-executor')]
    const { clock } = await start($, on, { rows })
    const ui = await $.ui.mount({ plugin: 'agentille', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 100 } as never })
    expect(await ui.find({ type: 'Text', text: /working$/ })).toBeDefined()
    rows.splice(1, 1)
    await clock.advance(5000)
    expect(await ui.find({ type: 'Text', text: /executor/ })).toBeUndefined()
    await ui.unmount()
  })

  const DONE = (role: string) => '/h/.agentille/state/run-r9/done-' + role
  const ANSWER = (role: string) => '/h/.agentille/state/run-r9/agents/pane-' + role + '.md'

  test('a lead kills a done pane only after 90s, never a working or a spawn pane', { timeoutMs: 15_000 }, async ($, on) => {
    const rows = [row('%1', ''), row('%2', 'agt-r9-executor', '1'), row('%3', 'agt-r9-spawn', '1'), row('%4', 'agt-r9-planner')]
    const { killed, clock } = await start($, on, { rows, mtimes: { [ANSWER('executor')]: FRESH } })
    await clock.advance(85_000)
    expect(killed).toEqual([])
    await clock.advance(10_000)
    expect(killed).toEqual(['%2'])
    await clock.advance(300_000)
    expect(killed).toEqual(['%2'])
  })

  test('a done pane with no answer saved is never killed, however long it waits', { timeoutMs: 15_000 }, async ($, on) => {
    const rows = [row('%1', ''), row('%2', 'agt-r9-executor', '1')]
    const { killed, clock } = await start($, on, { rows })
    await clock.advance(400_000)
    expect(killed).toEqual([])
  })

  test('an answer file older than the pane\'s first sighting does not harvest it', { timeoutMs: 15_000 }, async ($, on) => {
    const rows = [row('%1', ''), row('%2', 'agt-r9-executor', '1')]
    const mtimes: Record<string, number> = { [ANSWER('executor')]: 5 }
    const { killed, clock } = await start($, on, { rows, mtimes })
    await clock.advance(400_000)
    expect(killed).toEqual([])
    mtimes[ANSWER('executor')] = clock.now() + 1
    await clock.advance(10_000)
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
    const mtimes: Record<string, number> = { [DONE('planner')]: 5, [ANSWER('planner')]: FRESH }
    const { killed, clock } = await start($, on, { rows, mtimes })
    await clock.advance(300_000)
    expect(killed).toEqual([])
    mtimes[DONE('planner')] = clock.now() + 1
    await clock.advance(10_000)
    expect(killed).toEqual([])
    await clock.advance(85_000)
    expect(killed).toEqual(['%3'])
  })

  test('a tmux pane\'s own instance file (pane-<role>.5.md for %5) harvests it', { timeoutMs: 15_000 }, async ($, on) => {
    const rows = [row('%1', ''), row('%5', 'agt-r9-executor', '1')]
    const { killed, clock } = await start($, on, { rows, mtimes: { '/h/.agentille/state/run-r9/agents/pane-executor.5.md': FRESH } })
    await clock.advance(95_000)
    expect(killed).toEqual(['%5'])
  })

  test('a tmux wire done message naming pane-<role>.5.md harvests %5', { timeoutMs: 15_000 }, async ($, on) => {
    const rows = [row('%1', ''), row('%5', 'agt-r9-executor', '1')]
    const { killed, clock } = await start($, on, { rows })
    await $.session.receive({ text: '[agt wire] agt-r9-executor done · 0:10\nBuilt it\nFull answer: /h/.agentille/state/run-r9/agents/pane-executor.5.md', origin: { kind: 'peer' } } as never)
    await clock.advance(95_000)
    expect(killed).toEqual(['%5'])
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
    expect(seen.map((a) => a.slice(0, 3).join(' '))).toEqual(['herdr --version', 'herdr pane split', 'herdr agent start', 'herdr agent prompt', 'herdr pane report-metadata'])
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

describe('effort and layout', () => {
  const base = { target: '%1', cwd: '/w', run: 'ab12cd', model: 'sonnet', name: 'agt-ab12cd-exec-1', task: 't' }

  test('effort is valid only from the list', async () => {
    expect(EFFORTS).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
    const start = ['herdr', 'agent', 'start', 'n', '--kind', 'claude', '--pane', 'w1:p5', '--timeout', '45000', '--', '--model', 'opus']
    expect(herdrStartArgv({ name: 'n', pane: 'w1:p5', model: 'opus', effort: 'high' })).toEqual([...start, '--effort', 'high'])
    expect(herdrStartArgv({ name: 'n', pane: 'w1:p5', model: 'opus' })).toEqual(start)
    expect(herdrStartArgv({ name: 'n', pane: 'w1:p5', model: 'opus', effort: 'turbo' })).toEqual(start)
  })

  test('tmux puts --effort after --model, and -- stays second to last', async () => {
    const name = base.name
    const z = tmuxSplitArgv({ ...base, shell: '/bin/zsh', effort: 'medium' })
    expect(z.slice(-9)).toEqual(['agt', '--model', 'sonnet', '--effort', 'medium', '-n', name, '--', 't'])
    const f = tmuxSplitArgv({ ...base, shell: '/usr/bin/fish', effort: 'medium' })
    expect(f.slice(-9)).toEqual(['claude', '--model', 'sonnet', '--effort', 'medium', '-n', name, '--', 't'])
    const dash = tmuxSplitArgv({ ...base, shell: '/bin/zsh', effort: 'high', task: '-rf' })
    expect(dash[dash.length - 2]).toBe('--')
    expect(tmuxSplitArgv({ ...base, shell: '/bin/zsh', effort: 'turbo' })).not.toContain('--effort')
  })

  test('a routed worker runs as its agentille agent definition; unknown agents add nothing', async () => {
    const start = ['herdr', 'agent', 'start', 'n', '--kind', 'claude', '--pane', 'w1:p5', '--timeout', '45000', '--']
    expect(herdrStartArgv({ name: 'n', pane: 'w1:p5', model: 'opus', effort: 'high', agent: 'code-reviewer' })).toEqual([...start, '--agent', 'agentille:agentille-code-reviewer', '--model', 'opus', '--effort', 'high'])
    expect(herdrStartArgv({ name: 'n', pane: 'w1:p5', model: 'opus', agent: 'boss' })).toEqual([...start, '--model', 'opus'])
    const z = tmuxSplitArgv({ ...base, shell: '/bin/zsh', effort: 'medium', agent: 'executor' })
    expect(z.slice(-11)).toEqual(['agt', '--agent', 'agentille:agentille-executor', '--model', 'sonnet', '--effort', 'medium', '-n', base.name, '--', 't'])
    expect(tmuxSplitArgv({ ...base, shell: '/bin/zsh' })).not.toContain('--agent')
  })

  test('direction picks the tmux and herdr split axis', async () => {
    expect(tmuxSplitArgv({ ...base, shell: '/bin/zsh', direction: 'down' })[3]).toBe('-v')
    for (const d of [undefined, 'right', 'bogus']) expect(tmuxSplitArgv({ ...base, shell: '/bin/zsh', direction: d })[3]).toBe('-h')
    const h = (direction?: string) => herdrSplitArgv({ pane: 'w1:p1', cwd: '/w', run: 'ab12cd', direction })
    expect(h('down')[h('down').indexOf('--direction') + 1]).toBe('down')
    for (const d of [undefined, 'left']) expect(h(d)[h(d).indexOf('--direction') + 1]).toBe('right')
  })

  test('splitPlan: the first worker goes right of the lead, later ones down from the newest live worker', async () => {
    expect(splitPlan({ lead: '%1' })).toEqual({ target: '%1', direction: 'right' })
    const two = [{ id: '%2' }, { id: '%3' }]
    expect(splitPlan({ lead: '%1', opened: two.slice(0, 1), live: [{ id: '%2' }] })).toEqual({ target: '%2', direction: 'down' })
    expect(splitPlan({ lead: '%1', opened: two, live: two })).toEqual({ target: '%3', direction: 'down' })
    expect(splitPlan({ lead: '%1', opened: two, live: [{ id: '%2' }] })).toEqual({ target: '%2', direction: 'down' })
  })

  test('with nothing live, splitPlan returns to the lead', async () => {
    expect(splitPlan({ lead: '%1', opened: [{ id: '%2' }], live: [] })).toEqual({ target: '%1', direction: 'right' })
    expect(tmuxEvenArgv('%9')).toEqual(['tmux', 'select-layout', '-E', '-t', '%9'])
  })
})

describe('routing roles', () => {
  test('every role round-trips through its subagent type', async () => {
    for (const r of ['executor', 'adversary', 'code-reviewer', 'planner']) expect(ROLES).toContain(r)
    for (const r of ROLES) expect(roleOf('agentille:agentille-' + r)).toBe(r)
  })
})

describe('paneRole', () => {
  test('executor and adversary are panes', async () => {
    expect(paneRole('executor').pane).toBe(true)
    expect(paneRole('adversary').pane).toBe(true)
  })

  test('every other role is a subagent, reviewers included, whatever model they route to', async () => {
    for (const r of ROLES.filter((r) => r !== 'executor' && r !== 'adversary')) {
      const p = paneRole(r)
      expect(p.pane).toBe(false)
      expect(p.why).toContain(r + ' runs as a subagent')
    }
    expect(paneRole('boss').pane).toBe(false)
  })
})

describe('pane tools: input', () => {
  const header = '[agt run=k7f2ab size=small mode=build]'
  const ok = { run: 'k7f2ab', role: 'exec-1', task: 'build the search filter', agent: 'executor', header }

  test('a valid spawn defaults to sonnet and the session cwd', async () => {
    expect(spawnToolInput(ok)).toEqual({ run: 'k7f2ab', role: 'exec-1', name: 'agt-k7f2ab-exec-1', agent: 'executor', header, hdr: { run: 'k7f2ab', size: 'small', mode: 'build' }, asked: null, model: 'sonnet', task: 'build the search filter', cwd: null })
    expect(spawnToolInput({ ...ok, model: 'haiku', cwd: '/w/wt-1' })).toMatchObject({ asked: 'haiku', model: 'haiku', cwd: '/w/wt-1' })
  })

  test('agent and header are required and must agree with the run', async () => {
    const { agent: _a, ...noAgent } = ok
    const { header: _h, ...noHeader } = ok
    expect(spawnToolInput(noAgent).error).toContain('agent must be one of')
    expect(spawnToolInput({ ...ok, agent: 'Executor' }).error).toContain('agent must be one of')
    expect(spawnToolInput({ ...ok, agent: 'boss' }).error).toContain('agent must be one of')
    expect(spawnToolInput(noHeader).error).toContain('header must be')
    expect(spawnToolInput({ ...ok, header: 'size=large' }).error).toContain('header must be')
    expect(spawnToolInput({ ...ok, header: '[agt run=zzzzzz size=large]' }).error).toContain('does not match run k7f2ab')
  })

  test('the schema asks for agent and header; model is ignored', async () => {
    expect(SPAWN_TOOL.inputSchema.required).toEqual(['run', 'role', 'task', 'agent', 'header'])
    expect(SPAWN_TOOL.inputSchema.properties.agent.enum).toEqual(ROLES)
    expect(SPAWN_TOOL.inputSchema.properties.model.description).toContain('Ignored')
  })

  test('fable is not a tool model', async () => {
    expect(TOOL_MODELS).not.toContain('fable')
    expect(spawnToolInput({ ...ok, model: 'fable' }).error).toContain('routing guard')
    expect(spawnToolInput({ ...ok, model: 'gpt-4' }).error).toContain('model must be one of')
  })

  test('bad names, the reserved role, bare words and relative paths are refused', async () => {
    expect(spawnToolInput({ ...ok, run: 'a b' }).error).toContain('run must be')
    expect(spawnToolInput({ ...ok, role: 'Exec' }).error).toContain('role must be')
    expect(spawnToolInput({ ...ok, role: 'spawn' }).error).toContain('reserved')
    expect(spawnToolInput({ ...ok, role: 'x'.repeat(30) }).error).toContain('max 32')
    expect(spawnToolInput({ ...ok, task: '  ' }).error).toBe('task is empty.')
    expect(spawnToolInput({ ...ok, task: 'plugin' }).error).toContain('one-word task')
    expect(spawnToolInput({ ...ok, cwd: 'wt-1' }).error).toContain('absolute')
    expect(spawnToolInput(undefined).error).toContain('run must be')
  })

  test('a name already on screen is not doubled', async () => {
    expect(spawnToolInput(ok, [{ name: 'agt-k7f2ab-exec-1' }] as never).error).toContain('already open')
  })

  test('close targets only owned agt- panes in the lead\'s tab', async () => {
    const live = [{ id: 'w1:p5', name: 'agt-k7f2ab-exec-1', tab: 't1' }, { id: 'w1:p6', name: 'agt-k7f2ab-exec-2', tab: 't2' }, { id: 'w1:p7', name: 'agt-k7f2ab-spawn', tab: 't1' }]
    expect(closeTarget({ name: 'agt-k7f2ab-exec-1' }, live as never, 't1')).toEqual({ pane: live[0] })
    expect(closeTarget({ name: 'agt-k7f2ab-exec-2' }, live as never, 't1').error).toContain('No pane named')
    expect(closeTarget({ name: 'agt-k7f2ab-exec-2' }, live as never, null)).toEqual({ pane: live[1] })
    expect(closeTarget({ name: 'agt-k7f2ab-spawn' }, live as never, 't1').error).toContain('typed /agt-spawn')
    expect(closeTarget({ name: 'build' }, live as never).error).toContain('agt-<run>-<role>')
  })
})

describe('pane tools: in the mod', () => {
  const T = '\t'
  const setup = (on: any, vars: Record<string, string>, table: Record<string, any> = {}) => {
    const seen: string[][] = []
    const tools: string[] = []
    on('env.get', async ($: any, e: any) => ({ value: vars[e.name] }))
    on('session.cwd', async () => ({ value: '/work/repo' }))
    on('session.start', async ($: any, e: any) => ({ cwd: e.cwd }))
    on('command.register', async () => ({ value: undefined }))
    on('tool.register', async ($: any, e: any) => { tools.push(e.name); return { value: { tool: 'mcp__agentille__' + e.name } } })
    on('fs.read', async () => ({ deny: 'no profile' }))
    on('fs.exists', async () => ({ value: false }))
    on('fs.stat', async ($: any, e: any) => (e.path.startsWith('/work/') ? { value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false } } : { deny: 'ENOENT' }))
    on('store.get', async () => ({ value: undefined }))
    on('ui.panes', async () => ({ value: [] }))
    on('agent.spawn', async ($: any, e: any) => ({ model: e.model ?? 'sonnet', agentId: 'ag' + seen.length }))
    on('process.run', async ($: any, e: any) => {
      seen.push(e.argv)
      const key = Object.keys(table).find((k) => e.argv.join(' ').startsWith(k))
      const v = key === undefined ? {} : typeof table[key] === 'function' ? table[key]() : table[key]
      return { value: { exitCode: 0, stdout: '', stderr: '', ...v } }
    })
    mock.clock(on, { now: 1_000_000 })
    return { seen, tools }
  }
  const TMUX = { TMUX: '/tmp/tmux-1/default,1,0', TMUX_PANE: '%1', SHELL: '/bin/zsh', HOME: '/h' }
  const EXEC = { agent: 'executor', header: '[agt run=k7f2ab size=small mode=build]' }
  const spawn = ($: any, input: Record<string, unknown>) => $.tool.call({ tool: 'mcp__agentille__spawn_pane', ...input })
  const close = ($: any, name: string) => $.tool.call({ tool: 'mcp__agentille__close_pane', name })

  test('a lead with a transport registers both tools; no transport registers none', async ($, on) => {
    const a = setup(on, TMUX, { 'tmux list-panes': { stdout: ['%1', '', 'claude', '0', '@1'].join(T) + '\n' } })
    await $.session.start({ cwd: '/work/repo', surface: null, isInteractive: false })
    expect(a.tools).toEqual(['spawn_pane', 'close_pane'])
  })

  test('no transport: none registered', async ($, on) => {
    const a = setup(on, {})
    await $.session.start({ cwd: '/work/repo', surface: null, isInteractive: false })
    expect(a.tools).toEqual([])
  })

  test('a worker pane registers no tools', async ($, on) => {
    const a = setup(on, TMUX, { 'tmux list-panes': { stdout: ['%1', 'agt-k7f2ab-exec-1', 'claude', '0', '@1'].join(T) + '\n' } })
    await $.session.start({ cwd: '/work/repo', surface: null, isInteractive: false })
    expect(a.tools).toEqual([])
  })

  test('tmux: spawn opens a tagged pane in the worktree on the routed model, not the asked one', async ($, on) => {
    const { seen } = setup(on, TMUX, { 'tmux split-window': { stdout: '%9\n' } })
    const r = await spawn($, { run: 'k7f2ab', role: 'exec-1', task: 'build the filter', model: 'haiku', cwd: '/work/wt-1', ...EXEC })
    expect(r.result).toBe('Opened agt-k7f2ab-exec-1 · sonnet · medium · tmux pane.')
    const split = seen.find((a) => a[1] === 'split-window')!
    expect(split[split.indexOf('-c') + 1]).toBe('/work/wt-1')
    expect(split.slice(-10)).toEqual(['--agent', 'agentille:agentille-executor', '--model', 'sonnet', '--effort', 'medium', '-n', 'agt-k7f2ab-exec-1', '--', 'build the filter'])
  })

  test('herdr: spawn splits, starts with model and effort, and prompts', async ($, on) => {
    const { seen } = setup(on, { HERDR_ENV: '1', HERDR_PANE_ID: 'w1:p1' }, { 'herdr pane split': { stdout: JSON.stringify({ result: { pane: { pane_id: 'w1:p5' } } }) } })
    const r = await spawn($, { run: 'k7f2ab', role: 'exec-1', task: 'build the filter', ...EXEC })
    expect(r.result).toBe('Opened agt-k7f2ab-exec-1 · sonnet · medium · herdr pane.')
    const start = seen.find((a) => a.slice(0, 4).join(' ') === 'herdr agent start agt-k7f2ab-exec-1')!
    expect(start.slice(-6)).toEqual(['--agent', 'agentille:agentille-executor', '--model', 'sonnet', '--effort', 'medium'])
    expect(seen.some((a) => a.slice(0, 3).join(' ') === 'herdr agent prompt' && a[4] === 'build the filter')).toBe(true)
    const split = seen.find((a) => a.slice(0, 3).join(' ') === 'herdr pane split')!
    expect(split[split.indexOf('AGENTILLE_WORKER=executor:sonnet:medium') - 1]).toBe('--env')
  })

  test('herdr: the second worker splits down from the first', async ($, on) => {
    const { seen } = setup(on, { HERDR_ENV: '1', HERDR_PANE_ID: 'w1:p1' }, {
      'herdr pane split': { stdout: JSON.stringify({ result: { pane: { pane_id: 'w1:p5' } } }) },
      'herdr agent list': { stdout: JSON.stringify({ result: { agents: [{ name: 'agt-k7f2ab-exec-1', pane_id: 'w1:p5', agent: 'claude', agent_status: 'working', state_change_seq: 1 }] } }) },
    })
    await spawn($, { run: 'k7f2ab', role: 'exec-1', task: 'build one', ...EXEC })
    await spawn($, { run: 'k7f2ab', role: 'exec-2', task: 'build two', ...EXEC })
    const splits = seen.filter((a) => a.slice(0, 3).join(' ') === 'herdr pane split')
    expect(splits[0].slice(splits[0].indexOf('--pane'), splits[0].indexOf('--pane') + 4)).toEqual(['--pane', 'w1:p1', '--direction', 'right'])
    expect(splits[1].slice(splits[1].indexOf('--pane'), splits[1].indexOf('--pane') + 4)).toEqual(['--pane', 'w1:p5', '--direction', 'down'])
  })

  test('the adversary is a pane too, and the worker env names its agent', async ($, on) => {
    const { seen } = setup(on, TMUX, { 'tmux split-window': { stdout: '%9\n' } })
    const r = await spawn($, { run: 'k7f2ab', role: 'adv', task: 'break the filter', agent: 'adversary', header: '[agt run=k7f2ab size=small mode=build]' })
    expect(r.result).toMatch(/^Opened agt-k7f2ab-adv · \w+ · \w+ · tmux pane\./)
    const split = seen.find((a) => a[1] === 'split-window')!
    expect(split.some((x) => x.startsWith('AGENTILLE_WORKER=adversary:'))).toBe(true)
  })

  test('reviewers, even on opus, and the planning roles are denied and open nothing', async ($, on) => {
    const { seen } = setup(on, TMUX, { 'tmux split-window': { stdout: '%9\n' } })
    const big = await spawn($, { run: 'k7f2ab', role: 'review', task: 'review the diff', agent: 'code-reviewer', header: '[agt run=k7f2ab size=large mode=review]' })
    expect(big.deny).toContain('code-reviewer runs as a subagent')
    const small = await spawn($, { run: 'k7f2ab', role: 'review', task: 'review the diff', agent: 'code-reviewer', header: '[agt run=k7f2ab size=small mode=review]' })
    expect(small.deny).toContain('subagent')
    const plan = await spawn($, { run: 'k7f2ab', role: 'plan', task: 'plan the work', agent: 'planner', header: '[agt run=k7f2ab size=large mode=build]' })
    expect(plan.deny).toContain('planner')
    expect(seen.some((a) => a[1] === 'split-window')).toBe(false)
  })

  test('a fix-mode executor reaches effort high on its second pane, with the reason', async ($, on) => {
    setup(on, TMUX, { 'tmux split-window': { stdout: '%9\n' } })
    const fix = { agent: 'executor', header: '[agt run=k7f2ab size=small mode=fix]' }
    expect((await spawn($, { run: 'k7f2ab', role: 'fix-1', task: 'fix it', ...fix })).result).toBe('Opened agt-k7f2ab-fix-1 · sonnet · medium · tmux pane.')
    expect((await spawn($, { run: 'k7f2ab', role: 'fix-2', task: 'fix it again', ...fix })).result).toBe('Opened agt-k7f2ab-fix-2 · sonnet · high · tmux pane. (fix attempt 2)')
  })

  test('a failed split is not a fix attempt', async ($, on) => {
    setup(on, TMUX, { 'tmux split-window': { exitCode: 1 } })
    const fix = { agent: 'executor', header: '[agt run=k7f2ab size=small mode=fix]' }
    expect((await spawn($, { run: 'k7f2ab', role: 'fix-1', task: 'fix it', ...fix })).deny).toContain('Could not open')
    await $.agent.spawn({ prompt: '[agt run=k7f2ab size=small mode=fix]\nfix', subagentType: 'agentille:agentille-executor' })
    expect((await $.command.run({ command: 'agt-routing' })).text).toBe('executor → sonnet · medium')
  })

  test('a forced fable security-reviewer is refused as a pane and records nothing', async ($, on) => {
    const { seen } = setup(on, TMUX, { 'tmux split-window': { stdout: '%9\n' } })
    const sets: any[] = []
    on('store.set', async ($: any, e: any) => { sets.push(e); return { value: undefined } })
    const r = await spawn($, { run: 'k7f2ab', role: 'sec', task: 'audit the diff', agent: 'security-reviewer', header: '[agt run=k7f2ab size=large risk=auth mode=review fable=forced]' })
    expect(r.deny).toContain('security-reviewer runs as a subagent')
    expect(seen.some((a) => a[1] === 'split-window')).toBe(false)
    expect(sets).toEqual([])
  })

  test('the routing record lands in routing.jsonl as a pane', async ($, on) => {
    setup(on, TMUX, { 'tmux split-window': { stdout: '%9\n' } })
    const writes: any[] = []
    on('fs.write', async ($: any, e: any) => { writes.push(e); return { value: undefined } })
    await $.session.start({ cwd: '/work/repo', surface: null, isInteractive: false })
    await spawn($, { run: 'k7f2ab', role: 'exec-1', task: 'build the filter', ...EXEC })
    const w = writes.find((x) => x.path.endsWith('routing.jsonl'))
    expect(w.text).toContain('"kind":"pane"')
    expect(w.text).toContain('"pane":"agt-k7f2ab-exec-1"')
  })

  test('tmux layout: right of the lead first, then down from the newest worker, evened out', async ($, on) => {
    const rows = [['%1', '', 'claude', '0', '@1']]
    const { seen } = setup(on, TMUX, {
      'tmux split-window': { stdout: '%9\n' },
      'tmux list-panes': () => ({ stdout: rows.map((r) => r.join(T)).join('\n') + '\n' }),
    })
    await spawn($, { run: 'k7f2ab', role: 'exec-1', task: 'build one', ...EXEC })
    rows.push(['%9', 'agt-k7f2ab-exec-1', 'claude', '0', '@1'])
    await spawn($, { run: 'k7f2ab', role: 'exec-2', task: 'build two', ...EXEC })
    const splits = seen.filter((a) => a[1] === 'split-window')
    const target = (a: string[]) => a.slice(a.indexOf('-t'), a.indexOf('-t') + 2)
    expect(splits[0]).toContain('-h')
    expect(target(splits[0])).toEqual(['-t', '%1'])
    expect(splits[1]).toContain('-v')
    expect(target(splits[1])).toEqual(['-t', '%9'])
    expect(seen.some((a) => a.join(' ') === 'tmux select-layout -E -t %9')).toBe(true)
    expect(seen.some((a) => a[1] === 'display-message')).toBe(false)
  })

  test('refusals open nothing: fable, a missing directory, no transport', async ($, on) => {
    const { seen } = setup(on, TMUX)
    expect((await spawn($, { run: 'k7f2ab', role: 'exec-1', task: 'do the thing', model: 'fable', ...EXEC })).deny).toContain('routing guard')
    expect((await spawn($, { run: 'k7f2ab', role: 'exec-1', task: 'do the thing', cwd: '/nope', ...EXEC })).deny).toBe('/nope is not a directory.')
    expect(seen.some((a) => a[1] === 'split-window')).toBe(false)
  })

  test('no transport refuses the call', async ($, on) => {
    setup(on, {})
    expect((await spawn($, { run: 'k7f2ab', role: 'exec-1', task: 'do the thing', ...EXEC })).deny).toContain('No pane transport')
  })

  test('close: kills an owned worker, refuses a typed spawn pane and strangers', async ($, on) => {
    const rows = [['%1', '', 'claude', '0', '@1'], ['%5', 'agt-k7f2ab-exec-1', 'claude', '0', '@1'], ['%6', 'agt-k7f2ab-spawn', 'claude', '0', '@1'], ['%7', 'agt-k7f2ab-exec-2', 'claude', '0', '@2']]
    const { seen } = setup(on, TMUX, { 'tmux list-panes': () => ({ stdout: rows.map((r) => r.join(T)).join('\n') + '\n' }) })
    expect((await close($, 'agt-k7f2ab-exec-1')).result).toBe('Closed agt-k7f2ab-exec-1.')
    expect(seen.some((a) => a.join(' ') === 'tmux kill-pane -t %5')).toBe(true)
    expect((await close($, 'agt-k7f2ab-spawn')).deny).toContain('typed /agt-spawn')
    expect((await close($, 'agt-k7f2ab-exec-2')).deny).toContain('No pane named')
    expect(seen.filter((a) => a[1] === 'kill-pane').length).toBe(1)
  })
})

describe('herdr reaper', () => {
  const FRESH = Number.MAX_SAFE_INTEGER
  const LEAD = { name: 'lead', pane_id: 'w1:p1', agent: 'claude', agent_status: 'working', state_change_seq: 1, tab_id: 'w1:t1', workspace_id: 'w1' }
  const pane = (name: string, id: string, state: string) => ({ name, pane_id: id, agent: 'claude', agent_status: state, state_change_seq: 4, tab_id: 'w1:t1', workspace_id: 'w1' })
  const ANSWER = '/h/.agentille/state/run-r9/agents/pane-executor.md'
  // What a worker in pane w1:p2 sends: the lead reads which pane reported from the answer path.
  const WIRE_DONE = '[agt wire] agt-r9-executor done · 0:10\nBuilt it\nFull answer: /h/.agentille/state/run-r9/agents/pane-executor.w1-p2.md'

  // session.start polls once and starts the 5 s poll; `closed` collects `herdr pane close` ids, `files` maps a path to its
  // mtime (the files named up front are written in the far future, so always fresh), `agents` is what `herdr agent list`
  // shows (a test flips a pane's agent_status), `toasts` every toast, `sent` every session.send.
  const lead = async ($: any, on: any, state: string, files: string[] = [ANSWER], twin = false) => {
    const closed: string[] = []
    const toasts: string[] = []
    const sent: any[] = []
    const mtimes = new Map(files.map((f) => [f, FRESH]))
    const agents = [pane('agt-r9-executor', 'w1:p2', state)]
    if (twin) agents.push(pane('agt-r9-executor', 'w1:p3', state)) // a second pane of the same role, listed from the first poll
    let splits = 3
    let reuse: string | null = null
    let blind = false // `herdr agent list` fails while set
    on('env.get', async ($: any, e: any) => ({ value: ({ HERDR_ENV: '1', HERDR_PANE_ID: 'w1:p1', HOME: '/h' } as any)[e.name] }))
    on('session.start', async ($: any, e: any) => ({ cwd: e.cwd }))
    on('session.id', async () => ({ value: 'lead-sid' }))
    on('session.cwd', async () => ({ value: '/work/repo' }))
    on('command.register', async () => ({ value: undefined }))
    on('tool.register', async () => ({ value: undefined }))
    on('ui.toast', async ($: any, e: any) => { toasts.push(e.text); return { value: undefined } })
    on('fs.read', async () => ({ deny: 'no profile' }))
    on('fs.exists', async () => ({ value: false }))
    on('fs.stat', async ($: any, e: any) => (mtimes.has(e.path) ? { value: { kind: 'file', size: 0, mtimeMs: mtimes.get(e.path), isLink: false } } : { deny: 'ENOENT' }))
    on('store.get', async () => ({ value: undefined }))
    on('session.send', async ($: any, e: any) => { sent.push(e); return { isDelivered: true } })
    on('session.receive', async ($: any, e: any) => ({ text: e.text }) as never)
    on('turn.start', async ($: any, e: any) => ({ turnId: e.turnId }))
    on('turn.complete', async ($: any, e: any) => ({ text: e.answer }))
    on('ui.render', async () => ({ type: 'engine', ref: 0 }) as never)
    on('process.run', async ($: any, e: any) => {
      const cmd = e.argv.join(' ')
      let stdout = ''
      if (cmd.startsWith('herdr agent list') && blind) return { value: { exitCode: 1, stdout: '', stderr: 'down' } }
      if (cmd.startsWith('herdr agent list')) stdout = JSON.stringify({ result: { agents: [LEAD, ...agents] } })
      if (cmd.startsWith('herdr pane split')) {
        stdout = JSON.stringify({ result: { pane: { pane_id: reuse ?? 'w1:p' + splits++ } } })
        reuse = null
      }
      if (cmd.startsWith('herdr agent start')) agents.push(pane(e.argv[3], e.argv[7], 'working'))
      if (cmd.startsWith('herdr pane close')) {
        closed.push(e.argv[3])
        const i = agents.findIndex((a) => a.pane_id === e.argv[3])
        if (i >= 0) agents.splice(i, 1)
      }
      return { value: { exitCode: 0, stdout, stderr: '' } }
    })
    const clock = mock.clock(on, { now: 1_000_000 })
    await $.session.start({ cwd: '/w', surface: null, isInteractive: false })
    return { closed, clock, toasts, sent, files: mtimes, agents, reuseId: (id: string) => { reuse = id }, blind: (b: boolean) => { blind = b } }
  }
  const begin = ($: any) => $.turn.start({ text: 'go', turnId: 't1' })
  const end = ($: any) => $.turn.complete({ answer: 'ok', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' })
  // A role can be respawned (a fix, a retry): the second pane of agt-r9-executor is a new worker.
  const respawn = ($: any) => $.tool.call({ tool: 'mcp__agentille__spawn_pane', run: 'r9', role: 'executor', task: 'redo the filter, tests first', agent: 'executor', header: '[agt run=r9 size=small mode=build]' })
  const finish = (l: any, id: string) => { l.agents.find((a: any) => a.pane_id === id).agent_status = 'done' }
  const flagged = (l: any) => l.toasts.filter((t: string) => t.includes('agt-r9-executor done, not harvested')).length

  test('idle reaps only between lead turns, done reaps at 90 s (answer harvested)', async ($, on) => {
    const idle = await lead($, on, 'idle')
    await begin($)
    await idle.clock.advance(400_000)
    expect(idle.closed).toEqual([])
    await end($)
    await idle.clock.advance(10_000)
    expect(idle.closed).toEqual(['w1:p2'])
  })

  test('a done pane is reaped at 90 s even while the lead works (answer harvested)', async ($, on) => {
    const done = await lead($, on, 'done')
    await begin($)
    await done.clock.advance(85_000)
    expect(done.closed).toEqual([])
    await done.clock.advance(10_000)
    expect(done.closed).toEqual(['w1:p2'])
  })

  test('a done pane whose answer was never harvested stays open and is flagged once', async ($, on) => {
    const done = await lead($, on, 'done', [])
    await done.clock.advance(600_000)
    expect(done.closed).toEqual([])
    expect(done.toasts.filter((t) => t.includes('agt-r9-executor done, not harvested'))).toHaveLength(1)
  })

  test('an unharvested idle pane is not reaped between turns either, and the flag says idle', async ($, on) => {
    const idle = await lead($, on, 'idle', [])
    await idle.clock.advance(900_000)
    expect(idle.closed).toEqual([])
    expect(idle.toasts.filter((t) => t.includes('agt-r9-executor idle, not harvested'))).toHaveLength(1)
    expect(idle.toasts.filter((t) => t.includes('done, not harvested'))).toEqual([])
  })

  test('the pane is reaped once its answer file appears', async ($, on) => {
    const done = await lead($, on, 'done', [])
    await done.clock.advance(200_000)
    expect(done.closed).toEqual([])
    done.files.set(ANSWER, FRESH)
    await done.clock.advance(10_000)
    expect(done.closed).toEqual(['w1:p2'])
  })

  test('a wire done message from the pane counts as harvested', async ($, on) => {
    const done = await lead($, on, 'done', [])
    await done.clock.advance(100_000)
    expect(done.closed).toEqual([])
    await $.session.receive({ text: WIRE_DONE, origin: { kind: 'peer' } } as never)
    await done.clock.advance(10_000)
    expect(done.closed).toEqual(['w1:p2'])
  })

  test('the lead wakes itself once when a pane finishes without a wire message', async ($, on) => {
    const done = await lead($, on, 'done', [])
    await done.clock.advance(15_000)
    expect(done.sent).toEqual([])
    await done.clock.advance(10_000)
    expect(done.sent).toHaveLength(1)
    expect(JSON.stringify(done.sent[0].to)).toContain('lead-sid')
    expect(done.sent[0].text).toContain('agt-r9-executor finished and has not reported')
    expect(done.sent[0].text).toContain('herdr agent read agt-r9-executor --source recent-unwrapped --lines 200')
    await done.clock.advance(300_000)
    expect(done.sent).toHaveLength(1)
  })

  test('a blocked pane waits on the person: no wake, until it finishes without reporting', { timeoutMs: 30_000 }, async ($, on) => {
    const l = await lead($, on, 'blocked', [])
    await l.clock.advance(60_000)
    expect(l.sent).toEqual([])
    finish(l, 'w1:p2')
    await l.clock.advance(15_000)
    expect(l.sent).toEqual([])
    await l.clock.advance(10_000)
    expect(l.sent).toHaveLength(1)
    expect(l.sent[0].text).toContain('agt-r9-executor finished and has not reported')
    expect(l.sent[0].text).not.toContain('blocked')
    await l.clock.advance(300_000)
    expect(l.sent).toHaveLength(1)
  })

  test('a working pane never wakes the lead', async ($, on) => {
    const w = await lead($, on, 'working', [])
    await w.clock.advance(120_000)
    expect(w.sent).toEqual([])
  })

  test('a wire done message inside the window means no self-wake', async ($, on) => {
    const done = await lead($, on, 'done', [])
    await done.clock.advance(10_000)
    await $.session.receive({ text: WIRE_DONE, origin: { kind: 'peer' } } as never)
    await done.clock.advance(60_000)
    expect(done.sent).toEqual([])
  })

  test('the band shows the stranded pane as a flag', async ($, on) => {
    const done = await lead($, on, 'done', [])
    await done.clock.advance(100_000)
    const ui = await $.ui.mount({ plugin: 'agentille', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100 } as never })
    expect(await ui.find({ type: 'Text', text: /⚑ agt-r9-executor done, not harvested/ })).toBeDefined()
    await ui.unmount()
  })

  test('a respawned role starts unharvested: woken, flagged and kept open like any new pane', { timeoutMs: 30_000 }, async ($, on) => {
    const l = await lead($, on, 'done', [])
    await l.clock.advance(25_000)
    expect(l.sent).toHaveLength(1)
    await l.clock.advance(70_000)
    expect(flagged(l)).toBe(1)
    expect((await $.tool.call({ tool: 'mcp__agentille__close_pane', name: 'agt-r9-executor' })).result).toBe('Closed agt-r9-executor.')
    expect(l.closed).toEqual(['w1:p2'])
    expect((await respawn($)).result).toMatch(/^Opened agt-r9-executor/)
    finish(l, 'w1:p3')
    await l.clock.advance(25_000)
    expect(l.sent).toHaveLength(2)
    await l.clock.advance(70_000)
    expect(flagged(l)).toBe(2)
    expect(l.closed).toEqual(['w1:p2'])
  })

  test('a respawn after a wire report is not taken for reported: it wakes the lead if it goes quiet', { timeoutMs: 30_000 }, async ($, on) => {
    const l = await lead($, on, 'done', [])
    await $.session.receive({ text: WIRE_DONE, origin: { kind: 'peer' } } as never)
    await l.clock.advance(100_000)
    expect(l.closed).toEqual(['w1:p2'])
    expect(l.sent).toEqual([])
    expect((await respawn($)).result).toMatch(/^Opened agt-r9-executor/)
    finish(l, 'w1:p3')
    await l.clock.advance(25_000)
    expect(l.sent).toHaveLength(1)
    expect(l.sent[0].text).toContain('agt-r9-executor finished and has not reported')
    await l.clock.advance(70_000)
    expect(l.closed).toEqual(['w1:p2'])
  })

  test('the earlier pane\'s answer file does not harvest the respawn, a fresh one does', { timeoutMs: 30_000 }, async ($, on) => {
    const l = await lead($, on, 'done', [])
    l.files.set(ANSWER, l.clock.now()) // the first worker saved its answer as it finished
    await l.clock.advance(100_000)
    expect(l.closed).toEqual(['w1:p2'])
    expect((await respawn($)).result).toMatch(/^Opened agt-r9-executor/)
    finish(l, 'w1:p3')
    await l.clock.advance(100_000)
    expect(l.closed).toEqual(['w1:p2'])
    expect(flagged(l)).toBe(1)
    expect(l.sent.at(-1).text).not.toContain('saved at')
    expect(l.sent.at(-1).text).toContain('Read it with:')
    l.files.set(ANSWER, l.clock.now() + 1) // the second worker saves its own
    await l.clock.advance(10_000)
    expect(l.closed).toEqual(['w1:p2', 'w1:p3'])
  })

  describe('two panes of one role', () => {
    const W = (id: string, key = id.replace(':', '-')) => '/h/.agentille/state/run-r9/agents/pane-executor.' + key + '.md'
    // w1:p2 (the old pane) and w1:p3 (the respawn) both stay open and both finish.
    const twin = ($: any, on: any, files: string[]) => lead($, on, 'done', files, true)

    test('only the instance whose own answer exists is reaped', { timeoutMs: 30_000 }, async ($, on) => {
      const l = await twin($, on, [W('w1:p3')])
      await l.clock.advance(95_000)
      expect(l.closed).toEqual(['w1:p3'])
      expect(flagged(l)).toBe(1)
    })

    test('the old pane\'s own file harvests it, and not the other pane', { timeoutMs: 30_000 }, async ($, on) => {
      const l = await twin($, on, [W('w1:p2')])
      await l.clock.advance(95_000)
      expect(l.closed).toEqual(['w1:p2'])
      expect(flagged(l)).toBe(1)
    })

    test('a legacy answer file with a shared name harvests neither', { timeoutMs: 30_000 }, async ($, on) => {
      const l = await twin($, on, [ANSWER])
      await l.clock.advance(200_000)
      expect(l.closed).toEqual([])
      expect(flagged(l)).toBe(2) // once per pane
    })

    test('the legacy file counts again once the name is unique', { timeoutMs: 30_000 }, async ($, on) => {
      const l = await twin($, on, [ANSWER])
      await l.clock.advance(100_000)
      expect(l.closed).toEqual([])
      l.agents.splice(1, 1) // w1:p3 goes away
      await l.clock.advance(10_000)
      expect(l.closed).toEqual(['w1:p2'])
    })

    test('a done message naming a pane the list lacks does not harvest the one it does list', { timeoutMs: 30_000 }, async ($, on) => {
      const l = await lead($, on, 'done', []) // a stale list: only w1:p2
      await $.session.receive({ text: '[agt wire] agt-r9-executor done · 0:10\nBuilt it\nFull answer: ' + W('w1:p3'), origin: { kind: 'peer' } } as never)
      await l.clock.advance(100_000)
      expect(l.closed).toEqual([])
      expect(flagged(l)).toBe(1)
    })

    test('a done message from another role carrying this pane\'s key does not harvest it', { timeoutMs: 30_000 }, async ($, on) => {
      const l = await lead($, on, 'done', [])
      await $.session.receive({ text: '[agt wire] agt-r9-other done · 0:10\nBuilt it\nFull answer: ' + W('w1:p2'), origin: { kind: 'peer' } } as never)
      await l.clock.advance(100_000)
      expect(l.closed).toEqual([])
      expect(flagged(l)).toBe(1)
    })

    test('a done message with no Full answer line harvests nothing', { timeoutMs: 30_000 }, async ($, on) => {
      const l = await lead($, on, 'done', [])
      await $.session.receive({ text: '[agt wire] agt-r9-executor done · 0:10\nBuilt it', origin: { kind: 'peer' } } as never)
      await l.clock.advance(100_000)
      expect(l.closed).toEqual([])
      expect(flagged(l)).toBe(1)
    })

    test('a done message harvests the pane it names, and the lead is not woken for that pane', { timeoutMs: 30_000 }, async ($, on) => {
      const l = await twin($, on, [])
      await $.session.receive({ text: '[agt wire] agt-r9-executor done · 0:10\nBuilt it\nFull answer: ' + W('w1:p3'), origin: { kind: 'peer' } } as never)
      await l.clock.advance(95_000)
      expect(l.closed).toEqual(['w1:p3'])
      expect(l.sent).toHaveLength(1) // one wake, for the pane that did not report
    })
  })

  test('a pane id the multiplexer hands out again is a new pane: the old sighting is forgotten', { timeoutMs: 30_000 }, async ($, on) => {
    const l = await lead($, on, 'done', [])
    l.files.set(ANSWER, l.clock.now())
    await l.clock.advance(100_000)
    expect(l.closed).toEqual(['w1:p2'])
    l.reuseId('w1:p2')
    expect((await respawn($)).result).toMatch(/^Opened agt-r9-executor/)
    finish(l, 'w1:p2')
    await l.clock.advance(100_000)
    expect(l.closed).toEqual(['w1:p2'])
    expect(flagged(l)).toBe(1)
  })

  test('a new pane that gets an id whose owner no poll saw leave starts unharvested', { timeoutMs: 30_000 }, async ($, on) => {
    const l = await lead($, on, 'done', [])
    l.agents[0].name = 'agt-r9-planner' // w1:p2 is the planner for now
    const mine = '/h/.agentille/state/run-r9/agents/pane-planner.w1-p2.md'
    const older = '/h/.agentille/state/run-r9/agents/pane-executor.w1-p2.md' // an earlier executor held w1:p2 too
    l.files.set(mine, l.clock.now())
    l.files.set(older, l.clock.now())
    await l.clock.advance(10_000) // the planner's pane is harvested
    l.blind(true) // the list call fails as the planner goes: no poll sees it leave
    l.agents.splice(0, 1)
    l.reuseId('w1:p2')
    expect((await respawn($)).result).toMatch(/^Opened agt-r9-executor/)
    finish(l, 'w1:p2')
    l.blind(false)
    await l.clock.advance(100_000)
    expect(l.closed).toEqual([])
    expect(flagged(l)).toBe(1)
  })
})

import { focusArgv, herdrMetaArgv, herdrSplitArgv as split2, tmuxSplitArgv as tsplit2 } from '../../hooks/panes.js'

describe('switchboard pane helpers', () => {
  test('wire env rides the split; herdr metadata and focus argv', async () => {
    const h = split2({ pane: 'w:p1', cwd: '/r', run: 'r1', agent: 'executor', model: 'sonnet', effort: 'high', env: ['AGENTILLE_NAME=agt-r1-exec-1'] })
    expect(h.slice(h.indexOf('AGENTILLE_NAME=agt-r1-exec-1') - 1, h.indexOf('AGENTILLE_NAME=agt-r1-exec-1') + 1)).toEqual(['--env', 'AGENTILLE_NAME=agt-r1-exec-1'])
    expect(h[h.length - 1]).toBe('--no-focus')
    const t = tsplit2({ target: '%1', cwd: '/r', run: 'r1', shell: '/bin/sh', model: 'sonnet', name: 'agt-r1-exec-1', task: 'do it', env: ['AGENTILLE_LEAD=s1'] })
    expect(t).toContain('AGENTILLE_LEAD=s1')
    expect(herdrMetaArgv('w:p2', { display: '▣ exec-1 · sonnet' })).toEqual(['herdr', 'pane', 'report-metadata', 'w:p2', '--source', 'agentille', '--display-agent', '▣ exec-1 · sonnet'])
    expect(herdrMetaArgv('w:p2', {})).toBe(null)
    expect(focusArgv('herdr', { name: 'agt-r1-exec-1' })).toEqual(['herdr', 'agent', 'focus', 'agt-r1-exec-1'])
    expect(focusArgv('tmux', { id: '%4' })).toEqual(['tmux', 'select-pane', '-t', '%4'])
    expect(focusArgv('tmux', { id: 'bad' })).toBe(null)
    expect(focusArgv('none', { name: 'x' })).toBe(null)
  })
})

describe('herdr start race', () => {
  test('a pane still busy with its shell start is retried, then the worker starts', async ($, on) => {
    const seen: string[][] = []
    let busy = 2
    on('env.get', async ($: any, e: any) => ({ value: ({ HERDR_ENV: '1', HERDR_PANE_ID: 'w1:p1', HOME: '/h' } as any)[e.name] }))
    on('session.start', async ($: any, e: any) => ({ cwd: e.cwd }))
    on('session.cwd', async () => ({ value: '/w' }))
    on('command.register', async () => ({ value: undefined }))
    on('fs.read', async () => ({ deny: 'no profile' }))
    on('store.get', async () => ({ value: undefined }))
    on('process.run', async ($: any, e: any) => {
      seen.push(e.argv)
      const cmd = e.argv.slice(0, 3).join(' ')
      if (cmd === 'herdr pane split') return { value: { exitCode: 0, stdout: JSON.stringify({ result: { pane: { pane_id: 'w1:p5' } } }), stderr: '' } }
      if (cmd === 'herdr agent start' && busy-- > 0) return { value: { exitCode: 1, stdout: '', stderr: '{"error":{"code":"agent_pane_busy"}}' } }
      if (cmd === 'herdr agent list') return { value: { exitCode: 0, stdout: JSON.stringify({ result: { agents: [] } }), stderr: '' } }
      return { value: { exitCode: 0, stdout: '', stderr: '' } }
    })
    const clock = mock.clock(on, { now: 1_000_000 })
    await $.session.start({ cwd: '/w', surface: null, isInteractive: false })
    const pending = $.command.run({ command: 'agt-spawn', args: '"do the thing"', origin: { kind: 'composer' } } as never)
    for (let i = 0; i < 4; i++) await clock.advance(500)
    const r = await pending
    expect(r.text).toMatch(/^Opened agt-[a-z0-9]{6}-spawn · sonnet · herdr pane\.$/)
    expect(seen.filter((a) => a.slice(0, 3).join(' ') === 'herdr agent start').length).toBe(3)
    expect(seen.some((a) => a[1] === 'pane' && a[2] === 'close')).toBe(false)
  })
})

describe('advisor opt-out', () => {
  test('only Opus and Fable workers lose the advisor, and only when asked', () => {
    const off = 'CLAUDE_CODE_DISABLE_ADVISOR_TOOL=1'
    expect(advisorEnv('opus', { advisorOnOpus: false })).toEqual([off])
    expect(advisorEnv('fable', { advisorOnOpus: false })).toEqual([off])
    expect(advisorEnv('sonnet', { advisorOnOpus: false })).toEqual([])
    expect(advisorEnv('opus', { advisorOnOpus: true })).toEqual([])
    expect(advisorEnv('opus', {})).toEqual([])
    expect(advisorEnv('opus', undefined)).toEqual([])
  })
  test('the env reaches both transports', () => {
    const env = advisorEnv('opus', { advisorOnOpus: false })
    expect(tmuxSplitArgv({ target: '%1', cwd: '/w', run: 'ab12cd', shell: '/bin/zsh', model: 'opus', name: 'agt-ab12cd-planner', task: 't', env })).toContain('CLAUDE_CODE_DISABLE_ADVISOR_TOOL=1')
    expect(herdrSplitArgv({ pane: 'p1', cwd: '/w', run: 'ab12cd', model: 'opus', env })).toContain('CLAUDE_CODE_DISABLE_ADVISOR_TOOL=1')
  })
})

import { CLOSE_TOOL as closeTool, SPAWN_TOOL as spawnTool } from '../../hooks/panes.js'

describe('panes: tools load eagerly', () => {
  test('spawn_pane and close_pane are never deferred behind tool search', async () => {
    expect(spawnTool.isDeferred).toBe(false)
    expect(closeTool.isDeferred).toBe(false)
  })
})

import { answerFile, paneKey } from '../../hooks/panes.js'

describe('pane instance keys', () => {
  test('a pane id becomes a filename-safe key, or null', () => {
    expect(paneKey('w1:p3')).toBe('w1-p3')
    expect(paneKey('%5')).toBe('5')
    expect(paneKey('')).toBe(null)
    expect(paneKey(null)).toBe(null)
    expect(paneKey('::')).toBe(null)
    expect(paneKey('a'.repeat(64))).toBe('a'.repeat(64))
    expect(paneKey('a'.repeat(70))).toBe(null)
  })

  test('the answer file is per pane instance; no key is the legacy file; unsafe parts give null', () => {
    expect(answerFile('/h', 'r9', 'executor', 'w1-p3')).toBe('/h/.agentille/state/run-r9/agents/pane-executor.w1-p3.md')
    expect(answerFile('/h', 'r9', 'executor')).toBe('/h/.agentille/state/run-r9/agents/pane-executor.md')
    expect(answerFile(null, 'r9', 'executor', 'w1-p3')).toBe(null)
    expect(answerFile('/h', '../x', 'executor')).toBe(null)
    expect(answerFile('/h', 'r9', 'exec/utor')).toBe(null)
    expect(answerFile('/h', 'r9', 'executor', '../p3')).toBe(null)
  })
})
