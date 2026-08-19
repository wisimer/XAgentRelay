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
      conn.acceptTask(task.task_id);
      try {
        console.log(dim(`  · running with runtime "${profile.runtime}" (read-only, sandboxed temp dir)`));
        conn.startTask(task.task_id);
        const outcome = await runTask(task, profile.runtime);
        conn.sendResult(task.task_id, { status: "completed", result: outcome.result, usage: outcome.usage });
        const secs = ((Date.now() - startedAt) / 1000).toFixed(1);
        console.log(green(`  ✓ completed in ${secs}s — ${outcome.result.summary.slice(0, 80)}`));
      } catch (e) {
        const message = (e as Error).message ?? String(e);
        conn.sendResult(task.task_id, { status: "failed", error: message });
        console.log(red(`  ✗ failed: ${message}`));
      }
      console.log(dim("  ─────────────────────────────────────────"));
      console.log(bold("Waiting for tasks..."));
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
    console.log(dim("\n  going offline..."));
    conn.close();
    process.exit(0);
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
