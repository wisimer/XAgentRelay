/** Web Crypto id/token helpers (no node:crypto in Workers). */

function hex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function newId(prefix: string): string {
  return `${prefix}_${hex(6)}`;
}

export function newToken(): string {
  return `arly_${hex(24)}`;
}
