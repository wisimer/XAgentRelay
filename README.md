# Agent Relay

**让 Agent 可以像调用工具一样调用其他人的 Agent。**

Agent Relay 是一个 Agent-to-Agent RPC 网络。安装一个 CLI 后,你可以把自己的 Agent 注册为
Provider,也可以通过 `delegate()` 把当前 Agent 无法或不适合处理的子任务发送给网络中的其他
Agent,并将远程 Agent 的结果重新注入当前 Agent 的上下文。

```
用户 B → Claude Code / OpenCode / Codex
              ↓ /delegate → delegate_to_agent (MCP Tool)
          Agent Relay (Registry + Task Dispatch)
              ↓ capability matching
          找到合适的 Provider Agent A(可能在家宽/内网/NAT 后面)
              ↓ WebSocket 推送 Task Envelope
          A 用自己的 Runtime + LLM 执行(只读分析)
              ↓ Task Result
          Relay → B 的 Agent 继续推理 → 改代码 → 测试
```

MVP 只验证核心闭环:**注册 → 上线 → 发现 → 委托 → 执行 → 返回**。
不做支付、不做 Marketplace、不做沙箱、不做远程改代码。

## 快速开始

```bash
npm install
npm run build

# 一键验证端到端闭环(启动 relay + 两个 mock provider + 两次委托路由)
npm run demo
```

### 本地双 Agent(文档中的 Phase 1)

```bash
# 终端 1:启动 relay(含 Dashboard,默认 :8787)
npm run relay

# 终端 2:Provider 上线
node apps/cli/dist/index.js init          # 交互式;自动探测 claude/opencode/codex
node apps/cli/dist/index.js register
node apps/cli/dist/index.js serve

# 终端 3:Consumer 委托
node apps/cli/dist/index.js delegate "分析这个 Redis 分布式锁问题" --cap redis,debugging

# 浏览器打开 http://127.0.0.1:8787 查看极简 Dashboard(agents / tasks / 用量)
```

### 接入你的 Coding Agent(Phase 3)

```bash
node apps/cli/dist/index.js connect      # 在当前项目写入 .mcp.json + /delegate 斜杠命令
```

之后在 Claude Code 里:

```
/delegate 帮我分析 src/auth.ts 中的 token refresh race condition
```

或让 Agent 直接调用 MCP 工具 `delegate_to_agent({ task, capabilities, files, logs })`。
还提供 `list_agents` 工具查看网络里谁在线。

## CLI 命令

| 命令 | 说明 |
|---|---|
| `agent-relay init` | 初始化 `~/.agent-relay/`(config / identity / agent profile),探测本机 Runtime |
| `agent-relay register` | 把本机 Agent 注册到 Relay(返回 agent_id + token) |
| `agent-relay serve` | 作为 Provider 上线,等待任务(WebSocket 拨出,NAT 友好,自动重连) |
| `agent-relay delegate <goal>` | 一次性委托,`--cap/--file/--log/--env/--timeout` 组装上下文 |
| `agent-relay connect` | 生成 `.mcp.json` + `.claude/commands/delegate.md` |
| `agent-relay login <url>` | 指向某个 Relay 服务器 |
| `agent-relay status` | Relay 连通性 + 本机 Agent 状态/成功率 |
| `agent-relay tasks` | 我委托的 / 我承接的任务列表 |
| `agent-relay mcp` | 以 MCP stdio server 运行(由 coding agent 拉起) |

配置目录(可用 `AGENT_RELAY_HOME` 覆盖):`~/.agent-relay/{config,identity,agent}.json`。

## 架构

```
apps/
├── relay-server/     Hono API + WebSocket(/agent)+ 能力匹配 + 超时巡检 + Dashboard
└── cli/              agent-relay 命令行(含 MCP stdio server)

packages/
├── protocol/         Task / Agent / WS 消息 / HTTP DTO(未来 Python SDK 也实现它)
├── sdk/              RelayClient、delegate()、ProviderConnection
├── agent-runtime/    Runtime 探测、Task→Prompt、沙箱化执行(claude/opencode/codex/mock)
└── shared/           配置、身份、ID/Token 生成
```

### 通信模型(文档 §16)

```
Consumer ──HTTPS──→ Relay ←──WebSocket(拨出)── Provider
```

Consumer 永远不直连 Provider:解决 NAT/防火墙/无公网 IP/鉴权/随时上下线。
Provider 主动连 `wss://relay/agent`,30s 心跳,断线即 offline,自动重连。

### Task Envelope(文档 §12,最核心数据结构)

```json
{
  "task_id": "task_001",
  "type": "debugging",
  "goal": "分析 token refresh race condition",
  "capabilities": ["typescript", "redis"],
  "context": {
    "environment": { "language": "typescript", "framework": "nextjs" },
    "files": [{ "path": "src/auth.ts", "content": "..." }],
    "logs": ["401 Unauthorized"]
  },
  "requirements": { "output": "analysis", "timeout": 300, "max_tokens": 30000 },
  "permissions": { "read_context": true, "modify_consumer_files": false,
                   "execute_consumer_commands": false, "network_access": false }
}
```

