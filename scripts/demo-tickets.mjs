#!/usr/bin/env node
/**
 * End-to-end demo of the ticket board automation:
 *
 *   dashboard ticket (todo) ─→ ticket worker ─→ dispatch to agent ─→ inreview
 *          ^                                                      |
 *          +------------------ failure (todo, retry ≤3) <----------+
 *
 *   Human review closes the loop: inreview ──manual──> done
 *
 * Run with: node scripts/demo-tickets.mjs   (build first: npm run build)
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RelayClient, ProviderConnection } from "@x-agent-relay/sdk";

const PORT = 8793;
const BASE = `http://127.0.0.1:${PORT}`;
const ok = (s) => `\x1b[32m${s}\x1b[0m`;
const bad = (s) => `\x1b[31m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;

const dataDir = mkdtempSync(join(tmpdir(), "x-agent-relay-tickets-"));
const server = spawn(process.execPath, ["apps/relay-server/dist/index.js"], {
  env: { ...process.env, PORT: String(PORT), RELAY_DATA_DIR: dataDir, TICKET_WORKER_MS: "1000" },
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

/** Wait until predicate(value) holds; polls the tickets API every 200ms. */
async function waitForTicket(id, predicate, label, timeoutMs = 20000) {
  const start = Date.now();
  for (;;) {
    const { ticket } = await fetch(`${BASE}/api/tickets/${id}`).then((r) => r.json());
    if (predicate(ticket)) return ticket;
    if (Date.now() - start > timeoutMs) throw new Error(`timeout waiting for: ${label} (last: ${JSON.stringify(ticket)})`);
    await sleep(200);
  }
}

function makeProvider(reg, label, onTask) {
  let conn;
  conn = new ProviderConnection({
    baseUrl: BASE,
    agentId: reg.agent_id,
    token: reg.token,
    log: (m) => console.log(dim(`  [${label}] ${m}`)),
    onTask: async (task) => {
      conn.acceptTask(task.task_id);
      await sleep(150);
      conn.startTask(task.task_id);
      conn.sendChunk(task.task_id, `[${label}] working on ticket task ${task.task_id}\n`);
      await sleep(200);
      onTask(conn, task);
    },
  });
  conn.start();
  conns.push(conn);
  return conn;
}

