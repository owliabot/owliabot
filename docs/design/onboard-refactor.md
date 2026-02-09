# Onboard 重构设计（v2）— 基于已合并的统一流程

> 更新于 2026-02-09，基于 `refactor/unified-onboard` 合并后的 main 分支

## 现状

`onboard-docker.ts` 已删除，`onboard.ts`（1234 行）通过 `docker: boolean` 参数统一处理 local 和 docker 模式。核心入口 `runOnboarding()` 已合并两种流程。

### 已解决
- ✅ 两套独立实现 → 单一 `runOnboarding()`
- ✅ `entry.ts` 统一调用入口
- ✅ Provider / channel / gateway 配置共享

### 仍待解决

| 问题 | 说明 |
|------|------|
| **1234 行单文件** | 所有逻辑仍在一个文件中，职责过多 |
| **缺少 Discord guild 交互式配置** | `runDiscordSetup`（API 探测 guild/channel）未合入 main，两种模式都没有 |
| **缺少步骤模块化** | 40+ 个函数在同一文件，难以测试和复用 |
| **docker 模式仍缺部分功能** | Clawlet wallet 配置已有，但 discord guild 交互式和部分安全配置仍缺 |

## 重构目标

1. **模块拆分**：将 `onboard.ts` 的 40+ 函数提取到 `steps/` 目录
2. **合入 Discord guild 配置**：将 PR #97 的 `discord-setup.ts`（API 探测）集成到统一流程
3. **入口瘦身**：`onboard.ts` 仅保留 step 编排，< 80 行
4. **可测试性**：每个 step 可独立单测

## 架构

### 目录结构

```
src/onboarding/
├── onboard.ts                    # 入口：step 编排（< 80 行）
├── context.ts                    # OnboardContext 类型定义
├── steps/
│   ├── detect-existing.ts        # 检测已有配置
│   ├── provider-setup.ts         # Provider 选择 + 凭据输入
│   ├── channel-setup.ts          # 平台选择 + token 输入
│   ├── discord-guild-setup.ts    # Discord guild/channel 交互式配置（从 PR #97）
│   ├── telegram-setup.ts         # Telegram allowlist
│   ├── workspace-setup.ts        # Workspace 路径
│   ├── gateway-setup.ts          # Gateway HTTP 配置
│   ├── security-setup.ts         # Write-gate allowlist
│   ├── wallet-setup.ts           # Clawlet wallet
│   ├── timezone-setup.ts         # Timezone（docker only）
│   └── defaults.ts               # MemorySearch / SystemCapability 默认值
├── writers/
│   ├── yaml-writer.ts            # 写 app.yaml + secrets.yaml
│   └── compose-writer.ts         # 生成 docker-compose.yml
├── discord-setup.ts              # Discord API 探测（来自 PR #97，被 steps/discord-guild-setup.ts 调用）
├── clawlet-onboard.ts            # 不变
├── shared.ts                     # 不变（UI helpers）
├── secrets.ts                    # 不变
├── storage.ts                    # 不变
└── types.ts                      # 不变
```

### OnboardContext（共享状态）

> 类型应使用 onboarding 自定义的 config shape 或 `src/config/schema.ts` 类型，
> **不要**直接 import channel plugin 类型（`src/channels/*`），保持分层解耦。

```typescript
// src/onboarding/context.ts
interface OnboardContext {
  rl: RL;
  mode: "local" | "docker";
  dockerPaths?: DockerPaths;
  
  // Detection
  existing: DetectedConfig | null;
  reuseExisting: boolean;
  
  // Accumulated state
  secrets: SecretsConfig;
  providers: ProviderConfig[];
  
  // Platform
  discordEnabled: boolean;
  telegramEnabled: boolean;
  
  // Config sections（onboarding-specific types）
  discord?: OnboardDiscordConfig;
  telegram?: OnboardTelegramConfig;
  workspace: string;
  gateway?: GatewayConfig;
  security?: SecurityConfig;
  wallet?: WalletConfig;
  timezone?: string;
  memorySearch?: MemorySearchConfig;
  system?: SystemCapabilityConfig;
}
```

### 函数到 Step 的映射

现有 `onboard.ts` 函数 → 目标 step 文件：

