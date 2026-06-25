#!/usr/bin/env bash
# cockpit-launch.sh — launch the agentille-cockpit companion viewer
#
# This script resolves the cockpit app directory, validates it, installs deps,
# builds the SPA when stale, and runs the server in the foreground.
#
# TRUST WARNING: this script builds and runs JavaScript from the resolved
# cockpit directory.  Only point it at code you trust.  $AGENTILLE_COCKPIT_DIR
# and the sibling-directory probe are user-controlled — this is opt-in trust,
# NOT a sandboxed execution environment.  --clone fetches and runs the public
# repository (the resolved commit SHA is shown before install; this is social
# trust, not signature-verified).

set -euo pipefail

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

die() { echo "ERROR: $*" >&2; exit 1; }
warn() { echo "WARNING: $*" >&2; }
info() { echo "INFO: $*"; }

# ---------------------------------------------------------------------------
# Defaults / flags
# ---------------------------------------------------------------------------

FORCE_BUILD=0
DO_CLONE=0
COCKPIT_PORT="${COCKPIT_PORT:-7878}"
YES=0
SHOW_HELP=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --build)   FORCE_BUILD=1; shift ;;
    --clone)   DO_CLONE=1;    shift ;;
    --yes)     YES=1;         shift ;;
    --help|-h) SHOW_HELP=1;   shift ;;
    --port)
      shift
      [[ $# -gt 0 ]] || die "--port requires an argument"
      [[ "$1" =~ ^[0-9]+$ ]] || die "--port value must be numeric, got: $1"
      COCKPIT_PORT="$1"
      shift
      ;;
    --port=*)
      val="${1#--port=}"
      [[ "$val" =~ ^[0-9]+$ ]] || die "--port value must be numeric, got: $val"
      COCKPIT_PORT="$val"
      shift
      ;;
    *) die "Unknown flag: $1  (run --help for usage)" ;;
  esac
done

if [[ "$SHOW_HELP" == "1" ]]; then
  cat <<'HELP'
cockpit-launch.sh — start the agentille-cockpit live viewer

USAGE
  cockpit-launch.sh [--clone] [--build] [--port N] [--yes] [--help]

TRUST WARNING
  This script builds and runs JavaScript from the resolved cockpit directory.
  Point it only at code you trust.  --clone fetches and runs the public GitHub
  repository; it shows the resolved commit SHA and prompts for confirmation
  before install/run (social trust, not signature-verified).

FLAGS
  --clone    Clone the public repo to ~/.agentille/cockpit-app and use it.
             If the destination already exists and is clean + correct-origin,
             it does a git pull.  Dirty or wrong-origin → stop.
  --build    Force a full SPA rebuild even if web/dist looks up-to-date.
  --port N   Port to listen on (env COCKPIT_PORT, default 7878).
  --yes      Skip confirmation prompts for already-trusted, origin-matching
             directories.  NEVER silences an origin-mismatch warning —
             that is always an interactive hard stop.
  --help     Show this message and exit.

COCKPIT DIR RESOLUTION (first hit wins)
  1. $AGENTILLE_COCKPIT_DIR
  2. <plugin-root>/../agentille-cockpit   (sibling of the plugin)
  3. ~/.agentille/cockpit-app

REQUIREMENTS
  bun  — https://bun.sh
HELP
  exit 0
fi

# ---------------------------------------------------------------------------
# Known public URL (HTTPS form — used for origin validation + --clone)
# ---------------------------------------------------------------------------
KNOWN_PUBLIC_URL="https://github.com/hasuwini77/agentille-cockpit"
# Also accept the SSH remote form as trusted.
KNOWN_SSH_URL="git@github.com:hasuwini77/agentille-cockpit.git"

origin_is_trusted() {
  local remote="$1"
  # Strip trailing .git for comparison
  local bare="${remote%.git}"
  local bare_pub="${KNOWN_PUBLIC_URL%.git}"
  local bare_ssh="${KNOWN_SSH_URL%.git}"
  [[ "$bare" == "$bare_pub" || "$remote" == "$KNOWN_PUBLIC_URL" \
    || "$bare" == "$bare_ssh" || "$remote" == "$KNOWN_SSH_URL" ]]
}

