import type { Database } from "bun:sqlite";
import { codeKey } from "@stint/shared";
import { ApiError } from "../lib/errors.ts";

/** A 422 that the form shows next to the field. */
export const fieldError = (field: string, message: string) =>
  new ApiError(422, "validation_failed", `${field}: ${message}`, { fields: { [field]: message } });

export const CODE_REQUIRED = "Give the project a code, for example 2026-014. Your own numbering works.";

/** Another project or item of this client already has the code (ignoring case). Skips `exceptIds`. */
export function codeTakenBy(
  db: Database,
  clientId: string,
  code: string,
  exceptIds: readonly string[] = [],
): { id: string; name: string } | null {
  const rows = db
    .query<{ id: string; name: string; code: string }, [string]>(
      "SELECT id, name, code FROM projects WHERE client_id = ? AND deleted_at IS NULL AND code IS NOT NULL AND code <> ''",
    )
    .all(clientId);
  const key = codeKey(code);
  const hit = rows.find((r) => codeKey(r.code) === key && !exceptIds.includes(r.id));
  return hit ? { id: hit.id, name: hit.name } : null;
}

export function assertCodeFree(
  db: Database,
  clientId: string,
  code: string,
  exceptIds: readonly string[] = [],
): void {
  const hit = codeTakenBy(db, clientId, code, exceptIds);
  if (hit)
    throw fieldError(
      "code",
      `“${code}” is already used by “${hit.name}” for this client. Choose another code.`,
    );
}

/** The codes already used by a client's projects and items. */
export function clientCodes(db: Database, clientId: string): string[] {
  return db
    .query<{ code: string }, [string]>(
      "SELECT code FROM projects WHERE client_id = ? AND deleted_at IS NULL AND code IS NOT NULL AND code <> ''",
    )
    .all(clientId)
    .map((r) => r.code);
}
