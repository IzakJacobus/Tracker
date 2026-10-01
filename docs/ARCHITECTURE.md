# Stint — Architecture

Stint is a self-hosted, local-first time tracker for small consulting and engineering firms.
One office PC runs the **Stint Server**. Every employee runs the **Stint desktop app** (or opens
Stint in a browser). Each client keeps a local copy of that person's data, so timers and edits
are instant and keep working offline. Changes sync with the server when it can be reached.

This document covers the stack, the data model, the sync design, security, and installation.
The phased build plan is in [ROADMAP.md](ROADMAP.md). Current status is in
[PROGRESS.md](PROGRESS.md).

---

## 1. Goals and hard constraints

| Constraint | How Stint meets it |
| --- | --- |
| Completely free, permissive licences | Bun (MIT), SQLite (public domain), Hono (MIT), React (MIT), Dexie (Apache-2.0), Tauri (MIT/Apache-2.0), NSIS (zlib), WinSW (MIT). No paid services. |
| No network configuration | mDNS + UDP broadcast discovery, automatic port selection, the installer adds its own firewall rule, and the server makes its own TLS certificate. |
| No Docker needed | The server is one `.exe` with the database engine built in. A Dockerfile exists only as an optional extra. |
| Non-technical installer | Double-click installer. The setup wizard opens in the browser by itself. Pairing is "pick your company from a list". |
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
│  ├─ mDNS advertiser (_stint._tcp) + UDP discovery responder│
│  ├─ Scheduler: nightly backup, update check, sleep guard   │
│  └─ Run as a Windows service by WinSW (auto-start at boot) │
└────────────────────────────────────────────────────────────┘
           ▲ HTTPS (pinned CA)                ▲ HTTPS
           │                                  │
┌──────────┴─────────────┐        ┌───────────┴───────────┐
│ Stint desktop (Tauri)  │        │ Any browser (PWA)     │
│ React UI (bundled)     │        │ Same React UI         │
│ Rust: pinned HTTPS,    │        │ fetch + httpOnly      │
│  discovery, tray timer,│        │  cookie session       │
│  idle detection        │        │                       │
│ IndexedDB local store  │        │ IndexedDB local store │
└────────────────────────┘        └───────────────────────┘
```

### 2.1 Why these choices

* **Bun + TypeScript on the server.** `bun build --compile` turns the server into a single
  executable, and it can **cross-compile** Windows, macOS and Linux builds from one Linux CI
  runner. Bun has built-in SQLite (`bun:sqlite`) and argon2id (`Bun.password`), so there are no
  native add-ons to ship. That was the main risk with Node single-executable apps. Bun also lets
  the server and client share one TypeScript codebase: the Zod schemas and the domain logic
  (rates, rollups, rounding, conflict resolution) are written once in `packages/shared`.
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
* **React + TypeScript + Vite** for the client. The client is **one codebase** for both the
  browser/PWA and the Tauri desktop app. Only the network transport differs (see §6.4).
* **Dexie (IndexedDB)** for local storage. It is mature and has reactive live queries, which
  drive the optimistic UI: the UI reads from IndexedDB, and writes go to IndexedDB first.
  SQLite-WASM would add 1 MB+ and OPFS quirks for no real gain at this data size.
* **Tauri 2** for the desktop app. It is small (it uses the system WebView2), and its Rust side
  gives us a certificate-pinning HTTP client, mDNS, a system tray and OS idle APIs.
* **Biome** for linting and formatting (one fast tool) and `tsc --noEmit` in strict mode for
  type-checking. Tests use **bun test** for the server and shared code, **Vitest** for React
  components, and **Playwright** for end-to-end tests.
* **pdf-lib** for PDFs (pure JS, runs in the browser and on the server). **fflate** plus a small
  writer of our own for XLSX. **PapaParse** for CSV import.

### 2.2 Repository layout

```
apps/
  server/        Bun + Hono API, migrations, discovery, backups, TLS, scheduler
  web/           React client (PWA); also the UI inside the desktop app
  desktop/       Tauri 2 wrapper (src-tauri: Rust)
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
  name, logo, currency (ZAR), default_rate, timezone (Africa/Johannesburg),
  week_start (1 = Monday), date_format (YYYY-MM-DD), workday_hours (8),
  working_days (Mon–Fri), rounding {mode: none|up|down|nearest, minutes},
  approval_period (week|month), members_see_own_rates, reminder settings,
  brand colours for PDFs, backup settings, remote access settings

user            id, email, name, role (admin|manager|member), rate, active,
                password_hash, weekly_capacity_hours, color
