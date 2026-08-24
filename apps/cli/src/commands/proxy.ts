import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import readline from "node:readline";
import { delegate, DelegationError, RelayClient, type DelegateEvent } from "@x-agent-relay/sdk";
import { ensureIdentity } from "@x-agent-relay/shared";
import { bold, cyan, dim, err, green, resolveRelayUrl, yellow } from "../util.js";

export interface ProxyOptions {
  relay?: string;
  port?: string;
  runtime?: string;
  model?: string;
  list?: boolean;
  wire?: boolean;
  restore?: boolean;
}

const DEFAULT_PORT = 8790;

interface RuntimeModels {
  runtime: string;
  models: string[];
  agents: number;
}

/** Online agents grouped by runtime, models = capability tags in provider/model format. */
async function fetchRuntimeModels(baseUrl: string): Promise<RuntimeModels[]> {
  const agents = await new RelayClient(baseUrl).listAgents();
  const online = agents.filter((a) => a.status === "online");
  const byRuntime = new Map<string, { models: Set<string>; agents: number }>();
  for (const a of online) {
    const entry = byRuntime.get(a.runtime) ?? { models: new Set<string>(), agents: 0 };
    entry.agents += 1;
    for (const cap of a.capabilities) if (cap.includes("/")) entry.models.add(cap);
    byRuntime.set(a.runtime, entry);
  }
  return [...byRuntime.entries()]
    .map(([runtime, e]) => ({ runtime, models: [...e.models].sort(), agents: e.agents }))
    .sort((x, y) => y.agents - x.agents || x.runtime.localeCompare(y.runtime));
}

/* ------------------------------------------------------------ TTY pickers */

/** Single-choice raw-mode picker: returns the chosen option, or null when cancelled. */
function selectOne(title: string, options: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    let cursor = 0;
    let rendered = 0;

    const render = () => {
      if (rendered > 0) process.stdout.write(`\x1b[${rendered}A`);
      const lines = [
        bold(title),
        ...options.map((o, i) => `${i === cursor ? "❯" : " "} ${o}`),
        dim("↑/↓ move · enter select · ctrl+c cancel"),
      ];
      for (const line of lines) process.stdout.write(`\x1b[2K\r${line}\n`);
      rendered = lines.length;
    };

    const cleanup = (result: string | null) => {
      process.stdin.removeListener("keypress", onKey);
      rl.close();
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
      resolve(result);
    };

    const onKey = (_str: string, key: { name?: string; ctrl?: boolean }) => {
      if (key.ctrl && key.name === "c") return cleanup(null);
      if (key.name === "up") cursor = (cursor - 1 + options.length) % options.length;
      else if (key.name === "down") cursor = (cursor + 1) % options.length;
      else if (key.name === "return") return cleanup(options[cursor]);
      else return;
      render();
    };

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.on("keypress", onKey);
    render();
  });
}

const ALL_MODELS_SENTINEL = "‹all models of this runtime›";

async function pickRuntime(entries: RuntimeModels[]): Promise<RuntimeModels | null> {
  const labels = entries.map((e) => `${e.runtime}  (${e.agents} agent(s), ${e.models.length} model(s))`);
  const chosen = await selectOne("Which agent runtime should serve your requests?", labels);
  if (!chosen) return null;
  return entries[labels.indexOf(chosen)] ?? null;
}

async function pickModel(entry: RuntimeModels): Promise<string | null> {
  if (!entry.models.length) return "";
  return await selectOne(`Model for ${entry.runtime}:`, [...entry.models, dim(ALL_MODELS_SENTINEL)])
    .then((m) => (m === null ? null : m.includes(ALL_MODELS_SENTINEL) ? "" : m));
}

/* --------------------------------------------------------- auto-wiring */

const CLAUDE_SETTINGS = () => join(homedir(), ".claude", "settings.json");
const CLAUDE_BACKUP = () => CLAUDE_SETTINGS() + ".x-agent-relay-bak";
const OPENCODE_SETTINGS = () => join(homedir(), ".config", "opencode", "opencode.json");
const OPENCODE_BACKUP = () => OPENCODE_SETTINGS() + ".x-agent-relay-bak";

