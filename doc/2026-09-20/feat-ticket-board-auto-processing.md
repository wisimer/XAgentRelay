# feat: 网页问题板 — 自动派发 agent coding 处理 + 状态流转

- 时间:2026-09-20 14:57:07
- 范围:packages/protocol、packages/relay-core、apps/relay-server、dashboard、docs

## 需求

用户在网页(dashboard)上提交 bug / 问题 / 建议;server 持续监听所有工单,自动派发给 agent 做 coding 处理并更新状态。工单三个状态:Todo、InReview、Done;用户可手动更新状态、手动分配给指定 agent。

## 方案

### 数据模型(packages/protocol)

`TicketRecord`:`id/title/description/kind(bug|issue|suggestion)/status(todo|inreview|done)/assignedAgentId/taskIds[]/attempts/reporter/note/syncedTaskId`。
新增常量 `TICKET_MAX_ATTEMPTS=3`、`TICKET_TASK_TIMEOUT_S=900`。

### 状态机(关键设计决策)

```
todo ──派发──> inreview ──任务完成──> inreview(停在 InReview,由人确认 Done)
 ^                  |
 +──任务失败/超时/取消──+  (note 记录错误;自动重试最多 3 次后停在 todo)
```

任务完成停在 InReview 而非自动 Done:provider 的 coding agent 在临时沙箱执行,产出是 patch/分析文本,需要人审核后再标 Done——InReview 即"等人工审核"。失败自动退回 Todo 重试(≤3 次),防止无限循环。

### 共享自动化逻辑(packages/relay-core/src/tickets.ts)

`processTickets(backend, tickets)` 一趟两阶段:
1. sync:把最新 task 的终态结果折回工单(completed → inreview + note=summary;failed → todo + note=error),用 `syncedTaskId` 保证只应用一次;
2. dispatch:对 todo 工单选 agent(手动 assignedAgentId 优先,否则 `selectAgent` 空能力集匹配任意在线 agent),创建 `type:"ticket"` 任务并派发,工单转 inreview、attempts+1。

`TicketBackend` 接口由 Node 版 Store+AgentConnections 适配(预留 Worker 版复用)。

### relay-server

- store.ts:工单 CRUD + 持久化到 relay.json(保留最近 1000 条);
- api.ts:`POST/GET /api/tickets`、`GET/PATCH /api/tickets/:id`;手动改状态会消费未处理的任务结果(stamp syncedTaskId),保证手动变更不被迟到的 sync 覆盖;重开(todo)重置 attempts;
- index.ts:ticket worker 定时器(默认 3s,`TICKET_WORKER_MS` 可调)。

### Dashboard(relay-core/dashboard.ts)

问题板表单(kind/title/description/agent 下拉)+ 表格(标题、状态三按钮 Todo/InReview/Done、agent 分配下拉、最新 task 与状态、attempts/3、创建时间、note tooltip)。轮询 2s,JSON diff 跳过相同渲染避免下拉被重置;`/api/tickets` 404 时整个区块隐藏(Worker 版 dashboard 优雅降级)。

## 验证

- `npm run build` 通过;
- `node scripts/demo-tickets.mjs`(新增,4 个用例全过):自动派发→inreview、手动 done/重开重派、手动分配路由到指定 agent、失败回退 todo;
- `npm run demo` 原闭环回归通过;
- dashboard 内联 JS `node --check` 语法通过,API 手测 create/list/patch/400 正常。

## 测试发现并修复的问题

手动 re-open 后,旧已完成任务的迟到 sync 会把工单强行翻回 inreview(覆盖用户操作)。修复:PATCH 状态时 stamp `syncedTaskId`,手动变更消费掉 pending 的任务结果。

## 已知边界

- Cloudflare Worker 版(apps/relay-worker)未实现工单 API,dashboard 在其上自动隐藏问题板;后续可基于 `TicketBackend` 接口补齐(alarm 驱动);
- 无重试退避(最多少量 3 次);无鉴权(与现有 API 一致,MVP 阶段)。
