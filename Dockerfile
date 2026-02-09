# OwliaBot Dockerfile
# Multi-stage build for minimal production image
#
# Build: docker build -t owliabot .
# Run:   docker run -v ./config:/app/config owliabot

# ==============================================================================
# Stage 1: Build
# Compile TypeScript and install all dependencies (including devDependencies)
# ==============================================================================
FROM node:22-alpine AS builder

# Install build dependencies for native modules (better-sqlite3)
# python3 + make + g++ are required for node-gyp
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

# ==============================================================================
# Stage 2: Production
# Minimal image with only runtime dependencies
# ==============================================================================
FROM node:22-alpine AS production

# Install runtime dependencies for native modules
# libc6-compat helps with some native bindings on Alpine
RUN apk add --no-cache libc6-compat coreutils

# Create non-root user for security
# Using numeric UID/GID for Kubernetes compatibility
RUN addgroup -g 1001 -S owliabot && \
    adduser -u 1001 -S owliabot -G owliabot

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

# Expose gateway HTTP port (configurable, default 8787)
EXPOSE 8787

# Health check - assumes gateway HTTP is enabled on default port
# Adjust interval based on your needs
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8787/health || exit 1

# Default config path - can be overridden via -c flag or volume mount
ENV OWLIABOT_CONFIG_PATH=/app/config/app.yaml

# Entry point: start the bot
# Users can override command to run other CLI commands (onboard, auth, etc.)
ENTRYPOINT ["node", "dist/entry.js"]
CMD ["start", "-c", "/app/config/app.yaml"]
