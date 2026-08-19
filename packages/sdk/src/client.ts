import type {
  AgentPublic,
  AgentRegistration,
  CreateTaskRequest,
  CreateTaskResponse,
  RegisterResponse,
  StatsResponse,
  TaskRecord,
} from "@agent-relay/protocol";

export class RelayApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "RelayApiError";
  }
}

export interface RelayClientOptions {
  /** Sent as x-consumer-id on task creation. */
  consumerId?: string;
  /** Bearer token (registered agents). Currently optional in MVP. */
  token?: string;
}

/** Thin HTTP client for the relay server API. */
export class RelayClient {
  constructor(
    readonly baseUrl: string,
    private readonly opts: RelayClientOptions = {},
  ) {}

  async health(): Promise<{ ok: boolean; version: string; uptime_s: number }> {
    return this.req("/api/health");
  }

  async registerAgent(reg: AgentRegistration): Promise<RegisterResponse> {
    return this.req("/api/agents/register", {
      method: "POST",
      body: JSON.stringify(reg),
    });
  }

  async listAgents(capability?: string): Promise<AgentPublic[]> {
    const qs = capability ? `?capability=${encodeURIComponent(capability)}` : "";
    return this.req(`/api/agents${qs}`);
  }

  async getAgent(id: string): Promise<AgentPublic | null> {
    const res = await this.req<{ agent: AgentPublic | null }>(`/api/agents/${id}`);
    return res.agent;
  }

  async createTask(body: CreateTaskRequest): Promise<CreateTaskResponse> {
    return this.req("/api/tasks", { method: "POST", body: JSON.stringify(body) });
  }

  /** Cancel a running task; the relay forwards task_cancel to the provider. */
  async cancelTask(id: string): Promise<{ ok: boolean }> {
    return this.req(`/api/tasks/${id}/cancel`, { method: "POST" });
  }

  async getTask(id: string): Promise<TaskRecord> {
    const res = await this.req<{ task: TaskRecord }>(`/api/tasks/${id}`);
    return res.task;
  }

  async listTasks(filter: { consumer?: string; provider?: string; limit?: number } = {}): Promise<TaskRecord[]> {
    const params = new URLSearchParams();
    if (filter.consumer) params.set("consumer", filter.consumer);
    if (filter.provider) params.set("provider", filter.provider);
    if (filter.limit) params.set("limit", String(filter.limit));
    const qs = params.toString();
    const res = await this.req<{ tasks: TaskRecord[] }>(`/api/tasks${qs ? `?${qs}` : ""}`);
    return res.tasks;
  }

  async stats(): Promise<StatsResponse> {
    return this.req("/api/stats");
  }

  private async req<T>(path: string, init?: RequestInit): Promise<T> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.opts.token) headers.authorization = `Bearer ${this.opts.token}`;
    if (this.opts.consumerId) headers["x-consumer-id"] = this.opts.consumerId;
    const res = await fetch(`${this.baseUrl}${path}`, { ...init, headers });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      throw new RelayApiError(
        typeof body.error === "string" ? body.error : res.statusText,
        res.status,
        typeof body.code === "string" ? body.code : undefined,
      );
    }
    return body as T;
  }
}
