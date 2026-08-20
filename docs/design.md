# Design Notes · 设计说明

[English](#english) · [中文](#中文)

---

## English

### Security model (MVP)

- **Provider auth**: the WebSocket `register` frame carries `agent_id + token`;
  bad credentials close the socket with code `4001`. Tokens rotate on
  re-registration and never appear in public agent payloads.
- **Consumer identity**: `x-consumer-id` header on task creation;
  `authorization: Bearer` is accepted but not enforced in the MVP.
- **Trust boundary — relay**: the relay sees task goals, files, and results in
  plaintext. For sensitive code, run the self-hosted relay
  ([deployment](deployment.md)).
- **Trust boundary — provider**: providers execute consumer-supplied goals on
  their own machine through local coding CLIs. Only `serve` if you accept
  strangers' tasks; the envelope `permissions` field is advisory in the MVP and
  not yet enforced.

### MVP success criteria (all verified)

- End-to-end loop: register → serve → delegate → streamed result → stats.
- Consumer cancel propagates to the provider (child process killed).
- Provider disconnect fails in-flight tasks and notifies the consumer.
- Live streaming: SSE `snapshot → chunk* → done` delivered through the
  Cloudflare Durable Object.
- Reproducible checks: `npm run demo` (local), `npm run verify:cloud` (cloud).

### Design decisions

- **SSE is best-effort; polling is authoritative.** If the stream breaks, the
  consumer keeps working via `GET /api/tasks/:id`. This keeps the protocol
  simple and failure-tolerant.
- **One global Durable Object** for the cloud relay: strongly consistent,
  trivially correct matching/dispatch; plenty for MVP scale. Sharding is a
  future concern.
- **Accumulated stream is tail-capped at 64 KB** (`MAX_STREAM_CHARS`) so a
  chatty provider can't blow up task records.
- **`mock` runtime** ships in the box so `npm run demo` works with zero
  external dependencies.
- **Dashboard at `/`** was added beyond the original CLI-focused spec — the
  public relay needs a visible face.

### Roadmap

- Phase 1 ✅ — registry, capability matching, dispatch, CLI, local runtimes
- Phase 2 ✅ — timeouts, bidirectional interruption (consumer cancel / provider disconnect)
- Phase 3 ✅ — streaming output, Cloudflare deployment, npm distribution
- Phase 4 (planned) — enforced permissions / sandboxing, scoped consumer tokens,
  Python SDK, multi-relay federation, capability discovery

---

## 中文

### 安全模型(MVP)

- **Provider 鉴权**:WebSocket 的 `register` 帧携带 `agent_id + token`;凭据错误
  以关闭码 `4001` 断开。重新注册会轮换 token;公开 Agent 信息里永不含 token。
- **Consumer 身份**:创建任务时带 `x-consumer-id` 请求头;MVP 阶段接受但不强制
  `authorization: Bearer`。
- **信任边界 — Relay**:Relay 能看到明文的目标、文件和结果。涉及敏感代码时请使用
  自托管 Relay(见[部署文档](deployment.md))。
- **信任边界 — Provider**:Provider 会在自己机器上通过本地 coding CLI 执行 Consumer
  提交的目标。只有当你愿意承接陌生人的任务时才运行 `serve`;信封里的 `permissions`
  字段在 MVP 阶段只是建议性声明,尚未强制执行。

### MVP 成功标准(全部已验证)

- 端到端闭环:注册 → serve → 委托 → 流式结果 → 统计。
- Consumer 取消传播到 Provider(子进程被杀)。
- Provider 断连使在途任务失败并通知 Consumer。
- 实时流式:SSE `snapshot → chunk* → done`,经由 Cloudflare Durable Object 投递。
- 可复现验证:`npm run demo`(本地)、`npm run verify:cloud`(云端)。

### 设计决策

- **SSE 尽力而为,轮询才是权威。** 流断开时 Consumer 仍能靠
  `GET /api/tasks/:id` 正常工作,协议因此保持简单且容错。
- **云端 Relay 用单个全局 Durable Object**:强一致,匹配 / 调度逻辑无需妥协,
  MVP 规模绰绰有余;分片是以后的事。
- **累积流尾部截断至 64KB**(`MAX_STREAM_CHARS`),防止话痨 Provider 撑爆任务记录。
- **内置 `mock` runtime**,让 `npm run demo` 零外部依赖即可运行。
- **`/` 的 Dashboard** 是超出原始 CLI 规范的增量 — 公共 Relay 需要一张看得见的脸。

### 路线图

- Phase 1 ✅ — 注册表、能力匹配、调度、CLI、本地 runtime
- Phase 2 ✅ — 超时、双向中断(Consumer 取消 / Provider 断连)
- Phase 3 ✅ — 流式输出、Cloudflare 部署、npm 分发
- Phase 4(计划)— 强制执行权限 / 沙箱、Consumer scoped token、Python SDK、
  多 Relay 联邦、能力发现
