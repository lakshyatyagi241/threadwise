# Agent status bar and automatic Away: how to check it on the deployed site

**Nobody has verified this in a browser.** The rule, the API, the plan flags, the permission scopes, tenant isolation and the routing engine are covered by automated tests
(see the pull request), but the pill, its menu, the Working hours dialog, the Inbox notice and every translation were never opened by a person. This guide is for the team to do
that on the deployed site. Design: [specs/agent-status-bar.md](../specs/agent-status-bar.md). Allow 40 minutes.

You need: an operator login (for `/admin/workspace-plans`), one test workspace, and in it an admin, a Manager, two Agents (call them Ana and Bo) and a Viewer. A second browser (or a
private window) for two sessions at once. The simulator channel in the Inbox is enough for chats; a real WhatsApp number is not needed.

## 0. Set the plan flags (operator console)

Two plan features control everything: `agent_status_bar` and `agent_status_automation`. Both start **off** for a new plan; the sample plans Growth and Scale have them on and Starter off.
To set them for just your test workspace:

1. Sign in to the operator console and open **Plans and workspaces** (`/admin/workspace-plans`).
2. Find the test workspace and open its **plan and overrides**.
3. Under **Feature overrides** set `agent_status_bar` and `agent_status_automation` as each section below says. An override wins over the plan in both directions. Save.
4. The API reads the plan on every request; the web reads the entitlements when a page loads, so **reload the page** after changing a flag.

For the Smart routing checks (section 5) the workspace also needs `inbox_routing` on (override, or the Smart routing add-on).

Start with **both on**.

## 1. The pill is everywhere

1. Sign in as Ana. Look at the top bar next to the bell and your avatar: a pill with a green dot and **Available**.
2. Open Contacts, Settings, Billing, the Inbox: the pill is on every screen.
3. At the top of the Inbox list the same pill appears again.
4. Narrow the window to phone width: the pill stays visible (its text truncates), nothing overflows sideways.
5. Switch light and dark: the dot and the text stay readable.

Expected: one pill in the top bar on every screen and one at the top of the Inbox list; both show the same state.

## 2. Set as away / available

1. Select the pill. The menu shows Ana's name, **Update status** with **Set as away**, and **Automate status** with **Manage working hours and out of office**.
2. Select **Set as away**. The pill turns to **Away** with a muted dot, in both places, at once.
3. Open the account menu (avatar): the **Availability** row reads **Away**, switch off. Press it: you are **Available** again, and the pill follows.
4. Open the pill menu again: the option now reads the opposite (**Set as available** while Away).
5. The word **Offline** appears nowhere in these controls.

Expected: three controls (top pill, Inbox pill, account row) always agree.

## 3. Working hours and automatic Away

1. Pill menu, **Manage working hours and out of office**, then **Working hours**. The dialog opens with **Automate my status** off, the time zone filled from the workspace and Monday to Friday 09:00 to 18:00.
2. Switch **Automate my status** on. Make **today** open for one hour that does **not** include the current time (for example two hours from now). Leave the time zone as is. Save.
3. Expected within a minute: the pill reads **Away outside working hours** and the Inbox shows **Outside of working hours** under the pill. The account row reads the same.
4. Open the dialog again and make today open all day (**Open all day**). Save. Expected: the pill returns to **Available**.
5. Tick every day off and save with Automate on: a warning says no day is open and you will always show as Available. Saving is allowed; the pill stays **Available**.
6. Add a second range to a day (**Add hours**); try an overnight range (22:00 to 06:00): the line says it closes the next morning. Try two overlapping ranges: an error under the day, nothing saved.
7. Change the time zone to one where the hour you set is now: the pill changes accordingly after saving. **Use the workspace time zone** puts the zone back.

## 4. Your choice beats the schedule, and ends at the next boundary

