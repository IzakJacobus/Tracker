# Stint — Progress

> Single source of truth for where the work stands. Update after every meaningful step.

## Current phase
**Phase 4 — Time entries, timer, weekly grid, calendar** (starting)

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
- **Phase 2 complete**.
- Phase 3: rates/rollups/rounding (+31 unit tests); clients/projects/tasks/tags/members APIs +
  sync pull (+19 integration tests); Dexie store + pull engine (+4 tests); Projects tree page with
  drag-and-drop (verified in Chromium: WP2 dragged under Construction monitoring), Clients page.
  Setup wizard step 4 now works.
- **Phase 3 complete.**

## In progress
- Phase 4 (see ROADMAP "Plan adjustment": sync push is built with time entries)

## Next step (exact)
1. `packages/shared/src/sync.ts`: write the conflict tests FIRST (`test/sync-merge.test.ts`):
   field-level LWW by HLC, delete-wins tombstones, locked periods reject, dual running timers,
   unknown/forbidden fields stripped. Then implement `mergeChange()` to make them pass.
2. Server `POST /api/sync/push` using `mergeChange`, rate snapshot + entry_date derivation,
   one-running-timer rule, audit log; integration tests.
3. Web outbox + `pushHook` in SyncEngine; entry repository (create/update/delete/start/stop).
4. Timer dock, entries list (edit/duplicate/continue/delete), manual entry, weekly grid,
   calendar day view, favourites/recents, command palette + shortcuts.

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
