#!/usr/bin/env bash
#
# OwliaBot onboard launcher (release binary)
# - Default channel: preview
# - Downloads the correct binary for current OS/arch from GitHub releases
# - Verifies checksum when python3 + shasum are available
#

set -euo pipefail

CHANNEL="${OWLIABOT_ONBOARD_CHANNEL:-preview}" # preview | stable
REPO="${OWLIABOT_ONBOARD_REPO:-owliabot/owliabot}"

die() {
  echo "onboard.sh: $*" >&2
  exit 1
}

normalize_os() {
  case "$(uname -s)" in
    Darwin) echo "darwin" ;;
    Linux) echo "linux" ;;
    MINGW*|MSYS*|CYGWIN*) echo "win32" ;;
    *) die "unsupported OS: $(uname -s)" ;;
  esac
}

normalize_arch() {
  case "$(uname -m)" in
    x86_64|amd64) echo "x64" ;;
    arm64|aarch64) echo "arm64" ;;
    *) die "unsupported CPU architecture: $(uname -m)" ;;
  esac
}

resolve_binary_name() {
  local os="$1"
  local arch="$2"
  local ext=""
  if [ "$os" = "win32" ]; then
    ext=".exe"
  fi
  echo "owliabot-onboard-${os}-${arch}${ext}"
}

verify_checksum_if_possible() {
  local binary_path="$1"
  local manifest_url="$2"
  local runtime_key="$3"

  if ! command -v python3 >/dev/null 2>&1 || ! command -v shasum >/dev/null 2>&1; then
    echo "onboard.sh: checksum verification skipped (requires python3 + shasum)." >&2
    return 0
  fi

  local expected
  expected="$(
    curl -fsSL "$manifest_url" | python3 - "$runtime_key" <<'PY'
import json
import sys

runtime_key = sys.argv[1]
manifest = json.load(sys.stdin)
asset = (manifest.get("assets") or {}).get(runtime_key)
if not asset:
    print("")
    sys.exit(0)
print((asset.get("sha256") or "").strip().lower())
PY
  )"

  if [ -z "$expected" ]; then
    echo "onboard.sh: checksum verification skipped (runtime not present in manifest)." >&2
    return 0
  fi

  local actual
  actual="$(shasum -a 256 "$binary_path" | awk '{print tolower($1)}')"
  if [ "$actual" != "$expected" ]; then
    die "checksum mismatch for onboard binary"
  fi
}

main() {
  local os arch runtime_key binary_name tmp_dir binary_path release_tag binary_url manifest_url

  os="$(normalize_os)"
  arch="$(normalize_arch)"
  runtime_key="${os}-${arch}"
  binary_name="$(resolve_binary_name "$os" "$arch")"

  if [ "$CHANNEL" != "preview" ] && [ "$CHANNEL" != "stable" ]; then
    die "invalid channel '${CHANNEL}' (expected preview|stable)"
  fi

  release_tag="onboard-${CHANNEL}"
  binary_url="https://github.com/${REPO}/releases/download/${release_tag}/${binary_name}"
  manifest_url="https://github.com/${REPO}/releases/download/${release_tag}/onboard-manifest.json"

  tmp_dir="$(mktemp -d 2>/dev/null || mktemp -d -t owliabot-onboard)"
  trap 'rm -rf "$tmp_dir"' EXIT
  binary_path="${tmp_dir}/${binary_name}"

  echo "onboard.sh: downloading ${binary_name} from ${release_tag}..."
  curl -fsSL "$binary_url" -o "$binary_path"
  chmod +x "$binary_path"

  verify_checksum_if_possible "$binary_path" "$manifest_url" "$runtime_key"

  echo "onboard.sh: starting onboarding wizard..."
  exec "$binary_path" "$@"
}

main "$@"
