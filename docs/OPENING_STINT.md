# How to open Stint

You can use Stint in two ways: as the **Stint app** on your computer, or **in a web browser**.
Both show the same timesheets. This page explains how to open each one, and how to keep working
when you're not connected.

---

## Which one should I use?

| | **Stint app** | **Web browser** |
| --- | --- | --- |
| Good for | Your own laptop or desktop | A phone, tablet, Mac, or someone else's computer |
| Works without Wi-Fi | ✅ Yes | ✅ Yes, if you open it the same way every time (see below) |
| Lives in the corner of the screen (by the clock) | ✅ Yes | ❌ No |
| Asks about time when you were away from your desk | ✅ Yes | ❌ No |
| Safe if someone clears the browser history | ✅ Yes | ❌ No, unsent time is lost |

**In short:** use the **Stint app** on your own computer. Use the **browser** on a phone or tablet,
or when you can't install anything.

---

## The Stint app

### The first time (you need to be in the office for this)

1. Get the installer from your Stint administrator: `Stint_…_x64-setup.exe` on Windows, `.dmg` on
   a Mac, or `.deb` on Ubuntu.
2. Run it. If Windows warns about an unknown publisher, click **More info → Run anyway**.
3. Open **Stint**. Your company's name appears in a list. Click it.
   - Not in the list? Click **I have a pairing code** and type the code your administrator gives
     you.
4. Sign in with your email and the password from your administrator, then choose your own
   password.

### Every day after that

- Click **Stint** in the Start menu (Windows), Launchpad (Mac) or the app list (Ubuntu).
- **Closing the window doesn't quit Stint.** It keeps running as a small icon by the clock, and
  the timer keeps going. Click the icon to bring the window back. Right-click it to start or stop
  the timer, or to quit.

**Tip: let Stint start by itself.** Click your name at the bottom of the menu, choose
**Your account**, and under *This computer* turn on **Start Stint when I sign in**.

### Working without Wi-Fi

Just open Stint as usual. Everything works:

- the timer,
- adding and changing time,
- your reports and exports.

The box at the bottom of the menu tells you where things stand:

- **Synced**: everything is safely on the office server.
- **3 pending**: three changes are saved on your computer and waiting to be sent.
- **Offline · 3 saved**: you're not connected right now, and three changes are waiting. Carry
  on as normal.
- **Sync problem**: something went wrong talking to the server. Click it to see what; your time
  stays safe on your computer.

When you're back in the office, Stint sends your time by itself. You don't have to do anything.

---

## In a web browser

### The first time (you need to be in the office for this)

1. Open the address your administrator gives you, for example
   `https://office-pc.local:47600`.
2. The first time, the browser may warn that the connection isn't private. Stint uses its own
   security certificate, so ask your administrator before you continue.
3. Sign in, and choose your own password.

### Make it easy to open again

So you always come back to the **same address**, do one of these:

- **Chrome or Edge:** click the **install** icon in the address bar, or open the browser menu and
  look for **Install Stint**. You get a Stint icon on your desktop or Start menu that opens like
  a normal program.
- **Phone or tablet:** in the browser menu, choose **Add to Home Screen**.
- **Firefox or Safari on a computer:** add a **bookmark**.

### Working without Wi-Fi

Open Stint from your **icon or bookmark**, the same way as always. It opens and works just like
the app.

> ⚠️ It must be the **exact same address** you used the first time. If you normally use
> `https://office-pc.local:47600`, typing the server's number address (like `192.168.1.20`)
> won't work offline.

---

## Things that stop Stint working offline

| Don't… | Because… |
| --- | --- |
| **Sign out** when you're done | Signing out removes your copy from the computer. It's meant for shared computers. Just close the window instead. |
| Clear your browser's history or "site data" | That throws away the browser's copy of Stint, **including time that hasn't been sent yet**. |
| Use a private or incognito window | Private windows forget everything when you close them. |
| Try to sign in for the first time away from the office | The first sign-in on each computer needs the office server. After that, it works anywhere. |

---

## What needs the office connection

You can do almost everything offline. These need you to be connected:

- **Submitting your timesheet.** Stint sends any waiting time first, so nothing is missed.
- **Seeing new projects** someone else created while you were offline. They appear once you're
  connected.
- **Manager and admin work:** approving timesheets, adding people, projects and clients, and
  settings.

**Working from home a lot?** Your administrator can set up remote access, so Stint syncs from
anywhere. See [REMOTE_ACCESS.md](REMOTE_ACCESS.md).

---

## Quick help

| Problem | What to do |
| --- | --- |
| "pending" or "Offline" doesn't go away | You're probably not connected to the office network, or the server computer is switched off. Your time is safe; it's sent as soon as the server can be reached. |
| A change was "not accepted" after syncing | That week or month was already approved. Ask your manager to send it back, or an admin to unlock it. |
| The app can't find the company | Make sure you're on the office network (not guest Wi-Fi), then use the pairing code. |
| Forgot your password | Ask your Stint administrator to reset it. |
