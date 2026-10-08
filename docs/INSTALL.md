# Installing Stint

Two parts:

1. **Stint Server**, on **one** computer in the office. It keeps everyone's timesheets.
2. **A web browser** on everyone else's computer, phone or tablet. Nothing to install there.

The server is on the **[releases page](https://github.com/IzakJacobus/Tracker/releases/latest)**.

---

## 1. Install the server (once)

Pick a computer that stays on during working hours and is connected to the office network.

### On Windows

1. Download **`StintServer-Setup-0.3.5.exe`** and run it.
   - If Windows says *"Windows protected your PC"*, click **More info → Run anyway**.
2. Click **Next** until it finishes.
3. A browser window opens. Carry on with step 2 below.

### On Linux (Ubuntu, Debian and others with systemd)

Open a terminal and paste:

```bash
curl -fsSL https://github.com/IzakJacobus/Tracker/releases/latest/download/get-stint.sh | sudo bash
```

When it finishes, open **http://localhost:47601/setup** in a browser on that computer.

> No screen on that computer? The installer prints an `ssh -L …` command. Run it on your own
> computer, then open the same address there.

---

## 2. Set up your company (once, about 2 minutes)

The setup page asks for:

1. your company's name (South African defaults are filled in),
2. **your** name, email and password (you become the administrator),
3. a few clients and projects (you can add more later),
4. the people in your team.

Each person gets a **temporary password**. Give it to them privately.

**Then:** go to **Settings → Backups → Change folder** and pick a USB drive or OneDrive folder, so
your timesheets are safe even if the server computer breaks.

---

## 3. Open Stint on each person's computer

The last setup step, and the server's **Settings → Health** page, show Stint's address, for
example `https://office-pc.local:47600`, plus a QR code for phones.

1. On each computer, open that address in **Chrome, Edge, Firefox or Safari**.
2. The first time, the browser warns that the connection isn't private. That's because Stint makes
   its own certificate. To stop the warning, click **Stint's certificate** on the setup or Health
   page, open the downloaded file and install it as a **trusted root certificate**. Do this once
   per computer.
3. Sign in. To use Stint like an app with its own icon, choose **Install Stint** from the browser
   menu (on phones: **Add to Home Screen**).

---

## Updating

- **Windows server:** download and run the new `StintServer-Setup`. Your data stays.
- **Linux server:** run the same `curl … | sudo bash` command again.
- **Browsers** update themselves: people see an *Update* prompt.

A backup is made automatically before every update.

## Removing

- **Windows:** Settings → Apps → **Stint Server** → Uninstall. You'll be asked whether to keep
  your data.
- **Linux:** run the command below. Leave out `--purge` to keep your data.

  ```bash
  curl -fsSL https://github.com/IzakJacobus/Tracker/releases/latest/download/get-stint.sh | sudo bash -s -- --uninstall --purge
  ```

---

More help: [How to open Stint](OPENING_STINT.md) · [Admin guide](ADMIN_GUIDE.md) ·
[Troubleshooting](../README.md#troubleshooting)
