import { Hono } from "hono";
import {
  DEFAULT_TASK_PERMISSIONS,
  DEFAULT_TASK_TIMEOUT_S,
  PROTOCOL_VERSION,
  TICKET_STATUSES,
  isTerminal,
  normalizeCapabilities,
  toPublicAgent,
  type AgentRecord,
  type AgentRegistration,
  type AgentStatus,
  type CreateTaskRequest,
  type CreateTicketRequest,
  type RelayMessage,
  type TaskRecord,
  type TaskStatus,
  type TicketRecord,
  type TicketStatus,
  type TicketView,
  type UpdateTicketRequest,
} from "@x-agent-relay/protocol";
import { computeStats, dashboardHtml, selectAgent, taskStreamResponse, ticketsHtml, type StreamHub } from "@x-agent-relay/relay-core";
import { newId } from "./ids";

/**
 * Everything the HTTP routes need from the hub. Structurally implemented by
 * the RelayHub Durable Object — the same shape the node server's
 * Store + AgentConnections pair provides.
 */
export interface RelayBackend {
  registerAgent(reg: AgentRegistration): AgentRecord;
  getAgent(id: string): AgentRecord | undefined;
  listAgents(): AgentRecord[];
  setAgentStatus(id: string, status: AgentStatus): void;
  createTask(task: TaskRecord): void;
  getTask(id: string): TaskRecord | undefined;
  updateTask(id: string, patch: Partial<TaskRecord>): TaskRecord | undefined;
  setTaskStatus(id: string, status: TaskStatus): void;
  listTasks(filter?: { consumer?: string; provider?: string; limit?: number }): TaskRecord[];
  createTicket(input: {
    title: string;
    description?: string;
    kind?: string;
    reporter?: string | null;
    assignedAgentId?: string | null;
    status?: TicketRecord["status"];
  }): TicketRecord;
  getTicket(id: string): TicketRecord | undefined;
  updateTicket(id: string, patch: Partial<TicketRecord>): TicketRecord | undefined;
  listTickets(filter?: { status?: TicketStatus; limit?: number }): TicketRecord[];
  hasConnection(agentId: string): boolean;
  sendToAgent(agentId: string, msg: RelayMessage): boolean;
  readonly streams: StreamHub;
}

