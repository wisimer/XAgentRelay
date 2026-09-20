# feat: serve 工作区模式 + 工单看板独立页面

时间：2026-09-20 16:04:04

## 需求

1. `x-agent-relay serve` 以启动目录为工作区：任务全部在该目录（含子目录）下以读写权限执行；同一台机器可同时跑多个 serve（每个目录一个），互不干扰。
2. 前端工单功能拆成独立页面：首页加跳转链接；新页面按 Todo / In Review / Done 三列看板展示，每列可弹窗新增工单，页面顶部保留原快速添加表单。

## 改动

### 1. 工作区模式（workspace）

- `packages/agent-runtime/src/runtimes.ts`
  - `RunOptions` 新增 `cwd`。设置时 runtime 直接在该目录执行（读写）；未设置时维持原来的临时目录沙箱（只读分析）。
  - `runTask` 拆出共享的 `runInDir`；workspace 模式不再把 consumer 的 context 文件写进工作区（内容已嵌在 prompt 里），避免污染仓库。
- `packages/agent-runtime/src/prompt.ts`
  - `buildTaskPrompt(task, { workspace })`：workspace 模式下提示词改为"工作目录为 X，对其及子目录有读写权限，直接在其中改代码/跑验证"；产出格式要求改为"改动摘要 + 触及文件 + 验证方式"。
- `apps/cli/src/commands/serve.ts`
  - `--cwd <path>`（默认 `process.cwd()`）、`--name` 选项。
  - **每工作区独立 agent**：凭据存 `~/.x-agent-relay/workspaces/<dirname>-<sha1(abs)[:8]>.json`，agent 名默认 `<profile.name>@<dirname>`。这是多实例共存的关键——原实现共享全局 `agent_id`，第二个 serve 会把第一个的 WS 顶掉（`connections.attach` 关旧连接）无限互踢。
  - 同目录互斥锁：状态文件记录 pid，启动时若发现存活同名 serve 直接拒绝；SIGINT/SIGTERM 释放（pid 置 0）。
  - 注册失败（relay 数据被清）自动落回新建 agent。全局 `identity.json` 不再被 serve 改写，delegate 等消费侧身份不受影响。

### 2. 工单独立页面

- `packages/relay-core/src/dashboard.ts`
  - 首页：去掉工单表格及全部工单 JS；hero 右上导航加 "Ticket Board →"；原工单区替换为跳转卡片（实时显示 todo/in review/done 计数）。
  - 新增导出 `ticketsHtml`：`/tickets` 看板页。三列（Todo / In Review / Done）各带 "+" 按钮 → 弹窗新增（标题/描述/类型/agent，直接落到该列）；顶部保留原快速添加表单（默认落 Todo，触发自动派发）；卡片支持状态流转按钮、agent 改派、note/task/attempts 展示；2s 轮询 + 内容指纹去重避免打断下拉框/弹窗。
- `packages/protocol`：`CreateTicketRequest.status?: TicketStatus`。
- `apps/relay-server`（store.ts / api.ts）与 `apps/relay-worker`（hub.ts / routes.ts）：`createTicket` 支持初始 status（校验合法值），两端都加 `GET /tickets` 页面路由。
  - 注意：直接建到 inreview/done 不会被自动派发（worker 只派发 todo）。

## 验证（本地 e2e，mock runtime）

- 两个目录同时 `serve` → 两个独立 agent（`tester@ws1` / `tester@ws2`）同时 online，无互踢。
- delegate 任务 → completed；工单自动派发 → dispatched → inreview，日志显示 `running ... in workspace (read-write)`。
- 同目录第二个 serve → 正确拒绝（pid 锁）；SIGTERM 后 pid 释放为 0。
- `/tickets` 200、三列渲染；`POST /api/tickets {"status":"done"}` 直建成功；非法 status 400；首页无残留 ticketsWrap、有 2 处跳转链接。
- `npm run build` 通过（node server + worker + cli + packages 全量 tsc）。

## 行为变化提示

- serve 现在不再要求先跑过 `register`（有 `init` 的 profile 即可），但会额外注册一个 workspace agent。
- 真实 runtime（claude-code 等）在 workspace 模式下拥有该目录读写权限，只应在信任的目录启动。
