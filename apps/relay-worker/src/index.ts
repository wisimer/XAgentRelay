import { RelayHub } from "./hub";

export interface Env {
  RELAY_HUB: DurableObjectNamespace<RelayHub>;
}

/**
 * Agent Relay on Cloudflare: the Worker is a thin router — every request
 * (HTTP API, dashboard, and the provider WebSocket at /agent) is forwarded
 * to the single global RelayHub Durable Object that holds all state.
 */
export default {
  fetch(request: Request, env: Env): Promise<Response> {
    const hub = env.RELAY_HUB.get(env.RELAY_HUB.idFromName("global"));
    return hub.fetch(request);
  },
} satisfies ExportedHandler<Env>;

export { RelayHub };
