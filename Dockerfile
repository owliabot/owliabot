# OwliaBot Dockerfile
# Multi-stage build for minimal production image
#
# Build: docker build -t owliabot .
# Run:   docker run -v ./config:/app/config owliabot

# ==============================================================================
# Stage 1: Build
# Compile TypeScript and install all dependencies (including devDependencies)
# ==============================================================================
FROM node:22-slim AS builder

# Install build dependencies for native modules (better-sqlite3)
# python3 + make + g++ are required for node-gyp
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files first for better layer caching
COPY package.json package-lock.json ./

# Install all dependencies (including devDependencies for building)
RUN npm ci

# Copy source code
COPY tsconfig.json ./
COPY src/ ./src/

# Build TypeScript to JavaScript
RUN npm run build

# Prune dev dependencies after build
RUN npm prune --production

# ==============================================================================
# Stage 2: Production
# Minimal image with only runtime dependencies
# ==============================================================================
FROM node:22-slim AS production

# Install runtime dependencies + Chromium for Playwright MCP
# Chromium and its dependencies are needed for browser automation via @playwright/mcp.
# Using system Chromium avoids Playwright's own download (~400MB) and works in containers.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    coreutils \
    wget \
    chromium \
    fonts-liberation \
    fonts-noto-color-emoji \
    libgbm1 \
    libnss3 \
    libatk-bridge2.0-0 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libatspi2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user for security
# Using numeric UID/GID for Kubernetes compatibility
RUN groupadd -g 1001 owliabot && \
    useradd -u 1001 -g owliabot -m owliabot

WORKDIR /app

# Copy built artifacts from builder stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# Copy persona + bundled skills (needed for workspace initialization and runtime)
COPY persona/ ./persona/
COPY skills/ ./skills/

# Copy config example for reference (users should mount their own config)
COPY config.example.yaml ./config.example.yaml

# Create directories for config and workspace with proper ownership
RUN mkdir -p /app/config /app/workspace /home/owliabot/.owliabot && \
    chown -R owliabot:owliabot /app /home/owliabot

# Add owliabot CLI wrapper so users can run:
#   docker exec -it owliabot owliabot auth setup
# instead of:
#   docker exec -it owliabot node dist/entry.js auth setup
RUN printf '#!/bin/sh\nexec node /app/dist/entry.js "$@"\n' > /usr/local/bin/owliabot && \
    chmod +x /usr/local/bin/owliabot

# Switch to non-root user
USER owliabot

# Set HOME for the non-root user (needed for ~/.owliabot and ~/.owlia_dev)
ENV HOME=/home/owliabot
ENV OWLIABOT_HOME=/home/owliabot/.owliabot

# Expose gateway HTTP port (configurable, default 8787)
EXPOSE 8787

# Health check - assumes gateway HTTP is enabled on default port
# Adjust interval based on your needs
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8787/health || exit 1

# Default config path - can be overridden via -c flag or volume mount
# Playwright MCP: use system Chromium, skip download, disable sandbox (container)
ENV OWLIABOT_PLAYWRIGHT_CHROMIUM_PATH=/usr/bin/chromium
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PLAYWRIGHT_MCP_NO_SANDBOX=1

ENV OWLIABOT_CONFIG_PATH=/home/owliabot/.owliabot/app.yaml

# Entry point: start the bot
# Users can override command to run other CLI commands (onboard, auth, etc.)
ENTRYPOINT ["node", "dist/entry.js"]
CMD ["start", "-c", "/home/owliabot/.owliabot/app.yaml"]
