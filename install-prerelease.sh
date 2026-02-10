#!/bin/bash
#
# OwliaBot Prerelease installer — thin wrapper around install.sh
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/owliabot/owliabot/develop/install-prerelease.sh | bash
#   OWLIABOT_TAG=0.2.0-dev.abc1234 bash install-prerelease.sh
#   bash install-prerelease.sh --list
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)"

if [ -f "${SCRIPT_DIR}/install.sh" ]; then
  exec "${SCRIPT_DIR}/install.sh" --channel develop "$@"
else
  # When piped via curl, download install.sh to a temp file first to catch errors
  TMPSCRIPT=$(mktemp)
  trap 'rm -f "$TMPSCRIPT"' EXIT
  if ! curl -fsSL "https://raw.githubusercontent.com/owliabot/owliabot/develop/install.sh" -o "$TMPSCRIPT"; then
    echo "Error: Failed to download install.sh" >&2
    exit 1
  fi
  exec bash "$TMPSCRIPT" --channel develop "$@"
fi
