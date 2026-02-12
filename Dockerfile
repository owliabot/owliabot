# OwliaBot Dockerfile
# Multi-stage build with optional Chromium support
#
# Lite (no browser, ~260MB):
#   docker build -t owliabot .
#   docker build --target lite -t owliabot:lite .
#
# Full (with Chromium for Playwright MCP, ~1GB):
#   docker build --target full -t owliabot:full .
#
# Run:
#   docker run -v ./config:/app/config owliabot

# ==============================================================================
# Stage 1: Build
# Compile TypeScript and install all dependencies (including devDependencies)
# ==============================================================================
FROM node:22-alpine AS builder

# Install build dependencies for native modules (better-sqlite3)
# python3 + make + g++ are required for node-gyp
# Alpine uses musl libc — better-sqlite3 prebuilds may not exist, so we
# compile from source (handled automatically by node-gyp with these tools).
RUN apk add --no-cache python3 make g++

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

# Trim node_modules: remove @types (not needed at runtime), source maps, and docs
RUN rm -rf node_modules/@types \
    && find node_modules -name '*.d.ts' -delete \
    && find node_modules -name '*.map' -delete \
    && find node_modules -name '*.md' ! -name 'README.md' -delete \
    && find node_modules -name 'CHANGELOG*' -delete \
    && find node_modules -name 'LICENSE*' -delete

# ==============================================================================
# Stage 2a: Lite production image (no Chromium)
# Minimal image for deployments that don't need browser automation (~260MB)
# ==============================================================================
FROM node:22-alpine AS lite

# Install minimal runtime dependencies
RUN apk add --no-cache ca-certificates coreutils wget

# Create non-root user for security
# Using numeric UID/GID for Kubernetes compatibility
RUN addgroup -g 1001 owliabot && \
    adduser -u 1001 -G owliabot -D owliabot

WORKDIR /app

# Copy built artifacts from builder stage
# Use --chown to avoid a separate chown layer (saves ~100MB of duplicated data)
COPY --from=builder --chown=owliabot:owliabot /app/dist ./dist
COPY --from=builder --chown=owliabot:owliabot /app/node_modules ./node_modules
COPY --from=builder --chown=owliabot:owliabot /app/package.json ./

# Copy persona + bundled skills (needed for workspace initialization and runtime)
COPY --chown=owliabot:owliabot persona/ ./persona/
COPY --chown=owliabot:owliabot skills/ ./skills/

# Copy config example for reference (users should mount their own config)
COPY --chown=owliabot:owliabot config.example.yaml ./config.example.yaml

# Create directories for config and workspace with proper ownership
RUN mkdir -p /app/config /app/workspace /home/owliabot/.owliabot && \
    chown -R owliabot:owliabot /app/config /app/workspace /home/owliabot

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

# Health check
# Note: Alpine uses BusyBox wget which doesn't support --no-verbose; use -q instead
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget -q --tries=1 --spider http://localhost:8787/health || exit 1

# Skip Playwright browser download (no Chromium in lite image)
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Default config path - can be overridden via -c flag or volume mount
ENV OWLIABOT_CONFIG_PATH=/home/owliabot/.owliabot/app.yaml

ENTRYPOINT ["node", "dist/entry.js"]
CMD ["start", "-c", "/home/owliabot/.owliabot/app.yaml"]

# ==============================================================================
# Stage 2b: Full production image (with Chromium)
# Includes Chromium for browser automation via Playwright MCP (~1GB)
# ==============================================================================
FROM lite AS full

USER root

# Install Chromium and its dependencies for Playwright MCP
# Using system Chromium avoids Playwright's own download (~400MB) and works in containers.
RUN apk add --no-cache \
    chromium \
    font-liberation \
    font-noto-emoji \
    mesa-gbm \
    nss \
    libatk-bridge-2.0 \
    libdrm \
    libxkbcommon \
    libxcomposite \
    libxdamage \
    libxrandr \
    at-spi2-core

USER owliabot

# Playwright MCP: use system Chromium, disable sandbox (container)
# Note: Alpine's Chromium binary is at /usr/bin/chromium-browser (not /usr/bin/chromium)
ENV OWLIABOT_PLAYWRIGHT_CHROMIUM_PATH=/usr/bin/chromium-browser
ENV PLAYWRIGHT_MCP_NO_SANDBOX=1
