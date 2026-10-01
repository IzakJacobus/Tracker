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
- Pairing codes (`XXXX-XXXX-XXXX-XXXX-XXXX-XXXX`: IP + port + 72-bit certificate fingerprint prefix) and QR code.
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

- Server discovery on the LAN: mDNS/DNS-SD (`_stint._tcp`) plus a UDP broadcast responder.
- Desktop app (Tauri 2): finds the company's server by itself (or accepts a pairing code),
  pins the server's own certificate authority, keeps the session token inside the app, fails over
  between addresses and rediscovers the server when its IP changes; tray timer (start/stop,
  tooltip with the running entry), closes to the tray, optional start at sign-in, idle detection
  ("you were away 25 min — keep / discard / discard and stop"), native save dialog and reminder
  notifications. Verified on Linux (WebKitGTK under Xvfb) against a live server.
- CI job that builds the web client and runs the desktop Rust tests.

- Nightly backups (`VACUUM INTO`, integrity-checked, keep the last N) to a folder the admin picks
  from any browser (USB and OneDrive suggestions), a backup before every database upgrade, and
  one-click restore with an automatic safety copy, rollback on failure and a full client re-sync.
- Health page: database, backups, disk space, network, Windows firewall, sleep prevention, remote
  access and certificate checks with one-click fixes (back up now, mark network Private), people
  connected now, the pairing code and server details.
- Sleep prevention while the server runs (Windows `SetThreadExecutionState`; `caffeinate` /
  `systemd-inhibit` elsewhere), switchable in settings.
- Daily update check against GitHub Releases (only the version is sent; can be turned off).
- Remote access page recommending Tailscale, with live Tailscale status; the Tailscale name is added
  to the server certificate.
- CSV import for Toggl Track detailed exports, Stint's own exports and simple Date/Person/Project/
  Duration files: exact dry-run preview, person mapping, creates missing clients/projects/tasks/
  tags, skips duplicates and locked periods.

- Single-file server executable with the web client embedded (Windows, Linux, macOS), a Windows
  service (WinSW) and an NSIS installer: admin-only data folder, firewall rules for Private and
  Domain networks only (removed on uninstall), Start-menu shortcut, upgrade in place.
- Release workflow on version tags: a draft GitHub Release with the server installer, portable
  and Unix server builds, desktop bundles and checksums. A CI job builds and smoke-tests the
  server binary and compiles the installer on every push.
- Admins see "Stint x.y is available" in the sidebar.
- The desktop app learns every address the server answers on, including its Tailscale name,
  and fails over to them away from the office.
- Documentation: README with screenshots and a plain-language quick start, user guide, admin
  guide, remote access guide, install test checklist and release process.

- Linux server install script (`installer/linux/install.sh`): service account, systemd
  service, ufw/firewalld rules for private networks only, permission to keep the computer
  awake, upgrade in place, uninstall with optional purge. Tested in CI on a real systemd
  machine.
- Idle detection in the Linux desktop app: GNOME (X11 and Wayland) and other X11 desktops.

- Projects → New project: choose "+ New client…" to create the client in the same step.

### Security
- Sync push no longer returns another person's time entry or favourite when it rejects a change
  to it (a member could read someone's entry by guessing its ID).
- People with an admin-set temporary password must choose their own before the server lets
  them use anything else (it was only enforced by the app's screen).
- Pairing codes carry 72 bits of the server's certificate fingerprint (24 characters) instead
  of 32, which a LAN attacker could have forged by generating keys.
- "From the server PC" (first-run setup, plain-HTTP admin) now also requires a local host name,
  closing DNS rebinding and requests arriving through a tunnel on the same PC.
- Favourite updates are checked like creates (no repointing at off-limits projects or foreign
  tasks); tag renames are trimmed, length-limited, de-duplicated and colour-checked.

### Fixed
- Submitting a timesheet right after an edit could lock the period before the edit reached the
  server, silently rolling it back. Submitting now sends pending changes first.
- `.gitignore` hid `apps/web/src/data` and `apps/web/build` from the repository.
- Demo seed attached parent-project tasks to sub-project entries; now tested for consistency.
- A manager's reports showed "(deleted project)" for time their team logged on projects the
  manager isn't a member of. Managers can now see (not track on) their team's projects.
- Changing someone's line manager, or a team member's project access, didn't send the manager
  the older rows they could now see. Their local copy is now rebuilt.
- Opening up, closing or moving a project didn't sync its sub-projects and tasks (or retract
  them); every app now resyncs after such a change.
- One broken change in a sync batch failed the whole push with a 500 (and the device resent it
  forever); it is now rejected on its own.
- Safety copies and folder tests counted as "the nightly backup", so a restore could make the
  scheduler skip that night's backup and Health show a misleading date.
- "Reports to" accepted unknown people (a 500) and loops; it now must be an existing manager or
  admin, without loops.
- With more than one admin, admins can no longer approve their own timesheet.
- Switching the approval period from month to week could create a timesheet overlapping an
  already submitted or approved month.
- The project list in Add time opened behind the window and couldn't be clicked; lists and menus
  now open above dialogs, and Escape closes only the list.
- "Create project" did nothing: the form could start with no client (the list was still loading)
  and the server's error had nowhere to show. It now picks the client once the list loads and
  shows any error it can't place next to a field.
