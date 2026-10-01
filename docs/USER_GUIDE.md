# Stint user guide

This guide is for everyone who records time in Stint. You don't need to know anything about
servers or networks.

## Getting started

### Install the app (Windows)

1. Ask your office administrator for the installer (`Stint_…_x64-setup.exe`), or download it
   from the firm's release page.
2. Run it. If Windows warns about an unknown publisher, click **More info → Run anyway**.
3. Open **Stint** from the Start menu. The app looks for your office's Stint Server and shows
   your firm's name. Click it.
4. Sign in with the email address and password your administrator gave you. The first time,
   you'll be asked to choose your own password.

If your firm isn't listed, click **Use a pairing code** and type the 24-character code your
administrator gives you, for example `R2M0-255S-Y1YK-82FK-HRZT-A9AB`.

Stint starts with Windows and sits in the system tray, by the clock. Closing the window keeps
it running there. Right-click the tray icon to start or stop the timer, or to quit.

### Use it in a browser (Mac, phone, tablet)

Open the address your administrator gives you, for example `https://office-pc.local:47600`. The
first time, the browser may say the connection isn't private: your firm's server uses its own
certificate. Ask your administrator before you continue. On a phone, choose **Add to Home
Screen** to use Stint like an app.

## Recording time

### The timer

The bar at the bottom of every screen is the timer.

1. Type what you're working on, for example *Pile capacity check*.
2. Choose the project (and task, if there is one). Start typing to search. Your favourites and
   recent projects are at the top.
3. Press **Enter** or the ▶ button. The time runs in ochre, so you can see it's on.
4. Press ■ to stop. The entry is saved.

Press **S** anywhere in Stint to start or stop the timer, as long as you aren't typing in a
box.

Changed your mind about what you're doing? Edit the description or project while the timer
runs.

### Adding time afterwards

- **Add time** (or press **N**) opens a form. Enter the date, a start time and either an end
  time or a duration. Durations can be typed as `1:30`, `1.5`, `1h30` or `90m`.
- **Week** view is a spreadsheet: one row per project, one column per day. Click a cell and
  type hours, for example `2:30`. **Enter** moves down, and the arrow keys move around. Your
  favourite projects always have a row.
- **Day** view is a calendar. Click and drag on an empty area to add a block. Drag a block to
  move it, or drag its bottom edge to change its length.

In the list view, each entry has **▶ Continue** (start the timer again on the same work) and a
**⋯** menu with *Duplicate*, *Edit* and *Delete*. Deleting can be undone from the message that
appears.

### Billable or not

Each project has a default. Client work is usually billable, and internal work (admin,
training, leave) isn't. The **$** button beside the timer switches it for one entry. You can
only see rates and amounts if your firm allows it.

### Tags

Use tags such as *site*, *travel* or *overtime* to group time across projects. Click the tag
icon beside the timer.

### Working offline

Stint saves everything on your own computer first, so you can keep working without a
connection: on site, on a plane, or when the office PC is off. The pill at the bottom of the
menu shows:

- **Synced**: everything is on the server.
- **Pending**: changes are waiting to upload. They upload by themselves when the server is
  back.
- **Offline**: you can't reach the server right now. Keep working as normal.

Don't sign out while changes are pending. Stint warns you if you try.

### When you're away from your desk

If the timer is running and you haven't touched the PC for a while (10 minutes unless your
administrator changed it), the desktop app asks what happened when you come back:

- **Keep the time**: you were in a meeting about the project.
- **Discard and continue**: drop the time you were away, and carry on timing from now.
- **Discard and stop**: stop the timer at the moment you left.

On Linux this works on GNOME and on X11 desktops. On other Wayland desktops (KDE Plasma, Sway)
the app can't tell when you're away, so it doesn't ask. Its settings page says so.

### Reminders

If today (after the reminder time your firm set, 16:30 for example) or your last working day has
less time than expected, a reminder appears at the top of **Track**. Dismiss it if the day was
genuinely short. In a browser, Stint can also show it as a notification if you allow that. The
desktop app always uses Windows notifications.

## Submitting your timesheet

At the end of each period (a week or a month, as your firm decides), a card at the top of
**Track** asks you to submit.

1. Check your time. The card warns you about short days.
2. Click **Submit**. Stint uploads any pending changes first.
3. Your manager approves it or sends it back with a comment. If it's sent back, the comment
   appears on the card. Fix the entries and submit again.

Once a timesheet is submitted or approved, its entries can't be changed. To fix something, ask
your manager to send it back. If it's already approved, ask an administrator to unlock it.

## Reports

**Reports** shows your own time. Managers see their team's time, and admins see everyone's.

- **Overview**: hours, billable share and top projects for a period.
- **Monthly timesheet**: one person's month, by project and by day, ready to sign.
- **Project timesheet**: everything on a project and its sub-projects.
- **Client summary**: hours per client and project, for invoicing.

Every report has **PDF**, **Excel** and **CSV** buttons. Reports are worked out on your own
computer, so they work offline too.

## Keyboard shortcuts

| Key | Does |
| --- | --- |
| <kbd>Ctrl</kbd>+<kbd>K</kbd> or <kbd>/</kbd> | Command palette: search projects, pages and actions |
| <kbd>S</kbd> | Start or stop the timer |
| <kbd>N</kbd> | Add time |
| <kbd>←</kbd> <kbd>→</kbd> | Previous or next week (or day) on Track |
| <kbd>T</kbd> | Back to today |
| <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> | List, Week or Day view |
| <kbd>?</kbd> | Show all shortcuts |

## Your account

Click your name at the bottom of the menu to:

- change your password,
- switch between light, dark and system themes, and
- (desktop app) choose whether Stint starts with Windows, or disconnect from the server.

On a shared computer, **sign out** when you're done. This removes your copy of the data from
that computer.

## Questions

- **I forgot my password.** Ask an administrator to reset it.
- **I can't find my project.** You only see projects you've been added to, plus internal ones.
  Ask the project's manager to add you.
- **Two timers?** You can only have one timer running. If you started one on your laptop and
  another on your desktop while offline, Stint keeps the one started last and stops the other
  when they sync.
- **My entry vanished after syncing.** It was probably in a locked (submitted or approved)
  period. Stint shows a message when it can't save a change, and why.
