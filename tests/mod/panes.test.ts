import { describe, expect, mock, test } from 'claude-code/testing'
import { EFFORTS, PANE_RULE, splitPlan, tmuxEvenArgv, tmuxWidthArgv, widthOf, SPAWN_TOOL, closeTarget, paneRole, doneFile, spawnToolInput, TOOL_MODELS, herdrCloseArgv, herdrPaneIdOf, herdrPromptArgv, herdrSplitArgv, herdrStartArgv, isFreshDone, isLead, newRunId, paneName, parseSpawnArgs, parseTmuxList, pickTransport, quietSpawn, reapPool, scopeRows, splitName, tmuxKillArgv, tmuxPaneAgents, tmuxPaneIdOf, tmuxSplitArgv, tmuxTagArgvs, teamDirective, teamForce, teamNotice, transportBlock, TMUX_LIST_FORMAT } from '../../hooks/panes.js'
import { reapable } from '../../hooks/live.js'
import { ROLES, roleOf } from '../../hooks/routing.js'

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

  test('with the tools registered, the block points at them; never on none', async () => {
    expect(transportBlock('herdr')).not.toContain('spawn_pane')
    expect(transportBlock('tmux', true)).toContain('mcp__agentille__spawn_pane')
    expect(transportBlock('tmux', true)).toContain('"Through the mod\'s tools"')
    expect(transportBlock('none', true)).not.toContain('spawn_pane')
  })

  test('the pane rule rides with the tools, on tmux and herdr only', async () => {
    expect(transportBlock('tmux', true)).toContain(PANE_RULE)
    expect(transportBlock('herdr', true)).toContain(PANE_RULE)
    expect(transportBlock('tmux')).not.toContain('Pane rule')
    expect(transportBlock('none', true)).not.toContain('Pane rule')
    expect(PANE_RULE).toContain('1.12×')
    expect(PANE_RULE).toContain('--mode subagent')
    expect(PANE_RULE).toContain('header')
    expect(PANE_RULE).not.toContain('deprecated')
  })
})

describe('teamForce', () => {
  test('--team <name> and --mode team on a typed /agt', async () => {
    expect(teamForce('/agt --team feature-team build it')).toEqual({ template: 'feature-team' })
    expect(teamForce('/agentille:agt --team=review-team x')).toEqual({ template: 'review-team' })
    expect(teamForce('/agt --mode team build it')).toEqual({ template: null })
    expect(teamForce('/agt --mode team --team incident-team x')).toEqual({ template: 'incident-team' })
  })

  test('everything else is null', async () => {
    expect(teamForce('/agt add a search filter')).toBe(null)
    expect(teamForce('/agt --mode subagent x')).toBe(null)
    expect(teamForce('/agt --mode teams x')).toBe(null)
    expect(teamForce('fix it --team feature-team')).toBe(null)
    expect(teamForce('/agt-ledger --team a')).toBe(null)
    expect(teamForce(undefined)).toBe(null)
  })

  test('only the leading flags of /agt count, templates are validated', async () => {
    expect(teamForce('/agt explain the --team flag')).toBe(null)
    expect(teamForce('/agt why does "--mode team" fail')).toBe(null)
    expect(teamForce('/agt fix "--team foo"')).toBe(null)
    expect(teamForce('/agt --plan --team review-team "audit"')).toEqual({ template: 'review-team' })
    expect(teamForce('/agt --team --plan x')).toEqual({ template: null })
    expect(teamForce('/agt --team bogus-team x')).toEqual({ template: null })
    expect(teamForce('/agt --fable --mode=team x')).toEqual({ template: null })
  })
})

