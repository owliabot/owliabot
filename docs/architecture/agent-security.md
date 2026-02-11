# OwliaBot 相对 OpenClaw 的 Agent Security 增量

## **一、私钥与链上安全**

### **1. 私钥 / 签名能力彻底移出 Agent 进程（已支持）**

**一句话解释**：

OwliaBot 永远接触不到私钥，就算被攻击也无法直接完成签名。

**扩展说明**：

OwliaBot 将所有链上签名与私钥托管职责，明确移出 Agent 进程，交由独立的钱包守护进程 **Clawlet** 负责, 并且 Clawlet 位于不同的系统账户, OwliaBot 无法直接读取到其资源。OwliaBot 侧只持有受限的 Auth Token 和 RPC 调用能力。

这意味着即便发生 prompt injection、工具误调用，甚至 Agent 进程被 RCE，攻击者也很难完成“读私钥 → 发走 / 滥用签名”的完整攻击链。

**对比之下:**
通用型 Agent（如 OpenClaw）如果与主机文件系统、环境变量或剪贴板共享运行环境，一旦私钥存在于这些位置，注入攻击更容易转化为资产级风险。

---

### **2. 把“sign”当作一等高危能力来建模(已支持 Tier 安全分级和阈值检测)**

**一句话解释**：

单独分出一类 ‘sign’ 类型资源, 对其调用默认当成“危险操作”来治理, 设定针对性安全策略(交易行为统计), 比常规 ‘read/write’ 更适合 crypto

**扩展说明**：

OwliaBot 从设计层面增加 ‘sign’ 类型资源, ****设定专门的守护流程：

OwliaBot 语境下, 资源被分为 read / write / sign 类型，并进一步引入 Tier 分级（none / 3 / 2 / 1）。策略引擎会结合 ‘sign’ 资源调用 **金额阈值、累计额度、调用频率** 等上下文因素，决定是否升级到更严格的确认流程。

这种设计非常贴合 Crypto 场景的真实风险：**同一个工具，在不同金额或频率下，其风险级别并不相同**。OwliaBot 把这种差异变成了系统级能力，而不是依赖提示词或人工判断等非确定性决策。

**对比之下:**

通用性 Agent 不会针对 Crypto 场景进行特定业务的权限控制

---

### **3. WriteGate：write / sign 资源调用白名单, 甚至 Companion App 授权.(白名单已支持, Companion App 授权还没有)**

**一句话解释**：

OwliaBot 对于 ‘write/sign’ 资源调用, 会检查调用对象(channel/service) 是否在白名单内, 并且如果触发 Tier 1 风控, OwliaBot 会推送给 Companion App 进行授权确认。

**扩展说明**：

WriteGate 是 OwliaBot 的一道关键门禁。所有非只读资源被调用前，都必须同时满足两个条件：

1. 调用来源(channel 如 Telegram, service 如 交易机器人)在白名单中；
2. 满足 Tier 1/2/3 的风控要求。
    
    如果白名单为空，**等价于** ‘write / sign’ ****能力在系统层面默认关闭。
    
    如果资源调用触发 Tier 1 风控(如累计转账金额到达阈值), OwliaBot 会将二次确认信息推送到用户的 Companion App 以确认授权
    
    这一机制的核心思想是：**再可信的 Agent，也不应拥有“自主处置资产”的能力**。即便策略引擎判断风险可控，最终执行权仍然保留在人类用户手中。
    

**对比之下:**

OpenClaw 没有区分 ‘read/write/sign’ 的资源调用白名单, 其更多关注在 gateway 的权限(消息路径权限), 即某来源的消息是否会被处理, 而不会考虑**消息本身的侵入性**. 只要 channel/user 在白名单内, 不硬性区分 ‘read/write’ 操作, 风控取决于使用者的安全意识, 通过 prompt 进行薄弱防护.

---

## **二、对 Prompt Injection 的防护**

### **4. 工具级速率限制(已支持)**

**一句话解释**：

OwliaBot 会防止被注入后, 攻击方采用 **连续多次调用低风险资源** 来达成更高危的损失。

**扩展说明**：

OwliaBot 在资源调用层引入了精细的速率限制与配额机制，例如每小时 / 每日最大调用次数、最小调用间隔等。

与仅在 auth profile 或 provider 层做 cooldown 不同，这些限制直接作用于**工具执行前**，属于不可绕过的硬性限制。

其目的是控制最坏情况下的影响范围——防止 Agent 在被注入后，短时间内重复调用低风险工具，以绕过高风险操作的校验。

**对比之下:**

OpenClaw 为了最大化 Agent 的能力, 没有做此类限制. 他更多的还是关注在 Gateway, 即消息的接收(是否被DDoS, Spam)

---

### **5. Fail-closed 审计：没有日志，就不执行(已支持)**

**一句话解释**：
OwliaBot 要求资源调用必须先审计后执行, 留下操作记录。

**扩展说明**：