function readJson(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Back up before the first modification only, so --restore undoes to the
 *  user's true pre-wire state even after several wire runs. */
function backupOnce(path: string, backup: string): void {
  if (existsSync(path) && !existsSync(backup)) copyFileSync(path, backup);
}

/** Point Claude Code at the local proxy (env block of ~/.claude/settings.json). */
function wireClaudeCode(baseUrl: string): string {
  const settingsPath = CLAUDE_SETTINGS();
  mkdirSync(dirname(settingsPath), { recursive: true });
  if (!existsSync(settingsPath)) writeFileSync(settingsPath, "{}\n", "utf8");
  backupOnce(settingsPath, CLAUDE_BACKUP());
  const settings = readJson(settingsPath);
  settings.env = {
    ...(settings.env as Record<string, unknown> | undefined),
    ANTHROPIC_BASE_URL: baseUrl,
    ANTHROPIC_AUTH_TOKEN: "x-agent-relay-proxy",
  };
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf8");
  return settingsPath;
}

/**
 * Register an "agent-relay" provider in opencode's config so its /models list
 * shows every relay model. Model keys are sanitized (provider/model →
 * provider-model) because opencode references models as provider/model and a
 * slash inside the id would be ambiguous; the proxy maps them back to tags.
 */
function wireOpenCode(baseUrl: string, models: { key: string; tag: string; runtime: string }[]): string {
  const settingsPath = OPENCODE_SETTINGS();
  mkdirSync(dirname(settingsPath), { recursive: true });
  if (!existsSync(settingsPath)) writeFileSync(settingsPath, "{}\n", "utf8");
  backupOnce(settingsPath, OPENCODE_BACKUP());
  const settings = readJson(settingsPath);
  const provider = settings.provider as Record<string, unknown> | undefined;
  const modelMap: Record<string, { name: string }> = {};
  for (const m of models) modelMap[m.key] = { name: `${m.tag} · ${m.runtime}` };
  settings.provider = {
    ...(provider ?? {}),
    "agent-relay": {
      npm: "@ai-sdk/openai-compatible",
      name: "Agent Relay",
      options: { baseURL: `${baseUrl}/v1`, apiKey: "x-agent-relay" },
      models: modelMap,
    },
  };
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf8");
  return settingsPath;
}

/** Restore every file the wirer touched. Returns human-readable results. */
function restoreAll(): string[] {
  const results: string[] = [];
  for (const [settings, backup, label] of [
    [CLAUDE_SETTINGS(), CLAUDE_BACKUP(), "Claude Code"],
    [OPENCODE_SETTINGS(), OPENCODE_BACKUP(), "opencode"],
  ] as const) {
    if (existsSync(backup)) {
      copyFileSync(backup, settings);
      results.push(`${label}: restored`);
    }
  }
  return results;
}

/* ------------------------------------------------------ protocol adapters */

interface ChatRequest {
  prompt: string;
  stream: boolean;
  model: string | undefined;
}

function textOfContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content as { type?: string; text?: string; name?: string }[]) {
    if (block.type === "text" && block.text) parts.push(block.text);
    else if (block.type === "tool_use") parts.push(`[tool_use: ${block.name ?? "?"}]`);
    else if (block.type === "tool_result") parts.push("[tool_result omitted]");
  }
  return parts.join("\n");
}

/** Flatten an Anthropic /v1/messages body into a task goal. */
function parseAnthropic(body: Record<string, unknown>): ChatRequest {
  const lines: string[] = [];
  const system = textOfContent(body.system);
  if (system) lines.push(`[system]\n${system}`);
  for (const m of (body.messages as { role?: string; content?: unknown }[]) ?? []) {
    const text = textOfContent(m.content).trim();
    if (text) lines.push(`[${m.role === "assistant" ? "assistant" : "user"}]\n${text}`);
  }
  return { prompt: lines.join("\n\n"), stream: body.stream === true, model: typeof body.model === "string" ? body.model : undefined };
}

/** Flatten an OpenAI /v1/chat/completions body into a task goal. */
function parseOpenAi(body: Record<string, unknown>): ChatRequest {
  const lines: string[] = [];
  for (const m of (body.messages as { role?: string; content?: unknown }[]) ?? []) {
    const text = textOfContent(m.content).trim();
    if (text) lines.push(`[${m.role ?? "user"}]\n${text}`);
  }
  return { prompt: lines.join("\n\n"), stream: body.stream === true, model: typeof body.model === "string" ? body.model : undefined };
}

