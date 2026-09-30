/** argon2id via Bun's built-in implementation (m = 64 MiB, t = 2). */
export function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password, { algorithm: "argon2id", memoryCost: 65536, timeCost: 2 });
}

export function verifyPassword(password: string, hash: string | null): Promise<boolean> {
  if (!hash) return Promise.resolve(false);
  return Bun.password.verify(password, hash);
}

/** A hash to verify against when the user does not exist, so timing does not reveal valid emails. */
let dummy: Promise<string> | null = null;
export function dummyHash(): Promise<string> {
  dummy ??= hashPassword("stint-timing-equaliser");
  return dummy;
}
