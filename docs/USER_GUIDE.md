# Stint user guide

> New to Stint? Start with **[How to open Stint](OPENING_STINT.md)**: opening it in your browser,
> installing it as an app, and working without Wi-Fi.

This guide is for everyone who records time in Stint. You don't need to know anything about
servers or networks.

## Getting started

Stint runs in your web browser (Chrome, Edge, Firefox or Safari) on any computer, phone or
tablet. There's nothing to install.

1. Open the address your administrator gives you, for example `https://office-pc.local:47600`.
   The first time, the browser may say the connection isn't private: your firm's server uses its
   own certificate. Ask your administrator before you continue.
2. Sign in with the email address and password your administrator gave you. The first time,
   you'll be asked to choose your own password.
3. To use Stint like an app, choose **Install Stint** from the browser menu (on a phone: **Add to
   Home Screen**).

## Logging your hours

### Log hours

Click **Log hours** on the Track page, or press **N** anywhere in Stint (as long as you aren't
typing in a box).

1. **Worked on**: choose the project, then the item you worked on. Projects are broken down into
   items (phases, tasks, work packages…, whatever your firm uses); click an item to go a level
   deeper, and **Back** to go up. Hours go on the lowest level. You can also type to search by
   name or project code. Your favourites (☆) and recent items are at the top.
2. **Date**: the day you did the work.
3. **Hours**: type `1.5`, `1:30` or `90m`. A whole number up to 12 is hours (`8`); above
   that it is minutes (`45`).
4. **Note** (optional): what you did, for example *Pile capacity check*.

Items that are marked **done** don't appear: their work is finished. Ask the project's manager to
reopen one if you still need it.

### Filling in a whole week

**Week** view is a spreadsheet: one row per item, one column per day. Click a cell and type
hours, for example `2:30`. **Enter** moves down, and the arrow keys move around. Your favourite
items always have a row, and **Add row** adds another.

In the list view, each entry has **+** (log more hours on the same item and day) and a **⋯** menu
with *Edit*, *Duplicate* and *Delete*. Deleting can be undone from the message that appears.

### Tags

Use tags such as *site*, *travel* or *overtime* to group time across projects. Choose them in the
Log hours window.

### Working offline

Stint saves everything on your own computer first, so you can keep working without a
connection: on site, on a plane, or when the office PC is off. The pill at the bottom of the
menu shows:

- **Synced**: everything is on the server.
- **Pending**: changes are waiting to upload. They upload by themselves when the server is
  back.
- **Offline**: you can't reach the server right now. Keep working as normal.

Don't sign out while changes are pending. Stint warns you if you try.

### Reminders

If today (after the reminder time your firm set, 16:30 for example) or your last working day has
less time than expected, a reminder appears at the top of **Track**. Dismiss it if the day was
genuinely short. Stint can also show it as a notification if you allow that.

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
| <kbd>N</kbd> | Log hours |
| <kbd>←</kbd> <kbd>→</kbd> | Previous or next week on Track |
| <kbd>T</kbd> | Back to today |
| <kbd>1</kbd> <kbd>2</kbd> | List or Week view |
| <kbd>?</kbd> | Show all shortcuts |

## Your account

Click your name at the bottom of the menu to:

- change your password,
- switch between light, dark and system themes.

On a shared computer, **sign out** when you're done. This removes your copy of the data from
that computer.

## Questions

- **I forgot my password.** Ask an administrator to reset it.
- **I can't find my project.** You only see projects you've been added to, plus internal ones.
  Ask the project's manager to add you.
- **I can't log hours on a project.** If it has items under it, choose one of them: hours go on the
  lowest level. If the item you want isn't listed, it may be marked done; ask the project's
  manager to reopen it.
- **My entry vanished after syncing.** It was probably in a locked (submitted or approved)
  period. Stint shows a message when it can't save a change, and why.
