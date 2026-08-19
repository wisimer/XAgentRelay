#!/usr/bin/env node
import http from "node:http";
import { serve } from "@hono/node-server";
import { WebSocketServer } from "ws";
import { DEFAULT_TASK_TIMEOUT_S, OFFLINE_AFTER_MS } from "@agent-relay/protocol";
import { buildApp } from "./api.js";
import { AgentConnections } from "./connections.js";
import { Store } from "./store.js";
import { setupProviderSocket } from "./ws.js";

const port = Number(process.env.PORT ?? process.env.RELAY_PORT ?? 8787);
const dataDir = process.env.RELAY_DATA_DIR ?? "data";

const store = new Store(dataDir);
const connections = new AgentConnections(store);
const app = buildApp(store, connections);

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[relay] listening on http://127.0.0.1:${info.port} (dashboard at /)`);
  console.log(`[relay] provider websocket at ws://127.0.0.1:${info.port}/agent`);
  console.log(`[relay] data dir: ${dataDir}`);
});

// Provider connections: providers dial out, so they work behind NAT.
const wss = new WebSocketServer({ noServer: true });
setupProviderSocket(wss, store, connections);

(server as http.Server).on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  if (url.pathname === "/agent") {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  } else {
    socket.destroy();
  }
});

/**
 * Sweeper: enforce task deadlines and mark agents offline when their socket
 * disappears without a close event (crash, network partition).
 */
setInterval(() => {
  const now = Date.now();
  for (const task of store.listTasks({ limit: 10000 })) {
    if (["completed", "failed", "timeout"].includes(task.status)) continue;
    const timeoutMs = (task.requirements?.timeout ?? DEFAULT_TASK_TIMEOUT_S) * 1000 + 15_000;
    if (now - task.createdAt > timeoutMs) {
      store.updateTask(task.task_id, { status: "timeout", error: "provider did not finish in time", completedAt: now });
      if (task.providerId) store.setAgentStatus(task.providerId, connections.has(task.providerId) ? "online" : "offline");
      console.log(`[relay] task ${task.task_id} timed out`);
    }
  }
  for (const agent of store.listAgents()) {
    if (agent.status === "offline") continue;
    const stale = !connections.has(agent.id) && (!agent.lastHeartbeat || now - agent.lastHeartbeat > OFFLINE_AFTER_MS);
    if (stale) store.setAgentStatus(agent.id, "offline");
  }
}, 5_000);

const shutdown = () => {
  console.log("\n[relay] shutting down");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
