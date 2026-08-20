#!/usr/bin/env node
/**
 * End-to-end demo of the MVP core loop (doc §4):
 *
 *   Provider A (rust expert) ─┐
 *                             ├─→ Relay ─→ capability matching ─→ dispatch
 *   Provider B (react expert) ┘        ←─ task_result ─────────────┘
 *
 *   Consumer ── delegate() ──→ result
 *
 * Run with: npm run demo   (build first: npm run build)
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RelayClient, ProviderConnection, delegate } from "@agent-relay/sdk";

const PORT = 8791;
const BASE = `http://127.0.0.1:${PORT}`;
const ok = (s) => `\x1b[32m${s}\x1b[0m`;
const bad = (s) => `\x1b[31m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;

const dataDir = mkdtempSync(join(tmpdir(), "agent-relay-demo-"));
const server = spawn(process.execPath, ["apps/relay-server/dist/index.js"], {
  env: { ...process.env, PORT: String(PORT), RELAY_DATA_DIR: dataDir },
  stdio: ["ignore", "inherit", "inherit"],
});

const conns = [];
let failures = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForRelay() {
  for (let i = 0; i < 40; i++) {
    try {
      await fetch(`${BASE}/api/health`).then((r) => r.json());
      return;
    } catch {
      await sleep(250);
    }
  }
  throw new Error("relay server did not start");
}

function makeProvider(reg, label) {
  let conn;
  conn = new ProviderConnection({
    baseUrl: BASE,
    agentId: reg.agent_id,
    token: reg.token,
    log: (m) => console.log(dim(`  [${label}] ${m}`)),
    onTask: async (task) => {
      conn.acceptTask(task.task_id);
      await sleep(300);
      conn.startTask(task.task_id);
      conn.sendChunk(task.task_id, `[${label}] thinking about: ${task.goal.slice(0, 40)}\n`);
      await sleep(400);
      conn.sendChunk(task.task_id, `[${label}] drafting analysis…\n`);
      await sleep(200);
      conn.sendResult(task.task_id, {
        status: "completed",
        result: {
          summary: `${label} analysis of: ${task.goal}`,
          analysis: `Simulated deep analysis using [${task.capabilities.join(", ")}].`,
          recommendation: `${label} recommends fixing the hypothetical root cause.`,
          confidence: 0.9,
        },
        usage: { input_tokens: 8200, output_tokens: 2100 },
      });
    },
  });
  conn.start();
  conns.push(conn);
  return conn;
}

async function main() {
  await waitForRelay();
  console.log(bold(`\n━ Agent Relay MVP demo (${BASE}) ━\n`));

  // 1. Register two providers
  const client = new RelayClient(BASE);
  const regA = await client.registerAgent({
    name: "Rust Expert",
    runtime: "mock",
    capabilities: ["rust", "tokio", "async", "debugging"],
    ownerId: "demo-alice",
  });
  const regB = await client.registerAgent({
    name: "React Expert",
    runtime: "mock",
    capabilities: ["typescript", "react"],
    ownerId: "demo-bob",
  });
  console.log(`${ok("✓")} registered ${bold("Rust Expert")} ${dim(regA.agent_id)} and ${bold("React Expert")} ${dim(regB.agent_id)}`);

  // 2. Providers go online (dial out through WebSocket)
  const connA = makeProvider(regA, "Rust Expert");
  const connB = makeProvider(regB, "React Expert");
  await connA.waitUntilOnline();
  await connB.waitUntilOnline();
  console.log(`${ok("✓")} both providers online\n`);

  // 3. Delegate a rust task — must route to Rust Expert
  console.log(bold("Delegation 1:"), 'delegate("分析 Rust Tokio deadlock", caps=[rust, tokio, debugging])');
  const chunks1 = [];
  const t1 = await delegate({
    goal: "分析 Rust Tokio deadlock",
    capabilities: ["rust", "tokio", "debugging"],
    baseUrl: BASE,
    consumerId: "demo-consumer",
    onEvent: (ev) => {
      if (ev.type === "dispatched" && ev.provider) console.log(`  → matched ${bold(ev.provider.name)} ${dim(ev.task_id)}`);
      if (ev.type === "status") process.stdout.write(dim(`  · ${ev.status} `) + "\r");
    },
    onChunk: (text) => chunks1.push(text),
  });
  console.log(`  ${t1.providerId === regA.agent_id ? ok("✓ routed to Rust Expert") : bad("✗ wrong provider")} — ${t1.result.summary}`);
  const streamed1 = chunks1.join("");
  console.log(
    streamed1.includes("Rust Expert")
      ? `  ${ok("✓ streamed live output")} ${dim(`(${chunks1.length} chunks via SSE)`)}`
      : `  ${bad("✗ no stream chunks received")}`,
  );
  if (!streamed1.includes("Rust Expert")) failures++;

  // 4. Delegate a react task — must route to React Expert
  console.log(bold("\nDelegation 2:"), 'delegate("Review this React component", caps=[typescript, react])');
  const t2 = await delegate({
    goal: "Review this React component for re-render issues",
    capabilities: ["typescript", "react"],
    context: { files: [{ path: "src/App.tsx", content: "export default function App(){return null}" }] },
    baseUrl: BASE,
    consumerId: "demo-consumer",
  });
  console.log(`  ${t2.providerId === regB.agent_id ? ok("✓ routed to React Expert") : bad("✗ wrong provider")} — ${t2.result.summary}`);

  // 5. Verify stats
  const stats = await client.stats();
  const routed = t1.providerId === regA.agent_id && t2.providerId === regB.agent_id;
  const completed = t1.status === "completed" && t2.status === "completed";
  console.log(`\n${bold("Stats:")} ${JSON.stringify(stats)}`);

  if (!routed) failures++;
  if (!completed) failures++;
  console.log(
    failures === 0
      ? ok(`\n━━ MVP closed loop verified: register → online → discover → delegate → execute → result ━━\n`)
      : bad(`\n━━ DEMO FAILED (${failures} checks) ━━\n`),
  );
}

main()
  .catch((err) => {
    failures++;
    console.error(bad(`demo error: ${err.stack ?? err}`));
  })
  .finally(() => {
    for (const c of conns) c.close();
    server.kill("SIGTERM");
    setTimeout(() => rmSync(dataDir, { recursive: true, force: true }), 300);
    process.exit(failures === 0 ? 0 : 1);
  });
