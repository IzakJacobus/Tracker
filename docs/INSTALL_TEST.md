# Install test: clean Windows machine

The brief requires the full install flow to be tested on a clean Windows machine. This page
holds the procedure and the results.

## Status

**Not yet run on Windows.** Stint was built in a Linux container with no Windows machine or VM,
so the Windows-only parts below have been compiled and reviewed but not run. Before the first
release, someone needs to work through the checklist on a clean Windows 10 or 11 VM and record
the results in the table at the end.

### What was verified, and how

| Area | Verified | How |
| --- | --- | --- |
| Server executable | ✅ builds for Windows x64, Linux x64/arm64 and macOS | `bun apps/server/scripts/build.ts --target …`. The `.exe` is a valid PE32+ x86-64 file |
| Single-file server runs with the web client embedded | ✅ Linux | `installer/smoke-test.sh` (CI job *Package*): serves the UI, HTTPS API, setup, backup, health, runtime file |
| Windows installer compiles | ✅ | `makensis` 3.09 on Linux (CI job *Package*). Output about 34 MB |
| Installer runs, service registers and starts | ❌ needs Windows | NSIS + WinSW 2.12.0 (checksum pinned) |
| Firewall rules (Private/Domain only), removed on uninstall | ❌ needs Windows | `netsh advfirewall` in `installer/windows/server.nsi` |
| Data folder permissions | ❌ needs Windows | `icacls` in the installer |
| Sleep prevention | ✅ logic on Linux (`systemd-inhibit`); ❌ Windows `SetThreadExecutionState` call | `apps/server/src/platform/sleep.ts` |
| Public-network warning and "Mark as Private" | ✅ UI and API, with simulated Windows data (tests); ❌ real PowerShell output | `apps/server/src/platform/network.ts` |
| Setup wizard, sign-in, tracking, sync, approvals, PDF | ✅ | 12 Playwright end-to-end tests in Chromium, on every push |
| Backups, restore, import, health | ✅ | Server integration tests, plus manual runs against a live server |
| Linux install script: service, ufw rules (private networks only), data permissions, sleep inhibitor, upgrade, uninstall, purge | ✅ (via CI) | CI job *Linux install script* runs `installer/linux/install.sh` on a real Ubuntu runner with systemd and ufw |
| Linux desktop idle detection | ✅ X11; ❌ GNOME (Mutter D-Bus) not run | `cargo run --example idle` under Xvfb: counts up, resets on input |
| LAN discovery (mDNS + UDP broadcast) and pairing | ✅ Linux | Desktop app under Xvfb found the server, paired, signed in and synced (`docs/screenshots/desktop-*.png`) |
| Desktop app on Windows (tray, idle detection, NSIS bundle) | ❌ needs Windows | Built by the release workflow on `windows-latest` |
| Update notice | ✅ | Tests with a mocked GitHub Releases response |

## Test machine

- A fresh Windows 11 (or 10 22H2) x64 VM, not joined to a domain, with all updates installed.
- A second VM or PC on the same network, for the client.
- Network set to **Private** on both, except in test 4.
- Release artifacts: `StintServer-Setup-x.y.z.exe` and `Stint_x.y.z_x64-setup.exe` (from the
  draft release or from CI).

## Checklist

Record each result as ✅, ❌ (with what happened) or ⚠️ (works, but with a rough edge).

### 1. Server install

