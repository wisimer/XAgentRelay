import { Hono } from "hono";
import {
  DEFAULT_TASK_PERMISSIONS,
  DEFAULT_TASK_TIMEOUT_S,
  PROTOCOL_VERSION,
  isTerminal,
  normalizeCapabilities,
  toPublicAgent,
  type CreateTaskRequest,
} from "@agent-relay/protocol";
import { newId } from "@agent-relay/shared";
import type { AgentConnections } from "./connections.js";
import { selectAgent } from "./matcher.js";
import type { Store } from "./store.js";
import { dashboardHtml } from "./dashboard.js";

export function buildApp(store: Store, connections: AgentConnections): Hono {
  const app = new Hono();
  const startedAt = Date.now();

  app.get("/", (c) => c.html(dashboardHtml));

  app.get("/api/health", (c) =>
    c.json({ ok: true, version: PROTOCOL_VERSION, uptime_s: Math.round((Date.now() - startedAt) / 1000) }),
  );

  /* --------------------------------------------------------------- agents */

  app.post("/api/agents/register", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body?.name || !body?.ownerId) {
      return c.json({ error: "name and ownerId are required" }, 400);
    }
    const agent = store.registerAgent({
      name: String(body.name),
      runtime: String(body.runtime ?? "mock"),
      capabilities: normalizeCapabilities(body.capabilities),
      ownerId: String(body.ownerId),
      agentId: body.agentId ? String(body.agentId) : undefined,
    });
    return c.json({ agent_id: agent.id, token: agent.token, agent: toPublicAgent(agent) });
  });

  app.get("/api/agents", (c) => {
    const capability = c.req.query("capability")?.toLowerCase();
    let agents = store.listAgents();
    if (capability) {
      agents = agents.filter((a) =>
        a.capabilities.some((cap) => cap.toLowerCase() === capability),
      );
    }
    return c.json(agents.map(toPublicAgent));
  });

  app.get("/api/agents/:id", (c) => {
    const agent = store.getAgent(c.req.param("id"));
    if (!agent) return c.json({ error: "agent not found" }, 404);
    return c.json({ agent: toPublicAgent(agent) });
  });

  /* ---------------------------------------------------------------- tasks */

  app.post("/api/tasks", async (c) => {
    const body = (await c.req.json().catch(() => null)) as CreateTaskRequest | null;
    if (!body?.goal || typeof body.goal !== "string") {
      return c.json({ error: "goal is required", code: "invalid_request" }, 400);
    }
    const capabilities = normalizeCapabilities(body.capabilities);
    const consumerId = c.req.header("x-consumer-id") ?? "anonymous";

    // Discovery: only agents with a live socket can be dispatched to.
    const online = store.listAgents().filter((a) => connections.has(a.id));
    const match = selectAgent(online, capabilities);
    if (!match) {
      return c.json(
        {
          error: "no online agent matches the required capabilities",
          code: "no_matching_agent",
        },
        404,
      );
    }

    const timeout = body.requirements?.timeout ?? DEFAULT_TASK_TIMEOUT_S;
    const task = {
      task_id: newId("task"),
      type: body.type,
      goal: body.goal,
      capabilities,
      context: body.context,
      requirements: { ...body.requirements, timeout },
      permissions: body.permissions ?? DEFAULT_TASK_PERMISSIONS,
      consumerId,
      providerId: match.agent.id,
      status: "pending" as const,
      createdAt: Date.now(),
      startedAt: null,
      completedAt: null,
      error: null,
      result: null,
      usage: null,
    };
    store.createTask(task);

    const sent = connections.send(match.agent.id, {
      type: "task_dispatch",
      task: {
        task_id: task.task_id,
        type: task.type,
        goal: task.goal,
        capabilities: task.capabilities,
        context: task.context,
        requirements: task.requirements,
        permissions: task.permissions,
      },
    });
    if (!sent) {
      store.updateTask(task.task_id, { status: "failed", error: "provider disconnected", completedAt: Date.now() });
      return c.json({ error: "provider disconnected during dispatch", code: "dispatch_failed" }, 502);
    }

    store.setTaskStatus(task.task_id, "assigned");
    store.setAgentStatus(match.agent.id, "busy");
    return c.json({
      task_id: task.task_id,
      status: "assigned",
      provider: toPublicAgent(match.agent),
    });
  });

  app.get("/api/tasks", (c) => {
    const tasks = store.listTasks({
      consumer: c.req.query("consumer") ?? undefined,
      provider: c.req.query("provider") ?? undefined,
      limit: Number(c.req.query("limit") ?? 100),
    });
    return c.json({ tasks });
  });

  app.get("/api/tasks/:id", (c) => {
    const task = store.getTask(c.req.param("id"));
    if (!task) return c.json({ error: "task not found" }, 404);
    return c.json({ task });
  });

  /**
   * Consumer interrupt: mark the task cancelled and push task_cancel to the
   * provider over its WebSocket so it kills the running runtime process.
   */
  app.post("/api/tasks/:id/cancel", (c) => {
    const task = store.getTask(c.req.param("id"));
    if (!task) return c.json({ error: "task not found" }, 404);
    if (isTerminal(task.status)) {
      return c.json({ error: `task already ${task.status}` }, 409);
    }
    store.updateTask(task.task_id, {
      status: "cancelled",
      error: "cancelled by consumer",
      completedAt: Date.now(),
    });
    if (task.providerId) {
      connections.send(task.providerId, { type: "task_cancel", task_id: task.task_id });
      store.setAgentStatus(
        task.providerId,
        connections.has(task.providerId) ? "online" : "offline",
      );
    }
    return c.json({ ok: true, task_id: task.task_id });
  });

  app.get("/api/stats", (c) => {
    const agents = store.listAgents();
    const tasks = store.listTasks({ limit: 10000 });
    return c.json({
      agents: {
        total: agents.length,
        online: agents.filter((a) => a.status === "online").length,
        offline: agents.filter((a) => a.status === "offline").length,
        busy: agents.filter((a) => a.status === "busy").length,
      },
      tasks: {
        total: tasks.length,
        completed: tasks.filter((t) => t.status === "completed").length,
        failed: tasks.filter((t) => t.status === "failed").length,
        timeout: tasks.filter((t) => t.status === "timeout").length,
        cancelled: tasks.filter((t) => t.status === "cancelled").length,
        active: tasks.filter((t) => ["pending", "assigned", "accepted", "running"].includes(t.status)).length,
      },
    });
  });

  return app;
}
