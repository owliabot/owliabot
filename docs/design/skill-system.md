# Skill 系统设计

> 状态：已实现 (Implemented)  
> 作者：Lay2  
> 日期：2026-02-05  
> 更新：2026-02-05 (Markdown-based 重构)

## 1. 概述

Skill 是 OwliaBot 的可扩展能力单元。**新设计采用纯 Markdown 方案**：每个 Skill 是一个 `SKILL.md` 文件，包含 YAML frontmatter 元数据和 Markdown 说明。LLM 按需读取这些文件来获取执行指引。

### 1.1 设计原则

| 原则 | 说明 |
|------|------|
| **Markdown > JS** | 无运行时代码执行，减少攻击面 |
| **Prompt 即能力** | Skill 内容直接指导 LLM 行为 |
| **多目录覆盖** | builtin → user → workspace，支持自定义 |
| **安全在工具层** | WriteGate/TierPolicy 在工具执行层，Skill 无法绕过 |

### 1.2 与旧设计的对比

| 方面 | 旧设计 (JS) | 新设计 (Markdown) |
|------|------------|-------------------|
| 定义格式 | `package.json` + JS 模块 | `SKILL.md` (YAML + Markdown) |
| 执行方式 | 运行时加载执行 JS | LLM 读取后自行决策 |
| 安全模型 | 需要沙箱隔离 | 无代码执行风险 |
| 扩展方式 | 需要编程能力 | 只需写 Markdown |
| 工具调用 | `ctx.callTool()` 封装 | LLM 直接调用内置工具 |

## 2. SKILL.md 格式

```markdown
---
name: weather
description: Get current weather and forecasts using wttr.in.
version: 1.0.0
---

# Weather

Use wttr.in for weather queries. No API key needed.

## Quick Check

\`\`\`bash
curl -s "wttr.in/London?format=3"
\`\`\`

...
```

### 2.1 Frontmatter 字段

| 字段 | 必需 | 说明 |
|------|------|------|
| `name` | ✅ | Skill 显示名称 |
| `description` | ✅ | 简短描述（用于 LLM 选择） |
| `version` | ❌ | 语义化版本 |

### 2.2 Markdown Body

包含 LLM 执行该 Skill 所需的所有指引：
- 命令示例
- API 用法
- 最佳实践
- 注意事项

## 3. 目录结构与加载顺序

Skills 从三个目录加载，**后者覆盖前者**（按目录名/Skill ID）：

```
1. builtin:   <owliabot-core>/skills/          # 内置 skills
2. user:      ~/.owliabot/skills/              # 用户自定义
3. workspace: <workspace>/skills/              # 项目特定
```

### 3.1 覆盖规则

```
builtin/
  └── weather/SKILL.md    # 基础天气
  
~/.owliabot/skills/
  └── weather/SKILL.md    # 用户自定义，覆盖 builtin
  
workspace/skills/
  └── weather/SKILL.md    # 项目特定，最终生效
```

### 3.2 加载流程

```typescript
// src/skills/loader.ts
export async function loadSkills(dirs: string[]): Promise<Skill[]> {
  const skillsMap = new Map<string, Skill>();
  
  for (const dir of dirs) {
    const skills = await loadSkillsFromDir(dir);
    for (const skill of skills) {
      skillsMap.set(skill.id, skill); // 后者覆盖前者
    }
  }
  
  return Array.from(skillsMap.values());
}
```

## 4. System Prompt 注入

加载的 Skills 以 XML 格式注入 System Prompt：

```xml
<available_skills>
  <skill>
    <name>weather</name>
    <description>Get current weather and forecasts using wttr.in.</description>
    <location>/home/user/owliabot-core/skills/weather/SKILL.md</location>
  </skill>
  <skill>
    <name>github</name>
    <description>Interact with GitHub using the gh CLI.</description>
    <location>/home/user/.owliabot/skills/github/SKILL.md</location>
  </skill>
</available_skills>
```

### 4.1 Skills 使用指引

System Prompt 还包含使用指引：

```
## Skills (mandatory)

Before replying: scan <available_skills> <description> entries.
- If exactly one skill clearly applies: read its SKILL.md at <location> with `read`, then follow it.
- If multiple could apply: choose the most specific one, then read/follow it.
- If none clearly apply: do not read any SKILL.md.

Constraints: never read more than one skill up front; only read after selecting.
```

## 5. 运行时流程

