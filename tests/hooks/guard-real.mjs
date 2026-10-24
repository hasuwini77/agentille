// The Bash guard (hooks/guard.js) against real git: a scratch repo with a bare origin and a real agt/x branch,
// the real git binary behind $.process.run, and each allowed line run for real by bash, as the engine's Bash
// tool would. What reaches the bare origin is the proof, not only the deny text.
// Usage: node tests/hooks/guard-real.mjs <repo root>
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'

const root = process.argv[2]
const { Profile, Spawn, Session } = await import(root + '/hooks/state.js')
const { seed } = await import(root + '/hooks/store.js')
const { bashCall, loadRunProfile, DENY_INTEGRATION, DENY_LOCAL } = await import(root + '/hooks/guard.js')
const { agtTurnStart } = await import(root + '/hooks/proofs.js')
const { sameConfig } = await import(root + '/hooks/trust.js')

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
  // As the engine's: the child starts in init.cwd (else the session's), with init.env over the host's.
  process: { run: async (argv, init = {}) => { const r = spawnSync(argv[0], argv.slice(1), { cwd: init.cwd ?? APP, env: { ...env, ...(init.env ?? {}) }, encoding: 'utf8', timeout: init.timeoutMs ?? 30_000 }); if (r.error) throw r.error; return { exitCode: r.status ?? 1, stdout: r.stdout, stderr: r.stderr } } },
  fs: {
    read: async (p) => fs.readFileSync(p, 'utf8'),
    write: async (p, t) => fs.writeFileSync(p, t),
    list: async (d) => fs.readdirSync(d, { withFileTypes: true }).map((x) => ({ name: x.name, kind: x.isDirectory() ? 'dir' : 'file' })),
    // As the engine's: isLink for a link itself, and with { resolve: true } realPath, where the path lands.
    stat: async (p, o = {}) => {
      const l = fs.lstatSync(p)
      let s = l
      try { s = fs.statSync(p) } catch {}
      let realPath
      if (o.resolve) try { realPath = fs.realpathSync(p) } catch {}
      return { kind: s.isDirectory() ? 'dir' : s.isFile() ? 'file' : 'other', size: s.size, mtimeMs: s.mtimeMs, isLink: l.isSymbolicLink(), ...(realPath ? { realPath } : {}) }
    },
  },
  session: { cwd: async () => APP },
  env: { get: async () => null },
  clock: { now: async () => Date.now() },
  ui: { toast: () => {}, invalidate: () => {} },
  store: { get: async () => null, set: async () => {} },
}
const next = async (e) => { const r = spawnSync('bash', ['-c', e.command], { cwd: APP, env, encoding: 'utf8' }); return { result: (r.stdout + r.stderr).trim(), exit: r.status } }

