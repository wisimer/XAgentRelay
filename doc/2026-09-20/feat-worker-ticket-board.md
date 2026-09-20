# feat: Cloudflare Worker 版补齐工单 API(alarm 驱动)

- 时间:2026-09-20 15:04:07
- 范围:apps/relay-worker(hub.ts、routes.ts)、docs/api.md

## 背景

上一任务(feat-ticket-board-auto-processing)只实现了 Node 版 relay-server 的工单板,Worker 版 dashboard 因 `/api/tickets` 404 自动隐藏问题板区块。本任务基于预留的 `TicketBackend` 接口补齐 Worker 实现。

## 实现

### hub.ts(RelayHub Durable Object)

- 新增 `tickets` Map + `ticket:` 前缀 KV 持久化,load 时截断保留最近 1000 条(对齐 task 的 MAX_TASKS 模式);
- 补齐 Store 形态的工单方法:`createTicket/getTicket/updateTicket/listTickets`,以及 `newTaskId()`(Workers 无 node:crypto,走 ./ids 的 Web Crypto 版);
- `RelayHub implements TicketBackend`:TS 结构化校验,与 Node 版共享 `processTickets()` 自动化逻辑(sync + dispatch)零复制;
- `alarm()` 中接入 `processTickets(this, listTickets())`:工单 worker 与 sweeper 共用 DO alarm(10s 周期,Node 版是独立 3s 定时器)。alarm 本来就会唤醒 DO,不增加额外唤醒成本;代价是 todo 工单派发延迟最多 ~10s。

### routes.ts

- `RelayBackend` 接口扩展工单四方法;
- 新增 `POST/GET /api/tickets`、`GET/PATCH /api/tickets/:id`,逐行对齐 Node 版 api.ts,包括关键语义:手动改状态 stamp `syncedTaskId` 消费未处理的任务结果(手动变更优先于自动化)、重开 todo 重置 attempts。

Dashboard 无需改动:Worker 版 `/api/tickets` 就绪后,问题板区块自动从隐藏变为显示。

## 验证

- `npm run build` 通过(`implements TicketBackend` 提供编译期结构校验);
- `wrangler dev --port 8795` 本地实测:provider 上线 → 创建工单 → alarm 自动派发(17s 内含 10s alarm 周期)→ inreview + note=summary → 手动 PATCH done,全链路通过;dashboard HTML 含 ticketsWrap。

## 未部署

`npm run deploy:cloud` 会发布到生产(agent.kreplay.com),按红线规则需项目所有者确认后执行。

## 设计说明

- 派发节奏差异:Node 3s vs Worker 10s,是有意取舍(DO alarm 唤醒有成本);对工单场景 10s 延迟无感;
- 两份实现继续通过共享 relay-core 的 `processTickets` + 协议类型保持对齐,业务逻辑只有一份。