1. With hours that put you **Away** now (step 3.2), press **Set as available**. Expected: **Available**, even outside the hours.
2. Set hours so the current hour ends in **3 minutes** (for example today 09:00 to 14:33 at 14:30). Press **Set as away** now. Wait until the end passes and the pill refreshes (reload at most once a minute). Expected: the pill is **Away outside working hours** (the schedule), not a forgotten manual Away.
3. Switch **Automate my status** off, press **Set as away**, wait past any boundary: it stays **Away** until you change it.

## 5. Automatic assignment skips people outside their hours

1. As admin, open Auto-assignment, create a round robin rule for Ana and Bo (keyword `poolword`) and switch it on.
2. Give Ana hours that exclude now (section 3.2); leave Bo with no schedule.
3. Send three simulator messages containing `poolword`. Expected: all go to Bo.
4. Open **Try it** with `poolword`: Ana is listed as left out with **outside their working hours**.
5. Press **Set as available** as Ana and repeat: both receive chats.
6. As Ana, **Set as away** (manual). Try it now says Ana is **away, busy or at their chat limit**.
7. The assign menu on a chat and **Send to queue** list Ana as **Away, outside working hours** when the schedule has her away, and **Away** when she chose it.

## 6. Leave

1. Pill menu, **Manage working hours and out of office**, **Time off**: the leave dialog opens (the same as the account menu's **Time off**).
2. Record leave from today for three days. Expected: the pill reads **On leave until `<date>`**, the Inbox pill too.
3. As Ana press **Set as available** while on leave: **Available** (your own choice beats the leave). Remove the leave: back to the normal state.
4. A custom role without the leave management permission has **no Time off** line in the menu but still has **Working hours** (it can read them, and cannot save). A Viewer has both for themselves.

## 7. Plan flags off, and turned off mid-day

1. Flip `agent_status_automation` **off** for the workspace and reload as Ana (who has hours that put her away).
   Expected: the pill reads **Available** at the next refresh (the schedule is ignored); the Working hours dialog is read only, shows **included in a higher plan** with a link to Plans, and **Save** is not offered.
2. Flip it **on** again: Ana's saved hours are back and she is **Away outside working hours** again.
3. Flip `agent_status_bar` **off** and reload: the pill still shows the state, but its menu is a note naming a higher plan with a link to Plans (plus a **Working hours** line while `agent_status_automation` is on). The account menu's **Availability** switch still works.
4. With `agent_status_automation` on and `agent_status_bar` off, hours can still be set from Settings, Team members (section 8) and are still enforced.

## 8. Roles and Settings

1. As Ana (Agent): set your own hours; open Settings, Team members: the clock icon on **another** person's row opens their hours **read only** (no Save).
2. As the Manager: the clock icon on Ana's row opens her hours and **Save** works; the dialog title says **Working hours of Ana**.
3. As the Viewer: set your own hours from the pill. The Viewer cannot change Ana's.
4. As a custom role that has no access to Team settings: the pill still opens **Working hours** for yourself.
5. Team members and team member lists show a dot that agrees with the pill (Away outside the hours shows as away).

## 9. Several tabs and languages

1. Open the Inbox in two tabs as Ana. In tab 1 press **Set as away**. In tab 2 switch to the tab or wait a minute: it shows **Away** too.
2. Switch the app to **Arabic**: the pill, menu, dialog and notice are in Arabic and mirror right to left. Do the same in one other language (for example German or Japanese).
3. In each language read the words for Available and Away: they must be natural and consistent between the pill, the account menu, the pickers and the dialog.

## 10. Help center

Open Help: **Your status: Available or Away**, **Working hours and automatic status** (both appear only when the workspace has the matching plan feature) and **Away, not Offline** (under
Getting started). Read them with the screen open; report anything they promise that the screen does not do.

## What to report

For each section: pass or fail, a screenshot of any failure, the role and the workspace, the time you did it and your time zone, and the flag settings. Anything in
[specs/agent-status-bar.md](../specs/agent-status-bar.md) section 8 that behaves differently on the real site is a bug in the spec or in the build: say which.