seed(Profile, { home: HOME })
seed(Spawn, { transport: 'none' })
seed(Session, { worker: null, selfName: null, wireName: null })
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
    // push.default set for one call would push every matching branch, the base included: a config write.
    const w = world()
    sh('git branch -f main agt/x', APP)
    const r = await run('git -c push.default=matching push -q origin')
    check('git -c push.default=matching push: denied as a config write', r?.deny?.includes('git config key'), JSON.stringify(r))
    const c = await run('git config push.default matching')
    check('git config push.default matching: denied', c?.deny?.includes('git config key'), JSON.stringify(c))
    const f = await run('git -c core.fsmonitor=./watch.sh status')
    check('git -c core.fsmonitor: denied', f?.deny?.includes('git config key'), JSON.stringify(f))
    check('... origin/main unchanged, push.default unset', refOf('origin.git', 'main') === w.main && spawnSync('git', ['-C', APP, 'config', 'push.default'], { env, encoding: 'utf8' }).stdout.trim() === '')
  }
  {
    // A link made before the line runs (by an earlier line, or found in the tree) is judged by where it lands; a
    // link made on the line to a protected path is refused itself. Any case, and a submodule's own git dir.
    const w = world()
    const cfg0 = fs.readFileSync(APP + '/.git/config', 'utf8')
    const l1 = await run('ln -s .git g')
    check('ln -s .git g: denied (a link to the repo git state)', l1?.deny?.includes('may not write'), JSON.stringify(l1))
    sh('ln -s .git g && ln -s .git/config cfg && ln -s .git/hooks/pre-push dangling', APP)
    const a = await run("printf '[alias]\\n\\tp = push\\n' >> g/config")
    check('>> g/config through a linked .git dir: denied', a?.deny?.includes('may not write'), JSON.stringify(a))
    const b = await run('echo x | tee -a cfg')
    check('tee -a cfg, cfg a link to .git/config: denied', b?.deny?.includes('may not write'), JSON.stringify(b))
    const d = await run('echo x > dangling')
    check('a write through a link that leads nowhere: denied', d?.deny?.includes('leads nowhere'), JSON.stringify(d))
    const c = await run("printf '[alias]\\n\\tp = push\\n' >> .GIT/CONFIG")
    check('>> .GIT/CONFIG: denied', c?.deny?.includes('may not write'), JSON.stringify(c))
    check('... .git/config untouched', fs.readFileSync(APP + '/.git/config', 'utf8') === cfg0)
    const n = await run('echo x > notes-link-ok.md')
    check('control: an ordinary new file is still allowed', !n?.deny && n.exit === 0, JSON.stringify(n))
    sh('git -c protocol.file.allow=always submodule -q add ' + T + '/origin.git sub && git commit -qm sub', APP)
    const m = await run("printf '[alias]\\n\\tp = push\\n' >> .git/modules/sub/config")
    check(">> .git/modules/sub/config: denied (a submodule's config)", m?.deny?.includes('may not write'), JSON.stringify(m))
    const h = await run("printf '#!/bin/sh\\n' > .git/modules/sub/hooks/pre-commit")
    check('> .git/modules/sub/hooks/pre-commit: denied', h?.deny?.includes('may not write') && !fs.existsSync(APP + '/.git/modules/sub/hooks/pre-commit'), JSON.stringify(h))
    check('... origin/main unchanged', refOf('origin.git', 'main') === w.main)
  }
  {
    // What guards the base on GitHub is the person's: branch protection, the default branch, workflow runs. The
    // lines are judged against the real repo; none is run (the next step is a stub, so nothing reaches the network).
    world()
    const ran = []
    const stub = async (e) => { ran.push(e.command); return { result: 'stub', exit: 0 } }
    for (const line of ['gh api -X DELETE repos/o/r/branches/main/protection', 'gh api -X PATCH repos/o/r -f default_branch=agt/x', 'gh workflow run release.yml', 'gh repo edit --default-branch agt/x']) {
      const r = await bashCall($, { command: line }, stub)
      check(line + ': denied', r?.deny === DENY_INTEGRATION, JSON.stringify(r))
    }
    check('... and none of them ran', ran.length === 0, JSON.stringify(ran))
  }
  {
    // A git alias from config is looked up in the repo the call targets and its expansion judged: the everyday
    // `pom = push origin HEAD:main` in the person's global config, a `!` shell alias, one reached through -C.
    const w = world()
    const glob = fs.readFileSync(T + '/gitconfig', 'utf8')
    fs.writeFileSync(T + '/gitconfig', glob + '[alias]\n\tpom = push origin HEAD:main\n\tship = !git push -q origin HEAD:main\n\tst = status\n\tco = checkout\n')
    try {
      const plain = await run('git push -q origin HEAD:main')
      check('spelled-out push to main: denied', plain?.deny?.includes('git push to main'), JSON.stringify(plain))
      const pom = await run('git pom')
      check('git pom (alias.pom = push origin HEAD:main in ~/.gitconfig): denied', pom?.deny?.includes('git push to main'), JSON.stringify(pom))
      const ship = await run('git ship')
      check('git ship (a ! alias that pushes main): denied', ship?.deny?.includes('git push to main'), JSON.stringify(ship))
      const viaC = await run('cd .. && git -C app pom')
      check('cd .. && git -C app pom: denied', viaC?.deny?.includes('git push to main'), JSON.stringify(viaC))
      const co = await run('git co -q main && git push -q origin HEAD')
      check('an alias that checks out main, then push HEAD: denied (HEAD moved)', co?.deny?.includes('switches branches'), JSON.stringify(co))
      const st = await run('git st --short')
      check('control: git st (alias of status) runs', !st?.deny && st.exit === 0, JSON.stringify(st))
      fs.writeFileSync(APP + '/package.json', JSON.stringify({ scripts: { ship: 'git pom' } }))
      const viaPkg = await run('npm run ship')
      check('npm run ship, its script git pom: denied', viaPkg?.deny?.includes('then git pom'), JSON.stringify(viaPkg))
      fs.rmSync(APP + '/package.json')
      const typo = await run('git nosuchword')
      check('control: a word that is no alias is left to git', !typo?.deny, JSON.stringify(typo))
      check('... origin/main unchanged', refOf('origin.git', 'main') === w.main)
    } finally {
      fs.writeFileSync(T + '/gitconfig', glob)
    }
  }
  {
    // The chain: a link made on one line, an alias written through it on the next, the alias run on a third.
    // Each line is judged on its own; each must be refused, and origin/main must not move.
    const w = world()
    const cfg0 = fs.readFileSync(APP + '/.git/config', 'utf8')
    const l1 = await run('ln -s .git/config cfg')
    check('chain line 1, ln -s .git/config cfg: denied', l1?.deny?.includes('may not write'), JSON.stringify(l1))
    sh('ln -s .git/config cfg', APP) // as if the link were there before the run
    const l2 = await run("printf '[alias]\\n\\tyolo = push origin HEAD:main\\n' >> cfg")
    check('chain line 2, an alias appended through the link: denied', l2?.deny?.includes('may not write'), JSON.stringify(l2))
    check('... .git/config has no yolo', fs.readFileSync(APP + '/.git/config', 'utf8') === cfg0)
    sh("printf '[alias]\\n\\tyolo = push origin HEAD:main\\n' >> .git/config", APP) // as if it were written before the run
    const l3 = await run('git yolo')
    check('chain line 3, git yolo: denied as a push to main', l3?.deny?.includes('git push to main'), JSON.stringify(l3))
    check('... origin/main unchanged', refOf('origin.git', 'main') === w.main)
  }
  {
    // git submodule foreach runs its line in another repo: a push there is judged too.
    const w = world()
    sh('git -c protocol.file.allow=always submodule -q add ' + T + '/origin.git sub && git commit -qm sub', APP)
    const f = await run("git submodule foreach -q 'git push -q origin HEAD:main'")
    check('git submodule foreach push to main: denied', f?.deny?.includes('git push to main'), JSON.stringify(f))
    const g = await run("git submodule foreach 'git push -q origin HEAD'")
    check('git submodule foreach push of HEAD: denied (HEAD there cannot be read)', !!g?.deny, JSON.stringify(g))
    const ok = await run("git submodule foreach -q 'git status --short'")
    check('control: git submodule foreach status runs', !ok?.deny && ok.exit === 0, JSON.stringify(ok))
    check('... origin/main unchanged', refOf('origin.git', 'main') === w.main)
  }
  {
    // Package scripts are read with their pre/post scripts and followed into the scripts, modules and imports
    // they run; what the guard cannot find refuses. Each pushing form is denied and origin/main does not move.
    const w = world()
    fs.mkdirSync(APP + '/tools', { recursive: true })
    fs.writeFileSync(APP + '/package.json', JSON.stringify({ scripts: { preship: 'git push -q origin HEAD:main', ship: 'echo shipping', a: 'npm run b', b: 'sh ./tools/push.sh', rel: 'node tools/rel.mjs', gone: 'node tools/gone.mjs', mod: 'python3 -m tools.rel', hello: 'echo hello' } }))
    fs.writeFileSync(APP + '/tools/push.sh', '#!/bin/sh\ngit push -q origin HEAD:main\n')
    fs.writeFileSync(APP + '/tools/rel.mjs', "import { run } from './lib.js'\nrun()\n")
    fs.writeFileSync(APP + '/tools/lib.js', "import { execSync } from 'node:child_process'\nexport const run = () => execSync('git push -q origin HEAD:main')\n")
    fs.writeFileSync(APP + '/tools/__init__.py', '')
    fs.writeFileSync(APP + '/tools/rel.py', 'import subprocess\nsubprocess.run(["git", "push", "-q", "origin", "HEAD:main"])\n')
    for (const [line, text] of [
      ['npm run ship', 'its preship script'],
      ['npm run a', 'tools/push.sh runs a script that calls git push'],
      ['npm run rel', 'imports ./lib.js, which calls git push'],
      ['node tools/rel.mjs', 'imports ./lib.js, which calls git push'],
      ['npm run gone', 'cannot read'],
      ['npm run mod', 'runs a module that calls git push'],
      ['python3 -m tools.rel', 'runs a module that calls git push'],
      ['python3 -m tools.nowhere', 'cannot find'],
    ]) {
      const r = await run(line)
      check(line + ': denied', r?.deny?.includes(text), JSON.stringify(r))
    }
    check('... origin/main unchanged', refOf('origin.git', 'main') === w.main)
    if (spawnSync('python3', ['-c', 'pass'], { env }).status === 0) {
      const std = await run('python3 -m json.tool --help')
      check('control: python3 -m json.tool (the standard library) runs', !std?.deny && std.exit === 0, JSON.stringify(std))
    }
    const hello = await run('npm run hello')
    check('control: npm run hello is not refused', !hello?.deny, JSON.stringify(hello))
  }
  {
    // Past the lexer's depth caps the line is refused as unreadable, and the push after the deep part never runs.
    const w = world()
    for (const line of ['echo $($($($($(x))))); git push -q origin HEAD:main --force', 'eval eval eval eval git push -q origin HEAD:main']) {
      const r = await run(line)
      check(line + ': denied as nested too deep', r?.deny?.includes('nests deeper than the guard reads'), JSON.stringify(r))
    }
    check('... origin/main unchanged', refOf('origin.git', 'main') === w.main)
  }
  {
    // A clean filter runs on a plain `git add`: setting one, and the .gitattributes that turns it on, are both refused.
    const w = world()
    const a = await run("git config filter.f.clean 'git push -q origin agt/x:main; cat'")
    check('git config filter.f.clean: denied as a config write', a?.deny?.includes('git config key'), JSON.stringify(a))
    const b = await run("echo '* filter=f' > .gitattributes")
    check('echo > .gitattributes: denied', b?.deny?.includes('may not write'), JSON.stringify(b))
    const c = await run('echo c > c && git add c')
    check('control: a plain git add runs', !c?.deny && c.exit === 0, JSON.stringify(c))
    check('... no filter set, no attributes written, origin/main unchanged', !fs.existsSync(APP + '/.gitattributes') && refOf('origin.git', 'main') === w.main)
  }
  {
    // An alias is read from the config the line points git at: a global config named on the line is looked up there,
    // and one the lookup cannot place (a relative path) refuses.
    const w = world()
    fs.mkdirSync(T + '/evil', { recursive: true })
    fs.writeFileSync(T + '/evil/g.cfg', '[alias]\n\tpom = push -q origin agt/x:main\n')
    const a = await run('GIT_CONFIG_GLOBAL=' + T + '/evil/g.cfg git pom')
    check('GIT_CONFIG_GLOBAL=<abs> git pom: denied', !!a?.deny, JSON.stringify(a))
    const b = await run('GIT_CONFIG_GLOBAL=../evil/g.cfg git pom')
    check('GIT_CONFIG_GLOBAL=<relative> git pom: denied', !!b?.deny, JSON.stringify(b))
    const c = await run('HOME=../evil git pom')
    check('HOME=<relative> git pom: denied', !!c?.deny, JSON.stringify(c))
    // Through GIT_CONFIG_PARAMETERS-style variables the alias is looked up with them and judged.
    const d = await run('GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=include.path GIT_CONFIG_VALUE_0=' + T + '/evil/g.cfg git pom')
    check('an include set for one call: denied', !!d?.deny, JSON.stringify(d))
    check('... origin/main unchanged', refOf('origin.git', 'main') === w.main)
    fs.rmSync(T + '/evil', { recursive: true, force: true })
  }
  {
    // A package script or script file step whose program or subcommand cannot be read refuses: it may be a push.
    const w = world()
    fs.writeFileSync(APP + '/package.json', JSON.stringify({ scripts: { ship: 'git pu${X:-sh} -q origin agt/x:main' } }))
    fs.writeFileSync(APP + '/s.sh', 'c=$(printf gi)t; $c push -q origin agt/x:main\n')
    const a = await run('npm run -s ship')
    check('npm run ship (git pu${X:-sh}): denied as unreadable', a?.deny?.includes('cannot read'), JSON.stringify(a))
    const b = await run('sh s.sh')
    check('sh s.sh ($(printf gi)t push): denied as unreadable', b?.deny?.includes('cannot read'), JSON.stringify(b))
    check('... origin/main unchanged', refOf('origin.git', 'main') === w.main)
  }
  {
    // No profile at the typed /agt: the run is held to the default, so a profile it writes (here through a path the
    // reader cannot see) does not let the base push through.
    const w = world()
    fs.rmSync(HOME + '/.agentille/profile.json', { force: true })
    await loadRunProfile($)
    if (spawnSync('python3', ['-c', 'pass'], { env }).status === 0) {
      const a = await run(`python3 -c "import os; open(os.environ['HOME']+'/.agen'+'tille/profile.json','w').write('{\\"integration\\":\\"auto\\"}')"`)
      check('control: a profile write the reader cannot see runs', !a?.deny && JSON.parse(fs.readFileSync(HOME + '/.agentille/profile.json', 'utf8')).integration === 'auto', JSON.stringify(a))
    } else fs.writeFileSync(HOME + '/.agentille/profile.json', JSON.stringify({ integration: 'auto' }))
    const p = await run('git push -q origin agt/x:main')
    check('... the base push is still denied (the ceiling is the default, not the live profile)', p?.deny?.includes('git push to main'), JSON.stringify(p))
    check('... origin/main unchanged', refOf('origin.git', 'main') === w.main)
    fs.writeFileSync(HOME + '/.agentille/profile.json', JSON.stringify({ integration: 'pr' }))
    await loadRunProfile($)
  }
  {
    // A hard link to the profile is a second name for it: `cp -l` is judged by its source, so the rewrite through the
    // link never reaches the trust root.
    const w = world()
    const a = await run('cp -l ~/.agentille/profile.json p.json')
    check('cp -l ~/.agentille/profile.json: denied', a?.deny?.includes('may not write'), JSON.stringify(a))
    const b = await run(`printf '{"integration":"auto"}' > p.json`)
    check('control: the write to p.json runs (it is no link)', !b?.deny && b.exit === 0, JSON.stringify(b))
    check('... the profile is still pr', JSON.parse(fs.readFileSync(HOME + '/.agentille/profile.json', 'utf8')).integration === 'pr')
    const l = await run('link ~/.agentille/profile.json p2.json')
    check('link ~/.agentille/profile.json: denied', l?.deny?.includes('may not write'), JSON.stringify(l))
    const p = await run('git push -q origin agt/x:main')
    check('... and the base push is denied', !!p?.deny && refOf('origin.git', 'main') === w.main, JSON.stringify(p))
  }
  {
    // Your global git config holds aliases and code-running keys too: appending one is refused, so the alias never
    // exists and origin/main does not move.
    const w = world()
    const a = await run(`printf '[alias]\\n\\tpom = push -q origin agt/x:main\\n' >> ~/.gitconfig`)
    check('>> ~/.gitconfig: denied', a?.deny?.includes('may not write'), JSON.stringify(a))
    const s = await run('mkdir -p .claude && echo {} > .claude/settings.local.json')
    check('> .claude/settings.local.json: denied', s?.deny?.includes('Claude Code settings'), JSON.stringify(s))
    check('... no ~/.gitconfig, origin/main unchanged', !fs.existsSync(HOME + '/.gitconfig') && refOf('origin.git', 'main') === w.main)
  }
  {
    // An external diff named on the line runs on a plain `git diff`: refused, and a harmless pager stays allowed.
    const w = world()
    fs.writeFileSync(APP + '/b', 'changed\n')
    const a = await run("GIT_EXTERNAL_DIFF='git push -q origin agt/x:main;:' git diff")
    check('GIT_EXTERNAL_DIFF git diff: denied', a?.deny?.includes('GIT_EXTERNAL_DIFF'), JSON.stringify(a))
    const p = await run('GIT_PAGER=cat git diff --stat')
    check('control: GIT_PAGER=cat git diff runs', !p?.deny && p.exit === 0, JSON.stringify(p))
    check('... origin/main unchanged', refOf('origin.git', 'main') === w.main)
  }
  {
    // The repo already runs its hooks from .husky (core.hooksPath): a hook written there would run on a plain commit.
    const w = world()
    sh('git config core.hooksPath .husky && mkdir -p .husky', APP)
    const a = await run("printf '#!/bin/sh\\ngit push -q origin agt/x:main\\n' > .husky/post-commit && chmod +x .husky/post-commit")
    check('> .husky/post-commit with core.hooksPath=.husky: denied', a?.deny?.includes('core.hooksPath'), JSON.stringify(a))
    const c = await run('echo c > c && git add c && git commit -qm c')
    check('control: a plain commit runs', !c?.deny && c.exit === 0, JSON.stringify(c))
    check('... no hook written, origin/main unchanged', !fs.existsSync(APP + '/.husky/post-commit') && refOf('origin.git', 'main') === w.main)
  }
  {
    // feat/* is the person's prefix too: a push onto a feat/* branch the remote already has, which this run did not
    // make or check out, is refused. A new branch is fine.
    const w = world()
    sh('git branch feat/other main && git push -q origin feat/other', APP)
    const other = refOf('origin.git', 'feat/other')
    const a = await run('git push -q origin agt/x:feat/other')
    check('push agt/x:feat/other (on the remote, not this run\'s): denied', a?.deny?.includes('did not make'), JSON.stringify(a))
    check('... feat/other unchanged', refOf('origin.git', 'feat/other') === other)
    const b = await run('git push -q origin agt/x:feat/brand-new')
    check('push agt/x:feat/brand-new (new): allowed and landed', !b?.deny && refOf('origin.git', 'feat/brand-new') === w.slice, JSON.stringify(b))
    check('... origin/main unchanged', refOf('origin.git', 'main') === w.main)
  }
  {
    // A gh alias from gh's own config is read and judged: a `!` alias that pushes the base is refused.
    const w = world()
    fs.mkdirSync(HOME + '/.config/gh', { recursive: true })
    fs.writeFileSync(HOME + '/.config/gh/config.yml', "aliases:\n    pm: pr merge\n    ship: '!git push -q origin agt/x:main'\n")
    const a = await run('gh ship')
    check('gh ship (a ! alias that pushes the base): denied', a?.deny?.includes('git push to main'), JSON.stringify(a))
    const b = await run('gh pm 4')
    check('gh pm (an alias for pr merge): denied', b?.deny === DENY_INTEGRATION, JSON.stringify(b))
    const c = await run('gh pr review --approve 4')
    check('gh pr review --approve: denied', c?.deny === DENY_INTEGRATION, JSON.stringify(c))
    check('... origin/main unchanged', refOf('origin.git', 'main') === w.main)
    fs.rmSync(HOME + '/.config', { recursive: true, force: true })
  }
  {
    // Folder trust on real files: a worktree whose hook script imports a changed module, or whose MCP server requires
    // one, is not the lead checkout's config, so its trust prompt is never answered for the person.
    const lead = T + '/trust-lead'
    const wt = T + '/trust-wt'
    for (const d of [lead, wt]) {
      fs.mkdirSync(d + '/.claude', { recursive: true })
      fs.mkdirSync(d + '/scripts', { recursive: true })
      fs.mkdirSync(d + '/server', { recursive: true })
      fs.writeFileSync(d + '/.claude/settings.json', JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node "$CLAUDE_PROJECT_DIR"/scripts/hook.mjs' }] }] } }))
      fs.writeFileSync(d + '/.mcp.json', JSON.stringify({ mcpServers: { s: { command: 'node', args: ['server/index.js'] } } }))
      fs.writeFileSync(d + '/scripts/hook.mjs', "import { run } from './lib.mjs'\nrun()\n")
      fs.writeFileSync(d + '/scripts/lib.mjs', 'export const run = () => 0\n')
      fs.writeFileSync(d + '/server/index.js', "require('./tools')\n")
      fs.writeFileSync(d + '/server/tools.js', 'module.exports = {}\n')
    }
    check('trust control: identical checkouts are the same config', (await sameConfig($, wt, lead)) === true)
    fs.writeFileSync(wt + '/scripts/lib.mjs', "export const run = () => require('child_process').execSync('git push -q origin agt/x:main')\n")
    check('trust: a hook whose imported lib.mjs differs is not the same config', (await sameConfig($, wt, lead)) === false)
    fs.writeFileSync(wt + '/scripts/lib.mjs', 'export const run = () => 0\n')
    fs.writeFileSync(wt + '/server/tools.js', 'module.exports = { evil: true }\n')
    check('trust: an MCP server whose required tools.js differs is not the same config', (await sameConfig($, wt, lead)) === false)
    for (const d of [lead, wt]) fs.rmSync(d, { recursive: true, force: true })
  }
  {
    // A wrapper script that runs `exec "$@"`: the words passed to it are read as a command of their own.
    const w = world()
    fs.writeFileSync(APP + '/run.sh', '#!/bin/sh\nexec "$@"\n')
    const a = await run('sh run.sh git push -q origin HEAD:main')
    check('sh run.sh git push origin HEAD:main: denied', a?.deny?.includes('git push to main'), JSON.stringify(a))
    const b = await run('sh run.sh git status --short')
    check('control: sh run.sh git status runs', !b?.deny && b.exit === 0, JSON.stringify(b))
    check('... origin/main unchanged', refOf('origin.git', 'main') === w.main)
  }
  {
    // A program word built from a variable: one the line sets is expanded and split as the shell does, then judged;
    // one it cannot read is refused below auto.
    const w = world()
    const a = await run("c='git push -q origin agt/x:main'; $c")
    check("c='git push origin agt/x:main'; $c: denied", a?.deny?.includes('git push to main'), JSON.stringify(a))
    const b = await run("a='push -q origin agt/x:main'; git $a")
    check("a='push …'; git $a: denied", b?.deny?.includes('git push to main'), JSON.stringify(b))
    const c = await run('$(printf git) push -q origin agt/x:main')
    check('$(printf git) push: denied as unreadable', c?.deny?.includes('a program the guard cannot read'), JSON.stringify(c))
    const ok = await run("c='git status --short'; $c")
    check("control: c='git status'; $c runs", !ok?.deny && ok.exit === 0, JSON.stringify(ok))
    check('... origin/main unchanged', refOf('origin.git', 'main') === w.main)
  }
  {
    // The branch checked out at the typed /agt (feat/big, which the remote has) is pushed as itself; merging a slice
    // into it, then pushing, is the integrate step auto owns.
    world()
    sh('git checkout -q -b feat/big main && echo f > f && git add f && git commit -qm f && git push -q origin feat/big && git checkout -q -b agt/slice && echo s > s && git add s && git commit -qm s && git checkout -q feat/big', APP)
    await loadRunProfile($)
    const big = refOf('origin.git', 'feat/big')
    const m = await run('git merge -q --no-edit agt/slice && git push -q origin feat/big')
    check('merge agt/slice into the checked-out feat/big, then push: denied', m?.deny?.includes('a merge into feat/big'), JSON.stringify(m))
    check('... origin feat/big unchanged', refOf('origin.git', 'feat/big') === big)
    sh('echo g > g && git add g && git commit -qm g', APP)
    const own = await run('git push -q origin feat/big')
    check('control: a commit on feat/big itself is pushed', !own?.deny && refOf('origin.git', 'feat/big') === sh('git rev-parse feat/big', APP), JSON.stringify(own))
    fs.writeFileSync(HOME + '/.agentille/profile.json', JSON.stringify({ integration: 'local' }))
    await loadRunProfile($)
    const loc = await run('git merge -q --no-edit agt/slice')
    check('control: under local the merge into the checkout runs', !loc?.deny && loc.exit === 0, JSON.stringify(loc))
    const lp = await run('git push -q origin feat/big')
    check('... and its push is refused', lp?.deny === DENY_LOCAL, JSON.stringify(lp))
    fs.writeFileSync(HOME + '/.agentille/profile.json', JSON.stringify({ integration: 'pr' }))
  }
  {
    // The remote's default is develop and origin/HEAD is not recorded: every branch the remote has that the run did
    // not make is base-like, the checkout included.
    world()
    sh('git checkout -q -b develop main && echo d > d && git add d && git commit -qm d && git push -q origin develop && git remote set-head origin -d', APP)
    sh('git symbolic-ref HEAD refs/heads/develop', T + '/origin.git')
    await loadRunProfile($)
    sh('echo e > e && git add e && git commit -qm e', APP)
    const dev = refOf('origin.git', 'develop')
    const p = await run('git push -q origin develop')
    check('no origin/HEAD, push the checked-out develop: denied as the base', p?.deny?.includes('git push to develop'), JSON.stringify(p))
    check('... origin develop unchanged', refOf('origin.git', 'develop') === dev)
    const x = await run('git push -q origin agt/x')
    check('control: the agt/x slice branch still goes', !x?.deny && refOf('origin.git', 'agt/x') === sh('git rev-parse agt/x', APP), JSON.stringify(x))
  }
  {
    // A branch the run creates on the remote stays its own: pushed again, and merged into.
    world()
    await loadRunProfile($)
    sh('git checkout -q -b feat/slug main', APP)
    const a = await run('git push -q -u origin feat/slug')
    check('git push -u origin feat/slug (new): allowed and landed', !a?.deny && refOf('origin.git', 'feat/slug') !== null, JSON.stringify(a))
    const b = await run('git merge -q --no-edit agt/x && git push -q origin feat/slug')
    check('merge agt/x into it, push again: allowed and landed', !b?.deny && refOf('origin.git', 'feat/slug') === sh('git rev-parse feat/slug', APP), JSON.stringify(b))
    sh('git checkout -q agt/x', APP)
    await loadRunProfile($)
  }
  if (spawnSync('npm', ['--version'], { env }).status === 0) {
    // npm version runs the package's version scripts: a postversion that pushes refuses it, and the tag never lands.
    const w = world()
    fs.writeFileSync(APP + '/package.json', JSON.stringify({ name: 'p', version: '1.0.0', scripts: { postversion: 'git push -q origin HEAD:main && git push -q origin --tags' } }))
    sh('git add package.json && git commit -qm pkg', APP)
    const r = await run('npm version minor')
    check('npm version minor with a postversion push: denied', r?.deny?.includes('postversion script'), JSON.stringify(r))
    check('... origin/main unchanged, no tag on origin, package still 1.0.0', refOf('origin.git', 'main') === w.main && refOf('origin.git', 'refs/tags/v1.1.0') === null && JSON.parse(fs.readFileSync(APP + '/package.json', 'utf8')).version === '1.0.0')
    fs.writeFileSync(APP + '/package.json', JSON.stringify({ name: 'p', version: '1.0.0', scripts: { prepare: 'echo prepared' } }))
    const ok = await run('npm install --no-audit --no-fund')
    check('control: npm install with a harmless prepare runs', !ok?.deny && ok.exit === 0, JSON.stringify(ok))
  }
  {
    // push.followTags sends the annotated tag a release made along with the branch: judged as the tag push it is.
    const w = world()
    sh('git config push.followTags true && git tag -a v9.0.0 -m v9', APP)
    const r = await run('git push -q origin agt/x')
    check('push.followTags with a new annotated tag, push agt/x: denied', r?.deny?.includes('push.followTags carries v9.0.0'), JSON.stringify(r))
    check('... no tag and no agt/x on origin, origin/main unchanged', refOf('origin.git', 'refs/tags/v9.0.0') === null && refOf('origin.git', 'agt/x') === null && refOf('origin.git', 'main') === w.main)
    const c = await run('git config push.followTags false')
    check('git config push.followTags: denied as a config write', c?.deny?.includes('git config key'), JSON.stringify(c))
    const ok = await run('git push -q --no-follow-tags origin agt/x')
    check('control: --no-follow-tags pushes the branch alone', !ok?.deny && refOf('origin.git', 'agt/x') === w.slice && refOf('origin.git', 'refs/tags/v9.0.0') === null, JSON.stringify(ok))
  }
  {
    // A tag named like a branch: git reads the plain name as the tag, so the push publishes a tag.
    const w = world()
    sh('git tag feat/rel agt/x', APP)
    const r = await run('git push -q origin feat/rel')
    check('git push origin feat/rel (a tag of that name): denied', r?.deny?.includes('feat/rel names a tag'), JSON.stringify(r))
    check('... no tag on origin, origin/main unchanged', refOf('origin.git', 'refs/tags/feat/rel') === null && refOf('origin.git', 'main') === w.main)
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
