import type { Actor } from "@stint/shared";
import type { Context } from "hono";
import type { z } from "zod";
import type { RequestEnv } from "./context.ts";
import { badRequest, validationError } from "./lib/errors.ts";

export interface AuthedUser {
  id: string;
  email: string;
  name: string;
  role: Actor["role"];
  active: boolean;
  mustChangePassword: boolean;
}

export type HonoEnv = {
  Bindings: RequestEnv;
  Variables: {
    user: AuthedUser | null;
    actor: Actor | null;
    sessionToken: string | null;
  };
};

export type Ctx = Context<HonoEnv>;

export async function body<S extends z.ZodType>(c: Ctx, schema: S): Promise<z.infer<S>> {
  let json: unknown;
  try {
    json = await c.req.json();
  } catch {
    throw badRequest("Request body must be JSON.");
  }
  const r = schema.safeParse(json);
  if (!r.success) throw validationError(r.error);
  return r.data;
}

export function query<S extends z.ZodType>(c: Ctx, schema: S): z.infer<S> {
  const r = schema.safeParse(c.req.query());
  if (!r.success) throw validationError(r.error);
  return r.data;
}

export function clientIp(c: Ctx): string {
  return c.env?.ip ?? "";
}

export function actorOf(c: Ctx): Actor {
  const a = c.get("actor");
  if (!a) throw new Error("actorOf used on an unauthenticated route");
  return a;
}
