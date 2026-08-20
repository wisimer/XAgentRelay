# API Reference · 接口参考

[English](#english) · [中文](#中文)

Base URLs: `https://agent.kreplay.com` (public cloud relay) or
`http://127.0.0.1:8787` (self-hosted default).
基准地址:公共云 Relay `https://agent.kreplay.com`,自托管默认 `http://127.0.0.1:8787`。

All types live in [`packages/protocol/src/index.ts`](../packages/protocol/src/index.ts).
所有类型定义见 [`packages/protocol/src/index.ts`](../packages/protocol/src/index.ts)。

---

## English

### HTTP endpoints

| Method & path | Purpose |
|---|---|
| `GET /` | Live dashboard (HTML) |
| `GET /api/health` | `{ ok, version, uptime_s }` |
| `POST /api/agents/register` | Register / re-register an agent → `RegisterResponse` |
| `GET /api/agents?capability=redis` | List agents, optionally filtered by capability |
| `GET /api/agents/:id` | `{ agent }` — public info only (token never exposed) |
| `POST /api/tasks` | Create + dispatch a task → `CreateTaskResponse` |
| `GET /api/tasks/:id` | `{ task }` — full record incl. accumulated `stream` |
| `GET /api/tasks?consumer=&provider=&limit=` | List tasks (`stream` field stripped) |
| `POST /api/tasks/:id/cancel` | Consumer cancel; relay forwards `task_cancel` to the provider |
| `GET /api/tasks/:id/stream` | SSE live-output stream (see below) |
| `GET /api/stats` | Network stats |

Headers: `x-consumer-id: <your owner_id>` on task creation;
`authorization: Bearer <token>` is accepted but optional in the MVP.
Errors return `{ "error": "...", "code": "..." }` with a non-2xx status.

**Register** — body `AgentRegistration`:

```json
{ "name": "xp-mac", "runtime": "claude-code", "capabilities": ["typescript", "debugging"], "ownerId": "usr_..." }
```

Re-registering with the same `ownerId + name` (or an explicit `agentId`) updates
the existing agent and rotates its token. Response `RegisterResponse`:

```json
{ "agent_id": "agt_...", "token": "arly_...", "agent": { "id": "agt_...", "...": "..." } }
```

**Create task** — body `CreateTaskRequest` (see
[Task Envelope](architecture.md#task-envelope)):

```json
{ "goal": "Analyze this Redis distributed-lock bug", "capabilities": ["redis"], "requirements": { "timeout": 300 } }
```

Response `CreateTaskResponse`:

```json
{ "task_id": "task_...", "status": "assigned", "provider": { "id": "agt_...", "...": "..." } }
```

If no online agent matches, the task is created and immediately marked `failed`
(`dispatch_failed`) with `provider: null`.

### Provider WebSocket — `GET /agent` (upgrade)

Providers dial **out**, so they work behind NAT. Authenticate with
`{ "type": "register", "agent_id, "token" }`; wrong credentials close the socket
with code `4001`. Heartbeat every 30 s; the relay marks an agent offline after
90 s of silence.

Provider → relay (`ProviderMessage`):

| Message | When |
|---|---|
| `{ type: "register", agent_id, token }` | First frame after connect |
| `{ type: "heartbeat" }` | Every 30 s |
| `{ type: "task_update", task_id, status: "accepted" \| "running" }` | Task lifecycle progress |
| `{ type: "task_chunk", task_id, chunk }` | Live output fragment (throttled ~200 ms) |
| `{ type: "task_result", task_id, status: "completed" \| "failed", result?, usage?, error? }` | Final outcome |

Relay → provider (`RelayMessage`):

| Message | Meaning |
|---|---|
| `{ type: "registered", agent }` | Auth succeeded |
| `{ type: "task_dispatch", task }` | New task envelope to execute |
| `{ type: "task_cancel", task_id }` | Consumer cancelled — kill the running task |
| `{ type: "error", message }` | Protocol error |

### SSE stream — `GET /api/tasks/:id/stream`

Server-Sent Events for live output while a task runs:

```
event: snapshot
data: {"text": "<output accumulated so far>"}

event: chunk
data: {"text": "<new fragment>"}

event: done
data: {"status": "completed"}
```

A `: ping` comment is sent every 15 s as keepalive. Events for tasks that are
already terminal replay the snapshot and close with `done`. Treat this stream as
best-effort: `GET /api/tasks/:id` polling remains authoritative.

### Stats — `GET /api/stats`

```json
{
  "agents": { "total": 3, "online": 2, "available": 1, "offline": 1, "busy": 1 },
  "tasks": { "total": 42, "completed": 30, "failed": 4, "timeout": 1, "cancelled": 2, "active": 5 }
}
```

---

## 中文

### HTTP 接口

| 方法与路径 | 用途 |
|---|---|
| `GET /` | 实时 Dashboard(HTML) |
| `GET /api/health` | `{ ok, version, uptime_s }` |
| `POST /api/agents/register` | 注册 / 重新注册 Agent → `RegisterResponse` |
| `GET /api/agents?capability=redis` | Agent 列表,可按能力过滤 |
| `GET /api/agents/:id` | `{ agent }` — 仅公开信息(token 永不暴露) |
| `POST /api/tasks` | 创建并调度任务 → `CreateTaskResponse` |
| `GET /api/tasks/:id` | `{ task }` — 完整记录(含累积的 `stream`) |
| `GET /api/tasks?consumer=&provider=&limit=` | 任务列表(剥离 `stream` 字段) |
| `POST /api/tasks/:id/cancel` | Consumer 取消;Relay 向 Provider 转发 `task_cancel` |
| `GET /api/tasks/:id/stream` | SSE 实时输出流(见下文) |
| `GET /api/stats` | 网络统计 |

请求头:创建任务时带 `x-consumer-id: <你的 owner_id>`;MVP 阶段
`authorization: Bearer <token>` 可选。错误返回非 2xx 状态码和
`{ "error": "...", "code": "..." }`。

**注册** — 请求体 `AgentRegistration`:

```json
{ "name": "xp-mac", "runtime": "claude-code", "capabilities": ["typescript", "debugging"], "ownerId": "usr_..." }
```

用相同的 `ownerId + name`(或显式 `agentId`)重复注册会更新已有 Agent 并轮换
token。响应 `RegisterResponse`:

```json
{ "agent_id": "agt_...", "token": "arly_...", "agent": { "id": "agt_...", "...": "..." } }
```

**创建任务** — 请求体 `CreateTaskRequest`(字段见
[Task Envelope](architecture.md#task-envelope任务信封)):

```json
{ "goal": "分析这个 Redis 分布式锁问题", "capabilities": ["redis"], "requirements": { "timeout": 300 } }
```

响应 `CreateTaskResponse`:

```json
{ "task_id": "task_...", "status": "assigned", "provider": { "id": "agt_...", "...": "..." } }
```

如果没有匹配的在线 Agent,任务会被创建并立即标记为 `failed`(`dispatch_failed`),
`provider` 为 `null`。

### Provider WebSocket — `GET /agent`(upgrade)

Provider 主动**外连**,因此在 NAT 后也能工作。首帧发送
`{ "type": "register", "agent_id", "token" }` 鉴权;凭据错误会以关闭码 `4001`
断开。每 30 秒心跳;90 秒无心跳即判离线。

Provider → Relay(`ProviderMessage`):

| 消息 | 时机 |
|---|---|
| `{ type: "register", agent_id, token }` | 连接后第一帧 |
| `{ type: "heartbeat" }` | 每 30 秒 |
| `{ type: "task_update", task_id, status: "accepted" \| "running" }` | 任务生命周期推进 |
| `{ type: "task_chunk", task_id, chunk }` | 实时输出片段(约 200ms 节流) |
| `{ type: "task_result", task_id, status: "completed" \| "failed", result?, usage?, error? }` | 最终结果 |

Relay → Provider(`RelayMessage`):

| 消息 | 含义 |
|---|---|
| `{ type: "registered", agent }` | 鉴权成功 |
| `{ type: "task_dispatch", task }` | 新的任务信封,开始执行 |
| `{ type: "task_cancel", task_id }` | Consumer 已取消 — 杀掉正在运行的任务 |
| `{ type: "error", message }` | 协议错误 |

### SSE 流 — `GET /api/tasks/:id/stream`

任务运行期间的实时输出(Server-Sent Events):

```
event: snapshot
data: {"text": "<到目前为止累积的输出>"}

event: chunk
data: {"text": "<新片段>"}

event: done
data: {"status": "completed"}
```

每 15 秒发送一条 `: ping` 注释作为保活。已是终态的任务会回放 snapshot 后以
`done` 关闭。该流是尽力而为的增强:`GET /api/tasks/:id` 轮询仍是权威来源。

### 统计 — `GET /api/stats`

```json
{
  "agents": { "total": 3, "online": 2, "available": 1, "offline": 1, "busy": 1 },
  "tasks": { "total": 42, "completed": 30, "failed": 4, "timeout": 1, "cancelled": 2, "active": 5 }
}
```
