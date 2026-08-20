import type { AgentRecord } from "@x-agent-relay/protocol";

export interface MatchResult {
  agent: AgentRecord;
  score: number;
}

/**
 * MVP capability matching (doc §11): pick the online agent with the highest
 * coverage of the required capabilities. Full-match agents win; ties break on
 * success rate, then average latency, then fewer total requests.
 */
export function selectAgent(
  agents: AgentRecord[],
  required: string[],
): MatchResult | null {
  const wanted = required.map((c) => c.toLowerCase());
  let best: MatchResult | null = null;

  for (const agent of agents) {
    if (agent.status !== "online") continue; // busy agents are skipped too
    const caps = new Set(agent.capabilities.map((c) => c.toLowerCase()));
    let matched = 0;
    for (const c of wanted) if (caps.has(c)) matched += 1;
    const score = wanted.length === 0 ? 1 : matched / wanted.length;
    if (score <= 0) continue;

    const successRate = agent.requestCount === 0 ? 0.5 : agent.successCount / agent.requestCount;
    if (!best) {
      best = { agent, score };
      continue;
    }
    const bestRate =
      best.agent.requestCount === 0 ? 0.5 : best.agent.successCount / best.agent.requestCount;
    const better =
      score > best.score ||
      (score === best.score &&
        (successRate > bestRate ||
          (successRate === bestRate && agent.avgLatencyMs < best.agent.avgLatencyMs) ||
          (successRate === bestRate &&
            agent.avgLatencyMs === best.agent.avgLatencyMs &&
            agent.requestCount < best.agent.requestCount)));
    if (better) best = { agent, score };
  }
  return best;
}