function writeJson(res: ServerResponse, status: number, body: Record<string, unknown>): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(payload) });
  res.end(payload);
}

function sseHead(res: ServerResponse): void {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
}

function sseEvent(res: ServerResponse, event: string | null, data: unknown): void {
  if (event) res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

/* ------------------------------------------------------------- the server */

interface ProxyState {
  baseUrl: string;
  runtime: string;
  model: string; // "" = any model of the runtime's agents
  /** Request model name (tag or sanitized) → model tag, for per-request routing. */
  routes: Map<string, string>;
  consumerId: string;
  startedAt: number;
  requests: number;
}

/** Model-tag routing table: exact tags plus sanitized keys ("zhipu/glm" → "zhipu-glm"). */
function buildRoutes(entries: RuntimeModels[]): Map<string, string> {
  const routes = new Map<string, string>();
  for (const e of entries) {
    for (const tag of e.models) {
      routes.set(tag, tag);
      routes.set(tag.replace(/\//g, "-"), tag);
    }
  }
  return routes;
}

/**
 * Delegate one chat request to the relay. The target model is the one the
 * client asked for when it names a known tag (so switching models inside the
 * coding agent switches the remote agent), else the proxy's selection.
 * Live provider chunks are forwarded through onChunk as they arrive; after
 * completion only the not-yet-streamed remainder of the final text is sent,
 * so nothing is duplicated.
 */
async function delegateAsModel(
  state: ProxyState,
  req: ChatRequest,
  onChunk?: (text: string) => void,
): Promise<string> {
  const requested = req.model ? state.routes.get(req.model.trim().toLowerCase()) : undefined;
  const target = requested ?? state.model;
  let streamed = "";
  const task = await delegate({
    goal: req.prompt,
    capabilities: target ? [target] : [],
    type: "chat",
    context: { environment: { via: "x-agent-relay proxy", runtime: state.runtime, ...(target ? { model: target } : {}) } },
    baseUrl: state.baseUrl,
    consumerId: state.consumerId,
    onEvent: (ev: DelegateEvent) => void ev,
    onChunk: (text) => {
      streamed += text;
      onChunk?.(text);
    },
  });
  const text = task.result?.output ?? task.result?.summary ?? "";
  if (!onChunk) return text;
  if (!streamed) return text;
  return text.startsWith(streamed) ? text.slice(streamed.length) : "";
}

function handleAnthropic(state: ProxyState, body: Record<string, unknown>, res: ServerResponse): void {
  const req = parseAnthropic(body);
  const model = state.model || req.model || "x-agent-relay";
  const id = `msg_${randomBytes(12).toString("hex")}`;
  if (!req.prompt.trim()) {
    writeJson(res, 400, { type: "error", error: { type: "invalid_request_error", message: "empty prompt" } });
    return;
  }

  if (req.stream) {
    sseHead(res);
    sseEvent(res, "message_start", { type: "message_start", message: { id, type: "message", role: "assistant", model, content: [], usage: { input_tokens: 0, output_tokens: 0 } } });
    sseEvent(res, "content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
  }
  const onChunk = req.stream ? (text: string) => sseEvent(res, "content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } }) : undefined;

  delegateAsModel(state, req, onChunk)
    .then((text) => {
      const outputTokens = Math.ceil(text.length / 4);
      if (!req.stream) {
        writeJson(res, 200, {
          id, type: "message", role: "assistant", model,
          content: [{ type: "text", text }],
          stop_reason: "end_turn", stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: outputTokens },
        });
        return;
      }
      if (text) sseEvent(res, "content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } });
      sseEvent(res, "content_block_stop", { type: "content_block_stop", index: 0 });
      sseEvent(res, "message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: outputTokens } });
      sseEvent(res, "message_stop", { type: "message_stop" });
      res.end();
    })
    .catch((e: unknown) => {
      const message = e instanceof DelegationError ? e.message : (e as Error).message;
      if (req.stream && res.headersSent) {
        sseEvent(res, "error", { type: "error", error: { type: "api_error", message } });
        res.end();
      } else {
        writeJson(res, 502, { type: "error", error: { type: "api_error", message } });
      }
    });
}

function handleOpenAi(state: ProxyState, body: Record<string, unknown>, res: ServerResponse): void {
  const req = parseOpenAi(body);
  const model = state.model || req.model || "x-agent-relay";
  const id = `chatcmpl-${randomBytes(12).toString("hex")}`;
  if (!req.prompt.trim()) {
    writeJson(res, 400, { error: { message: "empty prompt", type: "invalid_request_error" } });
    return;
  }

  if (req.stream) sseHead(res);
  const chunkBase = { id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model };
  const onChunk = req.stream
    ? (text: string) => sseEvent(res, null, { ...chunkBase, choices: [{ index: 0, delta: { content: text }, finish_reason: null }] })
    : undefined;

  delegateAsModel(state, req, onChunk)
    .then((text) => {
      if (!req.stream) {
        writeJson(res, 200, {
          id, object: "chat.completion", created: Math.floor(Date.now() / 1000), model,
          choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
          usage: { prompt_tokens: 0, completion_tokens: Math.ceil(text.length / 4), total_tokens: Math.ceil(text.length / 4) },
        });
        return;
      }
      if (text) sseEvent(res, null, { ...chunkBase, choices: [{ index: 0, delta: { content: text }, finish_reason: null }] });
      sseEvent(res, null, { ...chunkBase, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
      res.write("data: [DONE]\n\n");
      res.end();
    })
    .catch((e: unknown) => {
      const message = e instanceof DelegationError ? e.message : (e as Error).message;
      // Streaming responses already sent their headers — an SSE error chunk is
      // the only valid way to report failures there; writeHead would throw
      // ERR_HTTP_HEADERS_SENT and kill the proxy.
      if (res.headersSent) {
        sseEvent(res, null, { ...chunkBase, choices: [{ index: 0, delta: { content: `\n[agent-relay error] ${message}` }, finish_reason: "stop" }] });
        res.write("data: [DONE]\n\n");
        res.end();
      } else {
        writeJson(res, 502, { error: { message, type: "api_error" } });
      }
    });
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk: Buffer) => {
      data += chunk;
      if (data.length > 8 * 1024 * 1024) reject(new Error("request body too large"));
    });
    req.on("end", () => {
      if (!data.trim()) return resolve({});
      try {
        resolve(JSON.parse(data) as Record<string, unknown>);
      } catch {
        reject(new Error("invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

/* ---------------------------------------------------------------- command */

export async function runProxy(opts: ProxyOptions): Promise<void> {
  if (opts.restore) {
    const results = restoreAll();
    console.log(results.length ? green(`✓ ${results.join(" · ")}`) : dim("nothing to restore"));
    return;
  }

  const baseUrl = resolveRelayUrl(opts.relay);
  const identity = ensureIdentity();

  let entries: RuntimeModels[];
  try {
    entries = await fetchRuntimeModels(baseUrl);
  } catch (e) {
    err(`cannot reach relay at ${baseUrl} (${(e as Error).message})`);
    process.exitCode = 1;
    return;
  }
  if (!entries.length) {
    err("no online agents on the relay — providers should run `x-agent-relay serve`");
    process.exitCode = 1;
    return;
  }

  if (opts.list) {
    console.log(bold(`Agents on ${baseUrl}`));
    for (const e of entries) {
      console.log(`  ${cyan(e.runtime)}  ${dim(`${e.agents} agent(s)`)}`);
      for (const m of e.models) console.log(`    · ${m}`);
      if (!e.models.length) console.log(dim("    · (no model tags advertised)"));
    }
    return;
  }

  // Resolve runtime + model: flags win, otherwise interactive picker.
  let runtime = opts.runtime;
  let model = opts.model;
  if (!runtime) {
    if (process.stdin.isTTY) {
      const picked = await pickRuntime(entries);
      if (!picked) {
        console.log(dim("Cancelled."));
        return;
      }
      runtime = picked.runtime;
      if (!model) {
        const pickedModel = await pickModel(picked);
        if (pickedModel === null) {
          console.log(dim("Cancelled."));
          return;
        }
        model = pickedModel || undefined;
      }
    } else {
      runtime = entries[0].runtime;
      console.log(dim(`non-interactive: defaulting to runtime ${runtime}`));
    }
  }
  const entry = entries.find((e) => e.runtime === runtime);
  if (!entry) {
    err(`runtime "${runtime}" not online. Available: ${entries.map((e) => e.runtime).join(", ")}`);
    process.exitCode = 1;
    return;
  }
  if (model) {
    model = model.trim().toLowerCase();
    if (entry.models.length && !entry.models.includes(model)) {
      console.log(yellow(`  warning: ${model} not advertised by ${runtime}; delegating with this tag anyway`));
    }
  }

  const port = Number(opts.port ?? DEFAULT_PORT);
  const state: ProxyState = {
    baseUrl, runtime, model: model ?? "", routes: buildRoutes(entries),
    consumerId: identity.owner_id, startedAt: Date.now(), requests: 0,
  };

  const server = createServer((req, res) => {
    const url = (req.url ?? "/").split("?")[0];
    if (req.method === "GET" && (url === "/" || url === "/health")) {
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end(
        `x-agent-relay proxy\n` +
          `relay:    ${state.baseUrl}\n` +
          `runtime:  ${state.runtime}${state.model ? `  (model: ${state.model})` : "  (any model)"}\n` +
          `endpoint: http://127.0.0.1:${port}\n` +
          `requests: ${state.requests}\n` +
          `uptime:   ${Math.round((Date.now() - state.startedAt) / 1000)}s\n`,
      );
      return;
    }
    if (req.method === "GET" && url === "/v1/models") {
      writeJson(res, 200, {
        object: "list",
        data: entries.flatMap((e) => e.models.map((m) => ({ id: m, object: "model", owned_by: e.runtime }))),
      });
      return;
    }
    const handler = url === "/v1/messages" ? handleAnthropic : url === "/v1/chat/completions" ? handleOpenAi : null;
    if (!handler || req.method !== "POST") {
      writeJson(res, 404, { error: { message: `no route: ${req.method} ${url}` } });
      return;
    }
    state.requests += 1;
    readBody(req)
      .then((body) => handler(state, body, res))
      .catch((e: unknown) => {
        if (res.headersSent) {
          res.end(); // too late for a status code — just close the stream
        } else {
          writeJson(res, 400, { error: { message: (e as Error).message } });
        }
      });
  });

  server.listen(port, "127.0.0.1", () => {
    const target = `http://127.0.0.1:${port}`;
    console.log(green(`✓ proxy listening on ${target}`));
    console.log(`  ${bold("Relay:")}   ${state.baseUrl}`);
    console.log(`  ${bold("Runtime:")}  ${state.runtime}`);
    console.log(`  ${bold("Model:")}    ${state.model || "(any model of this runtime)"}`);
    console.log("");
    console.log(dim("Point your coding agent at it:"));
    console.log(`  Claude Code:  ${cyan("ANTHROPIC_BASE_URL=")}${target}`);
    console.log(`  OpenAI-style: ${cyan("OPENAI_BASE_URL=")}${target}`);
    console.log("");
    console.log(dim("Ctrl+C stops the proxy."));
  });

  // Zero-config wiring (cc-switch style): Claude Code env block + opencode
  // provider entry, both backed up, both undone by --restore. Default on for
  // the interactive flow, off for scripted --runtime/--model runs.
  const wantsWire = opts.wire ?? (process.stdin.isTTY && !opts.runtime);
  if (wantsWire) {
    const target = `http://127.0.0.1:${port}`;
    const models = entries.flatMap((e) =>
      e.models.map((tag) => ({ key: tag.replace(/\//g, "-"), tag, runtime: e.runtime })),
    );
    try {
      const path = wireClaudeCode(target);
      console.log(green(`✓ Claude Code wired: ${path}`));
    } catch (e) {
      console.log(yellow(`  could not wire Claude Code: ${(e as Error).message}`));
    }
    if (models.length) {
      try {
        const path = wireOpenCode(target, models);
        console.log(green(`✓ opencode wired: ${path}`));
        console.log(dim("  restart opencode → Agent Relay models appear in /models"));
      } catch (e) {
        console.log(yellow(`  could not wire opencode: ${(e as Error).message}`));
      }
    }
    console.log(dim(`  undo everything with \`x-agent-relay proxy --restore\``));
  }

  // A long-running proxy must survive any single bad request: log and keep serving.
  process.on("unhandledRejection", (reason) => {
    console.log(yellow(`  [proxy] unhandled rejection: ${String(reason)}`));
  });
  process.on("uncaughtException", (err) => {
    console.log(yellow(`  [proxy] uncaught exception: ${err instanceof Error ? err.message : String(err)}`));
  });

  const shutdown = () => {
    console.log(dim("\nshutting down..."));
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