/** HTTP API — a straight port of the node server's routes (api.ts). */
export function buildRoutes(backend: RelayBackend): Hono {
  const app = new Hono();
  const startedAt = Date.now();

  app.get("/", (c) => c.html(dashboardHtml));

  app.get("/tickets", (c) => c.html(ticketsHtml));

  app.get("/api/health", (c) =>
    c.json({ ok: true, version: PROTOCOL_VERSION, uptime_s: Math.round((Date.now() - startedAt) / 1000) }),
  );

  /* --------------------------------------------------------------- agents */

  app.post("/api/agents/register", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body?.name || !body?.ownerId) {
      return c.json({ error: "name and ownerId are required" }, 400);
    }
    const agent = backend.registerAgent({
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
    let agents = backend.listAgents();
    if (capability) {
      agents = agents.filter((a) =>
        a.capabilities.some((cap) => cap.toLowerCase() === capability),
      );
    }
    return c.json(agents.map(toPublicAgent));
  });

  app.get("/api/agents/:id", (c) => {
    const agent = backend.getAgent(c.req.param("id"));
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
    const online = backend.listAgents().filter((a) => backend.hasConnection(a.id));
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
    const task: TaskRecord = {
      task_id: newId("task"),
      type: body.type,
      goal: body.goal,
      capabilities,
      context: body.context,
      requirements: { ...body.requirements, timeout },
      permissions: body.permissions ?? DEFAULT_TASK_PERMISSIONS,
      consumerId,
      providerId: match.agent.id,
      status: "pending",
      createdAt: Date.now(),
      startedAt: null,
      completedAt: null,
      error: null,
      result: null,
      usage: null,
    };
    backend.createTask(task);

    const sent = backend.sendToAgent(match.agent.id, {
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
      const failed = backend.updateTask(task.task_id, { status: "failed", error: "provider disconnected", completedAt: Date.now() });
      if (failed) backend.streams.finish(task.task_id, failed);
      return c.json({ error: "provider disconnected during dispatch", code: "dispatch_failed" }, 502);
    }

    backend.setTaskStatus(task.task_id, "assigned");
    backend.setAgentStatus(match.agent.id, "busy");
    return c.json({
      task_id: task.task_id,
      status: "assigned",
      provider: toPublicAgent(match.agent),
    });
  });

  app.get("/api/tasks", (c) => {
    const tasks = backend
      .listTasks({
        consumer: c.req.query("consumer") ?? undefined,
        provider: c.req.query("provider") ?? undefined,
        limit: Number(c.req.query("limit") ?? 100),
      })
      .map((t) => {
        const provider = t.providerId ? backend.getAgent(t.providerId) : undefined;
        // stream text is bulky and only useful on detail/stream endpoints
        const { stream, ...rest } = t;
        return { ...rest, provider: provider ? toPublicAgent(provider) : null };
      });
    return c.json({ tasks });
  });

  /** SSE live stream of a task's output (snapshot → chunk* → done). */
  app.get("/api/tasks/:id/stream", (c) => {
    const task = backend.getTask(c.req.param("id"));
    if (!task) return c.json({ error: "task not found" }, 404);
    return taskStreamResponse(task, backend.streams);
  });

  app.get("/api/tasks/:id", (c) => {
    const task = backend.getTask(c.req.param("id"));
    if (!task) return c.json({ error: "task not found" }, 404);
    return c.json({ task });
  });

  /**
   * Consumer interrupt: mark the task cancelled and push task_cancel to the
   * provider over its WebSocket so it kills the running runtime process.
   */
  app.post("/api/tasks/:id/cancel", (c) => {
    const task = backend.getTask(c.req.param("id"));
    if (!task) return c.json({ error: "task not found" }, 404);
    if (isTerminal(task.status)) {
      return c.json({ error: `task already ${task.status}` }, 409);
    }
    const updated = backend.updateTask(task.task_id, {
      status: "cancelled",
      error: "cancelled by consumer",
      completedAt: Date.now(),
    });
    if (updated) backend.streams.finish(task.task_id, updated);
    if (task.providerId) {
      backend.sendToAgent(task.providerId, { type: "task_cancel", task_id: task.task_id });
      backend.setAgentStatus(
        task.providerId,
        backend.hasConnection(task.providerId) ? "online" : "offline",
      );
    }
    return c.json({ ok: true, task_id: task.task_id });
  });

  app.get("/api/stats", (c) =>
    c.json(computeStats(backend.listAgents(), backend.listTasks({ limit: 10000 }))),
  );

  /* ------------------------------------------------------------- tickets */

  const ticketView = (t: TicketRecord): TicketView => {
    const agent = t.assignedAgentId ? backend.getAgent(t.assignedAgentId) : undefined;
    const latestId = t.taskIds.length ? t.taskIds[t.taskIds.length - 1] : null;
    const task = latestId ? backend.getTask(latestId) : undefined;
    return {
      ...t,
      assignedAgent: agent ? toPublicAgent(agent) : null,
      task: task ? { task_id: task.task_id, status: task.status, error: task.error } : null,
    };
  };

  /** Create a ticket on the board. The ticket worker picks it up automatically. */
  app.post("/api/tickets", async (c) => {
    const body = (await c.req.json().catch(() => null)) as CreateTicketRequest | null;
    const title = body?.title?.trim();
    if (!title) return c.json({ error: "title is required" }, 400);
    let assignedAgentId: string | null = null;
    if (body?.assignedAgentId) {
      if (!backend.getAgent(String(body.assignedAgentId))) {
        return c.json({ error: "assignedAgentId not found" }, 400);
      }
      assignedAgentId = String(body.assignedAgentId);
    }
    let status: TicketRecord["status"] = "todo";
    if (body?.status) {
      if (!TICKET_STATUSES.includes(body.status)) {
        return c.json({ error: `status must be one of ${TICKET_STATUSES.join(", ")}` }, 400);
      }
      status = body.status;
    }
    const ticket = backend.createTicket({
      title,
      description: body?.description?.trim() || "",
      kind: body?.kind ?? "issue",
      reporter: body?.reporter ?? null,
      assignedAgentId,
      status,
    });
    return c.json({ ticket: ticketView(ticket) }, 201);
  });

  app.get("/api/tickets", (c) => {
    const status = c.req.query("status") as TicketStatus | undefined;
    const tickets = backend
      .listTickets({
        status: status && TICKET_STATUSES.includes(status) ? status : undefined,
        limit: Number(c.req.query("limit") ?? 100),
      })
      .map(ticketView);
    return c.json({ tickets });
  });

  app.get("/api/tickets/:id", (c) => {
    const ticket = backend.getTicket(c.req.param("id"));
    if (!ticket) return c.json({ error: "ticket not found" }, 404);
    return c.json({ ticket: ticketView(ticket) });
  });

  /**
   * Manual update: status transitions (todo resets the retry counter so the
   * worker re-dispatches) and agent assignment (null/"" = auto-match).
   */
  app.patch("/api/tickets/:id", async (c) => {
    const ticket = backend.getTicket(c.req.param("id"));
    if (!ticket) return c.json({ error: "ticket not found" }, 404);
    const body = (await c.req.json().catch(() => null)) as UpdateTicketRequest | null;
    if (!body) return c.json({ error: "invalid JSON body" }, 400);

    const patch: Partial<TicketRecord> = {};
    if (body.title !== undefined) {
      const title = body.title?.trim();
      if (!title) return c.json({ error: "title cannot be empty" }, 400);
      patch.title = title;
    }
    if (body.description !== undefined) patch.description = body.description ?? "";
    if (body.status !== undefined) {
      if (!TICKET_STATUSES.includes(body.status)) {
        return c.json({ error: `status must be one of ${TICKET_STATUSES.join(", ")}` }, 400);
      }
      patch.status = body.status;
      if (body.status === "todo" && ticket.status !== "todo") {
        patch.attempts = 0; // manual re-open restarts the auto-dispatch cycle
        patch.note = "re-opened by user";
      }
      // A manual status change consumes any pending task outcome, so a late
      // sync of an already-finished task can never steamroll the user's pick.
      if (ticket.taskIds.length > 0) {
        patch.syncedTaskId = ticket.taskIds[ticket.taskIds.length - 1];
      }
    }
    if (body.assignedAgentId !== undefined) {
      if (!body.assignedAgentId) {
        patch.assignedAgentId = null;
      } else if (!backend.getAgent(String(body.assignedAgentId))) {
        return c.json({ error: "assignedAgentId not found" }, 400);
      } else {
        patch.assignedAgentId = String(body.assignedAgentId);
      }
    }
    const updated = backend.updateTicket(ticket.id, patch);
    return c.json({ ticket: ticketView(updated!) });
  });

  return app;
}