# ---------------------------------------------------------------------------
# Plugin-root resolution
# ---------------------------------------------------------------------------

# Portable realpath: readlink -f (Linux) → python3 → cd-fallback
portable_realpath() {
  local p="$1"
  if readlink -f "$p" 2>/dev/null; then
    return
  fi
  if command -v python3 &>/dev/null; then
    python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$p"
    return
  fi
  # cd-based fallback (resolves one level of symlink for a directory)
  if [[ -d "$p" ]]; then
    (cd "$p" && pwd -P)
  else
    (cd "$(dirname "$p")" && echo "$(pwd -P)/$(basename "$p")")
  fi
}

if [[ -n "${CLAUDE_PLUGIN_ROOT:-}" ]]; then
  PLUGIN_ROOT="$CLAUDE_PLUGIN_ROOT"
else
  SCRIPT_DIR="$(dirname "$0")"
  PLUGIN_ROOT="$(portable_realpath "$SCRIPT_DIR/..")"
fi

# ---------------------------------------------------------------------------
# --clone branch
# ---------------------------------------------------------------------------

if [[ "$DO_CLONE" == "1" ]]; then
  TARGET="$HOME/.agentille/cockpit-app"

  if [[ -e "$TARGET" ]]; then
    # Detect partial/interrupted clone
    if ! git -C "$TARGET" rev-parse HEAD &>/dev/null; then
      die "Directory $TARGET exists but is not a healthy git repository (partial clone?). Remove it manually and retry:\n  rm -rf $TARGET"
    fi
    # Check origin
    existing_origin="$(git -C "$TARGET" remote get-url origin 2>/dev/null || echo "")"
    if ! origin_is_trusted "$existing_origin"; then
      die "Existing $TARGET has a different origin: $existing_origin\nNot touching it. If this is intentional set AGENTILLE_COCKPIT_DIR to use it directly."
    fi
    # Check cleanliness
    if ! git -C "$TARGET" diff --quiet HEAD 2>/dev/null; then
      die "Existing $TARGET has uncommitted changes. Commit or stash them first."
    fi
    info "Pulling $TARGET (clean + correct origin) ..."
    git -C "$TARGET" pull --ff-only
  else
    mkdir -p "$(dirname "$TARGET")"
    info "Cloning $KNOWN_PUBLIC_URL into $TARGET ..."
    git clone "$KNOWN_PUBLIC_URL" "$TARGET"
  fi

  # Checkout latest tag, else stay on default branch
  latest_tag="$(git -C "$TARGET" describe --tags --abbrev=0 2>/dev/null || echo "")"
  if [[ -n "$latest_tag" ]]; then
    info "Checking out latest tag: $latest_tag"
    git -C "$TARGET" checkout "$latest_tag"
  fi

  resolved_sha="$(git -C "$TARGET" rev-parse HEAD)"
  echo ""
  echo "  Resolved commit: $resolved_sha"
  echo "  Source:          $KNOWN_PUBLIC_URL"
  echo ""
  echo "  This will install dependencies (may run third-party lifecycle scripts)"
  echo "  and run the server from the cloned directory."
  echo "  Social trust — the commit SHA is shown above; it is NOT signature-verified."
  echo ""
  read -r -p "Proceed? [y/N] " _ans
  [[ "${_ans,,}" == "y" || "${_ans,,}" == "yes" ]] || { echo "Aborted."; exit 0; }

  COCKPIT_DIR="$TARGET"
else
  # ---------------------------------------------------------------------------
  # Normal dir resolution
  # ---------------------------------------------------------------------------
  COCKPIT_DIR=""
  if [[ -n "${AGENTILLE_COCKPIT_DIR:-}" ]]; then
    COCKPIT_DIR="$AGENTILLE_COCKPIT_DIR"
  elif [[ -d "$PLUGIN_ROOT/../agentille-cockpit" ]]; then
    COCKPIT_DIR="$(portable_realpath "$PLUGIN_ROOT/../agentille-cockpit")"
  elif [[ -d "$HOME/.agentille/cockpit-app" ]]; then
    COCKPIT_DIR="$HOME/.agentille/cockpit-app"
  fi

  if [[ -z "$COCKPIT_DIR" ]]; then
    echo ""
    echo "No cockpit app directory found."
    echo ""
    echo "Quick start — clone the public repo once:"
    echo "  $0 --clone"
    echo ""
    echo "Or clone manually:"
    echo "  git clone $KNOWN_PUBLIC_URL ~/.agentille/cockpit-app"
    echo ""
    echo "Or point at an existing checkout:"
    echo "  export AGENTILLE_COCKPIT_DIR=/path/to/agentille-cockpit"
    echo "  $0"
    exit 1
  fi
