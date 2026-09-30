# Changelog

All notable changes to Stint are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Project foundations: Bun monorepo (`apps/server`, `apps/web`, `apps/desktop`, `packages/shared`),
  TypeScript strict mode, Biome, EditorConfig, CI workflow.
- Architecture and roadmap documents.
- SQLite schema v1 and a checksummed, transactional migration runner.
- UUIDv7 generator and hybrid logical clock (HLC) in the shared package.
- Web client skeleton (Vite + React 19 + Vitest).
- Shared domain: Zod schemas for every entity and API input, role-based permission policy,
  timezone-aware date helpers and forgiving duration/time parsing (all unit-tested).
- Server: configuration (defaults < `stint.config.json` < `STINT_*` env), argon2id passwords,
  hashed session tokens (httpOnly cookie for browsers, bearer token for the desktop app),
  per-account and per-IP login throttling, CSRF header check, audit log.
- First-run setup API (only from the server PC) that creates the organisation, the first admin and
  the built-in *Internal* client with Administration, Business development, Training, R&D and
  Leave projects.
- Organisation settings and user management APIs, with last-admin protection and rate hiding.
- Self-generated local certificate authority + leaf certificate (re-issued when IPs change),
  HTTPS on the LAN, loopback HTTP for the setup wizard, automatic port fallback.
- Pairing codes (`XXXX-XXXX-XXXX-XXXX`: IP + port + certificate fingerprint prefix) and QR code.
- Design system: Fynbos/Ochre/Stone colour tokens, IBM Plex type, light + dark themes, buttons,
  fields, switches, segmented controls, dialogs with focus trap, popovers/menus, toasts.
- Web: app shell with collapsible sidebar and phone drawer, sign-in, six-step setup wizard,
  forced password change, account page, organisation settings, team management.
- Rate resolution (task › per-person project rate › project tree › client › person › organisation),
  billability inheritance, tree rollups, budgets with 80 % / 100 % warnings, rounding rules.
- APIs for clients (archive, protected Internal client), nested projects (move with cycle check,
  subtree follows to another client), tasks, tags and project members; per-role shaping hides money
  from members.
- Sync pull endpoint (incremental, paged by a global change sequence, epoch-based full resync).
- Web: local IndexedDB copy (Dexie) with a pull loop and a visible sync status pill; Projects tree
  editor with drag-and-drop re-parenting, keyboard-friendly "Move to…", tasks and people tabs,
  budget progress; Clients page.
- Sync merge engine (conflict tests written first): field-level last-write-wins by hybrid logical
  clock, delete-wins tombstones, locked periods always win, server-owned fields stripped, dual
  running timers resolved.
- Sync push endpoint with per-change transactions, permission checks, validation, entry dates in
  the organisation's time zone, rate snapshots, one running timer per person and audit logging.
- Web: outbox with in-order push and rollback of rejected changes; always-visible timer dock;
  project/task picker with favourites, recents and search; tag picker; entry dialog; list view
  with continue/duplicate/undoable delete; spreadsheet-style weekly grid; day calendar with
  drag-to-move/resize; command palette (Ctrl/Cmd+K) and keyboard shortcuts.
- Playwright end-to-end tests (sign-in, start/stop timer, weekly grid) and a CI e2e job.
- Offline start as an installable PWA: a build-time service worker precaches the app shell (never
  API data), web manifest and icons, and an "update available — Reload" prompt.
- Sign-out deletes this person's local copy on shared computers, and warns before discarding
  changes that haven't reached the server.
- End-to-end test: offline edit, offline reload, reconnect, synced to the server.
- Reports computed from the local copy (so they work offline): company overview (hours,
  billable utilisation, hours-per-day chart, top projects, budget burn, people, missing
  timesheets), monthly timesheet per person, project timesheet (whole subtree, by person/task/
  sub-project), client summary for invoicing; filters for period, client, project subtree,
  person, tag and billability.
- Exports: branded A4 PDF (logo, address, registration/VAT, accent colour, signature lines, page
  numbers), Excel (.xlsx) and CSV (Excel-friendly, formula-injection safe).
- Demo seed: `bun run seed` creates Karoo Consulting Engineers with 5 people, 4 clients, nested
  projects, internal work, leave and three months of entries.
- E2E: monthly PDF export, money hidden from members.
- Timesheet workflow: submit, withdraw, approve, send back with a comment, admin unlock with a
  reason; submitted and approved periods lock their entries (enforced by the server). Track shows
  a submission card (short-day warnings, rejection comments); Approvals page with review, a
  pending-count badge in the menu and the admin unlock.
- Audit log viewer (Settings → Audit log) and a re-rate tool with preview (Settings → Re-rate).
- Reminders when today (after the reminder time) or the last working day is under-filled, with
  optional browser notifications.

### Fixed
- Submitting a timesheet right after an edit could lock the period before the edit reached the
  server, silently rolling it back. Submitting now sends pending changes first.
- `.gitignore` hid `apps/web/src/data` and `apps/web/build` from the repository.