| # | Step | Expected |
| --- | --- | --- |
| 1.1 | Run `StintServer-Setup` as a normal user | Windows asks for administrator permission (UAC). SmartScreen may warn about an unknown publisher; *More info → Run anyway* |
| 1.2 | Click through the wizard | Welcome, licence, folder and progress pages, then Finish with "Open Stint to finish setting up" ticked |
| 1.3 | Finish | Within about 10 s a browser opens `http://localhost:47601/setup` |
| 1.4 | `services.msc` | **Stint Server** is *Running*, *Automatic (Delayed Start)* |
| 1.5 | `wf.msc` → Inbound Rules | **Stint Server (TCP)** and **Stint Server (UDP discovery)**, profile *Private, Domain*, program `C:\Program Files\Stint Server\stint-server.exe` |
| 1.6 | `icacls C:\ProgramData\Stint` | Only SYSTEM and Administrators. `run\` is also readable by Users |
| 1.7 | Start menu | A **Stint Server** shortcut, which opens the admin page (a console window may flash, minimised) |
| 1.8 | `powercfg /requests` | `stint-server.exe` is listed under SYSTEM |

### 2. Setup and first use

| # | Step | Expected |
| --- | --- | --- |
| 2.1 | Complete the setup wizard (firm, admin, one client and project, one team member) | It reaches the *Connect* step, with a pairing code and a QR code |
| 2.2 | Settings → Health | Everything is green, apart from *Backups: no backup yet* and *Backup location* (amber). Network shows the VM's IP. Firewall is green |
| 2.3 | Settings → Backups → Back up now | A backup appears in the list, and `C:\ProgramData\Stint\backups\stint-…-manual.db` exists |
| 2.4 | Change folder → pick a USB drive or a folder on another drive | A test backup is written there, and the folder is saved |

### 3. Client install (second machine)

| # | Step | Expected |
| --- | --- | --- |
| 3.1 | Run `Stint_x.y.z_x64-setup.exe` as a normal user | Installs without admin rights. Stint opens |
| 3.2 | Pairing screen | The firm appears within about 3 s (found via mDNS or broadcast) |
| 3.3 | Click it, then sign in as the team member | The forced password change screen, then Track with *Synced* |
| 3.4 | Start the timer, wait, stop it | The entry appears. It also appears on the server's Reports page |
| 3.5 | Tray icon → Start/Stop | The timer toggles, and the tooltip shows the running time |
| 3.6 | Close the window | Stint keeps running in the tray |
| 3.7 | Leave the timer running, don't touch the PC for 11 minutes | The "You were away" dialog appears, with Keep, Discard and continue, and Discard and stop |
| 3.8 | Restart the client PC | Stint starts at sign-in (if enabled) and is still paired |
| 3.9 | Uninstall and reinstall the client, then pair with the code from Health | Pairing by code works |

### 4. Network edge cases

| # | Step | Expected |
| --- | --- | --- |
| 4.1 | Set the server's network to **Public** (Settings → Network) and wait up to 5 minutes, or click *Check again* | Health warns "Windows treats the network … as Public" and offers **Mark as Private** |
| 4.2 | While Public, try from the client | The client can't connect (firewall), and shows *Offline*. Entries made now stay *Pending* |
| 4.3 | Click **Mark as Private** | The network becomes Private, the warning clears, and the client syncs its pending entries |
| 4.4 | Change the server's IP (new DHCP lease or static IP) and restart the client | The client finds the server again by itself |
| 4.5 | Occupy port 47600 before the service starts (e.g. `python -m http.server 47600`), then restart the service | Stint uses 47602. Health shows it. The client finds it again |

### 5. Backup, restore, upgrade, uninstall

| # | Step | Expected |
| --- | --- | --- |
| 5.1 | Add an entry, then restore the backup from 2.3 | The entry is gone. A safety copy is listed. The client reloads its data |
| 5.2 | Restore the safety copy | The entry is back |
| 5.3 | Install a newer `StintServer-Setup` over the top | The service stops and starts. Data is intact. If the schema changed, a `…-pre-migration.db` backup exists |
| 5.4 | Reboot the server | The service starts by itself. The client reconnects |
| 5.5 | Uninstall Stint Server and answer **No** to "delete data" | Service, firewall rules, shortcut and Program Files folder are removed. `C:\ProgramData\Stint` remains |
| 5.6 | Reinstall | It picks up the existing data. No setup wizard, and the admin page opens |
| 5.7 | Uninstall and answer **Yes** | `C:\ProgramData\Stint` is removed |

## Results

| Date | Windows build | Tester | Stint version | Result | Notes |
| --- | --- | --- | --- | --- | --- |
| — | — | — | — | not run yet | No Windows machine was available while building. See *Status* |