在 OwliaBot 中，审计是资源调用的前置条件, 而不是简单的日志。所有敏感资源调用前，必须先成功写入审计日志；如果日志系统不可用，操作会被直接阻断。

这种 fail-closed 设计避免了“资产已转出但没有任何记录”的最坏情形，也为事后追责、风控复盘提供了可靠基础。

从安全工程角度看，这是把**可观测性当作安全边界的一部分**，而不是可选特性。

**对比之下:**

通用性 Agent, 比如 OpenClaw 没有对安全和合规有这么高要求, 并不需要做审计. 基础日志系统就足够满足通用 Agent 的需求.

---

### **6. 文件系统最小权限(已支持)**

**一句话解释**：

只给 Agent 看到指定目录的文件资源, 而不是整个系统都开放给他。

**扩展说明**：

OwliaBot 对文件读取能力实施了严格的最小权限原则：

只允许访问明确声明的 roots（如 workspace），拒绝绝对路径、路径穿越、符号链接逃逸，并主动隐藏常见敏感文件与目录（.env、secrets.yaml、auth.yaml 等）。

同时，系统还对读取大小、文件类型做限制，拒绝二进制文件，以降低数据外流和 DoS 风险。

OwliaBot 在**不依赖容器隔离的情况下，也尽量收紧文件访问面.**

当然 OwliaBot 优先推荐使用 Docker 进行隔离.

**对比之下:**

OpenClaw 明确指出 workspace 本身并非硬沙箱，更依赖 Docker sandbox 与策略配置；而且其推荐是用方式并不是 Docker 部署, 因为他的卖点是能力全面, 没有边界, 而 Docker 会限制他的边界.

---

### **7. 更窄的 exec 能力面(已支持)**

**一句话解释**：

只能跑被允许的命令。

**扩展说明**：

OwliaBot 的 exec 工具刻意避免 shell 语义，改用 command + params 形式，强制命令 basename 且必须在 allowlist 中。

执行目录必须位于 workspace 的 realpath 下，环境变量仅允许白名单项透传，任何“看起来像密钥”的变量名都会被自动剥离；输出大小与执行时间也都有硬上限。

这种设计显著降低了命令注入与环境变量泄漏风险。

**对比而言:**

OpenClaw 提供的是更通用、更强的 shell exec 能力，目的是达到更大的能力边界.

---

### **8. 阻断敏感信息泄漏(已支持)**

**一句话解释**：

OwliaBot 会扫描通过 Gateway 对外暴露的数据, 以及 web 资源调用, 防止敏感信息泄漏和逃过审计(例如会扫描 POST Request Body 里是否有敏感信息)

**扩展说明**：

OwliaBot 在 gateway message 和 web.fetch 中对非 GET / HEAD 请求的 body 做高置信模式扫描，一旦命中，直接阻断请求。

这正是 prompt injection 最常见的外流路径之一：诱导模型将Token, Key POST 到攻击者服务器。

通过在网络出口层面引入这种“DLP 式硬拦截”，OwliaBot 能有效切断注入攻击的最后一步，而不是仅依赖日志脱敏或事后发现。

**相比之下:**

OpenClaw 不具备 Data Leakage Monitoring 的能力, 风控取决于使用者的安全意识, 通过 prompt 进行薄弱防护.

---

## **三、远程与权限边界**

### **9. 更完善的 Device Token/Service Token （Token 泄露的止损机制）(已支持)**

**一句话解释**：

发放最小权限 token, 并支持 rotation 和取消。

**扩展说明**：

OwliaBot 在 Gateway 层将管理员 token 与 device token 和 service token 严格分离，并为device token 和 service token 引入明确的 scope（如 read / write / sign / system / mcp）。

这些 scope 会在进入 Tier policy 之前先进行硬拒绝，从而确保即使某个device token 或 service token 泄露，其可造成的影响也被限制在最小范围内。

**相比之下:**

OpenClaw 更偏向单一控制面 token，权限治理比较粗糙, 更多集中在后续的 tool policy。

---

## **四、供应链安全**

### **10. 优势：Skills 是 Markdown，不是代码(已支持)**

**一句话解释**：Skills 只限于 Markdown 文档, 调用的资源只限于已知白名单, 不会引入新的未知代码

**扩展说明**：

OwliaBot 的 Skills 体系本质上是 Markdown 文档，只用于提供元信息和提示词，不会被当作代码执行, 也不会为 Skill 引入未知的代码.

这显著降低了“装了一个技能就引入 RCE”的供应链风险，也更容易被人工审查。

**相比之下:**

OpenClaw 允许安装所有 Skills, 没有任何限制

---

OwliaBot 的安全设计核心是**针对性地限制 Agent 调用资源的能力**：

私钥隔离存储, ‘write/sign’ 资源调用默认是危险行为，文件隔离读取，数据不随便外发，要求 Companion App 授权。

通用性 Agent 则会为了追求更大的能力边界, 尽量减少能力的约束

这是两者的根本不同