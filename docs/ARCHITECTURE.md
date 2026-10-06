# Stint — Architecture

Stint is a self-hosted, local-first time tracker for small consulting and engineering firms.
One office PC runs the **Stint Server**. Everyone else opens Stint in a **web browser** (it can be
installed as an app from the browser). Each browser keeps a local copy of that person's data, so
edits are instant and keep working offline. Changes sync with the server when it can be reached.

This document covers the stack, the data model, the sync design, security, and installation.
The phased build plan is in [ROADMAP.md](ROADMAP.md). Current status is in
[PROGRESS.md](PROGRESS.md).

---

## 1. Goals and hard constraints

| Constraint | How Stint meets it |
| --- | --- |
| Completely free, permissive licences | Bun (MIT), SQLite (public domain), Hono (MIT), React (MIT), Dexie (Apache-2.0), NSIS (zlib), WinSW (MIT). No paid services. |
| No network configuration | Automatic port selection, the installer adds its own firewall rule, the server makes its own TLS certificate, and setup shows the address (and a QR code) to share. |
| No Docker needed | The server is one `.exe` with the database engine built in. A Dockerfile exists only as an optional extra. |
| Non-technical installer | Double-click installer for the server. The setup wizard opens in the browser by itself. Nothing to install on anyone else's computer. |
| Local-first | IndexedDB on every client, an outbox of pending changes, incremental pulls, and a visible sync status. |
| Server-side security | Every permission check runs on the server. The client is never trusted. |

## 2. Stack

```
┌──────────────────────── Office PC ────────────────────────┐
│  stint-server.exe  (Bun single-file executable)            │
│  ├─ Hono HTTP API  (/api/*)                                │
│  ├─ Embedded web client (React build, served as a PWA)     │
│  ├─ bun:sqlite  → data/stint.db (WAL)                      │
│  ├─ TLS: self-generated local CA + leaf certificate        │
│  ├─ Scheduler: nightly backup, update check, sleep guard   │
│  └─ Run as a Windows service by WinSW (auto-start at boot) │
└────────────────────────────────────────────────────────────┘
                         ▲ HTTPS
                         │
            ┌────────────┴────────────┐
            │ Any browser (PWA)       │
            │ Windows, Linux, Mac,    │
            │ phones and tablets      │
            │ fetch + httpOnly cookie │
            │ IndexedDB local store   │
            └─────────────────────────┘
```

### 2.1 Why these choices

* **Bun + TypeScript on the server.** `bun build --compile` turns the server into a single
  executable, and it can **cross-compile** Windows, macOS and Linux builds from one Linux CI
  runner. Bun has built-in SQLite (`bun:sqlite`) and argon2id (`Bun.password`), so there are no
  native add-ons to ship. That was the main risk with Node single-executable apps. Bun also lets
  the server and client share one TypeScript codebase: the Zod schemas and the domain logic
  (rollups, conflict resolution) are written once in `packages/shared`.
  Go or Rust would give smaller binaries, but we would have to write the schemas and business
  rules twice.
* **Hono** is a small, fast, MIT-licensed web framework that runs natively on Bun. It has
  typed middleware and Zod validation.
* **SQLite in WAL mode.** It is embedded, needs no administration, and backs up to one file.
  WAL mode lets readers and the single writer run at the same time. Only the server process
  ever opens the database, so SQLite's single-writer model is not a limit. A firm of 5–100
  people writes a few thousand rows a day, far below what SQLite handles. PostgreSQL would
  mean a second thing to install and look after. `VACUUM INTO` gives consistent online
  backups.
* **React + TypeScript + Vite** for the client, served by the server as an installable PWA.
  A service worker keeps it working offline (see §6.3).
* **Dexie (IndexedDB)** for local storage. It is mature and has reactive live queries, which
  drive the optimistic UI: the UI reads from IndexedDB, and writes go to IndexedDB first.
  SQLite-WASM would add 1 MB+ and OPFS quirks for no real gain at this data size.
* **Biome** for linting and formatting (one fast tool) and `tsc --noEmit` in strict mode for
  type-checking. Tests use **bun test** for the server and shared code, **Vitest** for React
  components, and **Playwright** for end-to-end tests.
* **pdf-lib** for PDFs (pure JS, runs in the browser and on the server). **fflate** plus a small
  writer of our own for XLSX. **PapaParse** for CSV import.