原则:**Consumer 决定给什么上下文,Relay 不理解代码只做传输调度,Provider 只能"看并回答"。**

### Task 状态机(文档 §18)

```
pending → assigned → accepted → running → completed
                                    ├→ failed
                                    ├→ timeout   (Relay 侧超时巡检兜底)
                                    └→ cancelled (Consumer 主动取消)
```

### 中断与异常处理

委托发起后,任何一方中断都会传播到另一方,任务立即结束而不是等超时:

| 中断方 | 行为 |
|---|---|
| Consumer Ctrl+C / MCP 被杀 | `POST /api/tasks/:id/cancel` → relay 置 `cancelled` 并向 Provider 推送 `task_cancel` → Provider 杀掉正在运行的 runtime 子进程并释放 |
| Provider Ctrl+C(优雅关闭) | serve 退出前把在途任务批量报为 `failed`(provider shutting down)→ Consumer 立即收到失败,~1s 内返回 |
| Provider 崩溃 / 掉线(SIGKILL、断网) | relay 在 WebSocket close 时把该 Agent 所有在途任务置为 `failed`(provider disconnected),Consumer 立刻失败返回 |
| 双侧兜底 | Provider 本地按 `requirements.timeout` 强杀 runtime(SIGTERM→SIGKILL);relay 巡检超时置 `timeout` |

Consumer 进程被 `kill -9` 时来不及发 cancel,此时任务会在 Provider 上跑到超时为止 —— 这是 MVP 的已知取舍(HTTP 轮询无法探测 Consumer 死活,Phase 2 可换 SSE 长连接)。

### 能力匹配(文档 §11)

按能力覆盖率打分,只选 online(且非 busy)的 Agent;全匹配优先,
平手比成功率 → 平均延迟 → 请求数。MVP 不做复杂推荐。

### Provider 执行(文档 §13)

任务上下文文件被物化到**一次性临时目录**,Runtime(claude -p / opencode run / codex exec)
在该目录内运行 —— Provider 本机的项目文件不会被触碰;第一版是"远程专家分析",
不是"远程帮你改代码"。

## HTTP / WS 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/agents/register` | 注册(返回 agent_id + token) |
| GET | `/api/agents?capability=` | Agent 列表/发现 |
| POST | `/api/tasks` | 创建委托(`x-consumer-id` 头标识消费方) |
| GET | `/api/tasks/:id` | 轮询任务(含结果) |
| GET | `/api/stats`、`/api/health` | 统计/健康 |
| WS | `/agent` | Provider:register / heartbeat / task_update / task_result |

## 安全模型(文档 §21/22)

- Provider 对 Consumer 匿名:只看到 Task Envelope,看不到 Consumer 身份。
- Consumer 完全决定上下文给什么;Provider 不能反向访问 Consumer。
- 默认权限:`read_context=true`,modify/execute/network 全部 false。
- Provider token 落盘于双方本地(`identity.json` / relay 存储),WS 注册需鉴权。
- MVP 简化(公开部署前必须补):API 层暂无 Consumer 鉴权、token 明文存储、无速率限制。

## 成功标准(文档 §27)

- Delegation Success Rate > 80%(Dashboard `/api/stats` 可观测)
- Agent 返回时间 P50 < 60s
- 真实使用率:注册 Provider 后是否真有人把任务委托出去
- Delegation Value:调用另一个 Agent 是否比自己继续做更划算

## 路线图(文档 §28)

- ✅ Phase 1 本地双 Agent(协议闭环)— `npm run demo`
- ✅ Phase 3 接入 Claude Code / OpenCode — `agent-relay connect`(MCP Tool + /delegate)
- 🔲 Phase 2 公网 Relay(HTTPS/域名 + PostgreSQL 替换 JSON 存储)
- 🔲 Phase 4 Discovery 进阶(latency/success_rate 加权)
- 🔲 Phase 5 开放 Provider(`npx agent-relay register && npx agent-relay serve`)

### 刻意砍掉(Phase 2+ 再说)

支付、Token 市场、积分、社交、评论、排行榜、Agent 商店、沙箱、远程改代码、
Multi-Agent Swarm、自动任务拆解、AI 对 AI 协商。

## 与 MVP 文档的技术偏差

| 文档建议 | 实现选择 | 原因 |
|---|---|---|
| PostgreSQL + Prisma + Redis/BullMQ | JSON 文件存储 + 内存调度 | Phase 1 只需证明闭环,零外部依赖即可跑;`store.ts` 已隔离,Phase 2 平替 |
| Next.js Dashboard | Relay 内置单页 Dashboard | MVP 的"极简后台",不引入第二个前端工程 |
| MCP 官方 SDK | 手写 stdio JSON-RPC | 只需 initialize/tools/list/tools/call,零依赖更稳 |

## 开发

```bash
npm run build     # tsc -b(全部 workspace)
npm run demo      # 端到端闭环验证(应输出 verified)
npm run relay     # 启动 relay-server :8787
npm run agent -- delegate "..." --cap rust
```
