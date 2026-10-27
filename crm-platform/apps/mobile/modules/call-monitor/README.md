# call-monitor (Android)

A local Expo module with two jobs. Both draw the same card over the phone's call screen: the app's name with a close button, and under it
the contact's initials, name, what they are and the number.

The card is a deep panel (the theme's `brand` colour) holding the contact's card (the `primary` blue). A caller-ID card also has a **Last Missed Call**
row: the time of that number's last missed call (`MissedCalls.kt` reads it from the call log, newest 300 missed calls, nothing kept) in the phone's
own time format with Today / Yesterday / the date, or "No missed calls". A card built without those words (a list kept by an older build, or a call
placed from the app) leaves the row off. The words are `calls.monitor.lastMissed`, `noMissed`, `today`, `yesterday`.

## 1. A call placed from the app

`CallMonitorService` is started by the app (`startCallMonitor`, `src/lib/device/call-monitor.ts`) just before it places a call. It
watches the phone's call state (no numbers, no call log), shows the card while the call is on, and when the call ends opens the app on the
"log this call" screen (`/call-summary`).

## 2. Caller ID: a call from a contact that rings the phone, or one placed from the phone's own dialler

`IncomingCallReceiver` (a manifest receiver for `android.intent.action.PHONE_STATE`) wakes even when the app is closed. When the phone
rings from a number that is in the list kept on the phone, it draws the card itself (`IncomingCaller`: the contact's name and number, and
the app's name) and takes it away when the call ends. **A tap on the card opens the app on that contact** (`/contact/<id>`). A number
that is hidden, nobody's, or too short does nothing. It does nothing either while caller ID is off, or "display over other apps" is not
allowed.

**When the call ends** (picked up, cut or missed) the app opens its existing "Add call" page (`/call-summary`, the same page that opens after
a call placed from the app) for that contact: `direction=incoming`, the start time, how long it lasted, and `status=notAnswered` when it was
never picked up (the phone cannot tell a cut call from a missed one). Saving there calls `POST /v2/calls/log` (right `call.logs.create`),
which stores the call as a call record (direction, outcome, duration, notes) that the Call logs screen and the contact's timeline show; the
subject, purpose, result and description are written into its notes. The page is opened while the card is still up, because a window of
the app on screen is what lets it start a screen from the background; if the person closed the card first, it is not opened.

**A call the person places from the phone's own dialler** (not from the app) shows the same card. The phone's state report does not say which number
is being dialled, so the receiver also listens for `NEW_OUTGOING_CALL`, the one broadcast that carries it (permission `PROCESS_OUTGOING_CALLS`, asked
for together with the call-log permission as the one "read the number" step). The card is drawn as the call is dialled and goes when it ends; the
"Add call" page then opens as an **outgoing** call (never "not answered": an outgoing call goes off hook as it is dialled, so the phone cannot say whether
the other side picked up). A dialled call that never starts (the person backs out) has its card taken away after 30 seconds. A call placed from the
app has its own card (job 1), so `CallMonitorService.running` keeps this one from drawing a second.

Why the receiver draws the card and does not start a service: Android 12 and later refuse a foreground service started from a broadcast
while the app is closed (`ForegroundServiceStartNotAllowedException`; found on the Android 17 emulator). "Display over other apps" does
allow a window, and a window on screen also keeps the app's process alive for the length of the call.

### Why a list on the phone, not a lookup

When a call rings the app may be closed and the phone locked, and the sign-in lives in the keychain, which a locked phone cannot open
(ADR-0023). So the receiver never calls the API. The app fills `CallerDirectory` (a private file, `caller-directory.json`, in the app's own
storage) while it is open, and the receiver only reads it. That is also what makes the card appear at once, with no network wait.

- **What is kept:** each contact's id, name and number, and the card's words and colours (translated and themed in the app). Up to 5,000
  contacts (`CALLER_MAX_CONTACTS`), newest first, read through the same contacts list the app already uses.
- **When it is read:** when caller ID is turned on, and again when the app comes to the front if the list is more than 15 minutes old
  (`useCallerIdSync`, mounted once in the signed-in layout).
- **When it is forgotten:** when caller ID is turned off, and whenever a session ends on the phone (`endSession`: sign-out, a refused
  refresh, a forced logout).
- **Matching:** on the last ten digits of the number, so `+91 98765 43210`, `098765 43210` and `98765 43210` are one person.

### Permissions (the person is asked on the Caller ID screen, Menu > Preferences, never at launch)

| Permission                | Why                                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `READ_PHONE_STATE`        | to hear that the phone is ringing and when the call ends                                                                 |
| `READ_CALL_LOG`           | Android gives the number of a ringing call only to an app that may read the call log; the app reads nothing else from it |
| `PROCESS_OUTGOING_CALLS`  | the number of a call the person places from the dialler (asked for with the call-log permission)                         |
| "Display over other apps" | to draw the card over the call screen (the person turns it on in the phone's own settings page)                          |

### Store consequences (for the release owner)

- **Google Play:** `READ_CALL_LOG` and `PROCESS_OUTGOING_CALLS` are restricted permissions. The Permissions Declaration Form must name the core feature ("shows the
  name of a CRM contact when they call") and the app must not be listed without it being the app's declared purpose. The data-safety form
  must list "phone number" and "name" as processed on the device, **not collected** (nothing is sent off the phone when a call comes in).
- **Privacy policy:** say that contact names and numbers are copied to the phone only to name a caller, and removed on sign-out.
- **iOS:** not available (Apple allows caller identification only through a Call Directory extension that has its own review).
- **Release type:** native code, so a new binary and a version bump; an OTA update cannot carry it.

### How to test it on an emulator

1. Build and install the app (`pnpm --filter @crm/mobile android`), sign in, open Menu > Caller ID and turn it on (allow the phone and
   call-log permissions, then "display over other apps").
2. Grant the permissions from the host if you do not want to tap through them: `adb shell pm grant <package> android.permission.READ_CALL_LOG` and `READ_PHONE_STATE`, and `adb shell appops set <package> SYSTEM_ALERT_WINDOW allow`. Then `adb emu gsm call <a number that is in the list>` rings the emulator from that number. The card appears; tap it to open
   the contact. `adb emu gsm cancel <number>` ends the call.
3. A number that is in no contact should show nothing.

## Files

| File                      | Part                                                                                                                   |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `CallMonitorModule.kt`    | the functions the app calls (`start`, `configureCallerId`, `setCallerDirectory`, `clearCallerId`, `callerIdStatus`...) |
| `CallMonitorService.kt`   | job 1: a call placed from the app                                                                                      |
| `CallerDirectory.kt`      | the contacts file, the switch, the card's words; number matching                                                       |
| `IncomingCallReceiver.kt` | job 2: hears the phone ring, and a call placed from the dialler                                                        |
| `IncomingCaller.kt`       | job 2: shows and hides the card, opens the contact on a tap                                                            |
| `CallOverlay.kt`          | the card itself, shared by both                                                                                        |
| `MissedCalls.kt`          | the "Last Missed Call" row (reads the call log for one number)                                                         |
