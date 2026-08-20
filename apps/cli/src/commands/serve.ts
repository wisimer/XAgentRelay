import { runTask } from "@agent-relay/agent-runtime";
import type { TaskEnvelope } from "@agent-relay/protocol";
import { ProviderConnection } from "@agent-relay/sdk";
import { ensureIdentity, readAgentProfile } from "@agent-relay/shared";
import { bold, cyan, dim, err, green, red, resolveRelayUrl, statusColor, yellow } from "../util.js";

export interface ServeOptions {
  relay?: string;
}

export async function runServe(opts: ServeOptions): Promise<void> {
  const baseUrl = resolveRelayUrl(opts.relay);
  const identity = ensureIdentity();
  const profile = readAgentProfile();

  if (!identity.agent_id || !identity.token) {
    err("This machine is not registered as a provider. Run `agent-relay register` first.");
    process.exitCode = 1;
    return;
  }
  if (!profile) {
    err("Missing ~/.agent-relay/agent.json. Run `agent-relay init` first.");
    process.exitCode = 1;
    return;
  }

  let conn: ProviderConnection;
  /** task_id → AbortController for the running runtime process. */
  const running = new Map<string, AbortController>();
  let shuttingDown = false;

  conn = new ProviderConnection({
    baseUrl,
    agentId: identity.agent_id,
    token: identity.token,
    log: (m) => console.log(dim(`  · ${m}`)),
    onStatusChange: (s) => {
      if (s === "offline") console.log(yellow("  ! relay connection lost, retrying..."));
    },
    onTask: async (task: TaskEnvelope) => {
      printTaskBanner(task);
      const startedAt = Date.now();
      const abort = new AbortController();
      running.set(task.task_id, abort);
      conn.acceptTask(task.task_id);
      // Stream live output to the consumer, batched to one WS frame per 200ms.
      let chunkBuf = "";
      const flushChunks = () => {
        if (chunkBuf) {
          conn.sendChunk(task.task_id, chunkBuf);
          chunkBuf = "";
        }
      };
      const flusher = setInterval(flushChunks, 200);
      try {
        console.log(dim(`  · running with runtime "${profile.runtime}" (read-only, sandboxed temp dir)`));
        conn.startTask(task.task_id);
        const outcome = await runTask(task, profile.runtime, {
          signal: abort.signal,
          onChunk: (text) => {
            chunkBuf += text;
          },
        });
        flushChunks(); // trailing chunks must go out before the terminal result
        conn.sendResult(task.task_id, { status: "completed", result: outcome.result, usage: outcome.usage });
        const secs = ((Date.now() - startedAt) / 1000).toFixed(1);
        console.log(green(`  ✓ completed in ${secs}s — ${outcome.result.summary.slice(0, 80)}`));
      } catch (e) {
        if (abort.signal.aborted) {
          // Consumer cancelled — relay already finalized the task, nothing to send.
          console.log(dim(`  ⊘ task cancelled, runtime process killed`));
        } else {
          const message = (e as Error).message ?? String(e);
          flushChunks();
          conn.sendResult(task.task_id, { status: "failed", error: message });
          console.log(red(`  ✗ failed: ${message}`));
        }
      } finally {
        clearInterval(flusher);
        running.delete(task.task_id);
      }
      if (!shuttingDown) {
        console.log(dim("  ─────────────────────────────────────────"));
        console.log(bold("Waiting for tasks..."));
      }
    },
    onCancel: (taskId) => {
      console.log(yellow(`  ⊘ cancel received for ${taskId} — stopping runtime`));
      running.get(taskId)?.abort();
    },
  });

  conn.start();

  try {
    await conn.waitUntilOnline();
  } catch {
    err(`cannot register with relay at ${baseUrl}`);
    process.exitCode = 1;
    return;
  }

  const agentId = identity.agent_id;
  console.log("");
  console.log(bold("Agent Relay Provider"));
  console.log(`  ${bold("Agent ID:")}     ${agentId}`);
  console.log(`  ${bold("Status:")}       ${statusColor("online")}`);
  console.log(`  ${bold("Runtime:")}     ${profile.runtime}`);
  console.log(`  ${bold("Caps:")}        ${profile.capabilities.join(", ")}`);
  console.log(`  ${bold("Relay:")}       ${baseUrl}`);
  console.log("");
  console.log(bold("Waiting for tasks..."));
  console.log(dim("  Ctrl+C to go offline\n"));

  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    // Tell the relay about in-flight tasks so consumers fail fast instead of
    // waiting for the timeout sweeper; then kill local runtime processes.
    for (const [taskId, abort] of running) {
      conn.sendResult(taskId, { status: "failed", error: "provider shutting down" });
      abort.abort();
    }
    if (running.size) {
      console.log(dim(`\n  reported ${running.size} in-flight task(s) as failed, stopping runtimes...`));
    } else {
      console.log(dim("\n  going offline..."));
    }
    running.clear();
    // Small delay so the failure messages flush over the socket before close.
    setTimeout(() => {
      conn.close();
      process.exit(0);
    }, 150);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

function printTaskBanner(task: TaskEnvelope): void {
  console.log("");
  console.log(cyan("━━━ Task received ━━━"));
  console.log(`  ${bold("Task ID:")}  ${task.task_id}`);
  if (task.type) console.log(`  ${bold("Type:")}     ${task.type}`);
  console.log(`  ${bold("Goal:")}     ${task.goal}`);
  console.log(`  ${bold("Caps:")}     ${task.capabilities.join(", ") || "—"}`);
  const files = task.context?.files?.length ?? 0;
  const logs = task.context?.logs?.length ?? 0;
  if (files || logs) console.log(dim(`  context: ${files} file(s), ${logs} log(s)`));
}
