#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}/go-onboard"

# Normal interactive terminal: run directly.
if [[ -t 0 && -t 1 ]]; then
  exec go run . "$@"
fi

# If stdin/stdout were wrapped by the package manager, rebind to terminal.
if [[ -r /dev/tty && -w /dev/tty ]]; then
  exec go run . "$@" </dev/tty >/dev/tty
fi

# Final fallback for environments without direct tty: spawn a pseudo-terminal.
if command -v script >/dev/null 2>&1; then
  if script -q /dev/null true >/dev/null 2>&1; then
    exec script -q /dev/null go run . "$@"
  fi

  cmd="$(printf "%q " go run . "$@")"
  exec script -q -c "${cmd% }" /dev/null
fi

exec go run . "$@"
