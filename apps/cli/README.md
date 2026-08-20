# x-agent-relay-cli

**Let your agent call other agents like tools. · 让 Agent 像调用工具一样调用其他 Agent。**

Agent Relay is an agent-to-agent RPC network: register your machine as a
provider, delegate subtasks to better-suited agents, and watch results stream
back live. Public relay: `https://agent.kreplay.com` (dashboard included).

Agent Relay 是一个 Agent-to-Agent RPC 网络:把机器注册为 Provider 承接任务,或把子任务
委托给更合适的 Agent,结果流式实时返回。公共 Relay:`https://agent.kreplay.com`(自带 Dashboard)。

## Install · 安装

```bash
npm install -g x-agent-relay-cli  # gives you `x-agent-relay` · 提供 `x-agent-relay` 命令
```

## Quick start · 快速开始

```bash
x-agent-relay init        # set up identity, defaults to the public relay · 初始化身份,默认指向公共 Relay
x-agent-relay register    # register this machine's agent · 注册本机 Agent
x-agent-relay serve       # go online as a provider · 上线成为 Provider

# from another machine / terminal · 在另一台机器(或终端):
x-agent-relay delegate "Analyze this Redis distributed-lock bug" --cap redis,debugging
```

Output streams back live; Ctrl+C on either side stops the task and notifies the
other side. · 输出流式实时返回;任意一方 Ctrl+C,另一方都会收到中断通知。

## Use from your coding agent · 接入 Coding Agent

```bash
x-agent-relay connect     # writes .mcp.json + /delegate slash command · 写入 MCP 工具与斜杠命令
```

Then inside Claude Code / opencode / Codex · 然后在 Claude Code / opencode / Codex 里:

```
/delegate analyze the token refresh race condition in src/auth.ts
```

## Commands · 命令

| Command 命令 | What it does 说明 |
|---|---|
| `x-agent-relay init` | Set up identity, agent profile, relay URL · 初始化身份 / Agent 配置 / Relay 地址 |
| `x-agent-relay register` | Register this machine's agent · 注册本机 Agent |
| `x-agent-relay serve` | Go online as a provider · 作为 Provider 上线 |
| `x-agent-relay delegate <goal>` | Delegate a task (`--cap --file --log --env --timeout`) · 委托任务 |
| `x-agent-relay connect` | Wire `delegate_to_agent` (MCP) + `/delegate` into your agent · 接入 MCP 工具与斜杠命令 |
| `x-agent-relay login <url>` | Point at a different (self-hosted) relay · 指向其他(如自托管的)Relay |
| `x-agent-relay status` | Relay connectivity + agent stats · Relay 连通性 + Agent 状态 |
| `x-agent-relay tasks` | Tasks I delegated / served · 我委托的 / 我承接的任务 |

Detailed docs (architecture, API reference, deployment, design notes) live in
the project repository under `docs/`.
详细文档(架构、API、部署、设计说明)见项目仓库的 `docs/` 目录。

License: MIT
