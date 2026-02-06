# OwliaBot + Clawlet 安装权限设计文档

> **版本**: 1.0  
> **日期**: 2026-02-06  
> **作者**: Lay2 + John Zhang  
> **状态**: Draft

---

## 1. 设计目标

### 1.1 核心原则

1. **私钥隔离**: Clawlet（钱包签名器）运行在独立用户下，私钥文件仅该用户可读
2. **最小权限**: OwliaBot 只能通过 IPC 调用 Clawlet API，无法直接访问密钥
3. **跨平台**: 支持 Linux、macOS、Windows 三大平台
4. **一键安装**: 用户运行单条命令即可完成安全配置

### 1.2 安全边界

```
┌─────────────────────────────────────────────────────────────┐
│                    用户空间 (当前用户)                        │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  OwliaBot (Node.js)                                  │   │
│  │  - 配置文件、会话、workspace                          │   │
│  │  - 可连接 Clawlet IPC                                │   │
│  │  - ❌ 不可读取 Clawlet 密钥                           │   │
│  └──────────────────────┬──────────────────────────────┘   │
│                         │ IPC (socket/pipe)                 │
│  ┌──────────────────────▼──────────────────────────────┐   │
│  │  Clawlet (Rust) - 独立用户                           │   │
│  │  - keystore.json (私钥) → 0600                       │   │
│  │  - policy.yml (策略)                                 │   │
│  │  - audit.jsonl (审计日志)                            │   │
│  │  - ✅ 仅 clawlet 用户可读写                          │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. 平台架构设计

### 2.1 Linux

#### 用户与组

```bash
# 系统用户 (无登录 shell)
clawlet:x:900:900:Clawlet Wallet Signer:/home/clawlet:/usr/sbin/nologin

# 授权组 (允许连接 IPC)
clawlet-users:x:901:john,alice
```

#### 目录结构

```
/home/clawlet/
├── clawlet                    # 二进制 (755 clawlet:clawlet)
└── .clawlet/
    ├── keystore.json          # 私钥 (600 clawlet:clawlet) ⛔
    ├── policy.yml             # 策略 (600 clawlet:clawlet) ⛔
    └── audit.jsonl            # 审计 (600 clawlet:clawlet) ⛔

/run/clawlet/                  # RuntimeDirectory (systemd 管理)
└── clawlet.sock               # IPC socket (660 clawlet:clawlet-users) ✅

~/.owliabot/                   # 当前用户
├── config/
│   └── app.yaml
├── workspace/
└── .owliabot/
```

#### 权限矩阵

| 路径 | 权限 | Owner | 当前用户可访问 |
|------|------|-------|---------------|
| `/home/clawlet/` | 0750 | clawlet:clawlet | ❌ |
| `/home/clawlet/.clawlet/keystore.json` | 0600 | clawlet:clawlet | ❌ |
| `/home/clawlet/.clawlet/policy.yml` | 0600 | clawlet:clawlet | ❌ |
| `/run/clawlet/` | 0750 | clawlet:clawlet-users | ✅ (组成员) |
| `/run/clawlet/clawlet.sock` | 0660 | clawlet:clawlet-users | ✅ (组成员) |

#### systemd Service

```ini
# /etc/systemd/system/clawlet.service
[Unit]
Description=Clawlet Wallet Signer
After=network.target

[Service]
Type=simple
User=clawlet
Group=clawlet
ExecStart=/home/clawlet/clawlet serve --unix /run/clawlet/clawlet.sock
Restart=on-failure
RestartSec=5

# 安全加固
RuntimeDirectory=clawlet
RuntimeDirectoryMode=0750
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=/home/clawlet/.clawlet /run/clawlet
CapabilityBoundingSet=
AmbientCapabilities=
SystemCallFilter=@system-service
SystemCallErrorNumber=EPERM

[Install]
WantedBy=multi-user.target
```

---

### 2.2 macOS

#### 用户与组

```bash
# 创建系统用户 (UID 在 200-400 范围，隐藏用户)
sudo dscl . -create /Users/clawlet
sudo dscl . -create /Users/clawlet UniqueID 399
sudo dscl . -create /Users/clawlet PrimaryGroupID 399
sudo dscl . -create /Users/clawlet UserShell /usr/bin/false
sudo dscl . -create /Users/clawlet NFSHomeDirectory /var/lib/clawlet
sudo dscl . -create /Users/clawlet IsHidden 1

