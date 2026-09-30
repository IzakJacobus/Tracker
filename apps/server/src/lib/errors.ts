import type { z } from "zod";

export class ApiError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 422 | 423 | 429 | 500 | 503,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new ApiError(400, "bad_request", message, details);
export const unauthorized = (message = "Please sign in.") => new ApiError(401, "unauthorized", message);
export const forbidden = (message = "You do not have permission to do that.") =>
  new ApiError(403, "forbidden", message);
export const notFound = (what = "Item") => new ApiError(404, "not_found", `${what} not found.`);
export const conflict = (message: string, details?: unknown) =>
  new ApiError(409, "conflict", message, details);
export const locked = (message: string, details?: unknown) => new ApiError(423, "locked", message, details);

export function validationError(err: z.ZodError): ApiError {
  const fields: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.join(".") || "_";
    if (!fields[key]) fields[key] = issue.message;
  }
  const first = Object.entries(fields)[0];
  return new ApiError(
    422,
    "validation_failed",
    first ? `${first[0] === "_" ? "" : `${first[0]}: `}${first[1]}` : "Invalid input.",
    { fields },
  );
}
