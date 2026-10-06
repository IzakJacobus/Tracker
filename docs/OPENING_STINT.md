# How to open Stint

Stint runs in your **web browser** (Chrome, Edge, Firefox or Safari) on Windows, Linux, Mac,
phones and tablets. There's nothing to install. This page explains how to open it, how to keep it
one click away, and how to keep working when you're not connected.

---

## The first time (you need to be in the office for this)

1. Open the address your administrator gives you, for example `https://office-pc.local:47600`.
   On a phone you can scan the QR code from the administrator instead.
2. The first time, the browser may warn that the connection isn't private. Stint uses its own
   security certificate. Your administrator can install it on your computer so the warning goes
   away (the link is on Stint's setup and Health pages). Ask before you click past the warning.
3. Sign in with your email and the password from your administrator, then choose your own
   password.

## Make it one click away

So you always come back to the **same address**, do one of these:

- **Chrome or Edge:** click the **install** icon in the address bar, or open the browser menu and
  choose **Install Stint**. You get a Stint icon on your desktop, Start menu or app list that opens
  in its own window, like a normal program.
- **Phone or tablet:** in the browser menu, choose **Add to Home Screen**.
- **Firefox or Safari on a computer:** add a **bookmark**.

## Working without Wi-Fi

Open Stint from your **icon or bookmark**, the same way as always. Everything works: adding and
changing time, your reports and exports.

> ⚠️ It must be the **exact same address** you used the first time. If you normally use
> `https://office-pc.local:47600`, typing the server's number address (like `192.168.1.20`)
> won't work offline.

The box at the bottom of the menu tells you where things stand:

- **Synced**: everything is safely on the office server.
- **3 pending**: three changes are saved on your computer and waiting to be sent.
- **Offline · 3 saved**: you're not connected right now, and three changes are waiting. Carry
  on as normal.
- **Sync problem**: something went wrong talking to the server. Click it to see what; your time
  stays safe on your computer.

When you're back in the office, Stint sends your time by itself. You don't have to do anything.

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
| The address doesn't open | Make sure you're on the office network (not guest Wi-Fi). If the `.local` address doesn't work, ask your administrator for the number address (like `https://192.168.1.20:47600`). |
| Forgot your password | Ask your Stint administrator to reset it. |