```
用户: "What's the weather in Tokyo?"
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│                      System Prompt                               │
│  包含 <available_skills>:                                       │
│    - weather: "Get current weather..."                          │
│    - github: "Interact with GitHub..."                          │
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                        LLM 决策                                  │
│  1. 扫描 skills 描述                                            │
│  2. 匹配到 weather skill                                        │
│  3. 调用 read 工具读取 SKILL.md                                 │
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│               read("/path/to/weather/SKILL.md")                  │
│  返回完整的 SKILL.md 内容                                       │
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                    LLM 根据指引执行                              │
│  1. 阅读 SKILL.md 中的 curl 命令                                │
│  2. 调用 exec 工具执行: curl -s "wttr.in/Tokyo?format=3"        │
│  3. 解析结果并回复用户                                          │
└─────────────────────────────────────────────────────────────────┘
```

## 6. 安全模型

### 6.1 安全边界在工具层

Skill 只是「给 LLM 的指引」，真正的安全检查在工具层：

| 工具类型 | 安全层 | 说明 |
|---------|--------|------|
| Read Tools | 无 | read-file, list-dir 直接执行 |
| Write Tools | WriteGate | 需要 allowlist + 可选确认 |
| Exec | TierPolicy | 命令白名单 + inline 确认 |
| Signer | TierPolicy | Tier 1/2/3 分级确认 |

### 6.2 Skill 无法绕过门控

```
SKILL.md: "执行 rm -rf /" 
           │
           ▼
      LLM 调用 exec 工具
           │
           ▼
      WriteGate 检查
           │
           ▼
      ❌ 命令不在白名单，拒绝执行
```

### 6.3 无代码执行风险

- Markdown 文件是纯文本，不会被执行
- LLM 必须通过内置工具才能执行任何操作
- 所有操作都经过 Gateway 的安全层

## 7. 实现细节

### 7.1 类型定义

```typescript
// src/skills/types.ts
export interface SkillMeta {
  name: string;
  description: string;
  version?: string;
}

export interface Skill {
  id: string;           // 目录名
  meta: SkillMeta;      // frontmatter 解析结果
  location: string;     // SKILL.md 绝对路径
  body: string;         // markdown 内容（可选缓存）
}

export interface SkillsInitResult {
  skills: Skill[];
  promptBlock: string;  // <available_skills> XML
  instruction: string;  // 使用指引
}
```

### 7.2 Frontmatter 解析

```typescript
// src/skills/loader.ts
const FRONTMATTER_REGEX = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/;

export function parseFrontmatter(content: string): { meta: SkillMeta; body: string } | null {
  const match = content.match(FRONTMATTER_REGEX);
  if (!match) return null;
  
  const meta = yaml.parse(match[1]) as SkillMeta;
  const body = match[2];
  
  if (!meta.name || !meta.description) return null;
  
  return { meta, body };
}
```

### 7.3 Prompt 生成

```typescript
// src/skills/prompt.ts
export function formatSkillsForPrompt(skills: Skill[]): string {
  if (skills.length === 0) return '';
  
  const items = skills.map(skill => `  <skill>
    <name>${escapeXml(skill.meta.name)}</name>
    <description>${escapeXml(skill.meta.description)}</description>
    <location>${escapeXml(skill.location)}</location>
  </skill>`);
  
  return `<available_skills>\n${items.join('\n')}\n</available_skills>`;
}
```

## 8. 测试覆盖

### 8.1 单元测试

| 文件 | 测试数 | 覆盖内容 |
|------|--------|---------|
| `loader.test.ts` | 11 | frontmatter 解析、目录加载、错误处理 |
| `prompt.test.ts` | 4 | XML 生成、特殊字符转义 |

### 8.2 E2E 测试

| 测试类别 | 测试数 | 覆盖内容 |
|---------|--------|---------|
| Skills 加载 | 4 | 多目录加载、工具命名空间、错误处理 |
| Tool 调用流程 | 2 | read-level 执行、SkillContext 传递 |
| WriteGate 集成 | 6 | allowlist、确认流程、安全边界验证 |

**总计**: 763 tests, 100% passing ✅

## 9. 内置 Skills

### 9.1 weather

天气查询，使用 wttr.in API。

```bash
curl -s "wttr.in/Tokyo?format=3"
# Tokyo: ☀️ +15°C
```

### 9.2 github

GitHub CLI 操作指南。

```bash
gh issue list
gh pr create --title "..." --body "..."
```

### 9.3 web-search

内置 web_search/web_fetch 工具使用指南。

## 10. 创建自定义 Skill

1. 在 `~/.owliabot/skills/` 下创建目录
2. 创建 `SKILL.md` 文件
3. 填写 frontmatter 和说明

```bash
mkdir -p ~/.owliabot/skills/my-skill
cat > ~/.owliabot/skills/my-skill/SKILL.md << 'EOF'
---
name: my-skill
description: 这是我的自定义 skill
version: 1.0.0
---

# My Skill

这里写 skill 的使用说明...
EOF
```

重启 owliabot 后自动加载。

## 11. 参考

- [WriteGate 设计](./write-gate.md)
- [Tier Policy 设计](./tier-policy.md)
- [审计日志策略](./audit-strategy.md)
