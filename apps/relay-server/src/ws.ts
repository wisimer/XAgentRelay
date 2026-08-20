import type { WebSocket, WebSocketServer } from "ws";
import { isTerminal, type ProviderMessage } from "@agent-relay/protocol";
import type { StreamHub } from "@agent-relay/relay-core";
import type { AgentConnections } from "./connections.js";
import { parseMessage } from "./connections.js";
import type { Store } from "./store.js";

/**
 * Provider WebSocket endpoint (wss://relay/agent).
 * register → heartbeat → task_update → task_chunk → task_result.
 */
export function setupProviderSocket(
  wss: WebSocketServer,
  store: Store,
  connections: AgentConnections,
  streams: StreamHub,
): void {
  wss.on("connection", (ws: WebSocket) => {
    let agentId: string | null = null;

    ws.on("message", (data) => {
      const msg = parseMessage(data) as ProviderMessage | null;
      if (!msg?.type) return;

      switch (msg.type) {
        case "register": {
          const agent = store.getAgent(msg.agent_id);
          if (!agent || agent.token !== msg.token) {
            ws.send(JSON.stringify({ type: "error", message: "invalid agent_id or token" }));
            ws.close(4001, "unauthorized");
            return;
          }
          agentId = agent.id;
          connections.attach(agentId, ws);
          ws.send(JSON.stringify({ type: "registered", agent: { ...agent, token: undefined, status: "online" } }));
          break;
        }
        case "heartbeat": {
          if (agentId) store.touchHeartbeat(agentId);
          break;
        }
        case "task_update": {
          if (!agentId) return;
          const task = store.getTask(msg.task_id);
          if (!task || task.providerId !== agentId) return;
          if (msg.status === "accepted" && task.status === "assigned") {
            store.setTaskStatus(msg.task_id, "accepted");
          } else if (msg.status === "running" && (task.status === "accepted" || task.status === "assigned")) {
            store.updateTask(msg.task_id, { status: "running", startedAt: task.startedAt ?? Date.now() });
          }
          break;
        }
        case "task_chunk": {
          if (!agentId) return;
          const task = store.getTask(msg.task_id);
          if (!task || task.providerId !== agentId || isTerminal(task.status)) return;
          store.appendStream(msg.task_id, msg.chunk);
          streams.publish(msg.task_id, msg.chunk);
          break;
        }
        case "task_result": {
          if (!agentId) return;
          const task = store.getTask(msg.task_id);
          if (!task || task.providerId !== agentId) return;
          if (isTerminal(task.status)) return; // late result after timeout/cancel
          const now = Date.now();
          const latency = (task.startedAt ?? task.createdAt) && now > (task.startedAt ?? task.createdAt)
            ? now - (task.startedAt ?? task.createdAt)
            : 0;
          const updated = store.updateTask(msg.task_id, {
            status: msg.status,
            result: msg.result ?? null,
            usage: msg.usage ?? null,
            error: msg.error ?? null,
            completedAt: now,
          });
          store.recordOutcome(agentId, msg.status === "completed", latency);
          store.setAgentStatus(agentId, "online");
          if (updated) streams.finish(msg.task_id, updated);
          break;
        }
      }
    });

    ws.on("close", () => {
      if (!agentId) return;
      connections.detach(agentId, ws);
      // Provider went away (crash, network loss): any in-flight task can never
      // report back — fail it immediately instead of letting consumers wait
      // for the timeout sweeper.
      const now = Date.now();
      for (const task of store.listTasks({ provider: agentId, limit: 1000 })) {
        if (isTerminal(task.status)) continue;
        const updated = store.updateTask(task.task_id, {
          status: "failed",
          error: "provider disconnected",
          completedAt: now,
        });
        store.recordOutcome(agentId, false, now - (task.startedAt ?? task.createdAt));
        if (updated) streams.finish(task.task_id, updated);
      }
    });
  });
}
