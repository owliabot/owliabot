#!/bin/bash
#
# OwliaBot Prerelease Docker installer
# Pulls a specific prerelease image (develop/rc) and runs onboard
#
# Usage:
#   # Latest develop build
#   curl -fsSL https://raw.githubusercontent.com/owliabot/owliabot/develop/install-prerelease.sh | bash
#
#   # Specific version
#   curl -fsSL ... | OWLIABOT_TAG=0.2.0-dev.abc1234 bash
#
#   # Build from source (develop branch)
#   curl -fsSL ... | OWLIABOT_BUILD=1 bash

set -euo pipefail

REGISTRY="ghcr.io/owliabot/owliabot"
OWLIABOT_TAG="${OWLIABOT_TAG:-develop}"
OWLIABOT_IMAGE="${OWLIABOT_IMAGE:-${REGISTRY}:${OWLIABOT_TAG}}"
BUILD_LOCAL="${OWLIABOT_BUILD:-false}"
BUILD_BRANCH="${OWLIABOT_BRANCH:-develop}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

info() { echo -e "${BLUE}i${NC} $1"; }
success() { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}!${NC} $1"; }
error() { echo -e "${RED}✗${NC} $1"; }
die() { error "$1"; exit 1; }

header() {
  echo ""
  echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${CYAN}  $1${NC}"
  echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

list_available_tags() {
  header "Available prerelease tags"
  info "Fetching tags from GHCR..."

  # Use GitHub API to list package versions
  local tags
  tags=$(curl -fsSL "https://api.github.com/orgs/owliabot/packages/container/owliabot/versions?per_page=20" \
    -H "Accept: application/vnd.github+json" 2>/dev/null \
    | grep -oP '"tags":\[.*?\]' \
    | grep -oP '"[^"]*-dev\.[^"]*"|"[^"]*-rc\.[^"]*"|"develop"' \
    | tr -d '"' \
    | sort -Vr \
    | head -15) || true

  if [ -z "$tags" ]; then
    warn "Could not fetch tags (auth may be required). Try:"
    echo "  docker pull ${REGISTRY}:develop"
    echo "  OWLIABOT_TAG=develop $0"
    return
  fi

  echo ""
  echo "Recent prerelease tags:"
  echo "$tags" | while read -r tag; do
    echo "  • ${tag}"
  done
  echo ""
  info "Usage: OWLIABOT_TAG=<tag> $0"
}

check_docker() {
  header "Checking Docker"

  if ! command -v docker &>/dev/null; then
    die "Docker is not installed. Install from https://docs.docker.com/get-docker/"
  fi
  success "Docker found: $(docker --version | head -1)"

  if ! docker info &>/dev/null; then
    die "Docker daemon is not running. Start it first."
  fi
  success "Docker daemon is running"
}

main() {
  echo -e "${CYAN}"
  echo '   ____          ___       ____        _   '
  echo '  / __ \        / (_)     |  _ \      | |  '
  echo ' | |  | |_      _| |_  __ _| |_) | ___ | |_ '
  echo ' | |  | \ \ /\ / / | |/ _` |  _ < / _ \| __|'
  echo ' | |__| |\ V  V /| | | (_| | |_) | (_) | |_ '
  echo '  \____/  \_/\_/ |_|_|\__,_|____/ \___/ \__|'
  echo -e "${NC}"
  echo -e "  ${YELLOW}⚠ Prerelease Installer${NC}"
  echo -e "  Tag: ${CYAN}${OWLIABOT_TAG}${NC}"
  echo ""

  # Show available tags if --list is passed
  if [ "${1:-}" = "--list" ] || [ "${1:-}" = "-l" ]; then
    list_available_tags
    exit 0
  fi

  check_docker

  # Build or pull image
  if [ "$BUILD_LOCAL" = "1" ] || [ "$BUILD_LOCAL" = "true" ]; then
    header "Building from source (${BUILD_BRANCH})"
    local tmpdir
    tmpdir=$(mktemp -d)
    info "Cloning ${BUILD_BRANCH} branch..."
    git clone --depth 1 --branch "$BUILD_BRANCH" https://github.com/owliabot/owliabot.git "$tmpdir"
    info "Building Docker image..."
    docker build -t "$OWLIABOT_IMAGE" "$tmpdir"
    rm -rf "$tmpdir"
    success "Built image: ${OWLIABOT_IMAGE}"
  else
    header "Pulling prerelease image"
    info "Image: ${OWLIABOT_IMAGE}"
    warn "This is a PRERELEASE build — may contain bugs or breaking changes."
    echo ""

    if ! docker pull "$OWLIABOT_IMAGE"; then
      error "Failed to pull ${OWLIABOT_IMAGE}"
      echo ""
      info "The tag '${OWLIABOT_TAG}' may not exist yet. Try:"
      echo "  $0 --list                              # list available tags"
      echo "  OWLIABOT_TAG=develop $0                # latest develop"
      echo "  OWLIABOT_BUILD=1 $0                    # build from source"
      exit 1
    fi
    success "Pulled ${OWLIABOT_IMAGE}"
  fi

  # Create directories
  header "Preparing directories"
  mkdir -p ~/.owliabot/auth
  chmod 700 ~/.owliabot ~/.owliabot/auth 2>/dev/null || true
  success "Created ~/.owliabot/"

  # Run onboarding
  header "Running onboarding"
  info "Starting interactive setup..."

  docker run --rm -it \
    -v ~/.owliabot:/home/owliabot/.owliabot \
    -v "$(pwd):/app/output" \
    "${OWLIABOT_IMAGE}" \
    onboard --docker --output-dir /app/output \
    < /dev/tty

  # Verify onboard produced docker-compose.yml
  if [ ! -f "docker-compose.yml" ]; then
    die "Onboarding did not produce docker-compose.yml"
  fi
  success "docker-compose.yml generated"

  # Update image in docker-compose.yml to use the prerelease tag
  if command -v sed &>/dev/null; then
    sed -i "s|image:.*owliabot.*|image: ${OWLIABOT_IMAGE}|" docker-compose.yml 2>/dev/null || true
    success "Updated docker-compose.yml to use ${OWLIABOT_IMAGE}"
  fi

  # OAuth setup if needed
  OAUTH_OK=true
  APP_YAML="$HOME/.owliabot/app.yaml"
  if [ -f "${APP_YAML}" ] && grep -qE 'apiKey: "?oauth"?' "${APP_YAML}" 2>/dev/null; then
    header "Setting up OAuth authentication"
    if docker run --rm -it \
      -v ~/.owliabot:/home/owliabot/.owliabot \
      "${OWLIABOT_IMAGE}" \
      auth setup < /dev/tty; then
      success "OAuth setup completed"
    else
      OAUTH_OK=false
      warn "OAuth setup failed — you can retry later"
    fi
  fi

  # Start
  header "Starting OwliaBot (prerelease)"
  docker compose up -d 2>/dev/null || docker-compose up -d 2>/dev/null || {
    die "Failed to start. Run manually: docker compose up -d"
  }
  success "OwliaBot is running!"

  # Final info
  header "Done!"
  echo ""
  warn "You are running a PRERELEASE build (${OWLIABOT_TAG})."
  echo ""
  info "Useful commands:"
  echo "  docker compose logs -f          # view logs"
  echo "  docker compose restart           # restart"
  echo "  docker compose down              # stop"
  echo ""
  info "To switch to stable release:"
  echo "  curl -fsSL https://raw.githubusercontent.com/owliabot/owliabot/main/install.sh | bash"
  echo ""

  if [ "$OAUTH_OK" = false ]; then
    warn "OAuth was not set up. Run:"
    echo "  docker exec -it owliabot owliabot auth setup"
  fi

  success "All set!"
}

main "$@"