# 创建组
sudo dscl . -create /Groups/clawlet-users
sudo dscl . -create /Groups/clawlet-users PrimaryGroupID 398
sudo dscl . -append /Groups/clawlet-users GroupMembership $(whoami)
```

#### 目录结构

```
/var/lib/clawlet/              # Clawlet home (macOS 惯例)
├── clawlet                    # 二进制
└── .clawlet/
    ├── keystore.json          # 私钥 (600)
    ├── policy.yml             # 策略 (600)
    └── audit.jsonl            # 审计 (600)

/var/run/clawlet/              # Socket 目录
└── clawlet.sock               # IPC socket (660)

~/Library/Application Support/OwliaBot/   # 当前用户
├── config/
├── workspace/
└── .owliabot/
```

#### launchd Service

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.owliabot.clawlet</string>
    
    <key>ProgramArguments</key>
    <array>
        <string>/var/lib/clawlet/clawlet</string>
        <string>serve</string>
        <string>--unix</string>
        <string>/var/run/clawlet/clawlet.sock</string>
    </array>
    
    <key>UserName</key>
    <string>clawlet</string>
    
    <key>GroupName</key>
    <string>clawlet</string>
    
    <key>RunAtLoad</key>
    <true/>
    
    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>
    
    <key>StandardOutPath</key>
    <string>/var/log/clawlet/clawlet.log</string>
    
    <key>StandardErrorPath</key>
    <string>/var/log/clawlet/clawlet.err</string>
    
    <!-- 沙箱 (可选，需要签名) -->
    <!-- <key>SandboxProfile</key>
    <string>/var/lib/clawlet/clawlet.sb</string> -->
</dict>
</plist>
```

---

### 2.3 Windows

#### 用户与组

```powershell
# 创建本地用户 (密码随机，禁止登录)
$password = [System.Web.Security.Membership]::GeneratePassword(32, 8)
$securePassword = ConvertTo-SecureString $password -AsPlainText -Force
New-LocalUser -Name "clawlet" -Password $securePassword -Description "Clawlet Wallet Signer" -AccountNeverExpires -PasswordNeverExpires
Disable-LocalUser -Name "clawlet"  # 禁止交互登录

# 创建授权组
New-LocalGroup -Name "clawlet-users" -Description "Users allowed to connect to Clawlet"
Add-LocalGroupMember -Group "clawlet-users" -Member $env:USERNAME
```

#### 目录结构

```
C:\ProgramData\Clawlet\        # Clawlet 数据目录
├── clawlet.exe                # 二进制
└── .clawlet\
    ├── keystore.json          # 私钥 (ACL: clawlet ONLY)
    ├── policy.yml             # 策略 (ACL: clawlet ONLY)
    └── audit.jsonl            # 审计 (ACL: clawlet ONLY)

\\.\pipe\clawlet               # Named Pipe (ACL: clawlet-users RW)

%APPDATA%\OwliaBot\            # 当前用户
├── config\
├── workspace\
└── .owliabot\
```

#### ACL 配置

```powershell
# 私钥目录 - 仅 clawlet 用户
$acl = Get-Acl "C:\ProgramData\Clawlet\.clawlet"
$acl.SetAccessRuleProtection($true, $false)  # 禁用继承
$acl.Access | ForEach-Object { $acl.RemoveAccessRule($_) }  # 清空
$rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
    "clawlet", "FullControl", "ContainerInherit,ObjectInherit", "None", "Allow")
$acl.AddAccessRule($rule)
Set-Acl "C:\ProgramData\Clawlet\.clawlet" $acl
```

#### Named Pipe ACL (Rust 代码)

```rust
// clawlet/src/ipc/windows.rs
use windows::Win32::Security::*;
use windows::Win32::System::Pipes::*;

pub fn create_secure_pipe() -> Result<NamedPipeServer> {
    // 构建 DACL
    let mut dacl = SecurityDescriptor::new()?;
    
    // 拒绝所有
    dacl.set_dacl_defaulted(true);
    
    // 允许 clawlet 用户完全控制
    dacl.allow_user("clawlet", PIPE_ACCESS_DUPLEX)?;
    
    // 允许 clawlet-users 组读写
    dacl.allow_group("clawlet-users", PIPE_ACCESS_DUPLEX)?;
    
    // 拒绝网络访问
    dacl.deny_network()?;
    
    CreateNamedPipe(
        r"\\.\pipe\clawlet",
        PIPE_ACCESS_DUPLEX,
        PIPE_TYPE_MESSAGE | PIPE_READMODE_MESSAGE | PIPE_REJECT_REMOTE_CLIENTS,
        PIPE_UNLIMITED_INSTANCES,
        65536, 65536,
        0,
        Some(&dacl.to_security_attributes()),
    )
}
```

