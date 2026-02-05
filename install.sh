#!/bin/bash
#
# OwliaBot Docker 安装脚本
# 交互式配置并启动 Bot
#

set -e

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
info() { echo -e "${BLUE}ℹ${NC} $1"; }
success() { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }
error() { echo -e "${RED}✗${NC} $1"; }

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
    local default=$3
    local is_secret=${4:-false}
    
    if [ -n "$default" ]; then
        prompt_text="$prompt_text [$default]"
    fi
    
    if [ "$is_secret" = true ]; then
        read -sp "$prompt_text: " value
        echo ""
    else
        read -p "$prompt_text: " value
    fi
    
    if [ -z "$value" ] && [ -n "$default" ]; then
        value="$default"
    fi
    
    eval "$var_name='$value'"
}

prompt_yn() {
    local prompt_text=$1
    local default=${2:-n}
    
    if [ "$default" = "y" ]; then
        read -p "$prompt_text [Y/n]: " yn
        yn=${yn:-y}
    else
        read -p "$prompt_text [y/N]: " yn
        yn=${yn:-n}
    fi
    
    [[ "$yn" =~ ^[Yy]$ ]]
}

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
        read -p "请选择 [1-${#options[@]}]: " selection
        if [[ "$selection" =~ ^[0-9]+$ ]] && [ "$selection" -ge 1 ] && [ "$selection" -le "${#options[@]}" ]; then
            return $((selection-1))
        fi
        warn "请输入 1-${#options[@]} 之间的数字"
    done
}