client          id, name, code, rate, archived, is_internal (one built-in "Internal" client)
project         id, client_id, parent_id (nullable: nesting to any depth), name, code,
                color, billable_default, rate, budget_hours, budget_amount, archived,
                notes
project_member  project_id, user_id, role (member|manager), rate (per-person override)
task            id, project_id, name, rate, billable (nullable = inherit), archived
tag             id, name, color, archived
time_entry      id, user_id, project_id, task_id?, description, started_at, ended_at?
                (null = running), duration_s (for manual/grid entries), entry_date
                (local YYYY-MM-DD in the org timezone), billable, rate_snapshot,
                currency_snapshot, source (timer|manual|grid|import), tag_ids (JSON)
timesheet       id, user_id, period_start, period_end, status
                (draft|submitted|approved|rejected), submitted_at, decided_by,
                decided_at, comment
favorite        user_id, project_id, task_id?  (per user, synced)
audit_log       id, at, actor_id, action (create|update|delete|approve|reject|unlock|
                submit|rerate|restore|login…), entity, entity_id, before, after, reason
session         token_hash, user_id, created_at, last_seen_at, expires_at, user_agent, ip
sync_seq        single-row counter
schema_migrations  version, name, checksum, applied_at
```

### 3.2 Rate resolution (most specific wins)

`task.rate → project tree, nearest level first → client.rate → user.rate → organization.default_rate`

At each level of the project tree (the entry's project first, then its parent, and so on up to
the top), a **per-person project rate** (`project_member.rate`) is checked first, then that
project's own rate. So a sub-project's rate beats a per-person rate set on its parent. This
extends the brief's `task > project > client > user > organisation` order: consulting firms
often bill one senior engineer at a special rate on one project. The resolved rate is
**snapshotted** onto the time entry when the server accepts it. It is recomputed only when the
entry's project, task or user changes, or when an admin runs the **Re-rate** tool (date range
plus filters, recorded in the audit log). A rate of 0 is a real rate (pro-bono work). Only
`null` means "not set". Implemented in `packages/shared/src/rates.ts` and unit-tested.

### 3.3 Rollups

Projects form a tree through `parent_id`. The total for a project is its own entries plus the
totals of all its descendants. `packages/shared/src/rollup.ts` builds the tree once and sums
bottom-up in O(n). It is unit-tested with deep, wide and archived subtrees. Budgets can be set
on any node and are measured against the rolled-up total. Warnings appear at 80 % (amber) and
100 % (red).

### 3.4 Rounding

Durations are always stored exactly. Rounding (`none`, or `up`/`down`/`nearest` to 1, 5, 6,
10, 15, 30 or 60 minutes) is applied **per entry at report time**. It is also shown next to
each entry, so people see what will be billed.

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
6. **Derived fields.** The server recomputes `rate_snapshot`, `currency_snapshot` and
   `entry_date`, and makes sure only one timer runs per user. If two devices both started a
   timer while offline, the older one is stopped when the newer one starts.
7. Assign a new `server_seq` and write an **audit log** entry, in the same transaction.

The response lists, for each change, `accepted`, `merged` (some fields lost) or
`rejected` (with a reason code and the authoritative row). The client then removes the change
from the outbox. For merged or rejected changes it overwrites its local row with the server's
version. If anything was rejected, it shows a clear notice, for example "The week of 3 March
is approved and locked — your edit was undone."

### 4.4 Pull — `GET /api/sync/pull?since=<seq>&limit=500`

The server returns the rows with `server_seq > since` that the user may see, plus the new
cursor and `hasMore`. Rows are **shaped per role**. For example, for a member the server
removes rates, amounts and other people's entries, unless the organisation allows members to
see their own rates.

If a user's visibility changes (new project assignment, role change), the server increments
`user.sync_epoch`. The client sees the new epoch in the response and does a full pull
(`since=0`), keeping its outbox. Reference data such as projects, clients, tasks and tags is
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
entries, timers, favourites and your own monthly timesheet PDF work offline.

## 5. Security

* **TLS on the LAN.** On first run the server makes a **local certificate authority (CA)**
  (ECDSA P-256, valid 10 years) and a leaf certificate signed by it. The leaf covers
  `localhost`, the PC name, `<pcname>.local` and every current LAN IP address. The leaf is
  re-issued automatically when the IP addresses change, and the CA stays the same. The CA's
  private key is stored in the database, so a backup restored on a new PC keeps existing
  pairings working.
* **Pinning.** During pairing the desktop app stores the SHA-256 hash of the CA's public key
  (SPKI). Its Rust HTTP client accepts only certificate chains that end in that CA, so there
  are no browser warnings and no way to impersonate the server. Browser users can install the
  CA certificate with one click from the server's "Trust this server" page, or accept the
  browser warning once.
* **Loopback HTTP.** On the server PC itself the setup wizard and admin pages open at
  `http://localhost:<port>`. That is served on 127.0.0.1 only, which browsers treat as secure,
  so the person installing never sees a certificate warning.
