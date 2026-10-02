# Installing Stint

Two parts:

1. **Stint Server**, on **one** computer in the office. It keeps everyone's timesheets.
2. **The Stint app**, on everyone's computer. Or they can use a web browser instead.

Everything is on the **[releases page](https://github.com/IzakJacobus/Tracker/releases/latest)**.

---

## 1. Install the server (once)

Pick a computer that stays on during working hours and is connected to the office network.

### On Windows

1. Download **`StintServer-Setup-0.1.0.exe`** and run it.
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

## 3. Install the app on each person's computer

Download the app for their computer from the same releases page:

| Computer | File | How |
| --- | --- | --- |
| Windows | `Stint_0.1.0_x64-setup.exe` | Run it. No administrator rights needed. |
| Mac (Apple silicon) | `Stint_0.1.0_aarch64.dmg` | Open it and drag Stint to Applications. If the Mac refuses to open it the first time: **System Settings → Privacy & Security → Open Anyway**. |
| Ubuntu / Debian | `Stint_0.1.0_amd64.deb` | `sudo apt install ./Stint_0.1.0_amd64.deb` |
| Other Linux | `Stint_0.1.0_amd64.AppImage` | Make it executable and double-click it. |

Then open **Stint**. It **finds the office server by itself**. Click your company and sign in.
If it isn't listed, use the **pairing code** from the server's **Settings → Health** page.

**Phones and tablets:** open `https://<server-computer-name>.local:47600` in the browser, sign in,
and choose **Add to Home Screen**.

---

## Updating

- **Windows server:** download and run the new `StintServer-Setup`. Your data stays.
- **Linux server:** run the same `curl … | sudo bash` command again.
- **Apps:** install the new version over the old one.

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
