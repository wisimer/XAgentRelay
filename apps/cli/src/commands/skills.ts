import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";
import { bold, dim, err, green } from "../util.js";

export interface SkillTarget {
  id: string;
  label: string;
  /** Agent home dir — target is skipped unless this exists. */
  home: string;
  /** Where `<name>/SKILL.md` files live for this agent. */
  skillsDir: string;
  /**
   * Agent has adopted the `<home>/skills/<name>/SKILL.md` convention, so it is
   * safe to create the dir ourselves. Otherwise only install when the agent
   * already has a skills dir (feature explicitly in use).
   */
  createIfHome: boolean;
}

/** Skill locations for known agents, probed in order. */
function skillTargets(): SkillTarget[] {
  const home = homedir();
  return [
    { id: "claude-code", label: "Claude Code", home: join(home, ".claude"), skillsDir: join(home, ".claude", "skills"), createIfHome: true },
    { id: "codex", label: "Codex", home: join(home, ".codex"), skillsDir: join(home, ".codex", "skills"), createIfHome: true },
    { id: "trae", label: "Trae", home: join(home, ".trae"), skillsDir: join(home, ".trae", "skills"), createIfHome: true },
    { id: "trae-cn", label: "Trae CN", home: join(home, ".trae-cn"), skillsDir: join(home, ".trae-cn", "skills"), createIfHome: true },
    { id: "qwen", label: "Qwen Code", home: join(home, ".qwen"), skillsDir: join(home, ".qwen", "skills"), createIfHome: true },
    { id: "agents", label: "Shared (~/.agents — read by ZCode and friends)", home: join(home, ".agents"), skillsDir: join(home, ".agents", "skills"), createIfHome: true },
    { id: "cursor", label: "Cursor", home: join(home, ".cursor"), skillsDir: join(home, ".cursor", "skills"), createIfHome: false },
    { id: "gemini", label: "Gemini CLI", home: join(home, ".gemini"), skillsDir: join(home, ".gemini", "skills"), createIfHome: false },
    { id: "opencode", label: "opencode", home: join(home, ".config", "opencode"), skillsDir: join(home, ".config", "opencode", "skill"), createIfHome: false },
  ];
}

/** Targets whose agent is present on this machine (and whose skills dir we may use). */
export function detectSkillTargets(): SkillTarget[] {
  return skillTargets().filter(
    (t) => existsSync(t.home) && (t.createIfHome || existsSync(t.skillsDir)),
  );
}

/**
 * Locate skills/delegate/SKILL.md shipped inside the package. Searches upward
 * because the compiled layout differs: dist/commands/*.js (tsc output) vs
 * dist-bin/x-agent-relay.mjs (esbuild bundle).
 */
export function findPackagedSkill(): string | null {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 4; i++) {
    const candidate = join(dir, "skills", "delegate", "SKILL.md");
    if (existsSync(candidate)) return candidate;
    dir = dirname(dir);
  }
  return null;
}

/** Copy the packaged /delegate skill into a target agent's skills dir. */
export function installSkillTo(target: SkillTarget, src: string): string {
  const dest = join(target.skillsDir, "delegate", "SKILL.md");
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
  return dest;
}

/** TTY checkbox picker: returns per-option selection, or null when cancelled. */
function multiSelect(title: string, options: string[]): Promise<boolean[] | null> {
  return new Promise((resolve) => {
    const selected = options.map(() => true);
    let cursor = 0;
    let rendered = 0;

    const render = () => {
      if (rendered > 0) process.stdout.write(`\x1b[${rendered}A`);
      const lines = [
        bold(title),
        ...options.map(
          (o, i) => `${i === cursor ? "❯" : " "} ${selected[i] ? "[x]" : "[ ]"} ${o}`,
        ),
        dim("↑/↓ move · space toggle · a toggle all · enter confirm · ctrl+c skip"),
      ];
      for (const line of lines) process.stdout.write(`\x1b[2K\r${line}\n`);
      rendered = lines.length;
    };

    const cleanup = (result: boolean[] | null) => {
      process.stdin.removeListener("keypress", onKey);
      rl.close();
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
      resolve(result);
    };

    const onKey = (_str: string, key: { name?: string; ctrl?: boolean }) => {
      if (key.ctrl && key.name === "c") return cleanup(null);
      if (key.name === "up") cursor = (cursor - 1 + options.length) % options.length;
      else if (key.name === "down") cursor = (cursor + 1) % options.length;
      else if (key.name === "space") selected[cursor] = !selected[cursor];
      else if (key.name === "a") {
        const all = selected.every(Boolean);
        for (let i = 0; i < selected.length; i++) selected[i] = !all;
      } else if (key.name === "return") return cleanup(selected);
      else return;
      render();
    };

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.on("keypress", onKey);
    render();
  });
}

export async function runSkillsInstall(opts: { all?: boolean; quiet?: boolean }): Promise<void> {
  const targets = detectSkillTargets();
  const src = findPackagedSkill();

  if (!src) {
    err("packaged skill not found — run from the npm package or the repo after build");
    return;
  }
  if (targets.length === 0) {
    console.log(dim("No coding agents detected (no ~/.claude, ~/.codex, ~/.trae, …)."));
    console.log(dim("Re-run `x-agent-relay skills install` after installing an agent."));
    return;
  }

  let chosen = targets;
  if (!opts.all && process.stdin.isTTY && process.stdout.isTTY) {
    const selection = await multiSelect(
      "Install the /delegate skill for:",
      targets.map((t) => t.label),
    );
    if (!selection) {
      console.log(dim("Skipped."));
      return;
    }
    chosen = targets.filter((_, i) => selection[i]);
  }
  if (chosen.length === 0) {
    console.log(dim("Nothing selected — no skill installed."));
    return;
  }

  for (const target of chosen) {
    const dest = installSkillTo(target, src);
    if (!opts.quiet) console.log(green(`✓ ${target.label} skill installed: ${dest}`));
  }
  if (!opts.quiet) {
    console.log("");
    console.log(dim("New chat/session in the agent → /delegate <task>"));
  }
}
