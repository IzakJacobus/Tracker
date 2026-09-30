# Stint — Progress

> Single source of truth for where the work stands. Update after every meaningful step.

## Current phase
**Phase 2 — Auth, users, organisation, setup wizard** (starting)

## Done
- Architecture (`docs/ARCHITECTURE.md`) and roadmap (`docs/ROADMAP.md`)
- Monorepo skeleton, Biome, TS strict, EditorConfig, LICENSE, CONTRIBUTING, CHANGELOG, CI
- `packages/shared`: UUIDv7 (monotonic), HLC (+ tests)
- `apps/server`: SQLite schema v1 (`0001_initial.sql`), migration runner with checksums (+ tests)
- `apps/web`: Vite 8 + React 19 + Vitest 5 skeleton (+ test)
- **Phase 1 complete** (lint, typecheck, tests green locally)

## In progress
- Phase 2: server config loader + bootstrap

## Next step (exact)
1. `apps/server/src/config.ts` (defaults < stint.config.json < env) + `stint.config.example.json`.
2. `apps/server/src/app.ts` Hono app factory taking `{db, config, clock}` for testability.
3. Shared Zod schemas: org settings, user, login; permissions module + tests.
4. Auth routes (setup, login, logout, me) + sessions + rate limiter + integration tests.

## Open decisions (for the owner)
- Repository: the brief asked for a new public repo via `gh repo create`; this environment has no
  `gh` CLI and is scoped to `IzakJacobus/Tracker`, so Stint is developed there. Rename the repo to
  `stint` in GitHub settings if desired (redirects keep working).
- Work is pushed to branch `claude/zen-planck-d724oo` (session constraint); merge to `main` via PR.

## Known bugs
- none yet

## Commands
```bash
bun install
bun run lint && bun run typecheck && bun run test
cd apps/web && bun run build   # production web build
```

## Environment notes
- Toolchain verified: Bun 1.3.14 (cross-compiles Windows exe), Node 22, Rust 1.97, Chromium for
  Playwright at /opt/pw-browsers (Playwright 1.56.x).
- Remote-access research (Sept 2026): tailscale.com and cloudflare docs were blocked by the sandbox
  proxy; tier details came from third-party summaries — re-verify before publishing the guide.
