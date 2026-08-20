import WebSocket from "ws";
import {
  HEARTBEAT_MS,
  type RelayMessage,
  type TaskEnvelope,
  type TaskResultPayload,
  type TaskUsage,
} from "@agent-relay/protocol";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function wsAgentUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = url.pathname.replace(/\/$/, "") + "/agent";
  return url.toString();
}

export type ProviderStatus = "connecting" | "online" | "offline";

export interface ProviderConnectionOptions {
  baseUrl: string;
  agentId: string;
  token: string;
  /** Called when the relay dispatches a task. Rejecting reports a failed result. */
  onTask: (task: TaskEnvelope) => Promise<void>;
  /** Called when the consumer (or relay) cancels a running task. Abort the work. */
  onCancel?: (taskId: string) => void;
  heartbeatMs?: number;
  reconnectDelayMs?: number;
  onStatusChange?: (status: ProviderStatus) => void;
  log?: (message: string) => void;
}

/**
 * Provider-side connection: dials the relay over WebSocket, registers,
 * heartbeats, and stays reconnected. Works behind NAT — it only dials out.
 */
export class ProviderConnection {
  private ws: WebSocket | null = null;
  private stopped = false;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private onlineResolve: (() => void) | null = null;
  private status: ProviderStatus = "offline";

  constructor(private readonly opts: ProviderConnectionOptions) {}

  start(): void {
    this.stopped = false;
    void this.runLoop();
  }

  /** Resolves on first successful registration (rejects after timeout). */
  async waitUntilOnline(timeoutMs = 15_000): Promise<void> {
    if (this.status === "online") return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("provider connection timeout")), timeoutMs);
      this.onlineResolve = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }

  close(): void {
    this.stopped = true;
    this.stopHeartbeat();
    this.ws?.close(1000);
  }

  /** task_update: accepted */
  acceptTask(taskId: string): void {
    this.send({ type: "task_update", task_id: taskId, status: "accepted" });
  }

  /** task_update: running */
  startTask(taskId: string): void {
    this.send({ type: "task_update", task_id: taskId, status: "running" });
  }

  /** Stream a live output delta for a running task (throttled by the caller). */
  sendChunk(taskId: string, chunk: string): void {
    this.send({ type: "task_chunk", task_id: taskId, chunk });
  }

  sendResult(
    taskId: string,
    payload: {
      status: "completed" | "failed";
      result?: TaskResultPayload;
      usage?: TaskUsage;
      error?: string;
    },
  ): void {
    this.send({ type: "task_result", task_id: taskId, ...payload });
  }

  get connected(): boolean {
    return this.status === "online";
  }

  /* ------------------------------------------------------------- internals */

  private async runLoop(): Promise<void> {
    while (!this.stopped) {
      try {
        await this.connectOnce();
      } catch (err) {
        this.opts.log?.(`connection error: ${String(err)}`);
      }
      if (this.stopped) break;
      this.setStatus("offline");
      await sleep(this.opts.reconnectDelayMs ?? 3000);
    }
  }

  private connectOnce(): Promise<void> {
    return new Promise((resolve) => {
      const url = wsAgentUrl(this.opts.baseUrl);
      this.setStatus("connecting");
      const ws = new WebSocket(url);
      this.ws = ws;

      ws.on("open", () => {
        this.send({ type: "register", agent_id: this.opts.agentId, token: this.opts.token });
      });

      ws.on("message", (data: WebSocket.RawData) => {
        let msg: RelayMessage;
        try {
          msg = JSON.parse(data.toString()) as RelayMessage;
        } catch {
          return;
        }
        if (msg.type === "registered") {
          this.setStatus("online");
          this.startHeartbeat();
          this.opts.log?.(`registered with relay as ${msg.agent.name} [${msg.agent.id}]`);
          this.onlineResolve?.();
          this.onlineResolve = null;
        } else if (msg.type === "task_dispatch") {
          Promise.resolve(this.opts.onTask(msg.task)).catch((err) => {
            this.sendResult(msg.task.task_id, {
              status: "failed",
              error: err?.message ?? String(err),
            });
          });
        } else if (msg.type === "task_cancel") {
          this.opts.onCancel?.(msg.task_id);
        } else if (msg.type === "error") {
          this.opts.log?.(`relay error: ${msg.message}`);
        }
      });

      const cleanup = () => {
        this.stopHeartbeat();
        if (this.ws === ws) this.ws = null;
        resolve();
      };
      ws.on("close", cleanup);
      ws.on("error", cleanup);
    });
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.send({ type: "heartbeat" });
    }, this.opts.heartbeatMs ?? HEARTBEAT_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private send(msg: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else {
      this.opts.log?.("dropping message, websocket not open");
    }
  }

  private setStatus(status: ProviderStatus): void {
    this.status = status;
    this.opts.onStatusChange?.(status);
  }
}