### 2.2 Repository layout

```
apps/
  server/        Bun + Hono API, migrations, backups, TLS, scheduler
  web/           React client (PWA)
packages/
  shared/        Zod schemas, types, domain logic, sync merge, reports, exporters
e2e/             Playwright end-to-end tests
installer/       NSIS scripts, WinSW service config, firewall helper
docs/            Architecture, roadmap, progress, user guides
```

## 3. Data model

All IDs are **UUIDv7** strings. The client generates them, so offline creation needs no round
trip, and they sort by creation time. Every table that syncs has these columns:

| Column | Meaning |
| --- | --- |
| `id` | UUIDv7 (TEXT primary key) |
| `created_at` | ms epoch, set by whoever created the row |
| `updated_at` | ms epoch of the last accepted change |
| `deleted_at` | tombstone. Rows are never hard-deleted by sync |
| `server_seq` | INTEGER from a global counter that goes up on every accepted write. Used for incremental pulls |
| `field_clock` | JSON `{field: hlc}`: the hybrid-logical-clock stamp of each field's last write. Drives field-level last-write-wins |

### 3.1 Entities

```
organization (single row)
  name, logo, timezone (Africa/Johannesburg),
  week_start (1 = Monday), date_format (YYYY-MM-DD), workday_hours (8),
  working_days (Mon–Fri), approval_period (week|month), reminder settings,
  brand colours for PDFs, backup settings, remote access settings

user            id, email, name, role (admin|manager|member), active,
                password_hash, weekly_capacity_hours, color
client          id, name, code, archived, is_internal (one built-in "Internal" client)
project         id, client_id, parent_id (nullable: nesting to any depth), name, code,
                kind (the firm's own label for an item: "Phase", "Task", ...), color,
                budget_hours, archived (= "done"
                for items under a project), notes. A top-level row is a project; every
                row under it is an item. Hours go on items with nothing under them.
project_member  project_id, user_id, role (member|manager)
task            (0.1 only; migration 0002 turned every task into an item and emptied it)
tag             id, name, color, archived
time_entry      id, user_id, project_id (the item), task_id (always null since 0.2),
                description, started_at (orders entries within a day), duration_s, entry_date
                (local YYYY-MM-DD in the org timezone), source (manual|grid|import; timer in 0.1), tag_ids (JSON)
timesheet       id, user_id, period_start, period_end, status
                (draft|submitted|approved|rejected), submitted_at, decided_by,
                decided_at, comment
favorite        user_id, project_id (an item)  (per user, synced)
audit_log       id, at, actor_id, action (create|update|delete|approve|reject|unlock|
                submit|restore|login…), entity, entity_id, before, after, reason
session         token_hash, user_id, created_at, last_seen_at, expires_at, user_agent, ip
sync_seq        single-row counter
schema_migrations  version, name, checksum, applied_at
```

### 3.2 Rollups

Projects form a tree through `parent_id`. The total for a project is its own entries plus the
totals of all its descendants. `packages/shared/src/rollup.ts` builds the tree once and sums
bottom-up in O(n). It is unit-tested with deep, wide and archived subtrees. Budgets can be set
on any node and are measured against the rolled-up total. Warnings appear at 80 % (amber) and
100 % (red).

## 4. Sync design

### 4.1 Principles

1. The client writes to IndexedDB first, and the UI updates instantly from live queries.
2. Every local write also appends a **change** to the outbox table:
   `{changeId, table, id, patch: {field: value}, hlc}`.
3. The sync loop runs when changes are queued (debounced 400 ms), every 20 s, and when the
   window regains focus or the network comes back. It **pushes** the outbox, then **pulls**.
4. The server is the only authority. It validates, applies permission checks, merges, and
   assigns `server_seq`.

### 4.2 Clocks

Each client keeps a **hybrid logical clock (HLC)**: `wallMs:counter:nodeId`, which can be
compared as a plain string. The HLC is always at least the local wall clock and at least the
last HLC seen from the server. So even a client whose PC clock runs behind still produces
stamps that sort after anything it has already seen. The server rejects HLCs more than 5
minutes in the future and replaces them with its own time, so a PC clock set to next year
cannot win every conflict.

### 4.3 Push — `POST /api/sync/push`

For each change:

1. **Validate** the patch against the table's Zod schema (a partial schema for updates).
2. **Authorise.** Can this user write this row and these fields? Members may write only their
   own time entries and favourites. Managers may write projects they manage. Admins may write
   anything.
3. **Lock check.** If the time entry's current *or* new `entry_date` falls in a timesheet that
   is `submitted` or `approved` for that user, the change is **rejected**. Approved or locked
   data always wins and can never be changed through sync.
4. **Merge (field-level last-write-wins).** For each field in the patch, apply it only if
   `patch.hlc > row.field_clock[field]`. Ties are broken by comparing node IDs, which is
   already part of the HLC string, so ties are impossible in practice. Fields not in the patch
   are left alone. So two people editing *different* fields of the same row both keep their
   edits.
5. **Tombstones.** A delete is the patch `{deleted_at: now}` and follows the same rules.
   A later edit does not revive a deleted row: once `deleted_at` is set, only an explicit
   restore from the admin UI clears it. This is the "delete wins" rule, so an entry someone
   deleted on purpose never comes back.
6. **Derived fields and rules.** The server recomputes `entry_date`. An entry needs hours (there is no timer), and a newly chosen item must have
   nothing under it and must not be done (or under a done item). Existing entries stay editable.
7. Assign a new `server_seq` and write an **audit log** entry, in the same transaction.

The response lists, for each change, `accepted`, `merged` (some fields lost) or
`rejected` (with a reason code and the authoritative row). The client then removes the change
from the outbox. For merged or rejected changes it overwrites its local row with the server's
version. If anything was rejected, it shows a clear notice, for example "The week of 3 March
is approved and locked — your edit was undone."

### 4.4 Pull — `GET /api/sync/pull?since=<seq>&limit=500`

The server returns the rows with `server_seq > since` that the user may see, plus the new
cursor and `hasMore`. Rows are **filtered per role**. For example, a member only receives
their own entries and the projects they may log hours on.

If a user's visibility changes (new project assignment, role change), the server increments
`user.sync_epoch`. The client sees the new epoch in the response and does a full pull
(`since=0`), keeping its outbox. Reference data such as projects (and their items), clients and tags is
small, so a full pull is cheap.

### 4.5 Status shown in the UI

| State | Meaning |
| --- | --- |
| **Synced** | outbox empty, last pull under 60 s ago |
| **Pending (n)** | changes waiting in the outbox, server reachable |
| **Offline** | server unreachable. Everything still works, and changes are kept |
| **Error** | server rejected a change or the session expired. Click for details |

### 4.6 Things that need a connection

Logging in, submitting, approving or rejecting timesheets, admin settings, reports that cover
other people, and PDF exports of other people's data all need the server. Your own
entries, favourites and your own monthly timesheet PDF work offline.

## 5. Security

* **TLS on the LAN.** On first run the server makes a **local certificate authority (CA)**
  (ECDSA P-256, valid 10 years) and a leaf certificate signed by it. The leaf covers
  `localhost`, the PC name, `<pcname>.local` and every current LAN IP address. The leaf is
  re-issued automatically when the IP addresses change, and the CA stays the same. The CA's
  private key is stored in the database, so a backup restored on a new PC keeps the certificate
  that browsers already trust.
* **Trusting the CA.** Browsers warn about the certificate until the CA is installed as a trusted
  root. The setup wizard and the Health page link to `/stint-ca.crt` for that; it is also served
  over plain HTTP on the LAN (port 47601), which otherwise only redirects to HTTPS.
* **Loopback HTTP.** On the server PC itself the setup wizard and admin pages open at
  `http://localhost:<port>`. That is served on 127.0.0.1 only, which browsers treat as secure,
  so the person installing never sees a certificate warning.
* **Passwords.** argon2id (`Bun.password`, m=64 MiB, t=2).
* **Sessions.** 256-bit random token. Only its SHA-256 hash is stored. Browsers get it in a
  `Secure; HttpOnly; SameSite=Strict` cookie, so page scripts never see it. Bearer tokens are not
  accepted. Sessions expire after 30 days (sliding) and can be revoked.
* **CSRF.** SameSite=Strict, plus a required `X-Stint-Request: 1` header on every request that
  changes data.
* **Login rate limit.** 5 failed attempts per username+IP within 15 minutes locks that pair out
  for 15 minutes, with a general limit per IP as well.
