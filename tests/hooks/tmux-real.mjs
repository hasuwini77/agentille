// spawn_pane and close_pane against a real tmux server, driven by tests/hooks/test-tmux-real.sh: the typed /agt
// prompt (turns.js) unlocks the tools, spawnPane and closePane (tools.js) run their real transport code, and the
// real tmux binary answers every probe, split, tag, list and kill. The server is a private one (-L <socket>), so
// the person's own tmux is never asked anything; the pane's `claude` is the test's placeholder, never the CLI.
// `claude plugin test` cannot host this: its sandbox has no process runner beneath the mod.
//
// node tmux-real.mjs <repo root> <socket name> <lead pane id> <home> <cwd>  → `ok <check>` / `FAIL <check>` lines.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'

const [root, sock, leadPane, home, cwd] = process.argv.slice(2)
const { S } = await import(root + '/hooks/state.js')
const { onPromptSubmit } = await import(root + '/hooks/turns.js')
const { spawnPane, closePane } = await import(root + '/hooks/tools.js')

let bad = 0
const check = (name, ok, detail = '') => {
  console.log((ok ? 'ok ' : 'FAIL ') + name + (!ok && detail ? ' :: ' + detail : ''))
  if (!ok) bad += 1
}

// Every child gets the test's PATH (the placeholder claude first), the fake HOME, and no TMUX of the caller's.
const env = { ...process.env, HOME: home }
delete env.TMUX
delete env.TMUX_PANE
// Every tmux call the mod makes goes to the private server: its argv names no socket, so the host adds one.
const argvOf = (argv) => (argv[0] === 'tmux' ? ['tmux', '-L', sock, ...argv.slice(1)] : argv)
const run = (argv) => {
  const a = argvOf(argv)
  const r = spawnSync(a[0], a.slice(1), { env, encoding: 'utf8', timeout: 10_000 })
  if (r.error) throw r.error
  return { exitCode: r.status ?? 1, stdout: r.stdout, stderr: r.stderr }
}
const tmux = (...a) => run(['tmux', ...a])
const socketPath = tmux('display-message', '-p', '-t', leadPane, '#{socket_path}').stdout.trim()

const vars = { HOME: home, TMUX: socketPath + ',' + process.pid + ',0', TMUX_PANE: leadPane, SHELL: '/bin/sh' }
const registered = []
const store = new Map()
const idle = () => ({ cancel() {} }) // no timers: the driver polls by hand, and node must exit when it is done
const $ = {
  process: { run: async (argv) => run(argv) },
  env: { get: async (name) => vars[name] ?? null },
  fs: {
    read: async (p) => fs.readFile(p, 'utf8'),
    write: async (p, t) => {
      await fs.mkdir(p.replace(/\/[^/]*$/, ''), { recursive: true })
      await fs.writeFile(p, t)
    },
    list: async (d) => (await fs.readdir(d, { withFileTypes: true })).map((x) => ({ name: x.name, kind: x.isDirectory() ? 'dir' : 'file' })),
    exists: async (p) => existsSync(p),
    stat: async (p) => {
      const s = await fs.stat(p)
      return { kind: s.isDirectory() ? 'dir' : 'file', size: s.size, mtimeMs: s.mtimeMs, isLink: false }
    },
  },
  session: { cwd: async () => cwd },
  clock: { now: async () => Date.now(), every: idle, after: idle, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) },
  tool: { register: async (t) => { registered.push(t.name) } },
  store: { get: async (k) => store.get(k), set: async (k, v) => { store.set(k, v) } },
  ui: { toast: () => {}, invalidate: () => {}, open: async () => {} },
  agent: { list: async () => [] },
}
Object.assign(S, { home, sessionId: 'tmux-real-lead', worker: null, selfName: null, wireName: null })

const rows = () => tmux('list-panes', '-a', '-F', ['#{pane_id}', '#{@agt}', '#{pane_title}', '#{pane_current_command}'].join('\t')).stdout
  .split('\n').filter(Boolean).map((l) => { const [id, agt, title, cmd] = l.split('\t'); return { id, agt, title, cmd } })

const RUN = 'tmx1ab'
const NAME = 'agt-' + RUN + '-exec-1'
try {
  await onPromptSubmit($, { text: '/agt heavy build the two slices', origin: { kind: 'composer' } })
  check('the typed /agt finds the tmux transport', S.transport === 'tmux', String(S.transport))
  check('... and registers spawn_pane and close_pane', registered.includes('spawn_pane') && registered.includes('close_pane'), JSON.stringify(registered))

  const r = await spawnPane($, { run: RUN, role: 'exec-1', task: 'build slice one', agent: 'executor', header: '[agt run=' + RUN + ' size=small mode=build]' })
  check('spawn_pane opens a tmux pane', typeof r?.result === 'string' && r.result.startsWith('Opened ' + NAME + ' ') && r.result.includes('tmux pane'), JSON.stringify(r))
  const mine = rows().find((p) => p.agt === NAME)
  check('tmux lists the pane, tagged @agt ' + NAME, !!mine, JSON.stringify(rows()))
  check('... titled ' + NAME, mine?.title === NAME, JSON.stringify(mine))
  check('... beside the lead, not in place of it', !!mine && mine.id !== leadPane && rows().some((p) => p.id === leadPane))
  // The pane runs the placeholder: `claude` on the server's PATH is `exec sleep 30`.
  let cmd = mine?.cmd
  for (let i = 0; i < 30 && mine && cmd !== 'sleep'; i++) {
    await new Promise((res) => setTimeout(res, 100))
    cmd = rows().find((p) => p.id === mine.id)?.cmd
  }
  check('... running the placeholder worker, not the claude CLI', cmd === 'sleep', String(cmd))
  const panes = await fs.readFile(home + '/.agentille/state/lead-' + leadPane.replace(/^%/, '') + '.panes', 'utf8').catch(() => '')
  check('the lead records the pane under the test HOME', panes.split('\n').includes(NAME), JSON.stringify(panes))
  check('the mod sees the pane as working', S.panes.some((p) => p.name === NAME && p.state === 'working'), JSON.stringify(S.panes))

  const c = await closePane($, { name: NAME })
  check('close_pane closes it', c?.result === 'Closed ' + NAME + '.', JSON.stringify(c))
  check('... tmux no longer lists it', !rows().some((p) => p.agt === NAME || p.id === mine?.id), JSON.stringify(rows()))
  check('... and the lead pane is still there', rows().some((p) => p.id === leadPane), JSON.stringify(rows()))
  const again = await closePane($, { name: NAME })
  check('a second close_pane says it is already closed', typeof again?.result === 'string' && again.result.startsWith(NAME + ' is already closed'), JSON.stringify(again))
} catch (err) {
  check('the driver ran to the end', false, String(err?.stack ?? err))
}
process.exit(bad ? 1 : 0)
