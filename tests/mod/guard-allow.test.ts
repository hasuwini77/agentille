import { describe, expect, test } from 'claude-code/testing'
import { integrationIn } from '../../hooks/guard.js'
import { commandSteps } from '../../hooks/guard-lex.js'

// The guard's allow paths, pinned as tightly as its denials. Below auto a merge or a rebase that writes the base
// branch is refused (guard-lex.js localWrite → guard-policy.js judgeLocal); the flags that only settle an operation
// already under way are exempt from that, so a run that hit a conflict on the base can always back out of it.
//
// Every check runs with the base branch checked out (`current: 'main'`): on a slice branch judgeLocal passes any
// merge, so an "allowed" there proves nothing about the exemption. Each exempt line has a denied control beside it
// (the same command writing the base), and near-miss flags stay denied, so a widened exemption shows up too.
const onBase = { current: 'main', cwd: '/w/app' }
const MODES = ['local', 'push', 'pr'] // every mode below auto, where local history rewrites are judged

// The explicit exemptions, exactly as guard-lex.js localWrite lists them today.
const MERGE_EXEMPT = ['--abort', '--continue', '--quit', '--skip']
const REBASE_EXEMPT = ['--abort', '--continue', '--quit', '--skip', '--edit-todo', '--show-current-patch']

const localSteps = (line: string, cwd = '/w/app') => commandSteps(line, cwd).filter((s: any) => s.kind === 'local')

describe('guard allow: merge and rebase settle flags on the base branch', () => {
  test('control: a merge or rebase that writes the base is refused in every mode below auto', async () => {
    for (const mode of MODES) {
      for (const line of ['git merge agt/x', 'git merge --no-ff agt/x', 'git rebase agt/x', 'git rebase -i agt/x']) {
        expect([mode, line, integrationIn(line, { ...onBase, mode })]).toEqual([mode, line, expect.stringContaining('base branch main')])
      }
    }
  })

  test('git merge --abort, --continue, --quit and --skip are allowed on the base, in every mode below auto', async () => {
    for (const mode of MODES) {
      for (const flag of MERGE_EXEMPT) {
        const line = 'git merge ' + flag
        expect([mode, line, integrationIn(line, { ...onBase, mode })]).toEqual([mode, line, null])
      }
    }
  })

  test('git rebase --abort, --continue, --quit, --skip, --edit-todo and --show-current-patch are allowed on the base', async () => {
    for (const mode of MODES) {
      for (const flag of REBASE_EXEMPT) {
        const line = 'git rebase ' + flag
        expect([mode, line, integrationIn(line, { ...onBase, mode })]).toEqual([mode, line, null])
      }
    }
  })

  test('the lexer emits no local-write step for an exempt flag, and one for the plain command', async () => {
    for (const flag of MERGE_EXEMPT) expect(['merge ' + flag, localSteps('git merge ' + flag)]).toEqual(['merge ' + flag, []])
    for (const flag of REBASE_EXEMPT) expect(['rebase ' + flag, localSteps('git rebase ' + flag)]).toEqual(['rebase ' + flag, []])
    expect(localSteps('git merge agt/x')).toHaveLength(1)
    expect(localSteps('git rebase agt/x')).toHaveLength(1)
  })

  test('the exemption holds through a branch switch, a -C dir and wrappers on the line', async () => {
    for (const line of [
      'git checkout main && git merge --abort',
      'git switch main && git rebase --continue',
      'git -C /w/app merge --abort',
      'GIT_EDITOR=true git rebase --continue',
      'git merge --abort || true',
      "bash -c 'git merge --abort'",
    ]) expect([line, integrationIn(line, { ...onBase, mode: 'pr' })]).toEqual([line, null])
  })

  test('the exemption covers its own step only: a later merge onto the base on the same line is still refused', async () => {
    for (const line of [
      'git merge --abort && git merge agt/x',
      'git rebase --abort; git rebase agt/x',
      'git checkout agt/x && git merge --abort && git checkout main && git merge agt/x',
    ]) expect([line, integrationIn(line, { ...onBase, mode: 'pr' })]).toEqual([line, expect.stringContaining('base branch main')])
  })

  test('near misses stay denied: a flag that only looks like an exempt one, or one that starts a new merge', async () => {
    for (const line of [
      'git merge --abort=1 agt/x',
      'git merge --abortx agt/x',
      'git merge -abort agt/x',
      'git merge --squash agt/x',
      'git merge --no-commit agt/x',
      'git merge --ff-only agt/x',
      'git merge --edit agt/x',
      'git rebase --continue-x agt/x',
      'git rebase --autostash agt/x',
    ]) expect([line, integrationIn(line, { ...onBase, mode: 'pr' })]).toEqual([line, expect.stringContaining('base branch main')])
  })
})

// These commands are not exemptions: the guard never judges them as a history rewrite at all, so they are allowed by
// omission, on the base branch too. Pinned so a change that starts judging them is a deliberate one.
describe('guard allow: commands the guard does not judge as a base rewrite', () => {
  test('cherry-pick, revert and am settle flags, stash and commit --amend are allowed on the base below auto', async () => {
    for (const mode of MODES) {
      for (const line of [
        'git cherry-pick --abort',
        'git cherry-pick --continue',
        'git revert --abort',
        'git am --abort',
        'git stash',
        'git stash push -m wip',
        'git stash pop',
        'git commit --amend --no-edit',
      ]) {
        expect([mode, line, integrationIn(line, { ...onBase, mode })]).toEqual([mode, line, null])
        expect([line, localSteps(line)]).toEqual([line, []])
      }
    }
  })

  test('on the run\'s own slice branch the same lines, and an amend of its unpushed commit, are allowed', async () => {
    for (const line of [
      'git stash && git stash pop',
      'git commit --amend --no-edit',
      'git commit --amend -m "fix: a thing"',
      'git cherry-pick --continue',
      'git merge --abort',
      'git rebase --abort',
    ]) expect([line, integrationIn(line, { current: 'agt/x', cwd: '/w/app', mode: 'pr' })]).toEqual([line, null])
  })
})
