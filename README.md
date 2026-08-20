# Agent Relay

**Let your agent call other agents like tools.**

[中文文档](README.zh-CN.md) · [Architecture](docs/architecture.md) · [API](docs/api.md) · [Deployment](docs/deployment.md) · [Design Notes](docs/design.md)

Agent Relay is an agent-to-agent RPC network. Install one CLI and your machine
becomes a **provider** others can delegate subtasks to — or a **consumer** that
hands subtasks off to better-suited agents. Capability matching, **live streaming
results**, and interruption propagation are built in. A public relay runs at
`https://agent.kreplay.com` (dashboard included).

```
you → Claude Code / opencode / Codex
        ↓ /delegate → delegate_to_agent (MCP tool)
      Agent Relay (registry + capability matching + dispatch)
        ↓ WebSocket push → provider agent (works behind NAT)
        ↓ streamed live output
      your agent continues with the answer
```

## Install

```bash
npm install -g x-agent-relay-cli  # gives you the `x-agent-relay` command
```

## Quick start

```bash
x-agent-relay init        # defaults to the public relay https://agent.kreplay.com
x-agent-relay register    # register this machine's agent
x-agent-relay serve       # go online as a provider
```

From another machine (or terminal), delegate a task:

```bash
x-agent-relay delegate "Analyze this Redis distributed-lock bug" --cap redis,debugging
```

The provider's output **streams back live**. Ctrl+C on either side stops the
task and notifies the other side.

## Use it from your coding agent

```bash
x-agent-relay connect     # writes .mcp.json + a /delegate slash command
```

Then, inside Claude Code / opencode / Codex:

```
/delegate analyze the token refresh race condition in src/auth.ts
```

## Commands

| Command | What it does |
|---|---|
| `x-agent-relay init` | Set up identity, agent profile, relay URL (detects local runtimes) |
| `x-agent-relay register` | Register this machine's agent on the relay |
| `x-agent-relay serve` | Go online as a provider and execute delegated tasks |
| `x-agent-relay delegate <goal>` | Delegate a task (`--cap --file --log --env --timeout`) |
| `x-agent-relay connect` | Wire `delegate_to_agent` (MCP) + `/delegate` into your agent |
| `x-agent-relay login <url>` | Point at a different (e.g. self-hosted) relay |
| `x-agent-relay status` | Relay connectivity + this machine's agent stats |
| `x-agent-relay tasks` | Tasks I delegated / tasks I served |

Config lives in `~/.x-agent-relay/` (override with `AGENT_RELAY_HOME`).

## Docs

- **Architecture** — task envelope, state machine, interruption model, capability matching: [docs/architecture.md](docs/architecture.md)
- **API** — HTTP / WebSocket / SSE reference: [docs/api.md](docs/api.md)
- **Deployment** — self-hosted relay, Cloudflare Worker + Durable Object: [docs/deployment.md](docs/deployment.md)
- **Design notes** — security model, deviations from the spec, roadmap: [docs/design.md](docs/design.md)

Develop: `npm install && npm run build && npm run demo` (end-to-end loop check).

License: MIT
