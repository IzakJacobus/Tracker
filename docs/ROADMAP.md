# Stint — Roadmap

Each phase ends with: all tests green → app runs → CHANGELOG updated → commit + push.
Live status lives in [PROGRESS.md](PROGRESS.md).

> **Plan adjustment (Phase 2):** the local-first store and sync protocol are built *together with*
> time entries rather than after them, so the tracking UI is written once against IndexedDB
> instead of first against REST and then rewritten. Concretely: Phase 3 adds the pull endpoint and
> the Dexie store for reference data; Phase 4 starts with the conflict tests, then the push
> endpoint, outbox and tracking UI; Phase 5 hardens offline behaviour (status UI, service worker,
> rejection handling, offline e2e). The pairing code (planned for Phase 9) was pulled into
> Phase 2 because the setup wizard's last step shows it.

## Phase 1 — Foundations
- Monorepo (Bun workspaces): `apps/server`, `apps/web`, `apps/desktop`, `packages/shared`, `e2e`
- Tooling: TypeScript strict, Biome (lint + format), EditorConfig, bun test, Vitest
- CI (GitHub Actions): lint, type-check, unit + integration tests on push/PR
- README, LICENSE (MIT), CONTRIBUTING, CHANGELOG, `.gitignore`
- ARCHITECTURE, ROADMAP, PROGRESS
- SQLite schema v1 + migration runner (checksums, transactional) + tests
- Shared primitives: UUIDv7, HLC, Zod schemas skeleton

## Phase 2 — Auth, users, organisation, setup wizard
- Config loading, server bootstrap (loopback HTTP + LAN HTTPS placeholder)
- argon2id passwords, sessions (cookie + bearer), login rate limiting, CSRF header
- Roles + permission policy module (unit tests)
- Organisation settings API (currency, timezone, week start, rounding, …)
- Users API (invite/create, deactivate, reset password)
- Design system: tokens, typography, light/dark, core components
- Web: app shell, login, setup wizard (organisation → admin → first client/project → invite)

## Phase 3 — Clients, projects, tasks, rates, budgets
- Clients (with built-in "Internal"), nested projects, tasks, tags, project members
- Rate resolution + rollups + budgets (unit tests)
- Admin UI: clients list, project tree editor with drag-and-drop re-parenting, archive

## Phase 4 — Tracking
- Time entry API; one running timer per user; rate snapshot
- Timer dock (always visible), quick project switcher, favourites/recents
- Entry list (edit, duplicate, continue, delete), manual entry
- Weekly grid timesheet, calendar/day view
- Keyboard shortcuts + command palette

## Phase 5 — Local-first sync
- Conflict tests FIRST (field-level LWW, tombstones, locks, dual timers)
- Server push/pull endpoints, change sequence, per-role shaping, sync epochs
- Client Dexie store, outbox, sync loop, reconciliation of rejected changes
- Sync status indicator; offline banner; PWA service worker

## Phase 6 — Reports and exports
- Report builders in `packages/shared` (project timesheet, monthly per person, client summary)
- Company dashboard (hours, utilisation, top projects, budget burn, missing timesheets)
- Filters (date, client, project subtree, user, tag, billable)
- PDF (branded, signature line), CSV, XLSX

## Phase 7 — Timesheets and audit
- Submit week/month, approve/reject with comment, locking, admin unlock with reason
- Reminders for under-filled days
- Audit log viewer; re-rate tool

## Phase 8 — Desktop app
- Tauri 2 shell around `apps/web`; DesktopTransport with pinned rustls verifier
- Discovery (mDNS + UDP broadcast), pairing code entry, rediscovery
- Tray timer (start/stop/switch), idle detection prompt, autostart option

## Phase 9 — Ship it
- Server: TLS CA/leaf, mDNS advertiser, UDP responder, port fallback, sleep guard,
  public-network detection, backups/restore, update check, health page
- Windows service (WinSW) + NSIS installer with firewall rules; client installer via Tauri
- Release workflow on tags (Windows; macOS/Linux where cheap)
- Seed script (demo company), CSV import (incl. Toggl exports), polish, screenshots, user docs
- Install-flow test on a clean Windows machine (documented)
- Status: all built. The Windows install test is written up in INSTALL_TEST.md but has not been
  run yet, because no Windows machine was available.

## Later / ideas
- Invoice export to accounting packages (Sage, Xero CSV formats)
- Expense tracking; leave balances
- Multi-organisation servers
