import {
  DEFAULT_TASK_PERMISSIONS,
  TICKET_MAX_ATTEMPTS,
  TICKET_TASK_TIMEOUT_S,
  isTerminal,
  type AgentRecord,
  type AgentStatus,
  type RelayMessage,
  type TaskRecord,
  type TicketRecord,
} from "@x-agent-relay/protocol";
import { selectAgent } from "./matcher.js";

/**
 * Everything the ticket worker needs from the host relay. Structurally
 * implemented by the node server's Store + AgentConnections pair (and later
 * by the worker's RelayBackend), so the automation logic lives here once.
 */
export interface TicketBackend {
  listAgents(): AgentRecord[];
  getAgent(id: string): AgentRecord | undefined;
  getTask(id: string): TaskRecord | undefined;
  createTask(task: TaskRecord): void;
  updateTask(id: string, patch: Partial<TaskRecord>): TaskRecord | undefined;
  setTaskStatus(id: string, status: TaskRecord["status"]): void;
  updateTicket(id: string, patch: Partial<TicketRecord>): TicketRecord | undefined;
  hasConnection(agentId: string): boolean;
  sendToAgent(agentId: string, msg: RelayMessage): boolean;
  setAgentStatus(id: string, status: AgentStatus): void;
  newTaskId(): string;
}

/** Build the goal a coding agent receives for a ticket. */
export function ticketGoal(t: TicketRecord): string {
  return [
    `[Ticket ${t.id}] (${t.kind}) ${t.title}`,
    "",
    t.description?.trim() || "(no description provided)",
    "",
    "You are handling this report from the relay ticket board. Identify the root cause, work out a fix, and reply with a concise summary of the change (what, where, and why).",
  ].join("\n");
}

export interface TicketPassResult {
  synced: number;
  dispatched: number;
}

/**
 * One worker pass over the ticket board:
 *
 * 1. sync  — apply the latest task's terminal outcome to its ticket
 *            (completed → inreview awaiting human review, failed → todo retry)
 * 2. dispatch — send due todo tickets to the assigned agent (or best match)
 *
 * Status machine:
 *   todo --dispatch--> inreview --task completed--> inreview (human marks done)
 *                     ^                    \
 *                     +----task failed------ (note records the error, max 3 attempts)
 */
export function processTickets(backend: TicketBackend, tickets: TicketRecord[]): TicketPassResult {
  const live = new Map(tickets.map((t) => [t.id, t]));
  let synced = 0;
  let dispatched = 0;

  /* ---------------------------------------------------------------- sync */
  for (const t0 of tickets) {
    const t = live.get(t0.id);
    if (!t || t.taskIds.length === 0 || t.status === "done") continue;
    const latestTaskId = t.taskIds[t.taskIds.length - 1];
    if (t.syncedTaskId === latestTaskId) continue;
    const task = backend.getTask(latestTaskId);
    if (!task || !isTerminal(task.status)) continue;

    if (task.status === "completed") {
      const summary = task.result?.summary?.trim() || "agent completed the task";
      const updated = backend.updateTicket(t.id, {
        status: "inreview",
        note: summary.length > 300 ? summary.slice(0, 297) + "…" : summary,
        syncedTaskId: latestTaskId,
        updatedAt: Date.now(),
      });
      if (updated) live.set(t.id, updated);
      synced++;
    } else {
      const reason = task.error?.trim() || `task ${task.status}`;
      const updated = backend.updateTicket(t.id, {
        status: "todo",
        note: `attempt ${t.attempts} failed: ${reason}`,
        syncedTaskId: latestTaskId,
        updatedAt: Date.now(),
      });
      if (updated) live.set(t.id, updated);
      synced++;
    }
  }

  /* ------------------------------------------------------------ dispatch */
  for (const t0 of tickets) {
    const t = live.get(t0.id);
    if (!t || t.status !== "todo") continue;
    if (t.attempts >= TICKET_MAX_ATTEMPTS) continue; // parked — needs manual re-open
    if (t.taskIds.length > 0) {
      const latest = backend.getTask(t.taskIds[t.taskIds.length - 1]);
      if (latest && !isTerminal(latest.status)) continue; // still in flight
    }

    // Pick the target: manual assignment wins, otherwise best online match.
    let agent: AgentRecord | undefined;
    if (t.assignedAgentId) {
      const assigned = backend.getAgent(t.assignedAgentId);
      if (!assigned || !backend.hasConnection(assigned.id) || assigned.status !== "online") continue; // wait for it
      agent = assigned;
    } else {
      const online = backend.listAgents().filter((a) => backend.hasConnection(a.id));
      const match = selectAgent(online, []);
      if (!match) continue; // nobody online — retry next pass
      agent = match.agent;
    }

    dispatched++;
    const taskId = backend.newTaskId();
    const task: TaskRecord = {
      task_id: taskId,
      type: "ticket",
      goal: ticketGoal(t),
      capabilities: [],
      context: { logs: [`ticket ${t.id} (${t.kind}): ${t.title}`] },
      requirements: { timeout: TICKET_TASK_TIMEOUT_S },
      permissions: DEFAULT_TASK_PERMISSIONS,
      consumerId: `ticket:${t.id}`,
      providerId: agent.id,
      status: "pending",
      createdAt: Date.now(),
      startedAt: null,
      completedAt: null,
      error: null,
      result: null,
      usage: null,
    };
    backend.createTask(task);

    const sent = backend.sendToAgent(agent.id, {
      type: "task_dispatch",
      task: {
        task_id: task.task_id,
        type: task.type,
        goal: task.goal,
        capabilities: task.capabilities,
        context: task.context,
        requirements: task.requirements,
        permissions: task.permissions,
      },
    });
    if (!sent) {
      backend.updateTask(task.task_id, { status: "failed", error: "provider disconnected", completedAt: Date.now() });
      continue;
    }

    backend.setTaskStatus(task.task_id, "assigned");
    backend.setAgentStatus(agent.id, "busy");
    backend.updateTicket(t.id, {
      status: "inreview",
      attempts: t.attempts + 1,
      taskIds: [...t.taskIds, taskId],
      syncedTaskId: null,
      note: `dispatched to ${agent.name} (attempt ${t.attempts + 1})`,
      updatedAt: Date.now(),
    });
  }

  return { synced, dispatched };
}
