<!-- docs/checks/04-remote-control.md -->

# Check 4: phone notifications and STOP by message

**Answer:** Yes, with conditions — on both systems a message sent from the phone through Remote Control reaches the session, and on Windows it is marked as coming from Remote Control. On the Mac a notification reached the locked phone once Claude's push switches were on, the phone allowed Claude's notifications, and the Mac's screen was locked. A push is skipped while the director is at the computer.

## Question

That a session's notification reaches the director's phone through Remote Control, and that a "stop" sent from the phone reaches the session in a form a hook or the mod can recognise as the director's.

## Tested on

Windows 11, Claude Desktop (Claude Code 2.1.299), with Remote Control connected and the Claude app on the director's phone, 17 October 2026.

macOS, Claude Desktop (Claude Code 2.1.299), with Remote Control on for the session and mobile push switched on, 17 October 2026.

## Method

On Windows:

1. The session called Claude Code's notification tool with a one-line test message.
2. The director sent the session "check 4 from phone" from the Claude app on their phone. The probe mod from check 9 was loaded, and its `prompt.submit` hook logged each message's origin. The word "stop" wasn't used, because nothing yet acts on it.

On the Mac, the same notification tool was called four times, and the director answered by card whether each arrived. No mod was loaded, so the origin of phone messages wasn't logged there.

## Evidence

- **Windows, notifications:** the tool answered "Push not sent — mobile push is disabled in /config". Remote Control was connected, and the app's own setting for connecting new sessions to Remote Control was on. The mobile push switch is a separate Claude Code setting, changed from `/config` in a terminal session; the app's settings don't include it.
- **Windows, the phone message:** it arrived in the session as an ordinary message from the director. The mod logged it with `origin: { kind: "bridge" }`. Messages typed in Desktop were logged with `origin: { kind: "composer" }`.
- **Mac, the setting:** mobile push is `agentPushNotifEnabled: true` in the user settings (`~/.claude/settings.json`), so setup can switch it on by writing that file, without `/config`.
- **Mac, notifications:** the first three calls answered "Mobile push requested". None reached the phone. The phone's own setting had Claude's notifications off for the first; the director switched them on before the second and third, which still didn't arrive. One card answer first said the second had arrived; the director then wrote from the phone that it hadn't, and a last card confirmed that neither had. The director was using the Claude app on the phone at the time, which may have kept them from showing; that wasn't isolated.
- **Mac, the fourth call:** sent seconds after the director clicked a card, it answered "Not sent — this terminal is active". The tool skips a push while the director is active at the computer, so a push only goes out when they've been away from it.
- **Mac, the second sitting:** the director found a notification switch within Claude off, and switched on both push options, "Push when Claude decides" and "Push when actions required". A push sent two minutes after their last message went out ("Mobile push requested") but didn't arrive. Two more, sent while the Desktop window was in front and soon after the director had typed, answered "Not sent — this terminal is active". With the Mac's screen locked, the next push went out and reached the locked phone.
- **Mac, phone messages:** three messages the director typed on the phone arrived in the session during a running turn, as ordinary messages from them.
- A project's `UserPromptSubmit` hook wasn't tried. Check 9 showed it can't tell the director from a mod, so the mod's `prompt.submit` is where STOP by message belongs.

## What it means for the design

- Section 12.7: STOP from the phone works as written, if the mod sets it. A Remote Control message that is just "stop" reaches the mod marked `bridge`, so the mod can set STOP for it and for nothing that arrives as `sdk`, `peer` or `task-notification`.
- Section 13 and setup step 8: switching on Remote Control isn't enough for phone notifications. Setup must also switch on Claude Code's mobile push (`agentPushNotifEnabled` in the user settings), and the phone must allow Claude's notifications.
- Section 13: a push reaches the phone, but only when Claude judges the director away from the computer: it is skipped while the Desktop window is in front or they have just typed, and arrives reliably once the screen is locked. Two pushes reported as sent didn't arrive, so the phone stays a second channel: a needs-you item also stays on the board and in the next briefing. Setup's check sends its test once the director has locked the screen, and asks on their return whether it arrived.
- Setup step 8: both push switches matter. "Push when actions required" sends a push whenever a question card is waiting, which suits the director's needs-you items.

## Needs the director

No. In the pilot, the probe mod on the Mac can show a phone message's origin there too.
