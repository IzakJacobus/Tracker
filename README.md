# Stint

**Hours tracking for engineering and consulting firms, running on your own office PC.**

Stint is a free, self-hosted time tracker for small engineering and consulting firms. One office
computer runs **Stint Server**. Everyone else opens Stint in their **web browser** (on Windows,
Linux, Mac, phones and tablets) and signs in; nothing needs installing on their computers. You
don't need the cloud, a subscription or an IT department.

![Weekly timesheet grid](docs/screenshots/track-week.png)

| | |
| --- | --- |
| ![Reports overview](docs/screenshots/reports-overview.png) | ![Monthly timesheet](docs/screenshots/reports-monthly.png) |
| ![Projects tree](docs/screenshots/projects.png) | ![Health page](docs/screenshots/health.png) |
| ![Dark mode](docs/screenshots/track-dark.png) | ![Command palette](docs/screenshots/command-palette.png) |

<p align="center"><img src="docs/screenshots/phone.png" alt="Stint on a phone" width="260"></p>

## What it does

**Logging hours**
- **Log hours** (or press <kbd>N</kbd>): choose the project, drill down to the item you worked on,
  type the hours (`1.5`, `1:30`, `90m`) and an optional note.
- A spreadsheet-style **weekly grid** to fill in a whole week, plus duplicate and "log more".
- Favourites and recent items. A command palette (<kbd>Ctrl</kbd>+<kbd>K</kbd>) and keyboard
  shortcuts for everything (<kbd>?</kbd> lists them).
- **Works offline.** Everything is saved on your own computer first and syncs when the server
  is reachable. A status pill shows *Synced*, *Pending* or *Offline*.
- Reminds you about days with missing time.

**Organising work**
- Clients, plus a built-in *Internal* client for admin, training, business development and
  leave.
- Projects broken down into **items**, nested as deep as you like (*Bridge upgrade › Detailed
  design › WP1*), each with a type your firm chooses (Phase, Task, Work package…). Totals roll up,
  and a drag-and-drop tree editor keeps it tidy.
- Mark items **done** when finished: they can't take new hours but stay in reports.
- Tags. Budgets in hours, with warnings at 80 % and 100 %.

**Timesheets and approvals**
- Admin, Manager and Member roles, enforced on the server.
- People submit their week or month. Managers approve or send it back with a comment.
  Approved periods are locked. An admin can unlock one, with a reason that is kept in the
  audit log.
- An audit log of every change to time data.

**Reports and exports**
- Company dashboard, monthly timesheet per person, project timesheet (whole sub-tree) and
  client summary for invoicing.
- Export to **PDF** (with your logo and a signature line), **Excel** and **CSV**.

**Looking after itself**
- Nightly backups to a USB drive or OneDrive folder (the last 30 are kept), and one-click
  restore.
- A **Health** page in plain language, with one-click fixes.
- Update notices from GitHub Releases. Excel export and import (projects, items and hours), plus CSV import, including **Toggl Track** exports.

South African defaults: Africa/Johannesburg, YYYY-MM-DD dates and weeks that start on
Monday. All of these can be changed in Settings.

## Quick start (no technical knowledge needed)

The one-page version is **[docs/INSTALL.md](docs/INSTALL.md)**.

### 1. Install the server on one office PC

Pick a PC that stays on during working hours (Windows 10 or 11, 64-bit).

