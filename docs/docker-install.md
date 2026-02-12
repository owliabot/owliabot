# Docker Installation

OwliaBot can be installed and run using Docker, which is the recommended method for production deployments.

## Quick Start (One-liner)

```bash
curl -sSL https://raw.githubusercontent.com/owliabot/owliabot/main/install.sh | bash
```

This will:
1. Check Docker is installed and running
2. Pull the latest OwliaBot image
3. Run the interactive onboard configuration wizard
4. Generate `docker-compose.yml`
5. Automatically start the container

## Manual Docker Setup

### Prerequisites

- Docker Engine 20.10+ or Docker Desktop
- Docker Compose v2 (recommended) or v1

### Step 1: Pull the image

```bash
docker pull ghcr.io/owliabot/owliabot:latest
```

### Step 2: Run interactive onboard

```bash
mkdir -p ~/.owliabot/auth ~/.owliabot/workspace

docker run --rm -it \
  -v ~/.owliabot:/home/owliabot/.owliabot \
  -v $(pwd):/app/output \
  ghcr.io/owliabot/owliabot:latest \
  onboard --docker --output-dir /app/output
```

Alternative (local Go TUI wizard):

```bash
owliabot onboard
# develop channel:
owliabot onboard --channel preview
```

`owliabot onboard` now prefers a prebuilt onboard binary (downloaded from GitHub Releases)
and no longer requires a local Go toolchain for most users.

The wizard will prompt for:
- AI provider (Anthropic/OpenAI/OpenAI-Codex/OpenAI-compatible)
- Chat platform (Discord/Telegram)
- Timezone (auto-detected; edit `app.yaml` to override)
- (Docker only) Host port to expose Gateway HTTP (default: 8787)

### Step 3: Start with Docker Compose

```bash
docker-compose up -d
```

Or use the Docker run command printed by the onboard wizard.

## Configuration Files

| File | Location | Description |
|------|----------|-------------|
| `app.yaml` | `~/.owliabot/app.yaml` | Main configuration (non-sensitive) |
| `secrets.yaml` | `~/.owliabot/secrets.yaml` | API keys and tokens (chmod 600) |
| `auth/` | `~/.owliabot/auth/` | OAuth tokens (chmod 700) |
| `workspace/` | `~/.owliabot/workspace/` | Agent workspace (persistent) |

## CLI Reference

### `onboard --docker`

Docker-aware interactive configuration.

```bash
owliabot onboard --docker [options]
```

Options:
- `--config-dir <path>` — Config output directory (default: `~/.owliabot`)
- `--output-dir <path>` — Output directory for docker-compose.yml (default: `.`)

### Other Commands in Docker

```bash
# Check auth status
docker run --rm -v ~/.owliabot:/home/owliabot/.owliabot \
  ghcr.io/owliabot/owliabot:latest auth status

# Setup Anthropic OAuth
docker run --rm -it -v ~/.owliabot:/home/owliabot/.owliabot \
  ghcr.io/owliabot/owliabot:latest auth setup anthropic

# Setup OpenAI OAuth (openai-codex)
docker run --rm -it -v ~/.owliabot:/home/owliabot/.owliabot \
  ghcr.io/owliabot/owliabot:latest auth setup openai-codex
```

## OpenAI-Compatible Providers

OwliaBot supports any OpenAI-compatible API server:

- **Ollama**: `http://localhost:11434/v1`
- **vLLM**: `http://localhost:8000/v1`
- **LM Studio**: `http://localhost:1234/v1`
- **LocalAI**: `http://localhost:8080/v1`

When running in Docker, use `host.docker.internal` instead of `localhost` to access host services:

```yaml
providers:
  - id: openai-compatible
    model: llama3.2
    baseUrl: http://host.docker.internal:11434/v1
    apiKey: none
    priority: 1
```

## Troubleshooting

### Docker not found

```
✗ Docker is not installed.
```

Install Docker:
- macOS: `brew install --cask docker` or download from https://docs.docker.com/desktop/mac/install/
- Ubuntu/Debian: `curl -fsSL https://get.docker.com | sudo sh`
- Windows: https://docs.docker.com/desktop/windows/install/

### Docker daemon not running

```
✗ Docker daemon is not running.
```

Start Docker:
- macOS/Windows: Start Docker Desktop application
- Linux: `sudo systemctl start docker`

### Permission denied

If you see permission errors, you may need to add your user to the docker group:

```bash
sudo usermod -aG docker $USER
# Log out and back in for the change to take effect
```

### Container keeps restarting

Check logs:

```bash
docker logs owliabot
```

Common causes:
- Missing or invalid API key
- Missing channel token (Discord/Telegram)
- Invalid config syntax

### Playwright MCP (browser automation)

Chromium is bundled in the Docker image and configured automatically:
- `OWLIABOT_PLAYWRIGHT_CHROMIUM_PATH=/usr/bin/chromium` (pre-set)
- `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` (no extra download needed)
- `PLAYWRIGHT_MCP_NO_SANDBOX=1` (required in containers)

No manual configuration is needed. Playwright MCP will use the bundled Chromium out of the box.

> **Security note:** `--no-sandbox` reduces browser isolation. For production deployments requiring stronger isolation, consider running the browser in a separate container or using CDP connection to an external browser service.
