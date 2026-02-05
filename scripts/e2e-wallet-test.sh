#!/usr/bin/env bash
#
# E2E Test Script for OwliaBot Clawlet Integration
#
# Prerequisites:
# - Clawlet binary built (target/release/clawlet)
# - Anvil installed (from Foundry)
# - Node.js / pnpm
#
# Usage:
#   ./scripts/e2e-wallet-test.sh
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OWLIABOT_DIR="$(dirname "$SCRIPT_DIR")"
CLAWLET_DIR="${CLAWLET_DIR:-$OWLIABOT_DIR/../clawlet}"
CLAWLET_BIN="${CLAWLET_BIN:-$CLAWLET_DIR/target/release/clawlet}"

# Test environment
TEST_DIR=$(mktemp -d)
SOCKET_PATH="$TEST_DIR/clawlet.sock"
CONFIG_PATH="$TEST_DIR/config.yaml"
KEYSTORE_PATH="$TEST_DIR/keystore"
POLICY_PATH="$TEST_DIR/policy.yaml"
ANVIL_PORT=8546
ANVIL_PID=""
CLAWLET_PID=""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() { echo -e "${GREEN}[INFO]${NC} $*"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*"; }

cleanup() {
    log_info "Cleaning up..."
    
    if [[ -n "$CLAWLET_PID" ]] && kill -0 "$CLAWLET_PID" 2>/dev/null; then
        log_info "Stopping Clawlet (PID: $CLAWLET_PID)"
        kill "$CLAWLET_PID" 2>/dev/null || true
        wait "$CLAWLET_PID" 2>/dev/null || true
    fi
    
    if [[ -n "$ANVIL_PID" ]] && kill -0 "$ANVIL_PID" 2>/dev/null; then
        log_info "Stopping Anvil (PID: $ANVIL_PID)"
        kill "$ANVIL_PID" 2>/dev/null || true
        wait "$ANVIL_PID" 2>/dev/null || true
    fi
    
    if [[ -d "$TEST_DIR" ]]; then
        log_info "Removing test directory: $TEST_DIR"
        rm -rf "$TEST_DIR"
    fi
}

trap cleanup EXIT

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."
    
    if [[ ! -x "$CLAWLET_BIN" ]]; then
        log_error "Clawlet binary not found: $CLAWLET_BIN"
        log_error "Build it with: cd $CLAWLET_DIR && cargo build --release -p clawlet-cli"
        exit 1
    fi
    
    if ! command -v anvil &>/dev/null; then
        log_error "Anvil not found. Install Foundry: https://getfoundry.sh"
        exit 1
    fi
    
    if ! command -v node &>/dev/null; then
        log_error "Node.js not found"
        exit 1
    fi
    
    log_info "All prerequisites met"
}

# Create test configuration
setup_test_config() {
    log_info "Setting up test configuration..."
    
    mkdir -p "$KEYSTORE_PATH"
    
    # Create Clawlet config
    cat > "$CONFIG_PATH" << EOF
# Test configuration for E2E tests
rpc_bind: "127.0.0.1:9100"
keystore_path: "$KEYSTORE_PATH"
policy_path: "$POLICY_PATH"
audit_path: "$TEST_DIR/audit.jsonl"
skills_path: "$TEST_DIR/skills"

chain_rpc_urls:
  # Anvil local testnet
  31337: "http://127.0.0.1:$ANVIL_PORT"

# Auth tokens for testing
auth:
  admin_password_hash: "test-admin-password"
  tokens:
    - id: "test-agent"
      token: "test-token-12345"
      scope: "trade"
EOF

    # Create permissive policy for testing
    cat > "$POLICY_PATH" << EOF
# Test policy - permissive for E2E tests
version: 1

limits:
  daily_usd: 10000
  per_tx_usd: 1000

allowed_tokens:
  - ETH

allowed_chains:
  - 31337  # Anvil
EOF

    mkdir -p "$TEST_DIR/skills"
    
    log_info "Config created at: $CONFIG_PATH"
}

