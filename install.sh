#!/bin/bash
#
# OwliaBot Docker installer
# Interactive configuration + optional OAuth setup
#

set -euo pipefail

# Image from GitHub Container Registry
OWLIABOT_IMAGE="${OWLIABOT_IMAGE:-ghcr.io/owliabot/owliabot:latest}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Helper functions
info() { echo -e "${BLUE}i${NC} $1"; }
success() { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}!${NC} $1"; }
error() { echo -e "${RED}✗${NC} $1"; }

die() {
  error "$1"
  exit 1
}

header() {
  echo ""
  echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${CYAN}  $1${NC}"
  echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""
}

prompt() {
  local var_name=$1
  local prompt_text=$2
  local default=${3:-}
  local is_secret=${4:-false}

  if [ -n "${default}" ]; then
    prompt_text="$prompt_text [$default]"
  fi

  local value
  if [ "${is_secret}" = true ]; then
    read -rsp "$prompt_text: " value
    echo ""
  else
    read -rp "$prompt_text: " value
  fi

  if [ -z "${value}" ] && [ -n "${default}" ]; then
    value="${default}"
  fi

  # shellcheck disable=SC2163
  eval "$var_name=\"$value\""
}

prompt_yn() {
  local prompt_text=$1
  local default=${2:-n}
  local yn

  if [ "${default}" = "y" ]; then
    read -rp "$prompt_text [Y/n]: " yn
    yn=${yn:-y}
  else
    read -rp "$prompt_text [y/N]: " yn
    yn=${yn:-n}
  fi

  [[ "$yn" =~ ^[Yy]$ ]]
}

# Global variable to store select_option result (avoids set -e issues with return codes)
SELECT_RESULT=0

select_option() {
  local prompt_text=$1
  shift
  local options=("$@")

  echo "$prompt_text"
  for i in "${!options[@]}"; do
    echo "  $((i+1)). ${options[$i]}"
  done

  local selection
  while true; do
    read -rp "Select [1-${#options[@]}]: " selection
    if [[ "$selection" =~ ^[0-9]+$ ]] && [ "$selection" -ge 1 ] && [ "$selection" -le "${#options[@]}" ]; then
      SELECT_RESULT=$((selection-1))
      return 0
    fi
    warn "Please enter a number between 1 and ${#options[@]}"
  done
}

