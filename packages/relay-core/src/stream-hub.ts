import { isTerminal, type TaskRecord } from "@x-agent-relay/protocol";

/** A consumer-side live subscriber for one task's stream. */
export interface StreamSink {
  chunk(text: string): void;
  done(task: TaskRecord): void;
}

/**
 * task_id → live subscriber registry. Platform-agnostic: the node server and
 * the Cloudflare Durable Object both keep one instance and route provider
 * task_chunk messages through it.
 */
export class StreamHub {
  private subs = new Map<string, Set<StreamSink>>();

  /** Returns the unsubscribe function. */
  subscribe(taskId: string, sink: StreamSink): () => void {
    let set = this.subs.get(taskId);
    if (!set) {
      set = new Set();
      this.subs.set(taskId, set);
    }
    set.add(sink);
    return () => {
      set.delete(sink);
      if (set.size === 0) this.subs.delete(taskId);
    };
  }

  publish(taskId: string, chunk: string): void {
    const set = this.subs.get(taskId);
    if (!set) return;
    for (const sink of set) {
      try {
        sink.chunk(chunk);
      } catch {
        /* a dead sink is cleaned up by its own abort handling */
      }
    }
  }

  /** Terminal-state fan-out; safe to call repeatedly (no-op when no subs). */
  finish(taskId: string, task: TaskRecord): void {
    const set = this.subs.get(taskId);
    if (!set) return;
    this.subs.delete(taskId);
    for (const sink of set) {
      try {
        sink.done(task);
      } catch {
        /* ignore */
      }
    }
  }

  /** Backstop for the sweeper: close subscribers of tasks that went terminal. */
  finishTerminal(tasks: TaskRecord[]): void {
    if (this.subs.size === 0) return;
    for (const task of tasks) {
      if (isTerminal(task.status)) this.finish(task.task_id, task);
    }
  }
}

const SSE_HEADERS = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache",
  connection: "keep-alive",
} as const;

/**
 * SSE response for GET /api/tasks/:id/stream:
 *   event: snapshot — buffered stream text so far (if any)
 *   event: chunk    — live provider output deltas
 *   event: done     — final task record, then the stream closes
 * A comment ping every 15s keeps proxies from idling the connection out.
 */
export function taskStreamResponse(task: TaskRecord, streams: StreamHub): Response {
  const encoder = new TextEncoder();
  let cleanup: () => void = () => {};
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (event: string, data: unknown): boolean => {
        if (closed) return false;
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
          return true;
        } catch {
          closed = true;
          return false;
        }
      };
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(ping);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      const ping = setInterval(() => {
        if (!closed) {
          try {
            controller.enqueue(encoder.encode(": ping\n\n"));
          } catch {
            close();
          }
        }
      }, 15_000);

      if (task.stream) send("snapshot", { text: task.stream });
      if (isTerminal(task.status)) {
        send("done", { task });
        close();
        return;
      }
      const unsub = streams.subscribe(task.task_id, {
        chunk: (text) => send("chunk", { text }),
        done: (t) => {
          send("done", { task: t });
          close();
        },
      });
      cleanup = () => {
        unsub();
        close();
      };
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(body, { headers: SSE_HEADERS });
}
