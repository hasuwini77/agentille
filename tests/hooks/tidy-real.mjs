// Real-git integration for the worktree ownership chain, driven by tests/hooks/test-agt-worktree.sh:
// scripts/agt-worktree.sh runs for real through the guard's Bash hook (bashCall), the tree it prints is recorded,
// and the reaper's sweep (cleanGit) deletes the ignored .env copies there and nothing else.
// `claude plugin test` cannot host this: its sandbox has no process runner beneath the mod.
//
// node tidy-real.mjs <main checkout> <script> <home>   → one `ok <check>` or `FAIL <check>` line per check.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { Profile, Worktrees } from '../../hooks/state.js'
import { seed } from '../../hooks/store.js'
import { agtTurnFromDispatch } from '../../hooks/proofs.js'
import { bashCall } from '../../hooks/guard.js'
import { cleanGit } from '../../hooks/reaper.js'

const [repo, script, home] = process.argv.slice(2)
let bad = 0
const check = (name, ok) => {
  console.log((ok ? 'ok ' : 'FAIL ') + name)
  if (!ok) bad += 1
}
const sh = (argv, cwd) => {
  const r = spawnSync(argv[0], argv.slice(1), { cwd, encoding: 'utf8' })
  if (r.error) throw r.error
  return { exitCode: r.status, stdout: r.stdout, stderr: r.stderr }
}
const $ = {
  process: { run: async (argv) => sh(argv) },
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
  session: { cwd: async () => repo },
  env: { get: async () => undefined },
  clock: { now: async () => Date.now() },
  ui: { toast: () => {}, invalidate: () => {} },
  store: { get: async () => undefined, set: async () => {} },
}
// The engine running a Bash call the way Claude Code's Bash tool returns it: { result: { stdout, stderr } }.
const next = async (e) => {
  const r = sh(['bash', '-c', e.command], repo)
  return { result: { stdout: r.stdout, stderr: r.stderr, interrupted: false }, isError: r.exitCode !== 0 }
}

seed(Profile, { home })
agtTurnFromDispatch() // an /agt turn: the guard records this session's worktrees

const listed = () => sh(['git', '-C', repo, 'worktree', 'list', '--porcelain']).stdout
const call = (command) => bashCall($, { tool: 'Bash', command }, next)

const res = await call('bash ' + script + ' web --branch feat/web')
const out = String(res?.result?.stdout ?? '').trim().split('\n')
const path = (out[0] ?? '').replace(/^path=/, '')
check('the script prints exactly path= and branch=', out.length === 2 && out[0].startsWith('path=/') && out[1] === 'branch=feat/web')
check('the printed path is the one git lists', listed().split('\n').includes('worktree ' + path))
const rec = Worktrees.worktrees.find((r) => r.path === path)
check('the tree is recorded as owned, by exact path, marked as the script\'s', !!rec && rec.branch === 'feat/web' && rec.src === 'script')
const fork = rec?.head
check('its fork point is the commit it was made from', !!fork && fork === sh(['git', '-C', repo, 'rev-parse', 'main']).stdout.trim())

// A commit in the slice, then a re-attach (a fix round): still one record, the fork point unchanged.
sh(['git', '-C', path, 'commit', '-q', '--allow-empty', '-m', 'slice work'])
await call('bash ' + script + ' web --branch feat/web')
const recs = Worktrees.worktrees.filter((r) => r.path === path)
check('a re-attach keeps one record and the first fork point', recs.length === 1 && recs[0].head === fork)

// What sits in the tree before the sweep: the ignored copies the script made, an untracked file git does not
// ignore, and the tracked example.
await fs.writeFile(path + '/.env.notes', 'not ignored\n')
// Another session's tree, made outside the guard: never recorded, never swept.
const other = repo + '-other'
sh(['git', '-C', repo, 'worktree', 'add', '-q', '-b', 'agt/other', other, 'main'])
await fs.writeFile(other + '/.env', 'theirs\n')
check('the script copied the ignored .env files', existsSync(path + '/.env') && existsSync(path + '/.env.local'))
check('the script did not copy an un-ignored .env file', !existsSync(path + '/.env.untracked'))

const r = { closed: [], tabs: 0, removed: [], branches: [], runs: 0, keep: [] }
await cleanGit($, (argv) => $.process.run(argv), r, { sweepEnv: true })
check('the sweep deletes the ignored .env copies in the owned feat/* tree', !existsSync(path + '/.env') && !existsSync(path + '/.env.local'))
check('the sweep keeps a tracked .env.example', existsSync(path + '/.env.example'))
check('the sweep keeps an untracked .env file git does not ignore', existsSync(path + '/.env.notes'))
check('the live checkout keeps its own .env files', existsSync(repo + '/.env') && existsSync(repo + '/.env.local'))
check('another session\'s tree keeps its .env', existsSync(other + '/.env'))
check('the feat/* tree itself stays for the lead', existsSync(path) && r.removed.length === 0)

process.exit(bad ? 1 : 0)