check_requirements() {
  header "Checking requirements"

  local missing=()

  if ! command -v docker &>/dev/null; then
    missing+=("docker")
  else
    success "Docker found"
  fi

  if ! command -v docker-compose &>/dev/null && ! docker compose version &>/dev/null; then
    missing+=("docker-compose")
  else
    success "Docker Compose found"
  fi

  if [ ${#missing[@]} -gt 0 ]; then
    die "Missing dependencies: ${missing[*]}\nInstall Docker: https://docs.docker.com/get-docker/"
  fi

  if ! docker info &>/dev/null; then
    die "Docker daemon is not running. Please start Docker and try again."
  fi

  success "Docker daemon is running"
}

container_is_running() {
  local name=$1
  docker inspect -f '{{.State.Running}}' "$name" 2>/dev/null | grep -q true
}

container_is_restarting() {
  local name=$1
  docker inspect -f '{{.State.Restarting}}' "$name" 2>/dev/null | grep -q true
}

tail_container_logs() {
  local name=$1
  local lines=${2:-120}
  echo ""
  warn "Showing last ${lines} lines of logs for '${name}':"
  docker logs --tail "$lines" "$name" 2>&1 || true
}

wait_for_container() {
  local name=$1
  local timeout_sec=${2:-30}

  local start
  start=$(date +%s)

  while true; do
    if container_is_running "$name" && ! container_is_restarting "$name"; then
      return 0
    fi

    local now
    now=$(date +%s)
    if [ $((now - start)) -ge "$timeout_sec" ]; then
      return 1
    fi

    sleep 1
  done
}

main() {
  clear || true
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

  check_requirements

  mkdir -p config workspace

  # ===========================================================================
  # Check for existing configuration
  # ===========================================================================
  OWLIABOT_HOME="${HOME}/.owliabot"
  EXISTING_SECRETS="${OWLIABOT_HOME}/secrets.yaml"
  EXISTING_AUTH_DIR="${OWLIABOT_HOME}/auth"
  
  # Variables to store existing values
  EXISTING_ANTHROPIC_KEY=""
  EXISTING_OPENAI_KEY=""
  EXISTING_DISCORD_TOKEN=""
  EXISTING_TELEGRAM_TOKEN=""
  EXISTING_GATEWAY_TOKEN=""
  EXISTING_OPENAI_COMPAT_KEY=""
  EXISTING_ANTHROPIC_OAUTH=0
  EXISTING_OPENAI_OAUTH=0
  
  # Check for existing configuration
  HAS_EXISTING_CONFIG=0
  
  if [ -f "$EXISTING_SECRETS" ]; then
    # Parse existing values (simple grep-based extraction)
    EXISTING_ANTHROPIC_KEY=$(grep -A1 '^anthropic:' "$EXISTING_SECRETS" 2>/dev/null | grep 'apiKey:' | sed 's/.*apiKey:[[:space:]]*"\?\([^"]*\)"\?/\1/' | tr -d ' ' || true)
    EXISTING_OPENAI_KEY=$(grep -A1 '^openai:' "$EXISTING_SECRETS" 2>/dev/null | grep 'apiKey:' | sed 's/.*apiKey:[[:space:]]*"\?\([^"]*\)"\?/\1/' | tr -d ' ' || true)
    EXISTING_DISCORD_TOKEN=$(grep -A1 '^discord:' "$EXISTING_SECRETS" 2>/dev/null | grep 'token:' | sed 's/.*token:[[:space:]]*"\?\([^"]*\)"\?/\1/' | tr -d ' ' || true)
    EXISTING_TELEGRAM_TOKEN=$(grep -A1 '^telegram:' "$EXISTING_SECRETS" 2>/dev/null | grep 'token:' | sed 's/.*token:[[:space:]]*"\?\([^"]*\)"\?/\1/' | tr -d ' ' || true)
    EXISTING_GATEWAY_TOKEN=$(grep -A1 '^gateway:' "$EXISTING_SECRETS" 2>/dev/null | grep 'token:' | sed 's/.*token:[[:space:]]*"\?\([^"]*\)"\?/\1/' | tr -d ' ' || true)
    EXISTING_OPENAI_COMPAT_KEY=$(grep -A1 '^openai-compatible:' "$EXISTING_SECRETS" 2>/dev/null | grep 'apiKey:' | sed 's/.*apiKey:[[:space:]]*"\?\([^"]*\)"\?/\1/' | tr -d ' ' || true)
  fi
  
  # Check for OAuth tokens in auth directory
  if [ -d "$EXISTING_AUTH_DIR" ]; then
    [ -f "$EXISTING_AUTH_DIR/anthropic.json" ] && EXISTING_ANTHROPIC_OAUTH=1
    [ -f "$EXISTING_AUTH_DIR/openai-codex.json" ] && EXISTING_OPENAI_OAUTH=1
  fi
  
  # Check if we have any existing credentials worth showing
  if [ -n "$EXISTING_ANTHROPIC_KEY" ] || [ -n "$EXISTING_OPENAI_KEY" ] || \
     [ -n "$EXISTING_DISCORD_TOKEN" ] || [ -n "$EXISTING_TELEGRAM_TOKEN" ] || \
     [ -n "$EXISTING_GATEWAY_TOKEN" ] || \
     [ "$EXISTING_ANTHROPIC_OAUTH" -eq 1 ] || [ "$EXISTING_OPENAI_OAUTH" -eq 1 ]; then
    HAS_EXISTING_CONFIG=1
  fi
  
  if [ "$HAS_EXISTING_CONFIG" -eq 1 ]; then
    header "Existing configuration found"
    info "Found existing config at: ${OWLIABOT_HOME}"
    
    # Show what was found (only non-empty values)
    [ -n "$EXISTING_ANTHROPIC_KEY" ] && info "Found Anthropic API key: ${EXISTING_ANTHROPIC_KEY:0:10}..."
    [ "$EXISTING_ANTHROPIC_OAUTH" -eq 1 ] && info "Found Anthropic OAuth token"
    [ -n "$EXISTING_OPENAI_KEY" ] && info "Found OpenAI API key: ${EXISTING_OPENAI_KEY:0:10}..."
    [ "$EXISTING_OPENAI_OAUTH" -eq 1 ] && info "Found OpenAI OAuth token (openai-codex)"
    [ -n "$EXISTING_DISCORD_TOKEN" ] && info "Found Discord token: ${EXISTING_DISCORD_TOKEN:0:20}..."
    [ -n "$EXISTING_TELEGRAM_TOKEN" ] && info "Found Telegram token: ${EXISTING_TELEGRAM_TOKEN:0:10}..."
    [ -n "$EXISTING_GATEWAY_TOKEN" ] && info "Found Gateway token: ${EXISTING_GATEWAY_TOKEN:0:10}..."
    
    if prompt_yn "Do you want to reuse existing configuration?" "y"; then
      REUSE_EXISTING=1
      success "Will reuse existing configuration"
    else
      REUSE_EXISTING=0
      info "Will configure new credentials"
    fi
  else
    REUSE_EXISTING=0
  fi

  # ===========================================================================
  # AI Providers
  # ===========================================================================
  
  ANTHROPIC_API_KEY=""
  OPENAI_API_KEY=""
  OPENAI_COMPAT_BASE_URL=""
  OPENAI_COMPAT_API_KEY=""
  OPENAI_COMPAT_MODEL=""

  USE_ANTHROPIC=0
  USE_OPENAI=0
  USE_OPENAI_CODEX=0
  USE_OPENAI_COMPAT=0

  # Check if we can skip AI provider setup (reusing existing config)
  HAS_EXISTING_AI_PROVIDER=0
  if [ "$REUSE_EXISTING" -eq 1 ]; then
    if [ -n "$EXISTING_ANTHROPIC_KEY" ] || [ "$EXISTING_ANTHROPIC_OAUTH" -eq 1 ]; then
      HAS_EXISTING_AI_PROVIDER=1
      if [ -n "$EXISTING_ANTHROPIC_KEY" ]; then
        USE_ANTHROPIC=1
        ANTHROPIC_API_KEY="$EXISTING_ANTHROPIC_KEY"
      elif [ "$EXISTING_ANTHROPIC_OAUTH" -eq 1 ]; then
        USE_ANTHROPIC=1
        # OAuth token exists, will be loaded from auth dir
      fi
    fi
    if [ -n "$EXISTING_OPENAI_KEY" ]; then
      HAS_EXISTING_AI_PROVIDER=1
      USE_OPENAI=1
      OPENAI_API_KEY="$EXISTING_OPENAI_KEY"
    fi
    if [ "$EXISTING_OPENAI_OAUTH" -eq 1 ]; then
      HAS_EXISTING_AI_PROVIDER=1
      USE_OPENAI_CODEX=1
    fi
  fi

  if [ "$HAS_EXISTING_AI_PROVIDER" -eq 1 ]; then
    header "AI provider setup"
    success "Reusing existing AI provider configuration:"
    [ "$USE_ANTHROPIC" -eq 1 ] && [ -n "$ANTHROPIC_API_KEY" ] && info "  - Anthropic (API key)"
    [ "$USE_ANTHROPIC" -eq 1 ] && [ -z "$ANTHROPIC_API_KEY" ] && [ "$EXISTING_ANTHROPIC_OAUTH" -eq 1 ] && info "  - Anthropic (OAuth)"
    [ "$USE_OPENAI" -eq 1 ] && info "  - OpenAI (API key)"
    [ "$USE_OPENAI_CODEX" -eq 1 ] && info "  - OpenAI OAuth (openai-codex)"
  else
    header "AI provider setup"

    select_option "Choose your AI provider(s):" \
      "Anthropic (Claude)" \
      "OpenAI (API key)" \
      "OpenAI (OAuth via ChatGPT Plus/Pro - openai-codex)" \
      "OpenAI-compatible (Ollama / vLLM / LM Studio / etc.)" \
      "Multiple providers (fallback)"
    local ai_choice=$SELECT_RESULT

    # Anthropic
    if [ $ai_choice -eq 0 ] || [ $ai_choice -eq 4 ]; then
      USE_ANTHROPIC=1
      echo ""
      info "Anthropic: https://console.anthropic.com/settings/keys"
      
      if prompt_yn "Do you want to use OAuth instead of an API key? (Claude Pro/Max subscription)" "y"; then
        # OAuth will be run later (inside the container)
        ANTHROPIC_API_KEY=""
        success "Anthropic OAuth will be configured after the container starts"
      else
        prompt ANTHROPIC_API_KEY "Enter Anthropic API key" "" true
        [ -n "$ANTHROPIC_API_KEY" ] && success "Anthropic API key set" || warn "Anthropic API key not provided"
      fi
    fi

    # OpenAI (API key)
    if [ $ai_choice -eq 1 ] || [ $ai_choice -eq 4 ]; then
      USE_OPENAI=1
      echo ""
      info "OpenAI API keys: https://platform.openai.com/api-keys"
      
      prompt OPENAI_API_KEY "Enter OpenAI API key" "" true
      [ -n "$OPENAI_API_KEY" ] && success "OpenAI API key set" || warn "OpenAI API key not provided"
    fi

    # OpenAI (OAuth - openai-codex)
    if [ $ai_choice -eq 2 ] || [ $ai_choice -eq 4 ]; then
      USE_OPENAI_CODEX=1
      echo ""
      info "OpenAI OAuth (openai-codex) uses your ChatGPT Plus/Pro subscription."
      success "OpenAI OAuth will be configured after the container starts"
    fi
  fi

  # OpenAI-compatible
  if [ $ai_choice -eq 3 ] || [ $ai_choice -eq 4 ]; then
    USE_OPENAI_COMPAT=1
    echo ""
    info "OpenAI-compatible supports any server that implements the OpenAI v1 API."
    info "Examples:"
    info "  - Ollama:    http://localhost:11434/v1"
    info "  - vLLM:      http://localhost:8000/v1"
    info "  - LM Studio: http://localhost:1234/v1"
    info "  - LocalAI:   http://localhost:8080/v1"
    echo ""
    prompt OPENAI_COMPAT_BASE_URL "API base URL"
    if [ -z "$OPENAI_COMPAT_BASE_URL" ]; then
      warn "No OpenAI-compatible base URL provided"
      USE_OPENAI_COMPAT=0
    else
      prompt OPENAI_COMPAT_MODEL "Model name" "llama3.2"
      prompt OPENAI_COMPAT_API_KEY "API key (optional)" "" true
      success "OpenAI-compatible configured: $OPENAI_COMPAT_BASE_URL"
    fi
  fi

  # Validate: at least one working provider path (API key or OAuth selection)
  if [ $USE_ANTHROPIC -eq 0 ] && [ $USE_OPENAI -eq 0 ] && [ $USE_OPENAI_CODEX -eq 0 ] && [ $USE_OPENAI_COMPAT -eq 0 ]; then
    die "You must select at least one provider."
  fi

  # If user selected only API-key providers, enforce key presence.
  if [ $USE_OPENAI -eq 1 ] && [ -z "$OPENAI_API_KEY" ] && [ $USE_OPENAI_CODEX -eq 0 ]; then
    warn "OpenAI selected but no API key provided."
  fi
  if [ $USE_ANTHROPIC -eq 1 ] && [ -z "$ANTHROPIC_API_KEY" ]; then
    # Could be OAuth path; we'll keep going.
    :
  fi

  # ===========================================================================
  # Chat platform
  # ===========================================================================
  
  DISCORD_BOT_TOKEN=""
  TELEGRAM_BOT_TOKEN=""
  
  # Check if we can skip chat platform setup (reusing existing config)
  HAS_EXISTING_CHAT_PLATFORM=0
  if [ "$REUSE_EXISTING" -eq 1 ]; then
    if [ -n "$EXISTING_DISCORD_TOKEN" ] || [ -n "$EXISTING_TELEGRAM_TOKEN" ]; then
      HAS_EXISTING_CHAT_PLATFORM=1
      DISCORD_BOT_TOKEN="$EXISTING_DISCORD_TOKEN"
      TELEGRAM_BOT_TOKEN="$EXISTING_TELEGRAM_TOKEN"
    fi
  fi

  if [ "$HAS_EXISTING_CHAT_PLATFORM" -eq 1 ]; then
    header "Chat platform setup"
    success "Reusing existing chat platform configuration:"
    [ -n "$DISCORD_BOT_TOKEN" ] && info "  - Discord"
    [ -n "$TELEGRAM_BOT_TOKEN" ] && info "  - Telegram"
  else
    header "Chat platform setup"

    select_option "Choose platform(s):" "Discord" "Telegram" "Both"
    local chat_choice=$SELECT_RESULT

    if [ $chat_choice -eq 0 ] || [ $chat_choice -eq 2 ]; then
      echo ""
      info "Discord developer portal: https://discord.com/developers/applications"
      
      prompt DISCORD_BOT_TOKEN "Enter Discord bot token" "" true
      [ -n "$DISCORD_BOT_TOKEN" ] && success "Discord token set" || warn "Discord token not provided"
    fi

    if [ $chat_choice -eq 1 ] || [ $chat_choice -eq 2 ]; then
      echo ""
      info "Telegram BotFather: https://t.me/BotFather"
      
      prompt TELEGRAM_BOT_TOKEN "Enter Telegram bot token" "" true
      [ -n "$TELEGRAM_BOT_TOKEN" ] && success "Telegram token set" || warn "Telegram token not provided"
    fi
  fi

  if [ -z "$DISCORD_BOT_TOKEN" ] && [ -z "$TELEGRAM_BOT_TOKEN" ]; then
    die "You must configure at least one chat platform token (Discord or Telegram)."
  fi

  # ===========================================================================
  # Gateway HTTP
  # ===========================================================================
  header "Gateway HTTP"

  info "Gateway HTTP is used for health checks and REST API access."

  GATEWAY_PORT="8787"
  prompt GATEWAY_PORT "Host port to expose the gateway" "8787"

  # Check for existing token or generate new one
  if [ "$REUSE_EXISTING" -eq 1 ] && [ -n "$EXISTING_GATEWAY_TOKEN" ]; then
    GATEWAY_TOKEN="$EXISTING_GATEWAY_TOKEN"
    echo ""
    success "Reusing existing Gateway token"
  else
    if command -v openssl &>/dev/null; then
      GATEWAY_TOKEN=$(openssl rand -hex 16)
    else
      GATEWAY_TOKEN=$(head -c 32 /dev/urandom | xxd -p | tr -d '\n' | head -c 32)
    fi

    echo ""
    info "Generated a random gateway token (you can override it)."
    prompt GATEWAY_TOKEN "Gateway token" "$GATEWAY_TOKEN" true
    success "Gateway token set"
  fi

  # ===========================================================================
  # Timezone
  # ===========================================================================
  header "Other settings"

  TZ="UTC"
  prompt TZ "Timezone" "UTC"
  success "Timezone: $TZ"

  # ===========================================================================
  # Secrets & config
  # ===========================================================================
  header "Writing config"

  # OWLIABOT_HOME already defined at the beginning
  mkdir -p "${OWLIABOT_HOME}"
  chmod 700 "${OWLIABOT_HOME}"
  mkdir -p "${OWLIABOT_HOME}/auth"
  chmod 700 "${OWLIABOT_HOME}/auth"

  cat > "${OWLIABOT_HOME}/secrets.yaml" << EOF
# OwliaBot Secrets
# Generated by install.sh on $(date)
# This file contains sensitive information. Do NOT commit it.

anthropic:
  apiKey: "${ANTHROPIC_API_KEY}"

openai:
  apiKey: "${OPENAI_API_KEY}"

openai-compatible:
  apiKey: "${OPENAI_COMPAT_API_KEY}"

discord:
  token: "${DISCORD_BOT_TOKEN}"

telegram:
  token: "${TELEGRAM_BOT_TOKEN}"

gateway:
  token: "${GATEWAY_TOKEN}"
EOF

  chmod 600 "${OWLIABOT_HOME}/secrets.yaml"
  success "Wrote ${OWLIABOT_HOME}/secrets.yaml (chmod 600)"

  # Create symlink so owliabot can find secrets next to app.yaml
  ln -sf "${OWLIABOT_HOME}/secrets.yaml" config/secrets.yaml
  success "Linked config/secrets.yaml -> ~/.owliabot/secrets.yaml"

  # Build app config
  cat > config/app.yaml << EOF
# OwliaBot config
# Generated by install.sh on $(date)
#
# Secrets are in ~/.owliabot/secrets.yaml (config/secrets.yaml is a symlink)

providers:
EOF

  # Provider blocks
  local priority=1

  if [ $USE_ANTHROPIC -eq 1 ]; then
    if [ -n "$ANTHROPIC_API_KEY" ]; then
      cat >> config/app.yaml << EOF
  - id: anthropic
    model: claude-sonnet-4-5
    apiKey: secrets
    priority: ${priority}
EOF
    else
      # OAuth placeholder (token will be loaded from ~/.owliabot/auth)
      cat >> config/app.yaml << EOF
  - id: anthropic
    model: claude-sonnet-4-5
    apiKey: oauth
    priority: ${priority}
EOF
    fi
    priority=$((priority+1))
  fi

  if [ $USE_OPENAI -eq 1 ]; then
    cat >> config/app.yaml << EOF
  - id: openai
    model: gpt-4o
    apiKey: secrets
    priority: ${priority}
EOF
    priority=$((priority+1))
  fi

  if [ $USE_OPENAI_CODEX -eq 1 ]; then
    cat >> config/app.yaml << EOF
  - id: openai-codex
    model: gpt-5.2
    apiKey: oauth
    priority: ${priority}
EOF
    priority=$((priority+1))
  fi

  if [ $USE_OPENAI_COMPAT -eq 1 ]; then
    if [ -n "$OPENAI_COMPAT_BASE_URL" ]; then
      cat >> config/app.yaml << EOF
  - id: openai-compatible
    model: ${OPENAI_COMPAT_MODEL}
    baseUrl: ${OPENAI_COMPAT_BASE_URL}
EOF
      if [ -n "$OPENAI_COMPAT_API_KEY" ]; then
        cat >> config/app.yaml << EOF
    apiKey: secrets
EOF
      else
        cat >> config/app.yaml << EOF
    apiKey: "none"
EOF
      fi
      cat >> config/app.yaml << EOF
    priority: ${priority}
EOF
      priority=$((priority+1))
    fi
  fi

  cat >> config/app.yaml << EOF

# Chat platform config (tokens are read from secrets.yaml)
EOF

  if [ -n "$DISCORD_BOT_TOKEN" ]; then
    cat >> config/app.yaml << EOF
discord:
  enabled: true
EOF
  fi

  if [ -n "$TELEGRAM_BOT_TOKEN" ]; then
    cat >> config/app.yaml << EOF
telegram:
  enabled: true
EOF
  fi

  cat >> config/app.yaml << EOF

# Gateway HTTP config
# Container always uses port 8787 (Dockerfile healthcheck depends on it)
# Host port is mapped via docker -p

gateway:
  http:
    host: 0.0.0.0
    port: 8787

workspace: /app/workspace
timezone: ${TZ}
EOF

  success "Wrote config/app.yaml"

  # ===========================================================================
  # Pull + run
  # ===========================================================================
  header "Pull & run"

  if prompt_yn "Start OwliaBot now?" "y"; then
    info "Pulling image: ${OWLIABOT_IMAGE}"
    if docker pull "${OWLIABOT_IMAGE}"; then
      success "Image pulled"
    else
      warn "Pull failed. Building locally..."
      docker build -t owliabot:local .
      OWLIABOT_IMAGE="owliabot:local"
      success "Local image built"
    fi

    info "Starting container..."
    docker rm -f owliabot 2>/dev/null || true

    # Mount:
    # - secrets.yaml (read-only) into /app/config/secrets.yaml
    # - auth dir (read-write) into /home/owliabot/.owliabot/auth for OAuth tokens
    # - app config into /app/config/app.yaml
    # - workspace dir
    docker run -d \
      --name owliabot \
      --restart unless-stopped \
      -p "127.0.0.1:${GATEWAY_PORT}:8787" \
      -v "${OWLIABOT_HOME}/secrets.yaml:/app/config/secrets.yaml:ro" \
      -v "${OWLIABOT_HOME}/auth:/home/owliabot/.owliabot/auth" \
      -v "$(pwd)/config/app.yaml:/app/config/app.yaml:ro" \
      -v "$(pwd)/workspace:/app/workspace" \
      -e "TZ=${TZ}" \
      "${OWLIABOT_IMAGE}" \
      start -c /app/config/app.yaml

    success "OwliaBot started"

    echo ""
    info "Logs: docker logs -f owliabot"

    # Wait briefly for container to be stable before attempting docker exec.
    if ! wait_for_container owliabot 15; then
      warn "Container is not stable (running/restarting). OAuth via 'docker exec' may fail."
      tail_container_logs owliabot 120
    fi

    # =======================================================================
    # OAuth flows (optional)
    # =======================================================================
    if [ $USE_ANTHROPIC -eq 1 ] && [ -z "$ANTHROPIC_API_KEY" ]; then
      echo ""
      header "Anthropic OAuth"
      info "OAuth requires an interactive flow. You can run it either:"
      info "  1) In a one-shot container (recommended if the main container is restarting)"
      info "  2) Via docker exec (requires the main container to be running)"

      if prompt_yn "Run Anthropic OAuth now (one-shot container)?" "y"; then
        docker run --rm -it \
          -v "${OWLIABOT_HOME}/auth:/home/owliabot/.owliabot/auth" \
          -v "${OWLIABOT_HOME}/secrets.yaml:/app/config/secrets.yaml:ro" \
          "${OWLIABOT_IMAGE}" auth setup anthropic
      else
        info "Later: docker exec -it owliabot node dist/entry.js auth setup anthropic"
        if container_is_running owliabot && ! container_is_restarting owliabot; then
          if prompt_yn "Run Anthropic OAuth now via docker exec?" "n"; then
            docker exec -it owliabot node dist/entry.js auth setup anthropic
          fi
        else
          warn "Skipping docker exec because the container is not stable."
        fi
      fi
    fi

    if [ $USE_OPENAI_CODEX -eq 1 ]; then
      echo ""
      header "OpenAI OAuth (openai-codex)"
      info "OAuth requires an interactive flow. You can run it either:"
      info "  1) In a one-shot container (recommended if the main container is restarting)"
      info "  2) Via docker exec (requires the main container to be running)"

      if prompt_yn "Run OpenAI OAuth now (one-shot container)?" "y"; then
        docker run --rm -it \
          -v "${OWLIABOT_HOME}/auth:/home/owliabot/.owliabot/auth" \
          -v "${OWLIABOT_HOME}/secrets.yaml:/app/config/secrets.yaml:ro" \
          "${OWLIABOT_IMAGE}" auth setup openai-codex
      else
        info "Later: docker exec -it owliabot node dist/entry.js auth setup openai-codex"
        if container_is_running owliabot && ! container_is_restarting owliabot; then
          if prompt_yn "Run OpenAI OAuth now via docker exec?" "n"; then
            docker exec -it owliabot node dist/entry.js auth setup openai-codex
          fi
        else
          warn "Skipping docker exec because the container is not stable."
        fi
      fi
    fi
  fi

  # ===========================================================================
  # Summary
  # ===========================================================================
  header "Done"

  echo "Files created:"
  echo "  - ~/.owliabot/secrets.yaml   (sensitive)"
  echo "  - ~/.owliabot/auth/          (OAuth tokens)"
  echo "  - ./config/app.yaml          (app config)"
  echo "  - ./config/secrets.yaml      (symlink to ~/.owliabot/secrets.yaml)"
  echo "  - ./workspace/               (workspace)"
  echo ""

  echo "Common commands:"
  echo "  - Start:   docker start owliabot"
  echo "  - Stop:    docker stop owliabot"
  echo "  - Restart: docker restart owliabot"
  echo "  - Logs:    docker logs -f owliabot"
  echo ""

  echo "Gateway HTTP:"
  echo "  - URL:   http://localhost:${GATEWAY_PORT}"
  echo "  - Token: ${GATEWAY_TOKEN:0:8}..."
  echo ""

  success "All set."
}

main "$@"