async function api(path, init) {
  const res = await fetch(`${BASE}${path}`, init);
  const body = await res.json();
  if (!res.ok) throw new Error(`${path} -> ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

const createTicket = (payload) =>
  api("/api/tickets", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
const patchTicket = (id, payload) =>
  api(`/api/tickets/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

async function main() {
  await waitForRelay();
  console.log(bold(`\n━ Ticket board demo (${BASE}) ━\n`));

  const client = new RelayClient(BASE);
  const regA = await client.registerAgent({
    name: "Fixer Bot",
    runtime: "mock",
    capabilities: ["coding"],
    ownerId: "demo-alice",
  });
  const regB = await client.registerAgent({
    name: "Dedicated Bot",
    runtime: "mock",
    capabilities: ["coding"],
    ownerId: "demo-bob",
  });

  let dedicatedFails = false;
  const connA = makeProvider(regA, "Fixer Bot", (conn, task) => {
    conn.sendResult(task.task_id, {
      status: "completed",
      result: { summary: "fixed the empty-password crash by guarding the login handler" },
      usage: { input_tokens: 900, output_tokens: 400 },
    });
  });
  const connB = makeProvider(regB, "Dedicated Bot", (conn, task) => {
    if (dedicatedFails) {
      conn.sendResult(task.task_id, { status: "failed", error: "simulated failure" });
    } else {
      conn.sendResult(task.task_id, {
        status: "completed",
        result: { summary: "patched the tooltip after the dedicated run" },
      });
    }
  });
  await connA.waitUntilOnline();
  await connB.waitUntilOnline();
  console.log(`${ok("✓")} providers online: ${bold("Fixer Bot")} + ${bold("Dedicated Bot")}\n`);

  /* 1. Auto-processing: todo → dispatch → inreview (completed, awaiting review) */
  console.log(bold("Case 1:"), "auto-dispatch a fresh ticket");
  const { ticket: t1 } = await createTicket({
    title: "Login crashes when password is empty",
    description: "Steps: open /login, leave password blank, press Enter. The page whitescreens.",
    kind: "bug",
    reporter: "demo",
  });
  console.log(`  created ${dim(t1.id)} (${t1.status})`);
  const d1 = await waitForTicket(
    t1.id,
    (t) => t.status === "inreview" && t.task && t.task.status === "completed" && !!t.note && t.note.includes("fixed the empty-password crash"),
    "auto-dispatch completes",
  );
  const task1 = await api(`/api/tasks/${d1.task.task_id}`).then((r) => r.task);
  const noteOk = d1.note.includes("fixed the empty-password crash");
  console.log(
    `  ${d1.attempts === 1 ? ok("✓") : bad("✗")} attempts=1` +
      ` ${noteOk ? ok("✓") : bad("✗")} note=result summary` +
      ` ${task1.providerId === regA.agent_id || task1.providerId === regB.agent_id ? ok("✓") : bad("✗")} dispatched (${dim(task1.providerId.slice(0, 12))})`,
  );
  if (d1.attempts !== 1 || !noteOk) failures++;

  /* 2. Manual status: inreview → done, then re-open (resets retries) */
  console.log(bold("\nCase 2:"), "manual status transitions");
  const done = await patchTicket(t1.id, { status: "done" }).then((r) => r.ticket);
  console.log(`  ${done.status === "done" ? ok("✓") : bad("✗")} manual done`);
  if (done.status !== "done") failures++;
  const reopened = await patchTicket(t1.id, { status: "todo" }).then((r) => r.ticket);
  console.log(`  ${reopened.attempts === 0 ? ok("✓") : bad("✗")} re-open resets attempts`);
  if (reopened.attempts !== 0) failures++;
  const d2 = await waitForTicket(
    t1.id,
    (t) => t.status === "inreview" && t.attempts === 1 && t.taskIds.length >= 2 && t.task && t.task.status === "completed",
    "re-dispatch",
  );
  console.log(`  ${d2.attempts === 1 ? ok("✓") : bad("✗")} auto re-dispatched (attempt 1, task ${d2.attempts === 1 ? "2nd" : "?"})`);
  if (d2.attempts !== 1) failures++;
  await patchTicket(t1.id, { status: "done" });

  /* 3. Manual assignment: dispatch must target the assigned agent */
  console.log(bold("\nCase 3:"), "manual assignment to a specific agent");
  const { ticket: t3 } = await createTicket({
    title: "Add keyboard shortcut for the search box",
    description: "Cmd+K should focus search, like every other dev tool.",
    kind: "suggestion",
    assignedAgentId: regB.agent_id,
  });
  const d3 = await waitForTicket(
    t3.id,
    (t) => t.status === "inreview" && t.task && t.task.status === "completed",
    "assigned dispatch",
  );
  const task3 = await api(`/api/tasks/${d3.task.task_id}`).then((r) => r.task);
  const routed = task3.providerId === regB.agent_id;
  console.log(`  ${routed ? ok("✓") : bad("✗")} routed to ${bold("Dedicated Bot")} ${routed ? "" : dim(`(got ${task3.providerId})`)}`);
  if (!routed) failures++;

  /* 4. Failure path: task fails → ticket back to todo with error note */
  console.log(bold("\nCase 4:"), "failure falls back to todo");
  dedicatedFails = true;
  const { ticket: t4 } = await createTicket({
    title: "Dashboard clock drifts on Safari",
    kind: "issue",
    assignedAgentId: regB.agent_id,
  });
  const d4 = await waitForTicket(t4.id, (t) => t.status === "todo" && t.note && t.note.includes("failed"), "failure rollback");
  const errOk = d4.note.includes("simulated failure") && d4.attempts >= 1;
  console.log(`  ${errOk ? ok("✓") : bad("✗")} back to todo with error note ${dim(`(${d4.note})`)}`);
  if (!errOk) failures++;
  await patchTicket(t4.id, { status: "done" }); // park it — don't let retries spin

  const list = await api("/api/tickets").then((r) => r.tickets);
  console.log(`\n${bold("Board:")} ${list.map((t) => `${t.id.slice(0, 12)}=${t.status}`).join(", ")}`);
  console.log(
    failures === 0
      ? ok(`\n━━ Ticket automation verified: create → auto-dispatch → review → done / retry ━━\n`)
      : bad(`\n━━ TICKET DEMO FAILED (${failures} checks) ━━\n`),
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
