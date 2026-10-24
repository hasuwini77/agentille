#!/usr/bin/env bash
# agt-worktree.sh <slug> [--base <branch>] [--branch <name>]
#
# Makes or re-attaches a slice's sibling worktree, the one way agentille's lead and executor do it
# (skills/agt/factory.md → "Worktree lifecycle"). Run it from the main checkout or any of its worktrees.
#
#   tree    <dirname of the main checkout>/<project>-<slug>
#   branch  --branch, else agt/<slug>
#   base    --base, else the branch checked out where it runs (only used for a new branch)
#
# Re-attach before create: the tree's directory if it already is a worktree of this repo, else the branch in a
# new tree, else a new branch from the base. Then the .env* files of the main checkout's top level are copied in,
# only those git ignores in the tree (a copy git would stage stays behind), and node_modules is copied
# copy-on-write when the filesystem has it, else plainly; never a symlink or a hardlink.
#
# stdout is exactly two lines, `path=<absolute path>` and `branch=<name>`, the path as git lists it. The
# agentille mod reads them to record the tree as the run's own, so its run-end sweep can delete the .env copies.
# Everything else goes to stderr. Exit 0 on success; 2 for bad arguments; 1 when git refuses or the directory is
# something else.
set -u

die() { printf 'agt-worktree: %s\n' "$1" >&2; exit "${2:-1}"; }

SLUG="" BASE="" BRANCH=""
while [ $# -gt 0 ]; do
  case "$1" in
    --base) [ $# -ge 2 ] || die "--base needs a branch" 2; BASE="$2"; shift 2 ;;
    --base=*) BASE="${1#--base=}"; shift ;;
    --branch) [ $# -ge 2 ] || die "--branch needs a name" 2; BRANCH="$2"; shift 2 ;;
    --branch=*) BRANCH="${1#--branch=}"; shift ;;
    -h|--help) sed -n '2,19p' "$0" | sed 's/^# \{0,1\}//' >&2; exit 0 ;;
    -*) die "unknown option $1" 2 ;;
    *) [ -z "$SLUG" ] || die "one slug only (got $SLUG and $1)" 2; SLUG="$1"; shift ;;
  esac
done
[ -n "$SLUG" ] || die "usage: agt-worktree.sh <slug> [--base <branch>] [--branch <name>]" 2
[[ "$SLUG" =~ ^[a-z0-9][a-z0-9-]{0,50}$ ]] || die "slug must be kebab-case: lowercase letters, digits and dashes, 1-51 chars (got $SLUG)" 2
[ -z "$BRANCH" ] && BRANCH="agt/$SLUG"
git check-ref-format --branch "$BRANCH" >/dev/null 2>&1 || die "not a valid branch name: $BRANCH" 2

git rev-parse --git-dir >/dev/null 2>&1 || die "not inside a git repository"
git worktree prune >&2 2>&1 || true

# Each worktree of the repo, as git lists it: path<TAB>branch (branch empty when detached). The first is the main
# checkout.
trees() {
  git worktree list --porcelain | awk '
    /^worktree / { if (p != "") print p "\t" b; p = substr($0, 10); b = "" }
    /^branch refs\/heads\// { b = substr($0, 19) }
    END { if (p != "") print p "\t" b }'
}
# A directory's physical path, or empty when it does not exist.
phys() { (cd "$1" 2>/dev/null && pwd -P); }

ROOT_LISTED=$(trees | head -n 1 | cut -f1)
[ -n "$ROOT_LISTED" ] || die "git lists no worktrees here"
ROOT=$(phys "$ROOT_LISTED")
[ -n "$ROOT" ] || die "the main checkout $ROOT_LISTED is gone"
[ -d "$ROOT/.git" ] || [ -f "$ROOT/.git" ] || die "the main checkout has no .git (a bare repository is not supported)"
WT="$(dirname "$ROOT")/$(basename "$ROOT")-$SLUG"

# The listed entry whose directory is $WT: its path as git prints it, and its branch.
listed() {
  local want p b
  want=$(phys "$WT")
  [ -n "$want" ] || return 1
  while IFS=$'\t' read -r p b; do
    [ "$(phys "$p")" = "$want" ] && { printf '%s\t%s\n' "$p" "$b"; return 0; }
  done < <(trees | tail -n +2)
  return 1
}

if [ -e "$WT" ]; then
  hit=$(listed) || die "$WT exists and is not a worktree of this repository: move it or pick another slug"
  have=$(printf '%s' "$hit" | cut -f2)
  [ -n "$have" ] || die "$WT is a worktree with a detached HEAD: check out $BRANCH there first"
  [ "$have" = "$BRANCH" ] || die "$WT is a worktree on $have, not $BRANCH: pass --branch $have to re-attach it"
elif git show-ref --verify --quiet "refs/heads/$BRANCH"; then
  git worktree add "$WT" "$BRANCH" >&2 2>&1 || die "git worktree add $WT $BRANCH failed"
else
  if [ -z "$BASE" ]; then
    BASE=$(git symbolic-ref --short -q HEAD) || die "HEAD is detached here: pass --base <branch>"
  fi
  git rev-parse --verify --quiet "$BASE^{commit}" >/dev/null || die "base $BASE is not a commit here"
  git worktree add -b "$BRANCH" "$WT" "$BASE" >&2 2>&1 || die "git worktree add -b $BRANCH $WT $BASE failed"
fi

hit=$(listed) || die "git does not list $WT after making it"
PATH_LISTED=$(printf '%s' "$hit" | cut -f1)

# .env* of the main checkout's top level: plain files only, and only where git ignores the copy in the tree, so
# `git add -A` in the slice can never stage a secret. A re-attach copies them again (the executor deletes its
# copies on every exit).
shopt -s nullglob dotglob
for f in "$ROOT"/.env*; do
  [ -f "$f" ] && [ ! -L "$f" ] || continue
  name=$(basename "$f")
  if git -C "$WT" check-ignore -q -- "$name" 2>/dev/null; then
    cp -p "$f" "$WT/$name" >&2 2>&1 || printf 'agt-worktree: could not copy %s\n' "$name" >&2
  else
    printf 'agt-worktree: %s not copied: git does not ignore it in the tree\n' "$name" >&2
  fi
done
shopt -u nullglob dotglob

# node_modules: copy-on-write (APFS clonefile, then a reflink), else a plain copy. A failed attempt leaves no half
# tree for the next one to merge into.
if [ ! -e "$WT/node_modules" ] && [ -d "$ROOT/node_modules" ] && [ ! -L "$ROOT/node_modules" ]; then
  cp -c -R "$ROOT/node_modules" "$WT/" 2>/dev/null \
    || { rm -rf "$WT/node_modules"; cp --reflink=auto -a "$ROOT/node_modules" "$WT/" 2>/dev/null; } \
    || { rm -rf "$WT/node_modules"; cp -R "$ROOT/node_modules" "$WT/" >&2 2>&1; } \
    || { rm -rf "$WT/node_modules"; printf 'agt-worktree: node_modules not copied: run the project install\n' >&2; }
fi

printf 'path=%s\nbranch=%s\n' "$PATH_LISTED" "$BRANCH"
