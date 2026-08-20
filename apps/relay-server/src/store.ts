import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  MAX_STREAM_CHARS,
  normalizeCapabilities,
  type AgentRecord,
  type AgentRegistration,
  type TaskRecord,
  type TaskStatus,
} from "@x-agent-relay/protocol";
import { newId, newToken } from "@x-agent-relay/shared";

interface StoreData {
  agents: AgentRecord[];
  tasks: TaskRecord[];
}

/**
 * MVP persistence: in-memory maps write-through to a JSON file.
 * Swap for PostgreSQL + Prisma when the network goes public (Phase 2+).
 */
export class Store {
  private agents = new Map<string, AgentRecord>();
  private tasks = new Map<string, TaskRecord>();
  private file: string;
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.file = join(dataDir, "relay.json");
    this.load();
  }

  private load(): void {
    if (!existsSync(this.file)) return;
    try {
      const data = JSON.parse(readFileSync(this.file, "utf8")) as StoreData;
      for (const a of data.agents ?? []) this.agents.set(a.id, { ...a, status: "offline" });
      for (const t of data.tasks ?? []) this.tasks.set(t.task_id, t);
    } catch {
      /* corrupt file — start fresh rather than crash */
    }
  }

  private persist(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      const data: StoreData = {
        agents: [...this.agents.values()],
        tasks: [...this.tasks.values()].slice(-5000),
      };
      writeFileSync(this.file, JSON.stringify(data), "utf8");
    }, 250);
  }

  /* --------------------------------------------------------------- agents */

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
      this.persist();
      return existing;
    }
    const now = Date.now();
    const agent: AgentRecord = {
      id: newId("agt"),
      name: reg.name,
      ownerId: reg.ownerId,
      runtime: reg.runtime,
      capabilities: normalizeCapabilities(reg.capabilities),
      status: "offline",
      token: newToken(),
      lastHeartbeat: null,
      createdAt: now,
      requestCount: 0,
      successCount: 0,
      avgLatencyMs: 0,
    };
    this.agents.set(agent.id, agent);
    this.persist();
    return agent;
  }

  getAgent(id: string): AgentRecord | undefined {
    return this.agents.get(id);
  }

  listAgents(): AgentRecord[] {
    return [...this.agents.values()];
  }

  setAgentStatus(id: string, status: AgentRecord["status"]): void {
    const agent = this.agents.get(id);
    if (agent) {
      agent.status = status;
      this.persist();
    }
  }

  touchHeartbeat(id: string): void {
    const agent = this.agents.get(id);
    if (agent) agent.lastHeartbeat = Date.now();
  }

  /* ---------------------------------------------------------------- tasks */

  createTask(task: TaskRecord): void {
    this.tasks.set(task.task_id, task);
    this.persist();
  }

  getTask(id: string): TaskRecord | undefined {
    return this.tasks.get(id);
  }

  updateTask(id: string, patch: Partial<TaskRecord>): TaskRecord | undefined {
    const task = this.tasks.get(id);
    if (!task) return undefined;
    Object.assign(task, patch);
    this.persist();
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
    this.persist();
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
    this.persist();
  }
}
