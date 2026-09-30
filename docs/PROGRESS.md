# Stint — Progress

> Single source of truth for where the work stands. Update after every meaningful step.

## Current phase
**Phase 3 — Clients, nested projects, tasks, rates, budgets** (starting)

## Done
- Architecture (`docs/ARCHITECTURE.md`) and roadmap (`docs/ROADMAP.md`)
- Monorepo skeleton, Biome, TS strict, EditorConfig, LICENSE, CONTRIBUTING, CHANGELOG, CI
- `packages/shared`: UUIDv7 (monotonic), HLC (+ tests)
- `apps/server`: SQLite schema v1 (`0001_initial.sql`), migration runner with checksums (+ tests)
- `apps/web`: Vite 8 + React 19 + Vitest 5 skeleton (+ test)
- **Phase 1 complete** (lint, typecheck, tests green locally)
- Phase 2: shared schemas/permissions/dates (+tests); server config, auth, sessions, rate limit,
  setup (loopback only), org + users APIs, TLS CA/leaf, port fallback, pairing code + QR (+38
  integration tests); web design system, shell, login, setup wizard, settings, team (+3 tests).
  Verified in Chromium via Playwright screenshots (wizard, settings, team light/dark).
- **Phase 2 complete** — except wizard step 4 ("first client and project") which calls
  `/api/clients` + `/api/projects`, arriving in Phase 3.

## In progress
- Phase 3 (see ROADMAP "Plan adjustment")

## Next step (exact)
1. `packages/shared/src/rates.ts` (task > member > project(ancestors) > client > user > org) + tests.
2. `packages/shared/src/rollup.ts` (tree totals, budgets 80/100 %) + `rounding.ts` + tests.
3. Server REST: `/api/clients`, `/api/projects` (tree, reparent with cycle check, archive),
   `/api/tasks`, `/api/tags`, `/api/projects/:id/members` + integration tests.
4. Server `GET /api/sync/pull` (per-role shaping, sync epoch) + tests.
5. Web: Dexie store + pull loop; Projects tree page (dnd-kit), Clients page.

## Open decisions (for the owner)
- Repository: the brief asked for a new public repo via `gh repo create`; this environment has no
  `gh` CLI and is scoped to `IzakJacobus/Tracker`, so Stint is developed there. Rename the repo to
  `stint` in GitHub settings if desired (redirects keep working).
- Work is pushed to branch `claude/zen-planck-d724oo` (session constraint); merge to `main` via PR.

## Known bugs
- none yet

## Commands
```bash
# run the server with the built web client (dev):
cd apps/web && bun run build && cd ../server && \
  STINT_DATA_DIR=$PWD/data STINT_OPEN_BROWSER=0 STINT_WEB_DIR=$PWD/../web/dist bun src/main.ts
# → setup wizard at http://localhost:47601/setup ; LAN HTTPS on :47600
# or hot reload: `bun run dev:server` + `bun run dev:web` (Vite on :5173 proxies /api to :47601)
bun install
bun run lint && bun run typecheck && bun run test
cd apps/web && bun run build   # production web build
```

## Environment notes
- Toolchain verified: Bun 1.3.14 (cross-compiles Windows exe), Node 22, Rust 1.97, Chromium for
  Playwright at /opt/pw-browsers (Playwright 1.56.x).
- Remote-access research (Sept 2026): tailscale.com and cloudflare docs were blocked by the sandbox
  proxy; tier details came from third-party summaries — re-verify before publishing the guide.
