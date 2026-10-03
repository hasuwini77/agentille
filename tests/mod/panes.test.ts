import { describe, expect, test } from 'claude-code/testing'
import { detectTransport, doneFile, isLead, newRunId, paneName, parseSpawnArgs, parseTmuxList, reapPool, spawnPane, splitName, tmuxPaneAgents, tmuxSplitArgv, tmuxTagArgvs, transportBlock, TMUX_LIST_FORMAT } from '../../hooks/panes.js'
import { reapable } from '../../hooks/live.js'

const TAB = '\t'
// A stand-in for `$`: env vars and process.run answered from tables. A table value is a
// partial { exitCode, stdout, stderr } or an Error (the binary is missing, so run rejects).
const mk = (vars: Record<string, string> = {}, table: Record<string, any> = {}, exists: string[] = []) => {
  const seen: string[][] = []
  const inits: any[] = []
  const $: any = {
    env: { get: async (name: string) => vars[name] },
    fs: { exists: async (p: string) => exists.includes(p) },
    process: {
      run: async (argv: string[], init?: any) => {
        seen.push(argv)
        inits.push(init)
        const key = Object.keys(table).find((k) => argv.join(' ').startsWith(k))
        const hit = key === undefined ? {} : table[key]
        if (hit instanceof Error) throw hit
        return { exitCode: 0, stdout: '', stderr: '', ...hit }
      },
    },
  }
  return { $, seen, inits }
}

describe('transport', () => {
  test('herdr wins when HERDR_ENV=1 and herdr runs', async () => {
    const { $ } = mk({ HERDR_ENV: '1', TMUX: '/tmp/tmux-1/default,1,0' }, { 'herdr --version': { stdout: 'herdr 1' }, 'tmux -V': { stdout: 'tmux 3.4' } })
    expect(await detectTransport($)).toBe('herdr')
  })

  test('a failed herdr probe falls through to tmux', async () => {
    const { $ } = mk({ HERDR_ENV: '1', TMUX: '/tmp/tmux-1/default,1,0' }, { 'herdr --version': { exitCode: 127 } })
    expect(await detectTransport($)).toBe('tmux')
  })

  test('a probe that rejects counts as unavailable', async () => {
    const { $ } = mk({ HERDR_ENV: '1', TMUX: '/tmp/tmux-1/default,1,0' }, { 'herdr --version': new Error('spawn herdr ENOENT'), 'tmux -V': new Error('spawn tmux ENOENT') })
    expect(await detectTransport($)).toBe('none')
  })

  test('tmux needs a non-empty TMUX; HERDR_ENV must be exactly 1', async () => {
    const { $, seen } = mk({ HERDR_ENV: '0', TMUX: '' })
    expect(await detectTransport($)).toBe('none')
    expect(seen).toEqual([])
  })

  test('no $.process (desktop app, VS Code) is none', async () => {
    expect(await detectTransport({ env: { get: async () => '1' } })).toBe('none')
  })

  test('probes carry the 5s timeout', async () => {
    const { $, inits } = mk({ HERDR_ENV: '1' })
    await detectTransport($)
    expect(inits).toEqual([{ timeoutMs: 5000 }])
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
  const o = { run: 'ab12cd', role: 'spawn', model: 'haiku', task: 'reply with ok', cwd: '/work/repo' }

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

  test('tmux spawn: split, tag, return the pane id', async () => {
    const { $, seen } = mk({ TMUX_PANE: '%1', SHELL: '/bin/zsh' }, { 'tmux split-window': { stdout: '%9\n' } })
    expect(await spawnPane($, 'tmux', o)).toBe('%9')
    expect(seen.map((a) => a[1])).toEqual(['split-window', 'set-option', 'set-option', 'set-option', 'select-pane'])
  })

  test('tmux spawn kills the pane when tagging fails', async () => {
    const { $, seen } = mk({ TMUX_PANE: '%1', SHELL: '/bin/zsh' }, { 'tmux split-window': { stdout: '%9\n' }, 'tmux set-option -p -t %9 @agt_vendor': { exitCode: 1, stderr: 'boom' } })
    await expect(spawnPane($, 'tmux', o)).rejects.toThrow(/exited 1/)
    expect(seen[seen.length - 1]).toEqual(['tmux', 'kill-pane', '-t', '%9'])
  })

  test('herdr spawn: split, start, prompt, never focused', async () => {
    const { $, seen, inits } = mk({ HERDR_PANE_ID: 'w1:p1' }, { 'herdr pane split': { stdout: JSON.stringify({ result: { pane: { pane_id: 'w1:p5' } } }) } })
    expect(await spawnPane($, 'herdr', o)).toBe('w1:p5')
    expect(seen[0]).toEqual(['herdr', 'pane', 'split', '--pane', 'w1:p1', '--direction', 'right', '--cwd', '/work/repo', '--env', 'AGENTILLE_RUN=ab12cd', '--no-focus'])
    expect(seen[1]).toEqual(['herdr', 'agent', 'start', 'agt-ab12cd-spawn', '--kind', 'claude', '--pane', 'w1:p5', '--timeout', '45000', '--', '--model', 'haiku'])
    expect(seen[2]).toEqual(['herdr', 'agent', 'prompt', 'agt-ab12cd-spawn', 'reply with ok'])
    expect(inits[1]).toEqual({ timeoutMs: 60000 })
  })

  test('herdr spawn closes the pane when start fails', async () => {
    const { $, seen } = mk({ HERDR_PANE_ID: 'w1:p1' }, { 'herdr pane split': { stdout: JSON.stringify({ result: { pane: { pane_id: 'w1:p5' } } }) }, 'herdr agent start': { exitCode: 2 } })
    await expect(spawnPane($, 'herdr', o)).rejects.toThrow()
    expect(seen[seen.length - 1]).toEqual(['herdr', 'pane', 'close', 'w1:p5'])
  })

  test('refuses a bad name and no transport', async () => {
    const { $ } = mk()
    await expect(spawnPane($, 'tmux', { ...o, run: '../x' })).rejects.toThrow('bad pane name')
    await expect(spawnPane($, 'none', o)).rejects.toThrow('no pane transport')
  })
})
