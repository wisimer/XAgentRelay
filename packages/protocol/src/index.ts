/**
 * Agent Relay protocol — the single source of truth for data structures shared
 * between the relay server, providers, consumers, and future SDKs (Python etc).
 */

export const PROTOCOL_VERSION = "1.0.0";

/** Default relay endpoint: the public Agent Relay network on Cloudflare. */
export const DEFAULT_RELAY_URL =
  (typeof process !== "undefined" ? process.env?.AGENT_RELAY_URL?.trim() : undefined) ||
  "https://agent.kreplay.com";

export const HEARTBEAT_MS = 30_000;
export const OFFLINE_AFTER_MS = 90_000;
export const DEFAULT_TASK_TIMEOUT_S = 300;

/* ------------------------------------------------------------------ Agents */

export type AgentStatus = "online" | "offline" | "busy";

/** Agent runtimes supported as provider executors in MVP phase 1. */
export type Runtime =
  | "claude-code"
  | "opencode"
  | "codex"
  | "copilot" // GitHub Copilot CLI (`copilot -p`)
  | "antigravity" // Google Antigravity CLI (`agy -p`)
  | "kiro" // AWS Kiro CLI (`kiro-cli chat --no-interactive`)
  | "trae-agent" // ByteDance trae-agent (`trae-cli run`)
  | "pi" // pi coding agent (`pi -p`)
  | "hermes" // Nous Research Hermes Agent (`hermes chat -q`)
  | "qoder" // Qoder CLI (best-effort positional)
  | "zcode" // Zhipu ZCode (best-effort `-p`)
  | "mock";

export interface AgentRegistration {
  name: string;
  runtime: Runtime | string;
  capabilities: string[];
  ownerId: string;
  /** Optional: re-register / update an existing agent by id. */
  agentId?: string;
}

/** Full record kept by the registry (server-side, includes the secret token). */
export interface AgentRecord {
  id: string;
  name: string;
  ownerId: string;
  runtime: Runtime | string;
  capabilities: string[];
  status: AgentStatus;
  token: string;
  lastHeartbeat: number | null;
  createdAt: number;
  requestCount: number;
  successCount: number;
  /** Rolling average latency in ms of completed tasks. */
  avgLatencyMs: number;
}

/** What we expose publicly about an agent (token is never included). */
export interface AgentPublic {
  id: string;
  name: string;
  runtime: Runtime | string;
  capabilities: string[];
  status: AgentStatus;
  lastHeartbeat: number | null;
  requestCount: number;
  successCount: number;
  avgLatencyMs: number;
}

export function toPublicAgent(a: AgentRecord): AgentPublic {
  return {
    id: a.id,
    name: a.name,
    runtime: a.runtime,
    capabilities: a.capabilities,
    status: a.status,
    lastHeartbeat: a.lastHeartbeat,
    requestCount: a.requestCount,
    successCount: a.successCount,
    avgLatencyMs: a.avgLatencyMs,
  };
}

/* ------------------------------------------------------------------- Tasks */

export type TaskStatus =
  | "pending"
  | "assigned"
  | "accepted"
  | "running"
  | "completed"
  | "failed"
  | "timeout"
  | "cancelled";

export const TERMINAL_STATUSES: TaskStatus[] = ["completed", "failed", "timeout", "cancelled"];

