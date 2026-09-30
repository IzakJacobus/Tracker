import type { Database } from "bun:sqlite";

export const SESSION_COOKIE = "stint_session";
export const SESSION_TTL_MS = 30 * 24 * 3600_000;
const TOUCH_INTERVAL_MS = 5 * 60_000;

export interface SessionRow {
  token_hash: string;
  user_id: string;
  kind: "browser" | "desktop";
  created_at: number;
  last_seen_at: number;
  expires_at: number;
}

function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

export function hashToken(token: string): string {
  return new Bun.CryptoHasher("sha256").update(token).digest("hex");
}

export function createSession(
  db: Database,
  userId: string,
  kind: "browser" | "desktop",
  now: number,
  meta: { userAgent?: string; ip?: string } = {},
): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const token = base64url(bytes);
  db.query(
    "INSERT INTO sessions (token_hash, user_id, kind, created_at, last_seen_at, expires_at, user_agent, ip) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    hashToken(token),
    userId,
    kind,
    now,
    now,
    now + SESSION_TTL_MS,
    (meta.userAgent ?? "").slice(0, 300),
    meta.ip ?? "",
  );
  return token;
}

/** Validates a token; slides the expiry forward. Returns null if unknown or expired. */
export function validateSession(db: Database, token: string, now: number): SessionRow | null {
  if (!token || token.length > 200) return null;
  const hash = hashToken(token);
  const row = db.query<SessionRow, [string]>("SELECT * FROM sessions WHERE token_hash = ?").get(hash);
  if (!row) return null;
  if (row.expires_at <= now) {
    db.query("DELETE FROM sessions WHERE token_hash = ?").run(hash);
    return null;
  }
  if (now - row.last_seen_at > TOUCH_INTERVAL_MS) {
    db.query("UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?").run(
      now,
      now + SESSION_TTL_MS,
      hash,
    );
  }
  return row;
}

export function destroySession(db: Database, token: string): void {
  db.query("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
}

export function destroyUserSessions(db: Database, userId: string, exceptToken?: string): void {
  if (exceptToken) {
    db.query("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?").run(
      userId,
      hashToken(exceptToken),
    );
  } else {
    db.query("DELETE FROM sessions WHERE user_id = ?").run(userId);
  }
}

export function pruneSessions(db: Database, now: number): void {
  db.query("DELETE FROM sessions WHERE expires_at <= ?").run(now);
}
