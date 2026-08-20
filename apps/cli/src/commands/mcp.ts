import readline from "node:readline";
import type { TaskFile } from "@x-agent-relay/protocol";
import { delegate, DelegationError, RelayClient } from "@x-agent-relay/sdk";
import { ensureIdentity } from "@x-agent-relay/shared";
import { resolveRelayUrl } from "../util.js";

/**
 * Minimal MCP stdio server exposing:
 *   - delegate_to_agent: the core MVP tool
 *   - list_agents: see who is on the network
 * All logs go to stderr — stdout carries only JSON-RPC.
 */

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: number | string;
  method: string;
  params?: Record<string, unknown>;
}

const DELEGATE_TOOL = {
  name: "delegate_to_agent",
  description:
    "Delegate a subtask to another agent on the Agent Relay network. " +
    "The remote agent analyses the context you provide and returns a result " +
    "(summary / analysis / recommendation). Use this when the current task " +
    "needs capabilities your agent lacks, or a second opinion helps.",
  inputSchema: {
    type: "object",
    properties: {
      task: { type: "string", description: "Clear description of what the remote agent should do." },
      capabilities: {
        type: "array",
        items: { type: "string" },
        description: "Required capabilities, e.g. ['typescript','redis','debugging'].",
      },
      files: {
        type: "array",
        items: {
          type: "object",
          properties: {
            path: { type: "string" },
            content: { type: "string" },
          },
          required: ["path", "content"],
        },
        description: "Files to share. You decide what the remote agent sees.",
      },
      logs: { type: "array", items: { type: "string" }, description: "Relevant log output." },
      environment: {
        type: "object",
        description: "Environment info, e.g. {language:'typescript', framework:'nextjs'}.",
      },
      timeout: { type: "number", description: "Timeout in seconds (default 300)." },
    },
    required: ["task"],
  },
};

const LIST_TOOL = {
  name: "list_agents",
  description: "List agents currently registered on the Agent Relay network, optionally filtered by capability.",
  inputSchema: {
    type: "object",
    properties: {
      capability: { type: "string", description: "Only return agents with this capability." },
    },
  },
};

export async function runMcpServer(): Promise<void> {
  const baseUrl = resolveRelayUrl();
  const identity = ensureIdentity();
  const rl = readline.createInterface({ input: process.stdin });

  // Task ids currently being delegated through this server. When the host
  // agent kills us (SIGINT/SIGTERM), cancel them so providers stop working.
  const inFlight = new Set<string>();
  const cancelAllInFlight = async () => {
    const ids = [...inFlight];
    if (ids.length) {
      const client = new RelayClient(baseUrl, { consumerId: identity.owner_id });
      await Promise.allSettled(ids.map((id) => client.cancelTask(id)));
      process.stderr.write(`[x-agent-relay mcp] cancelled ${ids.length} in-flight task(s)\n`);
    }
    process.exit(0);
  };
  process.on("SIGINT", () => void cancelAllInFlight());
  process.on("SIGTERM", () => void cancelAllInFlight());

  // Exit when stdin closes and no in-flight requests remain (tests, pipes).
  let pending = 0;
  let stdinClosed = false;
  const maybeExit = () => {
    if (stdinClosed && pending === 0) process.exit(0);
  };

  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let req: JsonRpcRequest;
    try {
      req = JSON.parse(trimmed) as JsonRpcRequest;
    } catch {
      return;
    }
    pending += 1;
    handle(req, baseUrl, identity.owner_id, inFlight)
      .catch((err) => {
        if (req.id !== undefined) respond(req.id, { error: { code: -32603, message: String(err) } });
      })
      .finally(() => {
        pending -= 1;
        maybeExit();
      });
  });

  rl.on("close", () => {
    stdinClosed = true;
    maybeExit();
  });

  process.stderr.write(`[x-agent-relay mcp] serving tools for relay ${baseUrl}\n`);
}

function respond(id: number | string, result: unknown): void {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
}