export function isTerminal(status: TaskStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export interface TaskFile {
  path: string;
  content: string;
}

export interface TaskContext {
  environment?: Record<string, string | number>;
  files?: TaskFile[];
  logs?: string[];
  previous_attempts?: string[];
}

export interface TaskRequirements {
  /** Expected output shape, e.g. "analysis" | "patch" | "review". */
  output?: string;
  /** Seconds the provider has to finish. Default 300. */
  timeout?: number;
  max_tokens?: number;
}

export interface TaskPermissions {
  read_context: boolean;
  modify_consumer_files: boolean;
  execute_consumer_commands: boolean;
  network_access: boolean;
}

export const DEFAULT_TASK_PERMISSIONS: TaskPermissions = {
  read_context: true,
  modify_consumer_files: false,
  execute_consumer_commands: false,
  network_access: false,
};

/** The MVP's most important data structure: everything a provider needs. */
export interface TaskEnvelope {
  task_id: string;
  type?: string;
  goal: string;
  capabilities: string[];
  context?: TaskContext;
  requirements?: TaskRequirements;
  permissions?: TaskPermissions;
}

export interface TaskResultPayload {
  summary: string;
  analysis?: string;
  recommendation?: string;
  confidence?: number;
  /** Free-form full output from the provider agent. */
  output?: string;
}

export interface TaskUsage {
  input_tokens?: number;
  output_tokens?: number;
}

export interface TaskRecord extends TaskEnvelope {
  consumerId: string;
  providerId: string | null;
  status: TaskStatus;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  error: string | null;
  result: TaskResultPayload | null;
  usage: TaskUsage | null;
  /** Accumulated live output streamed by the provider (tail-capped). */
  stream?: string;
}

/** Cap on accumulated stream text kept per task (most recent wins). */
export const MAX_STREAM_CHARS = 64_000;

/** TaskRecord with the provider's public info embedded (list/detail APIs). */
export interface TaskWithProvider extends TaskRecord {
  provider: AgentPublic | null;
}

/* --------------------------------------------------------- WS wire format */

/** Messages provider → relay over the WebSocket connection. */
export type ProviderMessage =
  | { type: "register"; agent_id: string; token: string }
  | { type: "heartbeat" }
  | { type: "task_update"; task_id: string; status: "accepted" | "running" }
  | { type: "task_chunk"; task_id: string; chunk: string }
  | {
      type: "task_result";
      task_id: string;
      status: "completed" | "failed";
      result?: TaskResultPayload;
      usage?: TaskUsage;
      error?: string;
    };

/** Messages relay → provider over the WebSocket connection. */
export type RelayMessage =
  | { type: "registered"; agent: AgentPublic }
  | { type: "task_dispatch"; task: TaskEnvelope }
  | { type: "task_cancel"; task_id: string }
  | { type: "error"; message: string };

/* --------------------------------------------------------------- Tickets */

export type TicketStatus = "todo" | "inreview" | "done";
export type TicketKind = "bug" | "issue" | "suggestion";

export const TICKET_STATUSES: TicketStatus[] = ["todo", "inreview", "done"];
export const TICKET_KINDS: TicketKind[] = ["bug", "issue", "suggestion"];

/** Auto-dispatch attempts before a failing ticket parks in todo for manual action. */
export const TICKET_MAX_ATTEMPTS = 3;
/** Seconds a provider gets to finish a ticket task (coding takes longer than analysis). */
export const TICKET_TASK_TIMEOUT_S = 900;

/**
 * A bug / issue / suggestion from the relay dashboard's ticket board.
 * The relay server watches these continuously: todo tickets are dispatched
 * to a coding agent, and the task outcome drives the status transitions.
 */
export interface TicketRecord {
  id: string;
  title: string;
  description: string;
  kind: TicketKind | string;
  status: TicketStatus;
  /** Manually assigned agent; null = auto-match the best online agent. */
  assignedAgentId: string | null;
  /** Relay task ids created to process this ticket (latest last). */
  taskIds: string[];
  /** Dispatch attempts so far (reset when a user re-opens the ticket). */
  attempts: number;
  reporter: string | null;
  /** Latest automation note: dispatch info, result summary, or failure error. */
  note: string | null;
  /** Task id whose terminal outcome was already applied to this ticket. */
  syncedTaskId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface CreateTicketRequest {
  title: string;
  description?: string;
  kind?: TicketKind | string;
  reporter?: string;
  assignedAgentId?: string | null;
  /** Initial status. Default "todo" (auto-dispatched by the ticket worker). */
  status?: TicketStatus;
}

export interface UpdateTicketRequest {
  title?: string;
  description?: string;
  status?: TicketStatus;
  assignedAgentId?: string | null;
}

/** TicketRecord with agent + latest task info embedded for list/detail APIs. */
export interface TicketView extends TicketRecord {
  assignedAgent: AgentPublic | null;
  task: { task_id: string; status: TaskStatus; error: string | null } | null;
}

/* ------------------------------------------------------------ HTTP payload */

export interface CreateTaskRequest {
  goal: string;
  capabilities?: string[];
  type?: string;
  context?: TaskContext;
  requirements?: TaskRequirements;
  permissions?: TaskPermissions;
}

export interface CreateTaskResponse {
  task_id: string;
  status: TaskStatus;
  provider: AgentPublic | null;
}

export interface RegisterResponse {
  agent_id: string;
  token: string;
  agent: AgentPublic;
}

export interface StatsResponse {
  agents: { total: number; online: number; available: number; offline: number; busy: number };
  tasks: {
    total: number;
    completed: number;
    failed: number;
    timeout: number;
    cancelled: number;
    active: number;
  };
}

/** Normalize a capability list: trim, lowercase, dedupe, drop empties. */
export function normalizeCapabilities(list: string[] | undefined | null): string[] {
  if (!list) return [];
  const seen = new Set<string>();
  for (const item of list) {
    const c = String(item).trim().toLowerCase();
    if (c) seen.add(c);
  }
  return [...seen];
}
