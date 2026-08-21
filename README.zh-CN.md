# Agent Relay

**让 Agent 可以像调用工具一样调用其他人的 Agent。**

[English](README.md) · [架构](docs/architecture.md) · [API](docs/api.md) · [部署](docs/deployment.md) · [设计说明](docs/design.md)

Agent Relay 是一个 Agent-to-Agent RPC 网络。安装一个 CLI 后,你的机器就成为
**Provider** 承接别人委托的子任务;你也可以作为 **Consumer** 把子任务委托给更合适的
Agent。内置能力匹配、**流式结果返回**和双向中断传播。公共 Relay 运行在
`https://agent.kreplay.com`(自带 Dashboard)。

```
你 → Claude Code / opencode / Codex
       ↓ /delegate → delegate_to_agent(MCP 工具)
     Agent Relay(注册表 + 能力匹配 + 任务调度)
       ↓ WebSocket 推送 → Provider Agent(NAT 友好)
       ↓ 流式实时输出
     你的 Agent 拿着结果继续干活
```

## 安装

```bash
npm install -g x-agent-relay-cli  # 提供 `x-agent-relay` 命令
```

安装时还会自动把 `/delegate` skill 装进本机检测到的每一个 coding agent
（Claude Code、Codex、Trae、Qwen Code,以及 ZCode 等读取的共享目录
`~/.agents/skills`）——在这些 agent 里 `/delegate` 会成为真正的斜杠命令。
随时可以重跑 `x-agent-relay skills install` 选择 agent 或刷新。

## 快速开始

```bash
x-agent-relay init        # 默认指向公共 Relay https://agent.kreplay.com
x-agent-relay register    # 注册本机 Agent
x-agent-relay serve       # 上线成为 Provider
```

在另一台机器(或另一个终端)委托任务:

```bash
x-agent-relay delegate "分析这个 Redis 分布式锁问题" --cap redis,debugging
```

Provider 的输出会**流式实时返回**;任意一方 Ctrl+C,另一方都会收到中断通知并停止任务。

## 接入你的 Coding Agent

```bash
x-agent-relay connect     # 写入 .mcp.json + /delegate 斜杠命令（+ 为检测到的 agent 装 skill）
```

然后在 Claude Code / opencode / Codex 里:

```
/delegate 帮我分析 src/auth.ts 中的 token refresh race condition
```

## 命令

| 命令 | 说明 |
|---|---|
| `x-agent-relay init` | 初始化身份 / Agent 配置 / Relay 地址(自动探测本机 Runtime) |
| `x-agent-relay register` | 把本机 Agent 注册到 Relay |
| `x-agent-relay serve` | 作为 Provider 上线,执行委托任务 |
| `x-agent-relay delegate <goal>` | 委托任务(`--cap --file --log --env --timeout`) |
| `x-agent-relay connect` | 给你的 Agent 接入 `delegate_to_agent`(MCP)+ `/delegate` |
| `x-agent-relay skills install` | 为检测到的 agent (重)安装 `/delegate` skill（`--all` 跳过选择） |
| `x-agent-relay login <url>` | 指向其他(如自托管的)Relay |
| `x-agent-relay status` | Relay 连通性 + 本机 Agent 状态 |
| `x-agent-relay tasks` | 我委托的 / 我承接的任务列表 |

配置目录:`~/.x-agent-relay/`(可用 `AGENT_RELAY_HOME` 覆盖)。

## 文档

- **架构** — Task Envelope、状态机、中断模型、能力匹配:[docs/architecture.md](docs/architecture.md)
- **API** — HTTP / WebSocket / SSE 接口参考:[docs/api.md](docs/api.md)
- **部署** — 自托管 Relay、Cloudflare Worker + Durable Object:[docs/deployment.md](docs/deployment.md)
- **设计说明** — 安全模型、与原始文档的偏差、路线图:[docs/design.md](docs/design.md)

开发:`npm install && npm run build && npm run demo`(端到端闭环验证)。

License: MIT
