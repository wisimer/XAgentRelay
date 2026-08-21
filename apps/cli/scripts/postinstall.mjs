// npm postinstall: install the /delegate skill for every detected coding
// agent (Claude Code, Codex, Trae, Qwen, shared ~/.agents, …) by invoking the
// bundled CLI. Best-effort only — must never fail the install.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const bundle = join(pkgRoot, "dist-bin", "x-agent-relay.mjs");

try {
  // dist-bin ships prebuilt in the npm tarball; in a dev checkout it appears
  // after `npm run bundle` — until then skip (`x-agent-relay connect` covers).
  if (existsSync(bundle)) {
    const result = spawnSync(
      process.execPath,
      [bundle, "skills", "install", "--all"],
      { stdio: "inherit" },
    );
    if (result.status !== 0) process.exitCode = 0;
  }
} catch {
  // ignore — skill can be installed later via `x-agent-relay skills install`
}