async function handle(
  req: JsonRpcRequest,
  baseUrl: string,
  consumerId: string,
  inFlight: Set<string>,
): Promise<void> {
  // Notifications (no id) never get a response.
  if (req.id === undefined) return;

  if (req.method === "initialize") {
    respond(req.id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "x-agent-relay", version: "0.1.5" },
    });
    return;
  }
  if (req.method === "tools/list") {
    respond(req.id, { tools: [DELEGATE_TOOL, LIST_TOOL] });
    return;
  }
  if (req.method === "tools/call") {
    const name = String(req.params?.name ?? "");
    const args = (req.params?.arguments ?? {}) as Record<string, unknown>;
    if (name === "delegate_to_agent") return await callDelegate(req.id, args, baseUrl, consumerId, inFlight);
    if (name === "list_agents") return await callListAgents(req.id, args, baseUrl);
    respond(req.id, { error: { code: -32602, message: `unknown tool: ${name}` } });
    return;
  }
  if (req.method === "ping") {
    respond(req.id, {});
    return;
  }
  respond(req.id, { error: { code: -32601, message: `method not found: ${req.method}` } });
}

async function callDelegate(
  id: number | string,
  args: Record<string, unknown>,
  baseUrl: string,
  consumerId: string,
  inFlight: Set<string>,
): Promise<void> {
  const goal = String(args.task ?? "").trim();
  if (!goal) {
    respond(id, { content: [{ type: "text", text: "error: 'task' is required" }], isError: true });
    return;
  }
  const files = Array.isArray(args.files)
    ? (args.files as { path: string; content: string }[]).map<TaskFile>((f) => ({ path: f.path, content: f.content }))
    : undefined;
  const logs = Array.isArray(args.logs) ? (args.logs as string[]) : undefined;
  const environment =
    args.environment && typeof args.environment === "object"
      ? (args.environment as Record<string, string | number>)
      : undefined;

  let taskId: string | null = null;
  try {
    const task = await delegate({
      goal,
      capabilities: Array.isArray(args.capabilities) ? (args.capabilities as string[]) : [],
      context: files || logs || environment ? { files, logs, environment } : undefined,
      requirements: typeof args.timeout === "number" ? { timeout: args.timeout } : undefined,
      baseUrl,
      consumerId,
      onEvent: (ev) => {
        if (ev.type === "dispatched") {
          taskId = ev.task_id;
          inFlight.add(ev.task_id);
        }
      },
    });
    respond(id, { content: [{ type: "text", text: formatResult(task) }] });
  } catch (e) {
    const message =
      e instanceof DelegationError
        ? `delegation failed: ${e.message}${e.task ? ` (status: ${e.task.status})` : ""}`
        : `delegation failed: ${(e as Error).message}`;
    respond(id, { content: [{ type: "text", text: message }], isError: true });
  } finally {
    if (taskId) inFlight.delete(taskId);
  }
}

async function callListAgents(id: number | string, args: Record<string, unknown>, baseUrl: string): Promise<void> {
  try {
    const agents = await new RelayClient(baseUrl).listAgents(
      typeof args.capability === "string" ? args.capability : undefined,
    );
    const lines = agents.map(
      (a) => `[${a.status}] ${a.name} (${a.runtime}) caps: ${a.capabilities.join(", ") || "—"} id=${a.id}`,
    );
    respond(id, {
      content: [{ type: "text", text: lines.length ? lines.join("\n") : "no agents registered" }],
    });
  } catch (e) {
    respond(id, { content: [{ type: "text", text: `failed: ${(e as Error).message}` }], isError: true });
  }
}

function formatResult(task: {
  status: string;
  providerId: string | null;
  result: { summary?: string; analysis?: string; recommendation?: string; confidence?: number; output?: string } | null;
  usage: { input_tokens?: number; output_tokens?: number } | null;
  completedAt: number | null;
  startedAt: number | null;
}): string {
  const r = task.result ?? {};
  const parts: string[] = [];
  parts.push(`Remote agent (${task.providerId}) ${task.status}:`);
  if (r.summary) parts.push(`\nSummary: ${r.summary}`);
  if (r.analysis) parts.push(`\nAnalysis: ${r.analysis}`);
  if (r.recommendation) parts.push(`\nRecommendation: ${r.recommendation}`);
  if (!r.summary && !r.analysis && r.output) parts.push(`\n${r.output}`);
  if (r.confidence != null) parts.push(`\nconfidence: ${r.confidence}`);
  if (task.usage) {
    const u: string[] = [];
    if (task.usage.input_tokens != null) u.push(`in ${task.usage.input_tokens}`);
    if (task.usage.output_tokens != null) u.push(`out ${task.usage.output_tokens}`);
    if (u.length) parts.push(`\nusage: ${u.join(" / ")} tokens`);
  }
  return parts.join("\n");
}
