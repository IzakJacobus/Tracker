# Stint — Progress

> Single source of truth for where the work stands. Update after every meaningful step.

## Current phase
**Phase 9 — Ship it** — complete, except the hands-on Windows install test (needs a Windows VM)

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
- Phase 5: service worker (build plugin `apps/web/build/sw-plugin.ts`), manifest, icons
  (`bun scripts/make-icons.ts`), update prompt, safe sign-out, mobile sync status; e2e
  `offline.spec.ts` passes (8/8 e2e).
- **Phase 5 complete.**
- Phase 6: `packages/shared/src/reports.ts` (+11 tests), exporters in `src/export/` (+9 tests),
  reports UI (overview/monthly/project/client) with validated chart palette, demo seed
  (`apps/server/scripts/seed.ts`), e2e for PDF export (11/11 e2e). PDFs checked visually.
- **Phase 6 complete.** Decision: reports run client-side over the synced local copy (members see
  only their own data because the server never sends them more).
- Phase 7: timesheet routes + admin audit/rerate (+10 integration tests), submit card, reminders,
  approvals page, audit viewer, re-rate page; e2e `approval.spec.ts` (submit → send back →
  resubmit → approve → admin unlock). 12/12 e2e green. Bug found and fixed: submit raced pending
  edits (see CHANGELOG "Fixed").
- **Phase 7 complete.**
- Phase 8: server mDNS + UDP responder (+1 test); `apps/desktop/src-tauri` (pin.rs, net.rs,
  discovery.rs, pairing.rs, store.rs, idle.rs, lib.rs; 3 Rust tests; `examples/probe.rs` live check);
  web PairScreen, DesktopGate, DesktopBridge (tray + idle dialog), desktop settings. Built with
  `bunx tauri build --debug --no-bundle` and driven under Xvfb with xdotool: discovery → pair →
  sign in → synced Track screen (screenshots in docs/screenshots). Windows build: CI (Phase 9).
- **Phase 8 complete.** Not verifiable here: Windows tray/idle APIs (compile-checked only in CI).

- Phase 9: backups + restore + folder browser (`services/backup.ts`); health report, sleep
  guard, Windows network/firewall checks, Tailscale status, update check (`services/health.ts`,
  `platform/*`, `services/updates.ts`); CSV import incl. Toggl (`csvImport.ts`,
  `services/importer.ts`); Settings → Health / Backups / Remote access / Import; admin update
  notice; single-file server build (`apps/server/scripts/build.ts`), WinSW service + NSIS
  installer (`installer/windows/`), systemd unit, release workflow (`.github/workflows/release.yml`),
  CI packaging job with `installer/smoke-test.sh`; desktop address failover incl. Tailscale
  (`remember_addresses`); docs: README, USER_GUIDE, ADMIN_GUIDE, REMOTE_ACCESS, INSTALL_TEST,
  RELEASING; screenshots via `scripts/screenshots.ts`.
  Bugs found and fixed: managers saw "(deleted project)" for their team's projects; manager
  changes didn't resync the manager.
- **Phase 9 complete** apart from running INSTALL_TEST.md on real Windows.
- Linux follow-up (user request): `installer/linux/install.sh` (systemd service, `stint` account,
  ufw/firewalld private-network rules, polkit rule for the sleep inhibitor, upgrade, uninstall,
  `--purge`), CI job *Linux install script* runs it on a real systemd runner; Linux desktop idle
  detection (`idle.rs`: Mutter D-Bus for GNOME, XScreenSaver for X11; verified under Xvfb).
  Bug found and fixed: x11-dl looks for libXss.so.2/libXss.so, which desktops don't ship.

- Code review follow-up: fixed 8 findings plus 4 smaller ones (see CHANGELOG "Security"/"Fixed"),
  each with a regression test that fails without the fix. Pairing codes are now 24 characters.

- Release prep (v0.1.0): one-command Linux install (`installer/linux/get-stint.sh`, checksum
  verified, tested locally and in CI), short install guide (`docs/INSTALL.md`), CHANGELOG
  versioned, desktop app compile-checked for Windows (MinGW), Linux .deb/.AppImage built locally.

## In progress
- nothing

## Next step (exact)
1. Run docs/INSTALL_TEST.md on a clean Windows 10/11 VM with artifacts from the release
   workflow (push a `v0.1.0` tag, or run the workflow by hand) and record the results.
2. Fix whatever that turns up (most likely spots: WinSW env expansion of `%ProgramData%`,
   icacls on the data folder, `open` from the Finish page, PowerShell JSON shapes).
3. Then: code signing (see docs/RELEASING.md), and the "Later / ideas" list in the roadmap.

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
  proxy; tier details came from third-party summaries — re-verify (docs/REMOTE_ACCESS.md says so).
- NSIS (`apt-get install nsis`) compiles the Windows installer on Linux.
