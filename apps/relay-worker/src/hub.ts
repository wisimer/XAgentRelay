import { DurableObject } from "cloudflare:workers";
import {
  DEFAULT_TASK_TIMEOUT_S,
  MAX_STREAM_CHARS,
  OFFLINE_AFTER_MS,
  isTerminal,
  normalizeCapabilities,
  toPublicAgent,
  type AgentRecord,
  type AgentRegistration,
  type AgentStatus,
  type ProviderMessage,
  type RelayMessage,
  type TaskRecord,
  type TaskStatus,
} from "@x-agent-relay/protocol";
import { StreamHub } from "@x-agent-relay/relay-core";
import type { Hono } from "hono";
import { buildRoutes } from "./routes";
import { newId, newToken } from "./ids";
import type { Env } from "./index";

/** Sweeper cadence (node server: 5s; here slightly relaxed to limit DO wakes). */
const SWEEP_MS = 10_000;
const MAX_TASKS = 5000;

/** Serialized onto each provider socket so identity survives hibernation. */
interface SocketMeta {
  agentId?: string;
}

/**
 * The whole relay as a single global Durable Object: agent registry, task
 * store, and every live provider WebSocket. Storage is the DO's transactional
 * KV (write-through from in-memory maps); the sweeper runs on `alarm()`
 * instead of setInterval, which doesn't exist in Workers.
 */
