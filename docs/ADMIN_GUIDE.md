# Stint admin guide

For the person who looks after Stint at your firm: setting it up, adding people and projects,
approvals, backups and keeping the server healthy. No programming needed.

## 1. Choosing the server PC

Stint Server runs on one Windows or Linux computer in the office. Choose one that:

- stays switched on during working hours (Stint stops it from sleeping while it runs),
- has a wired network connection if possible, and
- has somewhere to put backups: a USB drive or OneDrive.

It doesn't need to be powerful: Stint is a single small program with a single database file,
and staff can keep using the PC as normal.

On Windows, install it by running `StintServer-Setup-x.y.z.exe` as an administrator (see the
README's quick start). The setup wizard opens when it finishes.

On Linux, unpack the release's `stint-server-…-linux-x64.tar.gz` (or `-arm64`) and run
`sudo ./install.sh`. Paths differ from the rest of this guide:

| | Windows | Linux |
| --- | --- | --- |
| Data, backups, logs | `C:\ProgramData\Stint` | `/var/lib/stint` (owned by the `stint` account) |
| Service | *Stint Server* in Services | `systemctl status stint-server`, `journalctl -u stint-server` |
| Firewall | rules added by the installer | ufw or firewalld rules for private networks, added by `install.sh` |
| Config file | `C:\ProgramData\Stint\stint.config.json` | `/var/lib/stint/stint.config.json` |

A backup folder on Linux must be writable by the `stint` account. For a USB drive, for example:
`sudo mkdir /media/usb/stint-backups && sudo chown stint: /media/usb/stint-backups`. The
Health page's Public-network and firewall checks are Windows-only.

## 2. The setup wizard

The wizard only runs on the server PC itself, so nobody else on the network can claim a new
server.

1. **Company**: name, currency, time zone, date format and the day weeks start on. South
   African defaults are filled in.
2. **Your admin account**: your name, email and a password of at least 10 characters.
3. **Clients and projects**: add a few to start with. The *Internal* client already has
   Administration, Business development, Training, Research & development and Leave.
4. **Team**: add the people who'll track time (you can do this later too).
5. **Open Stint on other computers**: shows Stint's address (and a QR code for phones) to share
   with your team, and a link to Stint's certificate.

## 3. People and roles

**Team → Add person.** Enter their name, email, role, line manager and (optionally) an hourly
rate. Stint creates a temporary password for you to pass on, and asks them to change it the
first time they sign in.

| Role | Can |
| --- | --- |
| **Member** | Track their own time, see their own reports, and submit timesheets. They see rates and amounts only if *Members see their own rates* is on. |
| **Manager** | Everything a member can. They also see the time of people they line-manage, approve or send back those people's timesheets, and manage projects where they are a project manager (tasks, members and sub-projects). |
| **Admin** | Everything: people, clients, all projects, settings, backups, unlocking timesheets, re-rating, import and the audit log. |

Every rule is enforced by the server, not only hidden in the screens.

- **Forgotten password:** Team → the person → *Reset password*. This gives them a new
  temporary password and signs them out everywhere.
- **Someone leaves:** set them to *inactive*. Their time stays in reports, but they can't sign
  in. Stint won't let you deactivate the last admin.
- **Line manager:** the person who approves their timesheets. Changing it updates what the old
  and new managers see.

## 4. Clients, projects, tasks

- **Clients** have an optional default rate. The built-in *Internal* client can't be archived.
- **Projects** can be nested as deep as you like: *Paarl bridge upgrade › Detailed design ›
  WP1 Structural*. Drag a project in the tree to move it, or use *Move to…* from the keyboard.
  Totals and budgets roll up through the tree.
- **Visibility:** a project is either for its *members* (the default for client work) or for
  *everyone* (the default for internal work). Membership carries down to sub-projects: someone
  added to *Paarl bridge upgrade* can track on all of its sub-projects. A manager can also see
  the projects their team works on, but can't track on them.
- **Project managers** (a role on one project) can add tasks, sub-projects and members to that
  project.
- **Tasks** sit under a project (for example *Site visit* or *Drawings & modelling*) and can
  have their own rate and billable setting.
- **Budgets:** hours and/or an amount per project. The project page and the reports warn at
  80 % and 100 %.
- **Archive** projects and clients that are finished. They disappear from the pickers but stay
  in reports.

### Rates

When someone saves an entry, Stint picks the most specific rate that applies:

1. the task's rate,
2. the person's rate on that project (set on the project's *People* tab),
3. the project's rate (or the nearest parent project's rate),
4. the client's rate,
5. the person's own rate,
6. the firm's default rate (Settings → Organisation).

That rate is **frozen on the entry**. Changing a rate later doesn't change past entries, so
invoices you already sent stay correct. If you do want past entries repriced (a new rate was
agreed from the start of the month, for example), use **Settings → Re-rate**. It shows a preview of
the old and new amounts first, skips submitted and approved periods unless you tick the box,
and records what it did in the audit log.

### Rounding

Settings → Organisation → *Rounding* rounds each entry's duration for billing (for example up
to the next 15 minutes). Reports and exports show both the recorded hours and the *Billed*
(rounded) hours. The time people recorded is never changed.

## 5. Timesheets and approvals

Settings → Organisation → *Approval period* sets **week** or **month** (month is the
default).

- People submit from the card at the top of **Track**.
- Managers and admins see what's waiting under **Approvals** (the number in the menu). Open a
  timesheet to check the time, then **Approve** it or **Send back** with a comment.
- Submitted and approved periods are **locked**: nobody can change their entries, from any
  device, online or offline. Locked periods always win over offline edits.
