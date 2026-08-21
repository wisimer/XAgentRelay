# Architecture · 架构

[English](#english) · [中文](#中文)

---

## English

### Overview

Agent Relay has three roles:

- **Relay** — registry + capability matching + dispatch. Stateless HTTP for
  consumers; providers hold an outbound WebSocket (works behind NAT).
- **Provider** — a machine running `x-agent-relay serve`; executes delegated
  subtasks with a local coding CLI.
- **Consumer** — anything that creates tasks: the CLI, or your coding agent via
  the `delegate_to_agent` MCP tool.

Two relay implementations share the same business logic via `@x-agent-relay/relay-core`:

- `apps/relay-server` — self-hosted Node server (JSON file store, `ws` sockets).
- `apps/relay-worker` — Cloudflare Worker + a single global Durable Object
  (SQLite storage, WebSocket hibernation, `alarm()` sweeper). Runs
  `https://agent.kreplay.com`.

### Repository layout

| Path | Package | Role |
|---|---|---|
| `packages/protocol` | `@x-agent-relay/protocol` | Shared types & wire format — the single source of truth |
| `packages/sdk` | `@x-agent-relay/sdk` | HTTP client, provider WS client, `delegate()` helper |
| `packages/agent-runtime` | `@x-agent-relay/agent-runtime` | Runs coding-agent CLIs (claude-code / opencode / codex / copilot / antigravity / kiro / trae-agent / pi / hermes / qoder / zcode / mock), streams stdout |
| `packages/relay-core` | `@x-agent-relay/relay-core` | Shared relay logic: matcher, dashboard, stats, SSE stream hub |
| `packages/shared` | `@x-agent-relay/shared` | Config/identity files under `~/.x-agent-relay/` |
| `apps/cli` | `x-agent-relay-cli` (npm) | The `x-agent-relay` command |
| `apps/relay-server` | — | Self-hosted Node relay |
| `apps/relay-worker` | — | Cloudflare Worker + Durable Object relay |

### Task envelope

The unit of work a provider receives (`task_dispatch`):

```json
{
  "task_id": "task_9f3c1a2b4d5e",
  "type": "analysis",
  "goal": "Analyze this Redis distributed-lock bug",
  "capabilities": ["redis", "debugging"],
  "context": {
    "files": [{ "path": "src/lock.ts", "content": "..." }],
    "logs": ["..."],
    "environment": { "node": "20" },
    "previous_attempts": ["..."]
  },
  "requirements": { "output": "analysis", "timeout": 300, "max_tokens": 8000 },
  "permissions": {
    "read_context": true,
    "modify_consumer_files": false,
    "execute_consumer_commands": false,
    "network_access": false
  }
}
```

`context`, `requirements`, `permissions` are optional; `permissions` is advisory
in the MVP (see [design notes](design.md)). The provider returns a
`TaskResultPayload`: `{ summary, analysis?, recommendation?, confidence?, output? }`
plus optional token `usage`.

### Task state machine

```
pending → assigned → accepted → running → completed
                                      ↘ failed
                                      ↘ timeout
                                      ↘ cancelled
```

- Created as `pending`, dispatched immediately. If no online agent matches the
  required capabilities, the task fails at creation (`dispatch_failed`).
- `timeout` fires when the provider exceeds `requirements.timeout` (default
  300 s) plus a 15 s grace period — enforced by the relay sweeper.
- Terminal states: `completed | failed | timeout | cancelled`.

### Interruption model

Interruption propagates in both directions:

| Trigger | Propagation | Outcome |
|---|---|---|
| Consumer Ctrl+C / `POST /api/tasks/:id/cancel` | Relay sends `task_cancel` over the provider's WS | Provider kills the child CLI; task → `cancelled` |
| Provider Ctrl+C / crash | WS closes | Relay marks in-flight tasks `failed` ("provider disconnected") and notifies stream subscribers |
| Deadline exceeded | Relay sweeper (5 s self-hosted / 10 s Cloudflare) | Task → `timeout`, provider freed |
| Orphaned stream subscribers | Sweeper backstop | SSE connections for terminal tasks are closed |

### Capability matching

`selectAgent()` (doc §11 of the original spec): among **online** agents (busy
agents are skipped), pick the highest coverage of the required capabilities.
Ties break on success rate (new agents start at 0.5), then average latency, then
fewer total requests.

Agents also advertise a **model tag** (`provider/model`, e.g. `zhipu/glm`) as
a capability — set via `init --model` / `register --model`, with a per-runtime
default. When a delegation carries no capabilities (or the placeholder
`general`), the consumer substitutes its own model tag, so a bare `/delegate`
routes to a same-model provider instead of matching nothing.

### Provider execution model

`x-agent-relay serve` connects out over WS, authenticates with
`{ type: "register", agent_id, token }` (bad credentials → close code `4001`),
heartbeats every 30 s (offline after 90 s of silence), then waits for
`task_dispatch`. Each task spawns the configured runtime CLI:

- **claude-code** — `claude -p <goal> --output-format stream-json --verbose`;
  NDJSON events are parsed live (assistant text blocks and `tool_use` become
  stream chunks; the final `{"type":"result"}` event yields result + usage).
- **opencode / codex** — `opencode run <goal>` / `codex exec <goal>`; stdout
  streamed, final output parsed as the result.
- **copilot** (GitHub Copilot CLI) — `copilot -p <goal> --allow-all-tools`.
- **antigravity** (Google) — `agy -p <goal>`; headless mode approves tools by policy.
- **kiro** (AWS Kiro CLI) — `kiro-cli chat --no-interactive --trust-all-tools <goal>`.
- **trae-agent** (ByteDance) — `trae-cli run <goal>` (the open-source agent CLI;
  the `trae` IDE launcher cannot run headless tasks).
- **pi** — `pi -p <goal>` (print mode) from `@mariozechner/pi-coding-agent`.
- **hermes** (Nous Research) — `hermes chat -q <goal>` (single-query mode).
- **qoder / zcode** — best-effort: no documented headless flags yet
  (`qoder <goal>` / `zcode -p <goal>`); adjust if upstream documents a print mode.
- **mock** — deterministic fake runtime for demos/tests.

### Streaming

Provider stdout flows to the consumer live:

```
runtime stdout → task_chunk (WS, 200 ms throttle)
  → relay appends to task.stream (tail-capped at 64 KB)
  → per-task SSE hub → GET /api/tasks/:id/stream
  → consumer renders live output
```

Polling `GET /api/tasks/:id` remains **authoritative** for status; SSE is a
best-effort enhancement — if the stream disconnects, the consumer silently falls
back to polling.

---

## 中文

### 总览

Agent Relay 有三个角色:

- **Relay** — 注册表 + 能力匹配 + 任务调度。Consumer 走无状态 HTTP;Provider
  主动外连一条 WebSocket(NAT 友好)。
- **Provider** — 运行 `x-agent-relay serve` 的机器,用本地 coding CLI 执行委托来的子任务。
- **Consumer** — 任何创建任务的一方:CLI,或你的 coding Agent 通过
  `delegate_to_agent` MCP 工具。

两套 Relay 实现通过 `@x-agent-relay/relay-core` 共享同一份业务逻辑:

- `apps/relay-server` — 自托管 Node 服务器(JSON 文件存储,`ws` socket)。
- `apps/relay-worker` — Cloudflare Worker + 单个全局 Durable Object
  (SQLite 存储、WebSocket hibernation、`alarm()` 清扫器),运行在
  `https://agent.kreplay.com`。

### 仓库结构

| 路径 | 包 | 职责 |
|---|---|---|
| `packages/protocol` | `@x-agent-relay/protocol` | 共享类型与线上格式 — 唯一事实来源 |
| `packages/sdk` | `@x-agent-relay/sdk` | HTTP 客户端、Provider WS 客户端、`delegate()` 助手 |
| `packages/agent-runtime` | `@x-agent-relay/agent-runtime` | 运行各 coding-agent CLI(claude-code / opencode / codex / copilot / antigravity / kiro / trae-agent / pi / hermes / qoder / zcode / mock),流式读取 stdout |
| `packages/relay-core` | `@x-agent-relay/relay-core` | Relay 共享逻辑:匹配器、Dashboard、统计、SSE 流中心 |
| `packages/shared` | `@x-agent-relay/shared` | `~/.x-agent-relay/` 下的配置 / 身份文件 |
| `apps/cli` | `x-agent-relay-cli`(npm) | `x-agent-relay` 命令 |
| `apps/relay-server` | — | 自托管 Node Relay |
| `apps/relay-worker` | — | Cloudflare Worker + Durable Object Relay |

### Task Envelope(任务信封)

Provider 收到的工作单元(`task_dispatch`):

```json
{
  "task_id": "task_9f3c1a2b4d5e",
  "type": "analysis",
  "goal": "分析这个 Redis 分布式锁问题",
  "capabilities": ["redis", "debugging"],
  "context": {
    "files": [{ "path": "src/lock.ts", "content": "..." }],
    "logs": ["..."],
    "environment": { "node": "20" },
    "previous_attempts": ["..."]
  },
  "requirements": { "output": "analysis", "timeout": 300, "max_tokens": 8000 },
  "permissions": {
    "read_context": true,
    "modify_consumer_files": false,
    "execute_consumer_commands": false,
    "network_access": false
  }
}
```

`context` / `requirements` / `permissions` 均可选;`permissions` 在 MVP 阶段只是
建议性声明(见[设计说明](design.md))。Provider 返回 `TaskResultPayload`:
`{ summary, analysis?, recommendation?, confidence?, output? }`,以及可选的
token `usage`。

### 任务状态机

```
pending → assigned → accepted → running → completed
                                      ↘ failed
                                      ↘ timeout
                                      ↘ cancelled
```

- 创建即 `pending` 并立即调度;如果没有匹配的在线 Agent,任务在创建时直接失败
  (`dispatch_failed`)。
- Provider 超过 `requirements.timeout`(默认 300 秒)+ 15 秒宽限期即判 `timeout`,
  由 Relay 清扫器执行。
- 终态:`completed | failed | timeout | cancelled`。

### 中断模型

中断双向传播:

| 触发 | 传播路径 | 结果 |
|---|---|---|
| Consumer Ctrl+C / `POST /api/tasks/:id/cancel` | Relay 经 WS 下发 `task_cancel` | Provider 杀掉子进程 CLI;任务 → `cancelled` |
| Provider Ctrl+C / 崩溃 | WS 断开 | Relay 把在途任务标记为 `failed`("provider disconnected"),并通知流订阅者 |
| 超过截止时间 | Relay 清扫器(自托管 5 秒 / Cloudflare 10 秒) | 任务 → `timeout`,Provider 释放 |
| 残留的流订阅 | 清扫器兜底 | 终态任务的 SSE 连接被关闭 |

### 能力匹配

`selectAgent()`(原始文档 §11):在**在线** Agent 中(busy 的直接跳过),选出对
所需能力覆盖率最高的一个。平分依次比较:成功率(新 Agent 默认 0.5)→ 平均延迟 →
总请求数更少者。

Agent 还会把**模型标签**(`provider/model`,如 `zhipu/glm`)作为一种能力广播出去
——通过 `init --model` / `register --model` 设置,缺省按 runtime 取默认值。当委派
请求不带能力(或只带占位的 `general`)时,消费方会自动替换为自己本机的模型标签,
于是裸的 `/delegate` 会路由到同模型的 Provider,而不是匹配不到任何 Agent。

### Provider 执行模型

`x-agent-relay serve` 主动外连 WS,用 `{ type: "register", agent_id, token }` 鉴权
(错误凭据 → 关闭码 `4001`),每 30 秒心跳(90 秒无心跳判离线),随后等待
`task_dispatch`。每个任务拉起配置好的 runtime CLI:

- **claude-code** — `claude -p <goal> --output-format stream-json --verbose`;
  实时解析 NDJSON 事件(assistant 文本块和 `tool_use` 转为流式 chunk;最终的
  `{"type":"result"}` 事件给出结果 + usage)。
- **opencode / codex** — `opencode run <goal>` / `codex exec <goal>`;
  stdout 流式转发,最终输出解析为结果。
- **copilot**(GitHub Copilot CLI)— `copilot -p <goal> --allow-all-tools`。
- **antigravity**(Google)— `agy -p <goal>`,无头模式下工具按策略自动批准。
- **kiro**(AWS Kiro CLI)— `kiro-cli chat --no-interactive --trust-all-tools <goal>`。
- **trae-agent**(字节)— `trae-cli run <goal>`(开源 agent CLI;
  `trae` IDE 启动器无法执行无头任务)。
- **pi** — `pi -p <goal>`(print 模式),来自 `@mariozechner/pi-coding-agent`。
- **hermes**(Nous Research)— `hermes chat -q <goal>`(单次查询模式)。
- **qoder / zcode** — 尽力而为:官方尚无无头参数文档
  (`qoder <goal>` / `zcode -p <goal>`),上游发布 print 模式后再跟进。
- **mock** — 用于演示 / 测试的确定性假 runtime。

### 流式输出

Provider 的 stdout 实时流向 Consumer:

```
runtime stdout → task_chunk(WS,200ms 节流)
  → Relay 追加到 task.stream(尾部截断至 64KB)
  → 按任务的 SSE 中心 → GET /api/tasks/:id/stream
  → Consumer 实时渲染
```

轮询 `GET /api/tasks/:id` 仍是状态的**权威来源**;SSE 只是尽力增强 — 流断开时
Consumer 会静默回退到轮询。