# Initialize Clawlet keystore with a test key
init_keystore() {
    log_info "Initializing test keystore..."
    
    # Anvil's first default private key
    # Address: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
    # Private key: 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
    local ANVIL_PRIVATE_KEY="ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
    local TEST_PASSWORD="test-password"
    
    # Create a simple V3 keystore file manually or use clawlet init
    # For simplicity, we'll create a keystore using clawlet init with a known seed
    
    # Actually, let's use expect or provide password via stdin
    echo "$TEST_PASSWORD" | "$CLAWLET_BIN" init --config "$CONFIG_PATH" --import-key "$ANVIL_PRIVATE_KEY" 2>/dev/null || {
        # If import-key doesn't exist, try manual creation
        log_warn "clawlet init --import-key not available, creating keystore manually..."
        
        # Create a minimal keystore file (this is a simplified version)
        # In production, use proper V3 keystore format
        cat > "$KEYSTORE_PATH/test-key.json" << 'KEYSTORE_EOF'
{
  "address": "f39fd6e51aad88f6f4ce6ab8827279cfffb92266",
  "crypto": {
    "cipher": "aes-128-ctr",
    "cipherparams": {"iv": "6087dab2f9fdbbfaddc31a909735c1e6"},
    "ciphertext": "5318b4d5bcd28de64ee5559e671353e16f075ecae9f99c7a79a38af5f869aa46",
    "kdf": "scrypt",
    "kdfparams": {
      "dklen": 32,
      "n": 8192,
      "p": 1,
      "r": 8,
      "salt": "ae3cd4e7013836a3df6bd7241b12db061dbe2c6785853cce422d148a624ce0bd"
    },
    "mac": "517ead924a9d0dc3124507e3393d175ce3ff7c1e96529c6c555ce9e51205e9b2"
  },
  "id": "e13b209c-3b2f-4327-bab0-3bef2e51630d",
  "version": 3
}
KEYSTORE_EOF
    }
    
    log_info "Keystore initialized"
}

# Start Anvil
start_anvil() {
    log_info "Starting Anvil on port $ANVIL_PORT..."
    
    anvil --port "$ANVIL_PORT" --silent &
    ANVIL_PID=$!
    
    # Wait for Anvil to be ready
    for i in {1..10}; do
        if curl -s "http://127.0.0.1:$ANVIL_PORT" -X POST -H "Content-Type: application/json" \
            --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' &>/dev/null; then
            log_info "Anvil started (PID: $ANVIL_PID)"
            return 0
        fi
        sleep 0.5
    done
    
    log_error "Failed to start Anvil"
    exit 1
}

# Start Clawlet
start_clawlet() {
    log_info "Starting Clawlet with Unix socket at $SOCKET_PATH..."
    
    # Start Clawlet with socket mode
    # Note: This requires the keystore password
    echo "test-password" | "$CLAWLET_BIN" serve --config "$CONFIG_PATH" --socket "$SOCKET_PATH" &
    CLAWLET_PID=$!
    
    # Wait for socket to be created
    for i in {1..20}; do
        if [[ -S "$SOCKET_PATH" ]]; then
            log_info "Clawlet started (PID: $CLAWLET_PID), socket: $SOCKET_PATH"
            return 0
        fi
        sleep 0.5
    done
    
    log_error "Failed to start Clawlet (socket not created)"
    if [[ -n "$CLAWLET_PID" ]]; then
        kill "$CLAWLET_PID" 2>/dev/null || true
    fi
    exit 1
}

# Run integration tests
run_tests() {
    log_info "Running OwliaBot integration tests..."
    
    cd "$OWLIABOT_DIR"
    
    # Set environment variables for tests
    export CLAWLET_SOCKET_PATH="$SOCKET_PATH"
    export CLAWLET_AUTH_TOKEN="test-token-12345"
    export CLAWLET_TEST_ADDRESS="0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
    export CLAWLET_TEST_CHAIN_ID="31337"
    
    # Run integration tests
    if pnpm test:e2e:wallet 2>&1; then
        log_info "Integration tests PASSED ✅"
        return 0
    else
        log_error "Integration tests FAILED ❌"
        return 1
    fi
}

# Main
main() {
    log_info "=== OwliaBot Clawlet E2E Test ==="
    log_info "Test directory: $TEST_DIR"
    
    check_prerequisites
    setup_test_config
    init_keystore
    start_anvil
    start_clawlet
    run_tests
    
    log_info "=== E2E Test Complete ==="
}

main "$@"