- **Unlock** (admins only): open the timesheet, click *Unlock* and give a reason. The reason is
  stored in the audit log, and the person can edit and submit again.
- **Reports → Overview** lists people who haven't submitted.

## 6. Settings → Health

Health is the first place to look if something seems wrong. Each line is green, amber or red,
with a button to fix it where possible:

- **Database** is healthy, with its size.
- **Backups**: when the last one ran and whether it worked. Includes **Back up now**.
- **Backup location**: warns while backups are only on the server PC itself.
- **Disk space** on the server PC.
- **Network**: the addresses Stint can be reached on. It warns when Windows treats the network
  as **Public**, which blocks other PCs. **Mark as Private** fixes this, but only use it on your
  office network.
- **Firewall**: whether the installer's firewall rules are still there.
- **Sleep prevention**: whether Stint is keeping the PC awake.
- **Remote access**: Tailscale's status, if you turned remote access on.
- **Certificate**: when the server's certificate expires. Stint renews it by itself when the
  server restarts.
- **Updates**: whether a newer Stint is out.

The page also shows **Stint's address** to share with people, and who is connected right now.

## 7. Backups

Settings → **Backups**:

- **Where backups go.** By default they go to `C:\ProgramData\Stint\backups`, on the server
  PC itself. **Change folder** lets you pick a USB drive or a OneDrive folder from your browser.
  Stint writes a test backup there before it switches.
- **When.** Every night at the time you choose (02:00 by default). If the PC was off at that
  time, Stint backs up as soon as it's running again.
- **How many.** The last 30 are kept, and older ones are deleted. A backup is also made
  automatically before every upgrade. Those copies are kept separately.
- **Restore.** Click *Restore* next to a backup and confirm. Stint checks the file, saves a
  safety copy of the current data (listed under *Safety copies*, so a restore can itself be
  undone), switches over, and tells every app to reload its data. Changes made after that
  backup are lost.

Each backup is a single SQLite file, `stint-YYYY-MM-DD-HHmm.db`, holding everything: people,
projects, time, settings and the server's certificate.

**Test a restore** once in a while. It takes a minute, and you'll know it works when you need
it.

## 8. Importing from Toggl Track (or a spreadsheet)

1. In Toggl Track open **Reports → Detailed**, choose the date range and **Export → CSV**.
2. In Stint open **Settings → Import** and choose the file.
3. Click **Preview**. Nothing is saved yet. The preview shows how many entries will be
   imported, what will be created (clients, projects, tasks, tags) and any problems, line by
   line.
4. If people in the file don't match anyone in Stint by email or name, choose who they are
   from the list, or add them on the Team page first.
5. Click **Import**.

Importing the same file again doesn't create duplicates. Entries in submitted or approved
periods are skipped. Stint also reads its own CSV exports, and any CSV with **Date**,
**Person** (or **Email**), **Project** and **Duration** (or **Hours**) columns. Dates may be
`2026-09-30` or `30/09/2026` (day first).

## 9. Upgrading

1. Admins see "Stint x.y is available" in the menu and on the Health page.
2. Download the new `StintServer-Setup` from the release page and run it on the server PC.
3. The installer stops the service, replaces the program and starts it again. The database is
   backed up automatically before it is upgraded.
4. People's browsers pick up the new version by themselves (they see an *Update* prompt).

To go back to an older version, install it and restore the backup made before the upgrade
(Settings → Backups → *Safety copies*).

## 10. Moving Stint to another PC

1. On the old server, Settings → Backups → **Back up now**, and copy the newest backup file to a
   USB drive.
2. Install Stint Server on the new PC. In the setup wizard you can create a temporary firm,
   because the restore replaces it.
3. Copy the backup into `C:\ProgramData\Stint\backups` on the new PC (Windows asks for
   administrator permission), then open Settings → Backups and **Restore** it.
4. Uninstall Stint Server from the old PC.

Browsers keep trusting the certificate, because it moved with the backup. If the new PC has a
different name, share its address from the Health page (people need to sign in again there).

## 11. Security notes

- Passwords are stored with argon2id. Sessions are random tokens, and only their hashes are
  stored.
- Sign-in is rate-limited: 5 attempts per account and address, then a 15-minute pause.
- All traffic between browsers and the server is encrypted (HTTPS). Once Stint's certificate is
  installed on a computer, its browser trusts only certificates your server issued.
- The data folder (`C:\ProgramData\Stint`) is readable only by administrators and the Stint
  service.
- The firewall rules only allow Private and Domain networks, never Public ones such as café
  Wi-Fi.
- Setup only works on the server PC. The plain-HTTP admin address (`http://localhost:47601`)
  only works on the server PC too. From other PCs, plain HTTP only redirects to HTTPS.
- Every change to time data, timesheet decision, unlock, re-rate, import, restore and settings
  change is in **Settings → Audit log**.
- The only thing Stint sends to the internet is the once-a-day update check (just the version
  question, to GitHub). You can turn it off with `"updateCheck": false` in the configuration
  file.

## 12. Configuration file (advanced)

Most settings are in Stint's Settings page. A few start-up options live in
`C:\ProgramData\Stint\stint.config.json` (create it if needed, then restart the *Stint Server*
service):

```json
{
  "port": 47600,
  "httpPort": 47601,
  "sleepGuard": true,
  "updateCheck": true,
  "logLevel": "info"
}
```

Environment variables (`STINT_PORT`, `STINT_DATA_DIR`,
`STINT_DISABLE_SLEEP_GUARD`, `STINT_DISABLE_UPDATE_CHECK`, `STINT_LOG_LEVEL`) override the file.
Logs are in `C:\ProgramData\Stint\logs`.
