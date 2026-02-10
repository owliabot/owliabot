#!/bin/bash
#
# OwliaBot Docker installer
# Checks Docker environment, then runs onboard inside the container
#

set -euo pipefail

# Allow Ctrl+C to abort at any point (especially during interactive docker run)
cleanup() {
  echo ""
  echo -e "\033[0;31m✗\033[0m Aborted by user."
  exit 130
}
trap cleanup INT TERM

REGISTRY="ghcr.io/owliabot/owliabot"
CHANNEL="${OWLIABOT_CHANNEL:-stable}"  # stable | develop | custom tag
OWLIABOT_TAG="${OWLIABOT_TAG:-}"
BUILD_LOCAL=false
BUILD_BRANCH="main"
LIST_TAGS=false

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
  echo ""
}

big_success_banner() {
  # Pure ASCII banner for the final "started successfully" message.
  local cols=""
  cols="${COLUMNS:-}"
  if [ -z "${cols}" ] && command -v tput &>/dev/null; then
    cols="$(tput cols 2>/dev/null || true)"
  fi
  if ! [[ "${cols}" =~ ^[0-9]+$ ]]; then
    cols="80"
  fi

  echo ""
  if [ "${cols}" -lt 74 ]; then
    printf "%b\n" "${CYAN}+----------------------+${NC}"
    printf "%b\n" "${CYAN}| OwliaBot is running! |${NC}"
    printf "%b\n" "${CYAN}+----------------------+${NC}"
    echo ""
    return 0
  fi
  printf "%b\n" "${CYAN}  ____          _ _       ____        _     _${NC}"
  printf "%b\n" "${CYAN} / __ \\\\        (_) |     |  _ \\\\      | |   (_)_${NC}"
  printf "%b\n" "${CYAN}| |  | |_      _| | __ _  | |_) | ___ | |_   _| |${NC}"
  printf "%b\n" "${CYAN}| |  | \\\\ \\\\ /\\\\ / / | |/ _\` |  _ < / _ \\\\| __| | | |${NC}"
  printf "%b\n" "${CYAN}| |__| |\\\\ V  V /| | | (_| | |_) | (_) | |_  | | |${NC}"
  printf "%b\n" "${CYAN} \\\\____/  \\\\_/\\\\_/ |_|_|\\\\__,_|____/ \\\\___/ \\\\__| |_|_|${NC}"
  echo ""
  printf "%b\n" "${CYAN}  OwliaBot is running!${NC}"
  echo ""
}

check_docker() {
  header "Checking Docker environment"
  
  # Check if docker command exists
  if ! command -v docker &>/dev/null; then
    error "Docker is not installed."
    echo ""
    info "Please install Docker first:"
    echo ""
    echo "  macOS:   brew install --cask docker"
    echo "           or download from https://docs.docker.com/desktop/mac/install/"
    echo ""
    echo "  Ubuntu/Debian:"
    echo "           curl -fsSL https://get.docker.com | sudo sh"
    echo "           sudo usermod -aG docker \$USER"
    echo "           # Log out and back in for group change to take effect"
    echo ""
    echo "  Other Linux:"
    echo "           https://docs.docker.com/engine/install/"
    echo ""
    echo "  Windows: https://docs.docker.com/desktop/windows/install/"
    echo ""
    die "Install Docker and run this script again."
  fi
  success "Docker command found"
  
  # Check if docker daemon is running
  if ! docker info &>/dev/null; then
    error "Docker daemon is not running."
    echo ""
    info "Please start Docker:"
    echo ""
    echo "  macOS/Windows: Start Docker Desktop application"
    echo ""
    echo "  Linux:         sudo systemctl start docker"
    echo "                 # Or: sudo service docker start"
    echo ""
    die "Start Docker and run this script again."
  fi
  success "Docker daemon is running"
  
  # Check docker compose
  if docker compose version &>/dev/null; then
    success "Docker Compose v2 found (docker compose)"
  elif command -v docker-compose &>/dev/null; then
    success "Docker Compose v1 found (docker-compose)"
  else
    warn "Docker Compose not found. You can still use 'docker run' manually."
    info "To install Docker Compose: https://docs.docker.com/compose/install/"
  fi
}

resolve_channel() {
  # Sync BUILD_BRANCH with CHANNEL (handles both --channel flag and OWLIABOT_CHANNEL env)
  if [ "$CHANNEL" = "develop" ]; then
    BUILD_BRANCH="develop"
  fi
}

