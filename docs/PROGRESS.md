# Stint — Progress

> Single source of truth for where the work stands. Update after every meaningful step.

## Current phase
**Phase 5 — Local-first hardening: offline, PWA, sync status** (starting)

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
- Phase 4: conflict tests first (24), merge engine, push endpoint (+19 integration tests), outbox +
  EntryRepo (+15 web tests), timer dock, picker, entry dialog, list/week grid/day calendar, command
  palette + shortcuts; Playwright e2e harness (`e2e/`) with 6 passing tests; CI e2e job.
  Bug found by e2e and fixed: Enter in the grid's last row didn't save.
- **Phase 4 complete.** (Idle detection → Phase 8 desktop; under-filled-day reminders → Phase 7.)

## In progress
- Phase 5

## Next step (exact)
1. PWA: `vite-plugin-pwa` (precache app shell, `registerType: prompt`), manifest + icons, offline
   app start; show an "Offline" banner/status in the dock when the server is unreachable.
2. Session persistence offline: the cached `/auth/me` already lets people keep working; verify with
   an e2e test `e2e/offline.spec.ts` (context.setOffline(true) → edit/add entries → pending count →
   setOffline(false) → Synced → reload shows edits).
3. Conflict UX: toast + sync popover list for rejected changes (done); add "merged" notice.
4. Clear local data on sign-out when the outbox is empty; warn if not.

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
bun run check                  # lint + typecheck + unit/integration tests
bun run test:e2e               # builds the web client, starts a throwaway server, runs Playwright
```

## Environment notes
- Toolchain verified: Bun 1.3.14 (cross-compiles Windows exe), Node 22, Rust 1.97, Chromium for
  Playwright at /opt/pw-browsers (Playwright 1.56.x).
- Remote-access research (Sept 2026): tailscale.com and cloudflare docs were blocked by the sandbox
  proxy; tier details came from third-party summaries — re-verify before publishing the guide.
