import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/* ------------------------------------------------------------- id / tokens */

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(6).toString("hex")}`;
}

export function newToken(): string {
  return `arly_${randomBytes(24).toString("hex")}`;
}

/* ------------------------------------------------------------ config files */

export function relayDir(): string {
  const base = process.env.AGENT_RELAY_HOME ?? join(homedir(), ".x-agent-relay");
  if (!existsSync(base)) mkdirSync(base, { recursive: true });
  return base;
}

export function configPath(): string {
  return join(relayDir(), "config.json");
}

export function identityPath(): string {
  return join(relayDir(), "identity.json");
}

export function agentProfilePath(): string {
  return join(relayDir(), "agent.json");
}

function readJson<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", "utf8");
}

/* ------------------------------------------------------------------ config */

export interface RelayConfig {
  /** Base URL of the relay server, e.g. http://127.0.0.1:8787 */
  relay: string;
  /** When this machine registered: for the dashboard / status display. */
  registeredAt?: number;
}

export function readConfig(): RelayConfig | null {
  return readJson<RelayConfig | null>(configPath(), null);
}

export function writeConfig(config: RelayConfig): void {
  writeJson(configPath(), config);
}

/* --------------------------------------------------------------- identity */

export interface Identity {
  /** Local user id (also used as consumer id when delegating). */
  owner_id: string;
  name?: string;
  /** Present once this machine ran `x-agent-relay register`. */
  agent_id?: string;
  token?: string;
}

export function readIdentity(): Identity | null {
  return readJson<Identity | null>(identityPath(), null);
}

export function writeIdentity(identity: Identity): void {
  writeJson(identityPath(), identity);
}

/** Read identity, creating one (with a fresh owner_id) if missing. */
export function ensureIdentity(): Identity {
  const existing = readIdentity();
  if (existing && existing.owner_id) return existing;
  const identity: Identity = {
    owner_id: newId("usr"),
    ...(existing ?? {}),
  };
  writeIdentity(identity);
  return identity;
}

/* ------------------------------------------------------------ agent profile */

export interface AgentProfile {
  name: string;
  runtime: string;
  capabilities: string[];
}

export function readAgentProfile(): AgentProfile | null {
  return readJson<AgentProfile | null>(agentProfilePath(), null);
}

export function writeAgentProfile(profile: AgentProfile): void {
  writeJson(agentProfilePath(), profile);
}