# Check requirements
check_requirements() {
    header "检查环境"
    
    local missing=()
    
    if ! command -v docker &> /dev/null; then
        missing+=("docker")
    else
        success "Docker 已安装"
    fi
    
    if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
        missing+=("docker-compose")
    else
        success "Docker Compose 已安装"
    fi
    
    if [ ${#missing[@]} -gt 0 ]; then
        error "缺少依赖: ${missing[*]}"
        echo ""
        echo "请先安装 Docker："
        echo "  https://docs.docker.com/get-docker/"
        exit 1
    fi
    
    # Check if docker daemon is running
    if ! docker info &> /dev/null; then
        error "Docker 服务未运行，请先启动 Docker"
        exit 1
    fi
    success "Docker 服务运行中"
}

# Main installation
main() {
    clear
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
    echo "  欢迎使用 OwliaBot Docker 安装向导"
    echo ""
    
    check_requirements
    
    # Create directories
    mkdir -p config workspace
    
    # =========================================================================
    # AI Provider
    # =========================================================================
    header "配置 AI 服务"
    
    select_option "选择 AI 服务提供商：" "Anthropic (Claude)" "OpenAI (GPT)" "两者都配置"
    local ai_choice=$?
    
    ANTHROPIC_API_KEY=""
    OPENAI_API_KEY=""
    DEFAULT_PROVIDER=""
    
    if [ $ai_choice -eq 0 ] || [ $ai_choice -eq 2 ]; then
        echo ""
        info "Anthropic API Key 获取地址: https://console.anthropic.com/settings/keys"
        prompt ANTHROPIC_API_KEY "请输入 Anthropic API Key" "" true
        if [ -z "$ANTHROPIC_API_KEY" ]; then
            warn "未配置 Anthropic API Key"
        else
            success "Anthropic API Key 已配置"
            DEFAULT_PROVIDER="anthropic"
        fi
    fi
    
    if [ $ai_choice -eq 1 ] || [ $ai_choice -eq 2 ]; then
        echo ""
        info "OpenAI API Key 获取地址: https://platform.openai.com/api-keys"
        prompt OPENAI_API_KEY "请输入 OpenAI API Key" "" true
        if [ -z "$OPENAI_API_KEY" ]; then
            warn "未配置 OpenAI API Key"
        else
            success "OpenAI API Key 已配置"
            [ -z "$DEFAULT_PROVIDER" ] && DEFAULT_PROVIDER="openai"
        fi
    fi
    
    if [ -z "$ANTHROPIC_API_KEY" ] && [ -z "$OPENAI_API_KEY" ]; then
        error "至少需要配置一个 AI 服务提供商"
        exit 1
    fi
    
    # =========================================================================
    # Chat Platform
    # =========================================================================
    header "配置聊天平台"
    
    select_option "选择聊天平台：" "Discord" "Telegram" "两者都配置"
    local chat_choice=$?
    
    DISCORD_BOT_TOKEN=""
    TELEGRAM_BOT_TOKEN=""
    
    if [ $chat_choice -eq 0 ] || [ $chat_choice -eq 2 ]; then
        echo ""
        info "Discord Bot Token 获取地址: https://discord.com/developers/applications"
        info "创建 Bot 后，在 Bot 页面点击 'Reset Token' 获取"
        prompt DISCORD_BOT_TOKEN "请输入 Discord Bot Token" "" true
        if [ -z "$DISCORD_BOT_TOKEN" ]; then
            warn "未配置 Discord Bot Token"
        else
            success "Discord Bot Token 已配置"
        fi
    fi
    
    if [ $chat_choice -eq 1 ] || [ $chat_choice -eq 2 ]; then
        echo ""
        info "Telegram Bot Token 获取地址: 与 @BotFather 对话，使用 /newbot 创建"
        prompt TELEGRAM_BOT_TOKEN "请输入 Telegram Bot Token" "" true
        if [ -z "$TELEGRAM_BOT_TOKEN" ]; then
            warn "未配置 Telegram Bot Token"
        else
            success "Telegram Bot Token 已配置"
        fi
    fi
    
    if [ -z "$DISCORD_BOT_TOKEN" ] && [ -z "$TELEGRAM_BOT_TOKEN" ]; then
        error "至少需要配置一个聊天平台"
        exit 1
    fi
    
    # =========================================================================
    # Gateway HTTP
    # =========================================================================
    header "配置 Gateway HTTP"
    
    info "Gateway HTTP 用于健康检查和 API 访问"
    
    GATEWAY_PORT="8787"
    prompt GATEWAY_PORT "Gateway 端口" "8787"
    
    # Generate a random token if not provided
    GATEWAY_TOKEN=$(openssl rand -hex 16 2>/dev/null || head -c 32 /dev/urandom | xxd -p | tr -d '\n' | head -c 32)
    echo ""
    info "已生成随机 Gateway Token（可自定义）"
    prompt GATEWAY_TOKEN "Gateway Token" "$GATEWAY_TOKEN" true
    success "Gateway Token 已配置"
    
    # =========================================================================
    # Optional: Timezone
    # =========================================================================
    header "其他配置"
    
    TZ="UTC"
    prompt TZ "时区" "Asia/Shanghai"
    success "时区设置为 $TZ"
    
    # =========================================================================
    # Generate secrets file (~/.owliabot/secrets.yaml)
    # =========================================================================
    header "生成配置文件"
    
    # Secrets directory (shared between Docker and CLI)
    OWLIABOT_HOME="${HOME}/.owliabot"
    mkdir -p "${OWLIABOT_HOME}"
    
    cat > "${OWLIABOT_HOME}/secrets.yaml" << EOF
# OwliaBot Secrets
# 由 install.sh 生成于 $(date)
# 此文件包含敏感信息，请勿提交到 Git

# AI 服务 API Key
anthropic:
  apiKey: "${ANTHROPIC_API_KEY}"

openai:
  apiKey: "${OPENAI_API_KEY}"

# 聊天平台 Token
discord:
  token: "${DISCORD_BOT_TOKEN}"

telegram:
  token: "${TELEGRAM_BOT_TOKEN}"

# Gateway HTTP Token
gateway:
  token: "${GATEWAY_TOKEN}"
EOF
    
    chmod 600 "${OWLIABOT_HOME}/secrets.yaml"
    success "已生成 ~/.owliabot/secrets.yaml（权限 600）"
    
    # =========================================================================
    # Generate config/app.yaml
    # =========================================================================
    
    # =========================================================================
    # Generate config/app.yaml (references secrets from ~/.owliabot)
    # =========================================================================
    
    cat > config/app.yaml << EOF
# OwliaBot 配置文件
# 由 install.sh 生成于 $(date)
#
# Secrets 存储在 ~/.owliabot/secrets.yaml
# Docker 和 CLI 启动都会读取同一份 secrets

# Secrets 文件路径（Docker 内映射到 /home/owliabot/.owliabot）
secretsPath: /home/owliabot/.owliabot/secrets.yaml

# AI 提供商配置
providers:
EOF

    if [ -n "$ANTHROPIC_API_KEY" ]; then
        cat >> config/app.yaml << EOF
  - id: anthropic
    model: claude-sonnet-4-5
    # apiKey 从 secretsPath 读取
    priority: 1
EOF
    fi
    
    if [ -n "$OPENAI_API_KEY" ]; then
        local priority=1
        [ -n "$ANTHROPIC_API_KEY" ] && priority=2
        cat >> config/app.yaml << EOF
  - id: openai
    model: gpt-4o
    # apiKey 从 secretsPath 读取
    priority: $priority
EOF
    fi
    
    cat >> config/app.yaml << EOF

# 聊天平台配置（token 从 secretsPath 读取）
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

# Gateway HTTP 配置
gateway:
  http:
    host: 0.0.0.0
    port: ${GATEWAY_PORT}
    # token 从 secretsPath 读取

# 工作区路径
workspace: /app/workspace

# 时区
timezone: ${TZ}
EOF

    success "已生成 config/app.yaml"
    
    # =========================================================================
    # Pull and start
    # =========================================================================
    header "拉取并启动"
    
    if prompt_yn "是否立即启动 OwliaBot？" "y"; then
        info "正在拉取镜像 ${OWLIABOT_IMAGE}..."
        if docker pull "${OWLIABOT_IMAGE}"; then
            success "镜像拉取完成"
        else
            warn "拉取失败，尝试本地构建..."
            if docker build -t owliabot:local .; then
                OWLIABOT_IMAGE="owliabot:local"
                success "本地构建完成"
            else
                error "构建失败"
                exit 1
            fi
        fi
        
        echo ""
        info "正在启动..."
        
        # Stop existing container if running
        docker rm -f owliabot 2>/dev/null || true
        
        # Start container
        # Mount:
        #   - ~/.owliabot -> /home/owliabot/.owliabot (secrets, 与 CLI 共享)
        #   - ./config    -> /app/config (配置文件)
        #   - ./workspace -> /app/workspace (工作区)
        if docker run -d \
            --name owliabot \
            --restart unless-stopped \
            -p "${GATEWAY_PORT}:${GATEWAY_PORT}" \
            -v "${OWLIABOT_HOME}:/home/owliabot/.owliabot:ro" \
            -v "$(pwd)/config:/app/config:ro" \
            -v "$(pwd)/workspace:/app/workspace" \
            -e "TZ=${TZ}" \
            "${OWLIABOT_IMAGE}" \
            start -c /app/config/app.yaml; then
            success "OwliaBot 已启动"
        else
            error "启动失败"
            exit 1
        fi
        
        echo ""
        info "等待服务就绪..."
        sleep 3
        
        # Check health
        if docker ps | grep -q owliabot; then
            success "容器运行中"
            echo ""
            info "查看日志: docker logs -f owliabot"
        else
            warn "容器可能未正常启动，请检查日志: docker logs owliabot"
        fi
    fi
    
    # =========================================================================
    # Summary
    # =========================================================================
    header "安装完成 🎉"
    
    echo "配置文件位置："
    echo "  • ~/.owliabot/secrets.yaml - API Key 和 Token（敏感信息）"
    echo "  • ./config/app.yaml        - 主配置文件"
    echo "  • ./workspace/             - 工作区数据"
    echo ""
    echo "Docker 和 CLI 共享同一份 secrets，切换启动方式无需重新配置。"
    echo ""
    echo "常用命令："
    echo "  • 启动:  docker start owliabot"
    echo "  • 停止:  docker stop owliabot"
    echo "  • 重启:  docker restart owliabot"
    echo "  • 日志:  docker logs -f owliabot"
    echo "  • 状态:  docker ps | grep owliabot"
    echo ""
    
    if [ -n "$GATEWAY_TOKEN" ]; then
        echo "Gateway HTTP:"
        echo "  • 地址:  http://localhost:${GATEWAY_PORT}"
        echo "  • Token: ${GATEWAY_TOKEN:0:8}..."
        echo ""
    fi
    
    echo -e "${GREEN}感谢使用 OwliaBot！${NC}"
    echo ""
}

# Run
main "$@"
