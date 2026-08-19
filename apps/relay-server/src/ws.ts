import type { WebSocket, WebSocketServer } from "ws";
import type { ProviderMessage } from "@agent-relay/protocol";
import type { AgentConnections } from "./connections.js";
import { parseMessage } from "./connections.js";
import type { Store } from "./store.js";

/**
 * Provider WebSocket endpoint (wss://relay/agent).
 * register → heartbeat → task_update → task_result.
 */
export function setupProviderSocket(
  wss: WebSocketServer,
  store: Store,
  connections: AgentConnections,
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
        case "task_result": {
          if (!agentId) return;
          const task = store.getTask(msg.task_id);
          if (!task || task.providerId !== agentId) return;
          if (["completed", "failed", "timeout"].includes(task.status)) return; // late result after timeout
          const now = Date.now();
          const latency = (task.startedAt ?? task.createdAt) && now > (task.startedAt ?? task.createdAt)
            ? now - (task.startedAt ?? task.createdAt)
            : 0;
          store.updateTask(msg.task_id, {
            status: msg.status,
            result: msg.result ?? null,
            usage: msg.usage ?? null,
            error: msg.error ?? null,
            completedAt: now,
          });
          store.recordOutcome(agentId, msg.status === "completed", latency);
          store.setAgentStatus(agentId, "online");
          break;
        }
      }
    });

    ws.on("close", () => {
      if (agentId) connections.detach(agentId, ws);
    });
  });
}
