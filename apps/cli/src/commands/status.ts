import { RelayClient } from "@agent-relay/sdk";
import { ensureIdentity } from "@agent-relay/shared";
import { bold, dim, err, resolveRelayUrl, statusColor } from "../util.js";

export async function runStatus(opts: { relay?: string }): Promise<void> {
  const baseUrl = resolveRelayUrl(opts.relay);
  const identity = ensureIdentity();
  const client = new RelayClient(baseUrl);

  console.log(bold("Agent Relay status"));
  console.log(dim(`  relay:   ${baseUrl}`));
  console.log(dim(`  owner:   ${identity.owner_id}`));

  try {
    const health = await client.health();
    console.log(`  relay:   ${statusColor("online")} ${dim(`v${health.version}, up ${health.uptime_s}s`)}`);
  } catch {
    console.log(`  relay:   ${statusColor("offline")} ${dim("(cannot reach server)")}`);
  }

  if (identity.agent_id) {
    try {
      const agent = await client.getAgent(identity.agent_id);
      if (agent) {
        console.log(`  agent:   ${agent.name} [${agent.id}] — ${statusColor(agent.status)}`);
        console.log(dim(`           ${agent.runtime} · ${agent.capabilities.join(", ")}`));
        console.log(dim(`           ${agent.successCount}/${agent.requestCount} tasks ok · avg ${Math.round(agent.avgLatencyMs / 100) / 10}s`));
      }
    } catch {
      console.log(`  agent:   ${identity.agent_id} ${dim("(not found on this relay)")}`);
    }
  } else {
    console.log(dim("  agent:   not registered (run `agent-relay register`)"));
  }
}