fi

# ---------------------------------------------------------------------------
# Validate the resolved dir
# ---------------------------------------------------------------------------

[[ -f "$COCKPIT_DIR/src/main.ts" ]]  || die "Validation failed: $COCKPIT_DIR/src/main.ts not found. Is this the agentille-cockpit repo?"
[[ -f "$COCKPIT_DIR/package.json" ]] || die "Validation failed: $COCKPIT_DIR/package.json not found."

pkg_name="$(python3 -c 'import sys,json; print(json.load(open(sys.argv[1])).get("name",""))' "$COCKPIT_DIR/package.json" 2>/dev/null || echo "")"
[[ "$pkg_name" == "agentille-cockpit" ]] || die "Validation failed: package.json name is '$pkg_name', expected 'agentille-cockpit'."

# Origin trust check (only if it's a git repo)
if git -C "$COCKPIT_DIR" rev-parse --git-dir &>/dev/null; then
  remote_origin="$(git -C "$COCKPIT_DIR" remote get-url origin 2>/dev/null || echo "")"
  if [[ -n "$remote_origin" ]] && ! origin_is_trusted "$remote_origin"; then
    echo ""
    warn "UNTRUSTED ORIGIN"
    echo "  Directory : $COCKPIT_DIR"
    echo "  Origin    : $remote_origin"
    echo "  Expected  : $KNOWN_PUBLIC_URL  (or SSH equivalent)"
    echo ""
    echo "  This script will build and run JavaScript from the above directory."
    echo "  Only proceed if you trust the code at that path and origin."
    echo ""
    # --yes NEVER silences an origin mismatch
    if [[ ! -t 0 ]]; then
      die "Origin mismatch and no interactive TTY. Aborting."
    fi
    read -r -p "Proceed anyway? [y/N] " _ans
    [[ "${_ans,,}" == "y" || "${_ans,,}" == "yes" ]] || { echo "Aborted."; exit 0; }
  fi
fi

info "Cockpit dir: $COCKPIT_DIR"

# ---------------------------------------------------------------------------
# Require bun
# ---------------------------------------------------------------------------

if ! command -v bun &>/dev/null; then
  die "bun is required but not found.\nInstall: curl -fsSL https://bun.sh/install | bash\nThen open a new shell and retry."
fi

# ---------------------------------------------------------------------------
# Reinstall trigger: node_modules missing OR package.json/lockfile newer
# ---------------------------------------------------------------------------

needs_install() {
  local dir="$1"
  local nm="$dir/node_modules"
  if [[ ! -d "$nm" ]]; then return 0; fi
  # Find lockfile (bun.lock or bun.lockb)
  local lf
  for lf in "$dir/bun.lock" "$dir/bun.lockb"; do
    if [[ -f "$lf" && "$lf" -nt "$nm" ]]; then return 0; fi
  done
  if [[ -f "$dir/package.json" && "$dir/package.json" -nt "$nm" ]]; then return 0; fi
  return 1
}

install_deps() {
  local dir="$1"
  info "Installing dependencies in $dir ..."
  echo "  Note: bun install may run lifecycle scripts from third-party packages."
  (cd "$dir" && bun install --frozen-lockfile) \
    || die "bun install failed in $dir — see output above. Not starting with partial state."
}

if needs_install "$COCKPIT_DIR"; then
  install_deps "$COCKPIT_DIR"
fi

WEB_DIR="$COCKPIT_DIR/web"
if [[ -d "$WEB_DIR" ]]; then
  if needs_install "$WEB_DIR"; then
    install_deps "$WEB_DIR"
  fi
fi

# ---------------------------------------------------------------------------
# Build SPA when stale
# ---------------------------------------------------------------------------