#### Windows Service

```powershell
# 使用 NSSM 或 sc.exe 创建服务
New-Service -Name "Clawlet" `
    -BinaryPathName "C:\ProgramData\Clawlet\clawlet.exe serve --pipe \\.\pipe\clawlet" `
    -DisplayName "Clawlet Wallet Signer" `
    -Description "Secure wallet signer for OwliaBot" `
    -StartupType Automatic `
    -Credential (New-Object PSCredential(".\clawlet", $securePassword))

# 配置服务恢复选项
sc.exe failure Clawlet reset= 86400 actions= restart/5000/restart/10000/restart/30000
```

---

## 3. IPC 协议

### 3.1 传输层

| 平台 | 传输方式 | 路径/名称 |
|------|----------|-----------|
| Linux | Unix Socket | `/run/clawlet/clawlet.sock` |
| macOS | Unix Socket | `/var/run/clawlet/clawlet.sock` |
| Windows | Named Pipe | `\\.\pipe\clawlet` |

### 3.2 协议格式

JSON-RPC 2.0 over stream:

```json
// Request
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "wallet_getBalance",
  "params": {
    "address": "0x742d35Cc6634C0532925a3b844Bc9e7595f...",
    "chain_id": 8453
  }
}

// Response
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "balance": "1000000000000000000",
    "symbol": "ETH",
    "decimals": 18
  }
}
```

### 3.3 OwliaBot 客户端

```typescript
// src/wallet/clawlet-client.ts
import { connect } from 'net';
import { request } from 'undici';

export class ClawletClient {
  private socketPath: string;
  private pipeName: string;
  
  constructor(config: ClawletConfig) {
    if (process.platform === 'win32') {
      this.pipeName = config.pipe ?? '\\\\.\\pipe\\clawlet';
    } else {
      this.socketPath = config.socket ?? this.defaultSocketPath();
    }
  }
  
  private defaultSocketPath(): string {
    return process.platform === 'darwin'
      ? '/var/run/clawlet/clawlet.sock'
      : '/run/clawlet/clawlet.sock';
  }
  
  async call<T>(method: string, params: unknown): Promise<T> {
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method,
      params,
    });
    
    const response = await request({
      origin: 'http://localhost',
      path: '/',
      method: 'POST',
      socketPath: this.socketPath,  // Unix socket
      // Windows: use net.connect(this.pipeName)
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    
    const result = await response.body.json();
    if (result.error) throw new Error(result.error.message);
    return result.result as T;
  }
  
  async getBalance(address: string, chainId: number) {
    return this.call('wallet_getBalance', { address, chain_id: chainId });
  }
  
  async signTransaction(tx: TransactionRequest) {
    return this.call('wallet_signTransaction', tx);
  }
}
```

---

## 4. 安装脚本

### 4.1 统一入口

```bash
# 一键安装 (自动检测平台)
curl -fsSL https://get.owliabot.dev | bash

# 或指定组件
curl -fsSL https://get.owliabot.dev | bash -s -- --with-clawlet
curl -fsSL https://get.owliabot.dev | bash -s -- --owliabot-only
```

### 4.2 install.sh 主逻辑

```bash
#!/bin/bash
set -euo pipefail

VERSION="${OWLIABOT_VERSION:-latest}"
CLAWLET_VERSION="${CLAWLET_VERSION:-latest}"
INSTALL_CLAWLET="${INSTALL_CLAWLET:-true}"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info() { echo -e "${GREEN}[INFO]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

# 检测平台
detect_platform() {
    case "$(uname -s)" in
        Linux*)  PLATFORM="linux" ;;
        Darwin*) PLATFORM="macos" ;;
        MINGW*|MSYS*|CYGWIN*) PLATFORM="windows" ;;
        *) error "Unsupported platform: $(uname -s)" ;;
    esac
    
    case "$(uname -m)" in
        x86_64|amd64) ARCH="amd64" ;;
        arm64|aarch64) ARCH="arm64" ;;
        *) error "Unsupported architecture: $(uname -m)" ;;
    esac
    
    info "Detected platform: ${PLATFORM}/${ARCH}"
}

