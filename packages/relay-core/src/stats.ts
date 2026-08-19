import type { AgentRecord, StatsResponse, TaskRecord } from "@agent-relay/protocol";

/** Dashboard / monitoring stats, shared by the node server and the CF worker. */
export function computeStats(agents: AgentRecord[], tasks: TaskRecord[]): StatsResponse {
  return {
    agents: {
      total: agents.length,
      // connected to the relay right now (idle + busy)
      online: agents.filter((a) => a.status === "online" || a.status === "busy").length,
      // dispatchable immediately: connected and not running a task
      available: agents.filter((a) => a.status === "online").length,
      offline: agents.filter((a) => a.status === "offline").length,
      busy: agents.filter((a) => a.status === "busy").length,
    },
    tasks: {
      total: tasks.length,
      completed: tasks.filter((t) => t.status === "completed").length,
      failed: tasks.filter((t) => t.status === "failed").length,
      timeout: tasks.filter((t) => t.status === "timeout").length,
      cancelled: tasks.filter((t) => t.status === "cancelled").length,
      active: tasks.filter((t) =>
        ["pending", "assigned", "accepted", "running"].includes(t.status),
      ).length,
    },
  };
}