* **Passwords.** argon2id (`Bun.password`, m=64 MiB, t=2).
* **Sessions.** 256-bit random token. Only its SHA-256 hash is stored. Browsers get it in a
  `Secure; HttpOnly; SameSite=Strict` cookie. The desktop app keeps it in the Rust process and
  sends it as a bearer token, so web content never sees it. Sessions expire after 30 days
  (sliding) and can be revoked.
* **CSRF.** SameSite=Strict, plus a required `X-Stint-Request: 1` header on every request that
  changes data.
* **Login rate limit.** 5 failed attempts per username+IP within 15 minutes locks that pair out
  for 15 minutes, with a general limit per IP as well.
* **Authorisation.** Every route declares what it requires. Policy functions in
  `packages/shared/src/permissions.ts` are unit-tested and **evaluated on the server**. The
  client uses the same functions only to hide buttons.
* **Validation.** Every request body and query is parsed with Zod. Unknown keys are stripped.
* **Audit log.** Every create, update or delete of time entries, timesheets, rates and
  projects, and every approve, reject, unlock, re-rate and restore, is logged with before and
  after snapshots and a reason where one applies.
* **Security headers.** CSP, `X-Content-Type-Options`, `Referrer-Policy`, and
  `frame-ancestors 'none'`.

## 6. Networking, discovery and pairing

### 6.1 Ports

The default is TCP 47600 for HTTPS (LAN) and 47601 for HTTP (loopback, plus a small
"trust/pair" page on the LAN that only redirects). If a port is taken, the server tries the
next ones (47602, 47604, …). The chosen port is saved in `<data folder>/run/runtime.json` and advertised
through discovery, so nobody ever types it.

### 6.2 Discovery

* **mDNS / DNS-SD**. The service is `_stint._tcp.local`. Its TXT records carry `id` (server
  UUID), `org` (company name), `v` (version), `fp` (CA SPKI hash, base64url) and the port.
* **UDP broadcast fallback** on port 47609. The client sends `STINT?`. The server replies with
  the same information as JSON. This works on networks where multicast is filtered but
  broadcast is not (common on cheap routers and some mesh WiFi).
* **Pairing code** as a last resort. A 16-character code such as `K7QM-4XDA-9WFH-3CPN`, in
  Crockford base32 with a checksum, packs the server's IPv4 address, its port, and 32 bits of
  the CA fingerprint. The client connects straight to that address and checks the fingerprint
  prefix before trusting it. It is also shown as a QR code for phones.
* **Rediscovery.** The client remembers the server's `id` and pin. If the saved address stops
  answering (for example, DHCP handed out a new IP), it rediscovers the server by `id` and
  accepts the new address only if the certificate still matches the pin.

### 6.3 Firewall and the Public network trap

The installer adds program-based Windows Firewall rules (TCP and UDP) for `stint-server.exe`
with `profile=private,domain`, never public, under one UAC prompt. Uninstalling removes them.
A rule based on the program rather than the port keeps working if the server has to pick
another port. The server checks the network category (`Get-NetConnectionProfile`) every few
minutes. If the network is **Public**, it shows a clear warning in the wizard and on the Health
page, with a one-click "This is my office network — mark it as Private" button. The service
runs with enough rights to make that change.

### 6.4 Client transport

`apps/web/src/transport/` has two implementations with the same interface:

* **BrowserTransport**: `fetch` against the same origin, using a cookie session.
* **DesktopTransport**: `invoke('api_request', …)` into Rust, which uses reqwest with rustls
  and a custom certificate verifier that checks the pinned CA. The UI files are bundled inside
  the app, so the desktop app starts and works fully offline.

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
* Firewall: two inbound program rules (TCP for HTTPS, UDP for discovery), profile
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
| Works with Stint's pinned certificate | Yes. It is a private network, and the desktop app connects to the server's Tailscale address | Needs `noTLSVerify` to the origin. The public hostname is exposed to the internet (protect it with Cloudflare Access) |
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
| Domain unit | bun test | rate resolution, rollups, rounding, HLC, conflict merge, permissions, pairing code, report builders |
| Server integration | bun test + in-memory SQLite | every API route: auth, RBAC, validation, sync push and pull, locking, audit |
| Components | Vitest + Testing Library | timer, grid, forms, sync status |
| End to end | Playwright | login, start/stop timer, offline edit then sync, submit and approve, monthly PDF |

CI runs lint, type-check and all test suites on every push and pull request. Tagged releases
build the installers.
