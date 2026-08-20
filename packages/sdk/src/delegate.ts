import {
  DEFAULT_RELAY_URL,
  DEFAULT_TASK_TIMEOUT_S,
  DEFAULT_TASK_PERMISSIONS,
  isTerminal,
  type TaskContext,
  type TaskPermissions,
  type TaskRecord,
  type TaskRequirements,
  type AgentPublic,
} from "@agent-relay/protocol";
import { RelayClient } from "./client.js";

export interface DelegateOptions {
  /** What the remote agent should do. */
  goal: string;
  /** Capabilities required from the provider, e.g. ["typescript", "redis"]. */
  capabilities?: string[];
  type?: string;
  context?: TaskContext;
  requirements?: TaskRequirements;
  permissions?: TaskPermissions;
  baseUrl?: string;
  consumerId?: string;
  pollIntervalMs?: number;
  /** Called on lifecycle events so callers can render progress. */
  onEvent?: (event: DelegateEvent) => void;
  /** Called with live output deltas streamed by the provider (best-effort). */
  onChunk?: (text: string) => void;
}

export type DelegateEvent =
  | { type: "dispatched"; task_id: string; provider: AgentPublic | null }
  | { type: "status"; task_id: string; status: string };

export class DelegationError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly task?: TaskRecord,
  ) {
    super(message);
    this.name = "DelegationError";
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The core MVP call:
 *   delegate() → relay → registry → pick provider → dispatch → poll → result
 */
export async function delegate(opts: DelegateOptions): Promise<TaskRecord> {
  const baseUrl = opts.baseUrl ?? DEFAULT_RELAY_URL;
  const client = new RelayClient(baseUrl, { consumerId: opts.consumerId });

  let created;
  try {
    created = await client.createTask({
      goal: opts.goal,
      capabilities: opts.capabilities,
      type: opts.type,
      context: opts.context,
      requirements: opts.requirements,
      permissions: opts.permissions ?? DEFAULT_TASK_PERMISSIONS,
    });
  } catch (err) {
    const e = err as { status?: number; code?: string; message?: string };
    throw new DelegationError(
      e.message ?? "failed to create task",
      e.code ?? "create_failed",
    );
  }

  opts.onEvent?.({ type: "dispatched", task_id: created.task_id, provider: created.provider });

  // Live stream (SSE) runs alongside polling; polling stays the source of
  // truth for status, the stream only delivers output deltas.
  const sseAbort = new AbortController();
  if (opts.onChunk) {
    void streamTaskChunks(baseUrl, created.task_id, opts.onChunk, sseAbort.signal, {
      consumerId: opts.consumerId,
    });
  }

  const timeoutS = opts.requirements?.timeout ?? DEFAULT_TASK_TIMEOUT_S;
  const deadline = Date.now() + timeoutS * 1000 + 60_000; // grace for relay-side timeout sweep
  const pollMs = opts.pollIntervalMs ?? 1500;
  let lastStatus = created.status;

  try {
    while (Date.now() < deadline) {
      await sleep(pollMs);
      const task = await client.getTask(created.task_id);
      if (task.status !== lastStatus) {
        lastStatus = task.status;
        opts.onEvent?.({ type: "status", task_id: task.task_id, status: task.status });
      }
      if (isTerminal(task.status)) {
        if (task.status !== "completed") {
          throw new DelegationError(
            task.error ?? `task ${task.status}`,
            `task_${task.status}`,
            task,
          );
        }
        return task;
      }
    }
  } finally {
    sseAbort.abort();
  }

  const last = await client.getTask(created.task_id).catch(() => undefined);
  throw new DelegationError("delegate timed out waiting for result", "delegate_timeout", last);
}

/**
 * Read the relay's SSE stream for a task and forward text deltas.
 * Best-effort: any failure just ends the stream (polling still works).
 */
async function streamTaskChunks(
  baseUrl: string,
  taskId: string,
  onChunk: (text: string) => void,
  signal: AbortSignal,
  headers: { consumerId?: string },
): Promise<void> {
  try {
    const res = await fetch(`${baseUrl}/api/tasks/${taskId}/stream`, {
      headers: headers.consumerId ? { "x-consumer-id": headers.consumerId } : {},
      signal,
    });
    if (!res.ok || !res.body) return;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        if (handleSseFrame(frame, onChunk)) return; // "done" frame
      }
    }
  } catch {
    /* aborted or network error — polling remains authoritative */
  }
}

/** Returns true when the frame is the terminal "done" event. */
function handleSseFrame(frame: string, onChunk: (text: string) => void): boolean {
  let event = "";
  const dataLines: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
  if (!dataLines.length) return false;
  let data: { text?: string };
  try {
    data = JSON.parse(dataLines.join("\n")) as { text?: string };
  } catch {
    return event === "done";
  }
  if ((event === "chunk" || event === "snapshot") && typeof data.text === "string") {
    onChunk(data.text);
  }
  return event === "done";
}
