#!/usr/bin/env node
/**
 * End-to-end verification against the deployed Cloudflare relay:
 *   register → online (wss) → discover → delegate → result
 *   + consumer-cancel interruption → provider receives task_cancel
 *   + provider-disconnect interruption → task failed immediately
 *
 * Usage: node scripts/verify-cloudflare.mjs [relayUrl]
 * (build first: npm run build)
 */
import { RelayClient, ProviderConnection, delegate } from "@agent-relay/sdk";

const BASE = process.argv[2] ?? "https://agent-relay.1025195312.workers.dev";
const ok = (s) => `\x1b[32m${s}\x1b[0m`;
const bad = (s) => `\x1b[31m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const check = (cond, label) => {
  console.log(`  ${cond ? ok("✓") : bad("✗")} ${label}`);
  if (!cond) failures++;
};

const client = new RelayClient(BASE);
const conns = [];

/** Slow tasks sleep 30s unless interrupted (cancel/disconnect finishes them relay-side). */
function makeProvider(reg, label, hooks = {}) {
  let conn;
  conn = new ProviderConnection({
    baseUrl: BASE,
    agentId: reg.agent_id,
    token: reg.token,
    log: (m) => console.log(dim(`  [${label}] ${m}`)),
    onCancel: (taskId) => hooks.onCancel?.(taskId),
    onTask: async (task) => {
      conn.acceptTask(task.task_id);
      conn.startTask(task.task_id);
      const slow = task.goal.includes("[slow]");
      conn.sendChunk(task.task_id, `[${label}] started: ${task.goal.slice(0, 40)}\n`);
      await sleep(slow ? 30_000 : 500);
      if (!slow) conn.sendChunk(task.task_id, `[${label}] almost done…\n`);
      conn.sendResult(task.task_id, {
        status: "completed",
        result: {
          summary: `${label} analysis of: ${task.goal}`,
          analysis: `Simulated analysis using [${task.capabilities.join(", ")}].`,
          recommendation: `${label} recommends a fix.`,
          confidence: 0.9,
        },
        usage: { input_tokens: 100, output_tokens: 50 },
      });
    },
  });
  conn.start();
  conns.push(conn);
  return conn;
}

async function main() {
  console.log(bold(`\n━ Verifying deployed relay: ${BASE} ━\n`));

  // 0. health + dashboard
  const health = await fetch(`${BASE}/api/health`).then((r) => r.json());
  check(health.ok === true, `health ok (v${health.version})`);
  const html = await fetch(`${BASE}/`).then((r) => r.text());
  check(html.includes("AGENT") && html.includes("Delegated Tasks"), "dashboard HTML served");

  // 1. register + online
  const reg = await client.registerAgent({
    name: "cf-verify-mock",
    runtime: "mock",
    capabilities: ["verify", "mock"],
    ownerId: "cf-verify",
  });
  let cancelledId = null;
  const conn = makeProvider(reg, "cf-mock", { onCancel: (id) => (cancelledId = id) });
  await conn.waitUntilOnline();
  check(true, `provider online over wss (${dim(reg.agent_id)})`);

  // 2. delegate → result (with live streaming)
  console.log(bold("\nNormal delegation:"));
  const chunks = [];
  const t1 = await delegate({
    goal: "verify the deployed relay",
    capabilities: ["verify"],
    baseUrl: BASE,
    consumerId: "cf-verify-consumer",
    onChunk: (text) => chunks.push(text),
  });
  check(t1.status === "completed" && t1.providerId === reg.agent_id, `task completed — ${t1.result?.summary}`);
  check(
    chunks.join("").includes("started:"),
    `live stream received over SSE (${chunks.length} chunks)`,
  );

  // 3. consumer cancel → provider gets task_cancel
  console.log(bold("\nConsumer cancel:"));
  let cancelError = null;
  const pending = delegate({
    goal: "[slow] cancel me",
    capabilities: ["verify"],
    baseUrl: BASE,
    consumerId: "cf-verify-consumer",
    onEvent: (ev) => {
      if (ev.type === "dispatched") {
        setTimeout(() => client.cancelTask(ev.task_id).catch(() => {}), 1500);
      }
    },
  }).catch((err) => (cancelError = err));
  await pending;
  check(cancelError?.code === "task_cancelled", `delegate rejected with task_cancelled`);
  await sleep(500);
  check(cancelledId !== null, "provider received task_cancel over wss");
  const statsAfterCancel = await client.stats();
  check(statsAfterCancel.agents.available === 1, "agent freed back to available after cancel");

  // 4. provider disconnect → in-flight task fails immediately
  console.log(bold("\nProvider disconnect:"));
  let disconnectError = null;
  const p2 = delegate({
    goal: "[slow] survive provider loss",
    capabilities: ["verify"],
    baseUrl: BASE,
    consumerId: "cf-verify-consumer",
    onEvent: (ev) => {
      if (ev.type === "dispatched") setTimeout(() => conn.close(), 1500);
    },
  }).catch((err) => (disconnectError = err));
  await p2;
  check(
    disconnectError?.code === "task_failed" && /disconnected/.test(disconnectError?.message ?? ""),
    `delegate failed fast with "provider disconnected" (${dim(disconnectError?.message)})`,
  );

  const stats = await client.stats();
  console.log(`\n${bold("Stats:")} ${JSON.stringify(stats)}`);
  check(
    stats.tasks.completed >= 1 && stats.tasks.cancelled >= 1 && stats.tasks.failed >= 1,
    "stats reflect completed + cancelled + failed",
  );

  console.log(
    failures === 0
      ? ok(`\n━━ Cloudflare relay verified: full loop + both interruption directions ━━\n`)
      : bad(`\n━━ VERIFICATION FAILED (${failures} checks) ━━\n`),
  );
}

main()
  .catch((err) => {
    failures++;
    console.error(bad(`verify error: ${err.stack ?? err}`));
  })
  .finally(() => {
    for (const c of conns) c.close();
    setTimeout(() => process.exit(failures === 0 ? 0 : 1), 300);
  });
