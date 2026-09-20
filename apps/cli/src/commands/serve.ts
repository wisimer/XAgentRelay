import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { basename, resolve } from "node:path";
import { defaultModelForRuntime, runTask } from "@x-agent-relay/agent-runtime";
import type { TaskEnvelope } from "@x-agent-relay/protocol";
import { ProviderConnection, RelayClient } from "@x-agent-relay/sdk";
import { ensureIdentity, readAgentProfile, relayDir } from "@x-agent-relay/shared";
import { bold, cyan, dim, err, green, red, resolveRelayUrl, statusColor, yellow } from "../util.js";

export interface ServeOptions {
  relay?: string;
  /** Workspace directory. Defaults to the current working directory. */
  cwd?: string;
  /** Override the workspace agent display name. */
  name?: string;
}

/** Per-workspace agent credentials, kept under ~/.x-agent-relay/workspaces/. */
interface WorkspaceState {
  workspace: string;
  relay: string;
  agent_id: string;
  token: string;
  name: string;
  /** pid of the serve process currently holding this workspace (0 = free). */
  pid: number;
}

function workspacesDir(): string {
  const dir = resolve(relayDir(), "workspaces");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function workspaceStatePath(workspaceAbs: string): string {
  const base = basename(workspaceAbs).toLowerCase().replace(/[^a-z0-9._-]+/g, "-") || "ws";
  const hash = createHash("sha1").update(workspaceAbs).digest("hex").slice(0, 8);
  return resolve(workspacesDir(), `${base}-${hash}.json`);
}

function readWorkspaceState(workspaceAbs: string): WorkspaceState | null {
  try {
    const s = JSON.parse(readFileSync(workspaceStatePath(workspaceAbs), "utf8")) as WorkspaceState;
    return s?.workspace === workspaceAbs ? s : null;
  } catch {
    return null;
  }
}

function writeWorkspaceState(state: WorkspaceState): void {
  writeFileSync(workspaceStatePath(state.workspace), JSON.stringify(state, null, 2) + "\n", "utf8");
}

function isProcessAlive(pid: number): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

export async function runServe(opts: ServeOptions): Promise<void> {
  const baseUrl = resolveRelayUrl(opts.relay);
  const identity = ensureIdentity();
  const profile = readAgentProfile();

  if (!profile) {
    err("Missing ~/.x-agent-relay/agent.json. Run `x-agent-relay init` first.");
    process.exitCode = 1;
    return;
  }

  /* ------------------------------------------------------- workspace setup */
  const workspace = resolve(opts.cwd ?? process.cwd());
  const st = statSync(workspace, { throwIfNoEntry: false });
  if (!st?.isDirectory()) {
    err(`workspace directory not found: ${workspace}`);
    process.exitCode = 1;
    return;
  }

  const state = readWorkspaceState(workspace);
  if (state && state.pid && state.pid !== process.pid && isProcessAlive(state.pid)) {
    err(
      `another serve (pid ${state.pid}) is already running in this workspace.\n` +
        `  workspace: ${workspace}\n` +
        `  stop it first (Ctrl+C), or serve a different directory with --cwd.`,
    );
    process.exitCode = 1;
    return;
  }

  /* --------------------------------------- per-workspace agent registration */
  // Each workspace gets its own agent entry so multiple `serve` processes can
  // run side by side on one machine (one per directory) without replacing
  // each other's relay connection.
  const agentName = opts.name ?? state?.name ?? `${profile.name}@${basename(workspace)}`;
  const model = (profile.model ?? (profile.runtime ? defaultModelForRuntime(profile.runtime) : null))
    ?.trim()
    .toLowerCase();
  const capabilities = (profile.capabilities ?? ["coding"])
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean);
  if (model && !capabilities.includes(model)) capabilities.push(model);

  const client = new RelayClient(baseUrl);
  let agentId: string;
  let token: string;
  try {
    const res = await client.registerAgent({
      name: agentName,
      runtime: profile.runtime,
      capabilities,
      ownerId: identity.owner_id,
      // Re-registering an existing id refreshes its token; a stale id (relay
      // data wiped) simply creates a fresh agent — both are fine here.
      ...(state?.agent_id ? { agentId: state.agent_id } : {}),
    });
    agentId = res.agent_id;
    token = res.token;
  } catch (e) {
    err(`cannot register with relay at ${baseUrl} (${(e as Error).message})`);
    process.exitCode = 1;
    return;
  }

  const wsState: WorkspaceState = {
    workspace,
    relay: baseUrl,
    agent_id: agentId,
    token,
    name: agentName,
    pid: process.pid,
  };
  writeWorkspaceState(wsState);

  let conn: ProviderConnection;
  /** task_id → AbortController for the running runtime process. */
  const running = new Map<string, AbortController>();
  let shuttingDown = false;

  conn = new ProviderConnection({
    baseUrl,
    agentId,
    token,
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
        console.log(dim(`  · running with runtime "${profile.runtime}" in workspace (read-write): ${workspace}`));
        conn.startTask(task.task_id);
        const outcome = await runTask(task, profile.runtime, {
          cwd: workspace,
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

  console.log("");
  console.log(bold("Agent Relay Provider"));
  console.log(`  ${bold("Agent ID:")}     ${agentId}`);
  console.log(`  ${bold("Status:")}       ${statusColor("online")}`);
  console.log(`  ${bold("Runtime:")}     ${profile.runtime}`);
  console.log(`  ${bold("Workspace:")}   ${workspace} (read-write)`);
  console.log(`  ${bold("Caps:")}        ${capabilities.join(", ")}`);
  console.log(`  ${bold("Relay:")}       ${baseUrl}`);
  console.log("");
  console.log(bold("Waiting for tasks..."));
  console.log(dim("  Ctrl+C to go offline\n"));

  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    // Release the workspace lock (only if we still hold it).
    const cur = readWorkspaceState(workspace);
    if (cur && cur.pid === process.pid) writeWorkspaceState({ ...cur, pid: 0 });
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
