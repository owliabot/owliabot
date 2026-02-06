#!/bin/bash
#
# OwliaBot Docker installer (simplified)
# Runs the onboard command inside the Docker image
#

set -euo pipefail

OWLIABOT_IMAGE="${OWLIABOT_IMAGE:-ghcr.io/owliabot/owliabot:latest}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

info() { echo -e "\033[0;34mi\033[0m $1"; }
success() { echo -e "${GREEN}✓${NC} $1"; }
error() { echo -e "${RED}✗${NC} $1"; exit 1; }

# Check Docker
if ! command -v docker &>/dev/null; then
  error "Docker not found. Install: https://docs.docker.com/get-docker/"
fi
if ! docker info &>/dev/null; then
  error "Docker daemon not running. Please start Docker."
fi
success "Docker is running"

# Create directories
mkdir -p config workspace ~/.owliabot/auth
chmod 700 ~/.owliabot ~/.owliabot/auth 2>/dev/null || true

# Pull image
info "Pulling ${OWLIABOT_IMAGE}..."
if docker pull "${OWLIABOT_IMAGE}"; then
  success "Image pulled"
else
  error "Failed to pull image. Check your internet connection."
fi

# Run onboard interactively
info "Starting interactive configuration..."
docker run --rm -it \
  -v ~/.owliabot:/home/owliabot/.owliabot \
  -v "$(pwd)/config:/app/config" \
  -v "$(pwd):/app/output" \
  "${OWLIABOT_IMAGE}" \
  onboard --docker --config-dir /app/config --output-dir /app/output

# Done - the onboard command writes docker-compose.yml and instructions
