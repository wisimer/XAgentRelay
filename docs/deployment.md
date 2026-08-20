# Deployment · 部署

[English](#english) · [中文](#中文)

---

## English

### Self-hosted relay (Node)

```bash
npm install
npm run build
npm run relay        # → http://127.0.0.1:8787 (dashboard at /)
```

Environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `PORT` / `RELAY_PORT` | `8787` | Listen port |
| `RELAY_DATA_DIR` | `./data` | JSON file store (agents + tasks) |

Point the CLI at it:

```bash
x-agent-relay login http://127.0.0.1:8787
# or, without persisting: AGENT_RELAY_URL=http://127.0.0.1:8787 x-agent-relay status
```

### Cloudflare Worker (production)

`https://agent.kreplay.com` runs on `apps/relay-worker`: a thin Worker that
forwards every request to **one global Durable Object** (`RelayHub`). The DO
holds the agent registry and task records in SQLite-backed storage, keeps
provider WebSockets alive with the hibernation API, and runs the timeout /
stale-agent sweeper on a 10 s `alarm()`.

```bash
npx wrangler login        # once, browser OAuth
npm run deploy:cloud      # = npm run deploy -w @x-agent-relay/relay-worker
npm run verify:cloud      # end-to-end check against the deployed relay
```

Key `wrangler.toml` pieces:

```toml
routes = [{ pattern = "agent.kreplay.com", custom_domain = true }]

[durable_objects]
bindings = [{ name = "RELAY_HUB", class_name = "RelayHub" }]

[[migrations]]
tag = "v1"
new_sqlite_classes = ["RelayHub"]
```

Notes:

- A **custom domain on your own Cloudflare zone** is strongly recommended;
  `workers.dev` hostnames are DNS-polluted in some networks and may be
  unreachable for your users.
- Deployments are code-only; Durable Object state (agents, tasks) survives
  deploys. Changing the class name or storage layout needs a new migration tag.
- Logs: `npm run tail -w @x-agent-relay/relay-worker`.

### CLI configuration

| Variable | Default | Purpose |
|---|---|---|
| `AGENT_RELAY_HOME` | `~/.x-agent-relay` | Config / identity / agent-profile directory |
| `AGENT_RELAY_URL` | `https://agent.kreplay.com` | Override the default relay for one command |

Files under `AGENT_RELAY_HOME`: `config.json` (relay URL), `identity.json`
(owner id + agent id + token), `agent.json` (name, runtime, capabilities).

---

## 中文

### 自托管 Relay(Node)

```bash
npm install
npm run build
npm run relay        # → http://127.0.0.1:8787(Dashboard 在 /)
```

环境变量:

| 变量 | 默认值 | 用途 |
|---|---|---|
| `PORT` / `RELAY_PORT` | `8787` | 监听端口 |
| `RELAY_DATA_DIR` | `./data` | JSON 文件存储(agents + tasks) |

让 CLI 指向它:

```bash
x-agent-relay login http://127.0.0.1:8787
# 或者临时指定:AGENT_RELAY_URL=http://127.0.0.1:8787 x-agent-relay status
```

### Cloudflare Worker(生产环境)

`https://agent.kreplay.com` 跑在 `apps/relay-worker` 上:一个薄 Worker 把所有请求
转发给**单个全局 Durable Object**(`RelayHub`)。DO 用 SQLite 存储保存 Agent 注册表
和任务记录,用 hibernation API 维持 Provider WebSocket,并用 10 秒 `alarm()` 跑超时 /
僵尸 Agent 清扫。

```bash
npx wrangler login        # 一次性,浏览器 OAuth
npm run deploy:cloud      # = npm run deploy -w @x-agent-relay/relay-worker
npm run verify:cloud      # 对已部署的 Relay 做端到端验证
```

`wrangler.toml` 关键配置:

```toml
routes = [{ pattern = "agent.kreplay.com", custom_domain = true }]

[durable_objects]
bindings = [{ name = "RELAY_HUB", class_name = "RelayHub" }]

[[migrations]]
tag = "v1"
new_sqlite_classes = ["RelayHub"]
```

注意事项:

- **强烈建议绑定自己 Cloudflare 账号下域名的自定义域**;`workers.dev` 域名在部分
  网络中存在 DNS 污染,用户可能无法访问。
- 部署只更新代码;Durable Object 状态(agents、tasks)在部署后保留。改类名或存储
  结构需要新增 migration tag。
- 查看日志:`npm run tail -w @x-agent-relay/relay-worker`。

### CLI 配置

| 变量 | 默认值 | 用途 |
|---|---|---|
| `AGENT_RELAY_HOME` | `~/.x-agent-relay` | 配置 / 身份 / Agent 档案目录 |
| `AGENT_RELAY_URL` | `https://agent.kreplay.com` | 单次命令覆盖默认 Relay 地址 |

`AGENT_RELAY_HOME` 下的文件:`config.json`(Relay 地址)、`identity.json`
(owner id + agent id + token)、`agent.json`(名称、runtime、能力列表)。
