// The Bash guard (hooks/guard.js) against real git: a scratch repo with a bare origin and a real agt/x branch,
// the real git binary behind $.process.run, and each allowed line run for real by bash, as the engine's Bash
// tool would. What reaches the bare origin is the proof, not only the deny text.
// Usage: node tests/hooks/guard-real.mjs <repo root>
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'

const root = process.argv[2]
const { S } = await import(root + '/hooks/state.js')
const { bashCall, DENY_INTEGRATION } = await import(root + '/hooks/guard.js')
const { agtTurnStart } = await import(root + '/hooks/proofs.js')

const T = fs.realpathSync(fs.mkdtempSync(os.tmpdir() + '/agt-guard-real-'))
const HOME = T + '/home'
fs.mkdirSync(HOME + '/.agentille', { recursive: true })
fs.writeFileSync(T + '/gitconfig', '[user]\n\tname = t\n\temail = t@t\n[init]\n\tdefaultBranch = main\n[core]\n\thooksPath = /dev/null\n')
const env = { PATH: process.env.PATH, HOME, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: T + '/gitconfig', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' }
const sh = (cmd, cwd = T) => {
  const r = spawnSync('bash', ['-c', cmd], { cwd, env, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(cmd + ': ' + r.stderr)
  return r.stdout.trim()
}
const APP = T + '/app'
const refOf = (bare, ref) => spawnSync('git', ['--git-dir=' + T + '/' + bare, 'rev-parse', '-q', '--verify', ref], { env, encoding: 'utf8' }).stdout.trim() || null

// A fresh scratch world per case: origin.git (main), prod.git (empty, someone else's), app on agt/x one commit ahead.
function world() {
  fs.rmSync(T + '/w', { recursive: true, force: true })
  for (const d of ['origin.git', 'prod.git', 'app']) fs.rmSync(T + '/' + d, { recursive: true, force: true })
  sh('git init -q --bare origin.git && git init -q --bare prod.git && git init -q app')
  sh('echo a > a && git add a && git commit -qm init && git remote add origin ' + T + '/origin.git && git push -q origin main && git remote set-head origin main >/dev/null 2>&1; git checkout -qb agt/x && echo b > b && git add b && git commit -qm slice', APP)
  fs.writeFileSync(HOME + '/.agentille/profile.json', JSON.stringify({ integration: 'pr' }))
  return { main: refOf('origin.git', 'main'), slice: sh('git rev-parse HEAD', APP) }
}

const $ = {
  process: { run: async (argv) => { const r = spawnSync(argv[0], argv.slice(1), { env, encoding: 'utf8' }); if (r.error) throw r.error; return { exitCode: r.status ?? 1, stdout: r.stdout, stderr: r.stderr } } },
  fs: {
    read: async (p) => fs.readFileSync(p, 'utf8'),
    write: async (p, t) => fs.writeFileSync(p, t),
    list: async (d) => fs.readdirSync(d, { withFileTypes: true }).map((x) => ({ name: x.name, kind: x.isDirectory() ? 'dir' : 'file' })),
    stat: async (p) => { const s = fs.statSync(p); return { kind: s.isDirectory() ? 'dir' : 'file', mtimeMs: s.mtimeMs } },
  },
  session: { cwd: async () => APP },
  env: { get: async () => null },
  clock: { now: async () => Date.now() },
  ui: { toast: () => {}, invalidate: () => {} },
  store: { get: async () => null, set: async () => {} },
}
const next = async (e) => { const r = spawnSync('bash', ['-c', e.command], { cwd: APP, env, encoding: 'utf8' }); return { result: (r.stdout + r.stderr).trim(), exit: r.status } }

Object.assign(S, { home: HOME, transport: 'none', worker: null, selfName: null, wireName: null })
agtTurnStart(true) // the lead on its typed /agt turn

let n = 0
let bad = 0
const check = (name, ok, detail = '') => { n++; if (!ok) { bad++; console.log('FAIL ' + name + (detail ? ' :: ' + detail : '')) } }
const run = (cmd) => bashCall($, { command: cmd }, next)

try {
  {
    const w = world()
    const r = await run('git checkout -q main && git merge -q --ff-only agt/x && git push -q origin HEAD')
    check('checkout base, ff-merge to the base, push HEAD: denied', r?.deny?.startsWith(DENY_INTEGRATION) && r.deny.includes('base branch'), JSON.stringify(r))
    check('... and origin/main did not move', refOf('origin.git', 'main') === w.main)
    const h = await run('git checkout -q main && git push -q origin HEAD')
    check('checkout base then push HEAD (no merge): denied, HEAD unreadable', h?.deny?.includes('switches branches'), JSON.stringify(h))
  }
  {
    const w = world()
    const r = await run('git switch -q main && git merge -q --ff-only agt/x && git push -q -u origin HEAD')
    check('switch base, push -u HEAD: denied', !!r?.deny, JSON.stringify(r))
    check('... origin/main unchanged', refOf('origin.git', 'main') === w.main)
  }
  {
    const w = world()
    const r = await run('git push -q -u origin agt/x')
    check('git push -u origin agt/x: allowed', !r?.deny && r.exit === 0, JSON.stringify(r))
    check('... and agt/x reached the bare origin', refOf('origin.git', 'agt/x') === w.slice)
    const h = await run('git push -q origin HEAD')
    check('git push origin HEAD on agt/x (no switch on the line): allowed', !h?.deny && h.exit === 0, JSON.stringify(h))
  }
  {
    const w = world()
    const r = await run('git push -q origin HEAD:main')
    check('git push origin HEAD:main: denied', r?.deny?.includes('git push to main'), JSON.stringify(r))
    check('... origin/main unchanged', refOf('origin.git', 'main') === w.main)
  }
  {
    const w = world()
    const r = await run('git -c alias.p=push p -q origin agt/x:main')
    check('git -c alias.p=push: denied', r?.deny === DENY_INTEGRATION, JSON.stringify(r))
    const s = await run('git send-pack ' + T + '/origin.git agt/x:main')
    check('git send-pack: denied', r?.deny === DENY_INTEGRATION && s?.deny === DENY_INTEGRATION, JSON.stringify(s))
    check('... origin/main unchanged', refOf('origin.git', 'main') === w.main)
  }
  {
    // The person set auto for this checkout only. A pushurl sends the same command to someone else's repo.
    world()
    fs.writeFileSync(HOME + '/.agentille/profile.json', JSON.stringify({ integration: 'pr', projects: [{ path: APP, integration: 'auto' }] }))
    sh('git config remote.origin.pushurl ' + T + '/prod.git', APP)
    const r = await run('git push -q origin agt/x:main')
    check('auto checkout, pushurl to another repo: denied', r?.deny?.includes('git push to main'), JSON.stringify(r))
    check('... prod.git got no main', refOf('prod.git', 'main') === null)
    sh('git config --unset remote.origin.pushurl', APP)
    const ok = await run('git push -q origin agt/x:main')
    check('auto checkout, its own origin: allowed and landed', !ok?.deny && refOf('origin.git', 'main') === sh('git rev-parse agt/x', APP), JSON.stringify(ok))
    const url = await run('git push -q ' + T + '/prod.git agt/x:main')
    check('auto checkout, a push to another repo by path: denied', url?.deny?.includes('git push to main') && refOf('prod.git', 'main') === null, JSON.stringify(url))
    fs.symlinkSync(T + '/prod.git', APP + '/p')
    const link = await run('git push -q p agt/x:main')
    check('auto checkout, a bare name that is a symlink to another repo: denied', link?.deny?.includes('git push to main') && refOf('prod.git', 'main') === null, JSON.stringify(link))
    const none = await run('git push -q nosuch agt/y:main')
    check('auto checkout, a name that is neither remote nor repo: judged as its own (git refuses it)', !none?.deny, JSON.stringify(none))
  }
  {
    const w = world()
    fs.writeFileSync(APP + '/ship.sh', '#!/bin/sh\ngit push -q origin HEAD:main\n', { mode: 0o755 })
    const r = await run('./ship.sh')
    check('a script that pushes the base: denied, and says so', r?.deny?.includes('./ship.sh runs a script'), JSON.stringify(r))
    check('... origin/main unchanged', refOf('origin.git', 'main') === w.main)
  }
  {
    // The run below auto cannot lift its own ceiling: rewriting the profile to auto is a protected write.
    const w = world()
    const r = await run('printf \'{"integration":"auto"}\' > "$HOME/.agentille/profile.json"')
    check('profile rewrite below auto: denied', r?.deny?.includes('may not write'), JSON.stringify(r))
    check('... the profile is still pr', JSON.parse(fs.readFileSync(HOME + '/.agentille/profile.json', 'utf8')).integration === 'pr')
    const p = await run('git push -q origin HEAD:main')
    check('... and the base push is still denied', !!p?.deny && refOf('origin.git', 'main') === w.main, JSON.stringify(p))
  }
  {
    // Writing .git/config or .git/hooks is a protected write.
    const w = world()
    const a = await run("printf '[alias]\\n\\tp = push\\n' >> .git/config")
    check('.git/config write: denied', a?.deny?.includes('may not write'), JSON.stringify(a))
    const h = await run("printf '#!/bin/sh\\ngit push -q origin HEAD:main\\n' > .git/hooks/post-commit")
    check('.git/hooks write: denied', h?.deny?.includes('may not write'), JSON.stringify(h))
    check('... origin/main unchanged', refOf('origin.git', 'main') === w.main)
  }
  {
    // A bare push follows a configured push refspec; one reaching the base or a tag is denied.
    const w = world()
    sh('git config remote.origin.push refs/heads/agt/x:refs/heads/main', APP)
    const r = await run('git push -q')
    check('bare push via a base refspec: denied', r?.deny?.includes('configured push refspec') || r?.deny?.includes('git push'), JSON.stringify(r))
    check('... origin/main unchanged', refOf('origin.git', 'main') === w.main)
    sh('git config --unset-all remote.origin.push', APP)
    sh('git config remote.origin.push "refs/tags/*:refs/tags/*"', APP)
    sh('git tag v9.9.9', APP)
    const t = await run('git push -q')
    check('bare push via a tag refspec: denied', !!t?.deny, JSON.stringify(t))
    check('... no tag on origin', refOf('origin.git', 'refs/tags/v9.9.9') === null)
  }
  {
    // An npm run script is read from package.json; one that pushes is denied, a plain one is allowed.
    const w = world()
    fs.writeFileSync(APP + '/package.json', JSON.stringify({ scripts: { ship: 'git push origin main', build: 'echo build' } }))
    const r = await run('npm run ship')
    check('npm run script that pushes: denied', r?.deny?.includes('package script that calls git push'), JSON.stringify(r))
    check('... origin/main unchanged', refOf('origin.git', 'main') === w.main)
    const b = await run('npm run build')
    check('npm run build: allowed by the guard', !b?.deny, JSON.stringify(b))
  }
  {
    // Controls below auto: the run's own branch and ordinary writes still pass.
    world()
    const ok = await run('git push -q -u origin agt/x')
    check('control: push own branch allowed', !ok?.deny, JSON.stringify(ok))
    const note = await run('echo hello > notes.md')
    check('control: ordinary redirect allowed', !note?.deny && note.exit === 0, JSON.stringify(note))
  }
} catch (err) {
  bad++
  console.log('FAIL the run threw: ' + (err?.stack ?? err))
} finally {
  fs.rmSync(T, { recursive: true, force: true })
}

if (bad) {
  console.log('guard-real: ' + bad + ' of ' + n + ' checks fail')
  process.exit(1)
}
console.log('guard-real: ' + n + ' checks pass')
