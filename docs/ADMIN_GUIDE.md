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

1. **Company**: name, time zone, date format and the day weeks start on. South African
   defaults are filled in.
2. **Your admin account**: your name, email and a password of at least 10 characters.
3. **Clients and projects**: add a few to start with. The *Internal* client already has
   Administration, Business development, Training, Research & development and Leave.
4. **Team**: add the people who'll track time (you can do this later too).
5. **Open Stint on other computers**: shows Stint's address (and a QR code for phones) to share
   with your team, and a link to Stint's certificate.

## 3. People and roles

**Team → Add person.** Enter their name, email, role, line manager and expected hours per
week. Stint creates a temporary password for you to pass on, and asks them to change it the
first time they sign in.

| Role | Can |
| --- | --- |
| **Member** | Track their own time, see their own reports, and submit timesheets. |
| **Manager** | Everything a member can. They also see the time of people they line-manage, approve or send back those people's timesheets, and manage projects where they are a project manager (items and members). |
| **Admin** | Everything: people, clients, all projects, settings, backups, unlocking timesheets, import and the audit log. |

Every rule is enforced by the server, not only hidden in the screens.

- **Forgotten password:** Team → the person → *Reset password*. This gives them a new
  temporary password and signs them out everywhere.
- **Someone leaves:** set them to *inactive*. Their time stays in reports, but they can't sign
  in. Stint won't let you deactivate the last admin.
- **Line manager:** the person who approves their timesheets. Changing it updates what the old
  and new managers see.

## 4. Clients, projects and items

- **Clients** are the companies you do work for. The built-in *Internal* client (admin, training,
  leave…) can't be archived.
- **Projects** belong to a client and each has a **code**: your own reference, in any numbering
  you like (`2026-014`, `BRG/07`…), unique for that client. The New project form suggests the
  next code in the client's pattern. Items under a project may have a code too.
- Under a project you add **items**, and items under items, as
  deep as you need: *Paarl bridge upgrade › Detailed design › WP1 Structural › Pier design*. Give
  each item a **type** your firm uses (Phase, Task, Work package, …). It's only a name, so every
  firm can organise its work its own way; types you've used are suggested next time.
- **Hours go on the lowest level.** An item with items under it can't take hours itself, so
  people drill down to what they actually worked on. A project with no items takes hours
  directly. Totals and budgets roll up through the tree.
- **Drag** an item in the tree to move it, or use *Move to…* from the keyboard. Everything under
  it, and its hours, move with it.
- **Visibility:** a project is either for its *members* (the default for client work) or for
  *everyone* (the default for internal work). Membership carries down to every item: someone
  added to *Paarl bridge upgrade* can log hours on all of its items. A manager can also see the
  projects their team works on, but can't log hours on them.
- **Project managers** (a role on one project) can add items and members to that project.
- **Mark items done** when their work is finished (the item's ⋯ menu, or the *Items* tab). A done
  item and everything under it disappear from the pickers but stay in reports; *Reopen* brings it
  back. Finished projects and clients are **archived** the same way.
- **Budgets:** hours on any project or item. The Projects page and the reports
  warn at 80 % and 100 %.

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

## 8. Excel and CSV: export and import

Open **Settings → Import / Export**.

### Export to Excel
**Download Excel workbook** saves one file with two sheets:

- **Projects**: every project and item. Columns: Client, Project code, Path (the names from the
  project down, separated by ›), Type, Item code, Done, Budget hours.
- **Hours**: every entry. Columns: Date, Person, Email, Client, Project code, Project (the full
  path), Hours, Note, Tags. Choose "Hours from / to" first to export only a period.

### Import from Excel
Fill in the **empty template** (**Download empty template**, which has an example and a "How to
use" sheet), or edit an exported workbook, then:

1. Choose the file and click **Preview**. Nothing is saved yet. The preview shows how many
   entries will be imported, which projects and items will be created or changed, and any
   problems, line by line.
2. If people in the file don't match anyone in Stint by email or name, choose who they are
   from the list, or add them on the Team page first.
3. Click **Import**.

How rows are matched: a project is found by its **code** within the client, then by name; items
by their names under it. Missing clients, projects and items are created (a new project without
a code gets the next one in that client's numbering). The Type, Done and Budget hours columns
update existing items: put **Yes** under Done to finish an item, **No** to reopen it, and leave
it empty to keep it as it is. Hours can be `1.5`, `1:30` or an Excel time. Dates can be real Excel
dates, `2026-09-30` or `30/09/2026` (day first).

Importing the same workbook again doesn't create duplicates, and entries in submitted or
approved periods are skipped.

### Moving from Toggl Track (or another CSV)
1. In Toggl Track open **Reports → Detailed**, choose the date range and **Export → CSV**.
2. Choose that file on the same page and follow the same preview steps.

Stint also reads any CSV with **Date**, **Person** (or **Email**), **Project** and **Duration**
(or **Hours**) columns.

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
- Every change to time data, timesheet decision, unlock, import, restore and settings
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