| 现有函数 | 目标文件 |
|----------|----------|
| `detectExistingConfig()` | `steps/detect-existing.ts` |
| `printExistingConfigSummary()` | `steps/detect-existing.ts` |
| `promptReuseExistingConfig()` | `steps/detect-existing.ts` |
| `reuseProvidersFromExisting()` | `steps/provider-setup.ts` |
| `askProviders()` | `steps/provider-setup.ts` |
| `maybeConfigureAnthropic()` | `steps/provider-setup.ts` |
| `maybeConfigureOpenAI()` | `steps/provider-setup.ts` |
| `maybeConfigureOpenAICodex()` | `steps/provider-setup.ts` |
| `maybeConfigureOpenAICompatible()` | `steps/provider-setup.ts` |
| `getProvidersSetup()` | `steps/provider-setup.ts` |
| `askChannels()` | `steps/channel-setup.ts` |
| `getChannelsSetup()` | `steps/channel-setup.ts` |
| `configureDiscordConfig()` | `steps/discord-guild-setup.ts` |
| `configureTelegramConfig()` | `steps/telegram-setup.ts` |
| `getWorkspacePath()` | `steps/workspace-setup.ts` |
| `getGatewayConfig()` | `steps/gateway-setup.ts` |
| `configureDockerGatewayAndTimezone()` | `steps/gateway-setup.ts` + `steps/timezone-setup.ts` |
| `configureWriteToolsSecurity()` | `steps/security-setup.ts` |
| `configureWallet()` | `steps/wallet-setup.ts` |
| `buildDefaultMemorySearchConfig()` | `steps/defaults.ts` |
| `buildDefaultSystemConfig()` | `steps/defaults.ts` |
| `writeDockerConfigLocalStyle()` | `writers/yaml-writer.ts` |
| `writeDevConfig()` | `writers/yaml-writer.ts` |
| `buildDockerComposeYaml()` | `writers/compose-writer.ts` |
| Docker helper functions | `writers/compose-writer.ts` |
| `printDevNextSteps()` | `onboard.ts`（保留在入口） |
| `printDockerNextSteps()` | `onboard.ts`（保留在入口） |

### 重构后的入口

```typescript
// src/onboarding/onboard.ts（~70 行）
export async function runOnboarding(options: OnboardOptions = {}): Promise<void> {
  const ctx = createContext(options);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  ctx.rl = rl;

  try {
    printBanner(ctx);

    // 1. 检测 + 复用
    await detectAndPromptReuse(ctx);

    // 2. Provider
    await setupProviders(ctx);

    // 3. 平台 + token
    await setupChannels(ctx);

    // 4. Workspace
    await setupWorkspace(ctx);

    // 5. Discord guild 配置（有 token 时 API 探测）
    await setupDiscordGuild(ctx);

    // 6. Telegram
    await setupTelegram(ctx);

    // 7. Gateway
    await setupGateway(ctx);

    // 8. Timezone（docker only）
    if (ctx.mode === "docker") await setupTimezone(ctx);

    // 9. Wallet
    await setupWallet(ctx);

    // 10. Security
    await setupSecurity(ctx);

    // 11. Defaults
    applyDefaults(ctx);

    // 12. Write
    await writeConfig(ctx);
    await printNextSteps(ctx);

    success("All set!");
  } finally {
    rl.close();
  }
}
```

## 实施计划

### Phase 1：提取步骤（纯重构，不改行为）

1. 创建 `context.ts` + `OnboardContext` 类型
2. 逐个将函数移到 `steps/` 和 `writers/`（每移一批就跑测试）
3. `onboard.ts` 改为 step 编排
4. **验证**：所有现有测试通过，CLI 行为不变

**预计改动**：新增 ~13 个文件，`onboard.ts` 从 1234 行降到 ~70 行

### Phase 2：合入 Discord guild 交互式配置

1. 将 PR #97 的 `discord-setup.ts`（fetchGuilds / manualDiscordSetup / per-guild config）合入
2. `steps/discord-guild-setup.ts` 调用 `discord-setup.ts`
3. Docker 模式也能做 guild 配置
4. 更新测试

### Phase 3：清理 + 补充测试

1. 删除可能残留的死代码
2. 每个 step 加独立单测
3. E2E 测试覆盖两种模式的完整流程

## 风险

1. **测试回归**：onboard 测试依赖 prompt 顺序和 mock answer 数组，每个 Phase 完成后必须跑全量测试确认
2. **Docker 模式 secret input**：`secret=true`（raw mode）需要 TTY；非 TTY 环境（CI）要有 fallback
3. **Backward compatibility**：生成的 yaml 格式不能变
4. **类型分层**：`OnboardContext` 不要依赖 channel plugin（`src/channels/*`），使用 onboarding 自定义 shape 或 `src/config/schema.ts` 类型
