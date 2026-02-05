# OwliaBot Docker 部署指南

本文档介绍如何使用 Docker 部署 OwliaBot。

## 目录

- [环境要求](#环境要求)
- [快速开始](#快速开始)
- [配置说明](#配置说明)
- [数据卷挂载](#数据卷挂载)
- [构建自定义镜像](#构建自定义镜像)
- [生产环境建议](#生产环境建议)
- [常见问题](#常见问题)

## 环境要求

- Docker 20.10+
- Docker Compose v2.0+（可选，推荐使用）
- 至少 512MB 可用内存

## 快速开始

### 方式一：一键安装脚本（推荐）

最简单的方式，运行安装脚本，按提示操作即可：

```bash
git clone https://github.com/owliabot/owliabot.git
cd owliabot
./install.sh
```

脚本会引导你：
1. 选择 AI 服务提供商（Anthropic / OpenAI）
2. 选择聊天平台（Discord / Telegram）
3. 输入 API Key 和 Bot Token
4. 自动拉取预构建镜像并启动

**无需本地构建**，镜像从 GitHub Container Registry 拉取：
```
ghcr.io/owliabot/owliabot:latest
```

### 方式二：交互式 Onboarding

通过向导式配置生成 `app.yaml`，无需手动编辑配置文件。

1. **克隆仓库并构建镜像**

```bash
git clone https://github.com/owliabot/owliabot.git
cd owliabot
docker-compose build
```

2. **设置环境变量**

创建 `.env` 文件：

```bash
# AI 服务 API 密钥（至少配置一个）
ANTHROPIC_API_KEY=sk-ant-xxx
OPENAI_API_KEY=sk-xxx

# 聊天平台 Token（至少配置一个）
DISCORD_BOT_TOKEN=xxx
TELEGRAM_BOT_TOKEN=xxx

# Gateway HTTP Token（用于 API 认证）
GATEWAY_TOKEN=your-secure-token

# 可选：时区设置
TZ=Asia/Shanghai
```

3. **运行交互式 Onboarding**

```bash
# 创建配置目录
mkdir -p owlia_dev workspace

# 运行 onboard 向导（交互式）
docker run -it --rm \
  -v $(pwd)/owlia_dev:/home/owliabot/.owlia_dev \
  -v $(pwd)/workspace:/app/workspace \
  --env-file .env \
  owliabot:latest onboard
```

向导会引导你配置 AI 提供商、聊天平台等，生成的配置保存在 `./owlia_dev/app.yaml`。

4. **启动 Bot**

```bash
# 使用 onboard 生成的配置启动
docker run -d \
  --name owliabot \
  --restart unless-stopped \
  -p 8787:8787 \
  -v $(pwd)/owlia_dev:/home/owliabot/.owlia_dev:ro \
  -v $(pwd)/workspace:/app/workspace \
  --env-file .env \
  owliabot:latest start -c /home/owliabot/.owlia_dev/app.yaml
```

5. **查看日志**

```bash
docker logs -f owliabot
```

### 方式三：手动配置（熟悉配置的用户）

1. **克隆仓库并进入目录**

```bash
git clone https://github.com/owliabot/owliabot.git
cd owliabot
```

2. **准备配置文件**

```bash
# 创建配置目录
mkdir -p config workspace

# 复制示例配置
cp config.example.yaml config/app.yaml

# 编辑配置文件
nano config/app.yaml
```

3. **设置环境变量**

创建 `.env` 文件：

```bash
# AI 服务 API 密钥（至少配置一个）
ANTHROPIC_API_KEY=sk-ant-xxx
OPENAI_API_KEY=sk-xxx

# 聊天平台 Token（至少配置一个）
DISCORD_BOT_TOKEN=xxx
TELEGRAM_BOT_TOKEN=xxx

# Gateway HTTP Token（用于 API 认证）
GATEWAY_TOKEN=your-secure-token

# 可选：时区设置
TZ=Asia/Shanghai
```

4. **启动服务**

```bash
docker-compose up -d
```

5. **查看日志**

```bash
docker-compose logs -f
```

### 方式四：使用 Docker Run

1. **构建镜像**

```bash
docker build -t owliabot .
```

2. **运行容器**

```bash
docker run -d \
  --name owliabot \
  --restart unless-stopped \
  -p 8787:8787 \
  -v $(pwd)/config:/app/config:ro \
  -v $(pwd)/workspace:/app/workspace \
  -e ANTHROPIC_API_KEY=sk-ant-xxx \
  -e DISCORD_BOT_TOKEN=xxx \
  -e GATEWAY_TOKEN=your-secure-token \
  owliabot
```

## 配置说明

OwliaBot 支持两种配置方式：

### 1. 配置文件方式

将配置写入 `config/app.yaml`，通过卷挂载到容器内。

配置文件结构示例：

```yaml
# AI 提供商配置
providers:
  - id: anthropic
    model: claude-sonnet-4-5
    apiKey: ${ANTHROPIC_API_KEY}  # 引用环境变量
    priority: 1

# Telegram 配置
telegram:
  token: ${TELEGRAM_BOT_TOKEN}

# Discord 配置
discord:
  token: ${DISCORD_BOT_TOKEN}

# Gateway HTTP 配置
gateway:
  http:
    host: 0.0.0.0  # Docker 中必须绑定 0.0.0.0
    port: 8787
    token: ${GATEWAY_TOKEN}

# 工作区路径
workspace: /app/workspace
```

**注意**：配置文件中可以使用 `${ENV_VAR}` 语法引用环境变量。

### 2. 环境变量方式

| 环境变量 | 说明 | 必需 |
|---------|------|------|
| `ANTHROPIC_API_KEY` | Anthropic API 密钥 | 否* |
| `OPENAI_API_KEY` | OpenAI API 密钥 | 否* |
| `DISCORD_BOT_TOKEN` | Discord Bot Token | 否** |
| `TELEGRAM_BOT_TOKEN` | Telegram Bot Token | 否** |
| `GATEWAY_TOKEN` | Gateway HTTP 认证 Token | 推荐 |
| `BRAVE_SEARCH_API_KEY` | Brave Search API 密钥 | 否 |
| `TZ` | 时区（如 `Asia/Shanghai`） | 否 |

\* 至少需要配置一个 AI 提供商  
\** 至少需要配置一个聊天平台

## 数据卷挂载

| 容器路径 | 说明 | 挂载模式 |
|---------|------|---------|
| `/app/config` | 配置文件目录（手动配置方式） | 只读 (`:ro`) |
| `/home/owliabot/.owlia_dev` | Onboard 生成的配置 | 只读 (`:ro`) |
| `/app/workspace` | 工作区（记忆、文件等） | 读写 |
| `/home/owliabot/.owliabot` | OAuth 凭据等持久化数据 | 读写 |

### 目录结构示例

**手动配置方式：**
```
owliabot/
├── config/
│   └── app.yaml          # 主配置文件
├── workspace/
│   ├── memory/           # 记忆文件
│   └── gateway.db        # Gateway 数据库
├── docker-compose.yml
├── Dockerfile
└── .env                  # 环境变量（不要提交到 Git！）
```

**Onboard 方式：**
```
owliabot/
├── owlia_dev/
│   ├── app.yaml          # Onboard 生成的配置
│   └── secrets.yaml      # Token 存储（可选）
├── workspace/
│   ├── memory/           # 记忆文件
│   └── gateway.db        # Gateway 数据库
├── docker-compose.yml
├── Dockerfile
└── .env                  # 环境变量（不要提交到 Git！）
```

## 敏感信息存放位置

| 信息类型 | 存储位置 | 说明 |
|---------|---------|------|
| API Key（Anthropic/OpenAI） | `.env` 或 Docker Secrets | **推荐通过环境变量传入** |
| Bot Token（Discord/Telegram） | `.env` 或 Docker Secrets | **推荐通过环境变量传入** |
| Gateway Token | `.env` 或 Docker Secrets | **推荐通过环境变量传入** |
| OAuth 凭据 | `/home/owliabot/.owliabot/` | 挂载 named volume 持久化 |
| Onboard 生成的 secrets | `owlia_dev/secrets.yaml` | `token set` 命令写入 |

**安全提示：**
- `.env` 文件 **不要提交到 Git**（已在 `.gitignore`）
- 生产环境推荐使用 Docker Secrets 或外部密钥管理（Vault 等）
- `secrets.yaml` 和 `.env` 都应设置严格的文件权限（`chmod 600`）

## 构建自定义镜像

### 基础构建

```bash
docker build -t owliabot:latest .
```

### 指定构建参数

```bash
# 使用特定 Node 版本（需要修改 Dockerfile）
docker build --build-arg NODE_VERSION=22.12 -t owliabot:custom .
```

### 多平台构建

```bash
# 为 ARM64 和 AMD64 构建
docker buildx build --platform linux/amd64,linux/arm64 -t owliabot:latest .
```

## 生产环境建议

### 1. 密钥管理

**不推荐**：在 docker-compose.yml 中硬编码密钥

**推荐方案**：

#### 方案 A：使用 .env 文件

```bash
# .env 文件（确保添加到 .gitignore）
ANTHROPIC_API_KEY=sk-ant-xxx
```

#### 方案 B：使用 Docker Secrets（Swarm 模式）

```yaml
# docker-compose.yml
secrets:
  anthropic_key:
    file: ./secrets/anthropic_key.txt

services:
  owliabot:
    secrets:
      - anthropic_key
    environment:
      - ANTHROPIC_API_KEY_FILE=/run/secrets/anthropic_key
```

#### 方案 C：使用外部密钥管理服务

集成 HashiCorp Vault、AWS Secrets Manager 等。

### 2. 健康检查

默认 Dockerfile 已包含健康检查配置：

```dockerfile
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8787/health || exit 1
```

确保在 `app.yaml` 中启用 Gateway HTTP：

```yaml
gateway:
  http:
    host: 0.0.0.0
    port: 8787
```

### 3. 重启策略

```yaml
services:
  owliabot:
    restart: unless-stopped  # 或 always（生产环境推荐）
```

### 4. 资源限制

```yaml
services:
  owliabot:
    deploy:
      resources:
        limits:
          cpus: '1.0'
          memory: 512M
        reservations:
          memory: 256M
```

### 5. 日志管理

```yaml
services:
  owliabot:
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "5"
```

### 6. 网络安全

```yaml
services:
  owliabot:
    # 仅暴露必要端口
    ports:
      - "127.0.0.1:8787:8787"  # 仅本地访问
    # 或使用内部网络
    networks:
      - internal
```

### 7. 备份策略

定期备份以下数据：

```bash
# 备份工作区和配置
tar -czf backup-$(date +%Y%m%d).tar.gz workspace/ config/
```

## 常见问题

### Q: 容器启动失败，提示端口被占用

**A**: 检查 8787 端口是否被其他服务占用：

```bash
lsof -i :8787
# 或修改 docker-compose.yml 中的端口映射
ports:
  - "18787:8787"
```

### Q: 健康检查一直失败

**A**: 确保：
1. 配置文件中启用了 Gateway HTTP
2. `host` 设置为 `0.0.0.0`（不是 `127.0.0.1`）
3. 端口配置正确

### Q: 环境变量不生效

**A**: 检查：
1. `.env` 文件是否在 docker-compose.yml 同级目录
2. 配置文件中是否使用 `${VAR}` 语法引用
3. 运行 `docker-compose config` 查看实际配置

### Q: better-sqlite3 模块加载失败

**A**: 这是原生模块兼容性问题。确保：
1. 使用官方提供的 Dockerfile（已包含必要的构建依赖）
2. 不要直接复制宿主机的 `node_modules`

### Q: 如何查看详细日志？

**A**: 

```bash
# 实时查看日志
docker-compose logs -f owliabot

# 查看最近 100 行
docker-compose logs --tail 100 owliabot
```

### Q: 如何进入容器调试？

**A**:

```bash
docker-compose exec owliabot sh
```

### Q: 如何更新到新版本？

**A**:

```bash
# 拉取最新代码
git pull

# 重新构建并启动
docker-compose build
docker-compose up -d
```

## 相关链接

- [OwliaBot GitHub](https://github.com/owliabot/owliabot)
- [配置文件示例](../config.example.yaml)
- [Docker 官方文档](https://docs.docker.com/)