newest_src_mtime() {
  # Return 0 (epoch) if nothing found — safer than erroring
  local dir="$COCKPIT_DIR"
  local wdir="$WEB_DIR"
  local candidates=()
  [[ -d "$wdir/src" ]]    && candidates+=("$wdir/src")
  [[ -f "$wdir/index.html" ]] && candidates+=("$wdir/index.html")
  for cfg in "$wdir/vite.config.ts" "$wdir/vite.config.js"; do
    [[ -f "$cfg" ]] && candidates+=("$cfg")
  done
  [[ -f "$dir/package.json" ]]  && candidates+=("$dir/package.json")
  [[ -f "$wdir/package.json" ]] && candidates+=("$wdir/package.json")
  for lf in "$dir/bun.lock" "$dir/bun.lockb" "$wdir/bun.lock" "$wdir/bun.lockb"; do
    [[ -f "$lf" ]] && candidates+=("$lf")
  done
  if [[ ${#candidates[@]} -eq 0 ]]; then echo 0; return; fi
  # Find the newest file across all candidate paths
  find "${candidates[@]}" -type f -printf '%T@\n' 2>/dev/null \
    | sort -rn | head -1 || echo 0
}

needs_build() {
  [[ "$FORCE_BUILD" == "1" ]] && return 0
  [[ ! -d "$WEB_DIR/dist" ]] && return 0
  local dist_mtime
  dist_mtime="$(find "$WEB_DIR/dist" -type f -printf '%T@\n' 2>/dev/null | sort -rn | head -1 || echo 0)"
  local src_mtime
  src_mtime="$(newest_src_mtime)"
  # Compare as floats: if src newer than dist, rebuild
  if python3 -c "import sys; sys.exit(0 if float(sys.argv[1]) > float(sys.argv[2]) else 1)" \
      "$src_mtime" "$dist_mtime" 2>/dev/null; then
    return 0
  fi
  return 1
}

if [[ -d "$WEB_DIR" ]]; then
  if needs_build; then
    info "Building SPA ..."
    # Use repo-pinned tooling: prefer bun run build if defined in web/package.json
    web_has_build="$(python3 -c 'import sys,json; s=json.load(open(sys.argv[1])).get("scripts",{}); print("yes" if "build" in s else "no")' "$WEB_DIR/package.json" 2>/dev/null || echo "no")"
    if [[ "$web_has_build" == "yes" ]]; then
      (cd "$WEB_DIR" && bun run build) \
        || die "SPA build failed (bun run build in web/). See output above."
    elif [[ -x "$WEB_DIR/node_modules/.bin/vite" ]]; then
      (cd "$WEB_DIR" && node_modules/.bin/vite build) \
        || die "SPA build failed (vite build in web/). See output above."
    else
      die "Cannot build SPA: no 'build' script in web/package.json and web/node_modules/.bin/vite not found."
    fi
  else
    info "SPA is up-to-date (skip build; use --build to force)"
  fi
fi

# ---------------------------------------------------------------------------
# Port pre-check (best-effort; bind failure is the final authority)
# ---------------------------------------------------------------------------

port_in_use() {
  local p="$1"
  if command -v ss &>/dev/null; then
    ss -tlnH "sport = :$p" 2>/dev/null | grep -q .
    return
  fi
  if command -v lsof &>/dev/null; then
    lsof -iTCP:"$p" -sTCP:LISTEN -t &>/dev/null
    return
  fi
  if command -v nc &>/dev/null; then
    nc -z 127.0.0.1 "$p" &>/dev/null
    return
  fi
  return 1
}

if port_in_use "$COCKPIT_PORT"; then
  die "Port $COCKPIT_PORT appears to be in use. Stop the existing process or choose another port:\n  $0 --port <N>"
fi

# ---------------------------------------------------------------------------
# Run — foreground, server prints the token URL on startup
# ---------------------------------------------------------------------------

info "Starting agentille-cockpit on port $COCKPIT_PORT ..."
info "(press Ctrl-C to stop)"
echo ""

COCKPIT_PORT="$COCKPIT_PORT" exec bun "$COCKPIT_DIR/src/main.ts"