resolve_image() {
  # If user set OWLIABOT_IMAGE explicitly, use it as-is
  if [ -n "${OWLIABOT_IMAGE:-}" ]; then
    return
  fi

  # Resolve tag from channel
  if [ -n "$OWLIABOT_TAG" ]; then
    OWLIABOT_IMAGE="${REGISTRY}:${OWLIABOT_TAG}"
  elif [ "$CHANNEL" = "stable" ]; then
    OWLIABOT_IMAGE="${REGISTRY}:latest"
  elif [ "$CHANNEL" = "develop" ]; then
    OWLIABOT_IMAGE="${REGISTRY}:develop"
  else
    OWLIABOT_IMAGE="${REGISTRY}:${CHANNEL}"
  fi
}

list_available_tags() {
  header "Available prerelease tags"
  info "Fetching tags from GHCR..."

  local tags=""
  local api_response
  api_response=$(curl -fsSL "https://api.github.com/orgs/owliabot/packages/container/owliabot/versions?per_page=20" \
    -H "Accept: application/vnd.github+json" 2>/dev/null) || true

  if [ -n "$api_response" ]; then
    # Use jq or python3 for reliable JSON parsing (no PCRE/sort -V dependency)
    if command -v jq &>/dev/null; then
      tags=$(echo "$api_response" | jq -r '.[].metadata.container.tags[]' 2>/dev/null | head -20) || true
    elif command -v python3 &>/dev/null; then
      tags=$(echo "$api_response" | python3 -c "
import sys, json
data = json.load(sys.stdin)
tags = [t for v in data for t in v.get('metadata',{}).get('container',{}).get('tags',[])]
for t in sorted(set(tags), reverse=True)[:20]: print(t)
" 2>/dev/null) || true
    else
      warn "Install jq or python3 to use --list"
    fi
  fi

  if [ -z "$tags" ]; then
    warn "Could not fetch tags (auth may be required). Try:"
    echo "  docker pull ${REGISTRY}:develop"
    return
  fi

  echo ""
  echo "Available tags:"
  echo "$tags" | while read -r tag; do
    if echo "$tag" | grep -qE '\-dev\.|\-rc\.|^develop$'; then
      echo -e "  ${YELLOW}• ${tag}${NC}  (prerelease)"
    else
      echo -e "  ${GREEN}• ${tag}${NC}"
    fi
  done
  echo ""
  info "Usage: OWLIABOT_TAG=<tag> $0"
  info "   or: $0 --channel develop"
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --build)
        BUILD_LOCAL=true
        shift
        ;;
      --channel)
        CHANNEL="${2:-}"
        [ -z "$CHANNEL" ] && die "--channel requires a value (stable|develop)"
        shift 2
        ;;
      --tag)
        OWLIABOT_TAG="${2:-}"
        [ -z "$OWLIABOT_TAG" ] && die "--tag requires a value"
        shift 2
        ;;
      --list|-l)
        LIST_TAGS=true
        shift
        ;;
      --help|-h)
        echo "Usage: $0 [options]"
        echo ""
        echo "Options:"
        echo "  --channel <name>   Release channel: stable (default) or develop"
        echo "  --tag <tag>        Specific image tag (e.g. 0.2.0-dev.abc1234)"
        echo "  --list, -l         List available image tags from GHCR"
        echo "  --build            Build from source instead of pulling"
        echo "  --help, -h         Show this help"
        echo ""
        echo "Environment variables:"
        echo "  OWLIABOT_IMAGE     Override the full image reference"
        echo "  OWLIABOT_TAG       Same as --tag"
        echo "  OWLIABOT_CHANNEL   Same as --channel (stable|develop)"
        exit 0
        ;;
      *)
        die "Unknown option: $1 (use --help for usage)"
        ;;
    esac
  done
}