describe('teamNotice', () => {
  test('names the transport the forced team lands on', async () => {
    expect(teamNotice('herdr')).toBe('--team is deprecated (removed in v3.0): running as panes · herdr.')
    expect(teamNotice('tmux')).toBe('--team is deprecated (removed in v3.0): running as panes · tmux.')
    expect(teamNotice('none')).toBe('--team is deprecated (removed in v3.0): running as a team — no pane transport here.')
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

describe('forced team notice', () => {
  const setup = (on: any, vars: Record<string, string>) => {
    const toasts: string[] = []
    on('env.get', async ($: any, e: any) => ({ value: vars[e.name] }))
    on('process.run', async () => ({ value: { exitCode: 0, stdout: '', stderr: '' } }))
    on('store.get', async () => ({ value: undefined }))
    on('store.set', async () => ({ value: undefined }))
    on('ui.panes', async () => ({ value: [] }))
    on('ui.open', async () => ({ value: { isPlaced: true } }))
    on('ui.toast', async ($: any, e: any) => { toasts.push(e.text ?? e.message ?? String(e)); return { value: undefined } })
    on('prompt.submit', async ($: any, e: any) => ({ text: e.text }))
    return toasts
  }

  test('a typed forced team toasts the notice', async ($, on) => {
    const toasts = setup(on, { HERDR_ENV: '1' })
    await $.prompt.submit({ text: '/agt --team feature-team build it', wait: false })
    expect(toasts.some((t) => t.includes('--team is deprecated (removed in v3.0): running as panes · herdr.'))).toBe(true)
  })

  test('a plain /agt stays quiet', async ($, on) => {
    const toasts = setup(on, { HERDR_ENV: '1' })
    await $.prompt.submit({ text: '/agt build it', wait: false })
    expect(toasts.some((t) => t.includes('deprecated'))).toBe(false)
  })
})

describe('forced team directive', () => {
  const DEPRECATED = 'A forced team (--team/--mode team) is deprecated: resolve it as panes when the task has ≥2 genuinely disjoint slices, else subagent (the existing honesty flow). Do not spawn an agent team.'
  const NO_PANES = 'A forced team is deprecated (removed in v3.0); no pane transport here, so run the team as before and print the deprecation line on the recon ping.'

  test('directive text follows the transport', async () => {
    expect(teamDirective('herdr')).toContain(DEPRECATED)
    expect(teamDirective('tmux')).toContain(DEPRECATED)
    expect(teamDirective('none')).toContain(NO_PANES)
    expect(teamDirective('none')).not.toContain('Do not spawn')
  })

  const wire = (on: any, vars: Record<string, string>) => {
    on('env.get', async ($: any, e: any) => ({ value: vars[e.name] }))
    on('process.run', async () => ({ value: { exitCode: 0, stdout: '', stderr: '' } }))
    on('store.get', async () => ({ value: undefined }))
    on('store.set', async () => ({ value: undefined }))
    on('ui.panes', async () => ({ value: [] }))
    on('ui.open', async () => ({ value: { isPlaced: true } }))
    on('ui.toast', async () => ({ value: undefined }))
    on('prompt.submit', async ($: any, e: any) => ({ text: e.text }))
    on('skill.prompt', async ($: any, e: any) => ({ text: e.text }))
  }

  test('the next agt skill prompt carries it after the transport block, then it clears', async ($, on) => {
    wire(on, { HERDR_ENV: '1' })
    await $.prompt.submit({ text: '/agt --team feature-team build it', wait: false })
    const first = (await $.skill.prompt({ skill: 'agt', text: 'base' })).text
    expect(first).toContain(DEPRECATED)
    expect(first.indexOf('transport: herdr')).toBeLessThan(first.indexOf(DEPRECATED))
    const second = (await $.skill.prompt({ skill: 'agt', text: 'base' })).text
    expect(second).not.toContain('deprecated')
  })

  test('with no transport the team runs as before and says so', async ($, on) => {
    wire(on, {})
    await $.prompt.submit({ text: '/agt --mode team build it', wait: false })
    expect((await $.skill.prompt({ skill: 'agt', text: 'base' })).text).toContain(NO_PANES)
  })

  test('a plain /agt gets no directive, and other skills never consume the force', async ($, on) => {
    wire(on, { HERDR_ENV: '1' })
    await $.prompt.submit({ text: '/agt build it', wait: false })
    expect((await $.skill.prompt({ skill: 'agt', text: 'base' })).text).not.toContain('Forced team')
    await $.prompt.submit({ text: '/agt --team feature-team x', wait: false })
    expect((await $.skill.prompt({ skill: 'commit', text: 'base' })).text).toBe('base')
    expect((await $.skill.prompt({ skill: 'agt', text: 'base' })).text).toContain(DEPRECATED)
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

  test('direction picks the tmux and herdr split axis', async () => {
    expect(tmuxSplitArgv({ ...base, shell: '/bin/zsh', direction: 'down' })[3]).toBe('-v')
    for (const d of [undefined, 'right', 'bogus']) expect(tmuxSplitArgv({ ...base, shell: '/bin/zsh', direction: d })[3]).toBe('-h')
    const h = (direction?: string) => herdrSplitArgv({ pane: 'w1:p1', cwd: '/w', run: 'ab12cd', direction })
    expect(h('down')[h('down').indexOf('--direction') + 1]).toBe('down')
    for (const d of [undefined, 'left']) expect(h(d)[h(d).indexOf('--direction') + 1]).toBe('right')
  })

  test('splitPlan from the lead follows the lead width', async () => {
    expect(splitPlan({ lead: '%1', leadWidth: 83 })).toEqual({ target: '%1', direction: 'down', axis: 'down' })
    expect(splitPlan({ lead: '%1', leadWidth: 159 }).direction).toBe('down')
    for (const w of [160, 200, null]) expect(splitPlan({ lead: '%1', leadWidth: w }).direction).toBe('right')
  })

  test('splitPlan alternates around the newest live worker and keeps panes wide enough', async () => {
    const opened = [{ id: '%2', axis: 'down' }]
    const live = [{ id: '%2' }]
    expect(splitPlan({ lead: '%1', opened, live })).toEqual({ target: '%2', direction: 'right', axis: 'down' })
    for (const w of [83, 80]) expect(splitPlan({ lead: '%1', opened, live, newestWidth: w }).direction).toBe('right')
    for (const w of [79, 41]) expect(splitPlan({ lead: '%1', opened, live, newestWidth: w })).toEqual({ target: '%2', direction: 'down', axis: 'down' })
    const two = [{ id: '%2', axis: 'right' }, { id: '%3', axis: 'right' }]
    expect(splitPlan({ lead: '%1', opened: two, live: [{ id: '%2' }, { id: '%3' }] })).toEqual({ target: '%3', direction: 'down', axis: 'right' })
    expect(splitPlan({ lead: '%1', opened: two, live: [{ id: '%2' }, { id: '%3' }], newestWidth: 20 }).direction).toBe('down')
    expect(splitPlan({ lead: '%1', opened: two, live: [{ id: '%2' }] })).toMatchObject({ target: '%2', direction: 'down' })
  })

  test('with nothing live, splitPlan returns to the lead and ignores newestWidth', async () => {
    expect(splitPlan({ lead: '%1', leadWidth: 83, newestWidth: 200, opened: [{ id: '%2', axis: 'right' }], live: [] })).toEqual({ target: '%1', direction: 'down', axis: 'down' })
    expect(splitPlan({ lead: '%1', leadWidth: 200, newestWidth: 10, opened: [{ id: '%2', axis: 'down' }], live: [] })).toEqual({ target: '%1', direction: 'right', axis: 'right' })
  })

  test('widthOf reads a positive integer, tmux probes are pinned', async () => {
    expect(widthOf('83\n')).toBe(83)
    for (const v of ['', 'abc', '0', '-5', undefined]) expect(widthOf(v as never)).toBe(null)
    expect(tmuxWidthArgv('%1')).toEqual(['tmux', 'display-message', '-p', '-t', '%1', '#{pane_width}'])
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
  const on = (model: string) => ({ model })

  test('executor and adversary are always panes', async () => {
    expect(paneRole('executor', on('sonnet')).pane).toBe(true)
    expect(paneRole('adversary', on('sonnet')).pane).toBe(true)
    expect(paneRole('executor', undefined).pane).toBe(true)
  })

  test('reviewers get a pane only on opus or fable', async () => {
    expect(paneRole('code-reviewer', on('opus')).pane).toBe(true)
    expect(paneRole('code-reviewer', on('fable')).pane).toBe(true)
    const s = paneRole('code-reviewer', on('sonnet'))
    expect(s.pane).toBe(false)
    expect(s.why).toContain('routed to sonnet')
    expect(s.why).toContain('subagent')
    for (const r of ['security-reviewer', 'design-reviewer', 'payments-reviewer']) expect(paneRole(r, on('opus')).pane).toBe(true)
    expect(paneRole('perf-reviewer', on('sonnet')).pane).toBe(false)
    expect(paneRole('perf-reviewer', on('opus')).pane).toBe(true)
    expect(paneRole('code-reviewer', undefined).pane).toBe(false)
  })

  test('seo-reviewer and the planning roles stay subagents', async () => {
    const seo = paneRole('seo-reviewer', on('opus'))
    expect(seo.pane).toBe(false)
    expect(seo.why).toContain('seo-reviewer stays a subagent')
    for (const r of ['planner', 'plan-reviewer', 'ui-prototyper']) {
      const p = paneRole(r, on('opus'))
      expect(p.pane).toBe(false)
      expect(p.why).toContain('feeds the next dispatch')
    }
    expect(paneRole('boss', on('opus')).why).toContain('not a routing role')
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
    expect(split.slice(-8)).toEqual(['--model', 'sonnet', '--effort', 'medium', '-n', 'agt-k7f2ab-exec-1', '--', 'build the filter'])
  })

  test('herdr: spawn splits, starts with model and effort, and prompts', async ($, on) => {
    const { seen } = setup(on, { HERDR_ENV: '1', HERDR_PANE_ID: 'w1:p1' }, { 'herdr pane split': { stdout: JSON.stringify({ result: { pane: { pane_id: 'w1:p5' } } }) } })
    const r = await spawn($, { run: 'k7f2ab', role: 'review', task: 'review the diff', agent: 'code-reviewer', header: '[agt run=k7f2ab size=large mode=review]' })
    expect(r.result).toBe('Opened agt-k7f2ab-review · opus · high · herdr pane.')
    const start = seen.find((a) => a.slice(0, 4).join(' ') === 'herdr agent start agt-k7f2ab-review')!
    expect(start.slice(-4)).toEqual(['--model', 'opus', '--effort', 'high'])
    expect(seen.some((a) => a.slice(0, 3).join(' ') === 'herdr agent prompt' && a[4] === 'review the diff')).toBe(true)
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

  test('the routed model and effort win over the asked model', async ($, on) => {
    const { seen } = setup(on, TMUX, { 'tmux split-window': { stdout: '%9\n' } })
    const big = { run: 'k7f2ab', task: 'review the diff', header: '[agt run=k7f2ab size=large mode=review]' }
    const r = await spawn($, { ...big, role: 'review', agent: 'code-reviewer' })
    expect(r.result).toBe('Opened agt-k7f2ab-review · opus · high · tmux pane.')
    const split = seen.find((a) => a[1] === 'split-window')!
    expect(split.slice(-8, -4)).toEqual(['--model', 'opus', '--effort', 'high'])
  })

  test('a reviewer routed to sonnet, and the planning roles, are denied and open nothing', async ($, on) => {
    const { seen } = setup(on, TMUX, { 'tmux split-window': { stdout: '%9\n' } })
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

  test('a forced fable security-reviewer runs on fable and records it', async ($, on) => {
    const { seen } = setup(on, TMUX, { 'tmux split-window': { stdout: '%9\n' } })
    const sets: any[] = []
    on('store.set', async ($: any, e: any) => { sets.push(e); return { value: undefined } })
    const r = await spawn($, { run: 'k7f2ab', role: 'sec', task: 'audit the diff', agent: 'security-reviewer', header: '[agt run=k7f2ab size=large risk=auth mode=review fable=forced]' })
    expect(r.result).toContain('fable · high')
    const split = seen.find((a) => a[1] === 'split-window')!
    expect(split.slice(-8, -4)).toEqual(['--model', 'fable', '--effort', 'high'])
    expect(sets).toContainEqual(expect.objectContaining({ key: 'fable:k7f2ab', value: 1 }))
  })

  test('the routing record lands in routing.jsonl as a pane', async ($, on) => {
    setup(on, TMUX, { 'tmux split-window': { stdout: '%9\n' } })
    const writes: any[] = []
    on('fs.write', async ($: any, e: any) => { writes.push(e); console.log(Object.keys(e)); return { value: undefined } })
    await $.session.start({ cwd: '/work/repo', surface: null, isInteractive: false })
    await spawn($, { run: 'k7f2ab', role: 'exec-1', task: 'build the filter', ...EXEC })
    const w = writes.find((x) => x.path.endsWith('routing.jsonl'))
    expect(w.text).toContain('"kind":"pane"')
    expect(w.text).toContain('"pane":"agt-k7f2ab-exec-1"')
  })

  test('tmux layout: a narrow lead stacks down, the next worker splits beside the newest', async ($, on) => {
    const rows = [['%1', '', 'claude', '0', '@1']]
    const { seen } = setup(on, TMUX, {
      'tmux display-message': { stdout: '83\n' },
      'tmux split-window': { stdout: '%9\n' },
      'tmux list-panes': () => ({ stdout: rows.map((r) => r.join(T)).join('\n') + '\n' }),
    })
    await spawn($, { run: 'k7f2ab', role: 'exec-1', task: 'build one', ...EXEC })
    rows.push(['%9', 'agt-k7f2ab-exec-1', 'claude', '0', '@1'])
    await spawn($, { run: 'k7f2ab', role: 'exec-2', task: 'build two', ...EXEC })
    const splits = seen.filter((a) => a[1] === 'split-window')
    expect(splits[0].slice(2, 3).concat(splits[0].slice(splits[0].indexOf('-t'), splits[0].indexOf('-t') + 2))).toEqual(['-d', '-t', '%1'])
    expect(splits[0]).toContain('-v')
    expect(splits[1]).toContain('-h')
    expect(splits[1].slice(splits[1].indexOf('-t'), splits[1].indexOf('-t') + 2)).toEqual(['-t', '%9'])
    expect(seen.some((a) => a.join(' ') === 'tmux select-layout -E -t %9')).toBe(true)
  })

  test('tmux layout: a wide lead splits right first, then down from the newest', async ($, on) => {
    const rows = [['%1', '', 'claude', '0', '@1']]
    const { seen } = setup(on, TMUX, {
      'tmux display-message': { stdout: '200\n' },
      'tmux split-window': { stdout: '%9\n' },
      'tmux list-panes': () => ({ stdout: rows.map((r) => r.join(T)).join('\n') + '\n' }),
    })
    await spawn($, { run: 'k7f2ab', role: 'exec-1', task: 'build one', ...EXEC })
    rows.push(['%9', 'agt-k7f2ab-exec-1', 'claude', '0', '@1'])
    await spawn($, { run: 'k7f2ab', role: 'exec-2', task: 'build two', ...EXEC })
    const splits = seen.filter((a) => a[1] === 'split-window')
    expect(splits[0]).toContain('-h')
    expect(splits[1]).toContain('-v')
    expect(splits[1].slice(splits[1].indexOf('-t'), splits[1].indexOf('-t') + 2)).toEqual(['-t', '%9'])
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
