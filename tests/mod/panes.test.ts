import { describe, expect, mock, test } from 'claude-code/testing'
import { advisorEnv, EFFORTS, PANE_RULE, splitPlan, tmuxEvenArgv, SPAWN_TOOL, closeTarget, paneRole, doneFile, spawnToolInput, TOOL_MODELS, herdrCloseArgv, herdrPaneIdOf, herdrPromptArgv, herdrSplitArgv, herdrStartArgv, isFreshDone, isLead, newRunId, paneName, parseSpawnArgs, parseTmuxList, pickTransport, quietSpawn, reapPool, scopeRows, splitName, tmuxKillArgv, tmuxPaneAgents, tmuxPaneIdOf, tmuxSplitArgv, tmuxTagArgvs, transportBlock, TMUX_LIST_FORMAT } from '../../hooks/panes.js'
import { agentStatusOf, codexNote, codexTask, dialogKeys, herdrKeysArgv, herdrReadArgv, herdrTabArgv, herdrTabIds, herdrTabListArgv, herdrTabOf, herdrGetArgv, placePlan, screenLine, startupDialog, tabIdsOf, tabsFile } from '../../hooks/panes.js'
import { DONE_GRACE_MS, reapPlan } from '../../hooks/live.js'
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

  test('the pane rule: heavy level only, executor and adversary only, close right after harvest', async () => {
    expect(PANE_RULE).toContain('only on the heavy level')
    expect(PANE_RULE).toContain('/agt heavy')
    expect(PANE_RULE).not.toContain('--mode')
    expect(PANE_RULE).toContain('executor (and the adversary)')
    expect(PANE_RULE).toContain('everyone else is a subagent')
    expect(PANE_RULE).toContain('close_pane right after harvest')
    expect(PANE_RULE.length).toBeLessThan(300)
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

  test('a spawn pane shows as open in the band but keeps its real state for the reaper', async () => {
    const rows = parseTmuxList([row('%1', ''), row('%2', 'agt-ab12cd-spawn'), row('%3', 'agt-ab12cd-spawn', '1')].join('\n'))
    const p = tmuxPaneAgents(rows, '%1', new Map())
    expect(p.map((x) => x.state)).toEqual(['working', 'done'])
    expect(quietSpawn(p).map((x) => x.state)).toEqual(['open', 'open'])
    expect(tmuxPaneAgents(rows, '%1', new Map([['agt-ab12cd-spawn', true]])).map((x) => x.state)).toEqual(['done', 'done'])
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

  test('tmux done waits the done grace through the shared reaper, working never reaps', async () => {
    const rows = parseTmuxList([row('%1', ''), row('%2', 'agt-r1-executor'), row('%3', 'agt-r1-reviewer', '1')].join('\n'))
    const p = tmuxPaneAgents(rows, '%1', new Map())
    const seen = new Map()
    const ok = () => true
    expect(reapPlan(p, seen, 0, true, ok).reap).toEqual([])
    expect(reapPlan(p, seen, DONE_GRACE_MS - 1, true, ok).reap).toEqual([])
    expect(reapPlan(p, seen, DONE_GRACE_MS, true, ok).reap.map((x) => x.id)).toEqual(['%3'])
    expect(reapPlan(p, seen, 10_000_000, true, ok).reap.map((x) => x.id)).toEqual(['%3'])
    expect(reapPlan(p, seen, 10_000_000).reap).toEqual([])
  })

  test('spawn panes are offered to the reaper like any worker, with their real state, in either transport', async () => {
    const herdr = [
      { id: 'w1:p2', role: 'spawn', state: 'done', seq: 1 },
      { id: 'w1:p3', role: 'executor', state: 'done', seq: 1 },
      { id: 'w1:p4', role: 'spawn', state: 'idle', seq: 2 },
    ]
    expect(reapPool(herdr).map((x) => x.id)).toEqual(['w1:p2', 'w1:p3', 'w1:p4'])
    const rows = parseTmuxList([row('%1', ''), row('%2', 'agt-ab12cd-spawn', '1'), row('%3', 'agt-ab12cd-spawn-two', '1')].join('\n'))
    const p = reapPool(tmuxPaneAgents(rows, '%1', new Map()))
    expect(p.map((x) => x.id)).toEqual(['%2', '%3'])
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
    // The window's agt- panes are this lead's own, recorded by its previous session (lead-<pane>.panes).
    const ownFile = '/h/.agentille/state/lead-' + (o.self ?? '%1').replace(/[^A-Za-z0-9_-]/g, '') + '.panes'
    on('fs.read', async ($: any, e: any) => (e.path === ownFile ? { value: rows.map((r) => r.split(T)[1]).filter((n) => n.startsWith('agt-')).join('\n') + '\n' } : { deny: 'no profile' }))
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

  test('a lead kills a done pane only after the 10 s grace, never a working one', { timeoutMs: 15_000 }, async ($, on) => {
    const rows = [row('%1', ''), row('%2', 'agt-r9-executor', '1'), row('%4', 'agt-r9-planner')]
    const { killed, clock } = await start($, on, { rows, mtimes: { [ANSWER('executor')]: FRESH } })
    await clock.advance(5_000)
    expect(killed).toEqual([])
    await clock.advance(10_000)
    expect(killed).toEqual(['%2'])
    await clock.advance(300_000)
    expect(killed).toEqual(['%2'])
  })

  test('a spawn pane is killed like any worker once it is done and its answer is saved, and not before', { timeoutMs: 15_000 }, async ($, on) => {
    const rows = [row('%1', ''), row('%3', 'agt-r9-spawn', '1'), row('%4', 'agt-r9-spawn-two', '1')]
    const { killed, clock } = await start($, on, { rows, mtimes: { [ANSWER('spawn')]: FRESH } })
    await clock.advance(5_000)
    expect(killed).toEqual([])
    await clock.advance(10_000)
    expect(killed).toEqual(['%3'])
    await clock.advance(300_000)
    expect(killed).toEqual(['%3']) // %4 never saved an answer: kept, not lost
  })

  test('a live spawn pane whose answer file appears turns done and is killed', { timeoutMs: 15_000 }, async ($, on) => {
    const rows = [row('%1', ''), row('%3', 'agt-r9-spawn')]
    const mtimes: Record<string, number> = {}
    const { killed, clock } = await start($, on, { rows, mtimes })
    await clock.advance(60_000)
    expect(killed).toEqual([])
    mtimes['/h/.agentille/state/run-r9/agents/pane-spawn.3.md'] = clock.now() + 1
    await clock.advance(20_000)
    expect(killed).toEqual(['%3'])
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
    await clock.advance(2_000)
    expect(killed).toEqual([])
    await clock.advance(20_000)
    expect(killed).toEqual(['%3'])
  })

  test('a tmux pane\'s own instance file (pane-<role>.5.md for %5) harvests it', { timeoutMs: 15_000 }, async ($, on) => {
    const rows = [row('%1', ''), row('%5', 'agt-r9-executor', '1')]
    const { killed, clock } = await start($, on, { rows, mtimes: { '/h/.agentille/state/run-r9/agents/pane-executor.5.md': FRESH } })
    await clock.advance(20_000)
    expect(killed).toEqual(['%5'])
  })

  test('a tmux wire done message naming pane-<role>.5.md harvests %5', { timeoutMs: 15_000 }, async ($, on) => {
    const rows = [row('%1', ''), row('%5', 'agt-r9-executor', '1')]
    const { killed, clock } = await start($, on, { rows })
    await $.session.receive({ text: '[agt wire] agt-r9-executor done · 0:10\nBuilt it\nFull answer: /h/.agentille/state/run-r9/agents/pane-executor.5.md', origin: { kind: 'peer' } } as never)
    await clock.advance(20_000)
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
    expect(spawnToolInput(ok)).toEqual({ run: 'k7f2ab', role: 'exec-1', name: 'agt-k7f2ab-exec-1', agent: 'executor', header, hdr: { run: 'k7f2ab', size: 'small', mode: 'build' }, asked: null, model: 'sonnet', task: 'build the search filter', cwd: null, layout: 'stack', vendor: 'claude' })
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
    // A pane this lead opened that the reaper already closed is gone, not an error; a stranger's name still errors.
    expect(closeTarget({ name: 'agt-k7f2ab-fix-1' }, live as never, 't1', new Set(['agt-k7f2ab-fix-1']))).toEqual({ gone: 'agt-k7f2ab-fix-1' })
    expect(closeTarget({ name: 'agt-k7f2ab-fix-1' }, live as never, 't1').error).toContain('No pane named')
    expect(closeTarget({ name: 'agt-k7f2ab-exec-2' }, live as never, 't1', new Set(['agt-k7f2ab-exec-2'])).error).toContain('No pane named')
  })
})

describe('pane tools: in the mod', () => {
  const T = '\t'
  const setup = (on: any, vars: Record<string, string>, table: Record<string, any> = {}, owned: string[] = []) => {
    const seen: string[][] = []
    const tools: string[] = []
    on('env.get', async ($: any, e: any) => ({ value: vars[e.name] }))
    on('session.cwd', async () => ({ value: '/work/repo' }))
    on('session.start', async ($: any, e: any) => ({ cwd: e.cwd }))
    on('command.register', async () => ({ value: undefined }))
    on('tool.register', async ($: any, e: any) => { tools.push(e.name); return { value: { tool: 'mcp__agentille__' + e.name } } })
    // `owned`: pane names a previous session of this lead recorded in its lead-<pane>.panes file.
    on('fs.read', async ($: any, e: any) => (owned.length && /\/lead-[\w-]+\.panes$/.test(e.path) ? { value: owned.join('\n') + '\n' } : { deny: 'no profile' }))
    on('fs.exists', async () => ({ value: false }))
    on('fs.stat', async ($: any, e: any) => (e.path.startsWith('/work/') ? { value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false } } : { deny: 'ENOENT' }))
    on('store.get', async () => ({ value: undefined }))
    on('ui.panes', async () => ({ value: [] }))
    on('prompt.submit', async ($: any, e: any) => ({ text: e.text }))
    on('agent.spawn', async ($: any, e: any) => ({ model: e.model ?? 'sonnet', agentId: 'ag' + seen.length }))
    on('process.run', async ($: any, e: any) => {
      seen.push(e.argv)
      const key = Object.keys(table).find((k) => e.argv.join(' ').startsWith(k))
      const v = key === undefined ? {} : typeof table[key] === 'function' ? table[key]() : table[key]
      return { value: { exitCode: 0, stdout: '', stderr: '', ...v } }
    })
    const clock = mock.clock(on, { now: 1_000_000 })
    return { seen, tools, clock }
  }
  const TMUX = { TMUX: '/tmp/tmux-1/default,1,0', TMUX_PANE: '%1', SHELL: '/bin/zsh', HOME: '/h' }
  const EXEC = { agent: 'executor', header: '[agt run=k7f2ab size=small mode=build]' }
  // Every spawn follows a typed /agt: the tool is denied until the person typed one (`typed` sends that prompt).
  const typed = ($: any, text = '/agt ship it') => $.prompt.submit({ text, origin: { kind: 'composer' } } as never)
  const spawn = async ($: any, input: Record<string, unknown>) => { await typed($); return $.tool.call({ tool: 'mcp__agentille__spawn_pane', ...input }) }
  const close = ($: any, name: string) => $.tool.call({ tool: 'mcp__agentille__close_pane', name })

  test('spawn_pane is denied until /agt was typed in this session', async ($, on) => {
    const { seen } = setup(on, TMUX, { 'tmux split-window': { stdout: '%9\n' } })
    const r = await $.tool.call({ tool: 'mcp__agentille__spawn_pane', run: 'k7f2ab', role: 'exec-1', task: 'build the filter', ...EXEC })
    expect(r.deny).toContain('only in a session where /agt was typed')
    expect(seen.some((a) => a[1] === 'split-window')).toBe(false)
    // A task notification or peer turn is not the person typing.
    await $.prompt.submit({ text: '/agt ship it', origin: { kind: 'notification' } } as never)
    expect((await $.tool.call({ tool: 'mcp__agentille__spawn_pane', run: 'k7f2ab', role: 'exec-1', task: 'build the filter', ...EXEC })).deny).toContain('/agt was typed')
    await typed($)
    expect((await $.tool.call({ tool: 'mcp__agentille__spawn_pane', run: 'k7f2ab', role: 'exec-1', task: 'build the filter', ...EXEC })).result).toContain('Opened agt-k7f2ab-exec-1')
  })

  test('spawn_pane lasts while the typed /agt run is in flight, not for the session', async ($, on) => {
    setup(on, TMUX, { 'tmux split-window': { stdout: '%9\n' } })
    const call = (role: string) => $.tool.call({ tool: 'mcp__agentille__spawn_pane', run: 'k7f2ab', role, task: 'build the filter', ...EXEC })
    const plain = (text: string, kind = 'composer') => $.prompt.submit({ text, origin: { kind } } as never)
    await typed($)
    // The run asked a question and the person answered: still the run's.
    await plain('the second option')
    expect((await call('exec-1')).result).toContain('Opened agt-k7f2ab-exec-1')
    // Turns the run wakes itself (a worker report, a notification) never end it.
    for (let n = 0; n < 6; n++) await plain('[agt wire] done', 'notification')
    expect((await call('exec-2')).result).toContain('Opened agt-k7f2ab-exec-2')
    // No card came (an error, an interrupt), no pane is listed and the person moved on: the proof lapses.
    await plain('thanks')
    await plain('now fix the login form')
    expect((await call('exec-3')).deny).toContain('/agt was typed')
    await plain('[agt wire] done', 'notification')
    expect((await call('exec-3')).deny).toContain('/agt was typed')
    // The next typed /agt starts a new proof.
    await typed($, '/agt ship the rest')
    expect((await call('exec-3')).result).toContain('Opened agt-k7f2ab-exec-3')
  })

  test('a worker pane still working keeps the run in flight; an /agt-spawn pane does not', async ($, on) => {
    let rows = [['%1', '', 'claude', '0', '@1']]
    setup(on, TMUX, { 'tmux split-window': { stdout: '%9\n' }, 'tmux list-panes': () => ({ stdout: rows.map((r) => r.join(T)).join('\n') + '\n' }) })
    await $.session.start({ cwd: '/work/repo', surface: null, isInteractive: false })
    const call = (role: string) => $.tool.call({ tool: 'mcp__agentille__spawn_pane', run: 'k7f2ab', role, task: 'build the filter', ...EXEC })
    const plain = (text: string) => $.prompt.submit({ text, origin: { kind: 'composer' } } as never)
    await typed($)
    rows = [...rows, ['%9', 'agt-k7f2ab-exec-1', 'claude', '0', '@1']]
    expect((await call('exec-1')).result).toContain('Opened agt-k7f2ab-exec-1')
    for (const t of ['one', 'two', 'three', 'four']) await plain(t)
    expect((await call('exec-2')).result).toContain('Opened agt-k7f2ab-exec-2')
    // exec-1 and exec-2 close; only a pane the person opened with /agt-spawn is left, and it is not the run's.
    const opened = (await $.command.run({ command: 'agt-spawn', args: '"look around"', origin: { kind: 'composer' } } as never)).text
    const name = opened.match(/agt-[a-z0-9]{6}-spawn/)[0]
    rows = [rows[0], ['%7', name, 'claude', '0', '@1']]
    expect((await call('exec-3')).deny).toBe('spawn_pane opens worker panes only while the typed /agt run is in flight; the next run needs the next typed /agt.')
    await plain('five')
    expect((await call('exec-3')).deny).toContain('/agt was typed')
  })

  // The run id is born on the typed /agt's own turn; later turns open panes for that run only. Reproduced: a typed
  // /agt heavy, six unrelated typed prompts and a task notification, then a pane for a brand-new run id.
  test('after the typed /agt\'s turn, spawn_pane opens panes only for that run\'s id', async ($, on) => {
    let rows = [['%1', '', 'claude', '0', '@1']]
    setup(on, TMUX, { 'tmux split-window': { stdout: '%9\n' }, 'tmux list-panes': () => ({ stdout: rows.map((r) => r.join(T)).join('\n') + '\n' }) })
    await $.session.start({ cwd: '/work/repo', surface: null, isInteractive: false })
    const call = (run: string, role: string) => $.tool.call({ tool: 'mcp__agentille__spawn_pane', run, role, task: 'build the filter', agent: 'executor', header: '[agt run=' + run + ' size=small mode=build]' })
    await typed($, '/agt heavy ship it')
    rows = [...rows, ['%9', 'agt-k7f2ab-exec-1', 'claude', '0', '@1']]
    expect((await call('k7f2ab', 'exec-1')).result).toContain('Opened agt-k7f2ab-exec-1')
    for (let n = 0; n < 6; n++) await $.prompt.submit({ text: 'unrelated question ' + n, origin: { kind: 'composer' } } as never)
    await $.prompt.submit({ text: 'task finished', origin: { kind: 'notification' } } as never)
    expect((await call('zq81mx', 'exec-1')).deny).toBe('spawn_pane opens panes only for run k7f2ab, the run the typed /agt started; run zq81mx needs its own typed /agt.')
    // The run's own fix round still opens.
    expect((await call('k7f2ab', 'fix-1')).result).toContain('Opened agt-k7f2ab-fix-1')
    // A new typed /agt is a new birth: its turn may name a new run.
    await typed($, '/agt heavy ship the rest')
    expect((await call('zq81mx', 'exec-1')).result).toContain('Opened agt-zq81mx-exec-1')
  })

  test('the run id is learned from a routed dispatch on the typed turn, and its turn may open any id', async ($, on) => {
    setup(on, TMUX, { 'tmux split-window': { stdout: '%9\n' } })
    const call = (run: string, role: string) => $.tool.call({ tool: 'mcp__agentille__spawn_pane', run, role, task: 'build the filter', agent: 'executor', header: '[agt run=' + run + ' size=small mode=build]' })
    const plain = (text: string, kind = 'composer') => $.prompt.submit({ text, origin: { kind } } as never)
    await typed($, '/agt heavy ship it')
    await $.agent.spawn({ prompt: '[agt run=k7f2ab size=small mode=build]\nplan it', subagentType: 'agentille:agentille-planner', model: 'opus' } as never)
    await plain('the second option') // the person answers the planner's question
    expect((await call('zq81mx', 'exec-1')).deny).toContain('only for run k7f2ab')
    expect((await call('k7f2ab', 'exec-1')).result).toContain('Opened agt-k7f2ab-exec-1')
    // On the typed turn itself any id opens; the first one named is the run's.
    await typed($, '/agt heavy next')
    expect((await call('aa11bb', 'exec-1')).result).toContain('Opened agt-aa11bb-exec-1')
    expect((await call('cc22dd', 'exec-1')).result).toContain('Opened agt-cc22dd-exec-1')
    await plain('[agt wire] done', 'notification')
    expect((await call('cc22dd', 'exec-2')).deny).toContain('only for run aa11bb')
    expect((await call('aa11bb', 'exec-2')).result).toContain('Opened agt-aa11bb-exec-2')
  })

  test('a typed turn that named no run: the first pane on a later turn names it', async ($, on) => {
    setup(on, TMUX, { 'tmux split-window': { stdout: '%9\n' } })
    const call = (run: string, role: string) => $.tool.call({ tool: 'mcp__agentille__spawn_pane', run, role, task: 'build the filter', agent: 'executor', header: '[agt run=' + run + ' size=small mode=build]' })
    await typed($, '/agt heavy ship it')
    await $.prompt.submit({ text: 'yes, go', origin: { kind: 'composer' } } as never)
    expect((await call('k7f2ab', 'exec-1')).result).toContain('Opened agt-k7f2ab-exec-1')
    expect((await call('zq81mx', 'exec-1')).deny).toContain('only for run k7f2ab')
  })

  test('a tmux worker that never writes its done file keeps the run in flight for AGT_INFLIGHT_MAX_MS at most', async ($, on) => {
    let rows = [['%1', '', 'claude', '0', '@1']]
    const { clock } = setup(on, TMUX, { 'tmux split-window': { stdout: '%9\n' }, 'tmux list-panes': () => ({ stdout: rows.map((r) => r.join(T)).join('\n') + '\n' }) })
    on('ui.status', async () => ({ value: undefined }))
    await $.session.start({ cwd: '/work/repo', surface: null, isInteractive: false })
    const call = (role: string) => $.tool.call({ tool: 'mcp__agentille__spawn_pane', run: 'k7f2ab', role, task: 'build the filter', ...EXEC })
    await typed($)
    rows = [...rows, ['%9', 'agt-k7f2ab-exec-1', 'claude', '0', '@1']]
    expect((await call('exec-1')).result).toContain('Opened agt-k7f2ab-exec-1')
    for (const t of ['one', 'two', 'three', 'four']) await $.prompt.submit({ text: t, origin: { kind: 'composer' } } as never)
    for (let n = 0; n < 59; n++) await clock.advance(60_000) // the poll's interval runs all along
    expect((await call('exec-2')).result).toContain('Opened agt-k7f2ab-exec-2')
    await clock.advance(60_000)
    expect((await call('exec-3')).deny).toBe('spawn_pane opens worker panes only while the typed /agt run is in flight; the next run needs the next typed /agt.')
    await typed($, '/agt ship the rest')
    expect((await call('exec-3')).result).toContain('Opened agt-k7f2ab-exec-3')
  })

  test('a Herdr worker stuck at a prompt stops keeping the run in flight after PANE_REST_MS', async ($, on) => {
    const LEAD = { name: 'lead', pane_id: 'w1:p1', agent: 'claude', agent_status: 'working', state_change_seq: 1, tab_id: 'w1:t1', workspace_id: 'w1' }
    let agents: any[] = []
    const { clock } = setup(on, { HERDR_ENV: '1', HERDR_PANE_ID: 'w1:p1', HOME: '/h' }, {
      'herdr pane split': { stdout: JSON.stringify({ result: { pane: { pane_id: 'w1:p5' } } }) },
      'herdr agent list': () => ({ stdout: JSON.stringify({ result: { agents: [LEAD, ...agents] } }) }),
    })
    await $.session.start({ cwd: '/work/repo', surface: null, isInteractive: false })
    const call = (role: string) => $.tool.call({ tool: 'mcp__agentille__spawn_pane', run: 'k7f2ab', role, task: 'build the filter', ...EXEC })
    await typed($)
    agents = [{ name: 'agt-k7f2ab-exec-1', pane_id: 'w1:p5', agent: 'claude', agent_status: 'blocked', state_change_seq: 2, tab_id: 'w1:t1', workspace_id: 'w1' }]
    expect((await call('exec-1')).result).toContain('Opened agt-k7f2ab-exec-1')
    for (const t of ['one', 'two', 'three', 'four']) await $.prompt.submit({ text: t, origin: { kind: 'composer' } } as never)
    agents = [...agents, { name: 'agt-k7f2ab-exec-2', pane_id: 'w1:p6', agent: 'claude', agent_status: 'working', state_change_seq: 2, tab_id: 'w1:t1', workspace_id: 'w1' }]
    expect((await call('exec-2')).result).toContain('Opened agt-k7f2ab-exec-2') // exec-1 blocked a moment: still the run's
    agents = agents.slice(0, 1) // exec-2 finished and closed; exec-1 still waits on its permission prompt
    await clock.advance(15 * 60_000)
    expect((await call('exec-3')).deny).toBe('spawn_pane opens worker panes only while the typed /agt run is in flight; the next run needs the next typed /agt.')
  })

  test('fable=forced without a typed --fable is dropped from the worker task, once per run', async ($, on) => {
    const toasts: string[] = []
    const { seen } = setup(on, TMUX, { 'tmux split-window': { stdout: '%9\n' } })
    on('ui.toast', async ($: any, e: any) => { toasts.push(e.text ?? String(e)); return { value: undefined } })
    const hdr = '[agt run=k7f2ab size=small mode=build fable=forced]'
    await spawn($, { run: 'k7f2ab', role: 'exec-1', task: hdr + '\nbuild the filter', agent: 'executor', header: hdr })
    let split = seen.filter((a) => a[1] === 'split-window').at(-1)!
    expect(split.at(-1)).toBe('[agt run=k7f2ab size=small mode=build fable=auto]\nbuild the filter')
    expect(toasts.filter((t) => t.includes('fable=forced dropped'))).toHaveLength(1)
    await spawn($, { run: 'k7f2ab', role: 'exec-2', task: hdr + '\nbuild the sort', agent: 'executor', header: hdr })
    expect(toasts.filter((t) => t.includes('fable=forced dropped'))).toHaveLength(1)
    // Typed --fable: the header holds as written.
    await typed($, '/agt --fable ship it')
    await $.tool.call({ tool: 'mcp__agentille__spawn_pane', run: 'k7f2ab', role: 'exec-3', task: hdr + '\nbuild the paging', agent: 'executor', header: hdr })
    split = seen.filter((a) => a[1] === 'split-window').at(-1)!
    expect(split.at(-1)).toBe(hdr + '\nbuild the paging')
  })

  test('a respawned role\'s stale done file goes before its pane opens', async ($, on) => {
    const { seen } = setup(on, TMUX, { 'tmux split-window': { stdout: '%9\n' }, 'tmux list-panes': { stdout: ['%1', '', 'claude', '0', '@1'].join(T) + '\n' } })
    await $.session.start({ cwd: '/work/repo', surface: null, isInteractive: false })
    await spawn($, { run: 'k7f2ab', role: 'exec-1', task: 'build the filter', ...EXEC })
    const rm = seen.findIndex((a) => a[0] === 'rm' && a[1] === '-f' && a[2] === '/h/.agentille/state/run-k7f2ab/done-exec-1')
    const split = seen.findIndex((a) => a[1] === 'split-window')
    expect(rm).toBeGreaterThan(-1)
    expect(rm).toBeLessThan(split)
  })

  test('the pane tools exist only once /agt is typed: none at start, spawn_pane and close_pane on the typed /agt, once', async ($, on) => {
    const a = setup(on, TMUX, { 'tmux list-panes': { stdout: ['%1', '', 'claude', '0', '@1'].join(T) + '\n' } })
    await $.session.start({ cwd: '/work/repo', surface: null, isInteractive: false })
    expect(a.tools).toEqual([])
    await $.prompt.submit({ text: 'fix the login form', origin: { kind: 'composer' } } as never)
    expect(a.tools).toEqual([])
    await $.prompt.submit({ text: '/agt ship it', origin: { kind: 'notification' } } as never)
    expect(a.tools).toEqual([])
    await typed($)
    expect(a.tools).toEqual(['spawn_pane', 'close_pane'])
    await typed($, '/agt ship the rest')
    expect(a.tools).toEqual(['spawn_pane', 'close_pane'])
  })

  test('an older Claude Code: one toast at start, and a typed /agt registers no pane tools', async ($, on) => {
    const toasts: string[] = []
    const a = setup(on, TMUX, { 'tmux list-panes': { stdout: ['%1', '', 'claude', '0', '@1'].join(T) + '\n' } })
    on('ui.toast', async ($: any, e: any) => { toasts.push(e.text ?? String(e)); return { value: undefined } })
    on('session.version', async () => ({ value: { version: '2.1.200', base: '2.1.200' } }))
    await $.session.start({ cwd: '/work/repo', surface: null, isInteractive: false })
    expect(toasts.filter((t) => t.includes('Claude Code v2.1.200 is older'))).toHaveLength(1)
    await typed($)
    expect(a.tools).toEqual([])
  })

  test('a current Claude Code: no toast, tools on the typed /agt', async ($, on) => {
    const toasts: string[] = []
    const a = setup(on, TMUX, { 'tmux list-panes': { stdout: ['%1', '', 'claude', '0', '@1'].join(T) + '\n' } })
    on('ui.toast', async ($: any, e: any) => { toasts.push(e.text ?? String(e)); return { value: undefined } })
    on('session.version', async () => ({ value: { version: '2.1.309', base: '2.1.309' } }))
    await $.session.start({ cwd: '/work/repo', surface: null, isInteractive: false })
    expect(toasts.filter((t) => t.includes('is older'))).toHaveLength(0)
    await typed($)
    expect(a.tools).toEqual(['spawn_pane', 'close_pane'])
  })

  test('herdr: a trust prompt in another repo is refused and the half-made pane closed', async ($, on) => {
    const trust = ' Do you trust the files in this folder?\n\n /work/other\n\n ❯ 1. Yes, proceed\n   2. No, exit'
    const { seen } = setup(on, { HERDR_ENV: '1', HERDR_PANE_ID: 'w1:p1', HOME: '/h' }, {
      'herdr pane split': { stdout: JSON.stringify({ result: { pane: { pane_id: 'w1:p5' } } }) },
      'herdr agent start': { exitCode: 1, stderr: 'agent_not_ready' },
      'herdr agent read': { stdout: trust },
      'git -C /work/other': { stdout: '/work/other/.git\n' },
      'git -C /work/repo': { stdout: '/work/repo/.git\n' },
    })
    const r = await spawn($, { run: 'k7f2ab', role: 'exec-1', task: 'build the filter', cwd: '/work/other', ...EXEC })
    expect(String(r.text ?? r.error ?? JSON.stringify(r))).toContain('needs a one-time trust')
    expect(seen.some((a) => a[0] === 'herdr' && a[1] === 'agent' && a[2] === 'keys')).toBe(false)
    expect(seen[seen.length - 1]).toEqual(['herdr', 'pane', 'close', 'w1:p5'])
  })

  test('vendor codex needs the person to name Codex: the lead never picks it on its own', async ($, on) => {
    const HERDR = { HERDR_ENV: '1', HERDR_PANE_ID: 'w1:p1', HOME: '/h' }
    const { seen } = setup(on, HERDR, { 'herdr pane split': { stdout: JSON.stringify({ result: { pane: { pane_id: 'w1:p5' } } }) } })
    const r = await spawn($, { run: 'k7f2ab', role: 'exec-1', task: 'build the filter', vendor: 'codex', ...EXEC })
    expect(r.deny).toBe('vendor "codex" runs only when the person asked for Codex in their prompt, so run this slice as a Claude pane.')
    expect(seen.some((a) => a.slice(0, 3).join(' ') === 'herdr pane split')).toBe(false)
    // "/codex-reviewer" names another tool, not a Codex worker.
    await typed($, '/agt ship it, then /codex-reviewer the diff')
    expect((await $.tool.call({ tool: 'mcp__agentille__spawn_pane', run: 'k7f2ab', role: 'exec-1', task: 'build the filter', vendor: 'codex', ...EXEC })).deny).toContain('asked for Codex')
    await typed($, '/agt heavy ship it, codex builds the API slice')
    const ok = await $.tool.call({ tool: 'mcp__agentille__spawn_pane', run: 'k7f2ab', role: 'exec-1', task: 'build the filter', vendor: 'codex', ...EXEC })
    expect(ok.result).toContain('Opened agt-k7f2ab-exec-1 · codex')
    expect(seen.find((a) => a.slice(0, 3).join(' ') === 'herdr agent start')).toContain('codex')
  })

  test('vendor codex on tmux: the gate passes on a typed ask, then Herdr is required', async ($, on) => {
    setup(on, TMUX, { 'tmux split-window': { stdout: '%9\n' } })
    const r = await spawn($, { run: 'k7f2ab', role: 'exec-1', task: 'build the filter', vendor: 'codex', ...EXEC })
    expect(r.deny).toContain('asked for Codex')
    await typed($, '/agt use Codex for the api slice')
    expect((await $.tool.call({ tool: 'mcp__agentille__spawn_pane', run: 'k7f2ab', role: 'exec-1', task: 'build the filter', vendor: 'codex', ...EXEC })).deny).toContain('Codex panes need Herdr')
  })

  test('no transport: a typed /agt registers none', async ($, on) => {
    const a = setup(on, {})
    await $.session.start({ cwd: '/work/repo', surface: null, isInteractive: false })
    await typed($)
    expect(a.tools).toEqual([])
  })

  test('a worker pane registers no tools, typed /agt or not', async ($, on) => {
    const a = setup(on, TMUX, { 'tmux list-panes': { stdout: ['%1', 'agt-k7f2ab-exec-1', 'claude', '0', '@1'].join(T) + '\n' } })
    await $.session.start({ cwd: '/work/repo', surface: null, isInteractive: false })
    await typed($)
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
    expect((await $.command.run({ command: 'agt-info', args: 'routing' })).text).toBe('executor → sonnet · medium')
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
    const { seen } = setup(on, TMUX, { 'tmux list-panes': () => ({ stdout: rows.map((r) => r.join(T)).join('\n') + '\n' }) }, ['agt-k7f2ab-exec-1']) // exec-2 sits in another window and was never this lead's
    await $.session.start({ cwd: '/work/repo', surface: null, isInteractive: false }) // loads the lead's own pane names
    expect((await close($, 'agt-k7f2ab-exec-1')).result).toBe('Closed agt-k7f2ab-exec-1.')
    expect(seen.some((a) => a.join(' ') === 'tmux kill-pane -t %5')).toBe(true)
    expect((await close($, 'agt-k7f2ab-spawn')).deny).toContain('typed /agt-spawn')
    expect((await close($, 'agt-k7f2ab-exec-2')).deny).toContain('No pane named')
    expect(seen.filter((a) => a[1] === 'kill-pane').length).toBe(1)
  })
})

// The folder-trust prompt is accepted for a worktree of the lead's repo only when the lead made it: an agt/*, feat/*
// or fix/* branch on the lead's lead-<pane>.worktrees list, or, with no list, one that brings no settings of its own.
describe('pane tools: folder trust', () => {
  const trust = ' Do you trust the files in this folder?\n\n /work/wt\n\n ❯ 1. Yes, proceed\n   2. No, exit'
  const setup = (on: any, { branch = 'agt/k7f2ab-exec-1', files = {} as Record<string, string> } = {}) => {
    const seen: string[][] = []
    const vars: Record<string, string> = { HERDR_ENV: '1', HERDR_PANE_ID: 'w1:p1', HOME: '/h' }
    on('env.get', async ($: any, e: any) => ({ value: vars[e.name] }))
    on('session.cwd', async () => ({ value: '/work/repo' }))
    on('session.start', async ($: any, e: any) => ({ cwd: e.cwd }))
    on('command.register', async () => ({ value: undefined }))
    on('tool.register', async ($: any, e: any) => ({ value: { tool: 'mcp__agentille__' + e.name } }))
    on('fs.read', async ($: any, e: any) => (e.path in files ? { value: files[e.path] } : { deny: 'ENOENT' }))
    on('fs.write', async () => ({ value: undefined }))
    on('fs.exists', async () => ({ value: false }))
    on('fs.stat', async ($: any, e: any) => (e.path.startsWith('/work/') ? { value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false } } : { deny: 'ENOENT' }))
    on('store.get', async () => ({ value: undefined }))
    on('store.set', async () => ({ value: undefined }))
    on('ui.panes', async () => ({ value: [] }))
    on('prompt.submit', async ($: any, e: any) => ({ text: e.text }))
    const table: Record<string, any> = {
      'herdr pane split': { stdout: JSON.stringify({ result: { pane: { pane_id: 'w1:p5' } } }) },
      'herdr agent start': { exitCode: 1, stderr: 'agent_not_ready' },
      'herdr agent read': { stdout: trust },
      'herdr agent get': { stdout: JSON.stringify({ result: { agent: { agent_status: 'idle' } } }) },
      'git -C /work/wt rev-parse --path-format=absolute --git-common-dir': { stdout: '/work/repo/.git\n' },
      'git -C /work/repo rev-parse --path-format=absolute --git-common-dir': { stdout: '/work/repo/.git\n' },
      'git -C /work/wt rev-parse --show-toplevel': { stdout: '/work/wt\n' },
      'git -C /work/repo rev-parse --show-toplevel': { stdout: '/work/repo\n' },
      'git -C /work/wt symbolic-ref --short HEAD': { stdout: branch + '\n' },
    }
    on('process.run', async ($: any, e: any) => {
      seen.push(e.argv)
      const key = Object.keys(table).find((k) => e.argv.join(' ').startsWith(k))
      return { value: { exitCode: 0, stdout: '', stderr: '', ...(key === undefined ? {} : table[key]) } }
    })
    const clock = mock.clock(on, { now: 1_000_000 })
    return { seen, clock }
  }
  const EXEC = { agent: 'executor', header: '[agt run=k7f2ab size=small mode=build]' }
  // The keys go out 300 ms apart and the cleared screen is polled every 500 ms: the clock runs until the call settles.
  const spawn = async ($: any, clock: any) => {
    await $.session.start({ cwd: '/work/repo', surface: null, isInteractive: false })
    await $.prompt.submit({ text: '/agt ship it', origin: { kind: 'composer' } } as never)
    let out: any
    const call = $.tool.call({ tool: 'mcp__agentille__spawn_pane', run: 'k7f2ab', role: 'exec-1', task: 'build the filter', cwd: '/work/wt', ...EXEC }).then((r: any) => (out = r))
    for (let n = 0; n < 200 && out === undefined; n++) await clock.advance(250)
    await call
    return out
  }
  const accepted = (seen: string[][]) => seen.some((a) => a.slice(0, 3).join(' ') === 'herdr agent send-keys')
  const LIST = '/h/.agentille/state/lead-w1-p1.worktrees'

  test('an agt/* worktree on the lead\'s list is trusted', async ($, on) => {
    const { seen, clock } = setup(on, { files: { [LIST]: '/work/wt\tagt/k7f2ab-exec-1\n' } })
    expect((await spawn($, clock)).result).toContain('Opened agt-k7f2ab-exec-1')
    expect(accepted(seen)).toBe(true)
  })

  test('the guard\'s JSON records (path, branch) are read: a listed agt/* worktree is trusted, an unlisted one is not', async ($, on) => {
    const recs = JSON.stringify([{ path: '/work/wt', branch: 'agt/k7f2ab-exec-1', head: 'abc', run: 'k7f2ab', at: 1 }])
    const yes = setup(on, { files: { [LIST]: recs + '\n' } })
    expect((await spawn($, yes.clock)).result).toContain('Opened agt-k7f2ab-exec-1')
    expect(accepted(yes.seen)).toBe(true)
  })

  test('the guard\'s JSON records naming another worktree refuse this one', async ($, on) => {
    const recs = JSON.stringify([{ path: '/work/elsewhere', branch: 'agt/other', head: 'abc', run: 'k7f2ab', at: 1 }])
    const { seen, clock } = setup(on, { branch: 'feat/other', files: { [LIST]: recs + '\n' } })
    expect(JSON.stringify(await spawn($, clock))).toContain('needs a one-time trust')
    expect(accepted(seen)).toBe(false)
  })

  test('a feat/* worktree the list does not name is refused', async ($, on) => {
    const { seen, clock } = setup(on, { branch: 'feat/other', files: { [LIST]: '/work/elsewhere\nagt/k7f2ab-exec-2\n' } })
    expect(JSON.stringify(await spawn($, clock))).toContain('needs a one-time trust')
    expect(accepted(seen)).toBe(false)
  })

  test('a contributor branch of the same repo is refused, list or not', async ($, on) => {
    const { seen, clock } = setup(on, { branch: 'contrib-change', files: { [LIST]: '/work/wt\n' } })
    expect(JSON.stringify(await spawn($, clock))).toContain('needs a one-time trust')
    expect(accepted(seen)).toBe(false)
  })

  test('no list: a fix/* worktree with no settings of its own is trusted', async ($, on) => {
    const { seen, clock } = setup(on, { branch: 'fix/login', files: { '/work/repo/.claude/settings.json': '{}' } })
    expect((await spawn($, clock)).result).toContain('Opened agt-k7f2ab-exec-1')
    expect(accepted(seen)).toBe(true)
  })

  test('no list: settings that match the lead checkout\'s are trusted', async ($, on) => {
    const same = setup(on, { files: { '/work/repo/.claude/settings.json': '{"a":1}', '/work/wt/.claude/settings.json': '{"a":1}' } })
    expect((await spawn($, same.clock)).result).toContain('Opened agt-k7f2ab-exec-1')
    expect(accepted(same.seen)).toBe(true)
  })

  test('no list: a worktree whose own settings.local.json adds a hook is refused', async ($, on) => {
    const { seen, clock } = setup(on, { files: { '/work/wt/.claude/settings.local.json': '{"hooks":{"SessionStart":[]}}' } })
    expect(JSON.stringify(await spawn($, clock))).toContain('needs a one-time trust')
    expect(accepted(seen)).toBe(false)
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
  const lead = async ($: any, on: any, state: string, files: string[] = [ANSWER], twin = false, owned = true) => {
    const closed: string[] = []
    const toasts: string[] = []
    const sent: any[] = []
    const writes: Record<string, string> = {}
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
    on('prompt.submit', async ($: any, e: any) => ({ text: e.text }))
    on('ui.toast', async ($: any, e: any) => { toasts.push(e.text); return { value: undefined } })
    // The pane listed at start is this lead's own: its previous session recorded it in lead-w1-p1.panes.
    on('fs.read', async ($: any, e: any) => (owned && e.path === '/h/.agentille/state/lead-w1-p1.panes' ? { value: 'agt-r9-executor\n' } : { deny: 'no profile' }))
    on('fs.exists', async () => ({ value: false }))
    on('fs.write', async ($: any, e: any) => { writes[e.path] = e.text ?? e.content ?? e.data; return { value: undefined } })
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
    return { closed, clock, toasts, sent, writes, files: mtimes, agents, reuseId: (id: string) => { reuse = id }, blind: (b: boolean) => { blind = b } }
  }
  const begin = ($: any) => $.turn.start({ text: 'go', turnId: 't1' })
  const end = ($: any) => $.turn.complete({ answer: 'ok', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' })
  // A role can be respawned (a fix, a retry): the second pane of agt-r9-executor is a new worker.
  const respawn = async ($: any) => {
    await $.prompt.submit({ text: '/agt ship it', origin: { kind: 'composer' } } as never)
    return $.tool.call({ tool: 'mcp__agentille__spawn_pane', run: 'r9', role: 'executor', task: 'redo the filter, tests first', agent: 'executor', header: '[agt run=r9 size=small mode=build]' })
  }
  const finish = (l: any, id: string) => { l.agents.find((a: any) => a.pane_id === id).agent_status = 'done' }
  const flagged = (l: any) => l.toasts.filter((t: string) => t.includes('agt-r9-executor done, not harvested')).length

  test('another session\'s pane in the same tab is not adopted: no close, no flag, no wake, and the poll stops', async ($, on) => {
    const other = await lead($, on, 'done', [ANSWER], false, false)
    await begin($)
    await end($)
    await other.clock.advance(120_000)
    expect(other.closed).toEqual([])
    expect(other.toasts.filter((t) => t.includes('agt-r9-executor'))).toEqual([])
    expect(other.sent).toEqual([])
    const lists = other.agents.length // the fixture is untouched: nothing was closed by hand either
    expect(lists).toBe(1)
  })

  test('a spawned pane is recorded under the lead\'s own key, where the SessionEnd sweep and a restart read it', async ($, on) => {
    const l = await lead($, on, 'working', [], false, false)
    await respawn($)
    expect(l.writes['/h/.agentille/state/lead-w1-p1.panes']).toBe('agt-r9-executor\n')
  })

  test('the card ends the typed proof: the next spawn_pane waits for the next typed /agt', async ($, on) => {
    const l = await lead($, on, 'working', [], false, false) // the listed pane is a stranger's, so the name is free
    expect((await respawn($)).result).toContain('Opened agt-r9-executor')
    await begin($)
    await $.turn.complete({ answer: '✓ shipped · 1 slice', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' })
    const r = await $.tool.call({ tool: 'mcp__agentille__spawn_pane', run: 'r9', role: 'executor', task: 'one more', agent: 'executor', header: '[agt run=r9 size=small mode=build]' })
    expect(r.deny).toContain('/agt was typed')
    expect(l.closed).toEqual([])
  })

  test('idle reaps only between lead turns, done reaps at 10 s (answer harvested)', async ($, on) => {
    const idle = await lead($, on, 'idle')
    await begin($)
    await idle.clock.advance(400_000)
    expect(idle.closed).toEqual([])
    await end($)
    await idle.clock.advance(10_000)
    expect(idle.closed).toEqual(['w1:p2'])
  })

  test('a done pane is reaped at 10 s even while the lead works (answer harvested)', async ($, on) => {
    const done = await lead($, on, 'done')
    await begin($)
    await done.clock.advance(5_000)
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
    await l.clock.advance(5_000) // the planner's pane is harvested
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

describe('run tabs', () => {
  test('layout and vendor validate, with stack and claude as defaults', () => {
    const base = { run: 'ab12cd', role: 'exec-1', task: 'build the thing end to end', agent: 'executor', header: '[agt run=ab12cd size=m risk=low mode=build fable=0]' }
    const ok = spawnToolInput(base) as { layout: string; vendor: string }
    expect([ok.layout, ok.vendor]).toEqual(['stack', 'claude'])
    expect((spawnToolInput({ ...base, layout: 'tab', vendor: 'codex' }) as { layout: string; vendor: string }).layout).toBe('tab')
    expect(spawnToolInput({ ...base, layout: 'grid' }).error).toContain('layout must be one of stack, tab')
    expect(spawnToolInput({ ...base, vendor: 'gemini' }).error).toContain('vendor must be one of claude, codex')
    expect(spawnToolInput({ ...base, agent: 'code-reviewer', vendor: 'codex' }).error).toContain('executor only')
    expect(Object.keys(SPAWN_TOOL.inputSchema.properties)).toEqual(expect.arrayContaining(['layout', 'vendor']))
  })

  test('closeTarget takes one tab, a list of tabs, or none', () => {
    const live = [{ name: 'agt-k7f2ab-exec-1', id: 'w1:p2', tab: 't1' }, { name: 'agt-k7f2ab-exec-2', id: 'w1:p3', tab: 't9' }]
    expect(closeTarget({ name: 'agt-k7f2ab-exec-2' }, live as never, ['t1', 't9'])).toEqual({ pane: live[1] })
    expect(closeTarget({ name: 'agt-k7f2ab-exec-2' }, live as never, ['t1']).error).toContain('No pane named')
    expect(closeTarget({ name: 'agt-k7f2ab-exec-2' }, live as never, 't9')).toEqual({ pane: live[1] })
  })

  test('tab create argv carries the split env; its json gives the tab and root pane', () => {
    const argv = herdrTabArgv({ workspace: 'w1', cwd: '/work', run: 'ab12cd', agent: 'executor', model: 'sonnet', effort: 'high', env: ['X=1'] })
    expect(argv).toEqual(['herdr', 'tab', 'create', '--workspace', 'w1', '--cwd', '/work', '--label', 'agt-ab12cd', '--env', 'AGENTILLE_RUN=ab12cd', '--env', 'AGENTILLE_WORKER=executor:sonnet:high', '--env', 'X=1', '--no-focus'])
    const out = JSON.stringify({ result: { root_pane: { pane_id: 'w1:p8' }, tab: { tab_id: 'w1:t2' } } })
    expect(herdrTabOf(out)).toEqual({ tab: 'w1:t2', pane: 'w1:p8' })
    expect(herdrTabOf('nope')).toBe(null)
    expect(herdrTabOf(JSON.stringify({ result: { tab: { tab_id: 'bad id' }, root_pane: { pane_id: 'p' } } }))).toBe(null)
    expect(herdrTabIds(JSON.stringify({ result: { tabs: [{ tab_id: 'w1:t1' }, { tab_id: 'w1:t2' }] } }))).toEqual(['w1:t1', 'w1:t2'])
    expect(herdrTabIds('x')).toBe(null)
    expect(herdrTabListArgv('w1')).toEqual(['herdr', 'tab', 'list', '--workspace', 'w1'])
  })

  test('the tabs file is per lead pane; its ids are validated', () => {
    expect(tabsFile('/h', 'w1:p3')).toBe('/h/.agentille/state/lead-w1-p3.tabs')
    expect(tabsFile('/h', '')).toBe(null)
    expect(tabsFile(null, 'w1:p3')).toBe(null)
    expect(tabIdsOf('w1:t2\n  w1:t3 \nbad id\n../x\n\n')).toEqual(['w1:t2', 'w1:t3'])
  })

  test('placement: stack by default, a run tab for layout tab on herdr only, later workers split inside it', () => {
    const live = [{ id: 'p5' }, { id: 'p6' }, { id: 'p7' }]
    expect(placePlan({ transport: 'herdr', layout: 'tab', run: 'r1', lead: 'p1', opened: [], live })).toEqual({ newTab: true })
    const opened = [{ id: 'p5', run: 'r1', tab: 't2' }, { id: 'p6', run: 'r1', tab: 't2' }]
    expect(placePlan({ transport: 'herdr', layout: 'tab', run: 'r1', lead: 'p1', opened, live })).toEqual({ target: 'p6', direction: 'down', tab: 't2' })
    expect(placePlan({ transport: 'herdr', layout: 'tab', run: 'r2', lead: 'p1', opened, live })).toEqual({ newTab: true })
    expect(placePlan({ transport: 'herdr', layout: 'tab', run: 'r1', lead: 'p1', opened, live: [{ id: 'p7' }] })).toEqual({ newTab: true })
    expect(placePlan({ transport: 'tmux', layout: 'tab', run: 'r1', lead: '%1', opened: [], live })).toEqual({ target: '%1', direction: 'right' })
    expect(placePlan({ transport: 'herdr', layout: 'stack', run: 'r1', lead: 'p1', opened, live })).toEqual({ target: 'p1', direction: 'right' })
  })
})

describe('codex panes', () => {
  test('codex starts with the update nag off and no model, sandbox or approval flags', () => {
    expect(herdrStartArgv({ name: 'agt-ab12cd-exec-1', pane: 'w1:p5', model: 'codex', effort: '', agent: 'executor', vendor: 'codex' })).toEqual(['herdr', 'agent', 'start', 'agt-ab12cd-exec-1', '--kind', 'codex', '--pane', 'w1:p5', '--timeout', '45000', '--', '-c', 'check_for_update_on_startup=false'])
  })

  test('the lead is told to wait on the pane in the background, then read the file', () => {
    const n = codexNote('agt-ab12cd-exec-1', '/h/a.md')
    expect(n).toContain('herdr agent wait agt-ab12cd-exec-1 --until done --until blocked --timeout 3600000')
    expect(n).toContain('read /h/a.md, then close_pane if it is still open')
  })

  test('the task gets one closing line naming the answer file', () => {
    expect(codexTask('do it', '/h/a.md')).toBe('do it\n\nWhen you finish, write your complete final report to /h/a.md and stop.')
  })
})

describe('startup dialogs', () => {
  const codexTrust = '> You are in /work/repo\n\n  Do you trust the contents of this directory? Working with untrusted contents comes with higher risk of prompt injection.\n\n› 1. Yes, continue\n  2. No, quit\n\n  Press enter to continue'
  const codexUpdate = '  ✨ Update available! 0.1.0 -> 0.2.0\n\n  1. Update now\n  2. Skip\n  3. Skip until next version\n\n  Press enter to continue'
  const claudeTrust = ' Do you trust the files in this folder?\n\n /work/repo\n\n ❯ 1. Yes, proceed\n   2. No, exit'
  const claudeSafety = ' Accessing workspace:\n /work/repo\n Quick safety check: Is this a project you created or one you trust? (Like\n your own code).\n Security guide\n ❯ No, exit\n   Yes, I trust this folder\n Enter to confirm · Esc to cancel'

  test('classifies the real screens', () => {
    expect(startupDialog(codexTrust)).toBe('trust')
    expect(startupDialog(codexUpdate)).toBe('update')
    expect(startupDialog(claudeTrust)).toBe('trust')
    expect(startupDialog(claudeSafety)).toBe('trust')
    expect(startupDialog('Error: login required')).toBe(null)
    expect(startupDialog('')).toBe(null)
    expect(startupDialog(null)).toBe(null)
  })

  test('trust moves onto Yes; update moves down to Skip; unknown sends nothing', () => {
    expect(dialogKeys('trust', codexTrust)).toEqual(['enter'])
    expect(dialogKeys('trust', claudeTrust)).toEqual(['enter'])
    expect(dialogKeys('trust', claudeSafety)).toEqual(['down', 'enter'])
    expect(dialogKeys('trust', '> You are in /work\n  Do you trust the contents of this directory?')).toEqual([])
    expect(dialogKeys('update')).toEqual(['down', 'enter'])
    expect(dialogKeys(null)).toEqual([])
  })

  test('argv builders and status parsing', () => {
    expect(herdrReadArgv('agt-a-b')).toEqual(['herdr', 'agent', 'read', 'agt-a-b', '--source', 'detection', '--lines', '40'])
    expect(herdrKeysArgv('agt-a-b', ['down', 'enter'])).toEqual(['herdr', 'agent', 'send-keys', 'agt-a-b', 'down', 'enter'])
    expect(herdrGetArgv('agt-a-b')).toEqual(['herdr', 'agent', 'get', 'agt-a-b'])
    expect(agentStatusOf(JSON.stringify({ result: { agent: { agent_status: 'idle' } } }))).toBe('idle')
    expect(agentStatusOf('')).toBe(null)
  })

  test('an unknown screen reports its first non-empty line, 120 chars at most', () => {
    expect(screenLine('\n\n  Please sign in  \nmore')).toBe('Please sign in')
    expect(screenLine('x'.repeat(300))).toHaveLength(120)
    expect(screenLine('')).toContain('unknown screen')
  })
})

import { MAX_SESSIONS, OPEN_SESSIONS_TOOL, SESSION_KINDS, herdrSessionSplitArgv, herdrSessionStartArgv, herdrSessionTabArgv, herdrTerminalOf, sessionName, sessionsNote, sessionsToolInput, shellCommands, stripFable, tmuxSessionSplitArgv, tmuxTitleArgvs, tmuxTypeArgvs } from '../../hooks/panes.js'

describe('sessions: helpers', () => {
  test('a shell task must appear in the typed prompt; --fable is stripped from a Claude task unless typed', () => {
    expect(sessionsToolInput({ kind: 'shell', tasks: ['npm run dev'] }, { typed: 'open a shell and run npm run dev' }).error).toBeUndefined()
    expect(sessionsToolInput({ kind: 'shell', tasks: ['rm -rf dist'] }, { typed: 'open a shell and run npm run dev' }).error).toContain('runs only as the person typed it')
    expect(sessionsToolInput({ kind: 'shell', tasks: ['npm run dev'] }).error).toContain('runs only as the person typed it')
    expect((sessionsToolInput({ tasks: ['/agt --fable ship it'] }, { typed: 'open a session' }) as any).tasks).toEqual(['/agt ship it'])
    expect((sessionsToolInput({ tasks: ['/agt --fable ship it'] }, { typed: 'open a session --fable', fableTyped: true }) as any).tasks).toEqual(['/agt --fable ship it'])
    expect((sessionsToolInput({ tasks: ['--fable'] }) as any).tasks).toEqual([null])
    expect(stripFable('a --fable b --fableish')).toBe('a b --fableish')
  })

  test('a shell task is a quoted span or the rest of the ask, never a span the prompt says not to run', () => {
    const shell = (task: string, typed: string) => sessionsToolInput({ kind: 'shell', tasks: [task] }, { typed }).error
    expect(shell('rm -rf ~/Documents', 'open a shell. Do NOT run rm -rf ~/Documents under any circumstance')).toContain('runs only as the person typed it')
    expect(shell('rm -rf ~/Documents', 'open a shell and never run `rm -rf ~/Documents`')).toContain('runs only as the person typed it')
    expect(shell('rm -rf dist', 'open a shell and run `npm test`. Don\'t run "rm -rf dist"')).toContain('runs only as the person typed it')
    expect(shell('rm -rf x', 'open a shell and don\'t run rm -rf x')).toContain('runs only as the person typed it')
    expect(shell('npm run', 'open a shell and run npm run dev')).toContain('runs only as the person typed it') // a substring is not the command
    expect(shell('npm test', 'open a shell and run `npm test`. Don\'t run "rm -rf dist"')).toBeUndefined()
    expect(shell('make dev', 'open a shell that runs "make dev"')).toBeUndefined()
    expect(shell('git status', 'Can you open a shell and run git status?')).toBeUndefined()
    expect(shell('npm test', 'Open a new terminal in ../api and run npm test')).toBeUndefined()
    expect(shell('node index.js', 'open a shell and run node index.js.')).toBeUndefined()
    expect(shell('cd .. && ls', 'open a shell: cd .. && ls')).toBeUndefined()
    expect(shell('htop', 'give me a shell \u2018htop\u2019')).toBeUndefined()
    expect([...shellCommands('open a shell and run npm run dev in it')]).toEqual(['npm run dev'])
  })

  test('session names are s-<run>-<n>, never agt-, so the band and the worker reaper never pick them up', () => {
    expect(sessionName('k7f2ab', 1)).toBe('s-k7f2ab-1')
    expect(sessionName('k7f2ab', 8)).toBe('s-k7f2ab-8')
    expect(sessionName('k7f2ab', 0)).toBe(null)
    expect(sessionName('../x', 1)).toBe(null)
    expect(splitName(sessionName('k7f2ab', 1))).toBe(null)
    expect(paneAgentsOf([{ name: 's-k7f2ab-1', pane_id: 'w1:p5' }])).toEqual([])
  })

  test('the tool loads eagerly and says when to use it', () => {
    expect(OPEN_SESSIONS_TOOL.isDeferred).toBe(false)
    // What the reaper and the SessionEnd sweep really do, not "no reaper".
    expect(OPEN_SESSIONS_TOOL.description).not.toContain('no reaper')
    expect(OPEN_SESSIONS_TOOL.description).toContain('closed after 10 minutes idle and unfocused, and at session end when idle')
    expect(sessionsNote('herdr', 'claude')).toContain('closed after 10 minutes idle and unfocused, and at session end when idle')
    expect(OPEN_SESSIONS_TOOL.description).toContain('open or start sessions')
    expect(OPEN_SESSIONS_TOOL.description).toContain('never answer it with subagents')
    expect(OPEN_SESSIONS_TOOL.inputSchema.properties.model.enum).not.toContain('fable')
  })

  test('input: count, tasks, kind, model, cwd and layout, with defaults', () => {
    expect(sessionsToolInput({})).toEqual({ count: 1, tasks: [null], kind: 'claude', model: null, cwd: null, layout: 'stack' })
    expect(sessionsToolInput({ count: 3 })).toMatchObject({ count: 3, tasks: [null, null, null] })
    expect(sessionsToolInput({ tasks: ['fix the header', 'write the docs'] })).toMatchObject({ count: 2, tasks: ['fix the header', 'write the docs'] })
    expect(sessionsToolInput({ count: 3, tasks: ['fix the header'] }).tasks).toEqual(['fix the header', null, null])
    expect(sessionsToolInput({ count: 2, model: 'opus', cwd: '/w', layout: 'tab' })).toMatchObject({ model: 'opus', cwd: '/w', layout: 'tab' })
    expect(sessionsToolInput({ kind: 'shell', tasks: ['htop'] }, { typed: 'open a shell running htop' })).toMatchObject({ kind: 'shell', tasks: ['htop'] })
    expect(sessionsToolInput(undefined)).toMatchObject({ count: 1 })
  })

  test('input: bad values are refused', () => {
    expect(sessionsToolInput({ count: 0 }).error).toContain('1 to ' + MAX_SESSIONS)
    expect(sessionsToolInput({ count: MAX_SESSIONS + 1 }).error).toContain('1 to ' + MAX_SESSIONS)
    expect(sessionsToolInput({ count: 1.5 }).error).toContain('whole number')
    expect(sessionsToolInput({ count: 1, tasks: ['a b', 'c d'] }).error).toContain('one task per session')
    expect(sessionsToolInput({ tasks: 'do it' }).error).toContain('list of strings')
    expect(sessionsToolInput({ kind: 'gemini' }).error).toContain('kind must be one of ' + SESSION_KINDS.join(', '))
    expect(sessionsToolInput({ model: 'fable' }).error).toContain('model must be one of')
    expect(sessionsToolInput({ kind: 'shell', model: 'opus' }).error).toContain('Claude sessions only')
    expect(sessionsToolInput({ layout: 'grid' }).error).toContain('layout must be one of')
    expect(sessionsToolInput({ cwd: 'repo' }).error).toContain('absolute')
    expect(sessionsToolInput({ tasks: ['plugin'] }).error).toContain('one-word task')
  })

  test('herdr argv: a plain split and tab with no worker env, and the person\'s default model unless one is named', () => {
    const split = herdrSessionSplitArgv({ pane: 'w1:p1', cwd: '/w', direction: 'right' })
    expect(split).toEqual(['herdr', 'pane', 'split', '--pane', 'w1:p1', '--direction', 'right', '--cwd', '/w', '--no-focus'])
    expect(herdrSessionTabArgv({ workspace: 'w1', cwd: '/w', label: 'sessions' })).not.toContain('--env')
    expect(herdrSessionStartArgv({ name: 's-k7f2ab-1', pane: 'w1:p5', kind: 'claude', model: null }).slice(-1)).toEqual(['--'])
    expect(herdrSessionStartArgv({ name: 's-k7f2ab-1', pane: 'w1:p5', kind: 'claude', model: 'opus' }).slice(-2)).toEqual(['--model', 'opus'])
    expect(herdrSessionStartArgv({ name: 's-k7f2ab-1', pane: 'w1:p5', kind: 'codex', model: null })).toContain('codex')
  })

  test('tmux argv: claude with no worker env, the task after --, and a bare shell for kind shell', () => {
    const argv = tmuxSessionSplitArgv({ target: '%1', cwd: '/w', direction: 'right', shell: '/bin/zsh', kind: 'claude', model: null, task: 'fix it' })
    expect(argv.some((x) => x.startsWith('AGENTILLE_'))).toBe(false)
    expect(argv.slice(-6)).toEqual(['/bin/zsh', '-ic', 'claude "$@"', 's', '--', 'fix it'])
    expect(tmuxSessionSplitArgv({ target: '%1', cwd: '/w', direction: 'down', shell: '/bin/fish', kind: 'claude', model: 'haiku', task: null }).slice(-3)).toEqual(['claude', '--model', 'haiku'])
    expect(tmuxSessionSplitArgv({ target: '%1', cwd: '/w', direction: 'down', shell: '/bin/zsh', kind: 'shell', model: null, task: 'htop' }).at(-1)).toBe('/w')
    expect(tmuxTitleArgvs('%9', 's-k7f2ab-1').flat()).not.toContain('@agt')
    expect(tmuxTypeArgvs('%9', 'npm run dev')).toEqual([['tmux', 'send-keys', '-t', '%9', '-l', '--', 'npm run dev'], ['tmux', 'send-keys', '-t', '%9', 'Enter']])
  })

  test('the terminal id comes from a split, a tab or a pane get', () => {
    expect(herdrTerminalOf(JSON.stringify({ result: { pane: { pane_id: 'w1:p5', terminal_id: 'term_1' } } }))).toBe('term_1')
    expect(herdrTerminalOf(JSON.stringify({ result: { root_pane: { pane_id: 'w1:p5', terminal_id: 'term_2' } } }))).toBe('term_2')
    expect(herdrTerminalOf('nope')).toBe(null)
  })

  test('the note points herdr agents at prompt and read, and everyone at close_pane', () => {
    expect(sessionsNote('herdr', 'claude')).toContain('herdr agent prompt <name>')
    expect(sessionsNote('herdr', 'shell')).not.toContain('herdr agent')
    expect(sessionsNote('tmux', 'claude')).toContain('close_pane')
  })
})

import { paneAgents as paneAgentsOf } from '../../hooks/live.js'

describe('sessions: in the mod', () => {
  const setup = (on: any, vars: Record<string, string>, table: Record<string, any> = {}, owned: string[] = []) => {
    const seen: string[][] = []
    const tools: string[] = []
    on('env.get', async ($: any, e: any) => ({ value: vars[e.name] }))
    on('session.cwd', async () => ({ value: '/work/repo' }))
    on('session.start', async ($: any, e: any) => ({ cwd: e.cwd }))
    on('command.register', async () => ({ value: undefined }))
    on('tool.register', async ($: any, e: any) => { tools.push(e.name); return { value: { tool: 'mcp__agentille__' + e.name } } })
    // `owned`: pane names a previous session of this lead recorded in its lead-<pane>.panes file.
    on('fs.read', async ($: any, e: any) => (owned.length && /\/lead-[\w-]+\.panes$/.test(e.path) ? { value: owned.join('\n') + '\n' } : { deny: 'no profile' }))
    on('fs.exists', async () => ({ value: false }))
    on('fs.stat', async ($: any, e: any) => (e.path.startsWith('/work/') ? { value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false } } : { deny: 'ENOENT' }))
    on('store.get', async () => ({ value: undefined }))
    on('ui.panes', async () => ({ value: [] }))
    on('prompt.submit', async ($: any, e: any) => ({ text: e.text }))
    on('process.run', async ($: any, e: any) => {
      seen.push(e.argv)
      const key = Object.keys(table).find((k) => e.argv.join(' ').startsWith(k))
      const v = key === undefined ? {} : typeof table[key] === 'function' ? table[key](e.argv) : table[key]
      return { value: { exitCode: 0, stdout: '', stderr: '', ...v } }
    })
    mock.clock(on, { now: 1_000_000 })
    return { seen, tools }
  }
  const HERDR = { HERDR_ENV: '1', HERDR_PANE_ID: 'w1:p1', HOME: '/h' }
  const TMUX = { TMUX: '/tmp/tmux-1/default,1,0', TMUX_PANE: '%1', SHELL: '/bin/zsh', HOME: '/h' }
  let next = 4
  const herdrSplit = () => ({ stdout: JSON.stringify({ result: { pane: { pane_id: 'w1:p' + ++next, terminal_id: 'term_' + next } } }) })
  // Sessions open only on the turn the person typed the ask: `open` types one first.
  const asked = ($: any, text = 'open three sessions') => $.prompt.submit({ text, origin: { kind: 'composer' } } as never)
  const open = async ($: any, input: Record<string, unknown>) => { await asked($); return $.tool.call({ tool: 'mcp__agentille__open_sessions', ...input }) }
  const close = ($: any, name: string) => $.tool.call({ tool: 'mcp__agentille__close_pane', name })

  test('open_sessions is denied unless the newest typed prompt asked for sessions', async ($, on) => {
    next = 4
    const { seen } = setup(on, HERDR, { 'herdr pane split': herdrSplit })
    expect((await $.tool.call({ tool: 'mcp__agentille__open_sessions', count: 2 })).deny).toContain('typed a request for sessions')
    await asked($, 'fix the login form')
    expect((await $.tool.call({ tool: 'mcp__agentille__open_sessions', count: 2 })).deny).toContain('typed a request for sessions')
    expect(seen.some((a) => a.slice(0, 3).join(' ') === 'herdr pane split')).toBe(false)
    await asked($, 'start 2 codex panes here')
    expect((await $.tool.call({ tool: 'mcp__agentille__open_sessions', count: 2 })).result).toMatch(/^Opened s-/)
    // The ask does not carry over to the next typed prompt.
    await asked($, 'now fix the login form')
    expect((await $.tool.call({ tool: 'mcp__agentille__open_sessions', count: 1 })).deny).toContain('typed a request for sessions')
  })

  test('the ask is per turn: a notification turn after it opens nothing', async ($, on) => {
    next = 4
    const { seen } = setup(on, HERDR, { 'herdr pane split': herdrSplit })
    await asked($, 'open a session')
    expect((await $.tool.call({ tool: 'mcp__agentille__open_sessions', count: 1 })).result).toMatch(/^Opened s-/)
    await $.prompt.submit({ text: 'background task finished', origin: { kind: 'notification' } } as never)
    expect((await $.tool.call({ tool: 'mcp__agentille__open_sessions', count: 3 })).deny).toContain('typed a request for sessions')
    await $.prompt.submit({ text: 'peer message', origin: { kind: 'peer' } } as never)
    expect((await $.tool.call({ tool: 'mcp__agentille__open_sessions', count: 3 })).deny).toContain('typed a request for sessions')
    expect(seen.filter((a) => a.slice(0, 3).join(' ') === 'herdr pane split')).toHaveLength(1)
  })

  test('open_sessions is registered on the typed ask, with close_pane once; a later /agt adds spawn_pane only', async ($, on) => {
    const a = setup(on, TMUX, { 'tmux list-panes': { stdout: ['%1', '', 'claude', '0', '@1'].join('\t') + '\n' } })
    await $.session.start({ cwd: '/work/repo', surface: null, isInteractive: false })
    expect(a.tools).toEqual([])
    await asked($, 'open two sessions')
    expect(a.tools).toEqual(['open_sessions', 'close_pane'])
    await asked($, 'open another session')
    expect(a.tools).toEqual(['open_sessions', 'close_pane'])
    await asked($, '/agt ship it')
    expect(a.tools).toEqual(['open_sessions', 'close_pane', 'spawn_pane'])
  })

  test('herdr: three sessions stack right of the lead, then down, with no worker env and no prompt', async ($, on) => {
    next = 4
    const { seen } = setup(on, HERDR, { 'herdr pane split': herdrSplit })
    const r = await open($, { count: 3 })
    expect(r.result).toMatch(/^Opened s-([a-z0-9]{6})-1, s-\1-2, s-\1-3 · Claude · herdr panes\./)
    const splits = seen.filter((a) => a.slice(0, 3).join(' ') === 'herdr pane split')
    expect(splits.map((a) => [a[4], a[6]])).toEqual([['w1:p1', 'right'], ['w1:p5', 'down'], ['w1:p6', 'down']])
    expect(splits.flat().some((x) => x.startsWith('AGENTILLE_'))).toBe(false)
    const starts = seen.filter((a) => a.slice(0, 3).join(' ') === 'herdr agent start')
    expect(starts.map((a) => a[3])).toEqual(expect.arrayContaining([expect.stringMatching(/^s-[a-z0-9]{6}-1$/)]))
    expect(starts.every((a) => a.at(-1) === '--')).toBe(true)
    expect(seen.some((a) => a.slice(0, 3).join(' ') === 'herdr agent prompt')).toBe(false)
  })

  test('herdr: a task becomes the first prompt; a named model rides on start', async ($, on) => {
    next = 4
    const { seen } = setup(on, HERDR, { 'herdr pane split': herdrSplit })
    await open($, { tasks: ['fix the header'], model: 'opus' })
    expect(seen.find((a) => a.slice(0, 3).join(' ') === 'herdr agent start')!.slice(-2)).toEqual(['--model', 'opus'])
    expect(seen.find((a) => a.slice(0, 3).join(' ') === 'herdr agent prompt')!.at(-1)).toBe('fix the header')
  })

  test('herdr: a second call stacks under the last session; a gone one falls back to the lead', async ($, on) => {
    next = 4
    let refuse = false
    const { seen } = setup(on, HERDR, { 'herdr pane split': (argv: string[]) => (refuse && argv[4] !== 'w1:p1' ? { exitCode: 1, stderr: 'pane_not_found' } : herdrSplit()) })
    await open($, {})
    await open($, {})
    refuse = true
    await open($, {})
    const splits = seen.filter((a) => a.slice(0, 3).join(' ') === 'herdr pane split').map((a) => [a[4], a[6]])
    expect(splits).toEqual([['w1:p1', 'right'], ['w1:p5', 'down'], ['w1:p6', 'down'], ['w1:p1', 'right']])
  })

  test('a shell session runs only a command the person typed; --fable reaches a Claude session only when typed', async ($, on) => {
    next = 4
    const { seen } = setup(on, HERDR, { 'herdr pane split': herdrSplit })
    await asked($, 'open a shell and run npm run dev in it')
    expect((await $.tool.call({ tool: 'mcp__agentille__open_sessions', kind: 'shell', tasks: ['npm run build'] })).deny).toContain('runs only as the person typed it')
    expect(seen.some((a) => a.slice(0, 3).join(' ') === 'herdr pane run')).toBe(false)
    expect((await $.tool.call({ tool: 'mcp__agentille__open_sessions', kind: 'shell', tasks: ['npm run dev'] })).result).toContain('· shell ·')
    await asked($, 'open a session that ships it')
    await $.tool.call({ tool: 'mcp__agentille__open_sessions', tasks: ['/agt --fable ship it'] })
    expect(seen.filter((a) => a.slice(0, 3).join(' ') === 'herdr agent prompt').at(-1)!.at(-1)).toBe('/agt ship it')
    await asked($, 'open a session with --fable and ship it')
    await $.tool.call({ tool: 'mcp__agentille__open_sessions', tasks: ['/agt --fable ship it'] })
    expect(seen.filter((a) => a.slice(0, 3).join(' ') === 'herdr agent prompt').at(-1)!.at(-1)).toBe('/agt --fable ship it')
  })

  test('a shell session never runs a command the prompt said not to run', async ($, on) => {
    next = 4
    const { seen } = setup(on, HERDR, { 'herdr pane split': herdrSplit })
    await asked($, 'open a shell. Do NOT run rm -rf ~/Documents under any circumstance')
    expect((await $.tool.call({ tool: 'mcp__agentille__open_sessions', kind: 'shell', tasks: ['rm -rf ~/Documents'] })).deny).toContain('runs only as the person typed it')
    expect(seen.some((a) => a.slice(0, 3).join(' ') === 'herdr pane split')).toBe(false)
    expect((await $.tool.call({ tool: 'mcp__agentille__open_sessions', kind: 'shell' })).result).toContain('· shell ·')
  })

  test('herdr: a shell session runs its command and starts no agent', async ($, on) => {
    next = 4
    const { seen } = setup(on, HERDR, { 'herdr pane split': herdrSplit })
    await asked($, 'open a shell and run npm run dev')
    const r = await $.tool.call({ tool: 'mcp__agentille__open_sessions', kind: 'shell', tasks: ['npm run dev'] })
    expect(r.result).toContain('· shell · herdr pane.')
    expect(seen.some((a) => a.slice(0, 3).join(' ') === 'herdr agent start')).toBe(false)
    expect(seen).toContainEqual(['herdr', 'pane', 'run', 'w1:p5', 'npm run dev'])
  })

  test('herdr: a failed start closes that pane and reports the sessions already open', async ($, on) => {
    next = 4
    let starts = 0
    const { seen } = setup(on, HERDR, { 'herdr pane split': herdrSplit, 'herdr agent start': () => (++starts === 2 ? { exitCode: 1, stderr: 'boom' } : {}) })
    const r = await open($, { count: 3 })
    expect(r.result).toMatch(/^Opened s-[a-z0-9]{6}-1 · Claude · herdr pane\. Session 2 failed: herdr agent start exited 1: boom/)
    expect(seen).toContainEqual(['herdr', 'pane', 'close', 'w1:p6'])
  })

  test('close_pane closes a session only while its pane still holds the same terminal', async ($, on) => {
    next = 4
    let term = 'term_5'
    const { seen } = setup(on, HERDR, { 'herdr pane split': herdrSplit, 'herdr pane get': () => ({ stdout: JSON.stringify({ result: { pane: { pane_id: 'w1:p5', terminal_id: term } } }) }) })
    const name = (await open($, { count: 2 })).result.match(/s-[a-z0-9]{6}-1/)[0]
    expect((await close($, name)).result).toBe('Closed ' + name + '.')
    expect(seen).toContainEqual(['herdr', 'pane', 'close', 'w1:p5'])
    term = 'term_99'
    const other = name.replace(/-1$/, '-2')
    expect((await close($, other)).result).toBe(other + ' is already closed.')
    expect(seen).not.toContainEqual(['herdr', 'pane', 'close', 'w1:p6'])
  })

  test('tmux: claude with the task as its argument, a title and no @agt tag', async ($, on) => {
    const { seen } = setup(on, TMUX, { 'tmux split-window': { stdout: '%9\n' } })
    const r = await open($, { tasks: ['fix the header'] })
    expect(r.result).toMatch(/^Opened s-[a-z0-9]{6}-1 · Claude · tmux pane\. They close only on request: close_pane/)
    const split = seen.find((a) => a[1] === 'split-window')!
    expect(split.slice(-2)).toEqual(['--', 'fix the header'])
    expect(split.some((x) => x.startsWith('AGENTILLE_'))).toBe(false)
    expect(seen.some((a) => a.includes('@agt'))).toBe(false)
    expect(seen.some((a) => a[1] === 'select-pane' && /^s-/.test(a.at(-1)!))).toBe(true)
  })

  test('refusals: no transport, codex on tmux, a missing cwd, a worker pane', async ($, on) => {
    setup(on, TMUX, { 'tmux split-window': { stdout: '%9\n' } })
    expect((await open($, { kind: 'codex' })).deny).toBe('Codex sessions need Herdr.')
    expect((await open($, { cwd: '/nope' })).deny).toBe('/nope is not a directory.')
    expect((await open($, { count: 9 })).deny).toContain('1 to 8')
  })

  test('no transport: refused', async ($, on) => {
    setup(on, {})
    expect((await open($, {})).deny).toContain('No pane transport here')
  })
})

import { SESSION_IDLE_MS, sessionSweep, sessionsFile } from '../../hooks/panes.js'

describe('sessions: the idle sweep', () => {
  const s = (name: string, kind = 'claude') => ({ id: 'w1:' + name, name, kind, tab: null, terminal: 't' })
  test('an idle, unfocused session closes after the grace; done, working, blocked and focused ones reset it', () => {
    const since = new Map()
    const all = [s('s-a-1'), s('s-a-2'), s('s-a-3'), s('s-a-4'), s('s-a-5')]
    const agents = [
      { name: 's-a-1', agent_status: 'idle' },
      { name: 's-a-2', agent_status: 'done' },
      { name: 's-a-3', agent_status: 'working' },
      { name: 's-a-4', agent_status: 'blocked' },
      { name: 's-a-5', agent_status: 'idle', focused: true },
    ]
    expect(sessionSweep(all, agents, since, 0)).toEqual([])
    expect(sessionSweep(all, agents, since, SESSION_IDLE_MS - 1)).toEqual([])
    expect(sessionSweep(all, agents, since, SESSION_IDLE_MS).map((x) => x.name)).toEqual(['s-a-1'])
    agents[0].agent_status = 'working'
    expect(sessionSweep(all, agents, since, SESSION_IDLE_MS * 2)).toEqual([])
    expect(since.has('s-a-1')).toBe(false)
  })

  test('a session whose agent left (a bare shell now) and a shell are never due', () => {
    const since = new Map()
    expect(sessionSweep([s('s-a-1'), s('s-a-2', 'shell')], [], since, 0)).toEqual([])
    expect(sessionSweep([s('s-a-1'), s('s-a-2', 'shell')], [], since, SESSION_IDLE_MS * 2)).toEqual([])
  })

  test('the sessions file sits beside the run-tabs file', () => {
    expect(sessionsFile('/h', 'w1:p3')).toBe('/h/.agentille/state/lead-w1-p3.sessions')
    expect(sessionsFile(null, 'w1:p3')).toBe(null)
  })

  test('the note tells a herdr lead the sessions close themselves; tmux ones only on request', () => {
    expect(sessionsNote('herdr', 'claude')).toContain('is closed after 10 minutes idle')
    expect(sessionsNote('tmux', 'claude')).toContain('close only on request')
  })

  test('in the mod: the lead closes a session idle past the grace, and records sessions for SessionEnd', async ($, on) => {
    const seen: string[][] = []
    const writes: Record<string, string> = {}
    const toasts: string[] = []
    let status = 'idle'
    on('env.get', async ($: any, e: any) => ({ value: ({ HERDR_ENV: '1', HERDR_PANE_ID: 'w1:p1', HOME: '/h' } as any)[e.name] }))
    on('session.cwd', async () => ({ value: '/work/repo' }))
    on('session.start', async ($: any, e: any) => ({ cwd: e.cwd }))
    on('command.register', async () => ({ value: undefined }))
    on('tool.register', async ($: any, e: any) => ({ value: { tool: 'mcp__agentille__' + e.name } }))
    on('fs.read', async () => ({ deny: 'no profile' }))
    on('fs.write', async ($: any, e: any) => { writes[e.path] = e.content ?? e.text ?? e.data; return { value: undefined } })
    on('store.get', async () => ({ value: undefined }))
    on('ui.toast', async ($: any, e: any) => { toasts.push(e.text ?? e.message ?? String(e)); return { value: undefined } })
    on('process.run', async ($: any, e: any) => {
      seen.push(e.argv)
      const cmd = e.argv.slice(0, 3).join(' ')
      const out = (o: unknown) => ({ value: { exitCode: 0, stdout: JSON.stringify(o), stderr: '' } })
      if (cmd === 'herdr pane split') return out({ result: { pane: { pane_id: 'w1:p5', terminal_id: 'term_5' } } })
      if (cmd === 'herdr pane get') return out({ result: { pane: { pane_id: 'w1:p5', terminal_id: 'term_5' } } })
      if (cmd === 'herdr agent list') {
        const name = seen.find((a) => a.slice(0, 3).join(' ') === 'herdr agent start')?.[3]
        return out({ result: { agents: [{ name: null, pane_id: 'w1:p1', agent_status: 'working', tab_id: 't1', workspace_id: 'w1' }, ...(name ? [{ name, pane_id: 'w1:p5', agent_status: status, tab_id: 't1', workspace_id: 'w1' }] : [])] } })
      }
      return { value: { exitCode: 0, stdout: '', stderr: '' } }
    })
    on('prompt.submit', async ($: any, e: any) => ({ text: e.text }))
    const clock = mock.clock(on, { now: 1_000_000 })
    await $.session.start({ cwd: '/work/repo', surface: null, isInteractive: false })
    await $.prompt.submit({ text: 'open a session', origin: { kind: 'composer' } } as never)
    const r = await $.tool.call({ tool: 'mcp__agentille__open_sessions', count: 1 } as never)
    const name = r.result.match(/s-[a-z0-9]{6}-1/)[0]
    expect(writes['/h/.agentille/state/lead-w1-p1.sessions']).toBe(name + '\n')
    for (let t = 0; t < SESSION_IDLE_MS / 2; t += 5000) await clock.advance(5000)
    expect(seen).not.toContainEqual(['herdr', 'pane', 'close', 'w1:p5'])
    for (let t = 0; t < SESSION_IDLE_MS / 2 + 15_000; t += 5000) await clock.advance(5000)
    expect(seen).toContainEqual(['herdr', 'pane', 'close', 'w1:p5'])
    expect(writes['/h/.agentille/state/lead-w1-p1.sessions']).toBe(name + '\n')
    expect(toasts.some((t) => t.includes('closed ' + name))).toBe(true)
  })
})

import { cleanWorkspace } from '../../hooks/reaper.js'
import { S as modState } from '../../hooks/state.js'
import { strandedNow } from '../../hooks/panerec.js'

describe('/agt-clean: a stranded pane', () => {
  const LEAD = { name: 'lead', pane_id: 'w1:p1', agent: 'claude', agent_status: 'working', state_change_seq: 1, tab_id: 'w1:t1', workspace_id: 'w1' }
  const DONE = { name: 'agt-r9-executor', pane_id: 'w1:p2', agent: 'claude', agent_status: 'done', state_change_seq: 4, tab_id: 'w1:t1', workspace_id: 'w1' }
  const herdrList = () => ({ value: { exitCode: 0, stderr: '', stdout: JSON.stringify({ result: { agents: [LEAD, DONE] } }) } })

  test('a done pane with no saved answer and no wire message is flagged, kept by the run-end tidy, and closed by a typed /agt-clean', async ($, on) => {
    const seen: string[][] = []
    const toasts: string[] = []
    on('env.get', async ($: any, e: any) => ({ value: ({ HERDR_ENV: '1', HERDR_PANE_ID: 'w1:p1', HOME: '/h' } as any)[e.name] }))
    on('session.start', async ($: any, e: any) => ({ cwd: e.cwd }))
    on('session.id', async () => ({ value: 'lead-sid' }))
    on('session.cwd', async () => ({ value: '/work/repo' }))
    on('session.send', async () => ({ isDelivered: true }))
    on('command.register', async () => ({ value: undefined }))
    on('tool.register', async ($: any, e: any) => ({ value: { tool: 'mcp__agentille__' + e.name } }))
    on('prompt.submit', async ($: any, e: any) => ({ text: e.text }))
    on('turn.start', async ($: any, e: any) => ({ turnId: e.turnId }))
    on('turn.complete', async ($: any, e: any) => ({ text: e.answer }))
    on('ui.toast', async ($: any, e: any) => { toasts.push(e.text); return { value: undefined } })
    on('ui.render', async () => ({ type: 'engine', ref: 0 }) as never)
    // Ownership: a previous session of this lead recorded the pane in lead-w1-p1.panes. No answer file exists.
    on('fs.read', async ($: any, e: any) => (e.path === '/h/.agentille/state/lead-w1-p1.panes' ? { value: 'agt-r9-executor\n' } : { deny: 'ENOENT' }))
    on('fs.exists', async () => ({ value: false }))
    on('fs.stat', async () => ({ deny: 'ENOENT' }))
    on('store.get', async () => ({ value: undefined }))
    on('process.run', async ($: any, e: any) => {
      seen.push(e.argv)
      if (e.argv.slice(0, 3).join(' ') === 'herdr agent list') return herdrList()
      return { value: { exitCode: 0, stdout: '', stderr: '' } }
    })
    const clock = mock.clock(on, { now: 1_000_000 })
    const closes = () => seen.filter((a) => a.slice(0, 3).join(' ') === 'herdr pane close').map((a) => a[3])
    await $.session.start({ cwd: '/work/repo', surface: null, isInteractive: false })
    await clock.advance(30_000)
    expect(toasts.filter((t) => t.includes('agt-r9-executor done, not harvested'))).toHaveLength(1)
    expect(closes()).toEqual([])
    // A typed /agt run ends on its ✓ card: the run-end tidy runs and leaves the unread pane open.
    await $.prompt.submit({ text: '/agt ship it', origin: { kind: 'composer' } } as never)
    await $.turn.start({ text: '/agt ship it', turnId: 't1' })
    await $.turn.complete({ answer: '✓ shipped · 1 slice', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' })
    await clock.advance(5_000)
    expect(seen.some((a) => a[0] === 'git')).toBe(true) // the tidy ran
    expect(closes()).toEqual([])
    const r = await $.command.run({ command: 'agt-clean', args: '', origin: { kind: 'composer' } } as never)
    expect(closes()).toEqual(['w1:p2'])
    expect(r.text).toContain('1 pane closed')
  })

  test('the tidy without all keeps a stranded pane and says why; with all it closes it', async () => {
    const saved = { transport: modState.transport, home: modState.home, panes: modState.panes }
    const runs: string[][] = []
    const fake = {
      process: { run: async (argv: string[]) => { runs.push(argv); return argv.slice(0, 3).join(' ') === 'herdr agent list' ? herdrList().value : { exitCode: 0, stdout: '', stderr: '' } } },
      env: { get: async (k: string) => (k === 'HERDR_PANE_ID' ? 'w1:p1' : undefined) },
      fs: { list: async () => [], read: async () => '', exists: async () => false, stat: async () => null },
      session: { cwd: async () => null },
      ui: { invalidate: () => {}, toast: () => {} },
    }
    try {
      Object.assign(modState, { transport: 'herdr', home: '/h', panes: [{ id: 'w1:p2', name: 'agt-r9-executor', state: 'done' }] })
      strandedNow.add('agt-r9-executor')
      const kept = await cleanWorkspace(fake as never, { auto: true })
      expect(kept.closed).toEqual([])
      expect(kept.keep).toContainEqual({ what: 'agt-r9-executor', why: 'answer not read · /agt-clean closes it' })
      expect(runs.filter((a) => a.slice(0, 3).join(' ') === 'herdr pane close')).toEqual([])
      const all = await cleanWorkspace(fake as never, { all: true, panesOnly: true })
      expect(all.closed).toEqual(['agt-r9-executor'])
      expect(runs).toContainEqual(herdrCloseArgv('w1:p2'))
    } finally {
      Object.assign(modState, saved)
      strandedNow.clear()
    }
  })
})

describe('sessions: /agt-clean after a lead died', () => {
  test('a dead lead\'s idle sessions close and its list goes; a live lead\'s, a done or a focused one stay', async ($, on) => {
    const seen: string[][] = []
    const files: Record<string, string> = { '/h/.agentille/state/lead-w1-p9.sessions': 's-dead00-1\ns-dead00-2\ns-dead00-3\n', '/h/.agentille/state/lead-w1-p2.sessions': 's-live00-1\n' }
    on('env.get', async ($: any, e: any) => ({ value: ({ HERDR_ENV: '1', HERDR_PANE_ID: 'w1:p1', HOME: '/h' } as any)[e.name] }))
    on('session.cwd', async () => ({ value: '/work/repo' }))
    on('session.start', async ($: any, e: any) => ({ cwd: e.cwd }))
    on('command.register', async () => ({ value: undefined }))
    on('tool.register', async ($: any, e: any) => ({ value: { tool: 'mcp__agentille__' + e.name } }))
    on('fs.read', async ($: any, e: any) => (e.path in files ? { value: files[e.path] } : { deny: 'ENOENT' }))
    on('fs.list', async ($: any, e: any) => ({ value: e.path === '/h/.agentille/state' ? Object.keys(files).map((f) => ({ name: f.split('/').pop(), kind: 'file' })) : [] }))
    on('store.get', async () => ({ value: undefined }))
    on('process.run', async ($: any, e: any) => {
      seen.push(e.argv)
      if (e.argv.slice(0, 3).join(' ') === 'herdr agent list') {
        return { value: { exitCode: 0, stderr: '', stdout: JSON.stringify({ result: { agents: [
          { name: null, pane_id: 'w1:p1', agent_status: 'working', tab_id: 't1', workspace_id: 'w1' },
          { name: null, pane_id: 'w1:p2', agent_status: 'idle', tab_id: 't1', workspace_id: 'w1' },
          { name: 's-dead00-1', pane_id: 'w1:p5', agent_status: 'idle', tab_id: 't1', workspace_id: 'w1' },
          { name: 's-dead00-2', pane_id: 'w1:p6', agent_status: 'done', tab_id: 't1', workspace_id: 'w1' },
          { name: 's-dead00-3', pane_id: 'w1:p7', agent_status: 'idle', focused: true, tab_id: 't1', workspace_id: 'w1' },
          { name: 's-live00-1', pane_id: 'w1:p8', agent_status: 'idle', tab_id: 't1', workspace_id: 'w1' },
        ] } }) } }
      }
      return { value: { exitCode: 0, stdout: '', stderr: '' } }
    })
    mock.clock(on, { now: 1_000_000 })
    await $.session.start({ cwd: '/work/repo', surface: null, isInteractive: false })
    await $.command.run({ command: 'agt-clean', args: '', origin: { kind: 'composer' } } as never)
    const closed = seen.filter((a) => a.slice(0, 3).join(' ') === 'herdr pane close').map((a) => a[3])
    expect(closed).toEqual(['w1:p5'])
    expect(seen).toContainEqual(['rm', '-f', '/h/.agentille/state/lead-w1-p9.sessions'])
    expect(seen).not.toContainEqual(['rm', '-f', '/h/.agentille/state/lead-w1-p2.sessions'])
  })
})

describe('/agt-clean: old run folders', () => {
  test('a run folder untouched for 14 days goes; a fresh one, the run in progress and a run with a live pane stay', async ($, on) => {
    const seen: string[][] = []
    const now = Date.now()
    const old = now - 15 * 24 * 60 * 60_000
    const dirs: Record<string, number> = { 'run-old001': old, 'run-old002': old, 'run-fresh1': now - 60_000, 'run-k7f2ab': old, 'run-adhoc': old, 'lead-w1-p1.tabs': old }
    on('env.get', async ($: any, e: any) => ({ value: ({ HERDR_ENV: '1', HERDR_PANE_ID: 'w1:p1', HOME: '/h' } as any)[e.name] }))
    on('session.cwd', async () => ({ value: '/work/repo' }))
    on('session.start', async ($: any, e: any) => ({ cwd: e.cwd }))
    on('command.register', async () => ({ value: undefined }))
    on('tool.register', async ($: any, e: any) => ({ value: { tool: 'mcp__agentille__' + e.name } }))
    on('fs.read', async ($: any, e: any) => (e.path === '/h/.agentille/state/lead-w1-p1.panes' ? { value: 'agt-k7f2ab-exec-1\n' } : { deny: 'ENOENT' }))
    on('fs.list', async ($: any, e: any) => ({ value: e.path === '/h/.agentille/state' ? Object.keys(dirs).map((n) => ({ name: n, kind: n.startsWith('run-') ? 'dir' : 'file' })) : [] }))
    on('fs.stat', async ($: any, e: any) => { const n = e.path.split('/').pop()!; return n in dirs ? { value: { kind: 'dir', size: 0, mtimeMs: dirs[n], isLink: false } } : { deny: 'ENOENT' } })
    on('store.get', async () => ({ value: undefined }))
    on('process.run', async ($: any, e: any) => {
      seen.push(e.argv)
      if (e.argv.slice(0, 3).join(' ') === 'herdr agent list') {
        return { value: { exitCode: 0, stderr: '', stdout: JSON.stringify({ result: { agents: [
          { name: null, pane_id: 'w1:p1', agent_status: 'working', tab_id: 't1', workspace_id: 'w1' },
          { name: 'agt-k7f2ab-exec-1', pane_id: 'w1:p5', agent_status: 'working', tab_id: 't1', workspace_id: 'w1' },
        ] } }) } }
      }
      return { value: { exitCode: 0, stdout: '', stderr: '' } }
    })
    mock.clock(on, { now: 1_000_000 })
    await $.session.start({ cwd: '/work/repo', surface: null, isInteractive: false })
    const r = await $.command.run({ command: 'agt-clean', args: '', origin: { kind: 'composer' } } as never)
    const gone = seen.filter((a) => a[0] === 'rm' && a[1] === '-rf').map((a) => a[2])
    expect(gone).toEqual(['/h/.agentille/state/run-old001', '/h/.agentille/state/run-old002'])
    expect(r.text).toContain('2 old run folders dropped')
  })
})

describe('sessions: an agent that left', () => {
  test('a session whose claude exited stays open; once its pane is gone the lead forgets it', async ($, on) => {
    const seen: string[][] = []
    let listed = true
    let paneAlive = true
    on('env.get', async ($: any, e: any) => ({ value: ({ HERDR_ENV: '1', HERDR_PANE_ID: 'w1:p1', HOME: '/h' } as any)[e.name] }))
    on('session.cwd', async () => ({ value: '/work/repo' }))
    on('session.start', async ($: any, e: any) => ({ cwd: e.cwd }))
    on('command.register', async () => ({ value: undefined }))
    on('tool.register', async ($: any, e: any) => ({ value: { tool: 'mcp__agentille__' + e.name } }))
    on('fs.read', async () => ({ deny: 'no profile' }))
    on('fs.write', async () => ({ value: undefined }))
    on('store.get', async () => ({ value: undefined }))
    on('process.run', async ($: any, e: any) => {
      seen.push(e.argv)
      const cmd = e.argv.slice(0, 3).join(' ')
      const out = (o: unknown) => ({ value: { exitCode: 0, stdout: JSON.stringify(o), stderr: '' } })
      if (cmd === 'herdr pane split') return out({ result: { pane: { pane_id: 'w1:p5', terminal_id: 'term_5' } } })
      if (cmd === 'herdr pane get') return paneAlive ? out({ result: { pane: { pane_id: 'w1:p5', terminal_id: 'term_5', focused: false } } }) : { value: { exitCode: 1, stdout: '', stderr: 'pane_not_found' } }
      if (cmd === 'herdr agent list') {
        const name = seen.find((a) => a.slice(0, 3).join(' ') === 'herdr agent start')?.[3]
        return out({ result: { agents: [{ name: null, pane_id: 'w1:p1', agent_status: 'working', tab_id: 't1', workspace_id: 'w1' }, ...(name && listed ? [{ name, pane_id: 'w1:p5', agent_status: 'idle', tab_id: 't1', workspace_id: 'w1' }] : [])] } })
      }
      return { value: { exitCode: 0, stdout: '', stderr: '' } }
    })
    on('prompt.submit', async ($: any, e: any) => ({ text: e.text }))
    const clock = mock.clock(on, { now: 1_000_000 })
    await $.session.start({ cwd: '/work/repo', surface: null, isInteractive: false })
    await $.prompt.submit({ text: 'open a session', origin: { kind: 'composer' } } as never)
    const name = (await $.tool.call({ tool: 'mcp__agentille__open_sessions', count: 1 } as never)).result.match(/s-[a-z0-9]{6}-1/)[0]
    listed = false
    for (let t = 0; t < SESSION_IDLE_MS + 30_000; t += 5000) await clock.advance(5000)
    expect(seen).not.toContainEqual(['herdr', 'pane', 'close', 'w1:p5'])
    paneAlive = false
    await clock.advance(5000)
    expect((await $.tool.call({ tool: 'mcp__agentille__close_pane', name } as never)).deny).toContain('agt-<run>-<role>')
  })
})
