import { describe, expect, test } from 'claude-code/testing'
import { doneFile, herdrCloseArgv, herdrPaneIdOf, herdrPromptArgv, herdrSplitArgv, herdrStartArgv, isLead, newRunId, paneName, parseSpawnArgs, parseTmuxList, pickTransport, reapPool, splitName, tmuxKillArgv, tmuxPaneAgents, tmuxPaneIdOf, tmuxSplitArgv, tmuxTagArgvs, transportBlock, TMUX_LIST_FORMAT } from '../../hooks/panes.js'
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
    expect(parseSpawnArgs('task --model "x;rm"')).toMatchObject({ error: expect.any(String) })
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
    expect(argv).toEqual(['tmux', 'split-window', '-d', '-h', '-P', '-F', '#{pane_id}', '-t', '%1', '-c', '/work/repo', '-e', 'AGENTILLE_RUN=ab12cd', '/bin/zsh', '-ic', 'claude "$@"', 'agt', '--model', 'haiku', '-n', 'agt-ab12cd-spawn', 'a "quoted"; $(thing)'])
  })

  test('other shells exec claude directly', async () => {
    const argv = tmuxSplitArgv({ target: '%1', cwd: '/w', run: 'ab12cd', shell: '/usr/bin/fish', model: 'haiku', name: 'agt-ab12cd-spawn', task: 't' })
    expect(argv.slice(13)).toEqual(['claude', '--model', 'haiku', '-n', 'agt-ab12cd-spawn', 't'])
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

  test('with no multiplexer it says so, and other skills are untouched', async ($, on) => {
    answer(on, {}, { 'herdr --version': 127 })
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
  const LIST = [row('%1', ''), row('%2', 'agt-r9-executor'), row('%3', 'agt-r9-planner'), row('%4', 'agt-r9-spawn-x', '1'), row('%5', 'agt-r9-other', '0', '@2')].join('\n')

  // session.start probes tmux, polls once and draws; the 5s timer is left unfired
  const start = async ($: any, on: any, killed: string[] = [], files: string[] = []) => {
    on('env.get', async ($: any, e: any) => ({ value: ({ TMUX: '/tmp/tmux-1/default,1,0', TMUX_PANE: '%1', HOME: '/h' } as any)[e.name] }))
    on('session.start', async ($: any, e: any) => ({ cwd: e.cwd }))
    on('command.register', async () => ({ value: undefined }))
    on('fs.read', async () => ({ deny: 'no profile' }))
    on('fs.exists', async ($: any, e: any) => ({ value: files.includes(e.path) }))
    on('store.get', async () => ({ value: undefined }))
    on('ui.panes', async () => ({ value: [] }))
    on('process.run', async ($: any, e: any) => {
      const cmd = e.argv.join(' ')
      if (cmd.startsWith('tmux list-panes')) return { value: { exitCode: 0, stdout: LIST + '\n', stderr: '' } }
      if (cmd.startsWith('tmux kill-pane')) killed.push(e.argv[3])
      return { value: { exitCode: 0, stdout: '', stderr: '' } }
    })
    await $.session.start({ cwd: '/w', surface: null, isInteractive: false })
  }

  test('shows this window\'s agt- panes in the band', async ($, on) => {
    on('ui.render', async () => ({ type: 'engine', ref: 0 }) as never)
    await start($, on, [], ['/h/.agentille/state/run-r9/done-planner'])
    const ui = await $.ui.mount({ plugin: 'agentille', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 100 } as never })
    expect(await ui.find({ type: 'Text', text: /executor/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /planner/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /1 working · 2 done/ })).toBeDefined()
    await ui.unmount()
  })
})
