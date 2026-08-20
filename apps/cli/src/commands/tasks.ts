import { RelayClient } from "@x-agent-relay/sdk";
import { ensureIdentity } from "@x-agent-relay/shared";
import { bold, dim, resolveRelayUrl, statusColor } from "../util.js";

export async function runTasks(opts: { relay?: string; all?: boolean }): Promise<void> {
  const baseUrl = resolveRelayUrl(opts.relay);
  const identity = ensureIdentity();
  const client = new RelayClient(baseUrl);

  const sections: { title: string; tasks: Awaited<ReturnType<typeof client.listTasks>> }[] = [];

  try {
    if (!opts.all) {
      sections.push({ title: "Delegated by you", tasks: await client.listTasks({ consumer: identity.owner_id, limit: 15 }) });
      if (identity.agent_id) {
        sections.push({ title: "Served by this machine", tasks: await client.listTasks({ provider: identity.agent_id, limit: 15 }) });
      }
    } else {
      sections.push({ title: "All tasks", tasks: await client.listTasks({ limit: 30 }) });
    }
  } catch (e) {
    console.log(dim(`✗ cannot reach relay at ${baseUrl} (${(e as Error).message})`));
    process.exitCode = 1;
    return;
  }

  for (const section of sections) {
    console.log(bold(section.title));
    if (!section.tasks.length) {
      console.log(dim("  (none)"));
      continue;
    }
    for (const t of section.tasks) {
      const dur = t.completedAt && t.startedAt ? `${((t.completedAt - t.startedAt) / 1000).toFixed(0)}s` : "—";
      const goal = t.goal.length > 52 ? t.goal.slice(0, 52) + "…" : t.goal;
      console.log(`  ${dim(t.task_id.slice(0, 12))}  ${statusColor(t.status.padEnd(9))} ${dim(dur.padStart(4))}  ${goal}`);
    }
    console.log("");
  }
}