# Linux 安装
install_linux() {
    info "Installing for Linux..."
    
    # === Clawlet ===
    if [[ "$INSTALL_CLAWLET" == "true" ]]; then
        info "Creating clawlet user and group..."
        
        # 创建组
        if ! getent group clawlet-users >/dev/null; then
            sudo groupadd --system clawlet-users
        fi
        
        # 创建用户
        if ! id -u clawlet >/dev/null 2>&1; then
            sudo useradd --system \
                --home-dir /home/clawlet \
                --create-home \
                --shell /usr/sbin/nologin \
                --gid clawlet \
                --groups clawlet \
                clawlet
        fi
        
        # 当前用户加入组
        sudo usermod -aG clawlet-users "$USER"
        
        # 下载 clawlet
        info "Downloading clawlet ${CLAWLET_VERSION}..."
        CLAWLET_URL="https://github.com/owliabot/clawlet/releases/download/${CLAWLET_VERSION}/clawlet-linux-${ARCH}"
        sudo curl -fsSL "$CLAWLET_URL" -o /home/clawlet/clawlet
        sudo chmod 755 /home/clawlet/clawlet
        sudo chown clawlet:clawlet /home/clawlet/clawlet
        
        # 创建数据目录
        sudo -u clawlet mkdir -p /home/clawlet/.clawlet
        sudo chmod 700 /home/clawlet/.clawlet
        
        # 安装 systemd service
        info "Installing systemd service..."
        sudo tee /etc/systemd/system/clawlet.service > /dev/null << 'EOF'
[Unit]
Description=Clawlet Wallet Signer
After=network.target

[Service]
Type=simple
User=clawlet
Group=clawlet
ExecStart=/home/clawlet/clawlet serve --unix /run/clawlet/clawlet.sock
Restart=on-failure
RestartSec=5
RuntimeDirectory=clawlet
RuntimeDirectoryMode=0750
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=/home/clawlet/.clawlet /run/clawlet

[Install]
WantedBy=multi-user.target
EOF
        
        # 设置 socket 目录组权限
        sudo mkdir -p /etc/tmpfiles.d
        echo 'd /run/clawlet 0750 clawlet clawlet-users -' | sudo tee /etc/tmpfiles.d/clawlet.conf > /dev/null
        
        sudo systemctl daemon-reload
        sudo systemctl enable clawlet
        sudo systemctl start clawlet
        
        info "Clawlet installed and running ✓"
    fi
    
    # === OwliaBot ===
    info "Installing OwliaBot..."
    
    # 检查 Node.js
    if ! command -v node >/dev/null; then
        warn "Node.js not found. Installing via nvm..."
        curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
        export NVM_DIR="$HOME/.nvm"
        [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
        nvm install 22
    fi
    
    # 安装 owliabot
    npm install -g owliabot@${VERSION}
    
    # 创建配置目录
    mkdir -p ~/.owliabot/config ~/.owliabot/workspace
    
    info "OwliaBot installed ✓"
    info ""
    info "Run 'owliabot onboard' to configure."
    
    # 提示重新登录以应用组变更
    if [[ "$INSTALL_CLAWLET" == "true" ]]; then
        warn "Please log out and log back in for group membership to take effect."
        warn "Or run: newgrp clawlet-users"
    fi
}

# macOS 安装
install_macos() {
    info "Installing for macOS..."
    
    # === Clawlet ===
    if [[ "$INSTALL_CLAWLET" == "true" ]]; then
        info "Creating clawlet user and group..."
        
        # 创建组
        if ! dscl . -read /Groups/clawlet-users &>/dev/null; then
            sudo dscl . -create /Groups/clawlet-users
            sudo dscl . -create /Groups/clawlet-users PrimaryGroupID 398
        fi
        
        # 当前用户加入组
        sudo dscl . -append /Groups/clawlet-users GroupMembership "$USER"
        
        # 创建用户
        if ! dscl . -read /Users/clawlet &>/dev/null; then
            sudo dscl . -create /Users/clawlet
            sudo dscl . -create /Users/clawlet UniqueID 399
            sudo dscl . -create /Users/clawlet PrimaryGroupID 399
            sudo dscl . -create /Users/clawlet UserShell /usr/bin/false
            sudo dscl . -create /Users/clawlet NFSHomeDirectory /var/lib/clawlet
            sudo dscl . -create /Users/clawlet IsHidden 1
        fi
        
        # 创建目录
        sudo mkdir -p /var/lib/clawlet/.clawlet
        sudo mkdir -p /var/run/clawlet
        sudo mkdir -p /var/log/clawlet
        sudo chown -R clawlet:clawlet-users /var/lib/clawlet /var/run/clawlet
        sudo chmod 700 /var/lib/clawlet/.clawlet
        sudo chmod 750 /var/run/clawlet
        
        # 下载 clawlet
        info "Downloading clawlet ${CLAWLET_VERSION}..."
        CLAWLET_URL="https://github.com/owliabot/clawlet/releases/download/${CLAWLET_VERSION}/clawlet-darwin-${ARCH}"
        sudo curl -fsSL "$CLAWLET_URL" -o /var/lib/clawlet/clawlet
        sudo chmod 755 /var/lib/clawlet/clawlet
        sudo chown clawlet:clawlet /var/lib/clawlet/clawlet
        
        # 安装 launchd service
        info "Installing launchd service..."
        sudo tee /Library/LaunchDaemons/com.owliabot.clawlet.plist > /dev/null << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.owliabot.clawlet</string>
    <key>ProgramArguments</key>
    <array>
        <string>/var/lib/clawlet/clawlet</string>
        <string>serve</string>
        <string>--unix</string>
        <string>/var/run/clawlet/clawlet.sock</string>
    </array>
    <key>UserName</key>
    <string>clawlet</string>
    <key>GroupName</key>
    <string>clawlet</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/var/log/clawlet/clawlet.log</string>
    <key>StandardErrorPath</key>
    <string>/var/log/clawlet/clawlet.err</string>
</dict>
</plist>
EOF
        
        sudo launchctl load /Library/LaunchDaemons/com.owliabot.clawlet.plist
        
        info "Clawlet installed and running ✓"
    fi
    
    # === OwliaBot ===
    info "Installing OwliaBot..."
    
    # 检查 Node.js
    if ! command -v node >/dev/null; then
        if command -v brew >/dev/null; then
            brew install node@22
        else
            error "Please install Node.js 22+ first: https://nodejs.org"
        fi
    fi
    
    npm install -g owliabot@${VERSION}
    
    mkdir -p ~/Library/Application\ Support/OwliaBot/{config,workspace}
    
    info "OwliaBot installed ✓"
    info ""
    info "Run 'owliabot onboard' to configure."
}

# Windows 安装 (PowerShell 调用)
install_windows() {
    info "Installing for Windows..."
    
    # 需要管理员权限
    if [[ ! $(id -G) =~ (^|[[:space:]])544($|[[:space:]]) ]]; then
        error "Please run this script as Administrator"
    fi
    
    # 调用 PowerShell 脚本
    powershell.exe -ExecutionPolicy Bypass -File - << 'PWSH'
# Windows 安装脚本 (内嵌)
$ErrorActionPreference = "Stop"

Write-Host "[INFO] Installing for Windows..." -ForegroundColor Green

# === Clawlet ===
Write-Host "[INFO] Creating clawlet user and group..."

# 创建用户
$password = [System.Web.Security.Membership]::GeneratePassword(32, 8)
$securePassword = ConvertTo-SecureString $password -AsPlainText -Force

if (-not (Get-LocalUser -Name "clawlet" -ErrorAction SilentlyContinue)) {
    New-LocalUser -Name "clawlet" -Password $securePassword -Description "Clawlet Wallet Signer" -AccountNeverExpires -PasswordNeverExpires
    Disable-LocalUser -Name "clawlet"
}

# 创建组
if (-not (Get-LocalGroup -Name "clawlet-users" -ErrorAction SilentlyContinue)) {
    New-LocalGroup -Name "clawlet-users" -Description "Users allowed to connect to Clawlet"
}

# 当前用户加入组
Add-LocalGroupMember -Group "clawlet-users" -Member $env:USERNAME -ErrorAction SilentlyContinue

# 创建目录
$clawletDir = "C:\ProgramData\Clawlet"
New-Item -ItemType Directory -Force -Path "$clawletDir\.clawlet" | Out-Null

# 设置 ACL
$acl = Get-Acl "$clawletDir\.clawlet"
$acl.SetAccessRuleProtection($true, $false)
$acl.Access | ForEach-Object { $acl.RemoveAccessRule($_) | Out-Null }
$rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
    "clawlet", "FullControl", "ContainerInherit,ObjectInherit", "None", "Allow")
$acl.AddAccessRule($rule)
Set-Acl "$clawletDir\.clawlet" $acl

# 下载 clawlet
Write-Host "[INFO] Downloading clawlet..."
$arch = if ([Environment]::Is64BitOperatingSystem) { "amd64" } else { "x86" }
$url = "https://github.com/owliabot/clawlet/releases/latest/download/clawlet-windows-$arch.exe"
Invoke-WebRequest -Uri $url -OutFile "$clawletDir\clawlet.exe"

# 创建 Windows 服务
Write-Host "[INFO] Creating Windows service..."
if (Get-Service -Name "Clawlet" -ErrorAction SilentlyContinue) {
    Stop-Service -Name "Clawlet" -Force
    sc.exe delete Clawlet
}

New-Service -Name "Clawlet" `
    -BinaryPathName "$clawletDir\clawlet.exe serve --pipe \\.\pipe\clawlet" `
    -DisplayName "Clawlet Wallet Signer" `
    -Description "Secure wallet signer for OwliaBot" `
    -StartupType Automatic `
    -Credential (New-Object PSCredential(".\clawlet", $securePassword))

Start-Service -Name "Clawlet"

Write-Host "[INFO] Clawlet installed and running ✓" -ForegroundColor Green

# === OwliaBot ===
Write-Host "[INFO] Installing OwliaBot..."

# 检查 Node.js
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "[WARN] Node.js not found. Please install from https://nodejs.org" -ForegroundColor Yellow
    exit 1
}

npm install -g owliabot

Write-Host "[INFO] OwliaBot installed ✓" -ForegroundColor Green
Write-Host ""
Write-Host "Run 'owliabot onboard' to configure."
PWSH
}

# 主流程
main() {
    echo ""
    echo "╔═══════════════════════════════════════╗"
    echo "║     OwliaBot + Clawlet Installer      ║"
    echo "╚═══════════════════════════════════════╝"
    echo ""
    
    detect_platform
    
    case "$PLATFORM" in
        linux)  install_linux ;;
        macos)  install_macos ;;
        windows) install_windows ;;
    esac
    
    echo ""
    info "Installation complete! 🎉"
}

main "$@"
```

---

## 5. 分步实施计划

### Phase 1: 基础设施 (Week 1)

| 任务 | 负责 | 产出 | 估时 |
|------|------|------|------|
| **1.1** Clawlet Unix socket serve 模式 | Clawlet | `clawlet serve --unix <path>` | 1d |
| **1.2** Clawlet Named Pipe serve 模式 (Windows) | Clawlet | `clawlet serve --pipe <name>` | 1d |
| **1.3** Clawlet 多平台 CI 构建 | Clawlet | linux/macos/windows × amd64/arm64 | 0.5d |
| **1.4** Clawlet GitHub Release 自动发布 | Clawlet | `v0.1.0` tag → release binaries | 0.5d |

**交付物**: Clawlet 可在三平台以 service 模式运行，监听 IPC

### Phase 2: 集成层 (Week 2)

| 任务 | 负责 | 产出 | 估时 |
|------|------|------|------|
| **2.1** OwliaBot ClawletClient (跨平台) | OwliaBot | `src/wallet/clawlet-client.ts` | 1d |
| **2.2** OwliaBot wallet tools | OwliaBot | `wallet_balance`, `wallet_transfer` | 1d |
| **2.3** OwliaBot config schema 扩展 | OwliaBot | `wallet.clawlet.socket/pipe` | 0.5d |
| **2.4** 集成测试 | OwliaBot | E2E: owliabot ↔ clawlet | 0.5d |

**交付物**: OwliaBot 可通过 IPC 调用 Clawlet

### Phase 3: 安装体验 (Week 3)

| 任务 | 负责 | 产出 | 估时 |
|------|------|------|------|
| **3.1** install.sh Linux 部分 | OwliaBot | 用户/组/systemd/权限 | 1d |
| **3.2** install.sh macOS 部分 | OwliaBot | 用户/组/launchd/权限 | 1d |
| **3.3** install.ps1 Windows 部分 | OwliaBot | 用户/组/service/ACL | 1d |
| **3.4** uninstall 脚本 | OwliaBot | 清理用户/服务/文件 | 0.5d |
| **3.5** 文档: 安装/配置/故障排查 | OwliaBot | docs/installation.md | 0.5d |

**交付物**: `curl | bash` 一键安装

### Phase 4: 发布 (Week 4)

| 任务 | 负责 | 产出 | 估时 |
|------|------|------|------|
| **4.1** get.owliabot.dev 域名 + CDN | Infra | 安装脚本托管 | 0.5d |
| **4.2** 版本号对齐 | Both | owliabot v0.2.0 + clawlet v0.1.0 | 0.5d |
| **4.3** CHANGELOG 更新 | Both | 发布说明 | 0.5d |
| **4.4** 公告 + 文档站更新 | Marketing | README/docs | 0.5d |

**交付物**: 正式发布 v0.2.0

---

## 6. 验收标准

### 6.1 安全验收

- [ ] 当前用户无法读取 `/home/clawlet/.clawlet/keystore.json`
- [ ] 当前用户可以连接 IPC socket/pipe
- [ ] 非授权用户无法连接 IPC
- [ ] Windows Named Pipe 拒绝远程连接
- [ ] systemd/launchd 服务以最小权限运行

### 6.2 功能验收

- [ ] `curl -fsSL https://get.owliabot.dev | bash` 成功安装
- [ ] `owliabot onboard` 正确检测 Clawlet 连接
- [ ] `@bot 查询余额 0x...` 返回正确余额
- [ ] `@bot 转账 0.01 ETH to 0x...` 触发确认流程

### 6.3 平台验收

| 平台 | 测试环境 |
|------|----------|
| Linux | Ubuntu 22.04, Debian 12 |
| macOS | macOS 14 (Sonoma), macOS 13 (Ventura) |
| Windows | Windows 11, Windows Server 2022 |

---

## 7. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| Node.js Named Pipe 支持不完善 | Windows 集成受阻 | 降级为 HTTP localhost |
| macOS 隐藏用户创建需要 sudo | 用户体验 | 文档说明 + 手动安装选项 |
| systemd 版本差异 | 旧系统不兼容 | 检测版本，降级为 init.d |
| 用户拒绝 sudo | 无法创建隔离用户 | 提供单用户模式安装 |

---

## 附录 A: 命令速查

```bash
# Linux - 检查 clawlet 状态
sudo systemctl status clawlet
journalctl -u clawlet -f

# Linux - 测试 socket 连接
echo '{"jsonrpc":"2.0","id":1,"method":"wallet_ping"}' | nc -U /run/clawlet/clawlet.sock

# macOS - 检查 clawlet 状态
sudo launchctl list | grep clawlet
tail -f /var/log/clawlet/clawlet.log

# Windows - 检查 clawlet 状态
Get-Service Clawlet
Get-Content C:\ProgramData\Clawlet\clawlet.log -Tail 50

# Windows - 测试 Named Pipe
# (PowerShell)
$pipe = New-Object System.IO.Pipes.NamedPipeClientStream(".", "clawlet", [System.IO.Pipes.PipeDirection]::InOut)
$pipe.Connect(1000)
```

---

## 附录 B: 卸载脚本

```bash
#!/bin/bash
# uninstall.sh

case "$(uname -s)" in
    Linux*)
        sudo systemctl stop clawlet
        sudo systemctl disable clawlet
        sudo rm -f /etc/systemd/system/clawlet.service
        sudo systemctl daemon-reload
        sudo userdel -r clawlet
        sudo groupdel clawlet-users
        npm uninstall -g owliabot
        rm -rf ~/.owliabot
        ;;
    Darwin*)
        sudo launchctl unload /Library/LaunchDaemons/com.owliabot.clawlet.plist
        sudo rm -f /Library/LaunchDaemons/com.owliabot.clawlet.plist
        sudo rm -rf /var/lib/clawlet /var/run/clawlet /var/log/clawlet
        sudo dscl . -delete /Users/clawlet
        sudo dscl . -delete /Groups/clawlet-users
        npm uninstall -g owliabot
        rm -rf ~/Library/Application\ Support/OwliaBot
        ;;
esac

echo "Uninstall complete."
```