export class RelayHub extends DurableObject<Env> {
  private agents = new Map<string, AgentRecord>();
  private tasks = new Map<string, TaskRecord>();
  private sockets = new Map<string, WebSocket>();
  /** Live SSE subscribers per task, fanned out from provider task_chunk. */
  readonly streams = new StreamHub();
  private app: Hono | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(() => this.load());
  }

  /* ------------------------------------------------------------ storage */

  private async load(): Promise<void> {
    const storedAgents = await this.ctx.storage.list<AgentRecord>({ prefix: "agent:" });
    for (const [key, agent] of storedAgents) {
      this.agents.set(key.slice("agent:".length), agent);
    }
    const storedTasks = await this.ctx.storage.list<TaskRecord>({ prefix: "task:" });
    const sorted = [...storedTasks.values()].sort((a, b) => b.createdAt - a.createdAt);
    for (const task of sorted.slice(0, MAX_TASKS)) this.tasks.set(task.task_id, task);
    if (sorted.length > MAX_TASKS) {
      this.ctx.waitUntil(
        this.ctx.storage.delete(sorted.slice(MAX_TASKS).map((t) => `task:${t.task_id}`)),
      );
    }

    // Sockets survive DO restarts via hibernation: re-attach them. Agents
    // without a live socket are offline until they reconnect.
    const live = new Set<string>();
    for (const ws of this.ctx.getWebSockets()) {
      const agentId = this.meta(ws)?.agentId;
      if (agentId && this.agents.has(agentId)) {
        this.sockets.set(agentId, ws);
        live.add(agentId);
      }
    }
    for (const agent of this.agents.values()) {
      if (!live.has(agent.id)) agent.status = "offline";
    }
    await this.ensureAlarm();
  }

  private putAgent(agent: AgentRecord): void {
    this.ctx.waitUntil(this.ctx.storage.put(`agent:${agent.id}`, agent));
  }

  private putTask(task: TaskRecord): void {
    this.ctx.waitUntil(this.ctx.storage.put(`task:${task.task_id}`, task));
  }

  private async ensureAlarm(): Promise<void> {
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(Date.now() + SWEEP_MS);
    }
  }

  /* -------------------------------------------------- registry (Store API) */

  registerAgent(reg: AgentRegistration): AgentRecord {
    const existing = reg.agentId
      ? this.agents.get(reg.agentId)
      : [...this.agents.values()].find(
          (a) => a.ownerId === reg.ownerId && a.name === reg.name,
        );
    if (existing) {
      existing.runtime = reg.runtime;
      existing.capabilities = normalizeCapabilities(reg.capabilities);
      existing.token = newToken();
      this.putAgent(existing);
      return existing;
    }
    const agent: AgentRecord = {
      id: newId("agt"),
      name: reg.name,
      ownerId: reg.ownerId,
      runtime: reg.runtime,
      capabilities: normalizeCapabilities(reg.capabilities),
      status: "offline",
      token: newToken(),
      lastHeartbeat: null,
      createdAt: Date.now(),
      requestCount: 0,
      successCount: 0,
      avgLatencyMs: 0,
    };
    this.agents.set(agent.id, agent);
    this.putAgent(agent);
    return agent;
  }

  getAgent(id: string): AgentRecord | undefined {
    return this.agents.get(id);
  }

  listAgents(): AgentRecord[] {
    return [...this.agents.values()];
  }

  setAgentStatus(id: string, status: AgentStatus): void {
    const agent = this.agents.get(id);
    if (agent) {
      agent.status = status;
      this.putAgent(agent);
    }
  }

  /* ---------------------------------------------------------- tasks (Store) */

  createTask(task: TaskRecord): void {
    this.tasks.set(task.task_id, task);
    this.putTask(task);
    if (this.tasks.size > MAX_TASKS) {
      const sorted = [...this.tasks.values()].sort((a, b) => b.createdAt - a.createdAt);
      const drop = sorted.slice(MAX_TASKS);
      for (const t of drop) this.tasks.delete(t.task_id);
      this.ctx.waitUntil(this.ctx.storage.delete(drop.map((t) => `task:${t.task_id}`)));
    }
  }

  getTask(id: string): TaskRecord | undefined {
    return this.tasks.get(id);
  }

  updateTask(id: string, patch: Partial<TaskRecord>): TaskRecord | undefined {
    const task = this.tasks.get(id);
    if (!task) return undefined;
    Object.assign(task, patch);
    this.putTask(task);
    return task;
  }

  setTaskStatus(id: string, status: TaskStatus): void {
    this.updateTask(id, { status });
  }

  /** Append a live-output chunk, keeping only the most recent tail. */
  appendStream(id: string, chunk: string): void {
    const task = this.tasks.get(id);
    if (!task) return;
    task.stream = ((task.stream ?? "") + chunk).slice(-MAX_STREAM_CHARS);
    this.putTask(task);
  }

  listTasks(filter: { consumer?: string; provider?: string; limit?: number } = {}): TaskRecord[] {
    let tasks = [...this.tasks.values()].sort((a, b) => b.createdAt - a.createdAt);
    if (filter.consumer) tasks = tasks.filter((t) => t.consumerId === filter.consumer);
    if (filter.provider) tasks = tasks.filter((t) => t.providerId === filter.provider);
    return tasks.slice(0, filter.limit ?? 100);
  }

  /** Record provider stats after a finished task. */
  recordOutcome(agentId: string, ok: boolean, latencyMs: number): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;
    agent.requestCount += 1;
    if (ok) agent.successCount += 1;
    const n = agent.requestCount;
    agent.avgLatencyMs = Math.round(agent.avgLatencyMs + (latencyMs - agent.avgLatencyMs) / n);
    this.putAgent(agent);
  }

  /* ------------------------------------------------------ provider sockets */

  hasConnection(agentId: string): boolean {
    return this.sockets.has(agentId);
  }

  sendToAgent(agentId: string, msg: RelayMessage): boolean {
    const ws = this.sockets.get(agentId);
    if (!ws || ws.readyState !== 1) return false; // 1 = WebSocket.OPEN
    try {
      ws.send(JSON.stringify(msg));
      return true;
    } catch {
      return false;
    }
  }

  private meta(ws: WebSocket): SocketMeta | null {
    try {
      return (ws.deserializeAttachment() as SocketMeta | null) ?? null;
    } catch {
      return null;
    }
  }

  private attach(agentId: string, ws: WebSocket): void {
    const old = this.sockets.get(agentId);
    if (old && old !== ws) {
      try {
        old.close(4000, "replaced by new connection");
      } catch {
        /* already gone */
      }
    }
    this.sockets.set(agentId, ws);
    ws.serializeAttachment({ agentId } satisfies SocketMeta);
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.status = "online";
      agent.lastHeartbeat = Date.now();
      this.putAgent(agent);
    }
  }

  /* ------------------------------------------------------------ fetch API */

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/agent") {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("expected websocket upgrade", { status: 426 });
      }
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
      this.ctx.acceptWebSocket(server);
      await this.ensureAlarm();
      return new Response(null, { status: 101, webSocket: client });
    }
    this.app ??= buildRoutes(this);
    return this.app.fetch(request);
  }

  /* -------------------------------------------------- provider WS protocol */

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    let msg: ProviderMessage | null;
    try {
      const text = typeof message === "string" ? message : new TextDecoder().decode(message);
      msg = JSON.parse(text) as ProviderMessage;
    } catch {
      return;
    }
    if (!msg?.type) return;
    const agentId = this.meta(ws)?.agentId ?? null;

    switch (msg.type) {
      case "register": {
        const agent = this.agents.get(msg.agent_id);
        if (!agent || agent.token !== msg.token) {
          this.safeSend(ws, { type: "error", message: "invalid agent_id or token" });
          try {
            ws.close(4001, "unauthorized");
          } catch {
            /* already closed */
          }
          return;
        }
        this.attach(agent.id, ws);
        this.safeSend(ws, {
          type: "registered",
          agent: { ...toPublicAgent(agent), status: "online" },
        });
        break;
      }
      case "heartbeat": {
        if (agentId) {
          const agent = this.agents.get(agentId);
          if (agent) agent.lastHeartbeat = Date.now(); // memory only, not worth a write
        }
        break;
      }
      case "task_update": {
        if (!agentId) return;
        const task = this.tasks.get(msg.task_id);
        if (!task || task.providerId !== agentId) return;
        if (msg.status === "accepted" && task.status === "assigned") {
          this.setTaskStatus(msg.task_id, "accepted");
        } else if (msg.status === "running" && (task.status === "accepted" || task.status === "assigned")) {
          this.updateTask(msg.task_id, { status: "running", startedAt: task.startedAt ?? Date.now() });
        }
        break;
      }
      case "task_chunk": {
        if (!agentId) return;
        const task = this.tasks.get(msg.task_id);
        if (!task || task.providerId !== agentId || isTerminal(task.status)) return;
        this.appendStream(msg.task_id, msg.chunk);
        this.streams.publish(msg.task_id, msg.chunk);
        break;
      }
      case "task_result": {
        if (!agentId) return;
        const task = this.tasks.get(msg.task_id);
        if (!task || task.providerId !== agentId) return;
        if (isTerminal(task.status)) return; // late result after timeout/cancel
        const now = Date.now();
        const started = task.startedAt ?? task.createdAt;
        const latency = now > started ? now - started : 0;
        const updated = this.updateTask(msg.task_id, {
          status: msg.status,
          result: msg.result ?? null,
          usage: msg.usage ?? null,
          error: msg.error ?? null,
          completedAt: now,
        });
        this.recordOutcome(agentId, msg.status === "completed", latency);
        this.setAgentStatus(agentId, "online");
        if (updated) this.streams.finish(msg.task_id, updated);
        break;
      }
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    this.handleSocketGone(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    // close follows errors; handle idempotently in both
    this.handleSocketGone(ws);
  }

  /**
   * Provider went away (crash, network loss): any in-flight task can never
   * report back — fail it immediately instead of letting consumers wait
   * for the timeout sweeper. Mirrors the node server's close handler.
   */
  private handleSocketGone(ws: WebSocket): void {
    let agentId = this.meta(ws)?.agentId ?? null;
    if (!agentId) {
      for (const [id, socket] of this.sockets) {
        if (socket === ws) {
          agentId = id;
          break;
        }
      }
    }
    if (!agentId) return;
    if (this.sockets.get(agentId) === ws) {
      this.sockets.delete(agentId);
      this.setAgentStatus(agentId, "offline");
    }
    const now = Date.now();
    for (const task of this.listTasks({ provider: agentId, limit: 1000 })) {
      if (isTerminal(task.status)) continue;
      const updated = this.updateTask(task.task_id, {
        status: "failed",
        error: "provider disconnected",
        completedAt: now,
      });
      this.recordOutcome(agentId, false, now - (task.startedAt ?? task.createdAt));
      if (updated) this.streams.finish(task.task_id, updated);
    }
  }

  private safeSend(ws: WebSocket, msg: RelayMessage): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* socket already closing */
    }
  }

  /* ------------------------------------------------------------- sweeper */

  /**
   * Enforce task deadlines and mark agents offline when their socket
   * disappears without a close event (crash, network partition). Runs on the
   * DO alarm; reschedules itself.
   */
  async alarm(): Promise<void> {
    const now = Date.now();
    for (const task of this.listTasks({ limit: 10000 })) {
      if (isTerminal(task.status)) continue;
      const timeoutMs = (task.requirements?.timeout ?? DEFAULT_TASK_TIMEOUT_S) * 1000 + 15_000;
      if (now - task.createdAt > timeoutMs) {
        this.updateTask(task.task_id, { status: "timeout", error: "provider did not finish in time", completedAt: now });
        if (task.providerId) {
          this.setAgentStatus(task.providerId, this.hasConnection(task.providerId) ? "online" : "offline");
        }
        console.log(`[relay] task ${task.task_id} timed out`);
      }
    }
    for (const agent of this.agents.values()) {
      if (agent.status === "offline") continue;
      const stale =
        !this.hasConnection(agent.id) &&
        (!agent.lastHeartbeat || now - agent.lastHeartbeat > OFFLINE_AFTER_MS);
      if (stale) this.setAgentStatus(agent.id, "offline");
    }
    // backstop: close SSE subscribers of any task that reached a terminal state
    this.streams.finishTerminal(this.listTasks({ limit: 10000 }));
    await this.ctx.storage.setAlarm(Date.now() + SWEEP_MS);
  }
}