main() {
  # Banner
  echo ""
  echo -e "${CYAN}"
  echo "   ____          ___       ____        _   "
  echo "  / __ \\        / (_)     |  _ \\      | |  "
  echo " | |  | |_      _| |_  __ _| |_) | ___ | |_ "
  echo " | |  | \\ \\ /\\ / / | |/ _\` |  _ < / _ \\| __|"
  echo " | |__| |\\ V  V /| | | (_| | |_) | (_) | |_ "
  echo "  \\____/  \\_/\\_/ |_|_|\\__,_|____/ \\___/ \\__|"
  echo -e "${NC}"
  echo ""

  # Honor OWLIABOT_BUILD env var
  if [ "${OWLIABOT_BUILD:-}" = "1" ] || [ "${OWLIABOT_BUILD:-}" = "true" ]; then
    BUILD_LOCAL=true
  fi

  # Parse CLI arguments
  parse_args "$@"

  # Sync channel → build branch
  resolve_channel

  # Resolve image tag
  resolve_image

  # Handle --list
  if [ "$LIST_TAGS" = "true" ]; then
    list_available_tags
    exit 0
  fi

  # Banner subtitle
  if [ "$CHANNEL" = "stable" ] && [ -z "$OWLIABOT_TAG" ]; then
    echo "  Welcome to the OwliaBot Docker installer"
  else
    echo -e "  ${YELLOW}⚠ Prerelease Installer${NC}"
    echo -e "  Image: ${CYAN}${OWLIABOT_IMAGE}${NC}"
  fi
  echo ""

  # Check Docker environment
  check_docker

  # Create directories
  header "Preparing directories"
  mkdir -p ~/.owliabot/auth
  chmod 700 ~/.owliabot ~/.owliabot/auth 2>/dev/null || true
  success "Created ~/.owliabot/"

  # Build or pull image
  if [ "$BUILD_LOCAL" = "true" ]; then
    header "Building Docker image locally"
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    # Only use local Dockerfile if it matches the requested channel
    LOCAL_BRANCH=""
    if [ -f "${SCRIPT_DIR}/Dockerfile" ] && command -v git &>/dev/null; then
      LOCAL_BRANCH=$(git -C "${SCRIPT_DIR}" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
    fi
    if [ -f "${SCRIPT_DIR}/Dockerfile" ] && { [ "$CHANNEL" = "stable" ] || [ "$LOCAL_BRANCH" = "$BUILD_BRANCH" ] || [ -z "$LOCAL_BRANCH" ]; }; then
      OWLIABOT_IMAGE="owliabot:local"
      info "Building ${OWLIABOT_IMAGE} from ${SCRIPT_DIR}/Dockerfile (branch: ${LOCAL_BRANCH:-unknown})..."
      docker build -t "${OWLIABOT_IMAGE}" "${SCRIPT_DIR}" || die "Build failed."
    else
      # No local Dockerfile — clone and build
      local tmpdir
      tmpdir=$(mktemp -d)
      info "Cloning ${BUILD_BRANCH} branch..."
      git clone --depth 1 --branch "$BUILD_BRANCH" https://github.com/owliabot/owliabot.git "$tmpdir" || die "Clone failed."
      OWLIABOT_IMAGE="owliabot:local"
      info "Building ${OWLIABOT_IMAGE}..."
      docker build -t "${OWLIABOT_IMAGE}" "$tmpdir" || { rm -rf "$tmpdir"; die "Build failed."; }
      rm -rf "$tmpdir"
    fi
    success "Image built: ${OWLIABOT_IMAGE}"
  else
    header "Pulling Docker image"
    info "Image: ${OWLIABOT_IMAGE}"
    if [ "$CHANNEL" != "stable" ] || [ -n "$OWLIABOT_TAG" ]; then
      warn "This is a PRERELEASE build — may contain bugs or breaking changes."
    fi
    if docker pull "${OWLIABOT_IMAGE}"; then
      success "Image pulled successfully"
    else
      error "Failed to pull ${OWLIABOT_IMAGE}"
      if [ "$CHANNEL" != "stable" ]; then
        echo ""
        info "The tag may not exist yet. Try:"
        echo "  $0 --list                    # list available tags"
        echo "  $0 --channel develop         # latest develop"
        echo "  $0 --build --channel develop # build from source"
      fi
      exit 1
    fi
  fi

  # Run onboard interactively
  header "Starting interactive configuration"
  info "Running onboard inside Docker container..."
  echo ""
  
  # Use </dev/tty to ensure interactive input works even when
  # the script is piped via curl (curl ... | bash steals stdin)
  docker run --rm -it \
    -v ~/.owliabot:/home/owliabot/.owliabot \
    -v "$(pwd):/app/output" \
    "${OWLIABOT_IMAGE}" \
    onboard --docker --output-dir /app/output \
    < /dev/tty

  # Verify onboard produced docker-compose.yml
  if [ ! -f "docker-compose.yml" ]; then
    die "Onboard did not generate docker-compose.yml. Cannot auto-start."
  fi

  # Detect docker compose command
  COMPOSE_CMD=""
  if command -v docker-compose &>/dev/null; then
    COMPOSE_CMD="docker-compose"
  elif docker compose version &>/dev/null; then
    COMPOSE_CMD="docker compose"
  else
    die "Docker Compose not found. Please install it and run: docker-compose up -d"
  fi

  # --- Auto-trigger OAuth setup if needed (BEFORE starting the container) ---
  OAUTH_OK=true
  APP_YAML="$HOME/.owliabot/app.yaml"
  if [ -f "${APP_YAML}" ] && grep -qE 'apiKey: "?oauth"?' "${APP_YAML}" 2>/dev/null; then
    header "Setting up OAuth authentication"
    info "OAuth providers detected in config. Starting auth setup..."
    info "Running in a temporary container..."
    echo ""

    # Run auth setup in a temporary container (not the long-running one)
    if docker run --rm -it \
      -v ~/.owliabot:/home/owliabot/.owliabot \
      "${OWLIABOT_IMAGE}" \
      auth setup < /dev/tty; then
      success "OAuth setup completed successfully"
    else
      OAUTH_OK=false
      warn "OAuth setup did not complete."
    fi
  fi

  # If using a non-default image, update docker-compose.yml BEFORE starting
  if [ "$OWLIABOT_IMAGE" != "${REGISTRY}:latest" ]; then
    local SED_PATTERN="s|image:.*ghcr\.io/owliabot/owliabot:.*|image: ${OWLIABOT_IMAGE}|"
    if sed --version 2>/dev/null | grep -q GNU; then
      sed -i "$SED_PATTERN" docker-compose.yml
    else
      sed -i '' "$SED_PATTERN" docker-compose.yml
    fi
    if ! grep -q "${OWLIABOT_IMAGE}" docker-compose.yml 2>/dev/null; then
      warn "Failed to update image in docker-compose.yml. Please edit manually:"
      echo "  image: ${OWLIABOT_IMAGE}"
    else
      success "Updated docker-compose.yml image to ${OWLIABOT_IMAGE}"
    fi
  fi

  # --- Start container (or skip if OAuth failed) ---
  if [ "$OAUTH_OK" = "false" ]; then
    header "Container NOT auto-started"
    warn "OAuth setup did not complete. The container was NOT started to avoid a crash loop."
    echo ""
    info "To complete setup manually:"
    echo ""
    echo "  1. Run OAuth setup in a temporary container:"
    echo "     docker run --rm -it \\"
    echo "       -v ~/.owliabot:/home/owliabot/.owliabot \\"
    echo "       ${OWLIABOT_IMAGE} \\"
    echo "       auth setup"
    echo ""
    echo "  2. Then start the bot:"
    echo "     ${COMPOSE_CMD} up -d"
    echo ""
  else
    header "Starting OwliaBot container"
    info "Using: ${COMPOSE_CMD}"

    # Stop and remove any existing owliabot container (may have been started
    # manually via `docker run` or from an older install).  This prevents
    # name/port conflicts when `compose up -d` tries to create a new one.
    if docker ps -aq --filter "name=^owliabot$" | grep -q .; then
      info "Removing existing owliabot container..."
      docker stop owliabot 2>/dev/null || true
      docker rm owliabot 2>/dev/null || true
      success "Old container removed"
    fi

    if ! ${COMPOSE_CMD} up -d; then
      die "Failed to start container. Check docker-compose.yml and try: ${COMPOSE_CMD} up -d"
    fi
    success "Container started"

  fi

  # --- Final success message ---
  big_success_banner
  success "Your bot is up and running."
  if [ "$CHANNEL" != "stable" ] || [ -n "$OWLIABOT_TAG" ]; then
    echo ""
    warn "You are running a PRERELEASE build."
    info "To switch to stable: $0  (without --channel/--tag)"
  fi
  echo ""
  info "Useful commands:"
  echo "  ${COMPOSE_CMD} logs -f                              # Follow logs"
  echo "  ${COMPOSE_CMD} restart                              # Restart"
  echo "  ${COMPOSE_CMD} down                                 # Stop"
  echo "  ${COMPOSE_CMD} pull && ${COMPOSE_CMD} up -d         # Update"
  echo "  docker exec -it \$(${COMPOSE_CMD} ps -q owliabot) owliabot auth setup  # Re-run OAuth"
  echo ""
}

main "$@"
