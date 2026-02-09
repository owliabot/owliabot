#!/bin/bash
#
# OwliaBot Docker installer
# Checks Docker environment, then runs onboard inside the container
#

set -euo pipefail

OWLIABOT_IMAGE="${OWLIABOT_IMAGE:-ghcr.io/owliabot/owliabot:latest}"
BUILD_LOCAL=false

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

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --build)
        BUILD_LOCAL=true
        shift
        ;;
      *)
        die "Unknown option: $1"
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
  echo "  Welcome to the OwliaBot Docker installer"
  echo ""

  # Parse CLI arguments
  parse_args "$@"

  # Check Docker environment
  check_docker

  # Create directories
  header "Preparing directories"
  mkdir -p config workspace
  mkdir -p ~/.owliabot/auth
  chmod 700 ~/.owliabot ~/.owliabot/auth 2>/dev/null || true
  success "Created config/, workspace/, ~/.owliabot/"

  # Build or pull image
  if [ "$BUILD_LOCAL" = "true" ]; then
    header "Building Docker image locally"
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    if [ ! -f "${SCRIPT_DIR}/Dockerfile" ]; then
      die "Dockerfile not found in ${SCRIPT_DIR}. Cannot build locally."
    fi
    export OWLIABOT_IMAGE="owliabot:local"
    info "Building ${OWLIABOT_IMAGE} from ${SCRIPT_DIR}/Dockerfile ..."
    if docker build -t "${OWLIABOT_IMAGE}" "${SCRIPT_DIR}"; then
      success "Image built successfully: ${OWLIABOT_IMAGE}"
    else
      die "Failed to build image. Check the Dockerfile and build output above."
    fi
  else
    header "Pulling Docker image"
    info "Image: ${OWLIABOT_IMAGE}"
    if docker pull "${OWLIABOT_IMAGE}"; then
      success "Image pulled successfully"
    else
      die "Failed to pull image. Check your internet connection."
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
    -v "$(pwd)/config:/app/config" \
    -v "$(pwd):/app/output" \
    "${OWLIABOT_IMAGE}" \
    onboard --docker --config-dir /app/config --output-dir /app/output \
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
  if [ -f "config/app.yaml" ] && grep -qE 'apiKey: "?oauth"?' config/app.yaml 2>/dev/null; then
    header "Setting up OAuth authentication"
    info "OAuth providers detected in config. Starting auth setup..."
    info "Running in a temporary container..."
    echo ""

    # Run auth setup in a temporary container (not the long-running one)
    if docker run --rm -it \
      -v ~/.owliabot:/home/owliabot/.owliabot \
      -v "$(pwd)/config:/app/config" \
      "${OWLIABOT_IMAGE}" \
      auth setup < /dev/tty; then
      success "OAuth setup completed successfully"
    else
      OAUTH_OK=false
      warn "OAuth setup did not complete."
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
    echo "       -v \$(pwd)/config:/app/config \\"
    echo "       ${OWLIABOT_IMAGE} \\"
    echo "       auth setup"
    echo ""
    echo "  2. Then start the bot:"
    echo "     ${COMPOSE_CMD} up -d"
    echo ""
  else
    header "Starting OwliaBot container"
    info "Using: ${COMPOSE_CMD}"
    if ! ${COMPOSE_CMD} up -d; then
      die "Failed to start container. Check docker-compose.yml and try: ${COMPOSE_CMD} up -d"
    fi
    success "Container started"

    # --- Wait for container to be healthy ---
    info "Waiting for container to be healthy..."
    TIMEOUT=30
    ELAPSED=0
    HEALTHY=false
    while [ $ELAPSED -lt $TIMEOUT ]; do
      CID=$(${COMPOSE_CMD} ps -q owliabot 2>/dev/null)
      if [ -n "$CID" ]; then
        HEALTH=$(docker inspect --format='{{.State.Health.Status}}' "$CID" 2>/dev/null || echo "none")
        if [ "$HEALTH" = "healthy" ]; then
          HEALTHY=true
          break
        fi
        # Fallback: if no healthcheck defined, check State.Running
        if [ "$HEALTH" = "none" ] || [ "$HEALTH" = "" ]; then
          STATE=$(docker inspect --format='{{.State.Running}}' "$CID" 2>/dev/null || echo "false")
          if [ "$STATE" = "true" ]; then
            HEALTHY=true
            break
          fi
        fi
      fi
      sleep 1
      ELAPSED=$((ELAPSED + 1))
    done

    if [ "$HEALTHY" != "true" ]; then
      warn "Container did not become healthy within ${TIMEOUT}s."
      warn "Check logs with: ${COMPOSE_CMD} logs"
      exit 1
    fi
    success "Container is running and healthy"
  fi

  # --- Final success message ---
  header "OwliaBot is running! 🦉"
  success "Your bot is up and running."
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
