# Onboard 重构设计：合并 local 和 docker 流程

## 问题

`onboard.ts`（573 行）和 `onboard-docker.ts`（587 行）是两套独立实现，大量逻辑重复：

| 功能 | local | docker | 复用？ |
|------|-------|--------|--------|
| 检测已有配置 | ✅（从 secrets.yaml） | ✅（从 ~/.owliabot） | ❌ 各自实现 |
| Provider 选择 | ✅（5 选项） | ✅（5 选项，微调） | ❌ 重复 |
| 平台选择 | ✅ | ✅ | ❌ 重复 |
| Token 输入 | ✅ | ✅（secret mode） | ❌ 重复 |
| Discord guild 配置 | ✅（`runDiscordSetup`） | ❌ 完全没有 | — |
| Telegram allowlist | ✅ | ❌ 没有 | — |
| Write-gate 安全 | ✅ | ❌ 没有 | — |
| Workspace 路径 | ✅（交互） | ❌（硬编码 /app/workspace） | — |
| Memory search config | ✅ | ❌ | — |
| System capability config | ✅ | ❌ | — |
| Gateway HTTP | ✅（可选） | ✅（必选） | ❌ 重复 |
| Timezone | ❌ | ✅ | — |
| Clawlet wallet | ✅ | ❌ | — |
| docker-compose 生成 | ❌ | ✅ | — |
| 输出格式 | app.yaml + secrets.yaml | app.yaml + secrets.yaml + docker-compose.yml | ❌ 各自写 |

**核心矛盾**：docker 模式缺失了 local 模式的重要功能（discord guild 配置、allowlist、write-gate），而 local 模式缺少 docker 的 timezone 和 compose 输出。

## 设计方案

### 架构：Pipeline 模式

将 onboard 拆分为 **可组合的步骤（steps）**，每个步骤是独立函数，接受 `OnboardContext` 输入输出。local 和 docker 模式只是**不同的 step 组合 + 不同的 output writer**。

```
┌─────────────────────────────────────────────────────┐
│                  shared/steps/                       │
│                                                      │
│  detectExisting → providerSetup → platformSetup     │
│  → discordGuildSetup → telegramSetup → workspace    │
│  → gatewaySetup → securitySetup → walletSetup       │
│  → timezoneSetup                                     │
└─────────────────┬───────────────────┬───────────────┘
                  │                   │
           ┌──────┴──────┐     ┌──────┴──────┐
           │ local mode  │     │ docker mode │
           │             │     │             │
           │ steps:      │     │ steps:      │
           │  all above  │     │  all above  │
           │  - timezone │     │  + timezone │
           │             │     │  + compose  │
           │ output:     │     │ output:     │
           │  yaml writer│     │  yaml +     │
           │             │     │  compose    │
           └─────────────┘     └─────────────┘
```

### OnboardContext（共享状态）

> **注意**：Context 中的类型应使用 onboarding 自己定义的 config shape 或 `src/config/schema.ts` 中的类型，
> **不要**直接 import channel plugin 类型（如 `src/channels/discord/*`），以保持分层解耦。

```typescript
interface OnboardContext {
  rl: RL;
  mode: "local" | "docker";
  
  // Accumulated state
  secrets: SecretsConfig;
  providers: ProviderConfig[];
  
  // Platform config（使用 onboarding-specific 类型，不依赖 channel plugin）
  discordEnabled: boolean;
  telegramEnabled: boolean;
  discordConfig?: OnboardDiscordConfig;  // onboarding-specific shape, not channel plugin type
  telegramConfig?: OnboardTelegramConfig;
  
  // Other config
  workspace: string;
  gateway?: GatewayConfig;
  security?: SecurityConfig;
  wallet?: WalletConfig;
  timezone?: string;
  memorySearch?: MemorySearchConfig;
  system?: SystemCapabilityConfig;
  
  // Existing config (for reuse)
  existing: ExistingConfig | null;
  reuseExisting: boolean;
}
```

### 共享步骤（src/onboarding/steps/）

| 文件 | 职责 | 来源 |
|------|------|------|
| `detect-existing.ts` | 检测已有配置（合并两种检测逻辑） | 两个文件 |
| `provider-setup.ts` | Provider 选择 + 凭据输入 | 两个文件（合并差异） |
| `platform-setup.ts` | 平台选择 + token 输入 | 两个文件 |
| `discord-guild-setup.ts` | Discord guild/channel/member 配置 | 现有 `discord-setup.ts`（不变） |
| `telegram-setup.ts` | Telegram allowlist | `onboard.ts` |
| `workspace-setup.ts` | Workspace 路径选择 | `onboard.ts` |
| `gateway-setup.ts` | Gateway HTTP 配置 | 两个文件 |
| `security-setup.ts` | Write-gate allowlist | `onboard.ts` |
| `wallet-setup.ts` | Clawlet wallet | `onboard.ts`（包装现有） |
| `timezone-setup.ts` | Timezone | `onboard-docker.ts` |
| `defaults.ts` | MemorySearch / SystemCapability 默认值 | `onboard.ts` |

### 模式差异（仅在入口处理）

| 差异点 | local | docker |
|--------|-------|--------|
| Workspace 路径 | 交互式 | 固定 `/app/workspace` |
| Gateway | 可选 | 必选（容器需要健康检查） |
| Timezone | 不问 | 问 |
| docker-compose 输出 | 不生成 | 生成 |
| Token 输入 secret mode | `false` | `true`（docker 环境更敏感） |
| Provider 选项文案 | 微调 | 微调 |

### Output Writers（src/onboarding/writers/）