* **Authorisation.** Every route declares what it requires. Policy functions in
  `packages/shared/src/permissions.ts` are unit-tested and **evaluated on the server**. The
  client uses the same functions only to hide buttons.
* **Validation.** Every request body and query is parsed with Zod. Unknown keys are stripped.
* **Audit log.** Every create, update or delete of time entries, timesheets and
  projects, and every approve, reject, unlock and restore, is logged with before and
  after snapshots and a reason where one applies.
* **Security headers.** CSP, `X-Content-Type-Options`, `Referrer-Policy`, and
  `frame-ancestors 'none'`.

## 6. Networking

### 6.1 Ports and addresses

The default is TCP 47600 for HTTPS (LAN) and 47601 for HTTP (loopback, plus certificate download
and a redirect to HTTPS on the LAN). If a port is taken, the server tries the next ones (47602,
47604, …). The chosen port is saved in `<data folder>/run/runtime.json`.

People reach the server at `https://<pc-name>.local:<port>` (the operating system resolves
`.local` names on the LAN) or at one of its IP addresses. `GET /api/connect` returns these
addresses and a QR code (with an IP address, because phones often can't resolve `.local`); the
setup wizard and the Health page show them. Before 0.2 a desktop app found the server by mDNS
and UDP broadcast and paired with a code; that is gone.

### 6.2 Firewall and the Public network trap

The installer adds a program-based Windows Firewall rule (TCP) for `stint-server.exe`
with `profile=private,domain`, never public, under one UAC prompt. Uninstalling removes it, and
upgrading removes the UDP rule older versions added. A rule based on the program rather than the
port keeps working if the server has to pick another port. The server checks the network
category (`Get-NetConnectionProfile`) every few minutes. If the network is **Public**, it shows a
clear warning in the wizard and on the Health page, with a one-click "This is my office network —
mark it as Private" button. The service runs with enough rights to make that change.

### 6.3 Client transport and offline use

`apps/web/src/lib/transport.ts` talks to the same origin with `fetch` and the cookie session. A
service worker caches the app's files, so an installed (or bookmarked) Stint opens and works
offline; IndexedDB holds the data and the outbox. Offline copies belong to one origin, so people
should always use the same address.

## 7. Running the server on Windows

* `apps/server/scripts/build.ts` produces one self-contained executable with `bun build
  --compile`. The web client is embedded through generated `import … with { type: "file" }`
  statements, so no other files are needed at runtime.
* The NSIS installer (`installer/windows/server.nsi`) copies `stint-server.exe`,
  `stint-server-service.exe` (WinSW 2.12, MIT, checksum pinned) and
  `stint-server-service.xml` to `C:\Program Files\Stint Server`. Data goes to
  `C:\ProgramData\Stint`, which only SYSTEM and Administrators can read (it holds password
  hashes and the CA key). The `run\` subfolder, which only holds `runtime.json` with the
  ports, is also readable by Users.
* The service starts automatically (delayed start) and WinSW restarts it when it exits with an
  error. That is also how a restore that brings in a different certificate restarts it: the
  server exits with code 75. Logs rotate in `C:\ProgramData\Stint\logs`.
* Firewall: one inbound program rule (TCP), profile
  `private,domain`. They are deleted and re-added on upgrade, and removed on uninstall.
* **Sleep guard.** While running, the server calls `SetThreadExecutionState(ES_CONTINUOUS |
  ES_SYSTEM_REQUIRED)` through `bun:ffi`, so the PC does not go to sleep. The display may
  still switch off. Admins can turn this off in settings. macOS uses `caffeinate -w`, and Linux
  uses `systemd-inhibit`.
* The platform monitor (every 5 minutes, and on demand from Health) refreshes the LAN
  addresses (after DHCP changes), the Windows network category (`Get-NetConnectionProfile`),
  the firewall rules (`Get-NetFirewallRule`) and Tailscale's status (`tailscale status --json`).
* The Start-menu shortcut **"Stint Server"** runs `stint-server.exe open`. That waits up to
  30 s for `run\runtime.json` and a response from the server, then opens the setup wizard or
  the admin page in the default browser. The installer's Finish page runs it.
* Linux gets the same binary with a systemd unit (`installer/linux/stint-server.service`), and
  macOS gets a plain binary. These are for technical users.

## 8. Backups, restore and updates

* **Nightly backup** at 02:00 (configurable). If the last successful backup is more than 26 h
  old, for example because the PC was off, it runs on the next scheduler tick. `VACUUM INTO`
  writes `stint-YYYY-MM-DD-HHmm[-kind].db` to the folder the admin chose. That folder is picked
  with a folder browser that runs on the server and suggests USB drives and OneDrive folders.
  The newest N (default 30) regular backups and the newest 10 safety copies are kept. Each
  backup is checked with `PRAGMA integrity_check`, and the result is logged in `backup_log`.
* **Restore** (admin only, one click). The server checks the file (integrity, and a schema
  that isn't newer than this build), makes a safety copy in `restore-safety/`, closes and
  swaps the database, runs migrations, and bumps the global sync epoch so every client does a
  full resync. If anything fails after the swap, the safety copy is put back.
* **Updates.** The server checks the GitHub Releases API (`releases/latest`, so drafts and
  pre-releases are ignored) once a day, and an admin can check on demand. Only the request
  itself leaves the network. Admins see "Stint X is available" in the sidebar and on Health.
  Updating means running the new installer, which keeps the data folder. Migrations run
  automatically on the next start, after an automatic pre-migration backup.
* **Release builds:** see [RELEASING.md](RELEASING.md).

## 9. Migrations

`apps/server/src/db/migrations/NNNN_name.sql` files are embedded in the binary. At startup
the runner:

1. takes a pre-migration backup if there are pending migrations and the database is not empty,
2. applies each pending migration in its own transaction,
3. records version, name and a SHA-256 checksum in `schema_migrations`, and
4. refuses to start if an applied migration's checksum has changed. Migrations are never
   edited after release.

Migrations only move forward. Downgrading means restoring a backup.

## 10. Remote access (optional, off by default)

The app works fully without remote access. For staff who want to reach the server from home:

| | **Tailscale** (recommended) | Cloudflare Tunnel |
| --- | --- | --- |
| Cost | Free "Personal" plan: up to 6 users, unlimited devices | Tunnel is free, but it needs a domain on Cloudflare (a domain costs money every year) and a payment method on the Zero Trust account (free up to 50 users) |
| Setup | Install Tailscale on the server PC and each remote laptop, and sign in | Create a Cloudflare account, add a domain, create a tunnel, install `cloudflared` as a service |
| Works with Stint's own certificate | Yes. It is a private network, and the certificate covers the server's Tailscale name | Needs `noTLSVerify` to the origin. The public hostname is exposed to the internet (protect it with Cloudflare Access) |
| Inbound ports | None (outbound only) | None (outbound only) |

**Recommendation: Tailscale** for firms with up to 6 people who need remote access. It needs
no domain, is never exposed to the public internet, and Stint notices it by itself. When the
setting is on, the server adds its Tailscale address (`100.x.y.z` and its MagicDNS name) to the
certificate and to the list of addresses clients try. Firms with more than 6 remote users
should move to Tailscale's paid plans or Cloudflare Tunnel. See
[REMOTE_ACCESS.md](REMOTE_ACCESS.md). Tier details were checked in September 2026 and change
often. Always confirm them on the vendors' pricing pages.

## 11. Configuration

Settings come from these sources, in increasing priority: built-in defaults <
`data/stint.config.json` < environment variables (`STINT_PORT`, `STINT_DATA_DIR`,
`STINT_LOG_LEVEL`, `STINT_DISABLE_DISCOVERY`, `STINT_DISABLE_SLEEP_GUARD`, …). See
[`apps/server/stint.config.example.json`](../apps/server/stint.config.example.json). No
secrets are ever committed. Keys and certificates are generated at runtime.

## 12. Testing strategy

| Layer | Tool | What |
| --- | --- | --- |
| Domain unit | bun test | rollups, HLC, conflict merge, permissions, report builders |
| Server integration | bun test + in-memory SQLite | every API route: auth, RBAC, validation, sync push and pull, locking, audit |
| Components | Vitest + Testing Library | grid, forms, sync status |
| End to end | Playwright | login, log hours (drill down), done items, offline edit then sync, submit and approve, monthly PDF |

CI runs lint, type-check and all test suites on every push and pull request. Tagged releases
build the installers.
