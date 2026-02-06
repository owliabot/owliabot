#!/bin/bash
#
# OwliaBot Docker installer
# Checks Docker environment, then runs onboard inside the container
#

set -euo pipefail

OWLIABOT_IMAGE="${OWLIABOT_IMAGE:-ghcr.io/owliabot/owliabot:latest}"

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

  # Check Docker environment
  check_docker

  # Create directories
  header "Preparing directories"
  mkdir -p config workspace
  mkdir -p ~/.owliabot/auth
  chmod 700 ~/.owliabot ~/.owliabot/auth 2>/dev/null || true
  success "Created config/, workspace/, ~/.owliabot/"

  # Pull image
  header "Pulling Docker image"
  info "Image: ${OWLIABOT_IMAGE}"
  if docker pull "${OWLIABOT_IMAGE}"; then
    success "Image pulled successfully"
  else
    die "Failed to pull image. Check your internet connection."
  fi

  # Run onboard interactively
  header "Starting interactive configuration"
  info "Running onboard inside Docker container..."
  echo ""
  
  docker run --rm -it \
    -v ~/.owliabot:/home/owliabot/.owliabot \
    -v "$(pwd)/config:/app/config" \
    -v "$(pwd):/app/output" \
    "${OWLIABOT_IMAGE}" \
    onboard --docker --config-dir /app/config --output-dir /app/output
}

main "$@"
