import type { RawData, WebSocket } from "ws";
import type { RelayMessage } from "@x-agent-relay/protocol";
import type { Store } from "./store.js";

/**
 * Live WebSocket connections per agent. Providers dial out to the relay, so
 * this map is the source of truth for "is this agent actually online".
 */
export class AgentConnections {
  private sockets = new Map<string, WebSocket>();

  constructor(private readonly store: Store) {}

  has(agentId: string): boolean {
    return this.sockets.has(agentId);
  }

  attach(agentId: string, ws: WebSocket): void {
    this.sockets.get(agentId)?.close(4000, "replaced by new connection");
    this.sockets.set(agentId, ws);
    this.store.setAgentStatus(agentId, "online");
    this.store.touchHeartbeat(agentId);
  }

  detach(agentId: string, ws: WebSocket): void {
    if (this.sockets.get(agentId) !== ws) return;
    this.sockets.delete(agentId);
    this.store.setAgentStatus(agentId, "offline");
  }

  send(agentId: string, msg: RelayMessage): boolean {
    const ws = this.sockets.get(agentId);
    if (!ws || ws.readyState !== ws.OPEN) return false;
    ws.send(JSON.stringify(msg));
    return true;
  }
}

export function parseMessage(data: RawData): { type: string } | null {
  try {
    return JSON.parse(data.toString()) as { type: string };
  } catch {
    return null;
  }
}