| 文件 | 职责 |
|------|------|
| `yaml-writer.ts` | 写 app.yaml + secrets.yaml（共享） |
| `compose-writer.ts` | 生成 docker-compose.yml（仅 docker 模式） |

### 入口文件改造

```typescript
// src/onboarding/onboard.ts — 变成薄包装
export async function runOnboarding(options) {
  const ctx = createContext("local", options);
  
  await detectExisting(ctx);
  await platformSetup(ctx);
  await providerSetup(ctx);
  await workspaceSetup(ctx);
  await gatewaySetup(ctx, { required: false });
  await discordGuildSetup(ctx);
  await telegramSetup(ctx);
  await walletSetup(ctx);
  await securitySetup(ctx);
  await applyDefaults(ctx);
  
  await writeYamlConfig(ctx);
  await initWorkspace(ctx);
  await printNextSteps(ctx);
}

// src/onboarding/onboard-docker.ts — 变成薄包装
export async function runDockerOnboarding(options) {
  const ctx = createContext("docker", options);
  
  await detectExisting(ctx);
  await providerSetup(ctx);
  await platformSetup(ctx);
  await discordGuildSetup(ctx);      // 新增！之前 docker 模式没有
  await telegramSetup(ctx);          // 新增！
  await gatewaySetup(ctx, { required: true });
  await timezoneSetup(ctx);
  await securitySetup(ctx);          // 新增！
  await applyDefaults(ctx);
  
  await writeYamlConfig(ctx);
  await writeComposeFile(ctx);
  await printNextSteps(ctx);
}
```

## 实施计划

### Phase 1：提取共享步骤（不改变行为）

1. 创建 `src/onboarding/steps/` 目录
2. 逐个提取步骤函数（先从最简单的开始）：
   - `detect-existing.ts`（合并两种检测）
   - `provider-setup.ts`（合并 provider 选择逻辑）
   - `platform-setup.ts`（合并平台选择 + token）
   - `gateway-setup.ts`
   - `timezone-setup.ts`
3. 定义 `OnboardContext` 类型
4. 改造 `onboard.ts` 使用新步骤（保持行为不变）
5. 改造 `onboard-docker.ts` 使用新步骤（保持行为不变）
6. **验证**：所有现有测试通过

### Phase 2：补齐 docker 模式缺失功能

1. docker 模式加入 `discordGuildSetup`（复用 `discord-setup.ts`）
2. docker 模式加入 `telegramSetup`
3. docker 模式加入 `securitySetup`（write-gate）
4. docker 模式加入 `walletSetup`
5. 更新 docker onboard 测试
6. **验证**：docker onboard 输出与 local 对齐

### Phase 3：统一提示顺序

目标：两种模式的提示顺序一致（减少用户困惑）

统一顺序：
1. 检测已有配置
2. 平台选择 + token
3. Workspace
4. Provider 选择
5. Discord guild 配置
6. Telegram 配置
7. Gateway
8. Timezone（仅 docker）
9. Wallet
10. Security (write-gate)

### Phase 4：清理

1. 删除 `onboard.ts` 和 `onboard-docker.ts` 中的内联逻辑（只保留 step 组合）
2. 每个入口文件应 < 50 行
3. 更新/新增测试覆盖 steps
4. 更新 `onboard-docker.test.ts` 的 mock answers

## 文件变更预估

| 操作 | 文件 |
|------|------|
| 新增 | `src/onboarding/steps/detect-existing.ts` |
| 新增 | `src/onboarding/steps/provider-setup.ts` |
| 新增 | `src/onboarding/steps/platform-setup.ts` |
| 新增 | `src/onboarding/steps/workspace-setup.ts` |
| 新增 | `src/onboarding/steps/gateway-setup.ts` |
| 新增 | `src/onboarding/steps/security-setup.ts` |
| 新增 | `src/onboarding/steps/telegram-setup.ts` |
| 新增 | `src/onboarding/steps/timezone-setup.ts` |
| 新增 | `src/onboarding/steps/defaults.ts` |
| 新增 | `src/onboarding/steps/context.ts`（OnboardContext 类型） |
| 新增 | `src/onboarding/writers/yaml-writer.ts` |
| 新增 | `src/onboarding/writers/compose-writer.ts` |
| 改造 | `src/onboarding/onboard.ts`（~50 行入口） |
| 改造 | `src/onboarding/onboard-docker.ts`（~50 行入口） |
| 不变 | `src/onboarding/discord-setup.ts` |
| 不变 | `src/onboarding/clawlet-onboard.ts` |
| 不变 | `src/onboarding/shared.ts` |
| 更新 | `src/onboarding/__tests__/onboard.test.ts` |
| 更新 | `src/onboarding/__tests__/onboard-docker.test.ts` |

## 风险

1. **测试回归**：onboard 测试依赖 prompt 顺序和 mock answer 数组，重构后（尤其 Phase 3 统一提示顺序时）必须同步更新所有测试的 mock answers。建议每个 Phase 完成后都跑一次全量测试确认。
2. **Docker 模式 secret input**：docker 模式的 token 输入用 `secret=true`（raw mode），需要 TTY；非 TTY 环境（CI）要有 fallback
3. **Backward compatibility**：生成的 yaml 格式不能变（现有用户的 config 还要能用）
4. **类型分层**：`OnboardContext` 及 steps 中的类型不要直接依赖 channel plugin（`src/channels/*`），应使用 onboarding 自定义的 config shape 或 `src/config/schema.ts` 的类型，保持单向依赖（onboarding → config schema，不反向依赖 runtime channel 实现）