1. Download **`StintServer-Setup-x.y.z.exe`** from the
   [latest release](https://github.com/IzakJacobus/Tracker/releases/latest) and run it.
   Windows may warn that the app is from an unknown publisher. Click **More info → Run anyway**.
2. Click **Next** until it finishes. The installer:
   - installs Stint Server as a Windows service that starts with the PC,
   - lets Stint through Windows Firewall on **Private** and **Domain** networks (never on Public
     ones), and
   - stops the PC from going to sleep while Stint runs (the screen can still switch off).
3. A browser opens with the **setup wizard**. Enter your firm's name, create your admin account,
   add your first clients and projects, and invite your team.

You can get back to it any time from the Start menu: **Stint Server**.

### 2. Open Stint in a browser on everyone else's computer

Nothing to install: Windows, Linux and Mac computers, phones and tablets all use a web browser
(Chrome, Edge, Firefox or Safari).

1. Open the address shown at the end of setup and on the server's **Health** page, for example
   `https://office-pc.local:47600` (or `https://192.168.1.20:47600`; phones can scan the QR code).
2. The first time, the browser warns that the connection isn't private, because Stint makes its
   own certificate. To stop the warning for good, install Stint's certificate once per computer
   (see [Troubleshooting](#troubleshooting)).
3. Sign in. To use Stint like an app, choose **Install Stint** (Chrome, Edge) or **Add to Home
   Screen** (phones) from the browser menu. It keeps working offline, as below.

### Running the server on Linux instead

Any 64-bit Linux with systemd works (x64 or arm64, so a Raspberry Pi 4/5 is fine). One command
downloads the latest release, checks it against the release's checksums and installs it:

```bash
curl -fsSL https://github.com/IzakJacobus/Tracker/releases/latest/download/get-stint.sh | sudo bash
```

Or do the same by hand: download `stint-server-x.y.z-linux-x64.tar.gz` (or `-linux-arm64`) from
the release, then run `tar xzf stint-server-*-linux-*.tar.gz && cd stint-server-*/ && sudo ./install.sh`.

The script creates a `stint` service account, installs the `stint-server` service (it starts
at boot), keeps the computer from sleeping, and, if ufw or firewalld is on, opens Stint's ports
to private networks only. It then prints the setup address. Setup only opens on the server
itself, so on a server without a screen it also prints the `ssh -L …` command that lets you
finish setup from your own computer's browser.

Run the same command again to upgrade.
`sudo ./install.sh --uninstall` removes Stint but keeps the data in `/var/lib/stint`; add
`--purge` to delete that too. Logs: `journalctl -u stint-server`.

## Backups and restore

Stint backs up every night at 02:00. If the PC was off then, it backs up as soon as it starts.

- **Choose where backups go:** Settings → **Backups** → *Change folder*. Pick a USB drive or a
  OneDrive folder, so that a failed disk in the server PC can't take the backups with it. Stint
  makes a test backup there before it switches.
- **Back up now** makes a backup straight away. The last 30 are kept (you can change this).
- **Restore:** Settings → Backups → *Restore* next to the backup you want. Stint first saves a
  safety copy of the current data, so a restore can itself be undone. Everyone's browser then
  reloads its data.
- A backup is also made automatically before every upgrade.

**Moving to a new server PC:** install Stint Server on the new PC, copy a backup file across,
put it in the new PC's backup folder (`C:\ProgramData\Stint\backups`, which needs
administrator rights) and restore it. Browsers that trusted the old server's certificate keep
trusting it, because the certificate is stored inside the backup. Stint restarts itself to load it.
If the new PC has a different name, share its address from the Health page.

## Upgrading

- Admins see **"Stint x.y is available"** in the sidebar and on the Health page.
- **Server:** download the new `StintServer-Setup` and run it on the server PC. It stops the
  service, replaces the program, backs up the database and starts again. Your data stays where
  it is.
- **Browsers** pick up the new version by themselves; people see an *Update* prompt and keep any
  time that hasn't synced yet.

## Working from home (optional)

Stint works on the office network with no extra setup. To reach it from home or from site, we
recommend **[Tailscale](https://tailscale.com)**: a private network between your own devices,
with nothing exposed to the internet. Its free plan covers up to 6 users. Step-by-step guide:
[docs/REMOTE_ACCESS.md](docs/REMOTE_ACCESS.md), or Settings → **Remote access**.

## Troubleshooting

| Problem | What to do |
| --- | --- |
| The Stint address doesn't open | Check that the server PC is on, and that both computers are on the same office network. If the `.local` address doesn't work, use the IP address shown on the server's **Health** page. |
| Health says the network is **Public** | Windows blocks other PCs on Public networks. On the Health page click **Mark as Private** (only if this really is your office network), or use Windows Settings → Network → *Private*. |
| Health says the **firewall rule is missing** | Run the Stint Server installer again; it repairs the rule. |
| The browser says the connection isn't private | Stint uses its own certificate. Download `http://<server-pc>:47601/stint-ca.crt` (or use the link on the setup and Health pages) and install it as a *Trusted Root Certification Authority* to stop the warning. |
| "Sync pending" never clears | You're probably offline or the server PC is asleep or off. Your entries are safe on your PC and upload when the server is back. |
| "That period is submitted or approved" | Approved timesheets are locked. Ask your manager to send it back, or an admin to unlock it. |
| A backup failed | Health shows why. Usually the USB drive is unplugged or full. Plug it in and click **Back up now**. |
| Port 47600 is in use | Stint moves to the next free port by itself (47602, 47604, …). The **Health** page shows the address to use; free port 47600 again to keep the old address working. |
| Something else | Logs are in `C:\ProgramData\Stint\logs` on the server PC. Please [open an issue](https://github.com/IzakJacobus/Tracker/issues) and include them. |

## Documentation

- [Install guide](docs/INSTALL.md): the short version, for whoever sets Stint up
- [How to open Stint](docs/OPENING_STINT.md): opening it in a browser, installing it as an app, working offline (for staff)
- [User guide](docs/USER_GUIDE.md): for everyone who tracks time
- [Admin guide](docs/ADMIN_GUIDE.md): setting up the firm, people, approvals, backups
- [Remote access](docs/REMOTE_ACCESS.md): Tailscale (recommended) or Cloudflare Tunnel
- [Architecture](docs/ARCHITECTURE.md): how it works, sync, security and networking
- [Install test](docs/INSTALL_TEST.md): clean-Windows install checklist and results
- [Releasing](docs/RELEASING.md): how a release is built
- [Changelog](CHANGELOG.md), [Roadmap](docs/ROADMAP.md), [Progress](docs/PROGRESS.md)

## For developers

You need [Bun](https://bun.sh) 1.4.2 or later.

```bash
bun install
bun run check                       # lint, type-check, unit and integration tests
bun run test:e2e                    # Playwright end-to-end tests (builds the web client)

# A demo firm (Karoo Consulting Engineers, 5 people, 3 months of time):
bun run seed -- --reset             # into apps/server/data; password: stint demo 2026
bun run --filter @stint/web build
STINT_DATA_DIR=./apps/server/data STINT_WEB_DIR=./apps/web/dist bun apps/server/src/main.ts
# → http://localhost:47601  (sign in as thandi@karoo.co.za)

bun apps/server/scripts/build.ts --target windows-x64   # single-file server executable
```

Configuration: `<data folder>/stint.config.json` or `STINT_*` environment variables. See
[apps/server/stint.config.example.json](apps/server/stint.config.example.json). No secrets live
in the repository: keys and certificates are generated on first start.

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

[MIT](LICENSE)
